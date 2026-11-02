// Opening: the mark resolves (tile, clockwise glyph, settle), slides into the lockup with the wordmark, and the
// title of the piece rises under it. The next section opens through the mark (iris) from the lockup position.
//
//   { type: 'opening', title: 'Weekly update', subtitle: '26 October – 2 November', lock: 0.95 }
//   lock: seconds after the section start at which the mark is complete (default 0.95).
import { clamp, ease } from '../lib/math.mjs'
import { font } from '../lib/brand.mjs'
import { fit } from '../lib/draw.mjs'
import { drawLogoResolve, lockupLayout } from '../lib/logo.mjs'
import { background } from './common.mjs'

function layout(film) {
  const { W, H } = film
  return { cx: W / 2, cy: H * 0.43, big: W * 0.3, lock: { cx: W / 2, cy: H * 0.4, size: W * 0.13 } }
}

function driftScale(sec, t) { return 1 + 0.035 * ease.inOutQuad(clamp((t - sec.start) / Math.max(0.5, sec.end - sec.start))) }

export default {
  prepare(sec) {
    sec.lockT = sec.start + (sec.lock ?? 0.95)
    sec.captions = sec.captions ?? false
  },
  draw(c, sec, t, film) {
    const { W, H, logo } = film; const C = film.brand.colors
    background(c, film)
    c.save()
    const s = driftScale(sec, t); c.translate(W / 2, H * 0.45); c.scale(s, s); c.translate(-W / 2, -H * 0.45)
    drawLogoResolve(c, logo, t - sec.lockT, layout(film))
    const ta = ease.brand(clamp((t - sec.lockT - 1.0) / 0.7))
    if (ta > 0 && sec.title) {
      const { size } = fit(c, sec.title, W * 0.84, W * 0.088, (z) => font(film.brand, 'display', 800, z))
      c.font = font(film.brand, 'display', 800, size); c.textAlign = 'center'; c.textBaseline = 'middle'
      c.globalAlpha = clamp(ta * 2); c.fillStyle = C.ink
      c.fillText(sec.title, W / 2, H * 0.515 + (1 - ta) * 40)
    }
    const sa = ease.brand(clamp((t - sec.lockT - 1.2) / 0.7))
    if (sa > 0 && sec.subtitle) {
      c.font = font(film.brand, 'body', 500, W * 0.042); c.textAlign = 'center'; c.textBaseline = 'middle'
      c.globalAlpha = clamp(sa * 2); c.fillStyle = C.muted
      c.fillText(sec.subtitle, W / 2, H * 0.575 + (1 - sa) * 30)
    }
    c.restore()
  },
  /** Where the mark is at time t (frame px): the iris into the next section grows from here. */
  markRect(sec, t, film) {
    const L = layout(film)
    const lay = lockupLayout(film.ctxForMeasure, film.logo, L.lock.cx, L.lock.cy, L.lock.size)
    const s = driftScale(sec, t); const { W, H } = film
    const tx = (x) => W / 2 + (x - W / 2) * s, ty = (y) => H * 0.45 + (y - H * 0.45) * s
    return { x: tx(lay.markX), y: ty(lay.markY), w: lay.markW * s, h: lay.markH * s }
  },
  events(sec) {
    return [{ t: Math.max(0, sec.lockT - 0.95), name: 'logo', gain_db: -11 }]
  },
}
