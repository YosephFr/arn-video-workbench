'use strict';
// Word-synced captions, for the many people who watch without sound. Each line of the timeline is cut into short
// chunks; inside a chunk every word fades and rises in on its own timestamp, and *emphasis* takes the accent colour.
//
// cfg: { y, size, maxWords, style: 'band' | 'pill', skip: [line ids], replace: { 'spoken words': 'shown text' },
//        icons: { word: image } (an icon drawn before that word, e.g. a logo you are licensed to show) }
// `replace` turns spoken numbers into figures: { 'four hundred forty dollars': '$440' }. Keys of several words
// match consecutive words; the punctuation of the last word is kept.
const { clamp, ease } = require('./math');
const { rr } = require('./device');

const bare = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9$%]/g, '');

function chunks(tl, cfg) {
  const REPL = cfg.replace || {}; const maxWords = cfg.maxWords || (cfg.style === 'pill' ? 4 : 9);
  const single = {}; for (const [k, v] of Object.entries(REPL)) if (!k.trim().includes(' ')) single[bare(k)] = v;
  const phrases = Object.keys(REPL).filter((k) => k.trim().includes(' ')).map((k) => ({ k: k.trim().split(/\s+/).map(bare), v: REPL[k] })).sort((a, b) => b.k.length - a.k.length);
  const items = [];
  for (const line of tl.lines) {
    if (line.caption === false || (cfg.skip && cfg.skip.includes(line.id))) continue;
    const ws = [];
    for (let i = 0; i < line.words.length; i++) {
      const f = phrases.find((q) => q.k.every((x, j) => line.words[i + j] && bare(line.words[i + j].text) === x));
      if (!f) { const w = line.words[i]; const p = (w.text.match(/[.,;:!?…]+$/) || [''])[0]; const rep = single[bare(w.text)]; ws.push({ ...w, text: rep ? rep + p : w.text }); continue; }
      const last = line.words[i + f.k.length - 1]; const punct = (last.text.match(/[.,;:!?…]+$/) || [''])[0];
      ws.push({ text: f.v + punct, start: line.words[i].start, end: last.end, hot: line.words.slice(i, i + f.k.length).some((x) => x.hot) });
      i += f.k.length - 1;
    }
    let cur = [];
    const flush = () => { if (cur.length) items.push({ line: line.id, words: cur, t0: cur[0].t - 0.08, end: cur[cur.length - 1].end }); cur = []; };
    ws.forEach((w, i) => {
      cur.push({ w: w.text, t: w.start, end: w.end, hot: !!w.hot });
      const strong = /[.!?…:]$/.test(w.text); const soft = /[,;]$/.test(w.text) && cur.length >= (cfg.style === 'pill' ? 3 : 5);
      if (strong || soft || cur.length >= maxWords || i === ws.length - 1) flush();
    });
  }
  // A chunk stays until the next one arrives, at most `hold` seconds after its last word.
  const hold = cfg.hold ?? (cfg.style === 'pill' ? 0.5 : 1.2);
  items.forEach((it, k) => { const nx = items[k + 1]; it.t1 = nx ? Math.min(nx.t0, it.end + hold) : it.end + (cfg.style === 'pill' ? hold : 1.0); });
  return items;
}

function makeCaptions(tl, brand, cfg = {}) {
  if (cfg === false) return { draw() {}, box: () => null, items: [] };
  const C = brand.C; const items = chunks(tl, cfg); const layouts = new Map(); const icons = cfg.iconImages || {};
  const size0 = cfg.size || (cfg.style === 'pill' ? 56 : 54); const yC = cfg.y || 372; const maxW = cfg.maxWidth || 930;
  const iconFor = (w) => icons[bare(w)] || null;

  function layout(ctx, it) {
    const key = it.line + it.t0; if (layouts.has(key)) return layouts.get(key);
    let size = size0; let L;
    for (;;) {   // shrink until it fits in two rows (band) or one (pill)
      ctx.save(); ctx.font = brand.font(cfg.weight || 700, size); const sp = ctx.measureText(' ').width; const lg = size * 1.12;
      const ws = it.words.map((w) => ({ ...w, icon: iconFor(w.w), width: ctx.measureText(w.w).width + (iconFor(w.w) ? lg : 0) }));
      const rows = []; let row = [], rw = 0;
      ws.forEach((w) => { const add = (row.length ? sp : 0) + w.width; if (rw + add > maxW && row.length) { rows.push({ ws: row, w: rw }); row = []; rw = 0; } rw += (row.length ? sp : 0) + w.width; row.push(w); });
      if (row.length) rows.push({ ws: row, w: rw });
      if (rows.length === 2 && rows[1].ws.length === 1 && rows[0].ws.length > 2) { const mv = rows[0].ws.pop(); rows[0].w -= mv.width + sp; rows[1].ws.unshift(mv); rows[1].w += mv.width + sp; }   // no orphan
      ctx.restore(); L = { rows, sp, lg, size };
      const limit = cfg.style === 'pill' ? 1 : 2;
      if (rows.length <= limit || size <= 38) break;
      size -= 2;
    }
    layouts.set(key, L); return L;
  }

  function draw(ctx, t) {
    const it = items.find((x) => t >= x.t0 && t < x.t1 + 0.16); if (!it) return;
    const L = layout(ctx, it); const lh = L.size * 1.22; const out = 1 - clamp((t - it.t1) / 0.16);
    ctx.save(); ctx.font = brand.font(cfg.weight || 700, L.size); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    const y0 = yC - ((L.rows.length - 1) * lh) / 2;
    if (cfg.style === 'pill') {   // a soft pill behind the chunk
      const w = Math.max(...L.rows.map((r) => r.w)) + 64, h = L.rows.length * lh + 30;
      ctx.globalAlpha = clamp((t - it.t0) / 0.1) * out * (cfg.pillAlpha ?? 0.94); ctx.fillStyle = cfg.pill || C.surface;
      rr(ctx, 540 - w / 2, yC - h / 2, w, h, Math.min(h / 2, 48)); ctx.fill();
    }
    L.rows.forEach((r, ri) => {
      let x = 540 - r.w / 2; const y = y0 + ri * lh;
      r.ws.forEach((w) => {
        const a = ease.outCubic(clamp((t - (w.t - 0.05)) / 0.16));
        if (a > 0) {
          ctx.globalAlpha = a * out; const dy = (1 - a) * 12; let xx = x;
          if (w.icon) { const s = L.size * 0.92; const k = s / Math.max(w.icon.width, w.icon.height); ctx.drawImage(w.icon, xx + L.size * 0.45 - (w.icon.width * k) / 2, y + dy - 2 - (w.icon.height * k) / 2, w.icon.width * k, w.icon.height * k); xx += L.lg; }
          ctx.fillStyle = w.hot ? (cfg.hot || C.accentText) : (cfg.color || C.ink); ctx.fillText(w.w, xx, y + dy);
        }
        x += w.width + L.sp;
      });
    });
    ctx.restore();
  }

  // The band the captions can occupy (two rows), for zone checks.
  const box = () => ({ y0: yC - size0 * 1.22, y1: yC + size0 * 1.22 });
  return { draw, box, items };
}

module.exports = { makeCaptions, chunks, bare };
