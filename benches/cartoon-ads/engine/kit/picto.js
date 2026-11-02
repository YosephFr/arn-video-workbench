/* Pictograms: the viral explainer look (flat figures in one colour on a plain ground, usually light on dark),
   plus the old-film and VHS overlays that go with it. Figures are drawn once and moved every frame, all in frame
   pixels. The format's mystery comes from secrets, numbered rules and silence, not from the supernatural.

   var P = K.picto
   var fig = P.person(layer, { color, eyes })  fig.set({ x, y, s, op, pose, walk, look, mood, mark })
       poses: stand, think, point, shrug, walk, phone, cash, shh, sit; mood -1 sad … 1 smile; mark: '!' or '?' above
   P.phone(layer, { text, fill, stroke }) with set({ ..., bubble: 0..1, bubbleY }), P.say(layer, { text, w, size })
   P.moon, P.sun, P.store (set: door 0..1, lit), P.cross, P.ticks, P.bag, P.cash, P.warn, P.clock (set: a = minute
   hand in degrees), P.cloud (set(p, t): rain), P.chair, P.cup        each → { g, set({ x, y, s, r, op }) }
   var F = K.oldFilm(K.top) → F.frame(t, amount), F.weave(t, amount) → [dx, dy] to shake the picture
   var V = K.vhs(K.top)     → V.frame(t, amount, tear), V.shift(t, tear) → px to nudge torn frames sideways */
(function () {
  'use strict';
  var K = window.K;
  function s(tag, a, p) { return K.svg(tag, a, p); }
  function fontD() { return K.F.display.replace(/"/g, "'"); }
  function fontB() { return K.F.body.replace(/"/g, "'"); }
  function mover(g) {
    return function (p) {
      p = p || {};
      g.setAttribute('transform', 'translate(' + (p.x || 0) + ' ' + (p.y || 0) + ') rotate(' + (p.r || 0) + ') scale(' + (p.s == null ? 1 : p.s) + ')');
      g.style.opacity = p.op == null ? 1 : K.clamp(p.op, 0, 1);
      g.style.visibility = p.op === 0 || p.s === 0 ? 'hidden' : '';
    };
  }
  var P = {};
  // a person: a round head and rounded limbs; (0, 0) is between the feet
  P.person = function (parent, o) {
    o = o || {}; var col = o.color || K.C.paper, eyesC = o.eyes || K.C.ink, g = s('g', { 'data-ov': 'figure' }, parent), w = 34;
    var stroke = function () { return s('path', { d: '', stroke: col, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', fill: 'none' }, g); };
    var legL = stroke(), legR = stroke(), body = stroke(), armL = stroke(), armR = stroke();
    var head = s('circle', { r: 46, fill: col }, g);
    var eyeL = s('circle', { r: 6, fill: eyesC }, g), eyeR = s('circle', { r: 6, fill: eyesC }, g);
    var mouth = s('path', { d: '', stroke: eyesC, 'stroke-width': 6, 'stroke-linecap': 'round', fill: 'none' }, g);
    var mark = s('text', { 'text-anchor': 'middle', 'font-family': fontD(), 'font-weight': 800, 'font-size': 64, fill: col }, g);
    var finger = s('path', { d: K.rr(-8, -396, 16, 42, 8), fill: col, stroke: eyesC, 'stroke-width': 5 }, g);   // "shh": a finger on the lips
    var set = mover(g);
    var ARMS = {
      stand: ['M0 -310L-46 -230L-52 -160', 'M0 -310L46 -230L52 -160'],
      think: ['M0 -310L-40 -240L22 -300', 'M0 -310L46 -230L52 -160'],
      point: ['M0 -310L-46 -230L-52 -160', 'M0 -310L80 -300L150 -310'],
      shrug: ['M0 -310L-70 -280L-90 -330', 'M0 -310L70 -280L90 -330'],
      phone: ['M0 -310L-40 -240L-10 -260', 'M0 -310L40 -240L10 -260'],
      cash: ['M0 -310L-44 -236L-14 -268', 'M0 -310L92 -300L168 -352'],
      shh: ['M0 -310L-46 -230L-52 -160', 'M0 -310L54 -318L12 -362'],
      sit: ['M0 -290L40 -220L84 -206', 'M0 -290L52 -226L98 -214']
    };
    return {
      g: g,
      set: function (p) {
        p = p || {}; set(p);
        var pose = p.pose || 'stand', ph = (p.walk || 0) * Math.PI * 2, lk = p.look || 0;
        var sit = pose === 'sit', hip = sit ? [0, -150] : [0, -170], neck = sit ? [0, -310] : [0, -330], hy = sit ? -380 : -400;
        var la = pose === 'walk' ? Math.sin(ph) * 26 : 14, ra = pose === 'walk' ? -Math.sin(ph) * 26 : -14;
        if (sit) { legL.setAttribute('d', 'M0 -150L96 -150L96 -8'); legR.setAttribute('d', 'M0 -150L112 -146L112 -8'); }
        else {
          legL.setAttribute('d', 'M' + hip[0] + ' ' + hip[1] + 'L' + (hip[0] - la) + ' -8');
          legR.setAttribute('d', 'M' + hip[0] + ' ' + hip[1] + 'L' + (hip[0] - ra) + ' -8');
        }
        body.setAttribute('d', 'M' + neck[0] + ' ' + neck[1] + 'L' + hip[0] + ' ' + hip[1]);
        var A = pose === 'walk' ? ['M0 -310L' + (-30 - ra * 0.6) + ' -230L' + (-36 - ra) + ' -160', 'M0 -310L' + (30 - la * 0.6) + ' -230L' + (36 - la) + ' -160'] : (ARMS[pose] || ARMS.stand);
        armL.setAttribute('d', A[0]); armR.setAttribute('d', A[1]);
        head.setAttribute('cx', lk * 6); head.setAttribute('cy', hy);
        eyeL.setAttribute('cx', -16 + lk * 14); eyeR.setAttribute('cx', 16 + lk * 14); eyeL.setAttribute('cy', hy - 6); eyeR.setAttribute('cy', hy - 6);
        var m = p.mood || 0;
        mouth.setAttribute('d', 'M' + (-14 + lk * 14) + ' ' + (hy + 18 - m * 4) + 'Q' + (lk * 14) + ' ' + (hy + 18 + m * 10) + ' ' + (14 + lk * 14) + ' ' + (hy + 18 - m * 4));
        mark.textContent = p.mark || ''; mark.setAttribute('x', 20); mark.setAttribute('y', hy - 70);
        finger.style.display = pose === 'shh' ? '' : 'none';
      }
    };
  };
  // a phone outline with a speech bubble on it; fill gives it a dark screen, to hold it in front of a light body
  P.phone = function (parent, o) {
    o = o || {}; var col = o.color || K.C.paper, g = s('g', { 'data-ov': 'phone' }, parent);
    s('path', { d: K.rr(-95, -180, 190, 360, 34), fill: o.fill || 'none', stroke: col, 'stroke-width': o.stroke || 16 }, g);
    s('rect', { x: -26, y: -160, width: 52, height: 10, rx: 5, fill: col }, g);
    var bubble = s('g', {}, g);
    s('path', { d: K.rr(-130, -60, 260, 92, 36), fill: col }, bubble);
    var bt = s('text', { x: 0, y: 2, 'text-anchor': 'middle', 'font-family': fontB(), 'font-weight': 900, 'font-size': 40, fill: o.textColor || K.C.ink }, bubble); bt.textContent = o.text == null ? 'Price?' : o.text;
    var set = mover(g);
    return { g: g, bubble: bubble, set: function (p) { p = p || {}; set(p); var b = p.bubble == null ? 1 : p.bubble; bubble.setAttribute('transform', 'translate(0 ' + (p.bubbleY || 0) + ') scale(' + b + ')'); bubble.style.visibility = b > 0 ? '' : 'hidden'; } };
  };
  P.moon = function (parent, o) { o = o || {}; var g = s('g', { 'data-ov': 'moon' }, parent); s('path', { d: 'M0 -90A90 90 0 1 0 78 46A72 72 0 1 1 0 -90Z', fill: o.color || K.C.paper }, g); return { g: g, set: mover(g) }; };
  P.sun = function (parent, o) {
    o = o || {}; var g = s('g', { 'data-ov': 'sun' }, parent), col = o.color || K.C.paper;
    s('circle', { r: 60, fill: col }, g);
    for (var i = 0; i < 8; i++) s('rect', { x: -10, y: -118, width: 20, height: 36, rx: 10, fill: col, transform: 'rotate(' + i * 45 + ')' }, g);
    return { g: g, set: mover(g) };
  };
  P.store = function (parent, o) {
    o = o || {}; var col = o.color || K.C.paper, g = s('g', { 'data-ov': 'store' }, parent);
    s('path', { d: K.rr(-170, -260, 340, 260, 18), fill: 'none', stroke: col, 'stroke-width': 16 }, g);
    for (var i = 0; i < 5; i++) s('path', { d: 'M' + (-190 + i * 76) + ' -300h76v34a38 38 0 0 1 -76 0Z', fill: i % 2 ? 'none' : col, stroke: col, 'stroke-width': 10 }, g);
    var door = s('path', { d: K.rr(30, -170, 90, 170, 10), fill: col }, g);
    var win = s('path', { d: K.rr(-130, -190, 120, 90, 12), fill: o.lit ? col : 'none', stroke: col, 'stroke-width': 10 }, g);
    var set = mover(g);
    return { g: g, door: door, win: win, set: function (p) { p = p || {}; set(p); door.style.transformBox = 'fill-box'; door.style.transformOrigin = 'left center'; door.style.transform = 'scaleX(' + (p.door == null ? 1 : p.door) + ')'; win.setAttribute('fill', p.lit ? col : 'none'); } };
  };
  // a fan of banknotes; (0, 0) is where the hand holds them
  P.cash = function (parent, o) {
    o = o || {}; var col = o.color || K.C.paper, ink = o.ink || K.C.ink, g = s('g', { 'data-ov': 'cash' }, parent);
    [-16, 0, 16].forEach(function (a) {
      var b = s('g', { transform: 'rotate(' + a + ') translate(0 -46)' }, g);
      s('path', { d: K.rr(-74, -40, 148, 80, 12), fill: col }, b);
      s('path', { d: K.rr(-62, -28, 124, 56, 8), fill: 'none', stroke: ink, 'stroke-width': 5 }, b);
      var d = s('text', { x: 0, y: 17, 'text-anchor': 'middle', 'font-family': fontD(), 'font-weight': 800, 'font-size': 46, fill: ink }, b); d.textContent = o.symbol || (K.brand && K.brand.currency) || '$';
    });
    return { g: g, set: mover(g) };
  };
  // a wall clock; set({ a }) turns the minute hand (degrees) and the hour hand follows at 1/12 (or set h)
  P.clock = function (parent, o) {
    o = o || {}; var col = o.color || K.C.paper, g = s('g', { 'data-ov': 'clock' }, parent);
    s('circle', { r: 128, fill: 'none', stroke: col, 'stroke-width': 18 }, g);
    for (var i = 0; i < 12; i++) s('rect', { x: -5, y: -112, width: 10, height: i % 3 ? 14 : 26, rx: 5, fill: col, transform: 'rotate(' + i * 30 + ')' }, g);
    var hh = s('rect', { x: -9, y: -62, width: 18, height: 70, rx: 9, fill: col }, g), mm = s('rect', { x: -6, y: -96, width: 12, height: 104, rx: 6, fill: col }, g);
    s('circle', { r: 14, fill: col }, g);
    var set = mover(g);
    return { g: g, set: function (p) { p = p || {}; set(p); var a = p.a || 0; mm.setAttribute('transform', 'rotate(' + a + ')'); hh.setAttribute('transform', 'rotate(' + (p.h != null ? p.h : a / 12 + 120) + ')'); } };
  };
  // a cloud with rain; set(p, t) moves the drops
  P.cloud = function (parent, o) {
    o = o || {}; var col = o.color || K.C.paper, g = s('g', { 'data-ov': 'cloud' }, parent);
    s('path', { d: 'M-150 40A60 60 0 0 1 -110 -60A80 80 0 0 1 40 -90A70 70 0 0 1 150 -10A50 50 0 0 1 150 40Z', fill: col }, g);
    var drops = []; for (var i = 0; i < 7; i++) drops.push(s('rect', { x: -6, y: 0, width: 12, height: 44, rx: 6, fill: col }, g));
    var set = mover(g);
    return { g: g, set: function (p, t) { p = p || {}; set(p); drops.forEach(function (d, i) { var k = ((t || 0) * 1.6 + i * 0.37) % 1; d.setAttribute('transform', 'translate(' + (-120 + i * 40) + ' ' + (70 + k * 150) + ')'); d.style.opacity = 1 - k; }); } };
  };
  // a speech bubble with words in it; the tail points down-left
  P.say = function (parent, o) {
    o = o || {}; var col = o.color || K.C.paper, g = s('g', { 'data-ov': 'say' }, parent), w = o.w || 380;
    s('path', { d: K.rr(-w / 2, -64, w, 108, 40), fill: col }, g);
    s('path', { d: 'M' + (-w / 2 + 50) + ' 30L' + (-w / 2 + 34) + ' 92L' + (-w / 2 + 104) + ' 40Z', fill: col }, g);
    var tx = s('text', { x: 0, y: 4, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-family': fontB(), 'font-weight': 900, 'font-size': o.size || 42, fill: o.textColor || K.C.ink }, g); tx.textContent = o.text || '';
    var set = mover(g);
    return { g: g, set: function (p) { p = p || {}; set(p); if (p.text != null) tx.textContent = p.text; } };
  };
  P.chair = function (parent, o) {
    o = o || {}; var g = s('g', { 'data-ov': 'chair' }, parent);
    s('path', { d: 'M-40 -150H150M-40 -150V-330M-40 -150V0M130 -150V0', stroke: o.color || K.C.paper, 'stroke-width': 18, 'stroke-linecap': 'round', fill: 'none' }, g);
    return { g: g, set: mover(g) };
  };
  P.cup = function (parent, o) {
    o = o || {}; var col = o.color || K.C.paper, g = s('g', { 'data-ov': 'cup' }, parent);
    s('path', { d: 'M-34 -60H34V-14A34 34 0 0 1 -34 -14Z', fill: col }, g);
    s('path', { d: 'M34 -48A18 18 0 0 1 34 -16', stroke: col, 'stroke-width': 9, fill: 'none' }, g);
    return { g: g, set: mover(g) };
  };
  P.cross = function (parent, o) { o = o || {}; var g = s('g', { 'data-ov': 'cross' }, parent); s('path', { d: 'M-110 -110L110 110M110 -110L-110 110', stroke: o.color || K.C.paper, 'stroke-width': 30, 'stroke-linecap': 'round' }, g); return { g: g, set: mover(g) }; };
  P.ticks = function (parent, o) { o = o || {}; var g = s('g', { 'data-ov': 'ticks' }, parent); [0, 52].forEach(function (dx) { s('path', { d: 'M' + (dx - 90) + ' 0l34 34l64 -76', stroke: o.color || K.C.paper, 'stroke-width': 22, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', fill: 'none' }, g); }); return { g: g, set: mover(g) }; };
  P.bag = function (parent, o) { o = o || {}; var g = s('g', { 'data-ov': 'bag' }, parent), col = o.color || K.C.paper; s('path', { d: 'M-34 -70C-34 -110 34 -110 34 -70', stroke: col, 'stroke-width': 12, fill: 'none' }, g); s('path', { d: K.rr(-60, -72, 120, 120, 16), fill: col }, g); return { g: g, set: mover(g) }; };
  P.warn = function (parent, o) { o = o || {}; var g = s('g', { 'data-ov': 'warn' }, parent), col = o.color || K.C.paper; s('path', { d: 'M0 -150L150 120H-150Z', fill: 'none', stroke: col, 'stroke-width': 22, 'stroke-linejoin': 'round' }, g); s('rect', { x: -12, y: -60, width: 24, height: 110, rx: 12, fill: col }, g); s('circle', { cy: 85, r: 15, fill: col }, g); return { g: g, set: mover(g) }; };
  K.picto = P;

  // light flecks are drawn in the paper colour, shadows in black
  function paperRgba(a) { var h = K.C.paper.replace('#', ''); return 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ',' + a + ')'; }

  // ---------- old film: grain, dust, hairs, scratches, flicker, vignette, gate weave ----------
  K.oldFilm = function (parent, o) {
    o = o || {};
    var W = K.W, H = K.H, c = document.createElement('canvas'); c.width = W; c.height = H;
    c.style.cssText = 'position:absolute;left:0;top:0;width:' + W + 'px;height:' + H + 'px;z-index:' + (o.z || 40) + ';pointer-events:none';
    (parent || K.top).appendChild(c);
    var x = c.getContext('2d'), h = K.dots.hash;
    return {
      c: c,
      frame: function (t, amount) {
        x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, W, H);
        c.style.visibility = amount > 0 ? '' : 'hidden';
        if (amount <= 0) return;
        var f = Math.floor(t * 24);   // the projector runs at 24
        var fl = (h(f * 3.1) - 0.5) * 0.07 * amount;
        x.fillStyle = fl > 0 ? paperRgba(fl) : 'rgba(0,0,0,' + (-fl) + ')'; x.fillRect(0, 0, W, H);
        var g = x.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.72);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,' + (0.55 * amount) + ')');
        x.fillStyle = g; x.fillRect(0, 0, W, H);
        for (var i = 0; i < 2600; i++) {
          var gx = h(f * 7919 + i * 13) * W, gy = h(f * 104729 + i * 17) * H, v = h(i * 31 + f);
          x.fillStyle = v > 0.5 ? paperRgba(0.10 * amount) : 'rgba(0,0,0,' + (0.18 * amount) + ')';
          x.fillRect(gx, gy, 2, 2);
        }
        for (var d = 0; d < 6; d++) {
          if (h(f * 13 + d) > 0.35) continue;
          var dx = h(f * 17 + d * 5) * W, dy = h(f * 19 + d * 7) * H, r = 2 + h(f + d) * 6;
          x.fillStyle = paperRgba(0.5 * amount); x.beginPath(); x.arc(dx, dy, r, 0, 6.283); x.fill();
          if (h(f * 23 + d) < 0.3) { x.strokeStyle = paperRgba(0.4 * amount); x.lineWidth = 2; x.beginPath(); x.moveTo(dx, dy); x.quadraticCurveTo(dx + 30, dy + 20, dx + 10 + h(d) * 40, dy + 60); x.stroke(); }
        }
        var sf = Math.floor(f / 5);   // scratches that last a few frames
        for (var k = 0; k < 2; k++) {
          if (h(sf * 7 + k) > 0.45) continue;
          var sx = h(sf * 11 + k * 3) * W;
          x.fillStyle = paperRgba(0.22 * amount); x.fillRect(sx + (h(f + k) - 0.5) * 4, 0, 2.5, H);
        }
      },
      weave: function (t, amount) { var f = Math.floor(t * 24); return [(h(f * 2.3) - 0.5) * 5 * amount, (h(f * 4.7) - 0.5) * 7 * amount]; }
    };
  };

  // ---------- VHS: horizontal tracking streaks and a rolling noise band (the analog-tape look) ----------
  K.vhs = function (parent, o) {
    o = o || {};
    var W = K.W, H = K.H, c = document.createElement('canvas'); c.width = W; c.height = H;
    c.style.cssText = 'position:absolute;left:0;top:0;width:' + W + 'px;height:' + H + 'px;z-index:' + (o.z || 41) + ';pointer-events:none';
    (parent || K.top).appendChild(c);
    var x = c.getContext('2d'), h = K.dots.hash;
    return {
      c: c,
      frame: function (t, amount, tear) {
        tear = tear || 0;
        x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, W, H);
        c.style.visibility = amount > 0 ? '' : 'hidden';
        if (amount <= 0) return;
        var f = Math.floor(t * 24), n = 3 + Math.floor(tear * 10);
        for (var i = 0; i < n; i++) {
          if (h(f * 31 + i * 7) > 0.55 + tear * 0.4) continue;
          var y = h(f * 13 + i * 3) * H, len = 80 + h(f * 17 + i) * (tear > 0.3 ? W : 420), x0 = h(f * 19 + i * 5) * (W - len * 0.5);
          x.fillStyle = paperRgba((0.10 + h(i * 11 + f) * 0.35) * amount); x.fillRect(x0, y, len, 2 + h(f + i) * 3);
        }
        var by = ((t * 0.21) % 1) * (H + 200) - 100, bh = 26 + tear * 70;
        for (var k = 0; k < 40 + tear * 120; k++) {
          var nx = h(f * 7 + k * 13) * W, ny = by + h(f * 11 + k * 17) * bh;
          x.fillStyle = paperRgba((0.05 + 0.18 * h(k + f)) * amount); x.fillRect(nx, ny, 6 + h(k * 3) * 40, 2);
        }
      },
      shift: function (t, tear) { var f = Math.floor(t * 24); return tear > 0 && h(f * 5.3) < tear * 0.7 ? (h(f * 9.1) - 0.5) * 36 * tear : 0; }
    };
  };
})();
