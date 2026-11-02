// A piece on disk: script, timeline (or an estimate), brand, fonts, and the stage page that renders it.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { findFonts, fontDirs, fontFaceCss } from './fonts.mjs'

export const BENCH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const REPO = path.resolve(BENCH, '..', '..')
export const KIT = path.join(BENCH, 'engine', 'kit')
const KIT_SCRIPTS = ['kit.js', 'mascot-shape.js', 'mascot.js', 'logo.js', 'people.js', 'props.js', 'dots.js', 'picto.js', 'raster.js']

export const readJson = (file, fallback = null) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback)
const round = (x) => Math.round(x * 1000) / 1000

function merge(a, b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return b === undefined ? a : b
  const out = { ...(a || {}) }
  for (const k of Object.keys(b)) out[k] = merge(out[k], b[k])
  return out
}

// ---------- text markup (same rules as core: [direction] is never shown, *emphasis* may span words) ----------
export const spokenText = (text) => String(text).replace(/\[[^\]]*\]/g, ' ').replace(/\*/g, '').replace(/\s+/g, ' ').trim()
const stripMarkup = (text) => String(text).replace(/\[[^\]]*\]/g, ' ').replace(/\*/g, ' ').replace(/\s+/g, ' ').trim()
const normWord = (w) => w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
function tokensWithEmphasis(text) {
  const out = []
  let inside = false
  for (const tok of String(text).replace(/\[[^\]]*\]/g, ' ').split(/\s+/).filter(Boolean)) {
    const stars = (tok.match(/\*/g) || []).length, hot = inside || stars > 0
    if (stars % 2) inside = !inside
    const word = tok.replace(/\*/g, '')
    if (word) out.push([word, hot])
  }
  return out
}

// A timeline estimated from script.json, used until core/bin/wb timeline has written the real one.
// Same speaking rate as core's silent voice provider, so the layout barely moves when the real timings arrive.
export function estimateTimeline(script) {
  const starts = {}, ends = {}, lines = []
  for (const L of script.lines || []) {
    const tokens = tokensWithEmphasis(L.text), spoken = spokenText(L.text)
    const dur = 0.35 + spoken.length / 14.5, lead = 0.12, tail = 0.15
    const weights = tokens.map(([w]) => Math.max(1, normWord(w).length) + (/[,;:]$/.test(w) ? 2.5 : /[.!?…]$/.test(w) ? 4 : 0.6))
    const unit = Math.max(0.2, dur - lead - tail) / Math.max(1, weights.reduce((a, b) => a + b, 0))
    let t0
    if ('start' in L) t0 = Number(L.start)
    else if ('after' in L) t0 = ends[L.after] + (L.gap ?? 0.2)
    else if ('with' in L) t0 = starts[L.with] + (L.offset ?? 0)
    else t0 = lines.length ? Math.max(...Object.values(ends)) + 0.25 : 0.3
    t0 = Math.max(0, t0 || 0)
    let t = lead
    const words = tokens.map(([w, hot], i) => {
      const speak = (Math.max(1, normWord(w).length) + 0.6) * unit, word = { text: w, start: round(t0 + t), end: round(t0 + t + speak), emphasis: hot }
      t += weights[i] * unit
      return word
    })
    starts[L.id] = t0; ends[L.id] = t0 + dur
    lines.push({ id: L.id, voice: L.voice, text: stripMarkup(L.text), start: round(t0), end: round(t0 + dur), audio: null,
      effect: L.effect || null, caption: L.caption !== false, words })
  }
  const last = lines.length ? Math.max(...Object.values(ends)) : 0
  return { duration: round(last + (script.tail ?? 2.5)), last_end: round(last), fps: script.format?.fps || 30, lines, estimated: true }
}

export function loadPiece(dir) {
  const piece = path.resolve(dir)
  const script = readJson(path.join(piece, 'script.json'))
  if (!script) throw new Error(`${dir}: not a piece folder (no script.json)`)
  const film = path.join(piece, 'film.js')
  if (!fs.existsSync(film)) throw new Error(`${dir}: no film.js`)
  const brand = merge(readJson(path.join(BENCH, 'brand', 'brand.json'), {}), readJson(path.join(piece, 'brand.json'), {}))
  const fmt = script.format || {}
  const format = { width: fmt.width || 1080, height: fmt.height || 1920, fps: fmt.fps || 30 }
  let timeline = readJson(path.join(piece, 'timeline.json'))
  const estimated = !timeline
  if (!timeline) timeline = estimateTimeline(script)
  // an SVG wordmark of your own (brand.logo.wordmark, relative to the piece or to the bench)
  let logoSvg = null
  const wm = brand.logo && brand.logo.wordmark
  if (wm) {
    const file = [path.resolve(piece, wm), path.resolve(BENCH, wm)].find((f) => fs.existsSync(f))
    if (file) logoSvg = fs.readFileSync(file, 'utf8').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    else console.warn(`brand.logo.wordmark ${wm} not found: using the text wordmark`)
  }
  // the mascot's shape: the bench default, then brand/ and piece overrides
  const shapes = [path.join(KIT, 'mascot-shape.js'), path.join(BENCH, 'brand', 'mascot-shape.js'), path.join(piece, 'mascot-shape.js')].filter((f) => fs.existsSync(f))
  const fonts = findFonts([brand.fonts?.display, brand.fonts?.body, brand.fonts?.mono], fontDirs(REPO, BENCH, piece))
  const missing = [brand.fonts?.display, brand.fonts?.body, brand.fonts?.mono].filter((f) => f && !fonts.some((x) => x.family === f))
  return { piece, script, brand, format, timeline, estimated, film, logoSvg, shapes, fonts, missingFonts: missing }
}

const safeJson = (x) => JSON.stringify(x).replace(/</g, '\\u003c')   // a "</script>" inside the data cannot end the tag
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// The stage page: kit, fonts and the piece's data in one HTML file. It defines window.render(t) and window.wbReady,
// so core/node/frames.mjs can drive it too. noFilm builds a page with only the brand (for the particle builder).
export function bakeStage(P, { points = {}, pointsMeta = {}, file, noFilm = false } = {}) {
  const url = (f) => pathToFileURL(f).href
  const data = { format: P.format, timeline: P.timeline, script: { title: P.script.title || '', language: P.script.language || 'en' },
    brand: P.brand, points, pointsMeta, logoSvg: P.logoSvg, noFilm }
  const scripts = KIT_SCRIPTS.flatMap((s) => (s === 'mascot-shape.js' ? P.shapes : [path.join(KIT, s)]))
  if (!noFilm) scripts.push(P.film)
  const html = `<!doctype html>
<html lang="${esc(P.script.language || 'en')}">
<head>
<meta charset="utf-8">
<title>${esc(P.script.title || 'stage')}</title>
<style>
${fontFaceCss(P.fonts)}
</style>
<link rel="stylesheet" href="${url(path.join(KIT, 'kit.css'))}">
</head>
<body>
<div id="frame"></div>
<script>window.PIECE = ${safeJson(data)};</script>
${scripts.map((s) => `<script src="${url(s)}"></script>`).join('\n')}
<script>
window.wbReady = K.boot(window.PIECE).then(function (info) {
  window.duration = info.duration; window.events = info.events;
  window.render = function (t) { K.frame(t); };
  window.ready = true;
  return info;
}, function (e) { window.bootError = String((e && e.stack) || e); });
</script>
</body>
</html>
`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, html)
  return file
}
