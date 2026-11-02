#!/usr/bin/env node
// micro-ad-series render entry point. It runs on the particle-film engine (install it once with
// `npm --prefix ../particle-film install`, or `npm run setup` here); see that engine's renderer.mjs for every
// mode and option.
//   node benches/micro-ad-series/engine/render.mjs <episode> still 1,4,8
//   node benches/micro-ad-series/engine/render.mjs <episode> preview
//   node benches/micro-ad-series/engine/render.mjs <episode> final
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../../particle-film/engine/renderer.mjs';

const BENCH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// A series is many small files: 30 fps, x264 slow at CRF 23 with a 14 Mb/s ceiling (≈ 30 MB for 20 s).
main(process.argv.slice(2), { dir: BENCH, defaults: { stillScale: 0.5, previewFps: 30, previewCrf: 27, finalCrf: 23, finalPreset: 'slow', maxrate: '14M' } });
