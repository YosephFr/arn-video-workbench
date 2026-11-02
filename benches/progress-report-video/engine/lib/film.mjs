// A piece's film: script.json + timeline.json + brand + film.mjs → a deterministic render(frame, t).
//
// film.mjs exports a function that receives the anchors and returns the spec:
//
//   export default ({ L, W, at, T }) => ({
//     sections: [
//       { type: 'opening', title: 'Weekly update', subtitle: '…' },
//       { type: 'metric', from: 'L02', … },            // `from`: the anchor where the section's narration begins
//       …
//       { type: 'close', from: 'L09', … },
//     ],
//     transition: 'sweep',                              // default between content sections
//     captions: { maxWords: 7 },                        // or false
//     captures: '../other-piece/captures',              // optional: share another piece's captures
//     events: [ { at: 'L04:export', name: 'click' } ],  // extra sound effects
//   })
//
// A section starts `lead` seconds (0.3) before its anchor and lasts until the next one starts. The transition into
// it is centred on that start and lasts `transitionDur` (0.7 s): it opens while the previous narration ends and is
// settled when the new one begins. Types: opening, metric, beforeAfter, screen, feature, list, status, close, and
// custom ({ type: 'custom', draw(c, sec, t, film) {…} }).
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createCanvas } from '@napi-rs/canvas'
import { loadTimeline, makeAnchors } from './timeline.mjs'
import { loadBrand, registerFonts } from './brand.mjs'
import { loadLogo } from './logo.mjs'
import { makeCaptions } from './captions.mjs'
import { drawTransition, TRANSITIONS } from './transitions.mjs'
import opening from '../scenes/opening.mjs'
import metric from '../scenes/metric.mjs'
import { beforeAfter, screen } from '../scenes/screens.mjs'
import feature from '../scenes/feature.mjs'
import list from '../scenes/list.mjs'
import status from '../scenes/status.mjs'
import close from '../scenes/close.mjs'

export const SCENES = { opening, metric, beforeAfter, screen, feature, list, status, close }

export async function loadFilm(pieceDir, { benchDir, repoRoot }) {
  const script = JSON.parse(readFileSync(join(pieceDir, 'script.json'), 'utf8'))
  const W = script.format?.width ?? 1080, H = script.format?.height ?? 1920, fps = script.format?.fps ?? 60
  const tl = loadTimeline(pieceDir)
  const anchors = makeAnchors(tl)
  const brand = loadBrand({ pieceDir, benchDir })
  registerFonts(brand, { pieceDir, benchDir, repoRoot })
  const logo = await loadLogo(brand)
  const filmFile = ['film.mjs', 'film.js'].map((f) => join(pieceDir, f)).find(existsSync)
  if (!filmFile) throw new Error(`${pieceDir} has no film.mjs`)
  const build = (await import(pathToFileURL(filmFile).href)).default
  const spec = build({ ...anchors, T: { duration: tl.duration, lastEnd: tl.last_end }, brand, script })

  const film = {
    pieceDir, script, spec, tl, brand, logo, W, H, fps, duration: tl.duration, at: anchors.at, anchors,
    ctxForMeasure: createCanvas(16, 16).getContext('2d'),
    capturesDir: resolve(pieceDir, spec.captures || 'captures'),
  }

  // ---- sections and their times
  const secs = spec.sections.map((s, i) => {
    const scene = s.type === 'custom' ? { prepare: s.prepare, draw: s.draw, events: s.events } : SCENES[s.type]
    if (!scene) throw new Error(`section ${i}: unknown type "${s.type}" (use ${Object.keys(SCENES).join(', ')} or custom)`)
    return { ...s, index: i, scene }
  })
  secs.forEach((s, i) => {
    s.anchorT = i === 0 ? 0 : film.at(s.from)
    s.start = i === 0 ? 0 : Math.max(0.05, s.anchorT - (s.lead ?? 0.3))
  })
  secs.forEach((s, i) => { s.end = i < secs.length - 1 ? secs[i + 1].start : tl.duration })
  for (const s of secs) if (s.end <= s.start) throw new Error(`section ${s.index} (${s.type}) has no time: check the order of the "from" anchors`)
  for (const s of secs) if (s.scene.prepare) await s.scene.prepare(s, film)
  secs.forEach((s, i) => {
    if (i === 0) return
    const prev = secs[i - 1]
    const type = s.transition || (prev.type === 'opening' ? 'iris' : s.type === 'close' ? 'iris-close' : spec.transition || 'sweep')
    if (!TRANSITIONS.includes(type)) throw new Error(`section ${i}: unknown transition "${type}"`)
    const dur = Math.min(s.transitionDur ?? spec.transitionDur ?? 0.7, (s.end - s.start) * 0.8, (prev.end - prev.start) * 0.8)
    s.trans = { type, dur, w0: s.start - dur / 2, w1: s.start + dur / 2 }
  })
  film.sections = secs

  // ---- captions (off for sections that ask for it, e.g. opening and close)
  // A line belongs to the section where it starts; sections with captions: false (opening, close) hide theirs.
  const silentLines = tl.lines.filter((l) => sectionAt(l.start).captions === false).map((l) => l.id)
  const captions = makeCaptions(film, spec.captions === false ? false : { ...(spec.captions || {}), skip: [...(spec.captions?.skip || []), ...silentLines] })

  function sectionAt(t) { let k = 0; for (let i = 0; i < secs.length; i++) if (t >= secs[i].start) k = i; return secs[k] }

  // ---- sound effects on the picture
  const events = []
  for (const s of secs) {
    if (s.scene.events) for (const e of s.scene.events(s, film) || []) events.push({ ...e })
    if (s.trans && s.trans.type !== 'cut') events.push({ t: s.trans.w0 + 0.04, name: s.trans.type === 'fade' ? 'swoosh' : 'whoosh', gain_db: s.trans.type === 'iris' || s.trans.type === 'iris-close' ? -15 : -17 })
  }
  for (const e of spec.events || []) events.push({ ...e, t: e.t ?? film.at(e.at) })
  film.events = events.filter((e) => e.t >= 0 && e.t < tl.duration).map((e) => ({ ...e, t: Math.round(e.t * 1000) / 1000 })).sort((a, b) => a.t - b.t)

  // ---- rendering
  const draw = (s, t) => (c) => { c.save(); s.scene.draw(c, s, t, film); c.restore() }
  film.render = (frame, t) => {
    frame.begin(t)
    const c = frame.ctx
    let k = secs.indexOf(sectionAt(t))
    const next = secs[k + 1]
    let inTrans = null
    if (secs[k].trans && t < secs[k].trans.w1) inTrans = k
    else if (next && next.trans && t >= next.trans.w0) inTrans = k + 1
    if (inTrans !== null) {
      const B = secs[inTrans], A = secs[inTrans - 1]
      const p = (t - B.trans.w0) / B.trans.dur
      const tr = { ...B.trans }
      if (tr.type === 'iris' && A.scene.markRect) tr.rect = A.scene.markRect(A, t, film)
      if (tr.type === 'iris-close' && B.scene.markRect) tr.rect = B.scene.markRect(B, B.trans.w1, film)
      drawTransition(film, frame, tr, p, draw(A, t), draw(B, t))
    } else draw(secs[k], t)(c)
    frame.design(c)
    captions(c, t)
    frame.finish(spec.post || {})
  }
  return film
}
