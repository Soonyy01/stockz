// Vercel Edge Function: forwards the token image + details to flap's official metadata pinning API
// (https://funcs.flap.sh/api/upload, as required by flap's developer docs) and returns the IPFS CID.
// Runs on the same domain as the site, so the browser never needs cross-origin access.
export const config = { runtime: 'edge' };

const FLAP_UPLOAD = 'https://funcs.flap.sh/api/upload';
const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const clip = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const link = v => { const s = clip(v, 200); return s && /^https?:\/\/[^\s]+$/i.test(s) ? s : null; };

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  let fd;
  try { fd = await req.formData(); } catch { return json({ error: 'Bad form data' }, 400); }
  const file = fd.get('image');
  if (!file || typeof file === 'string') return json({ error: 'An image is required.' }, 400);
  if (!TYPES.includes(file.type)) return json({ error: 'Image must be PNG, JPG, WEBP or GIF.' }, 400);
  if (file.size > MAX_BYTES) return json({ error: 'Image must be 5 MB or smaller.' }, 400);
  const creator = clip(fd.get('creator'), 42);
  if (!/^0x[0-9a-fA-F]{40}$/.test(creator)) return json({ error: 'Creator wallet address is missing.' }, 400);

  // A short invisible nonce keeps every upload unique, so the contract never rejects it as an already-used CID.
  const description = (clip(fd.get('description'), 480) || 'Launched on Stockz') + ' ​' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const meta = { website: link(fd.get('website')), twitter: link(fd.get('twitter')), telegram: link(fd.get('telegram')), description, creator };

  const out = new FormData();
  out.append('operations', JSON.stringify({ query: 'mutation Create($file: Upload!, $meta: MetadataInput!) { create(file: $file, meta: $meta) }', variables: { file: null, meta } }));
  out.append('map', JSON.stringify({ '0': ['variables.file'] }));
  out.append('0', file, file.name || 'image.png');

  let res;
  try { res = await fetch(FLAP_UPLOAD, { method: 'POST', body: out, headers: { 'User-Agent': 'Stockz/1.0' } }); }
  catch { return json({ error: 'The metadata service could not be reached. Please retry.' }, 502); }
  const raw = await res.text();
  if (!res.ok) return json({ error: `Metadata upload failed (HTTP ${res.status}).`, detail: raw.slice(0, 300) }, 502);
  let j;
  try { j = JSON.parse(raw); } catch { return json({ error: 'Metadata service returned an unexpected answer.', detail: raw.slice(0, 300) }, 502); }
  if (j.errors && j.errors.length) return json({ error: 'Metadata rejected: ' + j.errors.map(e => e && e.message).join('; ').slice(0, 300) }, 502);
  const cid = j && j.data && j.data.create;
  if (typeof cid !== 'string' || !cid) return json({ error: 'Metadata service returned no CID.' }, 502);
  return json({ cid });
}
