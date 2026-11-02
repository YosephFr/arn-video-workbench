// Transitions borrowed from the brand mark, so every cut repeats the logo:
//   iris        the next section opens through the mark's silhouette, growing from where the mark sits
//   iris-close  the section shrinks into the mark, which lands where the closing lockup starts
//   sweep       a clock-hand wipe around the frame centre (the mark's own resolve, at frame scale)
//   tile        a brand-colour panel with the glyph cut out crosses the frame and leaves the next section behind
//   fade, cut
// p runs 0 → 1 over the transition window; drawA / drawB paint the outgoing / incoming section into a context.
import { clamp, ease, lerp, TAU } from './math.mjs'
import { drawGlyph, drawMark, drawSilhouette } from './logo.mjs'

export const TRANSITIONS = ['iris', 'iris-close', 'sweep', 'tile', 'fade', 'cut']

function markBox(logo, cx, cy, h) { const w = h / logo.mark.aspect; return { x: cx - w / 2, y: cy - h / 2, w, h } }

export function drawTransition(film, frame, tr, p, drawA, drawB) {
  const { W, H, logo } = film
  const C = film.brand.colors
  const main = frame.ctx
  const type = tr.type
  if (type === 'cut') { (p < 0.5 ? drawA : drawB)(main); return }

  if (type === 'fade') {
    const A = frame.layer(0); drawA(A.c); frame.blit(main, A)
    const B = frame.layer(1); drawB(B.c); frame.blit(main, B, ease.inOutCubic(p))
    return
  }

  if (type === 'iris' || type === 'iris-close') {
    const open = type === 'iris'
    // Mark centre and size where the shape starts (iris) or ends (iris-close); defaults to the frame centre.
    const r = tr.rect || { x: W / 2 - W * 0.06, y: H / 2 - W * 0.06, w: W * 0.12, h: W * 0.12 }
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2
    const cover = 2.6 * Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy))
    const e = open ? ease.inOutCubic(p) : ease.inOutCubic(1 - p)   // how open the shape is
    const size = Math.exp(lerp(Math.log(r.h), Math.log(cover), e))
    const outside = open ? drawA : drawB, inside = open ? drawB : drawA
    // The world outside the shape recedes a little while the inside settles in.
    const O = frame.layer(0)
    O.c.save(); O.c.translate(W / 2, H / 2); const so = open ? 1 + 0.06 * ease.inCubic(p) : 1 + 0.06 * ease.inCubic(1 - p); O.c.scale(so, so); O.c.translate(-W / 2, -H / 2)
    outside(O.c); O.c.restore()
    frame.blit(main, O)
    // Inside the shape: the tile colour first (so the shape reads even over a matching background), the glyph
    // while the shape is still small, and the other section fading in as it grows (out, for the close).
    const I = frame.layer(1)
    const b = markBox(logo, cx, cy, size)
    I.c.fillStyle = (logo.mark.tile && logo.mark.tile.fill) || C.accent; I.c.fillRect(-W, -H, W * 3, H * 3)
    const glyphA = open ? 1 - clamp((p - 0.15) / 0.25) : 0
    if (glyphA > 0) { I.c.save(); I.c.globalAlpha = glyphA; if (logo.mark.tile) drawGlyph(I.c, logo, b.x, b.y, b.w); else drawMark(I.c, logo, b.x, b.y, b.w); I.c.restore() }
    const show = open ? ease.inOutCubic(clamp((p - 0.3) / 0.5)) : 1 - ease.inOutCubic(clamp((p - 0.1) / 0.55))
    if (show > 0) {
      I.c.save(); I.c.globalAlpha = show
      I.c.translate(cx, cy); const si = open ? lerp(1.1, 1, ease.outCubic(p)) : lerp(1, 0.86, ease.inCubic(p)); I.c.scale(si, si); I.c.translate(-cx, -cy)
      inside(I.c); I.c.restore()
    }
    const M = frame.layer(2)
    drawSilhouette(M.c, logo, b.x, b.y, b.w, '#000')
    // A disc catches up late so marks with holes (rings, letters) still cover the whole frame.
    const disc = open ? ease.inCubic(clamp((p - 0.5) / 0.5)) : ease.inCubic(clamp((0.5 - p) / 0.5))
    if (disc > 0) { M.c.beginPath(); M.c.arc(cx, cy, disc * Math.hypot(W, H), 0, TAU); M.c.fillStyle = '#000'; M.c.fill() }
    I.c.save(); I.c.setTransform(1, 0, 0, 1, 0, 0); I.c.globalCompositeOperation = 'destination-in'; I.c.drawImage(M.cv, 0, 0); I.c.restore()
    frame.blit(main, I)
    return
  }

  if (type === 'sweep') {
    const A = frame.layer(0); drawA(A.c); frame.blit(main, A)
    const e = ease.inOutCubic(p)
    const cx = W / 2, cy = H / 2, R = Math.hypot(W, H)
    const a0 = -Math.PI / 2, a1 = a0 + TAU * e
    const B = frame.layer(1)
    B.c.save(); B.c.beginPath(); B.c.moveTo(cx, cy); B.c.arc(cx, cy, R, a0, a1, false); B.c.closePath(); B.c.clip(); drawB(B.c); B.c.restore()
    frame.blit(main, B)
    if (e > 0.001 && e < 0.999) {
      // The hand: a soft accent edge on the leading side of the wipe.
      main.save(); frame.design(main)
      main.strokeStyle = C.accent; main.lineCap = 'round'
      for (const [wdt, al] of [[26, 0.12], [9, 0.9]]) {
        main.globalAlpha = al * Math.sin(Math.PI * e); main.lineWidth = wdt
        main.beginPath(); main.moveTo(cx, cy); main.lineTo(cx + Math.cos(a1) * R, cy + Math.sin(a1) * R); main.stroke()
      }
      main.globalAlpha = Math.sin(Math.PI * e); main.fillStyle = C.accent; main.beginPath(); main.arc(cx, cy, 14, 0, TAU); main.fill()
      main.restore()
    }
    return
  }

  if (type === 'tile') {
    const base = frame.layer(0); (p < 0.5 ? drawA : drawB)(base.c); frame.blit(main, base)
    const e = ease.inOutCubic(p)
    const x = lerp(W * 1.02, -W * 1.02, e)
    const P = frame.layer(1)
    const k = clamp(1 - Math.abs(p - 0.5) * 2)   // the glyph grows while the panel covers the frame
    P.c.fillStyle = C.accent; P.c.beginPath(); P.c.roundRect(x, -10, W, H + 20, film.brand.radius * 2); P.c.fill()
    const gh = W * lerp(0.2, 0.34, ease.outCubic(k))
    const g = markBox(logo, x + W / 2, H / 2, gh)
    P.c.save(); P.c.globalCompositeOperation = 'destination-out'; drawGlyph(P.c, logo, g.x, g.y, g.w, '#000'); P.c.restore()
    frame.blit(main, P)
    return
  }
  throw new Error(`unknown transition "${type}" (use ${TRANSITIONS.join(', ')})`)
}
