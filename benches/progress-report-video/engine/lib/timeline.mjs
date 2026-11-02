// The voice timeline drives every visual cue. Nothing in a film is placed in hard-coded seconds: cues are anchors
// into timeline.json, so a re-recorded voice re-times the whole film.
//
// Anchor syntax (strings), used everywhere a time is expected:
//   'L03'              start of line L03                'L03:end'        end of line L03
//   'L03:export'       start of the first word starting with "export" (case and accents ignored)
//   'L03:export#2'     the second such word             'L03:export:end' end of that word
//   'L03:export+0.4'   any anchor plus or minus seconds 'end'            end of the piece (duration)
//   numbers are absolute seconds.
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')

export function loadTimeline(pieceDir) {
  const file = join(pieceDir, 'timeline.json')
  if (!existsSync(file)) {
    throw new Error(`${file} is missing. Make it with:\n  WB_TTS_PROVIDER=silent core/bin/wb voice ${pieceDir} && core/bin/wb timeline ${pieceDir}\n(silent voices need no keys; replace them with real takes later)`)
  }
  const tl = JSON.parse(readFileSync(file, 'utf8'))
  tl.byId = Object.fromEntries(tl.lines.map((l) => [l.id, l]))
  tl.last_end = tl.last_end ?? Math.max(0, ...tl.lines.map((l) => l.end))
  return tl
}

export function makeAnchors(tl) {
  const L = (id) => {
    const line = tl.byId[id]
    if (!line) throw new Error(`unknown line "${id}" (lines: ${tl.lines.map((l) => l.id).join(', ')})`)
    return line
  }
  const W = (id, word, n = 0) => {
    const line = L(id); const w = norm(word); let k = 0
    for (const x of line.words) if (norm(x.text).startsWith(w)) { if (k === n) return x; k++ }
    throw new Error(`word "${word}" is not in ${id}: ${line.words.map((x) => x.text).join(' ')}`)
  }
  const Wi = (id, i) => {
    const line = L(id); const x = line.words[i < 0 ? line.words.length + i : i]
    if (!x) throw new Error(`word index ${i} is outside ${id}`)
    return x
  }
  const at = (ref, fallback) => {
    if (ref === undefined || ref === null) {
      if (fallback === undefined) throw new Error('missing anchor')
      return fallback
    }
    if (typeof ref === 'number') return ref
    let s = String(ref).trim(); let offset = 0
    const m = s.match(/([+-]\d+(?:\.\d+)?)$/)
    if (m && !/^[+-]?\d+(\.\d+)?$/.test(s)) { offset = parseFloat(m[1]); s = s.slice(0, -m[1].length) }
    if (/^[+-]?\d+(\.\d+)?$/.test(s)) return parseFloat(s) + offset
    if (s === 'end') return tl.duration + offset
    if (s === 'last') return tl.last_end + offset
    const parts = s.split(':')
    const id = parts[0]
    if (parts.length === 1) return L(id).start + offset
    if (parts[1] === 'end' && parts.length === 2) return L(id).end + offset
    let [word, nth] = parts[1].split('#')
    const edge = parts[2] === 'end' ? 'end' : 'start'
    return W(id, word, nth ? parseInt(nth, 10) - 1 : 0)[edge] + offset
  }
  return { L, W, Wi, at, duration: tl.duration, lastEnd: tl.last_end, lines: tl.lines }
}
