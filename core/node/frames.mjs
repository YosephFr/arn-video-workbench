#!/usr/bin/env node
// Deterministic frame capture for HTML scenes.
//
// The page must define `window.render(t)` (t in seconds) that draws the frame for that instant without relying on
// wall-clock time, timers or CSS transitions. Before the first frame the page receives
// `window.WB = { timeline, brand, script, piece, fps, width, height }`, and `window.wbReady` (a promise the page may
// set) is awaited.
//
//   node core/node/frames.mjs --page scene.html --piece <piece> still 0.5,3,8   # renders/still-<t>.jpg
//   node core/node/frames.mjs --page scene.html --piece <piece> preview      # half size, mixed audio
//   node core/node/frames.mjs --page scene.html --piece <piece> final        # full size, mixed audio
//
// Options: --fps N, --size WxH, --duration S (default: timeline.duration), --out FILE, --crf N, --scale F,
// --brand FILE (the brand when the piece has no brand.json of its own).
// Frames are piped to ffmpeg as JPEG; nothing is written per frame. Chromium always runs headless.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const argv = process.argv.slice(2)
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d)
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')))
const mode = positional[0] || 'still'
const piece = path.resolve(opt('--piece', '.'))
const readJson = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d)
const script = readJson(path.join(piece, 'script.json'), {})
const timeline = readJson(path.join(piece, 'timeline.json'), { duration: Number(opt('--duration', 5)), lines: [] })
const brandFile = [path.join(piece, 'brand.json'), opt('--brand', '')].find((f) => f && fs.existsSync(f))
const brand = brandFile ? readJson(brandFile, {}) : {}
const fmt = script.format || {}
const [W, H] = (opt('--size', `${fmt.width || 1080}x${fmt.height || 1920}`)).split('x').map(Number)
const fps = Number(opt('--fps', fmt.fps || 30))
const duration = Number(opt('--duration', timeline.duration))
const scale = Number(opt('--scale', mode === 'preview' ? 0.5 : 1))
const page = opt('--page')
if (!page) throw new Error('--page <scene.html> is required')
const pageUrl = /^https?:/.test(page) ? page : pathToFileURL(path.resolve(page)).href
const renders = path.join(piece, 'renders')
fs.mkdirSync(renders, { recursive: true })

const browser = await chromium.launch({ headless: true })
try {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: scale })
  const tab = await ctx.newPage()
  await tab.addInitScript((wb) => { window.WB = wb }, { timeline, brand, script, piece, fps, width: W, height: H })
  await tab.goto(pageUrl)
  await tab.evaluate(async () => { await document.fonts.ready; if (window.wbReady) await window.wbReady })
  const shot = async (t) => {
    await tab.evaluate((x) => window.render(x), t)
    return tab.screenshot({ type: 'jpeg', quality: 92 })
  }
  if (mode === 'still') {
    const times = (positional[1] || '0').split(',').map(Number)
    for (const t of times) {
      const file = path.join(renders, `still-${t.toFixed(2)}.jpg`)
      fs.writeFileSync(file, await shot(t))
      console.log(file)
    }
  } else {
    const out = opt('--out', path.join(renders, `${mode}.mp4`))
    const mix = path.join(piece, 'audio', 'mix.wav')
    const args = ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-']
    if (fs.existsSync(mix)) args.push('-i', mix)
    args.push('-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
      '-crf', opt('--crf', mode === 'final' ? '18' : '23'), '-preset', 'medium', '-r', String(fps))
    if (fs.existsSync(mix)) args.push('-c:a', 'aac', '-b:a', '256k', '-shortest')
    args.push('-movflags', '+faststart', out)
    const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] })
    const frames = Math.ceil(duration * fps)
    for (let i = 0; i < frames; i++) {
      const jpg = await shot(i / fps)
      if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r))
      if (i % (fps * 2) === 0) process.stdout.write(`\r${mode} ${((i / frames) * 100).toFixed(0)}%`)
    }
    ff.stdin.end()
    await new Promise((resolve, reject) => ff.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg exited ${c}`)))))
    console.log(`\n${out}`)
  }
} finally {
  await browser.close()
}
