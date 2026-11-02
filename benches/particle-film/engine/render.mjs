#!/usr/bin/env node
// particle-film render entry point (see engine/renderer.mjs for every mode and option).
//   node benches/particle-film/engine/render.mjs <piece> still 0.5,3,8
//   node benches/particle-film/engine/render.mjs <piece> preview
//   node benches/particle-film/engine/render.mjs <piece> final
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from './renderer.mjs';

const BENCH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Masters at the script's fps (60 for this style): x264 slow, CRF 19 with a 16 Mb/s ceiling (about 2 MB per second,
// so a 25 s film stays under 60 MB). Previews: 30 fps, half size. Override with --crf / --maxrate.
main(process.argv.slice(2), { dir: BENCH, defaults: { stillScale: 0.5, previewFps: 30, previewCrf: 24, finalCrf: 19, finalPreset: 'slow', maxrate: '16M' } });
