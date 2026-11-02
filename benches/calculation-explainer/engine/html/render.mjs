#!/usr/bin/env node
// The light HTML path: scenes are plain DOM in <piece>/scenes.html, timed by data-in anchors (see runtime.js), and
// core/node/frames.mjs captures them frame by frame in headless Chromium.
//   node engine/html/render.mjs <piece> still 2,6,10      → <piece>/renders/still-<t>.jpg
//   node engine/html/render.mjs <piece> preview           → <piece>/renders/preview.mp4 (half size, with the mix if any)
//   node engine/html/render.mjs <piece> final             → <piece>/renders/final.mp4
//   node engine/html/render.mjs <piece> events            → <piece>/events.json from the page's data-sfx cues
// Options: --page <file> (default scenes.html), plus any frames.mjs option (--fps, --crf, --out).
// It builds <piece>/renders/.page.html: your page plus the brand fonts, the brand, the captures it points at, the
// timeline (estimated from script.json until core/bin/wb timeline has run) and the runtime.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fontFaces } from '../../../app-tutorial/tools/fonts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.resolve(HERE, '..', '..');
const ROOT = path.resolve(BENCH, '..', '..');
const require = createRequire(import.meta.url);
const { estimate } = require('../../../app-tutorial/engine/kit/timeline.js');

const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
const [pieceArg, mode = 'still', times] = positional;
if (!pieceArg) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 9).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(1); }
const piece = path.resolve(pieceArg);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

// timeline: the real one, or an estimate the page can use until voices exist
const tlFile = path.join(piece, 'timeline.json');
const timeline = fs.existsSync(tlFile) ? null : estimate(piece);
if (timeline) console.warn(`timeline: ${path.basename(piece)}/timeline.json not found, timing estimated from script.json (run core/bin/wb voice + timeline)`);

// brand: bench brand.json, then the piece's own
const merge = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b || {})) o[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? merge(a[k], v) : v; return o; };
let brand = {}; let mark = null;
for (const f of [path.join(BENCH, 'brand', 'brand.json'), path.join(piece, 'brand.json')].filter((x) => fs.existsSync(x))) {
  const layer = readJson(f); brand = merge(brand, layer);
  const m = layer.logo && layer.logo.mark; if (m) for (const base of [path.dirname(f), path.dirname(path.dirname(f)), ROOT]) { const p = path.resolve(base, m); if (fs.existsSync(p)) { mark = pathToFileURL(p).href; break; } }
}

const pageFile = path.resolve(piece, opt('--page', 'scenes.html'));
let html = fs.readFileSync(pageFile, 'utf8');

// events: sound effects declared on the elements that cause them, data-sfx="tick -26" (name and gain in dB), timed by
// the element's data-in or by data-sfx-at; both must be voice anchors (@L02:four, @L06, @L03.end+0.2).
if (mode === 'events') {
  const tl = timeline || readJson(tlFile); const lines = Object.fromEntries(tl.lines.map((l) => [l.id, l]));
  const clean = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9$%]/g, '');
  const resolve = (spec) => {
    const m = String(spec).trim().match(/^@([A-Za-z0-9_-]+)(\.end)?(?::([^#+\-]+)(?:#(\d+))?)?([+-][\d.]+)?$/); if (!m || !lines[m[1]]) return null;
    let t = m[2] ? lines[m[1]].end : lines[m[1]].start;
    if (m[3]) { let n = Number(m[4] || 0); const w = lines[m[1]].words.find((x) => clean(x.text).startsWith(clean(m[3])) && n-- === 0); if (!w) return null; t = w.start; }
    return t + Number(m[5] || 0);
  };
  const events = [];
  for (const [tag] of html.matchAll(/<[^>]*\sdata-sfx="[^"]*"[^>]*>/g)) {
    const attr = (k) => (tag.match(new RegExp(`\\s${k}="([^"]*)"`)) || [])[1];
    const [name, gain] = attr('data-sfx').trim().split(/\s+/); const spec = attr('data-sfx-at') ?? attr('data-in'); const t = spec != null ? resolve(spec) : null;
    if (t == null) { console.warn(`events: "${name}" needs a voice anchor in data-sfx-at or data-in (got ${spec})`); continue; }
    events.push({ t: +t.toFixed(3), name, gain_db: gain != null ? Number(gain) : -24 });
  }
  events.sort((x, y) => x.t - y.t);
  fs.writeFileSync(path.join(piece, 'events.json'), JSON.stringify(events, null, 1) + '\n');
  console.log(`events: ${events.length} → ${path.relative(process.cwd(), path.join(piece, 'events.json'))}`);
  process.exit(0);
}

// captures the page points at (data-capture="flow/NN-name"), from <piece>/captures, <pack>/captures or WB_CAPTURES
const roots = [...(process.env.WB_CAPTURES ? process.env.WB_CAPTURES.split(path.delimiter) : []), path.join(piece, 'captures'), path.join(path.dirname(piece), 'captures')];
const captures = {};
for (const [, id] of html.matchAll(/data-capture="([^"]+)"/g)) {
  const root = roots.find((r) => fs.existsSync(path.join(r, id + '.png')));
  if (!root) {
    const rel = (p) => { const r = path.relative(process.cwd(), p); return r && !r.startsWith('..') ? r : p; };
    const flow = [path.join(piece, 'capture.json'), path.join(path.dirname(piece), 'capture.json')].find((f) => fs.existsSync(f)) || path.join(piece, 'capture.json');
    console.error(`capture "${id}" not found: run node ${rel(path.join(ROOT, 'benches', 'app-tutorial', 'tools', 'capture.mjs'))} --flow ${rel(flow)}`); process.exit(1);
  }
  captures[id] = { url: pathToFileURL(path.join(root, id + '.png')).href, meta: readJson(path.join(root, id + '.json')) };
}

const fonts = fontFaces([path.join(ROOT, 'assets', 'fonts'), path.join(BENCH, 'brand', 'fonts'), path.join(piece, 'fonts')]);
const script = fs.existsSync(path.join(piece, 'script.json')) ? readJson(path.join(piece, 'script.json')) : {};
const extra = { brand, mark, captures, timeline, money: script.money || {} };
const head = `<base href="${pathToFileURL(piece).href}/">\n<style>${fonts.css}</style>\n<script>window.WB_EXTRA = ${JSON.stringify(extra).replace(/</g, '\\u003c')};</script>`;
html = html.includes('<head>') ? html.replace('<head>', '<head>\n' + head) : head + html;
const runtime = fs.readFileSync(path.join(HERE, 'runtime.js'), 'utf8');
html = html.includes('</body>') ? html.replace('</body>', `<script>\n${runtime}\n</script>\n</body>`) : html + `<script>\n${runtime}\n</script>`;
const built = path.join(piece, 'renders', '.page.html'); fs.mkdirSync(path.dirname(built), { recursive: true }); fs.writeFileSync(built, html);

// hand over to the shared capture
const frames = path.join(ROOT, 'core', 'node', 'frames.mjs');
const pass = argv.filter((a, i) => a.startsWith('--') ? !['--page'].includes(a) : i > 0 && argv[i - 1].startsWith('--') && argv[i - 1] !== '--page');
const args = [frames, '--page', built, '--piece', piece, mode, ...(times ? [times] : []), ...(timeline ? ['--duration', String(timeline.duration)] : []), ...pass];
const r = spawnSync(process.execPath, args, { stdio: 'inherit' });
process.exit(r.status ?? 1);
