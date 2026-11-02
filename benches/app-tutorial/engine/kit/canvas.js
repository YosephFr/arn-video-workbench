'use strict';
// The single import point for Skia (@napi-rs/canvas). Every module of this kit, and every bench built on it
// (calculation-explainer, story-highlights), goes through here, so only one copy of the native binding is loaded
// in a process: images and canvases from two copies cannot be drawn into each other.
//
// It resolves once, when the kit is first required: from this bench's node_modules, then from the package.json named
// by WB_CANVAS_FROM, then from the current directory. The entry points of calculation-explainer and story-highlights
// set WB_CANVAS_FROM to their own package.json before they require the kit, so each of them renders with its own
// `npm install` alone.
const path = require('path');
const { createRequire } = require('module');

function tryFrom(base) {
  try { return createRequire(base)('@napi-rs/canvas'); } catch (e) { return null; }
}

const mod = tryFrom(__filename)
  || (process.env.WB_CANVAS_FROM && tryFrom(process.env.WB_CANVAS_FROM))
  || tryFrom(path.join(process.cwd(), 'package.json'));
if (!mod) throw new Error('@napi-rs/canvas is not installed: run `npm install` inside the bench folder');

module.exports = mod;
