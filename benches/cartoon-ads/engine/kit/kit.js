/* Cartoon-ads kit: the stage every film draws on.

   A film is a pure function of time. build() makes the DOM once; frame(t) sets every style and attribute for
   second t. The renderer calls K.frame(t) for each frame and screenshots it, so frame N always shows N / fps and
   any frame can be rendered alone.

     FILM({
       bg: K.C.paper,                          // the frame's ground colour
       captions: { theme: 'paper', y: 1610 },  // automatic word-synced captions, or false
       overlaps: [['person', 'phone']],        // pairs that cover each other on purpose (overlap report)
       clearText: true,                        // erase particles under text that has no ground of its own
       duration: 12,                           // only for pieces without voice; otherwise the timeline decides
       build: function (K) { ... },            // make everything once; read every time from K.line / K.word here
       frame: function (t, K) { ... }          // set everything for second t
     })

   Colour rule of the style: a grey world with one accent colour. The mascot is the only thing in the accent
   colour; when something turns accent-coloured, the mascot took care of it. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var K = window.K = { W: 1080, H: 1920, fps: 30, t: 0, root: null, top: null, film: null };

  // ---------- colour ----------
  function rgbOf(hex) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    return [0, 2, 4].map(function (i) { return parseInt(h.slice(i, i + 2), 16); });
  }
  // mix two #hex colours in sRGB, k = 0 → a, 1 → b
  function mixHex(a, b, k) {
    var pa = rgbOf(a), pb = rgbOf(b);
    return '#' + pa.map(function (v, i) { return Math.round(v + (pb[i] - v) * k).toString(16).padStart(2, '0'); }).join('');
  }

  // ---------- easing ----------
  // CSS-style cubic-bezier solved by bisection (exact enough for 30 fps and free of Newton edge cases)
  function cubic(x1, y1, x2, y2) {
    return function (t) {
      if (t <= 0) return 0; if (t >= 1) return 1;
      var lo = 0, hi = 1, mid, x;
      for (var i = 0; i < 24; i++) {
        mid = (lo + hi) / 2;
        x = 3 * (1 - mid) * (1 - mid) * mid * x1 + 3 * (1 - mid) * mid * mid * x2 + mid * mid * mid;
        if (x < t) lo = mid; else hi = mid;
      }
      mid = (lo + hi) / 2;
      return 3 * (1 - mid) * (1 - mid) * mid * y1 + 3 * (1 - mid) * mid * mid * y2 + mid * mid * mid;
    };
  }
  // a damped spring normalised to its segment: it overshoots and settles exactly at 1
  function spring(zeta, cycles) {
    var w = 2 * Math.PI * (cycles || 1.6);
    return function (t) {
      if (t <= 0) return 0; if (t >= 1) return 1;
      var wd = w * Math.sqrt(1 - zeta * zeta);
      return 1 - Math.exp(-zeta * w * t) * (Math.cos(wd * t) + (zeta * w / wd) * Math.sin(wd * t));
    };
  }
  // The eases of the style. Gravity is never linear: things leave the floor with `rise`, come back with `fall`,
  // crouch with `ant` before they jump and settle with a spring.
  var E = {
    lin: function (t) { return t; },
    io: cubic(0.45, 0, 0.55, 1),       // standard in-out
    out: cubic(0.22, 1, 0.36, 1),      // quick start, long settle (entrances)
    in: cubic(0.55, 0, 1, 0.45),       // slow start, fast end (exits)
    fall: cubic(0.11, 0, 0.5, 0),      // gravity: accelerating down
    rise: cubic(0.5, 1, 0.89, 1),      // leaving the floor, slowing to the apex
    ant: cubic(0.4, 0, 0.2, 1),        // anticipation crouch
    move: cubic(0.65, 0, 0.35, 1),     // camera and big moves
    sine: function (t) { return 0.5 - Math.cos(Math.PI * t) / 2; },
    back: cubic(0.34, 1.56, 0.64, 1),  // overshoot and return
    spring: spring(0.32, 1.7),         // landings, ears, pops
    soft: spring(0.5, 1.2),            // a body settling
    firm: spring(0.86, 1)              // letters: arrive without bouncing
  };

  // ---------- math ----------
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, k) { return a + (b - a) * k; }
  // 0..1 progress of t between a and b
  function prog(t, a, b) { return b === a ? (t >= b ? 1 : 0) : clamp((t - a) / (b - a), 0, 1); }
  function ez(name) { return typeof name === 'function' ? name : (E[name] || E.io); }
  // keyframes in seconds: [[t, value, ease], ...]; the ease shapes the segment that ENDS at that key
  function sample(keys, t) {
    if (t <= keys[0][0]) return keys[0][1];
    for (var i = 1; i < keys.length; i++) {
      var k0 = keys[i - 1], k1 = keys[i];
      if (t <= k1[0]) return k0[1] + (k1[1] - k0[1]) * ez(k1[2])((t - k0[0]) / Math.max(1e-6, k1[0] - k0[0]));
    }
    return keys[keys.length - 1][1];
  }
  // a value that eases from a to b between t0 and t1
  function tw(t, t0, t1, a, b, e) { return lerp(a, b, ez(e || 'io')(prog(t, t0, t1))); }
  // seeded value noise for shakes and handheld drift (same input, same output: renders are repeatable)
  function hash(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function noise(t, seed) { var i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f); return lerp(hash(i + seed * 97), hash(i + 1 + seed * 97), u) * 2 - 1; }

  // ---------- DOM ----------
  function css(n, o) {
    for (var k in o) n.style[k] = typeof o[k] === 'number' && !/opacity|zIndex|fontWeight|lineHeight|flex/.test(k) ? o[k] + 'px' : o[k];
    return n;
  }
  function el(tag, o, parent) {
    var n = document.createElement(tag); o = o || {};
    if (o.cls) n.className = o.cls;
    if (o.text != null) n.textContent = o.text;
    if (o.html != null) n.innerHTML = o.html;
    if (o.style) css(n, o.style);
    if (o.attrs) for (var k in o.attrs) n.setAttribute(k, o.attrs[k]);
    (parent || K.root).appendChild(n);
    return n;
  }
  function svg(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs || {}) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  // a full-frame SVG layer in frame pixels
  function stageSvg(parent, z) {
    var s = svg('svg', { width: K.W, height: K.H, viewBox: '0 0 ' + K.W + ' ' + K.H, style: 'position:absolute;left:0;top:0;overflow:visible' + (z != null ? ';z-index:' + z : '') });
    (parent || K.root).appendChild(s);
    return s;
  }
  // place an HTML element by its anchor (ax, ay in 0..1 of its own box) at x, y with scale, rotation and opacity
  function place(n, x, y, s, r, ax, ay, op) {
    n.style.transform = 'translate(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px) translate(' + (-(ax == null ? 50 : ax * 100)) + '%,' + (-(ay == null ? 50 : ay * 100)) + '%) rotate(' + (r || 0).toFixed(3) + 'deg) scale(' + (s == null ? 1 : s).toFixed(4) + ')';
    n.style.transformOrigin = (ax == null ? 50 : ax * 100) + '% ' + (ay == null ? 50 : ay * 100) + '%';
    if (op != null) n.style.opacity = clamp(op, 0, 1).toFixed(3);
    n.style.visibility = op === 0 ? 'hidden' : '';
  }
  function show(n, on) { n.style.visibility = on ? '' : 'hidden'; }
  // a rounded rectangle as an SVG path
  function rr(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    return 'M' + (x + r) + ' ' + y + 'H' + (x + w - r) + 'Q' + (x + w) + ' ' + y + ' ' + (x + w) + ' ' + (y + r) + 'V' + (y + h - r) + 'Q' + (x + w) + ' ' + (y + h) + ' ' + (x + w - r) + ' ' + (y + h) + 'H' + (x + r) + 'Q' + x + ' ' + (y + h) + ' ' + x + ' ' + (y + h - r) + 'V' + (y + r) + 'Q' + x + ' ' + y + ' ' + (x + r) + ' ' + y + 'Z';
  }
  // HTML inside SVG (a foreignObject box of w × h at x, y), so text inside drawings wraps and uses the brand fonts
  function html(parent, x, y, w, h, style) {
    var fo = svg('foreignObject', { x: x, y: y, width: w, height: h }, parent);
    var d = document.createElement('div');
    d.style.cssText = 'width:100%;height:100%;box-sizing:border-box;font-family:' + K.F.body + ';color:' + K.C.ink + ';' + (style || '');
    fo.appendChild(d);
    return d;
  }

  // ---------- timeline (timeline.json written by core/bin/wb timeline) ----------
  var TL = { duration: 0, lines: [] };
  function normTimeline(tl) {
    tl = tl || {};
    var lines = (tl.lines || []).map(function (L) {
      var words = (L.words || []).map(function (w) {
        var text = w.text != null ? w.text : (w.w != null ? w.w : '');
        return { w: text, text: text, start: +w.start, end: +w.end, hot: !!(w.emphasis || w.hot) };
      });
      var env = L.env && L.env.length ? L.env : null;
      if (env && Math.max.apply(null, env) < 0.02) env = null;   // a silent take: animate from the words instead
      return { id: L.id, voice: L.voice || null, text: L.text || '', start: +L.start, end: +L.end, words: words,
        caption: L.caption !== false, effect: L.effect || null, env: env, envRate: L.env_rate || 50 };
    });
    return { duration: +tl.duration || 0, lines: lines };
  }
  function line(id) {
    for (var i = 0; i < TL.lines.length; i++) if (TL.lines[i].id === id) return TL.lines[i];
    throw new Error('no line ' + id + ' in the timeline (lines: ' + TL.lines.map(function (l) { return l.id; }).join(', ') + ')');
  }
  function norm(s) { return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, ''); }
  // the word of line `id` that starts with `w` (the n-th match), or the i-th word (negative counts from the end):
  // returns { w, text, start, end, hot }
  function word(id, w, n) {
    var L = line(id), k = 0;
    if (typeof w === 'number') { var x = L.words[w < 0 ? L.words.length + w : w]; if (!x) throw new Error('no word #' + w + ' in ' + id); return x; }
    for (var i = 0; i < L.words.length; i++) if (norm(L.words[i].w).indexOf(norm(w)) === 0) { if (k === (n || 0)) return L.words[i]; k++; }
    throw new Error('no word "' + w + '" in ' + id + ' (words: ' + L.words.map(function (x) { return x.w; }).join(' ') + ')');
  }
  // a speech-like level from the word timings, for silent drafts: one soft pulse per syllable
  function synthLevel(L, t) {
    for (var i = 0; i < L.words.length; i++) {
      var w = L.words[i];
      if (t < w.start || t > w.end) continue;
      var syl = Math.max(1, Math.round(norm(w.w).length / 3)), f = (t - w.start) / Math.max(0.05, w.end - w.start) * syl;
      return 0.2 + 0.8 * Math.pow(Math.sin(Math.PI * (f % 1)), 0.7);
    }
    return 0;
  }
  // voice level 0..1 at t (the 50 Hz envelope of the timeline, or a synthetic one), for talking bodies
  function level(t, id) {
    var best = 0;
    TL.lines.forEach(function (L) {
      if (id && L.id !== id) return;
      if (t < L.start || t > L.end) return;
      var v = L.env ? L.env[clamp(Math.floor((t - L.start) * L.envRate), 0, L.env.length - 1)] || 0 : synthLevel(L, t);
      best = Math.max(best, v);
    });
    return best;
  }
  // the line that `voice` is saying at t (or any voice when omitted), or null
  function speaking(t, voice) {
    for (var i = 0; i < TL.lines.length; i++) { var L = TL.lines[i]; if ((!voice || L.voice === voice) && t >= L.start && t <= L.end) return L; }
    return null;
  }

  // ---------- sound events (render.mjs <piece> events writes them to events.json for core/bin/wb sfx) ----------
  // K.sfx(t, 'pop', { gain_db: -14, pan: -0.3, dur: 0.4 }) in build(); t may also be an anchor like 'L02:word'
  var events = [];
  function sfx(t, name, o) {
    o = o || {};
    var e = typeof t === 'string' ? { at: t, name: name } : { t: +(+t).toFixed(3), name: name };
    e.gain_db = o.gain_db != null ? o.gain_db : (o.g != null ? o.g : -16);
    if (o.pan != null) e.pan = Math.round(o.pan * 100) / 100;
    if (o.dur != null) e.dur = o.dur;
    if (o.rev) e.rev = true;
    events.push(e);
    return e;
  }

  // ---------- camera ----------
  // world: an element that holds the scene; c = { x, y, z, r, shake } in frame pixels around the frame centre.
  // (x, y) is the point of the world that lands in the middle of the frame.
  function camera(world, c) {
    var sx = (c.shake || 0) * noise(K.t * 9, 1) * 24, sy = (c.shake || 0) * noise(K.t * 9, 2) * 24;
    world.style.transformOrigin = '0 0';
    world.style.transform = 'translate(' + (K.W / 2 + sx) + 'px,' + (K.H / 2 + sy) + 'px) rotate(' + (c.r || 0) + 'deg) scale(' + (c.z || 1) + ') translate(' + (-(c.x == null ? K.W / 2 : c.x)) + 'px,' + (-(c.y == null ? K.H / 2 : c.y)) + 'px)';
  }

  // ---------- type ----------
  // the words of a string as inline-block spans, for per-word animation; *word* gets the class "hot"
  function words(parent, str, style) {
    var box = el('div', { cls: 'words', style: style || {} }, parent), out = [], inside = false;
    str.split(/\s+/).forEach(function (w, i) {
      if (i) box.appendChild(document.createTextNode(' '));
      var stars = (w.match(/\*/g) || []).length, hot = inside || stars > 0;
      if (stars % 2) inside = !inside;
      out.push(el('span', { cls: 'w' + (hot ? ' hot' : ''), text: w.replace(/\*/g, '') }, box));
    });
    box.spans = out;
    return box;
  }
  // pop in: 0 → 1 with the spring, starting at t0
  function pop(t, t0, d) { var k = prog(t, t0, t0 + (d || 0.42)); return k <= 0 ? 0 : E.spring(k); }
  // typewriter: the first characters of text, cps characters per second from t0
  function typed(t, t0, cps, text) { return text.slice(0, Math.max(0, Math.floor((t - t0) * (cps || 28)))); }
  // a number that counts from a to b between t0 and t1, formatted for the brand's locale
  function count(t, t0, t1, a, b, fmt) { var v = tw(t, t0, t1, a, b, 'out'); return fmt ? fmt(v) : Math.round(v).toLocaleString(K.locale); }

  // ---------- captions: the words of the voice, a few at a time ----------
  // theme: 'paper' (ink words, accent emphasis; on light grounds), 'accent' (on an accent ground), 'ink' (on dark),
  //        'tile' (every word on its own tile, for busy scenes), 'caps' (viral explainer capitals), 'typewriter'
  // y: the vertical centre of the caption block; max: characters per chunk; typed: type each word as it is spoken
  function captions(o) {
    o = o || {};
    var box = el('div', { cls: 'cap cap-' + (o.theme || 'paper'), style: { top: (o.y || 1610) + 'px' } }, K.top);
    var typedMode = o.typed != null ? !!o.typed : o.theme === 'typewriter';
    var chunks = [];
    TL.lines.forEach(function (L) {
      if (!L.caption) return;
      var cur = [], len = 0;
      L.words.forEach(function (w, i) {
        cur.push(w); len += w.w.length + 1;
        var end = /[.,!?…:;]$/.test(w.w) || len > (o.max || 16) || i === L.words.length - 1;
        if (end) { chunks.push({ line: L, words: cur, start: cur[0].start, end: cur[cur.length - 1].end }); cur = []; len = 0; }
      });
    });
    chunks.forEach(function (c, i) { var nx = chunks[i + 1]; c.until = nx && nx.line === c.line ? nx.start : c.end + 0.25; });
    var spans = [];
    return {
      el: box,
      chunks: chunks,
      theme: function (th) { box.className = 'cap cap-' + th; },
      frame: function (t, hide) {
        var c = null;
        for (var i = 0; i < chunks.length; i++) if (t >= chunks[i].start - 0.05 && t < chunks[i].until) { c = chunks[i]; break; }
        if (!c || hide) { box.style.visibility = 'hidden'; return; }
        box.style.visibility = '';
        if (box._c !== c) {
          box._c = c; box.innerHTML = ''; spans = [];
          c.words.forEach(function (w, i) {
            if (i) box.appendChild(document.createTextNode(' '));
            spans.push(el('span', { cls: 'w' + (w.hot ? ' hot' : ''), text: w.w }, box));
          });
        }
        if (typedMode) {   // each word is typed over its own spoken time, with a blinking cursor after the last letter
          var last = -1;
          c.words.forEach(function (w, i) {
            var n = Math.round(clamp((t - w.start + 0.03) / Math.max(0.12, w.end - w.start), 0, 1) * w.w.length);
            spans[i].textContent = w.w.slice(0, n); spans[i].style.opacity = n ? 1 : 0; spans[i].style.transform = 'none';
            if (n) last = i;
            spans[i].classList.toggle('now', t >= w.start && t < w.end + 0.08);
          });
          if (last >= 0 && Math.floor(t * 2.5) % 2 === 0) spans[last].textContent += '|';
          return;
        }
        c.words.forEach(function (w, i) {
          var k = pop(t, w.start - 0.04, 0.3), on = t >= w.start - 0.02;
          spans[i].style.transform = 'translateY(' + ((1 - k) * 18).toFixed(1) + 'px) scale(' + (0.86 + 0.14 * k).toFixed(3) + ')';
          spans[i].style.opacity = on ? 1 : 0;
          spans[i].classList.toggle('now', t >= w.start && t < w.end + 0.08);
        });
      }
    };
  }

  // ---------- brand ----------
  function setupBrand(b) {
    b = b || {};
    var c = b.colors || {};
    var paper = c.background || '#F2F2F4', ink = c.ink || '#2B2C31', accent = c.accent || '#E35A14';
    K.C = {
      paper: paper, paper2: mixHex(paper, ink, 0.05), paper3: mixHex(paper, ink, 0.1), surface: c.surface || '#FFFFFF',
      ink: ink, muted: c.muted || mixHex(ink, paper, 0.38),
      accent: accent, accentInk: c.accent_ink || '#FFFFFF', accentSoft: mixHex(accent, paper, 0.8), accentDeep: mixHex(accent, ink, 0.42),
      positive: c.positive || '#2F7D4F', negative: c.negative || '#B4432F'
    };
    // the greys of the world (skins, clothes, objects), a ramp from paper to ink: never the accent
    var g = function (k) { return mixHex(paper, ink, k); };
    K.G = { skin1: g(0.09), skin2: g(0.19), skin3: g(0.32), skin4: g(0.45), mid: g(0.6), dark: g(0.78), ink: ink, paper: paper };
    var f = b.fonts || {};
    var q = function (name) { return name ? '"' + name + '", ' : ''; };
    K.F = {
      display: q(f.display) + 'ui-rounded, "Arial Rounded MT Bold", system-ui, sans-serif',
      body: q(f.body) + 'system-ui, -apple-system, "Segoe UI", sans-serif',
      mono: q(f.mono) + 'ui-monospace, "SFMono-Regular", Menlo, monospace'
    };
    K.locale = b.locale || 'en-US';
    var rs = document.documentElement.style;
    rs.setProperty('--paper', K.C.paper); rs.setProperty('--paper2', K.C.paper2); rs.setProperty('--paper3', K.C.paper3);
    rs.setProperty('--ink', K.C.ink); rs.setProperty('--muted', K.C.muted); rs.setProperty('--surface', K.C.surface);
    rs.setProperty('--accent', K.C.accent); rs.setProperty('--accent-ink', K.C.accentInk);
    rs.setProperty('--display', K.F.display); rs.setProperty('--body', K.F.body); rs.setProperty('--mono', K.F.mono);
    K.brand = b;
  }
  function loadFonts(b) {
    var f = (b && b.fonts) || {}, specs = [];
    [[f.display, [500, 600, 700, 800]], [f.body, [400, 600, 700, 800, 900]], [f.mono, [500, 700]]].forEach(function (p) {
      if (p[0]) p[1].forEach(function (w) { specs.push(w + ' 64px "' + p[0] + '"'); });
    });
    return Promise.all(specs.map(function (s) { return document.fonts.load(s).catch(function () { return null; }); }))
      .then(function () { return document.fonts.ready; });
  }

  // ---------- film registry ----------
  Object.assign(K, {
    E: E, NS: NS,
    clamp: clamp, lerp: lerp, prog: prog, sample: sample, tw: tw, noise: noise, hash: hash, mixHex: mixHex, ease: ez,
    el: el, svg: svg, stageSvg: stageSvg, css: css, place: place, show: show, rr: rr, html: html,
    line: line, word: word, level: level, speaking: speaking, norm: norm,
    sfx: sfx, events: events, camera: camera,
    words: words, pop: pop, typed: typed, count: count, captions: captions
  });
  setupBrand({});
  window.FILM = function (film) { K.film = film; };

  // Called by the baked stage with the piece's data, after film.js is loaded:
  // { format: { width, height, fps }, timeline, script, brand, points, pointsMeta, logoSvg, noFilm }
  K.boot = function (data) {
    data = data || {};
    var fmt = data.format || {};
    K.W = fmt.width || 1080; K.H = fmt.height || 1920; K.fps = fmt.fps || 30;
    setupBrand(data.brand || {});
    K.logoSvg = data.logoSvg || null;
    TL = normTimeline(data.timeline); K.tl = TL;
    K.script = data.script || {};
    var frame = document.getElementById('frame');
    frame.style.width = K.W + 'px'; frame.style.height = K.H + 'px';
    return loadFonts(data.brand).then(function () {
      K.root = el('div', { cls: 'root' }, frame);
      K.top = el('div', { cls: 'root top' }, frame);
      if (K.dots && data.points) K.dots.load(data.points, data.pointsMeta);
      if (data.noFilm) return { duration: 0, events: [] };
      if (!K.film) throw new Error('film.js did not call FILM({ ... })');
      K.duration = K.film.duration || TL.duration;
      if (!K.duration) throw new Error('no duration: the timeline has no lines and the film sets no duration');
      frame.style.background = K.film.bg || K.C.paper;
      K.film.build(K);
      if (K.film.captions !== false) K.cap = captions(K.film.captions || {});
      ovTag();
      return { duration: K.duration, events: events.slice().sort(function (a, b) { return (a.t || 0) - (b.t || 0); }) };
    });
  };

  K.frame = function (t) {
    K.t = t;
    K.film.frame(t, K);
    if (K.cap) K.cap.frame(t, K.hideCaptions);
    if (K.film.clearText !== false) clearUnderText();
  };

  // ---------- overlap report (render.mjs <piece> overlaps): every figure, text and particle layer has a name ----------
  // A film's own properties name what they hold (this.owner → "owner"). Pictograms and particle layers kept in local
  // variables keep their type name. Overlays and end cards (objects with a frame method) cover the scene on purpose.
  // Properties that start with "_" (this._floor, this._shadow, this._sparks) are grounds and effects: not checked.
  function ovTag() {
    var n = 0, tag = function (e, name) { if (!e || !e.setAttribute) return; e.setAttribute('data-ov', name); if (!e.getAttribute('data-ovid')) e.setAttribute('data-ovid', 'o' + (n++)); };
    var skip = function (e) { if (e && e.setAttribute) e.setAttribute('data-ovskip', ''); };
    Object.keys(K.film).forEach(function (k) {
      var v = K.film[k];
      if (!v || typeof v !== 'object' || k === 'T' || k === 'captions' || k === 'overlaps') return;
      if (k.charAt(0) === '_') { [v, v.g, v.el, v.c].forEach(skip); return; }
      if (v instanceof Element) return tag(v, k);
      if (typeof v.frame === 'function') return;
      if (v.g instanceof Element) return tag(v.g, k);
      if (v.el instanceof Element) return tag(v.el, k);
      if (v.c instanceof HTMLCanvasElement && v.ctx) return tag(v.c, k);
    });
    if (K.cap) tag(K.cap.el, 'captions');
    document.querySelectorAll('[data-ov]:not([data-ovid]):not([data-ovskip])').forEach(function (e) { tag(e, e.getAttribute('data-ov')); });
  }
  K.ovList = function () {
    var out = [];
    document.querySelectorAll('[data-ovid]').forEach(function (e) {
      if (e.checkVisibility && !e.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return;
      var r = e.getBoundingClientRect(), sc = K.scale || 1;
      var x0 = Math.max(0, r.left), y0 = Math.max(0, r.top), x1 = Math.min(K.W * sc, r.right), y1 = Math.min(K.H * sc, r.bottom);
      if (x1 - x0 < 2 || y1 - y0 < 2) return;
      if ((x1 - x0) * (y1 - y0) > 0.9 * K.W * K.H * sc * sc && e.tagName !== 'CANVAS') return;   // grounds and whole-frame layers
      var anc = [], a = e.parentElement;
      for (; a; a = a.parentElement) if (a.getAttribute && a.getAttribute('data-ovid')) anc.push(a.getAttribute('data-ovid'));
      out.push({ id: e.getAttribute('data-ovid'), name: e.getAttribute('data-ov'), r: [r.left, r.top, r.width, r.height], anc: anc,
        text: !!(e.textContent || '').trim() && !/^(svg|g|CANVAS)$/.test(e.tagName) });
    });
    return out;
  };
  // Show only `show` (ids, with what they contain) on top of the named containers of every id in `around`; hide every
  // other named element. The three shots of a pair share the same containers, so unnamed content inside them cancels.
  K.ovShow = function (show, around) {
    var q = function (id) { return document.querySelector('[data-ovid="' + id + '"]'); };
    var keep = (show || []).map(q).filter(Boolean), anc = (around || []).map(q).filter(Boolean);
    document.querySelectorAll('[data-ovid]').forEach(function (e) {
      var on = keep.some(function (k) { return k === e || e.contains(k) || k.contains(e); }) || anc.some(function (k) { return k !== e && e.contains(k); });
      if (on) e.removeAttribute('data-ovhide'); else e.setAttribute('data-ovhide', '');
    });
  };
  K.ovClear = function () { document.querySelectorAll('[data-ovhide]').forEach(function (e) { e.removeAttribute('data-ovhide'); }); };

  // Text never sits on particles: after the frame is drawn, particles under every visible text without a ground of
  // its own (captions, labels) are erased with a soft edge, so the words read clean. Cards in K.top are not touched.
  function clearUnderText() {
    var layers = Array.prototype.filter.call(document.querySelectorAll('canvas[data-dots]'), function (c) { return !K.top.contains(c); });
    if (!layers.length) return;
    var rects = [], push = function (r) { if (r.width > 1 && r.height > 1) rects.push(r); };
    document.querySelectorAll('[data-ovid]').forEach(function (e) {
      if (/^(CANVAS|svg|g)$/.test(e.tagName) || !(e.textContent || '').trim()) return;
      if (e.querySelector('[data-ovid]')) return;   // a container: its named children are handled one by one
      if (e.checkVisibility && !e.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return;
      var bg = getComputedStyle(e).backgroundColor;
      if (bg && bg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(bg)) return;   // a card with its own ground
      var parts = e.querySelectorAll('span');
      if (parts.length) Array.prototype.forEach.call(parts, function (p) { if (Number(getComputedStyle(p).opacity) >= 0.05) push(p.getBoundingClientRect()); });
      else { var rg = document.createRange(); rg.selectNodeContents(e); Array.prototype.forEach.call(rg.getClientRects(), push); }
    });
    if (!rects.length) return;
    layers.forEach(function (c) {
      if (getComputedStyle(c).visibility === 'hidden') return;
      var cr = c.getBoundingClientRect(); if (cr.width < 1) return;
      var sx = c.width / cr.width, sy = c.height / cr.height, x = c.getContext('2d');
      x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'destination-out'; x.filter = 'blur(' + Math.round(12 * sx) + 'px)'; x.fillStyle = '#000';
      rects.forEach(function (r) { x.fillRect((r.left - cr.left - 22) * sx, (r.top - cr.top - 12) * sy, (r.width + 44) * sx, (r.height + 24) * sy); });
      x.restore();
    });
  }
})();
