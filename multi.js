// Stockz Multi-pair: ONE token (StockzMultiToken), up to 12 PancakeSwap V3 pools (token / stock), single-sided liquidity.
// The creator deposits nothing but gas: the token contract holds the whole supply and puts 100% of it into the pools.
// The liquidity positions stay inside the token contract forever (no function can remove them) = locked permanently.
// Pool fees (1% tier) are split by the contract: a fixed share (min 10%) to holders as dividends, the rest to the creator.
(() => {
const C = window.FLAPCITY_CONFIG, L = C.launch, E = window.ethers;
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const FEE = Number(L.v3Fee || 10000), SPACING = Number(L.v3Spacing || 200);
const ROUTER_ABI = ['function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)'];
const QUOTER_ABI = ['function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)'];
const V2_ROUTER_ABI = ['function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)'];
const ERC20 = ['function decimals() view returns (uint8)', 'function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)'];
const MT_ABI = [
  'constructor(string name_, string symbol_, address creator_, uint256 holderShareBps_, address positionManager_, uint24 poolFee_, int24 tickSpacing_, address[] stocks_, int24[] startTicks_)',
  'function createPools(uint256 count)', 'function claim() returns (uint256[] paid)', 'function claimCreator() returns (uint256[] paid)',
  'function info() view returns (address[] stocks_, address[] pools_, uint256[] positionIds_, address[] rewards_, uint256 holderShareBps_, address creator_, uint256 processed_)',
  'function balanceOf(address) view returns (uint256)', 'function creator() view returns (address)'
];
// The token is deployed through the standard CREATE2 deployer with a normal transaction (not a contract-creation
// transaction). Some wallets replace the gas limit of contract-creation transactions with a fixed 1,200,000, which
// is too low; for normal transactions every wallet uses a correct gas limit.
const DEPLOYER = '0x4e59b44847b379578588920cA78FbF26c0B4956C';
// explain an on-chain failure: did the wallet send less gas than needed?
async function failReason(rc, needed) {
  try {
    const tx = await rd(r => r.getTransaction(rc.hash));
    const lim = tx && tx.gasLimit, used = rc.gasUsed;
    if (lim && used && used >= lim) return `Your wallet sent it with a gas limit of ${Number(lim).toLocaleString('en-US')}, but about ${Number(needed).toLocaleString('en-US')} is needed (out of gas). In your wallet, set the gas limit to at least ${Number(needed * 12n / 10n).toLocaleString('en-US')} or use "Market"/"Auto" gas, then try again.`;
  } catch {}
  return '';
}
const CH = () => window.StockzChain;
// reads with a time limit per RPC: a slow or silent public RPC must never freeze the launch
const RP = {}; let rIdx = 0;
const rp = i => RP[i] || (RP[i] = new E.JsonRpcProvider(C.rpcUrls[i], 56, { staticNetwork: true, batchMaxCount: 1 }));
async function rd(fn, ms = 8000) {
  let err; const n = C.rpcUrls.length;
  for (let k = 0; k < n; k++) {
    const i = (rIdx + k) % n; let timer;
    try {
      const r = await Promise.race([fn(rp(i)), new Promise((_, j) => { timer = setTimeout(() => j(Object.assign(new Error('The network is slow right now.'), { slow: true })), ms); })]);
      rIdx = i; return r;
    } catch (e) { err = e; if (!e.slow && CH().isRevert(e)) throw e; }
    finally { clearTimeout(timer); }
  }
  throw err;
}
const BATCH = Number(L.v3Batch || 1);

// deadline from the chain's own clock (a wrong phone clock must not break or weaken the deadline)
async function deadline() { const b = await rd(r => r.getBlock('latest')); return BigInt((b && b.timestamp) || Math.floor(Date.now() / 1000)) + 1200n; }

// ---------- USD price of a stock token, read on-chain from PancakeSwap (V2 direct / via WBNB, V3) ----------
// returns { usd, src } or null. A small amount is quoted so a thin pool is not over-read; the creator can always edit it.
async function stockUsd(stock) {
  const ch = CH(), s = E.getAddress(stock.address), U = L.usdt, W = L.wbnb;
  let d; try { d = Number(await rd(r => new E.Contract(s, ERC20, r).decimals())); } catch { return null; }
  const unit = 10n ** BigInt(Math.max(0, d - 3)), scale = Number(10n ** BigInt(d)) / Number(unit);   // quote 0.001 stock
  const toUsd = out => Number(E.formatUnits(out, 18)) * scale;
  const tries = [
    async () => ({ src: 'PancakeSwap V2', v: (await rd(r => new E.Contract(L.pcsRouter, V2_ROUTER_ABI, r).getAmountsOut(unit, [s, U]))).at(-1) }),
    ...[2500, 500, 10000, 100].map(fee => async () => ({ src: 'PancakeSwap V3', v: (await rd(r => new E.Contract(L.pcsV3Quoter, QUOTER_ABI, r).quoteExactInputSingle.staticCall({ tokenIn: s, tokenOut: U, amountIn: unit, fee, sqrtPriceLimitX96: 0 })))[0] })),
    async () => ({ src: 'PancakeSwap V2 via BNB', v: (await rd(r => new E.Contract(L.pcsRouter, V2_ROUTER_ABI, r).getAmountsOut(unit, [s, W, U]))).at(-1) })
  ];
  for (const t of tries) { try { const x = await t(); const usd = toUsd(x.v); if (usd > 0 && isFinite(usd)) return { usd, src: x.src }; } catch {} }
  return null;
}

async function register(tx, pairs, meta) {
  for (let i = 0; i < 4; i++) {
    try { const r = await fetch('/api/launches', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tx, pairs, meta }) }); if (r.ok || r.status === 503 || r.status === 422) return; } catch {}
    await new Promise(r => setTimeout(r, 3000 * (i + 1)));
  }
}

// start tick of a pool: log1.0001(stock base units per token base unit). The contract turns it into the pool range.
function startTick(priceStockPerToken, stockDec) {
  const raw = priceStockPerToken * 10 ** stockDec / 1e18;
  const t = Math.floor(Math.log(raw) / Math.log(1.0001));
  if (!isFinite(t) || Math.abs(t) > 880000) throw new Error('Price out of range. Check the market cap and stock prices.');
  return t;
}

// f: { name, symbol, mcapUsd, holderPct, liq: [{ stock: {t,address}, usd }] }, ctx: { log, uploadMeta, signer, account }
async function launch(f, ctx) {
  const { log, signer, account } = ctx, ch = CH();
  const n = f.liq.length, max = Number(L.multiMaxPairs || 12);
  if (n < 1 || n > max) throw new Error(`Pick 1 to ${max} stocks.`);
  const bps = Math.round(f.holderPct * 100);
  if (!(bps >= 1000 && bps <= 10000)) throw new Error('Holder share must be between 10% and 100%.');
  const tokenUsd = f.mcapUsd / Number(L.multiSupply || 1e9);

  log('Reading the stock tokens…');
  for (const p of f.liq) {
    try { p.dec = Number(await rd(r => new E.Contract(p.stock.address, ERC20, r).decimals())); }
    catch { throw new Error(`Could not read ${p.stock.t} on BNB Chain. Please retry.`); }
  }
  const stocks = f.liq.map(p => E.getAddress(p.stock.address)), ticks = f.liq.map(p => startTick(tokenUsd / p.usd, p.dec));

  let meta = '';
  try { log('Uploading image and details…'); meta = await ctx.uploadMeta(f); } catch { log('⚠ Image upload failed, continuing without it.'); }

  // 1) deploy the token through the CREATE2 deployer (it holds the whole supply until it is put into the pools)
  const factory = new E.ContractFactory(MT_ABI, window.STOCKZ_TOKEN_BIN);
  const init = (await factory.getDeployTransaction(f.name, f.symbol, E.getAddress(account), bps, L.pcsV3Npm, FEE, SPACING, stocks, ticks)).data;
  const salt = E.hexlify(E.randomBytes(32));
  const token = E.getCreate2Address(DEPLOYER, salt, E.keccak256(init));
  const data = E.concat([salt, init]);
  log('Simulating the token deployment (nothing is sent yet)…');
  let gas;
  try {
    const code = await rd(r => r.getCode(DEPLOYER));
    if (!code || code === '0x') throw new Error('The CREATE2 deployer is not available on this network.');
    const out = await rd(r => r.call({ from: account, to: DEPLOYER, data }));
    if (!out || E.getAddress(E.dataSlice(E.zeroPadValue(out, 32), 12)) !== token) throw new Error('The deployment simulation returned an unexpected address.');
    gas = await rd(r => r.estimateGas({ from: account, to: DEPLOYER, data }));
  } catch (e) { throw new Error('Simulation failed, nothing was sent: ' + (e.message && !e.code ? e.message : ch.decodeErr(e))); }
  const batches = Math.ceil(n / BATCH);
  log(`Confirm the token deployment in your wallet (${batches + 1} confirmations in total)…`);
  const sent = await signer.sendTransaction({ to: DEPLOYER, data, gasLimit: gas * 13n / 10n });
  log(`Sent: <a href="${esc(C.explorer)}/tx/${esc(sent.hash)}" target="_blank" rel="noopener noreferrer">${esc(sent.hash.slice(0, 12))}…</a> waiting for confirmation…`, true);
  const drc = await fastWait(sent).catch(() => null);
  const made = await rd(r => r.getCode(token)).catch(() => '0x');
  if (!made || made === '0x') { const why = drc ? await failReason(drc, gas) : ''; throw new Error('The token deployment failed on-chain. ' + why); }
  log(`✅ Token created: <a href="${esc(C.explorer)}/token/${esc(token)}" target="_blank" rel="noopener noreferrer">${esc(token)}</a>`, true);
  register(sent.hash, [], meta);

  // 2) pools, 2 per transaction (BSC caps one transaction at 16,777,216 gas; one V3 pool costs ~6M).
  // Every step waits for a tap: mobile browsers only open the wallet app right after a tap.
  const mt = new E.Contract(token, MT_ABI, signer);
  const done = [];
  for (let b = 0; b < batches; b++) {
    const part = f.liq.slice(b * BATCH, (b + 1) * BATCH), from = b * BATCH;
    log(`— Pools ${from + 1}–${from + part.length} of ${n}: ${part.map(p => f.symbol + '/' + p.stock.t).join(', ')} —`);
    try {
      const g = await poolGas(mt, account);
      const what = part.length === 1 ? `pool ${from + 1}: ${f.symbol}/${part[0].stock.t}` : `pools ${from + 1}–${from + part.length}`;
      let ptx = null;
      while (!ptx) {
        const go = await tapStep(log, `Confirm ${what} (step ${b + 2} of ${batches + 1})`);
        if (!go) break;
        try { ptx = await walletSend(() => mt.createPools(BATCH, { gasLimit: limitFor(g) })); }
        catch (e) { if (e && e.walletSilent) { log('No answer from your wallet after 60 seconds. Tap the button again to resend.'); continue; } throw e; }
      }
      if (!ptx) { log(`Paused. ${done.length} of ${n} pools are live. Open the token page and tap "Finish pool setup" to continue.`); break; }
      log('Waiting for confirmation…');
      const prc = await fastWait(ptx); if (!prc || prc.status !== 1) throw new Error('Creating pools failed on-chain. ' + (prc ? await failReason(prc, g) : ''));
      const inf = await rd(r => mt.connect(r).info());
      part.forEach((p, j) => {
        const i = from + j;
        if (inf[2][i] > 0n) { done.push(p.stock.address); log(`✅ Pool live (liquidity locked): <a href="${esc(C.explorer)}/address/${esc(inf[1][i])}" target="_blank" rel="noopener noreferrer">${esc(f.symbol)}/${esc(p.stock.t)}</a>`, true); }
        else log(`⚠ ${f.symbol}/${p.stock.t} could not be created (its pool already existed at another price). Its share of the supply was burned.`);
      });
      register(sent.hash, done.slice(), meta);
    } catch (e) {
      if (e && (e.code === 'ACTION_REJECTED' || e.code === 4001)) { log(`Paused: you rejected the request. ${done.length} of ${n} pools are live. Open the token page and tap "Finish pool setup" to continue.`); break; }
      log(`❌ ${e.message || ch.decodeErr(e)}`);
      log(`Paused. ${done.length} of ${n} pools are live; nothing else was sent. Open the token page and tap "Finish pool setup" to continue.`);
      break;
    }
  }
  await register(sent.hash, done.slice(), meta);
  return { token, tx: sent.hash, pools: done.length, total: n };
}

// ---------- fast, tap-driven steps ----------
const TX_CAP = 16_700_000n;   // BSC per-transaction gas cap is 16,777,216 (BEP-652)
const limitFor = g => { const l = g * 13n / 10n; return l > TX_CAP ? TX_CAP : l; };
const FIXED_POOL_GAS = 6_800_000n;   // per pool, measured ~6.0M; used only when no RPC answers in time
async function poolGas(mt, account) {
  let g;
  try {
    g = await Promise.race([rd(r => mt.connect(r).createPools.estimateGas(BATCH, { from: account }), 6000),
      new Promise((_, j) => setTimeout(() => j(Object.assign(new Error('slow'), { slow: true })), 10000))]);   // at most 10 s in total
  }
  catch (e) {
    if (CH().isRevert(e)) throw new Error('Simulation failed, nothing was sent: ' + CH().decodeErr(e));
    return FIXED_POOL_GAS * BigInt(BATCH);   // network slow: safe fixed limit (only the gas actually used is paid)
  }
  if (g > TX_CAP) throw new Error('This step needs more gas than BNB Chain allows in one transaction.');
  return g;
}
// wallet request with a 60 s watchdog (some wallets never answer or never show the request)
function walletSend(fn) {
  return Promise.race([fn(), new Promise((_, j) => setTimeout(() => j(Object.assign(new Error('No answer from your wallet.'), { walletSilent: true })), 60000))]);
}
// a button in the launch log; resolves true on tap, false on "Later"
function tapStep(log, label) {
  return new Promise(res => {
    const li = log(''); li.className = 'steprow';
    const b = document.createElement('button'); b.type = 'button'; b.className = 'bigbtn'; b.innerHTML = '<i>▶</i> ' + esc(label);
    const later = document.createElement('button'); later.type = 'button'; later.className = 'btn steplater'; later.textContent = 'Later';
    b.onclick = () => { li.remove(); res(true); };
    later.onclick = () => { li.remove(); res(false); };
    const hint = document.createElement('small'); hint.className = 'stephint'; hint.textContent = 'After tapping, approve in your wallet. If it does not open by itself, open your wallet app: the request is waiting there.';
    li.append(b, later, hint); b.scrollIntoView({ block: 'nearest' });
  });
}
// receipt as soon as any source has it (wallet or public RPC, polled every second)
async function fastWait(tx) {
  let rc = null, walletDone = false;
  tx.wait().then(r => { rc = rc || r; }).catch(() => {}).finally(() => { walletDone = true; });
  const t0 = Date.now();
  while (!rc && Date.now() - t0 < 300000) {
    try { const r = await rd(p => p.getTransactionReceipt(tx.hash)); if (r) rc = r; } catch {}
    if (!rc) await new Promise(r => setTimeout(r, 1000));
  }
  if (!rc) throw new Error('Still waiting for confirmation. Check the transaction on BscScan.');
  return rc;
}

// finish pool setup later (if a launch was interrupted). Anyone can run it; the plan is fixed in the contract.
// prepare() estimates first so the tap can open the wallet immediately.
async function preparePools(token, account) {
  const mt = new E.Contract(token, MT_ABI);
  return poolGas(mt, account);
}
async function finishPools(token, signer, account, deployTx, g) {
  const mt = new E.Contract(token, MT_ABI, signer);
  if (!g) g = await poolGas(mt, account);
  const tx = await walletSend(() => mt.createPools(BATCH, { gasLimit: limitFor(g) }));
  const rc = await fastWait(tx); if (!rc || rc.status !== 1) throw new Error('Creating pools failed on-chain. ' + (rc ? await failReason(rc, g) : ''));
  const inf = await rd(r => mt.connect(r).info());
  const live = inf[0].filter((_, i) => inf[2][i] > 0n);
  if (deployTx) await register(deployTx, live, '');
  return { hash: tx.hash, processed: Number(inf[6]), total: inf[0].length };
}

// ---------- trading on a pool ----------
async function quote(path, amountIn) {
  const r = await rd(p => new E.Contract(L.pcsV3Quoter, QUOTER_ABI, p).quoteExactInputSingle.staticCall({ tokenIn: path[0], tokenOut: path[1], amountIn, fee: FEE, sqrtPriceLimitX96: 0 }));
  return r[0];
}
function swapCall(signer, tokenIn, tokenOut, amountIn, minOut, recipient, dl) {
  return { target: new E.Contract(L.pcsV3Router, ROUTER_ABI, signer), fn: 'exactInputSingle',
    args: [{ tokenIn, tokenOut, fee: FEE, recipient, deadline: dl, amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0 }], spender: L.pcsV3Router };
}

// ---------- dividends: fees of the locked pools, split between holders and the creator ----------
async function tokenInfo(token) {
  const i = await rd(r => new E.Contract(token, MT_ABI, r).info());
  return { stocks: [...i[0]], pools: [...i[1]], positions: [...i[2]], rewards: [...i[3]], holderBps: Number(i[4]), creator: i[5], processed: Number(i[6]) };
}
// simulated claim (includes fees not harvested yet)
async function previewClaim(token, account) { return [...await rd(r => new E.Contract(token, MT_ABI, r).claim.staticCall({ from: account }))]; }
async function previewCreator(token, account) { return [...await rd(r => new E.Contract(token, MT_ABI, r).claimCreator.staticCall({ from: account }))]; }
async function send(token, fn, signer, account) {
  const c = new E.Contract(token, MT_ABI, signer);
  try { await rd(r => c.connect(r)[fn].staticCall({ from: account })); }
  catch (e) { throw new Error('Simulation failed, nothing was sent: ' + CH().decodeErr(e)); }
  const g = await rd(r => c.connect(r)[fn].estimateGas({ from: account }));
  const tx = await CH().sendTx(c, fn, [], {}, account);
  const rc = await CH().waitTx(tx); if (!rc || rc.status !== 1) throw new Error('The transaction failed on-chain. ' + (rc ? await failReason(rc, g) : ''));
  return tx.hash;
}
const claim = (token, signer, account) => send(token, 'claim', signer, account);
const claimCreator = (token, signer, account) => send(token, 'claimCreator', signer, account);

window.StockzMulti = { launch, finishPools, preparePools, quote, swapCall, deadline, stockUsd, tokenInfo, previewClaim, previewCreator, claim, claimCreator, startTick, FEE };
})();
