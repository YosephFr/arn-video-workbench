// Captions for muted viewing: the narration in short chunks, word by word on the timeline's word marks. The word
// being said carries a soft accent marker that glides from word to word; *emphasis* words stay in the accent colour.
import { clamp, ease, lerp } from './math.mjs'
import { font } from './brand.mjs'
import { rr, wrap } from './draw.mjs'

function chunks(tl, cfg) {
  const items = []
  for (const line of tl.lines) {
    if (line.caption === false || (cfg.skip && cfg.skip.includes(line.id))) continue
    let cur = []
    const flush = () => { if (cur.length) items.push({ line: line.id, words: cur, t0: cur[0].start - 0.08, end: cur[cur.length - 1].end }); cur = [] }
    const max = cfg.maxWords || 7
    const WEAK = /^(a|an|the|as|of|to|in|on|at|by|for|from|with|and|or|but|is|are|was|were)$/i
    line.words.forEach((w, i) => {
      cur.push(w)
      const strong = /[.!?…:]$/.test(w.text)
      const soft = /[,;]$/.test(w.text) && cur.length >= 4
      // Words left before the next strong stop: never leave one or two of them alone in a chunk of their own.
      let rest = 0
      for (let j = i + 1; j < line.words.length; j++) { rest++; if (/[.!?…:]$/.test(line.words[j].text)) break }
      const full = cur.length >= max && !(rest > 0 && rest <= 2 && cur.length < max + 2)
      if (full && !strong && !soft && i < line.words.length - 1) {
        // Break before trailing small words ("…downloaded | as a spreadsheet"), not after them.
        const carry = []
        while (cur.length > 3 && WEAK.test(cur[cur.length - 1].text)) carry.unshift(cur.pop())
        flush(); cur = carry
        return
      }
      if (strong || soft || full || i === line.words.length - 1) flush()
    })
  }
  const hold = cfg.hold ?? 0.6
  items.forEach((it, k) => { const next = items[k + 1]; it.t1 = next ? Math.min(next.t0, it.end + hold) : it.end + hold })
  return items
}

export function makeCaptions(film, cfg = {}) {
  if (cfg === false) return () => {}
  const { brand, W, H } = film
  const C = brand.colors
  let items = null
  const layouts = new Map()
  const size0 = cfg.size || Math.round(W * 0.05)
  const maxW = cfg.maxW || W * 0.84
  return function draw(c, t) {
    if (!items) items = chunks(film.tl, cfg)
    let it = null
    for (let i = items.length - 1; i >= 0; i--) if (t >= items[i].t0) { it = items[i]; break }   // the newest chunk wins
    if (!it || t >= it.t1 + 0.14) return
    let lay = layouts.get(it)
    if (!lay) {
      c.save()
      let size = size0, rows
      for (;;) {
        c.font = font(brand, 'display', 700, size)
        rows = wrap(c, it.words.map((w) => w.text).join(' '), maxW)
        if (rows.length <= 2 || size <= size0 * 0.75) break
        size -= 2
      }
      // Position of every word (rows are re-split on the same words).
      const sp = c.measureText(' ').width; const lh = size * 1.28; const pos = []; let wi = 0
      rows.forEach((row, ri) => {
        const ws = row.split(' '); const rw = c.measureText(row).width; let x = W / 2 - rw / 2
        for (const s of ws) { const w = c.measureText(s).width; pos.push({ x, w, ri, word: it.words[wi++] }); x += w + sp }
      })
      c.restore()
      lay = { size, rows, lh, pos, width: Math.max(...rows.map((r) => { c.font = font(brand, 'display', 700, size); return c.measureText(r).width })) }
      layouts.set(it, lay)
    }
    const yC = cfg.y ?? H - H * 0.1
    const y0 = yC - ((lay.rows.length - 1) * lay.lh) / 2
    const out = 1 - clamp((t - it.t1) / 0.14)
    const inA = clamp((t - it.t0) / 0.12)
    c.save()
    // A soft surface behind the chunk keeps it readable over screens and backgrounds alike.
    const padX = lay.size * 0.55, padY = lay.size * 0.36
    c.globalAlpha = 0.9 * out * inA; c.fillStyle = C.surface
    rr(c, W / 2 - lay.width / 2 - padX, y0 - lay.size * 0.62 - padY, lay.width + padX * 2, (lay.rows.length - 1) * lay.lh + lay.size * 1.24 + padY * 2, (lay.size * 1.24 + padY * 2) / 2)
    c.fill()
    // The marker glides to the word being said.
    let cur = -1
    lay.pos.forEach((p, i) => { if (t >= p.word.start - 0.02) cur = i })
    if (cur >= 0) {
      const p = lay.pos[cur]; const prev = lay.pos[Math.max(0, cur - 1)]
      const k = ease.outCubic(clamp((t - p.word.start + 0.02) / 0.12))
      const same = prev.ri === p.ri
      const mx = same ? lerp(prev.x, p.x, k) : p.x, mw = same ? lerp(prev.w, p.w, k) : p.w
      const live = 1 - clamp((t - p.word.end - 0.25) / 0.2)
      c.globalAlpha = 0.16 * out * live; c.fillStyle = C.accent
      rr(c, mx - lay.size * 0.16, y0 + p.ri * lay.lh - lay.size * 0.6, mw + lay.size * 0.32, lay.size * 1.2, lay.size * 0.3); c.fill()
    }
    c.font = font(brand, 'display', 700, lay.size); c.textBaseline = 'middle'; c.textAlign = 'left'
    // Karaoke: the whole chunk is there from its start in a quiet tone; each word turns to ink as it is said.
    lay.pos.forEach((p, i) => {
      const said = ease.outCubic(clamp((t - (p.word.start - 0.05)) / 0.14))
      const live = i === cur && t < p.word.end + 0.25
      const y = y0 + p.ri * lay.lh
      c.globalAlpha = out * inA
      c.fillStyle = C.muted; c.globalAlpha *= 0.55 * (1 - said); if (c.globalAlpha > 0.003) c.fillText(p.word.text, p.x, y)
      if (said > 0) { c.globalAlpha = out * inA * said; c.fillStyle = p.word.emphasis || live ? C.accent : C.ink; c.fillText(p.word.text, p.x, y) }
    })
    c.restore()
  }
}

