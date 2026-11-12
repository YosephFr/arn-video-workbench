// Headless Chromium (Playwright) and ffmpeg: open the stage, draw frame t, screenshot it, encode.
// Chromium always runs headless; nothing here opens a window.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { BENCH, REPO } from './piece.mjs'

// Playwright from this bench's node_modules, or from core/node's (npm install in either place works)
async function playwright() {
  for (const base of [BENCH, path.join(REPO, 'core', 'node')]) {
    try {
      const req = createRequire(path.join(base, 'package.json'))
      const mod = await import(pathToFileURL(req.resolve('playwright')).href)
      return mod.chromium ? mod : mod.default
    } catch { /* try the next place */ }
  }
  throw new Error('Playwright is missing: run `npm install` in benches/cartoon-ads (or core/node), then `npx playwright install --only-shell chromium`')
}

export async function launch() {
  const { chromium } = await playwright()
  return chromium.launch({ headless: true, args: ['--force-color-profile=srgb', '--disable-lcd-text', '--font-render-hinting=none', '--allow-file-access-from-files'] })
}

// open the stage at a scale (0.5 renders a half-size frame); returns { page, info: { duration, events } }
export async function openStage(browser, stage, { width, height, scale = 1 }) {
  const W = Math.round(width * scale), H = Math.round(height * scale)
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(pathToFileURL(stage).href, { waitUntil: 'load' })
  await page.waitForFunction(() => window.ready || window.bootError, null, { timeout: 120000 })
  const bootError = await page.evaluate(() => window.bootError)
  if (bootError || errors.length) throw new Error('the stage failed to start:\n' + [bootError, ...errors].filter(Boolean).join('\n'))
  if (scale !== 1) await page.evaluate((s) => { document.getElementById('frame').style.transform = 'scale(' + s + ')'; window.K.scale = s }, scale)
  const info = await page.evaluate(() => ({ duration: window.duration, events: window.events }))
  return { page, ctx, info, errors, W, H }
}

export async function shot(stage, t, { type = 'png', quality = 92 } = {}) {
  await stage.page.evaluate((x) => window.render(x), t)
  if (stage.errors.length) throw new Error(`error while drawing t=${t.toFixed(2)}: ${stage.errors.join(' | ')}`)
  return stage.page.screenshot({ type, ...(type === 'jpeg' ? { quality } : {}), clip: { x: 0, y: 0, width: stage.W, height: stage.H }, animations: 'disabled', caret: 'hide' })
}

// x264 in BT.709 limited range, the way phones and social players expect it
export function encoder(file, fps, { final = false, crf } = {}) {
  return spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p',
    '-c:v', 'libx264', '-threads', String(Math.max(1, parseInt(process.env.WB_RENDER_THREADS || '2', 10) || 2)), '-preset', final ? 'slow' : 'veryfast', '-crf', String(crf ?? (final ? 17 : 23)), '-profile:v', 'high', '-g', String(fps * 2),
    ...(final ? ['-maxrate', '9M', '-bufsize', '18M'] : []),
    '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709:fullrange=off',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', file], { stdio: ['pipe', 'inherit', 'inherit'] })
}
export const finished = (proc) => new Promise((resolve, reject) => proc.on('close', (c) => (c === 0 ? resolve() : reject(new Error('ffmpeg exited ' + c)))))

// Render frames [t0, t1) with several pages in parallel, each encoding its own chunk, then join them and mux the mix.
export async function renderVideo(browser, stageFile, P, { scale, fps, t0, t1, out, final, crf, workers, mix }) {
  const n = Math.round((t1 - t0) * fps)
  const pages = []
  pages.push(await openStage(browser, stageFile, { ...P.format, scale }))
  const count = Math.max(1, Math.min(workers, Math.ceil(n / 30)))
  for (let i = 1; i < count; i++) pages.push(await openStage(browser, stageFile, { ...P.format, scale }))
  const tmp = path.join(path.dirname(out), '_chunks')
  fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true })
  const per = Math.ceil(n / pages.length), started = Date.now()
  let made = 0
  await Promise.all(pages.map(async (stage, w) => {
    const a = w * per, b = Math.min(n, a + per)
    if (a >= b) return
    const ff = encoder(path.join(tmp, `c${w}.mp4`), fps, { final, crf })
    for (let i = a; i < b; i++) {
      const img = await shot(stage, t0 + i / fps, { type: final ? 'png' : 'jpeg', quality: 94 })
      if (!ff.stdin.write(img)) await new Promise((r) => ff.stdin.once('drain', r))
      if (++made % 30 === 0) process.stdout.write(`\r${made}/${n} frames · ${(made / ((Date.now() - started) / 1000)).toFixed(1)} fps`)
    }
    ff.stdin.end(); await finished(ff)
  }))
  process.stdout.write('\n')
  const list = pages.map((_, w) => w).filter((w) => w * per < n).map((w) => `file '${path.join(tmp, `c${w}.mp4`)}'`).join('\n')
  fs.writeFileSync(path.join(tmp, 'list.txt'), list)
  const args = ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(tmp, 'list.txt')]
  if (mix) args.push('-ss', String(t0), '-t', String(t1 - t0), '-i', mix, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000')
  args.push('-c:v', 'copy', '-movflags', '+faststart', out)
  await finished(spawn('ffmpeg', args, { stdio: 'inherit' }))
  fs.rmSync(tmp, { recursive: true, force: true })
  for (const s of pages) await s.ctx.close()
  return { frames: n, seconds: (Date.now() - started) / 1000, workers: pages.length }
}
