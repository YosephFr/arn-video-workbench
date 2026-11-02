'use strict';
// Film finishing: paper stock, grain, paper tooth, bloom, vignette, flicker and light leaks.
// Every texture is generated once per process from a seed (deterministic) and reused.

const { createCanvas } = require('../core/canvas');
const { makeNoise } = require('../core/noise');
const { rng, hash } = require('../core/math');

// Drawing paper: mottled fibres plus tooth. Render three sheets and alternate them on drawn frames
// (12 per second) so the page itself "boils" like stop-motion. base = [r, g, b] 0..255.
function makePaper(W, H, { seed = 1, base = [236, 229, 214], mottle = 10, tooth = 14, fibres = 900, warm = true } = {}) {
  const c = createCanvas(W, H); const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H); const d = img.data;
  const nz = makeNoise(seed * 17 + 3); const r = rng(seed);
  const sx = 1080 / Math.max(1, W);   // keep the mottle scale independent of the output resolution
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const m = nz.fbm2(x * sx * 0.0022, y * sx * 0.0022, 4) * mottle + nz.fbm2(x * sx * 0.02, y * sx * 0.02, 2) * 3;
    const v = m + (r() - 0.5) * tooth;
    d[i] = base[0] + v; d[i + 1] = base[1] + v * (warm ? 0.97 : 1); d[i + 2] = base[2] + v * (warm ? 0.9 : 1); d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // Fibres: short faint curved strokes, dark and light.
  ctx.lineCap = 'round';
  const dark = base[0] + base[1] + base[2] < 200;
  for (let k = 0; k < fibres * (W * H) / (1080 * 1920); k++) {
    const x = r() * W, y = r() * H, a = r() * Math.PI * 2, L = (6 + r() * 26) / sx;
    ctx.strokeStyle = r() < 0.5 ? (dark ? `rgba(255,255,255,${0.02 + r() * 0.03})` : `rgba(120,100,70,${0.03 + r() * 0.05})`) : (dark ? `rgba(0,0,0,${0.05 + r() * 0.08})` : `rgba(255,255,250,${0.05 + r() * 0.07})`);
    ctx.lineWidth = (0.6 + r() * 0.8) / Math.sqrt(sx);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + Math.cos(a + 0.6) * L * 0.5, y + Math.sin(a + 0.6) * L * 0.5, x + Math.cos(a) * L, y + Math.sin(a) * L); ctx.stroke();
  }
  return c;
}

// Monochrome grain tiles (mid-grey centred) to be blended with 'overlay'.
function makeGrainTiles(size = 512, count = 6, seed = 9) {
  const tiles = [];
  for (let k = 0; k < count; k++) {
    const c = createCanvas(size, size); const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size); const d = img.data; const r = rng(seed + k * 101);
    for (let i = 0; i < size * size; i++) {
      const g = (r() + r() + r() - 1.5) * 0.8;   // sum of uniforms ≈ gaussian grain
      const v = 128 + g * 110;
      d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    tiles.push(c);
  }
  return tiles;
}

// Paper tooth as an alpha mask, used with 'destination-out' on a stroke layer so graphite skips the
// valleys of the paper (grainy pencil instead of vector lines).
function makeTooth(W, H, { seed = 4, scale = 1 } = {}) {
  const c = createCanvas(W, H); const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H); const d = img.data; const nz = makeNoise(seed); const r = rng(seed * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const n = nz.n2(x * 0.35 / scale, y * 0.35 / scale) * 0.5 + nz.n2(x * 0.08 / scale, y * 0.11 / scale) * 0.35 + (r() - 0.5) * 0.5;
    const a = Math.max(0, Math.min(1, (n - 0.05) * 1.6));
    d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = a * 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

class Post {
  constructor(W, H) {
    this.W = W; this.H = H;
    this.grain = makeGrainTiles(512, 6);
    this.small = createCanvas(Math.ceil(W / 4), Math.ceil(H / 4));
    this.sctx = this.small.getContext('2d');
    this.small2 = createCanvas(Math.ceil(W / 8), Math.ceil(H / 8));
    this.sctx2 = this.small2.getContext('2d');
    this.vignettes = new Map();
  }
  // Bloom: blur the glow source at 1/4 and 1/8 resolution and add it back.
  bloom(ctx, src, { strength = 0.9, radius = 10, wide = 0.6 } = {}) {
    const { W, H, small, sctx, small2, sctx2 } = this;
    sctx.globalCompositeOperation = 'source-over'; sctx.clearRect(0, 0, small.width, small.height);
    sctx.filter = `blur(${radius}px)`; sctx.drawImage(src, 0, 0, small.width, small.height); sctx.filter = 'none';
    sctx2.clearRect(0, 0, small2.width, small2.height);
    sctx2.filter = `blur(${radius * 1.6}px)`; sctx2.drawImage(src, 0, 0, small2.width, small2.height); sctx2.filter = 'none';
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = strength; ctx.drawImage(small, 0, 0, W, H);
    ctx.globalAlpha = strength * wide; ctx.drawImage(small2, 0, 0, W, H);
    ctx.restore();
  }
  // Film grain that changes `fps` times per second (12 = on drawn frames, like the line boil).
  grainPass(ctx, t, fps, amount = 0.07) {
    if (amount <= 0) return;
    const { W, H } = this; const fi = Math.round(t * fps);
    const tile = this.grain[fi % this.grain.length];
    const ox = Math.floor(hash(fi * 7 + 1) * 512), oy = Math.floor(hash(fi * 13 + 5) * 512);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = amount;
    const pat = ctx.createPattern(tile, 'repeat');
    ctx.translate(-ox, -oy); ctx.fillStyle = pat; ctx.fillRect(ox, oy, W, H);
    ctx.restore();
  }
  vignette(ctx, strength = 0.45, color = '0,0,0', inner = 0.45) {
    const { W, H } = this; const key = `${strength}|${color}|${inner}`;
    let v = this.vignettes.get(key);
    if (!v) {
      v = createCanvas(W, H); const c = v.getContext('2d');
      const g = c.createRadialGradient(W / 2, H * 0.48, Math.min(W, H) * inner * 0.6, W / 2, H * 0.5, Math.hypot(W, H) * 0.55);
      g.addColorStop(0, `rgba(${color},0)`); g.addColorStop(1, `rgba(${color},${strength})`);
      c.fillStyle = g; c.fillRect(0, 0, W, H); this.vignettes.set(key, v);
    }
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(v, 0, 0); ctx.restore();
  }
  // Warm light leak drifting across the frame (additive).
  leak(ctx, t, { x = 0.9, y = 0.1, r = 0.8, color = '255,160,90', a = 0.18 } = {}) {
    const { W, H } = this; if (a <= 0) return;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'screen';
    const g = ctx.createRadialGradient(W * x, H * y, 0, W * x, H * y, Math.max(W, H) * r);
    g.addColorStop(0, `rgba(${color},${a})`); g.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
  }
  // Exposure flicker for a projected-film feel.
  flicker(ctx, t, fps, amount = 0.025) {
    const fi = Math.round(t * fps); const f = (hash(fi * 3 + 11) - 0.5) * 2 * amount;
    if (Math.abs(f) < 0.002) return;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = f > 0 ? 'screen' : 'multiply';
    ctx.fillStyle = f > 0 ? `rgba(255,248,235,${f})` : `rgba(${255 * (1 + f)},${255 * (1 + f)},${255 * (1 + f)},1)`;
    ctx.fillRect(0, 0, this.W, this.H); ctx.restore();
  }
}

module.exports = { Post, makePaper, makeGrainTiles, makeTooth };
