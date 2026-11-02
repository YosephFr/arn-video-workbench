// The big feature of the week, explained: its name arrives big with its icon (the hero), then glides up into the
// section title while the steps build up one by one on the words that name them, joined by a line that flows from
// step to step; then the real screen rises in and the camera finds the new control.
//
//   { type: 'feature', from: 'L05', title: 'Scheduled reports', icon: 'calendar-clock',
//     tagline: 'Reports that arrive on their own', heroAt: 'L05:scheduled',
//     steps: [ { icon: 'bookmark', title: 'A saved view', detail: 'Any filter set on a report', at: 'L06:view' }, … ],
//     screen: { capture: 'after-schedule', at: 'L07', frame: 'tablet', focus: [ { at: 'L07:live', el: 'Schedule', label: 'New' } ] } }
import { clamp, ease, lerp } from '../lib/math.mjs'
import { font, rgba } from '../lib/brand.mjs'
import { card, fit, rr, wrap } from '../lib/draw.mjs'
import { drawIcon } from '../lib/icons.mjs'
import { deviceGeom, drawDevice, drawFocus, loadCapture, makeCamera, paintCapture } from '../lib/screens.mjs'
import { background, title } from './common.mjs'
import { prepareFocus } from './screens.mjs'

function stepLayout(film, n) {
  const { W, H } = film
  const cw = W * 0.84, ch = H * 0.125, gap = H * 0.035
  const total = n * ch + (n - 1) * gap
  const y0 = H * 0.52 - total / 2
  return { cw, ch, gap, x0: W / 2 - cw / 2, ys: Array.from({ length: n }, (_, i) => y0 + i * (ch + gap)) }
}

export default {
  async prepare(sec, film) {
    const n = sec.steps.length
    sec.steps.forEach((s, i) => { s.t = film.at(s.at, sec.anchorT + 0.6 + i * 0.9) })
    sec.heroT = film.at(sec.heroAt, sec.anchorT + 0.2)
    sec.iconT = Math.min(sec.heroT - 0.15, sec.anchorT + 0.15)   // the icon arrives with the line, the name on its word
    sec.heroOut = Math.max(sec.heroT + 0.8, sec.steps[0].t - 0.75)   // the hero glides into the title here
    if (sec.screen) {
      sec.screenT = film.at(sec.screen.at, sec.steps[n - 1].t + 2)
      sec.cap = await loadCapture(film.capturesDir, sec.screen.capture)
      sec.G = deviceGeom(film, sec.cap, { frame: sec.screen.frame, cy: film.H * 0.505 })
      sec.focusList = await prepareFocus(sec, film, sec.cap, sec.G, sec.screen.focus, sec.screenT + 0.8)
      sec.cam = makeCamera(film, sec.G, { start: sec.screenT, end: sec.end, push: 0.05, focus: sec.focusList })
    } else sec.screenT = Infinity
  },
  draw(c, sec, t, film) {
    const { W, H } = film; const C = film.brand.colors
    background(c, film)
    // Hero: icon and name big in the middle, then the name glides up into the section title.
    const m = ease.inOutCubic(clamp((t - sec.heroOut) / 0.65))
    if (m < 1) {
      const k = ease.brand(clamp((t - sec.heroT) / 0.7))
      const pop = ease.outBack(clamp((t - sec.iconT) / 0.5), 1.8)
      if (pop > 0) {
        const ts = W * 0.2 * lerp(1, 0.6, m), tx = W / 2 - ts / 2, ty = H * 0.3 - ts / 2 - m * H * 0.1
        c.save(); c.globalAlpha *= clamp(pop * 3) * (1 - clamp(m * 3))
        c.translate(W / 2, H * 0.3); c.scale(lerp(0.6, 1, pop), lerp(0.6, 1, pop)); c.translate(-W / 2, -H * 0.3)
        card(c, tx, ty, ts, ts, { r: ts * 0.24, fill: C.accent, shadow: rgba(C.accent, 0.35), blur: 40, dy: 16 })
        drawIcon(c, sec.icon || 'sparkles', W / 2, ty + ts / 2, ts * 0.5, { color: C.accent_ink, width: 2, progress: ease.outCubic(clamp((t - sec.iconT - 0.1) / 0.7)) })
        c.restore()
      }
      if (k > 0) {
        const big = fit(c, sec.title, W * 0.86, W * 0.095, (z) => font(film.brand, 'display', 800, z)).size
        const small = fit(c, sec.title, W * 0.86, W * 0.064, (z) => font(film.brand, 'display', 800, z)).size
        c.save(); c.font = font(film.brand, 'display', 800, lerp(big, small, m)); c.fillStyle = C.ink; c.textAlign = 'center'; c.textBaseline = 'middle'
        c.globalAlpha *= clamp(k * 2); c.fillText(sec.title, W / 2, lerp(H * 0.44 + (1 - k) * 40, H * 0.125, m)); c.restore()
        if (sec.tagline) {
          c.save(); c.font = font(film.brand, 'body', 500, W * 0.042); c.fillStyle = C.muted; c.textAlign = 'center'; c.textBaseline = 'middle'
          c.globalAlpha *= clamp((t - sec.heroT - 0.35) / 0.5) * (1 - clamp(m * 2)); c.fillText(sec.tagline, W / 2, H * 0.5 + (1 - k) * 30); c.restore()
        }
      }
    } else title(c, film, sec.title, t, -Infinity)
    // Steps (they leave upwards when the screen comes in).
    const away = ease.inOutCubic(clamp((t - sec.screenT) / 0.6))
    if (away < 1) {
      const L = stepLayout(film, sec.steps.length)
      c.save(); c.globalAlpha *= 1 - away; c.translate(0, -away * H * 0.12)
      // The connecting line flows from one step to the next as each arrives.
      const ix = L.x0 + L.ch * 0.5
      sec.steps.forEach((s, i) => {
        if (i === 0) return
        const prev = sec.steps[i - 1]
        const k = ease.inOutCubic(clamp((t - prev.t - 0.15) / Math.max(0.3, s.t - prev.t - 0.1)))
        if (k <= 0) return
        const y1 = L.ys[i - 1] + L.ch / 2, y2 = L.ys[i] + L.ch / 2
        c.save(); c.strokeStyle = rgba(C.accent, 0.55); c.lineWidth = 6; c.lineCap = 'round'
        c.setLineDash([2, 18]); c.lineDashOffset = -t * 40
        c.beginPath(); c.moveTo(ix, y1 + L.ch * 0.32); c.lineTo(ix, lerp(y1 + L.ch * 0.32, y2 - L.ch * 0.32, k)); c.stroke(); c.restore()
      })
      sec.steps.forEach((s, i) => {
        const k = ease.brand(clamp((t - s.t + 0.1) / 0.6))
        if (k <= 0) return
        const y = L.ys[i] + (1 - k) * 46
        const latest = sec.steps.filter((x) => t >= x.t - 0.1).length - 1 === i
        c.save(); c.globalAlpha *= clamp(k * 2)
        card(c, L.x0, y, L.cw, L.ch, { r: film.brand.radius, fill: C.surface })
        // Icon tile: tonal, solid accent for the step being said.
        const ts = L.ch * 0.64, tx = L.x0 + L.ch * 0.18, ty = y + (L.ch - ts) / 2
        c.fillStyle = latest ? C.accent : rgba(C.accent, 0.12); rr(c, tx, ty, ts, ts, film.brand.radius * 0.7); c.fill()
        drawIcon(c, s.icon || 'sparkles', tx + ts / 2, ty + ts / 2, ts * 0.5, { color: latest ? C.accent_ink : C.accent, width: 2.2, progress: ease.outCubic(clamp((t - s.t) / 0.5)) })
        const textX = tx + ts + L.ch * 0.22, textW = L.x0 + L.cw - textX - L.ch * 0.2
        const { size } = fit(c, s.title, textW, W * 0.047, (z) => font(film.brand, 'display', 700, z))
        c.font = font(film.brand, 'display', 700, size); c.fillStyle = C.ink; c.textAlign = 'left'; c.textBaseline = 'middle'
        c.fillText(s.title, textX, y + L.ch * (s.detail ? 0.37 : 0.5))
        if (s.detail) {
          c.font = font(film.brand, 'body', 400, W * 0.03); c.fillStyle = C.muted
          c.fillText(wrap(c, s.detail, textW)[0], textX, y + L.ch * 0.66)
        }
        c.restore()
      })
      c.restore()
    }
    // The real screen.
    if (sec.screen && t >= sec.screenT - 0.05) {
      const k = ease.brand(clamp((t - sec.screenT) / 0.8))
      const S0 = sec.cam(t)
      const S = { ...S0, ty: S0.ty + (1 - k) * H * 0.45 }
      drawDevice(c, film, sec.G, S, (cc, x, y, w, h) => paintCapture(cc, sec.cap, x, y, w, h, film), { alpha: clamp(k * 2) })
      for (const f of sec.focusList) drawFocus(c, film, sec.G, S, f, t, sec.cap)
    }
  },
  events(sec) {
    const ev = sec.steps.map((s, i) => ({ t: s.t, name: 'pop', gain_db: -17, pan: [-0.2, 0, 0.2][i % 3] }))
    if (sec.screen) {
      ev.push({ t: sec.screenT - 0.1, name: 'whoosh', gain_db: -18 })
      sec.focusList.forEach((f) => ev.push({ t: f.at, name: 'pop', gain_db: -19 }))
    }
    return ev
  },
}
