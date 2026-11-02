/* Particles: stippled point sets (guide plates, text, the logo, the mascot) drawn as ink on light grounds or as
   light on dark or accent grounds, frame by frame.

   Point sets come from engine/points.mjs (render.mjs builds them before rendering): the piece's points.json plus
   two brand sets that always exist, "logo" and "mascot".

   var L = K.dots.layer(parent)                        a full-frame canvas (with a glow buffer)
   var S = K.dots.place('promise', { cx, cy, h, n })   a set placed in world pixels (n resamples it)
   K.dots.begin(L, cam)                                clear and apply a camera { x, y, z, r }
   K.dots.draw(L, S, { mode: 'ink' | 'light', col, alpha, r0, r1, appear, from, fade, wind, burst, drift, boil, tint, clip })
   K.dots.morph(L, A, B, p, { swirl, stagger, col, colB })   travel from one set to another (p 0..1)
   K.dots.burst(L, x, y, p, { n, spread, col, gravity })     sparks flung out from a point
   K.dots.end(L)                                       composite the glow
   A set can also be made by hand: { n, X: Float32Array, Y, V } (V = tone 0..1, darker dots are bigger). */
(function () {
  'use strict';
  var K = window.K;
  var SETS = {}, META = {};
  function hash(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function clamp(v, a, b) { a = a || 0; b = b == null ? 1 : b; return v < a ? a : v > b ? b : v; }
  function lerp(a, b, k) { return a + (b - a) * k; }
  var ease = {
    outCubic: function (t) { return 1 - Math.pow(1 - t, 3); },
    inOutCubic: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  };
  // seeded 2D simplex noise (after Stefan Gustavson's public-domain description) and its curl, for swirls and drift
  var perm = new Uint8Array(512), pm12 = new Uint8Array(512);
  (function () {
    var p = [], s = 7, i;
    for (i = 0; i < 256; i++) p[i] = i;
    for (i = 255; i > 0; i--) { s = (s * 1664525 + 1013904223) % 4294967296; var j = Math.floor(s / 4294967296 * (i + 1)), t = p[i]; p[i] = p[j]; p[j] = t; }
    for (i = 0; i < 512; i++) { perm[i] = p[i & 255]; pm12[i] = perm[i] % 12; }
  })();
  var G3 = [1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 1, 0, -1, 0, 0, 1, 0, -1, 0, 1, 0, -1];
  function simplex(xin, yin) {
    var F2 = 0.36602540378, G2 = 0.2113248654, s = (xin + yin) * F2, i = Math.floor(xin + s), j = Math.floor(yin + s), t = (i + j) * G2;
    var x0 = xin - (i - t), y0 = yin - (j - t), i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
    var x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2, ii = i & 255, jj = j & 255, n = 0, tt, g;
    tt = 0.5 - x0 * x0 - y0 * y0; if (tt > 0) { g = pm12[ii + perm[jj]] * 2; tt *= tt; n += tt * tt * (G3[g] * x0 + G3[g + 1] * y0); }
    tt = 0.5 - x1 * x1 - y1 * y1; if (tt > 0) { g = pm12[ii + i1 + perm[jj + j1]] * 2; tt *= tt; n += tt * tt * (G3[g] * x1 + G3[g + 1] * y1); }
    tt = 0.5 - x2 * x2 - y2 * y2; if (tt > 0) { g = pm12[ii + 1 + perm[jj + 1]] * 2; tt *= tt; n += tt * tt * (G3[g] * x2 + G3[g + 1] * y2); }
    return 70 * n;
  }
  function curl(x, y, z) { var e = 0.01, a = simplex(x, y + e + z) - simplex(x, y - e + z), b = simplex(x + e + z, y) - simplex(x - e + z, y); return [a / (2 * e), -b / (2 * e)]; }

  // ---------- sets ----------
  // binary format of engine/points.mjs: uint32 n, float32 aspect, then n × (x, y, v) float32 (x, y in 0..1)
  function decode(b64) {
    var bin = atob(b64), buf = new ArrayBuffer(bin.length), u8 = new Uint8Array(buf);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    var dv = new DataView(buf), n = dv.getUint32(0, true), aspect = dv.getFloat32(4, true), x = new Float32Array(n), y = new Float32Array(n), v = new Float32Array(n);
    for (i = 0; i < n; i++) { x[i] = dv.getFloat32(8 + i * 12, true); y[i] = dv.getFloat32(12 + i * 12, true); v[i] = dv.getFloat32(16 + i * 12, true); }
    return { n: n, x: x, y: y, v: v, aspect: aspect };
  }
  function load(points, meta) { for (var k in points) SETS[k] = decode(points[k]); META = meta || {}; }
  // place a set: centre (cx, cy) and height h in world pixels (w follows the set's aspect unless given);
  // n resamples it, keeping the locality order so morphs between sets flow instead of crossing
  function place(name, o) {
    o = o || {};
    var p = SETS[name]; if (!p) throw new Error('no point set "' + name + '" (sets: ' + Object.keys(SETS).join(', ') + '); add it to points.json');
    var h = o.h || K.H, w = o.w || h * p.aspect, N = o.n || p.n, X = new Float32Array(N), Y = new Float32Array(N), V = new Float32Array(N);
    var cx = o.cx == null ? K.W / 2 : o.cx, cy = o.cy == null ? K.H / 2 : o.cy;
    for (var i = 0; i < N; i++) { var k = Math.min(p.n - 1, Math.floor(i * p.n / N)); X[i] = cx + (p.x[k] - 0.5) * w; Y[i] = cy + (p.y[k] - 0.5) * h; V[i] = p.v[k]; }
    var S = { n: N, X: X, Y: Y, V: V, cx: cx, cy: cy, w: w, h: h }, m = META[name];
    if (m && m.screen) {   // a plate with a measured phone screen: where to draw the UI on top of the dots
      var sc = m.screen;
      S.screen = { x0: cx + (sc.x0 - 0.5) * w, y0: cy + (sc.y0 - 0.5) * h, x1: cx + (sc.x1 - 0.5) * w, y1: cy + (sc.y1 - 0.5) * h, rot: sc.rot || 0 };
      S.screen.w = S.screen.x1 - S.screen.x0; S.screen.h = S.screen.y1 - S.screen.y0; S.screen.cx = (S.screen.x0 + S.screen.x1) / 2; S.screen.cy = (S.screen.y0 + S.screen.y1) / 2;
    }
    return S;
  }
  // a random cloud (bursts, swarms, the start of a card): n points in a disc (r) or an ellipse (sx, sy)
  function cloud(n, o) {
    o = o || {}; var X = new Float32Array(n), Y = new Float32Array(n), V = new Float32Array(n), cx = o.cx == null ? K.W / 2 : o.cx, cy = o.cy == null ? K.H / 2 : o.cy;
    for (var i = 0; i < n; i++) { var a = hash(i * 3 + (o.seed || 1)) * Math.PI * 2, r = Math.sqrt(hash(i * 7 + (o.seed || 1))) * (o.r || 900); X[i] = cx + Math.cos(a) * r * (o.sx || 1); Y[i] = cy + Math.sin(a) * r * (o.sy || 1); V[i] = 0.3 + hash(i * 11) * 0.7; }
    return { n: n, X: X, Y: Y, V: V, cx: cx, cy: cy, w: 2 * (o.r || 900), h: 2 * (o.r || 900) };
  }
  // a set moved by (dx, dy), turned by rot (radians) and scaled by sc about its centre
  function moved(S, dx, dy, rot, sc) {
    sc = sc == null ? 1 : sc;
    var T = { n: S.n, X: new Float32Array(S.n), Y: new Float32Array(S.n), V: S.V, cx: S.cx + dx, cy: S.cy + dy, w: S.w * sc, h: S.h * sc };
    var c = Math.cos(rot || 0) * sc, s = Math.sin(rot || 0) * sc;
    for (var i = 0; i < S.n; i++) { var x = S.X[i] - S.cx, y = S.Y[i] - S.cy; T.X[i] = S.cx + dx + x * c - y * s; T.Y[i] = S.cy + dy + x * s + y * c; }
    return T;
  }
  // several sets joined into one (for a morph from "two words" to "one shape")
  function join(list) {
    var n = 0; list.forEach(function (S) { n += S.n; });
    var T = { n: n, X: new Float32Array(n), Y: new Float32Array(n), V: new Float32Array(n) }, k = 0;
    list.forEach(function (S) { T.X.set(S.X, k); T.Y.set(S.Y, k); T.V.set(S.V, k); k += S.n; });
    return T;
  }

  // ---------- drawing ----------
  function layer(parent, z) {
    var W = K.W, H = K.H, c = document.createElement('canvas'); c.width = W; c.height = H;
    c.style.cssText = 'position:absolute;left:0;top:0;width:' + W + 'px;height:' + H + 'px' + (z != null ? ';z-index:' + z : '');
    c.setAttribute('data-ov', 'dots'); c.setAttribute('data-dots', '1');
    (parent || K.root).appendChild(c);
    var g = document.createElement('canvas'); g.width = W / 2; g.height = H / 2;
    return { c: c, ctx: c.getContext('2d'), glow: g, gctx: g.getContext('2d'), cam: { x: W / 2, y: H / 2, z: 1, r: 0 } };
  }
  function begin(L, cam) {
    var W = K.W, H = K.H;
    L.cam = cam || { x: W / 2, y: H / 2, z: 1, r: 0 };
    L.ctx.setTransform(1, 0, 0, 1, 0, 0); L.ctx.clearRect(0, 0, W, H);
    L.gctx.setTransform(1, 0, 0, 1, 0, 0); L.gctx.clearRect(0, 0, W / 2, H / 2);
    L.glowUsed = false;
  }
  function setCam(ctx, cam, s) {
    var z = (cam.z || 1) * s, r = (cam.r || 0) * Math.PI / 180;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(K.W / 2 * s, K.H / 2 * s); ctx.rotate(r); ctx.scale(z, z); ctx.translate(-(cam.x == null ? K.W / 2 : cam.x), -(cam.y == null ? K.H / 2 : cam.y));
  }
  // dots are batched by alpha bucket: one path and one fill per bucket keeps 20k dots fast
  var NB = 10;
  function buckets() { var B = []; for (var b = 0; b < NB; b++) B.push([]); return B; }
  function rgb(hex) { var h = String(hex).replace('#', ''); return [0, 2, 4].map(function (i) { return parseInt(h.slice(i, i + 2), 16); }).join(','); }
  function flush(L, B, light, col, glow) {
    var ctx = L.ctx, b, i, arr;
    setCam(ctx, L.cam, 1);
    ctx.globalCompositeOperation = light ? 'lighter' : 'source-over';
    for (b = 0; b < NB; b++) {
      arr = B[b]; if (!arr.length) continue;
      ctx.fillStyle = 'rgba(' + col + ',' + ((b + 0.5) / NB).toFixed(3) + ')';
      ctx.beginPath();
      for (i = 0; i < arr.length; i += 3) { ctx.moveTo(arr[i] + arr[i + 2], arr[i + 1]); ctx.arc(arr[i], arr[i + 1], arr[i + 2], 0, 6.2832); }
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    if (light && glow) {
      var g = L.gctx; setCam(g, L.cam, 0.5); g.globalCompositeOperation = 'lighter';
      for (b = 0; b < NB; b++) {
        arr = B[b]; if (!arr.length) continue;
        g.fillStyle = 'rgba(' + col + ',' + ((b + 0.5) / NB * 0.5).toFixed(3) + ')';
        g.beginPath();
        for (i = 0; i < arr.length; i += 6) { g.moveTo(arr[i] + arr[i + 2] * 2.6, arr[i + 1]); g.arc(arr[i], arr[i + 1], arr[i + 2] * 2.6, 0, 6.2832); }
        g.fill();
      }
      L.glowUsed = true;
    }
  }

  // o: mode 'ink' | 'light'; col '#hex'; alpha; r0, r1 (dot radius for light and dark tones);
  //    appear 0..1 (darkest dots first) with from { x, y, spread } (where they fly in from);
  //    fade 0..1 with wind (blown sideways) or burst (px, flung out); drift (curl-noise wander, px); boil (jitter that
  //    changes 12 times a second, the hand-drawn look); seed; tint(i, x, y) → '#hex' or null (a second colour per dot);
  //    clip { x0, y0, x1, y1 } (no dots inside: a phone screen drawn on top); glow (light mode, default on)
  function draw(L, S, o) {
    o = o || {};
    var alpha = o.alpha == null ? 1 : o.alpha; if (alpha <= 0.003) return;
    var light = o.mode === 'light', col = rgb(o.col || (light ? K.C.paper : K.C.ink)), r0 = o.r0 == null ? 1.1 : o.r0, r1 = o.r1 == null ? 2.8 : o.r1;
    var appear = o.appear == null ? 1 : o.appear, fade = o.fade || 0, seed = o.seed || 1, boil = o.boil == null ? 0.6 : o.boil, t = K.t, bi = Math.floor(t * 12);
    var B = buckets(), B2 = o.tint ? buckets() : null, col2 = null;
    for (var i = 0; i < S.n; i++) {
      var v = S.V[i], x = S.X[i], y = S.Y[i], a = alpha;
      if (o.clip && x > o.clip.x0 && x < o.clip.x1 && y > o.clip.y0 && y < o.clip.y1) continue;
      if (appear < 1) {
        var th = (1 - v) * 0.7 + hash(i * 3 + seed) * 0.3, k = clamp((appear * 1.25 - th) / 0.25);
        if (k <= 0) continue;
        if (o.from) { var e = ease.outCubic(k); x = lerp(o.from.x + (hash(i * 7 + seed) - 0.5) * o.from.spread, x, e); y = lerp(o.from.y + (hash(i * 11 + seed) - 0.5) * o.from.spread, y, e); }
        a *= k;
      }
      if (fade > 0) {
        var th2 = hash(i * 5 + seed * 3), k2 = clamp((fade * 1.3 - th2) / 0.3);
        if (k2 >= 1) continue;
        if (o.wind) { x += o.wind * k2 * k2 * 160 * (0.5 + hash(i)); y -= k2 * k2 * 90 * hash(i * 2); }
        if (o.burst) { var ang = hash(i * 19 + seed) * 6.2832, d = k2 * k2 * o.burst * (0.4 + hash(i * 23)); x += Math.cos(ang) * d; y += Math.sin(ang) * d; }
        a *= 1 - k2;
      }
      if (o.drift) { var c2 = curl(x * 0.0025, y * 0.0025, t * 0.15 + seed); x += c2[0] * o.drift; y += c2[1] * o.drift; }
      x += (hash(i * 13 + bi * 7919) - 0.5) * 2 * boil; y += (hash(i * 17 + bi * 104729) - 0.5) * 2 * boil;
      var r = r0 + (r1 - r0) * v, aa = light ? a * (0.35 + 0.65 * v) : a * (0.55 + 0.45 * v), bk = Math.min(NB - 1, Math.max(0, Math.floor(aa * NB)));
      if (aa < 0.04) continue;
      var tc = o.tint ? o.tint(i, x, y) : null;
      if (tc) { if (!col2) col2 = rgb(tc); B2[bk].push(x, y, r); } else B[bk].push(x, y, r);
    }
    flush(L, B, light, col, o.glow !== false);
    if (col2) flush(L, B2, light, col2, o.glow !== false);
  }
  // morph between two sets (the shorter decides n): dots travel staggered, with a curl-noise swirl mid-flight;
  // colB paints each dot in a second colour once it is past halfway (grey ink turning accent, for example)
  function morph(L, A, B, p, o) {
    o = o || {};
    var N = Math.min(A.n, B.n), swirl = o.swirl == null ? 70 : o.swirl, stagger = o.stagger == null ? 0.35 : o.stagger;
    var T = { n: N, X: new Float32Array(N), Y: new Float32Array(N), V: new Float32Array(N) };
    for (var i = 0; i < N; i++) {
      var d = hash(i * 29 + 5) * stagger, k = ease.inOutCubic(clamp((p - d) / (1 - stagger)));
      var x = lerp(A.X[i], B.X[i], k), y = lerp(A.Y[i], B.Y[i], k), m = Math.sin(Math.PI * k);
      if (m > 0.01 && swirl) { var c = curl(x * 0.004, y * 0.004, i * 0.001 + K.t * 0.2); x += c[0] * swirl * m; y += c[1] * swirl * m; }
      T.X[i] = x; T.Y[i] = y; T.V[i] = lerp(A.V[i], B.V[i], k);
    }
    var colB = o.colB;
    draw(L, T, { mode: o.mode, col: o.col, r0: o.r0, r1: o.r1, alpha: o.alpha, boil: o.boil, glow: o.glow,
      tint: colB ? function (i) { var d = hash(i * 29 + 5) * stagger; return clamp((p - d) / (1 - stagger)) > 0.5 ? colB : null; } : o.tint });
  }
  // sparks from (x, y): n particles flung outwards as p goes 0 → 1
  function burst(L, x, y, p, o) {
    o = o || {}; if (p <= 0 || p >= 1) return;
    var n = o.n || 400, S = { n: n, X: new Float32Array(n), Y: new Float32Array(n), V: new Float32Array(n) };
    for (var i = 0; i < n; i++) {
      var a = hash(i * 7 + (o.seed || 3)) * 6.2832, sp = (0.3 + hash(i * 13) * 0.7) * (o.spread || 520), e = 1 - Math.pow(1 - p, 2.2);
      S.X[i] = x + Math.cos(a) * sp * e; S.Y[i] = y + Math.sin(a) * sp * e + (o.gravity || 0) * p * p; S.V[i] = (1 - p) * (0.4 + hash(i) * 0.6);
    }
    draw(L, S, { mode: o.mode || 'ink', col: o.col, r0: o.r0 || 1.5, r1: o.r1 || 4.5, boil: 0, glow: o.glow });
  }
  function end(L) {
    if (!L.glowUsed) return;
    var ctx = L.ctx; ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(7px)'; ctx.drawImage(L.glow, 0, 0, K.W, K.H); ctx.restore();
    ctx.filter = 'none';
  }
  K.dots = { load: load, place: place, cloud: cloud, moved: moved, join: join, layer: layer, begin: begin, draw: draw, morph: morph, burst: burst, end: end,
    sets: SETS, meta: function () { return META; }, hash: hash, curl: curl, simplex: simplex };
})();

/* The end card in particles: the dots of the last scene (or a cloud) fly in and assemble the logo, which then
   settles into the solid drawing, with a line and the address.
   var card = K.dotsCard(K.top, { bg, fg, line, url, at })   card.frame(t, t0, fromSet, dur) */
(function () {
  'use strict';
  var K = window.K;
  K.dotsCard = function (parent, o) {
    o = o || {};
    var W = K.W, H = K.H, b = K.brand || {}, bg = o.bg || K.C.accent, fg = o.fg || K.C.accentInk, lw = o.logoW || 640;
    var box = K.el('div', { style: { position: 'absolute', left: '0px', top: '0px', width: W + 'px', height: H + 'px', zIndex: 45 } }, parent || K.top);
    var paint = K.el('div', { style: { position: 'absolute', inset: '0px', background: bg } }, box);
    var L = K.dots.layer(box, 2);
    var logoBox = K.el('div', { style: { position: 'absolute', left: ((W - lw) / 2) + 'px', top: '0px', width: lw + 'px', zIndex: 3 } }, box);
    var logo = K.logo(logoBox, { color: fg, dotColor: o.dotColor || fg, width: lw });
    var lineText = o.line != null ? o.line : (b.tagline || ''), urlText = o.url != null ? o.url : (b.url || '');
    var line = K.el('div', { cls: 'display', text: lineText, style: { position: 'absolute', left: '90px', right: '90px', top: '0px', textAlign: 'center', fontSize: (o.lineSize || 62) + 'px', lineHeight: '1.08', color: fg, textWrap: 'balance', zIndex: 3 } }, box);
    var url = K.el('div', { text: urlText, style: { position: 'absolute', left: '90px', right: '90px', top: '0px', textAlign: 'center', fontFamily: K.F.body, fontWeight: 800, fontSize: '46px', color: fg, zIndex: 3 } }, box);
    var lyTop = (o.y || 860) - logo.height / 2 - (lineText ? 60 : 0);
    logoBox.style.top = lyTop + 'px';
    line.style.top = (lyTop + logo.height + 80) + 'px';
    url.style.top = (lyTop + logo.height + (lineText ? 240 : 80)) + 'px';
    if (!lineText) line.style.display = 'none';
    if (!urlText) url.style.display = 'none';
    if (o.at != null && o.sound !== false) K.sfx(o.at + (o.dur || 1.1) - 0.05, o.sound || 'logo', { gain_db: o.gain_db != null ? o.gain_db : -8 });
    var target = null, cloud = null;
    return {
      el: box, logo: logo,
      // t0: start; from: a placed point set to fly in from (null: a cloud); dur: assembly time
      frame: function (t, t0, from, dur) {
        if (t0 == null) t0 = o.at;
        dur = dur || o.dur || 1.1;
        var on = t >= t0; box.style.visibility = on ? '' : 'hidden';
        if (!on) return;
        if (!target) target = K.dots.place('logo', { cx: W / 2, cy: lyTop + logo.height / 2, h: logo.height, w: logo.width, n: from ? from.n : 14000 });
        if (!from && !cloud) cloud = K.dots.cloud(target.n, { r: 1400, seed: 9 });
        var src = from || cloud, p = K.prog(t, t0, t0 + dur);
        paint.style.opacity = K.E.out(K.prog(t, t0, t0 + 0.35)).toFixed(3);
        K.dots.begin(L, { x: W / 2, y: H / 2, z: 1 });
        var solid = K.prog(t, t0 + dur - 0.05, t0 + dur + 0.25);
        if (solid < 1) K.dots.morph(L, src, target, p, { mode: bg === K.C.paper ? 'ink' : 'light', col: fg, swirl: 160, stagger: 0.3, r0: 1.0, r1: 2.6, glow: false, alpha: 1 - solid * 0.9 });
        K.dots.end(L);
        logo.el.style.opacity = solid.toFixed(3);
        var k1 = K.prog(t, t0 + dur + 0.15, t0 + dur + 0.6), k2 = K.prog(t, t0 + dur + 0.4, t0 + dur + 0.85);
        line.style.opacity = K.E.out(k1); line.style.transform = 'translateY(' + ((1 - K.E.out(k1)) * 30).toFixed(1) + 'px)';
        url.style.opacity = K.E.out(k2); url.style.transform = 'translateY(' + ((1 - K.E.out(k2)) * 30).toFixed(1) + 'px)';
        box.style.transform = 'scale(' + (1 + 0.03 * K.E.sine(K.prog(t, t0 + dur + 0.3, t0 + dur + 5))).toFixed(4) + ')';
      }
    };
  };
})();
