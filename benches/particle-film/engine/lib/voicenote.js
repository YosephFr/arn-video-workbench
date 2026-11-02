'use strict';
// Voice notes drawn like the chat bubbles (sketchy outline, wash, legible type): the sender's initials, a
// play / pause icon, waveform bars cut from the line's real loudness envelope, a playhead that follows the
// audio and the elapsed time. A line voiced with "effect": "voice-note" reads best when it appears as one.

const { sketch, roundRectPts } = require('../draw/ink');
const { clamp, ease } = require('../core/math');
const { envelope } = require('./timeline');
const { brand } = require('./brand');

function tones() {
  const c = brand().colors;
  return {
    paper: { line: '#23201b', wash: 'rgba(255,252,244,0.92)', bar: 'rgba(35,32,27,0.32)', played: c.accent, text: 'rgba(29,26,22,0.62)', icon: '#23201b', avatar: c.accent, avatarInk: c.accent_ink },
    night: { line: 'rgba(255,245,228,0.85)', wash: 'rgba(24,22,20,0.94)', bar: 'rgba(255,245,228,0.3)', played: c.accent, text: 'rgba(255,245,228,0.7)', icon: '#fff3e0', avatar: c.accent, avatarInk: c.accent_ink },
  };
}
const fmt = (s) => `0:${String(Math.max(0, Math.floor(s))).padStart(2, '0')}`;

// Bar heights (0..1) from a line's 50 Hz envelope.
function bars(id, n) {
  const env = envelope(id); const out = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i / n) * env.length), b = Math.max(a + 1, Math.floor(((i + 1) / n) * env.length));
    let m = 0; for (let j = a; j < b; j++) m = Math.max(m, env[j] || 0);
    out.push(Math.pow(m, 0.75));
  }
  return out;
}

// o: { x, y (top-left), w, h, line (timeline line), t, side 'in'|'out', tone 'paper'|'night', initials,
//      appear 0..1, name, n (bars), scale, seed }
function drawVoiceNote(c, o) {
  const { x, y, w = 640, h = 128, line, t, side = 'in', tone = 'paper', initials = null, appear = 1, n = 38, seed = 11, name = null } = o;
  const T = tones()[tone]; if (appear <= 0) return;
  const b = brand();
  const dur = line.end - line.start; const p = clamp((t - line.start) / dur); const playing = t >= line.start && t < line.end;
  c.save();
  const ox = side === 'out' ? x + w : x, oy = y + h; const sc = ease.outBack(clamp(appear), 2) * (o.scale || 1);
  c.translate(ox, oy); c.scale(sc, sc); c.translate(-ox, -oy); c.globalAlpha *= clamp(appear * 3);
  const r = 34; const pts = roundRectPts(x, y, w, h, r, 8);
  const tail = side === 'out' ? [[x + w - r * 0.6, y + h], [x + w + 16, y + h + 12], [x + w - 4, y + h - r * 0.45]] : [[x + r * 0.6, y + h], [x - 16, y + h + 12], [x + 4, y + h - r * 0.45]];
  c.fillStyle = T.wash; c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (const q of pts) c.lineTo(q[0], q[1]); c.closePath(); c.fill();
  c.beginPath(); c.moveTo(tail[0][0], tail[0][1]); c.lineTo(tail[1][0], tail[1][1]); c.lineTo(tail[2][0], tail[2][1]); c.closePath(); c.fill();
  sketch(c, pts, { width: 2.6, color: T.line, t, seed, boil: 1.0, passes: 2, closed: true, spacing: 6 });
  sketch(c, tail, { width: 2.4, color: T.line, t, seed: seed + 3, boil: 0.8, passes: 1, taper: 0.3 });
  const cy = y + h / 2; let cx = x + 26;
  if (initials) {
    const ar = h * 0.32; c.beginPath(); c.arc(cx + ar, cy, ar, 0, Math.PI * 2); c.fillStyle = T.avatar; c.fill();
    c.fillStyle = T.avatarInk; c.font = b.font(700, Math.round(ar * 0.8), 'display'); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(initials, cx + ar, cy + 1);
    c.textAlign = 'left'; cx += ar * 2 + 22;
  }
  c.fillStyle = T.icon; c.save(); c.translate(cx + 16, cy - 6);
  if (playing) { c.fillRect(-11, -16, 8, 32); c.fillRect(4, -16, 8, 32); }
  else { c.beginPath(); c.moveTo(-10, -18); c.lineTo(16, 0); c.lineTo(-10, 18); c.closePath(); c.fill(); }
  c.restore(); cx += 52;
  const bw = (x + w - 30 - cx) / n; const B = bars(line.id, n); const midY = cy - 8;
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n; const hh = 6 + B[i] * (h * 0.46);
    const played = u <= p; const bx = cx + i * bw + bw * 0.2;
    const live = playing && Math.abs(u - p) < 1.5 / n ? 1 + 0.18 * Math.sin(t * 40 + i) : 1;
    c.fillStyle = played ? T.played : T.bar;
    c.beginPath(); c.roundRect(bx, midY - (hh * live) / 2, bw * 0.6, hh * live, bw * 0.3); c.fill();
  }
  const px = cx + p * (n * bw); c.fillStyle = T.played; c.beginPath(); c.arc(px, midY, 9, 0, Math.PI * 2); c.fill();
  c.font = b.font(500, 26, 'mono'); c.fillStyle = T.text; c.textBaseline = 'alphabetic';
  c.fillText(fmt(playing ? (t - line.start) : dur), cx, y + h - 16);
  if (name) { c.textAlign = 'right'; c.fillText(name, x + w - 28, y + h - 16); c.textAlign = 'left'; }
  c.restore();
}

module.exports = { drawVoiceNote, bars };
