#!/usr/bin/env node
// Renders a cartoon-ads piece: headless Chromium draws the stage (kit + film.js) frame by frame, ffmpeg encodes.
//
//   node engine/render.mjs <piece> still 0.5,3,8      renders/stills/f_003.00.png, full size (--scale 0.5 for half)
//   node engine/render.mjs <piece> preview            renders/preview.mp4, half size, with audio/mix.wav if present
//   node engine/render.mjs <piece> final              renders/final.mp4, full size, 30 fps, with audio/mix.wav
//   node engine/render.mjs <piece> events             events.json: the film's K.sfx cues, for core/bin/wb sfx and mix
//   node engine/render.mjs <piece> overlaps           renders/overlaps.json: which named elements cover which, and when
//   node engine/render.mjs <piece> poster 12.5        renders/poster.png, 540 × 960 (--out file, --scale)
//   node engine/render.mjs <piece> stage              renders/stage.html only (drive it with core/node/frames.mjs)
//
// Options: --from s --to s (preview/final/overlaps), --fps N, --workers N, --crf N, --silent (no audio),
//          --out file, --step 0.2 and --min 120 (overlaps: seconds between checks, pixels that count as covering).
// Frame N always shows time N / fps. Without timeline.json the timing is estimated from script.json.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadPiece, bakeStage } from './lib/piece.mjs'
import { launch, openStage, shot, renderVideo } from './lib/capture.mjs'
import { decodePng } from './lib/png.mjs'
import { ensurePoints } from './points.mjs'

const argv = process.argv.slice(2)
const flag = (k) => argv.includes('--' + k)
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d }
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && !['silent', 'force'].includes(argv[i - 1].slice(2))))
const [pieceArg, mode = 'preview', arg] = positional
if (!pieceArg) { console.error('usage: node engine/render.mjs <piece> still|preview|final|events|overlaps|poster|stage [times]'); process.exit(2) }

const P = loadPiece(pieceArg)
if (P.estimated) console.warn('no timeline.json: timing estimated from script.json (run core/bin/wb voice and core/bin/wb timeline for real timings)')
if (P.missingFonts.length) console.warn(`fonts not found: ${P.missingFonts.join(', ')} (core/bin/fetch-fonts.sh "${P.missingFonts.join('" "')}"); falling back to system fonts`)
const renders = path.join(P.piece, 'renders')
fs.mkdirSync(renders, { recursive: true })
const fps = Number(opt('fps', P.format.fps))

const browser = await launch()
try {
  const { points, pointsMeta } = await ensurePoints(browser, P, { force: flag('force') })
  const stageFile = bakeStage(P, { points, pointsMeta, file: path.join(renders, 'stage.html') })

  if (mode === 'stage') {
    console.log(stageFile)
  } else if (mode === 'still' || mode === 'poster') {
    const scale = Number(opt('scale', mode === 'poster' ? 0.5 : 1))
    const stage = await openStage(browser, stageFile, { ...P.format, scale })
    const times = String(arg ?? (mode === 'poster' ? stage.info.duration * 0.6 : '0')).split(',').map(Number)
    const dir = path.join(renders, 'stills')
    fs.mkdirSync(dir, { recursive: true })
    for (const t of times) {
      const file = mode === 'poster' ? path.resolve(opt('out', path.join(renders, 'poster.png'))) : path.join(dir, `f_${t.toFixed(2).padStart(6, '0')}.png`)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, await shot(stage, t))
      console.log(file)
    }
  } else if (mode === 'events') {
    const stage = await openStage(browser, stageFile, { ...P.format, scale: 0.25 })
    const out = path.join(P.piece, 'events.json')
    fs.writeFileSync(out, JSON.stringify(stage.info.events, null, 1) + '\n')
    console.log(`${out}: ${stage.info.events.length} events · duration ${stage.info.duration.toFixed(2)} s`)
  } else if (mode === 'overlaps') {
    await overlaps(stageFile)
  } else if (mode === 'preview' || mode === 'final') {
    const final = mode === 'final', probe = await openStage(browser, stageFile, { ...P.format, scale: 0.25 })
    const dur = probe.info.duration
    await probe.ctx.close()
    const t0 = Number(opt('from', 0)), t1 = Math.min(dur, Number(opt('to', dur)))
    const mixFile = path.join(P.piece, 'audio', 'mix.wav')
    const mix = fs.existsSync(mixFile) && !flag('silent') ? mixFile : null
    const out = path.resolve(opt('out', path.join(renders, mode + '.mp4')))
    fs.mkdirSync(path.dirname(out), { recursive: true })
    const workers = Number(opt('workers', Math.min(6, Math.max(2, Math.floor(os.cpus().length / 2)))))
    const r = await renderVideo(browser, stageFile, P, { scale: final ? 1 : 0.5, fps, t0, t1, out, final, crf: opt('crf'), workers, mix })
    console.log(`${out} · ${r.frames} frames in ${r.seconds.toFixed(0)} s · ${r.workers} workers${mix ? ' · with audio/mix.wav' : ' · silent'}`)
  } else {
    throw new Error(`unknown mode ${mode}`)
  }
} finally {
  await browser.close()
}

// Overlap report. At every step, each pair of named elements whose boxes meet is photographed three times over the
// shared rectangle (neither, only one, only the other, always inside their own containers); pixels that both change
// are where one covers the other.
// Nested pairs (a phone in a hand) are composed on purpose and skipped, and so are the pairs the film declares in
// overlaps: [['a', 'b']]. Crossings inside one particle canvas or one SVG group are not seen: check those in stills.
async function overlaps(stageFile) {
  const stage = await openStage(browser, stageFile, { ...P.format, scale: 1 })
  const { page, info } = stage
  await page.addStyleTag({ content: '[data-ovhide]{display:none!important}' })
  const step = Number(opt('step', 0.2)), minPx = Number(opt('min', 120))
  const allowed = await page.evaluate(() => ((window.K.film && window.K.film.overlaps) || []).map((p) => p.slice().sort().join(' × ')))
  const pix = async (clip) => decodePng(await page.screenshot({ type: 'png', clip, animations: 'disabled', caret: 'hide' })).data
  const hits = []
  const t1 = Number(opt('to', info.duration))
  for (let t = Number(opt('from', 0)); t < t1; t += step) {
    const els = await page.evaluate((x) => { window.K.ovClear(); window.render(x); return window.K.ovList() }, t)
    for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
      const A = els[i], B = els[j]
      if (A.anc.includes(B.id) || B.anc.includes(A.id) || allowed.includes([A.name, B.name].sort().join(' × '))) continue
      const x0 = Math.max(A.r[0], B.r[0], 0), y0 = Math.max(A.r[1], B.r[1], 0)
      const x1 = Math.min(A.r[0] + A.r[2], B.r[0] + B.r[2], stage.W), y1 = Math.min(A.r[1] + A.r[3], B.r[1] + B.r[3], stage.H)
      if (x1 - x0 < 3 || y1 - y0 < 3) continue
      const clip = { x: Math.floor(x0), y: Math.floor(y0), width: Math.ceil(x1 - x0), height: Math.ceil(y1 - y0) }
      const solo = async (ids) => { await page.evaluate(([show, around]) => window.K.ovShow(show, around), [ids, [A.id, B.id]]); return pix(clip) }
      const base = await solo([]), a = await solo([A.id]), b = await solo([B.id])
      let n = 0
      for (let k = 0; k < base.length; k += 4) {
        const da = Math.abs(a[k] - base[k]) + Math.abs(a[k + 1] - base[k + 1]) + Math.abs(a[k + 2] - base[k + 2])
        const db = Math.abs(b[k] - base[k]) + Math.abs(b[k + 1] - base[k + 1]) + Math.abs(b[k + 2] - base[k + 2])
        if (da > 45 && db > 45) n++
      }
      if (n >= minPx) hits.push({ t: +t.toFixed(2), a: A.name, b: B.name, px: n, text: A.text || B.text })
    }
    await page.evaluate(() => window.K.ovClear())
  }
  // join consecutive steps of the same pair into spans
  const spans = []
  for (const h of hits) {
    const key = [h.a, h.b].sort().join(' × '), last = spans.findLast((s) => s.key === key)
    if (last && h.t - last.to <= step * 1.5 + 1e-6) { last.to = h.t; if (h.px > last.px) { last.px = h.px; last.worst = h.t } }
    else spans.push({ key, from: h.t, to: h.t, px: h.px, worst: h.t, text: h.text })
  }
  const out = path.join(renders, 'overlaps.json')
  fs.writeFileSync(out, JSON.stringify(spans, null, 1) + '\n')
  if (!spans.length) console.log('no overlaps')
  for (const s of spans.sort((p, q) => p.from - q.from)) console.log(`${s.text ? 'TEXT ' : '     '}${s.key.padEnd(36)} ${s.from.toFixed(2)}–${s.to.toFixed(2)} s · up to ${s.px} px (worst at ${s.worst} s)`)
  console.log(out)
}
