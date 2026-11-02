// The 2D layer drawn over the 3D frame: subtitles, title cards, fact cards for the frozen beat, full-frame inserts and
// the poster card. It is a separate canvas so the HDR grade can map it at a fixed UI white (text never glares) while
// the 3D scene gets the highlight expansion.
// Text rules: minimal and plain. Subtitles are static white with a thin dark outline and a soft shadow (readable on any
// background), near the speaker in the middle-upper band; no karaoke. Titles go in a centred white box. Nothing names
// the frozen beat, and fact cards carry no numbering.
import { drawBackground, drawPost, drawChart, drawNumber, drawImage, particleField, roundRect } from './tv.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const sm = (a, b, x) => { const u = clamp((x - a)/(b - a), 0, 1); return u*u*(3 - 2*u); };
const eo = u => 1 - Math.pow(1 - clamp(u, 0, 1), 3);

export function makeUI(canvas, { W, H, plan, brand, fonts, images }){
  const cx = canvas.getContext('2d');
  const k = W/1080;                                    // all layout is designed on the 1080 x 1920 grid
  const B = brand.colors, F = fonts, R = (brand.radius ?? 28)*k;
  const SS = { size:62, weight:700, color:'#ffffff', outline:'#0a0c12', outline_px:3, shadow:0.55, emphasis:true, max_width:900, ...(plan.sub_style || {}) };
  // emphasis colour: the brand accent, lightened until it reads over a dark outline on a night set (any brand colour works)
  const EMPH = (() => { const hex2 = h => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16)/255);
    const lum = c => c.map(v => v <= 0.04045 ? v/12.92 : ((v + 0.055)/1.055)**2.4).reduce((a, v, k) => a + v*[0.2126, 0.7152, 0.0722][k], 0);
    let c = hex2(SS.emphasis_color || B.accent);
    for (let k = 0; k < 10 && lum(c) < 0.42; k++) c = c.map(v => v + (1 - v)*0.18);
    return '#' + c.map(v => Math.round(v*255).toString(16).padStart(2, '0')).join(''); })();
  const subs = plan.subs || [], titles = plan.titles || [], P = plan.pause, inserts = plan.inserts || [];
  const cards = P?.cards || [];
  const IMG = {};
  for (const [key, url] of Object.entries(images || {})){ const im = new Image(); im.src = url; IMG[key] = im; }

  // ---- text helpers (rich lines: "<em>word</em>" marks the keyword in the accent colour)
  const font = (size, weight, fam) => `${weight} ${size}px ${fam}`;
  function runs(line){ const out = []; const re = /<em>(.*?)<\/em>/g; let last = 0, m;
    while ((m = re.exec(line))){ if (m.index > last) out.push({ t:line.slice(last, m.index), em:false }); out.push({ t:m[1], em:true }); last = re.lastIndex; }
    if (last < line.length) out.push({ t:line.slice(last), em:false }); return out; }
  const plain = line => line.replace(/<\/?em>/g, '');
  function wrapWords(words, maxW){                       // greedy, then balanced when it takes two lines
    const L = [[]]; const wOf = ws => cx.measureText(ws.map(w => w.t).join(' ')).width;
    for (const w of words){ const cur = L[L.length - 1]; if (!cur.length || wOf([...cur, w]) <= maxW) cur.push(w); else L.push([w]); }
    if (L.length === 2){ const all = [...L[0], ...L[1]]; let best = 1, bw = 1e9;
      for (let i = 1; i < all.length; i++){ const m = Math.max(wOf(all.slice(0, i)), wOf(all.slice(i))); if (m < bw){ bw = m; best = i; } }
      return [all.slice(0, best), all.slice(best)]; }
    return L;
  }

  // ---- subtitles
  function subtitleLayout(s){
    const size = SS.size*k; cx.font = font(size, SS.weight, F.body);
    const words = s.words || s.text.split(/\s+/).map(t => ({ t, em:false }));
    const L = wrapWords(words, SS.max_width*k);
    const lh = size*1.18, h = lh*L.length;
    return { L, size, lh, h };
  }
  function drawSubtitle(s, alpha){
    const { L, size, lh, h } = subtitleLayout(s);
    let y0 = s.y*H - h/2;
    for (const c of activeCards){ if (y0 < c.y1 + 18*k && y0 + h > c.y0 - 18*k) y0 = c.y1 + 24*k; }   // never under or over a card
    cx.save(); cx.globalAlpha = alpha; cx.textBaseline = 'top'; cx.lineJoin = 'round'; cx.font = font(size, SS.weight, F.body);
    L.forEach((ws, i) => {
      const text = ws.map(w => w.t).join(' '), tw = cx.measureText(text).width;
      let x = s.x*W - tw/2; const y = y0 + i*lh;
      cx.shadowColor = `rgba(0,0,0,${SS.shadow})`; cx.shadowBlur = 16*k; cx.shadowOffsetY = 4*k;
      cx.lineWidth = SS.outline_px*2*k; cx.strokeStyle = SS.outline; cx.strokeText(text, x, y);
      cx.shadowColor = 'transparent';
      for (const [j, w] of ws.entries()){ const piece = w.t + (j < ws.length - 1 ? ' ' : '');
        cx.fillStyle = w.em && SS.emphasis ? EMPH : SS.color; cx.fillText(piece, x, y); x += cx.measureText(piece).width; }
    });
    cx.restore();
  }

  // ---- white title box, centred, text centred (display font, keyword in the accent colour)
  function boxLayout(lines, maxSize, minSize, boxW){
    let size = maxSize*k; const pad = 56*k;
    const fits = () => { cx.font = font(size, 850, F.display); return lines.every(l => cx.measureText(plain(l)).width <= boxW - 2*pad); };
    while (!fits() && size > minSize*k) size -= 2*k;
    return { size, pad, h:lines.length*size*1.08 + 2*48*k };
  }
  function drawBox(lines, cxp, cyp, boxW, maxSize, alpha, scale, opts = {}){
    const { size, pad, h } = boxLayout(lines, maxSize, opts.min || 44, boxW);
    cx.save(); cx.globalAlpha = alpha; cx.translate(cxp, cyp); cx.scale(scale, scale);
    cx.shadowColor = 'rgba(0,0,0,0.45)'; cx.shadowBlur = 60*k; cx.shadowOffsetY = 22*k;
    roundRect(cx, -boxW/2, -h/2, boxW, h, opts.radius ?? R); cx.fillStyle = opts.paper || B.surface || '#ffffff'; cx.fill();
    cx.shadowColor = 'transparent'; cx.textBaseline = 'middle'; cx.font = font(size, 850, F.display);
    lines.forEach((l, i) => {
      const rs = runs(l), tw = rs.reduce((a, r) => a + cx.measureText(r.t).width, 0);
      let x = -tw/2; const y = -h/2 + 48*k + size*1.08*(i + 0.5);
      for (const r of rs){ cx.fillStyle = r.em ? B.accent : (opts.ink || B.ink); cx.fillText(r.t, x, y); x += cx.measureText(r.t).width; }
    });
    cx.restore();
    return { y0:cyp - h/2, y1:cyp + h/2 };
  }

  // ---- inserts: full frame, grown out of the TV (scale from zfrom), then held; cross-fade between items
  const P0 = particleField(7);
  const panel = document.createElement('canvas'); panel.width = 2048; panel.height = 879; const pcx = panel.getContext('2d');
  function drawInsert(ins, t){
    const seq = ins.seq.filter(q => q.t <= t + 1e-6); const item = (seq.length ? seq[seq.length - 1] : ins.seq[0]);
    const u = clamp((t - ins.t0)/(ins.zin || 0.45), 0, 1), out = ins.zout ? clamp((ins.t1 - t)/ins.zout, 0, 1) : 1, e = eo(Math.min(u, out));
    const sc = (ins.zfrom ?? 0.3) + (1 - (ins.zfrom ?? 0.3))*e, a = Math.min(1, Math.min(u, out)*1.6);
    if (a <= 0) return;
    cx.save(); cx.globalAlpha = a; cx.translate(W/2, H*(ins.cy ?? 0.5)); cx.scale(sc, sc); cx.translate(-W/2, -H/2);
    drawBackground(cx, W, H, t, P0, B.accent);
    pcx.clearRect(0, 0, 2048, 879);
    if (item.kind === 'image' && IMG[item.image]?.complete) drawImage(pcx, 2048, 879, IMG[item.image]);
    else if (item.kind === 'post') drawPost(pcx, 2048, 879, item, B, F);
    else if (item.kind === 'chart') drawChart(pcx, 2048, 879, item, B, F, t, ins.t0);
    else if (item.kind === 'number') drawNumber(pcx, 2048, 879, item, B, F);
    const pw = W*0.98, ph = pw*879/2048; cx.drawImage(panel, (W - pw)/2, H*0.46 - ph/2, pw, ph);
    cx.restore();
  }

  let activeCards = [];
  return {
    draw(t, mode = 'video'){
      cx.clearRect(0, 0, W, H);
      activeCards = [];
      if (mode === 'poster'){
        const pc = plan.poster || {}; const lines = pc.title || ['Your title', 'in <em>two</em> lines'];
        drawBox(lines, W/2, H*(pc.y ?? 0.5), 880*k, 104, 1, 1, { min:72, radius:40*k });
        return;
      }
      for (const ins of inserts) if (t >= ins.t0 && t < ins.t1) drawInsert(ins, t);
      for (const T of titles){                              // title cards
        if (t < T.t0 - 0.01 || t >= T.t1 + 0.2) continue;
        const opens = T.t0 <= 0.001;                         // a title that opens the piece is there from frame 0 (the hook)
        const a = (opens ? 1 : sm(T.t0, T.t0 + 0.18, t))*(1 - sm(T.t1, T.t1 + 0.2, t)), s = opens ? 1 : 0.94 + 0.06*eo((t - T.t0)/0.25);
        const r = drawBox(T.lines, W/2, H*(T.y ?? 0.2), (T.w ?? 880)*k, T.size ?? 84, a, s);
        activeCards.push(r);
      }
      for (const c of cards){                               // fact cards of the frozen beat: no label, no numbers
        if (t < c.t0 - 0.01 || t >= c.t1 + 0.22) continue;
        const e = eo((t - c.t0)/0.25), o = sm(c.t1, c.t1 + 0.22, t), a = Math.min(1, e)*(1 - o);
        if (a <= 0) continue;
        const r = drawBox(c.lines, W/2, H*(c.y ?? 0.22) + 50*k*(1 - e) - 40*k*o, (c.w ?? 880)*k, c.size ?? 60, a, 1, { paper:'#f6f4ee', ink:'#101218', min:40 });
        activeCards.push(r);
      }
      let cur = null;                                      // one subtitle at a time: the latest that has started
      for (const s of subs) if (t >= s.t0 && t < s.t1) cur = s;
      if (cur && !cards.some(c => (c.covers || []).includes(cur.line) && t >= c.t0 - 0.02 && t < c.t1 + 0.24)){   // hidden while a card covers its line
        const ins = inserts.find(i => t >= i.t0 && t < i.t1);
        const a = ins ? clamp((t - ins.t0 - (ins.zin || 0.45))/0.15, 0, 1) : 1;   // after an insert's growth
        if (a > 0) drawSubtitle(cur, a);
      }
    },
  };
}
