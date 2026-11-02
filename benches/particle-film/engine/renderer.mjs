// Shared renderer for Skia film modules (particle-film, and micro-ad-series which builds on this engine).
//
//   node <bench>/engine/render.mjs <piece> still 0.5,3,8        PNG frames → <piece>/renders/stills/
//   node <bench>/engine/render.mjs <piece> sheet 0:24:1          contact sheet → <piece>/renders/sheet.png
//   node <bench>/engine/render.mjs <piece> preview               half-res MP4 (+ audio/mix.wav if present)
//   node <bench>/engine/render.mjs <piece> final                 full-res master at the script's fps
//   node <bench>/engine/render.mjs <piece> poster [t] [--out f]  540 × 960 PNG of one frame
//   node <bench>/engine/render.mjs <piece> events                film sound events → <piece>/events.json
// Options: --scale s  --fps n  --workers n  --from s  --to s  --crf n  --audio file  --out file
// Switches: WB_ACTS=hook,cost renders only those acts (particle-film); WB_CAPTIONS=0 hides the captions.
//
// Rendering is deterministic: frame N shows exactly time N / fps, so frames can be rendered in any order by
// any number of worker processes. Workers encode disjoint frame ranges to H.264 chunks that are joined
// losslessly (stream copy) and muxed with the mix.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ENGINE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_BENCH = path.dirname(ENGINE_DIR);

function parse(argv) {
  const pos = []; const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const v = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true; opt[a.slice(2)] = v; }
    else pos.push(a);
  }
  return { pos, opt };
}

// BT.709 tags for the container: x264 writes them into the stream (x264-params), and every mux step repeats them so the
// MP4 carries them too (ffmpeg drops the encoder's colour options for RGBA input).
const BT709 = ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709'];

function run(cmd, args) {
  return new Promise((res, rej) => { const p = spawn(cmd, args, { stdio: 'inherit' }); p.on('close', (c) => (c === 0 ? res() : rej(new Error(`${cmd} exited ${c}`)))); });
}

function setupEnv(pieceDir, bench) {
  process.env.WB_PIECE = pieceDir;
  process.env.WB_BENCH = bench.dir;
  process.env.WB_ENGINE_BENCH = ENGINE_BENCH;
  // Films require their engine through this path, so a piece works wherever it lives (wb new copies it to work/).
  process.env.WB_ENGINE = path.join(bench.dir, 'engine');
  process.env.WB_REPO = process.env.WB_REPO || path.resolve(bench.dir, '..', '..');
}

function loadFilm(pieceDir) {
  const file = path.join(pieceDir, 'film.js');
  if (!fs.existsSync(file)) throw new Error(`${pieceDir}: no film.js`);
  return require(file);
}

function format(pieceDir) {
  const s = JSON.parse(fs.readFileSync(path.join(pieceDir, 'script.json'), 'utf8'));
  const f = s.format || {};
  return { width: f.width || 1080, height: f.height || 1920, fps: f.fps || 60 };
}

async function makeFrame(film, { scale, fps, width, height }) {
  const { Frame } = require('./core/frame.js');
  const frame = new Frame({ scale, fps, width, height });
  await film.init({ scale, fps, width, height });
  return frame;
}

function renderAt(film, frame, t) { frame.begin(t); film.render(frame, t); }

// ---------------------------------------------------------------- stills, sheet, poster
async function stills(pieceDir, film, fmt, list, opt, bench) {
  const scale = parseFloat(opt.scale || bench.defaults.stillScale || 0.5);
  const frame = await makeFrame(film, { ...fmt, scale });
  const out = opt.out || path.join(pieceDir, 'renders', 'stills'); fs.mkdirSync(out, { recursive: true });
  const times = String(list).split(',').map(Number).filter((x) => !Number.isNaN(x));
  for (const t of times) {
    const t0 = Date.now(); renderAt(film, frame, t);
    const file = path.join(out, `f_${t.toFixed(2).padStart(6, '0')}.png`);
    fs.writeFileSync(file, frame.canvas.toBuffer('image/png'));
    console.log(`still t=${t}s → ${path.relative(process.cwd(), file)} (${Date.now() - t0} ms)`);
  }
}

async function sheet(pieceDir, film, fmt, spec, opt) {
  const { createCanvas } = require('./core/canvas.js');
  const scale = parseFloat(opt.scale || 0.2);
  const frame = await makeFrame(film, { ...fmt, scale });
  const [a, b, step] = String(spec || `0:${film.duration}:1`).split(':').map(Number);
  const times = []; for (let t = a; t <= b + 1e-6; t += step) times.push(+t.toFixed(3));
  const cols = parseInt(opt.cols || '8', 10); const rows = Math.ceil(times.length / cols);
  const tw = frame.PW, th = frame.PH; const pad = 6, lab = 22;
  const outCv = createCanvas(cols * (tw + pad) + pad, rows * (th + pad + lab) + pad); const o = outCv.getContext('2d');
  o.fillStyle = '#222'; o.fillRect(0, 0, outCv.width, outCv.height); o.font = '16px sans-serif';
  times.forEach((t, k) => {
    renderAt(film, frame, t);
    const x = pad + (k % cols) * (tw + pad), y = pad + Math.floor(k / cols) * (th + pad + lab);
    o.drawImage(frame.canvas, x, y + lab); o.fillStyle = '#ddd'; o.fillText(`${t.toFixed(2)}s`, x + 4, y + 16);
  });
  const file = opt.out || path.join(pieceDir, 'renders', 'sheet.png'); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, outCv.toBuffer('image/png')); console.log(`sheet → ${path.relative(process.cwd(), file)} (${times.length} frames)`);
}

async function poster(pieceDir, film, fmt, tArg, opt) {
  const scale = parseFloat(opt.scale || 0.5);
  const frame = await makeFrame(film, { ...fmt, scale });
  const t = tArg !== undefined ? parseFloat(tArg) : (film.posterTime !== undefined ? film.posterTime : film.duration * 0.45);
  renderAt(film, frame, t);
  const file = path.resolve(opt.out || path.join(pieceDir, 'renders', 'poster.png'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file.replace(/\.png$/, '.full.png');
  fs.writeFileSync(tmp, frame.canvas.toBuffer('image/png'));
  // Palette PNG keeps the poster small (paper grain is expensive for PNG); falls back to the full PNG.
  try {
    await run('ffmpeg', ['-v', 'error', '-y', '-i', tmp, '-vf', 'split[a][b];[a]palettegen=max_colors=192:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a', file]);
    fs.rmSync(tmp);
  } catch (e) { fs.renameSync(tmp, file); }
  console.log(`poster t=${t.toFixed(2)}s → ${path.relative(process.cwd(), file)} (${Math.round(fs.statSync(file).size / 1024)} KB)`);
}

function events(pieceDir, film) {
  const ev = (film.events || []).map((e) => ({ ...e, ...(e.t !== undefined ? { t: +(+e.t).toFixed(3) } : {}) })).sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  if (!ev.length) { console.log('events: the film declares no events (hand-write events.json if you need them)'); return; }
  const file = path.join(pieceDir, 'events.json');
  fs.writeFileSync(file, JSON.stringify(ev, null, 1) + '\n');
  console.log(`events: ${ev.length} → ${path.relative(process.cwd(), file)}`);
}

// ---------------------------------------------------------------- video
async function chunkWorker(opt) {
  const pieceDir = opt.piece; const scale = parseFloat(opt.scale); const fps = parseFloat(opt.fps);
  const f0 = parseInt(opt.f0, 10), f1 = parseInt(opt.f1, 10);
  const fmt = format(pieceDir);
  const film = loadFilm(pieceDir);
  const frame = await makeFrame(film, { ...fmt, scale, fps });
  const x264 = ['-c:v', 'libx264', '-preset', opt.preset || 'medium', '-crf', String(opt.crf || 18), ...(opt.maxrate ? ['-maxrate', String(opt.maxrate), '-bufsize', String(opt.bufsize || `${parseFloat(opt.maxrate) * 2}M`)] : []),
    '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-x264-params', `keyint=${Math.round(fps * 2)}:min-keyint=1:colorprim=bt709:transfer=bt709:colormatrix=bt709`, '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709'];
  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${frame.PW}x${frame.PH}`, '-r', String(fps), '-i', '-', ...x264, opt.chunk], { stdio: ['pipe', 'inherit', 'inherit'] });
  const write = (buf) => new Promise((res) => { if (!ff.stdin.write(buf)) ff.stdin.once('drain', res); else res(); });
  for (let k = f0; k < f1; k++) {
    renderAt(film, frame, k / fps);
    await write(frame.canvas.data());
    if (process.send && (k - f0) % 15 === 0) process.send({ progress: k - f0 });
  }
  ff.stdin.end();
  await new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg chunk failed ' + c)))));
  if (process.send) process.send({ progress: f1 - f0, done: true });
}

async function video(pieceDir, film, fmt, mode, opt, bench) {
  const d = bench.defaults;
  const preview = mode === 'preview';
  const fps = parseFloat(opt.fps || (preview ? Math.min(d.previewFps || 30, fmt.fps) : fmt.fps));
  const scale = parseFloat(opt.scale || (preview ? 0.5 : 1));
  const from = parseFloat(opt.from || '0'); const to = parseFloat(opt.to || String(film.duration));
  const F0 = Math.round(from * fps), F1 = Math.round(to * fps); const total = F1 - F0;
  const workers = Math.max(1, Math.min(total, parseInt(opt.workers || String(d.workers || Math.max(1, Math.min(8, os.cpus().length - 2))), 10)));
  const out = path.resolve(opt.out || path.join(pieceDir, 'renders', `${mode}.mp4`));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tmp = path.join(path.dirname(out), `.chunks-${path.basename(out, '.mp4')}`);
  fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
  // Warm the caches (stipple relaxations) once before forking, so workers only read them.
  await film.init({ ...fmt, scale, fps, warm: true });
  const crf = opt.crf || (preview ? d.previewCrf || 24 : d.finalCrf || 18);
  const preset = opt.preset || (preview ? 'veryfast' : d.finalPreset || 'medium');
  const maxrate = opt.maxrate || (preview ? null : d.maxrate || null);
  const per = Math.ceil(total / workers); const prog = new Array(workers).fill(0); const t0 = Date.now(); const jobs = [];
  for (let w = 0; w < workers; w++) {
    const a = F0 + w * per, b = Math.min(F1, a + per); if (a >= b) break;
    const chunk = path.join(tmp, `c${String(w).padStart(3, '0')}.mp4`);
    jobs.push(new Promise((res, rej) => {
      const args = ['--worker', '--piece', pieceDir, '--scale', String(scale), '--fps', String(fps), '--f0', String(a), '--f1', String(b), '--chunk', chunk, '--crf', String(crf), '--preset', preset, ...(maxrate ? ['--maxrate', String(maxrate)] : [])];
      const cp = fork(process.argv[1], args, { env: { ...process.env, WB_WORKER: '1', WB_QUIET_TIMELINE: '1' } });
      cp.on('message', (m) => {
        if (m.progress === undefined) return; prog[w] = m.progress; const done = prog.reduce((x, y) => x + y, 0);
        process.stdout.write(`\r  ${mode}: ${done}/${total} frames (${((Date.now() - t0) / 1000).toFixed(0)} s, ${workers} workers)   `);
      });
      cp.on('exit', (c) => (c === 0 ? res(chunk) : rej(new Error(`worker ${w} exited ${c}`))));
    }));
  }
  const chunks = await Promise.all(jobs);
  process.stdout.write('\n');
  const list = path.join(tmp, 'list.txt'); fs.writeFileSync(list, chunks.map((c) => `file '${c.replace(/'/g, "'\\''")}'`).join('\n'));
  const silent = path.join(tmp, 'video.mp4');
  await run('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', silent]);
  const audio = opt.audio ? path.resolve(opt.audio) : path.join(pieceDir, 'audio', 'mix.wav');
  const dur = (F1 - F0) / fps;
  if (fs.existsSync(audio) && !opt.silent) {
    const ss = from > 0 ? ['-ss', String(from)] : [];
    await run('ffmpeg', ['-v', 'error', '-y', '-i', silent, ...ss, '-i', audio, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', ...BT709, '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-t', dur.toFixed(3), '-movflags', '+faststart', out]);
  } else {
    if (mode === 'final' && !opt.silent) console.warn(`final: no ${path.relative(process.cwd(), audio)} yet; the master is silent (run core/bin/wb mix first).`);
    await run('ffmpeg', ['-v', 'error', '-y', '-i', silent, '-c', 'copy', ...BT709, '-movflags', '+faststart', out]);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`${mode} → ${path.relative(process.cwd(), out)} (${total} frames, ${fps} fps, ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}

// ---------------------------------------------------------------- entry
export async function main(argv, bench) {
  const { pos, opt } = parse(argv);
  bench.defaults = bench.defaults || {};
  try {
    if (opt.worker) { setupEnv(path.resolve(opt.piece), bench); await chunkWorker(opt); return; }
    const [pieceArg, mode = 'still', arg] = pos;
    if (!pieceArg) { console.log('usage: node engine/render.mjs <piece> still|sheet|preview|final|poster|events [args] (see engine/renderer.mjs)'); process.exit(1); }
    const pieceDir = path.resolve(pieceArg);
    if (!fs.existsSync(path.join(pieceDir, 'script.json'))) throw new Error(`${pieceArg}: not a piece folder (no script.json)`);
    setupEnv(pieceDir, bench);
    const fmt = format(pieceDir);
    const film = loadFilm(pieceDir);
    if (mode === 'still') await stills(pieceDir, film, fmt, arg || '1,4,8', opt, bench);
    else if (mode === 'sheet') await sheet(pieceDir, film, fmt, arg, opt);
    else if (mode === 'poster') await poster(pieceDir, film, fmt, arg, opt);
    else if (mode === 'events') events(pieceDir, film);
    else if (mode === 'preview' || mode === 'final') await video(pieceDir, film, fmt, mode, opt, bench);
    else throw new Error(`unknown mode ${mode}`);
  } catch (e) { console.error(e && e.stack ? e.stack : e); process.exit(1); }
}
