// Vercel Edge Function: the Stockz launch index (like an indexer + database, without running a server).
//   GET  /api/launches            -> every recorded Stockz launch, newest first
//   POST /api/launches {tx}       -> verify that transaction on BNB Chain and record it
//   GET  /api/launches?tx=0x...   -> same as POST (handy for adding an older launch by hand)
// Nothing is trusted from the browser: a launch is stored only if the transaction, read from a BSC RPC,
// succeeded, called newTokenV6 on the Portal with a salt starting with "STKZ", and minted a token to the Portal.
// Storage: Upstash Redis (Vercel Storage -> Upstash). Without it the endpoint answers 503 and the app falls back to chain scanning.
export const config = { runtime: 'edge' };

const PORTAL = '0xe2ce6ab80874fa9fa2aae65d277dd6b8e65c9de0';
const SEL_V6 = '8cb5772c';
const STKZ = '53544b5a';
const T_TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ZERO_TOPIC = '0x' + '0'.repeat(64);
const PORTAL_TOPIC = '0x' + '0'.repeat(24) + PORTAL.slice(2);
const RPCS = ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.binance.org', 'https://bsc.drpc.org', 'https://1rpc.io/bnb'];
const KEY_SET = 'stz:launches', KEY_DATA = 'stz:token';

const json = (o, status = 200, cache = 'no-store') => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': cache } });

function redisConf() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}
async function redis(cmds) {
  const c = redisConf(); if (!c) throw Object.assign(new Error('storage not configured'), { status: 503 });
  const r = await fetch(c.url + '/pipeline', { method: 'POST', headers: { authorization: 'Bearer ' + c.token, 'content-type': 'application/json' }, body: JSON.stringify(cmds) });
  if (!r.ok) throw Object.assign(new Error('storage error HTTP ' + r.status), { status: 502 });
  const out = await r.json();
  return out.map(x => { if (x.error) throw Object.assign(new Error(x.error), { status: 502 }); return x.result; });
}
async function rpc(method, params) {
  let last;
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const j = await r.json(); if (j.error) throw new Error(j.error.message || 'rpc error');
      return j.result;
    } catch (e) { last = e; }
  }
  throw last || new Error('rpc unreachable');
}

// minimal ABI reading of newTokenV6((string name, string symbol, ..., address quoteToken, ...)) calldata
function readStr(hex, start, off) {
  const p = start + off * 2; const len = parseInt(hex.slice(p, p + 64), 16);
  if (!(len >= 0 && len <= 256)) return '';
  const bytes = hex.slice(p + 64, p + 64 + len * 2); let s = '';
  try { s = new TextDecoder().decode(new Uint8Array(bytes.match(/../g)?.map(b => parseInt(b, 16)) || [])); } catch {}
  return s.replace(/[\u0000-\u001f\u007f<>]/g, '').trim();
}
function decodeLaunch(input) {
  const inp = (input || '').toLowerCase().replace(/^0x/, '');
  if (!inp.startsWith(SEL_V6)) return null;
  const t = 8 + 64;                                   // tuple starts after the selector and its offset word
  const w = i => inp.slice(t + i * 64, t + (i + 1) * 64);
  const salt = w(4);
  if (!salt.startsWith(STKZ)) return null;
  const name = readStr(inp, t, parseInt(w(0), 16)), symbol = readStr(inp, t, parseInt(w(1), 16));
  const quote = '0x' + w(6).slice(24);
  return { name: name.slice(0, 32) || 'Unnamed', symbol: symbol.slice(0, 12) || '?', quote };
}

async function verifyAndStore(txHash) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash || '')) return json({ error: 'Invalid transaction hash.' }, 400);
  const tx = await rpc('eth_getTransactionByHash', [txHash]);
  if (!tx) return json({ error: 'Transaction not found yet. Retry in a few seconds.' }, 404);
  if ((tx.to || '').toLowerCase() !== PORTAL) return json({ error: 'Not a launch on the Portal.' }, 422);
  const d = decodeLaunch(tx.input);
  if (!d) return json({ error: 'Not a Stockz launch.' }, 422);
  const rc = await rpc('eth_getTransactionReceipt', [txHash]);
  if (!rc) return json({ error: 'Not confirmed yet. Retry in a few seconds.' }, 404);
  if (rc.status !== '0x1') return json({ error: 'That launch failed on-chain.' }, 422);
  const mint = (rc.logs || []).find(l => l.topics && l.topics[0] === T_TRANSFER && l.topics[1] === ZERO_TOPIC && (l.topics[2] || '').toLowerCase() === PORTAL_TOPIC);
  if (!mint) return json({ error: 'No token was created in that transaction.' }, 422);
  const block = parseInt(rc.blockNumber, 16);
  const b = await rpc('eth_getBlockByNumber', [rc.blockNumber, false]);
  const rec = { token: mint.address.toLowerCase(), tx: txHash.toLowerCase(), block, ts: b ? parseInt(b.timestamp, 16) : 0,
    creator: (tx.from || '').toLowerCase(), name: d.name, symbol: d.symbol, quote: d.quote.toLowerCase() };
  await redis([['ZADD', KEY_SET, String(block), rec.token], ['HSET', KEY_DATA, rec.token, JSON.stringify(rec)]]);
  return json({ ok: true, launch: rec });
}

export default async function handler(req) {
  try {
    const url = new URL(req.url);
    if (req.method === 'POST') {
      let body = {}; try { body = await req.json(); } catch {}
      return await verifyAndStore(String(body.tx || ''));
    }
    if (req.method !== 'GET') return json({ error: 'GET or POST only' }, 405);
    const tx = url.searchParams.get('tx');
    if (tx) return await verifyAndStore(tx);
    if (!redisConf()) return json({ error: 'storage not configured', launches: [] }, 503);
    const [ids] = await redis([['ZREVRANGE', KEY_SET, '0', '999']]);
    if (!ids || !ids.length) return json({ launches: [] }, 200, 'public, max-age=10');
    const [rows] = await redis([['HMGET', KEY_DATA, ...ids]]);
    const launches = (rows || []).map(r => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean);
    return json({ launches }, 200, 'public, max-age=10');
  } catch (e) {
    return json({ error: e.message || 'error' }, e.status || 500);
  }
}
