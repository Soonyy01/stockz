// Minimal, dependency-free BSC reader. Fails closed: any doubt -> throw, never invent data.
(() => {
const C = window.FLAPCITY_CONFIG;
const T_TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO = "0x0000000000000000000000000000000000000000";
const ZERO_TOPIC = "0x" + "0".repeat(64);
const V6_SIG = 'function newTokenV6((string name, string symbol, string meta, uint8 dexThresh, bytes32 salt, uint8 migratorType, address quoteToken, uint256 quoteAmt, address beneficiary, bytes permitData, bytes32 extensionID, bytes extensionData, uint8 dexId, uint8 lpFeeProfile, uint16 buyTaxRate, uint16 sellTaxRate, uint64 taxDuration, uint64 antiFarmerDuration, uint16 mktBps, uint16 deflationBps, uint16 dividendBps, uint16 lpBps, uint256 minimumShareBalance, address dividendToken, address commissionReceiver, uint8 tokenVersion) params) payable returns (address)';
const IFACE = window.ethers ? new window.ethers.Interface([V6_SIG]) : null;
const clean = s => String(s || "").replace(/[\u0000-\u001f\u007f<>]/g, "").trim();
let rpcIdx = 0;

async function rpc(method, params, tries = 8) {
  let last;
  for (let i = 0; i < tries; i++) {
    const url = C.rpcUrls[(rpcIdx + i) % C.rpcUrls.length];
    try {
      const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 20000);
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, signal: ctl.signal,
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      clearTimeout(to);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      if (j.error) { const e = new Error(j.error.message || "RPC error"); e.rpc = true; throw e; }
      rpcIdx = (rpcIdx + i) % C.rpcUrls.length;
      return j.result;
    } catch (e) {
      last = e;
      if (e.rpc && /range|limit|exceed|too many|too large|results|block/i.test(e.message)) { e.range = true; throw e; } // let caller shrink the range
      await new Promise(r => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw last || new Error("RPC unreachable");
}
async function rpcBatch(calls) {           // [{method, params}] -> results (null on per-call error)
  for (let i = 0; i < C.rpcUrls.length * 2; i++) {
    const url = C.rpcUrls[(rpcIdx + i) % C.rpcUrls.length];
    try {
      const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 25000);
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, signal: ctl.signal,
        body: JSON.stringify(calls.map((c, id) => ({ jsonrpc: "2.0", id, method: c.method, params: c.params }))) });
      clearTimeout(to);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      if (!Array.isArray(j)) throw new Error("batch not supported");
      const out = new Array(calls.length).fill(null);
      for (const x of j) if (x && typeof x.id === "number" && !x.error) out[x.id] = x.result;
      return out;
    } catch (e) { await new Promise(r => setTimeout(r, 300 * (i + 1))); }
  }
  // last resort: one by one
  const out = [];
  for (const c of calls) { try { out.push(await rpc(c.method, c.params, 3)); } catch { out.push(null); } }
  return out;
}
const hex = n => "0x" + n.toString(16);
const num = h => parseInt(h, 16);

let maxSpan = 5000;   // learned from RPC errors such as "limited to a 1000 blocks range"
async function getLogsChunked(filter, from, to, onLogs, onProgress) {
  const queue = [];
  for (let s = from; s <= to; s += maxSpan) queue.push([s, Math.min(to, s + maxSpan - 1)]);
  let total = queue.length, done = 0;
  async function worker() {
    while (queue.length) {
      const [a, b] = queue.shift();
      try {
        const logs = await rpc("eth_getLogs", [{ ...filter, fromBlock: hex(a), toBlock: hex(b) }]);
        onLogs(logs); done++; onProgress && onProgress(Math.min(1, done / total));
      } catch (e) {
        if (e.range && b > a) {
          const msg = String(e.message).replace(/,/g, "");
          const m = msg.match(/(\d{2,7})\s*blocks?/i) || msg.match(/blocks?[^0-9]{0,24}(\d{2,7})/i);
          const lim = m ? parseInt(m[1], 10) : 0;
          maxSpan = Math.max(10, Math.min(maxSpan, lim > 0 ? lim : Math.floor((b - a + 1) / 2)));
          const parts = []; for (let s = a; s <= b; s += maxSpan) parts.push([s, Math.min(b, s + maxSpan - 1)]);
          queue.unshift(...parts); total += parts.length - 1;
        } else throw e;
      }
    }
  }
  await Promise.all(Array.from({ length: 3 }, worker));
}

function decodeCreated(log) {
  if (!log || log.address.toLowerCase() !== C.portal.toLowerCase()) return null;
  if (!log.topics || log.topics.length !== 1 || log.topics[0].toLowerCase() !== C.topicTokenCreated) return null;
  const d = log.data.slice(2); if (d.length < 7 * 64 || d.length % 2) return null;
  const w = i => d.slice(i * 64, i * 64 + 64);
  const addr = i => { const x = w(i); if (!/^0{24}/.test(x)) return null; return "0x" + x.slice(24); };
  const str = off => {
    const o = parseInt(off, 16) * 2; if (!(o >= 7 * 64) || o + 64 > d.length) return null;
    const len = parseInt(d.slice(o, o + 64), 16) * 2; if (o + 64 + len > d.length || len > 4000) return null;
    const bytes = new Uint8Array(len / 2); for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(d.substr(o + 64 + i * 2, 2), 16);
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/[\u0000-\u001f\u007f<>]/g, "").trim();
  };
  const creator = addr(1), token = addr(3), name = str(w(4)), symbol = str(w(5));
  if (!creator || !token || name === null || symbol === null) return null;
  return { token, creator, name: name.slice(0, 32) || "Unnamed", symbol: symbol.slice(0, 12) || "?", ts: num(w(0)), block: num(log.blockNumber), tx: log.transactionHash };
}

async function init() {
  const cid = num(await rpc("eth_chainId", []));
  if (cid !== C.chainId) throw new Error("RPC is on chain " + cid + ", expected " + C.chainId);
  const code = await rpc("eth_getCode", [C.portal, "latest"]);
  if (!code || code === "0x") throw new Error("No contract code at the Portal address");
  const latest = num(await rpc("eth_blockNumber", []));
  const [bl, bo] = await Promise.all([rpc("eth_getBlockByNumber", [hex(latest), false]), rpc("eth_getBlockByNumber", [hex(latest - 20000), false])]);
  const spb = (num(bl.timestamp) - num(bo.timestamp)) / 20000;       // seconds per block, measured
  if (!(spb > 0.2 && spb < 5)) throw new Error("Unexpected block time");
  return { latest, nowTs: num(bl.timestamp), spb };
}

// Two independent ways to find new tokens, merged by address:
//  1) the Portal's TokenCreated event, 2) the token's mint (Transfer from 0x0 to the Portal), which every launch emits.
// (2) does not depend on the event layout, so a launch is never missed if the event format changes.
async function collectLaunches(from, to, tsOf, onProgress) {
  const byTok = new Map();
  await getLogsChunked({ address: C.portal, topics: [C.topicTokenCreated] }, from, to, logs => {
    for (const l of logs) { const t = decodeCreated(l); if (t) byTok.set(t.token.toLowerCase(), t); }
  }, p => onProgress && onProgress("Reading launches", p * 0.5));
  const portalTopic = "0x" + "0".repeat(24) + C.portal.slice(2).toLowerCase();
  try {
    await getLogsChunked({ topics: [T_TRANSFER, ZERO_TOPIC, portalTopic] }, from, to, logs => {
      for (const l of logs) {
        const k = (l.address || "").toLowerCase(); if (!k || byTok.has(k)) continue;
        const b = num(l.blockNumber);
        byTok.set(k, { token: k, creator: null, name: null, symbol: null, ts: tsOf(b), block: b, tx: l.transactionHash });
      }
    }, p => onProgress && onProgress("Reading launches", 0.5 + p * 0.5));
  } catch (e) { console.warn("[Stockz] mint scan failed, using launch events only:", e && e.message); }
  return [...byTok.values()];
}

async function loadTokens(ctx, onUpdate, onProgress) {
  const from = Math.max(0, ctx.latest - Math.ceil(C.lookbackHours * 3600 / ctx.spb));
  const created = await collectLaunches(from, ctx.latest, b => Math.round(ctx.nowTs - (ctx.latest - b) * ctx.spb), onProgress);
  const seen = new Set(); const list = [];
  created.sort((a, b) => b.block - a.block);
  for (const t of created) { const k = t.token.toLowerCase(); if (!seen.has(k)) { seen.add(k); list.push({ ...t, id: k, balances: new Map(), transfers: 0, lastBlock: 0, recent: 0, rb: [] }); } }
  await scanTxs(list, onProgress);
  const tokens = list.filter(t => t.stockz).slice(0, C.maxTokens);
  onUpdate(tokens, created.length);
  // Transfer logs -> holders and activity (standard ERC-20 Transfer, batches of 25 tokens)
  ctx.scanned = ctx.latest;
  const byId = new Map(tokens.map(t => [t.id, t]));
  const batches = []; for (let i = 0; i < tokens.length; i += 25) batches.push(tokens.slice(i, i + 25));
  let bi = 0;
  for (const b of batches) {
    const start = Math.min(...b.map(t => t.block));
    try { await getLogsChunked({ address: b.map(t => t.token), topics: [T_TRANSFER] }, start, ctx.latest, logs => {
      for (const l of logs) {
        const t = byId.get(l.address.toLowerCase()); if (!t || !l.topics || l.topics.length !== 3) continue;
        const f = "0x" + l.topics[1].slice(26), to = "0x" + l.topics[2].slice(26);
        let v; try { v = BigInt(l.data); } catch { continue; }
        t.balances.set(f, (t.balances.get(f) || 0n) - v); t.balances.set(to, (t.balances.get(to) || 0n) + v);
        t.transfers++; const bn = num(l.blockNumber); if (bn > t.lastBlock) t.lastBlock = bn;
        t.rb.push(bn); if (t.rb.length > 300) t.rb.splice(0, t.rb.length - 300);
      }
    }, p => onProgress && onProgress("Reading activity", (bi + p) / batches.length));
    } catch (e) {
      // Fail closed for THIS batch only: its holder/activity numbers are unknown, never guessed.
      for (const t of b) { t.activityError = true; t.balances = new Map(); t.transfers = 0; t.lastBlock = 0; t.recent = 0; t.rb = []; }
    }
    bi++; onUpdate(tokens, created.length);
  }
  recompute(tokens, ctx);
  return tokens;
}

function recompute(tokens, ctx) {
  const cut = ctx.latest - 900 / ctx.spb;
  for (const t of tokens) t.recent = (t.rb || []).filter(b => b >= cut).length;
}

// Incremental update: new launches and new transfers since the last scan. Throws on failure; the caller just retries later.
async function refresh(ctx, tokens, onUpdate) {
  const latest = num(await rpc("eth_blockNumber", []));
  if (latest <= ctx.scanned) return tokens;
  const bl = await rpc("eth_getBlockByNumber", [hex(latest), false]);
  const from = ctx.scanned + 1, have = new Set(tokens.map(t => t.id)), fresh = [], nowTs = num(bl.timestamp);
  for (const t of await collectLaunches(from, latest, b => Math.round(nowTs - (latest - b) * ctx.spb))) {
    const k = t.token.toLowerCase(); if (have.has(k)) continue; have.add(k);
    fresh.push({ ...t, id: k, balances: new Map(), transfers: 0, lastBlock: 0, recent: 0, rb: [] });
  }
  if (fresh.length) await scanTxs(fresh, null);
  const all = fresh.filter(t => t.stockz).sort((a, b) => b.block - a.block).concat(tokens).slice(0, C.maxTokens);
  const byId = new Map(all.map(t => [t.id, t]));
  for (let i = 0; i < all.length; i += 25) {
    const b = all.slice(i, i + 25).filter(t => !t.activityError);
    if (!b.length) continue;
    await getLogsChunked({ address: b.map(t => t.token), topics: [T_TRANSFER] }, from, latest, logs => {
      for (const l of logs) {
        const t = byId.get(l.address.toLowerCase()); if (!t || !l.topics || l.topics.length !== 3) continue;
        const f = "0x" + l.topics[1].slice(26), to = "0x" + l.topics[2].slice(26);
        let v; try { v = BigInt(l.data); } catch { continue; }
        t.balances.set(f, (t.balances.get(f) || 0n) - v); t.balances.set(to, (t.balances.get(to) || 0n) + v);
        t.transfers++; const bn = num(l.blockNumber); if (bn > t.lastBlock) t.lastBlock = bn;
        t.rb.push(bn); if (t.rb.length > 300) t.rb.splice(0, t.rb.length - 300);
      }
    });
  }
  ctx.latest = latest; ctx.scanned = latest; ctx.nowTs = num(bl.timestamp);
  recompute(all, ctx);
  onUpdate && onUpdate(all);
  return all;
}

// Pair detection without any event ABI: read the creation transaction and look for a known stock address in its calldata.
// A token is only assigned a stock when EXACTLY ONE known stock address appears there. Otherwise it stays unpaired.
// Stockz launches carry a marker: newTokenV6 called on the Portal with a salt starting with "STKZ" (0x53544b5a).
// The pair is the one known stock address that appears in the same calldata.
const STKZ = "53544b5a", SEL_V6 = "0x8cb5772c";
async function scanTxs(tokens, onProgress) {
  const known = (C.stockTokens || []).map(s => ({ t: s.t, word: "000000000000000000000000" + s.address.slice(2).toLowerCase() }));
  const portal = C.portal.toLowerCase();
  for (let i = 0; i < tokens.length; i += 40) {
    const part = tokens.slice(i, i + 40);
    const txs = await rpcBatch(part.map(t => ({ method: "eth_getTransactionByHash", params: [t.tx] })));
    part.forEach((t, k) => {
      const tx = txs[k]; if (!tx || typeof tx.input !== "string") return;
      const inp = tx.input.toLowerCase();
      // find the newTokenV6 call: directly at the start, or wrapped inside a smart-wallet call
      let at = inp.startsWith(SEL_V6) ? 2 : -1;
      if (at < 0) { let i = inp.indexOf(SEL_V6.slice(2)); while (i > 0 && i % 2 !== 0) i = inp.indexOf(SEL_V6.slice(2), i + 1); at = i; }
      const salt = at >= 0 ? inp.slice(at + 8 + 5 * 64, at + 8 + 6 * 64) : "";   // tuple head: offset, name, symbol, meta, dexThresh, salt
      t.stockz = at >= 0 && salt.startsWith(STKZ) && ((tx.to || "").toLowerCase() === portal || at > 2);
      if (!t.stockz) return;
      if (!t.creator && tx.from) t.creator = String(tx.from).toLowerCase();
      // read name, ticker and pair straight from the launch call
      let p = null;
      if (IFACE) { try { p = IFACE.decodeFunctionData("newTokenV6", "0x" + inp.slice(at))[0]; } catch {} }
      if (p) {
        if (!t.name) t.name = clean(p.name).slice(0, 32) || "Unnamed";
        if (!t.symbol) t.symbol = clean(p.symbol).slice(0, 12) || "?";
        const q = String(p.quoteToken || "").toLowerCase(), hit = (C.stockTokens || []).find(s => s.address.toLowerCase() === q);
        if (hit) t.quote = hit.t;
      }
      if (!t.quote) { const hits = known.filter(x => inp.includes(x.word)); if (hits.length === 1) t.quote = hits[0].t; }
      if (!t.name) t.name = "Unnamed"; if (!t.symbol) t.symbol = "?";
    });
    onProgress && onProgress("Finding Stockz launches", Math.min(1, (i + 40) / tokens.length));
  }
}
function holders(t) {
  let n = 0; const skip = new Set([ZERO, C.portal.toLowerCase(), t.token.toLowerCase()]);
  for (const [a, v] of t.balances) if (v > 0n && !skip.has(a)) n++;
  return n;
}
window.FlapChain = { init, loadTokens, refresh, holders };
})();
