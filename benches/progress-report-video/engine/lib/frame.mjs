// Per-process frame context. Scenes draw in design space (script.format width × height, e.g. 1080 × 1920);
// `scale` maps design pixels to output pixels (0.5 for previews). Two offscreen layers let a transition draw the
// outgoing and the incoming section separately and composite them through a mask.
import { createCanvas } from '@napi-rs/canvas'
import { hash, rng } from './math.mjs'

function grainTiles(size = 256, count = 6, seed = 9) {
  const tiles = []
  for (let k = 0; k < count; k++) {
    const cv = createCanvas(size, size); const c = cv.getContext('2d')
    const img = c.createImageData(size, size); const d = img.data; const r = rng(seed + k * 101)
    for (let i = 0; i < size * size; i++) {
      const v = 128 + (r() + r() + r() - 1.5) * 0.8 * 110
      d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 255
    }
    c.putImageData(img, 0, 0); tiles.push(cv)
  }
  return tiles
}

export class Frame {
  constructor({ width, height, scale = 1, fps = 60 }) {
    this.W = width; this.H = height; this.s = scale; this.fps = fps
    this.PW = Math.round(width * scale); this.PH = Math.round(height * scale)
    this.canvas = createCanvas(this.PW, this.PH); this.ctx = this.canvas.getContext('2d')
    this.layers = [0, 1, 2].map(() => { const cv = createCanvas(this.PW, this.PH); return { cv, c: cv.getContext('2d') } })
    this.grain = null; this.vignettes = new Map()
    this.t = 0
  }
  begin(t) {
    this.t = t
    const c = this.ctx
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.filter = 'none'
    c.clearRect(0, 0, this.PW, this.PH)
    this.design(c)
  }
  /** Put a context in design space. */
  design(c) { c.setTransform(this.s, 0, 0, this.s, 0, 0) }
  /** A cleared offscreen layer in design space. */
  layer(i) {
    const L = this.layers[i]; const c = L.c
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.filter = 'none'
    c.clearRect(0, 0, this.PW, this.PH); this.design(c)
    return L
  }
  /** Draw a layer onto a context at output resolution. */
  blit(dst, L, alpha = 1, op = 'source-over') {
    dst.save(); dst.setTransform(1, 0, 0, 1, 0, 0); dst.globalAlpha = alpha; dst.globalCompositeOperation = op
    dst.drawImage(L.cv, 0, 0); dst.restore()
  }
  // Finishing: a faint film grain that changes 12 times a second and a neutral vignette. Both are kept low on
  // purpose: they take the digital edge off flat UI without making screenshots look dirty.
  finish({ grain = 0.022, vignette = 0.07, grainFps = 12 } = {}) {
    const c = this.ctx
    if (vignette > 0) {
      let v = this.vignettes.get(vignette)
      if (!v) {
        v = createCanvas(this.PW, this.PH); const g = v.getContext('2d'); const { PW, PH } = this
        const grad = g.createRadialGradient(PW / 2, PH * 0.48, Math.min(PW, PH) * 0.3, PW / 2, PH * 0.5, Math.hypot(PW, PH) * 0.56)
        grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, `rgba(0,0,0,${vignette})`)
        g.fillStyle = grad; g.fillRect(0, 0, PW, PH); this.vignettes.set(vignette, v)
      }
      c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(v, 0, 0); c.restore()
    }
    if (grain > 0) {
      if (!this.grain) this.grain = grainTiles()
      const fi = Math.floor(this.t * grainFps)
      const tile = this.grain[fi % this.grain.length]
      const ox = Math.floor(hash(fi * 7 + 1) * 256), oy = Math.floor(hash(fi * 13 + 5) * 256)
      c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'overlay'; c.globalAlpha = grain
      c.fillStyle = c.createPattern(tile, 'repeat'); c.translate(-ox, -oy); c.fillRect(ox, oy, this.PW, this.PH)
      c.restore()
    }
  }
}
