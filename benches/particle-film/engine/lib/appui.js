'use strict';
// A generic phone app, drawn in phone points (390 wide, `h` tall, origin top-left; the caller sets the
// transform and clips to the screen). Colours, fonts and radius come from brand.json, so the screens look
// like *your* product. Replace these with drawings of your real screens when you have them: measure your
// app's layout once and reproduce it here, so the film shows the product people will actually use.
//
//   drawChat(c, t, { h, contact, initials, items, typing, bottom })   a messaging thread
//     items: { type: 'text', side: 'in'|'out', text, t0 } | { type: 'voice', side, line, t0, initials }
//            | { type: 'card', title, lines: [..], t0 } | { type: 'system', text, t0 }
//   drawList(c, t, { h, title, subtitle, rows, newRows, highlight, counters, button })   a list screen
//   icon(c, kind, x, y, size, color, lineWidth)

const { clamp, ease, lerp, smoothstep, mixHex } = require('../core/math');
const { brand } = require('./brand');
const { envelope } = require('./timeline');

function palette() {
  const b = brand(); const k = b.colors;
  return {
    bg: k.background, surface: k.surface, text: k.ink, sub: k.muted, accent: k.accent, accentInk: k.accent_ink,
    line: mixHex(k.background, k.ink, 0.1), soft: mixHex(k.accent, '#ffffff', 0.86), softer: mixHex(k.background, '#ffffff', 0.5), chip: mixHex(k.background, k.ink, 0.06),
    positive: k.positive, negative: k.negative, r: Math.max(8, Math.min(24, (b.radius || 28) * 0.64)),
  };
}
const F = (size, w = 400, role = 'body') => brand().font(w, size, role);
function rr(c, x, y, w, h, r) { c.beginPath(); c.roundRect(x, y, w, h, r); }
function text(c, s, x, y, size, w = 400, color, align = 'left', role = 'body') { c.font = F(size, w, role); c.fillStyle = color || palette().text; c.textAlign = align; c.textBaseline = 'alphabetic'; c.fillText(s, x, y); c.textAlign = 'left'; }
function initialsOf(name) { return String(name || '?').split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase(); }

// ---------- line icons (24-unit grid) ----------
function icon(c, kind, x, y, s, color, lw = 1.7) {
  c.save(); c.translate(x, y); c.scale(s / 24, s / 24); c.strokeStyle = color; c.fillStyle = color; c.lineWidth = lw * 24 / s; c.lineCap = 'round'; c.lineJoin = 'round';
  c.beginPath();
  if (kind === 'calendar' || kind === 'calendarPlus') { c.roundRect(3, 5, 18, 16, 3); c.moveTo(3, 10); c.lineTo(21, 10); c.moveTo(8, 3); c.lineTo(8, 7); c.moveTo(16, 3); c.lineTo(16, 7); if (kind === 'calendarPlus') { c.moveTo(15, 15); c.lineTo(21, 15); c.moveTo(18, 12); c.lineTo(18, 18); } }
  else if (kind === 'users') { c.arc(9, 8, 3.5, 0, Math.PI * 2); c.moveTo(2.5, 20); c.quadraticCurveTo(3, 13.5, 9, 13.5); c.quadraticCurveTo(15, 13.5, 15.5, 20); c.moveTo(16, 4.8); c.arc(16, 8, 3.2, -Math.PI / 2, Math.PI / 2); c.moveTo(17.5, 13.8); c.quadraticCurveTo(21.3, 14.6, 21.5, 20); }
  else if (kind === 'chat') { c.moveTo(20.5, 11.5); c.arc(12, 11.5, 8.5, 0, Math.PI * 0.62, false); c.lineTo(4, 21); c.lineTo(5.6, 16.4); c.arc(12, 11.5, 8.5, Math.PI * 0.8, Math.PI * 2, false); }
  else if (kind === 'chart') { c.moveTo(4, 3); c.lineTo(4, 21); c.lineTo(21, 21); c.moveTo(9, 17); c.lineTo(9, 11); c.moveTo(14, 17); c.lineTo(14, 7); c.moveTo(19, 17); c.lineTo(19, 13); }
  else if (kind === 'home') { c.moveTo(3, 11); c.lineTo(12, 3.5); c.lineTo(21, 11); c.moveTo(5.5, 9.5); c.lineTo(5.5, 20.5); c.lineTo(18.5, 20.5); c.lineTo(18.5, 9.5); c.moveTo(10, 20.5); c.lineTo(10, 14.5); c.lineTo(14, 14.5); c.lineTo(14, 20.5); }
  else if (kind === 'bell') { c.moveTo(6, 16); c.lineTo(6, 10.5); c.arc(12, 10.5, 6, Math.PI, 0); c.lineTo(18, 16); c.lineTo(19.5, 18); c.lineTo(4.5, 18); c.lineTo(6, 16); c.moveTo(10, 20.5); c.quadraticCurveTo(12, 22.5, 14, 20.5); }
  else if (kind === 'list') { for (const yy of [6, 12, 18]) { c.moveTo(9, yy); c.lineTo(20, yy); c.moveTo(4.5, yy); c.lineTo(5, yy); } }
  else if (kind === 'back') { c.moveTo(15, 4); c.lineTo(7, 12); c.lineTo(15, 20); }
  else if (kind === 'chevL') { c.moveTo(14, 6); c.lineTo(8, 12); c.lineTo(14, 18); }
  else if (kind === 'chevR') { c.moveTo(10, 6); c.lineTo(16, 12); c.lineTo(10, 18); }
  else if (kind === 'chevD') { c.moveTo(6, 9); c.lineTo(12, 15); c.lineTo(18, 9); }
  else if (kind === 'check') { c.moveTo(5, 12.5); c.lineTo(10, 17.5); c.lineTo(19, 7); }
  else if (kind === 'plus') { c.moveTo(12, 5); c.lineTo(12, 19); c.moveTo(5, 12); c.lineTo(19, 12); }
  else if (kind === 'clock') { c.arc(12, 12, 9, 0, Math.PI * 2); c.moveTo(12, 7); c.lineTo(12, 12); c.lineTo(15.5, 14); }
  else if (kind === 'star') { for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5; const r = k % 2 ? 4 : 9; const px = 12 + Math.cos(a) * r, py = 12.5 + Math.sin(a) * r; if (k) c.lineTo(px, py); else c.moveTo(px, py); } c.closePath(); }
  else if (kind === 'send') { c.moveTo(3, 11); c.lineTo(21, 3); c.lineTo(14, 21); c.lineTo(11, 13); c.closePath(); }
  else if (kind === 'mic') { c.roundRect(9, 3, 6, 11, 3); c.moveTo(5.5, 11); c.quadraticCurveTo(6, 17.5, 12, 17.5); c.quadraticCurveTo(18, 17.5, 18.5, 11); c.moveTo(12, 17.5); c.lineTo(12, 21); }
  else if (kind === 'spark') { c.moveTo(12, 3); c.quadraticCurveTo(13, 11, 21, 12); c.quadraticCurveTo(13, 13, 12, 21); c.quadraticCurveTo(11, 13, 3, 12); c.quadraticCurveTo(11, 11, 12, 3); }
  c.stroke(); c.restore();
}

function statusBar(c, { dark = false, clock = '9:41' } = {}) {
  const P = palette(); const col = dark ? '#ffffff' : P.text;
  text(c, clock, 30, 24, 13, 600, col);
  c.fillStyle = col; rr(c, 330, 14, 24, 11, 3); c.globalAlpha *= 0.9; c.fill(); c.globalAlpha /= 0.9; c.fillRect(355, 17.5, 2, 4);
  for (let k = 0; k < 3; k++) { c.fillRect(300 + k * 6, 22 - k * 3, 4, 3 + k * 3); }
}

// ---------- messaging thread ----------
function bars(line, n) {
  const env = envelope(line.id); const out = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i / n) * env.length), b = Math.max(a + 1, Math.floor(((i + 1) / n) * env.length));
    let m = 0; for (let j = a; j < b; j++) m = Math.max(m, env[j] || 0); out.push(Math.pow(m, 0.7));
  }
  return out;
}
// Transcript lines under a voice note: the words appear as they are spoken.
function transcriptLines(c, line, maxW) {
  c.font = F(12.5); const lines = []; let cur = [];
  for (const w of line.words) { const test = [...cur, w].map((x) => x.text).join(' '); if (c.measureText(test).width > maxW && cur.length) { lines.push(cur); cur = [w]; } else cur.push(w); }
  if (cur.length) lines.push(cur); return lines;
}
function voiceHeight(c, it) { return 66 + (it.transcript === false ? 0 : transcriptLines(c, it.line, 240).length * 18 + 8); }
function voiceNote(c, t, it, y) {
  const P = palette(); const out = it.side === 'out'; const w = 272, h = 66; const x = out ? 390 - 14 - w : 14;
  const H = voiceHeight(c, it); const line = it.line;
  const p = clamp((t - line.start) / (line.end - line.start)); const playing = t >= line.start && t < line.end;
  c.fillStyle = out ? P.soft : P.surface; rr(c, x, y, w, H, 18); c.fill();
  let cx = x + 14;
  c.fillStyle = out ? P.accent : P.chip; c.beginPath(); c.arc(cx + 20, y + h / 2, 20, 0, Math.PI * 2); c.fill();
  text(c, it.initials || 'AB', cx + 20, y + h / 2 + 5, 13, 600, out ? P.accentInk : P.sub, 'center'); cx += 50;
  c.fillStyle = out ? mixHex(P.accent, P.text, 0.45) : P.sub;
  if (playing) { rr(c, cx + 2, y + 24, 5.5, 20, 2); c.fill(); rr(c, cx + 11, y + 24, 5.5, 20, 2); c.fill(); }
  else { c.beginPath(); c.moveTo(cx + 2, y + 23); c.lineTo(cx + 19, y + 34); c.lineTo(cx + 2, y + 45); c.closePath(); c.fill(); }
  cx += 28;
  const n = 30, bw = (x + w - 16 - cx) / n, B = bars(line, n), mid = y + 32;
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n; const hh = 4 + B[i] * 26; const on = u <= p;
    c.fillStyle = on ? (out ? P.accent : P.text) : out ? mixHex(P.accent, '#ffffff', 0.5) : mixHex(P.surface, P.text, 0.3);
    rr(c, cx + i * bw + bw * 0.22, mid - hh / 2, bw * 0.56, hh, bw * 0.28); c.fill();
  }
  c.fillStyle = out ? P.accent : P.text; c.beginPath(); c.arc(cx + p * n * bw, mid, 6.5, 0, Math.PI * 2); c.fill();
  const secs = playing ? t - line.start : line.end - line.start;
  text(c, `0:${String(Math.max(1, Math.round(secs))).padStart(2, '0')}`, cx, y + h - 9, 11, 500, P.sub);
  if (it.transcript !== false) {
    const TL = transcriptLines(c, line, 240);
    c.fillStyle = P.line; c.fillRect(x + 16, y + h, w - 32, 1);
    TL.forEach((ws, i) => {
      let xx = x + 16; c.font = F(12.5);
      for (const wd of ws) { const a = clamp((t - wd.start + 0.05) / 0.12); if (a > 0) { c.save(); c.globalAlpha *= a; text(c, wd.text, xx, y + h + 18 + i * 18, 12.5, 400, P.text); c.restore(); } c.font = F(12.5); xx += c.measureText(wd.text + ' ').width; }
    });
  }
  return H;
}
function drawChat(c, t, o = {}) {
  const P = palette();
  const { h = 844, items = [], typing = [], contact = 'Sam Rivera', initials = initialsOf(o.contact || 'Sam Rivera'), status = 'online', typingLabel = 'typing…' } = o;
  c.fillStyle = P.bg; c.fillRect(0, 0, 390, h);
  statusBar(c);
  c.fillStyle = P.surface; c.fillRect(0, 36, 390, 72);
  icon(c, 'back', 10, 60, 24, P.text, 2); c.fillStyle = P.chip; c.beginPath(); c.arc(64, 72, 20, 0, Math.PI * 2); c.fill(); text(c, initials, 64, 77, 13, 600, P.sub, 'center');
  text(c, contact, 94, 68, 15, 600);
  const typingNow = typing.some(([a, b]) => t >= a && t < b);
  text(c, typingNow ? typingLabel : status, 94, 89, 12, typingNow ? 500 : 400, typingNow ? P.accent : P.sub);
  const shown = items.filter((it) => t >= it.t0);
  const heights = shown.map((it) => (it.type === 'voice' ? voiceHeight(c, it) : it.type === 'card' ? 22 + 30 + (it.lines || []).length * 20 + 14 : it.type === 'system' ? 30 : textHeight(c, it)));
  const total = heights.reduce((a, b) => a + b + 12, 0);
  // Messages start under the header and scroll up once they pass `bottom`; valign 'center' centres a short
  // thread in the screen (a proof moment reads better in the middle than stuck under the header).
  const bottom = o.bottom || h - 100; let y = Math.min(124, bottom - total);
  if (o.valign === 'center') y = Math.max(124, Math.min(bottom - total, (124 + bottom - total) / 2));
  shown.forEach((it, i) => {
    const p = clamp((t - it.t0) / 0.3); const sc = ease.outBack(p, 1.8);
    c.save(); c.globalAlpha *= clamp(p * 2.5);
    const ox = it.side === 'out' ? 376 : 14; c.translate(ox, y + heights[i]); c.scale(sc, sc); c.translate(-ox, -(y + heights[i]));
    if (it.type === 'voice') voiceNote(c, t, it, y);
    else if (it.type === 'system') { c.font = F(11.5, 600); const tw = c.measureText(it.text).width + 32; rr(c, 195 - tw / 2, y, tw, 26, 13); c.fillStyle = P.chip; c.fill(); text(c, it.text, 195, y + 17, 11.5, 600, P.sub, 'center'); }
    else if (it.type === 'card') {
      const x = 44, w = 302, H = heights[i]; c.fillStyle = P.surface; rr(c, x, y, w, H, 18); c.fill(); c.strokeStyle = mixHex(P.accent, '#ffffff', 0.6); c.lineWidth = 1.5; rr(c, x, y, w, H, 18); c.stroke();
      const k = smoothstep(it.t0 + 0.15, it.t0 + 0.5, t);
      c.fillStyle = P.accent; c.beginPath(); c.arc(x + 30, y + 30, 15, 0, Math.PI * 2); c.fill(); c.save(); c.globalAlpha *= k; icon(c, 'check', x + 20, y + 20, 20, P.accentInk, 3); c.restore();
      text(c, it.title || 'Confirmed', x + 56, y + 36, 15, 600);
      (it.lines || []).forEach((s, j) => text(c, s, x + 20, y + 70 + j * 20, j === 0 ? 13.5 : 12.5, j === 0 ? 600 : 400, j === 0 ? P.text : P.sub));
    } else {
      const L = textLayout(c, it.text); const w = L.w + 32; const x = it.side === 'out' ? 376 - w : 14; const H = heights[i];
      c.fillStyle = it.side === 'out' ? P.accent : P.surface; rr(c, x, y, w, H, 18); c.fill();
      L.lines.forEach((ln, j) => text(c, ln, x + 16, y + 28 + j * 20, 15, 400, it.side === 'out' ? P.accentInk : P.text));
    }
    c.restore();
    y += heights[i] + 12;
  });
  c.fillStyle = P.surface; c.fillRect(0, h - 74, 390, 74); c.fillStyle = P.bg; rr(c, 14, h - 62, 302, 44, 22); c.fill(); text(c, o.placeholder || 'Message', 32, h - 34, 13.5, 400, P.sub);
  c.fillStyle = P.accent; c.beginPath(); c.arc(350, h - 40, 22, 0, Math.PI * 2); c.fill(); icon(c, typingNow ? 'send' : 'mic', 340, h - 51, 20, P.accentInk, 2);
}
function textLayout(c, s) {
  c.font = F(15); const words = String(s).split(/\s+/); const lines = []; let cur = '';
  for (const w of words) { const test = cur ? cur + ' ' + w : w; if (c.measureText(test).width > 250 && cur) { lines.push(cur); cur = w; } else cur = test; }
  if (cur) lines.push(cur); return { lines, w: Math.max(...lines.map((l) => c.measureText(l).width)) };
}
function textHeight(c, it) { return 18 + textLayout(c, it.text).lines.length * 20 + 8; }

// ---------- list screen with counters ----------
// rows: [{ title, sub, meta }]; newRows: [{ row, t0 }] (pop in); highlight: [{ row, t0 }];
// counters: [{ label, from, to, t0, prefix, suffix }] (they roll when t passes t0); button: label of a
// primary action (or null).
function drawList(c, t, o = {}) {
  const P = palette();
  const { h = 844, title = 'Today', subtitle = '', rows = [], newRows = [], highlight = [], counters = [], button = null } = o;
  c.fillStyle = P.bg; c.fillRect(0, 0, 390, h);
  statusBar(c);
  text(c, title, 16, 92, 26, 700, P.text, 'left', 'display'); if (subtitle) text(c, subtitle, 16, 116, 13.5, 400, P.sub);
  let y = 136;
  if (counters.length) {
    const cw = (358 - (counters.length - 1) * 8) / counters.length;
    counters.forEach((k, i) => {
      const x = 16 + i * (cw + 8); const p = ease.outCubic(clamp((t - (k.t0 ?? 0)) / 0.6)); const v = Math.round(lerp(k.from ?? 0, k.to ?? 0, p));
      const pulse = k.to !== k.from && t >= (k.t0 ?? 0) ? Math.exp(-(t - k.t0) * 3) : 0;
      c.fillStyle = P.surface; rr(c, x, y, cw, 78, P.r); c.fill();
      if (pulse > 0.01) { c.save(); c.strokeStyle = P.accent; c.globalAlpha *= pulse; c.lineWidth = 2.5; rr(c, x, y, cw, 78, P.r); c.stroke(); c.restore(); }
      text(c, k.label, x + 14, y + 28, 12.5, 400, P.sub);
      text(c, `${k.prefix || ''}${v.toLocaleString('en-US')}${k.suffix || ''}`, x + 14, y + 62, 22, 700, pulse > 0.3 ? P.accent : P.text, 'left', 'display');
    });
    y += 92;
  }
  if (button) { c.fillStyle = P.accent; rr(c, 16, y, 358, 54, P.r); c.fill(); text(c, button, 195, y + 34, 15, 600, P.accentInk, 'center'); y += 68; }
  const all = [...rows, ...newRows.map((n) => n.row)];
  for (const r of all) {
    const nr = newRows.find((n) => n.row === r); let a = 1, sc = 1;
    if (nr) { const p = clamp((t - nr.t0) / 0.45); if (p <= 0) continue; a = p; sc = ease.outBack(p, 2); }
    const hl = highlight.find((x) => x.row === r); const hi = hl ? smoothstep(hl.t0, hl.t0 + 0.4, t) : 0;
    c.save(); c.globalAlpha *= a; c.translate(195, y + 32); c.scale(sc, sc); c.translate(-195, -(y + 32));
    c.fillStyle = hi > 0 ? mixHex(P.surface, P.soft, hi) : P.surface; rr(c, 16, y, 358, 64, P.r); c.fill();
    if (hi > 0) { c.save(); c.strokeStyle = P.accent; c.lineWidth = 2; c.globalAlpha *= hi; rr(c, 16, y, 358, 64, P.r); c.stroke(); c.restore(); }
    c.fillStyle = P.soft; c.beginPath(); c.arc(46, y + 32, 17, 0, Math.PI * 2); c.fill(); text(c, initialsOf(r.title), 46, y + 37, 12, 700, P.accent, 'center');
    text(c, r.title, 74, y + 28, 14.5, 600); if (r.sub) text(c, r.sub, 74, y + 48, 12.5, 400, P.sub);
    if (r.meta) text(c, r.meta, 360, y + 38, 13, 600, P.text, 'right');
    c.restore();
    y += 72; if (y > h - 90) break;
  }
  // Tab bar.
  const ty = h - 74; c.fillStyle = P.surface; rr(c, 12, ty, 366, 64, 22); c.fill();
  ['home', 'calendar', 'chat', 'users'].forEach((ic, i) => { const cx = 12 + 45.75 + i * 91.5; if (i === (o.tab ?? 0)) { c.fillStyle = P.soft; rr(c, cx - 30, ty + 8, 60, 48, 16); c.fill(); } icon(c, ic, cx - 11, ty + 21, 22, i === (o.tab ?? 0) ? P.accent : P.sub); });
}

module.exports = { drawChat, drawList, icon, statusBar, palette, initialsOf, voiceHeight, PW: 390 };
