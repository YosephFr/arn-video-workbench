'use strict';
// The end card: the last scene's dots fly and assemble into the logo mark, the exact logo takes over (the
// final frame is the real asset, never an approximation), the wordmark wipes in and the tagline and URL
// follow. The brand appears only here; keep the call to action apart from the logo.
//
// Timeline (seconds relative to `lock`, the moment the mark is complete):
//   lock - gather .. lock - 0.25   dots leave the source set (staggered, curl swirl) and land on the mark
//   lock - 0.25  .. lock + 0.2     the crisp mark fades in over the dots, which tighten and fade
//   lock         flash / ink ring
//   lock + 0.35  .. lock + 0.95    the wordmark wipes in under the mark
//   lock + 0.9   .. lock + 1.5     tagline, then the URL / call to action
//
// Layout (design px, 1080 × 1920): mark centred at (540, markY), wordmark at wordY, copy below, everything
// inside the safe zone y 250–1250.

const fs = require('fs');
const { createCanvas, loadImage } = require('../core/canvas');
const { clamp, ease, lerp, hash, smoothstep, rgb01, mixHex } = require('../core/math');
const { noise } = require('../core/noise');
const { stippleCanvas } = require('./plates');
const { brand } = require('./brand');

// Rasterise a logo file at a pixel size (SVGs are re-rendered at that size so they stay crisp).
async function rasterize(file, px) {
  if (!file) return null;
  let buf = fs.readFileSync(file);
  if (/\.svg$/i.test(file)) {
    let s = buf.toString('utf8');
    const vb = s.match(/viewBox\s*=\s*"([\d.\s,-]+)"/i);
    let ar = 1; if (vb) { const [, , w, h] = vb[1].trim().split(/[\s,]+/).map(Number); if (w && h) ar = w / h; }
    const W = ar >= 1 ? px : Math.round(px * ar), H = ar >= 1 ? Math.round(px / ar) : px;
    s = s.replace(/<svg([^>]*?)\swidth\s*=\s*"[^"]*"/i, '<svg$1').replace(/<svg([^>]*?)\sheight\s*=\s*"[^"]*"/i, '<svg$1').replace(/<svg/i, `<svg width="${W}" height="${H}"`);
    buf = Buffer.from(s);
  }
  const img = await loadImage(buf);
  const cv = createCanvas(img.width, img.height); cv.getContext('2d').drawImage(img, 0, 0);
  return cv;
}

// Recolour an image (keeps its alpha): white wordmark on a dark ground, and so on.
function tint(src, color) {
  const cv = createCanvas(src.width, src.height); const c = cv.getContext('2d');
  c.drawImage(src, 0, 0); c.globalCompositeOperation = 'source-in'; c.fillStyle = color; c.fillRect(0, 0, src.width, src.height);
  return cv;
}

function createEndCard(o = {}) {
  const cfg = { lock: 20, world: 'paper', gather: 1.5, N: 8000, markY: 720, markSize: 400, wordY: 1000, wordH: 104, tagline: true, url: true, cta: null, from: null, ...o };
  let MARK = null, WORD = null, PTS = null, COLS = null, SEL = null;

  async function init() {
    const b = brand();
    MARK = await rasterize(b.files.mark, 900);
    if (!MARK) {   // no mark file: a neutral disc with the initial, so the card still works
      MARK = createCanvas(900, 900); const c = MARK.getContext('2d');
      c.fillStyle = b.colors.accent; c.beginPath(); c.arc(450, 450, 430, 0, Math.PI * 2); c.fill();
      c.fillStyle = b.colors.accent_ink; c.font = b.font(800, 520, 'display'); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(b.name).trim()[0] || '•', 450, 480);
    }
    const night = cfg.world === 'night';
    const wm = await rasterize(b.files.wordmark, 1400);
    if (wm) WORD = night ? tint(wm, '#ffffff') : wm;
    else {
      const m = createCanvas(10, 10).getContext('2d'); m.font = b.font(700, 200, 'display'); const w = Math.ceil(m.measureText(b.name).width) + 40;
      WORD = createCanvas(w, 260); const c = WORD.getContext('2d'); c.font = b.font(700, 200, 'display'); c.fillStyle = night ? '#ffffff' : b.colors.ink; c.textBaseline = 'middle'; c.fillText(b.name, 20, 135);
    }
    // Density of the mark: opaque and dark/saturated areas get dots, white knock-outs stay empty.
    // A logo that is all white on transparent falls back to its alpha.
    const S = 600; const d = createCanvas(S, S); const dc = d.getContext('2d');
    const ar = MARK.width / MARK.height; const dw = ar >= 1 ? S * 0.92 : S * 0.92 * ar, dh = ar >= 1 ? S * 0.92 / ar : S * 0.92;
    const src = createCanvas(S, S); const sc = src.getContext('2d'); sc.drawImage(MARK, (S - dw) / 2, (S - dh) / 2, dw, dh);
    const px = sc.getImageData(0, 0, S, S).data;
    let sum = 0, cnt = 0;
    for (let i = 0; i < S * S; i++) { const a = px[i * 4 + 3] / 255; if (a > 0.5) { sum += 1 - (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255; cnt++; } }
    const alphaOnly = cnt === 0 || sum / cnt < 0.15;
    const img = dc.createImageData(S, S);
    for (let i = 0; i < S * S; i++) {
      const a = px[i * 4 + 3] / 255; const l = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
      const dens = alphaOnly ? a : a * Math.min(1, 0.25 + (1 - l) * 1.1);
      const v = Math.round(255 * (1 - dens)); img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
    }
    dc.putImageData(img, 0, 0);
    PTS = await stippleCanvas(d, cfg.N, { w: 480, h: 480, gamma: 0.8, edge: 0.6, floor: 0.04 });
    // Each dot takes the logo's colour where it lands (white parts of the mark read as the ground).
    COLS = new Array(PTS.n);
    for (let i = 0; i < PTS.n; i++) {
      const x = Math.min(S - 1, Math.max(0, Math.round(PTS.x[i] * S))), y = Math.min(S - 1, Math.max(0, Math.round(PTS.y[i] * S))); const k = (y * S + x) * 4;
      let col = [px[k] / 255, px[k + 1] / 255, px[k + 2] / 255];
      if (alphaOnly || (px[k + 3] < 128) || (col[0] + col[1] + col[2] > 2.7)) col = night ? [1, 0.97, 0.92] : rgb01(b.colors.ink);
      COLS[i] = col;
    }
  }

  // The card takes over exactly when the gather begins: the act that drew the source dots must end there.
  const start = () => cfg.lock - cfg.gather;

  // f: frame; t: time. from: placed set the dots come from (world units, seen through `fromCam`), or null
  // for a cloud from the centre. inkCol: colour of the source dots.
  // style: how the source dots were drawn ({ r0, r1, gain }), so the first frame of the gather matches.
  function draw(f, t, { from = null, fromCam = null, inkCol = null, style = {} } = {}) {
    if (!PTS || t < start()) return;
    const b = brand(); const night = cfg.world === 'night'; const u = t - cfg.lock;
    const { ctx } = f;
    const size = cfg.markSize, cx = f.W / 2, cy = cfg.markY;
    const ar = MARK.width / MARK.height; const mw = ar >= 1 ? size : size * ar, mh = ar >= 1 ? size / ar : size;
    // Where each logo dot lives on screen (the stipple map is square and 8% padded, like `init`).
    const lx = (i) => cx + (PTS.x[i] - 0.5) * size / 0.92, ly = (i) => cy + (PTS.y[i] - 0.5) * size / 0.92;
    const g = clamp((t - (cfg.lock - cfg.gather)) / (cfg.gather - 0.15));
    const crisp = smoothstep(-0.25, 0.2, u);
    const homeCam = f.homeCam(); const saveCam = f.cam; f.cam = homeCam;
    const src = inkCol || (night ? [1, 0.95, 0.88] : rgb01(b.colors.ink));
    const bi = Math.floor(t * 12);
    const sr0 = style.r0 ?? (night ? 0.8 : 0.85), sr1 = style.r1 ?? (night ? 1.9 : 2.3), sg = style.gain ?? 1;
    const srcR = (v) => sr0 + (sr1 - sr0) * v, srcA = (v) => (night ? (0.35 + 0.65 * v) * sg : 0.55 + 0.45 * v);
    if (crisp < 1) {
      const Ns = from ? from.n : 0; const stride = from ? Ns / PTS.n : 0;
      const zs = fromCam ? fromCam.z : 1;   // source dots were sized in world units under that zoom
      // Which source dots fly to the logo (one per logo dot, spread evenly along the Hilbert order).
      if (from && (!SEL || SEL.length !== Ns)) { SEL = new Uint8Array(Ns); for (let i = 0; i < PTS.n; i++) SEL[Math.min(Ns - 1, Math.floor(i * stride))] = 1; }
      const proj = (x, y) => { if (!fromCam) return [x, y]; const [px, py] = f.project(x, y, fromCam); return [px / f.s, py / f.s]; };
      // Dots of the source set that are not needed blow away as the rest gather.
      if (from && g < 1) {
        for (let i = 0; i < Ns; i++) {
          if (SEL[i]) continue;
          const k = clamp((g * 1.4 - hash(i * 5 + 3) * 0.4) / 0.6); if (k >= 1) continue;
          const [x0, y0] = proj(from.X[i], from.Y[i]);
          const x = x0 + k * k * 260 * (hash(i) - 0.3), y = y0 - k * k * 180 * hash(i * 2);
          const v = from.V[i]; const a = (1 - k) * srcA(v);
          if (night) f.dotLight(x, y, srcR(v) * zs, a, src); else f.dotInk(x, y, srcR(v) * zs, a, src);
        }
      }
      for (let i = 0; i < PTS.n; i++) {
        let x0, y0, v0 = 0.6;
        if (from) { const j = Math.min(Ns - 1, Math.floor(i * stride)); [x0, y0] = proj(from.X[j], from.Y[j]); v0 = from.V[j]; }
        else { const a = hash(i * 7) * Math.PI * 2, r = 300 + hash(i * 3) * 700; x0 = cx + Math.cos(a) * r; y0 = cy + Math.sin(a) * r; }
        const d = hash(i * 29 + 5) * 0.35; const k = ease.inOutCubic(clamp((g - d) / 0.65));
        let x = lerp(x0, lx(i), k), y = lerp(y0, ly(i), k);
        const m = Math.sin(Math.PI * k);
        if (m > 0.01) { const c = noise.curl2(x * 0.004, y * 0.004, i * 0.001 + t * 0.2); x += c[0] * 70 * m; y += c[1] * 70 * m; }
        const jx = (hash(i * 13 + bi * 7919) - 0.5) * 1.0 * (1 - k * 0.6), jy = (hash(i * 17 + bi * 104729) - 0.5) * 1.0 * (1 - k * 0.6);
        const col = [lerp(src[0], COLS[i][0], k), lerp(src[1], COLS[i][1], k), lerp(src[2], COLS[i][2], k)];
        const r = lerp(from ? srcR(v0) * zs : 1.4, 2.3, k) * (1 - 0.5 * crisp); const a = (1 - crisp) * lerp(from ? srcA(v0) : 0.6, night ? 1.2 : 0.95, k);
        if (night) f.dotLight(x + jx, y + jy, r, a, col); else f.dotInk(x + jx, y + jy, r, a, col);
      }
      if (night) f.flushLight(1, 0.8); else f.flushInk();
    }
    f.setScreen(ctx);
    if (crisp > 0) {
      ctx.save(); ctx.globalAlpha = crisp;
      if (!night) { ctx.save(); ctx.globalAlpha *= 0.22; ctx.filter = `blur(${size * 0.05 * f.s}px)`; ctx.drawImage(MARK, cx - mw / 2 + 6, cy - mh / 2 + 16, mw, mh); ctx.restore(); }
      ctx.drawImage(MARK, cx - mw / 2, cy - mh / 2, mw, mh); ctx.restore();
    }
    // Lock: a flash of light at night, an ink ring pulse on paper.
    if (u > -0.05 && u < 0.8) {
      const a = Math.exp(-Math.max(0, u) * 6);
      if (night) { f.glowLight(cx, cy, size * 1.1, 0.5 * a, [1, 1, 1]); f.flushLight(1, 1); }
      else { ctx.save(); ctx.globalAlpha = 0.35 * a; ctx.strokeStyle = b.colors.accent; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(cx, cy, size * 0.55 + ease.outCubic(clamp(u / 0.8)) * 160, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
    }
    // Wordmark wipe (left → right, drifting into place).
    const wp = clamp((u - 0.35) / 0.6);
    if (wp > 0 && WORD) {
      const h = cfg.wordH, w = h * WORD.width / WORD.height; const x = cx - w / 2, y = cfg.wordY - h / 2;
      const e = ease.outCubic(wp); const front = lerp(x - 10, x + w + 20, ease.inOutCubic(wp));
      ctx.save(); ctx.beginPath(); ctx.rect(x - 20, y - 40, Math.max(0, front - (x - 20)), h + 80); ctx.clip();
      ctx.drawImage(WORD, x - (1 - e) * 50, y, w, h); ctx.restore();
    }
    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const soft = night ? 'rgba(255,243,224,0.78)' : mixHex(b.colors.ink, b.colors.muted, 0.6);
    const accent = night ? mixHex(b.colors.accent, '#ffffff', 0.3) : b.colors.accent;
    if (cfg.copy) {
      // Copy lines (an offer, its conditions, the URL), each rising in shortly after the previous one.
      // roles: offer (display, large), sub (body, muted), cta (body, accent), fine (small print).
      const ROLE = { offer: [700, 50, 'display', night ? '#fff3e0' : b.colors.ink], sub: [500, 30, 'body', soft], cta: [600, 34, 'body', accent], fine: [400, 22, 'body', soft] };
      let y = cfg.wordY + cfg.wordH * 0.5 + 64, prev = 0;
      cfg.copy.filter((l) => l && l.text).forEach((l, k) => {
        const [wgt, size, role, col] = ROLE[l.role] || ROLE.sub; y += k ? prev * 0.42 + size * 0.95 + 14 : size * 0.9; prev = size;
        const a = smoothstep(0.9 + k * 0.15, 1.25 + k * 0.15, u); if (a <= 0) return;
        ctx.globalAlpha = a; ctx.font = b.font(wgt, size, role); ctx.fillStyle = col; ctx.fillText(l.text, cx, y + (1 - ease.outCubic(a)) * 16);
      });
    } else {
      // Tagline, then the URL or call to action.
      const ta = smoothstep(0.9, 1.25, u), ua = smoothstep(1.15, 1.5, u);
      if (cfg.tagline && ta > 0 && b.tagline) { ctx.globalAlpha = ta; ctx.font = b.font(500, 42, 'body'); ctx.fillStyle = soft; ctx.fillText(cfg.tagline === true ? b.tagline : cfg.tagline, cx, cfg.wordY + cfg.wordH * 0.5 + 76 + (1 - ease.outCubic(ta)) * 16); }
      const cta = cfg.cta || (cfg.url ? b.url : null);
      if (cta && ua > 0) { ctx.globalAlpha = ua; ctx.font = b.font(600, 40, 'body'); ctx.fillStyle = accent; ctx.fillText(cta, cx, cfg.wordY + cfg.wordH * 0.5 + 138 + (1 - ease.outCubic(ua)) * 16); }
    }
    ctx.restore();
    f.cam = saveCam;
  }

  return { init, draw, start, get lock() { return cfg.lock; }, cfg };
}

module.exports = { createEndCard, rasterize, tint };
