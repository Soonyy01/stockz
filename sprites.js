// Pixel sprite library shared with the map (same drawings).
const NS = 'http://www.w3.org/2000/svg', INK = '#1d1a16';
function el(t, a, parent) { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); parent.appendChild(e); return e; }
function shade(hex, f) { const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = n >> 8 & 255, b = n & 255;
  r = Math.min(255, Math.round(r * f)); g = Math.min(255, Math.round(g * f)); b = Math.min(255, Math.round(b * f)); return `rgb(${r},${g},${b})`; }
const pp = a => a.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ');
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
