#!/usr/bin/env node
// Turn any image into a plate: a 768 × 1376 greyscale guide with the subject on pure white, deep blacks and
// clean highlights. The stippler reads only its tone, so the photo itself never appears in the film.
//
//   node tools/plate-from-image.mjs <input.jpg|png|webp> plates/<name>.png [options]
//
//   --fit contain|cover   contain (default) keeps the whole image; cover fills the frame and crops
//   --bg auto|none        auto (default) flattens a plain background to white, judged from the borders
//   --tolerance 0.12      how far from the background tone still counts as background (0..1)
//   --black 0.06 --white 0.94 --gamma 1.0   levels: clip the ends, then bend the mid-tones
//   --invert              for a light subject on a dark background
//   --screen              measure the phone screen (a pure-white rectangle inside a dark bezel) and store it
//   --anchor name=u,v     store a named point (plate-normalised 0..1), e.g. --anchor fingertip=0.47,0.31
//
// Writes the PNG and a sidecar JSON with the same name ({ screen, anchors }) that the engine reads.
// Best input: one subject, plain background, strong side light, no text. For a phone in the shot, show a
// blank white screen so its content can be drawn by code. Generated images work well too: ask for "a
// high-contrast black-and-white studio photograph on a pure white background, single subject, no text".
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require('../engine/core/canvas.js');

const PW = 768, PH = 1376;
const args = process.argv.slice(2);
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && !['--screen', '--invert'].includes(args[i - 1])));
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i === -1 ? d : args[i + 1]; };
const flag = (k) => args.includes(`--${k}`);
if (pos.length < 2) { console.log('usage: node tools/plate-from-image.mjs <input> <output.png> [--fit contain|cover] [--bg auto|none] [--black b --white w --gamma g] [--invert] [--screen] [--anchor name=u,v]'); process.exit(1); }
const [input, output] = pos;

const img = await loadImage(fs.readFileSync(input));
const cv = createCanvas(PW, PH); const c = cv.getContext('2d');
c.fillStyle = '#fff'; c.fillRect(0, 0, PW, PH);
const fit = opt('fit', 'contain');
const s = fit === 'cover' ? Math.max(PW / img.width, PH / img.height) : Math.min(PW / img.width, PH / img.height);
const dw = img.width * s, dh = img.height * s;
c.drawImage(img, (PW - dw) / 2, (PH - dh) / 2, dw, dh);

const id = c.getImageData(0, 0, PW, PH); const d = id.data;
const L = new Float32Array(PW * PH);
for (let i = 0; i < PW * PH; i++) L[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
if (flag('invert')) for (let i = 0; i < L.length; i++) L[i] = 1 - L[i];

// Background: the median tone of a 2% border; pixels close to it fade to white.
if (opt('bg', 'auto') === 'auto') {
  const b = []; const m = Math.round(PW * 0.02);
  for (let y = 0; y < PH; y += 2) for (let x = 0; x < PW; x += 2) if (x < m || y < m || x >= PW - m || y >= PH - m) b.push(L[y * PW + x]);
  b.sort((p, q) => p - q); const bg = b[Math.floor(b.length / 2)];
  const spread = b[Math.floor(b.length * 0.9)] - b[Math.floor(b.length * 0.1)];
  const tol = parseFloat(opt('tolerance', '0.12'));
  if (spread < 0.25) {
    for (let i = 0; i < L.length; i++) { const k = Math.min(1, Math.max(0, (Math.abs(L[i] - bg) - tol) / tol)); L[i] = 1 - (1 - L[i]) * k * k * (3 - 2 * k); }
  } else console.warn(`background is busy (spread ${spread.toFixed(2)}): kept as is; a plain background gives cleaner plates`);
}
// Levels.
const black = parseFloat(opt('black', '0.06')), white = parseFloat(opt('white', '0.94')), gamma = parseFloat(opt('gamma', '1'));
for (let i = 0; i < L.length; i++) { const v = Math.min(1, Math.max(0, (L[i] - black) / (white - black))); L[i] = Math.pow(v, gamma); }
for (let i = 0; i < L.length; i++) { const v = Math.round(L[i] * 255); d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
c.putImageData(id, 0, 0);
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, cv.toBuffer('image/png'));

// Sidecar: measured screen and anchors.
const meta = {};
if (flag('screen')) {
  const sc = measureScreen(L, PW, PH);
  if (sc) { meta.screen = sc; console.log(`screen: cx ${sc.cx} cy ${sc.cy} w ${sc.w} h ${sc.h} rot ${sc.rot} rad`); }
  else console.warn('screen: none found (it must be pure white, fully inside a dark bezel, roughly 9:16 to 9:21)');
}
args.forEach((a, i) => { if (a === '--anchor') { const [k, uv] = args[i + 1].split('='); const [u, v] = uv.split(',').map(Number); (meta.anchors = meta.anchors || {})[k] = [u, v]; } });
fs.writeFileSync(output.replace(/\.png$/i, '.json'), JSON.stringify(meta, null, 1) + '\n');
console.log(`plate → ${output} (+ ${path.basename(output.replace(/\.png$/i, '.json'))})`);

// The largest bright region that does not touch the border, filled like a rectangle and shaped like a phone
// screen, measured as an oriented box (principal axes). rot: clockwise radians of the screen's up direction.
function measureScreen(L, W, H) {
  for (const thr of [0.94, 0.88, 0.8]) {
    const lab = new Int32Array(W * H).fill(0); let best = null; let n = 0;
    for (let p = 0; p < W * H; p++) {
      if (L[p] <= thr || lab[p]) continue;
      n++; const st = [p]; lab[p] = n; const xs = [], ys = []; let border = false;
      while (st.length) {
        const q = st.pop(); const x = q % W, y = (q / W) | 0; xs.push(x); ys.push(y);
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border = true;
        for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + ox, yy = y + oy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const qq = yy * W + xx; if (!lab[qq] && L[qq] > thr) { lab[qq] = n; st.push(qq); } }
      }
      if (border || xs.length < 0.003 * W * H) continue;
      const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
      let sxx = 0, syy = 0, sxy = 0; for (let k = 0; k < xs.length; k++) { const dx = xs[k] - mx, dy = ys[k] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
      const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);   // major axis angle
      let ux = Math.cos(th), uy = Math.sin(th); if (uy < 0) { ux = -ux; uy = -uy; }   // major axis points down
      const vx = -uy, vy = ux;
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (let k = 0; k < xs.length; k++) { const dx = xs[k] - mx, dy = ys[k] - my; const a = dx * ux + dy * uy, b = dx * vx + dy * vy; if (a < a0) a0 = a; if (a > a1) a1 = a; if (b < b0) b0 = b; if (b > b1) b1 = b; }
      const hh = a1 - a0, ww = b1 - b0; const fill = xs.length / Math.max(1, hh * ww);
      if (fill < 0.82 || hh / Math.max(1, ww) < 1.4 || hh / Math.max(1, ww) > 2.6) continue;
      if (!best || xs.length > best.area) {
        const cx = mx + ux * (a0 + a1) / 2 + vx * (b0 + b1) / 2, cy = my + uy * (a0 + a1) / 2 + vy * (b0 + b1) / 2;
        const rot = Math.atan2(-ux, uy);   // 0 = upright; positive = clockwise
        best = { area: xs.length, cx, cy, w: ww, h: hh, rot };
      }
    }
    if (best) { const m = 3; return { cx: +(best.cx / W).toFixed(4), cy: +(best.cy / H).toFixed(4), w: +((best.w - 2 * m) / W).toFixed(4), h: +((best.h - 2 * m) / H).toFixed(4), rot: +best.rot.toFixed(4) }; }
  }
  return null;
}
