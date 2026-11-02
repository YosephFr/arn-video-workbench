// The brand mark, animated in code, and the shapes the transitions borrow from it.
//
// A "simple" SVG mark (flat <rect>, <circle>, <ellipse>, <path>, <polygon>, <polyline> or <line> elements with fill
// and stroke attributes; no transforms, styles, masks, gradients or text) is parsed into vector parts, so the tile
// and the glyph animate separately and stay sharp at any scale. Any other SVG still works: it is rasterised once and
// animated as a whole. No mark file at all → a designed placeholder mark in the brand colours.
//
// The resolve, relative to the lock time u = 0 (when the mark is complete):
//   u −1.00 … −0.62  the tile pops in on a spring
//   u −0.72 … −0.12  the glyph is drawn by a clockwise sweep from 12 o'clock, like a clock hand
//   u −0.10 … +0.50  a small settle
//   u +0.35 … +1.05  the mark shrinks and slides into the lockup
//   u +0.80 … +1.35  the wordmark wipes in from the mark's edge, drifting into place
import { readFileSync } from 'node:fs'
import { Image, Path2D } from '@napi-rs/canvas'
import { clamp, ease, lerp, TAU } from './math.mjs'
import { font } from './brand.mjs'

const UNSUPPORTED = /transform=|<use\b|<clipPath|<mask|Gradient|<text\b|<image\b|style=|class=|<pattern/i

function attrs(s) { const o = {}; for (const m of s.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) o[m[1]] = m[2]; return o }

function partPath(tag, a) {
  const n = (k, d = 0) => parseFloat(a[k] ?? d)
  const p = new Path2D()
  if (tag === 'path') return new Path2D(a.d)
  if (tag === 'rect') { const r = Math.min(n('rx', a.ry || 0), n('width') / 2, n('height') / 2); p.roundRect(n('x'), n('y'), n('width'), n('height'), r); return p }
  if (tag === 'circle') { p.arc(n('cx'), n('cy'), n('r'), 0, TAU); return p }
  if (tag === 'ellipse') { p.ellipse(n('cx'), n('cy'), n('rx'), n('ry'), 0, 0, TAU); return p }
  if (tag === 'line') { p.moveTo(n('x1'), n('y1')); p.lineTo(n('x2'), n('y2')); return p }
  const pts = (a.points || '').trim().split(/[\s,]+/).map(Number)
  p.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) p.lineTo(pts[i], pts[i + 1])
  if (tag === 'polygon') p.closePath()
  return p
}

function parseSimple(svg) {
  const vbm = svg.match(/viewBox\s*=\s*"([^"]+)"/)
  const vb = vbm ? vbm[1].trim().split(/[\s,]+/).map(Number) : [0, 0, parseFloat(attrs(svg.match(/<svg[^>]*>/)[0]).width || 100), parseFloat(attrs(svg.match(/<svg[^>]*>/)[0]).height || 100)]
  if (UNSUPPORTED.test(svg)) return { vb, parts: null }
  const parts = []
  for (const m of svg.matchAll(/<(rect|circle|ellipse|path|polygon|polyline|line)\b([^>]*?)\/?>/g)) {
    const a = attrs(m[2])
    const fill = a.fill === 'none' ? null : (a.fill || (m[1] === 'line' || m[1] === 'polyline' ? null : '#000'))
    const stroke = a.stroke && a.stroke !== 'none' ? a.stroke : null
    parts.push({ tag: m[1], a, path: partPath(m[1], a), fill, stroke, width: parseFloat(a['stroke-width'] || 1), cap: a['stroke-linecap'] || 'butt', join: a['stroke-linejoin'] || 'miter', opacity: parseFloat(a.opacity ?? 1), rule: a['fill-rule'] === 'evenodd' ? 'evenodd' : 'nonzero' })
  }
  if (!parts.length) return { vb, parts: null }
  // The first filled rect or circle that covers most of the viewBox is the tile (background shape).
  const p0 = parts[0]; const area = vb[2] * vb[3]
  const cover = p0.tag === 'rect' ? parseFloat(p0.a.width) * parseFloat(p0.a.height) : p0.tag === 'circle' ? Math.PI * parseFloat(p0.a.r) ** 2 : 0
  const tile = p0.fill && cover > area * 0.6 ? p0 : null
  return { vb, parts, tile, glyph: parts.filter((p) => p !== tile) }
}

function placeholderSvg(brand) {
  const c = brand.colors
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect x="0" y="0" width="120" height="120" rx="30" fill="${c.accent}"/>` +
    `<path d="M30 80 L50 56 L66 70 L90 42" fill="none" stroke="${c.accent_ink}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<circle cx="90" cy="42" r="3" fill="${c.accent_ink}"/></svg>`
}

async function raster(buf, w, h) {
  const img = new Image(); img.width = Math.round(w); img.height = Math.round(h)
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = buf })
  return img
}

export async function loadLogo(brand) {
  const svg = brand.logoFiles.mark ? readFileSync(brand.logoFiles.mark, 'utf8') : placeholderSvg(brand)
  const parsed = parseSimple(svg)
  const [, , vw, vh] = parsed.vb
  const aspect = vh / vw
  const mark = { svg, ...parsed, aspect, img: await raster(Buffer.from(svg), 2048, 2048 * aspect) }
  let wordmark = null
  if (brand.logoFiles.wordmark) {
    const wsvg = readFileSync(brand.logoFiles.wordmark, 'utf8')
    const vb = parseSimple(wsvg).vb
    wordmark = { img: await raster(Buffer.from(wsvg), 1600, 1600 * vb[3] / vb[2]), aspect: vb[3] / vb[2] }
  }
  return { mark, wordmark, name: brand.name, brand }
}

// ----------------------------------------------------------------------------- drawing the mark
function partsTransform(c, mark, x, y, size) {
  const [vx, vy, vw] = mark.vb
  c.translate(x, y); c.scale(size / vw, size / vw); c.translate(-vx, -vy)
}

function drawParts(c, mark, parts, x, y, size, color) {
  c.save(); partsTransform(c, mark, x, y, size)
  for (const p of parts) {
    c.save(); c.globalAlpha *= p.opacity
    if (p.fill) { c.fillStyle = color || p.fill; c.fill(p.path, p.rule) }
    if (p.stroke) { c.strokeStyle = color || p.stroke; c.lineWidth = p.width; c.lineCap = p.cap; c.lineJoin = p.join; c.stroke(p.path) }
    c.restore()
  }
  c.restore()
}

/** The finished mark, static, top-left at (x, y), `size` wide. */
export function drawMark(c, logo, x, y, size, o = {}) {
  const m = logo.mark
  c.save(); c.globalAlpha *= o.alpha ?? 1
  if (m.parts) drawParts(c, m, m.parts, x, y, size, o.color)
  else c.drawImage(m.img, x, y, size, size * m.aspect)
  c.restore()
}

/** Silhouette of the whole mark (tile included) filled with `color`: the shape transitions grow and shrink. */
export function drawSilhouette(c, logo, x, y, size, color = '#000') {
  const m = logo.mark
  if (m.tile) return drawParts(c, m, [m.tile], x, y, size, color)
  if (m.parts) return drawParts(c, m, m.parts, x, y, size, color)
  c.drawImage(m.img, x, y, size, size * m.aspect)   // used as an alpha mask: the colour does not matter
}

/** Only the glyph (the mark without its tile): cut out of panels by the tile transition. */
export function drawGlyph(c, logo, x, y, size, color) {
  const m = logo.mark
  if (m.parts) return drawParts(c, m, m.glyph.length ? m.glyph : m.parts, x, y, size, color)
  c.drawImage(m.img, x, y, size, size * m.aspect)
}

/** The mark while it resolves (u = t − lock). o: { noPop: the tile is already on screen } */
export function drawMarkResolve(c, logo, x, y, size, u, o = {}) {
  const m = logo.mark; const h = size * m.aspect
  const cx = x + size / 2, cy = y + h / 2
  const pop = o.noPop ? 1 : clamp((u + 1.0) / 0.38)
  if (pop <= 0) return
  const settle = u > -0.1 ? 0.035 * Math.exp(-(u + 0.1) * 7) * Math.sin((u + 0.1) * 26) : 0
  const ps = (o.noPop ? 1 : lerp(0.5, 1, ease.outBack(pop, 1.7))) + settle
  const sweep = ease.inOutCubic(clamp((u + 0.72) / 0.6))
  c.save()
  c.translate(cx, cy); c.scale(ps, ps); c.translate(-cx, -cy)
  c.globalAlpha *= clamp(pop * 3)
  const pie = (k) => { c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, size, -Math.PI / 2, -Math.PI / 2 + TAU * k, false); c.closePath(); c.clip() }
  if (m.tile) {
    drawParts(c, m, [m.tile], x, y, size)
    if (sweep > 0) { c.save(); if (sweep < 1) pie(sweep); drawParts(c, m, m.glyph, x, y, size); c.restore() }
  } else {
    // No separate tile: the whole mark is drawn by the sweep while it pops.
    const k = Math.max(sweep, clamp((u + 1.0) / 0.9))
    if (k > 0) { c.save(); if (k < 1) pie(k); drawMark(c, logo, x, y, size); c.restore() }
  }
  c.restore()
}

// ----------------------------------------------------------------------------- lockup
/** Geometry of the horizontal lockup (mark + wordmark) centred on (cx, cy) with the mark `size` tall. */
export function lockupLayout(c, logo, cx, cy, size) {
  const brand = logo.brand
  const gap = size * 0.28
  let ww, wh
  if (logo.wordmark) { wh = size * 0.62; ww = wh / logo.wordmark.aspect }
  else { c.save(); c.font = font(brand, 'display', 800, size * 0.62); ww = c.measureText(logo.name).width; c.restore(); wh = size * 0.62 }
  const msize = size / logo.mark.aspect   // mark width
  const total = msize + gap + ww
  const x0 = cx - total / 2
  return { markX: x0, markY: cy - size / 2, markW: msize, markH: size, wordX: x0 + msize + gap, wordY: cy, wordW: ww, wordH: wh, total }
}

/** Draw the wordmark with its left edge at x, vertically centred on y; `reveal` 0..1 wipes it in from the left. */
export function drawWordmark(c, logo, x, y, w, h, reveal = 1, color) {
  if (reveal <= 0) return
  const e = ease.outCubic(reveal)
  c.save()
  c.beginPath(); c.rect(x - 4, y - h * 1.2, (w + 24) * ease.inOutCubic(reveal) + 4, h * 2.4); c.clip()
  const dx = -(1 - e) * h * 0.9
  if (logo.wordmark) c.drawImage(logo.wordmark.img, x + dx, y - h / 2, w, h)
  else {
    c.font = font(logo.brand, 'display', 800, h); c.fillStyle = color || logo.brand.colors.ink
    c.textBaseline = 'middle'; c.textAlign = 'left'; c.fillText(logo.name, x + dx, y + h * 0.04)
  }
  c.restore()
}

/**
 * The whole resolve: the mark appears big at (cx, cy), then settles into the lockup centred on lock.{cx, cy} with
 * the mark lock.size tall. u = t − lockTime. Returns the mark rect at this instant (for the logo transitions).
 */
export function drawLogoResolve(c, logo, u, o) {
  const { cx, cy, big, lock } = o
  const L = lockupLayout(c, logo, lock.cx, lock.cy, lock.size)
  const mv = o.stay ? 0 : ease.inOutCubic(clamp((u - 0.35) / 0.7))
  const mw = lerp(big / logo.mark.aspect, L.markW, mv), mh = lerp(big, L.markH, mv)
  const mx = lerp(cx - big / logo.mark.aspect / 2, L.markX, mv), my = lerp(cy - big / 2, L.markY, mv)
  if (!o.stay) drawWordmark(c, logo, L.wordX, L.wordY, L.wordW, L.wordH, clamp((u - 0.8) / 0.55), o.wordColor)
  drawMarkResolve(c, logo, mx, my, mw, u, { noPop: o.noPop })
  return { x: mx, y: my, w: mw, h: mh, lockup: L }
}
