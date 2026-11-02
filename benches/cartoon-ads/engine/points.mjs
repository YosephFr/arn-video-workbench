#!/usr/bin/env node
// Particle sets for the dots layer. render.mjs runs this before every render, so you rarely call it yourself.
//
//   node engine/points.mjs <piece> [--force]
//
// Every piece gets two brand sets: "logo" (the wordmark exactly as the end card draws it) and "mascot" (the
// silhouette, eyes cut out). A piece adds its own in points.json:
//   { "promise": { "text": "Your promise.", "n": 9000, "w": 1100, "h": 360 },              text in the display font
//     "hands":   { "plate": "plates/hands.png", "n": 22000, "gamma": 1.1, "edge": 0.8,      any image or SVG, tone only
//                  "floor": 0.03, "crop": [0, 0.1, 1, 0.8], "screen": [0.41, 0.37, 0.59, 0.6] },
//     "badge":   { "mascot": true, "n": 5000 }, "brand": { "logo": true, "n": 9000 } }
// "screen" marks a phone screen on the plate (0..1 of the whole image): it gets no dots, and the film reads where it
// landed from K.dots.place(name).screen to draw the interface on top. Output: <piece>/cache/points/ (git-ignored).
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { BENCH, bakeStage, loadPiece, readJson } from './lib/piece.mjs'
import { launch, openStage } from './lib/capture.mjs'
import { hilbertSorted, relax, shape, writePoints } from './lib/stipple.mjs'

const VERSION = 1
const sha = (x) => crypto.createHash('sha1').update(x).digest('hex')
const fileSha = (f) => sha(fs.readFileSync(f))
const DEFAULTS = { text: { n: 9000, iters: 26 }, logo: { n: 14000, w: 1200, iters: 26 }, mascot: { n: 7000, w: 700, iters: 26 }, plate: { n: 20000, w: 480, iters: 30 } }
const kindOf = (s) => (s.plate ? 'plate' : s.text != null ? 'text' : s.logo ? 'logo' : s.mascot ? 'mascot' : null)
// an SVG without width and height has no size as an image: give it the size of its viewBox
function plateUrl(file) {
  if (!/\.svg$/i.test(file)) return pathToFileURL(file).href
  let txt = fs.readFileSync(file, 'utf8')
  const head = (txt.match(/<svg\b[^>]*>/) || [''])[0], vb = head.match(/viewBox\s*=\s*["']([^"']+)["']/)
  if (vb && !/\swidth\s*=/.test(head)) { const v = vb[1].trim().split(/[\s,]+/).map(Number); txt = txt.replace(/<svg\b/, `<svg width="${v[2]}" height="${v[3]}"`) }
  return 'data:image/svg+xml;base64,' + Buffer.from(txt).toString('base64')
}
const header = (file) => { const b = fs.readFileSync(file); return { n: b.readUInt32LE(0), aspect: b.readFloatLE(4) } }

export async function ensurePoints(browser, P, { force = false, log = console.log } = {}) {
  const fontSha = sha(P.fonts.map((f) => fileSha(f.file)).join(','))
  const brandKey = sha(JSON.stringify({ v: VERSION, name: P.brand.name, logo: P.brand.logo, fonts: P.brand.fonts, fontSha,
    shapes: P.shapes.map(fileSha), svg: P.logoSvg ? sha(P.logoSvg) : null }))
  const brandDir = path.join(BENCH, 'cache', 'points', 'brand-' + brandKey.slice(0, 12))
  const pieceDir = path.join(P.piece, 'cache', 'points'), metaFile = path.join(pieceDir, 'meta.json')
  const oldMeta = readJson(metaFile, {}), meta = {}
  const jobs = [], sets = {}

  for (const name of ['logo', 'mascot']) {
    const file = path.join(brandDir, name + '.bin')
    sets[name] = { file }
    if (force || !fs.existsSync(file)) jobs.push({ name, spec: { [name]: true }, file })
  }
  const specs = readJson(path.join(P.piece, 'points.json'), {})
  for (const [name, spec] of Object.entries(specs)) {
    if (name.startsWith('_')) continue   // "_note" keys are comments
    const kind = kindOf(spec)
    if (!kind) throw new Error(`points.json "${name}": give one of plate, text, logo or mascot`)
    const src = kind === 'plate' ? path.resolve(P.piece, spec.plate) : null
    if (src && !fs.existsSync(src)) throw new Error(`points.json "${name}": plate ${spec.plate} not found next to the piece`)
    const key = sha(JSON.stringify({ v: VERSION, spec, src: src ? fileSha(src) : null, fonts: kind === 'text' ? fontSha : null, brand: kind === 'logo' || kind === 'mascot' ? brandKey : null }))
    const file = path.join(pieceDir, name + '.bin')
    sets[name] = { file, piece: true }
    meta[name] = oldMeta[name] && oldMeta[name].hash === key ? oldMeta[name] : null
    if (force || !fs.existsSync(file) || !meta[name]) jobs.push({ name, spec, file, key, src, piece: true })
  }

  if (jobs.length) {
    const stageFile = bakeStage(P, { file: path.join(P.piece, 'cache', 'points-stage.html'), noFilm: true })
    const stage = await openStage(browser, stageFile, { ...P.format, scale: 1 })
    for (const job of jobs) {
      const t0 = Date.now(), s = job.spec, kind = kindOf(s), d = DEFAULTS[kind]
      const req = kind === 'plate' ? { kind: 'image', src: plateUrl(job.src), w: s.w || d.w, h: s.h, crop: s.crop, fit: s.fit, mode: s.mode }
        : kind === 'text' ? { kind: 'text', text: s.text, w: s.w, h: s.h, size: s.size, weight: s.weight, font: s.font }
          : { kind, w: s.w || d.w }
      const r = await stage.page.evaluate((q) => window.K.raster(q), req)
      const bytes = Buffer.from(r.density, 'base64'), D = new Float32Array(new Uint8Array(bytes).buffer)
      let mask = null, screen = null
      if (kind === 'plate' && s.screen) {
        let [x0, y0, x1, y1] = s.screen
        if (s.crop) { const [cx, cy, cw, ch] = s.crop; x0 = (x0 - cx) / cw; x1 = (x1 - cx) / cw; y0 = (y0 - cy) / ch; y1 = (y1 - cy) / ch }
        screen = { x0, y0, x1, y1, rot: s.screenRot || 0 }
        mask = [[x0 - 0.004, y0 - 0.004, x1 + 0.004, y1 + 0.004]]
      }
      shape(D, r.w, r.h, { gamma: s.gamma ?? 1, edge: s.edge ?? 0, floor: s.floor ?? 0, mask })
      const n = s.n || d.n
      const p = hilbertSorted(relax(D, r.w, r.h, n, { iters: s.iters || d.iters, seed: s.seed || 5 }))
      fs.mkdirSync(path.dirname(job.file), { recursive: true })
      writePoints(job.file, p)
      if (job.piece) meta[job.name] = { n, aspect: p.aspect, screen, hash: job.key }   // "hash": the inputs it was made from
      log(`points ${job.name}: ${n} dots from ${kind} in ${((Date.now() - t0) / 1000).toFixed(1)} s`)
    }
    await stage.ctx.close()
  }
  if (Object.keys(meta).length) { fs.mkdirSync(pieceDir, { recursive: true }); fs.writeFileSync(metaFile, JSON.stringify(meta, null, 1)) }

  const points = {}, pointsMeta = {}
  for (const [name, set] of Object.entries(sets)) {
    points[name] = fs.readFileSync(set.file).toString('base64')
    pointsMeta[name] = set.piece ? { n: meta[name].n, aspect: meta[name].aspect, screen: meta[name].screen } : header(set.file)
  }
  return { points, pointsMeta }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2]
  if (!dir) { console.error('usage: node engine/points.mjs <piece> [--force]'); process.exit(2) }
  const P = loadPiece(dir), browser = await launch()
  try {
    const { pointsMeta } = await ensurePoints(browser, P, { force: process.argv.includes('--force') })
    for (const [name, m] of Object.entries(pointsMeta)) console.log(`${name.padEnd(12)} ${m.n} dots · aspect ${m.aspect.toFixed(3)}${m.screen ? ' · screen' : ''}`)
  } finally { await browser.close() }
}
