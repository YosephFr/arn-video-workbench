#!/usr/bin/env node
// Render a progress-report piece frame by frame (Skia via @napi-rs/canvas; deterministic: frame N shows t = N / fps).
//
//   node engine/render.mjs <piece> check                    resolve every anchor, element and capture; list sections
//   node engine/render.mjs <piece> still 0.5,3,8 [--scale 0.5] [--out DIR]
//   node engine/render.mjs <piece> sheet 0:40:2 [--scale 0.2] [--cols 8]   (overview only: a sheet hides jumps)
//   node engine/render.mjs <piece> events                   write <piece>/events.json (sound effects on the picture)
//   node engine/render.mjs <piece> preview [--from S --to S] [--silent]    half size, 30 fps, with audio/mix.wav if present
//   node engine/render.mjs <piece> final [--workers N]      full size at script.format.fps, with audio/mix.wav
//   node engine/render.mjs <piece> poster [--at S] [--out FILE]            540 px wide PNG, <piece>/renders/poster.png
//
// Workers render disjoint frame ranges into H.264 chunks that are joined losslessly, then muxed with the mix.
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fork, spawn, spawnSync } from 'node:child_process'
import { createCanvas } from '@napi-rs/canvas'
import { Frame } from './lib/frame.mjs'
import { loadFilm } from './lib/film.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const BENCH = resolve(HERE, '..')
const ROOT = resolve(BENCH, '..', '..')

function parse(argv) {
  const a = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    if (k.startsWith('--')) { const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; a[k.slice(2)] = v } else a._.push(k)
  }
  return a
}

// BT.709 tags for the container: x264 writes them into the stream (x264-params), and every mux step repeats them so the
// MP4 carries them too (ffmpeg drops the encoder's colour options for RGBA input).
const BT709 = ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709']
const run = (cmd, args) => new Promise((res, rej) => { const p = spawn(cmd, args, { stdio: 'inherit' }); p.on('close', (c) => (c === 0 ? res() : rej(new Error(`${cmd} exited ${c}`)))) })

async function open(piece) {
  const dir = resolve(piece)
  if (!existsSync(join(dir, 'script.json'))) throw new Error(`${piece}: not a piece folder (no script.json)`)
  return { dir, film: await loadFilm(dir, { benchDir: BENCH, repoRoot: ROOT }) }
}

async function check(piece) {
  const { film } = await open(piece)
  console.log(`${film.W}×${film.H} @ ${film.fps} fps, ${film.duration.toFixed(2)} s, ${film.sections.length} sections, ${film.events.length} sound effects`)
  for (const s of film.sections) {
    const tr = s.trans ? `${s.trans.type} ${s.trans.dur.toFixed(2)} s` : '—'
    console.log(`  ${String(s.index).padStart(2)} ${s.type.padEnd(12)} ${s.start.toFixed(2).padStart(7)} → ${s.end.toFixed(2).padStart(7)}  in: ${tr}`)
  }
  const fr = new Frame({ width: film.W, height: film.H, scale: 0.25, fps: film.fps })
  for (const s of film.sections) film.render(fr, (s.start + s.end) / 2)   // draws every section once
  console.log('ok: every anchor, element and capture resolved')
}

async function stills(piece, a) {
  const { dir, film } = await open(piece)
  const scale = parseFloat(a.scale || '0.5')
  const fr = new Frame({ width: film.W, height: film.H, scale, fps: film.fps })
  const out = resolve(a.out || join(dir, 'renders', 'stills')); mkdirSync(out, { recursive: true })
  for (const t of String(a._[2]).split(',').map(Number)) {
    const t0 = Date.now(); film.render(fr, t)
    const file = join(out, `t${t.toFixed(2).padStart(6, '0')}.png`)
    writeFileSync(file, await fr.canvas.encode('png'))
    console.log(`still ${t.toFixed(2)} s → ${file} (${Date.now() - t0} ms)`)
  }
}

async function sheet(piece, a) {
  const { dir, film } = await open(piece)
  const scale = parseFloat(a.scale || '0.2')
  const fr = new Frame({ width: film.W, height: film.H, scale, fps: film.fps })
  const [t0, t1, step] = String(a._[2] || `0:${film.duration}:2`).split(':').map(Number)
  const times = []; for (let t = t0; t <= t1 + 1e-6; t += step) times.push(+t.toFixed(3))
  const cols = parseInt(a.cols || '8', 10), rows = Math.ceil(times.length / cols)
  const pad = 6, lab = 22
  const cv = createCanvas(cols * (fr.PW + pad) + pad, rows * (fr.PH + pad + lab) + pad); const c = cv.getContext('2d')
  c.fillStyle = '#222'; c.fillRect(0, 0, cv.width, cv.height); c.font = '16px sans-serif'
  times.forEach((t, k) => {
    film.render(fr, t)
    const x = pad + (k % cols) * (fr.PW + pad), y = pad + Math.floor(k / cols) * (fr.PH + pad + lab)
    c.drawImage(fr.canvas, x, y + lab); c.fillStyle = '#ddd'; c.fillText(`${t.toFixed(2)} s`, x + 4, y + 16)
  })
  const file = resolve(a.out || join(dir, 'renders', 'sheet.png')); mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, await cv.encode('png')); console.log(`sheet → ${file} (${times.length} frames)`)
}

async function events(piece) {
  const { dir, film } = await open(piece)
  writeFileSync(join(dir, 'events.json'), JSON.stringify(film.events, null, 1) + '\n')
  console.log(`${film.events.length} events → ${join(dir, 'events.json')}`)
}

async function poster(piece, a) {
  const { dir, film } = await open(piece)
  const ba = film.sections.find((s) => s.type === 'beforeAfter' && s.revealT)
  const t = a.at !== undefined ? parseFloat(a.at) : ba ? ba.revealT + 0.85 : film.duration * 0.4
  const fr = new Frame({ width: film.W, height: film.H, scale: 540 / film.W, fps: film.fps })
  film.render(fr, t)
  const out = resolve(a.out || join(dir, 'renders', 'poster.png')); mkdirSync(dirname(out), { recursive: true })
  const tmp = out + '.full.png'
  writeFileSync(tmp, await fr.canvas.encode('png'))
  // Palette PNG keeps the poster small (≤ 400 KB) without visible banding on flat UI.
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', tmp, '-vf', 'split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a', out])
  rmSync(tmp, { force: true })
  console.log(`poster t=${t.toFixed(2)} s → ${out} (${Math.round(statSync(out).size / 1024)} KB)`)
}

// Worker: render frames [f0, f1) into one H.264 chunk.
async function worker(a) {
  const { film } = await open(a.piece)
  const scale = parseFloat(a.scale), fps = parseFloat(a.fps), f0 = parseInt(a.f0, 10), f1 = parseInt(a.f1, 10)
  const fr = new Frame({ width: film.W, height: film.H, scale, fps })
  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${fr.PW}x${fr.PH}`, '-r', String(fps), '-i', '-',
    '-c:v', 'libx264', '-preset', a.preset || 'medium', '-crf', String(a.crf || 18), '-pix_fmt', 'yuv420p', '-profile:v', 'high',
    '-x264-params', 'keyint=120:min-keyint=1:colorprim=bt709:transfer=bt709:colormatrix=bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', a.chunk], { stdio: ['pipe', 'inherit', 'inherit'] })
  const write = (buf) => new Promise((res) => { if (!ff.stdin.write(buf)) ff.stdin.once('drain', res); else res() })
  for (let f = f0; f < f1; f++) {
    film.render(fr, f / fps)
    await write(fr.canvas.data())
    if (process.send && (f - f0) % 30 === 0) process.send({ progress: f - f0 })
  }
  ff.stdin.end()
  await new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg chunk failed')))))
}

async function video(piece, a, mode) {
  const { dir, film } = await open(piece)
  const final = mode === 'final'
  const fps = parseFloat(a.fps || (final ? film.fps : 30))
  const scale = parseFloat(a.scale || (final ? '1' : '0.5'))
  const from = parseFloat(a.from || '0'), to = Math.min(film.duration, parseFloat(a.to || String(film.duration)))
  const F0 = Math.round(from * fps), F1 = Math.round(to * fps), total = F1 - F0
  const workers = Math.max(1, Math.min(parseInt(a.workers || String(Math.max(1, cpus().length - 2)), 10), Math.ceil(total / 30)))
  const mix = join(dir, 'audio', 'mix.wav')
  const audio = !a.silent && existsSync(mix)
  if (final && !audio && !a.silent) throw new Error(`${mix} is missing: run the audio steps (see README) or pass --silent`)
  if (!audio) console.log(a.silent ? 'silent render (--silent)' : `no ${mix} yet: rendering without audio`)
  const out = resolve(a.out || join(dir, 'renders', `${mode}${a.from || a.to ? `-${from}-${to}` : ''}.mp4`))
  const tmp = join(dirname(out), `.chunks-${basename(out, '.mp4')}`)
  rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true })
  const per = Math.ceil(total / workers); const prog = new Array(workers).fill(0); const t0 = Date.now()
  const jobs = []
  for (let w = 0; w < workers; w++) {
    const f0 = F0 + w * per, f1 = Math.min(F1, f0 + per); if (f0 >= f1) break
    const chunk = join(tmp, `c${String(w).padStart(3, '0')}.mp4`)
    jobs.push(new Promise((res, rej) => {
      const cp = fork(fileURLToPath(import.meta.url), ['--worker', '--piece', dir, '--scale', String(scale), '--fps', String(fps), '--f0', String(f0), '--f1', String(f1), '--chunk', chunk, '--crf', String(a.crf || (final ? 18 : 23)), '--preset', a.preset || (final ? 'slow' : 'medium')])
      cp.on('message', (m) => { prog[w] = m.progress; process.stdout.write(`\r  ${prog.reduce((x, y) => x + y, 0)}/${total} frames (${((Date.now() - t0) / 1000).toFixed(0)} s)   `) })
      cp.on('exit', (c) => (c === 0 ? res(chunk) : rej(new Error(`worker ${w} exited ${c}`))))
    }))
  }
  const chunks = await Promise.all(jobs); process.stdout.write('\n')
  const list = join(tmp, 'list.txt'); writeFileSync(list, chunks.map((c) => `file '${c}'`).join('\n'))
  const silent = join(tmp, 'video.mp4')
  await run('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', silent])
  if (audio) {
    await run('ffmpeg', ['-v', 'error', '-y', '-i', silent, '-ss', String(from), '-t', String(to - from), '-i', mix, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', ...BT709, '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-shortest', '-movflags', '+faststart', out])
  } else await run('ffmpeg', ['-v', 'error', '-y', '-i', silent, '-c', 'copy', ...BT709, '-movflags', '+faststart', out])
  rmSync(tmp, { recursive: true, force: true })
  console.log(`${mode} → ${out}  (${total} frames, ${((Date.now() - t0) / 1000).toFixed(1)} s, ${workers} workers${audio ? ', with audio/mix.wav' : ', no audio'})`)
}

const a = parse(process.argv.slice(2))
try {
  if (a.worker) await worker(a)
  else {
    const [piece, mode] = a._
    if (!piece || !mode) { console.log('usage: node engine/render.mjs <piece> check|still|sheet|events|preview|final|poster [...] (see the header of this file)'); process.exit(1) }
    if (mode === 'check') await check(piece)
    else if (mode === 'still') await stills(piece, a)
    else if (mode === 'sheet') await sheet(piece, a)
    else if (mode === 'events') await events(piece)
    else if (mode === 'poster') await poster(piece, a)
    else if (mode === 'preview' || mode === 'final') await video(piece, a, mode)
    else throw new Error(`unknown mode ${mode}`)
  }
} catch (e) { console.error(e.message || e); if (process.env.WB_DEBUG) console.error(e.stack); process.exit(1) }
