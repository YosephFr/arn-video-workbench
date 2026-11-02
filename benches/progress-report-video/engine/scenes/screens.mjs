// Real screens. `beforeAfter`: the same screen with the same data, the old build first, then a divider sweeps across
// and the new one takes its place (it stops halfway so both can be compared). `screen`: one capture.
// Both keep a slow push-in for the whole section and move the camera onto each focus target.
//
//   { type: 'beforeAfter', from: 'L03', title: 'Reports, before and after',
//     before: 'before-reports', after: 'after-reports', revealAt: 'L03:now',
//     labels: { before: 'Before', after: 'Now' }, frame: 'tablet' | 'browser',
//     focus: [ { at: 'L04:totals', to: 'L04:exported', el: 'Total', kind: 'ring' | 'spot' | 'magnify', label: 'Totals on top', zoom: 1.3 } ] }
//   { type: 'screen', from: 'L07', title: '…', capture: 'after-schedule', focus: [ … ] }
import { clamp, ease, lerp } from '../lib/math.mjs'
import { font, rgba } from '../lib/brand.mjs'
import { rr } from '../lib/draw.mjs'
import { drawIcon } from '../lib/icons.mjs'
import { camTransform, deviceGeom, drawDevice, drawFocus, elRect, findEl, loadCapture, makeCamera, paintCapture } from '../lib/screens.mjs'
import { background, title } from './common.mjs'

export async function prepareFocus(sec, film, cap, G, list, fallbackAt) {
  const out = []
  for (let i = 0; i < (list || []).length; i++) {
    const f = list[i]
    const at = film.at(f.at, fallbackAt)
    const el = findEl(cap, f.el)
    out.push({ ...f, at, el, rect: elRect(G, el), zoom: f.zoom ?? (f.kind === 'magnify' ? 1 : undefined) })   // the lens is the zoom
  }
  out.forEach((f, i) => { f.to = film.at(list[i].to, out[i + 1] ? out[i + 1].at - 0.15 : sec.end - 0.4) })
  return out
}

function pill(c, film, text, x, y, o) {
  const size = film.W * 0.028
  c.font = font(film.brand, 'display', 700, size); const tw = c.measureText(text).width
  const w = tw + size * 1.5, h = size * 2
  const left = o.align === 'right' ? x - w : x
  c.save(); c.globalAlpha *= o.alpha
  c.fillStyle = o.bg; rr(c, left, y, w, h, h / 2); c.fill()
  c.fillStyle = o.fg; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, left + w / 2, y + h / 2 + 1)
  c.restore()
}

function revealPos(sec, t) {
  // 1 = all "before"; 0 = all "after". Sweep to the middle, hold, finish.
  if (!sec.before) return 0
  const r = sec.revealT; const h = sec.hold ?? 0.5
  if (t < r) return 1
  if (t < r + 0.65) return lerp(1, 0.5, ease.inOutCubic((t - r) / 0.65))
  if (t < r + 0.65 + h) return 0.5
  return lerp(0.5, 0, ease.inOutCubic(clamp((t - r - 0.65 - h) / 0.6)))
}

function drawScreens(c, sec, t, film) {
  const C = film.brand.colors
  background(c, film)
  title(c, film, sec.title, t, sec.start + 0.1)
  const G = sec.G; const S = sec.cam(t)
  const pos = revealPos(sec, t)
  drawDevice(c, film, G, S, (cc, x, y, w, h) => {
    if (sec.before && pos > 0) paintCapture(cc, sec.beforeCap, x, y, w, h, film)
    if (pos < 1) {
      cc.save(); cc.beginPath(); cc.rect(x + w * pos, y, w * (1 - pos) + 2, h); cc.clip()
      paintCapture(cc, sec.afterCap, x, y, w, h, film); cc.restore()
    }
    // Before / after labels inside the screen.
    if (sec.before) {
      const inset = w * 0.03
      const ab = clamp((pos - 0.1) / 0.15) * clamp((t - sec.start - 0.2) / 0.4)
      if (ab > 0) pill(cc, film, sec.labels.before, x + inset, y + inset, { bg: rgba(C.ink, 0.86), fg: '#FFFFFF', alpha: ab })
      const aa = clamp((t - sec.revealT) / 0.35)
      if (aa > 0) pill(cc, film, sec.labels.after, x + w - inset, y + inset, { bg: C.accent, fg: C.accent_ink, alpha: aa, align: 'right' })
    }
    // The divider and its handle.
    if (sec.before && pos > 0 && pos < 1) {
      const dx = x + w * pos
      cc.save()
      cc.shadowColor = 'rgba(0,0,0,0.25)'; cc.shadowBlur = 18
      cc.fillStyle = '#FFFFFF'; cc.fillRect(dx - 3, y, 6, h)
      const hy = y + h * 0.5, R = w * 0.045
      cc.fillStyle = C.accent; cc.beginPath(); cc.arc(dx, hy, R, 0, Math.PI * 2); cc.fill()
      cc.shadowColor = 'transparent'
      drawIcon(cc, 'chevrons-left-right', dx, hy, R * 1.15, { color: C.accent_ink, width: 2.4 })
      cc.restore()
    }
  }, { url: sec.url })
  for (const f of sec.focusList) if (t >= sec.revealT + 0.4 || !sec.before) drawFocus(c, film, G, S, f, t, sec.afterCap)
}

async function prepareScreens(sec, film) {
  sec.labels = { before: 'Before', after: 'Now', ...(sec.labels || {}) }
  sec.afterCap = await loadCapture(film.capturesDir, sec.after || sec.capture)
  if (sec.before) sec.beforeCap = await loadCapture(film.capturesDir, sec.before)
  sec.revealT = sec.before ? film.at(sec.revealAt, sec.anchorT + 0.8) : sec.start
  sec.G = deviceGeom(film, sec.afterCap, { frame: sec.frame, cy: sec.deviceY ?? film.H * 0.505, width: sec.deviceWidth })
  if (sec.beforeCap && (sec.beforeCap.vw !== sec.afterCap.vw || sec.beforeCap.vh !== sec.afterCap.vh)) {
    console.warn(`beforeAfter: ${sec.before} and ${sec.after} have different viewports; capture both at the same size so the divider compares like with like`)
  }
  sec.focusList = await prepareFocus(sec, film, sec.afterCap, sec.G, sec.focus, sec.revealT + 1)
  sec.cam = makeCamera(film, sec.G, { start: sec.start, end: sec.end, push: sec.push ?? 0.055, focus: sec.focusList })
}

export const beforeAfter = {
  prepare: prepareScreens,
  draw: drawScreens,
  events(sec) {
    const ev = sec.before ? [{ t: sec.revealT, name: 'swoosh', gain_db: -16 }, { t: sec.revealT + 0.65 + (sec.hold ?? 0.5), name: 'swoosh', gain_db: -19, pan: -0.2 }] : []
    sec.focusList.forEach((f, i) => ev.push({ t: f.at, name: 'pop', gain_db: -19, pan: i % 2 ? 0.15 : -0.15 }))
    return ev
  },
}

export const screen = beforeAfter

export { camTransform }
