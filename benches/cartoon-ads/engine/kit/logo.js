/* The logo and the end card.

   The placeholder wordmark is built from brand.json: logo.text (or name) set in the display font at logo.weight,
   followed by a round dot that acts as the ball of the animation. If brand.json points logo.wordmark at an SVG
   file, that drawing is used instead and the whole logo drops and bounces.

   var lg = K.logo(parent, { color, dotColor, width })   → { el, layout, set(t, { x, y, s, op }), drop(dt) }
   var card = K.endCard(K.top, { bg, fg, line, url, at: T.card })   → card.frame(t)
   The card registers its own sound so the sting lands exactly when the dot does (K.logo.LAND seconds after `at`). */
(function () {
  'use strict';
  var K = window.K, REF = 300;   // reference font size of the layout, in logo units
  var LAND = 1.08;               // the dot's first contact with the baseline, seconds after the card starts
  var uid = 0;

  // the wordmark's geometry in logo units: baseline at y = 0, text starting at x = 0
  K.logoLayout = function () {
    var b = K.brand || {}, lg = b.logo || {};
    if (K.logoSvg) {
      var vb = (K.logoSvg.match(/viewBox\s*=\s*["']([^"']+)["']/) || [])[1];
      var v = vb ? vb.trim().split(/[\s,]+/).map(Number) : [0, 0, 400, 120];
      return { svg: true, x0: v[0], y0: v[1], w: v[2], h: v[3], asc: -v[1], desc: v[1] + v[3], letters: [], dot: null };
    }
    var text = String(lg.text || b.name || 'brand'), weight = lg.weight || 800;
    var c = document.createElement('canvas').getContext('2d');
    c.font = weight + ' ' + REF + 'px ' + K.F.display;
    var letters = [];
    for (var i = 0; i < text.length; i++) letters.push({ ch: text[i], x: c.measureText(text.slice(0, i)).width, w: c.measureText(text[i]).width });
    var m = c.measureText(text), asc = m.actualBoundingBoxAscent, desc = Math.max(0, m.actualBoundingBoxDescent);
    var r = lg.dot === false ? 0 : REF * 0.1, dot = r ? { cx: m.width + REF * 0.045 + r, cy: -r, r: r } : null;
    var x0 = -m.actualBoundingBoxLeft, x1 = Math.max(m.actualBoundingBoxRight, dot ? dot.cx + r : 0);
    return { svg: false, text: text, weight: weight, size: REF, font: c.font, letters: letters, dot: dot, x0: x0, y0: -asc, w: x1 - x0, h: asc + desc, asc: asc, desc: desc };
  };

  K.logo = function (parent, o) {
    o = o || {};
    var L = K.logoLayout(), color = o.color || K.C.ink, dotColor = o.dotColor || color;
    var width = o.width || (o.height ? o.height * L.w / L.h : 600), k = width / L.w, height = L.h * k;
    var s = K.svg('svg', { viewBox: [L.x0, L.y0, L.w, L.h].join(' '), width: width, height: height, overflow: 'visible', style: 'overflow:visible;display:block' });
    parent.appendChild(s);
    s.setAttribute('data-ov', 'logo');
    var id = 'logoclip' + (++uid), letters = [], dot = null, whole = K.svg('g', {}, s);
    if (L.svg) {
      whole.innerHTML = K.logoSvg.replace(/<\?xml[^>]*>/, '');
      var inner = whole.querySelector('svg');
      if (inner) { inner.setAttribute('x', L.x0); inner.setAttribute('y', L.y0); inner.setAttribute('width', L.w); inner.setAttribute('height', L.h); }
      if (o.color) whole.setAttribute('fill', color);
    } else {
      // letters rise out of the baseline: everything below it (descenders aside) is clipped
      var cp = K.svg('clipPath', { id: id }, K.svg('defs', {}, s));
      K.svg('rect', { x: L.x0 - L.w, y: L.y0 - L.h * 4, width: L.w * 3, height: L.h * 4 + L.h + 4 }, cp);
      var gl = K.svg('g', { 'clip-path': 'url(#' + id + ')' }, whole);
      L.letters.forEach(function (l) {
        var g = K.svg('g', {}, gl);
        var tx = K.svg('text', { x: l.x, y: 0, 'font-family': K.F.display.replace(/"/g, "'"), 'font-weight': L.weight, 'font-size': REF, fill: color }, g);
        tx.textContent = l.ch;
        letters.push({ g: g, cx: l.x + l.w / 2 });
      });
      if (L.dot) { dot = K.svg('g', {}, whole); K.svg('circle', { cx: L.dot.cx, cy: L.dot.cy, r: L.dot.r, fill: dotColor }, dot); }
    }
    function tf(g, cx, ty, sx, sy) { g.setAttribute('transform', 'translate(' + cx + ' ' + ty + ') scale(' + sx.toFixed(4) + ' ' + sy.toFixed(4) + ') translate(' + (-cx) + ' 0)'); }
    var me = {
      el: s, layout: L, width: width, height: height,
      // place the logo by its centre (HTML parents only)
      set: function (t, p) { p = p || {}; K.place(s, p.x || 0, p.y || 0, p.s, p.r, 0.5, 0.5, p.op); return me; },
      // the entrance: letters rise without bouncing, the dot falls and bounces (or the whole SVG logo drops); dt in s
      drop: function (dt) {
        var E = K.E, S = K.sample;
        if (L.svg) {
          var ty = S([[0, -L.h * 4], [0.25, -L.h * 4, 'lin'], [LAND, 0, 'fall'], [LAND + 0.2, -L.h * 0.16, 'rise'], [LAND + 0.38, 0, 'fall']], dt);
          var sy = S([[0, 1.08], [LAND - 0.01, 1.08, 'lin'], [LAND + 0.05, 0.84, 'out'], [LAND + 0.2, 1.04, 'out'], [LAND + 0.38, 0.95, 'in'], [LAND + 0.8, 1, 'spring']], dt);
          whole.setAttribute('transform', 'translate(0 ' + ty.toFixed(2) + ') translate(' + (L.x0 + L.w / 2) + ' ' + (L.y0 + L.h) + ') scale(' + (1 / sy).toFixed(4) + ' ' + sy.toFixed(4) + ') translate(' + (-(L.x0 + L.w / 2)) + ' ' + (-(L.y0 + L.h)) + ')');
          whole.style.visibility = dt >= 0.25 ? '' : 'hidden';
          return me;
        }
        var impact = S([[0, 1], [LAND, 1, 'lin'], [LAND + 0.05, 0.93, 'out'], [LAND + 0.42, 1, 'spring']], dt);
        letters.forEach(function (l, i) {
          var a = 0.12 + i * 0.06, kk = E.firm(K.prog(dt, a, a + 0.5));
          tf(l.g, l.cx, (1 - kk) * (L.h + 20), 1 / impact, impact);
        });
        if (dot) {
          var r = L.dot.r, y = S([[0.6, -REF * 3.4], [LAND, 0, 'fall'], [LAND + 0.2, -REF * 0.42, 'rise'], [LAND + 0.4, 0, 'fall'], [LAND + 0.52, -REF * 0.08, 'rise'], [LAND + 0.62, 0, 'fall']], dt);
          var q = S([[0.6, 1.18], [LAND - 0.01, 1.18, 'lin'], [LAND + 0.04, 0.68, 'out'], [LAND + 0.12, 1.12, 'out'], [LAND + 0.24, 1, 'io'], [LAND + 0.4, 0.82, 'in'], [LAND + 0.48, 1.06, 'out'], [LAND + 0.62, 0.92, 'in'], [LAND + 0.95, 1, 'spring']], dt);
          dot.setAttribute('transform', 'translate(0 ' + y.toFixed(2) + ') translate(' + L.dot.cx + ' 0) scale(' + (1 / q).toFixed(4) + ' ' + q.toFixed(4) + ') translate(' + (-L.dot.cx) + ' 0)');
          dot.style.visibility = dt >= 0.6 ? '' : 'hidden';
        }
        return me;
      },
      // the finished logo, no animation
      rest: function () { return me.drop(LAND + 3); }
    };
    me.rest();
    return me;
  };
  K.logo.LAND = LAND;

  // ---------- the end card: the ground, the logo's entrance, then the line and the address ----------
  // o: bg, fg, dotColor, line (default brand.tagline), url (default brand.url), logoW, at (start time; registers the
  //    synced sound), sound (effect name, default 'logo'; false for none), gain_db, soundLead (seconds of the effect
  //    before its hit; the sound starts at at + LAND - soundLead)
  K.endCard = function (parent, o) {
    o = o || {};
    var b = K.brand || {}, bg = o.bg || K.C.accent, fg = o.fg || K.C.accentInk;
    var box = K.el('div', { style: { position: 'absolute', left: '0px', top: '0px', width: K.W + 'px', height: K.H + 'px', background: bg, zIndex: 46 } }, parent || K.top);
    var col = K.el('div', { style: { position: 'absolute', left: '90px', right: '90px', top: '0px', height: K.H + 'px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' } }, box);
    var holder = K.el('div', { style: { position: 'relative' } }, col);
    var logo = K.logo(holder, { color: fg, dotColor: o.dotColor || fg, width: o.logoW || 600 });
    var lineText = o.line != null ? o.line : (b.tagline || ''), urlText = o.url != null ? o.url : (b.url || '');
    var line = K.el('div', { cls: 'display', text: lineText, style: { position: 'relative', textAlign: 'center', fontSize: (o.lineSize || 62) + 'px', lineHeight: '1.08', color: fg, maxWidth: '860px', textWrap: 'balance', marginTop: '70px' } }, col);
    var url = K.el('div', { text: urlText, style: { position: 'relative', textAlign: 'center', fontFamily: K.F.body, fontWeight: 800, fontSize: '46px', color: fg, marginTop: '30px' } }, col);
    if (!lineText) line.style.display = 'none';
    if (!urlText) url.style.display = 'none';
    var lead = o.soundLead != null ? o.soundLead : 0;
    if (o.at != null && o.sound !== false) K.sfx(o.at + LAND - lead, o.sound || 'logo', { gain_db: o.gain_db != null ? o.gain_db : -8 });
    return {
      el: box, logo: logo, line: line, url: url, land: LAND,
      frame: function (t, t0) {
        if (t0 == null) t0 = o.at;
        var on = t >= t0; box.style.visibility = on ? '' : 'hidden';
        if (!on) return;
        var dt = t - t0;
        logo.drop(dt);
        var k1 = K.E.out(K.prog(dt, 1.25, 1.75)), k2 = K.E.out(K.prog(dt, 1.55, 2.05));
        line.style.opacity = k1; line.style.transform = 'translateY(' + ((1 - k1) * 30).toFixed(1) + 'px)';
        url.style.opacity = k2; url.style.transform = 'translateY(' + ((1 - k2) * 30).toFixed(1) + 'px)';
        // settle in, then a slow push-in so the hold never reads as a frozen frame
        var z = K.lerp(1.05, 1, K.E.out(K.prog(dt, 0, 0.9))) * (1 + 0.035 * K.E.sine(K.prog(dt, 1.8, 6)));
        col.style.transform = 'scale(' + z.toFixed(4) + ')';
      }
    };
  };
})();
