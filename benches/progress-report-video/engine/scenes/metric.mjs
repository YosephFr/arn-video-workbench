// One headline metric: a real number from production, rolled in like an odometer on the word that says it, with
// its comparison, a short trend and where the number comes from.
//
//   { type: 'metric', from: 'L02', label: 'Weekly active workspaces', value: 1234, format: { sep: ',' },
//     countAt: 'L02:reached', landAt: 'L02:thirty:end', delta: { text: '+12% vs. last week', tone: 'positive', at: 'L02:twelve' },
//     series: [820, 870, 905, 990, 1010, 1102, 1234], seriesLabels: ['8 weeks ago', 'This week'],
//     source: 'Source: production read replica, 2 Nov' }
import { clamp, ease, fract, lerp } from '../lib/math.mjs'
import { font, rgba } from '../lib/brand.mjs'
import { card, fit, fmtNumber, rr } from '../lib/draw.mjs'
import { drawIcon } from '../lib/icons.mjs'
import { background, drift } from './common.mjs'

/** Odometer: every digit column scrolls to its final digit; the right-hand columns spin more. */
function odometer(c, film, text, cx, cy, size, p) {
  c.font = font(film.brand, 'display', 800, size)
  const digitW = Math.max(...'0123456789'.split('').map((d) => c.measureText(d).width))
  const chars = text.split('')
  const widths = chars.map((ch) => (/\d/.test(ch) ? digitW : c.measureText(ch).width))
  const total = widths.reduce((a, b) => a + b, 0)
  let x = cx - total / 2
  const digits = chars.filter((ch) => /\d/.test(ch)).length
  c.textAlign = 'center'; c.textBaseline = 'middle'
  // The window is exactly one digit tall (measured), and rolling digits are 1.35 digit-heights apart, so a
  // neighbour is only ever seen while it is entering or leaving the window.
  const m = c.measureText('0'); const asc = m.actualBoundingBoxAscent, desc = m.actualBoundingBoxDescent
  const gh = asc + desc, pitch = gh * 1.35, margin = size * 0.03
  let di = 0
  chars.forEach((ch, i) => {
    const w = widths[i]
    if (!/\d/.test(ch)) { c.globalAlpha = clamp(p * 4); c.fillText(ch, x + w / 2, cy); x += w; return }
    const d = +ch; const spins = digits - di; di++
    const e = ease.outExpo(clamp(p * (1 + 0.08 * (digits - di))))   // left columns settle a touch earlier
    const v = e * (spins * 10 + d)
    const lo = Math.floor(v), f = fract(v)
    c.save(); c.beginPath(); c.rect(x - 2, cy - asc - margin, w + 4, gh + margin * 2); c.clip()
    c.globalAlpha = clamp(p * 4)
    c.fillText(String(lo % 10), x + w / 2, cy - f * pitch)
    if (f > 0.001) c.fillText(String((lo + 1) % 10), x + w / 2, cy + (1 - f) * pitch)
    c.restore()
    x += w
  })
}

export default {
  prepare(sec, film) {
    sec.countT = film.at(sec.countAt, sec.anchorT + 0.25)
    // landAt: the anchor where the number has been said in full (it lands there); otherwise countDur seconds.
    sec.countDur = sec.landAt ? Math.max(0.6, film.at(sec.landAt) - sec.countT) : (sec.countDur ?? 1.3)
    if (sec.delta) sec.delta.t = film.at(sec.delta.at, sec.countT + sec.countDur + 0.1)
    sec.trendT = sec.countT + 0.2
  },
  draw(c, sec, t, film) {
    const { W, H } = film; const C = film.brand.colors
    background(c, film)
    c.save(); drift(c, film, sec, t, 0.035, H * 0.45)
    // Label.
    const la = ease.brand(clamp((t - sec.start - 0.1) / 0.6))
    if (la > 0) {
      const { size } = fit(c, sec.label, W * 0.84, W * 0.05, (s) => font(film.brand, 'display', 700, s))
      c.font = font(film.brand, 'display', 700, size); c.fillStyle = C.muted; c.textAlign = 'center'; c.textBaseline = 'middle'
      c.globalAlpha = clamp(la * 2); c.fillText(sec.label, W / 2, H * 0.285 + (1 - la) * 30); c.globalAlpha = 1
    }
    // The number, landing with a small spring.
    const p = clamp((t - sec.countT) / sec.countDur)
    if (t >= sec.countT - 0.05) {
      const land = t - sec.countT - sec.countDur
      const pulse = land > 0 ? 1 + 0.045 * Math.exp(-land * 7) * Math.sin(land * 22) : 1
      const text = fmtNumber(sec.value, sec.format || {})
      const { size } = fit(c, text, W * 0.88, W * 0.24, (s) => font(film.brand, 'display', 800, s))
      c.save(); c.translate(W / 2, H * 0.395); c.scale(pulse, pulse); c.translate(-W / 2, -H * 0.395)
      c.fillStyle = C.ink; odometer(c, film, text, W / 2, H * 0.395, size, p); c.restore()
    }
    // Comparison chip.
    if (sec.delta && t >= sec.delta.t) {
      const k = ease.outBack(clamp((t - sec.delta.t) / 0.4), 1.6)
      const tone = sec.delta.tone === 'negative' ? C.negative : sec.delta.tone === 'neutral' ? C.muted : C.positive
      const size = W * 0.036
      c.font = font(film.brand, 'display', 700, size); const tw = c.measureText(sec.delta.text).width
      const iw = size * 1.15, cw = tw + iw + size * 1.6, ch = size * 2.1
      c.save(); c.translate(W / 2, H * 0.5); c.scale(lerp(0.7, 1, k), lerp(0.7, 1, k)); c.globalAlpha = clamp(k * 3)
      c.fillStyle = rgba(tone, 0.13); rr(c, -cw / 2, -ch / 2, cw, ch, ch / 2); c.fill()
      drawIcon(c, sec.delta.icon || (sec.delta.tone === 'negative' ? 'trending-down' : sec.delta.tone === 'neutral' ? 'minus' : 'trending-up'), -cw / 2 + size * 0.8 + iw / 2, 0, iw, { color: tone, width: 2.4 })
      c.fillStyle = tone; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(sec.delta.text, -cw / 2 + size * 0.8 + iw + size * 0.35, 2)
      c.restore()
    }
    // Trend card: the series draws itself while the number rolls.
    if (sec.series && sec.series.length > 1) {
      const ka = ease.brand(clamp((t - sec.trendT + 0.3) / 0.7))
      if (ka > 0) {
        const cw = W * 0.82, ch = H * 0.17, x0 = W / 2 - cw / 2, y0 = H * 0.585 + (1 - ka) * 50
        card(c, x0, y0, cw, ch, { r: film.brand.radius, fill: C.surface, alpha: clamp(ka * 2) })
        const vs = sec.series; const lo = Math.min(...vs), hi = Math.max(...vs)
        const px = (i) => x0 + cw * 0.08 + (cw * 0.84 * i) / (vs.length - 1)
        const py = (v) => y0 + ch * 0.78 - ((v - lo) / Math.max(1e-9, hi - lo)) * ch * 0.5
        const dp = ease.inOutCubic(clamp((t - sec.trendT) / 1.5)) * (vs.length - 1)
        const n = Math.floor(dp), f = dp - n
        const pts = []; for (let i = 0; i <= n; i++) pts.push([px(i), py(vs[i])])
        if (n < vs.length - 1) pts.push([lerp(px(n), px(n + 1), f), lerp(py(vs[n]), py(vs[n + 1]), f)])
        c.save(); c.globalAlpha = clamp(ka * 2)
        if (pts.length > 1) {
          c.beginPath(); c.moveTo(pts[0][0], y0 + ch * 0.86); pts.forEach(([x, y]) => c.lineTo(x, y)); c.lineTo(pts[pts.length - 1][0], y0 + ch * 0.86); c.closePath()
          c.fillStyle = rgba(C.accent, 0.1); c.fill()
          c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)))
          c.strokeStyle = C.accent; c.lineWidth = 7; c.lineJoin = 'round'; c.lineCap = 'round'; c.stroke()
          const [hx, hy] = pts[pts.length - 1]
          const ring = (t * 1.4) % 1
          c.fillStyle = rgba(C.accent, 0.25 * (1 - ring)); c.beginPath(); c.arc(hx, hy, 12 + ring * 26, 0, Math.PI * 2); c.fill()
          c.fillStyle = C.accent; c.beginPath(); c.arc(hx, hy, 12, 0, Math.PI * 2); c.fill()
        }
        if (sec.seriesLabels) {
          c.font = font(film.brand, 'body', 500, W * 0.024); c.fillStyle = C.muted; c.textBaseline = 'middle'
          c.textAlign = 'left'; c.fillText(sec.seriesLabels[0], x0 + cw * 0.06, y0 + ch * 0.17)
          c.textAlign = 'right'; c.fillText(sec.seriesLabels[1], x0 + cw * 0.94, y0 + ch * 0.17)
        }
        c.restore()
      }
    }
    // Where the number comes from.
    if (sec.source) {
      const sa = clamp((t - sec.countT - 0.6) / 0.5)
      c.font = font(film.brand, 'body', 400, W * 0.026); c.fillStyle = C.muted; c.textAlign = 'center'; c.textBaseline = 'middle'
      c.globalAlpha = sa; c.fillText(sec.source, W / 2, H * 0.79)
    }
    c.restore()
  },
  events(sec) {
    const land = sec.countT + sec.countDur
    const ev = [{ t: sec.countT, name: 'swoosh', gain_db: -18 }, { t: land, name: 'ding', gain_db: -20 }]
    if (sec.delta && sec.delta.t - land > 0.4) ev.push({ t: sec.delta.t, name: 'pop', gain_db: -18 })
    return ev
  },
}
