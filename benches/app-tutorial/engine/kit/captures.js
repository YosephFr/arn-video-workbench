'use strict';
// App captures: <name>.png (the viewport at 3x) and <name>.json (the measured rectangles of what is on screen),
// written by tools/capture.mjs. Films point at elements by what they say or by the name given to a selector, never
// by pixel positions, so a redesigned app only needs a new capture.
//
// A capture id is a path without extension relative to a captures folder: 'reminders/03-reminders'.
// Sequences: 'reminders/05-message.type' is every 05-message.type-NN.png in order (typing), '.anim' the frames of an
// animation. Folders searched, in order: WB_CAPTURES (one or more, separated by ':'), <piece>/captures, <pack>/captures.
const fs = require('fs');
const path = require('path');
const { loadImage, createCanvas } = require('./canvas');

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const INTERACTIVE = /^(button|link|field|select|tab|switch|checkbox|option|menu|label|card|listitem)$/i;
const CAPTURE_TOOL = path.join(__dirname, '..', '..', 'tools', 'capture.mjs');
// `render.mjs <piece> check` sets lenient: a missing capture is recorded in `missing` instead of stopping the film, so
// the check lists every capture still to be made.
const options = { lenient: false };

function makeCaptures(pieceDir) {
  const roots = [...(process.env.WB_CAPTURES ? process.env.WB_CAPTURES.split(path.delimiter).map((p) => path.resolve(p)) : []),
    path.join(pieceDir, 'captures'), path.join(path.dirname(pieceDir), 'captures')];
  const IMG = new Map(); const META = new Map(); const SAMPLE = new Map(); const missing = new Set();

  // The command that makes the captures: the flow file of this piece, or of its pack.
  function howTo() {
    const rel = (p) => { const r = path.relative(process.cwd(), p); return r && !r.startsWith('..') ? r : p; };
    const flow = [path.join(pieceDir, 'capture.json'), path.join(path.dirname(pieceDir), 'capture.json')].find((f) => fs.existsSync(f));
    return `run node ${rel(CAPTURE_TOOL)} --flow ${rel(flow || path.join(pieceDir, 'capture.json'))}`;
  }
  function absent(id) {
    if (!options.lenient) throw Object.assign(new Error(`capture "${id}" not found: ${howTo()}`), { plain: true });
    missing.add(id);
  }

  function paths(id) {
    const jsonId = id.replace(/\.(type|anim)-\d+$/, '');
    for (const r of roots) { const png = path.join(r, id + '.png'); if (fs.existsSync(png)) return { png, json: path.join(r, jsonId + '.json'), root: r }; }
    return { png: path.join(roots[0], id + '.png'), json: path.join(roots[0], jsonId + '.json'), root: roots[0], missing: true };
  }

  function meta(id) {
    if (META.has(id)) return META.get(id);
    const { json } = paths(id); const m = { vw: 393, vh: 852, dpr: 3, els: [], names: {} };
    if (fs.existsSync(json)) {
      const d = JSON.parse(fs.readFileSync(json, 'utf8')); const vp = d.viewport || {};
      m.vw = vp.w || m.vw; m.vh = vp.h || m.vh; m.dpr = vp.dpr || m.dpr;
      m.els = (d.elements || []).map((e) => ({ text: e.text || '', role: e.role || '', name: e.name || null, x: e.x, y: e.y, w: e.w, h: e.h, r: e.radius, box: !!(e.box || e.radius) }));
      for (const e of d.texts || []) if (e.w > 0 && e.h > 0) m.els.push({ text: e.text || '', role: 'text', x: e.x, y: e.y, w: e.w, h: e.h, box: false });
      for (const e of m.els) if (e.name) m.names[e.name] = e;
      m.mode = d.mode; m.safeArea = d.safeArea; m.scrollY = (d.scroll && d.scroll.y) || 0; m.full = d.full || null;
    }
    META.set(id, m); return m;
  }

  // An element of a capture, in CSS px of its viewport. q:
  //   'Save'                         text match (exact > prefix > contains; buttons and cards before loose text)
  //   '@save'                        the element measured with the selector named "save"
  //   { q: 'Save', n: 1 }            the second match from the top
  //   { q: 'Total', text: true }     prefer the loose text over the box that contains it
  //   { q: '1 day', box: true }      the smallest card, option or field that contains the text
  //   { x, y, w, h }                 a rectangle given directly
  function find(id, q) {
    if (q && typeof q === 'object' && 'x' in q && 'w' in q) return q;
    if (paths(id).missing) { absent(id); return { text: '', role: '', x: 0, y: 0, w: 1, h: 1, box: false }; }
    const m = meta(id);
    const named = typeof q === 'string' && q.startsWith('@') ? q.slice(1) : q && typeof q === 'object' && q.name ? q.name : null;
    if (named) { const e = m.names[named]; if (!e) throw new Error(`no element named "${named}" in ${id} (named: ${Object.keys(m.names).join(', ') || 'none'})`); return e; }
    const text = norm(typeof q === 'string' ? q : q.q); const wantText = typeof q === 'object' && q.text;
    const hits = m.els.filter((e) => norm(e.text).includes(text));
    if (!hits.length) throw new Error(`"${typeof q === 'string' ? q : q.q}" is not on ${id}`);
    const score = (e) => { const t = norm(e.text); const loose = e.role === 'text'; return (t === text ? 0 : t.startsWith(text) ? 1 : 2) * 10 + (INTERACTIVE.test(e.role) ? 0 : 1) + (loose ? (wantText ? -25 : 15) : 0); };
    if (typeof q === 'object' && q.n != null) {
      const best = Math.min(...hits.map(score)); const cand = hits.filter((e) => score(e) === best).sort((a, b) => a.y - b.y || a.x - b.x);
      return cand[Math.min(q.n, cand.length - 1)];
    }
    hits.sort((a, b) => score(a) - score(b) || a.w * a.h - b.w * b.h);
    const e = hits[0];
    if (typeof q === 'object' && q.box) {
      const inside = (o) => o !== e && o.x <= e.x + 0.5 && o.y <= e.y + 0.5 && o.x + o.w >= e.x + e.w - 0.5 && o.y + o.h >= e.y + e.h - 0.5 && o.w * o.h > e.w * e.h * 1.15;
      const boxes = m.els.filter((o) => inside(o) && (o.box || INTERACTIVE.test(o.role)) && o.w < m.vw - 0.5).sort((a, b) => a.w * a.h - b.w * b.h);
      if (boxes.length) return boxes[0];
    }
    return e;
  }

  // Every frame of a sequence, in order: seq('reminders/05-message.type')
  function seq(prefix) {
    const dir = path.dirname(paths(prefix + '-01').png); const base = path.basename(prefix);
    const re = new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-\\d+\\.png$');
    const rel = path.dirname(prefix);
    const ids = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => re.test(f)).sort().map((f) => path.join(rel, f.replace(/\.png$/, '')).split(path.sep).join('/')) : [];
    if (!ids.length) absent(prefix + '-01');
    return ids;
  }

  async function load(id) {
    const p = paths(id);
    if (IMG.has(p.png)) return IMG.get(p.png);
    if (p.missing) { absent(id); return null; }
    const im = await loadImage(fs.readFileSync(p.png)); IMG.set(p.png, im); return im;
  }
  const image = (id) => { const im = IMG.get(paths(id).png); if (!im) throw new Error('capture not loaded: ' + id); return im; };

  // Colour of one pixel of a capture (to cover something with the page's own colour).
  function sample(im, x, y) {
    const key = `${im.width}x${im.height}:${Math.round(x)},${Math.round(y)}`; if (SAMPLE.has(key)) return SAMPLE.get(key);
    const cv = createCanvas(1, 1); const c = cv.getContext('2d'); c.drawImage(im, -Math.round(x), -Math.round(y)); const d = c.getImageData(0, 0, 1, 1).data;
    const col = `rgb(${d[0]},${d[1]},${d[2]})`; SAMPLE.set(key, col); return col;
  }

  // Rectangles from measured elements, so boxes follow the app when its layout changes.
  const rect = (id, q) => { const e = find(id, q); return { x: e.x, y: e.y, w: e.w, h: e.h }; };
  const scrollOf = (id) => meta(id).scrollY || 0;

  return { roots, paths, meta, find, seq, load, image, sample, rect, scrollOf, missing, howTo };
}

const union = (...rs) => { const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y)), x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h)); return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; };
const pad = (r, d, dy = d) => ({ x: r.x - d, y: r.y - dy, w: r.w + 2 * d, h: r.h + 2 * dy });

module.exports = { makeCaptures, union, pad, norm, options };
