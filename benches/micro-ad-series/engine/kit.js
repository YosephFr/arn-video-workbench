'use strict';
// Scene kit of the micro-ad series. Every episode is a short film.js built on this kit, which in turn
// runs on the particle-film engine (Skia frame loop, stippler, ink strokes, captions, end card):
//
//   module.exports = defineEpisode(__dirname, ({ L, W, Hot, along, T, sfx }) => ({
//     world: 'paper',                       // paper | brand | night | kraft
//     plates: ['clock'],                    // plates from the bank (engine/bank.js)
//     captions: { y: 300 },                 // captions (or false when autoText carries the words)
//     autoText: true,                       // big kinetic text, word by word, of every spoken line
//     card: { lock: T.lastEnd + 1.2 },      // end card; its copy comes from script.json "card"
//     scenes: [ { at: 0, to: 3.2, draw(u) { u.paper(); u.plate('clock', { ... }); u.text('Hi', { ... }); } } ],
//     events: [ sfx(0.2, 'pop', -18) ],     // sound effects, exported to events.json for `wb sfx`
//   }));
//
// `u` is a scene's context for one frame (see makeU): local time, paper, camera, plates, phones, animated
// text, ink strokes, bubbles, voice notes, counters, stamps, bursts and transitions. Scene times may use
// 'card' (until the end card covers the frame) or 'end'.

const path = require('path');
const E = path.join(process.env.WB_ENGINE_BENCH || path.join(__dirname, '..', '..', 'particle-film'), 'engine');
const { clamp, ease, lerp, smoothstep, hash, TAU, rgb01, mixHex, luminance } = require(path.join(E, 'core/math'));
const { sketch, roundRectPts, ellipsePts } = require(path.join(E, 'draw/ink'));
const { makePaper } = require(path.join(E, 'post/post'));
const { noise } = require(path.join(E, 'core/noise'));
const bubbles = require(path.join(E, 'draw/bubbles'));
const P = require(path.join(E, 'lib/plates'));
const tl = require(path.join(E, 'lib/timeline'));
const { makeCaptions } = require(path.join(E, 'lib/captions'));
const { loadBrand, loadLogos } = require(path.join(E, 'lib/brand'));
const { createEndCard } = require(path.join(E, 'lib/endcard'));
const { drawVoiceNote } = require(path.join(E, 'lib/voicenote'));
const appui = require(path.join(E, 'lib/appui'));
const { camPath } = require(path.join(E, 'lib/cam'));
const { BANK } = require('./bank');

const hex255 = (hex) => rgb01(hex).map((v) => Math.round(v * 255));
const rr = (c, x, y, w, h, r) => { c.beginPath(); c.roundRect(x, y, w, h, r); };

// ---------------------------------------------------------------- worlds (grounds), from the brand colours
function makeWorlds(b) {
  const c = b.colors;
  const onAccent = luminance(c.accent) > 0.32 ? mixHex(c.ink, c.accent, 0.12) : '#fff8ec';
  const accentDark = hex255(mixHex(c.accent, '#000000', 0.55)).join(',');
  return {
    paper: { base: hex255(mixHex(c.background, '#ece5d6', 0.6)), mode: 'ink', col: rgb01(c.ink), text: c.ink, accent: luminance(c.accent) > 0.5 ? mixHex(c.accent, c.ink, 0.45) : c.accent,
      cap: 'paper', card: 'paper', post: { bloom: 0, grain: 0.07, vignette: 0.34, vignetteColor: '45,30,15', flicker: 0.015 }, paper: { mottle: 10, tooth: 14 } },
    brand: { base: hex255(c.accent), mode: 'ink', col: rgb01(onAccent), text: onAccent, accent: luminance(c.accent) > 0.32 ? '#fff8ec' : mixHex(c.accent, '#ffffff', 0.7),
      cap: 'accent', card: 'paper', post: { bloom: 0, grain: 0.09, vignette: 0.26, vignetteColor: accentDark, flicker: 0.015 }, paper: { mottle: 6, tooth: 10 } },
    night: { base: [20, 17, 14], mode: 'light', col: [1.0, 0.93, 0.8], text: '#fff3e0', accent: mixHex(c.accent, '#ffffff', 0.35),
      cap: 'night', card: 'night', post: { bloom: 0.5, bloomRadius: 10, grain: 0.06, vignette: 0.5, vignetteColor: '0,0,0', flicker: 0.02 }, paper: { mottle: 3, tooth: 6, fibres: 200, warm: false } },
    kraft: { base: [201, 166, 124], mode: 'ink', col: [0.13, 0.09, 0.06], text: '#2a1b0e', accent: '#fff2dc',
      cap: 'paper', card: 'paper', post: { bloom: 0, grain: 0.08, vignette: 0.32, vignetteColor: '70,40,10', flicker: 0.015 }, paper: { mottle: 12, tooth: 18 } },
  };
}

// A rising paper edge (the transition into the end card): y(x) for progress p 0..1.
function wipeEdge(p, t, seed = 3, H = 1920) {
  const base = lerp(H + 140, -160, ease.inOutCubic(clamp(p)));
  return (x) => base + noise.fbm2(x * 0.0026 + seed, t * 0.4, 2) * 60 + Math.sin(x * 0.007 + seed) * 20;
}
function pathBelowEdge(c, edge, W = 1080, H = 1920) {
  c.beginPath(); c.moveTo(-40, H + 80);
  const n = 40; for (let i = 0; i <= n; i++) { const x = -40 + (i / n) * (W + 80); c.lineTo(x, edge(x)); }
  c.lineTo(W + 40, H + 80); c.closePath();
}

// ---------------------------------------------------------------- the episode
function defineEpisode(dir, build) {
  process.env.WB_PIECE = process.env.WB_PIECE || dir;
  let cfg = null, b = null, world = null, cardWorld = null, scenes = null, events = null, capDraw = null, card = null, cardCfg = null, cardStart = Infinity;
  let papers = null, cardPapers = null; const placed = new Map(); const kinCache = new Map();
  const WIPE = 0.42;

  function configure() {
    if (cfg) return;
    const bench = process.env.WB_BENCH || path.join(__dirname, '..');
    b = loadBrand({ piece: process.env.WB_PIECE, bench, repo: process.env.WB_REPO || path.join(bench, '..', '..') });
    bubbles.setFamilies({ body: b.fonts.body, mono: b.fonts.mono });
    const T = { duration: tl.duration, lastEnd: tl.lastEnd };
    const sfx = (t, name, gain_db = -18, o = {}) => ({ t, name, gain_db, ...o });
    cfg = build({ L: tl.L, W: tl.W, Wi: tl.Wi, Hot: tl.Hot, along: tl.along, T, sfx, brand: b, ui: appui });
    const WORLDS = makeWorlds(b);
    world = WORLDS[cfg.world || 'paper'] || WORLDS.paper;
    cardWorld = WORLDS[world.card];
    // Plates from the bank (only the ones the episode uses).
    const spec = {}; for (const n of cfg.plates || []) { if (!BANK[n]) throw new Error(`plate "${n}" is not in engine/bank.js`); spec[n] = BANK[n]; }
    P.register(spec);
    // End card: always the same structure (brand consistency across the series); copy from script.json.
    if (cfg.card !== false) {
      const sc = tl.tl.script.card || {};
      const copy = [sc.offer && { text: sc.offer, role: 'offer' }, sc.offer2 && { text: sc.offer2, role: 'offer' }, sc.sub && { text: sc.sub, role: 'sub' }, { text: sc.cta || b.url, role: 'cta' }, sc.fine && { text: sc.fine, role: 'fine' }].filter(Boolean);
      cardCfg = { lock: tl.lastEnd + 1.15, gather: 1.0, N: 6000, markY: 700, markSize: 340, wordY: 950, wordH: 104, copy, ...(cfg.card || {}) };
      cardCfg.world = world.card;
      card = createEndCard(cardCfg);
      cardStart = cardCfg.lock - 1.35;
    }
    events = [...(cfg.events || [])];
    if (card) { events.push({ t: cardStart, name: 'whoosh', gain_db: -22 }); events.push({ t: cardCfg.lock - 0.05, name: 'logo', gain_db: -12 }); }
    capDraw = cfg.captions === false ? null : makeCaptions({ tone: world.cap, ...(cfg.captions || {}) });
    scenes = (cfg.scenes || []).map((s) => ({ ...s, to: s.to === 'card' ? cardStart + WIPE + 0.05 : s.to === 'end' ? T.duration : s.to }));
    if (cfg.autoText) {   // big text of every line, word by word, sized by length; drawn on top of the scenes
      const ao = cfg.autoText === true ? {} : cfg.autoText; const ids = tl.ids;
      scenes.push({ at: 0, to: card ? cardStart + WIPE + 0.05 : T.duration, draw(u) {
        ids.forEach((id, i) => {
          const line = tl.L(id); if (line.caption === false) return;
          const n = line.words.length; const size = ao.size || (n <= 3 ? 124 : n <= 5 ? 108 : n <= 8 ? 96 : n <= 11 ? 86 : 76); const last = i === ids.length - 1;
          const next = last ? Infinity : tl.L(ids[i + 1]).start;
          u.kinetic(id, { halo: true, ...(ao.kinetic || {}), y: ao.y || (size >= 96 ? 345 : 390), size, maxW: 940, until: last ? T.lastEnd + 0.8 : Math.min(line.end + 0.12, next - 0.04), outDur: 0.18 });
        });
      } });
    }
  }

  const mkPapers = (w, W_, H_) => [1, 2, 3].map((s) => makePaper(W_, H_, { seed: s, base: w.base, ...w.paper }));

  function placeOf(name, o) {
    const key = `${name}|${o.cx ?? 540}|${o.cy ?? 960}|${o.h ?? 1500}|${o.n ?? 0}|${o.flip ? 1 : 0}`;
    let S = placed.get(key);
    if (!S) { S = P.place(P.plate(name), { cx: o.cx ?? 540, cy: o.cy ?? 960, h: o.h ?? 1500, n: o.n, flip: o.flip }); placed.set(key, S); }
    return S;
  }

  function makeU(f, t, sc) {
    const lt = t - sc.at; const w = world; const { ctx } = f;
    const F = (weight, size, role = 'display') => b.font(weight, size, role);
    const u = {
      f, t, lt, ctx, world: w, brand: b, L: tl.L, W: tl.W, Wi: tl.Wi, Hot: tl.Hot, along: tl.along, ease, clamp, lerp, hash, smoothstep, TAU, P, ui: appui, sc, roundRectPts, ellipsePts, sketch,
      // Progress of a window [a, a + d] of local time (p) or absolute time (pa), eased.
      p(a, d, e = 'outCubic') { return ease[e](clamp((lt - a) / d)); },
      pa(a, d, e = 'outCubic') { return ease[e](clamp((t - a) / d)); },
      // 1 inside [a, b] of local time, with soft edges.
      win(a, b2, fin = 0.2, fout = 0.2) { return Math.min(smoothstep(a, a + fin, lt), 1 - smoothstep(b2 - fout, b2, lt)); },
      paper() { f.setScreen(ctx); ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(papers[Math.floor(t * 12) % 3], 0, 0); ctx.restore(); },
      cam(c) { f.cam = { x: 540, y: 960, z: 1, r: 0, ...c }; return f.cam; },
      camPath(keys) { f.cam = camPath(keys, t); return f.cam; },
      flush(alpha = 1) { if (w.mode === 'light') f.flushLight(alpha, 0.8, 1.05); else f.flushInk(alpha); },
      // A stippled plate from the bank. o: { cx, cy, h, n, flip, appear, fade, alpha, wind, from, col, r0, r1, seed, boil, tint, clip, gain, mode }
      plate(name, o = {}) {
        const S = placeOf(name, o); const mode = o.mode || w.mode;
        P.drawSet(f, S, { mode, col: o.col || w.col, alpha: o.alpha ?? 1, r0: o.r0 ?? 0.85, r1: o.r1 ?? 2.3, appear: o.appear ?? 1, fade: o.fade ?? 0, wind: o.wind || 0,
          from: o.from || null, t, boil: o.boil ?? 0.55, seed: o.seed ?? 1, tint: o.tint || null, clip: o.clip || null, gain: o.gain ?? 1 });
        if (mode === 'light') f.flushLight(1, 0.8, 1.05); else f.flushInk();
        return S;
      },
      // Pencil outline of a plate (traced from it), drawn on by `progress`.
      outline(name, o = {}) { const S = placeOf(name, o); f.withLayer((c) => P.drawContours(c, S, { t, progress: o.progress ?? 1, alpha: o.alpha ?? 0.7, width: o.width ?? 2.4, seed: o.seed ?? 3, max: o.max ?? 40, color: o.color || w.text, light: w.mode === 'light' }), { tooth: 0.3 }); },
      // Metamorphosis between two plates (placed with the same n).
      morph(a, b2, p, o = {}) {
        const n = o.n || 24000; const A = placeOf(a, { ...o, n }), B = placeOf(b2, { ...o, n }); const mode = o.mode || w.mode;
        P.drawMorph(f, A, B, p, { mode, col: o.col || w.col, colB: o.colB || null, alpha: o.alpha ?? 1, r0: o.r0 ?? 0.85, r1: o.r1 ?? 2.3, swirl: o.swirl ?? 70, t, boil: o.boil ?? 0.55 });
        if (mode === 'light') f.flushLight(1, 0.8, 1.05); else f.flushInk();
      },
      placed(name, o = {}) { return placeOf(name, o); },
      // App content inside a plate's phone screen (follows the camera and the screen's tilt). draw(c, t, h)
      // draws in phone points (390 wide, h tall).
      screen(S, draw, o = {}) {
        const s = S.screen; if (!s) throw new Error('this plate has no screen');
        const k = s.w / 390, h = s.h / k;
        f.withLayer((c) => { c.save(); c.translate(s.cx, s.cy); c.rotate(s.rot); c.translate(-s.w / 2, -s.h / 2); c.scale(k, k); rr(c, 0, 0, 390, h, o.r ?? 34); c.clip(); c.globalAlpha *= o.alpha ?? 1; draw(c, t, h); c.restore(); });
      },
      // A loose phone (no hand): body, notch and the app. o: { x, y, w, h (points), rot, alpha, scale, shadow }
      phone(draw, o = {}) {
        const pw = (o.w || 420) * (o.scale || 1); const k = pw / 390; const hp = o.h || 844; const ph = hp * k; const pad = pw * 0.035;
        f.withLayer((c) => {
          c.save(); c.translate(o.x ?? 540, o.y ?? 960); c.rotate(o.rot || 0); c.globalAlpha *= o.alpha ?? 1;
          if (o.shadow !== false) { c.save(); c.globalAlpha *= 0.28; c.filter = `blur(${26 * f.s}px)`; c.fillStyle = '#3b2a16'; rr(c, -pw / 2 + 14, -ph / 2 + 28, pw + pad * 2, ph + pad * 2, pw * 0.14); c.fill(); c.restore(); }
          c.fillStyle = '#15120f'; rr(c, -pw / 2 - pad, -ph / 2 - pad, pw + pad * 2, ph + pad * 2, pw * 0.13); c.fill();
          c.save(); c.translate(-pw / 2, -ph / 2); c.scale(k, k); rr(c, 0, 0, 390, hp, 36); c.clip(); draw(c, t, hp); c.restore();
          c.fillStyle = '#15120f'; rr(c, -pw * 0.16, -ph / 2 - pad * 0.4, pw * 0.32, pad * 2.6, pad); c.fill();
          c.restore();
        });
      },
      // Animated text. o: { x, y, size, weight, role ('display'|'body'), color, align, rot, alpha, lh, maxW,
      //   in: { at, dur, kind: pop|rise|slam|drop|left|right|type|wipe }, out: { at, dur }, stroke, strokeW, shadow, abs }
      text(str, o = {}) {
        const ref = o.abs ? t : lt; const size = o.size || 90; const lines = String(str).split('\n');
        const inn = o.in || {}; const at = inn.at || 0; const dur = inn.dur || 0.28; const kind = inn.kind || 'pop';
        const k = clamp((ref - at) / dur); if (k <= 0) return;
        let alpha = o.alpha ?? 1; if (o.out) alpha *= 1 - clamp((ref - o.out.at) / (o.out.dur || 0.2)); if (alpha <= 0.003) return;
        ctx.save(); f.setScreen(ctx);
        ctx.font = F(o.weight || 800, size, o.role || 'display'); ctx.textAlign = o.align || 'center'; ctx.textBaseline = 'middle';
        const x = o.x ?? 540, y = o.y ?? 960, lh = (o.lh || 1.08) * size;
        ctx.translate(x, y); if (o.rot) ctx.rotate(o.rot);
        let sc = 1, dy = 0, dx = 0; const e = ease.outCubic(k);
        if (kind === 'pop') sc = lerp(0.55, 1, ease.outBack(k, 2.2));
        else if (kind === 'rise') dy = (1 - e) * 42;
        else if (kind === 'slam') { sc = lerp(1.9, 1, ease.outQuart(k)); const sh = k < 1 ? (1 - k) * 8 : 0; dx = (hash(Math.floor(ref * 60)) - 0.5) * sh; dy = (hash(Math.floor(ref * 60) + 9) - 0.5) * sh; }
        else if (kind === 'drop') dy = -(1 - ease.outBack(k, 1.4)) * 160;
        else if (kind === 'left') dx = (1 - e) * -160; else if (kind === 'right') dx = (1 - e) * 160;
        ctx.translate(dx, dy); ctx.scale(sc, sc);
        ctx.globalAlpha = alpha * (kind === 'type' || kind === 'wipe' ? 1 : clamp(k * 2.4));
        if (kind === 'wipe') { const tw = Math.max(...lines.map((l) => ctx.measureText(l).width)); ctx.beginPath(); ctx.rect(-tw / 2 - 20, -size * lines.length, (tw + 40) * e, size * lines.length * 2); ctx.clip(); }
        const color = o.color || w.text;
        lines.forEach((ln, i) => {
          const yy = (i - (lines.length - 1) / 2) * lh; let s = ln;
          if (kind === 'type') s = ln.slice(0, Math.max(0, Math.floor(ln.length * e)));
          if (o.shadow) { ctx.fillStyle = o.shadow; ctx.fillText(s, 5, yy + 6); }
          if (o.stroke) { ctx.lineWidth = o.strokeW || 10; ctx.strokeStyle = o.stroke; ctx.lineJoin = 'round'; ctx.strokeText(s, 0, yy); }
          ctx.fillStyle = color; ctx.fillText(s, 0, yy);
        });
        ctx.restore();
      },
      // One line with its own colour per part: parts = [['Fast ', null], ['booking.', accent]]
      rich(parts, o = {}) {
        const ref = o.abs ? t : lt; const inn = o.in || {}; const k = clamp((ref - (inn.at || 0)) / (inn.dur || 0.28)); if (k <= 0) return;
        ctx.save(); f.setScreen(ctx); const size = o.size || 90; ctx.font = F(o.weight || 800, size); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        const ws = parts.map(([s]) => ctx.measureText(s).width); const total = ws.reduce((a, c) => a + c, 0); let x = (o.x ?? 540) - total / 2; const y = o.y ?? 960;
        ctx.globalAlpha = (o.alpha ?? 1) * clamp(k * 2.4); const sc = lerp(0.6, 1, ease.outBack(k, 2)); ctx.translate(o.x ?? 540, y); ctx.scale(sc, sc); ctx.translate(-(o.x ?? 540), -y);
        parts.forEach(([s, col], i) => { if (o.stroke) { ctx.lineJoin = 'round'; ctx.lineWidth = o.strokeW || 12; ctx.strokeStyle = o.stroke; ctx.strokeText(s, x, y); } ctx.fillStyle = col || w.text; ctx.fillText(s, x, y); x += ws[i]; });
        ctx.restore();
      },
      // A pill with text, like a caption chunk but free. o: { x, y, size, in, color }
      pill(str, o = {}) {
        const ref = o.abs ? t : lt; const inn = o.in || {}; const k = clamp((ref - (inn.at || 0)) / (inn.dur || 0.22)); if (k <= 0) return;
        ctx.save(); f.setScreen(ctx); const size = o.size || 52; ctx.font = F(700, size); const tw = ctx.measureText(str).width;
        const x = o.x ?? 540, y = o.y ?? 300; const sc = lerp(0.8, 1, ease.outBack(k, 2)); ctx.translate(x, y); ctx.scale(sc, sc);
        const dark = w.mode === 'light'; ctx.globalAlpha = (o.alpha ?? 1) * clamp(k * 2.4) * (dark ? 0.72 : 0.94); ctx.fillStyle = dark ? '#08090d' : 'rgb(250,246,238)'; rr(ctx, -tw / 2 - 30, -size / 2 - 16, tw + 60, size + 32, (size + 32) / 2); ctx.fill();
        ctx.globalAlpha = (o.alpha ?? 1) * clamp(k * 2.4); ctx.fillStyle = o.color || (dark ? '#fff3e0' : b.colors.ink); ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.fillText(str, 0, 2); ctx.restore();
      },
      // A marker swash under words. o: { x, y, w, h, color, alpha, in: { at, dur } }
      swash(o = {}) {
        const inn = o.in || {}; const k = clamp((lt - (inn.at || 0)) / (inn.dur || 0.35)); if (k <= 0) return;
        f.withLayer((c) => { c.globalAlpha *= o.alpha ?? 0.5; const x = o.x ?? 540, y = o.y ?? 960, ww = o.w ?? 400, hh = o.h ?? 46;
          const pts = []; for (let i = 0; i <= 8; i++) pts.push([x - ww / 2 + (ww * i) / 8, y + Math.sin(i * 1.3) * hh * 0.12]);
          sketch(c, pts, { width: hh, color: o.color || w.accent, t, seed: o.seed || 5, boil: 1.4, passes: 2, progress: ease.outCubic(k), taper: 0.08, spacing: 10, pressure: 0.25, drift: 2 }); }, { cam: false });
      },
      // A free ink stroke (screen points). o: { color, width, progress, seed, passes, alpha, taper, closed }
      ink(pts, o = {}) {
        f.withLayer((c) => { c.globalAlpha *= o.alpha ?? 1; sketch(c, pts, { width: o.width || 6, color: o.color || w.text, t, seed: o.seed || 3, boil: o.boil ?? 1.2, passes: o.passes || 2, progress: o.progress ?? 1, taper: o.taper ?? 0.15, closed: !!o.closed, spacing: o.spacing || 6 }); }, { cam: false });
      },
      circle(x, y, o = {}) { this.ink(ellipsePts(x, y, o.rx || 200, o.ry || 90, o.rot ?? -0.05, 60, -0.4, Math.PI * 2 + 0.3), { color: o.color || w.accent, width: o.width || 7, progress: o.progress ?? 1, seed: o.seed || 8, alpha: o.alpha ?? 1 }); },
      underline(x0, x1, y, o = {}) { const m = (x0 + x1) / 2; this.ink([[x0, y], [m, y + (o.bow ?? 8)], [x1, y - 4]], { color: o.color || w.accent, width: o.width || 8, progress: o.progress ?? 1, seed: o.seed || 4, alpha: o.alpha ?? 1, passes: 2, taper: 0.1 }); },
      arrow(x0, y0, x1, y1, o = {}) {
        const dx = x1 - x0, dy = y1 - y0, L_ = Math.hypot(dx, dy) || 1, nx = -dy / L_, ny = dx / L_, bend = (o.bend ?? 0.18) * L_;
        const pts = []; for (let i = 0; i <= 24; i++) { const v = i / 24, s = Math.sin(Math.PI * v) * bend; pts.push([x0 + dx * v + nx * s, y0 + dy * v + ny * s]); }
        const pr = o.progress ?? 1; const col = o.color || w.accent; this.ink(pts, { color: col, width: o.width || 7, progress: pr, seed: o.seed || 6, alpha: o.alpha ?? 1, taper: 0.05 });
        if (pr > 0.92) { const ang = Math.atan2(y1 - pts[22][1], x1 - pts[22][0]); const hl = 46; this.ink([[x1 - Math.cos(ang - 0.5) * hl, y1 - Math.sin(ang - 0.5) * hl], [x1, y1], [x1 - Math.cos(ang + 0.5) * hl, y1 - Math.sin(ang + 0.5) * hl]], { color: col, width: o.width || 7, seed: 12, alpha: o.alpha ?? 1, passes: 1, taper: 0.1 }); }
      },
      check(x, y, o = {}) { const s = o.size || 60; this.ink([[x - s * 0.5, y + s * 0.02], [x - s * 0.12, y + s * 0.4], [x + s * 0.55, y - s * 0.42]], { color: o.color || b.colors.positive, width: o.width || s * 0.16, progress: o.progress ?? 1, seed: 21, taper: 0.1, alpha: o.alpha ?? 1 }); },
      cross(x, y, o = {}) { const s = o.size || 60; const c = o.color || b.colors.negative; const pr = o.progress ?? 1; this.ink([[x - s / 2, y - s / 2], [x + s / 2, y + s / 2]], { color: c, width: o.width || s * 0.16, progress: clamp(pr * 2), seed: 31, taper: 0.1, alpha: o.alpha ?? 1 }); this.ink([[x + s / 2, y - s / 2], [x - s / 2, y + s / 2]], { color: c, width: o.width || s * 0.16, progress: clamp(pr * 2 - 1), seed: 32, taper: 0.1, alpha: o.alpha ?? 1 }); },
      // A chat bubble drawn in ink. b: { x, y, text, side, tone, appear, typed, size, maxW, align, time, wash, line, textColor }
      bubble(bb) { f.withLayer((c) => { bubbles.drawBubble(c, bb, t); }, { cam: false }); },
      // A voice note with the line's real waveform. o: { x, y, w, h, line, side, initials, appear, name, n }
      voiceNote(o) { f.withLayer((c) => { drawVoiceNote(c, { t, tone: w.mode === 'light' ? 'night' : 'paper', ...o }); }, { cam: false }); },
      // A notification card. o: { x, y, w, h, title, body, time, appear, alpha, icon (appui icon name) }
      notif(o = {}) {
        const ap = clamp(o.appear ?? 1); if (ap <= 0) return; const ww = o.w || 820, hh = o.h || 150;
        f.withLayer((c) => {
          c.save(); c.translate(o.x ?? 540, (o.y ?? 400) + (1 - ease.outBack(ap, 1.5)) * -90); c.globalAlpha *= clamp(ap * 3) * (o.alpha ?? 1);
          c.shadowColor = 'rgba(20,17,14,0.25)'; c.shadowBlur = 30; c.shadowOffsetY = 12; c.fillStyle = 'rgba(254,253,252,0.97)'; rr(c, -ww / 2, -hh / 2, ww, hh, 36); c.fill(); c.shadowColor = 'transparent';
          c.fillStyle = b.colors.accent; rr(c, -ww / 2 + 24, -hh / 2 + 24, hh - 48, hh - 48, 22); c.fill();
          appui.icon(c, o.icon || 'chat', -ww / 2 + 24 + (hh - 48) * 0.2, -hh / 2 + 24 + (hh - 48) * 0.2, (hh - 48) * 0.6, b.colors.accent_ink, 2);
          c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillStyle = b.colors.ink; c.font = F(600, hh * 0.24, 'body'); c.fillText(o.title || 'New message', -ww / 2 + hh, -hh * 0.16);
          c.fillStyle = b.colors.muted; c.font = F(400, hh * 0.21, 'body'); c.fillText(o.body || '', -ww / 2 + hh, hh * 0.19);
          c.font = F(400, hh * 0.17, 'body'); c.textAlign = 'right'; c.fillText(o.time || 'now', ww / 2 - 28, -hh * 0.16);
          c.restore();
        }, { cam: false });
      },
      // A rolling number. o: { x, y, from, to, at, dur, size, prefix, suffix, color, sep }
      counter(o = {}) {
        const k = ease.outCubic(clamp((lt - (o.at || 0)) / (o.dur || 0.9))); const v = Math.round(lerp(o.from || 0, o.to || 0, k));
        const txt = (o.prefix || '') + String(v).replace(/\B(?=(\d{3})+(?!\d))/g, o.sep ?? ',') + (o.suffix || '');
        this.text(txt, { x: o.x, y: o.y, size: o.size || 160, color: o.color, weight: o.weight || 800, in: { at: o.in ?? 0, dur: 0.01, kind: 'none' }, alpha: o.alpha ?? 1 });
      },
      // Big kinetic text: the words of a spoken line appear on their own timestamps; *emphasised* words land
      // bigger, with a shake and the accent colour.
      // o: { x, y, size, weight, maxW, lh, hotColor, color, until (s, absolute), hold, outDur, shadow, halo }
      kinetic(id, o = {}) {
        const line = tl.L(id); const size = o.size || 110; const weight = o.weight || 800; const maxW = o.maxW || 900; const lhp = (o.lh || 1.04) * size;
        const key = `${id}|${size}|${maxW}|${weight}`; let lay = kinCache.get(key);
        if (!lay) {
          ctx.save(); ctx.font = F(weight, size); const sp = ctx.measureText(' ').width; const ws = line.words.map((x) => ctx.measureText(x.text).width);
          const lines = []; let cur = [], cw = 0;
          line.words.forEach((x, i) => { const add = (cur.length ? sp : 0) + ws[i]; if (cw + add > maxW && cur.length) { lines.push({ items: cur, w: cw }); cur = []; cw = 0; } cw += (cur.length ? sp : 0) + ws[i]; cur.push(i); });
          if (cur.length) lines.push({ items: cur, w: cw });
          ctx.restore(); lay = { lines, ws, sp }; kinCache.set(key, lay);
        }
        if (!line.words.length || t < line.words[0].start - 0.05) return;
        const until = o.until ?? (line.end + (o.hold ?? 0.6)); const outK = clamp((t - until) / (o.outDur ?? 0.22)); if (outK >= 1) return;
        ctx.save(); f.setScreen(ctx); ctx.font = F(weight, size); ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
        // Keep the whole block inside the safe zone (y ≥ 262): a long line pushes its block down, never up.
        let yc = o.y ?? 700; const top = yc - ((lay.lines.length - 1) * lhp) / 2 - size * 0.55; const minTop = o.minTop ?? 262;
        if (top < minTop) yc += minTop - top;
        const y0 = yc - ((lay.lines.length - 1) * lhp) / 2 - outK * 46;
        lay.lines.forEach((ln, li) => {
          let x = (o.x ?? 540) - ln.w / 2;
          ln.items.forEach((wi) => {
            const wd = line.words[wi]; const a = clamp((t - (wd.start - 0.03)) / 0.16);
            if (a > 0) {
              const hot = wd.emphasis; const sc = hot ? lerp(1.55, 1, ease.outQuart(a)) : lerp(0.72, 1, ease.outBack(a, 1.8));
              const cx = x + lay.ws[wi] / 2, cy = y0 + li * lhp; const shk = hot && a < 1 ? (1 - a) * 6 : 0;
              ctx.save(); ctx.translate(cx + (hash(Math.floor(t * 60) + wi) - 0.5) * shk, cy + (hash(Math.floor(t * 60) + wi + 9) - 0.5) * shk); ctx.scale(sc, sc); ctx.globalAlpha = clamp(a * 3) * (1 - outK);
              const col = hot ? (o.hotColor || w.accent) : (o.color || w.text);
              if (o.halo) { ctx.lineJoin = 'round'; ctx.lineWidth = o.haloW || size * 0.15; ctx.strokeStyle = o.halo === true ? `rgb(${w.base.join(',')})` : o.halo; ctx.strokeText(wd.text, 0, 0); }
              if (o.shadow !== false && hot) { ctx.fillStyle = 'rgba(26,20,16,0.88)'; ctx.fillText(wd.text, 5, 6); }
              ctx.fillStyle = col; ctx.fillText(wd.text, 0, 0); ctx.restore();
            }
            x += lay.ws[wi] + lay.sp;
          });
        });
        ctx.restore();
      },
      // A list row drawn in ink (a booking, a task, an order...). o: { x, y (centre), w, h, left (e.g. a time),
      //   title, sub, state: 'on' | 'free' | 'cancelled' | 'waiting' | 'done', appear, alpha, rot, dy, scale, cross (0..1) }
      row(o = {}) {
        const ap = clamp(o.appear ?? 1); if (ap <= 0) return; const ww = o.w || 720, hh = o.h || 96; const st = o.state || 'on';
        f.withLayer((c) => {
          c.save(); c.translate(o.x ?? 540, (o.y ?? 900) + (o.dy || 0)); const sc = ease.outBack(ap, 1.7) * (o.scale || 1); c.scale(sc, sc); c.rotate(o.rot || 0); c.globalAlpha *= clamp(ap * 3) * (o.alpha ?? 1);
          const fill = { on: 'rgba(255,250,240,0.97)', done: 'rgba(255,250,240,0.97)', free: 'rgba(255,250,240,0.16)', cancelled: 'rgba(255,250,240,0.6)', waiting: 'rgba(26,20,16,0.92)' }[st];
          const line = st === 'waiting' ? '#fff4e2' : '#1a1410';
          c.fillStyle = fill; rr(c, -ww / 2, -hh / 2, ww, hh, hh * 0.24); c.fill();
          if (st === 'free') { c.save(); c.setLineDash([18, 12]); c.lineWidth = 4; c.strokeStyle = 'rgba(26,20,16,0.7)'; rr(c, -ww / 2, -hh / 2, ww, hh, hh * 0.24); c.stroke(); c.restore(); }
          else sketch(c, roundRectPts(-ww / 2, -hh / 2, ww, hh, hh * 0.24, 8), { width: 3.4, color: line, t, seed: Math.floor((o.x || 0) + (o.y || 0)) % 97 + 1, boil: 0.9, passes: 2, closed: true, spacing: 8 });
          if (st === 'on' || st === 'done') { c.fillStyle = st === 'done' ? b.colors.positive : b.colors.accent; rr(c, -ww / 2 + 10, -hh / 2 + 12, 12, hh - 24, 6); c.fill(); }
          c.textBaseline = 'middle'; c.textAlign = 'left';
          const ink = st === 'waiting' ? '#fff4e2' : st === 'free' ? 'rgba(26,20,16,0.75)' : '#1a1410';
          c.fillStyle = st === 'cancelled' ? 'rgba(26,20,16,0.45)' : ink; c.font = F(600, hh * 0.34, 'body'); c.fillText(o.left || '', -ww / 2 + 44, -hh * 0.02);
          c.font = F(600, hh * 0.36, 'body'); const nX = o.titleX ?? (-ww / 2 + 44 + hh * 1.55); c.fillText(o.title || (st === 'free' ? 'free' : ''), nX, o.sub ? -hh * 0.12 : hh * 0.02);
          if (o.sub) { c.font = F(400, hh * 0.25, 'body'); c.fillStyle = st === 'waiting' ? 'rgba(255,244,226,0.72)' : 'rgba(26,20,16,0.6)'; c.fillText(o.sub, nX, hh * 0.24); }
          if (st === 'cancelled' && (o.cross ?? 1) > 0) { const k = clamp(o.cross ?? 1); sketch(c, [[-ww / 2 + 30, -hh / 2 + 16], [ww / 2 - 30, hh / 2 - 16]], { width: 8, color: b.colors.negative, t, seed: 4, boil: 1, passes: 1, progress: clamp(k * 1.4), taper: 0.05 }); sketch(c, [[ww / 2 - 30, -hh / 2 + 16], [-ww / 2 + 30, hh / 2 - 16]], { width: 8, color: b.colors.negative, t, seed: 5, boil: 1, passes: 1, progress: clamp(k * 1.4 - 0.4), taper: 0.05 }); }
          c.restore();
        }, { cam: false });
      },
      // An ink stamp slammed at local time `at`. o: { x, y, rot, size, color, at, sub }
      stamp(label, o = {}) {
        const k = lt - (o.at || 0); if (k < 0) return;
        const inT = 0.11; const s = k < inT ? lerp(2.5, 1, ease.inQuad(k / inT)) : 1 + 0.06 * Math.exp(-(k - inT) * 18) * Math.cos((k - inT) * 60);
        const col = o.color || b.colors.negative; const size = o.size || 96;
        f.withLayer((c) => {
          c.save(); c.translate(o.x ?? 540, o.y ?? 900); c.rotate(o.rot ?? -0.1); c.scale(s, s); c.globalAlpha *= clamp(k / 0.05) * (o.alpha ?? 0.94);
          c.font = F(800, size); const tw = c.measureText(label).width; const ww = tw + 80, hh = size + 70;
          sketch(c, roundRectPts(-ww / 2, -hh / 2, ww, hh, 20, 6), { width: 9, color: col, t, seed: 3, closed: true, boil: 1.2, passes: 1, spacing: 6 });
          sketch(c, roundRectPts(-ww / 2 + 14, -hh / 2 + 14, ww - 28, hh - 28, 12, 6), { width: 3, color: col, t, seed: 4, closed: true, boil: 1, passes: 1, spacing: 6 });
          c.fillStyle = col; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(label, 0, 4);
          if (o.sub) { c.font = F(600, size * 0.3, 'mono'); c.fillText(o.sub, 0, hh / 2 - 6); }
          c.restore();
        }, { cam: false, tooth: 0.45 });
      },
      // A burst of ink dots from a point or along a rectangle. o: { x, y, n, at, dur, speed, r, color, rect }
      burst(o = {}) {
        const k = clamp((lt - (o.at || 0)) / (o.dur || 0.9)); if (k <= 0 || k >= 1) return; const n = o.n || 160; const col = o.color || w.col; const e = ease.outCubic(k);
        for (let i = 0; i < n; i++) {
          let x, y, dx, dy;
          if (o.rect) { const [x0, y0, x1, y1] = o.rect; const per = 2 * (x1 - x0 + y1 - y0); let d = (i / n) * per; if (d < x1 - x0) { x = x0 + d; y = y0; } else if ((d -= x1 - x0) < y1 - y0) { x = x1; y = y0 + d; } else if ((d -= y1 - y0) < x1 - x0) { x = x1 - d; y = y1; } else { d -= x1 - x0; x = x0; y = y1 - d; }
            dx = x - (x0 + x1) / 2; dy = y - (y0 + y1) / 2; const L_ = Math.hypot(dx, dy) || 1; dx /= L_; dy /= L_; }
          else { x = o.x ?? 540; y = o.y ?? 960; const a = hash(i * 3 + 1) * TAU; dx = Math.cos(a); dy = Math.sin(a); }
          const sp = (o.speed || 520) * (0.35 + hash(i * 7 + 2)); const save = f.cam; f.cam = f.homeCam();
          if (w.mode === 'light') f.dotLight(x + dx * sp * e + (hash(i) - 0.5) * 18, y + dy * sp * e + (hash(i + 5) - 0.5) * 18 + 90 * k * k, (o.r || 2.6) * (0.6 + hash(i * 5)), (1 - k) * 1.2, col);
          else f.dotInk(x + dx * sp * e + (hash(i) - 0.5) * 18, y + dy * sp * e + (hash(i + 5) - 0.5) * 18 + 90 * k * k, (o.r || 2.6) * (0.6 + hash(i * 5)), (1 - k) * 0.95, col);
          f.cam = save;
        }
        this.flush();
      },
      // Head-and-shoulders icon in ink. o: { s, color, alpha }
      person(x, y, o = {}) {
        const s = o.s || 100; f.withLayer((c) => { c.save(); c.globalAlpha *= o.alpha ?? 1; c.fillStyle = o.color || w.text; c.beginPath(); c.arc(x, y - s * 0.34, s * 0.24, 0, TAU); c.fill(); c.beginPath(); c.moveTo(x - s * 0.5, y + s * 0.5); c.quadraticCurveTo(x - s * 0.5, y - s * 0.02, x, y - s * 0.02); c.quadraticCurveTo(x + s * 0.5, y - s * 0.02, x + s * 0.5, y + s * 0.5); c.closePath(); c.fill(); c.restore(); }, { cam: false });
      },
      // An initials avatar (a stand-in for a person or a brand character). o: { size, initials, ring, alpha }
      avatar(x, y, o = {}) {
        const s = o.size || 160; f.withLayer((c) => { c.save(); c.globalAlpha *= o.alpha ?? 1; c.beginPath(); c.arc(x, y, s / 2, 0, TAU); c.fillStyle = b.colors.accent; c.fill();
          c.fillStyle = b.colors.accent_ink; c.font = F(800, s * 0.4); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(o.initials || 'A', x, y + s * 0.03);
          if (o.ring) { c.lineWidth = Math.max(3, s * 0.05); c.strokeStyle = o.ring; c.beginPath(); c.arc(x, y, s / 2, 0, TAU); c.stroke(); } c.restore(); }, { cam: false });
      },
      // Paper rising from the bottom (a transition to the same or another world). p 0..1.
      wipe(p, o = {}) {
        if (p <= 0) return; const e = wipeEdge(p, t, o.seed || 3); ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(f.s, f.s); pathBelowEdge(ctx, e); ctx.clip();
        const set = o.world === 'night' ? cardPapers.night : o.world === 'paper' ? cardPapers.paper : papers; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(set[Math.floor(t * 12) % 3], 0, 0);
        ctx.restore(); return e;
      },
      // A hand-with-phone shot: the camera moves from the whole plate to its screen and the app is drawn inside.
      // o: { Z (final zoom), yScreen (frame y of the screen centre), at, dur, seed, wind, appear, rot: false, alpha, draw(c, t, h) }
      phoneShot(name, place, o = {}) {
        const S = this.placed(name, place), s = S.screen, Z = o.Z ?? 1.6, k = this.p(o.at ?? 0, o.dur ?? 0.5, 'inOutCubic'); const yOff = (o.yScreen ?? 1140) - 960;
        this.cam({ x: lerp(540, s.cx, k), y: lerp(960, s.cy - yOff / Z, k), z: lerp(1.0, Z, k), r: o.rot === false ? 0 : -s.rot * k });
        this.plate(name, { ...place, seed: o.seed ?? 11, appear: this.p(-0.2, o.appear ?? 0.3), wind: o.wind ?? 0.9 });
        if (o.draw) this.screen(S, o.draw, { alpha: o.alpha ?? 1 });
        return S;
      },
      // Tap ripple on screen. o: { at, color, r }
      tap(x, y, o = {}) {
        const k = clamp((lt - (o.at || 0)) / 0.55); if (k <= 0 || k >= 1) return; f.withLayer((c) => { c.strokeStyle = o.color || b.colors.accent; c.lineWidth = 8 * (1 - k) + 1; c.globalAlpha *= 1 - k; c.beginPath(); c.arc(x, y, (o.r || 90) * ease.outCubic(k), 0, TAU); c.stroke(); }, { cam: false });
      },
      // Damped camera shake from local t0: returns { x, y } to add to the camera.
      shake(t0, amp = 10, decay = 9) { const k = lt - t0; if (k < 0) return { x: 0, y: 0 }; const a = amp * Math.exp(-k * decay); return { x: (hash(Math.floor(t * 60)) - 0.5) * 2 * a, y: (hash(Math.floor(t * 60) + 7) - 0.5) * 2 * a }; },
    };
    return u;
  }

  // The end card: paper rises from below, then the dots gather into the logo (shared end card).
  function drawCard(f, t) {
    const wp = clamp((t - cardStart) / WIPE); if (wp <= 0) return;
    const { ctx } = f; const dark = cardWorld.mode === 'light';
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.scale(f.s, f.s);
    if (wp < 1) { const e = wipeEdge(wp, t, 5); pathBelowEdge(ctx, e); ctx.clip(); }
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage((dark ? cardPapers.night : cardPapers.paper)[Math.floor(t * 12) % 3], 0, 0);
    ctx.restore();
    if (t >= card.start()) card.draw(f, t, {});
    // An ink line on the rising paper edge.
    if (wp < 1 && wp > 0.02) { const e = wipeEdge(wp, t, 5); const pts = []; for (let i = 0; i <= 30; i++) { const x = -20 + (i / 30) * 1120; pts.push([x, e(x)]); } f.withLayer((c) => { sketch(c, pts, { width: 5, color: dark ? mixHex(b.colors.accent, '#ffffff', 0.35) : b.colors.ink, t, seed: 9, boil: 1.2, passes: 1, taper: 0.02, spacing: 12 }); }, { cam: false }); }
  }

  return {
    get duration() { configure(); return tl.duration; },
    get events() { configure(); return events.map((e) => ({ ...e })); },
    get endCardStart() { configure(); return cardStart; },
    get posterTime() { configure(); return cfg.posterTime; },
    get cfg() { configure(); return cfg; },
    async init(env) {
      configure();
      if (papers) return;
      await loadLogos(b);
      await P.loadPlates(cfg.plates || []);
      if (card) await card.init();
      const Wp = Math.round(env.width * env.scale), Hp = Math.round(env.height * env.scale);
      const WORLDS = makeWorlds(b);
      papers = mkPapers(world, Wp, Hp);
      cardPapers = { paper: world === WORLDS.paper ? papers : mkPapers(WORLDS.paper, Wp, Hp), night: world.mode === 'light' ? papers : mkPapers(WORLDS.night, Wp, Hp) };
      if (cfg.init) await cfg.init({ P, env });
    },
    render(f, t) {
      f.cam = f.homeCam();
      let drew = false;
      for (const s of scenes) {
        if (t >= s.at && t < s.to) { s.draw(makeU(f, t, s)); drew = true; f.setScreen(f.ctx); f.cam = f.homeCam(); }
      }
      if (!drew) makeU(f, t, { at: 0 }).paper();
      if (capDraw && process.env.WB_CAPTIONS !== '0' && !(card && t >= cardStart + WIPE)) capDraw(f, t);
      if (card) drawCard(f, t);
      f.setScreen(f.ctx);
      const post = { ...world.post }; if (card && t >= cardStart + WIPE && cardWorld !== world) Object.assign(post, cardWorld.post);
      f.finish(post);
    },
  };
}

module.exports = { defineEpisode, makeWorlds };
