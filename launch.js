// Stockz in-platform launch. The creator signs every transaction in their own wallet.
// Safety: every launch is simulated first (eth_call). If the simulation fails, nothing is sent and no BNB is spent.
(() => {
const C = window.FLAPCITY_CONFIG, L = C.launch, E = window.ethers;
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ZERO = '0x0000000000000000000000000000000000000000', Z32 = '0x' + '0'.repeat(64);

// newTokenV6 params, field order as in flap's developer docs (Portal launch with a custom quote token).
const V6 = 'function newTokenV6((string name, string symbol, string meta, uint8 dexThresh, bytes32 salt, uint8 migratorType, address quoteToken, uint256 quoteAmt, address beneficiary, bytes permitData, bytes32 extensionID, bytes extensionData, uint8 dexId, uint8 lpFeeProfile, uint16 buyTaxRate, uint16 sellTaxRate, uint64 taxDuration, uint64 antiFarmerDuration, uint16 mktBps, uint16 deflationBps, uint16 dividendBps, uint16 lpBps, uint256 minimumShareBalance, address dividendToken, address commissionReceiver, uint8 tokenVersion) params) payable returns (address)';
const TOKEN_CREATED = 'event TokenCreated(uint256 ts, address creator, uint256 nonce, address token, string name, string symbol, string meta)';
const ERC20 = ['function decimals() view returns (uint8)', 'function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)'];

// ---------- chain access: reads, simulations and gas estimates go through public BSC RPCs (with fallback),
// the wallet is only asked to sign. Some wallets' own RPCs drop revert data, which made calls fail blindly.
const RO = {}; let roIdx = 0;
const prov = i => RO[i] || (RO[i] = new E.JsonRpcProvider(C.rpcUrls[i], 56, { staticNetwork: true }));
const isRevert = e => !!e && (e.code === 'CALL_EXCEPTION' || /revert/i.test(String(e.shortMessage || e.message || '')));
async function withRead(fn) {
  let err;
  for (let k = 0; k < C.rpcUrls.length; k++) {
    const i = (roIdx + k) % C.rpcUrls.length;
    try { const r = await fn(prov(i)); roIdx = i; return r; } catch (e) { err = e; if (isRevert(e)) throw e; }
  }
  throw err;
}
// send a contract call from the wallet, with gas estimated on a public RPC (+30%)
async function sendTx(c, fn, args, ov = {}, from) {
  let gasLimit;
  try { const g = await withRead(r => c.connect(r)[fn].estimateGas(...args, { ...ov, from })); gasLimit = g * 13n / 10n; } catch (e) { if (isRevert(e)) throw e; }
  return c[fn](...args, gasLimit ? { ...ov, gasLimit } : ov);
}
async function waitTx(tx) {
  try { const rc = await withRead(r => r.waitForTransaction(tx.hash, 1, 240000)); if (rc) return rc; } catch {}
  return tx.wait();
}
const ERR = {
  '0x9a5c8a92': 'This stock is not allowed as a pair by the contract (QuoteTokenNotAllowed).',
  '0xb07f6501': 'This stock is not configured as a pair on the contract (InvalidQuoteTokenConfiguration).',
  '0xdf3a6581': 'The metadata was already used by another token. Please retry.',
  '0x273cc575': 'A creation fee is required (InsufficientCreationFee).',
  '0xa458261b': 'A protocol fee is required (InsufficientFee).',
  '0x3ebbc337': 'Not enough BNB sent (InsufficientEth).',
  '0xca4c5b2d': 'The token address did not meet the vanity rule. Please retry.',
  '0x524b4af7': 'That token address is already taken. Please retry.',
  '0xca7f5f0e': 'Moving the stock for the initial buy failed. Check balance and approval.',
  '0x4fd0ffbb': 'Migrator type not supported for this launch (InvalidMigratorType).',
  '0x127a76fb': 'This stock pair needs a different launch route (QuoteTokenNotNativeButNotUsingTradeV2).',
  '0xa7382e9b': 'This wallet is rate-limited for launches right now. Wait and retry.',
  '0x148e6157': 'This wallet is blocked from launching.',
  '0x9b9bf411': 'Public launches are disabled on the contract right now.',
  '0x931b4858': 'The protocol is paused right now.',
  '0xac5f6092': 'This launch function is disabled right now.',
  '0x18adb6e1': 'Invalid DEX threshold.', '0x77146b42': 'Invalid DEX threshold type.',
  '0xe2fae90a': 'Initial buy amount is too small.',
  '0x0139660b': 'Unsupported token version.', '0x3d24ab78': 'No supported DEX for this pair.',
  '0x1f541609': 'Invalid fee tier for this DEX.', '0xd5f11840': 'Invalid curve type.',
  '0x929d8da4': 'Tax is too high (max 10%).', '0xf8d94a75': 'Tax split must add up to 100%.',
  '0xd036fb98': 'Tax duration is too long.', '0xaef851bb': 'Tax duration is too short.', '0x2269dd1a': 'Anti-bot window is too long.',
  '0x01edd3fb': 'Holder rewards are not supported for this stock pair.', '0x6b9099a1': 'Holder reward minimum is too low.',
  '0x1eaf8408': 'Holder reward settings are missing.', '0x8dd5267b': 'Holder rewards must be paid in the paired stock.',
  '0xa735ace3': 'A tiny amount of BNB is needed to create a tax token with a stock pair.'
};
function decodeData(v) {
  const s = v.slice(0, 10).toLowerCase();
  if (s === '0x08c379a0') { try { return 'Contract says: "' + E.AbiCoder.defaultAbiCoder().decode(['string'], '0x' + v.slice(10))[0] + '"'; } catch {} }
  if (s === '0x4e487b71') { try { return 'Contract panic (code 0x' + BigInt('0x' + v.slice(10, 74)).toString(16) + ').'; } catch {} }
  return ERR[s] || `Contract error ${s}.`;
}
function decodeErr(e) {
  if (e && e.reason && typeof e.reason === 'string' && !/^0x/.test(e.reason)) return 'Contract says: "' + e.reason + '"';
  const seen = new Set(), stack = [e];
  while (stack.length) {
    const x = stack.pop(); if (!x || typeof x !== 'object' || seen.has(x)) continue; seen.add(x);
    for (const k of ['data', 'error', 'info', 'cause']) { const v = x[k]; if (typeof v === 'string' && /^0x[0-9a-fA-F]{8}/.test(v)) { return decodeData(v); } if (v && typeof v === 'object') stack.push(v); }
  }
  const m = String((e && (e.shortMessage || e.reason || e.message)) || e).match(/0x[0-9a-fA-F]{8}/);
  if (m && ERR[m[0].toLowerCase()]) return ERR[m[0].toLowerCase()];
  { const d = String((e && (e.shortMessage || e.message)) || '').match(/0x08c379a0[0-9a-fA-F]+/); if (d) return decodeData(d[0]); }
  if (e && (e.code === 'ACTION_REJECTED' || e.code === 4001)) return 'You rejected the request in your wallet.';
  if (/missing revert data/i.test(String(e && (e.shortMessage || e.message)))) return 'The contract rejected it without a reason. Check your balance and that this stock can be paired, then retry.';
  return String((e && (e.shortMessage || e.reason || e.message)) || e).slice(0, 220);
}

// ---------- wallet ----------
let provider = null, signer = null, account = null, connecting = false;
function waitPrivyAddress(ms) {
  return new Promise((resolve, reject) => {
    const P = window.StockzPrivy; if (P && P.address) return resolve(P.address);
    const t = setTimeout(() => { cleanup(); reject(new Error('Login timed out. Please try again.')); }, ms);
    const onState = e => { if (e.detail && e.detail.address) { cleanup(); resolve(e.detail.address); } };
    const onLogin = e => {
      if (!e.detail || e.detail.ok) return;
      const msg = String(e.detail.error || '');
      // closing the Privy window is not an error; anything else is shown as-is
      if (/exited_auth_flow|cancel|closed/i.test(msg)) { cleanup(); const er = new Error('Login was cancelled.'); er.cancelled = true; reject(er); }
      else { cleanup(); reject(new Error('Login error: ' + msg)); }
    };
    function cleanup() { clearTimeout(t); window.removeEventListener('stockz:privy', onState); window.removeEventListener('stockz:privy-login', onLogin); }
    window.addEventListener('stockz:privy', onState); window.addEventListener('stockz:privy-login', onLogin);
  });
}
function waitPrivyReady(ms) {
  return new Promise((resolve, reject) => {
    const ok = () => window.StockzPrivy && window.StockzPrivy.ready;
    const bad = () => String(window.StockzPrivyStatus || '').startsWith('error');
    if (ok()) return resolve(); if (bad()) return (console.warn('[Stockz] Privy:', window.StockzPrivyStatus), reject(new Error('Login could not load. Please reload the page and try again.')));
    const t = setTimeout(() => { cleanup(); reject(new Error('Login is taking too long. Please reload the page and try again.')); }, ms);
    const on = () => { if (ok()) { cleanup(); resolve(); } else if (bad()) { cleanup(); (console.warn('[Stockz] Privy:', window.StockzPrivyStatus), reject(new Error('Login could not load. Please reload the page and try again.'))); } };
    function cleanup() { clearTimeout(t); window.removeEventListener('stockz:privy', on); }
    window.addEventListener('stockz:privy', on);
  });
}
async function connect() {
  if (C.privyAppId) {
    try { await waitPrivyReady(25000); }
    catch (e) { if (!window.ethereum) throw e; console.warn('[Stockz] Privy unavailable, using the browser wallet:', e.message); }
  }
  const P = window.StockzPrivy;
  let eip1193;
  if (P && P.ready) {
    if (!P.address) { P.login(); await waitPrivyAddress(180000); }
    eip1193 = await window.StockzPrivy.provider();
  } else {
    if (!window.ethereum) throw new Error('No wallet found. Open Stockz inside your wallet app browser (MetaMask, Trust, OKX, Binance Wallet) or install a wallet extension.');
    eip1193 = window.ethereum;
  }
  provider = new E.BrowserProvider(eip1193, 'any');
  await provider.send('eth_requestAccounts', []).catch(() => {});
  let net = await provider.getNetwork();
  if (Number(net.chainId) !== 56) {
    try { await provider.send('wallet_switchEthereumChain', [{ chainId: '0x38' }]); }
    catch (e) {
      const code = e && (e.code ?? (e.error && e.error.code) ?? (e.info && e.info.error && e.info.error.code));
      if (code === 4902) await provider.send('wallet_addEthereumChain', [{ chainId: '0x38', chainName: 'BNB Smart Chain', nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 }, rpcUrls: ['https://bsc-dataseed.binance.org'], blockExplorerUrls: ['https://bscscan.com'] }]);
      else throw new Error('Please switch your wallet to BNB Smart Chain.');
    }
    provider = new E.BrowserProvider(eip1193, 'any');
    net = await provider.getNetwork();
    if (Number(net.chainId) !== 56) throw new Error('Please switch your wallet to BNB Smart Chain.');
  }
  signer = await provider.getSigner(); account = await signer.getAddress();
  return account;
}

// ---------- vanity salt: token address must end with the suffix the contract requires ----------
async function findSalt(taxed, onTick) {
  const impl = taxed ? L.taxImpl : L.standardImpl, suffix = taxed ? L.taxSuffix : L.suffix;
  const initCode = '0x3d602d80600a3d3981f3363d3d373d3d3d363d73' + impl.slice(2).toLowerCase() + '5af43d82803e903d91602b57fd5bf3';
  const pre = '0xff' + L.portal.slice(2).toLowerCase(), initHash = E.keccak256(initCode).slice(2), suf = suffix.toLowerCase();
  // Every Stockz salt starts with "STKZ" (0x53544b5a) so the map can recognise Stockz launches on-chain.
  let salt = '0x53544b5a' + E.hexlify(E.randomBytes(28)).slice(2);
  for (let i = 0; i < 4000000; i++) {
    const h = E.keccak256(pre + salt.slice(2) + initHash);
    if (h.endsWith(suf)) return { salt, address: E.getAddress('0x' + h.slice(-40)) };
    salt = '0x53544b5a' + E.keccak256(salt).slice(10);
    if (i % 3000 === 0) { onTick && onTick(i); await new Promise(r => setTimeout(r, 0)); }
  }
  throw new Error('Could not find a token address. Please retry.');
}

async function uploadMeta(f) {
  const fd = new FormData();
  fd.append('image', f.image); fd.append('creator', account);
  for (const k of ['description', 'website', 'twitter', 'telegram']) fd.append(k, f[k] || '');
  let r, j;
  try { r = await fetch(L.uploadApi, { method: 'POST', body: fd }); } catch { throw new Error('Could not reach the upload service. Check your connection and retry.'); }
  try { j = await r.json(); } catch { throw new Error(`Upload service not available (HTTP ${r.status}). It runs on Vercel at ${L.uploadApi}.`); }
  if (!r.ok || !j.cid) throw new Error(j.error || 'Image upload failed.');
  return j.cid;
}

// initial buy as a normal Portal swap right after the launch (5% slippage guard, simulated first)
async function buyRightAfter(quote, token, amt, stock, f, log) {
  const Q = 'function quoteExactInput((address inputToken, address outputToken, uint256 inputAmount) params) returns (uint256 outputAmount)';
  const S = 'function swapExactInput((address inputToken, address outputToken, uint256 inputAmount, uint256 minOutputAmount, bytes permitData) params) payable returns (uint256 outputAmount)';
  const erc = new E.Contract(quote, ERC20, signer);
  const al = await withRead(r => erc.connect(r).allowance(account, L.portal));
  if (al < amt) { log(`Approve exactly ${f.buy} ${stock.t} for the buy (confirm in wallet)…`); const a = await sendTx(erc, 'approve', [L.portal, amt], {}, account); const ar = await waitTx(a); if (!ar || ar.status !== 1) throw new Error('Approval failed.'); }
  const out = await withRead(r => new E.Contract(L.portal, [Q], r).quoteExactInput.staticCall({ inputToken: quote, outputToken: token, inputAmount: amt }));
  const params = { inputToken: quote, outputToken: token, inputAmount: amt, minOutputAmount: out * 9500n / 10000n, permitData: '0x' };
  const portal = new E.Contract(L.portal, [S], signer);
  await withRead(r => portal.connect(r).swapExactInput.staticCall(params, { value: 0n, from: account }));
  log(`Confirm the initial buy of ${f.buy} ${stock.t} in your wallet…`);
  const tx = await sendTx(portal, 'swapExactInput', [params], { value: 0n }, account);
  const rc = await waitTx(tx);
  if (!rc || rc.status !== 1) throw new Error('The buy failed on-chain.');
  log(`Initial buy done: <a href="${esc(C.explorer)}/tx/${esc(tx.hash)}" target="_blank" rel="noopener noreferrer">${esc(tx.hash.slice(0, 12))}…</a>`, true);
}

async function launchOne(f, stock, log) {
  const quote = E.getAddress(stock.address);
  let quoteAmt = 0n;
  if (f.buy && Number(f.buy) > 0) {
    const erc = new E.Contract(quote, ERC20, signer);
    let dec, bal, al;
    try {
      dec = await withRead(r => erc.connect(r).decimals());
      quoteAmt = E.parseUnits(String(f.buy), dec);
      [bal, al] = await withRead(r => Promise.all([erc.connect(r).balanceOf(account), erc.connect(r).allowance(account, L.portal)]));
    } catch (e) { console.warn('[Stockz] read', stock.t, e); throw new Error(`Could not read your ${stock.t} balance on BNB Chain. Please retry.`); }
    if (bal < quoteAmt) throw new Error(`Not enough ${stock.t} for the initial buy. You have ${E.formatUnits(bal, dec)} ${stock.t}.`);
    if (al < quoteAmt) {
      log(`Approve exactly ${f.buy} ${stock.t} for the initial buy (confirm in wallet)…`);
      const atx = await sendTx(erc, 'approve', [L.portal, quoteAmt], {}, account);
      const arc = await waitTx(atx);
      if (!arc || arc.status !== 1) throw new Error('Approval failed.');
    }
  }
  log('Uploading image and details…');
  const meta = await uploadMeta(f);
  log('Finding the token address…');
  const taxed = !!(f.tax && (f.tax.buy > 0 || f.tax.sell > 0));
  const { salt, address } = await findSalt(taxed);
  const T = f.tax || { buy: 0, sell: 0, mkt: 10000, burn: 0, div: 0, lp: 0 };
  const params = {
    name: f.name, symbol: f.symbol, meta, dexThresh: L.dexThresh, salt, migratorType: L.migratorType,
    quoteToken: quote, quoteAmt, beneficiary: account, permitData: '0x', extensionID: Z32, extensionData: '0x',
    dexId: L.dexId, lpFeeProfile: L.lpFeeProfile,
    buyTaxRate: taxed ? T.buy : 0, sellTaxRate: taxed ? T.sell : 0,
    taxDuration: taxed ? BigInt(L.taxDurationSec) : 0n, antiFarmerDuration: taxed ? BigInt(L.antiFarmerSec) : 0n,
    mktBps: taxed ? T.mkt : 0, deflationBps: taxed ? T.burn : 0, dividendBps: taxed ? T.div : 0, lpBps: taxed ? T.lp : 0,
    minimumShareBalance: taxed && T.div > 0 ? E.parseUnits(L.dividendMinShare, 18) : 0n,
    dividendToken: taxed && T.div > 0 ? quote : ZERO, commissionReceiver: ZERO,
    tokenVersion: taxed ? L.taxTokenVersion : L.tokenVersion
  };
  const value = taxed ? BigInt(L.taxErc20Value) : 0n;
  if (taxed) log(`Tax: ${T.buy / 100}% buy · ${T.sell / 100}% sell`);
  const portal = new E.Contract(L.portal, [V6, TOKEN_CREATED], signer);
  const sim = p => withRead(r => portal.connect(r).newTokenV6.staticCall(p, { value, from: account }));
  log('Simulating the launch (nothing is sent yet)…');
  let buyAfter = 0n;
  try { await sim(params); }
  catch (e) {
    console.warn('[Stockz] launch simulation:', e);
    const why = decodeErr(e);
    let plainOk = false;
    if (quoteAmt > 0n) {
      try { await sim({ ...params, quoteAmt: 0n }); plainOk = true; } catch (e2) { console.warn('[Stockz] launch simulation without buy:', e2); }
    }
    if (plainOk) {
      log(`The initial buy can't run inside the launch for ${stock.t}, so Stockz launches first and buys right after.`);
      params.quoteAmt = 0n; buyAfter = quoteAmt;
    } else {
      // find out which part is rejected, so the message says what to change
      let hint = '';
      if (taxed) {
        try {
          log('Checking what the contract rejects…');
          const st = await findSalt(false);
          const noTax = { ...params, salt: st.salt, quoteAmt: 0n, buyTaxRate: 0, sellTaxRate: 0, taxDuration: 0n, antiFarmerDuration: 0n, mktBps: 0, deflationBps: 0, dividendBps: 0, lpBps: 0, minimumShareBalance: 0n, dividendToken: ZERO, tokenVersion: L.tokenVersion };
          await withRead(r => portal.connect(r).newTokenV6.staticCall(noTax, { value: 0n, from: account }));
          hint = ` A launch WITHOUT tax works for ${stock.t}: set Tax to NONE and launch again.`;
        } catch (e3) { console.warn('[Stockz] probe without tax:', e3); hint = ` A launch without tax is rejected too: ${decodeErr(e3)}`; }
      }
      throw new Error('Simulation failed, nothing was sent: ' + why + hint);
    }
  }
  log('Confirm the launch in your wallet…');
  const tx = await sendTx(portal, 'newTokenV6', [params], { value }, account);
  log(`Sent: <a href="${esc(C.explorer)}/tx/${esc(tx.hash)}" target="_blank" rel="noopener noreferrer">${esc(tx.hash.slice(0, 12))}…</a> waiting for confirmation…`, true);
  const rc = await waitTx(tx);
  if (!rc || rc.status !== 1) throw new Error('The transaction failed on-chain.');
  let token = null;
  for (const lg of rc.logs || []) {
    if ((lg.address || '').toLowerCase() !== L.portal.toLowerCase()) continue;
    try { const p = portal.interface.parseLog(lg); if (p && p.name === 'TokenCreated') token = p.args.token; } catch {}
  }
  const tokenAddr = token || address;
  if (buyAfter > 0n) {
    try { await buyRightAfter(quote, tokenAddr, buyAfter, stock, f, log); }
    catch (e) { console.warn('[Stockz] buy after launch:', e); log(`⚠ Token launched, but the initial buy did not go through: ${decodeErr(e)} You can buy it from its building on the map.`); }
  }
  return { tx: tx.hash, token: tokenAddr, fromEvent: !!token };
}

// ---------- UI ----------
const STOCKS = () => C.stockTokens || [];
let mode = 'single', busy = false;
// stock picker: pixel tiles coloured like each stock's plot on the map, with search
const PAL = ['#e8b04a', '#6fae5a', '#d9774b', '#5c8fc7', '#b56bb0', '#4fb3a6', '#c9a36b', '#d65c6d', '#8a9a3e', '#7a7fd1'];
const stockName = t => { const x = (window.FLAP_STOCKS || []).find(s => s.t === t); return (x && x.n) || ''; };
const stockCol = (t, i) => { const m = window.StockzStockMeta && window.StockzStockMeta(t); return (m && m.col) || PAL[i % PAL.length]; };
let picked = new Set();
function renderPairs(preset) {
  const box = $('#lmPairs'), multi = mode === 'multi';
  picked = new Set(multi ? (preset || []) : (preset && preset[0] ? [preset[0]] : []));
  box.innerHTML = `${multi ? '<div class="mnote">Same name, ticker and image on every stock you pick. One wallet confirmation per stock.</div>' : ''}
    <div class="spk">
      <div class="spk-head"><span class="spk-lbl">${multi ? 'Pair with (pick several)' : 'Pair with'}</span><span class="spk-sel" id="spkSel"></span></div>
      <div class="spk-bar"><input id="spkQ" placeholder="Search ${STOCKS().length} stocks…" autocomplete="off" spellcheck="false" aria-label="Search stocks">${multi ? '<button type="button" class="spk-all" id="spkAll">ALL</button>' : ''}</div>
      <div class="spk-grid" id="spkGrid" role="listbox" aria-multiselectable="${multi}">${STOCKS().map((s, i) => `<button type="button" class="spk-t" role="option" data-t="${esc(s.t)}" style="--c:${stockCol(s.t, i)}"><i></i><b>${esc(s.t)}</b><small>${esc(stockName(s.t) || 'Tokenized stock')}</small></button>`).join('')}</div>
    </div>
    ${multi ? '' : '<label>Initial buy (optional, in the paired stock)<input id="lmBuy" inputmode="decimal" placeholder="0" autocomplete="off"></label>'}`;
  const sync = () => {
    box.querySelectorAll('.spk-t').forEach(b => { const on = picked.has(b.dataset.t); b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    const n = picked.size, one = [...picked][0];
    $('#spkSel').innerHTML = !n ? '<em>none yet</em>' : multi ? `<b>${n}</b> picked` : `<b>${esc(one)}</b> ${esc(stockName(one))}`;
    const all = $('#spkAll'); if (all) all.classList.toggle('on', n === STOCKS().length);
  };
  $('#spkGrid').onclick = e => {
    const b = e.target.closest('.spk-t'); if (!b) return; const t = b.dataset.t;
    if (multi) { picked.has(t) ? picked.delete(t) : picked.add(t); } else picked = new Set([t]);
    sync();
  };
  $('#spkQ').oninput = () => { const q = $('#spkQ').value.trim().toLowerCase(); box.querySelectorAll('.spk-t').forEach(b => { b.hidden = !!q && !(b.dataset.t.toLowerCase().includes(q) || stockName(b.dataset.t).toLowerCase().includes(q)); }); };
  if (multi) $('#spkAll').onclick = () => { picked = picked.size === STOCKS().length ? new Set() : new Set(STOCKS().map(s => s.t)); sync(); };
  sync();
  const first = box.querySelector('.spk-t.on'); if (first) first.scrollIntoView({ block: 'nearest' });
}
function setMode(m, preset) { mode = m; $('#lmSingle').classList.toggle('on', m === 'single'); $('#lmMulti').classList.toggle('on', m === 'multi'); renderPairs(preset); }
function log(msg, html) { const li = document.createElement('li'); if (html) li.innerHTML = msg; else li.textContent = msg; $('#lmLog').appendChild(li); li.scrollIntoView({ block: 'nearest' }); return li; }
function open(opts = {}) {
  $('#launchModal').hidden = false; document.body.style.overflow = 'hidden';
  setMode(opts.mode || 'single', opts.stocks);
  $('#lmName').focus();
}
function close() { if (busy) return; $('#launchModal').hidden = true; document.body.style.overflow = ''; }
function readForm() {
  const f = {
    name: $('#lmName').value.trim(), symbol: $('#lmSymbol').value.trim(), image: $('#lmImage').files[0],
    description: $('#lmDesc').value.trim(), website: $('#lmWeb').value.trim(), twitter: $('#lmX').value.trim(), telegram: $('#lmTg').value.trim()
  };
  if (!f.name || f.name.length > 32) throw new Error('Name is required (max 32 characters).');
  if (!/^[A-Za-z0-9]{1,10}$/.test(f.symbol)) throw new Error('Ticker must be 1 to 10 letters or numbers.');
  if (!f.image) throw new Error('Please choose an image.');
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(f.image.type)) throw new Error('Image must be PNG, JPG, WEBP or GIF.');
  if (f.image.size > 5 * 1024 * 1024) throw new Error('Image must be 5 MB or smaller.');
  for (const k of ['website', 'twitter', 'telegram']) if (f[k] && !/^https?:\/\/\S+$/i.test(f[k])) throw new Error(`${k === 'twitter' ? 'X' : k[0].toUpperCase() + k.slice(1)} link must start with https://`);
  let picks;
  if (mode === 'single') {
    picks = [...picked];
    if (!picks.length) throw new Error('Pick a stock to pair with.');
    f.buy = ($('#lmBuy').value || '').trim();
    if (f.buy && !/^\d*(\.\d+)?$/.test(f.buy)) throw new Error('Initial buy must be a number.');
  } else {
    picks = [...picked];
    if (!picks.length) throw new Error('Pick at least one stock.');
    f.buy = '';
  }
  // tax
  const num = id => { const v = parseFloat(($(id) && $(id).value) || '0'); return isFinite(v) ? v : NaN; };
  const buy = num('#txBuy'), sell = num('#txSell'), mk = num('#txMkt'), bu = num('#txBurn'), dv = num('#txDiv'), lq = num('#txLp');
  if ([buy, sell].some(v => isNaN(v) || v < 0 || v > 10)) throw new Error('Tax must be between 0% and 10%.');
  if (buy > 0 || sell > 0) {
    if ([mk, bu, dv, lq].some(v => isNaN(v) || v < 0 || v > 100)) throw new Error('Tax split values must be between 0 and 100.');
    if (Math.round(mk + bu + dv + lq) !== 100) throw new Error('Tax split must add up to 100%.');
  }
  f.tax = { buy: Math.round(buy * 100), sell: Math.round(sell * 100), mkt: Math.round(mk * 100), burn: Math.round(bu * 100), div: Math.round(dv * 100), lp: 0 };
  f.tax.lp = 10000 - f.tax.mkt - f.tax.burn - f.tax.div;
  f.stocks = picks.map(t => STOCKS().find(s => s.t === t)).filter(Boolean);
  if (!f.stocks.length) throw new Error('Pick a stock.');
  return f;
}
async function onSubmit(ev) {
  ev.preventDefault(); if (busy) return;
  $('#lmLog').innerHTML = '';
  let f;
  try { f = readForm(); } catch (e) { log('⚠ ' + e.message); return; }
  busy = true; $('#lmGo').disabled = true; $('#lmClose').disabled = true;
  const done = [];
  try {
    if (!account) { log('Connecting wallet…'); await connect(); showAcct(); }
    for (let i = 0; i < f.stocks.length; i++) {
      const s = f.stocks[i];
      log(`— ${f.stocks.length > 1 ? `(${i + 1}/${f.stocks.length}) ` : ''}${f.symbol.toUpperCase()} paired with ${s.t} —`);
      const r = await launchOne({ ...f, symbol: f.symbol.toUpperCase() }, s, log);
      done.push({ s, r });
      log(`✅ Launched: <a href="${esc(C.explorer)}/token/${esc(r.token)}" target="_blank" rel="noopener noreferrer">${esc(r.token)}</a>`, true);
    }
    log(`🎉 Done. ${done.length} token${done.length > 1 ? 's' : ''} launched. ${done.length > 1 ? 'They appear' : 'It appears'} on the map after the next refresh.`);
    window.dispatchEvent(new CustomEvent('stockz:launched', { detail: done }));
    const li = log(''); const rb = document.createElement('button'); rb.type = 'button'; rb.className = 'btn'; rb.textContent = 'Refresh the map'; rb.onclick = () => location.reload(); li.appendChild(rb);
  } catch (e) {
    log(e && e.cancelled ? 'Login was cancelled.' : '❌ ' + decodeErr(e));
    if (done.length) log(`${done.length} of ${f.stocks.length} launches finished before the error. Nothing else was sent.`);
  } finally { busy = false; $('#lmGo').disabled = false; $('#lmClose').disabled = false; }
}
document.addEventListener('DOMContentLoaded', () => {});
$('#lmClose').onclick = close;
$('#launchModal').addEventListener('click', e => { if (e.target.id === 'launchModal') close(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#launchModal').hidden) close(); });
document.querySelectorAll('.tchip').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.tchip').forEach(x => x.classList.toggle('on', x === b));
  const v = b.dataset.tax, custom = v === 'custom';
  $('#taxCustom').hidden = !custom;
  if (!custom) { $('#txBuy').value = v; $('#txSell').value = v; $('#txMkt').value = 100; $('#txBurn').value = 0; $('#txDiv').value = 0; $('#txLp').value = 0; }
}));
$('#lmSingle').onclick = () => setMode('single'); $('#lmMulti').onclick = () => setMode('multi');
$('#lmForm').addEventListener('submit', onSubmit);
// small pixel toast instead of browser alert() popups
function toast(msg, kind = 'err') {
  let box = document.getElementById('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
  const t = document.createElement('div'); t.className = 'toast ' + kind; t.textContent = msg;
  t.onclick = () => t.remove(); box.appendChild(t);
  setTimeout(() => { t.classList.add('bye'); setTimeout(() => t.remove(), 400); }, 5000);
}
window.StockzToast = toast;
const showAcct = () => { const b = $('#connect'); if (b && account) { b.textContent = account.slice(0, 6) + '…' + account.slice(-4) + ' ▾'; b.classList.add('on'); } window.dispatchEvent(new Event('stockz:wallet')); };
const cb = $('#connect');
// ---------- wallet menu: balances, copy, BscScan, disconnect ----------
const resetBtn = () => { if (cb) { cb.textContent = 'Connect wallet'; cb.classList.remove('on'); } };
function closeMenu() { const m = document.getElementById('wmenu'); if (m) m.remove(); document.removeEventListener('pointerdown', outside, true); }
function outside(e) { const m = document.getElementById('wmenu'); if (m && !m.contains(e.target) && e.target !== cb) closeMenu(); }
async function disconnect() {
  closeMenu();
  const P = window.StockzPrivy;
  if (P && P.authenticated) { try { await P.logout(); } catch {} }
  try { if (provider) await provider.send('wallet_revokePermissions', [{ eth_accounts: {} }]); } catch {}
  account = null; signer = null; provider = null; resetBtn();
  window.dispatchEvent(new Event('stockz:wallet'));
}
async function openMenu() {
  closeMenu();
  const m = document.createElement('div'); m.id = 'wmenu'; m.className = 'wmenu bev'; m.setAttribute('role', 'menu');
  const a = account;
  m.innerHTML = `<div class="wm-addr"><span class="wm-dot"></span><b>${esc(a.slice(0, 6) + '…' + a.slice(-4))}</b><button type="button" class="wm-copy" id="wmCopy">COPY</button></div>
    <div class="wm-bal"><span>BNB</span><b id="wmBnb">…</b></div>
    <div class="wm-sub">Your stocks</div><div class="wm-stocks" id="wmStocks"><span class="wm-muted">Reading…</span></div>
    <div class="wm-btns"><a class="btn" href="${esc(C.explorer)}/address/${esc(a)}" target="_blank" rel="noopener noreferrer">BscScan</a><button type="button" class="btn wm-out" id="wmOut">Disconnect</button></div>`;
  document.body.appendChild(m);
  const r = cb.getBoundingClientRect();
  m.style.top = (r.bottom + 6) + 'px'; m.style.right = Math.max(8, innerWidth - r.right) + 'px';
  m.querySelector('#wmOut').onclick = disconnect;
  m.querySelector('#wmCopy').onclick = async e => { try { await navigator.clipboard.writeText(a); e.target.textContent = 'COPIED'; } catch { e.target.textContent = a; } };
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  const nf = (v, d) => { const n = Number(E.formatUnits(v, d)); return n === 0 ? '0' : n < 0.0001 ? '<0.0001' : n.toLocaleString('en-US', { maximumFractionDigits: n < 1 ? 6 : 4 }); };
  try { const b = await withRead(p => p.getBalance(a)); const el = document.getElementById('wmBnb'); if (el) el.textContent = nf(b, 18); }
  catch { const el = document.getElementById('wmBnb'); if (el) el.textContent = '–'; }
  try {
    const list = STOCKS();
    const res = await withRead(p => Promise.all(list.map(s => { const c = new E.Contract(s.address, ERC20, p); return Promise.all([c.balanceOf(a), c.decimals()]).catch(() => [0n, 18]); })));
    const held = list.map((s, i) => ({ t: s.t, v: res[i][0], d: Number(res[i][1]) })).filter(x => x.v > 0n);
    const el = document.getElementById('wmStocks'); if (!el) return;
    el.innerHTML = held.length ? held.map((x, i) => `<div class="wm-row"><i style="background:${stockCol(x.t, i)}"></i><span>${esc(x.t)}</span><b>${nf(x.v, x.d)}</b></div>`).join('') : '<span class="wm-muted">No stock tokens yet</span>';
  } catch { const el = document.getElementById('wmStocks'); if (el) el.innerHTML = '<span class="wm-muted">Could not read right now</span>'; }
}
if (cb) cb.onclick = async () => {
  if (account) { document.getElementById('wmenu') ? closeMenu() : openMenu(); return; }
  const prev = cb.textContent; cb.disabled = true; cb.textContent = 'Loading…';
  try { connecting = true; await connect(); showAcct(); } catch (e) { cb.textContent = prev; console.warn('[Stockz] connect:', decodeErr(e)); } finally { cb.disabled = false; connecting = false; }
};
window.addEventListener('stockz:privy', e => {
  const d = e.detail || {};
  if (account && !d.address && !connecting) { account = null; signer = null; closeMenu(); resetBtn(); window.dispatchEvent(new Event('stockz:wallet')); return; }
  if (!account && d.address && d.authenticated && !connecting) { connecting = true; connect().then(showAcct).catch(() => {}).finally(() => { connecting = false; }); }
});
if (window.ethereum && window.ethereum.on) window.ethereum.on('accountsChanged', a => { account = null; signer = null; closeMenu(); resetBtn(); window.dispatchEvent(new Event('stockz:wallet')); });
window.StockzLaunch = { open, _findSalt: findSalt };
window.StockzChain = { withRead, sendTx, waitTx, decodeErr, isRevert };
window.StockzWallet = {
  async connect() { await connect(); showAcct(); window.dispatchEvent(new Event('stockz:wallet')); return { signer, account, provider }; },
  state() { return { signer, account, provider }; },
  disconnect
};
})();
