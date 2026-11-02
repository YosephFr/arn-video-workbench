#!/usr/bin/env node
// app-tutorial render entry. See engine/kit/render.js for every mode.
//   node engine/render.mjs samples/feature-tour still 1,5,9
//   node engine/render.mjs samples/feature-tour preview
//   node engine/render.mjs samples/feature-tour final
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(import.meta.url);
const { run } = createRequire(import.meta.url)('./kit/render.js');
await run({ benchDir: path.resolve(path.dirname(entry), '..'), entry });
