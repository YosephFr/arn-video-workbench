// What every section shares: the background, the section title and a slow drift so nothing sits still.
import { clamp, ease } from '../lib/math.mjs'
import { font } from '../lib/brand.mjs'
import { fit } from '../lib/draw.mjs'

/** Brand background with a soft light from above (tonal depth, no lines). */
export function background(c, film) {
  const { W, H } = film; const C = film.brand.colors
  c.fillStyle = C.background; c.fillRect(-W, -H, W * 3, H * 3)
  const g = c.createRadialGradient(W / 2, H * 0.18, W * 0.05, W / 2, H * 0.3, H * 0.75)
  g.addColorStop(0, 'rgba(255,255,255,0.75)'); g.addColorStop(1, 'rgba(255,255,255,0)')
  c.fillStyle = g; c.fillRect(-W, -H, W * 3, H * 3)
}

/** A slow push on the whole section: scale 1 → 1 + amount around (cx, cy) over the section. */
export function drift(c, film, sec, t, amount = 0.03, cy = film.H / 2) {
  const k = ease.inOutQuad(clamp((t - sec.start) / Math.max(0.5, sec.end - sec.start)))
  const s = 1 + amount * k
  c.translate(film.W / 2, cy); c.scale(s, s); c.translate(-film.W / 2, -cy)
}

/** Section title: display weight, normal case, one line that shrinks to fit, rising in at `at`. */
export function title(c, film, text, t, at, o = {}) {
  if (!text) return
  const k = at === -Infinity ? 1 : ease.brand(clamp((t - at) / 0.6))
  if (k <= 0) return
  const { W, H } = film
  c.save()
  const { size } = fit(c, text, W * 0.86, o.size ?? W * 0.064, (s) => font(film.brand, 'display', 800, s))
  c.font = font(film.brand, 'display', 800, size)
  c.fillStyle = o.color || film.brand.colors.ink; c.textAlign = 'center'; c.textBaseline = 'middle'
  c.globalAlpha *= clamp(k * 2)
  c.fillText(text, W / 2, (o.y ?? H * 0.125) + (1 - k) * 34)
  c.restore()
}
