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
    const tx = await CH().withRead(r => r.getTransaction(rc.hash));
    const lim = tx && tx.gasLimit, used = rc.gasUsed;
    if (lim && used && used >= lim) return `Your wallet sent it with a gas limit of ${Number(lim).toLocaleString('en-US')}, but about ${Number(needed).toLocaleString('en-US')} is needed (out of gas). In your wallet, set the gas limit to at least ${Number(needed * 12n / 10n).toLocaleString('en-US')} or use "Market"/"Auto" gas, then try again.`;
  } catch {}
  return '';
}
const CH = () => window.StockzChain;
const BATCH = Number(L.v3Batch || 2);

// deadline from the chain's own clock (a wrong phone clock must not break or weaken the deadline)
async function deadline() { const b = await CH().withRead(r => r.getBlock('latest')); return BigInt((b && b.timestamp) || Math.floor(Date.now() / 1000)) + 1200n; }

// ---------- USD price of a stock token, read on-chain from PancakeSwap (V2 direct / via WBNB, V3) ----------
// returns { usd, src } or null. A small amount is quoted so a thin pool is not over-read; the creator can always edit it.
async function stockUsd(stock) {
  const ch = CH(), s = E.getAddress(stock.address), U = L.usdt, W = L.wbnb;
  let d; try { d = Number(await ch.withRead(r => new E.Contract(s, ERC20, r).decimals())); } catch { return null; }
  const unit = 10n ** BigInt(Math.max(0, d - 3)), scale = Number(10n ** BigInt(d)) / Number(unit);   // quote 0.001 stock
  const toUsd = out => Number(E.formatUnits(out, 18)) * scale;
  const tries = [
    async () => ({ src: 'PancakeSwap V2', v: (await ch.withRead(r => new E.Contract(L.pcsRouter, V2_ROUTER_ABI, r).getAmountsOut(unit, [s, U]))).at(-1) }),
    ...[2500, 500, 10000, 100].map(fee => async () => ({ src: 'PancakeSwap V3', v: (await ch.withRead(r => new E.Contract(L.pcsV3Quoter, QUOTER_ABI, r).quoteExactInputSingle.staticCall({ tokenIn: s, tokenOut: U, amountIn: unit, fee, sqrtPriceLimitX96: 0 })))[0] })),
    async () => ({ src: 'PancakeSwap V2 via BNB', v: (await ch.withRead(r => new E.Contract(L.pcsRouter, V2_ROUTER_ABI, r).getAmountsOut(unit, [s, W, U]))).at(-1) })
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
    try { p.dec = Number(await ch.withRead(r => new E.Contract(p.stock.address, ERC20, r).decimals())); }
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
    const code = await ch.withRead(r => r.getCode(DEPLOYER));
    if (!code || code === '0x') throw new Error('The CREATE2 deployer is not available on this network.');
    const out = await ch.withRead(r => r.call({ from: account, to: DEPLOYER, data }));
    if (!out || E.getAddress(E.dataSlice(E.zeroPadValue(out, 32), 12)) !== token) throw new Error('The deployment simulation returned an unexpected address.');
    gas = await ch.withRead(r => r.estimateGas({ from: account, to: DEPLOYER, data }));
  } catch (e) { throw new Error('Simulation failed, nothing was sent: ' + (e.message && !e.code ? e.message : ch.decodeErr(e))); }
  const batches = Math.ceil(n / BATCH);
  log(`Confirm the token deployment in your wallet (${batches + 1} confirmations in total)…`);
  const sent = await signer.sendTransaction({ to: DEPLOYER, data, gasLimit: gas * 13n / 10n });
  log(`Sent: <a href="${esc(C.explorer)}/tx/${esc(sent.hash)}" target="_blank" rel="noopener noreferrer">${esc(sent.hash.slice(0, 12))}…</a> waiting for confirmation…`, true);
  const drc = await ch.waitTx(sent);
  const made = await ch.withRead(r => r.getCode(token)).catch(() => '0x');
  if (!made || made === '0x') { const why = drc ? await failReason(drc, gas) : ''; throw new Error('The token deployment failed on-chain. ' + why); }
  log(`✅ Token created: <a href="${esc(C.explorer)}/token/${esc(token)}" target="_blank" rel="noopener noreferrer">${esc(token)}</a>`, true);
  register(sent.hash, [], meta);

  // 2) pools, a few per transaction; liquidity is locked inside the token contract forever
  const mt = new E.Contract(token, MT_ABI, signer);
  const done = [];
  for (let b = 0; b < batches; b++) {
    const part = f.liq.slice(b * BATCH, (b + 1) * BATCH), from = b * BATCH;
    log(`— Pools ${from + 1}–${from + part.length} of ${n}: ${part.map(p => f.symbol + '/' + p.stock.t).join(', ')} —`);
    try {
      try { await ch.withRead(r => mt.connect(r).createPools.staticCall(BATCH, { from: account })); }
      catch (e) { throw new Error('Simulation failed, nothing was sent: ' + ch.decodeErr(e)); }
      log('Confirm creating these pools in your wallet…');
      const pgas = await ch.withRead(r => mt.connect(r).createPools.estimateGas(BATCH, { from: account }));
      const ptx = await ch.sendTx(mt, 'createPools', [BATCH], {}, account);
      const prc = await ch.waitTx(ptx); if (!prc || prc.status !== 1) throw new Error('Creating pools failed on-chain. ' + (prc ? await failReason(prc, pgas) : ''));
      const inf = await ch.withRead(r => mt.connect(r).info());
      part.forEach((p, j) => {
        const i = from + j;
        if (inf[2][i] > 0n) { done.push(p.stock.address); log(`✅ Pool live (liquidity locked): <a href="${esc(C.explorer)}/address/${esc(inf[1][i])}" target="_blank" rel="noopener noreferrer">${esc(f.symbol)}/${esc(p.stock.t)}</a>`, true); }
        else log(`⚠ ${f.symbol}/${p.stock.t} could not be created (its pool already existed at another price). Its share of the supply was burned.`);
      });
      register(sent.hash, done.slice(), meta);
    } catch (e) {
      if (e && (e.code === 'ACTION_REJECTED' || e.code === 4001)) { log(`Paused: you rejected the request. ${done.length} of ${n} pools are live. Open the token page to finish the rest.`); break; }
      log(`❌ ${e.message || ch.decodeErr(e)}`);
      log(`Paused. ${done.length} of ${n} pools are live; nothing else was sent. Open the token page to finish the rest.`);
      break;
    }
  }
  await register(sent.hash, done.slice(), meta);
  return { token, tx: sent.hash, pools: done.length, total: n };
}

// finish pool setup later (if a launch was interrupted). Anyone can run it; the plan is fixed in the contract.
async function finishPools(token, signer, account, deployTx) {
  const mt = new E.Contract(token, MT_ABI, signer);
  try { await CH().withRead(r => mt.connect(r).createPools.staticCall(BATCH, { from: account })); }
  catch (e) { throw new Error('Simulation failed, nothing was sent: ' + CH().decodeErr(e)); }
  const pgas = await CH().withRead(r => mt.connect(r).createPools.estimateGas(BATCH, { from: account }));
  const tx = await CH().sendTx(mt, 'createPools', [BATCH], {}, account);
  const rc = await CH().waitTx(tx); if (!rc || rc.status !== 1) throw new Error('Creating pools failed on-chain. ' + (rc ? await failReason(rc, pgas) : ''));
  const inf = await CH().withRead(r => mt.connect(r).info());
  const live = inf[0].filter((_, i) => inf[2][i] > 0n);
  if (deployTx) await register(deployTx, live, '');
  return { hash: tx.hash, processed: Number(inf[6]), total: inf[0].length };
}

// ---------- trading on a pool ----------
async function quote(path, amountIn) {
  const r = await CH().withRead(p => new E.Contract(L.pcsV3Quoter, QUOTER_ABI, p).quoteExactInputSingle.staticCall({ tokenIn: path[0], tokenOut: path[1], amountIn, fee: FEE, sqrtPriceLimitX96: 0 }));
  return r[0];
}
function swapCall(signer, tokenIn, tokenOut, amountIn, minOut, recipient, dl) {
  return { target: new E.Contract(L.pcsV3Router, ROUTER_ABI, signer), fn: 'exactInputSingle',
    args: [{ tokenIn, tokenOut, fee: FEE, recipient, deadline: dl, amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0 }], spender: L.pcsV3Router };
}

// ---------- dividends: fees of the locked pools, split between holders and the creator ----------
async function tokenInfo(token) {
  const i = await CH().withRead(r => new E.Contract(token, MT_ABI, r).info());
  return { stocks: [...i[0]], pools: [...i[1]], positions: [...i[2]], rewards: [...i[3]], holderBps: Number(i[4]), creator: i[5], processed: Number(i[6]) };
}
// simulated claim (includes fees not harvested yet)
async function previewClaim(token, account) { return [...await CH().withRead(r => new E.Contract(token, MT_ABI, r).claim.staticCall({ from: account }))]; }
async function previewCreator(token, account) { return [...await CH().withRead(r => new E.Contract(token, MT_ABI, r).claimCreator.staticCall({ from: account }))]; }
async function send(token, fn, signer, account) {
  const c = new E.Contract(token, MT_ABI, signer);
  try { await CH().withRead(r => c.connect(r)[fn].staticCall({ from: account })); }
  catch (e) { throw new Error('Simulation failed, nothing was sent: ' + CH().decodeErr(e)); }
  const g = await CH().withRead(r => c.connect(r)[fn].estimateGas({ from: account }));
  const tx = await CH().sendTx(c, fn, [], {}, account);
  const rc = await CH().waitTx(tx); if (!rc || rc.status !== 1) throw new Error('The transaction failed on-chain. ' + (rc ? await failReason(rc, g) : ''));
  return tx.hash;
}
const claim = (token, signer, account) => send(token, 'claim', signer, account);
const claimCreator = (token, signer, account) => send(token, 'claimCreator', signer, account);

window.StockzMulti = { launch, finishPools, quote, swapCall, deadline, stockUsd, tokenInfo, previewClaim, previewCreator, claim, claimCreator, startTick, FEE };
})();
