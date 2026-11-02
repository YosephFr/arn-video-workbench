'use strict';
// Font registration. Fonts are never bundled: `core/bin/fetch-fonts.sh <Family ...>` downloads OFL TTFs into
// `<repo>/assets/fonts/`, and you can drop your own into `<bench>/brand/fonts/` or `<piece>/fonts/`.
// Every .ttf/.otf found is registered under its internal family name. A family named in brand.json that is
// not installed falls back to the system sans-serif (the render still works; it just won't look on-brand).

const fs = require('fs');
const path = require('path');
const { GlobalFonts } = require('./canvas');

const done = new Set();
let warned = false;

function walk(dir, out, depth = 0) {
  if (depth > 3 || !fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out, depth + 1);
    else if (/\.(ttf|otf)$/i.test(e.name)) out.push(p);
  }
  return out;
}

// dirs: folders to scan (missing ones are skipped). Returns the families now available.
function registerFonts(dirs) {
  for (const dir of dirs) {
    for (const file of walk(dir, [])) {
      if (done.has(file)) continue;
      done.add(file);
      try { GlobalFonts.registerFromPath(file); } catch (e) { /* unreadable font: skip it */ }
    }
  }
  return new Set(GlobalFonts.families.map((f) => f.family));
}

// Warn once about brand families that are not installed.
function checkFamilies(families) {
  if (warned) return;
  warned = true;
  const have = new Set(GlobalFonts.families.map((f) => f.family.toLowerCase()));
  const missing = families.filter((f) => f && !have.has(String(f).toLowerCase()));
  if (missing.length) {
    console.warn(`fonts: ${missing.join(', ')} not installed; using the system sans-serif. ` +
      `Run core/bin/fetch-fonts.sh ${missing.map((m) => `"${m}"`).join(' ')} (or drop TTFs in brand/fonts/).`);
  }
}

// CSS font string with sensible fallbacks: font(700, 58, 'display') or font(400, 20, 'Inter').
function fontStack(family) {
  return `"${family}", "Helvetica Neue", Helvetica, Arial, sans-serif`;
}

module.exports = { registerFonts, checkFamilies, fontStack };
