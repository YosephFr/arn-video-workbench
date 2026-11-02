'use strict';
// Deterministic math helpers shared by every scene. Everything is a pure function of time, so any frame
// can be rendered on its own, in any order, by any worker process.

const TAU = Math.PI * 2;

const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const invLerp = (a, b, x) => clamp((x - a) / (b - a));
const remap = (x, a0, a1, b0, b1, ease = (t) => t) => lerp(b0, b1, ease(invLerp(a0, a1, x)));
const smoothstep = (a, b, x) => { const t = invLerp(a, b, x); return t * t * (3 - 2 * t); };
const smootherstep = (a, b, x) => { const t = invLerp(a, b, x); return t * t * t * (t * (t * 6 - 15) + 10); };
const fract = (x) => x - Math.floor(x);
const mix = lerp;

// CSS-style cubic-bezier easing, solved with Newton iterations.
function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  const sy = (t) => ((ay * t + by) * t + cy) * t;
  const dsx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0; if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x; const d = dsx(t);
      if (Math.abs(e) < 1e-6 || Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    return sy(clamp(t));
  };
}

// Easing curves (usual names). `burst` is a snappy organic move: a quick start and a long settle.
// `brand` is the cubic-bezier(.16, 1, .3, 1) curve used for logo reveals.
const ease = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  inQuart: (t) => t * t * t * t,
  outQuart: (t) => 1 - Math.pow(1 - t, 4),
  inOutQuart: (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2),
  outQuint: (t) => 1 - Math.pow(1 - t, 5),
  inOutQuint: (t) => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2),
  inExpo: (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  outExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inOutExpo: (t) => (t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2),
  outBack: (t, s = 1.70158) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2),
  inBack: (t, s = 1.70158) => (s + 1) * t * t * t - s * t * t,
  outElastic: (t) => (t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1),
  burst: (t) => 1 - Math.pow(1 - t, 3.2) * (1 - 0.15 * Math.sin(t * Math.PI)),
  brand: (t) => BRAND(t),
};
const BRAND = cubicBezier(0.16, 1, 0.3, 1);

// Damped spring response to a unit step at time 0 (t in seconds).
function spring(t, freq = 2.2, damping = 0.45) {
  if (t <= 0) return 0;
  const w = TAU * freq; const z = damping;
  if (z >= 1) return 1 - Math.exp(-w * t) * (1 + w * t);
  const wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t));
}

// Seeded PRNG (mulberry32) and integer hashing: stable per-element randomness, identical in every worker.
function rng(seed = 1) {
  let s = seed >>> 0;
  const f = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (a, b) => a + (b - a) * f();
  f.int = (a, b) => Math.floor(a + (b - a + 1) * f());
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  f.gauss = () => { let u = 0, v = 0; while (u === 0) u = f(); while (v === 0) v = f(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); };
  return f;
}
function hash(n) {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
function hash2(a, b) { return hash((a | 0) * 73856093 ^ (b | 0) * 19349663); }

// Keyframe envelope: keys = [[time, value, easeName?], ...] sorted by time.
function env(t, keys) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, e] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      const f = ease[e || 'inOutCubic'] || ease.inOutCubic;
      return lerp(v0, v1, f((t - t0) / (t1 - t0)));
    }
  }
  return keys[keys.length - 1][1];
}

// Progress of a beat window [a, a + d], eased.
const beat = (t, a, d, e = 'inOutCubic') => (ease[e] || ease.inOutCubic)(clamp((t - a) / d));
// 0 → 1 → 0 window with fades (in/out durations).
const windowed = (t, a, b, fin = 0.3, fout = 0.3) => Math.min(smoothstep(a, a + fin, t), 1 - smoothstep(b - fout, b, t));

// Hand-drawn "on twos/threes": quantise time to a lower rate so line jitter changes like drawn frames
// (12 per second) while the camera keeps moving smoothly at the output frame rate.
const BOIL_FPS = 12;
const boilTime = (t, fps = BOIL_FPS) => Math.floor(t * fps) / fps;
const boilIndex = (t, fps = BOIL_FPS) => Math.floor(t * fps);

// '#rrggbb' → [r, g, b] in 0..1 (dot layers work in floats).
function rgb01(hex) {
  const h = String(hex).replace('#', '');
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}
// '#rrggbb' → 'r,g,b' (0..255) for rgba() strings.
function rgbStr(hex) { return rgb01(hex).map((v) => Math.round(v * 255)).join(','); }
// Mix two hex colours (k = 0 → a, 1 → b) and return hex.
function mixHex(a, b, k) {
  const A = rgb01(a), B = rgb01(b);
  return '#' + A.map((v, i) => Math.round(lerp(v, B[i], k) * 255).toString(16).padStart(2, '0')).join('');
}
// Relative luminance (sRGB), used to pick readable text on a colour.
function luminance(hex) {
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const [r, g, b] = rgb01(hex).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

module.exports = {
  TAU, clamp, lerp, invLerp, remap, smoothstep, smootherstep, fract, mix,
  ease, cubicBezier, spring, rng, hash, hash2, env, beat, windowed, BOIL_FPS, boilTime, boilIndex,
  rgb01, rgbStr, mixHex, luminance,
};
