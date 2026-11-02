'use strict';
// Hand-drawn ink and graphite strokes. Geometry is jittered with noise that changes on "boil" frames
// (12 per second), strokes taper like a dip pen, secondary passes drift like a line gone over twice, and any
// path can draw itself on (progress 0..1). Hatching fills give engraving tone.

const { noise } = require('../core/noise');
const { clamp, hash, lerp, BOIL_FPS } = require('../core/math');

// ---------- geometry ----------
function dist(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); }

function polyLength(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]); return L; }

// Resample a polyline at uniform spacing (keeps both ends).
function resample(pts, spacing = 6) {
  if (pts.length < 2) return pts.slice();
  const out = [pts[0].slice()]; let need = spacing;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]; const d = dist(a, b); if (d === 0) continue;
    let pos = 0;
    while (d - pos >= need) { pos += need; const t = pos / d; out.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t)]); need = spacing; }
    need -= d - pos;
  }
  const last = pts[pts.length - 1];
  if (dist(out[out.length - 1], last) > spacing * 0.3) out.push(last.slice());
  return out;
}

function roundRectPts(x, y, w, h, r, seg = 10) {
  r = Math.min(r, w / 2, h / 2);
  const pts = [];
  const corner = (cx, cy, a0) => { for (let i = 0; i <= seg; i++) { const a = a0 + (i / seg) * Math.PI / 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
  corner(x + w - r, y + r, -Math.PI / 2); corner(x + w - r, y + h - r, 0); corner(x + r, y + h - r, Math.PI / 2); corner(x + r, y + r, Math.PI);
  pts.push(pts[0].slice());
  return pts;
}
function ellipsePts(cx, cy, rx, ry, rot = 0, seg = 64, a0 = 0, a1 = Math.PI * 2) {
  const pts = []; const c = Math.cos(rot), s = Math.sin(rot);
  for (let i = 0; i <= seg; i++) { const a = a0 + (a1 - a0) * i / seg; const x = Math.cos(a) * rx, y = Math.sin(a) * ry; pts.push([cx + x * c - y * s, cy + x * s + y * c]); }
  return pts;
}
function linePts(x0, y0, x1, y1) { return [[x0, y0], [x1, y1]]; }

// Minimal SVG path flattener (M L H V C S Q T A Z, absolute and relative) → array of polylines.
function flattenSvgPath(d, tol = 1.5) {
  const toks = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
  let i = 0; const subs = []; let cur = null; let x = 0, y = 0, sx = 0, sy = 0; let lcx = null, lcy = null, lqx = null, lqy = null; let cmd = null;
  const num = () => parseFloat(toks[i++]);
  const push = (px, py) => { cur.push([px, py]); };
  const cubic = (x1, y1, x2, y2, x3, y3) => { const L = Math.hypot(x1 - x, y1 - y) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2); const n = Math.max(2, Math.ceil(L / (tol * 4))); for (let k = 1; k <= n; k++) { const t = k / n, u = 1 - t; push(u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3); } };
  const quad = (x1, y1, x2, y2) => { const L = Math.hypot(x1 - x, y1 - y) + Math.hypot(x2 - x1, y2 - y1); const n = Math.max(2, Math.ceil(L / (tol * 4))); for (let k = 1; k <= n; k++) { const t = k / n, u = 1 - t; push(u * u * x + 2 * u * t * x1 + t * t * x2, u * u * y + 2 * u * t * y1 + t * t * y2); } };
  const arc = (rx, ry, phi, fa, fs, x2, y2) => {
    // Endpoint → centre parameterisation (SVG spec F.6.5).
    const cp = Math.cos(phi), sp = Math.sin(phi);
    const dx = (x - x2) / 2, dy = (y - y2) / 2; const x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy;
    rx = Math.abs(rx); ry = Math.abs(ry); const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry); if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
    const sign = fa === fs ? -1 : 1; const num2 = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p; const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    const co = sign * Math.sqrt(Math.max(0, num2 / den)); const cxp = co * (rx * y1p / ry), cyp = co * (-ry * x1p / rx);
    const cx = cp * cxp - sp * cyp + (x + x2) / 2, cy = sp * cxp + cp * cyp + (y + y2) / 2;
    const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry); let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!fs && dth > 0) dth -= Math.PI * 2; else if (fs && dth < 0) dth += Math.PI * 2;
    const n = Math.max(4, Math.ceil(Math.abs(dth) * Math.max(rx, ry) / (tol * 3)));
    for (let k = 1; k <= n; k++) { const t = th1 + dth * k / n; const ex = rx * Math.cos(t), ey = ry * Math.sin(t); push(cp * ex - sp * ey + cx, sp * ex + cp * ey + cy); }
  };
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase(); const C = cmd.toUpperCase();
    if (C === 'Z') { if (cur && cur.length) push(sx, sy); x = sx; y = sy; lcx = lqx = null; continue; }
    if (C === 'M') { const nx = num() + (rel ? x : 0), ny = num() + (rel ? y : 0); cur = [[nx, ny]]; subs.push(cur); x = sx = nx; y = sy = ny; cmd = rel ? 'l' : 'L'; lcx = lqx = null; continue; }
    if (!cur) { cur = [[x, y]]; subs.push(cur); }
    if (C === 'L') { const nx = num() + (rel ? x : 0), ny = num() + (rel ? y : 0); push(nx, ny); x = nx; y = ny; lcx = lqx = null; }
    else if (C === 'H') { const nx = num() + (rel ? x : 0); push(nx, y); x = nx; lcx = lqx = null; }
    else if (C === 'V') { const ny = num() + (rel ? y : 0); push(x, ny); y = ny; lcx = lqx = null; }
    else if (C === 'C') { const x1 = num() + (rel ? x : 0), y1 = num() + (rel ? y : 0), x2 = num() + (rel ? x : 0), y2 = num() + (rel ? y : 0), x3 = num() + (rel ? x : 0), y3 = num() + (rel ? y : 0); cubic(x1, y1, x2, y2, x3, y3); lcx = x2; lcy = y2; x = x3; y = y3; lqx = null; }
    else if (C === 'S') { const x1 = lcx === null ? x : 2 * x - lcx, y1 = lcy === null ? y : 2 * y - lcy; const x2 = num() + (rel ? x : 0), y2 = num() + (rel ? y : 0), x3 = num() + (rel ? x : 0), y3 = num() + (rel ? y : 0); cubic(x1, y1, x2, y2, x3, y3); lcx = x2; lcy = y2; x = x3; y = y3; lqx = null; }
    else if (C === 'Q') { const x1 = num() + (rel ? x : 0), y1 = num() + (rel ? y : 0), x2 = num() + (rel ? x : 0), y2 = num() + (rel ? y : 0); quad(x1, y1, x2, y2); lqx = x1; lqy = y1; x = x2; y = y2; lcx = null; }
    else if (C === 'T') { const x1 = lqx === null ? x : 2 * x - lqx, y1 = lqy === null ? y : 2 * y - lqy; const x2 = num() + (rel ? x : 0), y2 = num() + (rel ? y : 0); quad(x1, y1, x2, y2); lqx = x1; lqy = y1; x = x2; y = y2; lcx = null; }
    else if (C === 'A') { const rx = num(), ry = num(), rot = num() * Math.PI / 180, fa = num(), fs = num(); const nx = num() + (rel ? x : 0), ny = num() + (rel ? y : 0); arc(rx, ry, rot, fa, fs, nx, ny); x = nx; y = ny; lcx = lqx = null; }
    else { i++; }
  }
  return subs.filter((s) => s.length > 1);
}

function transformPts(pts, { x = 0, y = 0, s = 1, sx = s, sy = s, rot = 0 } = {}) {
  const c = Math.cos(rot), sn = Math.sin(rot);
  return pts.map(([px, py]) => { const X = px * sx, Y = py * sy; return [x + X * c - Y * sn, y + X * sn + Y * c]; });
}

// ---------- boil + stroke rendering ----------
// Perturb points with low-frequency noise; the pattern changes on each boil frame.
function boilPts(pts, amp, seed, bi, freq = 0.012) {
  if (amp <= 0) return pts;
  const z = seed * 13.37 + bi * 3.1;
  return pts.map(([x, y]) => [x + amp * noise.n3(x * freq, y * freq, z), y + amp * noise.n3(x * freq + 91.7, y * freq - 17.3, z)]);
}

// Build and fill a variable-width polygon along the polyline (dip-pen feel). widthFn(u) → width at the
// arc-length fraction u. progress < 1 draws only the first part (the line draws itself on).
function fillStroke(ctx, pts, widthFn, progress = 1) {
  const n = pts.length; if (n < 2) return;
  const L = [0]; let acc = 0;
  for (let i = 1; i < n; i++) { acc += dist(pts[i - 1], pts[i]); L.push(acc); }
  const total = acc || 1; const lim = total * clamp(progress);
  if (lim <= 0.5) return;
  const left = [], right = [];
  for (let i = 0; i < n; i++) {
    let px = pts[i][0], py = pts[i][1]; let li = L[i];
    if (li > lim) {
      const a = pts[i - 1], t = (lim - L[i - 1]) / Math.max(1e-6, L[i] - L[i - 1]);
      px = lerp(a[0], pts[i][0], t); py = lerp(a[1], pts[i][1], t); li = lim;
    }
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1]; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const w = Math.max(0.05, widthFn(li / total)) / 2;
    left.push([px - ty * w, py + tx * w]); right.push([px + ty * w, py - tx * w]);
    if (li >= lim) break;
  }
  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (let i = 1; i < left.length; i++) ctx.lineTo(left[i][0], left[i][1]);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath(); ctx.fill();
}

// Extend both ends of an open polyline (hand-drawn lines overshoot their corners).
function overshoot(pts, a0, a1) {
  if (pts.length < 2) return pts;
  const p0 = pts[0], p1 = pts[1], q0 = pts[pts.length - 1], q1 = pts[pts.length - 2];
  const d0 = dist(p0, p1) || 1, d1 = dist(q0, q1) || 1;
  const s = [p0[0] + (p0[0] - p1[0]) / d0 * a0, p0[1] + (p0[1] - p1[1]) / d0 * a0];
  const e = [q0[0] + (q0[0] - q1[0]) / d1 * a1, q0[1] + (q0[1] - q1[1]) / d1 * a1];
  return [s, ...pts, e];
}

// Sketchy multi-pass ink / graphite line.
// o: width, color, alpha, boil (px), boilFps, t, seed, passes, taper, progress (0..1 draw-on),
//    pressure (0..1 noise on width), spacing, freq, closed, over (px overshoot), drift (px between passes)
function sketch(ctx, pts, o = {}) {
  const { width = 3, color = '#1b1a17', alpha = 1, boil = 1.4, boilFps = BOIL_FPS, t = 0, seed = 1, passes = 2, taper = 0.18, progress = 1, pressure = 0.45, spacing = 5, freq = 0.012, closed = false, over = 0, drift = 1.2 } = o;
  if (progress <= 0 || !pts || pts.length < 2) return;
  const bi = Math.floor(t * boilFps);
  let src = pts;
  if (over > 0 && !closed) src = overshoot(pts, over * (0.4 + hash(seed * 3 + bi) * 0.8), over * (0.4 + hash(seed * 5 + bi) * 0.8));
  const base = resample(src, spacing);
  ctx.save(); ctx.fillStyle = color;
  const ga = ctx.globalAlpha;   // respect fades set by the caller
  for (let p = 0; p < passes; p++) {
    const s = seed * 7 + p * 101;
    let P = boilPts(base, boil * (p === 0 ? 1 : 1.5), s, bi, freq);
    if (p > 0 && drift > 0) {
      const ox = (hash(s + bi * 7) - 0.5) * 2 * drift, oy = (hash(s + bi * 11) - 0.5) * 2 * drift;
      P = P.map(([x, y]) => [x + ox, y + oy]);
    }
    const r = hash(s + bi * 31);
    const wmul = p === 0 ? 1 : 0.45 + 0.3 * r;
    ctx.globalAlpha = ga * alpha * (p === 0 ? 0.92 : 0.38 + 0.2 * r);
    const wf = (u) => {
      const tp = closed ? 1 : Math.min(1, u / taper, (1 - u) / taper);
      const tap = closed ? 1 : Math.pow(clamp(tp), 0.6);
      const pr = 1 - pressure * 0.5 + pressure * 0.5 * noise.n2(u * 5 + s, bi * 0.37) + pressure * 0.25 * noise.n2(u * 23 + s * 3, bi * 0.5);
      return width * wmul * (0.25 + 0.75 * tap) * Math.max(0.2, pr);
    };
    fillStroke(ctx, P, wf, progress);
  }
  ctx.restore();
}

// Hatching inside a clip region. region(ctx) builds the clip path; angle in radians, spacing in px,
// tone 0..1 controls how many lines survive, cross adds a second direction.
function hatch(ctx, region, o = {}) {
  const { bbox, angle = -0.7, spacing = 9, width = 1.2, color = '#1b1a17', alpha = 0.8, t = 0, seed = 5, boil = 1.0, boilFps = BOIL_FPS, tone = 1, progress = 1, cross = false } = o;
  const [bx, by, bw, bh] = bbox; const cx = bx + bw / 2, cy = by + bh / 2; const R = Math.hypot(bw, bh) / 2 + spacing;
  ctx.save(); ctx.beginPath(); region(ctx); ctx.clip();
  const bi = Math.floor(t * boilFps);
  const dirs = cross ? [angle, angle + Math.PI / 2.6] : [angle];
  dirs.forEach((ang, di) => {
    const c = Math.cos(ang), s = Math.sin(ang);
    const nLines = Math.ceil((2 * R) / spacing);
    for (let k = 0; k <= nLines; k++) {
      const h = hash(seed * 977 + k * 13 + di * 7919);
      if (h > tone) continue;
      const off = -R + k * spacing + (hash(seed + k * 3 + bi * 17) - 0.5) * spacing * 0.35;
      const x0 = cx - c * R - s * off, y0 = cy - s * R + c * off, x1 = cx + c * R - s * off, y1 = cy + s * R + c * off;
      const L = 2 * R; const a0 = hash(seed + k * 5) * 0.08, a1 = 1 - hash(seed + k * 9) * 0.08;
      const pr = clamp(progress * 1.6 - (k / nLines) * 0.6);
      if (pr <= 0) continue;
      const pts = [[lerp(x0, x1, a0), lerp(y0, y1, a0)], [lerp(x0, x1, a1), lerp(y0, y1, a1)]];
      sketch(ctx, pts, { width, color, alpha: alpha * (0.6 + 0.4 * h), boil, t, seed: seed * 31 + k + di * 1000, passes: 1, taper: 0.1, progress: pr, pressure: 0.5, spacing: Math.max(6, L / 40), boilFps });
    }
  });
  ctx.restore();
}

// Split a closed outline into a few open strokes with overlapping ends, the way an illustrator draws a
// rectangle in two to four gestures.
function gestures(pts, n = 3, seed = 1, overlap = 0.04) {
  const res = resample(pts, 4); const N = res.length; const out = [];
  const start = Math.floor(hash(seed) * N);
  for (let k = 0; k < n; k++) {
    const a = start + Math.floor((k / n - overlap * hash(seed + k)) * N);
    const b = start + Math.floor(((k + 1) / n + overlap * hash(seed + k + 7)) * N);
    const seg = []; for (let i = a; i <= b; i++) seg.push(res[((i % N) + N) % N]);
    out.push(seg);
  }
  return out;
}

module.exports = { resample, polyLength, roundRectPts, ellipsePts, linePts, flattenSvgPath, transformPts, boilPts, fillStroke, sketch, hatch, overshoot, gestures };
