'use strict';
// Render entry shared by the benches built on this kit. A bench's engine/render.mjs calls run() with its own
// extension (extra film API such as the ledger cards or the pack helpers).
//
//   render.mjs <piece> still 0.5,3,8 [--scale 0.5]    PNG frames in <piece>/renders/stills/
//   render.mjs <piece> sheet 0:20:1 [--cols 8]          contact sheet (overview only: review frames one by one)
//   render.mjs <piece> preview [--to 8] [--silent]      half-size MP4 with audio/mix.wav when it exists
//   render.mjs <piece> final                            full-size master with the mix
//   render.mjs <piece> poster 6.5                       540 × 960 PNG ≤ 400 KB in <piece>/renders/poster.png
//   render.mjs <piece> events                           writes <piece>/events.json from the film (taps, cuts, end card)
//   render.mjs <piece> info                             duration, shots and the moments worth a still
//   render.mjs <piece> check [--social]                 rings and taps on the visible screen, timing, safe zones
//   render.mjs <piece> review                           a still of every moment worth checking, in order
// Rendering is deterministic: frame N shows exactly time N / fps. Workers render disjoint frame ranges into H.264
// chunks that are concatenated without re-encoding, then muxed with the mix.
//
// Parallelism is opt-in: preview and final run on one worker with two encoder threads. Every worker decodes all the
// captures of the film (about 10 MB each at 3x) and runs its own encoder, so a capture-heavy film on many workers
// can exhaust the memory of a machine that also serves something else. On a machine of your own, raise them with
// --workers N and --threads N, or with WB_RENDER_WORKERS and WB_RENDER_THREADS.
const fs = require('fs');
const path = require('path');
const { spawn, fork, execFileSync } = require('child_process');
const { createCanvas } = require('./canvas');
const { Frame } = require('./frame');
const { defineTutorial } = require('./tutorial');
const { checkFilm } = require('./check');
const { options: captureOptions } = require('./captures');

const limit = (flag, env, fallback) => Math.max(1, parseInt(flag === true ? '' : flag || process.env[env] || fallback, 10) || parseInt(fallback, 10));

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith('--')) { const v = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true; a[k.slice(2)] = v; } else a._.push(k);
  }
  return a;
}

function loadFilm(pieceArg, ext) {
  const pieceDir = path.resolve(pieceArg); const file = path.join(pieceDir, 'film.js');
  if (!fs.existsSync(file)) throw new Error(`${pieceDir} has no film.js`);
  const mod = require(file);
  const resolvedExt = typeof ext === 'function' ? ext(pieceDir) : ext || {};
  if (typeof mod === 'function') return defineTutorial(pieceDir, mod, resolvedExt);
  if (mod && typeof mod.render === 'function') return mod;
  throw new Error('film.js must export a function ({ W, L, focus, ... }) => config');
}

// BT.709 tags for the container: x264 writes them into the stream (x264-params), and every mux step repeats them so the
// MP4 carries them too (ffmpeg drops the encoder's colour options for RGBA input).
const BT709 = ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709'];
const run1 = (cmd, argv) => new Promise((res, rej) => { const p = spawn(cmd, argv, { stdio: 'inherit' }); p.on('close', (c) => (c === 0 ? res() : rej(new Error(`${cmd} exited ${c}`)))); });

async function renderStills(film, piece, times, scale, outDir) {
  const f = new Frame({ scale, fps: film.fps }); await film.init({ scale });
  fs.mkdirSync(outDir, { recursive: true }); const files = [];
  for (const t of times) {
    const t0 = Date.now(); f.begin(t); film.render(f, t);
    const file = path.join(outDir, `f_${t.toFixed(2).padStart(6, '0')}.png`);
    fs.writeFileSync(file, f.canvas.toBuffer('image/png')); files.push(file);
    console.log(`still ${t.toFixed(2)} s → ${path.relative(process.cwd(), file)} (${Date.now() - t0} ms)`);
  }
  return files;
}

async function sheet(film, piece, spec, scale, cols) {
  const f = new Frame({ scale, fps: film.fps }); await film.init({ scale });
  const [a, b, step] = String(spec).split(':').map(Number); const times = []; for (let t = a; t <= b + 1e-6; t += step) times.push(+t.toFixed(3));
  const rows = Math.ceil(times.length / cols); const pad = 6, lab = 22;
  const out = createCanvas(cols * (f.PW + pad) + pad, rows * (f.PH + pad + lab) + pad); const o = out.getContext('2d');
  o.fillStyle = '#222'; o.fillRect(0, 0, out.width, out.height); o.font = '16px sans-serif';
  times.forEach((t, k) => {
    f.begin(t); film.render(f, t);
    const x = pad + (k % cols) * (f.PW + pad), y = pad + Math.floor(k / cols) * (f.PH + pad + lab);
    o.drawImage(f.canvas, x, y + lab); o.fillStyle = '#ddd'; o.fillText(`${t.toFixed(2)} s`, x + 4, y + 16);
  });
  const file = path.join(piece, 'renders', 'sheet.png'); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, out.toBuffer('image/png')); console.log('sheet →', path.relative(process.cwd(), file), times.length, 'frames');
}

// Worker: frames [f0, f1) → one H.264 chunk.
async function chunkWorker(film, a) {
  const scale = parseFloat(a.scale); const fps = film.fps; const f0 = parseInt(a.f0, 10), f1 = parseInt(a.f1, 10);
  const f = new Frame({ scale, fps }); await film.init({ scale });
  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${f.PW}x${f.PH}`, '-r', String(fps), '-i', '-',
    '-c:v', 'libx264', '-threads', String(limit(a.threads, 'WB_RENDER_THREADS', '2')), '-preset', a.preset, '-crf', String(a.crf), ...(a.maxrate && a.maxrate !== 'none' ? ['-maxrate', a.maxrate, '-bufsize', a.maxrate] : []),
    '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-x264-params', 'keyint=90:min-keyint=1:colorprim=bt709:transfer=bt709:colormatrix=bt709',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', a.chunk], { stdio: ['pipe', 'inherit', 'inherit'] });
  const write = (buf) => new Promise((res) => { if (!ff.stdin.write(buf)) ff.stdin.once('drain', res); else res(); });
  for (let i = f0; i < f1; i++) {
    f.begin(i / fps); film.render(f, i / fps); await write(f.canvas.data());
    if (process.send && (i - f0) % 15 === 0) process.send({ progress: i - f0 });
  }
  ff.stdin.end();
  await new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg chunk failed ' + c)))));
}

async function video(film, piece, a, entry, mode) {
  const fps = film.fps; const scale = parseFloat(a.scale);
  const from = parseFloat(a.from || '0'); const to = Math.min(parseFloat(a.to || String(film.duration)), film.duration);
  const F0 = Math.round(from * fps), F1 = Math.round(to * fps); const total = F1 - F0;
  const workers = Math.min(limit(a.workers, 'WB_RENDER_WORKERS', '1'), Math.ceil(total / 30)); const threads = limit(a.threads, 'WB_RENDER_THREADS', '2');
  const out = path.resolve(a.out || path.join(piece, 'renders', `${mode}.mp4`)); const tmp = path.join(path.dirname(out), `.chunks-${path.basename(out, '.mp4')}`);
  fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
  const per = Math.ceil(total / workers); const t0 = Date.now(); const prog = new Array(workers).fill(0); const jobs = [];
  for (let w = 0; w < workers; w++) {
    const s = F0 + w * per, e = Math.min(F1, s + per); if (s >= e) break;
    const chunk = path.join(tmp, `c${String(w).padStart(3, '0')}.mp4`);
    jobs.push(new Promise((res, rej) => {
      const cp = fork(entry, [piece, '--worker', '--scale', String(scale), '--f0', String(s), '--f1', String(e), '--chunk', chunk, '--crf', String(a.crf), '--preset', a.preset, '--maxrate', a.maxrate || 'none', '--threads', String(threads)], { env: process.env });
      cp.on('message', (m) => { if (m.progress !== undefined) { prog[w] = m.progress; process.stdout.write(`\r  ${mode}: ${prog.reduce((x, y) => x + y, 0)}/${total} frames (${((Date.now() - t0) / 1000).toFixed(0)} s)   `); } });
      cp.on('exit', (c) => (c === 0 ? res(chunk) : rej(new Error(`worker ${w} exited ${c}`))));
    }));
  }
  const chunks = await Promise.all(jobs); process.stdout.write('\n');
  const list = path.join(tmp, 'list.txt'); fs.writeFileSync(list, chunks.map((c) => `file '${c}'`).join('\n'));
  const silent = path.join(tmp, 'video.mp4');
  await run1('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', silent]);
  const mix = path.join(piece, 'audio', 'mix.wav'); const withAudio = !a.silent && fs.existsSync(mix);
  if (withAudio) {
    await run1('ffmpeg', ['-v', 'error', '-y', '-i', silent, '-ss', String(from), '-i', mix, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', ...BT709,
      '-af', 'apad', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-threads', String(threads), '-t', (total / fps).toFixed(3), '-movflags', '+faststart', out]);
  } else await run1('ffmpeg', ['-v', 'error', '-y', '-i', silent, '-c', 'copy', ...BT709, '-movflags', '+faststart', out]);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`${mode} → ${path.relative(process.cwd(), out)}  (${total} frames, ${((Date.now() - t0) / 1000).toFixed(1)} s, ${workers} worker${workers > 1 ? 's' : ''}, ${threads} encoder threads${withAudio ? ', with the mix' : ', silent'})`);
  if (!withAudio && mode !== 'preview' && !a.silent) console.warn('  no audio/mix.wav yet: run core/bin/wb mix <piece> and render again');
  return out;
}

async function poster(film, piece, t, outFile) {
  const files = await renderStills(film, piece, [t], 0.5, path.join(piece, 'renders', 'stills'));
  const out = outFile || path.join(piece, 'renders', 'poster.png'); fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.copyFileSync(files[0], out);
  if (fs.statSync(out).size > 400 * 1024) {   // a 256-colour palette keeps UI posters sharp and small
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', files[0], '-vf', 'split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a', out]);
  }
  console.log(`poster → ${path.relative(process.cwd(), out)} (${Math.round(fs.statSync(out).size / 1024)} KB)`);
}

// opts: { benchDir, entry (the render.mjs path), ext (film API extension or (pieceDir) => extension), modes (extra modes) }
async function run(opts) {
  try { await runMode(opts); } catch (e) {
    if (e && e.plain) { console.error(e.message); process.exit(1); }   // a known situation (a missing capture): no stack
    throw e;
  }
}

async function runMode(opts) {
  const a = parseArgs(process.argv.slice(2));
  process.env.WB_BENCH_DIR = process.env.WB_BENCH_DIR || opts.benchDir;
  const [pieceArg, mode = 'still', arg] = a._;
  if (!pieceArg) { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 14).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(1); }
  const piece = path.resolve(pieceArg);
  if (a.worker) { process.env.WB_QUIET = '1'; const film = loadFilm(piece, opts.ext); await chunkWorker(film, a); return; }
  if (opts.modes && opts.modes[mode]) return opts.modes[mode]({ piece, a, arg, loadFilm: () => loadFilm(piece, opts.ext), run1 });
  if (mode === 'check') captureOptions.lenient = true;   // list every missing capture instead of stopping at the first
  const film = loadFilm(piece, opts.ext);
  if (film.estimated) process.env.WB_QUIET = '1';
  switch (mode) {
    case 'still': {
      const times = String(arg ?? '0').split(',').map(Number);
      await renderStills(film, piece, times, parseFloat(a.scale || '0.5'), a.out ? path.resolve(a.out) : path.join(piece, 'renders', 'stills'));
      break;
    }
    case 'sheet': await sheet(film, piece, arg || `0:${film.duration.toFixed(1)}:1`, parseFloat(a.scale || '0.2'), parseInt(a.cols || '8', 10)); break;
    case 'preview': await video(film, piece, { scale: '0.5', crf: '27', preset: 'veryfast', ...a }, opts.entry, 'preview'); break;
    case 'final': await video(film, piece, { scale: '1', crf: '20', preset: 'slow', maxrate: '14M', ...a }, opts.entry, a.name || 'final'); break;
    case 'poster': await poster(film, piece, parseFloat(arg ?? String(film.duration / 3)), a.out && path.resolve(a.out)); break;
    case 'events': {
      const ev = film.events.map((e) => ({ ...e, t: +e.t.toFixed(3) })).sort((x, y) => x.t - y.t);
      fs.writeFileSync(path.join(piece, 'events.json'), JSON.stringify(ev, null, 1) + '\n');
      console.log(`events: ${ev.length} → ${path.relative(process.cwd(), path.join(piece, 'events.json'))}`);
      break;
    }
    case 'info': {
      console.log(`${path.basename(piece)}: ${film.duration.toFixed(2)} s at ${film.fps} fps${film.estimated ? ' (estimated timing)' : ''}, ${film.shots.length} shots, end card ${Number.isFinite(film.cardStart) ? 'from ' + film.cardStart.toFixed(2) + ' s' : 'off'}`);
      for (const [t, l] of film.moments()) console.log(`  ${t.toFixed(2).padStart(6)}  ${l}`);
      break;
    }
    case 'check': {
      const issues = await checkFilm(film, { social: !!a.social });
      console.log(`${path.basename(piece)}: ${issues.length ? issues.length + ' issues' : 'ok'} (${film.duration.toFixed(2)} s${a.social ? ', social zones' : ''})`);
      issues.forEach((x) => console.log('   ' + x)); if (issues.length) process.exitCode = 1;
      break;
    }
    case 'review': {   // one still per moment, named by time and what to look at
      const ms = film.moments(); const dir = path.join(piece, 'renders', 'review'); fs.rmSync(dir, { recursive: true, force: true });
      const files = await renderStills(film, piece, ms.map(([t]) => t), parseFloat(a.scale || '0.5'), dir);
      fs.writeFileSync(path.join(dir, 'moments.txt'), ms.map(([t, l], i) => `${path.basename(files[i])}  ${t.toFixed(2)} s  ${l}`).join('\n') + '\n');
      console.log(`review: ${files.length} stills in ${path.relative(process.cwd(), dir)} (moments.txt says what each one shows)`);
      break;
    }
    default: console.error(`unknown mode ${mode}`); process.exit(1);
  }
}

module.exports = { run, loadFilm, renderStills, parseArgs, run1 };
