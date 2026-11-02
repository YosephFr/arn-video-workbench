// Weighted Voronoi stippling (after Secord, "Weighted Voronoi Stippling", NPAR 2002).
// A density map (0..1 per pixel) becomes N well-spaced dots whose local density follows the tone: the engraving
// look of the particle scenes. Then the dots are put in Hilbert-curve order, so dot i of one set pairs naturally with
// dot i of another and morphs flow instead of crossing.
import fs from 'node:fs'

// mulberry32: a small seeded PRNG, so the same plate always gives the same dots
function rng(seed = 1) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6D2B79F5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Tone shaping before stippling: gamma, contour emphasis (so outlines survive), a floor that drops faint noise,
// and masked rectangles (normalised [x0, y0, x1, y1]) that get no dots, such as a phone screen drawn on top.
export function shape(D, w, h, { gamma = 1, edge = 0, floor = 0, mask = null } = {}) {
  if (gamma !== 1) for (let i = 0; i < D.length; i++) D[i] = Math.pow(Math.max(0, D[i]), gamma)
  if (edge > 0) {
    const E = new Float32Array(w * h)
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const gx = D[i + 1] - D[i - 1] + 0.5 * (D[i + 1 - w] - D[i - 1 - w] + D[i + 1 + w] - D[i - 1 + w])
      const gy = D[i + w] - D[i - w] + 0.5 * (D[i + w + 1] - D[i - w + 1] + D[i + w - 1] - D[i - w - 1])
      E[i] = Math.min(1, Math.hypot(gx, gy))
    }
    for (let i = 0; i < w * h; i++) D[i] = Math.min(1, D[i] + edge * E[i])
  }
  if (floor > 0) for (let i = 0; i < D.length; i++) D[i] = D[i] < floor ? 0 : (D[i] - floor) / (1 - floor)
  if (mask) for (const m of mask) {
    const x0 = Math.floor(m[0] * w), y0 = Math.floor(m[1] * h), x1 = Math.ceil(m[2] * w), y1 = Math.ceil(m[3] * h)
    for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) D[y * w + x] = 0
  }
  return D
}

// Lloyd relaxation on the raster: each dot moves to the density-weighted centroid of the pixels nearest to it.
// A uniform grid makes the nearest-dot search cheap; early iterations use every other pixel.
export function relax(D, w, h, N, { iters = 26, seed = 5 } = {}) {
  const r = rng(seed)
  let maxD = 0
  for (let i = 0; i < D.length; i++) if (D[i] > maxD) maxD = D[i]
  if (maxD <= 0) throw new Error('stipple: the plate is empty (no tone to place dots on)')
  const X = new Float32Array(N), Y = new Float32Array(N)
  let n = 0, guard = 0
  while (n < N && guard < N * 4000) {   // initial placement by rejection sampling on the density
    guard++
    const x = r() * w, y = r() * h, d = D[(y | 0) * w + (x | 0)]
    if (d > 0 && r() * maxD < d) { X[n] = x; Y[n] = y; n++ }
  }
  if (n < N) throw new Error(`stipple: density too low for ${N} dots (placed ${n}); lower n or raise the plate's contrast`)
  const cell = Math.max(2, Math.sqrt((w * h) / N))
  const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell)
  const head = new Int32Array(gw * gh), next = new Int32Array(N)
  const sx = new Float64Array(N), sy = new Float64Array(N), sw = new Float64Array(N)
  for (let it = 0; it < iters; it++) {
    head.fill(-1)
    for (let i = 0; i < N; i++) {
      const cx = Math.min(gw - 1, Math.max(0, (X[i] / cell) | 0)), cy = Math.min(gh - 1, Math.max(0, (Y[i] / cell) | 0))
      const c = cy * gw + cx; next[i] = head[c]; head[c] = i
    }
    sx.fill(0); sy.fill(0); sw.fill(0)
    const step = it < iters - 6 ? 2 : 1
    for (let y = 0; y < h; y += step) {
      const gy0 = (y / cell) | 0
      for (let x = 0; x < w; x += step) {
        const d = D[y * w + x]; if (d <= 0) continue
        const gx0 = (x / cell) | 0
        let best = -1, bd = Infinity
        for (let ring = 0; ring < 64; ring++) {   // scan square rings of cells around (x, y) until the best is certain
          for (let gy = gy0 - ring; gy <= gy0 + ring; gy++) {
            if (gy < 0 || gy >= gh) continue
            const edgeY = gy === gy0 - ring || gy === gy0 + ring
            for (let gx = gx0 - ring; gx <= gx0 + ring; gx++) {
              if (gx < 0 || gx >= gw) continue
              if (!edgeY && gx !== gx0 - ring && gx !== gx0 + ring) continue
              for (let k = head[gy * gw + gx]; k !== -1; k = next[k]) {
                const dx = X[k] - x, dy = Y[k] - y, dd = dx * dx + dy * dy
                if (dd < bd) { bd = dd; best = k }
              }
            }
          }
          if (best !== -1 && Math.sqrt(bd) < ring * cell) break
        }
        if (best !== -1) { sx[best] += x * d; sy[best] += y * d; sw[best] += d }
      }
    }
    for (let i = 0; i < N; i++) if (sw[i] > 0) { X[i] = sx[i] / sw[i]; Y[i] = sy[i] / sw[i] }
  }
  // each dot's tone, used for its radius and alpha
  const V = new Float32Array(N)
  for (let i = 0; i < N; i++) V[i] = D[Math.min(h - 1, Math.max(0, Y[i] | 0)) * w + Math.min(w - 1, Math.max(0, X[i] | 0))]
  const out = { n: N, x: new Float32Array(N), y: new Float32Array(N), v: V, aspect: w / h }
  for (let i = 0; i < N; i++) { out.x[i] = X[i] / w; out.y[i] = Y[i] / h }
  return out
}

function hilbertIndex(x, y, order = 1 << 12) {
  let rx, ry, d = 0
  let X = Math.floor(x * (order - 1)), Y = Math.floor(y * (order - 1))
  for (let s = order >> 1; s > 0; s >>= 1) {
    rx = (X & s) > 0 ? 1 : 0; ry = (Y & s) > 0 ? 1 : 0
    d += s * s * ((3 * rx) ^ ry)
    if (ry === 0) { if (rx === 1) { X = s - 1 - X; Y = s - 1 - Y } const t = X; X = Y; Y = t }
  }
  return d
}
// reorder a set along a Hilbert curve (aspect-corrected), so neighbours in space are neighbours in the list
export function hilbertSorted(p) {
  const ax = p.aspect >= 1 ? 1 : p.aspect, ay = p.aspect >= 1 ? 1 / p.aspect : 1
  const keys = new Float64Array(p.n)
  for (let i = 0; i < p.n; i++) keys[i] = hilbertIndex(Math.min(1, p.x[i] * ax), Math.min(1, p.y[i] * ay))
  const order = Array.from({ length: p.n }, (_, i) => i).sort((a, b) => keys[a] - keys[b])
  const q = { n: p.n, x: new Float32Array(p.n), y: new Float32Array(p.n), v: new Float32Array(p.n), aspect: p.aspect }
  order.forEach((k, i) => { q.x[i] = p.x[k]; q.y[i] = p.y[k]; q.v[i] = p.v[k] })
  return q
}

// file format: uint32 n, float32 aspect, then n × (x, y, v) float32, little endian
export function writePoints(file, p) {
  const buf = Buffer.alloc(8 + p.n * 12)
  buf.writeUInt32LE(p.n, 0); buf.writeFloatLE(p.aspect || 1, 4)
  for (let i = 0; i < p.n; i++) { buf.writeFloatLE(p.x[i], 8 + i * 12); buf.writeFloatLE(p.y[i], 12 + i * 12); buf.writeFloatLE(p.v[i], 16 + i * 12) }
  fs.writeFileSync(file, buf)
}
