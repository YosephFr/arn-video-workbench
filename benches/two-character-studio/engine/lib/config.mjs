// Everything the page needs, assembled on the Node side: script, brand, cast, plan (refreshed with tools/plan.py when
// it is missing or older than its inputs), fonts found on disk, and the evidence/insert images the plan references.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const BENCH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ROOT = path.resolve(BENCH, '..', '..');
const readJson = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const mtime = f => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0);

export function python(){
  const venv = path.join(ROOT, '.venv', 'bin', 'python');
  return process.env.WB_PYTHON || (fs.existsSync(venv) ? venv : 'python3');
}
export function runPy(script, args, opts = {}){
  const env = { ...process.env, PYTHONPATH: [path.join(ROOT, 'core', 'python'), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter) };
  const r = spawnSync(python(), [path.join(BENCH, 'tools', script), ...args], { stdio: opts.quiet ? 'pipe' : 'inherit', env, encoding:'utf8' });
  if (r.status !== 0) throw new Error(`${script} failed (exit ${r.status})${opts.quiet ? '\n' + (r.stderr || '') : ''}`);
  return r;
}

// plan.json is derived from script.json + timeline.json + direction.json (+ cast.json): rebuild it when stale
export function ensurePlan(piece, { force = false } = {}){
  const plan = path.join(piece, 'plan.json');
  const inputs = ['script.json', 'timeline.json', 'direction.json', 'cast.json'].map(f => path.join(piece, f));
  const tool = path.join(BENCH, 'tools', 'plan.py');
  if (force || !fs.existsSync(plan) || Math.max(...inputs.map(mtime), mtime(tool)) > mtime(plan)) runPy('plan.py', [piece]);
  return readJson(plan);
}

function findFonts(families){
  const dirs = [process.env.WB_FONTS_DIR, path.join(ROOT, 'assets', 'fonts'), path.join(BENCH, 'brand', 'fonts')].filter(Boolean);
  const faces = [];
  for (const fam of new Set(families.filter(Boolean))){
    const key = fam.replace(/\s+/g, '').toLowerCase();
    for (const d of dirs){
      if (!fs.existsSync(d)) continue;
      for (const f of fs.readdirSync(d)){
        if (!/\.(ttf|otf|woff2?)$/i.test(f)) continue;
        const base = f.replace(/\.(ttf|otf|woff2?)$/i, '');
        const [name, w] = base.split('-');
        if (name.replace(/\s+/g, '').toLowerCase() !== key) continue;
        const weight = /^\d+$/.test(w || '') ? Number(w) : /bold/i.test(w || '') ? 700 : 400;
        faces.push({ family:fam, weight, file:path.join(d, f) });
      }
    }
  }
  return faces;
}

export function loadConfig(piece, { pass = 'full', scale = 1, query = {} } = {}){
  const script = readJson(path.join(piece, 'script.json'));
  if (!script) throw new Error(`${piece}: no script.json`);
  const brand = readJson(path.join(piece, 'brand.json')) || readJson(path.join(BENCH, 'brand', 'brand.json'));
  // cast.json may point at brand colours: "brand.accent" -> brand.colors.accent
  const resolve = v => (typeof v === 'string' && /^brand\.\w+$/.test(v)) ? (brand.colors[v.slice(6)] || v)
    : Array.isArray(v) ? v.map(resolve) : (v && typeof v === 'object') ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x)])) : v;
  const cast = resolve(readJson(path.join(piece, 'cast.json'), {}));
  const plan = ensurePlan(piece);
  const fmt = script.format || {};
  const fams = [brand.fonts?.display, brand.fonts?.body];
  const faces = findFonts(fams);
  const missing = fams.filter(f => f && !faces.some(x => x.family === f));
  if (missing.length) console.warn(`fonts not found for ${missing.join(', ')} (run core/bin/fetch-fonts.sh "${missing[0]}:400,700,800"); using a system sans`);
  const stack = f => `"${f}", "Inter", "Helvetica Neue", Helvetica, Arial, sans-serif`;
  const files = {};                                   // url -> absolute file, served by the static server
  const fonts = faces.map((f, i) => { const url = `/asset/font${i}${path.extname(f.file)}`; files[url] = f.file; return { family:f.family, weight:f.weight, url }; });
  const images = {};
  const addImage = rel => { if (!rel || images[rel]) return; const abs = path.resolve(piece, rel);
    if (!fs.existsSync(abs)){ console.warn(`image not found: ${rel}`); return; }
    const url = `/asset/img${Object.keys(images).length}${path.extname(abs)}`; files[url] = abs; images[rel] = url; };
  for (const s of plan.shots || []) if (s.evidence?.image) addImage(s.evidence.image);
  for (const ins of plan.inserts || []) for (const q of ins.seq || []) if (q.image) addImage(q.image);
  return {
    files,
    page: { pass, scale, width:fmt.width || 1080, height:fmt.height || 1920, fps:fmt.fps || 60, brand, cast, plan, query,
            fonts, fontFamilies:{ display:stack(brand.fonts?.display || 'Inter'), body:stack(brand.fonts?.body || 'Inter') }, images },
    script, plan, brand,
  };
}
