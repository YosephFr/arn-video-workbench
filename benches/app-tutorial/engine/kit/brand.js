'use strict';
// The brand: colours, fonts and logo from brand.json, plus the animated end-card lockup.
//
// Layers, later ones win: built-in defaults ← <bench>/brand/brand.json ← <pack>/brand.json ← <piece>/brand.json.
// Logo paths are resolved from the file that names them (its folder, then its parent, then the repo root).
// Fonts are never bundled: core/bin/fetch-fonts.sh downloads OFL TTFs into <repo>/assets/fonts/, and you can drop
// your own into <bench>/brand/fonts/, <pack>/fonts/ or <piece>/fonts/. Every .ttf/.otf found is registered under
// its internal family name; a family that is missing falls back to the system sans-serif.
const fs = require('fs');
const path = require('path');
const { GlobalFonts, loadImage } = require('./canvas');
const { clamp, ease, lerp } = require('./math');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const KIT_BENCH = path.resolve(__dirname, '..', '..');

const DEFAULTS = {
  name: 'Your Brand',
  tagline: 'One short line',
  url: 'yourbrand.example',
  colors: { background: '#F2F2EF', surface: '#FFFFFF', ink: '#16171A', muted: '#64666C', accent: '#3355E0', accent_ink: '#FFFFFF', positive: '#2F7D4F', negative: '#B4432F' },
  fonts: { display: 'Plus Jakarta Sans', body: 'Inter', mono: 'JetBrains Mono' },
  logo: { mark: null, wordmark: null },
  radius: 28,
};

// ------------------------------------------------------------------------------------------------ colours
const hex = (h) => { const s = String(h).replace('#', ''); const v = s.length === 3 ? s.split('').map((c) => c + c).join('') : s; return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)); };
const toHex = (rgb) => '#' + rgb.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
const mix = (a, b, k) => { const A = hex(a), B = hex(b); return toHex(A.map((v, i) => lerp(v, B[i], k))); };
const rgba = (h, a) => { const [r, g, b] = hex(h); return `rgba(${r},${g},${b},${a})`; };
function luminance(h) { const c = hex(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// Colours the kit needs beyond brand.json, derived so a rebrand only touches brand.json.
function derive(c) {
  let accentText = c.accent; let k = 0;
  while (contrast(accentText, c.background) < 4.5 && k < 10) { accentText = mix(accentText, c.ink, 0.12); k++; }   // emphasis that stays readable
  return {
    ...c,
    accentText,
    accentSoft: mix(c.accent, c.surface, 0.88),
    panel: mix(c.surface, c.background, 0.55),
    sunk: mix(c.background, c.ink, 0.04),
    positiveSoft: mix(c.positive, c.surface, 0.86),
    negativeSoft: mix(c.negative, c.surface, 0.88),
    shadow: rgba(mix(c.ink, c.background, 0.2), 0.16),
    phone: '#1c1b1e', rim: '#46454a', island: '#050505',
  };
}

// ------------------------------------------------------------------------------------------------ loading
function readJson(f) { return JSON.parse(fs.readFileSync(f, 'utf8')); }
function resolveAsset(rel, file) {
  if (!rel) return null;
  if (path.isAbsolute(rel)) return fs.existsSync(rel) ? rel : null;
  for (const base of [path.dirname(file), path.dirname(path.dirname(file)), ROOT]) { const p = path.join(base, rel); if (fs.existsSync(p)) return p; }
  return null;
}
function merge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? merge(a[k], v) : v;
  return out;
}

// Brand files that apply to a piece, in order.
function brandFiles(pieceDir) {
  const bench = process.env.WB_BENCH_DIR ? path.resolve(process.env.WB_BENCH_DIR) : KIT_BENCH;
  const files = [path.join(KIT_BENCH, 'brand', 'brand.json')];
  if (bench !== KIT_BENCH) files.push(path.join(bench, 'brand', 'brand.json'));
  const parent = path.dirname(pieceDir);
  if (fs.existsSync(path.join(parent, 'pack.json'))) files.push(path.join(parent, 'brand.json'));
  files.push(path.join(pieceDir, 'brand.json'));
  return [...new Set(files)].filter((f) => fs.existsSync(f));
}

function fontDirs(pieceDir) {
  const bench = process.env.WB_BENCH_DIR ? path.resolve(process.env.WB_BENCH_DIR) : KIT_BENCH;
  return [process.env.WB_FONTS_DIR, path.join(ROOT, 'assets', 'fonts'), path.join(KIT_BENCH, 'brand', 'fonts'), path.join(bench, 'brand', 'fonts'),
    path.join(path.dirname(pieceDir), 'fonts'), path.join(pieceDir, 'fonts')].filter(Boolean);
}

const registered = new Set();
function registerFonts(dirs) {
  const walk = (dir, depth = 0) => {
    if (depth > 3 || !fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (/\.(ttf|otf)$/i.test(e.name) && !registered.has(p)) { registered.add(p); try { GlobalFonts.registerFromPath(p); } catch (err) { /* unreadable: skip */ } }
    }
  };
  dirs.forEach((d) => walk(d));
}

let warned = false;
function loadBrand(pieceDir) {
  let brand = JSON.parse(JSON.stringify(DEFAULTS));
  for (const f of brandFiles(pieceDir)) {
    const layer = readJson(f);
    if (layer.logo) for (const k of Object.keys(layer.logo)) layer.logo[k] = resolveAsset(layer.logo[k], f);
    brand = merge(brand, layer);
  }
  registerFonts(fontDirs(pieceDir));
  const have = new Set(GlobalFonts.families.map((x) => x.family.toLowerCase()));
  const missing = Object.values(brand.fonts).filter((x) => x && !have.has(x.toLowerCase()));
  if (missing.length && !warned) {
    warned = true;
    console.warn(`fonts: ${missing.join(', ')} not installed, using the system sans-serif. Run core/bin/fetch-fonts.sh ${missing.map((m) => `"${m}:500,600,700"`).join(' ')}`);
  }
  brand.C = derive(brand.colors);
  // CSS font string with fallbacks: font(700, 54) uses the display family; font(500, 30, 'mono') the mono one.
  brand.font = (weight, size, role = 'display') => `${weight} ${size}px "${brand.fonts[role] || role}", "Helvetica Neue", Helvetica, Arial, sans-serif`;
  brand.images = {};
  return brand;
}

async function loadBrandImages(brand) {
  for (const k of ['mark', 'wordmark']) {
    const p = brand.logo && brand.logo[k];
    if (p && !brand.images[k]) brand.images[k] = await loadImage(fs.readFileSync(p));
  }
  return brand;
}

// ------------------------------------------------------------------------------------------------ end-card lockup
// The mark pops in at the centre, lands with a ripple, then slides left and shrinks into the horizontal lockup
// while the wordmark (the wordmark SVG, or the brand name set in the display font) wipes in beside it.
// `lock` is the moment the lockup is complete; everything is timed relative to it.
//   o: { cy, big (mark size while it lands), size (final mark size), dark, alpha }
function lockupGeometry(ctx, brand, o = {}) {
  const S = o.size || 150; const gap = S * 0.26; const im = brand.images.wordmark;
  let wordW, wordH;
  if (im) { wordH = S * 0.6; wordW = im.width * (wordH / im.height); }
  else { ctx.save(); ctx.font = brand.font(800, Math.round(S * 0.52)); wordW = ctx.measureText(brand.name).width; wordH = S * 0.52; ctx.restore(); }
  const total = S + gap + wordW; const left = 540 - total / 2;
  return { S, gap, wordW, wordH, left, markCx: left + S / 2, wordX: left + S + gap };
}

function drawMark(ctx, brand, cx, cy, size, alpha = 1) {
  const im = brand.images.mark; ctx.save(); ctx.globalAlpha *= alpha;
  if (im) { const k = size / Math.max(im.width, im.height); ctx.drawImage(im, cx - (im.width * k) / 2, cy - (im.height * k) / 2, im.width * k, im.height * k); }
  else { ctx.fillStyle = brand.C.accent; ctx.beginPath(); ctx.roundRect(cx - size / 2, cy - size / 2, size, size, size * 0.24); ctx.fill(); }
  ctx.restore();
}

function drawLockup(ctx, brand, t, lock, o = {}) {
  const u = t - lock; if (u < -1.2) return null;
  const C = brand.C; const cy = o.cy ?? 800; const big = o.big || 280; const G = lockupGeometry(ctx, brand, o);
  ctx.save(); ctx.globalAlpha *= o.alpha ?? 1;
  const pop = clamp((u + 1.0) / 0.42); if (pop <= 0) { ctx.restore(); return G; }
  const mv = ease.inOutCubic(clamp((u - 0.35) / 0.7));
  const size = lerp(big, G.S, mv) * ease.outBack(pop, 1.7); const cx = lerp(540, G.markCx, mv);
  // ripple when the mark lands
  const rp = clamp((u + 0.55) / 0.7);
  if (rp > 0 && rp < 1) { ctx.save(); ctx.globalAlpha *= (1 - rp) * 0.5; ctx.strokeStyle = C.accent; ctx.lineWidth = 6 * (1 - rp) + 1; ctx.beginPath(); ctx.arc(540, cy, big * (0.55 + 0.5 * ease.outCubic(rp)), 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
  // soft shadow on light grounds
  if (!o.dark) { ctx.save(); ctx.globalAlpha *= 0.22 * clamp(pop * 3); ctx.filter = `blur(${Math.max(2, size * 0.06)}px)`; ctx.fillStyle = C.ink; ctx.beginPath(); ctx.roundRect(cx - size * 0.44, cy - size * 0.38, size * 0.88, size * 0.88, size * 0.22); ctx.fill(); ctx.restore(); }
  const tilt = (1 - ease.outBack(clamp((u + 1.0) / 0.6), 2)) * -0.14;
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(tilt); ctx.translate(-cx, -cy); drawMark(ctx, brand, cx, cy, size, clamp(pop * 3)); ctx.restore();
  // wordmark wipes in from the mark's edge
  const wp = clamp((u - 0.75) / 0.55);
  if (wp > 0) {
    const e = ease.outCubic(wp); const front = lerp(G.wordX - 10, G.wordX + G.wordW + 30, ease.inOutCubic(wp));
    ctx.save(); ctx.beginPath(); ctx.rect(G.wordX - 12, 0, Math.max(0, front - G.wordX + 12), 1920); ctx.clip();
    const dx = -(1 - e) * 60; const im = brand.images.wordmark;
    if (im) ctx.drawImage(im, G.wordX + dx, cy - G.wordH / 2, G.wordW, G.wordH);
    else { ctx.font = brand.font(800, Math.round(G.S * 0.52)); ctx.fillStyle = o.dark ? '#ffffff' : C.ink; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(brand.name, G.wordX + dx, cy + 2); }
    ctx.restore();
  }
  ctx.restore();
  return G;
}

module.exports = { ROOT, KIT_BENCH, DEFAULTS, loadBrand, loadBrandImages, registerFonts, drawLockup, drawMark, mix, rgba, contrast, hex };
