#!/usr/bin/env node
// Highlight covers: one 1080 × 1920 PNG per pack (profiles show its central circle), a plain brand-colour ground
// with one white line icon, plus a preview of how the row of highlights reads on a profile.
//   node tools/covers.mjs samples        → <pack>/renders/cover.png for every pack, samples/renders/profile-preview.png
// Reads every <dir>/*/pack.json that has "cover": { "icon": "user-plus" | "path/to/icon.svg", "name": "Start",
// "color": "#3355E0" (optional, the brand accent by default) }. An icon path is any 24 × 24 line icon you are allowed
// to use (an open icon library works well); the built-in set below is generic and drawn for this bench.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.resolve(HERE, '..');
process.env.WB_BENCH_DIR = process.env.WB_BENCH_DIR || BENCH;
process.env.WB_CANVAS_FROM = process.env.WB_CANVAS_FROM || path.join(BENCH, 'package.json');
const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require('../../app-tutorial/engine/kit/canvas.js');
const { loadBrand } = require('../../app-tutorial/engine/kit/brand.js');

// Generic 24 × 24 line icons (stroke only).
const ICONS = {
  'user-plus': '<circle cx="9" cy="8" r="4"/><path d="M2.5 20c.7-3.8 3.3-6 6.5-6s5.8 2.2 6.5 6"/><path d="M19 8v6M16 11h6"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  chat: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17H6.5A2.5 2.5 0 0 1 4 14.5z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18M16 15h2"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14"/><path d="M12 17.2v.1"/>',
};
const svgIcon = (body, size, color) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

async function icon(spec, dir, size) {
  if (ICONS[spec]) return loadImage(Buffer.from(svgIcon(ICONS[spec], size, '#ffffff')));
  const file = path.resolve(dir, spec); if (!fs.existsSync(file)) throw new Error(`icon ${spec}: not built in (${Object.keys(ICONS).join(', ')}) and no file at ${file}`);
  const svg = fs.readFileSync(file, 'utf8').replace(/stroke="currentColor"/g, 'stroke="#ffffff"').replace(/width="[\d.]+"/, `width="${size}"`).replace(/height="[\d.]+"/, `height="${size}"`);
  return loadImage(Buffer.from(svg));
}

const argv = process.argv.slice(2);
const root = path.resolve(argv.find((a) => !a.startsWith('--')) || 'samples');
const packs = fs.readdirSync(root).map((d) => path.join(root, d)).filter((d) => fs.existsSync(path.join(d, 'pack.json')))
  .map((d) => ({ dir: d, pack: JSON.parse(fs.readFileSync(path.join(d, 'pack.json'), 'utf8')) })).filter((p) => p.pack.cover).sort((a, b) => a.dir.localeCompare(b.dir));
if (!packs.length) { console.error(`no pack.json with a "cover" under ${root}`); process.exit(1); }

const SIZE = 470;   // icon side on the cover: fills the central circle without touching its edge
const made = [];
for (const { dir, pack } of packs) {
  const brand = loadBrand(path.join(dir, pack.stories[0]));
  const cv = createCanvas(1080, 1920); const c = cv.getContext('2d');
  c.fillStyle = pack.cover.color || brand.colors.accent; c.fillRect(0, 0, 1080, 1920);
  const im = await icon(pack.cover.icon, dir, SIZE); c.drawImage(im, 540 - SIZE / 2, 960 - SIZE / 2, SIZE, SIZE);
  const file = path.join(dir, 'renders', 'cover.png'); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, cv.toBuffer('image/png'));
  console.log('cover →', path.relative(process.cwd(), file)); made.push({ cv, name: pack.cover.name || pack.title, brand });
}

// How the row reads on a profile: circles cut from the centre of each cover, names under them.
const W = Math.max(600, made.length * 240); const V = createCanvas(W, 330); const v = V.getContext('2d');
v.fillStyle = '#ffffff'; v.fillRect(0, 0, W, 330);
made.forEach(({ cv, name, brand }, i) => {
  const cx = 120 + i * 240, cy = 140, r = 88;
  v.save(); v.beginPath(); v.arc(cx, cy, r + 8, 0, Math.PI * 2); v.strokeStyle = '#dbdbdb'; v.lineWidth = 3; v.stroke();
  v.beginPath(); v.arc(cx, cy, r, 0, Math.PI * 2); v.clip(); v.drawImage(cv, 0, 420, 1080, 1080, cx - r, cy - r, r * 2, r * 2); v.restore();
  v.fillStyle = '#262626'; v.font = brand.font(500, 26, 'body'); v.textAlign = 'center'; v.fillText(name, cx, 280);
});
const pv = path.join(root, 'renders', 'profile-preview.png'); fs.mkdirSync(path.dirname(pv), { recursive: true }); fs.writeFileSync(pv, V.toBuffer('image/png')); console.log('preview →', path.relative(process.cwd(), pv));
