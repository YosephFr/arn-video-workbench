#!/usr/bin/env node
// Two-character studio renderer (contract entry point). Headless Chromium + Three.js, deterministic: frame N = time N/fps.
//
//   node engine/render.mjs <piece> still 0.5,3,8 [--pass full|beauty|ui|mask|id] [--scale 1] [--cam NAME]
//   node engine/render.mjs <piece> preview [--t0 S --t1 S] [--fps 30] [--scale 0.5] [--silent]     half-res SDR H.264
//   node engine/render.mjs <piece> final [--sdr] [--t0 S --t1 S] [--keep]                           the one master MP4
//   node engine/render.mjs <piece> idpass [--fps 10] [--scale 0.25]                                 QA: host red, orb green
//   node engine/render.mjs <piece> poster [--t S] [--out FILE] [--size 540x960]                     cover still with the title card
// Common: --gl auto|gpu|swiftshader (default auto: GPU, else software WebGL), --jobs N (parallel pages), --out PATH,
// --camx px,py,pz,lookx,looky,lookz,fov (a free camera for stills and posters).
//
// final: 3D beauty frames + 2D layer frames + light-source mask frames (half res) -> tools/grade_hdr.py (HDR+ grade,
// HLG BT.2020, HEVC Main 10, AAC) -> Apple full-frame-rate tag (exiftool). With --sdr, or when ffmpeg has no HEVC
// encoder, the master is SDR instead (H.264 High, BT.709, same 60 fps and audio).
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { BENCH, loadConfig, runPy } from './lib/config.mjs';
import { serve } from './lib/server.mjs';
import { launch } from './lib/browser.mjs';

const argv = process.argv.slice(2);
const flag = k => argv.includes(k);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && !['--sdr', '--keep', '--silent'].includes(argv[i - 1])));
const [pieceArg, mode = 'still', arg3] = pos;
if (!pieceArg){ const head = fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1); console.log(head.slice(0, head.findIndex(l => !l.startsWith('//'))).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(1); }
const piece = path.resolve(pieceArg);
const renders = path.join(piece, 'renders');
fs.mkdirSync(renders, { recursive:true });
const log = (...a) => console.log(...a);
const sec = ms => (ms/1000).toFixed(1) + ' s';

function ffmpeg(args, input){
  return new Promise((ok, bad) => { const p = spawn('ffmpeg', ['-v', 'error', '-y', ...args], { stdio:[input ? 'pipe' : 'ignore', 'inherit', 'inherit'] });
    p.on('close', c => (c === 0 ? ok() : bad(new Error('ffmpeg exited ' + c)))); if (input) input(p.stdin); });
}
function hevcEncoder(){
  const out = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding:'utf8' }).stdout || '';
  if (/\blibx265\b/.test(out)) return 'libx265';
  if (/\bhevc_videotoolbox\b/.test(out)) return 'hevc_videotoolbox';
  return null;
}

// one page per worker; each renders a contiguous chunk of frame indices and writes one PNG/JPEG per layer
async function renderSeq({ browser, base, pass, scale, fps, n0, n1, layers, dirs, jobs = 1, ext = 'png', query = '' }){
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive:true });
  const N = n1 - n0, per = Math.ceil(N/jobs), t0 = Date.now(); let done = 0;
  const chunk = async (a, b) => {
    const cfg = JSON.parse(await (await fetch(`${base}/config.json?pass=${pass}&scale=${scale}${query}`)).text());
    const W = Math.round(cfg.width*scale), H = Math.round(cfg.height*scale);
    const page = await browser.newPage({ viewport:{ width:W, height:H }, deviceScaleFactor:1 });
    const errs = []; page.on('pageerror', e => errs.push(String(e))); page.on('console', m => { if (m.type() === 'error' && !/GL Driver Message|GPU stall/.test(m.text())) errs.push(m.text()); });
    await page.goto(`${base}/bench/engine/page/studio.html?pass=${pass}&scale=${scale}${query}`);
    await page.waitForFunction('window.__done === true', null, { timeout:300000 });
    const err = await page.evaluate('window.__error || null');
    if (err) throw new Error('page failed: ' + err + '\n' + errs.join('\n'));
    for (let n = a; n < b; n++){
      const files = layers.map(L => path.join(dirs[L], `f_${String(n).padStart(5, '0')}.${ext}`));
      if (files.every(f => fs.existsSync(f))){ done++; continue; }
      await page.evaluate(t => window.render(t), n/fps);
      for (let k = 0; k < layers.length; k++){
        const L = layers[k];
        if (layers.length > 1 || L !== 'full') await page.evaluate(l => window.setLayer(l), L === 'mask' || L === 'id' ? 'beauty' : L);
        const tmp = files[k] + '.tmp';
        const buf = await page.screenshot({ type:ext === 'jpg' ? 'jpeg' : 'png', quality:ext === 'jpg' ? 90 : undefined, omitBackground:L === 'ui', clip:{ x:0, y:0, width:W, height:H } });
        fs.writeFileSync(tmp, buf); fs.renameSync(tmp, files[k]);
      }
      done++;
      if (done % Math.max(1, Math.round(fps)) === 0) process.stdout.write(`\r  ${pass}: ${done}/${N} frames (${sec(Date.now() - t0)})   `);
    }
    if (errs.length) console.warn('\n  page warnings: ' + errs.slice(0, 3).join(' | '));
    await page.close();
  };
  const tasks = []; for (let j = 0; j < jobs; j++){ const a = n0 + j*per, b = Math.min(n1, a + per); if (a < b) tasks.push(chunk(a, b)); }
  await Promise.all(tasks);
  process.stdout.write(`\r  ${pass}: ${N}/${N} frames in ${sec(Date.now() - t0)}            \n`);
}

// temporary frames live in renders/frames/<output name>/, so two renders of the same piece never touch each other's files
const framesDir = out => path.join(renders, 'frames', path.basename(out).replace(/\.[^.]+$/, ''));
const dropFrames = dir => { fs.rmSync(dir, { recursive:true, force:true }); try { fs.rmdirSync(path.join(renders, 'frames')); } catch {} };

const scaleDefault = { still:1, preview:0.5, final:1, idpass:0.25, poster:1 }[mode] ?? 1;
const scale = Number(opt('--scale', scaleDefault));
const query = (opt('--cam') ? `&cam=${opt('--cam')}` : '') + (flag('--lookcam') ? '&lookcam=1' : '') + (opt('--camx') ? `&camx=${opt('--camx')}` : '');
const C = loadConfig(piece, { pass:'full', scale });
if (C.plan.provisional) console.warn('note: no timeline.json yet; timings are estimated from the text (run: core/bin/wb voice + wb timeline)');
const { server, base } = await serve(BENCH, C);
let browser;
try {
  const L = await launch(opt('--gl'));
  browser = L.browser;
  log(`WebGL: ${L.renderer}${L.software ? ' (software: slower, no GPU needed)' : ''}`);
  const dur = C.plan.duration, fpsScript = C.page.fps;
  const jobs = Number(opt('--jobs', L.software ? 2 : 3));

  if (mode === 'still'){
    const times = String(arg3 || '1').split(',').map(Number), pass = opt('--pass', 'full');
    const dir = opt('--out', path.join(renders, 'stills')); fs.mkdirSync(dir, { recursive:true });
    const W = Math.round(C.page.width*scale), H = Math.round(C.page.height*scale);
    const page = await browser.newPage({ viewport:{ width:W, height:H }, deviceScaleFactor:1 });
    page.on('pageerror', e => console.error('page error:', String(e)));
    page.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !/GL Driver Message|GPU stall/.test(m.text())) console.error('page:', m.text().slice(0, 400)); });
    await page.goto(`${base}/bench/engine/page/studio.html?pass=${pass}&scale=${scale}${query}`);
    await page.waitForFunction('window.__done === true', null, { timeout:300000 });
    const err = await page.evaluate('window.__error || null'); if (err) throw new Error(err);
    if (pass === 'ui') await page.evaluate(() => window.setLayer('ui'));       // the 2D layer alone, on a transparent background
    for (const t of times){
      const t0 = Date.now(); await page.evaluate(x => window.render(x), t);
      const file = path.join(dir, `still-${t.toFixed(2)}${pass === 'full' ? '' : '-' + pass}${opt('--cam') ? '-' + opt('--cam') : ''}.png`);
      await page.screenshot({ path:file, omitBackground:pass === 'ui', clip:{ x:0, y:0, width:W, height:H } });
      const heads = await page.evaluate('window.__studio ? window.__studio.heads() : null');
      log(`${file}  (${sec(Date.now() - t0)})${heads ? '  heads ' + JSON.stringify(heads) : ''}`);
    }
  }

  else if (mode === 'preview'){
    const fps = Number(opt('--fps', 30)), t0 = Number(opt('--t0', 0)), t1 = Math.min(dur, Number(opt('--t1', dur)));
    const out = opt('--out', path.join(renders, 'preview.mp4'));
    const n0 = Math.round(t0*fps), n1 = Math.round(t1*fps), dir = framesDir(out);      // one frames folder per output: renders never collide
    fs.rmSync(dir, { recursive:true, force:true });
    log(`preview ${t0}-${t1} s, ${n1 - n0} frames at ${fps} fps, scale ${scale}`);
    await renderSeq({ browser, base, pass:'full', scale, fps, n0, n1, layers:['full'], dirs:{ full:dir }, jobs, ext:'jpg', query });
    const mix = path.join(piece, 'audio', 'mix.wav');
    const audio = fs.existsSync(mix) && !flag('--silent');
    await ffmpeg(['-framerate', String(fps), '-start_number', String(n0), '-i', path.join(dir, 'f_%05d.jpg'),
      ...(audio ? ['-ss', String(t0), '-t', String(t1 - t0), '-i', mix] : []),
      '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv', '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
      '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', '-r', String(fps),
      ...(audio ? ['-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', '-shortest'] : []), '-movflags', '+faststart', out]);
    dropFrames(dir);
    log(`${out}${audio ? '' : flag('--silent') ? '  (silent)' : '  (silent: no audio/mix.wav yet)'}`);
  }

  else if (mode === 'final'){
    const fps = fpsScript;
    if (fps > 60) throw new Error('final renders at 60 fps at most: phones and QuickTime play files of 85 fps and more in slow motion');
    const t0 = Number(opt('--t0', 0)), t1 = Math.min(dur, Number(opt('--t1', dur))), n0 = Math.round(t0*fps), n1 = Math.round(t1*fps);
    const mix = path.join(piece, 'audio', 'mix.wav'), out = opt('--out', path.join(renders, 'final.mp4'));
    if (!fs.existsSync(mix) && !flag('--silent')) throw new Error('no audio/mix.wav: run the audio steps first (README), or pass --silent for a picture-only test');
    const enc = flag('--sdr') ? null : hevcEncoder();
    if (!flag('--sdr') && !enc) console.warn('ffmpeg has no HEVC encoder (libx265 or hevc_videotoolbox): delivering the SDR master instead');
    const fr = framesDir(out);
    log(`final ${t0}-${t1} s, ${n1 - n0} frames at ${fps} fps, ${enc ? 'HDR+ HLG via ' + enc : 'SDR H.264'}`);
    if (enc){
      await Promise.all([
        renderSeq({ browser, base, pass:'full', scale:1, fps, n0, n1, layers:['beauty', 'ui'], dirs:{ beauty:path.join(fr, 'beauty'), ui:path.join(fr, 'ui') }, jobs }),
        renderSeq({ browser, base, pass:'mask', scale:0.5, fps, n0, n1, layers:['mask'], dirs:{ mask:path.join(fr, 'mask') }, jobs:Math.max(1, Math.ceil(jobs/2)) }),
      ]);
      runPy('grade_hdr.py', ['--frames', fr, '--fps', String(fps), '--start', String(n0), '--count', String(n1 - n0), '--encoder', enc,
        ...(fs.existsSync(mix) && !flag('--silent') ? ['--audio', mix, '--audio-start', String(t0)] : []), '--out', out]);
      const tag = spawnSync('exiftool', ['-q', '-overwrite_original', '-Keys:FullFrameRatePlaybackIntent=1', out], { stdio:'inherit' });
      if (tag.error) console.warn('exiftool not found: the Apple full-frame-rate tag was not written (harmless at 60 fps; install exiftool for delivery)');
    } else {
      const dir = path.join(fr, 'sdr');
      await renderSeq({ browser, base, pass:'full', scale:1, fps, n0, n1, layers:['full'], dirs:{ full:dir }, jobs });
      const audio = fs.existsSync(mix) && !flag('--silent');
      await ffmpeg(['-framerate', String(fps), '-start_number', String(n0), '-i', path.join(dir, 'f_%05d.png'),
        ...(audio ? ['-ss', String(t0), '-t', String(t1 - t0), '-i', mix] : []),
        '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv', '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709', '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '17',
        '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', '-r', String(fps),
        ...(audio ? ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-shortest'] : []), '-movflags', '+faststart', out]);
    }
    if (!flag('--keep')) dropFrames(fr);
    log(out);
  }

  else if (mode === 'idpass'){
    const fps = Number(opt('--fps', 10)), dir = opt('--out', path.join(renders, 'qa', 'idpass'));
    fs.rmSync(dir, { recursive:true, force:true });
    await renderSeq({ browser, base, pass:'id', scale, fps, n0:0, n1:Math.floor(dur*fps), layers:['id'], dirs:{ id:dir }, jobs:Math.min(jobs, 2) });
    log(dir);
  }

  else if (mode === 'poster'){
    const pc = C.plan.poster || {}, t = Number(opt('--t', pc.t ?? Math.max(0, dur - 1.0)));
    const W = Math.round(C.page.width*scale), H = Math.round(C.page.height*scale);
    const page = await browser.newPage({ viewport:{ width:W, height:H }, deviceScaleFactor:1 });
    await page.goto(`${base}/bench/engine/page/studio.html?pass=poster&scale=${scale}&cam=${opt('--cam', pc.cam || 'cover')}&lookcam=1${opt('--camx') ? '&camx=' + opt('--camx') : ''}`);
    await page.waitForFunction('window.__done === true', null, { timeout:300000 });
    const err = await page.evaluate('window.__error || null'); if (err) throw new Error(err);
    await page.evaluate(x => window.render(x), t);
    const full = path.join(renders, 'poster-full.png');
    await page.screenshot({ path:full, clip:{ x:0, y:0, width:W, height:H } });
    const out = opt('--out', path.join(renders, 'poster.png')), size = opt('--size', '540x960').split('x');
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive:true });
    await ffmpeg(['-i', full, '-vf', `scale=${size[0]}:${size[1]}:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a`, '-frames:v', '1', out]);
    log(`${out} (${Math.round(fs.statSync(out).size/1024)} KB)`);
  }
  else throw new Error(`unknown mode ${mode}`);
} finally {
  if (browser) await browser.close();
  server.close();
}
