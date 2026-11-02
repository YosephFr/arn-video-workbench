'use strict';
// Plates → stipple point sets, placed in world space and drawn as ink (on paper) or light (in the dark).
// A plate is only a density guide: every dot is computed and drawn by code, frame by frame.
//
// A film declares its plates by name:
//   plates: {
//     hand:  { src: 'procedural:hand-phone', N: 30000, screen: true },       // generated (lib/procedural.js)
//     alex:  { src: 'plates/alex-from-behind.png', N: 26000, crop: [0, 0.15, 1, 0.85] },   // your own photo
//   }
// Options: N (dots), mode 'dark' (dark pixels get dots) | 'light', gamma (>1 thins mid-tones), edge (contour
// emphasis), floor (cuts background haze), crop [x, y, w, h] (all N dots on that part of the plate),
// screen: true (mask the phone screen so its content can be drawn by code), contours (levels or false).
// File plates may carry a sidecar JSON with the same name (tools/plate-from-image.mjs writes it) holding the
// measured screen, a clock dial or named anchors.

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('../core/canvas');
const { stippleImage, hilbertSorted, resample, inPoly } = require('../draw/stipple');
const { clamp, hash, ease, lerp, BOIL_FPS } = require('../core/math');
const { noise } = require('../core/noise');
const { sketch } = require('../draw/ink');
const procedural = require('./procedural');
const { traceContours } = require('./contours');

const BASE = { N: 26000, mode: 'dark', gamma: 1.1, edge: 0.8, floor: 0.04 };
let SPEC = {};
const cache = {};

function register(spec) { SPEC = { ...SPEC, ...spec }; }

function resolveFile(src) {
  const roots = [process.env.WB_PIECE, process.env.WB_BENCH, process.env.WB_ENGINE_BENCH].filter(Boolean);
  if (path.isAbsolute(src)) return src;
  for (const r of roots) { const p = path.join(r, src); if (fs.existsSync(p)) return p; }
  throw new Error(`plate file not found: ${src} (looked in the piece and the bench). Make it with tools/plate-from-image.mjs.`);
}

// Source image + meta for a spec.
async function source(name, o) {
  if (String(o.src).startsWith('procedural:')) {
    const r = procedural.make(o.src.slice('procedural:'.length), o.params || {});
    return { img: r.canvas, meta: r.meta || {} };
  }
  const file = resolveFile(o.src);
  const side = file.replace(/\.[a-z0-9]+$/i, '.json');
  const meta = fs.existsSync(side) ? JSON.parse(fs.readFileSync(side, 'utf8')) : {};
  return { img: await loadImage(fs.readFileSync(file)), meta };
}

// Corners of a (rotated) normalised rectangle, in normalised plate coordinates (rotation done in pixels).
function rectCorners(r, W, H, grow = 1) {
  const c = Math.cos(r.rot || 0), s = Math.sin(r.rot || 0); const out = [];
  for (const [x, y] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
    const px = x * r.w * W * grow, py = y * r.h * H * grow;
    out.push([r.cx + (px * c - py * s) / W, r.cy + (px * s + py * c) / H]);
  }
  return out;
}

async function loadPlates(names = Object.keys(SPEC)) {
  for (const name of names) {
    if (cache[name]) continue;
    const spec = SPEC[name]; if (!spec) throw new Error(`plate "${name}" is not declared in the film's plates`);
    const o = { ...BASE, ...spec };
    const { img, meta } = await source(name, o);
    // Work on the cropped region at native resolution: the stipple and the contours both read it.
    const [cx0, cy0, cw, ch] = o.crop || [0, 0, 1, 1];
    const sw = Math.round(img.width * cw), sh = Math.round(img.height * ch);
    const cv = createCanvas(sw, sh); const cctx = cv.getContext('2d');
    cctx.fillStyle = o.mode === 'light' ? '#000' : '#fff'; cctx.fillRect(0, 0, sw, sh);
    cctx.drawImage(img, img.width * cx0, img.height * cy0, sw, sh, 0, 0, sw, sh);
    const toCrop = ([u, v]) => [(u - cx0) / cw, (v - cy0) / ch];
    let screen = null;
    if (meta.screen) {
      const s = meta.screen; const [u, v] = toCrop([s.cx, s.cy]);
      screen = { cx: u, cy: v, w: s.w / cw, h: s.h / ch, rot: s.rot || 0 };
    }
    const opts = { w: 480, h: Math.round(480 * sh / sw), mode: o.mode, gamma: o.gamma, edge: o.edge, floor: o.floor, iters: o.iters || 30 };
    if (o.screen && screen) opts.maskPolys = [rectCorners(screen, sw, sh, 1.012)];
    const raw = await stippleImage(cv, o.N, opts);
    const anchors = {};
    for (const [k, uv] of Object.entries(meta.anchors || {})) anchors[k] = toCrop(uv);
    let dial = null;
    if (meta.dial) { const [u, v] = toCrop([meta.dial.cx, meta.dial.cy]); dial = { cx: u, cy: v, r: meta.dial.r / ch }; }
    cache[name] = { name, pts: hilbertSorted(raw), aspect: raw.aspect, screen, dial, anchors, img: cv, spec: o, contours: null };
  }
  return cache;
}
const plate = (name) => { if (!cache[name]) throw new Error(`plate not loaded: ${name}`); return cache[name]; };

// Place a plate: centre (cx, cy) and height h in world px; n resamples to an exact dot count (morph pairs
// must share n); flip mirrors it. Returns world arrays plus the screen / dial / anchors in world units.
function place(p, { cx = 540, cy = 960, h = 1920, n = null, flip = false } = {}) {
  const src = n && n !== p.pts.n ? resample(p.pts, n) : p.pts;
  const w = h * p.aspect; const N = src.n; const sg = flip ? -1 : 1;
  const X = new Float32Array(N), Y = new Float32Array(N);
  for (let i = 0; i < N; i++) { X[i] = cx + sg * (src.x[i] - 0.5) * w; Y[i] = cy + (src.y[i] - 0.5) * h; }
  const at = (u, v) => [cx + sg * (u - 0.5) * w, cy + (v - 0.5) * h];
  let screen = null;
  if (p.screen) {
    const s = p.screen; const [sx, sy] = at(s.cx, s.cy); const ww = s.w * w, hh = s.h * h;
    screen = { cx: sx, cy: sy, w: ww, h: hh, rot: flip ? -s.rot : s.rot, x0: sx - ww / 2, x1: sx + ww / 2, y0: sy - hh / 2, y1: sy + hh / 2 };
  }
  let dial = null;
  if (p.dial) { const [dx, dy] = at(p.dial.cx, p.dial.cy); dial = { cx: dx, cy: dy, r: p.dial.r * h }; }
  const anchors = {}; for (const [k, [u, v]] of Object.entries(p.anchors)) anchors[k] = at(u, v);
  return { n: N, X, Y, V: src.v, screen, dial, anchors, cx, cy, h, w, flip, plate: p, at };
}

// Draw a placed set. o:
//   mode 'ink'|'light', col [r,g,b], alpha, r0/r1 (radius range by density), t, seed, boil (px jitter on drawn
//   frames), appear 0..1 (dots arrive darkest first, like an engraver), from {x, y, spread} (arrival origin),
//   fade 0..1 (dots leave in random order), wind (they blow away while fading), gain (light intensity),
//   tint(i, x, y) → colour per dot, clip {x0,y0,x1,y1} (world rect to skip), skip (Set of indices),
//   screenR (constant on-screen dot size while zooming).
function drawSet(f, S, o = {}) {
  const { mode = 'ink', col = [0.11, 0.1, 0.085], alpha = 1, r0 = 0.9, r1 = 2.4, appear = 1, t = f.t, boil = 0.55, seed = 1, fade = 0, from = null, tint = null, clip = null, wind = 0, gain = 1, skip = null, screenR = false } = o;
  if (alpha <= 0.003) return;
  const rz = screenR ? 1 / f.cam.z : 1;
  const bi = Math.floor(t * BOIL_FPS); const N = S.n; const light = mode === 'light';
  for (let i = 0; i < N; i++) {
    const v = S.V[i];
    let x = S.X[i], y = S.Y[i];
    if (clip && x > clip.x0 && x < clip.x1 && y > clip.y0 && y < clip.y1) continue;
    if (skip && skip.has(i)) continue;
    let a = alpha;
    if (appear < 1) {
      const th = (1 - v) * 0.7 + hash(i * 3 + seed) * 0.3;
      const k = clamp((appear * 1.25 - th) / 0.25);
      if (k <= 0) continue;
      if (from) {
        const e = ease.outCubic(k);
        const sx = from.x + (hash(i * 7 + seed) - 0.5) * from.spread, sy = from.y + (hash(i * 11 + seed) - 0.5) * from.spread;
        x = lerp(sx, x, e); y = lerp(sy, y, e);
      }
      a *= k;
    }
    if (fade > 0) {
      const th = hash(i * 5 + seed * 3);
      const k = clamp((fade * 1.3 - th) / 0.3);
      if (k >= 1) continue;
      if (wind) { x += wind * k * k * 120 * (0.5 + hash(i)); y -= k * k * 60 * hash(i * 2); }
      a *= 1 - k;
    }
    const jx = (hash(i * 13 + bi * 7919) - 0.5) * 2 * boil, jy = (hash(i * 17 + bi * 104729) - 0.5) * 2 * boil;
    const r = (r0 + (r1 - r0) * v) * rz;
    const c = tint ? tint(i, x, y) : col;
    if (light) f.dotLight(x + jx, y + jy, r, a * (0.35 + 0.65 * v) * gain, c);
    else f.dotInk(x + jx, y + jy, r, a * (0.55 + 0.45 * v), c);
  }
}

// Draw a placed set moved rigidly: rotate by rot around its centre, scale, then translate by (dx, dy).
const _xf = {};
function drawSetXf(f, S, { dx = 0, dy = 0, rot = 0, scale = 1, key = 'xf', ...o } = {}) {
  let T = _xf[key]; if (!T || T.n !== S.n) T = _xf[key] = { n: S.n, X: new Float32Array(S.n), Y: new Float32Array(S.n), V: S.V };
  T.V = S.V;
  const c = Math.cos(rot) * scale, s = Math.sin(rot) * scale;
  for (let i = 0; i < S.n; i++) { const x = S.X[i] - S.cx, y = S.Y[i] - S.cy; T.X[i] = S.cx + dx + x * c - y * s; T.Y[i] = S.cy + dy + x * s + y * c; }
  T.cx = S.cx + dx; T.cy = S.cy + dy;
  drawSet(f, T, o);
}

// Morph between two placed sets of the same size (place both with the same n). p 0..1. Each dot leaves on
// its own (stagger), travels with a curl-noise swirl that peaks mid-flight, and takes the target's tone.
function drawMorph(f, A, B, p, o = {}) {
  const { mode = 'ink', col = [0.11, 0.1, 0.085], colB = null, alpha = 1, r0 = 0.9, r1 = 2.4, swirl = 60, t = f.t, boil = 0.55, stagger = 0.35, gainA = 1, gainB = 1, screenR = false, tint = null } = o;
  const rz = screenR ? 1 / f.cam.z : 1;
  const N = Math.min(A.n, B.n); const bi = Math.floor(t * BOIL_FPS); const light = mode === 'light';
  for (let i = 0; i < N; i++) {
    const d = hash(i * 29 + 5) * stagger;
    const k = ease.inOutCubic(clamp((p - d) / (1 - stagger)));
    let x = lerp(A.X[i], B.X[i], k), y = lerp(A.Y[i], B.Y[i], k);
    const m = Math.sin(Math.PI * k);
    if (m > 0.01 && swirl) { const c = noise.curl2(x * 0.004, y * 0.004, i * 0.001 + t * 0.2); x += c[0] * swirl * m; y += c[1] * swirl * m; }
    const v = lerp(A.V[i], B.V[i], k);
    const jx = (hash(i * 13 + bi * 7919) - 0.5) * 2 * boil, jy = (hash(i * 17 + bi * 104729) - 0.5) * 2 * boil;
    const r = (r0 + (r1 - r0) * v) * rz;
    const c = tint ? tint(i, k) : colB ? [lerp(col[0], colB[0], k), lerp(col[1], colB[1], k), lerp(col[2], colB[2], k)] : col;
    if (light) f.dotLight(x + jx, y + jy, r, alpha * (0.35 + 0.65 * v) * lerp(gainA, gainB, k), c);
    else f.dotInk(x + jx, y + jy, r, alpha * (0.55 + 0.45 * v), c);
  }
}

// Pencil contours of a placed set (traced from its plate on first use). c: a 2D context with the camera
// applied. progress 0..1 draws them on, longest first. colorOf(poly) → null to skip it, or { color, alpha }.
function contoursOf(p) {
  if (!p.contours) {
    const levels = Array.isArray(p.spec.contours) ? p.spec.contours : p.spec.mode === 'light' ? [0.2, 0.42] : [0.42, 0.72];
    p.contours = p.spec.contours === false ? [] : traceContours(p.img, { levels, exclude: p.screen ? [p.screen] : [] });
  }
  return p.contours;
}
function drawContours(c, S, { t = 0, color = '#1d1a16', width = 2.2, alpha = 0.75, progress = 1, max = 60, boil = 1.2, seed = 7, light = false, colorOf = null } = {}) {
  if (alpha <= 0.01 || progress <= 0) return;
  const polys = contoursOf(S.plate).slice(0, max);
  const sg = S.flip ? -1 : 1;
  polys.forEach((p, k) => {
    const pts = p.pts.map(([u, v]) => [S.cx + sg * (u - 0.5) * S.w, S.cy + (v - 0.5) * S.h]);
    const pr = clamp(progress * 1.4 - (k / Math.max(1, polys.length)) * 0.4);
    if (pr <= 0) return;
    const w = width * (p.lv > 0.6 && !light ? 0.7 : 1);
    let col = color, a = alpha;
    if (colorOf) { const q = colorOf(p); if (!q) return; col = q.color || color; a = alpha * (q.alpha == null ? 1 : q.alpha); }
    if (a <= 0.01) return;
    sketch(c, pts, { width: w, color: col, alpha: a * (light ? 0.8 : 1), t, seed: seed * 97 + k, passes: light ? 1 : 2, boil, progress: pr, taper: 0.12, spacing: 7, pressure: 0.5 });
  });
}

// Dots of a placed set inside a polygon given in plate-normalised coordinates (an object to recolour or to
// fly away on its own).
function dotsInPoly(S, poly) {
  const out = new Set(); const sg = S.flip ? -1 : 1;
  for (let i = 0; i < S.n; i++) if (inPoly(sg * (S.X[i] - S.cx) / S.w + 0.5, (S.Y[i] - S.cy) / S.h + 0.5, poly)) out.add(i);
  return out;
}
const polyShare = (p, poly) => p.pts.filter(([u, v]) => inPoly(u, v, poly)).length / p.pts.length;

// A point set from any canvas (the logo, a word, a shape) using the same stippler.
async function stippleCanvas(cv, N, o = {}) {
  const opts = { w: o.w || 480, h: o.h || Math.round((o.w || 480) * cv.height / cv.width), mode: o.mode || 'dark', gamma: o.gamma ?? 1, edge: o.edge ?? 0.4, floor: o.floor ?? 0.02, iters: o.iters || 30 };
  return hilbertSorted(await stippleImage(cv, N, opts));
}

module.exports = { register, loadPlates, plate, place, drawSet, drawSetXf, drawMorph, drawContours, contoursOf, dotsInPoly, polyShare, inPoly, stippleCanvas, rectCorners, BASE };
