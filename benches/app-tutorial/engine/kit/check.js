'use strict';
// Checks a tutorial film before rendering it:
//   - every ring and tap falls on the screen that is visible at that moment;
//   - rings last long enough to be seen (≥ 0.35 s) and shots last at least their transition;
//   - camera keys are in order (two push-ins that overlap make the camera go back and forth);
//   - every capture the film uses exists (all the missing ones are listed, with the command that makes them) and every
//     element it points at is in its capture;
//   - with --social: taps, rings, labels, loupes and captions stay out of what Reels, Shorts and TikTok cover.
// A ring may outlive a cut by 0.4 s (a cut right after a tap is usually the same button in its next state), and may
// span any number of cuts when its element stays in the same place (typing frames, a pressed state).
const { ZONES, zoneOf } = require('./zones');

async function checkFilm(film, { social = false } = {}) {
  const { shots, cfg } = film; const out = [];
  // captures the film points at that are not there yet (recorded while the film was built): list them all, and how to make them
  const missing = film.captures && film.captures.missing;
  if (missing && missing.size) return [...[...missing].map((id) => `capture "${id}" not found`), film.captures.howTo()];
  const shotAt = (t) => { let k = -1; for (let i = 0; i < shots.length; i++) if (shots[i].at <= t) k = i; return k; };
  const label = (x) => (typeof x.el === 'string' ? x.el : (x.el && (x.el.q || x.el.name)) || x.text || 'rect');
  const name = (s) => String(s.cap || s.seq || 'drawn').split('/').pop();

  for (let i = 1; i < shots.length; i++) {
    const d = shots[i].at - shots[i - 1].at; const p = shots[i - 1]; const need = p.trans === 'cut' || p.trans === 'none' ? 0.05 : Math.min(p.dur ?? 0.42, 0.42);
    if (d < need - 1e-6) out.push(`shot ${i - 1} (${name(p)}) lasts ${d.toFixed(2)} s, less than its transition (${need} s)`);
  }
  await film.init({ scale: 0.5 });
  // the same element, in the same place, on a later shot (typing frames, a pressed state)
  const samePlace = (m, k) => { try { const r0 = film.elRect(shots[k].at, m.el, m.shot), r1 = film.elRect(shots[k].at, m.el, k); return Math.abs(r0.x - r1.x) < 4 && Math.abs(r0.y - r1.y) < 4 && Math.abs(r0.h - r1.h) < 4; } catch (e) { return false; } };
  for (const m of cfg.marks || []) {
    const lab = label(m);
    if (m.to - m.at < 0.35) out.push(`ring "${lab}" lasts ${(m.to - m.at).toFixed(2)} s (${m.at.toFixed(2)}–${m.to.toFixed(2)})`);
    if (m.shot != null) {
      const a = shotAt(m.at + 0.05), b = shotAt(m.to - 0.05); const nx = shots[m.shot + 1];
      let cut = a === m.shot && b > m.shot && nx && m.to - nx.at <= 0.4;
      for (let k = m.shot + 1; cut && k <= b; k++) cut = shots[k].trans === 'cut';
      let same = a === m.shot && b > m.shot; for (let k = m.shot + 1; same && k <= b; k++) same = shots[k].trans === 'cut' && samePlace(m, k);
      if ((a !== m.shot || b !== m.shot) && !cut && !same) out.push(`ring "${lab}" (shot ${m.shot}) shows over shots ${a}–${b} (${m.at.toFixed(2)}–${m.to.toFixed(2)})`);
    }
  }
  const ks = (cfg.phone || []).flat(); for (let i = 1; i < ks.length; i++) if (ks[i].t < ks[i - 1].t - 1e-6) out.push(`camera: key ${i} (t ${ks[i].t.toFixed(2)}) comes before the previous one (t ${ks[i - 1].t.toFixed(2)}): two push-ins overlap`);
  for (const tp of cfg.taps || []) if (tp.shot != null && shotAt(tp.at) !== tp.shot) out.push(`tap "${label(tp)}" (shot ${tp.shot}) falls on shot ${shotAt(tp.at)} at ${tp.at.toFixed(2)} s`);

  const probe = (kind, x, t0, t1, rectAt) => {
    for (const t of [t0, (t0 + t1) / 2, t1]) {
      let r; try { r = rectAt(t); } catch (e) { out.push(`${kind} "${label(x)}": ${e.message}`); return; }
      if (!social) return;
      const z = zoneOf(r); if (z) { out.push(`${kind} "${label(x)}" at ${t.toFixed(2)} s: ${z} · y ${Math.round(r.y)}–${Math.round(r.y + r.h)}, x ${Math.round(r.x)}–${Math.round(r.x + r.w)}`); return; }
    }
  };
  for (const m of cfg.marks || []) probe('ring', m, m.at + 0.1, m.to, (t) => film.elRect(t, m.el, m.shot ?? film.shotAt(m.at)));
  for (const tp of cfg.taps || []) probe('tap', tp, tp.at, tp.at, (t) => { const r = film.elRect(t, tp.el, tp.shot ?? film.shotAt(tp.at)); const R = 21 * r.G.k * r.G.z; return { x: r.x + r.w / 2 - R, y: r.y + r.h / 2 - R, w: 2 * R, h: 2 * R }; });
  for (const lb of cfg.labels || []) {
    if (lb.el) probe('label', lb, lb.at + 0.1, lb.to, (t) => { const r = film.elRect(t, lb.el, lb.shot ?? film.shotAt(lb.at)); const y = lb.side === 'above' ? r.y - 46 : r.y + r.h + 46; return { x: r.x, y: y - 32, w: r.w, h: 64 }; });
    else probe('label', lb, lb.at, lb.to, () => ({ x: (lb.x ?? 540) - 150, y: (lb.y ?? 1200) - 32, w: 300, h: 64 }));
  }
  for (const lp of cfg.loupes || []) probe('loupe', lp, lp.at + 0.45, lp.to, () => { const r = film.elRect(lp.at, lp.el, lp.shot); const z = lp.zoom || 2; const w = r.w * z, h = r.h * z; const cy = lp.y ?? Math.min(Math.max(r.y + r.h / 2, 640), 1240); return { x: (lp.x ?? 540) - w / 2, y: cy - h / 2, w, h }; });
  if (social) { const cb = film.capBox(); if (cb) { const z = zoneOf({ x: 75, y: cb.y0, w: 930, h: cb.y1 - cb.y0 }); if (z) out.push(`captions (y ${Math.round(cb.y0)}–${Math.round(cb.y1)}): ${z}`); } }
  return out;
}

module.exports = { checkFilm, ZONES };
