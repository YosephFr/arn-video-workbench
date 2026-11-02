#!/usr/bin/env node
// Export the procedural plates as PNG (plus a JSON sidecar with the screen / dial / anchors) so you can look
// at them, edit them in any image editor, or use them as a template for your own photos.
//
//   node tools/plates.mjs                 every generator → plates/procedural/<name>.png + sheet.png
//   node tools/plates.mjs clock person    only those
//
// Films do not need these files: `src: 'procedural:<name>'` draws the plate in memory. Use an exported PNG
// when you want to retouch it, then point the film at it (`src: 'plates/procedural/clock.png'`).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const BENCH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { make, GENERATORS } = require('../engine/lib/procedural.js');
const { createCanvas } = require('../engine/core/canvas.js');

const names = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const list = names.length ? names : Object.keys(GENERATORS);
const out = path.join(BENCH, 'plates', 'procedural'); fs.mkdirSync(out, { recursive: true });
const thumbs = [];
for (const n of list) {
  const r = make(n);
  fs.writeFileSync(path.join(out, `${n}.png`), r.canvas.toBuffer('image/png'));
  fs.writeFileSync(path.join(out, `${n}.json`), JSON.stringify(r.meta, null, 1) + '\n');
  thumbs.push([n, r.canvas]);
  console.log(`plate ${n} → ${path.relative(process.cwd(), path.join(out, n + '.png'))}`);
}
const W = 192, H = 344, pad = 8;
const sheet = createCanvas(thumbs.length * (W + pad) + pad, H + pad * 2 + 22); const c = sheet.getContext('2d');
c.fillStyle = '#444'; c.fillRect(0, 0, sheet.width, sheet.height); c.font = '14px sans-serif';
thumbs.forEach(([n, cv], i) => { c.drawImage(cv, pad + i * (W + pad), pad, W, H); c.fillStyle = '#eee'; c.fillText(n, pad + i * (W + pad) + 4, H + pad + 16); });
fs.writeFileSync(path.join(out, 'sheet.png'), sheet.toBuffer('image/png'));
console.log(`sheet → ${path.relative(process.cwd(), path.join(out, 'sheet.png'))}`);
