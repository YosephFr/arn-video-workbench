// Deterministic math shared by every scene. Everything is a pure function of time, so any frame renders in isolation
// (workers render disjoint frame ranges and a still at t is identical to frame t × fps of the video).

export const TAU = Math.PI * 2

export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x)
export const lerp = (a, b, t) => a + (b - a) * t
export const invLerp = (a, b, x) => clamp((x - a) / (b - a))
export const smoothstep = (a, b, x) => { const t = invLerp(a, b, x); return t * t * (3 - 2 * t) }
export const smootherstep = (a, b, x) => { const t = invLerp(a, b, x); return t * t * t * (t * (t * 6 - 15) + 10) }
export const fract = (x) => x - Math.floor(x)

// CSS-style cubic-bezier easing, solved with Newton iterations.
export function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by
  const sx = (t) => ((ax * t + bx) * t + cx) * t
  const sy = (t) => ((ay * t + by) * t + cy) * t
  const dsx = (t) => (3 * ax * t + 2 * bx) * t + cx
  return (x) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let t = x
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x; const d = dsx(t)
      if (Math.abs(e) < 1e-6 || Math.abs(d) < 1e-6) break
      t -= e / d
    }
    return sy(clamp(t))
  }
}

export const ease = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outQuart: (t) => 1 - Math.pow(1 - t, 4),
  inOutQuart: (t) => (t < 0.5 ? 8 * t ** 4 : 1 - Math.pow(-2 * t + 2, 4) / 2),
  outQuint: (t) => 1 - Math.pow(1 - t, 5),
  inOutQuint: (t) => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2),
  outExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inOutExpo: (t) => (t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2),
  outBack: (t, s = 1.70158) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2),
  inBack: (t, s = 1.70158) => (s + 1) * t * t * t - s * t * t,
  // The house curve: a fast start and a long, soft landing. Used for anything that "arrives".
  brand: cubicBezier(0.16, 1, 0.3, 1),
}

/** Damped spring response to a unit step at time 0 (t in seconds): 0 → overshoot → 1. */
export function spring(t, freq = 2.2, damping = 0.45) {
  if (t <= 0) return 0
  const w = TAU * freq; const z = damping
  if (z >= 1) return 1 - Math.exp(-w * t) * (1 + w * t)
  const wd = w * Math.sqrt(1 - z * z)
  return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t))
}

/** Seeded PRNG (mulberry32) for stable per-element randomness. */
export function rng(seed = 1) {
  let s = seed >>> 0
  const f = () => {
    s = (s + 0x6D2B79F5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  f.range = (a, b) => a + (b - a) * f()
  return f
}

export function hash(n) {
  let x = (n | 0) ^ 0x9e3779b9
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b)
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35)
  x ^= x >>> 16
  return (x >>> 0) / 4294967296
}

/** Eased progress of the window [a, a + d]. */
export const prog = (t, a, d, e = 'outCubic') => (ease[e] || ease.outCubic)(clamp((t - a) / d))

/** 0 → 1 → 0 window with soft edges: 1 inside [a, b]. */
export const windowed = (t, a, b, fin = 0.3, fout = 0.3) => Math.min(smoothstep(a - fin, a, t), 1 - smoothstep(b, b + fout, t))

/** Keyframe envelope: keys = [[time, value, easeName?], ...] sorted by time. */
export function env(t, keys) {
  if (t <= keys[0][0]) return keys[0][1]
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, e] = keys[i]
    if (t <= t1) {
      const [t0, v0] = keys[i - 1]
      return lerp(v0, v1, (ease[e] || ease.inOutCubic)((t - t0) / (t1 - t0)))
    }
  }
  return keys[keys.length - 1][1]
}
