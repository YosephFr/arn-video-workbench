'use strict';
// Procedural plates: neutral black-and-white "studio photographs" of a single subject on pure white, drawn
// with gradients, soft shadows and noise. The stippler only reads their tone (dark = many dots), so they
// never appear as images; they guide where the dots go. Replace them with your own photos at any time
// (tools/plate-from-image.mjs) — same size, same rules: one subject, white background, deep blacks.
//
// Every generator draws on a PW × PH canvas (768 × 1376, the plate convention) and returns
// { canvas, meta } where meta carries measured geometry in plate-normalised units:
//   screen: { cx, cy, w, h, rot }  the phone screen (pure white, masked from the stipple)
//   dial:   { cx, cy, r }          a clock face (r relative to the plate height)
//   anchors: { name: [u, v] }      points of interest (fingertip, wick, tip...)

const { createCanvas } = require('../core/canvas');
const { makeNoise } = require('../core/noise');
const { rng, TAU } = require('../core/math');

const PW = 768, PH = 1376;

function canvas() { const cv = createCanvas(PW, PH); const c = cv.getContext('2d'); c.fillStyle = '#ffffff'; c.fillRect(0, 0, PW, PH); return [cv, c]; }
const grey = (v, a = 1) => `rgba(${v},${v},${v},${a})`;
function rr(c, x, y, w, h, r) { c.beginPath(); c.roundRect(x, y, w, h, r); }
function linear(c, x0, y0, x1, y1, stops) { const g = c.createLinearGradient(x0, y0, x1, y1); for (const [o, col] of stops) g.addColorStop(o, col); return g; }
function radial(c, x, y, r0, r1, stops, fx = x, fy = y) { const g = c.createRadialGradient(fx, fy, r0, x, y, r1); for (const [o, col] of stops) g.addColorStop(o, col); return g; }
function softShadow(c, draw, { blur = 30, alpha = 0.35, dx = 0, dy = 18 } = {}) { c.save(); c.filter = `blur(${blur}px)`; c.globalAlpha = alpha; c.translate(dx, dy); c.fillStyle = '#000'; draw(); c.fill(); c.restore(); }
// A finger-like capsule from (x0, y0) to (x1, y1) with width w, shaded across its width.
function capsule(c, x0, y0, x1, y1, w, { light = 170, dark = 92, nail = true } = {}) {
  const ang = Math.atan2(y1 - y0, x1 - x0), len = Math.hypot(x1 - x0, y1 - y0);
  c.save(); c.translate(x0, y0); c.rotate(ang);
  rr(c, 0, -w / 2, len, w, w / 2);
  c.fillStyle = linear(c, 0, -w / 2, 0, w / 2, [[0, grey(dark + 25)], [0.35, grey(light)], [0.75, grey(dark + 10)], [1, grey(dark - 25)]]); c.fill();
  c.lineWidth = 3; c.strokeStyle = grey(dark - 40, 0.7); c.stroke();
  if (nail) { rr(c, len - w * 0.95, -w * 0.3, w * 0.75, w * 0.6, w * 0.3); c.fillStyle = grey(Math.min(235, light + 40)); c.fill(); c.strokeStyle = grey(dark - 20, 0.5); c.lineWidth = 2; c.stroke(); }
  // knuckle creases
  for (const k of [0.38, 0.62]) { c.beginPath(); c.moveTo(len * k, -w * 0.32); c.quadraticCurveTo(len * k + 6, 0, len * k, w * 0.32); c.strokeStyle = grey(dark - 30, 0.55); c.lineWidth = 2.5; c.stroke(); }
  c.restore();
}

// ---------------------------------------------------------------- hand holding a phone
function handPhone({ tilt = -0.05 } = {}) {
  const [cv, c] = canvas();
  const cx = 384, cy = 610, bw = 372, bh = 760, br = 58, bez = 16;
  // Forearm from the bottom of the frame, then the palm behind the phone.
  softShadow(c, () => { c.beginPath(); c.moveTo(230, PH); c.lineTo(300, 1040); c.lineTo(540, 1030); c.lineTo(600, PH); c.closePath(); }, { blur: 40, alpha: 0.25, dx: 20, dy: 0 });
  c.beginPath(); c.moveTo(220, PH); c.bezierCurveTo(240, 1220, 270, 1110, 300, 1030); c.lineTo(545, 1020); c.bezierCurveTo(570, 1110, 590, 1230, 612, PH); c.closePath();
  c.fillStyle = linear(c, 220, 0, 612, 0, [[0, grey(105)], [0.3, grey(165)], [0.65, grey(140)], [1, grey(70)]]); c.fill();
  // Sleeve cuff at the bottom.
  c.beginPath(); c.moveTo(200, PH); c.bezierCurveTo(230, 1290, 250, 1255, 262, 1240); c.lineTo(588, 1232); c.bezierCurveTo(600, 1260, 615, 1300, 632, PH); c.closePath();
  c.fillStyle = linear(c, 200, 0, 632, 0, [[0, grey(40)], [0.4, grey(78)], [1, grey(25)]]); c.fill();
  for (let k = 0; k < 5; k++) { c.beginPath(); c.moveTo(250 + k * 80, 1250); c.quadraticCurveTo(262 + k * 80, 1310, 245 + k * 80, PH); c.strokeStyle = grey(15, 0.5); c.lineWidth = 4; c.stroke(); }
  // Palm, and the side of the hand behind the right edge of the phone (the fingers wrap from there).
  c.save(); c.beginPath(); c.ellipse(cx + 18, cy + 330, 238, 250, -0.12, 0, TAU);
  c.fillStyle = radial(c, cx - 30, cy + 300, 20, 300, [[0, grey(178)], [0.6, grey(140)], [1, grey(88)]], cx - 80, cy + 260); c.fill(); c.restore();
  c.beginPath(); c.ellipse(cx + bw / 2 + 4, cy + 90, 58, 300, 0.04, 0, TAU);
  c.fillStyle = linear(c, cx + bw / 2 - 50, 0, cx + bw / 2 + 62, 0, [[0, grey(80)], [0.55, grey(150)], [1, grey(96)]]); c.fill();
  // Phone body (tilted), with its shadow on the palm.
  c.save(); c.translate(cx, cy); c.rotate(tilt);
  softShadow(c, () => rr(c, -bw / 2, -bh / 2, bw, bh, br), { blur: 26, alpha: 0.45, dx: 16, dy: 22 });
  rr(c, -bw / 2, -bh / 2, bw, bh, br); c.fillStyle = linear(c, -bw / 2, 0, bw / 2, 0, [[0, grey(70)], [0.06, grey(28)], [0.94, grey(18)], [1, grey(55)]]); c.fill();
  rr(c, -bw / 2 + 3, -bh / 2 + 3, bw - 6, bh - 6, br - 3); c.lineWidth = 3; c.strokeStyle = grey(120, 0.8); c.stroke();
  // Side buttons.
  rr(c, -bw / 2 - 7, -bh / 2 + 150, 9, 70, 4); c.fillStyle = grey(40); c.fill();
  rr(c, bw / 2 - 2, -bh / 2 + 190, 9, 110, 4); c.fill();
  // Screen: pure white (masked; its content is drawn by code).
  const sw = bw - 2 * bez, sh = bh - 2 * bez;
  rr(c, -sw / 2, -sh / 2, sw, sh, br - bez); c.fillStyle = '#ffffff'; c.fill();
  rr(c, -54, -sh / 2 + 12, 108, 30, 15); c.fillStyle = grey(10); c.fill();   // camera notch
  c.restore();
  // Fingertips curling over the right edge (only the pads show, in front of the bezel).
  const edge = cx + bw / 2 + Math.sin(tilt) * 0;
  const tips = [[edge - 4, cy - 170], [edge, cy - 52], [edge + 4, cy + 66], [edge + 8, cy + 178]];
  tips.forEach(([x, y], i) => {
    const w = 64 - i * 5;
    c.save(); c.filter = 'blur(6px)'; c.beginPath(); c.ellipse(x - 6, y + 8, 40, w * 0.5, 0, 0, TAU); c.fillStyle = grey(10, 0.45); c.fill(); c.restore();
    capsule(c, x + 46, y + 10, x - 18, y, w, { light: 172 - i * 6, dark: 92, nail: false });
  });
  // Thumb: from the heel of the hand up along the left edge, its tip resting on the bezel.
  c.save(); c.filter = 'blur(8px)'; c.beginPath(); c.ellipse(cx - bw / 2 + 10, cy + 160, 34, 150, 0.35, 0, TAU); c.fillStyle = grey(10, 0.35); c.fill(); c.restore();
  capsule(c, cx - 120, cy + 500, cx - bw / 2 - 30, cy + 250, 92, { light: 176, dark: 98, nail: false });
  capsule(c, cx - bw / 2 - 30, cy + 258, cx - bw / 2 + 6, cy + 40, 80, { light: 182, dark: 100 });
  // Crease between thumb and palm.
  c.beginPath(); c.moveTo(cx - 120, cy + 520); c.quadraticCurveTo(cx - 40, cy + 470, cx + 30, cy + 540); c.strokeStyle = grey(70, 0.6); c.lineWidth = 4; c.stroke();
  const cs = Math.cos(tilt), sn = Math.sin(tilt);
  const screen = { cx: cx / PW, cy: cy / PH, w: (bw - 2 * bez) / PW, h: (bh - 2 * bez) / PH, rot: tilt };
  return { canvas: cv, meta: { screen, anchors: { thumb: [(cx - bw / 2) / PW, (cy + 40) / PH], top: [(cx + sn * bh / 2) / PW, (cy - cs * bh / 2) / PH] } } };
}

// ---------------------------------------------------------------- twin-bell alarm clock (no hands: draw them in ink)
function clock() {
  const [cv, c] = canvas();
  const cx = 384, cy = 720, R = 262, r = 222;
  const metal = (x, y, rad) => radial(c, x, y, rad * 0.05, rad, [[0, grey(205)], [0.45, grey(120)], [0.85, grey(48)], [1, grey(25)]], x - rad * 0.35, y - rad * 0.4);
  // Legs and shadow.
  softShadow(c, () => { c.beginPath(); c.ellipse(cx, cy + R + 70, R * 0.95, 34, 0, 0, TAU); }, { blur: 24, alpha: 0.4, dy: 0 });
  for (const s of [-1, 1]) {
    c.save(); c.translate(cx + s * R * 0.62, cy + R * 0.78); c.rotate(s * 0.5);
    rr(c, -16, 0, 32, 120, 14); c.fillStyle = linear(c, -16, 0, 16, 0, [[0, grey(40)], [0.4, grey(150)], [1, grey(30)]]); c.fill(); c.restore();
  }
  // Handle arc and the two bells, behind the body.
  c.beginPath(); c.arc(cx, cy - R - 10, 150, Math.PI * 1.08, Math.PI * 1.92); c.lineWidth = 26; c.strokeStyle = grey(45); c.stroke();
  c.lineWidth = 8; c.strokeStyle = grey(150); c.beginPath(); c.arc(cx, cy - R - 10, 150, Math.PI * 1.15, Math.PI * 1.4); c.stroke();
  for (const s of [-1, 1]) {
    const bx = cx + s * 205, by = cy - 205;
    c.save(); c.translate(bx, by); c.rotate(s * 0.62);
    c.beginPath(); c.arc(0, 0, 112, Math.PI, 0); c.lineTo(112, 14); c.lineTo(-112, 14); c.closePath();
    c.fillStyle = metal(0, -20, 140); c.fill(); c.lineWidth = 4; c.strokeStyle = grey(20); c.stroke();
    c.beginPath(); c.arc(0, -112, 16, 0, TAU); c.fillStyle = grey(35); c.fill();
    c.restore();
  }
  // Hammer between the bells.
  rr(c, cx - 7, cy - R - 120, 14, 110, 6); c.fillStyle = grey(40); c.fill();
  rr(c, cx - 34, cy - R - 138, 68, 34, 12); c.fillStyle = grey(55); c.fill();
  // Body ring.
  c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.fillStyle = metal(cx, cy, R); c.fill();
  c.beginPath(); c.arc(cx, cy, R - 6, 0, TAU); c.lineWidth = 3; c.strokeStyle = grey(200, 0.6); c.stroke();
  // Dial.
  c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.fillStyle = radial(c, cx, cy, r * 0.2, r, [[0, '#ffffff'], [0.8, grey(246)], [1, grey(205)]]); c.fill();
  c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.lineWidth = 6; c.strokeStyle = grey(30); c.stroke();
  for (let k = 0; k < 60; k++) {
    const a = (k / 60) * TAU - Math.PI / 2; const big = k % 5 === 0; const r0 = r - (big ? 46 : 22), r1 = r - 12;
    c.beginPath(); c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); c.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    c.lineWidth = big ? 10 : 3; c.strokeStyle = grey(big ? 20 : 70); c.lineCap = 'round'; c.stroke();
  }
  c.beginPath(); c.arc(cx, cy, 18, 0, TAU); c.fillStyle = grey(25); c.fill();
  return { canvas: cv, meta: { dial: { cx: cx / PW, cy: cy / PH, r: (r - 30) / PH }, anchors: { center: [cx / PW, cy / PH] } } };
}

// ---------------------------------------------------------------- a person seen from behind (head and shoulders)
function person({ seed = 5 } = {}) {
  const [cv, c] = canvas();
  const nz = makeNoise(seed); const r = rng(seed);
  const hx = 384, hy = 560;
  // Shoulders and shirt.
  softShadow(c, () => { c.beginPath(); c.ellipse(384, 1250, 380, 260, 0, 0, TAU); }, { blur: 40, alpha: 0.15, dy: 0 });
  c.beginPath(); c.moveTo(0, PH); c.lineTo(0, 1120); c.bezierCurveTo(40, 960, 200, 900, 300, 880); c.lineTo(468, 880); c.bezierCurveTo(568, 900, 728, 960, 768, 1120); c.lineTo(768, PH); c.closePath();
  c.fillStyle = linear(c, 0, 0, 768, 0, [[0, grey(48)], [0.25, grey(118)], [0.5, grey(96)], [0.75, grey(122)], [1, grey(40)]]); c.fill();
  // Folds.
  for (const [x0, x1, w] of [[170, 140, 18], [600, 640, 16], [300, 270, 10], [470, 500, 10]]) {
    c.save(); c.filter = 'blur(8px)'; c.beginPath(); c.moveTo(x0, 930); c.quadraticCurveTo((x0 + x1) / 2 + 20, 1150, x1, PH); c.lineWidth = w; c.strokeStyle = grey(30, 0.6); c.stroke(); c.restore();
  }
  // Collar.
  c.beginPath(); c.moveTo(286, 884); c.quadraticCurveTo(384, 940, 482, 884); c.lineTo(470, 860); c.quadraticCurveTo(384, 905, 298, 860); c.closePath(); c.fillStyle = grey(70); c.fill();
  // Neck.
  c.beginPath(); c.moveTo(318, 700); c.lineTo(450, 700); c.bezierCurveTo(452, 790, 462, 840, 476, 872); c.quadraticCurveTo(384, 905, 292, 872); c.bezierCurveTo(306, 840, 316, 790, 318, 700); c.closePath();
  c.fillStyle = linear(c, 300, 0, 470, 0, [[0, grey(110)], [0.45, grey(178)], [1, grey(96)]]); c.fill();
  c.save(); c.filter = 'blur(14px)'; c.beginPath(); c.ellipse(384, 735, 80, 30, 0, 0, TAU); c.fillStyle = grey(60, 0.6); c.fill(); c.restore();
  // Ears.
  for (const s of [-1, 1]) { c.beginPath(); c.ellipse(hx + s * 168, hy + 40, 30, 58, s * 0.15, 0, TAU); c.fillStyle = radial(c, hx + s * 168, hy + 40, 5, 60, [[0, grey(150)], [1, grey(90)]]); c.fill(); }
  // Head (skin under the hair), then the hair as many curved strokes.
  c.beginPath(); c.ellipse(hx, hy, 170, 212, 0, 0, TAU); c.fillStyle = grey(120); c.fill();
  c.save(); c.beginPath(); c.ellipse(hx, hy - 6, 176, 214, 0, 0, TAU); c.clip();
  c.fillStyle = radial(c, hx - 40, hy - 80, 10, 260, [[0, grey(85)], [0.7, grey(45)], [1, grey(25)]]); c.fillRect(0, 0, PW, PH);
  c.lineCap = 'round';
  for (let k = 0; k < 900; k++) {
    const a = r() * TAU, rad = Math.sqrt(r()) * 200; const x = hx + Math.cos(a) * rad * 0.9, y = hy - 30 + Math.sin(a) * rad;
    const dir = Math.atan2(y - (hy - 240), x - hx) + nz.n2(x * 0.01, y * 0.01) * 0.6; const L = 18 + r() * 34;
    c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + Math.cos(dir + 0.3) * L * 0.5, y + Math.sin(dir + 0.3) * L * 0.5, x + Math.cos(dir) * L, y + Math.sin(dir) * L);
    c.strokeStyle = r() < 0.7 ? grey(20 + r() * 30, 0.6) : grey(140 + r() * 50, 0.35); c.lineWidth = 1.5 + r() * 2.5; c.stroke();
  }
  c.restore();
  // A soft hairline at the back of the neck.
  c.save(); c.filter = 'blur(10px)'; c.beginPath(); c.ellipse(hx, hy + 190, 120, 40, 0, 0, TAU); c.fillStyle = grey(95, 0.6); c.fill(); c.restore();
  return { canvas: cv, meta: { anchors: { head: [hx / PW, hy / PH], shoulders: [384 / PW, 1000 / PH] } } };
}

// ---------------------------------------------------------------- incandescent light bulb
function bulb() {
  const [cv, c] = canvas();
  const cx = 384, cy = 560, R = 236;
  softShadow(c, () => { c.beginPath(); c.ellipse(cx, 1150, 150, 26, 0, 0, TAU); }, { blur: 20, alpha: 0.35, dy: 0 });
  // Glass: globe plus neck.
  const glass = () => { c.beginPath(); c.arc(cx, cy, R, Math.PI * 0.78, Math.PI * 0.22 + TAU); c.bezierCurveTo(cx + R * 0.62, cy + R * 1.05, cx + 112, cy + 300, cx + 104, cy + 352); c.lineTo(cx - 104, cy + 352); c.bezierCurveTo(cx - 112, cy + 300, cx - R * 0.62, cy + R * 1.05, cx + Math.cos(Math.PI * 0.78) * R, cy + Math.sin(Math.PI * 0.78) * R); c.closePath(); };
  glass(); c.fillStyle = radial(c, cx, cy, R * 0.3, R * 1.1, [[0, '#ffffff'], [0.75, grey(236)], [1, grey(170)]], cx - 60, cy - 70); c.fill();
  glass(); c.lineWidth = 7; c.strokeStyle = grey(70); c.stroke();
  // Highlight.
  c.beginPath(); c.ellipse(cx - 120, cy - 110, 34, 86, 0.6, 0, TAU); c.fillStyle = '#ffffff'; c.fill();
  // Supports and the coiled filament.
  c.lineCap = 'round'; c.strokeStyle = grey(45); c.lineWidth = 6;
  c.beginPath(); c.moveTo(cx - 34, cy + 352); c.lineTo(cx - 60, cy + 40); c.moveTo(cx + 34, cy + 352); c.lineTo(cx + 60, cy + 40); c.stroke();
  c.beginPath(); c.moveTo(cx, cy + 352); c.lineTo(cx, cy + 120); c.stroke();
  c.beginPath(); for (let k = 0; k <= 40; k++) { const u = k / 40; const x = cx - 60 + 120 * u, y = cy + 40 - Math.sin(u * Math.PI) * 50 + Math.sin(u * TAU * 7) * 14; if (k) c.lineTo(x, y); else c.moveTo(x, y); }
  c.lineWidth = 5; c.strokeStyle = grey(25); c.stroke();
  // Screw base: bands, then the contact.
  for (let k = 0; k < 6; k++) {
    const y = cy + 352 + k * 30; const w = 214 - k * 4;
    rr(c, cx - w / 2, y, w, 30, 12); c.fillStyle = linear(c, cx - w / 2, 0, cx + w / 2, 0, [[0, grey(40)], [0.35, k % 2 ? grey(170) : grey(140)], [0.7, grey(80)], [1, grey(30)]]); c.fill();
  }
  c.beginPath(); c.moveTo(cx - 80, cy + 532); c.lineTo(cx + 80, cy + 532); c.lineTo(cx + 40, cy + 590); c.lineTo(cx - 40, cy + 590); c.closePath(); c.fillStyle = grey(35); c.fill();
  c.beginPath(); c.arc(cx, cy + 594, 26, 0, Math.PI); c.fillStyle = grey(60); c.fill();
  return { canvas: cv, meta: { anchors: { filament: [cx / PW, (cy + 30) / PH], base: [cx / PW, (cy + 590) / PH] } } };
}

// ---------------------------------------------------------------- mug on a saucer (draw the steam with particles)
function mug() {
  const [cv, c] = canvas();
  const cx = 360, top = 600, bot = 1000, rx = 178, ry = 42;
  softShadow(c, () => { c.beginPath(); c.ellipse(cx + 20, 1060, 320, 60, 0, 0, TAU); }, { blur: 26, alpha: 0.35, dy: 0 });
  // Saucer.
  c.beginPath(); c.ellipse(cx + 10, 1030, 320, 74, 0, 0, TAU); c.fillStyle = linear(c, 0, 960, 0, 1100, [[0, grey(232)], [1, grey(150)]]); c.fill(); c.lineWidth = 4; c.strokeStyle = grey(90); c.stroke();
  c.beginPath(); c.ellipse(cx + 10, 1018, 220, 46, 0, 0, TAU); c.lineWidth = 3; c.strokeStyle = grey(150); c.stroke();
  // Handle (behind the right side of the body).
  c.beginPath(); c.ellipse(cx + rx + 30, 790, 92, 120, 0, -Math.PI / 2, Math.PI / 2); c.lineWidth = 46; c.strokeStyle = linear(c, cx + rx, 0, cx + rx + 130, 0, [[0, grey(60)], [0.5, grey(170)], [1, grey(55)]]); c.stroke();
  // Body (a cylinder: light from the left).
  c.beginPath(); c.moveTo(cx - rx, top); c.lineTo(cx - rx + 12, bot - 30); c.quadraticCurveTo(cx, bot + 22, cx + rx - 12, bot - 30); c.lineTo(cx + rx, top); c.closePath();
  c.fillStyle = linear(c, cx - rx, 0, cx + rx, 0, [[0, grey(120)], [0.22, grey(236)], [0.45, grey(214)], [0.85, grey(110)], [1, grey(70)]]); c.fill();
  c.lineWidth = 4; c.strokeStyle = grey(60); c.stroke();
  // Rim and the coffee.
  c.beginPath(); c.ellipse(cx, top, rx, ry, 0, 0, TAU); c.fillStyle = grey(245); c.fill(); c.lineWidth = 5; c.strokeStyle = grey(70); c.stroke();
  c.beginPath(); c.ellipse(cx, top + 8, rx - 16, ry - 10, 0, 0, TAU); c.fillStyle = radial(c, cx - 30, top + 4, 10, rx, [[0, grey(80)], [1, grey(22)]]); c.fill();
  return { canvas: cv, meta: { anchors: { cup: [cx / PW, (top - 10) / PH] } } };
}

// ---------------------------------------------------------------- paper plane (a message on its way)
function plane() {
  const [cv, c] = canvas();
  const P = { nose: [640, 360], tailL: [120, 760], tailR: [420, 880], keel: [380, 760], fold: [300, 800] };
  softShadow(c, () => { c.beginPath(); c.moveTo(...P.nose); c.lineTo(...P.tailL); c.lineTo(...P.tailR); c.closePath(); }, { blur: 30, alpha: 0.3, dx: 40, dy: 120 });
  const face = (pts, col) => { c.beginPath(); c.moveTo(...pts[0]); for (const p of pts.slice(1)) c.lineTo(...p); c.closePath(); c.fillStyle = col; c.fill(); c.lineWidth = 4; c.lineJoin = 'round'; c.strokeStyle = grey(55); c.stroke(); };
  face([P.nose, P.tailL, P.fold], linear(c, 120, 760, 640, 360, [[0, grey(232)], [1, grey(205)]]));
  face([P.nose, P.fold, P.keel], linear(c, 300, 800, 640, 360, [[0, grey(120)], [1, grey(165)]]));
  face([P.nose, P.keel, P.tailR], linear(c, 420, 880, 640, 360, [[0, grey(190)], [1, grey(228)]]));
  c.beginPath(); c.moveTo(...P.nose); c.lineTo(...P.keel); c.lineWidth = 3; c.strokeStyle = grey(40); c.stroke();
  return { canvas: cv, meta: { anchors: { nose: [P.nose[0] / PW, P.nose[1] / PH] } } };
}

const GENERATORS = { 'hand-phone': handPhone, clock, person, bulb, mug, plane };

function make(name, params = {}) {
  const g = GENERATORS[name];
  if (!g) throw new Error(`procedural plate "${name}" does not exist (available: ${Object.keys(GENERATORS).join(', ')})`);
  return g(params);
}

module.exports = { make, GENERATORS, PW, PH };
