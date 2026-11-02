'use strict';
// Per-process frame context: output canvas, dot layers (ink and light), glow buffer, scratch layer and camera.
// Scenes draw in design space (1080 × 1920 by default); `scale` maps it to output pixels, so the same film
// renders a half-size preview or the full master without changes.

const { createCanvas } = require('./canvas');
const { DotLayer } = require('../draw/dots');
const { Post, makeTooth } = require('../post/post');
const { BOIL_FPS } = require('./math');

class Frame {
  constructor({ scale = 1, fps = 60, width = 1080, height = 1920 } = {}) {
    this.s = scale; this.fps = fps;
    this.W = width; this.H = height;
    this.PW = Math.round(width * scale); this.PH = Math.round(height * scale);
    this.canvas = createCanvas(this.PW, this.PH);
    this.ctx = this.canvas.getContext('2d');
    this.ink = new DotLayer(this.PW, this.PH, 'ink');
    this.light = new DotLayer(this.PW, this.PH, 'light');
    this.glowCanvas = createCanvas(this.PW, this.PH);
    this.glow = this.glowCanvas.getContext('2d');
    this.layerCanvas = createCanvas(this.PW, this.PH);
    this.layer = this.layerCanvas.getContext('2d');
    this.post = new Post(this.PW, this.PH);
    this.cam = this.homeCam();
    this.t = 0;
  }
  homeCam() { return { x: this.W / 2, y: this.H / 2, z: 1, r: 0 }; }
  begin(t) {
    this.t = t;
    this.cam = this.homeCam();
    const { ctx, glow } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
    ctx.clearRect(0, 0, this.PW, this.PH);
    glow.setTransform(1, 0, 0, 1, 0, 0); glow.clearRect(0, 0, this.PW, this.PH);
    this.ink.clear(); this.light.clear();
  }
  // Camera transform for any 2D context (design space → output pixels). cam = { x, y, z, r }: the design
  // point at the centre of the frame, zoom and roll.
  setCam(c, cam = this.cam) {
    const { s } = this; const cs = Math.cos(cam.r) * cam.z * s, sn = Math.sin(cam.r) * cam.z * s;
    const tx = s * this.W / 2 - (cs * cam.x - sn * cam.y);
    const ty = s * this.H / 2 - (sn * cam.x + cs * cam.y);
    c.setTransform(cs, sn, -sn, cs, tx, ty);
  }
  // Screen space (no camera): captions, titles, end card.
  setScreen(c) { c.setTransform(this.s, 0, 0, this.s, 0, 0); }
  // Project a design-space point through the camera to output pixels.
  project(x, y, cam = this.cam) {
    const { s } = this; const dx = x - cam.x, dy = y - cam.y; const c = Math.cos(cam.r), sn = Math.sin(cam.r);
    return [s * (this.W / 2 + (dx * c - dy * sn) * cam.z), s * (this.H / 2 + (dx * sn + dy * c) * cam.z)];
  }
  // Inverse: a screen point (design units, no camera) → world point under the current camera.
  unproject(sx, sy, cam = this.cam) {
    const dx = (sx - this.W / 2) / cam.z, dy = (sy - this.H / 2) / cam.z; const c = Math.cos(-cam.r), sn = Math.sin(-cam.r);
    return [cam.x + dx * c - dy * sn, cam.y + dx * sn + dy * c];
  }
  // Composite the accumulated ink dots onto the main canvas (then clear them).
  flushInk(alpha = 1, op = 'source-over', blur = 0) {
    const cv = this.ink.upload();
    const { ctx } = this; ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = alpha; ctx.globalCompositeOperation = op;
    if (blur > 0) ctx.filter = `blur(${blur * this.s}px)`;
    ctx.drawImage(cv, 0, 0); ctx.restore(); this.ink.clear();
  }
  // Composite the light particles additively; part of them also feeds the bloom buffer.
  flushLight(alpha = 1, toGlow = 0.8, exposure = 1, blur = 0) {
    const cv = this.light.upload(exposure);
    const { ctx } = this; ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = alpha; ctx.globalCompositeOperation = 'lighter';
    if (blur > 0) ctx.filter = `blur(${blur * this.s}px)`;
    ctx.drawImage(cv, 0, 0); ctx.restore();
    if (toGlow > 0) { const g = this.glow; g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = toGlow * alpha; g.globalCompositeOperation = 'lighter'; g.drawImage(cv, 0, 0); g.restore(); }
    this.light.clear();
  }
  // Draw into an offscreen layer (design space, camera on by default), then composite it.
  // tooth > 0 erodes the strokes with the paper-tooth mask (graphite grain); glow > 0 also feeds bloom.
  withLayer(fn, { alpha = 1, op = 'source-over', blur = 0, cam = true, tooth = 0, glow = 0 } = {}) {
    const L = this.layer; L.setTransform(1, 0, 0, 1, 0, 0); L.globalAlpha = 1; L.globalCompositeOperation = 'source-over'; L.filter = 'none'; L.clearRect(0, 0, this.PW, this.PH);
    if (cam) this.setCam(L); else this.setScreen(L);
    fn(L);
    if (tooth > 0) {
      if (!this.toothCanvas) this.toothCanvas = makeTooth(this.PW, this.PH, { scale: Math.max(0.5, this.s) });
      L.save(); L.setTransform(1, 0, 0, 1, 0, 0); L.globalCompositeOperation = 'destination-out'; L.globalAlpha = tooth;
      const bi = Math.floor(this.t * BOIL_FPS) % 4; const ox = [0, 13, 29, 7][bi], oy = [0, 21, 5, 17][bi];
      L.drawImage(this.toothCanvas, -ox, -oy); L.drawImage(this.toothCanvas, this.PW - ox, -oy); L.drawImage(this.toothCanvas, -ox, this.PH - oy);
      L.restore();
    }
    const { ctx } = this; ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = alpha; ctx.globalCompositeOperation = op;
    if (blur > 0) ctx.filter = `blur(${blur * this.s}px)`;
    ctx.drawImage(this.layerCanvas, 0, 0); ctx.restore();
    if (glow > 0) { const g = this.glow; g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = glow * alpha; g.globalCompositeOperation = 'lighter'; g.drawImage(this.layerCanvas, 0, 0); g.restore(); }
  }
  // Directional motion blur of everything drawn so far: average of shifted copies along (dx, dy) px.
  motionBlur(dx, dy, samples = 8) {
    const len = Math.hypot(dx, dy); if (len < 1.5) return;
    const n = Math.max(2, Math.min(samples, Math.ceil(len / 3)));
    const L = this.layer; L.setTransform(1, 0, 0, 1, 0, 0); L.globalAlpha = 1; L.globalCompositeOperation = 'copy'; L.drawImage(this.canvas, 0, 0); L.globalCompositeOperation = 'source-over';
    const { ctx } = this; ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (let k = 1; k < n; k++) { const u = k / (n - 1) - 0.5; ctx.globalAlpha = 1 / (k + 1); ctx.drawImage(this.layerCanvas, dx * u, dy * u); }
    ctx.restore();
  }
  // Physically based motion blur from a camera function: the blur length equals the on-screen travel during
  // a 180° shutter (half a frame). Use it on whip pans; it is what makes a fast move read as a camera move.
  autoMotionBlur(camFn, t, shutter = 0.5, max = 140) {
    const h = 1 / 240; const a = camFn(t - h), b = camFn(t + h); const z = (a.z + b.z) / 2;
    const vx = (b.x - a.x) / (2 * h) * z, vy = (b.y - a.y) / (2 * h) * z;
    let dx = -vx / this.fps * shutter * this.s, dy = -vy / this.fps * shutter * this.s;
    const L = Math.hypot(dx, dy); if (L > max * this.s) { dx *= max * this.s / L; dy *= max * this.s / L; }
    this.motionBlur(dx, dy, 10);
  }
  // Camera speed in design px per second (to decide when a move deserves motion blur).
  static camSpeed(camFn, t) {
    const h = 1 / 120; const a = camFn(t - h), b = camFn(t + h);
    return Math.hypot(b.x - a.x, b.y - a.y) / (2 * h);
  }
  dotInk(x, y, r, a, col) { const [px, py] = this.project(x, y); this.ink.dot(px, py, r * this.cam.z * this.s, a, col[0], col[1], col[2]); }
  dotLight(x, y, r, a, col) { const [px, py] = this.project(x, y); this.light.dot(px, py, r * this.cam.z * this.s, a, col[0], col[1], col[2]); }
  glowLight(x, y, r, a, col) { const [px, py] = this.project(x, y); this.light.glow(px, py, r * this.cam.z * this.s, a, col[0], col[1], col[2]); }
  // Final pass. grainFps / flickerFps: grain and flicker change on drawn frames (12 per second) rather than
  // on every output frame: the same look on twos, and far fewer bits for the encoder to spend on noise.
  finish({ bloom = 0.8, bloomRadius = 10, grain = 0.07, vignette = 0.45, vignetteColor = '0,0,0', flicker = 0.02, grainFps = BOIL_FPS, flickerFps = BOIL_FPS } = {}) {
    const { ctx, post } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
    if (bloom > 0) post.bloom(ctx, this.glowCanvas, { strength: bloom, radius: bloomRadius * this.s });
    if (vignette > 0) post.vignette(ctx, vignette, vignetteColor);
    if (flicker > 0) post.flicker(ctx, this.t, flickerFps || this.fps, flicker);
    post.grainPass(ctx, this.t, grainFps || this.fps, grain);
  }
}

module.exports = { Frame };
