#!/usr/bin/env node
// Entry point of the pdf-report bench (same shape as the video benches).
//
//   node engine/render.mjs <piece> pdf [--strict]        build the PDF, layout check, text read-back, page PNGs
//   node engine/render.mjs <piece> logo                  render the brand's SVG logo to PNG with headless Chromium
//   node engine/render.mjs <piece> poster [--out FILE]   page 1 as a PNG 540 px wide (<piece>/renders/poster.png by default)
//
// The builder is Python (ReportLab). It runs with <bench>/.venv, else <repo>/.venv, else python3 — whichever has
// the packages of requirements.txt.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const BENCH = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = resolve(BENCH, '..', '..')
const [pieceArg, mode, ...rest] = process.argv.slice(2)
if (!pieceArg || !mode) { console.log('usage: node engine/render.mjs <piece> pdf|logo|poster [--strict] [--out FILE]'); process.exit(1) }
const piece = resolve(pieceArg)

function python() {
  for (const p of [join(BENCH, '.venv', 'bin', 'python'), join(ROOT, '.venv', 'bin', 'python'), 'python3']) {
    if (p !== 'python3' && !existsSync(p)) continue
    if (spawnSync(p, ['-c', 'import reportlab, pypdfium2, PIL'], { stdio: 'ignore' }).status === 0) return p
  }
  console.error(`ReportLab is not installed. Run:\n  python3 -m venv ${join(BENCH, '.venv')} && ${join(BENCH, '.venv', 'bin', 'pip')} install -r ${join(BENCH, 'requirements.txt')}`)
  process.exit(1)
}
const run = (cmd, args) => { const r = spawnSync(cmd, args, { stdio: 'inherit' }); if (r.status !== 0) process.exit(r.status ?? 1) }

if (mode === 'pdf') run(python(), [join(BENCH, 'engine', 'report.py'), piece, ...rest])
else if (mode === 'logo') {
  const own = join(piece, 'brand.json')
  const brandFile = existsSync(own) ? own : join(BENCH, 'brand', 'brand.json')
  const brand = JSON.parse(readFileSync(brandFile, 'utf8'))
  const svg = brand.logo?.wordmark || brand.logo?.mark
  if (!svg) { console.log('brand.json has no logo SVG: the report draws its placeholder lockup'); process.exit(0) }
  const src = [BENCH, piece, dirname(brandFile)].map((b) => resolve(b, svg)).find(existsSync)
  const out = [BENCH, piece, dirname(brandFile)].map((b) => resolve(b, brand.pdf?.logo_png || 'brand/logo.png'))[0]
  if (!src) { console.error(`logo ${svg} not found`); process.exit(1) }
  run(process.execPath, [join(BENCH, 'tools', 'render_logo.mjs'), src, out])
} else if (mode === 'poster') {
  const i = rest.indexOf('--out')
  const out = resolve(i >= 0 ? rest[i + 1] : join(piece, 'renders', 'poster.png'))
  const report = JSON.parse(readFileSync(join(piece, 'report.json'), 'utf8'))
  const pdf = join(piece, 'renders', report.meta?.filename || 'report.pdf')
  if (!existsSync(pdf)) { console.error(`${pdf} is missing: run the pdf mode first`); process.exit(1) }
  run(python(), ['-c', `import sys; sys.path.insert(0, ${JSON.stringify(join(BENCH, 'engine'))}); import qa; f, n = qa.poster(${JSON.stringify(pdf)}, ${JSON.stringify(out)}); print(f'poster → {f} ({n // 1024} KB)')`])
} else { console.error(`unknown mode ${mode}`); process.exit(1) }
