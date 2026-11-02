'use strict';
// Weighted Voronoi stippling (Secord, NPAR 2002) with an on-disk cache.
// A density map (0..1) becomes N well-spaced points whose local density follows the image tone: the
// engraving / stipple look. Plates are only density guides; every dot is then drawn by code, frame by frame.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createCanvas, loadImage } = require('../core/canvas');
const { rng } = require('../core/math');

const CACHE_DIR = process.env.WB_STIPPLE_CACHE || path.join(__dirname, '..', '..', '.cache', 'stipple');
const sha1 = (x) => crypto.createHash('sha1').update(x).digest('hex');

// A plate source can be a file path, an encoded image Buffer, or a canvas (procedural plates).
async function toImage(src) {
  if (typeof src === 'string' || Buffer.isBuffer(src)) return loadImage(typeof src === 'string' ? fs.readFileSync(src) : src);
  return src; // canvas or Image
}
function contentKey(src) {
  if (typeof src === 'string') return sha1(fs.readFileSync(src));
  if (Buffer.isBuffer(src)) return sha1(src);
  if (src && typeof src.data === 'function') return sha1(src.data());   // @napi-rs canvas: raw RGBA
  if (src && src.width) { const c = createCanvas(src.width, src.height); c.getContext('2d').drawImage(src, 0, 0); return sha1(c.data()); }
  throw new Error('stipple: unsupported plate source');
}

// Build a density map of size (w, h).
// mode 'dark' → dark pixels get dots (ink on paper); 'light' → bright pixels get dots (light in the dark).
// gamma > 1 thins the mid-tones; edge adds contour emphasis so outlines survive the stippling; floor cuts the
// faint background haze; crop [x, y, w, h] (normalised) stipples only that part of the plate with all N
// points; mask (rects) and maskPolys (polygons), both normalised to the map, receive no dots (a phone
// screen whose content is drawn separately).
async function densityFromImage(src, { w = 540, h = 960, mode = 'dark', gamma = 1.0, edge = 0.0, fit = 'contain', bg = null, crop = null, mask = null, maskPolys = null, floor = 0 } = {}) {
  const img = await toImage(src);
  const c = createCanvas(w, h); const ctx = c.getContext('2d');
  ctx.fillStyle = bg || (mode === 'dark' ? '#fff' : '#000'); ctx.fillRect(0, 0, w, h);
  let sx = 0, sy = 0, sw = img.width, sh = img.height;
  if (crop) { sx = crop[0] * img.width; sy = crop[1] * img.height; sw = crop[2] * img.width; sh = crop[3] * img.height; }
  const s = fit === 'cover' ? Math.max(w / sw, h / sh) : Math.min(w / sw, h / sh);
  const dw = sw * s, dh = sh * s;
  ctx.drawImage(img, sx, sy, sw, sh, (w - dw) / 2, (h - dh) / 2, dw, dh);
  const data = ctx.getImageData(0, 0, w, h).data;
  const D = new Float32Array(w * h);
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    const a = data[j + 3] / 255;
    let l = (0.2126 * data[j] + 0.7152 * data[j + 1] + 0.0722 * data[j + 2]) / 255;
    l = l * a + (mode === 'dark' ? 1 : 0) * (1 - a);
    const v = mode === 'dark' ? 1 - l : l;
    D[i] = Math.pow(Math.max(0, v), gamma);
  }
  if (edge > 0) addEdges(D, w, h, edge);
  if (floor > 0) for (let i = 0; i < D.length; i++) D[i] = D[i] < floor ? 0 : (D[i] - floor) / (1 - floor);
  if (mask) for (const m of mask) {
    const x0 = Math.floor(m[0] * w), y0 = Math.floor(m[1] * h), x1 = Math.ceil(m[2] * w), y1 = Math.ceil(m[3] * h);
    for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) D[y * w + x] = 0;
  }
  if (maskPolys) for (const poly of maskPolys) {
    let u0 = 1, v0 = 1, u1 = 0, v1 = 0;
    for (const [u, v] of poly) { if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
    const xa = Math.max(0, Math.floor(u0 * w)), xb = Math.min(w - 1, Math.ceil(u1 * w)), ya = Math.max(0, Math.floor(v0 * h)), yb = Math.min(h - 1, Math.ceil(v1 * h));
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
      if (inPoly((x + 0.5) / w, (y + 0.5) / h, poly)) D[y * w + x] = 0;
    }
  }
  return { D, w, h };
}

function inPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Emphasise contours so outlines survive the stippling (engraving style).
function addEdges(D, w, h, k) {
  const E = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = D[i + 1] - D[i - 1] + 0.5 * (D[i + 1 - w] - D[i - 1 - w] + D[i + 1 + w] - D[i - 1 + w]);
    const gy = D[i + w] - D[i - w] + 0.5 * (D[i + w + 1] - D[i - w + 1] + D[i + w - 1] - D[i - w - 1]);
    E[i] = Math.min(1, Math.hypot(gx, gy));
  }
  for (let i = 0; i < w * h; i++) D[i] = Math.min(1, D[i] + k * E[i]);
}

// Lloyd relaxation on a raster, with a uniform grid for nearest-point lookup.
function relax(D, w, h, N, { iters = 30, seed = 3, threshold = 0.0 } = {}) {
  const r = rng(seed);
  // Initial placement by rejection sampling on density.
  let maxD = 0; for (let i = 0; i < D.length; i++) if (D[i] > maxD) maxD = D[i];
  const X = new Float32Array(N), Y = new Float32Array(N);
  let n = 0, guard = 0;
  while (n < N && guard < N * 2000) {
    guard++;
    const x = r() * w, y = r() * h;
    const d = D[(y | 0) * w + (x | 0)];
    if (d > threshold && r() * maxD < d) { X[n] = x; Y[n] = y; n++; }
  }
  if (n < N) throw new Error(`stipple: density too low for ${N} points (placed ${n}); lower N or the plate's floor`);

  const cell = Math.max(2, Math.sqrt((w * h) / N));
  const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
  const head = new Int32Array(gw * gh); const next = new Int32Array(N);
  const sx = new Float64Array(N), sy = new Float64Array(N), sw = new Float64Array(N);

  for (let it = 0; it < iters; it++) {
    head.fill(-1);
    for (let i = 0; i < N; i++) {
      const cx = Math.min(gw - 1, Math.max(0, (X[i] / cell) | 0)), cy = Math.min(gh - 1, Math.max(0, (Y[i] / cell) | 0));
      const c = cy * gw + cx; next[i] = head[c]; head[c] = i;
    }
    sx.fill(0); sy.fill(0); sw.fill(0);
    const step = it < iters - 6 ? 2 : 1;   // coarse raster early, full resolution for the last iterations
    for (let y = 0; y < h; y += step) {
      const gy0 = (y / cell) | 0;
      for (let x = 0; x < w; x += step) {
        const d = D[y * w + x]; if (d <= 0) continue;
        const gx0 = (x / cell) | 0;
        let best = -1, bd = Infinity;
        for (let ring = 0; ring < 64; ring++) {
          // Scan the square ring at Chebyshev distance `ring` around the cell.
          for (let gy = gy0 - ring; gy <= gy0 + ring; gy++) {
            if (gy < 0 || gy >= gh) continue;
            const onEdgeY = gy === gy0 - ring || gy === gy0 + ring;
            for (let gx = gx0 - ring; gx <= gx0 + ring; gx++) {
              if (gx < 0 || gx >= gw) continue;
              if (!onEdgeY && gx !== gx0 - ring && gx !== gx0 + ring) continue;
              for (let k = head[gy * gw + gx]; k !== -1; k = next[k]) {
                const dx = X[k] - x, dy = Y[k] - y; const dd = dx * dx + dy * dy;
                if (dd < bd) { bd = dd; best = k; }
              }
            }
          }
          if (best !== -1 && Math.sqrt(bd) < ring * cell) break;
        }
        if (best !== -1) { sx[best] += x * d; sy[best] += y * d; sw[best] += d; }
      }
    }
    for (let i = 0; i < N; i++) if (sw[i] > 0) { X[i] = sx[i] / sw[i]; Y[i] = sy[i] / sw[i]; }
  }
  return { X, Y };
}

// Density at point positions (used to modulate dot radius and opacity).
function sampleAt(D, w, h, X, Y) {
  const V = new Float32Array(X.length);
  for (let i = 0; i < X.length; i++) {
    const x = Math.min(w - 1, Math.max(0, X[i] | 0)), y = Math.min(h - 1, Math.max(0, Y[i] | 0));
    V[i] = D[y * w + x];
  }
  return V;
}

function finishSet(D, w, h, X, Y, N) {
  const V = sampleAt(D, w, h, X, Y);
  const out = { n: N, x: new Float32Array(N), y: new Float32Array(N), v: V, aspect: w / h };
  for (let i = 0; i < N; i++) { out.x[i] = X[i] / w; out.y[i] = Y[i] / h; }
  return out;
}

// Public entry: returns { n, x, y, v, aspect } with x, y normalised to 0..1 of the (cropped) map.
// The cache is keyed by the plate's content and the options, so copies of a piece reuse it.
async function stippleImage(src, N, opts = {}) {
  const { mask, maskPolys, crop, mode, gamma, edge, floor, w, h, iters, seed, fit } = opts;
  const key = sha1(JSON.stringify({ c: contentKey(src), N, o: { mask, maskPolys, crop, mode, gamma, edge, floor, w, h, iters, seed, fit } })).slice(0, 20);
  const cacheFile = path.join(CACHE_DIR, `stipple-${N}-${key}.bin`);
  if (fs.existsSync(cacheFile)) return readPts(cacheFile);
  const map = await densityFromImage(src, opts);
  const { X, Y } = relax(map.D, map.w, map.h, N, opts);
  const out = finishSet(map.D, map.w, map.h, X, Y, N);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  writePts(cacheFile, out);
  return out;
}

// Stipple an arbitrary density function fn(u, v) → 0..1 (procedural shapes without an image).
function stippleFn(fn, N, { w = 540, h = 960, iters = 30, seed = 3, cacheKey = null } = {}) {
  let cacheFile = null;
  if (cacheKey) {
    cacheFile = path.join(CACHE_DIR, `stipplefn-${cacheKey}-${N}-${w}x${h}-${iters}-${seed}.bin`);
    if (fs.existsSync(cacheFile)) return readPts(cacheFile);
  }
  const D = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) D[y * w + x] = Math.max(0, Math.min(1, fn(x / w, y / h)));
  const { X, Y } = relax(D, w, h, N, { iters, seed });
  const out = finishSet(D, w, h, X, Y, N);
  if (cacheFile) { fs.mkdirSync(CACHE_DIR, { recursive: true }); writePts(cacheFile, out); }
  return out;
}

function writePts(file, p) {
  const buf = Buffer.alloc(8 + p.n * 12);
  buf.writeUInt32LE(p.n, 0); buf.writeFloatLE(p.aspect || 1, 4);
  for (let i = 0; i < p.n; i++) { buf.writeFloatLE(p.x[i], 8 + i * 12); buf.writeFloatLE(p.y[i], 12 + i * 12); buf.writeFloatLE(p.v[i], 16 + i * 12); }
  fs.writeFileSync(file, buf);
}
function readPts(file) {
  const buf = fs.readFileSync(file); const n = buf.readUInt32LE(0); const aspect = buf.readFloatLE(4);
  const p = { n, x: new Float32Array(n), y: new Float32Array(n), v: new Float32Array(n), aspect };
  for (let i = 0; i < n; i++) { p.x[i] = buf.readFloatLE(8 + i * 12); p.y[i] = buf.readFloatLE(12 + i * 12); p.v[i] = buf.readFloatLE(16 + i * 12); }
  return p;
}

// Hilbert-curve index: locality-preserving order. Two point sets sorted this way pair index i with index i
// and their dots travel to nearby places, so a morph flows like a swarm instead of every dot crossing the frame.
function hilbertIndex(x, y, order = 1 << 12) {
  let rx, ry, d = 0; let s = order >> 1;
  let X = Math.floor(x * (order - 1)), Y = Math.floor(y * (order - 1));
  for (; s > 0; s >>= 1) {
    rx = (X & s) > 0 ? 1 : 0; ry = (Y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) { if (rx === 1) { X = s - 1 - X; Y = s - 1 - Y; } const t = X; X = Y; Y = t; }
  }
  return d;
}
function hilbertOrder(p, aspect = 1) {
  const order = new Array(p.n);
  for (let i = 0; i < p.n; i++) order[i] = i;
  const keys = new Float64Array(p.n);
  const ax = aspect >= 1 ? 1 : aspect, ay = aspect >= 1 ? 1 / aspect : 1;
  for (let i = 0; i < p.n; i++) keys[i] = hilbertIndex(Math.min(1, p.x[i] * ax), Math.min(1, p.y[i] * ay));
  order.sort((a, b) => keys[a] - keys[b]);
  return order;
}
function reorder(p, order) {
  const q = { n: p.n, x: new Float32Array(p.n), y: new Float32Array(p.n), v: new Float32Array(p.n), aspect: p.aspect };
  for (let i = 0; i < p.n; i++) { const k = order[i]; q.x[i] = p.x[k]; q.y[i] = p.y[k]; q.v[i] = p.v[k]; }
  return q;
}
// Resample a set to exactly N points (repeat or drop evenly), keeping its order.
function resample(p, N) {
  const q = { n: N, x: new Float32Array(N), y: new Float32Array(N), v: new Float32Array(N), aspect: p.aspect };
  for (let i = 0; i < N; i++) { const k = Math.min(p.n - 1, Math.floor(i * p.n / N)); q.x[i] = p.x[k]; q.y[i] = p.y[k]; q.v[i] = p.v[k]; }
  return q;
}
function hilbertSorted(p, N = p.n) {
  const s = reorder(p, hilbertOrder(p, p.aspect || 1));
  return N === p.n ? s : resample(s, N);
}

module.exports = { densityFromImage, relax, stippleImage, stippleFn, hilbertSorted, hilbertOrder, reorder, resample, readPts, writePts, inPoly, CACHE_DIR };
