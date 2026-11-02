// Brand close: the previous section shrinks into the mark (iris-close), the mark finishes its resolve and settles
// into the lockup, then one line and the address rise in. A slow push keeps the hold alive to the last frame.
//
//   { type: 'close', from: 'L09', line: 'Platform updates, every Monday', url: 'acme.example', lock: 1.15 }
//   lock: seconds after the section start at which the mark completes; keep it ≥ half the transition + 0.75 so
//   the glyph starts drawing after the iris has closed.
import { clamp, ease } from '../lib/math.mjs'
import { font } from '../lib/brand.mjs'
import { fit } from '../lib/draw.mjs'
import { drawLogoResolve } from '../lib/logo.mjs'
import { background } from './common.mjs'

function layout(film) {
  const { W, H } = film
  return { cx: W / 2, cy: H * 0.43, big: W * 0.3, lock: { cx: W / 2, cy: H * 0.42, size: W * 0.13 } }
}
// Linear on purpose: an eased push would come to rest during the hold, and a still end card reads as frozen.
const driftScale = (sec, t) => 1 + 0.04 * clamp((t - sec.start) / Math.max(0.5, sec.end - sec.start))

export default {
  prepare(sec) {
    sec.lockT = sec.start + (sec.lock ?? 1.15)
    sec.captions = sec.captions ?? false
    sec.transition = sec.transition ?? 'iris-close'
  },
  draw(c, sec, t, film) {
    const { W, H, logo } = film; const C = film.brand.colors
    background(c, film)
    c.save()
    const s = driftScale(sec, t); c.translate(W / 2, H * 0.45); c.scale(s, s); c.translate(-W / 2, -H * 0.45)
    drawLogoResolve(c, logo, t - sec.lockT, { ...layout(film), noPop: sec.transition === 'iris-close' })
    const la = ease.brand(clamp((t - sec.lockT - 1.0) / 0.7))
    if (la > 0 && sec.line) {
      const { size } = fit(c, sec.line, W * 0.84, W * 0.05, (z) => font(film.brand, 'display', 700, z))
      c.font = font(film.brand, 'display', 700, size); c.fillStyle = C.ink; c.textAlign = 'center'; c.textBaseline = 'middle'
      c.globalAlpha = clamp(la * 2); c.fillText(sec.line, W / 2, H * 0.505 + (1 - la) * 30)
    }
    const ua = ease.brand(clamp((t - sec.lockT - 1.25) / 0.7))
    if (ua > 0 && (sec.url ?? film.brand.url)) {
      c.font = font(film.brand, 'body', 600, W * 0.038); c.fillStyle = C.accent; c.textAlign = 'center'; c.textBaseline = 'middle'
      c.globalAlpha = clamp(ua * 2); c.fillText(sec.url ?? film.brand.url, W / 2, H * 0.555 + (1 - ua) * 24)
    }
    c.restore()
  },
  /** Where the closing mark starts (frame px): the iris-close lands the previous section exactly here. */
  markRect(sec, t, film) {
    const L = layout(film); const s = driftScale(sec, t); const { W, H } = film
    const w = L.big / film.logo.mark.aspect
    const tx = (x) => W / 2 + (x - W / 2) * s, ty = (y) => H * 0.45 + (y - H * 0.45) * s
    return { x: tx(L.cx - w / 2), y: ty(L.cy - L.big / 2), w: w * s, h: L.big * s }
  },
  events(sec) { return [{ t: sec.lockT - 0.95, name: 'logo', gain_db: -11 }] },
}
