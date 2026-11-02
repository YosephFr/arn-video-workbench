'use strict';
// Captions for muted viewing: the spoken lines in short chunks, each word arriving on its own timestamp.
// They stay inside the vertical-video safe zone (y 250–1250 of 1920: Reels/Stories/TikTok cover about the
// top 14% and the bottom 35%, plus 6% at each side). *Emphasis* words from the script take the accent.
//
// cfg: { y: number | (t, item) => y, tone: 'paper' | 'night' | (t) => tone, size, maxWords, hold,
//        skip: [line ids], only: [line ids], until: { lineId: (t) } }
// Lines with "caption": false in script.json (e.g. a voice note that shows its own transcript) are skipped.

const { clamp, ease, mixHex, luminance } = require('../core/math');
const tl = require('./timeline');
const { brand } = require('./brand');

function tones() {
  const b = brand(); const c = b.colors;
  const hotOnPaper = luminance(c.accent) > 0.5 ? mixHex(c.accent, c.ink, 0.45) : c.accent;
  return {
    paper: { pill: mixHex(c.background, '#ffffff', 0.35), pa: 0.94, text: c.ink, hot: hotOnPaper },
    night: { pill: '#08090d', pa: 0.72, text: '#fff3e0', hot: mixHex(c.accent, '#ffffff', 0.35) },
    accent: { pill: '#ffffff', pa: 0.97, text: c.ink, hot: hotOnPaper },
    ink: { pill: c.ink, pa: 0.92, text: '#ffffff', hot: mixHex(c.accent, '#ffffff', 0.35) },
  };
}

// Split a line into chunks: at strong punctuation, or every `maxWords` words.
function chunkLine(line, maxWords) {
  const out = []; let cur = [];
  line.words.forEach((w, i) => {
    cur.push({ w: w.text.replace(/\.\.\.$/, '…'), t: w.start, end: w.end, hot: !!w.emphasis });
    const strong = /[.!?…:]$/.test(w.text) || (/[,;]$/.test(w.text) && cur.length >= 3);
    if (strong || cur.length >= maxWords || i === line.words.length - 1) { out.push(cur); cur = []; }
  });
  return out.filter((c) => c.length);
}

function build(cfg) {
  const maxWords = cfg.maxWords || 4; const items = [];
  for (const line of tl.lines) {
    if (line.caption === false) continue;
    if (cfg.skip && cfg.skip.includes(line.id)) continue;
    if (cfg.only && !cfg.only.includes(line.id)) continue;
    chunkLine(line, maxWords).forEach((words, k) => items.push({ key: `${line.id}:${k}`, line: line.id, words, t0: words[0].t - 0.06, chunkEnd: words[words.length - 1].end }));
  }
  items.sort((a, b) => a.t0 - b.t0);
  // A chunk stays until the next one starts, at most `hold` s after its last word (0.5 s by default).
  const hold = cfg.hold === undefined ? 0.5 : cfg.hold;
  items.forEach((it, k) => {
    const next = items[k + 1]; let t1 = it.chunkEnd + hold; if (next && next.t0 < t1) t1 = next.t0;
    const u = cfg.until && cfg.until[it.line]; if (u != null && u < t1) t1 = u;
    it.t1 = t1;
  });
  return items;
}

function makeCaptions(cfg = {}) {
  let items = null; let T = null;
  return function draw(f, t) {
    if (cfg.off) return;
    if (!items) { items = build(cfg); T = tones(); }
    // The most recent chunk wins, so a new chunk never waits for the previous one to finish fading out.
    let it = null; for (let i = items.length - 1; i >= 0; i--) { const x = items[i]; if (t >= x.t0 && t < x.t1 + 0.12) { it = x; break; } }
    if (!it) return;
    const b = brand();
    const toneName = typeof cfg.tone === 'function' ? cfg.tone(t) : (cfg.tone || 'paper');
    const K = T[toneName] || T.paper;
    const { ctx } = f; f.setScreen(ctx);
    const out = 1 - clamp((t - it.t1) / 0.12);
    ctx.save();
    // Size: as asked, reduced until the chunk fits the safe width (~900 px).
    let size = cfg.size || 58; let widths, space, total;
    for (;;) {
      ctx.font = b.font(700, size, 'display'); space = ctx.measureText(' ').width;
      widths = it.words.map((w) => ctx.measureText(w.w).width);
      total = widths.reduce((a, c) => a + c, 0) + space * (it.words.length - 1);
      if (total <= 900 || size <= 40) break; size -= 2;
    }
    const y = (typeof cfg.y === 'function' ? cfg.y(t, it) : cfg.y) || 300;
    const a0 = clamp((t - it.t0) / 0.1) * out;
    const padX = 30, padY = 18, h = size + padY * 2, x0 = f.W / 2 - total / 2 - padX, w = total + padX * 2;
    ctx.globalAlpha = a0 * K.pa; ctx.fillStyle = K.pill;
    ctx.beginPath(); ctx.roundRect(x0, y - h / 2, w, h, h / 2); ctx.fill();
    let x = f.W / 2 - total / 2; ctx.textBaseline = 'middle';
    it.words.forEach((wd, i) => {
      const k = clamp((t - wd.t + 0.04) / 0.12);
      if (k > 0) {
        ctx.globalAlpha = ease.outCubic(k) * out; ctx.fillStyle = wd.hot ? K.hot : K.text;
        ctx.fillText(wd.w, x, y + 2 + (1 - ease.outCubic(k)) * 10);
      }
      x += widths[i] + space;
    });
    ctx.restore();
  };
}

module.exports = { makeCaptions, build, chunkLine, tones };
