(() => {
const C = window.FLAPCITY_CONFIG, GEO = window.GEO;
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const svg = $('#map'), NS = 'http://www.w3.org/2000/svg', INK = '#1d1a16';
function el(t, a, parent = svg) { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); parent.appendChild(e); return e; }
function shade(hex, f) { const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = n >> 8 & 255, b = n & 255;
  r = Math.min(255, Math.round(r * f)); g = Math.min(255, Math.round(g * f)); b = Math.min(255, Math.round(b * f)); return `rgb(${r},${g},${b})`; }
const pp = a => a.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ');
let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

// ---------- markets (real hours, holidays not modelled) ----------
const MARKETS = { US:{tz:'America/New_York',o:[9,30],c:[16,0],n:'New York'}, HK:{tz:'Asia/Hong_Kong',o:[9,30],c:[16,0],n:'Hong Kong'}, KR:{tz:'Asia/Seoul',o:[9,0],c:[15,30],n:'Seoul'}, TW:{tz:'Asia/Taipei',o:[9,0],c:[13,30],n:'Taipei'} };
function mstate(k) { const m = MARKETS[k];
  const p = new Intl.DateTimeFormat('en-US', {timeZone:m.tz, weekday:'short', hour:'2-digit', minute:'2-digit', hour12:false}).formatToParts(new Date());
  const g = t => p.find(x => x.type === t).value; const mins = (+g('hour') % 24) * 60 + +g('minute');
  return { open: !['Sat','Sun'].includes(g('weekday')) && mins >= m.o[0]*60+m.o[1] && mins < m.c[0]*60+m.c[1], time: g('hour').replace(/^24$/,'00') + ':' + g('minute') }; }

// ---------- geography ----------
const US = GEO.us, ASIA = GEO.asia;
const rings = g => g.type === 'Polygon' ? [g.coordinates[0]] : g.coordinates.map(p => p[0]);
const TILT = .98, R = Math.PI/180, p1 = 29.5*R, p2 = 45.5*R, l0 = -96*R, f0 = 37.5*R;
const n = (Math.sin(p1)+Math.sin(p2))/2, Cc = Math.cos(p1)**2 + 2*n*Math.sin(p1), r0 = Math.sqrt(Cc - 2*n*Math.sin(f0))/n;
const albers = (lon, lat) => { const l = lon*R, f = lat*R; const r = Math.sqrt(Cc - 2*n*Math.sin(f))/n, t = n*(l-l0); return [r*Math.sin(t), -(r0 - r*Math.cos(t))*TILT]; };
const eqr = (lon, lat) => [lon*Math.cos(36*R)*R, -lat*R*TILT];
function fitter(features, raw, box) {
  let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
  for (const f of features) for (const r of rings(f.geometry)) for (const [a,b] of r) { const [x,y] = raw(a,b); x0=Math.min(x0,x); x1=Math.max(x1,x); y0=Math.min(y0,y); y1=Math.max(y1,y); }
  const s = Math.min(box.w/(x1-x0), box.h/(y1-y0)), ox = box.x + (box.w-(x1-x0)*s)/2, oy = box.y + (box.h-(y1-y0)*s)/2;
  return (a,b) => { const [x,y] = raw(a,b); return [ox+(x-x0)*s, oy+(y-y0)*s]; };
}
const usP = fitter(US.features, albers, {x:700,y:170,w:1240,h:960});
const asP = fitter(ASIA.features, eqr, {x:30,y:230,w:620,h:700});
// ---------- stock districts: every flap quote stock gets a plot ----------
const STOCKS = window.FLAP_STOCKS;
// Plots are assigned by Stockz (not company HQ). Fixed plots keep the approved map; the rest fill the remaining space.
const FIXED = {TSLAB:'Texas',NVDAB:'California',MSFTB:'Washington',AAPLB:'Arizona',GOOGLB:'Montana',NFLXB:'Colorado',HOODB:'Nebraska',ADBEB:'Minnesota',
  MSTRB:'Illinois',AGPUB:'Michigan',GMEB:'Louisiana',SPCXB:'Florida',SPYB:'New York',QQQB:'North Carolina',FWDIB:'Maine',
  BABAB:'China',PDDB:'China',wTCENTx:'China',aWDH:'China',wPOPMTx:'China',SKHYB:'South Korea',EWYB:'South Korea',KORUB:'South Korea',TSMB:'Taiwan'};
const REGION_MKT = {'China':'HK','South Korea':'KR','Taiwan':'TW'};
const LAND_COL = {'Washington':'#7fb8ff','California':'#5fd38d','Arizona':'#c9cfd6','Montana':'#ffd166','Colorado':'#ff7b8a','Nebraska':'#c6f06a','Texas':'#ff7461','Minnesota':'#ff9fb2','Illinois':'#ffa25a','Michigan':'#79d3ff','Louisiana':'#ff6b6b','Florida':'#62e0ef','New York':'#a9b4ff','North Carolina':'#d7a6ff','Maine':'#6fe3cf','China':'#ff9a3d','South Korea':'#f19bff','Taiwan':'#7be0a8'};
const PAL = ['#7fb8ff','#5fd38d','#c9cfd6','#ffd166','#ff7b8a','#c6f06a','#ff7461','#ff9fb2','#ffa25a','#79d3ff','#ff6b6b','#62e0ef','#a9b4ff','#d7a6ff','#6fe3cf','#ff9a3d','#f19bff'];
function area(f){ let A = 0; for (const r of rings(f.geometry)) { const p = r.map(([a, b]) => usP(a, b)); let s = 0; for (let i = 0; i < p.length - 1; i++) s += p[i][0]*p[i+1][1] - p[i+1][0]*p[i][1]; A += Math.abs(s / 2); } return A; }
const DIST = {};
(function assign() {
  const add = (land, s) => { (DIST[land] = DIST[land] || {lots: []}).lots.push(s); };
  for (const s of STOCKS) if (FIXED[s.t]) add(FIXED[s.t], s);
  const areas = US.features.map(f => ({ n: f.properties.name, a: area(f) })).sort((x, y) => y.a - x.a);
  const rest = STOCKS.filter(s => !FIXED[s.t]);
  // spread the rest over states in proportion to land area (largest remainder), so small states are not crowded
  const have = n => (DIST[n] ? DIST[n].lots.length : 0), tot = areas.reduce((p, x) => p + x.a, 0), all = rest.length + STOCKS.filter(s => FIXED[s.t] && US.features.some(f => f.properties.name === FIXED[s.t])).length;
  const want = areas.map(x => { const q = x.a / tot * all; return { n: x.n, f: Math.floor(q), r: q - Math.floor(q), have: have(x.n) }; });
  let slots = []; for (const w of want) for (let j = w.have; j < w.f; j++) slots.push(w.n);
  for (const w of want.slice().sort((x, y) => y.r - x.r)) { if (slots.length >= rest.length) break; if (w.have + w.f < 6) slots.push(w.n); }
  for (let j = 0; slots.length < rest.length; j++) slots.push(areas[j % areas.length].n);
  slots = slots.slice(0, rest.length);
  rest.forEach((s, i) => add(slots[i], s));
  let k = 0; for (const nm of Object.keys(DIST)) { DIST[nm].col = LAND_COL[nm] || PAL[k++ % PAL.length]; DIST[nm].mkt = REGION_MKT[nm] || 'US'; }
})();
const ADJ = {'Florida':[26,26],'Texas':[10,34],'North Carolina':[10,6],'Nebraska':[0,-4],'Michigan':[10,8],'South Korea':[4,6],'China':[30,10]};
const pathOf = (f,P,dy=0) => rings(f.geometry).map(r => 'M' + r.map(([lo,la]) => { const p = P(lo,la); return p[0].toFixed(1)+','+(p[1]+dy).toFixed(1); }).join('L') + 'Z').join('');
function centroid(f,P){let best=null,ba=0;for(const r of rings(f.geometry)){const pts=r.map(([a,b])=>P(a,b));let A=0,x=0,y=0;
  for(let i=0;i<pts.length-1;i++){const c=pts[i][0]*pts[i+1][1]-pts[i+1][0]*pts[i][1];A+=c;x+=(pts[i][0]+pts[i+1][0])*c;y+=(pts[i][1]+pts[i+1][1])*c}
  if(Math.abs(A)>ba){ba=Math.abs(A);best=[x/(3*A),y/(3*A)]}}return best}

// ---------- sprites (from the approved mockup) ----------
const OUT = {stroke:INK,'stroke-width':1.6,'stroke-linejoin':'round'};
const poly = (g,pts,fill) => el('polygon',{points:pp(pts),fill,...OUT},g);
function box(g,x,y,w,d,h,col,o={}){
  const k=o.night?.55:1;
  poly(g,[[x-w,y],[x,y+d],[x,y+d-h],[x-w,y-h]],shade(col,.68*k));
  poly(g,[[x,y+d],[x+w,y],[x+w,y-h],[x,y+d-h]],shade(col,.9*k));
  poly(g,[[x-w,y-h],[x,y+d-h],[x+w,y-h],[x,y-d-h]],shade(col,(o.top||1.15)*k));
  if(o.windows){const lit=o.night?'#ffd75e':'#e8f6ff',dark=o.night?'#2a2f45':'#3a5a74';
    for(let kk=10,j=0;kk<h-6;kk+=10,j++)for(let q=0;q<2;q++){
      const t=(q+.35)/2.2,lx=x-w+w*t,ly=y+d*t-kk;
      el('polygon',{points:pp([[lx,ly],[lx+2.6,ly+1.5],[lx+2.6,ly-3],[lx,ly-4.5]]),fill:(j+q)%3===0?dark:lit},g);
      const rx=x+w*t,ry=y+d-d*t-kk;
      el('polygon',{points:pp([[rx,ry],[rx+2.6,ry-1.5],[rx+2.6,ry-6],[rx,ry-4.5]]),fill:(j+q)%4===1?dark:lit},g);}}
}
function tent(g,x,y,col,o={}){const k=o.night?.6:1,h=20,w=11,d=6;
  poly(g,[[x-w,y],[x,y+d],[x,y-h]],shade('#f2e3c6',.85*k));poly(g,[[x,y+d],[x+w,y],[x,y-h]],shade('#f2e3c6',k));
  el('polygon',{points:pp([[x+1.5,y+d-1],[x+5,y+d-3],[x+1.5,y-6]]),fill:shade(col,.7)},g);
  el('line',{x1:x,y1:y-h,x2:x,y2:y-h-10,stroke:INK,'stroke-width':1.6},g);poly(g,[[x,y-h-10],[x+8,y-h-7.5],[x,y-h-5]],col);}
function house(g,x,y,col,o={},ruin=false){const c=ruin?'#9a948a':col,w=11,d=6,h=14;
  box(g,x,y,w,d,h,c,{night:o.night,top:1});const a=[x,y-h-14],k=o.night?.6:1;
  if(!ruin){poly(g,[[x-w,y-h],[x,y+d-h],a],shade('#b24a32',k));poly(g,[[x,y+d-h],[x+w,y-h],a],shade('#d9643f',k));}
  else{poly(g,[[x-w,y-h],[x,y+d-h],[x-3,y-h-6]],'#6f6a62');
    el('path',{d:`M${x+2},${y-h+3} l4,-6 l3,4`,stroke:INK,'stroke-width':1.4,fill:'none'},g);
    for(const [dx,dy,r] of [[-15,-2,3],[14,2,2.4],[-6,6,2]])el('circle',{cx:x+dx,cy:y+dy,r,fill:'#8b867c',stroke:INK,'stroke-width':1},g);
    el('path',{d:`M${x-8},${y-h-22} q4,-7 8,0 q4,-7 8,0`,stroke:'#e8e3d6','stroke-width':1.6,fill:'none',opacity:.8},g);}
  el('polygon',{points:pp([[x+3,y+d-2.5],[x+6,y+d-4.3],[x+6,y-5],[x+3,y-3.2]]),fill:ruin?'#3b3833':'#4a2c1a'},g);}
function shop(g,x,y,col,o={}){const w=15,d=8,h=18;box(g,x,y,w,d,h,col,{night:o.night,top:1.2});
  for(let i=0;i<5;i++){const t0=i/5,t1=(i+1)/5,p=t=>[x+w*t,y+d-d*t],a=p(t0),b=p(t1);
    el('polygon',{points:pp([[a[0],a[1]-h+5],[b[0],b[1]-h+5],[b[0]+1.5,b[1]-h+11],[a[0]+1.5,a[1]-h+11]]),fill:i%2?'#ffffff':'#e8463a',stroke:INK,'stroke-width':.8},g);}
  el('polygon',{points:pp([[x+3,y+d-3.5],[x+11,y+d-7.8],[x+11,y+d-15],[x+3,y+d-10.7]]),fill:o.night?'#ffd75e':'#bfe6ff',stroke:INK,'stroke-width':1},g);}
function tower(g,x,y,col,o={},h=70){box(g,x,y,12,7,h,col,{night:o.night,windows:true,top:1.3});
  el('rect',{x:x-3,y:y-h-12,width:6,height:6,fill:'#ff5a4e',stroke:INK,'stroke-width':1.2},g);}
function landmark(g,x,y,col,o={}){
  box(g,x,y,18,10,82,col,{night:o.night,windows:true,top:1.2});box(g,x,y-82,12,7,36,col,{night:o.night,windows:true,top:1.3});
  box(g,x,y-118,6.5,3.8,16,'#f4b400',{night:o.night,top:1.4});
  el('line',{x1:x,y1:y-134,x2:x,y2:y-164,stroke:INK,'stroke-width':2.4},g);el('rect',{x:x-3.5,y:y-170,width:7,height:7,fill:'#f4b400',stroke:INK,'stroke-width':1.4},g);
  el('polygon',{points:pp([[x,y-164],[x+20,y-159],[x,y-153]]),fill:'#f4b400',stroke:INK,'stroke-width':1.2},g);}
function drawStage(g,st,x,y,col,o){ if(st==='L')landmark(g,x,y,col,o);else if(st==='T')tower(g,x,y,col,o,o.big?78:56);else if(st==='S')shop(g,x,y,col,o);
  else if(st==='H')house(g,x,y,col,o);else if(st==='G')house(g,x,y,col,o,true);else tent(g,x,y,col,o);}
const HT = {L:175,T:94,S:32,H:44,t:46,G:40};

// ---------- tiers (rules shown in the Build path bar) ----------
const TIERS = [
  {k:'t',name:'Tent',note:'Just launched'},
  {k:'H',name:'House',note:'25+ holders'},
  {k:'S',name:'Shop',note:'100+ holders'},
  {k:'T',name:'Tower',note:'300+ holders'},
  {k:'L',name:'Landmark',note:'Most holders on the island'},
  {k:'G',name:'Ruins',note:'No transfers for 12 hours'}
];
function tierOf(t, ctx, leader) {
  const age = ctx.nowTs - t.ts, quiet = (ctx.latest - (t.lastBlock || t.block)) * ctx.spb;
  if (t.activityError) return 0;            // unknown activity: never shown as ruins or as grown
  if (age > 43200 && quiet > 43200) return 5;
  const h = window.FlapChain.holders(t);
  if (t === leader && h >= 300) return 4;
  return h >= 300 ? 3 : h >= 100 ? 2 : h >= 25 ? 1 : 0;
}

// ---------- static map: sea, land, island ----------
const gSea = el('g'), defs = el('defs', {}, gSea);
const lg = el('linearGradient', {id:'seam',x1:0,x2:1,y1:0,y2:0}, defs); const st1 = el('stop',{offset:'0'},lg), st2 = el('stop',{offset:'1'},lg);
const nightRect = el('rect',{x:0,y:0,width:700,height:1360}, gSea), seamRect = el('rect',{x:680,y:0,width:140,height:1360,fill:'url(#seam)'}, gSea);
const waves = [];
for (let i=0;i<220;i++){const x=rnd()*2400,y=20+rnd()*1330; waves.push([el('path',{d:`M${x},${y} h8 m4,0 h6`,'stroke-width':2.4,'stroke-linecap':'square'},gSea), x<720]);}
const stars = []; for (let i=0;i<70;i++){stars.push(el('rect',{x:rnd()*680,y:30+rnd()*1200,width:2.4,height:2.4,fill:'#fff',opacity:.35+rnd()*.5},gSea));}
const moon = el('g',{}, gSea); el('circle',{cx:560,cy:110,r:26,fill:'#f4efd8',stroke:INK,'stroke-width':2},moon);const moonCut=el('circle',{cx:572,cy:102,r:22},moon);

const lands = []; // {path, base, mkt, name}
const gSide = el('g'), gTop = el('g'), gTrees = el('g'), gLots = el('g');
const all = [...US.features.map(f=>({f,P:usP,asia:false})), ...ASIA.features.map(f=>({f,P:asP,asia:true}))];
for (const {f,P} of all) el('path',{d:pathOf(f,P,12),fill:'#8a6a43',stroke:INK,'stroke-width':1.6}, gSide);
for (const {f,P,asia} of all) { const d = DIST[f.properties.name]; const base = d ? d.col : (asia ? '#7fa35a' : '#a3c86a');
  lands.push({el: el('path',{d:pathOf(f,P),stroke:INK,'stroke-width':1.4,'stroke-linejoin':'round'}, gTop), base, mkt: d ? d.mkt : (asia ? 'HK' : 'US'), name: f.properties.name}); }
const centers = {};
for (const {f,P} of all) { const nm = f.properties.name, c = centroid(f,P); if (!c) continue;
  const a = ADJ[nm]; centers[nm] = a ? [c[0]+a[0], c[1]+a[1]] : c;
  if (DIST[nm]) continue;
  for(let i=0;i<3;i++){const x=c[0]+(rnd()-.5)*50,y=c[1]+(rnd()-.5)*26;el('ellipse',{cx:x,cy:y+3,rx:5,ry:2,fill:'#00000025'},gTrees);el('circle',{cx:x,cy:y-4,r:5,fill:'#4f8f3a',stroke:INK,'stroke-width':1.2},gTrees);} }
// plots: one lot per flap stock, no buildings until a token is verified as paired
const LOTS = [];
for (const nm of Object.keys(DIST)) { const c = centers[nm]; if (!c) continue; const lots = DIST[nm].lots, n = lots.length;
  const cols = n > 4 ? 3 : (n > 1 ? 2 : 1), rowsN = Math.ceil(n / cols);
  lots.forEach((s, i) => { const cx = (i % cols - (cols - 1) / 2) * 62, cy = (Math.floor(i / cols) - (rowsN - 1) / 2) * 44;
    const x = c[0] + cx, y = c[1] + cy - 8; LOTS.push({ s, land: nm, x, y, col: DIST[nm].col });
    poly(gLots, [[x-18,y],[x,y+9],[x+18,y],[x,y-9]], '#c9a56b');
    for (const [dx,dy] of [[-18,0],[18,0]]) el('rect',{x:x+dx-1.2,y:y+dy-9,width:2.4,height:9,fill:'#7a4e24',stroke:INK,'stroke-width':.8}, gLots); }); }
// New Arrivals island
const ISL = {cx:600, cy:1170, rx:440, ry:150};
const isl = []; for (let i=0;i<40;i++){const a=i/40*6.283,j=1+(rnd()-.5)*.1;isl.push([ISL.cx+Math.cos(a)*ISL.rx*j, ISL.cy+Math.sin(a)*ISL.ry*j]);}
el('polygon',{points:pp(isl.map(p=>[p[0],p[1]+14])),fill:'#8a6a43',stroke:INK,'stroke-width':1.6,'stroke-linejoin':'round'}, gSide);
el('polygon',{points:pp(isl.map(p=>[ISL.cx+(p[0]-ISL.cx)*1.04,ISL.cy+(p[1]-ISL.cy)*1.06])),fill:'#f0dfa6',stroke:INK,'stroke-width':1.6,'stroke-linejoin':'round'}, gTop);
el('polygon',{points:pp(isl),fill:'#a3c86a',stroke:INK,'stroke-width':1.4,'stroke-linejoin':'round'}, gTop);

const gDyn = el('g'); // everything data-driven lives here

// ---------- sky / day-night from real market hours ----------
function applySky() {
  const us = mstate('US'), hk = mstate('HK'), kr = mstate('KR');
  const left = hk.open ? '#2a6f97' : '#173a57', wl = hk.open ? '#4d92b9' : '#2b5577', wr = '#4d92b9';
  nightRect.setAttribute('fill', left); st1.setAttribute('stop-color', left); st2.setAttribute('stop-color', '#2a6f97');
  svg.parentNode.style.background = '#2a6f97';
  for (const [w, isLeft] of waves) w.setAttribute('stroke', isLeft ? wl : wr);
  stars.forEach(s => s.style.display = hk.open ? 'none' : ''); moon.style.display = hk.open ? 'none' : '';
  moonCut.setAttribute('fill', left);
  for (const L of lands) { const open = mstate(L.mkt).open; L.el.setAttribute('fill', open ? L.base : shade(L.base, .5)); }
  return {us, hk, kr};
}

// ---------- signs ----------
function sign(g0,x,y,text,fill,color,fs=16,font='Silk'){
  const g=el('g',{},g0), tw=text.length*fs*(font==='Silk'?0.86:0.42)+20;
  el('rect',{x:x-tw/2+3,y:y+3,width:tw,height:fs+12,fill:INK},g);el('rect',{x:x-tw/2,y,width:tw,height:fs+12,fill,stroke:INK,'stroke-width':2},g);
  const t=el('text',{x,y:y+fs+3,'text-anchor':'middle','font-size':fs,'font-family':font,'font-weight':700,fill:color},g);t.textContent=text;return g;}
function firework(g,x,y,col){for(let i=0;i<12;i++){const a=i/12*6.283;for(let j=1;j<=3;j++)el('rect',{x:x+Math.cos(a)*j*7-2,y:y+Math.sin(a)*j*7-2,width:4,height:4,fill:j===3?col:'#fff6c2'},g);}}

// ---------- dynamic render ----------
let STATE = { tokens: [], ctx: null, sel: null, selStock: null, status: 'loading' };
function lattice() {
  const pts = []; let r = 0;
  for (let y = ISL.cy - ISL.ry + 26; y < ISL.cy + ISL.ry - 14; y += 24, r++)
    for (let x = ISL.cx - ISL.rx + 40 + (r % 2 ? 24 : 0); x < ISL.cx + ISL.rx - 30; x += 48) {
      const u = (x-ISL.cx)/ISL.rx, v = (y-ISL.cy)/ISL.ry; if (u*u + v*v < 0.78) pts.push([x, y]);
    }
  return pts;
}
const LAT = lattice();
function render() {
  gDyn.replaceChildren();
  const sky = applySky(), {tokens, ctx} = STATE;
  // region + district signs
  for (const L of LOTS) { const open = mstate(DIST[L.land].mkt).open;
    const g = sign(gDyn, L.x, L.y + 8, L.s.t, '#fdfaf2', open ? '#16733a' : '#5b6475', 20, 'V');
    g.style.cursor = 'pointer'; g.setAttribute('tabindex', 0); g.setAttribute('role', 'button'); g.setAttribute('aria-label', L.s.t + ' district');
    g.addEventListener('click', () => selectStock(L.s.t)); g.addEventListener('keydown', e => { if (e.key === 'Enter') selectStock(L.s.t); });
    if (STATE.selStock === L.s.t) el('ellipse', {cx:L.x, cy:L.y, rx:30, ry:14, fill:'none', stroke:'#fff', 'stroke-width':3, 'stroke-dasharray':'6 4'}, gDyn); }
  sign(gDyn, 330, 190, sky.hk.open ? 'Asia, trading now' : 'Asia, night shift', sky.hk.open ? '#fdfaf2' : '#173a57', sky.hk.open ? INK : '#f4efd8', 20);
  sign(gDyn, 1330, 96, sky.us.open ? 'America, trading now' : 'America, market closed', sky.us.open ? '#fdfaf2' : '#173a57', sky.us.open ? INK : '#f4efd8', 20);
  sign(gDyn, ISL.cx, ISL.cy + ISL.ry + 14, 'New Arrivals', '#f4b400', INK, 20);
  if (!ctx || !tokens.length) { if (STATE.status === 'live') sign(gDyn, ISL.cx, ISL.cy - 10, 'No Stockz launches yet', '#fdfaf2', INK, 22, 'V'); return; }

  // sort: best first, put them at the back of the island
  let leader = null, lh = -1;
  for (const t of tokens) { const h = window.FlapChain.holders(t); if (h > lh) { lh = h; leader = t; } }
  const rows = tokens.map(t => ({ t, h: window.FlapChain.holders(t), tier: tierOf(t, ctx, leader) }));
  rows.forEach(r => r.t._tier = r.tier);
  const order = rows.slice().sort((a, b) => (b.tier === 5 ? -1 : b.tier) - (a.tier === 5 ? -1 : a.tier) || b.h - a.h);
  tokens.forEach(t => { t._onPlot = false; });
  const PLOT_OFF = [[-16,0],[16,0],[0,-8],[-30,-6],[30,-6],[0,8]], used = {}, placed = [], rest = [];
  for (const r of order) { const L = r.t.quote && LOTS.find(l => l.s.t === r.t.quote), n = L ? (used[L.s.t] || 0) : 99;
    if (L && n < 6) { used[L.s.t] = n + 1; r.t._onPlot = true; const o = PLOT_OFF[n]; placed.push({ ...r, plot: true, x: L.x + o[0], y: L.y + o[1] }); } else rest.push(r); }
  const pts = LAT.slice().sort((a, b) => a[1] - b[1] || Math.abs(a[0]-ISL.cx) - Math.abs(b[0]-ISL.cx));
  const items = placed.concat(rest.slice(0, pts.length).map((r, i) => ({ ...r, x: pts[i][0], y: pts[i][1] })));
  const night = !sky.us.open;
  items.sort((a, b) => a.y - b.y);
  const gP = el('g', {}, gDyn), gB = el('g', {}, gDyn), gF = el('g', {}, gDyn);
  let fw = 0;
  for (const it of items) {
    const col = PAL[parseInt(it.t.id.slice(2, 8), 16) % PAL.length], k = ('tHG'.includes(TIERS[it.tier].k) ? 1.3 : 1) * (it.plot ? .7 : 1);
    if (!it.plot) for (let q = 0; q < Math.min(4, Math.floor(it.h / 15)); q++) { const x = it.x + (q % 2 ? 22 : -22) + (q > 1 ? 6 : 0), y = it.y + 8 + (q > 1 ? 4 : 0);
      el('rect',{x:x-1.6,y:y-6,width:3.2,height:3.2,fill:'#ffd9b3',stroke:INK,'stroke-width':.6},gP);
      el('rect',{x:x-2,y:y-2.6,width:4,height:5,fill:['#2f6fdb','#f4b400','#2e9e4f','#e8463a','#ffffff'][q%5],stroke:INK,'stroke-width':.6},gP); }
    const g = el('g', {transform:`translate(${it.x},${it.y}) scale(${k}) translate(${-it.x},${-it.y})`, 'data-id': it.t.id, tabindex: 0, role: 'button', 'aria-label': `${it.t.name} ${TIERS[it.tier].name}`, style:'cursor:pointer'}, gB);
    drawStage(g, TIERS[it.tier].k, it.x, it.y, col, { night, big: false });
    el('title', {}, g).textContent = `${it.t.name} ($${it.t.symbol}) · ${TIERS[it.tier].name}`;
    g.addEventListener('click', () => select(it.t.id)); g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(it.t.id); } });
    if (it.t.recent > 0 && fw < 12) { firework(gF, it.x + 18, it.y - HT[TIERS[it.tier].k] * k - 14, ['#ff5a4e','#f4b400','#b26bff','#7bd13a'][fw % 4]); fw++; }
    it.t._pos = it;
  }
  const top = items.filter(i => i.tier !== 5 && !i.plot).sort((p, q) => q.h - p.h).slice(0, 1);
  top.forEach((it, i) => { sign(gDyn, it.x, it.y - HT[TIERS[it.tier].k] * 1.3 - 40, '♛ ' + it.t.name, '#f4b400', INK, 16); });
  if (STATE.sel) { const t = tokens.find(x => x.id === STATE.sel); if (t && t._pos) el('ellipse', {cx:t._pos.x, cy:t._pos.y + 6, rx:26, ry:11, fill:'none', stroke:'#fff', 'stroke-width':3, 'stroke-dasharray':'6 4'}, gDyn); }
}

// ---------- panels ----------
const short = a => a.slice(0, 6) + '…' + a.slice(-4);
function ago(sec) { sec = Math.max(0, sec); return sec < 90 ? Math.round(sec) + ' seconds ago' : sec < 5400 ? Math.round(sec / 60) + ' minutes ago' : Math.round(sec / 3600) + ' hours ago'; }
function select(id) {
  STATE.sel = id; STATE.selStock = null; render(); const t = STATE.tokens.find(x => x.id === id); if (!t) return;
  const h = window.FlapChain.holders(t), tier = TIERS[t._tier || 0];
  const age = STATE.ctx.nowTs - t.ts, last = t.lastBlock ? (STATE.ctx.latest - t.lastBlock) * STATE.ctx.spb : null;
  $('#selBody').innerHTML = `<div class="head"><div class="av">${esc(t.symbol.slice(0,2).toUpperCase())}</div><div><div class="nm">${tier.name}</div><div class="sub">${esc(t.name)} ($${esc(t.symbol)})</div></div></div>
   <div class="chips"><span class="chip g">${t._onPlot ? esc(t.quote) + " plot" : "New Arrivals island"}</span><span class="chip">${t.recent > 0 ? '🎆 active now' : (tier.k === 'G' ? '🕸️ quiet 24h+' : 'quiet')}</span></div>
   <div class="stats"><div>Residents (holders)<b>${t.activityError ? 'unavailable' : '≈ ' + h}</b></div><div>Transfers seen<b>${t.activityError ? 'unavailable' : t.transfers}</b></div>
   <div>Launched<b>${esc(ago(age))}</b></div><div>Last transfer<b>${t.activityError ? 'unavailable' : (last === null ? 'none yet' : esc(ago(last)))}</b></div>
   <div>Paired with<b>${t.quote ? esc(t.quote) : 'not detected'}</b></div><div>Creator<b>${esc(short(t.creator))}</b></div><div>Contract<b>${esc(short(t.token))}</b></div></div>
   <div class="acts"><a class="btn buy" href="${esc(C.explorer)}/token/${esc(t.token)}" target="_blank" rel="noopener noreferrer">BscScan</a></div>`;
  $('#sel .tb').textContent = `${t.name} ($${t.symbol})`;
}
function selectStock(t) {
  STATE.selStock = t; STATE.sel = null; render(); if (STATE.mode !== 'multi') modeFlap();
  const L = LOTS.find(l => l.s.t === t); if (!L) return; const s = L.s, mk = mstate(DIST[L.land].mkt);
  $('#sel .tb').textContent = s.t + ' district';
  $('#selBody').innerHTML = `<div class="head"><div class="av" style="background:${L.col}">${esc(s.t.slice(0,2).toUpperCase())}</div><div><div class="nm">${esc(s.t)}</div><div class="sub">${esc(s.n || 'Stock token')}</div></div></div>
   <div class="chips"><span class="chip g">Plot: ${esc(L.land)}</span><span class="chip">${mk.open ? '☀️ market open' : '🌙 market closed'}</span></div>
   <div class="stats"><div>Buildings on plot<b>${STATE.tokens.filter(x => x._onPlot && x.quote === s.t).length}</b></div><div>Paired tokens<b>${STATE.tokens.filter(x => x.quote === s.t).length}</b></div>${(() => { const v = (C.stockTokens || []).find(x => x.t === s.t); return v ? `<div style="grid-column:1/3">Contract<b>${esc(v.address)}</b></div>` : ''; })()}</div>
   <p class="sub">A token appears here when its creation transaction contains this stock's address. A plot shows up to 6 buildings; extra paired tokens stay on the New Arrivals island. Stocks without a known address cannot be detected yet.</p>`;
}
function focusStock(t) { const L = LOTS.find(l => l.s.t.toLowerCase() === t.toLowerCase()); if (!L) return; selectStock(L.s.t);
  setZoom(Math.max(zoom, .9), false); vp.scrollLeft = L.x * zoom - vp.clientWidth / 2; vp.scrollTop = (L.y - 60) * zoom - vp.clientHeight / 2; }
function modeFlap() {
  const t = STATE.selStock;
  $('#modeBody').innerHTML = `<div class="pickrow"><span>Stock</span><span class="stockchip${t ? '' : ' empty'}">${t ? esc(t) : 'Pick a plot'}</span></div>
   <button type="button" class="bigbtn" id="goSingle"><i>▶</i> Launch${t ? ' with ' + esc(t) : ''}</button>`;
  $('#goSingle').onclick = () => window.StockzLaunch.open({ mode: 'single', stocks: t ? [t] : [] });
}
function modeMulti() {
  const list = C.stockTokens || [];
  $('#modeBody').innerHTML = `<label class="allrow"><input type="checkbox" id="mAll"> All stocks <b>${list.length}</b></label><div class="pick">` +
   list.map((s, i) => `<label><input type="checkbox" class="mOne" value="${i}"> ${esc(s.t)}</label>`).join('') +
   `</div><button type="button" class="bigbtn" id="goMulti" disabled><i>▶</i> Pick stocks</button>`;
  const upd = () => { const n = document.querySelectorAll('.mOne:checked').length, b = $('#goMulti'); b.disabled = !n; b.innerHTML = n ? `<i>▶</i> Launch on ${n} stock${n > 1 ? 's' : ''}` : '<i>▶</i> Pick stocks'; };
  $('#mAll').onchange = e => { document.querySelectorAll('.mOne').forEach(x => x.checked = e.target.checked); upd(); };
  document.querySelectorAll('.mOne').forEach(x => x.onchange = () => { $('#mAll').checked = document.querySelectorAll('.mOne:checked').length === list.length; upd(); });
  $('#goMulti').onclick = () => window.StockzLaunch.open({ mode: 'multi', stocks: [...document.querySelectorAll('.mOne:checked')].map(x => list[+x.value].t) });
}
function setMode(m) { STATE.mode = m; $('#tabFlap').classList.toggle('on', m === 'flap'); $('#tabMulti').classList.toggle('on', m === 'multi');
  $('#tabFlap').setAttribute('aria-selected', m === 'flap'); $('#tabMulti').setAttribute('aria-selected', m === 'multi'); (m === 'flap' ? modeFlap : modeMulti)(); }
$('#tabFlap').onclick = () => setMode('flap'); $('#tabMulti').onclick = () => setMode('multi');
function renderFeed() {
  const { tokens, ctx } = STATE, f = $('#feed');
  if (!ctx || !tokens.length) { f.innerHTML = '<div class="row"><div class="t">' + (STATE.status === 'live' ? 'No launches yet. Tokens launched on Stockz appear here.' : 'Loading launches from BNB Chain…') + '</div></div>'; return; }
  // launches (a Multi-pair launch = same creator, name and ticker on several stocks, grouped into one line)
  const groups = new Map();
  for (const t of tokens) {
    const k = t.creator + '|' + t.name + '|' + t.symbol;
    const g = groups.get(k) || { name: t.name, symbol: t.symbol, stocks: [], ts: 0 };
    if (t.quote) g.stocks.push(t.quote); g.ts = Math.max(g.ts, t.ts); groups.set(k, g);
  }
  const ev = [];
  for (const g of groups.values()) {
    const s = ctx.nowTs - g.ts, n = g.stocks.length;
    ev.push({ s, ico: '🚀', txt: `${g.name} ($${g.symbol}) launched`, sub: `${n > 1 ? 'Multi-pair on ' + n + ' stocks' : n === 1 ? 'Paired with ' + g.stocks[0] : 'New Arrivals'} · ${ago(s)}` });
  }
  // landmark announcements
  for (const t of tokens) if (t._tier === 4) ev.push({ s: -1, ico: '👑', txt: `${t.name} is a Landmark!`, sub: `${t.quote ? t.quote + ' plot' : 'New Arrivals'} · most residents in the city` });
  ev.sort((a, b) => a.s - b.s);
  f.innerHTML = ev.slice(0, 6).map(e => `<div class="row"><div class="ico">${e.ico}</div><div class="t">${esc(e.txt)}<small>${esc(e.sub)}</small></div></div>`).join('');
}
function renderClocks() {
  const s = applySkyLite(); const SHORT = { US: 'NY', HK: 'HK', KR: 'SEL' };
  $('#clocks').innerHTML = ['US','HK','KR'].map(k => `<div class="clock" title="${MARKETS[k].n} ${s[k].open ? 'open' : 'closed'}"><span class="led" style="background:${s[k].open ? '#4cd964' : '#ff5a4e'}"></span><span class="cn">${MARKETS[k].n}</span><span class="cs">${SHORT[k]}</span> ${s[k].time}<span class="co"> ${s[k].open ? 'open' : 'closed'}</span></div>`).join('');
  $('#mkts').innerHTML = [['US','America (US stocks)'],['HK','Asia: China plots'],['KR','Asia: Korea plots']].map(([k,l]) => `<span>${s[k].open ? '☀️' : '🌙'}</span><span>${l}</span><span>${s[k].open ? 'open' : 'closed'}</span>`).join('');
}
const applySkyLite = () => ({ US: mstate('US'), HK: mstate('HK'), KR: mstate('KR') });

// ---------- toolbar (build path icons) ----------
{ const tb = $('#tools');
  TIERS.forEach((t, i) => { const d = document.createElement('div'); d.className = 'tool'; if (i === 5) d.style.background = '#b9bec5';
    const s = document.createElementNS(NS, 'svg'); s.setAttribute('width', 90); s.setAttribute('height', 70); d.appendChild(s);
    const g1 = document.createElementNS(NS, 'g'); s.appendChild(g1); const k = t.k === 'L' ? .38 : (t.k === 'T' ? .7 : 1.25);
    const g2 = document.createElementNS(NS, 'g'); g2.setAttribute('transform', `translate(45,62) scale(${k}) translate(-45,-62)`); g1.appendChild(g2);
    // draw into detached svg using el() with parent
    drawStage(g2, t.k, 45, 62, '#ffc61a', { big: false });
    d.insertAdjacentHTML('beforeend', `<b>${t.name}</b><span>${t.note}</span>`); tb.appendChild(d); }); }

// ---------- zoom / pan ----------
var vp = $('#viewport'); var zoom = 0.5;
function setZoom(z, keep = true) { const cx = (vp.scrollLeft + vp.clientWidth / 2) / (2000 * zoom), cy = (vp.scrollTop + vp.clientHeight / 2) / (1300 * zoom);
  zoom = Math.max(.3, Math.min(1.4, z)); svg.setAttribute('width', 2000 * zoom); svg.setAttribute('height', 1300 * zoom);
  if (keep) { vp.scrollLeft = cx * 2000 * zoom - vp.clientWidth / 2; vp.scrollTop = cy * 1300 * zoom - vp.clientHeight / 2; } }
$('#zin').onclick = () => setZoom(zoom * 1.2); $('#zout').onclick = () => setZoom(zoom / 1.2);
const PORTRAIT = innerWidth >= 900 && matchMedia('(max-aspect-ratio: 4/5)').matches;
zoom = innerWidth < 900 ? .5 : PORTRAIT ? Math.min(1.3, vp.clientWidth / 2000) : Math.max(.4, Math.min(1, (vp.clientWidth - 370) / 2000, vp.clientHeight / 1300)); setZoom(zoom, false);
// tall screens (e.g. a phone in desktop mode): shrink the stage to the map so there is no empty band below it
if (innerWidth >= 900 && !PORTRAIT) { const want = Math.max(620, Math.ceil(1300 * zoom) + 4); if (vp.clientHeight > want) $('#stage').style.height = want + 'px'; }
if (innerWidth < 900) { vp.scrollLeft = 1250 * zoom - vp.clientWidth / 2; vp.scrollTop = (560 - 60) * zoom - vp.clientHeight / 2; }
let drag = null;
vp.addEventListener('pointerdown', e => { if (e.target.closest('[data-id]')) return; drag = { x: e.clientX, y: e.clientY, l: vp.scrollLeft, t: vp.scrollTop }; vp.classList.add('drag'); vp.setPointerCapture(e.pointerId); });
vp.addEventListener('pointermove', e => { if (!drag) return; vp.scrollLeft = drag.l - (e.clientX - drag.x); vp.scrollTop = drag.t - (e.clientY - drag.y); });
const endDrag = () => { drag = null; vp.classList.remove('drag'); }; vp.addEventListener('pointerup', endDrag); vp.addEventListener('pointercancel', endDrag);

// ---------- search: custom pixel list, coloured like each stock's plot ----------
{ const inp = $('#find'), ul = $('#findList');
  const meta = t => { const L = LOTS.find(l => l.s.t === t); return L ? { col: L.col, land: L.land } : { col: '#cdd2d8', land: '' }; };
  let items = [], hi = -1;
  const draw = () => {
    const q = inp.value.trim().toLowerCase();
    items = STOCKS.filter(s => !q || s.t.toLowerCase().includes(q) || (s.n || '').toLowerCase().includes(q));
    hi = items.length ? 0 : -1;
    ul.innerHTML = items.length ? items.map((s, n) => { const m = meta(s.t); return `<li role="option" id="fo${n}" data-t="${esc(s.t)}" class="${n === hi ? 'hi' : ''}"><span class="sw" style="background:${m.col}"></span><b>${esc(s.t)}</b><small>${esc(s.n || '')}</small><em>${esc(m.land)}</em></li>`; }).join('') : '<li class="none">No stock found</li>';
    ul.hidden = false; inp.setAttribute('aria-expanded', 'true');
  };
  const mark = () => { ul.querySelectorAll('li[role=option]').forEach((li, n) => li.classList.toggle('hi', n === hi)); const el = $('#fo' + hi); if (el) { el.scrollIntoView({ block: 'nearest' }); inp.setAttribute('aria-activedescendant', el.id); } };
  const close = () => { ul.hidden = true; inp.setAttribute('aria-expanded', 'false'); };
  const pick = t => { inp.value = t; close(); focusStock(t); };
  inp.addEventListener('focus', draw); inp.addEventListener('input', draw);
  inp.addEventListener('keydown', e => {
    if (ul.hidden && (e.key === 'ArrowDown' || e.key === 'Enter')) { draw(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); hi = Math.min(items.length - 1, hi + 1); mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); hi = Math.max(0, hi - 1); mark(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[hi]) pick(items[hi].t); }
    else if (e.key === 'Escape') close();
  });
  ul.addEventListener('mousedown', e => { e.preventDefault(); const li = e.target.closest('li[data-t]'); if (li) pick(li.dataset.t); });
  inp.addEventListener('blur', () => setTimeout(close, 120)); }

// ---------- boot ----------
async function boot() {
  setMode('flap'); render(); renderFeed(); renderClocks();
  setInterval(() => { renderClocks(); render(); }, 60000);
  let ctx = null;
  for (;;) {
    try {
      ctx = await window.FlapChain.init(); STATE.ctx = ctx;
      STATE.tokens = await window.FlapChain.loadTokens(ctx, tokens => { STATE.tokens = tokens; render(); renderFeed(); });
      STATE.status = 'live'; render(); renderFeed(); break;
    } catch (e) { console.warn('[Stockz] chain read failed, retrying in 20s:', e && e.message); await new Promise(r => setTimeout(r, 20000)); }
  }
  let busy = false;
  const tick = async () => {
    if (busy) return; busy = true;
    try { STATE.tokens = await window.FlapChain.refresh(ctx, STATE.tokens); render(); renderFeed(); }
    catch (e) { console.warn('[Stockz] refresh failed, will retry:', e && e.message); }
    finally { busy = false; }
  };
  setInterval(tick, 60000);
  window.addEventListener('stockz:launched', () => setTimeout(tick, 4000));
}
boot();
})();
