/* Sample: the mascot handles it. An empty guiding sample: the structure is the method, the words are slots.

     L01 hook     the grey world already shows the problem: a person, and messages piling up around them
     L02 problem  one of those things speaks (a chatter with eyes, voiced by "guest")
     L03 turn     the mascot drops in: the only thing on screen in the accent colour
     L04 payoff   it handles one thing per beat; whatever it handles turns accent and cheers up
     L05 close    the promise appears in particles and becomes the mascot; its silhouette wipes to the end card

   Every cue is read from the timeline, never typed in seconds, so a new voice take re-times the whole film.
   Cues hang on the *emphasised* word of each line (script.json), so rewording a line rarely breaks them.
   K.word('L03', 'help') would find a word by its first letters instead. */
FILM({
  bg: K.C.paper,
  captions: { theme: 'paper', y: 1610 },
  overlaps: [['chatter', 'mascot'], ['closing', 'hero']],   // on purpose: it drops in from behind the messages; the dots become it
  build: function (K) {
    var C = K.C, G = K.G, L = K.line, self = this
    var hot = function (id) { var ws = L(id).words; return ws.filter(function (w) { return w.hot })[0] || ws[ws.length - 1] }
    var second = function (id) { var ws = L(id).words; for (var i = 0; i < ws.length - 1; i++) if (/[.!?]$/.test(ws[i].w)) return ws[i + 1]; return ws[ws.length - 1] }
    var T = this.T = {
      problem: hot('L01').start, l02: L('L02').start, l02end: L('L02').end,
      land: hot('L03').start,
      l04: L('L04').start, colour: hot('L04').start,
      l05: L('L05').start, promise: hot('L05').start, then: second('L05').start, l05end: L('L05').end
    }
    // the payoff: one beat per thing handled, spread from the start of L04 to its emphasised word
    T.beats = [0, 1, 2, 3].map(function (i) { return K.lerp(T.l04 + 0.1, T.colour - 0.35, i / 3) })
    T.out = T.l05 - 0.15          // the world clears for the close
    T.morph = T.then - 0.1        // the promise becomes the mascot
    T.wipe = T.l05end + 0.15
    T.card = T.wipe + 0.45

    // the world: everything the camera moves
    this.world = K.el('div', { cls: 'layer' })
    this._sparks = K.dots.layer(this.world)   // under the scene: a handled bubble gets a halo, never dots over its words
    var sv = K.stageSvg(this.world)
    this._floor = K.svg('path', { d: 'M-600 1430H1680V2600H-600Z', fill: C.paper2 }, sv)   // a tonal floor, no outline ("_": not checked for overlaps)
    K.svg('ellipse', { cx: 330, cy: 1474, rx: 150, ry: 22, fill: C.paper3 }, sv)
    this._shadow = K.svg('ellipse', { cx: 0, cy: 0, rx: 130, ry: 21, fill: C.paper3 }, sv)   // the mascot's, grows as it falls
    this.alex = K.person(sv, { hair: 'short', skin: G.skin2, cloth: G.mid, pants: G.dark, apron: G.skin1, seed: 7 })
    this.phone = K.props.phone(this.alex.hand, { w: 112, h: 222 })
    // the things waiting: [text, x, y, w, h, voice]; "Hello?" is the one that speaks L02
    var specs = [['Price?', 780, 420, 340, 200], ['Size?', 290, 330, 320, 190], ['Hello?', 300, 650, 380, 220, 'guest'], ['Open?', 800, 740, 330, 200]]
    this.mascot = K.mascot(sv, { size: 360, seed: 4 })   // in the SVG before the chatters: it drops in from behind them
    this.chatters = specs.map(function (s, i) { var c = K.chatter(sv, s[0], { w: s[3], h: s[4], voice: s[5], seed: i + 2 }); c.x = s[1]; c.y = s[2]; return c })
    this.popAt = [-0.5, T.problem - 0.1, T.l02 - 0.3, T.l02end + 0.05]   // the first is already there on frame one
    this.order = [2, 3, 0, 1]                                              // who gets handled on each beat

    // the close: the promise in particles turns into the mascot
    this.closing = K.dots.layer(K.root)
    this.promise = K.dots.place('promise', { cx: 540, cy: 800, h: 270, n: 7000 })
    this.heroAt = [540, 1330, 440]
    this.heroDots = K.dots.place('mascot', Object.assign({ n: 7000 }, K.mascotBox(540, 1330, 440)))
    this.hero = K.mascot(K.root, { size: 440, seed: 8 })
    this.wipe = K.stageSvg(K.top, 40)
    this.card = K.endCard(K.top, { at: T.card })   // the logo lands with its sound at T.card + K.logo.LAND

    // sound: the film declares its cues; `render.mjs <piece> events` writes them to events.json
    this.popAt.forEach(function (t0, i) { if (t0 > 0) K.sfx(t0 + 0.04, 'pop', { gain_db: -18, pan: (self.chatters[i].x - 540) / 900 }) })
    K.sfx(T.land - 0.42, 'whoosh', { gain_db: -16 })
    K.sfx(T.land, 'thud', { gain_db: -9 })
    T.beats.forEach(function (b, i) { K.sfx(b + 0.05, 'ding', { gain_db: -21, pan: (self.chatters[self.order[i]].x - 540) / 900 }) })
    K.sfx(T.colour + 0.4, 'pop', { gain_db: -16 })
    K.sfx(T.out, 'swoosh', { gain_db: -18 })
    K.sfx(T.morph + 0.8 - 1.6, 'riser', { gain_db: -22 })
    K.sfx(T.wipe - 0.05, 'swoosh', { gain_db: -15 })
  },

  frame: function (t, K) {
    var T = this.T, C = K.C, S = K.sample, pop = K.pop, pr = K.prog, D = K.dots, self = this
    // camera: a slow push while the problem piles up, a jolt on the landing, a drift toward the mascot, a push out
    var out = K.E.in(pr(t, T.out, T.out + 0.45))
    K.camera(this.world, {
      x: S([[0, 515], [T.problem - 0.2, 520, 'lin'], [T.l02 + 0.5, 540, 'move'], [T.land, 540], [T.land + 0.9, 585, 'move']], t),
      y: S([[0, 1000], [T.out, 1000], [T.out + 0.6, 1120, 'in']], t),
      z: S([[0, 1.16], [T.problem - 0.2, 1.13, 'lin'], [T.l02 + 0.5, 1.0, 'move'], [T.land - 0.1, 1.05, 'lin'], [T.land + 0.6, 1.02, 'out'], [T.out, 1.05, 'lin'], [T.out + 0.6, 1.45, 'in']], t),
      shake: S([[0, 0], [T.land, 0], [T.land + 0.04, 0.6, 'out'], [T.land + 0.45, 0, 'out']], t)
    })
    this.world.style.opacity = (1 - out).toFixed(3)
    this.world.style.visibility = out >= 1 ? 'hidden' : ''

    // which chatter the mascot is handling now (-1: none yet)
    var beat = -1
    T.beats.forEach(function (b, i) { if (t >= b - 0.3) beat = i })
    var landed = t >= T.land

    // the things waiting: they pop in, get sadder the longer nobody answers, watch whoever is acting
    this.chatters.forEach(function (c, i) {
      var k = pop(t, self.popAt[i], 0.45), hb = T.beats[self.order.indexOf(i)]
      var acc = K.E.out(pr(t, hb, hb + 0.3)), hop = acc > 0 && acc < 1 ? -Math.sin(acc * Math.PI) * 36 : 0
      var waiting = pr(t, self.popAt[i] + 0.6, T.land)
      var tx = landed ? 840 : t >= T.l02 - 0.2 && i !== 2 ? self.chatters[2].x : 330, ty = landed ? 1300 : t >= T.l02 - 0.2 && i !== 2 ? self.chatters[2].y : 1000
      var dx = tx - c.x, dy = ty - c.y, dl = Math.sqrt(dx * dx + dy * dy) || 1
      c.set(t, { x: c.x, y: c.y + hop + Math.sin(t * 1.7 + i * 1.3) * 6, s: k, accent: acc, happy: acc, sad: (1 - acc) * waiting * 0.8,
        look: [dx / dl * 14, dy / dl * 10], r: Math.sin(t * 1.3 + i) * 1.5 })
    })

    // the person: eyes on the phone, then up at the pile, surprised by the landing, relieved when it is handled
    var surprised = pr(t, T.land, T.land + 0.15) * (1 - pr(t, T.land + 1.1, T.land + 1.5)), relieved = pr(t, T.beats[1], T.beats[1] + 0.4)
    var cheer = t > T.colour + 0.2 ? Math.max(0, Math.sin((t - T.colour - 0.2) * 10)) * (1 - pr(t, T.colour + 0.2, T.colour + 1.2)) : 0
    this.alex.set(t, { x: 330, y: 1470, armR: 16, elbowR: 112, armL: 10, bounce: cheer,
      look: t < T.problem ? [-14, 26] : !landed ? [-6, -34] : [44, -6],
      brows: relieved > 0.5 ? 'up' : t > T.problem ? 'sad' : 0,
      mouth: relieved > 0.5 ? 'smile' : surprised > 0.5 ? 'o' : t > T.problem ? 'frown' : 'flat',
      eyesBig: 1 + 0.25 * surprised })
    this.phone.set(t, { x: 0, y: 26, r: 112 })

    // the mascot: dropped in on the emphasised word of L03, then it looks at each thing it handles
    // where it looks: the person first, then each thing it handles, then the viewer for the cheer.
    // The eyes lead (0.12 s, like a glance), the body follows (0.4 s): looking up is the body's job, it leans and stretches.
    var aim = function (i) {
      if (i < -1 || i >= T.beats.length) return { gx: 0, gy: 0, lean: 0, up: 0 }
      if (i === -1) return { gx: -22, gy: 2, lean: -3, up: 0 }
      var c = self.chatters[self.order[i]], fx = c.x - 840, fy = c.y - 1300, fl = Math.sqrt(fx * fx + fy * fy) || 1
      return { gx: (fx < 0 ? -1 : 1) * Math.max(20, Math.abs(fx / fl) * 34), gy: fy / fl * 30, lean: fx / fl * 8, up: Math.max(0, -fy / fl) * 0.035 }
    }
    var step = t >= T.colour - 0.1 ? T.beats.length : beat
    var since = step < 0 ? T.land + 0.3 : step >= T.beats.length ? T.colour - 0.1 : T.beats[step] - 0.3
    var a0 = aim(step - 1), a1 = aim(step), ke = K.E.out(pr(t, since, since + 0.12)), kb = K.E.io(pr(t, since, since + 0.4))
    var up = K.lerp(a0.up, a1.up, kb)
    this.mascot.set(t, { x: 840, y: 1470, op: t >= T.land - 0.42 ? 1 : 0,
      scene: [['land', T.land - 0.42], ['cheer', T.colour - 0.1]],
      'eyes.dx': K.lerp(a0.gx, a1.gx, ke), 'eyes.dy': K.lerp(a0.gy, a1.gy, ke),
      'body.rot': K.lerp(a0.lean, a1.lean, kb), 'body.sy': 1 + up, 'body.sx': 1 / (1 + up) })
    var fall = K.E.fall(pr(t, T.land - 0.42, T.land))
    this._shadow.setAttribute('transform', 'translate(840 1474) scale(' + (0.2 + 0.8 * fall).toFixed(3) + ')')
    this._shadow.style.visibility = t >= T.land - 0.42 ? '' : 'hidden'

    // handled: a small accent burst around each chatter as it turns
    D.begin(this._sparks, { x: K.W / 2, y: K.H / 2, z: 1 })
    T.beats.forEach(function (b, i) {
      var c = self.chatters[self.order[i]]
      D.burst(self._sparks, c.x, c.y, pr(t, b, b + 0.7), { mode: 'ink', col: C.accent, n: 140, spread: 300, r0: 2, r1: 5, seed: i + 3 })
    })
    D.end(this._sparks)

    // the close: the promise appears as ink dots, then flies into the mascot's shape, turning accent on the way
    var L = this.closing
    // a slow push while the promise holds, landing exactly at 1 when the dots hand over to the drawn mascot
    D.begin(L, { x: K.W / 2, y: K.H / 2, z: S([[T.out, 0.93], [T.morph + 0.7, 1, 'sine']], t) })
    var mp = pr(t, T.morph, T.morph + 0.8), solid = pr(t, T.morph + 0.72, T.morph + 0.92)
    if (t >= T.out && solid < 1) {
      if (mp <= 0) D.draw(L, this.promise, { mode: 'ink', col: C.ink, appear: pr(t, T.out + 0.45, T.promise + 0.35), from: { x: 540, y: 1250, spread: 1300 }, r0: 1.3, r1: 3.1, boil: 0.9 })
      else D.morph(L, this.promise, this.heroDots, mp, { mode: 'ink', col: C.ink, colB: C.accent, swirl: 90, stagger: 0.3, r0: 1.3, r1: 3.1, alpha: 1 - solid })
    }
    D.end(L)
    this.hero.set(t, { x: this.heroAt[0], y: this.heroAt[1], op: solid, scene: ['cheer', T.morph + 1.0] })

    // the mascot's silhouette wipes to the end card
    var hb = K.mascotBox(this.heroAt[0], this.heroAt[1], this.heroAt[2])
    K.wipe(this.wipe, pr(t, T.wipe, T.card + 0.1), C.accent, hb.cx, hb.cy)
    this.card.frame(t)
  }
})
