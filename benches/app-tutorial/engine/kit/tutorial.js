'use strict';
// The tutorial kit. A short film.js declares what the phone shows and when, anchored to the voice:
//
//   module.exports = ({ W, L, focus, sfx }) => ({
//     shots:  [ { at: 0, cap: 'reminders/01-home', chip: 'Your app' },
//               { at: W('L02', 'Settings').start, cap: 'reminders/03-settings', trans: 'push' } ],
//     taps:   [ { at: W('L02', 'tap').start, el: 'Settings' } ],
//     marks:  [ { at: 5, to: 7, el: 'Reminders', kind: 'ring' } ],          // ring | spot
//     loupes: [ { at: 8, to: 10, el: '@preview', zoom: 2 } ],
//     labels: [ { at: 9, to: 11, text: 'Goes out at 9:00', el: 'Save', side: 'above' } ],
//     over:   [ { at: 20, to: 24, draw(u) { ... } } ],                     // anything drawn outside the phone
//                                                  (under: true behind the phone, top: true above the captions)
//     phone:  [ { t: 0 }, focus('reminders/03-settings', 'Reminders', { t: 6, until: 8, z: 1.6 }), { t: 8.6 } ],
//   });
//
// The phone shows real captures of the app (captures/<flow>/<NN-name>.png at 3x) or a screen drawn in code
// (shot.draw). Taps, rings, loupes and labels are placed with the measured rectangles of each capture, so they land
// exactly on the element, and they follow the camera. Captions come from the voice, word by word. The brand end card
// closes the film.
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('./canvas');
const { clamp, ease, lerp, smoothstep } = require('./math');
const { loadTimeline } = require('./timeline');
const { loadBrand, loadBrandImages, drawLockup } = require('./brand');
const { makeCaptures, union, pad } = require('./captures');
const D = require('./device');
const { makeCaptions } = require('./captions');
const { ZONES, drawGuides } = require('./zones');

const rr = D.rr;
const SCREEN_BG = '#f8f8f7';

function defineTutorial(pieceDir, build, ext = {}) {
  const dir = path.resolve(pieceDir);
  const TLM = loadTimeline(dir); const { L, W, Wi } = TLM;
  const T = { duration: TLM.duration, lastEnd: TLM.lastEnd, ids: TLM.ids };
  const brand = loadBrand(dir); const C = brand.C; const font = brand.font;
  const caps = makeCaptures(dir);
  const script = JSON.parse(fs.readFileSync(path.join(dir, 'script.json'), 'utf8'));
  const fps = (script.format && script.format.fps) || TLM.tl.fps || 30;
  const REEL = process.env.WB_REEL === '1';
  const sfx = (t, name, gain_db = -18, o = {}) => ({ t, name, gain_db, ...o });
  const cfg0 = {};

  // A camera key that brings a measured element of a capture to (x, y) of the frame:
  //   phone: [{ t: 0 }, focus('flow/05-x', 'Save', { t: 12, until: 14, z: 1.7 }), { t: 14.6 }]
  // It arrives at t (moving for `dur`, 0.6 s by default), holds until `until`, and the next key takes it back
  // ({ t } alone is the full shot). The zoom is capped so the element fits between the platform buttons;
  // z ≈ 1.3–1.8 keeps app text readable on a phone.
  const focus = (cap, q, o = {}) => {
    const m = caps.meta(cap); const e = caps.find(cap, q); const y0 = o.mode === 'browser' ? D.BROWSER_TOP * m.vw / 393 : 0;
    const k = ((cfg0.phoneBase && cfg0.phoneBase.sw) || 556) / m.vw; const z = Math.min(o.z ?? 1.6, 820 / ((e.w + 14) * k));
    const fx = e.x + e.w / 2 + (o.dx || 0);
    let tx = o.x;   // centred, without the zoomed phone leaving the frame (40 px margin on each side)
    if (tx == null) { const lo = 40 + fx * k * z, hi = 1040 - (m.vw - fx) * k * z; tx = lo <= hi ? Math.min(Math.max(540, lo), hi) : 540; }
    const key = { t: o.t, dur: o.dur ?? 0.6, z, fx, fy: y0 + e.y + e.h / 2 + (o.dy || 0), tx, ty: o.y ?? 900 };
    return o.until != null ? [key, { ...key, t: o.until, dur: undefined }] : key;
  };

  const base = { L, W, Wi, T, sfx, focus, rect: caps.rect, union, pad, scrollOf: caps.scrollOf, find: caps.find, seq: caps.seq,
    ease, clamp, lerp, smoothstep, rr, brand, C, font, script, dir, reel: REEL };
  const api = { ...base, ...(typeof ext.api === 'function' ? ext.api(base) : ext.api || {}) };
  // ext.decorate lets a bench add overlays or defaults to every film it renders (the story bench adds its header).
  const built = build(api); const cfg = ext.decorate ? ext.decorate(built, api) : built; Object.assign(cfg0, cfg);

  const events = [...(cfg.events || [])];
  const cardOn = cfg.card === false ? false : cfg.card ? true : ext.cardDefault ?? true;
  const cardCfg = cardOn ? { ...(typeof cfg.card === 'object' ? cfg.card : {}) } : null;
  if (cardCfg) cardCfg.lock = cardCfg.lock ?? (T.lastEnd + 1.45);
  const cardStart = cardCfg ? cardCfg.lock - 1.25 : Infinity;
  if (cardCfg) { events.push(sfx(cardStart + 0.1, 'whoosh', -24)); events.push(sfx(cardCfg.lock - 0.95, 'logo', -13)); }

  // Shots, completed with their mode, transition and duration.
  const shots = (cfg.shots || []).map((s, i) => ({ trans: i === 0 ? 'none' : 'push', dur: 0.42, mode: 'app', ...s })).sort((a, b) => a.at - b.at);
  for (const s of shots) if (s.fixed && !s.fullId) s.fullId = s.cap + '.full';
  const taps = cfg.taps || []; const marks = cfg.marks || []; const loupes = cfg.loupes || []; const over = cfg.over || []; const labels = cfg.labels || [];
  for (const tp of taps) if (tp.sound !== false) events.push(sfx(tp.at, tp.sound || 'tap', tp.gain ?? -20));
  for (const s of shots) if (s.sound) events.push(sfx(s.at, s.sound, s.gain ?? -24));
  const phoneKeys = (cfg.phone || [{ t: 0 }]).flat().sort((a, b) => a.t - b.t);
  const PH = { cx: 540, top: 548, sw: 556, ...(cfg.phoneBase || {}) };

  // While the camera rests, the phone drifts in very slowly (0.4% per second, up to 3%); the next camera move takes
  // the drift back out with its own easing. On a phone, a frame that does not move for a second reads as stopped.
  const DRIFT = cfg.drift === false ? 0 : (cfg.drift ?? 0.004), DRIFT_MAX = 0.03;
  const geoKeys = ['cx', 'top', 'sw', 'alpha', 'z', 'fx', 'fy', 'tx', 'ty'];
  const segments = (() => {
    const ks = phoneKeys; const segs = [];
    for (let i = 0; i < ks.length - 1; i++) {
      const A = { ...PH, alpha: 1, z: 1, ...ks[i] }, B = { ...PH, alpha: 1, z: 1, ...ks[i + 1] };
      const same = geoKeys.every((k) => (A[k] ?? null) === (B[k] ?? null));
      if (same) { segs.push({ rest: true, from: A.t, to: B.t }); continue; }
      const t0 = Math.max(A.t, B.t - (B.dur ?? (B.t - A.t)));
      if (t0 > A.t) segs.push({ rest: true, from: A.t, to: t0 });
      segs.push({ rest: false, from: t0, to: B.t });
    }
    segs.push({ rest: true, from: ks[ks.length - 1].t, to: Infinity });
    let since = -Infinity; for (const s of segs) { if (s.rest) { if (since === -Infinity) since = s.from; s.since = since; } else since = -Infinity; }
    return segs;
  })();
  // a story that opens on the previous story's last frame also starts with its drift (phone key 0: { drift })
  const DRIFT0 = Math.max(0, (phoneKeys[0].drift || 1) - 1); const firstRest = segments[0].rest ? segments[0].since : null;
  function driftAt(t) {
    if (!DRIFT && !DRIFT0) return 1;
    const at = (x, since) => Math.min(DRIFT_MAX, (since === firstRest ? DRIFT0 : 0) + DRIFT * Math.max(0, x));
    const i = segments.findIndex((s) => t >= s.from && t < s.to); const s = segments[i < 0 ? 0 : i];
    if (t < segments[0].from) return 1 + DRIFT0;
    if (s.rest) return 1 + at(t - s.since, s.since);
    const prev = segments[i - 1]; const d0 = prev && prev.rest ? at(s.from - prev.since, prev.since) : 0;
    return 1 + d0 * (1 - ease.inOutCubic(clamp((t - s.from) / Math.max(0.001, s.to - s.from))));
  }
  const DRIFT_X = 540, DRIFT_Y = 1000;

  function shotAt(t) { let k = -1; for (let i = 0; i < shots.length; i++) if (shots[i].at <= t) k = i; return k; }
  function capOf(s, t) {   // image shown by a shot at t (sequences included)
    if (s.seq) { const ids = s._seq; const dt = s.dt || 0.1; const i = Math.min(ids.length - 1, Math.max(0, Math.floor((t - s.at - (s.seqDelay || 0)) / dt))); return ids[i]; }
    return s.cap;
  }
  function devOf(s) {   // device size (CSS px) and where the capture sits inside it
    if (s.draw) return { w: s.w || 393, h: s.h || 852, y0: 0, ch: s.h || 852 };
    const m = caps.meta(s.cap || s._seq[0]);
    if (s.mode === 'browser') return { w: m.vw, h: 852 * m.vw / 393, y0: D.BROWSER_TOP, ch: m.vh };
    return { w: m.vw, h: m.vh, y0: 0, ch: m.vh };
  }
  function phoneAt(t) {   // interpolates the phone keys
    const ks = phoneKeys; let a = ks[0], b = ks[ks.length - 1];
    for (let i = 0; i < ks.length - 1; i++) if (t >= ks[i].t && t <= ks[i + 1].t) { a = ks[i]; b = ks[i + 1]; break; }
    const A = { ...PH, alpha: 1, z: 1, fx: null, fy: null, u: a.fx != null || a.fy != null ? 1 : 0, ...a };
    const B = { ...PH, alpha: 1, z: 1, fx: null, fy: null, u: b.fx != null || b.fy != null ? 1 : 0, ...b };
    if (t <= a.t || a === b) return A;
    const t0 = Math.max(a.t, b.t - (b.dur ?? (b.t - a.t))); const k = ease.inOutCubic(clamp((t - t0) / Math.max(0.001, b.t - t0)));   // arrives at b.t
    const lp = (p) => (A[p] == null || B[p] == null ? (B[p] ?? A[p]) : lerp(A[p], B[p], k));
    return { cx: lp('cx'), top: lp('top'), sw: lp('sw'), alpha: lp('alpha'), z: lp('z'), fx: lp('fx'), fy: lp('fy'), tx: lp('tx'), ty: lp('ty'), u: lp('u') };
  }
  function geom(t, dev) {   // device CSS px → frame px
    const P = phoneAt(t); const k = P.sw / dev.w;
    return { k, left: P.cx - P.sw / 2, top: P.top, sw: P.sw, sh: dev.h * k, alpha: P.alpha, z: P.z || 1, fx: P.fx, fy: P.fy, tx: P.tx, ty: P.ty, u: P.u || 0, d: driftAt(t) };
  }
  // Camera: the focus point (fx, fy in device px) moves to (tx, ty) of the frame and the phone scales z around it.
  // u carries the focus from 0 to 1 together with the zoom, so entering and leaving a push-in never jumps.
  function pivot(G, dev) {
    const px = G.left + (G.fx ?? dev.w / 2) * G.k, py = G.top + (G.fy ?? dev.h / 2) * G.k;
    return { px, py, qx: px + G.u * ((G.tx ?? px) - px), qy: py + G.u * ((G.ty ?? py) - py) };
  }
  const zoomed = (G) => G.z !== 1 || (G.u > 0 && (G.tx != null || G.ty != null));
  function toFrame(G, dev, x, y) {
    let X = G.left + x * G.k, Y = G.top + y * G.k;
    if (zoomed(G)) { const P = pivot(G, dev); X = P.qx + (X - P.px) * G.z; Y = P.qy + (Y - P.py) * G.z; }
    if (G.d && G.d !== 1) { X = DRIFT_X + (X - DRIFT_X) * G.d; Y = DRIFT_Y + (Y - DRIFT_Y) * G.d; }
    return [X, Y];
  }

  // ---------------------------------------------------------------------------------------------- captions
  let captions = null;

  // ---------------------------------------------------------------------------------------------- screens
  // Paints a capture into the device (CSS px). o: { mode, url, sy (scroll), full, top, barBg, mask }
  function paintCap(c, id, dev, o = {}) {
    const m = caps.meta(id); const im = caps.image(id);
    const sc = dev.w / m.vw; const sy = o.sy || 0; const y0 = o.mode === 'browser' ? D.BROWSER_TOP * dev.w / 393 : 0; const dpr = im.width / m.vw;   // density comes from the image
    if (o.mode === 'browser') {
      c.fillStyle = o.top || '#f8f8f7'; c.fillRect(0, 0, dev.w, y0);
      c.save(); c.beginPath(); c.rect(0, y0, dev.w, m.vh * sc); c.clip();
      c.drawImage(im, 0, sy * dpr, im.width, m.vh * dpr, 0, y0, dev.w, m.vh * sc); c.restore();
    } else if (o.full || sy) c.drawImage(im, 0, sy * dpr, im.width, m.vh * dpr, 0, 0, dev.w, m.vh * sc);
    else c.drawImage(im, 0, 0, im.width, im.height, 0, 0, dev.w, (im.height / dpr) * sc);
    // cover something (a promo line, a test banner) with the page's own colour
    if (o.mask) for (const mk of o.mask) { c.fillStyle = mk.color && mk.color !== 'auto' ? mk.color : caps.sample(im, (mk.sx ?? mk.x + 2) * dpr, (mk.sy ?? mk.y + 2) * dpr); c.fillRect(mk.x * sc, y0 + mk.y * sc, mk.w * sc, mk.h * sc); }
    if (o.mode === 'browser') D.browserBar(c, dev.w, dev.h, o.url || brand.url, { bg: o.barBg, font });
  }
  function scrollAt(s, t) {   // scroll offset (CSS px) of a shot with scroll keys [{ t, y }]
    if (!s.scroll) return 0; const ks = s.scroll; let sy = ks[0].y;
    for (let i = 0; i < ks.length - 1; i++) if (t >= ks[i].t) sy = lerp(ks[i].y, ks[i + 1].y, ease.inOutCubic(clamp((t - ks[i].t) / (ks[i + 1].t - ks[i].t))));
    if (t >= ks[ks.length - 1].t) sy = ks[ks.length - 1].y; return sy;
  }
  // A page that scrolls under a fixed header and a fixed bottom bar. fixed = [f0, f1] (CSS px): above f0 is the header,
  // from f1 down the fixed bottom elements. The moving content comes from the full-page capture (cap + '.full'),
  // the header and the bar from the viewport capture; `until` cross-fades them to the capture where the scroll ends.
  function paintScroll(c, s, id, dev, sy) {
    const m = caps.meta(id); const imB = caps.image(id); const imF = caps.image(s.fullId); const dpr = imB.width / m.vw; const sc = dev.w / m.vw;
    const [f0] = s.fixed; const y0 = m.scrollY || 0; const B = s.bar || { x: 12, y: m.vh - 92, w: m.vw - 24, h: 64, r: 22 };
    const yF = (f0 + y0 + sy) * dpr, hF = Math.min((m.vh - f0) * dpr, imF.height - yF);
    c.drawImage(imF, 0, yF, imF.width, hF, 0, f0 * sc, dev.w, hF / dpr * sc);
    const fixedParts = (im, a) => {
      if (a <= 0.001) return; c.save(); c.globalAlpha *= a; c.drawImage(im, 0, 0, im.width, f0 * dpr, 0, 0, dev.w, f0 * sc);
      rr(c, B.x * sc, B.y * sc, B.w * sc, B.h * sc, B.r * sc); c.clip(); c.drawImage(im, 0, 0, im.width, im.height, 0, 0, dev.w, (im.height / dpr) * sc); c.restore();
    };
    const ks = s.scroll, ya = ks[0].y, yb = ks[ks.length - 1].y; const pr = yb !== ya ? clamp((sy - ya) / (yb - ya)) : 0;
    fixedParts(imB, 1); if (s.until) fixedParts(caps.image(s.until), pr);
  }
  function drawScreen(c, s, t, dev) {   // a shot's content in device CSS px
    if (s.draw) {
      const sapi = { at: s.at, lt: t - s.at, capture: (id, o = {}) => paintCap(c, id, dev, o), brand, C, font, rr, ease, clamp, lerp };
      if (s.mode === 'browser') {   // the drawn page sits between the status bar and the address bar
        const y0 = D.BROWSER_TOP * dev.w / 393, vh = dev.h - y0 - D.BROWSER_BAR; c.fillStyle = s.top || '#ffffff'; c.fillRect(0, 0, dev.w, y0);
        c.save(); c.beginPath(); c.rect(0, y0, dev.w, vh); c.clip(); c.translate(0, y0); s.draw(c, t, dev.w, vh, sapi); c.restore();
        D.browserBar(c, dev.w, dev.h, s.url || brand.url, { bg: s.barBg, font });
      } else s.draw(c, t, dev.w, dev.h, sapi);
      if (s.paint) s.paint(c, t, dev); return;
    }
    const id = capOf(s, t); const sy = scrollAt(s, t);
    if (s.fixed) { paintScroll(c, s, id, dev, sy); if (s.paint) s.paint(c, t, dev); return; }
    paintCap(c, id, dev, { mode: s.mode, url: s.url, sy, full: s.full, top: s.top, barBg: s.barBg, mask: s.mask });
    if (s.paint) s.paint(c, t, dev);
  }

  function drawPhone(f, t) {
    const i = shotAt(t); if (i < 0) return null;
    const s = shots[i]; const dev = devOf(s); const G = geom(t, dev); if (G.alpha <= 0.002) return { s, dev, G };
    const ctx = f.ctx; f.setScreen(ctx); const android = s.frame === 'android';
    ctx.save(); ctx.globalAlpha = G.alpha;
    if (G.d !== 1) { ctx.translate(DRIFT_X, DRIFT_Y); ctx.scale(G.d, G.d); ctx.translate(-DRIFT_X, -DRIFT_Y); }
    if (zoomed(G)) { const P = pivot(G, dev); ctx.translate(P.qx, P.qy); ctx.scale(G.z, G.z); ctx.translate(-P.px, -P.py); }
    const R = D.phoneBody(ctx, G, C, android);
    ctx.save(); rr(ctx, G.left, G.top, G.sw, G.sh, R); ctx.clip(); ctx.translate(G.left, G.top); ctx.scale(G.k, G.k);
    ctx.fillStyle = SCREEN_BG; ctx.fillRect(0, 0, dev.w, dev.h);
    const p = s.trans === 'none' || s.trans === 'cut' ? 1 : clamp((t - s.at) / s.dur); const prev = i > 0 ? shots[i - 1] : null;
    if (p < 1 && prev) {
      const e = ease.inOutCubic(p);
      if (s.trans === 'push' || s.trans === 'back') {   // the new screen slides over the old one, which recedes and dims
        const dirn = s.trans === 'push' ? 1 : -1;
        ctx.save(); ctx.translate(-dirn * dev.w * 0.3 * e, 0); drawScreen(ctx, prev, t, devOf(prev)); ctx.fillStyle = `rgba(0,0,0,${0.12 * e})`; ctx.fillRect(0, 0, dev.w, dev.h); ctx.restore();
        ctx.save(); ctx.translate(dirn * dev.w * (1 - e), 0); ctx.shadowColor = 'rgba(0,0,0,0.18)'; ctx.shadowBlur = 20; ctx.fillStyle = SCREEN_BG; ctx.fillRect(0, 0, dev.w, dev.h); ctx.shadowColor = 'transparent'; drawScreen(ctx, s, t, dev); ctx.restore();
      } else if (s.trans === 'sheet') {   // a sheet rises from the bottom over a dimmed screen
        drawScreen(ctx, prev, t, devOf(prev)); ctx.fillStyle = `rgba(0,0,0,${0.3 * e})`; ctx.fillRect(0, 0, dev.w, dev.h);
        ctx.save(); ctx.translate(0, dev.h * (1 - e)); drawScreen(ctx, s, t, dev); ctx.restore();
      } else if (s.trans === 'unsheet') {   // the sheet goes back down
        drawScreen(ctx, s, t, dev); ctx.fillStyle = `rgba(0,0,0,${0.3 * (1 - e)})`; ctx.fillRect(0, 0, dev.w, dev.h);
        ctx.save(); ctx.translate(0, dev.h * e); drawScreen(ctx, prev, t, devOf(prev)); ctx.restore();
      } else { drawScreen(ctx, prev, t, devOf(prev)); ctx.globalAlpha = e; drawScreen(ctx, s, t, dev); ctx.globalAlpha = 1; }   // fade
    } else drawScreen(ctx, s, t, dev);
    const dark = !!s.dark; const time = s.time || cfg.time;
    if (s.mode !== 'browser' && s.statusBg) { ctx.fillStyle = s.statusBg; ctx.fillRect(0, 0, dev.w, D.BROWSER_TOP); }
    if (android) { if (!s.noStatus) D.androidStatus(ctx, dev.w, { dark, time, font }); D.androidNav(ctx, dev.w, dev.h, dark); }
    else { if (!s.noStatus) D.statusBar(ctx, dev.w, { dark, time, font }); if (s.mode !== 'browser') D.homeIndicator(ctx, dev.w, dev.h, dark); }
    ctx.restore();
    D.phoneCamera(ctx, G, C, android);
    ctx.restore();
    drawChip(ctx, t, i, G);
    return { s, dev, G };
  }

  // Whose screen this is ("Your app", "Your customer's phone"): a pill above the phone that leaves as the camera pushes in.
  function drawChip(ctx, t, i, G) {
    const s = shots[i]; const prev = i > 0 ? shots[i - 1] : null; const txt = s.chip; const ptxt = prev && prev.chip; if (!txt && !ptxt) return;
    const k = txt === ptxt || (i === 0 && s.carried) ? 1 : clamp((t - s.at) / 0.35);   // a carried first shot keeps its label
    const one = (label, a) => {
      if (!label || a <= 0.001) return; ctx.save(); ctx.font = font(600, 32, 'body'); const tw = ctx.measureText(label).width; const w = tw + 60, h = 60;
      const top = toFrame(G, devOf(s), devOf(s).w / 2, 0)[1];
      const y = (cfg.chipY ?? (top - 64)) + (1 - a) * 8; ctx.globalAlpha = a * G.alpha * clamp(1 - (G.z - 1) / 0.08);
      ctx.shadowColor = 'rgba(30,30,40,0.10)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
      ctx.fillStyle = C.surface; rr(ctx, 540 - w / 2, y - h / 2, w, h, h / 2); ctx.fill(); ctx.shadowColor = 'transparent';
      ctx.fillStyle = C.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, 540, y + 1); ctx.restore();
    };
    if (k < 1 && ptxt) one(ptxt, 1 - ease.inOutCubic(clamp(k * 2)));
    one(txt, txt === ptxt ? 1 : ease.outCubic(clamp(k * 2 - 1)));
  }

  // The rectangle of an element in frame px, on the shot active at t (or shotIndex), camera included.
  function elRect(t, q, shotIndex) {
    const i = shotIndex ?? shotAt(t); const s = shots[i]; if (!s) throw new Error(`no shot at ${t.toFixed(2)} s`);
    const dev = devOf(s); const G = geom(t, dev);
    const direct = q && typeof q === 'object' && 'x' in q && 'w' in q; const inCap = direct && q.cap === true;   // a rect in capture px
    const id = s.draw ? null : capOf(s, t); const e = direct ? q : caps.find(id, q); const off = s.mode === 'browser' && (!direct || inCap) ? dev.y0 : 0;
    const sc = (direct && !inCap) || s.draw ? 1 : dev.w / caps.meta(id).vw;
    const dy = s.fixed && !direct && e.y >= s.fixed[0] && e.y < s.fixed[1] ? -scrollAt(s, t) : 0;   // the band that scrolls
    const [x0, y0] = toFrame(G, dev, e.x * sc, off + (e.y + dy) * sc); const [x1, y1] = toFrame(G, dev, (e.x + e.w) * sc, off + (e.y + e.h + dy) * sc);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, r: (e.r || 12) * G.k * G.z * G.d, el: e, G, dev, s, id };
  }

  // A finger: a soft disc presses in, then a ripple spreads. It fades with the transition it causes and, after a cut,
  // follows the same button in its new state.
  function drawTaps(ctx, t) {
    for (const tp of taps) {
      const k = t - tp.at; if (k < -0.4 || k > 0.55) continue;
      let si = tp.shot ?? shotAt(tp.at); const cur = shotAt(t); let fade = 1;
      if (cur > si && cur >= 0) {
        if (shots[cur].trans === 'cut' && !(tp.el && typeof tp.el === 'object' && 'x' in tp.el)) { try { elRect(t, tp.el, cur); si = cur; } catch (e) { /* not there: stays */ } }
        else if (shots[cur].trans !== 'cut') fade = 1 - clamp((t - shots[cur].at) / 0.15);
      }
      if (fade <= 0) continue;
      let r; try { r = elRect(t, tp.el, si); } catch (e) { throw new Error(`tap at ${tp.at.toFixed(2)} s: ${e.message}`); }
      const zk = r.G.k * r.G.z * r.G.d; const x = r.x + r.w / 2 + (tp.dx || 0) * zk, y = r.y + r.h / 2 + (tp.dy || 0) * zk; const R0 = 21 * zk;
      const inA = smoothstep(-0.4, -0.15, k), outA = 1 - smoothstep(0.25, 0.5, k);
      const press = k < 0 ? lerp(1.25, 1, smoothstep(-0.4, -0.1, k)) : k < 0.12 ? lerp(1, 0.82, k / 0.12) : lerp(0.82, 1, clamp((k - 0.12) / 0.2));
      ctx.save(); ctx.globalAlpha = inA * outA * fade;
      ctx.fillStyle = 'rgba(30,30,36,0.28)'; ctx.beginPath(); ctx.arc(x, y, R0 * press, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 2.4; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.stroke();
      if (k > 0) { const rk = clamp(k / 0.5); ctx.globalAlpha = (1 - rk) * 0.55 * fade; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(30,30,36,0.55)'; ctx.beginPath(); ctx.arc(x, y, R0 * (1 + rk * 1.4), 0, Math.PI * 2); ctx.stroke(); }
      ctx.restore();
    }
  }

  // A ring that draws itself around an element (ring), or a dimmed screen with the element left clear (spot).
  function drawMarks(ctx, t) {
    for (const mk of marks) {
      if (t < mk.at - 0.02 || t > mk.to + 0.35) continue;
      const si = mk.shot ?? shotAt(mk.at); const r = elRect(t, mk.el, si); const pd = (mk.pad ?? 6) * r.G.k * r.G.z * r.G.d;
      let fade = 1; const cur = shotAt(t);   // after a cut, if the element moved or changed size, the ring leaves
      if (cur > si && shots[cur].trans === 'cut' && !(mk.el && typeof mk.el === 'object' && 'x' in mk.el)) {
        try { const b = elRect(t, mk.el, cur); if (Math.abs(b.y - r.y) > 4 || Math.abs(b.h - r.h) > 4) fade = 1 - clamp((t - shots[cur].at) / 0.1); } catch (e) { /* gone: keep */ }
      }
      if (fade <= 0) continue;
      const a = smoothstep(mk.at, mk.at + 0.3, t) * (1 - smoothstep(mk.to, mk.to + 0.3, t)) * fade;
      const x = r.x - pd, y = r.y - pd, w = r.w + pd * 2, h = r.h + pd * 2, rad = mk.r != null ? mk.r * r.G.k * r.G.z * r.G.d : r.r + pd;
      if (mk.kind === 'spot') {
        const [px0, py0] = toFrame(r.G, r.dev, 0, 0), [px1, py1] = toFrame(r.G, r.dev, r.dev.w, r.dev.h);
        ctx.save(); rr(ctx, px0, py0, px1 - px0, py1 - py0, 55 * r.G.k * r.G.z * r.G.d); ctx.clip();
        ctx.fillStyle = `rgba(14,14,18,${0.5 * a})`; ctx.beginPath(); ctx.rect(0, 0, 1080, 1920); ctx.roundRect(x, y, w, h, rad); ctx.fill('evenodd'); ctx.restore();
      }
      if (mk.kind !== 'spot' || mk.ring !== false) {
        const dr = ease.outCubic(smoothstep(mk.at, mk.at + 0.45, t)); const per = 2 * (w + h);
        ctx.save(); ctx.globalAlpha = a; ctx.lineWidth = mk.width || 5; ctx.strokeStyle = mk.color || C.accent; ctx.lineCap = 'round';
        ctx.setLineDash([per * dr, per]); rr(ctx, x, y, w, h, rad); ctx.stroke(); ctx.restore();
      }
    }
  }

  // A loupe: the element's pixels lift off the screen into a larger card.
  function drawLoupes(ctx, t) {
    for (const lp of loupes) {
      if (t < lp.at || t > lp.to + 0.4) continue;
      const r = elRect(lp.at, lp.el, lp.shot); const m = caps.meta(r.id); const im = caps.image(r.id); const dpr = im.width / m.vw;
      const pd = lp.pad ?? 10; const e = r.el; const zoom = lp.zoom || 2; const off = r.s.mode === 'browser' ? 0 : 0;
      const src = { x: Math.max(0, e.x - pd), y: Math.max(0, e.y - pd) }; src.w = Math.min(m.vw - src.x, e.w + pd * 2); src.h = e.h + pd * 2;
      const dw = src.w * r.G.k * zoom, dh = src.h * r.G.k * zoom; const cxT = lp.x ?? 540; const cyT = lp.y ?? Math.min(Math.max(r.y + r.h / 2, 640), 1240);
      const kIn = ease.outBack(clamp((t - lp.at) / 0.42), 1.2), kOut = ease.inCubic(clamp((t - lp.to) / 0.35)); const k = kIn * (1 - kOut);
      const bx = lerp(r.x - pd * r.G.k, cxT - dw / 2, k), by = lerp(r.y - pd * r.G.k, cyT - dh / 2, k), bw = lerp(src.w * r.G.k, dw, k), bh = lerp(src.h * r.G.k, dh, k);
      const a = clamp((t - lp.at) / 0.12) * (1 - clamp((t - lp.to - 0.2) / 0.2)); const rad = 22 * (0.4 + 0.6 * k);
      ctx.save(); ctx.globalAlpha = a;
      ctx.shadowColor = 'rgba(30,30,40,0.28)'; ctx.shadowBlur = 36 * k; ctx.shadowOffsetY = 14 * k; ctx.fillStyle = C.surface; rr(ctx, bx, by, bw, bh, rad); ctx.fill(); ctx.shadowColor = 'transparent';
      ctx.save(); rr(ctx, bx, by, bw, bh, rad); ctx.clip(); ctx.drawImage(im, src.x * dpr, (src.y + off) * dpr, src.w * dpr, src.h * dpr, bx, by, bw, bh); ctx.restore();
      ctx.lineWidth = 3; ctx.strokeStyle = lp.color || C.accent; rr(ctx, bx, by, bw, bh, rad); ctx.stroke();
      ctx.restore();
    }
  }

  // A short label next to an element or at (x, y).
  function drawLabels(ctx, t) {
    for (const lb of labels) {
      if (t < lb.at || t > lb.to + 0.3) continue;
      const a = ease.outCubic(clamp((t - lb.at) / 0.3)) * (1 - clamp((t - lb.to) / 0.3));
      let x = lb.x ?? 540, y = lb.y ?? 1200;
      if (lb.el) { const r = elRect(t, lb.el, lb.shot ?? shotAt(lb.at)); x = lb.x ?? (r.x + r.w / 2); y = (lb.side === 'above' ? r.y - 46 : r.y + r.h + 46) + (lb.dy || 0); }
      const size = lb.size || 34; ctx.save(); ctx.font = font(600, size, 'body'); const tw = ctx.measureText(lb.text).width; const w = tw + 56, h = size + 30;
      x = Math.min(Math.max(x, w / 2 + 40), 920 - w / 2);
      ctx.globalAlpha = a; ctx.translate(x, y + (1 - a) * 10);
      ctx.shadowColor = 'rgba(30,30,40,0.22)'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 8; ctx.fillStyle = lb.bg || C.ink; rr(ctx, -w / 2, -h / 2, w, h, h / 2); ctx.fill(); ctx.shadowColor = 'transparent';
      ctx.fillStyle = lb.color || '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(lb.text, 0, 2);
      ctx.restore();
    }
  }

  function background(ctx) {
    ctx.fillStyle = C.background; ctx.fillRect(0, 0, 1080, 1920);
    const g = ctx.createRadialGradient(540, 1060, 120, 540, 1060, 1150); g.addColorStop(0, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 1080, 1920);
  }

  // Caption band: when the camera pushes in and the phone rises behind the captions, the background covers the top
  // again (opaque below the second caption row, then a 70 px fade) so the caption always reads clean.
  let BAND = null;
  function band(f, t) {
    if (cfg.captions === false || cfg.band === false) return;
    const i = shotAt(t); if (i < 0) return; const dev = devOf(shots[i]); const G = geom(t, dev); if (G.alpha <= 0.01) return;
    const capY = (cfg.captions && cfg.captions.y) || 372, capSize = (cfg.captions && cfg.captions.size) || 54;
    const solid = Math.round(capY + capSize * 1.22 + 16), H = solid + 70;
    const top = toFrame(G, dev, dev.w / 2, 0)[1]; const k = clamp((H - top) / 90) * G.alpha; if (k <= 0) return;
    if (!BAND) {
      BAND = createCanvas(Math.round(1080 * f.s), Math.round(H * f.s)); const c = BAND.getContext('2d'); c.scale(f.s, f.s); background(c);
      c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'destination-in'; const g = c.createLinearGradient(0, 0, 0, BAND.height);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(solid / H, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(0, 0, BAND.width, BAND.height);
    }
    const ctx = f.ctx; ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = k; ctx.drawImage(BAND, 0, 0); ctx.restore();
  }

  // Cover frame for the grid (WB_COVER='Title|Subtitle'): a band with the title instead of the captions, inside the
  // 3:4 crop the profile grid shows (y 240–1680).
  function cover(f, txt) {
    const [tit, sub] = txt.split('|'); const ctx = f.ctx;
    ctx.save(); ctx.font = font(800, 92); const words = tit.split(' '); const lines = []; let cur = '';
    for (const w of words) { const nx = cur ? cur + ' ' + w : w; if (ctx.measureText(nx).width > 900 && cur) { lines.push(cur); cur = w; } else cur = nx; }
    lines.push(cur); ctx.restore();
    const yLast = 340 + (lines.length - 1) * 104, hB = (sub ? yLast + 92 : yLast) + 64, H = hB + 90;
    const cv = createCanvas(Math.round(1080 * f.s), Math.round(H * f.s)); const c = cv.getContext('2d'); c.scale(f.s, f.s); background(c);
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'destination-in'; const g = c.createLinearGradient(0, 0, 0, cv.height); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(hB / H, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(0, 0, cv.width, cv.height);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(cv, 0, 0); ctx.restore();
    f.setScreen(ctx); ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = C.ink; ctx.font = font(800, 92);
    lines.forEach((l, i) => ctx.fillText(l, 540, 340 + i * 104));
    if (sub) { ctx.font = font(600, 48); ctx.fillStyle = C.accentText; ctx.fillText(sub, 540, yLast + 92); }
    ctx.restore();
  }

  // End card: the background covers everything, the lockup lands, then one line and the address.
  function drawCard(f, t) {
    const ctx = f.ctx; const k = clamp((t - cardStart) / 0.45); if (k <= 0) return;
    f.setScreen(ctx); ctx.save(); ctx.globalAlpha = ease.inOutCubic(k); background(ctx); ctx.restore();
    if (k < 1) return;
    // once it has landed the card keeps a slow push (about 1% a second), so the hold never reads as a frozen frame
    const push = 1 + 0.035 * ease.inOutCubic(clamp((t - cardCfg.lock - 0.6) / 3.5));
    ctx.save(); ctx.translate(540, 900); ctx.scale(push, push); ctx.translate(-540, -900);
    drawLockup(ctx, brand, t, cardCfg.lock, { cy: 800, big: 280, size: 150 });
    const ca = smoothstep(cardCfg.lock + 0.9, cardCfg.lock + 1.25, t); if (ca <= 0) { ctx.restore(); return; }
    const line = cardCfg.line ?? brand.tagline; const url = cardCfg.url ?? brand.url; const rows = String(line || '').split('\n').filter(Boolean);
    ctx.save(); ctx.textAlign = 'center'; ctx.globalAlpha = ca; const rise = (1 - ease.outCubic(ca)) * 16;
    ctx.font = font(600, 46); ctx.fillStyle = C.ink; rows.forEach((s, i) => ctx.fillText(s, 540, 1040 + i * 58 + rise));
    ctx.globalAlpha = smoothstep(cardCfg.lock + 1.15, cardCfg.lock + 1.5, t); ctx.font = font(600, 38); ctx.fillStyle = C.accentText;
    if (url) ctx.fillText(url, 540, 1040 + rows.length * 58 + 44);
    ctx.restore(); ctx.restore();
  }

  // Moments worth a still in review: each screen once it has settled, the middle of each ring, each tap, the card.
  function moments() {
    const out = [];
    shots.forEach((s, i) => { const nx = shots[i + 1] ? shots[i + 1].at : T.duration; out.push([Math.min(s.at + 0.5, (s.at + nx) / 2), `shot ${i} ${String(s.cap || s.seq || 'drawn').split('/').pop()}`]); });
    marks.forEach((m) => out.push([(m.at + 0.3 + m.to) / 2, `ring ${typeof m.el === 'string' ? m.el : (m.el && (m.el.q || m.el.name)) || 'rect'}`]));
    taps.forEach((tp) => out.push([tp.at + 0.05, `tap ${typeof tp.el === 'string' ? tp.el : (tp.el && (tp.el.q || tp.el.name)) || 'rect'}`]));
    if (Number.isFinite(cardStart)) out.push([Math.min(T.duration - 0.3, cardStart + 2.6), 'end card']);
    out.sort((a, b) => a[0] - b[0]);
    const merged = []; for (const [t, l] of out) { if (merged.length && t - merged[merged.length - 1][0] < 0.25) { merged[merged.length - 1][1] += ' + ' + l; continue; } merged.push([t, l]); }
    return merged;
  }

  const film = {
    duration: T.duration, fps, events, cardStart, cfg, shots, brand, captures: caps, estimated: TLM.estimated,
    async init() {
      await loadBrandImages(brand);
      for (const s of shots) {
        if (s.seq) s._seq = Array.isArray(s.seq) ? s.seq : caps.seq(s.seq);
        for (const id of [...(s.seq ? s._seq : s.cap ? [s.cap] : []), ...(s.caps || []), ...(s.fullId ? [s.fullId] : []), ...(s.until ? [s.until] : [])]) await caps.load(id);
      }
      const iconImages = {};
      for (const [word, file] of Object.entries((cfg.captions && cfg.captions.icons) || {})) iconImages[word.toLowerCase()] = await loadImage(fs.readFileSync(path.resolve(dir, file)));
      captions = makeCaptions(TLM.tl, brand, cfg.captions === false ? false : { ...(cfg.captions || {}), iconImages });
      if (cfg.init) await cfg.init({ loadImage, dir, brand });
    },
    render(f, t) {
      const ctx = f.ctx; f.setScreen(ctx); background(ctx);
      const u = { f, t, ctx, C, brand, font, L, W, T, ease, clamp, lerp, smoothstep, rr, elRect, phoneAt, shotAt, reel: REEL, api };
      for (const o of over) if (o.under && t >= o.at && t < o.to) { f.setScreen(ctx); o.draw({ ...u, lt: t - o.at }); }
      drawPhone(f, t); f.setScreen(ctx);
      drawMarks(ctx, t); drawTaps(ctx, t); drawLoupes(ctx, t); drawLabels(ctx, t);
      for (const o of over) if (!o.under && !o.top && t >= o.at && t < o.to) { f.setScreen(ctx); o.draw({ ...u, lt: t - o.at }); }
      f.setScreen(ctx);
      if (process.env.WB_COVER) cover(f, process.env.WB_COVER);
      else if (!(cardCfg && t >= cardStart)) { band(f, t); f.setScreen(ctx); captions.draw(ctx, t); }
      for (const o of over) if (o.top && t >= o.at && t < o.to && !(cardCfg && t >= cardStart)) { f.setScreen(ctx); o.draw({ ...u, lt: t - o.at }); }   // above the captions
      if (cardCfg) drawCard(f, t);
      f.setScreen(ctx);
      f.finish(cfg.post || {});
      if (process.env.WB_GUIDES === 'social') { f.setScreen(ctx); drawGuides(ctx, font); }
    },
    elRect, phoneAt, shotAt, moments,
    geomAt: (t) => { const i = shotAt(t); return i < 0 ? null : geom(t, devOf(shots[i])); },
    capBox: () => (cfg.captions === false ? null : { y0: (cfg.captions?.y || 372) - (cfg.captions?.size || 54) * 1.22, y1: (cfg.captions?.y || 372) + (cfg.captions?.size || 54) * 1.22 }),
  };
  return film;
}

module.exports = { defineTutorial, ZONES };
