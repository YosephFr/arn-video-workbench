'use strict';
// The voice timeline drives every visual cue. Films never hard-code seconds: they ask for a line, L('L03'), or a
// word, W('L03', 'save'), and re-recording a voice re-times the whole film.
//
// Reads <piece>/timeline.json (written by `core/bin/wb timeline`). Until it exists, the timing is estimated from
// script.json with the same speaking rate as the `silent` voice provider, so stills render on day one.
const fs = require('fs');
const path = require('path');

const clean = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9$%]/g, '');
const CHARS_PER_SECOND = 14.5;

// Words of a script line as they will be spoken: [direction] hints removed, *emphasis* marked.
function spokenWords(text) {
  const plain = String(text).replace(/\[[^\]]*\]/g, ' ');
  const out = []; let hot = false;
  for (const raw of plain.split(/\s+/).filter(Boolean)) {
    const opens = raw.startsWith('*'); if (opens) hot = true;
    const word = raw.replace(/\*/g, '');
    if (word) out.push({ text: word, emphasis: hot });
    if (raw.endsWith('*') || raw.replace(/[.,;:!?…]+$/, '').endsWith('*')) hot = false;
  }
  return out;
}

function estimate(pieceDir) {
  const script = JSON.parse(fs.readFileSync(path.join(pieceDir, 'script.json'), 'utf8'));
  const placed = {}; const lines = [];
  for (const line of script.lines || []) {
    const words = spokenWords(line.text); const chars = words.map((w) => w.text).join(' ').length;
    const dur = 0.35 + chars / (CHARS_PER_SECOND * (line.speed || 1));
    let start = 0;
    if (line.start != null) start = line.start;
    else if (line.after) start = placed[line.after].end + (line.gap ?? 0.3);
    else if (line.with) start = placed[line.with].start + (line.offset ?? 0);
    const weights = words.map((w) => Math.max(1, clean(w.text).length) + (/[,;:]$/.test(w.text) ? 2.5 : /[.!?…]$/.test(w.text) ? 4 : 0.6));
    const unit = Math.max(0.2, dur - 0.27) / weights.reduce((a, b) => a + b, 0);
    let t = start + 0.12;
    const ws = words.map((w, i) => { const speak = (Math.max(1, clean(w.text).length) + 0.6) * unit; const o = { text: w.text, start: +t.toFixed(3), end: +(t + speak).toFixed(3), emphasis: w.emphasis }; t += weights[i] * unit; return o; });
    const end = ws.length ? ws[ws.length - 1].end : start + dur;
    placed[line.id] = { start, end };
    lines.push({ id: line.id, voice: line.voice, text: words.map((w) => w.text).join(' '), start: +start.toFixed(3), end: +end.toFixed(3), effect: line.effect || null, caption: line.caption !== false, words: ws });
  }
  const last = Math.max(0, ...lines.map((l) => l.end));
  return { duration: +(last + (script.tail ?? 2.5)).toFixed(3), last_end: +last.toFixed(3), fps: (script.format && script.format.fps) || 30, lines, estimated: true };
}

const cache = new Map();
function loadTimeline(pieceDir) {
  const dir = path.resolve(pieceDir);
  if (cache.has(dir)) return cache.get(dir);
  const file = path.join(dir, 'timeline.json');
  let tl;
  if (fs.existsSync(file)) tl = JSON.parse(fs.readFileSync(file, 'utf8'));
  else {
    tl = estimate(dir);
    if (!process.env.WB_QUIET) console.warn(`timeline: ${path.basename(dir)}/timeline.json not found, timing estimated from script.json (run core/bin/wb voice + timeline)`);
  }
  for (const l of tl.lines) {
    l.words = (l.words || []).map((w) => ({ ...w, w: w.text ?? w.w, text: w.text ?? w.w, hot: !!(w.emphasis ?? w.hot) }));
    if (l.caption === undefined) l.caption = true;
  }
  tl.lastEnd = tl.last_end ?? Math.max(0, ...tl.lines.map((l) => l.end));
  const byId = Object.fromEntries(tl.lines.map((l) => [l.id, l]));
  const L = (id) => { const l = byId[id]; if (!l) throw new Error(`line ${id} is not in the timeline (${Object.keys(byId).join(', ')})`); return l; };
  // A word by prefix, ignoring case, accents and punctuation: W('L03', 'save') or the second match W('L03', 'the', 1).
  const W = (id, word, n = 0) => {
    const l = L(id); const q = clean(word); let k = 0;
    for (const x of l.words) if (clean(x.text).startsWith(q)) { if (k === n) return x; k++; }
    throw new Error(`word "${word}" (#${n}) is not in ${id}: ${l.words.map((x) => x.text).join(' ')}`);
  };
  const Wi = (id, i) => { const l = L(id); const x = l.words[i < 0 ? l.words.length + i : i]; if (!x) throw new Error(`word index ${i} is out of ${id}`); return x; };
  const api = { tl, L, W, Wi, clean, duration: tl.duration, lastEnd: tl.lastEnd, ids: tl.lines.map((l) => l.id), estimated: !!tl.estimated };
  cache.set(dir, api);
  return api;
}

module.exports = { loadTimeline, estimate, spokenWords, clean };
