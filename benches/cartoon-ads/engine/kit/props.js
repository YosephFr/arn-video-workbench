/* Props of the cartoon world, drawn in code as SVG groups so a person can hold them (K.props.phone(alex.hand)).
   Every prop returns { g, set(t, { x, y, s, r, op }) } plus its own parts. Text inside props is HTML in a
   foreignObject, so it wraps and uses the brand fonts. Props are grey; only what the mascot handled turns accent. */
(function () {
  'use strict';
  var K = window.K;
  function s(tag, a, p) { return K.svg(tag, a, p); }
  function mover(g) {
    return function (t, p) {
      p = p || {};
      g.setAttribute('transform', 'translate(' + (p.x || 0) + ' ' + (p.y || 0) + ') rotate(' + (p.r || 0) + ') scale(' + (p.s == null ? 1 : p.s) + ')');
      g.style.opacity = p.op == null ? 1 : K.clamp(p.op, 0, 1);
      g.style.visibility = p.op === 0 || p.s === 0 ? 'hidden' : '';
    };
  }
  var uid = 0;

  // the app icon: the mascot's silhouette, its face cut out, on an accent squircle (notifications, app grids);
  // a group centred on (0, 0)
  function badge(parent, size, o) {
    o = o || {};
    var C = K.C, S = window.MASCOT_SHAPE, g = s('g', { 'data-ov': 'badge' }, parent);
    s('path', { d: K.rr(-size / 2, -size / 2, size, size, size * 0.3), fill: o.fill || C.accent }, g);
    var vb = S.view, k = size * 0.72 / vb[3], id = 'badge' + (++uid), face = K.mascotFace();
    var inner = s('g', { transform: 'translate(0 ' + (size * 0.4) + ') scale(' + k.toFixed(5) + ')' }, g);
    var m = s('mask', { id: id, maskUnits: 'userSpaceOnUse', x: vb[0], y: vb[1], width: vb[2], height: vb[3] + 100 }, inner);
    s('rect', { x: vb[0], y: vb[1], width: vb[2], height: vb[3] + 100, fill: '#fff' }, m);
    face.eyes.forEach(function (e) { s('ellipse', { cx: e.cx, cy: e.cy, rx: e.rx, ry: e.ry, fill: '#000' }, m); });
    if (face.mouth) s('path', { d: face.mouth.d, fill: '#000', stroke: '#000', 'stroke-width': face.mouth.width * 1.3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, m);
    var gm = s('g', { mask: 'url(#' + id + ')', fill: o.ink || C.accentInk }, inner);
    K.mascotPaths().forEach(function (d) { s('path', { d: d }, gm); });
    return g;
  }

  K.props = {
    // the app icon as a prop: K.props.badge(layer, { size: 120 }).set(t, { x, y, s })
    badge: function (parent, o) { o = o || {}; var g = badge(parent, o.size || 120, o); return { g: g, set: mover(g) }; },
    // a phone; screen content goes in .screen (clipped); (0, 0) is the phone's centre
    phone: function (parent, o) {
      o = o || {}; var C = K.C, w = o.w || 300, h = o.h || 620, g = s('g', { 'data-ov': 'phone' }, parent), id = 'ph' + (++uid);
      s('path', { d: K.rr(-w / 2, -h / 2, w, h, w * 0.19), fill: o.body || C.ink }, g);
      var cp = s('clipPath', { id: id }, g); s('path', { d: K.rr(-w / 2 + 12, -h / 2 + 12, w - 24, h - 24, w * 0.15) }, cp);
      var scr = s('g', { 'clip-path': 'url(#' + id + ')' }, g);
      var bg = s('path', { d: K.rr(-w / 2 + 12, -h / 2 + 12, w - 24, h - 24, w * 0.15), fill: o.screen || C.paper }, scr);
      var screen = s('g', {}, scr);
      s('path', { d: K.rr(-w * 0.17, -h / 2 + 26, w * 0.34, 30, 15), fill: o.body || C.ink }, g);
      return { g: g, screen: screen, bg: bg, w: w, h: h, set: mover(g) };
    },
    // a message bubble with text; side 'in' (light grey, tail left), 'out' (white, tail right) or 'brand' (accent, tail right)
    bubble: function (parent, text, o) {
      o = o || {}; var C = K.C, G = K.G, w = o.w || 420, h = o.h || 110, g = s('g', { 'data-ov': 'bubble' }, parent), side = o.side || 'in';
      var fill = o.fill || (side === 'brand' ? C.accent : side === 'out' ? C.surface : G.skin1), col = side === 'brand' ? C.accentInk : C.ink;
      var body = s('path', { d: K.rr(-w / 2, -h / 2, w, h, Math.min(44, h / 2)), fill: fill }, g);
      var tail = side === 'in' ? 'M' + (-w / 2 + 18) + ' ' + (h / 2 - 30) + 'L' + (-w / 2 - 14) + ' ' + (h / 2 + 6) + 'L' + (-w / 2 + 46) + ' ' + (h / 2 - 4) + 'Z'
        : 'M' + (w / 2 - 18) + ' ' + (h / 2 - 30) + 'L' + (w / 2 + 14) + ' ' + (h / 2 + 6) + 'L' + (w / 2 - 46) + ' ' + (h / 2 - 4) + 'Z';
      var tl = s('path', { d: tail, fill: fill }, g);
      var tx = K.html(g, -w / 2 + 30, -h / 2, w - 60, h, 'display:flex;align-items:center;font-weight:700;font-size:' + (o.size || 40) + 'px;line-height:1.15;color:' + col);
      tx.textContent = text;
      return { g: g, text: tx, set: mover(g), fill: function (c, ink) { body.setAttribute('fill', c); tl.setAttribute('fill', c); if (ink) tx.style.color = ink; } };
    },
    // the notification the owner gets: badge, a bold title (the brand name by default) and a line of detail
    notice: function (parent, title, body, o) {
      o = o || {}; var C = K.C, w = o.w || 820, h = o.h || 170, g = s('g', { 'data-ov': 'notice' }, parent);
      s('path', { d: K.rr(-w / 2, -h / 2, w, h, 44), fill: o.fill || C.surface }, g);
      var b = badge(g, 96); b.setAttribute('transform', 'translate(' + (-w / 2 + 82) + ' 0)');
      var tx = K.html(g, -w / 2 + 152, -h / 2 + 22, w - 190, h - 44, 'display:flex;flex-direction:column;justify-content:center;gap:4px');
      var t1 = document.createElement('div'); t1.style.cssText = 'font-weight:800;font-size:38px;line-height:1.1'; t1.textContent = title == null ? (K.brand.name || '') : title; tx.appendChild(t1);
      var t2 = document.createElement('div'); t2.style.cssText = 'font-weight:600;font-size:32px;line-height:1.2;color:' + C.muted; t2.textContent = body || ''; tx.appendChild(t2);
      return { g: g, title: t1, body: t2, set: mover(g) };
    },
    // a wall clock; .time(hours as a decimal) sets the hands
    clock: function (parent, o) {
      o = o || {}; var C = K.C, r = o.r || 120, g = s('g', { 'data-ov': 'clock' }, parent);
      s('circle', { r: r, fill: o.face || C.surface, stroke: o.rim || C.ink, 'stroke-width': r * 0.12 }, g);
      for (var i = 0; i < 12; i++) s('rect', { x: -5, y: -r * 0.78, width: 10, height: r * 0.14, rx: 5, fill: C.ink, transform: 'rotate(' + i * 30 + ')' }, g);
      var hh = s('rect', { x: -9, y: -r * 0.5, width: 18, height: r * 0.56, rx: 9, fill: C.ink }, g);
      var mm = s('rect', { x: -6, y: -r * 0.72, width: 12, height: r * 0.78, rx: 6, fill: C.ink }, g);
      s('circle', { r: 14, fill: C.ink }, g);
      return { g: g, set: mover(g), time: function (hours) { hh.setAttribute('transform', 'rotate(' + (hours % 12) * 30 + ')'); mm.setAttribute('transform', 'rotate(' + (hours % 1) * 360 + ')'); } };
    },
    // a banknote with the brand's currency sign
    bill: function (parent, o) {
      o = o || {}; var G = K.G, w = o.w || 220, h = w * 0.46, g = s('g', { 'data-ov': 'bill' }, parent);
      s('path', { d: K.rr(-w / 2, -h / 2, w, h, 16), fill: o.fill || G.skin3 }, g);
      s('path', { d: K.rr(-w / 2 + 12, -h / 2 + 12, w - 24, h - 24, 10), fill: 'none', stroke: o.ink || G.mid, 'stroke-width': 6 }, g);
      s('circle', { r: h * 0.28, fill: o.ink || G.mid }, g);
      var t = s('text', { x: 0, y: h * 0.13, 'text-anchor': 'middle', 'font-family': K.F.display.replace(/"/g, "'"), 'font-weight': 800, 'font-size': h * 0.38, fill: o.fill || G.skin3 }, g);
      t.textContent = o.symbol || (K.brand && K.brand.currency) || '$';
      return { g: g, set: mover(g) };
    },
    // a shopping bag with a handle and an optional label
    bag: function (parent, o) {
      o = o || {}; var C = K.C, G = K.G, w = o.w || 200, h = w * 1.05, g = s('g', { 'data-ov': 'bag' }, parent);
      s('path', { d: 'M' + (-w * 0.22) + ' ' + (-h / 2) + 'C' + (-w * 0.22) + ' ' + (-h * 0.86) + ' ' + (w * 0.22) + ' ' + (-h * 0.86) + ' ' + (w * 0.22) + ' ' + (-h / 2), fill: 'none', stroke: o.ink || C.ink, 'stroke-width': 14, 'stroke-linecap': 'round' }, g);
      s('path', { d: K.rr(-w / 2, -h / 2, w, h, 26), fill: o.fill || G.mid }, g);
      if (o.label) { var t = s('text', { x: 0, y: h * 0.1, 'text-anchor': 'middle', 'font-family': K.F.display.replace(/"/g, "'"), 'font-weight': 700, 'font-size': w * 0.22, fill: o.labelColor || C.paper }, g); t.textContent = o.label; }
      return { g: g, set: mover(g) };
    },
    // a shoe in profile
    shoe: function (parent, o) {
      o = o || {}; var C = K.C, G = K.G, w = o.w || 240, g = s('g', { 'data-ov': 'shoe' }, parent), k = w / 240;
      s('path', { d: 'M-120 30C-120 -20 -100 -60 -70 -64C-40 -66 -20 -40 10 -30C50 -18 100 -10 116 10C124 22 120 40 100 40H-110C-118 40 -120 36 -120 30Z', fill: o.fill || C.ink, transform: 'scale(' + k + ')' }, g);
      s('path', { d: 'M-122 30H120V44C120 50 116 54 110 54H-114C-120 54 -122 50 -122 44Z', fill: o.sole || G.skin2, transform: 'scale(' + k + ')' }, g);
      return { g: g, set: mover(g) };
    },
    // a store front: a sign with a name, awning stripes, a window, a door; (0, 0) is the bottom centre
    store: function (parent, name, o) {
      o = o || {}; var C = K.C, G = K.G, w = o.w || 760, h = o.h || 640, g = s('g', { 'data-ov': 'store' }, parent);
      s('path', { d: K.rr(-w / 2, -h, w, h, 18), fill: o.wall || G.skin1 }, g);
      var sign = s('path', { d: K.rr(-w / 2 + 40, -h + 30, w - 80, 110, 28), fill: o.signFill || C.ink }, g);
      var tx = K.html(g, -w / 2 + 40, -h + 30, w - 80, 110, 'display:flex;align-items:center;justify-content:center;font-family:' + K.F.display + ';font-weight:700;font-size:64px;color:' + (o.signInk || C.paper));
      tx.textContent = name || '';
      var n = 8, sw = (w - 40) / n;
      for (var i = 0; i < n; i++) s('path', { d: 'M' + (-w / 2 + 20 + i * sw) + ' ' + (-h + 170) + 'h' + sw + 'v70a' + (sw / 2) + ' ' + (sw / 2) + ' 0 0 1 ' + (-sw) + ' 0Z', fill: i % 2 ? (o.stripeB || C.paper) : (o.stripeA || C.ink) }, g);
      var win = s('path', { d: K.rr(-w / 2 + 60, -h + 300, w * 0.42, h * 0.38, 20), fill: o.window || G.skin3 }, g);
      var door = s('path', { d: K.rr(w * 0.08, -h + 300, w * 0.3, h - 300, 20), fill: o.door || G.mid }, g);
      return { g: g, sign: sign, label: tx, window: win, door: door, set: mover(g) };
    },
    // a receipt that prints: rows appear as k goes 0 → 1; rows are [label, value] or { text, value, bold }
    receipt: function (parent, rows, o) {
      o = o || {}; var C = K.C, w = o.w || 520, lh = o.lh || 64, h = 120 + rows.length * lh, g = s('g', { 'data-ov': 'receipt' }, parent), id = 'rc' + (++uid);
      var cp = s('clipPath', { id: id }, g), cr = s('rect', { x: -w / 2 - 10, y: 0, width: w + 20, height: h + 40 }, cp);
      var body = s('g', { 'clip-path': 'url(#' + id + ')' }, g);
      s('rect', { x: -w / 2, y: 0, width: w, height: h, fill: o.fill || C.surface }, body);
      var zz = 'M' + (-w / 2) + ' ' + h; for (var i = 0; i <= 20; i++) zz += 'L' + (-w / 2 + i * w / 20) + ' ' + (h + (i % 2 ? 16 : 0)); zz += 'L' + (w / 2) + ' ' + h + 'Z';
      s('path', { d: zz, fill: o.fill || C.surface }, body);
      var tx = K.html(body, -w / 2 + 40, 40, w - 80, h - 40, 'font-family:' + K.F.mono + ';font-size:32px;line-height:' + lh + 'px;font-variant-numeric:tabular-nums');
      rows.forEach(function (l) {
        var r = document.createElement('div'); r.style.cssText = 'display:flex;justify-content:space-between;font-weight:' + (l.bold ? 700 : 500);
        var a = document.createElement('span'); a.textContent = l[0] || l.text || ''; var b = document.createElement('span'); b.textContent = l[1] || l.value || '';
        r.appendChild(a); r.appendChild(b); tx.appendChild(r);
      });
      var set = mover(g);
      return { g: g, h: h, set: function (t, p) { p = p || {}; set(t, p); var k = p.k == null ? 1 : p.k; cr.setAttribute('height', (h + 40) * k); } };
    },
    // a loading bar: track and fill (accent: the mascot is working on it); (0, 0) is the centre
    loader: function (parent, o) {
      o = o || {}; var C = K.C, w = o.w || 720, h = o.h || 48, g = s('g', { 'data-ov': 'loader' }, parent);
      s('path', { d: K.rr(-w / 2, -h / 2, w, h, h / 2), fill: o.track || C.paper3 }, g);
      var f = s('path', { d: '', fill: o.fill || C.accent }, g);
      var set = mover(g);
      return { g: g, set: function (t, p) { p = p || {}; set(t, p); var k = K.clamp(p.k || 0, 0, 1); f.setAttribute('d', k > 0 ? K.rr(-w / 2, -h / 2, Math.max(h, w * k), h, h / 2) : ''); f.style.visibility = k > 0 ? '' : 'hidden'; } };
    }
  };
})();

/* A message that is a character: eyes on top, its words below, a tail at the bottom left. It can talk (with a
   voice its body follows that voice's lines) and it turns accent when the mascot handles it.
   var c = K.chatter(layer, 'Price?', { w, h, size, voice, seed, gray })
   c.set(t, { x, y, s, r, op, accent (0..1), look: [dx, dy], open, blink, eyesBig, sad (0..1), happy (0..1), talk, squash }) */
(function () {
  'use strict';
  var K = window.K;
  K.chatter = function (parent, text, o) {
    o = o || {};
    var C = K.C, w = o.w || 460, h = o.h || 270, gray = o.gray || K.G.skin2;
    var g = K.svg('g', { 'data-ov': 'chatter' }, parent), body = K.svg('g', {}, g);
    var shape = K.svg('path', { d: K.rr(-w / 2, -h / 2, w, h, Math.min(96, h * 0.42)), fill: gray }, body);
    var tail = K.svg('path', { d: 'M' + (-w / 2 + 40) + ' ' + (h / 2 - 50) + 'C' + (-w / 2 + 20) + ' ' + (h / 2 + 10) + ' ' + (-w / 2 - 20) + ' ' + (h / 2 + 34) + ' ' + (-w / 2 - 44) + ' ' + (h / 2 + 40) + 'C' + (-w / 2 + 10) + ' ' + (h / 2 + 40) + ' ' + (-w / 2 + 70) + ' ' + (h / 2 + 20) + ' ' + (-w / 2 + 100) + ' ' + (h / 2 - 6) + 'Z', fill: gray }, body);
    var eyes = [0, 1].map(function () { return K.svg('rect', { width: 30, height: 60, rx: 15, fill: C.ink }, body); });
    var cheeks = [0, 1].map(function () { return K.svg('ellipse', { rx: 26, ry: 22, fill: gray }, body); });
    var label = K.svg('text', { x: 0, y: h * 0.27, 'text-anchor': 'middle', 'font-family': K.F.display.replace(/"/g, "'"), 'font-weight': 700, 'font-size': o.size || Math.min(92, h * 0.3), fill: C.ink }, body);
    label.textContent = text;
    var blinks = [], r = (o.seed || 5) * 104729;
    for (var bt = 0.7 + (o.seed || 5) % 4 * 0.41; bt < 900; bt += 2.1 + ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648) * 2.6) blinks.push(bt);
    var me = {
      g: g, label: label, voice: o.voice,
      set: function (t, p) {
        p = p || {};
        var acc = K.clamp(p.accent || 0, 0, 1), fill = K.mixHex(gray, C.accent, acc), ink = K.mixHex(C.ink, C.accentInk, acc);
        shape.setAttribute('fill', fill); tail.setAttribute('fill', fill); label.setAttribute('fill', ink);
        eyes.forEach(function (e) { e.setAttribute('fill', ink); });
        var talk = typeof p.talk === 'number' ? p.talk : 0;
        if (o.voice && p.talk !== false && typeof p.talk !== 'number') { var L = K.speaking(t, o.voice); talk = L ? K.level(t, L.id) : 0; }
        var sq = (p.squash || 0) + talk * 0.07, sad = p.sad || 0, happy = K.clamp(p.happy || 0, 0, 1);
        var sy = 1 - sq * 0.5 - sad * 0.06 + 0.012 * Math.sin(t * 2.6 + (o.seed || 0)), sx = 1 / Math.max(0.5, sy);
        var hop = talk * 16, sc = p.s == null ? 1 : p.s;
        g.setAttribute('transform', 'translate(' + (p.x || 0) + ' ' + ((p.y || 0) - hop) + ') rotate(' + (p.r || 0) + ') scale(' + (sc * sx).toFixed(4) + ' ' + (sc * sy).toFixed(4) + ')');
        g.style.opacity = p.op == null ? 1 : p.op;
        g.style.visibility = p.op === 0 || sc === 0 ? 'hidden' : '';
        var look = p.look || [0, 0], open = p.open == null ? 1 : p.open;
        for (var i = 0; i < blinks.length && blinks[i] <= t; i++) { var d = t - blinks[i]; if (d < 0.2) open = Math.min(open, Math.abs(d - 0.1) / 0.1 * 0.94 + 0.06); }
        if (p.blink != null) open = p.blink;
        var eh = Math.max(8, 60 * open * (1 - sad * 0.45) * (p.eyesBig || 1)), ey = -h * 0.17;
        eyes.forEach(function (e, i) {
          var x = (i ? 1 : -1) * 50 - 15 + look[0], y = ey - eh / 2 + look[1] + sad * 10;
          e.setAttribute('x', x.toFixed(1)); e.setAttribute('y', y.toFixed(1)); e.setAttribute('height', eh.toFixed(1)); e.setAttribute('rx', Math.min(15, eh / 2).toFixed(1));
        });
        // happy eyes: an arch of the body's colour rises from below each eye (like the mascot's cheeks)
        cheeks.forEach(function (c, i) {
          c.setAttribute('fill', fill);
          c.setAttribute('cx', ((i ? 1 : -1) * 50 + look[0]).toFixed(1));
          c.setAttribute('cy', (ey + eh / 2 + look[1] + sad * 10 + 22 - happy * eh * 0.42).toFixed(1));
          c.style.visibility = happy > 0.01 ? '' : 'hidden';
        });
        return me;
      }
    };
    return me;
  };
})();
