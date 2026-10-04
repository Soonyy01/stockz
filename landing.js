(() => {
const $ = s => document.querySelector(s);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
let pageStarted = false;
const PAL = ['#7fb8ff', '#5fd38d', '#ffd166', '#ff7b8a', '#c6f06a', '#ff7461', '#d7a6ff', '#62e0ef', '#ffa25a', '#f19bff', '#a9b4ff', '#6fe3cf'];
const STOCKS = (window.FLAP_STOCKS || []).map(s => s.t);

// one building, anchored at (x,y) on the ground; tents/houses are drawn a bit bigger like on the map
function building(parent, st, x, y, col, opt = {}) {
  const k = (opt.k || 1) * ('tHG'.includes(st) ? 1.3 : 1);
  const g = el('g', { transform: `translate(${x},${y}) scale(${k}) translate(${-x},${-y})` }, parent);
  drawStage(g, st, x, y, col, { night: !!opt.night, big: !!opt.big });
  return g;
}
function plot(parent, x, y, w, h, fill = '#c9a56b') {
  el('polygon', { points: pp([[x - w, y + 6], [x, y + h + 6], [x + w, y + 6], [x, y - h + 6]]), fill: '#8a6a43', stroke: INK, 'stroke-width': 1.4 }, parent);
  el('polygon', { points: pp([[x - w, y], [x, y + h], [x + w, y], [x, y - h]]), fill, stroke: INK, 'stroke-width': 1.4 }, parent);
}
function sign(parent, x, y, text, fill = '#f4b400', color = INK, fs = 11) {
  const w = text.length * fs * 0.62 + 14, g = el('g', {}, parent);
  el('rect', { x: x - w / 2 + 2, y: y + 2, width: w, height: fs + 9, fill: INK }, g);
  el('rect', { x: x - w / 2, y, width: w, height: fs + 9, fill, stroke: INK, 'stroke-width': 1.5 }, g);
  const t = el('text', { x, y: y + fs + 2, 'text-anchor': 'middle', 'font-size': fs, 'font-family': 'Silk', fill: color }, g); t.textContent = text;
  return g;
}

// ---------- intro ----------
(function intro() {
  const box = $('#intro'); if (!box) return;
  let seen = false; try { seen = sessionStorage.getItem('stz-intro') === '1'; } catch {}
  if (reduce || seen) { box.remove(); startPage(); return; }
  box.hidden = false;
  document.body.classList.add('lock');
  const svg = $('#inCity');
  el('rect', { x: 0, y: 128, width: 420, height: 22, fill: '#2b2f45' }, svg);
  el('rect', { x: 0, y: 126, width: 420, height: 3, fill: '#f4b400' }, svg);
  const row = [['t', '#ff9fb2'], ['H', '#62e0ef'], ['S', '#ff7461'], ['T', '#7fb8ff'], ['L', '#ffc61a'], ['T', '#5fd38d'], ['S', '#d7a6ff'], ['H', '#ffd166']];
  row.forEach(([st, col], i) => {
    const w = el('g', { class: 'rise', style: `animation-delay:${0.15 + i * 0.22}s` }, svg);
    building(w, st, 30 + i * 52, 127, col, { night: true, k: st === 'L' ? 0.62 : st === 'T' ? 0.85 : 1 });
  });
  const fill = $('#inFill'), txt = $('#inTxt');
  requestAnimationFrame(() => { fill.style.width = '100%'; });
  const steps = [[900, 'CONNECTING TO BNB CHAIN…'], [1800, 'RAISING BUILDINGS…'], [2500, 'READY']];
  const timers = steps.map(([t, s]) => setTimeout(() => { txt.textContent = s; }, t));
  let done = false;
  const end = () => {
    if (done) return; done = true; timers.forEach(clearTimeout);
    try { sessionStorage.setItem('stz-intro', '1'); } catch {}
    box.classList.add('out'); document.body.classList.remove('lock');
    setTimeout(() => box.remove(), 600); startPage();
  };
  setTimeout(end, 3000); $('#inSkip').onclick = end;
  document.addEventListener('keydown', e => { if (e.key === 'Escape' || e.key === 'Enter') end(); }, { once: true });
})();

// ---------- hero city ----------
function heroCity() {
  const svg = $('#heroCity'); if (!svg) return;
  const defs = el('defs', {}, svg), lg = el('linearGradient', { id: 'sky', x1: 0, x2: 0, y1: 0, y2: 1 }, defs);
  el('stop', { offset: '0', 'stop-color': '#173a57' }, lg); el('stop', { offset: '1', 'stop-color': '#2a6f97' }, lg);
  el('rect', { x: 0, y: 0, width: 560, height: 360, fill: 'url(#sky)' }, svg);
  for (let i = 0; i < 40; i++) el('rect', { x: (i * 137) % 560, y: (i * 53) % 150, width: 2.5, height: 2.5, fill: '#fff', class: 'twinkle', style: `animation-delay:${(i % 7) * 0.4}s` }, svg);
  el('circle', { cx: 500, cy: 48, r: 20, fill: '#f4efd8', stroke: INK, 'stroke-width': 2 }, svg); el('circle', { cx: 509, cy: 42, r: 17, fill: '#1c4766' }, svg);
  // island
  el('polygon', { points: pp([[30, 272], [280, 177], [530, 272], [280, 367]]), fill: '#8a6a43', stroke: INK, 'stroke-width': 1.6 }, svg);
  el('polygon', { points: pp([[30, 260], [280, 165], [530, 260], [280, 355]]), fill: '#a3c86a', stroke: INK, 'stroke-width': 1.6 }, svg);
  const spots = [[280, 205, 'L', '#ffc61a', 1, true], [200, 232, 'T', '#7fb8ff', 1, true], [360, 232, 'T', '#5fd38d', 1, false], [130, 262, 'S', '#ff7461'], [430, 262, 'S', '#d7a6ff'],
    [250, 270, 'H', '#62e0ef'], [318, 282, 'H', '#ffd166'], [190, 300, 't', '#ff9fb2'], [392, 300, 't', '#a9b4ff'], [282, 324, 'S', '#c6f06a']];
  const gB = el('g', {}, svg), tops = [];
  spots.forEach(([x, y, st, col, k, big], i) => {
    plot(gB, x, y + 4, 26, 12, '#c9a56b');
    const w = el('g', { class: 'rise', style: `animation-delay:${0.2 + i * 0.12}s` }, gB);
    building(w, st, x, y, col, { night: true, big });
    tops.push([x, y - (st === 'L' ? 175 : st === 'T' ? (big ? 94 : 72) : 50)]);
  });
  sign(svg, 280, 0 + 14, '♛ YOUR TOKEN HERE', '#f4b400', INK, 11);
  // blinking windows
  const lit = [...svg.querySelectorAll('polygon')].filter(p => ['#ffd75e', '#2a2f45'].includes(p.getAttribute('fill')));
  if (!reduce) setInterval(() => { for (let n = 0; n < 6; n++) { const p = lit[Math.floor(Math.random() * lit.length)]; if (p) p.setAttribute('fill', p.getAttribute('fill') === '#ffd75e' ? '#2a2f45' : '#ffd75e'); } }, 450);
  // fireworks
  const fw = (x, y, col) => { const g = el('g', { class: 'fw' }, svg);
    for (let i = 0; i < 12; i++) { const a = i / 12 * 6.283; for (let j = 1; j <= 3; j++) el('rect', { x: x + Math.cos(a) * j * 7 - 2, y: y + Math.sin(a) * j * 7 - 2, width: 4, height: 4, fill: j === 3 ? col : '#fff6c2' }, g); }
    setTimeout(() => g.remove(), 1500); };
  if (!reduce) setInterval(() => { const [x, y] = tops[Math.floor(Math.random() * tops.length)]; fw(x + (Math.random() * 30 - 15), Math.max(30, y - 22), PAL[Math.floor(Math.random() * PAL.length)]); }, 1300);
}

// ---------- rotating ticker word ----------
function swapWord() {
  const w = $('#swap'); if (!w || reduce) return;
  const list = ['TSLAB', 'NVDAB', 'QQQB', 'AAPLB', 'SPYB', 'MSFTB', 'GOOGLB', 'METAB', 'AMZNB']; let i = 0;
  setInterval(() => { i = (i + 1) % list.length; w.classList.remove('flip'); void w.offsetWidth; w.textContent = list[i]; w.classList.add('flip'); }, 1700);
}

// ---------- LED tape ----------
function tape() {
  const t = $('#tape'); if (!t || !STOCKS.length) return;
  const one = STOCKS.map((s, i) => `<span><i style="background:${PAL[i % PAL.length]}"></i>${s}</span>`).join('');
  t.innerHTML = one + one;
}

// ---------- section art ----------
function art() {
  document.querySelectorAll('.plotsvg').forEach((svg, i) => {
    plot(svg, 60, 92, 46, 16, '#c9a56b');
    const st = svg.dataset.st;
    building(svg, st, 60, 90, ['#ff9fb2', '#d7a6ff', '#ffc61a'][i % 3], { k: st === 'L' ? 0.48 : 1.7 });
  });
  const one = $('#vsOne'); if (one) { plot(one, 110, 110, 46, 16, '#ff7461'); building(one, 'T', 110, 108, '#ffc61a', { big: true }); sign(one, 110, 2, 'TSLAB', '#fdfaf2'); }
  const many = $('#vsMany'); if (many) {
    [['#ff7461', 'TSLAB'], ['#5fd38d', 'NVDAB'], ['#d7a6ff', 'QQQB'], ['#c9cfd6', 'AAPLB']].forEach(([c, t], i) => {
      const x = 32 + i * 52; plot(many, x, 112, 24, 9, c); building(many, 'T', x, 110, '#ffc61a', { k: 0.8 }); sign(many, x, 118 - 118 + 2 + (i % 2) * 20, t, '#fdfaf2', INK, 8);
    });
  }
}

// ---------- evolution ----------
function evolution() {
  const svg = $('#evoBig'); if (!svg) return;
  const STAGES = [['t', 'TENT', 'Just launched'], ['H', 'HOUSE', '25+ holders'], ['S', 'SHOP', '100+ holders'], ['T', 'TOWER', '300+ holders'], ['L', 'LANDMARK', 'Most holders in the city'], ['G', 'RUINS', 'No trades for 12 hours']];
  const steps = [...document.querySelectorAll('#evoSteps li')];
  let i = 0;
  const show = () => {
    svg.replaceChildren(); plot(svg, 110, 196, 80, 26, '#a3c86a');
    const [st, name, rule] = STAGES[i], k = st === 'L' ? 0.95 : st === 'T' ? 1.6 : 2.2;
    const w = el('g', { class: 'pop' }, svg); building(w, st, 110, 194, '#ffc61a', { k, big: st === 'T' });
    $('#evoName').textContent = name; $('#evoRule').textContent = rule;
    steps.forEach((s, n) => s.classList.toggle('on', n === i));
  };
  show();
  steps.forEach((s, n) => s.addEventListener('click', () => { i = n; show(); }));
  if (!reduce) setInterval(() => { i = (i + 1) % STAGES.length; show(); }, 1600);
}

// ---------- terminal ----------
function terminal() {
  const out = $('#termOut'); if (!out) return;
  const lines = ['> wallet.sign()       you sign every transaction', '> launch.simulate()   tested before your wallet opens', '> approve(exact)      never unlimited', '> private.keys        never stored by Stockz', '> status              SAFE ✓'];
  const full = lines.join('\n');
  if (reduce) { out.textContent = full; return; }
  let started = false;
  const io = new IntersectionObserver(es => { if (started || !es.some(e => e.isIntersecting)) return; started = true; io.disconnect();
    let n = 0; const tick = () => { out.textContent = full.slice(0, n) + (n < full.length ? '█' : ''); if (n++ < full.length) setTimeout(tick, full[n - 1] === '\n' ? 180 : 18); }; tick(); }, { threshold: .4 });
  io.observe(out);
}

// ---------- reveal on scroll ----------
function reveal() {
  const items = document.querySelectorAll('.reveal');
  if (reduce || !('IntersectionObserver' in window)) { items.forEach(x => x.classList.add('in')); return; }
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .15 });
  items.forEach(x => io.observe(x));
}

function startPage() { if (pageStarted) return; pageStarted = true; heroCity(); swapWord(); }
tape(); art(); evolution(); terminal(); reveal();
if (!document.getElementById('intro')) startPage();
})();
