// The hook of an update: something the last video left pending closes now. The item's status flips from what it
// was then to what it is today, on the word that says so.
//
//   { type: 'status', from: 'U02', title: 'Scheduled reports', icon: 'calendar-clock', detail: 'For every workspace',
//     was: 'In review', now: 'Live', flipAt: 'U02:live', note: 'Since the last update' }
import { clamp, ease, lerp } from '../lib/math.mjs'
import { font, rgba } from '../lib/brand.mjs'
import { card, fit, rr } from '../lib/draw.mjs'
import { drawIcon } from '../lib/icons.mjs'
import { background, drift } from './common.mjs'

function chip(c, film, text, icon, tone, x, y, size, alpha) {
  c.font = font(film.brand, 'display', 700, size); const tw = c.measureText(text).width
  const iw = size * 1.1, w = tw + iw + size * 1.7, h = size * 2.1
  c.save(); c.globalAlpha *= alpha
  c.fillStyle = rgba(tone, 0.13); rr(c, x, y - h / 2, w, h, h / 2); c.fill()
  drawIcon(c, icon, x + size * 0.85 + iw / 2, y, iw, { color: tone, width: 2.4 })
  c.fillStyle = tone; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(text, x + size * 0.85 + iw + size * 0.35, y + 2)
  c.restore()
  return { w, h }
}

export default {
  prepare(sec, film) {
    sec.flipT = film.at(sec.flipAt, sec.anchorT + 1.2)
    sec.was = sec.was || 'In review'; sec.now = sec.now || 'Live'
  },
  draw(c, sec, t, film) {
    const { W, H } = film; const C = film.brand.colors
    background(c, film)
    c.save(); drift(c, film, sec, t, 0.035, H * 0.47)
    if (sec.note) {
      const na = ease.brand(clamp((t - sec.start - 0.1) / 0.6))
      c.font = font(film.brand, 'body', 500, W * 0.036); c.fillStyle = C.muted; c.textAlign = 'center'; c.textBaseline = 'middle'
      c.globalAlpha = na; c.fillText(sec.note, W / 2, H * 0.3 + (1 - na) * 24); c.globalAlpha = 1
    }
    const k = ease.brand(clamp((t - sec.start - 0.15) / 0.7))
    const cw = W * 0.84, ch = H * 0.24, x0 = W / 2 - cw / 2, y0 = H * 0.36 + (1 - k) * 50
    c.globalAlpha = clamp(k * 2)
    card(c, x0, y0, cw, ch, { r: film.brand.radius * 1.2, fill: C.surface })
    const ts = ch * 0.34, tx = x0 + ch * 0.16, ty = y0 + ch * 0.16
    c.fillStyle = C.accent; rr(c, tx, ty, ts, ts, film.brand.radius * 0.7); c.fill()
    drawIcon(c, sec.icon || 'sparkles', tx + ts / 2, ty + ts / 2, ts * 0.5, { color: C.accent_ink, width: 2.2 })
    const { size } = fit(c, sec.title, cw - ts - ch * 0.5, W * 0.06, (z) => font(film.brand, 'display', 800, z))
    c.font = font(film.brand, 'display', 800, size); c.fillStyle = C.ink; c.textAlign = 'left'; c.textBaseline = 'middle'
    c.fillText(sec.title, tx + ts + ch * 0.12, ty + ts * 0.5)
    if (sec.detail) { c.font = font(film.brand, 'body', 400, W * 0.034); c.fillStyle = C.muted; c.fillText(sec.detail, tx, y0 + ch * 0.62) }
    // The status flips around its horizontal axis on the word.
    const f = clamp((t - sec.flipT) / 0.36)
    const sy = f < 0.5 ? 1 - ease.inCubic(f * 2) : ease.outBack((f - 0.5) * 2, 2)
    const after = f >= 0.5
    const cy = y0 + ch * 0.82
    c.save(); c.translate(0, cy); c.scale(1, Math.max(0.02, sy)); c.translate(0, -cy)
    const { w, h } = after
      ? chip(c, film, sec.now, 'circle-check', C.positive, tx, cy, W * 0.034, 1)
      : chip(c, film, sec.was, 'clock', C.muted, tx, cy, W * 0.034, 1)
    c.restore()
    if (t > sec.flipT + 0.18) {
      const r = clamp((t - sec.flipT - 0.18) / 0.7)
      c.strokeStyle = rgba(C.positive, 0.5 * (1 - r)); c.lineWidth = 6
      rr(c, tx - r * 26, cy - h / 2 - r * 26, w + r * 52, h + r * 52, h / 2 + r * 26); c.stroke()
    }
    c.restore()
  },
  events(sec) { return [{ t: sec.flipT + 0.15, name: 'ding', gain_db: -16 }] },
}

export { lerp }
