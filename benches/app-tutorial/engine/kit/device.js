'use strict';
// The phone around the captures: body, side buttons, camera island or punch hole, status bar, home indicator and a
// compact browser address bar. Everything is drawn in code in CSS px of the device (393 wide), so it stays sharp
// at any zoom and carries no third-party artwork.
const rr = (c, x, y, w, h, r) => { c.beginPath(); c.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2))); };

// iPhone-style status bar. o: { dark (white glyphs), time, font }
function statusBar(c, w, o = {}) {
  const col = o.dark ? '#ffffff' : '#111111'; const font = o.font || ((wt, s) => `${wt} ${s}px sans-serif`);
  c.save(); c.fillStyle = col; c.strokeStyle = col; c.font = font(600, 17, 'body'); c.textBaseline = 'middle'; c.textAlign = 'center';
  c.fillText(o.time || '9:41', 66, 30);
  const x = w - 36;   // battery
  c.globalAlpha = 0.4; rr(c, x - 12, 23, 25, 13, 4); c.lineWidth = 1.2; c.stroke(); c.globalAlpha = 1;
  rr(c, x - 10, 25, 19, 9, 2.5); c.fill(); c.globalAlpha = 0.45; rr(c, x + 14, 27.5, 2, 4.5, 1); c.fill(); c.globalAlpha = 1;
  const wx = w - 70, wy = 35; c.lineWidth = 2.1; c.lineCap = 'round';   // wifi
  for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(wx, wy, 3.5 + i * 3.6, -Math.PI * 0.75, -Math.PI * 0.25); c.stroke(); }
  c.beginPath(); c.arc(wx, wy, 1.3, 0, Math.PI * 2); c.fill();
  for (let i = 0; i < 4; i++) { rr(c, w - 104 + i * 5.2, 36 - (4 + i * 2.6), 3.4, 4 + i * 2.6, 1); c.fill(); }   // signal
  c.restore();
}

// Android-style status bar and gesture pill.
function androidStatus(c, w, o = {}) {
  const col = o.dark ? '#ffffff' : '#1f1f1f'; const font = o.font || ((wt, s) => `${wt} ${s}px sans-serif`);
  c.save(); c.fillStyle = col; c.font = font(500, 15, 'body'); c.textBaseline = 'middle'; c.textAlign = 'left';
  c.fillText(o.time || '9:41', 22, 17);
  rr(c, w - 34, 11, 13, 12, 2.5); c.fill();
  c.beginPath(); c.moveTo(w - 58, 23); c.lineTo(w - 44, 23); c.lineTo(w - 44, 10); c.closePath(); c.fill();
  c.beginPath(); c.moveTo(w - 78, 14); c.arc(w - 72, 23, 11, -Math.PI * 0.78, -Math.PI * 0.22); c.closePath(); c.fill();
  c.restore();
}
function androidNav(c, w, h, dark) { c.save(); c.fillStyle = dark ? 'rgba(255,255,255,0.8)' : 'rgba(31,31,31,0.75)'; rr(c, w / 2 - 54, h - 12, 108, 4.5, 2.5); c.fill(); c.restore(); }
function homeIndicator(c, w, h, dark) { c.save(); c.fillStyle = dark ? 'rgba(255,255,255,0.85)' : 'rgba(17,17,17,0.82)'; rr(c, w / 2 - 67, h - 9, 134, 5, 3); c.fill(); c.restore(); }

// Compact mobile-browser address bar at the bottom of the screen (88 px). o: { bg, font }
const BROWSER_TOP = 54, BROWSER_BAR = 88;
function browserBar(c, w, h, url, o = {}) {
  const y0 = h - BROWSER_BAR; const font = o.font || ((wt, s) => `${wt} ${s}px sans-serif`);
  c.save();
  c.fillStyle = o.bg || '#f4f4f2'; c.fillRect(0, y0, w, BROWSER_BAR);
  c.shadowColor = 'rgba(20,20,25,0.14)'; c.shadowBlur = 14; c.shadowOffsetY = 3;
  c.fillStyle = 'rgba(255,255,255,0.97)'; rr(c, 14, y0 + 10, w - 28, 50, 25); c.fill(); c.shadowColor = 'transparent';
  c.strokeStyle = '#1b1b1d'; c.lineWidth = 2.2; c.lineCap = 'round'; c.lineJoin = 'round';
  c.beginPath(); c.moveTo(44, y0 + 26); c.lineTo(36, y0 + 35); c.lineTo(44, y0 + 44); c.stroke();   // back
  c.fillStyle = '#1b1b1d'; for (let i = -1; i <= 1; i++) { c.beginPath(); c.arc(w - 42 + i * 6.5, y0 + 35, 1.9, 0, Math.PI * 2); c.fill(); }   // more
  c.font = font(500, 16, 'body'); c.textAlign = 'center'; c.textBaseline = 'middle';
  const tw = c.measureText(url).width; c.fillText(url, w / 2 + 9, y0 + 36);
  const lx = w / 2 - tw / 2 - 4; c.lineWidth = 1.5; c.beginPath(); c.arc(lx, y0 + 31, 3.2, Math.PI, 0); c.stroke(); rr(c, lx - 4.6, y0 + 31, 9.2, 8, 1.6); c.fill();   // lock
  c.restore();
}

// Phone body around a screen rectangle G = { left, top, sw, sh, k } (frame px). android: punch hole, fewer buttons.
function phoneBody(ctx, G, C, android) {
  const R = (android ? 34 : 55) * G.k, bez = android ? 10 : 13, rad = R + bez;
  ctx.save(); ctx.shadowColor = 'rgba(30,30,40,0.22)'; ctx.shadowBlur = 46; ctx.shadowOffsetY = 26; ctx.fillStyle = C.phone;
  rr(ctx, G.left - bez, G.top - bez, G.sw + bez * 2, G.sh + bez * 2, rad); ctx.fill(); ctx.restore();
  ctx.save(); ctx.strokeStyle = C.rim; ctx.lineWidth = 2.2; rr(ctx, G.left - bez + 1, G.top - bez + 1, G.sw + bez * 2 - 2, G.sh + bez * 2 - 2, rad - 1); ctx.stroke(); ctx.restore();
  ctx.save(); ctx.fillStyle = C.phone;
  if (android) { rr(ctx, G.left + G.sw + bez - 0.5, G.top + G.sh * 0.2, 4, G.sh * 0.13, 2); ctx.fill(); rr(ctx, G.left + G.sw + bez - 0.5, G.top + G.sh * 0.37, 4, G.sh * 0.07, 2); ctx.fill(); }
  else {
    [[0.2, 0.05], [0.29, 0.08], [0.4, 0.08]].forEach(([fy, fh]) => { rr(ctx, G.left - bez - 3.5, G.top + G.sh * fy, 4, G.sh * fh, 2); ctx.fill(); });
    rr(ctx, G.left + G.sw + bez - 0.5, G.top + G.sh * 0.3, 4, G.sh * 0.12, 2); ctx.fill();
  }
  ctx.restore();
  return R;
}
function phoneCamera(ctx, G, C, android) {
  ctx.save(); ctx.fillStyle = C.island;
  if (android) { ctx.beginPath(); ctx.arc(G.left + G.sw / 2, G.top + 16 * G.k, 6.5 * G.k, 0, Math.PI * 2); ctx.fill(); }
  else { rr(ctx, G.left + G.sw / 2 - 62 * G.k, G.top + 11 * G.k, 124 * G.k, 36 * G.k, 18 * G.k); ctx.fill(); }
  ctx.restore();
}

module.exports = { rr, statusBar, androidStatus, androidNav, homeIndicator, browserBar, phoneBody, phoneCamera, BROWSER_TOP, BROWSER_BAR };
