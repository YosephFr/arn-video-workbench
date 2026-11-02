/* The mascot rig: the character drawn from mascot-shape.js, posed every frame by channels.

   var m = K.mascot(layer, { size: 360, color: K.C.accent, eyes: K.C.ink, seed: 4 })   // eyes: the face colour
   m.set(t, { x, y, s, r, op,                      // (x, y) is where the mascot stands (the lowest point of its body)
              scene: ['hello', t0],                // a scene that starts at t0 (or a list: [['land', t0], ['hello', t1]])
              idle: true,                          // breathing, seeded blinks and small fidgets (default on)
              'eyes.dx': 20, 'body.rot': -4 })     // any channel, added (or multiplied) on top of the scene

   Channels. Added, default 0: body.tx body.ty body.rot (degrees, about the standing point), eyes.dx eyes.dy,
   eyes.cheek (0..0.4: happy eyes and stronger blush), eyes.lid (sleepy lids), ear.l ear.r (degrees an appendage
   leans, + = right; a single one follows ear.l), mouth.smile (−0.3..1 on top of the resting smile), mouth.open
   (0..1), mouth.o (0..1: a round "o").
   Multiplied, default 1: body.sx body.sy (squash and stretch), eyes.open, eyeL.open, eyeR.open, body.op.

   Scenes: blink, look, curious, hello, think, cheer, sleep, nod, land.

   Technique, whatever the character: the gaze leads and the body follows; looking far up is the body's job. Squash
   and stretch keep the volume (sx · sy stays between 0.95 and 1.05 once settled). Appendages follow through: they
   lag the body and settle with a spring. While a scene plays the idle layer only breathes, so blinks never fight the
   choreography. */
(function () {
  'use strict';
  var K = window.K;
  function shape() { return window.MASCOT_SHAPE; }
  function n2(v) { return (Math.round(v * 10) / 10).toString(); }

  // ---------- appendages (ears, a sprout, antennae): bent from the root, more toward the tip ----------
  // shape 'capsule' (default): a soft capsule with a round tip; 'leaf': full in the middle and pointed, on an optional stem
  function earPath(e, extra) {
    var a = (e.lean + (extra || 0)) * Math.PI / 180, a0 = a * 0.3, L = e.length, hw = e.width / 2, leaf = e.shape === 'leaf';
    var bx = e.base[0], by = e.base[1];
    var cx = bx + Math.sin(a0) * L * 0.5, cy = by - Math.cos(a0) * L * 0.5;
    var tx = bx + Math.sin(a) * L, ty = by - Math.cos(a) * L;
    var N = leaf ? 24 : 10, A = [], B = [], wTip = hw;
    for (var i = 0; i <= N; i++) {
      var u = i / N, v = 1 - u;
      var x = v * v * bx + 2 * v * u * cx + u * u * tx, y = v * v * by + 2 * v * u * cy + u * u * ty;
      var dx = 2 * v * (cx - bx) + 2 * u * (tx - cx), dy = 2 * v * (cy - by) + 2 * u * (ty - cy), l = Math.sqrt(dx * dx + dy * dy) || 1;
      var st = e.stem || 0, blade = (u - st) / (1 - st);   // a leaf may grow from a thin stem (`stem`: its share of the length)
      var nx = -dy / l, ny = dx / l, w = !leaf ? hw * (1 - 0.1 * u) : u < st ? hw * 0.2 : hw * Math.pow(Math.sin(Math.PI * (0.06 + 0.94 * blade)), 0.8);
      if (i === N) wTip = w;
      A.push([x + nx * w, y + ny * w]); B.push([x - nx * w, y - ny * w]);
    }
    var d = 'M' + n2(A[0][0]) + ' ' + n2(A[0][1]);
    for (i = 1; i <= N; i++) d += 'L' + n2(A[i][0]) + ' ' + n2(A[i][1]);
    d += leaf ? 'L' + n2(B[N][0]) + ' ' + n2(B[N][1]) : 'A' + n2(wTip) + ' ' + n2(wTip) + ' 0 0 0 ' + n2(B[N][0]) + ' ' + n2(B[N][1]);
    for (i = N - 1; i >= 0; i--) d += 'L' + n2(B[i][0]) + ' ' + n2(B[i][1]);
    return d + 'Z';
  }

  // ---------- the face: eyes as ellipses, the mouth as one closed curve (a line when shut, a "D" when open, an "o") ----------
  function eyeR(e) { return { rx: e.rx || e.r, ry: e.ry || e.r }; }
  function mouthPath(m, smile, open, oo, x, y) {
    var lerp = function (a, b) { return a + (b - a) * oo; };
    var hw = lerp(m.w / 2 * (1 + 0.25 * Math.max(0, smile) + 0.15 * open), 10), depth = 4 + 24 * smile;
    var top = lerp(y + 2 * depth * (1 - 0.65 * Math.min(1, open * 4)), y - 18), bottom = lerp(y + 2 * depth + 80 * open, y + 34);
    return 'M' + n2(x - hw) + ' ' + n2(y) + 'Q' + n2(x) + ' ' + n2(top) + ' ' + n2(x + hw) + ' ' + n2(y) +
           'Q' + n2(x) + ' ' + n2(bottom) + ' ' + n2(x - hw) + ' ' + n2(y) + 'Z';
  }
  function blushOf(c) { return K.mixHex(c, '#FFFFFF', 0.42); }

  // ---------- scenes: keyframe tracks in seconds, [[t, value, ease], ...] ----------
  function BLINK(t0, hold) { hold = hold == null ? 0.04 : hold; return [[t0, 1], [t0 + 0.07, 0.06, 'in'], [t0 + 0.07 + hold, 0.06, 'lin'], [t0 + 0.18 + hold, 1, 'out']]; }
  function merge() { var out = []; for (var i = 0; i < arguments.length; i++) out = out.concat(arguments[i]); return out.sort(function (a, b) { return a[0] - b[0]; }); }
  function mirror(keys) { return keys.map(function (k) { return [k[0], -k[1], k[2]]; }); }
  function inverse(keys) { return keys.map(function (k) { return [k[0], 1 / k[1], k[2]]; }); }

  // ears of the right side (+ leans out); the left ear mirrors them. Ears lag the body: they flop out when it takes off
  // and when it lands, straighten at the top of the hop, then settle with a spring.
  var HOP_EARS = [[0, 0], [0.16, -4, 'out'], [0.3, 10, 'out'], [0.48, -6, 'io'], [0.66, 16, 'out'], [1.3, 0, 'spring']];
  var CHEER_EARS = [[0, 0], [0.12, -5, 'out'], [0.28, 12, 'out'], [0.5, 20, 'out'], [0.62, -8, 'out'], [0.76, 10, 'out'], [0.96, 22, 'out'], [1.45, 0, 'spring']];
  var SCENES = {
    blink: { dur: 0.6, tracks: {
      'eyes.open': [[0, 1], [0.08, 0.06, 'in'], [0.13, 0.06, 'lin'], [0.26, 1, 'out']],
      'ear.l': [[0, 0], [0.1, -4, 'out'], [0.5, 0, 'spring']], 'ear.r': [[0, 0], [0.1, 4, 'out'], [0.5, 0, 'spring']]
    } },
    // a glance to one side, a blink on the way, the other side, back
    look: { dur: 2.4, tracks: {
      'eyes.dx': [[0, 0], [0.12, 24, 'out'], [0.9, 24, 'lin'], [1.05, -24, 'out'], [1.9, -24, 'lin'], [2.15, 0, 'out']],
      'eyes.dy': [[0, 0], [0.12, 2, 'out'], [1.9, 2, 'lin'], [2.15, 0, 'out']],
      'body.rot': [[0, 0], [0.3, 2.5, 'out'], [0.9, 2.5, 'lin'], [1.25, -2.5, 'io'], [1.9, -2.5, 'lin'], [2.4, 0, 'soft']],
      'eyes.open': BLINK(0.95, 0.02),
      'ear.l': [[0, 0], [0.4, 6, 'out'], [0.95, 5, 'lin'], [1.35, -7, 'io'], [1.95, -5, 'lin'], [2.4, 0, 'soft']],
      'ear.r': [[0, 0], [0.42, 5, 'out'], [0.95, 4, 'lin'], [1.4, -8, 'io'], [1.95, -6, 'lin'], [2.4, 0, 'soft']]
    } },
    // a head tilt with one eye opening wider: "what is that?"
    curious: { dur: 2.4, tracks: {
      'mouth.o': [[0, 0], [0.3, 0.55, 'out'], [1.5, 0.55, 'lin'], [1.8, 0, 'io']],
      'body.rot': [[0, 0], [0.18, -2, 'out'], [0.55, 9, 'back'], [1.5, 9, 'lin'], [1.95, 0, 'soft']],
      'body.sy': [[0, 1], [0.15, 0.96, 'ant'], [0.38, 1.04, 'out'], [0.7, 1, 'soft']],
      'body.sx': [[0, 1], [0.15, 1.04, 'ant'], [0.38, 0.96, 'out'], [0.7, 1, 'soft']],
      'eyes.dx': [[0, 0], [0.3, 16, 'out'], [1.5, 16, 'lin'], [1.8, 0, 'out']],
      'eyeL.open': [[0, 1], [0.3, 0.84, 'out'], [1.5, 0.84, 'lin'], [1.75, 1, 'io']],
      'eyeR.open': [[0, 1], [0.3, 1.12, 'out'], [1.5, 1.12, 'lin'], [1.75, 1, 'io']],
      'eyes.open': BLINK(1.1, 0.02),
      'ear.r': [[0, 0], [0.3, -10, 'out'], [0.75, 2, 'spring'], [1.6, 0, 'lin'], [1.8, 6, 'out'], [2.3, 0, 'spring']],
      'ear.l': [[0, 0], [0.35, -4, 'out'], [0.8, 0, 'spring']]
    } },
    // crouch, hop, land with a squash, happy eyes: arriving or greeting
    hello: { dur: 1.7, tracks: {
      'body.sy': [[0, 1], [0.16, 0.88, 'ant'], [0.28, 1.1, 'out'], [0.42, 1.02, 'io'], [0.56, 1.04, 'in'], [0.6, 0.85, 'out'], [0.7, 0.88, 'lin'], [1.2, 1, 'spring']],
      'body.sx': inverse([[0, 1], [0.16, 0.88, 'ant'], [0.28, 1.1, 'out'], [0.42, 1.02, 'io'], [0.56, 1.04, 'in'], [0.6, 0.85, 'out'], [0.7, 0.88, 'lin'], [1.2, 1, 'spring']]),
      'body.ty': [[0, 0], [0.16, 0, 'lin'], [0.4, -110, 'rise'], [0.6, 0, 'fall']],
      'body.rot': [[0, 0], [0.3, 3, 'out'], [0.48, -2, 'io'], [0.6, 0, 'in']],
      'eyes.dy': [[0, 0], [0.16, 7, 'out'], [0.4, -4, 'out'], [0.6, 9, 'in'], [0.95, 0, 'soft']],
      'eyes.open': merge([[0, 1], [0.16, 0.6, 'out'], [0.4, 1.1, 'out'], [0.55, 1, 'io']], BLINK(0.62, 0.02)),
      'eyes.cheek': [[0, 0], [0.75, 0, 'lin'], [0.88, 0.32, 'out'], [1.4, 0.32, 'lin'], [1.65, 0, 'io']],
      'mouth.smile': [[0, 0], [0.75, 0, 'lin'], [0.88, 0.5, 'out'], [1.4, 0.5, 'lin'], [1.65, 0, 'io']],
      'mouth.open': [[0, 0], [0.75, 0, 'lin'], [0.9, 0.55, 'out'], [1.3, 0.45, 'lin'], [1.6, 0, 'io']],
      'ear.l': mirror(HOP_EARS), 'ear.r': HOP_EARS
    } },
    // eyes up to one side while it thinks, a blink, then "got it": wide eyes and a small hop
    think: { dur: 3.6, tracks: {
      'eyes.dx': [[0, 0], [0.3, 22, 'out'], [1.6, 22, 'lin'], [1.75, -6, 'out'], [2.1, -6, 'lin'], [2.25, 22, 'out'], [2.8, 22, 'lin'], [2.95, 0, 'out']],
      'eyes.dy': [[0, 0], [0.3, -6, 'out'], [2.8, -6, 'lin'], [2.95, 0, 'out']],
      'eyes.open': merge([[0, 1], [0.3, 0.82, 'out'], [1.62, 0.82, 'lin']], BLINK(1.66, 0.02), [[2.0, 0.82], [2.8, 0.82, 'lin'], [2.95, 1.16, 'out'], [3.4, 1, 'soft']]),
      'mouth.smile': [[0, 0], [0.3, -0.3, 'out'], [2.8, -0.3, 'lin'], [2.95, 0.45, 'out'], [3.5, 0, 'soft']],
      'body.rot': [[0, 0], [0.45, -4, 'out'], [2.8, -4, 'lin'], [3.0, 1.5, 'out'], [3.5, 0, 'soft']],
      'body.sy': [[0, 1], [0.9, 1.012, 'sine'], [1.8, 1, 'sine'], [2.6, 1.012, 'sine'], [2.85, 1, 'sine'], [2.95, 0.93, 'ant'], [3.1, 1.07, 'out'], [3.55, 1, 'spring']],
      'body.sx': [[0, 1], [0.9, 0.994, 'sine'], [1.8, 1, 'sine'], [2.6, 0.994, 'sine'], [2.85, 1, 'sine'], [2.95, 1.06, 'ant'], [3.1, 0.94, 'out'], [3.55, 1, 'spring']],
      'body.ty': [[0, 0], [2.95, 0, 'lin'], [3.12, -40, 'rise'], [3.32, 0, 'fall']],
      'ear.l': [[0, 0], [0.45, -9, 'out'], [2.8, -9, 'lin'], [3.0, 7, 'out'], [3.55, 0, 'spring']],
      'ear.r': [[0, 0], [0.45, -3, 'out'], [2.8, -3, 'lin'], [3.0, -8, 'out'], [3.55, 0, 'spring']]
    } },
    // two hops with happy eyes and flapping ears: it worked
    cheer: { dur: 2.2, tracks: {
      'body.ty': [[0, 0], [0.12, 0, 'lin'], [0.3, -130, 'rise'], [0.5, 0, 'fall'], [0.58, 0, 'lin'], [0.74, -90, 'rise'], [0.94, 0, 'fall']],
      'body.sy': [[0, 1], [0.12, 0.86, 'ant'], [0.24, 1.12, 'out'], [0.4, 1.02, 'io'], [0.5, 0.85, 'out'], [0.58, 0.9, 'lin'], [0.68, 1.08, 'out'], [0.84, 1, 'io'], [0.94, 0.88, 'out'], [1.35, 1, 'spring']],
      'body.sx': inverse([[0, 1], [0.12, 0.86, 'ant'], [0.24, 1.12, 'out'], [0.4, 1.02, 'io'], [0.5, 0.85, 'out'], [0.58, 0.9, 'lin'], [0.68, 1.08, 'out'], [0.84, 1, 'io'], [0.94, 0.88, 'out'], [1.35, 1, 'spring']]),
      'body.rot': [[0, 0], [0.3, -6, 'out'], [0.5, 0, 'in'], [0.74, 6, 'out'], [0.94, 0, 'in']],
      'eyes.cheek': [[0, 0], [0.2, 0.34, 'out'], [1.7, 0.34, 'lin'], [1.95, 0, 'io']],
      'mouth.smile': [[0, 0], [0.15, 0.6, 'out'], [1.7, 0.6, 'lin'], [1.95, 0, 'io']],
      'mouth.open': [[0, 0], [0.15, 0.75, 'out'], [1.7, 0.7, 'lin'], [1.95, 0, 'io']],
      'eyes.open': BLINK(1.96, 0.02),
      'ear.l': mirror(CHEER_EARS), 'ear.r': CHEER_EARS
    } },
    // lids droop, two nods, then a wake-up hop
    sleep: { dur: 4.6, tracks: {
      'eyes.lid': [[0, 0], [1.1, 0.34, 'io'], [3.7, 0.34, 'lin'], [3.8, 0, 'out']],
      'mouth.smile': [[0, 0], [1.1, -0.3, 'io'], [3.7, -0.3, 'lin'], [3.86, 0, 'out']],
      'mouth.o': [[0, 0], [2.3, 0, 'lin'], [2.6, 0.3, 'io'], [3.7, 0.3, 'lin'], [3.8, 0, 'out']],
      'eyes.open': [[0, 1], [1.1, 0.5, 'io'], [1.8, 0.5, 'lin'], [2.3, 0.06, 'io'], [3.7, 0.06, 'lin'], [3.86, 1.15, 'out'], [4.2, 1, 'soft']],
      'eyes.dy': [[0, 0], [1.1, 5, 'io'], [3.7, 7, 'lin'], [3.86, -3, 'out'], [4.2, 0, 'soft']],
      'body.sy': [[0, 1], [1.3, 0.985, 'sine'], [2.6, 1.015, 'sine'], [3.5, 0.99, 'sine'], [3.7, 0.95, 'in'], [3.86, 1.06, 'out'], [4.3, 1, 'spring']],
      'body.sx': [[0, 1], [1.3, 1.012, 'sine'], [2.6, 0.988, 'sine'], [3.5, 1.008, 'sine'], [3.7, 1.04, 'in'], [3.86, 0.96, 'out'], [4.3, 1, 'spring']],
      'body.ty': [[0, 0], [2.6, 0, 'lin'], [2.75, 9, 'in'], [3.0, 0, 'soft'], [3.15, 0, 'lin'], [3.28, 11, 'in'], [3.55, 0, 'soft'], [3.7, 0, 'lin'], [3.86, -34, 'rise'], [4.1, 0, 'fall']],
      'body.rot': [[0, 0], [2.2, 3, 'io'], [2.75, 4.5, 'in'], [3.0, 3, 'soft'], [3.28, 5, 'in'], [3.55, 3, 'soft'], [3.7, 3, 'lin'], [3.9, -1.5, 'out'], [4.3, 0, 'soft']],
      'ear.l': [[0, 0], [1.5, -15, 'io'], [3.7, -15, 'lin'], [3.82, 9, 'out'], [4.3, 0, 'spring']],
      'ear.r': [[0, 0], [1.5, 15, 'io'], [3.7, 15, 'lin'], [3.82, -9, 'out'], [4.3, 0, 'spring']]
    } },
    // yes, twice
    nod: { dur: 1.0, tracks: {
      'body.ty': [[0, 0], [0.14, 10, 'out'], [0.3, 0, 'io'], [0.44, 8, 'out'], [0.6, 0, 'io']],
      'body.sy': [[0, 1], [0.14, 0.95, 'out'], [0.3, 1.01, 'io'], [0.44, 0.96, 'out'], [0.75, 1, 'soft']],
      'body.sx': [[0, 1], [0.14, 1.04, 'out'], [0.3, 0.995, 'io'], [0.44, 1.03, 'out'], [0.75, 1, 'soft']],
      'eyes.dy': [[0, 0], [0.14, 10, 'out'], [0.3, 2, 'io'], [0.44, 9, 'out'], [0.7, 0, 'soft']],
      'eyes.open': [[0, 1], [0.14, 0.7, 'out'], [0.3, 1, 'io'], [0.44, 0.75, 'out'], [0.7, 1, 'soft']],
      'mouth.smile': [[0, 0], [0.14, 0.3, 'out'], [0.8, 0.3, 'lin'], [1.0, 0, 'soft']],
      'ear.l': [[0, 0], [0.16, -5, 'out'], [0.32, 3, 'io'], [0.46, -4, 'out'], [0.9, 0, 'spring']],
      'ear.r': [[0, 0], [0.16, 5, 'out'], [0.32, -3, 'io'], [0.46, 4, 'out'], [0.9, 0, 'spring']]
    } },
    // dropped in from above the frame: stretched while falling, a big squash, a spring back (sound at 0.42 s)
    land: { dur: 1.1, tracks: {
      'body.ty': [[0, -1600], [0.42, 0, 'fall']],
      'body.sy': [[0, 1.14], [0.4, 1.14, 'lin'], [0.44, 0.82, 'out'], [0.56, 0.86, 'lin'], [1.05, 1, 'spring']],
      'body.sx': [[0, 0.9], [0.4, 0.9, 'lin'], [0.44, 1.18, 'out'], [0.56, 1.14, 'lin'], [1.05, 1, 'spring']],
      'eyes.open': [[0, 1.1], [0.42, 1.1, 'lin'], [0.46, 0.4, 'out'], [0.62, 1, 'out']],
      'eyes.dy': [[0, -4], [0.42, -4, 'lin'], [0.46, 10, 'out'], [0.8, 0, 'soft']],
      'mouth.o': [[0, 0.5], [0.42, 0.5, 'lin'], [0.46, 0.9, 'out'], [0.66, 0, 'out']],
      'ear.l': [[0, 6], [0.42, 6, 'lin'], [0.5, -20, 'out'], [1.1, 0, 'spring']],
      'ear.r': [[0, -6], [0.42, -6, 'lin'], [0.5, 20, 'out'], [1.1, 0, 'spring']]
    } }
  };
  function duration(name) { return SCENES[name] ? SCENES[name].dur : 0; }
  // the channels of a scene `st` seconds after it started (held at its last pose afterwards)
  function sceneAt(name, st) {
    var s = SCENES[name], p = {};
    if (!s) throw new Error('unknown mascot scene ' + name + ' (scenes: ' + Object.keys(SCENES).join(', ') + ')');
    var u = Math.max(0, Math.min(st, s.dur));
    for (var k in s.tracks) p[k] = K.sample(s.tracks[k], u);
    return p;
  }
  var MULT = /\.(sx|sy|open|op)$/;
  function mix(ch, k, v) { if (MULT.test(k)) ch[k] = (ch[k] == null ? 1 : ch[k]) * v; else ch[k] = (ch[k] || 0) + v; }
  function addAll(ch, p) { for (var k in p) mix(ch, k, p[k]); }

  // ---------- idle: breathing, blinks and one small fidget at a time, all seeded ----------
  function rng(seed) {
    var s = (seed >>> 0) || 1;
    return function () { s = (s + 0x6D2B79F5) >>> 0; var t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function idlePlan(seed) {
    var r = rng(seed), blinks = [], fidgets = [], t = 1.8 + r() * 1.2, last = '';
    while (t < 900) { blinks.push(t); if (r() < 0.3) blinks.push(t + 0.38); t += 2.4 + r() * 2.8; }
    t = 5 + r() * 2.5;
    while (t < 900) {
      var kind = last === 'glance' ? 'ear' : (r() < 0.6 ? 'glance' : 'ear');   // never the same fidget twice in a row
      if (kind === 'glance') fidgets.push({ t: t, kind: 'glance', dx: (r() < 0.5 ? -1 : 1) * (14 + r() * 9), dy: r() * 3, hold: 0.6 + r() * 0.7 });
      else fidgets.push({ t: t, kind: r() < 0.5 ? 'ear.l' : 'ear.r', a: (r() < 0.5 ? -1 : 1) * (7 + r() * 6) });
      last = kind; t += 5.5 + r() * 5;
    }
    return { blinks: blinks, fidgets: fidgets };
  }
  function idleAt(plan, t, quiet) {
    var breath = 0.5 - 0.5 * Math.cos(2 * Math.PI * t / 5.2);
    var o = { 'body.sy': 1 + 0.012 * breath, 'body.sx': 1 - 0.006 * breath };
    if (quiet) return o;
    var open = 1, i, b;
    for (i = 0; i < plan.blinks.length && (b = plan.blinks[i]) <= t; i++) if (t - b < 0.3) open = Math.min(open, K.sample(BLINK(b), t));
    o['eyes.open'] = open;
    for (i = 0; i < plan.fidgets.length; i++) {
      var f = plan.fidgets[i]; if (f.t > t) break;
      var d = t - f.t;
      if (f.kind === 'glance' && d < f.hold + 0.4) {
        var k = K.sample([[0, 0], [0.14, 1, 'out'], [f.hold, 1, 'lin'], [f.hold + 0.26, 0, 'io']], d);
        o['eyes.dx'] = (o['eyes.dx'] || 0) + f.dx * k; o['eyes.dy'] = (o['eyes.dy'] || 0) + f.dy * k;
      } else if (f.kind !== 'glance' && d < 0.7) {
        o[f.kind] = (o[f.kind] || 0) + K.sample([[0, 0], [0.09, f.a, 'out'], [0.32, 0, 'spring']], d);
      }
    }
    return o;
  }
  function scenesOf(sc) { return !sc ? [] : Array.isArray(sc[0]) ? sc.filter(Boolean) : [sc]; }

  K.mascot = function (parent, o) {
    o = o || {};
    var S = shape(), size = o.size || 400, k = size / S.view[2], hpx = S.view[3] * k, inSvg = parent instanceof SVGElement;
    var host = inSvg ? K.svg('g', {}, parent) : K.el('div', { cls: 'mascot', style: { position: 'absolute', left: '0px', top: '0px', width: size + 'px', height: hpx + 'px' } }, parent);
    host.setAttribute('data-ov', 'mascot');
    var root = K.svg('svg', { viewBox: S.view.join(' '), width: size, height: hpx, overflow: 'visible', style: 'overflow:visible;display:block' }, host);
    var body = o.color || K.C.accent, face = o.eyes || K.C.ink;
    var gBody = K.svg('g', {}, root);
    var gFill = K.svg('g', { fill: body }, gBody);
    var ears = S.ears.map(function (e) { return K.svg('path', { d: earPath(e, 0) }, gFill); });
    K.svg('path', { d: S.body }, gFill);
    // the face, in drawing order: eyes, the body-coloured arcs that make a happy eye, blush, mouth
    var gEyes = K.svg('g', { fill: face }, gBody);
    var eyes = S.eyes.map(function () { return K.svg('ellipse', {}, gEyes); });
    var gCover = K.svg('g', { fill: body }, gBody);
    var covers = S.eyes.map(function () { return K.svg('ellipse', { cx: 0, cy: -9999, rx: 1, ry: 1 }, gCover); });
    var gBlush = K.svg('g', { fill: blushOf(body) }, gBody);
    var blush = (S.blush || []).map(function (b) { return K.svg('ellipse', { rx: b.rx, ry: b.ry }, gBlush); });
    var mouth = S.mouth ? K.svg('path', { fill: face, stroke: face, 'stroke-width': S.mouth.stroke || 12, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, gBody) : null;
    var plan = idlePlan(o.seed || 11), earKey = '';

    function g(ch, key, d) { return ch[key] == null ? d : ch[key]; }
    function apply(ch) {
      gBody.setAttribute('transform', 'translate(' + n2(g(ch, 'body.tx', 0)) + ' ' + n2(g(ch, 'body.ty', 0)) + ') rotate(' + g(ch, 'body.rot', 0).toFixed(3) + ') scale(' + g(ch, 'body.sx', 1).toFixed(4) + ' ' + g(ch, 'body.sy', 1).toFixed(4) + ')');
      gBody.setAttribute('opacity', K.clamp(g(ch, 'body.op', 1), 0, 1));
      var el = g(ch, 'ear.l', 0), er = g(ch, 'ear.r', 0), key = el.toFixed(1) + ',' + er.toFixed(1);
      if (key !== earKey) { earKey = key; ears.forEach(function (p, i) { p.setAttribute('d', earPath(S.ears[i], i % 2 ? er : el)); }); }
      var gz = S.gaze || { x: 30, up: 8, down: 26 };
      var dx = K.clamp(g(ch, 'eyes.dx', 0), -gz.x, gz.x), dy = K.clamp(g(ch, 'eyes.dy', 0), -gz.up, gz.down);
      var cheek = K.clamp(g(ch, 'eyes.cheek', 0), 0, 0.4), lid = K.clamp((S.lid == null ? 0.6 : S.lid) + g(ch, 'eyes.lid', 0), 0, 1);
      S.eyes.forEach(function (e, i) {
        var R = eyeR(e), open = Math.max(0.06, g(ch, 'eyes.open', 1) * g(ch, i ? 'eyeR.open' : 'eyeL.open', 1));
        var ry = Math.max(3.5, R.ry * Math.min(open, 1.2)), cx = e.x + dx;
        var cy = e.y + dy + (lid - 0.5) * 2 * R.ry * (1 - Math.min(open, 1));   // a closing eye meets at the lid line
        eyes[i].setAttribute('cx', n2(cx)); eyes[i].setAttribute('cy', n2(cy)); eyes[i].setAttribute('rx', n2(R.rx)); eyes[i].setAttribute('ry', n2(ry));
        // a happy eye: an arch of the body's colour rises from below and leaves the upper half of the eye
        var cr = R.rx * 1.5, top = cy + ry - cheek * 2.5 * ry;
        covers[i].setAttribute('cx', n2(cx)); covers[i].setAttribute('cy', n2(cheek > 0.001 ? top + cr * 0.9 : -9999));
        covers[i].setAttribute('rx', n2(cr)); covers[i].setAttribute('ry', n2(cr * 0.9));
      });
      (S.blush || []).forEach(function (b, i) { blush[i].setAttribute('cx', n2(b.x + dx * 0.3)); blush[i].setAttribute('cy', n2(b.y + dy * 0.25)); });
      gBlush.setAttribute('opacity', K.clamp(0.32 + cheek * 1.5, 0, 0.92).toFixed(3));
      if (mouth) {   // the face follows the gaze a little, so the mascot turns its head without a 3D rig
        var m = S.mouth, mx = m.x + dx * 0.35, my = m.y + dy * 0.3, oo = K.clamp(g(ch, 'mouth.o', 0), 0, 1);
        var smile = K.clamp((m.smile == null ? 0.35 : m.smile) + g(ch, 'mouth.smile', 0), -0.3, 1), open = K.clamp(g(ch, 'mouth.open', 0), 0, 1);
        mouth.setAttribute('d', mouthPath(m, smile, open, oo, mx, my));
      }
    }

    var me = {
      el: host, size: size, shape: S,
      // the body's colour and, optionally, the face's (eyes and mouth)
      color: function (c, eyesColour) {
        gFill.setAttribute('fill', c); gCover.setAttribute('fill', c); gBlush.setAttribute('fill', blushOf(c));
        if (eyesColour !== undefined) {
          var f = eyesColour || K.C.ink; gEyes.setAttribute('fill', f);
          if (mouth) { mouth.setAttribute('fill', f); mouth.setAttribute('stroke', f); }
        }
        return me;
      },
      // explicit channels only (no idle, no scene), for films that compose their own pose
      pose: function (ch) { apply(ch || {}); return me; },
      set: function (t, p) {
        p = p || {};
        var ch = {}, list = scenesOf(p.scene);
        var playing = list.some(function (s) { return t - s[1] >= 0 && t - s[1] <= duration(s[0]); });
        if (p.idle !== false) addAll(ch, idleAt(plan, t, playing));
        list.forEach(function (s) { if (t >= s[1]) addAll(ch, sceneAt(s[0], t - s[1])); });
        for (var key in p) if (key.indexOf('.') > 0) mix(ch, key, p[key]);
        apply(ch);
        var s = p.s == null ? 1 : p.s, bx = -S.view[0] * k, by = -S.view[1] * k, x = p.x || 0, y = p.y || 0, r = p.r || 0;
        if (inSvg) host.setAttribute('transform', 'translate(' + n2(x) + ' ' + n2(y) + ') rotate(' + r + ') scale(' + s.toFixed(4) + ') translate(' + n2(-bx) + ' ' + n2(-by) + ')');
        else { host.style.transformOrigin = '0 0'; host.style.transform = 'translate(' + n2(x) + 'px,' + n2(y) + 'px) rotate(' + r + 'deg) scale(' + s.toFixed(4) + ') translate(' + n2(-bx) + 'px,' + n2(-by) + 'px)'; }
        var op = p.op == null ? 1 : K.clamp(p.op, 0, 1);
        if (inSvg) host.setAttribute('opacity', op); else host.style.opacity = op;
        host.style.visibility = op === 0 || s === 0 ? 'hidden' : '';
        return me;
      }
    };
    return me;
  };
  K.mascot.scenes = Object.keys(SCENES);
  K.mascot.duration = duration;
  K.mascot.sceneAt = sceneAt;
  K.mascot.earPath = earPath;

  // the silhouette as filled paths [body, ears...] in shape units, for wipes, badges and the "mascot" particle set
  K.mascotPaths = function () { var S = shape(); return [S.body].concat(S.ears.map(function (e) { return earPath(e, 0); })); };
  // the resting face in shape units, to cut out of a silhouette (badge, particle set): eye ellipses and the mouth line
  K.mascotFace = function () {
    var S = shape(), m = S.mouth;
    return { eyes: S.eyes.map(function (e) { var R = eyeR(e); return { cx: e.x, cy: e.y, rx: R.rx, ry: R.ry }; }),
             mouth: m ? { d: mouthPath(m, m.smile == null ? 0.35 : m.smile, 0, 0, m.x, m.y), width: m.stroke || 12 } : null };
  };
  // where a mascot of `size` standing at (x, y) is drawn: { cx, cy, w, h } in pixels. Place the "mascot" point set
  // with it (K.dots.place('mascot', K.mascotBox(x, y, size))) and the dots land exactly on the drawing.
  K.mascotBox = function (x, y, size) {
    var v = shape().view, k = size / v[2];
    return { cx: x + (v[0] + v[2] / 2) * k, cy: y + (v[1] + v[3] / 2) * k, w: v[2] * k, h: v[3] * k };
  };
  // the middle of the body in shape units (where wipes grow from)
  K.mascotCentre = function () { var S = shape(), top = Infinity; S.eyes.forEach(function (e) { top = Math.min(top, e.y); }); return [0, top * 0.9]; };

  // Transition: the mascot's silhouette grows from (cx, cy) until it covers the frame (k 0 → 1).
  // layer: an SVG layer (K.stageSvg(K.top, 40)); o.grow: the final scale (default 14); o.shape 'circle' for a disc.
  K.wipe = function (layer, k, color, cx, cy, o) {
    o = o || {};
    if (!layer._wipe) {
      layer._wipe = K.svg('g', {}, layer);
      if (o.shape === 'circle') K.svg('circle', { r: 240 }, layer._wipe);
      else K.mascotPaths().forEach(function (d) { K.svg('path', { d: d }, layer._wipe); });
    }
    var s = 0.02 + Math.pow(K.clamp(k, 0, 1), 2.2) * (o.grow || 14), c = o.shape === 'circle' ? [0, 0] : K.mascotCentre();
    layer._wipe.setAttribute('fill', color);
    layer._wipe.setAttribute('transform', 'translate(' + (cx == null ? K.W / 2 : cx) + ' ' + (cy == null ? K.H * 0.55 : cy) + ') scale(' + s.toFixed(4) + ') translate(' + (-c[0]) + ' ' + (-c[1]) + ')');
    layer._wipe.style.visibility = k <= 0 ? 'hidden' : '';
  };
})();
