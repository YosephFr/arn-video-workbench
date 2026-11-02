'use strict';
// Story devices: threads (a conversation as a line between two people), beads running along them, a rubber
// stamp that slams onto the frame, the ink flood that turns paper into night, a comet of light and a stream
// of sparks (money, attention, anything that travels from one place to another).

const { sketch, roundRectPts } = require('../draw/ink');
const { clamp, hash, ease, lerp, TAU } = require('../core/math');
const { noise } = require('../core/noise');
const { fontStack } = require('../core/fonts');

// ---------------- threads ----------------
// A thread from a to b; slack 0 (taut) .. 1 (droops); vib = vibration amplitude in px.
function threadPoint(a, b, u, { slack = 0.2, vib = 0, t = 0, seed = 1, gravity = [0, 1] } = {}) {
  const dx = b[0] - a[0], dy = b[1] - a[1]; const L = Math.hypot(dx, dy) || 1;
  let x = a[0] + dx * u, y = a[1] + dy * u;
  const sag = Math.sin(Math.PI * u) * slack * L * 0.28;
  x += gravity[0] * sag; y += gravity[1] * sag;
  if (vib) { const w = Math.sin(Math.PI * u) * vib * Math.sin(t * 38 + seed + u * 9); x += (-dy / L) * w; y += (dx / L) * w; }
  const wob = noise.n2(u * 3 + seed * 1.7, t * 0.6) * 4 * Math.sin(Math.PI * u);
  x += (-dy / L) * wob; y += (dx / L) * wob;
  return [x, y];
}
function threadPts(a, b, o = {}, n = 40, u0 = 0, u1 = 1) {
  const pts = []; for (let i = 0; i <= n; i++) pts.push(threadPoint(a, b, lerp(u0, u1, i / n), o)); return pts;
}
// An ink thread (paper world).
function inkThread(ctx, a, b, o = {}) {
  const { width = 2, color = '#23201b', alpha = 1, t = 0, seed = 1, progress = 1, u0 = 0, u1 = 1 } = o;
  sketch(ctx, threadPts(a, b, o, 36, u0, u1), { width, color, alpha, t, seed, passes: 1, taper: 0.06, progress, boil: 0.8, spacing: 8, pressure: 0.3 });
}
// A light thread (night world), drawn into the frame and the bloom buffer.
function lightThread(f, a, b, o = {}) {
  const { width = 1.6, color = '255,235,205', alpha = 0.8, u0 = 0, u1 = 1 } = o;
  const pts = threadPts(a, b, o, 36, u0, u1);
  for (const c of [f.ctx, f.glow]) {
    c.save(); f.setCam(c); c.globalCompositeOperation = 'lighter'; c.strokeStyle = `rgba(${color},${alpha * (c === f.glow ? 0.9 : 1)})`;
    c.lineWidth = width * (c === f.glow ? 2.2 : 1); c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (const p of pts) c.lineTo(p[0], p[1]); c.stroke(); c.restore();
  }
}

// ---------------- stamp ----------------
// A rubber stamp that slams onto the frame at t0 (scale from 2.4 → 1 in 0.11 s, then a damped wobble),
// with ink speckles on impact. Returns a camera-shake amount for the caller (decays fast).
function stamp(ctx, t, t0, { x, y, rot = -0.2, scale = 1, label = 'SEEN', sub = '', color = '#c8322b', alpha = 0.92, seed = 3, family = 'Poppins' } = {}) {
  const k = t - t0; if (k < 0) return 0;
  const inT = 0.11;
  const s = k < inT ? lerp(2.4, 1, ease.inQuad(k / inT)) : 1 + 0.06 * Math.exp(-(k - inT) * 18) * Math.cos((k - inT) * 60);
  const a = alpha * clamp(k / 0.05);
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s * scale, s * scale);
  ctx.globalAlpha = a;
  ctx.font = `800 118px ${fontStack(family)}`; const tw = ctx.measureText(label).width; const w = tw + 90, h = 170;
  sketch(ctx, roundRectPts(-w / 2, -h / 2, w, h, 22, 6), { width: 9, color, t, seed, closed: true, boil: 1.2, passes: 1, spacing: 6 });
  sketch(ctx, roundRectPts(-w / 2 + 16, -h / 2 + 16, w - 32, h - 32, 14, 6), { width: 3.2, color, t, seed: seed + 1, closed: true, boil: 1, passes: 1, spacing: 6 });
  ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, 0, sub ? -8 : 4);
  if (sub) { ctx.font = `600 30px ${fontStack('JetBrains Mono')}`; ctx.fillText(sub, 0, 52); }
  for (let i = 0; i < 40; i++) {
    const ang = hash(i * 7 + seed) * TAU, rr = w * 0.5 + hash(i * 3 + seed) * 120;
    const px = Math.cos(ang) * rr * 0.9, py = Math.sin(ang) * rr * 0.55;
    ctx.globalAlpha = a * clamp(k / 0.12) * (0.3 + 0.5 * hash(i + seed));
    ctx.beginPath(); ctx.arc(px, py, 1.2 + hash(i * 5 + seed) * 4, 0, TAU); ctx.fill();
  }
  ctx.restore();
  return k < 0.25 ? Math.exp(-k * 18) : 0;
}

// ---------------- ink flood ----------------
// Black ink covers the frame from the top: p 0..1 (screen space, design units). The classic way to move
// from the paper world to the night world without a cut.
function flood(ctx, p, t, { color = '#0b0a09', W = 1080, H = 1920, seed = 2 } = {}) {
  if (p <= 0) return;
  const base = lerp(-160, H + 420, ease.inOutCubic(p));
  const edge = (x) => base + noise.fbm2(x * 0.0022 + seed, t * 0.5, 2) * 70 + Math.sin(x * 0.006 + seed) * 22;
  ctx.save(); ctx.fillStyle = color;
  const body = () => {
    ctx.beginPath(); ctx.moveTo(-60, -60); ctx.lineTo(W + 60, -60);
    const n = 48; for (let i = n; i >= 0; i--) { const x = (i / n) * (W + 120) - 60; ctx.lineTo(x, edge(x)); }
    ctx.closePath(); ctx.fill();
  };
  body();
  // Drips running ahead of the front.
  for (let k = 0; k < 11; k++) {
    const x = 40 + hash(k * 13 + seed) * (W - 80); const len = (60 + hash(k * 7) * 260) * Math.min(1, p * 2.2);
    const w = 10 + hash(k * 3) * 22; const y0 = edge(x) - 10;
    ctx.beginPath(); ctx.moveTo(x - w, y0); ctx.lineTo(x - w * 0.55, y0 + len); ctx.arc(x, y0 + len, w * 0.55, Math.PI, 0, true); ctx.lineTo(x + w, y0); ctx.closePath(); ctx.fill();
  }
  // Wet bleed: a soft dark halo under the front.
  ctx.globalAlpha = 0.45; ctx.filter = 'blur(26px)'; body(); ctx.filter = 'none';
  ctx.restore();
}

// ---------------- comet ----------------
// pathFn(t) → [x, y] in world units; draws a bright head and a fading trail (light world).
function comet(f, pathFn, t, { trail = 0.55, samples = 40, width = 7, color = [1, 1, 1], alpha = 1, head = 26 } = {}) {
  const pts = [];
  for (let k = 0; k <= samples; k++) pts.push(pathFn(t - (k / samples) * trail));
  for (const c of [f.ctx, f.glow]) {
    c.save(); f.setCam(c); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round'; c.lineJoin = 'round';
    for (let k = samples; k > 0; k--) {
      const u = 1 - k / samples; const a = alpha * Math.pow(u, 1.6);
      c.strokeStyle = `rgba(${color[0] * 255 | 0},${color[1] * 255 | 0},${color[2] * 255 | 0},${a})`;
      c.lineWidth = width * (0.2 + 0.8 * u) * (c === f.glow ? 2 : 1);
      c.beginPath(); c.moveTo(pts[k][0], pts[k][1]); c.lineTo(pts[k - 1][0], pts[k - 1][1]); c.stroke();
    }
    c.restore();
  }
  const [hx, hy] = pts[0];
  f.glowLight(hx, hy, head, 0.9 * alpha, color); f.dotLight(hx, hy, width * 0.9, 1.5 * alpha, color);
  return [hx, hy];
}

// ---------------- spark stream ----------------
// n particles flowing from a to b along a curved path; each leaves at its own time (stagger).
function sparkStream(f, a, b, p, { n = 600, col = [1, 0.78, 0.36], spread = 40, arc = -0.25, mode = 'light', r = 1.6, seed = 7, alpha = 1, stagger = 0.6 } = {}) {
  const dx = b[0] - a[0], dy = b[1] - a[1]; const L = Math.hypot(dx, dy) || 1; const nx = -dy / L, ny = dx / L;
  for (let i = 0; i < n; i++) {
    const d = hash(i * 3 + seed) * stagger; const k = clamp((p - d) / (1 - stagger)); if (k <= 0 || k >= 1) continue;
    const e = ease.inOutQuad(k);
    const off = (hash(i * 7 + seed) - 0.5) * spread * Math.sin(Math.PI * e);
    const bend = Math.sin(Math.PI * e) * arc * L;
    const x = a[0] + dx * e + nx * (bend + off), y = a[1] + dy * e + ny * (bend + off);
    const aa = alpha * Math.sin(Math.PI * k) * (0.6 + 0.4 * hash(i));
    if (mode === 'light') f.dotLight(x, y, r * (0.6 + hash(i * 5) * 0.8), aa * 1.4, col); else f.dotInk(x, y, r * (0.6 + hash(i * 5) * 0.8), aa, col);
  }
}

module.exports = { threadPoint, threadPts, inkThread, lightThread, stamp, flood, comet, sparkStream };
