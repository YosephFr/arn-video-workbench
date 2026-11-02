// The brand: colours, fonts, logo and radius from brand.json (the piece's own brand.json wins over the bench's).
// Fonts are Google Fonts TTFs named <Family>-<weight>.ttf (core/bin/fetch-fonts.sh), looked up in, in order:
// $WB_FONTS_DIR, <piece>/assets/fonts, <bench>/assets/fonts and <repo>/assets/fonts.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { GlobalFonts } from '@napi-rs/canvas'

const FALLBACK = '"Helvetica Neue", Helvetica, Arial, sans-serif'

export function loadBrand({ pieceDir, benchDir }) {
  const own = join(pieceDir, 'brand.json')
  const file = existsSync(own) ? own : join(benchDir, 'brand', 'brand.json')
  const brand = JSON.parse(readFileSync(file, 'utf8'))
  brand.file = file
  brand.colors = { background: '#F4F4F5', surface: '#FFFFFF', ink: '#18181B', muted: '#6B6B73', accent: '#4F5BD5', accent_ink: '#FFFFFF', positive: '#2F7D4F', negative: '#B4432F', ...(brand.colors || {}) }
  brand.fonts = { display: 'Plus Jakarta Sans', body: 'Inter', mono: 'JetBrains Mono', ...(brand.fonts || {}) }
  brand.radius = brand.radius ?? 28
  // Logo paths are relative to the bench root, the piece or the brand.json folder, whichever has the file.
  const find = (p) => {
    if (!p) return null
    for (const base of [benchDir, pieceDir, dirname(file)]) { const f = resolve(base, p); if (existsSync(f)) return f }
    console.warn(`brand: logo file ${p} not found; drawing the placeholder mark`)
    return null
  }
  brand.logoFiles = { mark: find(brand.logo?.mark), wordmark: find(brand.logo?.wordmark) }
  return brand
}

export function registerFonts(brand, { pieceDir, benchDir, repoRoot }) {
  const dirs = [process.env.WB_FONTS_DIR, join(pieceDir, 'assets', 'fonts'), join(benchDir, 'assets', 'fonts'), join(repoRoot, 'assets', 'fonts')]
    .filter((d) => d && existsSync(d))
  const missing = []
  for (const family of new Set(Object.values(brand.fonts))) {
    const stem = family.replace(/\s+/g, '')
    let found = 0
    for (const d of dirs) {
      for (const f of readdirSync(d)) {
        if (new RegExp(`^${stem}-\\d{3}\\.ttf$`, 'i').test(f)) { GlobalFonts.registerFromPath(join(d, f), family); found++ }
      }
      if (found) break
    }
    if (!found) missing.push(family)
  }
  if (missing.length) {
    const spec = missing.map((f) => `"${f}:400,500,600,700,800"`).join(' ')
    console.warn(`fonts not found: ${missing.join(', ')} → falling back to system sans. Fetch them with:\n  core/bin/fetch-fonts.sh ${spec}`)
  }
  return missing
}

/** CSS font string for a role (display | body | mono). */
export function font(brand, role, weight, size) {
  return `${weight} ${size}px "${brand.fonts[role] || brand.fonts.body}", ${FALLBACK}`
}

// ----------------------------------------------------------------------------- colour helpers
export function hexRgb(hex) {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
export const rgba = (hex, a = 1) => { const [r, g, b] = hexRgb(hex); return `rgba(${r},${g},${b},${a})` }
export function mixHex(a, b, t) {
  const A = hexRgb(a), B = hexRgb(b)
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('')
}
/** Relative luminance (0 dark … 1 light), for choosing readable text on a colour. */
export function luminance(hex) {
  const [r, g, b] = hexRgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
