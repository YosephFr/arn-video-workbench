'use strict';
// Software dot rasteriser. Tens of thousands of anti-aliased dots are splatted into a float buffer (much
// faster than one canvas call per dot), then uploaded to a canvas layer that scenes composite with the usual
// blend modes.
//   mode 'ink'   → premultiplied "over" compositing (ink or graphite on paper)
//   mode 'light' → additive HDR light (glowing particles), meant to be drawn with 'lighter'

const { createCanvas } = require('../core/canvas');
const { rgb01 } = require('../core/math');

class DotLayer {
  constructor(W, H, mode = 'ink') {
    this.W = W; this.H = H; this.mode = mode;
    this.acc = new Float32Array(W * H * 4);
    this.canvas = createCanvas(W, H);
    this.ctx = this.canvas.getContext('2d');
    this.img = this.ctx.createImageData(W, H);
    this.resetBox();
  }
  resetBox() { this.x0 = this.W; this.y0 = this.H; this.x1 = -1; this.y1 = -1; }
  // Only the dirty box is cleared and uploaded: a scene that draws a small object stays cheap.
  clear() {
    if (this.x1 >= this.x0) {
      const { W } = this;
      for (let y = this.y0; y <= this.y1; y++) this.acc.fill(0, (y * W + this.x0) * 4, (y * W + this.x1 + 1) * 4);
    }
    this.resetBox();
  }
  _grow(x0, y0, x1, y1) {
    if (x0 < this.x0) this.x0 = x0; if (y0 < this.y0) this.y0 = y0;
    if (x1 > this.x1) this.x1 = x1; if (y1 > this.y1) this.y1 = y1;
  }
  // One dot. r in px, a = opacity 0..1 (may exceed 1 in light mode), (cr, cg, cb) colour in 0..1.
  dot(x, y, r, a, cr, cg, cb) {
    const { W, H, acc } = this;
    if (a <= 0.002 || r <= 0) return;
    const R = r + 1.0;
    if (x < -R || y < -R || x >= W + R || y >= H + R) return;
    const light = this.mode === 'light';
    if (r < 0.8) {
      // Tiny dot: bilinear splat carrying the area of a disc of radius r (no shimmering at small sizes).
      const area = Math.min(1, Math.PI * r * r) * a;
      const xf = x - 0.5, yf = y - 0.5;
      const ix = Math.floor(xf), iy = Math.floor(yf); const fx = xf - ix, fy = yf - iy;
      const ws = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
      const px = [ix, ix + 1, ix, ix + 1], py = [iy, iy, iy + 1, iy + 1];
      for (let k = 0; k < 4; k++) {
        const X = px[k], Y = py[k]; if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        const cov = ws[k] * area; if (cov <= 0) continue;
        const i = (Y * W + X) * 4;
        if (light) { acc[i] += cr * cov; acc[i + 1] += cg * cov; acc[i + 2] += cb * cov; acc[i + 3] += cov; }
        else { const inv = 1 - cov; acc[i] = cr * cov + acc[i] * inv; acc[i + 1] = cg * cov + acc[i + 1] * inv; acc[i + 2] = cb * cov + acc[i + 2] * inv; acc[i + 3] = cov + acc[i + 3] * inv; }
      }
      this._grow(Math.max(0, ix), Math.max(0, iy), Math.min(W - 1, ix + 1), Math.min(H - 1, iy + 1));
      return;
    }
    const xa = Math.max(0, Math.floor(x - R)), xb = Math.min(W - 1, Math.ceil(x + R));
    const ya = Math.max(0, Math.floor(y - R)), yb = Math.min(H - 1, Math.ceil(y + R));
    const rr = r + 0.5;
    for (let Y = ya; Y <= yb; Y++) {
      const dy = Y + 0.5 - y; const dy2 = dy * dy;
      let i = (Y * W + xa) * 4;
      for (let X = xa; X <= xb; X++, i += 4) {
        const dx = X + 0.5 - x; const d = Math.sqrt(dx * dx + dy2);
        let cov = rr - d; if (cov <= 0) continue; if (cov > 1) cov = 1;
        cov *= a;
        if (light) { acc[i] += cr * cov; acc[i + 1] += cg * cov; acc[i + 2] += cb * cov; acc[i + 3] += cov; }
        else { if (cov > 1) cov = 1; const inv = 1 - cov; acc[i] = cr * cov + acc[i] * inv; acc[i + 1] = cg * cov + acc[i + 1] * inv; acc[i + 2] = cb * cov + acc[i + 2] * inv; acc[i + 3] = cov + acc[i + 3] * inv; }
      }
    }
    this._grow(xa, ya, xb, yb);
  }
  // Soft glowing blob (cubic falloff), light mode only.
  glow(x, y, radius, a, cr, cg, cb) {
    const { W, H, acc } = this;
    const R = radius;
    const xa = Math.max(0, Math.floor(x - R)), xb = Math.min(W - 1, Math.ceil(x + R));
    const ya = Math.max(0, Math.floor(y - R)), yb = Math.min(H - 1, Math.ceil(y + R));
    if (xa > xb || ya > yb) return;
    const inv = 1 / (R * R);
    for (let Y = ya; Y <= yb; Y++) {
      const dy = Y + 0.5 - y;
      let i = (Y * W + xa) * 4;
      for (let X = xa; X <= xb; X++, i += 4) {
        const dx = X + 0.5 - x; const q = (dx * dx + dy * dy) * inv; if (q >= 1) continue;
        const f = (1 - q); const cov = a * f * f * f;
        acc[i] += cr * cov; acc[i + 1] += cg * cov; acc[i + 2] += cb * cov; acc[i + 3] += cov;
      }
    }
    this._grow(xa, ya, xb, yb);
  }
  // Upload the dirty region to the internal canvas and return it.
  upload(exposure = 1) {
    const { W, acc, img } = this; const d = img.data;
    this.ctx.clearRect(0, 0, W, this.H);
    if (this.x1 < this.x0) return this.canvas;
    const light = this.mode === 'light';
    for (let y = this.y0; y <= this.y1; y++) {
      let i = (y * W + this.x0) * 4;
      for (let x = this.x0; x <= this.x1; x++, i += 4) {
        const A = acc[i + 3];
        if (A <= 0.0005) { d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = 0; continue; }
        if (light) {
          // Filmic soft clip keeps hot cores white without hard banding.
          const r = 1 - Math.exp(-acc[i] * exposure), g = 1 - Math.exp(-acc[i + 1] * exposure), b = 1 - Math.exp(-acc[i + 2] * exposure);
          const m = Math.max(r, g, b);
          d[i] = r / (m || 1) * 255; d[i + 1] = g / (m || 1) * 255; d[i + 2] = b / (m || 1) * 255; d[i + 3] = Math.min(255, m * 255);
        } else {
          const a = A > 1 ? 1 : A;
          d[i] = (acc[i] / A) * 255; d[i + 1] = (acc[i + 1] / A) * 255; d[i + 2] = (acc[i + 2] / A) * 255; d[i + 3] = a * 255;
        }
      }
    }
    this.ctx.putImageData(img, 0, 0, this.x0, this.y0, this.x1 - this.x0 + 1, this.y1 - this.y0 + 1);
    return this.canvas;
  }
}

module.exports = { DotLayer, rgb01 };
