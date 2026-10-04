// Stockz trade panel: buy / sell a token through the Portal (flap docs: quoteExactInput + swapExactInput).
// Safety: exact-amount approvals only, every swap is simulated before the wallet opens, slippage-protected minimum.
(() => {
const C = window.FLAPCITY_CONFIG, E = window.ethers, PORTAL = C.launch.portal;
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const QUOTE = 'function quoteExactInput((address inputToken, address outputToken, uint256 inputAmount) params) returns (uint256 outputAmount)';
const SWAP = 'function swapExactInput((address inputToken, address outputToken, uint256 inputAmount, uint256 minOutputAmount, bytes permitData) params) payable returns (uint256 outputAmount)';
const ERC20 = ['function decimals() view returns (uint8)', 'function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)'];
const CH = () => window.StockzChain;
const withRead = fn => CH().withRead(fn);
const fmt = (v, d) => { const n = Number(E.formatUnits(v, d)); return n === 0 ? '0' : n < 0.0001 ? n.toExponential(3) : n.toLocaleString('en-US', { maximumFractionDigits: n < 1 ? 6 : 4 }); };
const short = e => String((e && (e.shortMessage || e.reason || e.message)) || e).slice(0, 160);

function mount(box, t) {
  const stock = (C.stockTokens || []).find(s => s.t === t.quote);
  if (!box || !stock) { if (box) box.innerHTML = ''; return; }
  const Q = E.getAddress(stock.address), TK = E.getAddress(t.token);
  let side = 'buy', slip = 100, dec = { [Q]: 18, [TK]: 18 }, timer = null, lastQuote = null, busy = false;
  box.innerHTML = `<div class="trade">
    <div class="trtabs"><button type="button" class="trtab on" data-s="buy">Buy</button><button type="button" class="trtab" data-s="sell">Sell</button></div>
    <div class="trrow"><span class="trlbl" id="trPayLbl">Pay (${esc(stock.t)})</span><span class="trbal" id="trBal">Balance: –</span></div>
    <div class="trin"><input id="trAmt" inputmode="decimal" placeholder="0.0" autocomplete="off"><button type="button" id="trMax">MAX</button><span id="trUnit">${esc(stock.t)}</span></div>
    <div class="trrow"><span class="trlbl">Slippage</span><div class="trslip"><button type="button" data-v="50">0.5%</button><button type="button" data-v="100" class="on">1%</button><button type="button" data-v="300">3%</button><button type="button" data-v="500">5%</button><input id="trSlipC" placeholder="custom" inputmode="decimal"></div></div>
    <dl class="trinfo"><dt>You receive (est.)</dt><dd id="trOut">–</dd><dt>Minimum received</dt><dd id="trMin">–</dd><dt>Fees</dt><dd>Protocol fee + token tax, included</dd></dl>
    <button type="button" class="bigbtn" id="trGo" disabled><i>▶</i> Enter an amount</button>
    <div class="trmsg" id="trMsg"></div></div>`;
  const $ = s => box.querySelector(s);
  const pair = () => side === 'buy' ? { inT: Q, outT: TK, inSym: stock.t, outSym: t.symbol } : { inT: TK, outT: Q, inSym: t.symbol, outSym: stock.t };
  const msg = (h, ok) => { $('#trMsg').innerHTML = h; $('#trMsg').className = 'trmsg' + (ok ? ' ok' : ''); };

  async function loadDec() {
    for (const a of [Q, TK]) { try { dec[a] = Number(await withRead(p => new E.Contract(a, ERC20, p).decimals())); } catch {} }
  }
  async function balance() {
    const W = window.StockzWallet && window.StockzWallet.state();
    if (!W || !W.account) { $('#trBal').textContent = 'Balance: –'; return null; }
    try { const p = pair(), b = await withRead(r => new E.Contract(p.inT, ERC20, r).balanceOf(W.account)); $('#trBal').textContent = 'Balance: ' + fmt(b, dec[p.inT]); return b; }
    catch { $('#trBal').textContent = 'Balance: –'; return null; }
  }
  function amountIn() { const v = ($('#trAmt').value || '').trim(); if (!/^\d*(\.\d+)?$/.test(v) || !Number(v)) return null; try { return E.parseUnits(v, dec[pair().inT]); } catch { return null; } }
  function setBtn() {
    const a = amountIn(), W = window.StockzWallet && window.StockzWallet.state(), b = $('#trGo');
    if (busy) return;
    if (!W || !W.account) { b.disabled = false; b.innerHTML = '<i>▶</i> Connect wallet'; return; }
    b.disabled = !a || !lastQuote; b.innerHTML = a ? `<i>▶</i> ${side === 'buy' ? 'Buy' : 'Sell'} ${esc(t.symbol)}` : '<i>▶</i> Enter an amount';
  }
  async function quote() {
    const a = amountIn(); lastQuote = null; $('#trOut').textContent = '–'; $('#trMin').textContent = '–'; msg('');
    if (!a) { setBtn(); return; }
    const p = pair();
    try {
      const out = await withRead(r => new E.Contract(PORTAL, [QUOTE], r).quoteExactInput.staticCall({ inputToken: p.inT, outputToken: p.outT, inputAmount: a }));
      lastQuote = out;
      $('#trOut').textContent = fmt(out, dec[p.outT]) + ' ' + p.outSym;
      $('#trMin').textContent = fmt(out * BigInt(10000 - slip) / 10000n, dec[p.outT]) + ' ' + p.outSym;
    } catch (e) { msg('No quote available for this trade right now.'); console.warn('[Stockz] quote:', short(e)); }
    setBtn();
  }
  const requote = () => { clearTimeout(timer); timer = setTimeout(quote, 350); };

  async function go() {
    const W = window.StockzWallet;
    if (!W.state().account) { try { await W.connect(); } catch (e) { console.warn('[Stockz] connect:', short(e)); } await balance(); setBtn(); return; }
    const a = amountIn(); if (!a || !lastQuote || busy) return;
    const { signer, account } = W.state(), p = pair();
    busy = true; const b = $('#trGo'); b.disabled = true;
    try {
      const bal = await withRead(r => new E.Contract(p.inT, ERC20, r).balanceOf(account));
      if (bal < a) throw new Error(`Not enough ${p.inSym}.`);
      const erc = new E.Contract(p.inT, ERC20, signer);
      if ((await withRead(r => erc.connect(r).allowance(account, PORTAL))) < a) {
        b.innerHTML = '<i>…</i> Approve in wallet'; msg(`Approving exactly ${esc($('#trAmt').value)} ${esc(p.inSym)}…`);
        const atx = await CH().sendTx(erc, 'approve', [PORTAL, a], {}, account); const arc = await CH().waitTx(atx); if (!arc || arc.status !== 1) throw new Error('Approval failed.');
      }
      const fresh = await withRead(r => new E.Contract(PORTAL, [QUOTE], r).quoteExactInput.staticCall({ inputToken: p.inT, outputToken: p.outT, inputAmount: a }));
      const params = { inputToken: p.inT, outputToken: p.outT, inputAmount: a, minOutputAmount: fresh * BigInt(10000 - slip) / 10000n, permitData: '0x' };
      const portal = new E.Contract(PORTAL, [SWAP], signer);
      b.innerHTML = '<i>…</i> Simulating';
      try { await withRead(r => portal.connect(r).swapExactInput.staticCall(params, { value: 0n, from: account })); } catch (e) { throw new Error('Simulation failed, nothing was sent. ' + CH().decodeErr(e)); }
      b.innerHTML = '<i>…</i> Confirm in wallet';
      const tx = await CH().sendTx(portal, 'swapExactInput', [params], { value: 0n }, account);
      b.innerHTML = '<i>…</i> Confirming';
      const rc = await CH().waitTx(tx); if (!rc || rc.status !== 1) throw new Error('The trade failed on-chain.');
      msg(`Done. <a href="${esc(C.explorer)}/tx/${esc(tx.hash)}" target="_blank" rel="noopener noreferrer">View on BscScan</a>`, true);
      $('#trAmt').value = ''; lastQuote = null; $('#trOut').textContent = '–'; $('#trMin').textContent = '–';
    } catch (e) {
      const m = (e && (e.code === 'ACTION_REJECTED' || e.code === 4001)) ? 'Cancelled in wallet.' : (e.message || short(e));
      msg(esc(m));
    } finally { busy = false; await balance(); setBtn(); }
  }

  box.querySelectorAll('.trtab').forEach(x => x.onclick = () => {
    side = x.dataset.s; box.querySelectorAll('.trtab').forEach(y => y.classList.toggle('on', y === x));
    const p = pair(); $('#trPayLbl').textContent = `Pay (${p.inSym})`; $('#trUnit').textContent = p.inSym; $('#trAmt').value = ''; quote(); balance();
  });
  box.querySelectorAll('.trslip button').forEach(x => x.onclick = () => { slip = +x.dataset.v; $('#trSlipC').value = ''; box.querySelectorAll('.trslip button').forEach(y => y.classList.toggle('on', y === x)); quote(); });
  $('#trSlipC').oninput = () => { const v = parseFloat($('#trSlipC').value); if (v > 0 && v <= 50) { slip = Math.round(v * 100); box.querySelectorAll('.trslip button').forEach(y => y.classList.remove('on')); quote(); } };
  $('#trAmt').oninput = requote;
  $('#trMax').onclick = async () => { const b = await balance(); if (b != null) { $('#trAmt').value = E.formatUnits(b, dec[pair().inT]); quote(); } };
  $('#trGo').onclick = go;
  window.addEventListener('stockz:wallet', () => { balance(); setBtn(); });
  loadDec().then(() => { balance(); setBtn(); });
}
window.StockzTrade = { mount };
})();
