#!/usr/bin/env node
// calculation-explainer render entry (canvas path). The film API is the app-tutorial kit plus `ledger`:
// cards, split bars, rule chips and rings (engine/ledger.js). Every mode of the kit works here:
//   node engine/render.mjs samples/shift-payout still 2,6,10
//   node engine/render.mjs samples/shift-payout check --social
//   node engine/render.mjs samples/shift-payout preview | final | review | events | poster 21
// The light HTML path has its own entry: engine/html/render.mjs.
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(import.meta.url);
const bench = path.resolve(path.dirname(entry), '..');
// Skia comes from this bench's own install when app-tutorial has none (see app-tutorial/engine/kit/canvas.js).
process.env.WB_CANVAS_FROM = process.env.WB_CANVAS_FROM || path.join(bench, 'package.json');
const require = createRequire(import.meta.url);
const { run } = require('../../app-tutorial/engine/kit/render.js');
const { makeLedger } = require('./ledger.js');

// script.json may carry { "money": { "locale": "en-US", "currency": "USD", "decimals": 0 } }.
await run({
  benchDir: bench, entry,
  ext: { api: (base) => ({ ledger: makeLedger(base.brand, base.script.money || {}) }) },
});
