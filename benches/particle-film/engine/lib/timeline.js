'use strict';
// The voice timeline drives the whole film: every visual beat is anchored to a spoken word, so a re-recorded
// voice re-times camera moves, morphs, captions and the end card without touching the scene code.
//
//   L('L02')              → line { id, start, end, words, ... }
//   W('L02', 'eight')     → first word starting with "eight" (accents and case ignored); W(id, word, n) = n-th
//   Wi('L02', -1)         → word by index (negative counts from the end)
//
// The piece folder comes from WB_PIECE (set by the renderer in the main process and in every worker).
// timeline.json is written by `core/bin/wb timeline`. If it is missing, timings are estimated from
// script.json with the same speaking rate as the `silent` voice provider, so a film can be blocked out
// before any voice exists.

const fs = require('fs');
const path = require('path');

const CHARS_PER_SECOND = 14.5;   // keep in step with core/python/workbench/voice.py
let TL = null;

const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const spoken = (text) => String(text).replace(/\[[^\]]*\]/g, ' ').replace(/\*/g, '').replace(/\s+/g, ' ').trim();

// [(word, emphasised)] for the visible words; one *emphasis* may span several words.
function tokens(text) {
  const out = []; let inside = false;
  for (const tok of String(text).replace(/\[[^\]]*\]/g, ' ').split(/\s+/)) {
    if (!tok) continue;
    const stars = (tok.match(/\*/g) || []).length; const hot = inside || stars > 0;
    if (stars % 2 === 1) inside = !inside;
    const w = tok.replace(/\*/g, ''); if (w) out.push([w, hot]);
  }
  return out;
}

function estimateWords(text, duration, lead = 0.12, tail = 0.15) {
  const toks = tokens(text); if (!toks.length) return [];
  const weight = (w) => Math.max(1, norm(w).length) + (/[,;:]$/.test(w) ? 2.5 : /[.!?…]$/.test(w) ? 4 : 0.6);
  const unit = Math.max(0.2, duration - lead - tail) / toks.reduce((a, [w]) => a + weight(w), 0);
  const out = []; let t = lead;
  for (const [w, hot] of toks) {
    const speak = (Math.max(1, norm(w).length) + 0.6) * unit;
    out.push({ text: w, start: t, end: t + speak, emphasis: hot });
    t += weight(w) * unit;
  }
  return out;
}

// Lay lines out like `wb timeline` does: start | after + gap | with + offset.
function estimate(script) {
  const byId = {}; const lines = [];
  const voices = script.voices || {};
  for (const l of script.lines || []) {
    const speed = l.speed || (voices[l.voice] && voices[l.voice].speed) || 1;
    const dur = 0.35 + spoken(l.text).length / (CHARS_PER_SECOND * speed);
    let start = 0;
    if (l.start !== undefined) start = l.start;
    else if (l.after) start = byId[l.after].end + (l.gap || 0);
    else if (l.with) start = byId[l.with].start + (l.offset || 0);
    else if (lines.length) start = lines[lines.length - 1].end + 0.25;
    const words = estimateWords(l.text, dur).map((w) => ({ ...w, start: +(start + w.start).toFixed(3), end: +(start + w.end).toFixed(3) }));
    const line = { id: l.id, voice: l.voice, text: spoken(l.text), start: +start.toFixed(3), end: +(start + dur).toFixed(3), audio: null, effect: l.effect || null, caption: l.caption !== false, words, estimated: true };
    byId[l.id] = line; lines.push(line);
  }
  const lastEnd = lines.reduce((m, l) => Math.max(m, l.end), 0);
  return { duration: +(lastEnd + (script.tail ?? 2.5)).toFixed(3), fps: (script.format || {}).fps || 60, lines, estimated: true };
}

function pieceDir() {
  const d = process.env.WB_PIECE; if (!d) throw new Error('WB_PIECE is not set (the renderer sets it to the piece folder)');
  return d;
}

function load() {
  if (TL) return TL;
  const dir = pieceDir();
  const file = path.join(dir, 'timeline.json');
  const script = JSON.parse(fs.readFileSync(path.join(dir, 'script.json'), 'utf8'));
  if (fs.existsSync(file)) TL = JSON.parse(fs.readFileSync(file, 'utf8'));
  else {
    TL = estimate(script);
    if (!process.env.WB_QUIET_TIMELINE) { process.env.WB_QUIET_TIMELINE = '1'; console.warn('timeline: no timeline.json yet; using estimated word timings (run core/bin/wb voice + timeline).'); }
  }
  // Normalise: older timelines used `w` for the word text; emphasis may be missing.
  const scriptLines = Object.fromEntries((script.lines || []).map((l) => [l.id, l]));
  for (const l of TL.lines) {
    l.words = (l.words || []).map((w) => ({ text: w.text ?? w.w, start: w.start, end: w.end, emphasis: !!(w.emphasis ?? w.hot) }));
    if (l.caption === undefined) l.caption = scriptLines[l.id] ? scriptLines[l.id].caption !== false : true;
  }
  TL.byId = Object.fromEntries(TL.lines.map((l) => [l.id, l]));
  TL.lastEnd = TL.lines.reduce((m, l) => Math.max(m, l.end), 0);
  TL.script = script;
  return TL;
}

function L(id) { const l = load().byId[id]; if (!l) throw new Error(`timeline: no line ${id} (lines: ${load().lines.map((x) => x.id).join(', ')})`); return l; }
function W(id, word, n = 0) {
  const l = L(id); const w = norm(word); let k = 0;
  for (const x of l.words) if (norm(x.text).startsWith(w)) { if (k === n) return x; k++; }
  throw new Error(`timeline: word "${word}" not in ${id}: ${l.words.map((x) => x.text).join(' ')}`);
}
function Wi(id, i) { const l = L(id); const x = l.words[i < 0 ? l.words.length + i : i]; if (!x) throw new Error(`timeline: index ${i} out of ${id}`); return x; }
// The n-th *emphasised* word of a line (falls back to the last word). Anchoring a beat to the word the script
// marks keeps it right when the line is rewritten: move the asterisks and the visual follows.
function Hot(id, n = 0) { const l = L(id); const hot = l.words.filter((w) => w.emphasis); return hot[Math.min(n, hot.length - 1)] || l.words[l.words.length - 1]; }
// Time at a fraction of a line (0 = first word, 1 = end of the last word).
function along(id, k) { const l = L(id); const a = l.words.length ? l.words[0].start : l.start, b = l.words.length ? l.words[l.words.length - 1].end : l.end; return a + (b - a) * k; }

// Loudness envelope of a line at 50 Hz (0..1): from the line's WAV when it has sound, otherwise synthesised
// from the word timings (so voice-note waveforms still move with the speech of a silent draft).
const ENV = {};
function envelope(id) {
  if (ENV[id]) return ENV[id];
  const l = L(id); const n = Math.max(1, Math.round((l.end - l.start) * 50));
  let env = l.env || null;
  if (!env && l.audio) {
    const file = path.join(pieceDir(), l.audio);
    if (fs.existsSync(file)) env = wavEnvelope(file, n);
  }
  if (!env || Math.max(...env) < 0.01) {
    env = [];
    for (let i = 0; i < n; i++) {
      const t = l.start + (i + 0.5) / 50; const inWord = l.words.some((w) => t >= w.start && t <= w.end);
      const wob = 0.5 + 0.5 * Math.sin(i * 0.9 + l.id.length) * Math.sin(i * 0.37 + 1.3);
      env.push(inWord ? 0.3 + 0.7 * wob : 0.06);
    }
  }
  ENV[id] = env;
  return env;
}

// Minimal RIFF reader (PCM 16/24/32-bit or float32), RMS per window, normalised to the loudest window.
function wavEnvelope(file, n) {
  try {
    const b = fs.readFileSync(file); if (b.toString('ascii', 0, 4) !== 'RIFF') return null;
    let p = 12, fmt = null, data = null;
    while (p + 8 <= b.length) {
      const id = b.toString('ascii', p, p + 4), size = b.readUInt32LE(p + 4);
      if (id === 'fmt ') fmt = { tag: b.readUInt16LE(p + 8), ch: b.readUInt16LE(p + 10), bits: b.readUInt16LE(p + 22) };
      if (id === 'data') { data = [p + 8, Math.min(b.length, p + 8 + size)]; break; }
      p += 8 + size + (size & 1);
    }
    if (!fmt || !data) return null;
    const bps = fmt.bits / 8, frame = bps * fmt.ch; const count = Math.floor((data[1] - data[0]) / frame);
    const read = (o) => (fmt.tag === 3 ? b.readFloatLE(o) : bps === 2 ? b.readInt16LE(o) / 32768 : bps === 3 ? b.readIntLE(o, 3) / 8388608 : b.readInt32LE(o) / 2147483648);
    const out = []; let mx = 1e-9;
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * count / n), z = Math.max(a + 1, Math.floor((i + 1) * count / n)); let s = 0;
      for (let k = a; k < z; k += 4) { const v = read(data[0] + k * frame); s += v * v; }
      const r = Math.sqrt(s / Math.max(1, (z - a) / 4)); out.push(r); if (r > mx) mx = r;
    }
    return out.map((v) => v / mx);
  } catch (e) { return null; }
}

module.exports = {
  L, W, Wi, Hot, along, envelope, norm, tokens, spoken, estimate,
  get tl() { return load(); },
  get lines() { return load().lines; },
  get ids() { return load().lines.map((l) => l.id); },
  get duration() { return load().duration; },
  get lastEnd() { return load().lastEnd; },
  get estimated() { return !!load().estimated; },
};
