#!/usr/bin/env node
// Compare stipple settings for a plate side by side before committing them to a film.
//
//   node tools/probe-plate.mjs procedural:person '{"gamma":1.1}' '{"gamma":1.4,"edge":1.2}' '{"N":18000}'
//   node tools/probe-plate.mjs plates/my-hands.png '{}' '{"floor":0.1}' '{"crop":[0,0.2,1,0.8]}'
//
// Each variant is stippled with the engine's own code and drawn on paper with the film's dot sizes; the
// sheet goes to renders/probe-plate.png. Defaults: N 26000, gamma 1.1, edge 0.8, floor 0.04.
// What to look for: the silhouette reads at a glance, mid-tones are airy (raise gamma), outlines survive
// (raise edge), the background stays clean (raise floor), and N is the lowest that still holds detail.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const BENCH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.WB_BENCH = process.env.WB_BENCH || BENCH;
process.env.WB_PIECE = process.env.WB_PIECE || process.cwd();
const P = require('../engine/lib/plates.js');
const { createCanvas } = require('../engine/core/canvas.js');
const { makePaper } = require('../engine/post/post.js');

const [src, ...variants] = process.argv.slice(2);
if (!src) { console.log("usage: node tools/probe-plate.mjs <procedural:name | file.png> '{json options}' ..."); process.exit(1); }
const list = variants.length ? variants.map((v) => JSON.parse(v)) : [{}];
const W = 540, H = 960; const tiles = [];
const paper = makePaper(W, H, { seed: 1 });
for (const [k, o] of list.entries()) {
  const name = `probe${k}`;
  P.register({ [name]: { src, N: 26000, gamma: 1.1, edge: 0.8, floor: 0.04, ...o } });
  const t0 = Date.now(); await P.loadPlates([name]); const ms = Date.now() - t0;
  const p = P.plate(name);
  const cv = createCanvas(W, H); const c = cv.getContext('2d'); c.drawImage(paper, 0, 0);
  const h = H * 0.92, w = h * p.aspect; const cx = W / 2, cy = H / 2;
  for (let i = 0; i < p.pts.n; i++) {
    const v = p.pts.v[i]; const r = (0.85 + 1.45 * v) * 0.5;
    c.fillStyle = `rgba(28,26,22,${0.55 + 0.45 * v})`; c.beginPath(); c.arc(cx + (p.pts.x[i] - 0.5) * w, cy + (p.pts.y[i] - 0.5) * h, Math.max(0.45, r), 0, Math.PI * 2); c.fill();
  }
  c.fillStyle = '#b4432f'; c.font = '15px sans-serif'; c.fillText(`${JSON.stringify(o)}  (${p.pts.n} dots, ${ms} ms)`.slice(0, 70), 10, 22);
  tiles.push(cv);
}
const cols = Math.min(4, tiles.length); const rows = Math.ceil(tiles.length / cols);
const sheet = createCanvas(cols * (W + 6) + 6, rows * (H + 6) + 6); const s = sheet.getContext('2d');
s.fillStyle = '#222'; s.fillRect(0, 0, sheet.width, sheet.height);
tiles.forEach((t, i) => s.drawImage(t, 6 + (i % cols) * (W + 6), 6 + Math.floor(i / cols) * (H + 6)));
const out = path.join(BENCH, 'renders', 'probe-plate.png'); fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, sheet.toBuffer('image/png'));
console.log(`probe → ${path.relative(process.cwd(), out)} (${tiles.length} variants)`);
