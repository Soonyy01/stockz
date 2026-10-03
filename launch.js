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
  '0x1f541609': 'Invalid fee tier for this DEX.', '0xd5f11840': 'Invalid curve type.'
};
function decodeErr(e) {
  const seen = new Set(), stack = [e];
  while (stack.length) {
    const x = stack.pop(); if (!x || typeof x !== 'object' || seen.has(x)) continue; seen.add(x);
    for (const k of ['data', 'error', 'info', 'cause']) { const v = x[k]; if (typeof v === 'string' && /^0x[0-9a-fA-F]{8}/.test(v)) { const s = v.slice(0, 10).toLowerCase(); return ERR[s] || `Contract error ${s}.`; } if (v && typeof v === 'object') stack.push(v); }
  }
  const m = String((e && (e.shortMessage || e.reason || e.message)) || e).match(/0x[0-9a-fA-F]{8}/);
  if (m && ERR[m[0].toLowerCase()]) return ERR[m[0].toLowerCase()];
  if (e && (e.code === 'ACTION_REJECTED' || e.code === 4001)) return 'You rejected the request in your wallet.';
  return String((e && (e.shortMessage || e.reason || e.message)) || e).slice(0, 220);
}

// ---------- wallet ----------
let provider = null, signer = null, account = null;
function waitPrivyAddress(ms) {
  return new Promise((resolve, reject) => {
    const P = window.StockzPrivy; if (P && P.address) return resolve(P.address);
    const t = setTimeout(() => { cleanup(); reject(new Error('Login timed out. Please try again.')); }, ms);
    const onState = e => { if (e.detail && e.detail.address) { cleanup(); resolve(e.detail.address); } };
    const onLogin = e => { if (e.detail && !e.detail.ok) { cleanup(); reject(new Error('Login was cancelled.')); } };
    function cleanup() { clearTimeout(t); window.removeEventListener('stockz:privy', onState); window.removeEventListener('stockz:privy-login', onLogin); }
    window.addEventListener('stockz:privy', onState); window.addEventListener('stockz:privy-login', onLogin);
  });
}
function waitPrivyReady(ms) {
  return new Promise((resolve, reject) => {
    const ok = () => window.StockzPrivy && window.StockzPrivy.ready;
    const bad = () => String(window.StockzPrivyStatus || '').startsWith('error');
    if (ok()) return resolve(); if (bad()) return reject(new Error('Login could not load (' + window.StockzPrivyStatus + ').'));
    const t = setTimeout(() => { cleanup(); reject(new Error('Login is taking too long to load. Check your connection, and that this site domain is added in the Privy dashboard, then reload.')); }, ms);
    const on = () => { if (ok()) { cleanup(); resolve(); } else if (bad()) { cleanup(); reject(new Error('Login could not load (' + window.StockzPrivyStatus + ').')); } };
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
async function findSalt(onTick) {
  const initCode = '0x3d602d80600a3d3981f3363d3d373d3d3d363d73' + L.standardImpl.slice(2).toLowerCase() + '5af43d82803e903d91602b57fd5bf3';
  const pre = '0xff' + L.portal.slice(2).toLowerCase(), initHash = E.keccak256(initCode).slice(2), suf = L.suffix.toLowerCase();
  let salt = E.hexlify(E.randomBytes(32));
  for (let i = 0; i < 4000000; i++) {
    const h = E.keccak256(pre + salt.slice(2) + initHash);
    if (h.endsWith(suf)) return { salt, address: E.getAddress('0x' + h.slice(-40)) };
    salt = E.keccak256(salt);
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

async function launchOne(f, stock, log) {
  const quote = E.getAddress(stock.address);
  let quoteAmt = 0n;
  if (f.buy && Number(f.buy) > 0) {
    const erc = new E.Contract(quote, ERC20, signer);
    const dec = await erc.decimals();
    quoteAmt = E.parseUnits(String(f.buy), dec);
    const bal = await erc.balanceOf(account);
    if (bal < quoteAmt) throw new Error(`Not enough ${stock.t} in your wallet for the initial buy.`);
    const al = await erc.allowance(account, L.portal);
    if (al < quoteAmt) {
      log(`Approve exactly ${f.buy} ${stock.t} for the initial buy (confirm in wallet)…`);
      const atx = await erc.approve(L.portal, quoteAmt);
      const arc = await atx.wait();
      if (!arc || arc.status !== 1) throw new Error('Approval failed.');
    }
  }
  log('Uploading image and details…');
  const meta = await uploadMeta(f);
  log('Finding the token address…');
  const { salt, address } = await findSalt();
  const params = {
    name: f.name, symbol: f.symbol, meta, dexThresh: L.dexThresh, salt, migratorType: L.migratorType,
    quoteToken: quote, quoteAmt, beneficiary: account, permitData: '0x', extensionID: Z32, extensionData: '0x',
    dexId: L.dexId, lpFeeProfile: L.lpFeeProfile, buyTaxRate: 0, sellTaxRate: 0, taxDuration: 0n, antiFarmerDuration: 0n,
    mktBps: 0, deflationBps: 0, dividendBps: 0, lpBps: 0, minimumShareBalance: 0n, dividendToken: ZERO, commissionReceiver: ZERO,
    tokenVersion: L.tokenVersion
  };
  const portal = new E.Contract(L.portal, [V6, TOKEN_CREATED], signer);
  log('Simulating the launch (nothing is sent yet)…');
  try { await portal.newTokenV6.staticCall(params, { value: 0n }); }
  catch (e) { throw new Error('Simulation failed, nothing was sent: ' + decodeErr(e)); }
  log('Confirm the launch in your wallet…');
  const tx = await portal.newTokenV6(params, { value: 0n });
  log(`Sent: <a href="${esc(C.explorer)}/tx/${esc(tx.hash)}" target="_blank" rel="noopener noreferrer">${esc(tx.hash.slice(0, 12))}…</a> waiting for confirmation…`, true);
  const rc = await tx.wait();
  if (!rc || rc.status !== 1) throw new Error('The transaction failed on-chain.');
  let token = null;
  for (const lg of rc.logs || []) {
    if ((lg.address || '').toLowerCase() !== L.portal.toLowerCase()) continue;
    try { const p = portal.interface.parseLog(lg); if (p && p.name === 'TokenCreated') token = p.args.token; } catch {}
  }
  return { tx: tx.hash, token: token || address, fromEvent: !!token };
}

// ---------- UI ----------
const STOCKS = () => C.stockTokens || [];
let mode = 'single', busy = false;
function stockOptions(sel) { return STOCKS().map(s => `<option value="${esc(s.t)}"${s.t === sel ? ' selected' : ''}>${esc(s.t)}</option>`).join(''); }
function renderPairs(preset) {
  const box = $('#lmPairs');
  if (mode === 'single') {
    box.innerHTML = `<label>Pair with<select id="lmStock" required>${stockOptions(preset && preset[0])}</select></label>
      <label>Initial buy (optional, in the paired stock)<input id="lmBuy" inputmode="decimal" placeholder="0" pattern="^\\d*(\\.\\d+)?$"></label>`;
  } else {
    const on = new Set(preset || []);
    box.innerHTML = `<div class="mnote">Multi-pair launches your token once per stock you pick, with the same name, ticker and image. Every pair is a real on-chain pair, and you confirm one transaction per stock.</div>
      <label class="chk"><input type="checkbox" id="lmAll"> All stocks (${STOCKS().length})</label>
      <div class="pick" id="lmPick">${STOCKS().map(s => `<label class="chk"><input type="checkbox" class="lmOne" value="${esc(s.t)}"${on.has(s.t) ? ' checked' : ''}> ${esc(s.t)}</label>`).join('')}</div>`;
    $('#lmAll').onchange = e => document.querySelectorAll('.lmOne').forEach(x => x.checked = e.target.checked);
  }
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
    picks = [$('#lmStock').value];
    f.buy = ($('#lmBuy').value || '').trim();
    if (f.buy && !/^\d*(\.\d+)?$/.test(f.buy)) throw new Error('Initial buy must be a number.');
  } else {
    picks = [...document.querySelectorAll('.lmOne:checked')].map(x => x.value);
    if (!picks.length) throw new Error('Pick at least one stock.');
    f.buy = '';
  }
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
    log('❌ ' + decodeErr(e));
    if (done.length) log(`${done.length} of ${f.stocks.length} launches finished before the error. Nothing else was sent.`);
  } finally { busy = false; $('#lmGo').disabled = false; $('#lmClose').disabled = false; }
}
document.addEventListener('DOMContentLoaded', () => {});
$('#lmClose').onclick = close;
$('#launchModal').addEventListener('click', e => { if (e.target.id === 'launchModal') close(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#launchModal').hidden) close(); });
$('#lmSingle').onclick = () => setMode('single'); $('#lmMulti').onclick = () => setMode('multi');
$('#lmForm').addEventListener('submit', onSubmit);
const showAcct = () => { const b = $('#connect'); if (b && account) { b.textContent = account.slice(0, 6) + '…' + account.slice(-4); b.classList.add('on'); } };
const cb = $('#connect');
if (cb) cb.onclick = async () => {
  const P = window.StockzPrivy;
  if (account && P && P.authenticated) { try { await P.logout(); } catch {} account = null; signer = null; cb.textContent = 'Connect wallet'; cb.classList.remove('on'); return; }
  const prev = cb.textContent; cb.disabled = true; cb.textContent = 'Loading…';
  try { await connect(); showAcct(); } catch (e) { cb.textContent = prev; alert(decodeErr(e)); } finally { cb.disabled = false; }
};
window.addEventListener('stockz:privy', e => { if (account && e.detail && !e.detail.address) { account = null; signer = null; cb.textContent = 'Connect wallet'; cb.classList.remove('on'); } });
if (window.ethereum && window.ethereum.on) window.ethereum.on('accountsChanged', a => { account = null; signer = null; const b = $('#connect'); if (b) { b.textContent = 'Connect wallet'; b.classList.remove('on'); } });
window.StockzLaunch = { open, _findSalt: findSalt };
})();
