#!/usr/bin/env node
// story-highlights render entry: one story of a pack. The film API is the app-tutorial kit plus `pack`
// (see engine/pack.js). Every mode of the kit works here:
//   node engine/render.mjs samples/getting-started/01-create-account still 1,4,8
//   node engine/render.mjs samples/getting-started/01-create-account check --social
//   node engine/render.mjs samples/getting-started/01-create-account final
//   WB_REEL=1 node engine/render.mjs <story> final --name final_reel    # without the pack header, for the reel
// tools/render-pack.sh renders every story of a pack, tools/reel.py joins them.
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(import.meta.url);
const bench = path.resolve(path.dirname(entry), '..');
// Skia comes from this bench's own install when app-tutorial has none (see app-tutorial/engine/kit/canvas.js).
process.env.WB_CANVAS_FROM = process.env.WB_CANVAS_FROM || path.join(bench, 'package.json');
const require = createRequire(import.meta.url);
const { run } = require('../../app-tutorial/engine/kit/render.js');
const { storyExt } = require('./pack.js');

await run({ benchDir: bench, entry, ext: (pieceDir) => storyExt(pieceDir) });
