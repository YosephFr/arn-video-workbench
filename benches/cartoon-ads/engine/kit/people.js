/* People of the cartoon world: big rounded heads, capsule eyes and flat greys, so the mascot stays the only
   thing in the accent colour. A person is drawn once (K.person) and posed every frame (p.set(t, pose)).

   var alex = K.person(layer, { body: 'dress' | 'shirt', hair: 'bun' | 'short' | 'slick' | 'long' | 'curly' | 'cap' | 'bald' | 'none',
                                skin, cloth, pants, shoes, hairColor, sleeve, forearm, apron, collar, tie, earrings,
                                glasses, mustache, noBrows, voice: 'guest', seed: 3,
                                headW, headH, bodyH, legH, shoulders, hem })
   alex.set(t, { x, y, s, flip, lean, op,
                 look: [dx, dy], brows: 'angry' | 'sad' | 'up' | 0..1, mouth: 'smile' | 'frown' | 'o' | 'flat' | -1..1,
                 open (eyes 0..1), blink, eyesBig, armL, armR, elbowL, elbowR (degrees), bounce, walk (phase), nod,
                 talk (0..1, or false; with a voice the mouth follows that voice's lines by itself) })
   alex.hand / alex.handL hold props (K.props.phone(alex.hand, ...)).
   Units are the person's own: feet at (0, 0), the top of the head near -640. */
(function () {
  'use strict';
  var K = window.K;
  function s(tag, a, p) { return K.svg(tag, a, p); }
  var rr = function (x, y, w, h, r) { return K.rr(x, y, w, h, r); };
  // torso from y = 0 (hem) up to y = -h: shoulders sw, hem hw, rounded shoulders r
  function torso(sw, hw, h, r) {
    var a = -sw / 2, b = sw / 2, c = -hw / 2, d = hw / 2;
    return 'M' + (a + r) + ' ' + (-h) + 'H' + (b - r) + 'Q' + b + ' ' + (-h) + ' ' + b + ' ' + (-h + r) + 'L' + d + ' -16Q' + d + ' 0 ' + (d - 16) + ' 0H' + (c + 16) + 'Q' + c + ' 0 ' + c + ' -16L' + a + ' ' + (-h + r) + 'Q' + a + ' ' + (-h) + ' ' + (a + r) + ' ' + (-h) + 'Z';
  }
  // hair shapes around a head box (w, h) centred at 0, 0: [behind the head, over the head]
  var HAIR = {
    bun: function (w, h) {
      return ['', 'M' + (-w / 2 - 6) + ' ' + (-h * 0.02) + 'C' + (-w / 2 - 10) + ' ' + (-h * 0.62) + ' ' + (w / 2 + 10) + ' ' + (-h * 0.62) + ' ' + (w / 2 + 6) + ' ' + (-h * 0.02) +
        'C' + (w * 0.38) + ' ' + (-h * 0.26) + ' ' + (w * 0.12) + ' ' + (-h * 0.3) + ' ' + (w * 0.02) + ' ' + (-h * 0.24) + 'C' + (-w * 0.16) + ' ' + (-h * 0.34) + ' ' + (-w * 0.4) + ' ' + (-h * 0.28) + ' ' + (-w / 2 - 6) + ' ' + (-h * 0.02) + 'Z' +
        'M-58 ' + (-h * 0.56) + 'a58 52 0 1 1 116 0a58 52 0 1 1 -116 0Z'];
    },
    short: function (w, h) {
      return ['', 'M' + (-w / 2 - 4) + ' ' + (-h * 0.08) + 'C' + (-w / 2 - 8) + ' ' + (-h * 0.66) + ' ' + (w / 2 + 8) + ' ' + (-h * 0.66) + ' ' + (w / 2 + 4) + ' ' + (-h * 0.08) +
        'C' + (w * 0.4) + ' ' + (-h * 0.26) + ' ' + (w * 0.2) + ' ' + (-h * 0.3) + ' ' + (-w * 0.02) + ' ' + (-h * 0.24) + 'C' + (-w * 0.26) + ' ' + (-h * 0.3) + ' ' + (-w * 0.42) + ' ' + (-h * 0.24) + ' ' + (-w / 2 - 4) + ' ' + (-h * 0.08) + 'Z'];
    },
    slick: function (w, h) {
      return ['', 'M' + (-w / 2 - 4) + ' ' + (-h * 0.04) + 'C' + (-w / 2 - 10) + ' ' + (-h * 0.7) + ' ' + (w * 0.2) + ' ' + (-h * 0.74) + ' ' + (w / 2 + 6) + ' ' + (-h * 0.18) +
        'C' + (w * 0.3) + ' ' + (-h * 0.36) + ' ' + (-w * 0.1) + ' ' + (-h * 0.34) + ' ' + (-w * 0.3) + ' ' + (-h * 0.22) + 'C' + (-w * 0.42) + ' ' + (-h * 0.16) + ' ' + (-w * 0.46) + ' ' + (-h * 0.08) + ' ' + (-w / 2 - 4) + ' ' + (-h * 0.04) + 'Z'];
    },
    long: function (w, h) {
      return ['M' + (-w / 2 - 16) + ' ' + (-h * 0.16) + 'C' + (-w / 2 - 30) + ' ' + (h * 0.4) + ' ' + (-w / 2 - 20) + ' ' + (h * 0.7) + ' ' + (-w / 2 + 4) + ' ' + (h * 0.78) + 'H' + (w / 2 - 4) + 'C' + (w / 2 + 20) + ' ' + (h * 0.7) + ' ' + (w / 2 + 30) + ' ' + (h * 0.4) + ' ' + (w / 2 + 16) + ' ' + (-h * 0.16) + 'Z',
        'M' + (-w / 2 - 10) + ' ' + (h * 0.1) + 'C' + (-w / 2 - 16) + ' ' + (-h * 0.7) + ' ' + (w / 2 + 16) + ' ' + (-h * 0.7) + ' ' + (w / 2 + 10) + ' ' + (h * 0.1) +
        'C' + (w * 0.42) + ' ' + (-h * 0.2) + ' ' + (w * 0.26) + ' ' + (-h * 0.3) + ' ' + (w * 0.06) + ' ' + (-h * 0.3) + 'C' + (-w * 0.16) + ' ' + (-h * 0.22) + ' ' + (-w * 0.4) + ' ' + (-h * 0.2) + ' ' + (-w / 2 - 10) + ' ' + (h * 0.1) + 'Z'];
    },
    curly: function (w, h) {
      var d = '', n = 8;
      for (var i = 0; i < n; i++) {
        var a = Math.PI * (1.04 + i * 0.92 / (n - 1)), x = Math.cos(a) * (w / 2 + 2), y = Math.sin(a) * (h / 2 + 2) - h * 0.04;
        d += 'M' + (x - 40) + ' ' + y + 'a40 40 0 1 1 80 0a40 40 0 1 1 -80 0Z';
      }
      return ['M' + (-w / 2 - 24) + ' ' + (-h * 0.06) + 'C' + (-w / 2 - 36) + ' ' + (h * 0.36) + ' ' + (-w / 2 - 18) + ' ' + (h * 0.52) + ' ' + (-w / 2) + ' ' + (h * 0.52) + 'H' + (w / 2) + 'C' + (w / 2 + 18) + ' ' + (h * 0.52) + ' ' + (w / 2 + 36) + ' ' + (h * 0.36) + ' ' + (w / 2 + 24) + ' ' + (-h * 0.06) + 'Z', d];
    },
    cap: function (w, h) {
      return ['', 'M' + (-w / 2 - 6) + ' ' + (-h * 0.14) + 'C' + (-w / 2 - 8) + ' ' + (-h * 0.72) + ' ' + (w / 2 + 8) + ' ' + (-h * 0.72) + ' ' + (w / 2 + 6) + ' ' + (-h * 0.14) + 'Z' +
        'M' + (w * 0.2) + ' ' + (-h * 0.2) + 'H' + (w / 2 + 84) + 'a14 14 0 0 1 0 28H' + (w * 0.2) + 'Z'];
    },
    bald: function (w, h) { return ['', 'M' + (-w / 2 - 2) + ' ' + (h * 0.02) + 'C' + (-w / 2 - 4) + ' ' + (-h * 0.2) + ' ' + (-w * 0.42) + ' ' + (-h * 0.24) + ' ' + (-w * 0.4) + ' ' + (-h * 0.1) + 'Z M' + (w / 2 + 2) + ' ' + (h * 0.02) + 'C' + (w / 2 + 4) + ' ' + (-h * 0.2) + ' ' + (w * 0.42) + ' ' + (-h * 0.24) + ' ' + (w * 0.4) + ' ' + (-h * 0.1) + 'Z']; },
    none: function () { return ['', '']; }
  };

  function person(parent, o) {
    o = o || {};
    var C = K.C, G = K.G;
    var skin = o.skin || G.skin2, cloth = o.cloth || C.ink, pants = o.pants || G.dark, ink = o.ink || C.ink, hairC = o.hairColor || C.ink;
    var hw = o.headW || 272, hh = o.headH || 296, legH = o.legH == null ? 74 : o.legH, bodyH = o.bodyH || 250;
    var dress = o.body === 'dress', sw = o.shoulders || (dress ? 214 : 236), hem = o.hem || (dress ? 300 : 236);
    var shoulderY = -(legH + bodyH) + 8, headCY = shoulderY - 12 - hh / 2 + 18;
    var g = s('g', { 'data-ov': 'person' }, parent), gLegs = s('g', {}, g), gBody = s('g', {}, g), gHead = s('g', {}, g), gArms = s('g', {}, g);
    // legs (or the feet under a dress)
    var legs = [-1, 1].map(function (k) {
      var lg = s('g', {}, gLegs);
      s('path', { d: rr(-24, -legH - 14, 48, legH + 14, 22), fill: dress ? skin : pants }, lg);
      s('path', { d: rr(-30 + k * 6, -24, 62, 26, 13), fill: o.shoes || ink }, lg);
      return lg;
    });
    s('path', { d: torso(sw, hem, bodyH, 74), fill: cloth, transform: 'translate(0 ' + (-legH) + ')' }, gBody);
    if (o.apron) s('path', { d: rr(-sw * 0.32, -legH - bodyH * 0.6, sw * 0.64, bodyH * 0.6 - 8, 30), fill: o.apron }, gBody);
    if (o.collar) s('path', { d: 'M-40 ' + (shoulderY - 6) + 'L0 ' + (shoulderY + 40) + 'L40 ' + (shoulderY - 6) + 'Z', fill: o.collar }, gBody);
    if (o.tie) s('path', { d: 'M-13 ' + (shoulderY + 22) + 'H13L20 ' + (shoulderY + 120) + 'L0 ' + (shoulderY + 140) + 'L-20 ' + (shoulderY + 120) + 'Z', fill: o.tie }, gBody);
    s('path', { d: rr(-30, shoulderY - 34, 60, 50, 20), fill: skin }, gBody);   // neck
    // head
    var gHeadIn = s('g', {}, gHead);
    var hair = (HAIR[o.hair || 'short'] || HAIR.short)(hw, hh);
    if (hair[0]) s('path', { d: hair[0], fill: hairC }, gHeadIn);
    s('path', { d: rr(-hw / 2, -hh / 2, hw, hh, hw * 0.44), fill: skin }, gHeadIn);
    if (o.earrings) [-1, 1].forEach(function (k) { s('circle', { cx: k * (hw / 2 + 2), cy: 34, r: 14, fill: o.earrings }, gHeadIn); });
    var face = s('g', {}, gHeadIn);
    var eyes = [0, 1].map(function () { return s('rect', { x: 0, y: 0, width: 26, height: 52, rx: 13, fill: ink }, face); });
    var brows = [0, 1].map(function () { return s('rect', { x: -27, y: -8, width: 54, height: 16, rx: 8, fill: hairC }, face); });
    var mouth = s('path', { d: '', fill: 'none', stroke: ink, 'stroke-width': 12, 'stroke-linecap': 'round' }, face);
    var mouthO = s('rect', { x: -20, y: 0, width: 40, height: 10, rx: 20, fill: ink }, face);
    var stache = o.mustache ? s('path', { d: 'M-58 52C-40 30 -14 34 0 46C14 34 40 30 58 52C40 60 18 58 0 52C-18 58 -40 60 -58 52Z', fill: hairC }, face) : null;
    if (o.glasses) [-1, 1].forEach(function (k) { s('path', { d: rr(k * 52 - 38, -40, 76, 70, 28), fill: 'none', stroke: o.glasses, 'stroke-width': 9 }, face); });
    if (o.glasses) s('path', { d: 'M-14 -8H14', stroke: o.glasses, 'stroke-width': 9 }, face);
    if (hair[1]) s('path', { d: hair[1], fill: hairC }, gHeadIn);
    // arms in front of the body: upper arm, forearm, hand; each hand can hold a prop
    function arm() {
      var up = s('g', {}, gArms);
      s('path', { d: rr(-18, -6, 36, 128, 18), fill: o.sleeve || cloth }, up);
      var low = s('g', {}, up);
      s('path', { d: rr(-16, -4, 32, 112, 16), fill: o.forearm || skin }, low);
      s('circle', { cx: 0, cy: 112, r: 24, fill: skin }, low);
      var hold = s('g', { transform: 'translate(0 112)' }, low);
      return { up: up, low: low, hold: hold };
    }
    var aL = arm(), aR = arm();
    // seeded blinks, so every render of the same piece blinks at the same frames
    var blinks = [], r = (o.seed || 3) * 7919;
    for (var bt = 0.9 + (o.seed || 3) % 5 * 0.37; bt < 900; bt += 2.3 + ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648) * 2.9) blinks.push(bt);
    var me = {
      g: g, hand: aR.hold, handL: aL.hold, voice: o.voice, head: gHead,
      set: function (t, p) {
        p = p || {};
        var sc = p.s == null ? 1 : p.s, flip = p.flip ? -1 : 1, br = 0.5 - 0.5 * Math.cos(t * 2 * Math.PI / 4.2 + (o.seed || 0));
        var walk = p.walk == null ? null : p.walk, bob = walk == null ? 0 : Math.abs(Math.sin(walk * Math.PI * 2)) * 14;
        var sy = 1 + 0.012 * br - (p.bounce || 0) * 0.1, sx = 1 / Math.sqrt(Math.max(0.2, sy));
        g.setAttribute('transform', 'translate(' + (p.x || 0) + ' ' + ((p.y || 0) - bob) + ') scale(' + (sc * flip) + ' ' + sc + ') rotate(' + (p.lean || 0) + ') scale(' + sx.toFixed(4) + ' ' + sy.toFixed(4) + ')');
        g.style.opacity = p.op == null ? 1 : p.op;
        g.style.visibility = p.op === 0 || sc === 0 ? 'hidden' : '';
        legs.forEach(function (lg, i) {
          var k = i ? 1 : -1, lift = walk == null ? 0 : Math.max(0, Math.sin((walk + i * 0.5) * Math.PI * 2)) * 26;
          lg.setAttribute('transform', 'translate(' + (k * (dress ? 52 : 58)) + ' ' + (-lift) + ')');
        });
        var look = p.look || [0, 0], talk = typeof p.talk === 'number' ? p.talk : 0;
        if (o.voice && p.talk !== false && typeof p.talk !== 'number') { var L = K.speaking(t, o.voice); talk = L ? K.level(t, L.id) : 0; }
        gHead.setAttribute('transform', 'translate(' + (look[0] * 0.3) + ' ' + (headCY + look[1] * 0.2 - talk * 4) + ') rotate(' + ((p.nod || 0) + look[0] * 0.05) + ')');
        var open = p.open == null ? 1 : p.open;
        for (var i = 0; i < blinks.length && blinks[i] <= t; i++) { var d = t - blinks[i]; if (d < 0.2) open = Math.min(open, Math.abs(d - 0.1) / 0.1 * 0.94 + 0.06); }
        if (p.blink != null) open = p.blink;
        var big = p.eyesBig || 1, ew = 26 * big, eh = Math.max(7, 52 * big * open);
        eyes.forEach(function (e, i) {
          var x = (i ? 1 : -1) * 54 - ew / 2 + look[0] * 0.55, y = -14 - eh / 2 + look[1] * 0.45;
          e.setAttribute('x', x.toFixed(1)); e.setAttribute('y', y.toFixed(1)); e.setAttribute('width', ew.toFixed(1)); e.setAttribute('height', eh.toFixed(1)); e.setAttribute('rx', Math.min(ew, eh) / 2);
        });
        var bm = p.brows, raise = typeof bm === 'number' ? bm : bm === 'up' ? 1 : 0, ang = bm === 'angry' ? 20 : bm === 'sad' ? -18 : 0;
        brows.forEach(function (b, i) {
          var k = i ? 1 : -1, x = k * 54 + look[0] * 0.5, y = -66 - raise * 20 + look[1] * 0.3 + (bm === 'angry' ? 6 : 0);
          b.setAttribute('transform', 'translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ') rotate(' + (k * -ang) + ')');
          b.style.visibility = o.noBrows ? 'hidden' : '';
        });
        var curve = p.mouth === 'smile' ? 1 : p.mouth === 'frown' ? -0.8 : p.mouth === 'flat' ? 0 : (typeof p.mouth === 'number' ? p.mouth : 0.3);
        var opn = p.mouth === 'o' ? 0.8 : Math.min(1, talk * 1.7), mx = look[0] * 0.45, my = 74 + look[1] * 0.35;
        if (stache) stache.setAttribute('transform', 'translate(' + mx + ' ' + (look[1] * 0.35 - opn * 4) + ')');
        if (opn > 0.08) {
          mouth.style.visibility = 'hidden'; mouthO.style.visibility = '';
          var mh = 12 + opn * 44, mw = 50 - opn * 8;
          mouthO.setAttribute('x', (mx - mw / 2).toFixed(1)); mouthO.setAttribute('y', (my - mh / 2 + 4).toFixed(1));
          mouthO.setAttribute('width', mw.toFixed(1)); mouthO.setAttribute('height', mh.toFixed(1)); mouthO.setAttribute('rx', (Math.min(mw, mh) / 2).toFixed(1));
        } else {
          mouthO.style.visibility = 'hidden'; mouth.style.visibility = '';
          mouth.setAttribute('d', 'M' + (mx - 32) + ' ' + (my - curve * 8) + 'Q' + mx + ' ' + (my + curve * 24) + ' ' + (mx + 32) + ' ' + (my - curve * 8));
        }
        function setArm(a, side, ang, elbow) {
          var swing = walk == null ? 0 : Math.sin((walk + (side > 0 ? 0.5 : 0)) * Math.PI * 2) * 14;
          a.up.setAttribute('transform', 'translate(' + (side * (sw / 2 - 20)) + ' ' + (shoulderY + 18) + ') rotate(' + (-side * (ang == null ? 9 : ang) + swing) + ')');
          a.low.setAttribute('transform', 'translate(0 118) rotate(' + (-side * (elbow || 0)) + ')');
        }
        setArm(aL, -1, p.armL, p.elbowL); setArm(aR, 1, p.armR, p.elbowR);
        return me;
      }
    };
    return me;
  }
  K.person = person;
  K.person.hair = Object.keys(HAIR);
})();
