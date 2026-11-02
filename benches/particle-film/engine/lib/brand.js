'use strict';
// The brand: colours, fonts, logo files and copy, read from brand.json. A piece can override the bench's
// brand/brand.json with its own brand.json. Nothing brand-specific lives in the engine code.

const fs = require('fs');
const path = require('path');
const { loadImage } = require('../core/canvas');
const { rgb01, luminance } = require('../core/math');
const { registerFonts, checkFamilies, fontStack } = require('../core/fonts');

const DEFAULTS = {
  name: 'Your Brand', tagline: 'One short line', url: 'yourbrand.example',
  colors: { background: '#F4F3F1', surface: '#FFFFFF', ink: '#161618', muted: '#6B6B70', accent: '#EC7623', accent_ink: '#FFFFFF', positive: '#2F7D4F', negative: '#B4432F' },
  fonts: { display: 'Poppins', body: 'Inter', mono: 'JetBrains Mono' },
  logo: { mark: null, wordmark: null },
  radius: 28,
};

let BRAND = null;

// dirs: { bench, piece, repo }
function loadBrand(dirs) {
  if (BRAND) return BRAND;
  const candidates = [dirs.piece && path.join(dirs.piece, 'brand.json'), path.join(dirs.bench, 'brand', 'brand.json')].filter(Boolean);
  const file = candidates.find((f) => fs.existsSync(f));
  const raw = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const b = { ...DEFAULTS, ...raw, colors: { ...DEFAULTS.colors, ...(raw.colors || {}) }, fonts: { ...DEFAULTS.fonts, ...(raw.fonts || {}) }, logo: { ...DEFAULTS.logo, ...(raw.logo || {}) } };
  // Logo paths: relative to the brand.json folder, the piece, the bench or the repo root (first that exists).
  const roots = [file && path.dirname(file), file && path.dirname(path.dirname(file)), dirs.piece, dirs.bench, dirs.repo].filter(Boolean);
  const resolve = (p) => { if (!p) return null; if (path.isAbsolute(p)) return fs.existsSync(p) ? p : null; for (const r of roots) { const q = path.join(r, p); if (fs.existsSync(q)) return q; } return null; };
  b.files = { mark: resolve(b.logo.mark), wordmark: resolve(b.logo.wordmark), source: file };
  // Fonts: repo assets/fonts (fetch-fonts.sh), the bench, the brand folder and the piece.
  registerFonts([dirs.repo && path.join(dirs.repo, 'assets', 'fonts'), path.join(dirs.bench, 'assets', 'fonts'), path.join(dirs.bench, 'brand', 'fonts'), file && path.join(path.dirname(file), 'fonts'), dirs.piece && path.join(dirs.piece, 'fonts')].filter(Boolean));
  if (!process.env.WB_WORKER) checkFamilies([b.fonts.display, b.fonts.body, b.fonts.mono]);
  // Derived values the scenes use a lot.
  b.rgb = Object.fromEntries(Object.entries(b.colors).map(([k, v]) => [k, rgb01(v)]));
  b.darkAccent = luminance(b.colors.accent) < 0.35;
  b.font = (weight, size, role = 'body') => `${weight} ${size}px ${fontStack(b.fonts[role] || role)}`;
  BRAND = b;
  return b;
}

const images = {};
async function loadLogos(b = BRAND) {
  for (const k of ['mark', 'wordmark']) {
    const f = b.files[k];
    if (f && !images[k]) images[k] = await loadImage(fs.readFileSync(f));
  }
  return images;
}
function logoImage(kind) { return images[kind] || null; }
function brand() { if (!BRAND) throw new Error('brand not loaded'); return BRAND; }

module.exports = { loadBrand, loadLogos, logoImage, brand, DEFAULTS };
