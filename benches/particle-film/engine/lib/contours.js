'use strict';
// Pencil contours traced from a plate: iso-luminance curves (marching squares) on a blurred copy of the
// plate, linked into polylines, simplified and normalised to the plate. The film draws them as boiling
// graphite strokes over the stipple, like an engraver's outline: dots give tone, lines give the silhouette.

const { createCanvas } = require('../core/canvas');

// Luminance map (0..1) of an image or canvas at width w, blurred by `blur` px.
function lumaMap(img, w, blur = 2) {
  const h = Math.round(w * img.height / img.width);
  const c = createCanvas(w, h); const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.filter = `blur(${blur}px)`; ctx.drawImage(img, 0, 0, w, h); ctx.filter = 'none';
  const d = ctx.getImageData(0, 0, w, h).data; const L = new Float32Array(w * h);
  for (let i = 0, j = 0; i < w * h; i++, j += 4) L[i] = (0.2126 * d[j] + 0.7152 * d[j + 1] + 0.0722 * d[j + 2]) / 255;
  return { L, w, h };
}

// Marching squares at one level → array of polylines in map pixels.
function isolines(L, w, h, level) {
  const segs = []; const at = (x, y) => L[y * w + x];
  // Edge keys: horizontal edge (x, y)-(x+1, y) = 2*(y*w+x); vertical edge (x, y)-(x, y+1) = 2*(y*w+x)+1.
  const point = (key) => {
    const vert = key & 1; const cell = key >> 1; const x = cell % w, y = (cell / w) | 0;
    const a = at(x, y), b = vert ? at(x, y + 1) : at(x + 1, y); const t = (level - a) / ((b - a) || 1e-6);
    return vert ? [x, y + t] : [x + t, y];
  };
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
    const v0 = at(x, y) > level ? 1 : 0, v1 = at(x + 1, y) > level ? 2 : 0, v2 = at(x + 1, y + 1) > level ? 4 : 0, v3 = at(x, y + 1) > level ? 8 : 0;
    const k = v0 | v1 | v2 | v3; if (k === 0 || k === 15) continue;
    const top = 2 * (y * w + x), bottom = 2 * ((y + 1) * w + x), left = 2 * (y * w + x) + 1, right = 2 * (y * w + x + 1) + 1;
    const add = (e0, e1) => segs.push([e0, e1]);
    switch (k) {
      case 1: case 14: add(left, top); break;
      case 2: case 13: add(top, right); break;
      case 3: case 12: add(left, right); break;
      case 4: case 11: add(right, bottom); break;
      case 6: case 9: add(top, bottom); break;
      case 7: case 8: add(left, bottom); break;
      case 5: add(left, top); add(right, bottom); break;
      case 10: add(top, right); add(left, bottom); break;
      default: break;
    }
  }
  // Link segments through their shared edge keys.
  const byKey = new Map();
  segs.forEach((s, i) => { for (const e of s) { if (!byKey.has(e)) byKey.set(e, []); byKey.get(e).push(i); } });
  const used = new Uint8Array(segs.length); const lines = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue; used[i] = 1;
    const chain = [segs[i][0], segs[i][1]];
    for (const dir of [1, -1]) {
      for (;;) {
        const end = dir === 1 ? chain[chain.length - 1] : chain[0];
        const next = (byKey.get(end) || []).find((j) => !used[j]); if (next === undefined) break;
        used[next] = 1; const s = segs[next]; const other = s[0] === end ? s[1] : s[0];
        if (dir === 1) chain.push(other); else chain.unshift(other);
      }
    }
    lines.push(chain.map(point));
  }
  return lines;
}

// Ramer–Douglas–Peucker simplification.
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let best = -1, bd = tol;
    const [ax, ay] = pts[a], [bx, by] = pts[b]; const dx = bx - ax, dy = by - ay; const len = Math.hypot(dx, dy) || 1e-9;
    for (let i = a + 1; i < b; i++) { const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len; if (d > bd) { bd = d; best = i; } }
    if (best !== -1) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const lengthOf = (pts) => { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; };

// Trace contours of a plate image. o: { levels (luminance, 0..1), minLen (px at 768 wide), blur, max,
// exclude: [{cx, cy, w, h, rot}] normalised regions to skip (a phone screen), crop [x, y, w, h] }.
// Returns [{ lv, len, pts: [[u, v], ...] }] normalised to the (cropped) plate, longest first.
function traceContours(img, o = {}) {
  const { levels = [0.42, 0.72], minLen = 60, blur = 2.2, max = 220, exclude = [], width = 384 } = o;
  const m = lumaMap(img, width, blur); const k = 768 / width;
  const out = [];
  for (const lv of levels) {
    for (const line of isolines(m.L, m.w, m.h, lv)) {
      const len = lengthOf(line) * k; if (len < minLen) continue;
      const pts = simplify(line, 0.7).map(([x, y]) => [x / m.w, y / m.h]);
      if (pts.every(([u, v]) => u < 0.01 || u > 0.99 || v < 0.01 || v > 0.99)) continue;
      if (exclude.some((r) => pts.filter(([u, v]) => inRect(u, v, r)).length > pts.length * 0.6)) continue;
      out.push({ lv, len: Math.round(len), pts: pts.map(([u, v]) => [+u.toFixed(5), +v.toFixed(5)]) });
    }
  }
  out.sort((a, b) => b.len - a.len);
  return out.slice(0, max);
}

function inRect(u, v, r) {
  const c = Math.cos(-(r.rot || 0)), s = Math.sin(-(r.rot || 0)); const dx = u - r.cx, dy = v - r.cy;
  // Rotation in pixel space would be exact; plates are close to 9:16, so this is accurate enough to skip a screen.
  const x = dx * c - dy * s, y = dx * s + dy * c;
  return Math.abs(x) < r.w / 2 + 0.01 && Math.abs(y) < r.h / 2 + 0.01;
}

module.exports = { traceContours, isolines, simplify, lumaMap };
