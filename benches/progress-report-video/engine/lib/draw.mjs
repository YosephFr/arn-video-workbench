// Small drawing helpers in design space: rounded rects, soft-shadow cards, text that fits, number formatting.
import { createCanvas } from '@napi-rs/canvas'

export function rr(c, x, y, w, h, r) {
  c.beginPath()
  c.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)))
}

// Blurred shadows are the most expensive thing Skia draws on the CPU. Cards cache theirs as a bitmap per size
// and reuse it every frame (drawn under whatever transform the card has).
const SHADOWS = new Map()
function shadowBitmap(w, h, r, blur, color, dy) {
  const key = `${Math.round(w)}x${Math.round(h)}|${Math.round(r)}|${blur}|${color}|${dy}`
  let s = SHADOWS.get(key)
  if (!s) {
    const pad = blur * 2
    const cv = createCanvas(Math.ceil(w + pad * 2), Math.ceil(h + pad * 2)); const c = cv.getContext('2d')
    // The shape is drawn off-canvas and only its shadow is offset back in: no flat fill, just the soft falloff.
    const OFF = Math.ceil(w + pad * 4)
    c.shadowColor = color; c.shadowBlur = blur; c.shadowOffsetX = OFF; c.shadowOffsetY = 0
    c.fillStyle = '#000'; rr(c, pad - OFF, pad, w, h, r); c.fill()
    // Keep only the shadow: punch out where the card itself will sit (the bitmap is drawn dy lower), so a
    // translucent card never darkens and the shadow keeps its soft falloff.
    c.shadowColor = 'transparent'; c.globalCompositeOperation = 'destination-out'; rr(c, pad + 1, pad - dy + 1, w - 2, h - 2, r); c.fill()
    s = { cv, pad }
    if (SHADOWS.size > 64) SHADOWS.clear()
    SHADOWS.set(key, s)
  }
  return s
}

/** A tonal card with a soft shadow (no outlines). o: { r, fill, shadow (css colour), blur, dy, alpha } */
export function card(c, x, y, w, h, o = {}) {
  const r = o.r ?? 28
  c.save()
  c.globalAlpha *= o.alpha ?? 1
  if (o.shadow !== false) {
    const dy = o.dy ?? 14
    const s = shadowBitmap(w, h, r, o.blur ?? 36, o.shadow || 'rgba(24,24,32,0.16)', dy)
    c.drawImage(s.cv, x - s.pad, y - s.pad + dy)
  }
  c.fillStyle = o.fill || '#fff'
  rr(c, x, y, w, h, r); c.fill()
  c.restore()
}

/** Largest size ≤ size (down to min) at which `text` fits in maxW. Returns { size, width }. */
export function fit(c, text, maxW, size, fontFn, min = size * 0.6) {
  let s = size
  for (;;) {
    c.font = fontFn(s)
    const w = c.measureText(text).width
    if (w <= maxW || s <= min) return { size: s, width: w }
    s -= Math.max(1, s * 0.04)
  }
}

/** Greedy word wrap: returns lines that fit maxW with the current ctx.font. */
export function wrap(c, text, maxW) {
  const words = String(text).split(/\s+/).filter(Boolean)
  const lines = []; let cur = ''
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w
    if (c.measureText(next).width > maxW && cur) { lines.push(cur); cur = w } else cur = next
  }
  if (cur) lines.push(cur)
  // Avoid a lonely last word when the line above can give one away.
  if (lines.length >= 2 && !lines[lines.length - 1].includes(' ')) {
    const prev = lines[lines.length - 2].split(' ')
    if (prev.length > 2) {
      const moved = prev.pop() + ' ' + lines[lines.length - 1]
      if (c.measureText(moved).width <= maxW) { lines[lines.length - 2] = prev.join(' '); lines[lines.length - 1] = moved }
    }
  }
  return lines
}

/** Format a number for the screen: { decimals, sep, dec, prefix, suffix }. */
export function fmtNumber(v, o = {}) {
  const d = o.decimals ?? 0
  const fixed = Math.abs(v).toFixed(d)
  let [int, frac] = fixed.split('.')
  int = int.replace(/\B(?=(\d{3})+(?!\d))/g, o.sep ?? ',')
  return (v < 0 ? '−' : '') + (o.prefix || '') + int + (frac ? (o.dec ?? '.') + frac : '') + (o.suffix || '')
}
