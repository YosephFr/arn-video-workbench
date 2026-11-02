// The rest of the week, quickly: one row per change, each arriving on the word that names it, its check drawing in.
//
//   { type: 'list', from: 'L08', title: 'Also live this week',
//     items: [ { text: 'Faster exports', icon: 'zap', at: 'L08:faster' }, … ] }   (3 to 6 items read best)
import { clamp, ease, lerp } from '../lib/math.mjs'
import { font, rgba } from '../lib/brand.mjs'
import { card, fit } from '../lib/draw.mjs'
import { drawIcon } from '../lib/icons.mjs'
import { background, drift, title } from './common.mjs'

export default {
  prepare(sec, film) {
    sec.items.forEach((it, i) => { it.t = film.at(it.at, sec.anchorT + 0.5 + i * 0.7) })
  },
  draw(c, sec, t, film) {
    const { W, H } = film; const C = film.brand.colors
    background(c, film)
    c.save(); drift(c, film, sec, t, 0.03, H * 0.45)
    title(c, film, sec.title, t, sec.start + 0.1, { y: H * 0.2 })
    const n = sec.items.length
    const rh = Math.min(H * 0.088, (H * 0.56) / n - H * 0.02), gap = H * 0.022, rw = W * 0.84
    const total = n * rh + (n - 1) * gap
    const y0 = H * 0.53 - total / 2
    sec.items.forEach((it, i) => {
      const k = ease.brand(clamp((t - it.t + 0.08) / 0.55))
      if (k <= 0) return
      const x = W / 2 - rw / 2 + (1 - k) * W * 0.06, y = y0 + i * (rh + gap)
      c.save(); c.globalAlpha *= clamp(k * 2)
      card(c, x, y, rw, rh, { r: film.brand.radius, fill: C.surface })
      const R = rh * 0.3, cx = x + rh * 0.5, cy = y + rh / 2
      const pop = ease.outBack(clamp((t - it.t) / 0.4), 2)
      c.fillStyle = rgba(C.accent, 0.12); c.beginPath(); c.arc(cx, cy, R * lerp(0.6, 1, pop), 0, Math.PI * 2); c.fill()
      drawIcon(c, it.icon || 'check', cx, cy, R * 1.1, { color: C.accent, width: 2.6, progress: ease.outCubic(clamp((t - it.t - 0.1) / 0.45)) })
      const tx = x + rh * 1.02, tw = rw - rh * 1.3
      const { size } = fit(c, it.text, tw, W * 0.045, (z) => font(film.brand, 'display', 700, z))
      c.font = font(film.brand, 'display', 700, size); c.fillStyle = C.ink; c.textAlign = 'left'; c.textBaseline = 'middle'
      c.fillText(it.text, tx, cy + 2)
      c.restore()
    })
    c.restore()
  },
  events(sec) {
    return sec.items.map((it, i) => ({ t: it.t, name: 'pop', gain_db: -17, pan: i % 2 ? 0.2 : -0.2 }))
  },
}
