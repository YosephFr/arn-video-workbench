// Real screens of the product inside a device, with a camera that never sits still.
//
// A capture is <piece>/captures/<id>.png plus <id>.json, written by tools/capture.mjs: the viewport
// ({ width, height, dpr }) and every visible element with its text, role and box in CSS pixels. Highlights find
// elements by their text, so a ring lands exactly on the control the narration names, at the word that names it.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadImage } from '@napi-rs/canvas'
import { clamp, ease, lerp, smoothstep } from './math.mjs'
import { font, rgba } from './brand.mjs'
import { card, rr } from './draw.mjs'
import { drawIcon } from './icons.mjs'

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
const INTERACTIVE = /^(button|link|tab|input|textbox|select|option|checkbox|radio|switch|menuitem|card)$/i

const CAPTURES = new Map()

/** dir: the piece's captures folder (film.capturesDir: <piece>/captures, or spec.captures to share another piece's). */
export async function loadCapture(dir, id) {
  if (CAPTURES.has(id)) return CAPTURES.get(id)
  const png = join(dir, `${id}.png`), json = join(dir, `${id}.json`)
  const meta = existsSync(json) ? JSON.parse(readFileSync(json, 'utf8')) : { viewport: { width: 1024, height: 1320, dpr: 2 }, elements: [] }
  meta.elements = meta.elements || []
  let img = null
  if (existsSync(png)) img = await loadImage(readFileSync(png))
  else console.warn(`capture ${id}: ${png} is missing; drawing a placeholder screen (see the bench README, "Screens")`)
  const cap = { id, img, meta, vw: meta.viewport.width, vh: meta.viewport.height }
  CAPTURES.set(id, cap)
  return cap
}

/**
 * An element of a capture: q = 'text' | { text, n (nth match, top to bottom), role, box } | { x, y, w, h } (CSS px)
 * | [q1, q2, …] (the box around all of them). Exact text beats prefix beats substring; controls beat loose text; the
 * smallest box wins a tie. box: true → the smallest card, button or field that contains the text.
 */
export function findEl(cap, q) {
  if (Array.isArray(q)) {
    const rs = q.map((x) => findEl(cap, x))
    const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y))
    const x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h))
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, text: rs.map((r) => r.text).join(' + '), radius: Math.max(...rs.map((r) => r.radius || 0)) }
  }
  if (q && typeof q === 'object' && 'x' in q && 'w' in q) return q
  if (q && typeof q === 'object' && q.box) {
    const e = findEl(cap, { ...q, box: false })
    const inside = (o) => o !== e && o.x <= e.x + 0.5 && o.y <= e.y + 0.5 && o.x + o.w >= e.x + e.w - 0.5 && o.y + o.h >= e.y + e.h - 0.5 && o.w * o.h > e.w * e.h * 1.15
    const boxes = cap.meta.elements.filter((o) => inside(o) && o.role !== 'text' && o.w < cap.vw - 1).sort((a, b) => a.w * a.h - b.w * b.h)
    return boxes[0] || e
  }
  const text = norm(typeof q === 'string' ? q : q.text)
  const hits = cap.meta.elements.filter((e) => norm(e.text).includes(text) && (!q.role || e.role === q.role))
  if (!hits.length) {
    if (!cap.img) return { x: cap.vw * 0.3, y: cap.vh * 0.3, w: cap.vw * 0.4, h: 60, text: '' }   // placeholder screen
    throw new Error(`"${typeof q === 'string' ? q : q.text}" is not on capture ${cap.id}; visible texts: ${cap.meta.elements.slice(0, 30).map((e) => e.text).join(' | ')}`)
  }
  const score = (e) => { const t = norm(e.text); return (t === text ? 0 : t.startsWith(text) ? 10 : 20) + (INTERACTIVE.test(e.role) ? 0 : 1) }
  if (typeof q === 'object' && q.n != null) {
    const best = Math.min(...hits.map(score))
    const cand = hits.filter((e) => score(e) === best).sort((a, b) => a.y - b.y || a.x - b.x)
    return cand[Math.min(q.n - 1, cand.length - 1)]
  }
  return hits.sort((a, b) => score(a) - score(b) || a.w * a.h - b.w * b.h)[0]
}

// ----------------------------------------------------------------------------- device geometry
/** Where the device sits (design px). o: { width (screen width), cy, frame: 'tablet' | 'browser' | 'none' } */
export function deviceGeom(film, cap, o = {}) {
  const sw = o.width ?? film.W * 0.815
  const k = sw / cap.vw; const sh = cap.vh * k
  const frame = o.frame || 'tablet'
  const bar = frame === 'browser' ? sw * 0.062 : 0
  const cy = o.cy ?? film.H * 0.505
  const left = film.W / 2 - sw / 2 + (o.dx || 0)
  const top = cy - (sh + bar) / 2 + bar
  return { sw, sh, k, left, top, bar, frame, cx: left + sw / 2, cy: top + sh / 2, bezel: frame === 'tablet' ? sw * 0.022 : 0 }
}

/** Element rect of a capture → design px of the unzoomed device. */
export function elRect(G, el, pad = 0) {
  return { x: G.left + (el.x - pad) * G.k, y: G.top + (el.y - pad) * G.k, w: (el.w + pad * 2) * G.k, h: (el.h + pad * 2) * G.k }
}

// ----------------------------------------------------------------------------- camera
// State: zoom z around the focus point (fx, fy) of the unzoomed layout, which lands on (tx, ty) of the frame.
const apply = (S, x, y) => [S.tx + S.z * (x - S.fx), S.ty + S.z * (y - S.fy)]
const mixState = (a, b, k) => ({ z: Math.exp(lerp(Math.log(a.z), Math.log(b.z), k)), fx: lerp(a.fx, b.fx, k), fy: lerp(a.fy, b.fy, k), tx: lerp(a.tx, b.tx, k), ty: lerp(a.ty, b.ty, k) })

/**
 * Camera of a screen section: a slow push-in for the whole section (so no screen ever sits still), plus a move
 * onto each focus target. focus items: { at, to, rect (design px), zoom }.
 */
export function makeCamera(film, G, { start, end, push = 0.055, focus = [] }) {
  const base = (t) => {
    const k = ease.inOutQuad(clamp((t - start) / Math.max(0.1, end - start)))
    const z = 1 + push * k
    return { z, fx: G.cx, fy: G.top + G.sh * 0.42, tx: G.cx, ty: G.top + G.sh * 0.42 - G.sh * 0.012 * k }
  }
  const target = (f) => {
    const r = f.rect; const ex = r.x + r.w / 2, ey = r.y + r.h / 2
    const z = f.zoom ?? Math.min(1.45, Math.max(1.12, (film.W * 0.7) / Math.max(r.w, 1)))
    let tx = lerp(ex, film.W / 2, 0.75)
    // A zoomed device wider than the frame keeps both edges outside it: no empty strip on either side.
    const lo = film.W - z * (G.left + G.sw - ex), hi = z * (ex - G.left)
    if (lo <= hi) tx = Math.min(Math.max(tx, lo), hi)
    return { z, fx: ex, fy: ey, tx, ty: lerp(ey, G.cy, 0.55) }
  }
  const keys = [{ t: start, s: 'base' }]
  focus.filter((f) => f.zoom !== 1).forEach((f, i, arr) => {
    const into = f.at - 0.5; const settle = f.at + 0.35
    const prev = keys[keys.length - 1]
    if (prev.t > into) prev.t = into - 0.01
    keys.push({ t: into, s: prev.s === 'base' ? 'base' : prev.s })
    keys.push({ t: settle, s: target(f) })
    keys.push({ t: Math.max(settle + 0.01, f.to), s: target(f) })
    const next = arr[i + 1]
    if (!next || next.at - 0.5 > f.to + 0.7) keys.push({ t: f.to + 0.65, s: 'base' })
  })
  keys.push({ t: end + 1, s: 'base' })
  return (t) => {
    let i = 0
    while (i < keys.length - 2 && t > keys[i + 1].t) i++
    const a = keys[i], b = keys[i + 1]
    const sa = a.s === 'base' ? base(t) : a.s, sb = b.s === 'base' ? base(t) : b.s
    const k = ease.inOutCubic(clamp((t - a.t) / Math.max(0.001, b.t - a.t)))
    return mixState(sa, sb, k)
  }
}

export function camTransform(c, S) { c.translate(S.tx, S.ty); c.scale(S.z, S.z); c.translate(-S.fx, -S.fy) }
export function camRect(S, r) { const [x0, y0] = apply(S, r.x, r.y); return { x: x0, y: y0, w: r.w * S.z, h: r.h * S.z } }

// ----------------------------------------------------------------------------- painting
export function paintCapture(c, cap, x, y, w, h, film) {
  if (cap.img) { c.drawImage(cap.img, x, y, w, h); return }
  // Designed placeholder: the run still shows where the screen goes and which capture it expects.
  const C = film.brand.colors
  c.fillStyle = C.surface; c.fillRect(x, y, w, h)
  c.fillStyle = rgba(C.ink, 0.04); for (let i = 0; i < 6; i++) { rr(c, x + w * 0.08, y + h * (0.12 + i * 0.12), w * (i % 2 ? 0.62 : 0.84), h * 0.06, 12); c.fill() }
  drawIcon(c, 'layout-dashboard', x + w / 2, y + h * 0.52, w * 0.14, { color: rgba(C.ink, 0.3), width: 1.6 })
  c.font = font(film.brand, 'mono', 500, w * 0.03); c.fillStyle = rgba(C.ink, 0.45); c.textAlign = 'center'; c.textBaseline = 'middle'
  c.fillText(`${cap.id}.png`, x + w / 2, y + h * 0.62)
}

/** Device body under the camera: frame, shadow and the screen content painted by `paint(c, x, y, w, h)`. */
export function drawDevice(c, film, G, S, paint, o = {}) {
  const C = film.brand.colors
  c.save(); camTransform(c, S); c.globalAlpha *= o.alpha ?? 1
  const b = G.bezel
  if (G.frame === 'tablet') {
    const R = G.sw * 0.055
    card(c, G.left - b, G.top - b, G.sw + 2 * b, G.sh + 2 * b, { r: R + b, fill: '#141418', shadow: 'rgba(16,16,24,0.26)', blur: 60, dy: 26 })
    c.save(); rr(c, G.left, G.top, G.sw, G.sh, R); c.clip(); paint(c, G.left, G.top, G.sw, G.sh); c.restore()
  } else if (G.frame === 'browser') {
    const R = film.brand.radius * 0.9
    card(c, G.left, G.top - G.bar, G.sw, G.sh + G.bar, { r: R, fill: C.surface, shadow: 'rgba(16,16,24,0.18)', blur: 56, dy: 22 })
    c.save(); rr(c, G.left, G.top - G.bar, G.sw, G.sh + G.bar, R); c.clip()
    c.fillStyle = '#ECECEF'; c.fillRect(G.left, G.top - G.bar, G.sw, G.bar)
    const pw = G.sw * 0.56, ph = G.bar * 0.58
    c.fillStyle = '#FFFFFF'; rr(c, G.cx - pw / 2, G.top - G.bar / 2 - ph / 2, pw, ph, ph / 2); c.fill()
    c.font = font(film.brand, 'body', 500, ph * 0.46); c.fillStyle = C.muted; c.textAlign = 'center'; c.textBaseline = 'middle'
    c.fillText(o.url || film.brand.url || '', G.cx, G.top - G.bar / 2 + 1)
    paint(c, G.left, G.top, G.sw, G.sh); c.restore()
  } else {
    card(c, G.left, G.top, G.sw, G.sh, { r: film.brand.radius, fill: C.surface })
    c.save(); rr(c, G.left, G.top, G.sw, G.sh, film.brand.radius); c.clip(); paint(c, G.left, G.top, G.sw, G.sh); c.restore()
  }
  c.restore()
}

// ----------------------------------------------------------------------------- highlights
/**
 * Draw one focus highlight in frame space. f: { at, to, kind: 'ring' | 'spot' | 'magnify', label, rect (design px),
 * pad } — rect is the element in the unzoomed layout; S is the camera at time t.
 */
export function drawFocus(c, film, G, S, f, t, cap) {
  if (t < f.at - 0.05 || t > f.to + 0.45) return
  const C = film.brand.colors
  const a = smoothstep(f.at - 0.05, f.at + 0.25, t) * (1 - smoothstep(f.to, f.to + 0.4, t))
  if (a <= 0) return
  const pad = (f.pad ?? 10) * S.z
  const R = camRect(S, f.rect)
  const x = R.x - pad, y = R.y - pad, w = R.w + pad * 2, h = R.h + pad * 2, rad = Math.min(h / 2, (f.radius ?? 14) * S.z + pad)
  c.save()
  let anchor = { x, y, w, h }   // what the label hangs from
  if (f.kind === 'spot') {
    const scr = camRect(S, { x: G.left, y: G.top, w: G.sw, h: G.sh })
    c.save(); rr(c, scr.x, scr.y, scr.w, scr.h, G.sw * 0.055 * S.z); c.clip()
    c.fillStyle = `rgba(14,14,20,${0.42 * a})`; c.beginPath(); c.rect(scr.x, scr.y, scr.w, scr.h); c.roundRect(x, y, w, h, rad); c.fill('evenodd')
    c.restore()
  }
  if (f.kind === 'magnify' && cap && cap.img) {
    const k = ease.outBack(clamp((t - f.at) / 0.42), 1.2) * (1 - ease.inCubic(clamp((t - f.to) / 0.35)))
    const el = f.el; const zoom = f.magnify || 3
    const dw = R.w / S.z * zoom * 1.1, dh = R.h / S.z * zoom * 1.1
    const tx = film.W / 2, ty = clamp(R.y + R.h / 2 + (R.y > film.H / 2 ? -1 : 1) * (dh * 0.9 + 60), film.H * 0.22, film.H * 0.8)
    const bx = lerp(R.x, tx - dw / 2, k), by = lerp(R.y, ty - dh / 2, k), bw = lerp(R.w, dw, k), bh = lerp(R.h, dh, k)
    card(c, bx - 14, by - 14, bw + 28, bh + 28, { r: 24, fill: C.surface, alpha: clamp(k * 3) })
    const dpr = cap.img.width / cap.vw
    c.save(); rr(c, bx, by, bw, bh, 14); c.clip(); c.globalAlpha *= clamp(k * 3)
    c.drawImage(cap.img, (el.x - 6) * dpr, (el.y - 6) * dpr, (el.w + 12) * dpr, (el.h + 12) * dpr, bx, by, bw, bh); c.restore()
    anchor = { x: bx - 14, y: by - 14, w: bw + 28, h: bh + 28 }
  } else {
    // A ring that draws itself around the element.
    const draw = ease.outCubic(clamp((t - f.at) / 0.45))
    const per = 2 * (w + h)
    c.globalAlpha = a; c.lineWidth = f.width ?? 6; c.strokeStyle = f.color || C.accent; c.lineCap = 'round'
    c.setLineDash([per * draw, per + 10]); c.lineDashOffset = -per * 0.12
    rr(c, x, y, w, h, rad); c.stroke(); c.setLineDash([])
  }
  if (f.label) {
    const la = ease.outCubic(clamp((t - f.at - 0.2) / 0.3)) * (1 - clamp((t - f.to) / 0.3))
    if (la > 0) {
      const size = f.labelSize ?? film.W * 0.033
      c.font = font(film.brand, 'display', 700, size); const tw = c.measureText(f.label).width
      const lw = tw + size * 1.4, lh = size * 1.9
      const A = anchor
      const below = A.y + A.h / 2 < film.H * 0.55
      const lx = clamp(A.x + A.w / 2, lw / 2 + 40, film.W - lw / 2 - 40)
      const ly = below ? A.y + A.h + lh / 2 + 18 : A.y - lh / 2 - 18
      c.globalAlpha = la
      card(c, lx - lw / 2, ly - lh / 2 + (1 - la) * 12, lw, lh, { r: lh / 2, fill: C.ink, shadow: 'rgba(16,16,24,0.22)', blur: 24, dy: 8 })
      c.fillStyle = '#FFFFFF'; c.textAlign = 'center'; c.textBaseline = 'middle'
      c.fillText(f.label, lx, ly + (1 - la) * 12 + 1)
    }
  }
  c.restore()
}
