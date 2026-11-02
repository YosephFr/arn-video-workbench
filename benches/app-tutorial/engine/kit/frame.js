'use strict';
// Per-process frame context. Scenes draw in design space (1080 × 1920); `scale` maps it to output pixels, so the
// same film renders a half-size preview or the full master without changes. finish() adds a light film grain and
// vignette: on a phone a perfectly flat frame reads as a static slide.
const { createCanvas } = require('./canvas');
const { rng, hash } = require('./math');

const DESIGN_W = 1080, DESIGN_H = 1920;

function grainTiles(size = 512, count = 6, seed = 9) {
  const tiles = [];
  for (let k = 0; k < count; k++) {
    const c = createCanvas(size, size); const ctx = c.getContext('2d'); const img = ctx.createImageData(size, size); const d = img.data; const r = rng(seed + k * 101);
    for (let i = 0; i < size * size; i++) { const v = 128 + (r() + r() + r() - 1.5) * 0.8 * 110; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
    ctx.putImageData(img, 0, 0); tiles.push(c);
  }
  return tiles;
}

class Frame {
  constructor({ scale = 1, fps = 30 } = {}) {
    this.s = scale; this.fps = fps; this.W = DESIGN_W; this.H = DESIGN_H;
    this.PW = Math.round(DESIGN_W * scale); this.PH = Math.round(DESIGN_H * scale);
    this.canvas = createCanvas(this.PW, this.PH); this.ctx = this.canvas.getContext('2d');
    this.t = 0; this.vignettes = new Map(); this.grain = null;
  }
  begin(t) {
    this.t = t; const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.filter = 'none';
    c.clearRect(0, 0, this.PW, this.PH);
  }
  setScreen(c = this.ctx) { c.setTransform(this.s, 0, 0, this.s, 0, 0); }
  // grain: overlay noise that changes 12 times a second (on "drawn" frames, as in animation); vignette: darkened edges.
  finish({ grain = 0.022, vignette = 0.1, vignetteColor = '40,40,48', grainFps = 12 } = {}) {
    const c = this.ctx;
    if (vignette > 0) {
      const key = `${vignette}|${vignetteColor}`; let v = this.vignettes.get(key);
      if (!v) {
        v = createCanvas(this.PW, this.PH); const g0 = v.getContext('2d'); const W = this.PW, H = this.PH;
        const g = g0.createRadialGradient(W / 2, H * 0.48, Math.min(W, H) * 0.27, W / 2, H * 0.5, Math.hypot(W, H) * 0.55);
        g.addColorStop(0, `rgba(${vignetteColor},0)`); g.addColorStop(1, `rgba(${vignetteColor},${vignette})`); g0.fillStyle = g; g0.fillRect(0, 0, W, H);
        this.vignettes.set(key, v);
      }
      c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(v, 0, 0); c.restore();
    }
    if (grain > 0) {
      if (!this.grain) this.grain = grainTiles();
      const fi = Math.round(this.t * grainFps); const tile = this.grain[fi % this.grain.length];
      const ox = Math.floor(hash(fi * 7 + 1) * 512), oy = Math.floor(hash(fi * 13 + 5) * 512);
      c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'overlay'; c.globalAlpha = grain;
      c.translate(-ox, -oy); c.fillStyle = c.createPattern(tile, 'repeat'); c.fillRect(ox, oy, this.PW, this.PH); c.restore();
    }
  }
}

module.exports = { Frame, DESIGN_W, DESIGN_H };
