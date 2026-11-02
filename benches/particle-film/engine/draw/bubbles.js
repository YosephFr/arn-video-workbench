'use strict';
// Chat bubbles drawn like an illustrator's sketchbook: a wobbling ink outline, a tinted wash and legible
// type. They work on paper (ink tones) and in the dark (light tones). Fonts come from the brand.

const { sketch, roundRectPts } = require('./ink');
const { clamp, ease, hash } = require('../core/math');
const { fontStack } = require('../core/fonts');

let FAMILY = { body: 'Inter', mono: 'JetBrains Mono' };
function setFamilies(f) { FAMILY = { ...FAMILY, ...f }; }

const TONES = {
  ink: { line: '#23201b', wash: 'rgba(35,32,27,0.06)', text: '#1d1a16', meta: 'rgba(29,26,22,0.55)' },
  out: { line: '#23201b', wash: 'rgba(35,32,27,0.13)', text: '#1d1a16', meta: 'rgba(29,26,22,0.55)' },
  red: { line: '#b8261f', wash: 'rgba(200,50,43,0.16)', text: '#2a0f0c', meta: 'rgba(160,30,25,0.8)' },
  green: { line: '#1f7a4d', wash: 'rgba(40,160,95,0.16)', text: '#0f2a1c', meta: 'rgba(25,110,65,0.8)' },
  gold: { line: '#9a6a12', wash: 'rgba(214,160,50,0.18)', text: '#2a1d05', meta: 'rgba(140,95,20,0.8)' },
  grey: { line: 'rgba(35,32,27,0.35)', wash: 'rgba(35,32,27,0.04)', text: 'rgba(29,26,22,0.45)', meta: 'rgba(29,26,22,0.35)' },
  // Luminous variants for the night world.
  lgreen: { line: '#63f2a6', wash: 'rgba(60,230,140,0.10)', text: '#e9fff3', meta: 'rgba(160,255,200,0.7)' },
  lwhite: { line: '#dfe6ff', wash: 'rgba(200,210,255,0.07)', text: '#f2f5ff', meta: 'rgba(200,210,255,0.6)' },
  lred: { line: '#ff5a4e', wash: 'rgba(255,80,70,0.10)', text: '#ffe9e6', meta: 'rgba(255,150,140,0.7)' },
  lgold: { line: '#ffc35a', wash: 'rgba(255,190,80,0.12)', text: '#fff6e3', meta: 'rgba(255,220,150,0.75)' },
  lsolid: { line: '#ffffff', wash: 'rgba(255,250,238,0.94)', text: '#15130f', meta: 'rgba(40,36,30,0.6)' },
  lgrey: { line: 'rgba(200,205,220,0.35)', wash: 'rgba(200,210,255,0.04)', text: 'rgba(220,225,240,0.55)', meta: 'rgba(200,210,255,0.35)' },
};

function fontStr(size, weight = 500, fam = FAMILY.body) { return `${weight} ${size}px ${fontStack(fam)}`; }
function monoStr(size, weight = 400) { return `${weight} ${size}px ${fontStack(FAMILY.mono)}`; }

// Word-wrap text to maxW; returns { lines, w, h } for the given font size.
function layout(ctx, text, { size = 38, maxW = 560, weight = 500, lh = 1.28, fam = FAMILY.body } = {}) {
  ctx.save(); ctx.font = fontStr(size, weight, fam);
  const words = String(text).split(/\s+/); const lines = []; let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test;
  }
  if (cur) lines.push(cur);
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width));
  ctx.restore();
  return { lines, w, h: lines.length * size * lh, size, lh, weight, fam };
}

function bubbleBox(L, { padX = 28, padY = 20, metaW = 0 } = {}) {
  const w = Math.max(L.w, metaW) + padX * 2; const h = L.h + padY * 2 + (metaW ? L.size * 0.62 : 0);
  return { w, h, padX, padY };
}

// Rounded rectangle with a small hand-drawn tail at the bottom corner.
function bubblePath(x, y, w, h, side, r = 30) {
  const pts = roundRectPts(x, y, w, h, r, 8);
  const tail = side === 'out'
    ? [[x + w - r * 0.6, y + h], [x + w + 14, y + h + 10], [x + w - 4, y + h - r * 0.45]]
    : [[x + r * 0.6, y + h], [x - 14, y + h + 10], [x + 4, y + h - r * 0.45]];
  return { pts, tail };
}

// Draw a bubble. b: { x, y, text, side 'in'|'out', tone, time, meta, appear 0..1, typed (chars), seed, size,
// maxW, align 'right', wash, line, textColor, alpha, scale, weight, L (precomputed layout) }
function drawBubble(ctx, b, t) {
  const tone = TONES[b.tone || (b.side === 'out' ? 'out' : 'ink')];
  const L = b.L || layout(ctx, b.text, { size: b.size || 38, maxW: b.maxW || 560, weight: b.weight || 500 });
  ctx.save(); ctx.font = monoStr(Math.round(L.size * 0.52));
  const metaText = [b.time, b.meta].filter(Boolean).join('  ');
  const metaW = metaText ? ctx.measureText(metaText).width : 0; ctx.restore();
  const box = bubbleBox(L, { metaW });
  const x = b.align === 'right' ? b.x - box.w : b.x; const y = b.y;
  const ap = clamp(b.appear === undefined ? 1 : b.appear);
  if (ap <= 0) return { w: box.w, h: box.h, x, y };
  ctx.save();
  // Pop-in: scale from the tail corner with a little overshoot.
  const ox = b.side === 'out' ? x + box.w : x, oy = y + box.h;
  const sc = ease.outBack(ap, 2.2) * (b.scale || 1);
  ctx.translate(ox, oy); ctx.scale(sc, sc); ctx.translate(-ox, -oy);
  ctx.globalAlpha *= clamp(ap * 3) * (b.alpha === undefined ? 1 : b.alpha);
  const { pts, tail } = bubblePath(x, y, box.w, box.h, b.side);
  ctx.fillStyle = b.wash || tone.wash; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (const p of pts) ctx.lineTo(p[0], p[1]); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(tail[0][0], tail[0][1]); ctx.lineTo(tail[1][0], tail[1][1]); ctx.lineTo(tail[2][0], tail[2][1]); ctx.closePath(); ctx.fill();
  const seed = b.seed || Math.floor(hash(x * 7 + y * 13) * 1000);
  const lw = b.lineWidth || 2.6;
  sketch(ctx, pts, { width: lw, color: b.line || tone.line, t, seed, boil: b.boil === undefined ? 1.1 : b.boil, passes: 2, closed: true, spacing: 6 });
  sketch(ctx, [tail[0], tail[1], tail[2]], { width: lw * 0.9, color: b.line || tone.line, t, seed: seed + 3, boil: 0.8, passes: 1, taper: 0.3 });
  ctx.fillStyle = b.textColor || tone.text; ctx.font = fontStr(L.size, L.weight, L.fam); ctx.textBaseline = 'alphabetic';
  let budget = b.typed === undefined ? Infinity : Math.floor(b.typed);
  L.lines.forEach((line, i) => {
    if (budget <= 0) return;
    const chars = Array.from(line); const shown = chars.slice(0, Math.min(chars.length, budget)).join(''); budget -= chars.length + 1;
    ctx.fillText(shown, x + box.padX, y + box.padY + L.size * (0.92 + i * L.lh));
  });
  if (metaText) {
    ctx.font = monoStr(Math.round(L.size * 0.52)); ctx.fillStyle = tone.meta; ctx.textAlign = 'right';
    ctx.fillText(metaText, x + box.w - box.padX * 0.7, y + box.h - box.padY * 0.55); ctx.textAlign = 'left';
  }
  ctx.restore();
  return { w: box.w, h: box.h, x, y };
}

// A "seen" label with a hand-drawn double tick.
function drawSeen(ctx, x, y, label, t, { color = 'rgba(29,26,22,0.7)', size = 24, align = 'right', ticks = true, seed = 5 } = {}) {
  ctx.save(); ctx.font = monoStr(size, 500); ctx.fillStyle = color; ctx.textAlign = align;
  ctx.fillText(label, x, y); const w = ctx.measureText(label).width; ctx.restore();
  if (ticks) {
    const tx = align === 'right' ? x - w - 58 : x + w + 14; const ty = y - size * 0.35;
    for (let k = 0; k < 2; k++) sketch(ctx, [[tx + k * 14, ty], [tx + 8 + k * 14, ty + 8], [tx + 24 + k * 14, ty - 10]], { width: 2.4, color, t, seed: seed + k, boil: 0.6, passes: 1, taper: 0.25 });
  }
}

// Typing indicator: three bouncing dots.
function drawTyping(ctx, x, y, t, { color = '#23201b', r = 7, gap = 22 } = {}) {
  ctx.save();
  for (let k = 0; k < 3; k++) {
    const ph = t * 6 - k * 0.7; const lift = Math.max(0, Math.sin(ph)) * 8;
    ctx.beginPath(); ctx.fillStyle = color; ctx.globalAlpha = 0.5 + 0.5 * Math.max(0, Math.sin(ph));
    ctx.arc(x + k * gap, y - lift, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

module.exports = { TONES, layout, drawBubble, drawSeen, drawTyping, fontStr, monoStr, bubbleBox, setFamilies };
