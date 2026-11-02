'use strict';
// Smooth camera paths through keyframes: monotone cubic Hermite per channel (continuous velocity, no
// overshoot, so a hold is a real hold). keys: [[t, x, y, z, r?], ...]. Zoom is interpolated in log space so
// a 1× → 4× push feels as even as a 4× → 16× one.

function hermite(ts, vs, t) {
  const n = ts.length;
  if (t <= ts[0]) return vs[0];
  if (t >= ts[n - 1]) return vs[n - 1];
  let i = 0; while (i < n - 2 && t > ts[i + 1]) i++;
  const h = ts[i + 1] - ts[i];
  const slope = (k) => {
    if (k === 0 || k === n - 1) return 0;
    const d0 = (vs[k] - vs[k - 1]) / (ts[k] - ts[k - 1]), d1 = (vs[k + 1] - vs[k]) / (ts[k + 1] - ts[k]);
    if (d0 * d1 <= 0) return 0;
    return (2 * d0 * d1) / (d0 + d1);   // harmonic mean keeps it monotone
  };
  const m0 = slope(i), m1 = slope(i + 1);
  const u = (t - ts[i]) / h, u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * vs[i] + (u3 - 2 * u2 + u) * h * m0 + (-2 * u3 + 3 * u2) * vs[i + 1] + (u3 - u2) * h * m1;
}

function camPath(keys, t) {
  const ts = keys.map((k) => k[0]);
  const ch = (j, def) => keys.map((k) => (k[j] === undefined ? def : k[j]));
  const lz = hermite(ts, ch(3, 1).map(Math.log), t);
  return { x: hermite(ts, ch(1), t), y: hermite(ts, ch(2), t), z: Math.exp(lz), r: hermite(ts, ch(4, 0), t) };
}

// Damped shake to add to a camera (decays after t0). Returns { x, y } in design px.
function shake(t, t0, amp = 12, decay = 16, fps = 60) {
  const k = t - t0; if (k < 0 || k > 0.6) return { x: 0, y: 0 };
  const { hash } = require('../core/math');
  const a = amp * Math.exp(-k * decay); const fi = Math.floor(t * fps);
  return { x: (hash(fi * 3) - 0.5) * 2 * a, y: (hash(fi * 7) - 0.5) * 2 * a };
}

// ---------------------------------------------------------------- nested worlds
// A whole scene can live inside one point of a bigger world (a city map, a constellation of chats), K times
// smaller, so the camera dives from one into the other without a cut. `anchor` is the point in the parent
// world, `origin` the scene's own centre (usually [540, 960]).
//   toNested(parentCam) → the camera to draw the nested scene with, while the parent is on screen
//   toParent(nestedCam) → the parent camera that shows the nested scene through `nestedCam`
// Draw the parent with its camera, then set f.cam = toNested(...) and draw the nested scene (once its zoom
// is large enough to matter, e.g. z > 0.03), so both worlds are on screen during the dive.
function toNested(cam, anchor, origin = [540, 960], K = 40) {
  return { x: origin[0] + (cam.x - anchor[0]) * K, y: origin[1] + (cam.y - anchor[1]) * K, z: cam.z / K, r: cam.r || 0 };
}
function toParent(c, anchor, origin = [540, 960], K = 40) {
  return { x: anchor[0] + (c.x - origin[0]) / K, y: anchor[1] + (c.y - origin[1]) / K, z: c.z * K, r: c.r || 0 };
}
// Hop between two places of the parent world (both given as parent cameras): zoom out, pan, zoom in.
// p 0..1. The zoom-out is fast at first and slow at the end, so the wider world builds up in view.
function hop(from, to, p, { mid = 0.5, out = 0.42, pan = 0.26 } = {}) {
  const { ease, lerp } = require('../core/math');
  const a = out, b = out + pan;
  const midC = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - 60, z: mid };
  if (p < a) { const k = ease.outCubic(p / a); return { x: lerp(from.x, midC.x, ease.inCubic(k) * 0.35), y: lerp(from.y, midC.y, ease.inCubic(k) * 0.35), z: Math.exp(lerp(Math.log(from.z), Math.log(midC.z), k)), r: 0 }; }
  if (p < b) { const k = ease.inOutCubic((p - a) / pan); const s = { x: lerp(from.x, midC.x, 0.35), y: lerp(from.y, midC.y, 0.35) }; const e = { x: lerp(to.x, midC.x, 0.35), y: lerp(to.y, midC.y, 0.35) }; return { x: lerp(s.x, e.x, k), y: lerp(s.y, e.y, k), z: midC.z * (1 - 0.08 * Math.sin(Math.PI * k)), r: 0 }; }
  const k = ease.inOutCubic((p - b) / (1 - b));
  return { x: lerp(lerp(to.x, midC.x, 0.35), to.x, ease.outCubic(k)), y: lerp(lerp(to.y, midC.y, 0.35), to.y, ease.outCubic(k)), z: Math.exp(lerp(Math.log(midC.z), Math.log(to.z), k)), r: 0 };
}

module.exports = { hermite, camPath, shake, toNested, toParent, hop };
