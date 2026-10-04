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
  let total = queue.length, done = 0, failed = 0;
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
        } else { failed++; console.warn("[Stockz] skipped a block range after retries:", a, b, e && e.message); done++; }
      }
    }
  }
  await Promise.all(Array.from({ length: 3 }, worker));
  if (failed && failed === total) throw new Error("every block range failed");
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

// ---------- launch index (/api/launches): every verified Stockz launch, no time limit ----------
const INDEX_API = "/api/launches";
async function fetchIndex() {
  try {
    const r = await fetch(INDEX_API, { cache: "no-store" }); if (!r.ok) return null;
    const j = await r.json(); return Array.isArray(j.launches) ? j.launches : null;
  } catch { return null; }
}
const tickerOf = addr => { const a = String(addr || "").toLowerCase(), s = (C.stockTokens || []).find(x => x.address.toLowerCase() === a); return s ? s.t : null; };
function mergeIndex(list, idx) {
  if (!idx) return;
  const byTok = new Map(list.map(t => [t.token.toLowerCase(), t])), cc = loadCache();
  for (const r of idx) {
    const k = String(r.token || "").toLowerCase(); if (!/^0x[0-9a-f]{40}$/.test(k)) continue;
    let t = byTok.get(k);
    if (!t) { t = { token: k, id: k, creator: r.creator || null, name: r.name, symbol: r.symbol, ts: r.ts, block: r.block, tx: r.tx, balances: new Map(), transfers: 0, lastBlock: 0, recent: 0, rb: [] }; list.push(t); byTok.set(k, t); }
    t.stockz = true; t.indexed = true; t.quote = tickerOf(r.quote) || t.quote;
    t.name = t.name || r.name || "Unnamed"; t.symbol = t.symbol || r.symbol || "?"; t.creator = t.creator || r.creator || null;
    cc[k] = { s: 1, b: t.block, q: t.quote || "", n: t.name, y: t.symbol, c: t.creator || "" };
  }
}
// tokens found by the chain scan but missing from the index are sent there (the server re-verifies them)
function reportToIndex(tokens) {
  const miss = tokens.filter(t => t.stockz && !t.indexed && t.tx).slice(0, 10);
  for (const t of miss) fetch(INDEX_API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tx: t.tx }) }).then(r => { if (r.ok) t.indexed = true; }).catch(() => {});
}

async function indexTokens() {
  const idx = await fetchIndex(); if (!idx) return null;
  const list = []; mergeIndex(list, idx);
  return list.sort((a, b) => b.block - a.block).slice(0, C.maxTokens);
}
async function loadTokens(ctx, onUpdate, onProgress) {
  const from = Math.max(0, ctx.latest - Math.ceil(C.lookbackHours * 3600 / ctx.spb));
  const created = await collectLaunches(from, ctx.latest, b => Math.round(ctx.nowTs - (ctx.latest - b) * ctx.spb), onProgress);
  const seen = new Set(); const list = [];
  created.sort((a, b) => b.block - a.block);
  for (const t of created) { const k = t.token.toLowerCase(); if (!seen.has(k)) { seen.add(k); list.push({ ...t, id: k, balances: new Map(), transfers: 0, lastBlock: 0, recent: 0, rb: [] }); } }
  const idx = await fetchIndex(); const hasIndex = !!idx;
  mergeIndex(list, idx);
  list.sort((a, b) => b.block - a.block);
  const found = () => list.filter(t => t.stockz).slice(0, C.maxTokens);
  if (found().length) onUpdate(found(), created.length);
  await scanTxs(list, onProgress, () => onUpdate(found(), created.length));
  const tokens = found();
  if (hasIndex) reportToIndex(tokens);
  onUpdate(tokens, created.length);
  // Transfer logs -> holders and activity (standard ERC-20 Transfer, batches of 25 tokens)
  ctx.scanned = ctx.latest;
  const byId = new Map(tokens.map(t => [t.id, t]));
  const batches = []; for (let i = 0; i < tokens.length; i += 25) batches.push(tokens.slice(i, i + 25));
  let bi = 0;
  for (const b of batches) {
    const floor = ctx.latest - Math.ceil(7 * 86400 / ctx.spb);
    for (const t of b) if (t.block < floor) t.activityError = true;   // older than 7 days: activity not scanned (shown as unavailable, never guessed)
    const live = b.filter(t => !t.activityError); if (!live.length) { bi++; continue; }
    const start = Math.min(...live.map(t => t.block));
    try { await getLogsChunked({ address: live.map(t => t.token), topics: [T_TRANSFER] }, start, ctx.latest, logs => {
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
      for (const t of live) { t.activityError = true; t.balances = new Map(); t.transfers = 0; t.lastBlock = 0; t.recent = 0; t.rb = []; }
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
  const idx = await fetchIndex();
  if (idx) { const before = new Set(fresh.map(t => t.id)); mergeIndex(fresh, idx.filter(r => !have.has(String(r.token).toLowerCase()) || before.has(String(r.token).toLowerCase()))); }
  if (fresh.length) await scanTxs(fresh.filter(t => !t.indexed), null);
  if (idx) reportToIndex(fresh);
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
// scan results are remembered per browser (token -> not Stockz / Stockz + pair, name, ticker, creator), so reloads are fast
const CK = "stz-scan-v2";
let cache = null;
function loadCache() { if (cache) return cache; try { cache = JSON.parse(localStorage.getItem(CK) || "{}") || {}; } catch { cache = {}; } return cache; }
function saveCache(list) {
  try { const keep = {}, min = Math.min(...list.map(t => t.block)) - 1; for (const [k, v] of Object.entries(cache || {})) if ((v.b || 0) >= min) keep[k] = v; cache = keep; localStorage.setItem(CK, JSON.stringify(keep)); } catch {}
}
async function scanTxs(tokens, onProgress, onFound) {
  const known = (C.stockTokens || []).map(s => ({ t: s.t, word: "000000000000000000000000" + s.address.slice(2).toLowerCase() }));
  const portal = C.portal.toLowerCase(), cc = loadCache();
  const todo = [];
  for (const t of tokens) {
    const v = cc[t.token.toLowerCase()];
    if (!v) { todo.push(t); continue; }
    t.stockz = !!v.s;
    if (v.s) { t.quote = v.q || t.quote; t.name = t.name || v.n || "Unnamed"; t.symbol = t.symbol || v.y || "?"; t.creator = t.creator || v.c || null; }
  }
  if (onFound && tokens.some(t => t.stockz)) onFound();
  todo.sort((a, b) => b.block - a.block);                         // newest first: fresh launches show up right away
  const batches = []; for (let i = 0; i < todo.length; i += 40) batches.push(todo.slice(i, i + 40));
  let done = 0, next = 0;
  const work = async () => {
    while (next < batches.length) {
      const part = batches[next++];
      const txs = await rpcBatch(part.map(t => ({ method: "eth_getTransactionByHash", params: [t.tx] })));
      let hit = false;
      part.forEach((t, k) => {
        const tx = txs[k]; if (!tx || typeof tx.input !== "string") return;   // unknown: not cached, retried next time
        const inp = tx.input.toLowerCase();
        // find the newTokenV6 call: directly at the start, or wrapped inside a smart-wallet call
        let at = inp.startsWith(SEL_V6) ? 2 : -1;
        if (at < 0) { let i = inp.indexOf(SEL_V6.slice(2)); while (i > 0 && i % 2 !== 0) i = inp.indexOf(SEL_V6.slice(2), i + 1); at = i; }
        const salt = at >= 0 ? inp.slice(at + 8 + 5 * 64, at + 8 + 6 * 64) : "";   // tuple head: offset, name, symbol, meta, dexThresh, salt
        t.stockz = at >= 0 && salt.startsWith(STKZ) && ((tx.to || "").toLowerCase() === portal || at > 2);
        if (!t.stockz) { cc[t.token.toLowerCase()] = { s: 0, b: t.block }; return; }
        hit = true;
        if (!t.creator && tx.from) t.creator = String(tx.from).toLowerCase();
        let p = null;
        if (IFACE) { try { p = IFACE.decodeFunctionData("newTokenV6", "0x" + inp.slice(at))[0]; } catch {} }
        if (p) {
          if (!t.name) t.name = clean(p.name).slice(0, 32) || "Unnamed";
          if (!t.symbol) t.symbol = clean(p.symbol).slice(0, 12) || "?";
          const q = String(p.quoteToken || "").toLowerCase(), h = (C.stockTokens || []).find(s => s.address.toLowerCase() === q);
          if (h) t.quote = h.t;
        }
        if (!t.quote) { const hits = known.filter(x => inp.includes(x.word)); if (hits.length === 1) t.quote = hits[0].t; }
        if (!t.name) t.name = "Unnamed"; if (!t.symbol) t.symbol = "?";
        cc[t.token.toLowerCase()] = { s: 1, b: t.block, q: t.quote || "", n: t.name, y: t.symbol, c: t.creator || "" };
      });
      done++;
      onProgress && onProgress("Finding Stockz launches", Math.min(1, done / batches.length));
      if (hit && onFound) onFound();
      if (done % 10 === 0) saveCache(tokens);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, batches.length) }, work));
  saveCache(tokens);
}
function holders(t) {
  let n = 0; const skip = new Set([ZERO, C.portal.toLowerCase(), t.token.toLowerCase()]);
  for (const [a, v] of t.balances) if (v > 0n && !skip.has(a)) n++;
  return n;
}
window.FlapChain = { init, loadTokens, refresh, holders, indexTokens };
})();
