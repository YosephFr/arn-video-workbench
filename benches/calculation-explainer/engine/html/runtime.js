// In-page runtime for HTML calculation scenes. Injected by engine/html/render.mjs; defines window.render(t), a pure
// function of time (no timers, no CSS transitions), so core/node/frames.mjs can capture any frame in any order.
//
// Markup it understands (all times come from the voice timeline):
//   <section class="scene" data-from="@L02" data-to="@L03.end+0.4" data-push>   a scene, its span, and a slow push
//                                                    and float that keep it alive (a still frame reads as frozen)
//   <div class="card" data-drift>    the scene's main card drifts on a small circle at a constant speed (default
//                                    radius 10 px, one turn in 12 s; data-drift="6" for 6 px), so it never stands still
//                                    between two cues of the voice
//   data-in="0.4"                    appears 0.4 s after its scene starts
//   data-in="@L03"                   …when line L03 starts      "@L03.end"  …when it ends
//   data-in="@L03:tips"              …on the first word starting with "tips" of L03   "@L03:four#1" the second one
//   data-in="@L03:tips+0.2"          …with an offset (+ or −, seconds)
//   data-out="@L05"                  fades out at that moment
//   data-count="153" data-format="money|number|percent" data-sign="+"   the number counts up when it appears
//   data-count-at="@L06:one"         …or from another moment
//   <div class="screen" data-capture="shift/01-shift" data-window="0,140,393,480">  an app capture (or a window of
//     it, in capture px), as wide as the box; children with
//     <div class="hl" data-el="@total" data-in=… data-out=…>   a ring placed on a measured element (named or by text)
//   <div class="captions" data-replace='{"four hundred": "$400"}'>   word-synced captions
//   [data-brand="name|tagline|url"], <img data-brand="mark">   filled from brand.json
//   <section class="scene" data-hide-captions>   no captions while it shows (an end card with its own text)
(function () {
  const WB = window.WB || {}; const X = window.WB_EXTRA || {};
  const TL = WB.timeline && WB.timeline.lines && WB.timeline.lines.length ? WB.timeline : X.timeline;
  const DUR = (TL && TL.duration) || WB.duration || 5;
  const brand = X.brand || WB.brand || {}; const colors = brand.colors || {}; const fonts = brand.fonts || {};
  const money = (WB.script && WB.script.money) || X.money || {};
  const root = document.documentElement.style;
  const setVar = (k, v) => v && root.setProperty(k, v);
  setVar('--bg', colors.background); setVar('--surface', colors.surface); setVar('--ink', colors.ink); setVar('--muted', colors.muted);
  setVar('--accent', colors.accent); setVar('--accent-ink', colors.accent_ink); setVar('--positive', colors.positive); setVar('--negative', colors.negative);
  if (colors.accent) setVar('--accent-soft', `color-mix(in srgb, ${colors.accent} 12%, ${colors.surface || '#fff'})`);
  if (brand.radius) setVar('--radius', brand.radius + 'px');
  const stack = (f) => f && `"${f}", system-ui, -apple-system, "Segoe UI", sans-serif`;
  setVar('--font-display', stack(fonts.display)); setVar('--font-body', stack(fonts.body)); setVar('--font-mono', fonts.mono && `"${fonts.mono}", ui-monospace, monospace`);
  document.querySelectorAll('[data-brand]').forEach((el) => {
    const k = el.dataset.brand; if (k === 'mark') { if (X.mark) el.src = X.mark; else el.remove(); } else if (brand[k]) el.textContent = brand[k];
  });

  // ------------------------------------------------------------------------------------------ anchors
  const clean = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9$%]/g, '');
  const lines = {}; ((TL && TL.lines) || []).forEach((l) => { lines[l.id] = l; });
  function at(spec, base) {
    spec = String(spec ?? '0').trim();
    if (spec === 'end') return DUR;
    if (!spec.startsWith('@')) return base + Number(spec);
    const m = spec.match(/^@([A-Za-z0-9_-]+)(\.end)?(?::([^#+\-]+)(?:#(\d+))?)?([+-][\d.]+)?$/);
    if (!m) throw new Error('bad anchor ' + spec);
    const l = lines[m[1]]; if (!l) throw new Error('no line ' + m[1]);
    let t = m[2] ? l.end : l.start;
    if (m[3]) {
      const q = clean(m[3]); let n = Number(m[4] || 0); const w = (l.words || []).find((x) => clean(x.text).startsWith(q) && n-- === 0);
      if (!w) throw new Error(`no word "${m[3]}" in ${m[1]}`); t = w.start;
    }
    return t + Number(m[5] || 0);
  }

  // ------------------------------------------------------------------------------------------ scenes
  const ease = (x) => 1 - Math.pow(1 - Math.min(Math.max(x, 0), 1), 3);
  const scenes = [...document.querySelectorAll('.scene')].map((el) => ({ el, start: at(el.dataset.from ?? '0', 0) - Number(el.dataset.lead ?? 0.3) }));
  scenes.sort((a, b) => a.start - b.start);
  scenes.forEach((s, i) => {
    const nx = scenes[i + 1]; s.end = s.el.dataset.to ? at(s.el.dataset.to, s.start) : nx ? nx.start + 0.2 : DUR + 1;
    s.drift = [...s.el.querySelectorAll('[data-drift]')]; s.turn = i % 2 ? 1 : -1;   // alternate the direction scene by scene
    s.items = [...s.el.querySelectorAll('[data-in], [data-out], [data-count]')].map((el) => {
      const inAt = el.dataset.in != null ? at(el.dataset.in, s.start) : s.start;
      const countEl = el.dataset.count != null ? el : null;
      const cue = el.dataset.countAt ?? el.dataset.in ?? (el.parentElement && el.parentElement.closest('[data-in]') ? el.parentElement.closest('[data-in]').dataset.in : '0');   // a number counts up with its row
      return { el, inAt, outAt: el.dataset.out != null ? at(el.dataset.out, s.start) : Infinity, count: countEl ? { to: Number(el.dataset.count), from: at(cue, s.start) } : null };
    });
  });
  const nf = new Intl.NumberFormat(money.locale || 'en-US', { style: 'currency', currency: money.currency || 'USD', minimumFractionDigits: money.decimals ?? 0, maximumFractionDigits: money.decimals ?? 0 });
  function formatValue(el, v) {
    const f = el.dataset.format || 'money'; const sign = v < 0 ? '−' : el.dataset.sign === '+' ? '+' : '';
    const body = f === 'money' ? nf.format(Math.abs(v)) : f === 'percent' ? `${Math.round(Math.abs(v))}%` : Math.round(Math.abs(v)).toLocaleString(money.locale || 'en-US');
    return sign + body;
  }

  // ------------------------------------------------------------------------------------------ captures and rings
  const loads = [];
  document.querySelectorAll('[data-capture]').forEach((box) => {
    const cap = (X.captures || {})[box.dataset.capture]; if (!cap) { box.textContent = 'missing capture ' + box.dataset.capture; return; }
    const img = document.createElement('img'); img.src = cap.url; img.className = 'capture'; box.prepend(img);
    loads.push(img.decode().catch(() => {}));
    box._meta = cap.meta;
  });
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  function findEl(meta, q) {
    const els = [...(meta.elements || []), ...(meta.texts || []).map((e) => ({ ...e, role: 'text' }))];
    if (q.startsWith('@')) { const e = els.find((x) => x.name === q.slice(1)); if (!e) throw new Error('no element named ' + q); return e; }
    const t = norm(q); const hits = els.filter((e) => norm(e.text).includes(t)); if (!hits.length) throw new Error(`"${q}" is not on the capture`);
    return hits.sort((a, b) => (norm(a.text) === t ? 0 : 1) - (norm(b.text) === t ? 0 : 1) || a.w * a.h - b.w * b.h)[0];
  }
  // data-window="x,y,w,h" (CSS px of the capture) shows only that part of the screen, at the box's width: a window of
  // the real app as a floating card, large enough to read.
  function layoutCaptures() {
    document.querySelectorAll('[data-capture]').forEach((box) => {
      const meta = box._meta; if (!meta) return; const img = box.querySelector('img.capture');
      const [wx, wy, ww, wh] = (box.dataset.window || `0,0,${meta.viewport.w},${meta.viewport.h}`).split(',').map(Number);
      const k = box.clientWidth / ww; box._k = k; box._win = [wx, wy];
      Object.assign(box.style, { height: wh * k + 'px', position: 'relative', overflow: 'hidden' });
      Object.assign(img.style, { position: 'absolute', left: -wx * k + 'px', top: -wy * k + 'px', width: meta.viewport.w * k + 'px', maxWidth: 'none' });
    });
  }
  function placeRings() {
    document.querySelectorAll('[data-capture] [data-el]').forEach((hl) => {
      const box = hl.closest('[data-capture]'); const meta = box._meta; if (!meta) return;
      const k = box._k; const [wx, wy] = box._win; const e = findEl(meta, hl.dataset.el); const pad = Number(hl.dataset.pad ?? 6);
      Object.assign(hl.style, { left: (e.x - wx - pad) * k + 'px', top: (e.y - wy - pad) * k + 'px', width: (e.w + 2 * pad) * k + 'px', height: (e.h + 2 * pad) * k + 'px', borderRadius: ((e.radius || 12) + pad) * k + 'px' });
    });
  }

  // ------------------------------------------------------------------------------------------ captions
  const capBox = document.querySelector('[data-captions]:not(.scene)'); let chunks = []; let shown = -1;
  if (capBox && TL) {
    const repl = JSON.parse(capBox.dataset.replace || '{}');
    const phrases = Object.keys(repl).map((k) => ({ k: k.trim().split(/\s+/).map(clean), v: repl[k] })).sort((a, b) => b.k.length - a.k.length);
    for (const l of TL.lines) {
      if (l.caption === false) continue;
      const ws = []; const words = l.words || [];
      for (let i = 0; i < words.length; i++) {
        const p = phrases.find((q) => q.k.every((x, j) => words[i + j] && clean(words[i + j].text) === x));
        if (!p) { ws.push({ text: words[i].text, start: words[i].start, end: words[i].end, hot: !!words[i].emphasis }); continue; }
        const last = words[i + p.k.length - 1]; ws.push({ text: p.v + ((last.text.match(/[.,;:!?…]+$/) || [''])[0]), start: words[i].start, end: last.end, hot: words.slice(i, i + p.k.length).some((x) => x.emphasis) }); i += p.k.length - 1;
      }
      let cur = [];
      ws.forEach((w, i) => { cur.push(w); if (/[.!?…:]$/.test(w.text) || (/[,;]$/.test(w.text) && cur.length >= 5) || cur.length >= 9 || i === ws.length - 1) { chunks.push({ words: cur, t0: cur[0].start - 0.08, end: cur[cur.length - 1].end }); cur = []; } });
    }
    chunks.forEach((c, i) => { const nx = chunks[i + 1]; c.t1 = nx ? Math.min(nx.t0, c.end + 1.2) : c.end + 1.0; });
  }
  const quiet = () => scenes.filter((s) => s.el.hasAttribute('data-hide-captions'));   // e.g. the end card, which shows its own text
  function captions(t) {
    if (!capBox) return; const hush = quiet().some((s) => t >= s.start && t < s.end); const i = hush ? -1 : chunks.findIndex((c) => t >= c.t0 && t < c.t1 + 0.16);
    if (i !== shown) {
      shown = i; capBox.replaceChildren();
      if (i >= 0) chunks[i].words.forEach((w, k) => { if (k) capBox.append(' '); const sp = document.createElement('span'); if (w.hot) sp.className = 'hot'; sp.textContent = w.text; capBox.append(sp); });
    }
    if (i < 0) return; const c = chunks[i]; const out = 1 - Math.min(Math.max((t - c.t1) / 0.16, 0), 1);
    [...capBox.children].forEach((sp, k) => { const a = ease((t - (c.words[k].start - 0.05)) / 0.16); sp.style.opacity = a * out; sp.style.transform = `translateY(${(1 - a) * 12}px)`; });
  }

  // ------------------------------------------------------------------------------------------ grain and vignette
  // The same finish as the canvas engines: a light overlay grain that changes 12 times a second (seeded, so every
  // render is identical) and a soft vignette. <body data-grain="0"> turns the grain off.
  const GRAIN = Number(document.body.dataset.grain ?? 0.022);
  const W0 = window.WB && WB.width || 1080, H0 = window.WB && WB.height || 1920;
  const vignette = document.createElement('div');
  Object.assign(vignette.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: 9998, background: 'radial-gradient(ellipse 100% 78% at 50% 48%, rgba(40,40,48,0) 52%, rgba(40,40,48,0.1) 100%)' });
  document.body.append(vignette);
  let grainCanvas = null; const tiles = [];
  if (GRAIN > 0) {
    let seed = 9; const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    for (let k = 0; k < 6; k++) {
      const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d'); const img = x.createImageData(256, 256);
      for (let i = 0; i < 256 * 256; i++) { const v = 128 + (rnd() + rnd() + rnd() - 1.5) * 88; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
      x.putImageData(img, 0, 0); tiles.push(c);
    }
    grainCanvas = document.createElement('canvas'); grainCanvas.width = W0; grainCanvas.height = H0;
    Object.assign(grainCanvas.style, { position: 'fixed', left: '0', top: '0', width: W0 + 'px', height: H0 + 'px', pointerEvents: 'none', zIndex: 9999, mixBlendMode: 'overlay', opacity: String(Math.min(1, GRAIN * 8)) });
    document.body.append(grainCanvas);
  }
  const hash = (n) => { let x = (n | 0) ^ 0x9e3779b9; x = Math.imul(x ^ (x >>> 16), 0x85ebca6b); x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; };
  let lastGrain = -1;
  function grain(t) {
    if (!grainCanvas) return; const fi = Math.round(t * 12); if (fi === lastGrain) return; lastGrain = fi;
    const g = grainCanvas.getContext('2d'); const tile = tiles[fi % tiles.length]; const ox = Math.floor(hash(fi * 7 + 1) * 256), oy = Math.floor(hash(fi * 13 + 5) * 256);
    g.save(); g.translate(-ox, -oy); g.fillStyle = g.createPattern(tile, 'repeat'); g.fillRect(ox, oy, W0, H0); g.restore();
  }

  // data-drift: a circle at a constant speed starting from the element's place (no turning point where it stops)
  const drift = (el, lt, turn) => {
    const r = Number(el.dataset.drift || 10), a = (2 * Math.PI * lt) / 12;
    return `translate(${(turn * r * Math.sin(a)).toFixed(2)}px, ${(r * (1 - Math.cos(a))).toFixed(2)}px)`;
  };

  // ------------------------------------------------------------------------------------------ render
  window.render = function (t) {
    for (const s of scenes) {
      const fin = ease((t - s.start) / 0.45), fout = 1 - ease((t - (s.end - 0.35)) / 0.35); const o = Math.max(0, Math.min(fin, fout));
      s.el.style.opacity = o; s.el.style.visibility = o <= 0.001 ? 'hidden' : 'visible';
      // data-push: the scene stays alive (a slow push of 0.22% a second up to 4%, and a ±5 px float over 7 s)
      const lt = Math.max(0, t - s.start); const alive = s.el.hasAttribute('data-push');
      const push = alive ? 1 + Math.min(0.04, 0.0022 * lt) : 1; const float = alive ? 5 * Math.sin((2 * Math.PI * lt) / 7) : 0;
      s.el.style.transform = `translateY(${(1 - fin) * 40 - (1 - fout) * 30 + float}px) scale(${push})`;
      if (o <= 0.001) continue;
      for (const it of s.items) {
        const p = ease((t - it.inAt) / 0.5) * (1 - ease((t - it.outAt) / 0.35));
        if (it.el.dataset.in != null || it.el.dataset.out != null) {
          it.el.style.opacity = p; it.el.style.transform = `translateY(${(1 - ease((t - it.inAt) / 0.5)) * 24}px)` + (it.el.dataset.drift != null ? ' ' + drift(it.el, lt, s.turn) : '');
        }
        if (it.el.classList.contains('hl')) it.el.style.setProperty('--draw', ease((t - it.inAt) / 0.45));
        if (it.count) { const k = ease((t - it.count.from) / 0.9); it.el.textContent = t < it.count.from ? (it.el.dataset.before ?? '') : formatValue(it.el, it.count.to * k); }
      }
      for (const el of s.drift) if (el.dataset.in == null && el.dataset.out == null) el.style.transform = drift(el, lt, s.turn);
    }
    captions(t); grain(t);
  };
  window.wbReady = Promise.all(loads).then(() => { layoutCaptures(); placeRings(); window.render(0); });
})();
