'use strict';
// First film: an EMPTY guiding sample. It runs end to end so you can see the pipeline work, and every slot
// says what to put there. Keep the craft, replace the content.
//
// Story template (five lines, ~25–30 s): hook → the customer's ask → the cost → the turn → promise + brand.
// One continuous shot, no cuts, the same dots all the way:
//   1 hook     a hand holding a phone engraves itself in dots; the question arrives, the asks pile up
//   2 cost     the hand's dots swirl into a clock; time runs, a stamp lands on the emphasised word;
//              ink floods the page
//   3 turn     in the dark, the clock's dots light up and become a person (the owner, seen from behind)
//   4 brand    the person's dots fly and assemble into the logo; wordmark, tagline, URL
// Every time below comes from the voice (L, W, Hot, along), so a new voice take re-times the whole film.

// The renderer sets WB_ENGINE to this bench's engine folder, so the piece can live anywhere.
const { defineFilm } = require(`${process.env.WB_ENGINE}/lib/film`);

// On-screen props (never spoken). Slots: replace with your customer's real situation.
const COPY = {
  contact: 'Sam',                                          // Slot: who writes in
  question: 'Is this still available?',                    // Slot: the message your customer actually sends
  chorus: ['How much?', 'Open today?', 'Can I book?', 'Still there?'],   // Slot: the asks that pile up
  verdict: 'LOST',                                         // Slot: a one-word stamp for the cost
  clockFrom: 9 * 60, clockLost: 45,                        // Slot: the waiting time the clock shows (minutes)
};

module.exports = defineFilm(__dirname, ({ L, Hot, along, P, cam, fx, ink, bubbles, math, voicenote, env, Frame }) => {
  const { clamp, ease, lerp, smoothstep, TAU } = math;
  const { camPath } = cam;

  // ---------------------------------------------------------------- times (all from the voice)
  const L1 = L('L01'), L2 = L('L02'), L3 = L('L03'), L4 = L('L04');
  const tBack0 = along('L01', 0.3), tBack1 = L1.end + 0.25;            // pull back from the macro
  const tType0 = L2.start - 0.75;                                       // typing dots before the voice note
  const tMorph0 = L3.start - 0.2, tMorph1 = tMorph0 + 1.3;              // hand → clock
  const tStamp = Hot('L03').start;                                      // the stamp lands on the *emphasised* word
  const tFlood0 = L3.end - 0.45, tFlood1 = L3.end + 0.4;                // ink floods the page
  const tLights = tFlood1 - 0.1;                                        // the clock's dots light up
  const lock = Hot('L05').end + 0.15;                                   // the logo completes on the brand name
  const GATHER = 1.6;
  // clock → person, finished before the end card takes the person's dots (guards keep short lines working).
  const tPerson0 = Math.max(tFlood1 + 0.35, L4.start + 0.05), tPerson1 = Math.max(tPerson0 + 0.6, Math.min(tPerson0 + 1.4, lock - GATHER - 0.2));

  // ---------------------------------------------------------------- the world (one space, one camera)
  const N = 26000;   // morph pairs share the same number of dots
  let HAND, CLOCK, PERSON;
  const setup = () => {
    HAND = P.place(P.plate('hand'), { cx: 540, cy: 1180, h: 3000, n: N });
    CLOCK = P.place(P.plate('clock'), { cx: 540, cy: 1150, h: 2600, n: N });
    PERSON = P.place(P.plate('person'), { cx: 540, cy: 1170, h: 2700, n: N });
  };

  // ---------------------------------------------------------------- 1 · hook
  // Centre of the question bubble in world units (the screen is tilted with the plate).
  const bubbleAt = () => { const s = HAND.screen; const k = s.w / 740; const lx = (300 - 370) * k, ly = (370 - s.h / k / 2) * k; return [s.cx + lx * Math.cos(s.rot) - ly * Math.sin(s.rot), s.cy + lx * Math.sin(s.rot) + ly * Math.cos(s.rot)]; };
  function cam1(t) {
    const [bx, by] = bubbleAt();
    return camPath([[0, bx, by + 60, 1.8], [tBack0, bx, by + 50, 1.9], [tBack1, 540, 1150, 0.64], [L2.start + 0.4, 540, 1120, 0.66], [L2.end, 540, 1060, 0.72], [tMorph0 + 0.4, 540, 1100, 0.74]], t);
  }
  // The phone screen, drawn in ink inside the plate's measured (and tilted) screen.
  function screen(c, t) {
    const s = HAND.screen; const W = s.w, H = s.h; const k = W / 740;   // layout in 740-wide screen units
    c.save(); c.translate(s.cx, s.cy); c.rotate(s.rot); c.translate(-W / 2, -H / 2);
    c.beginPath(); c.roundRect(0, 0, W, H, 70 * k); c.clip();
    c.fillStyle = 'rgba(255,253,248,0.97)'; c.fillRect(0, 0, W, H);
    c.scale(k, k);
    // Header: who is writing.
    ink.sketch(c, ink.ellipsePts(92, 150, 42, 42, 0, 40), { width: 3, t, seed: 41, closed: true, boil: 0.8, passes: 1, color: env.world.inkHex });
    c.fillStyle = env.world.inkHex; c.font = env.brand.font(700, 34, 'display'); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(COPY.contact[0], 92, 152);
    c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.font = env.brand.font(600, 40, 'body'); c.fillText(COPY.contact, 156, 146);
    c.font = env.brand.font(400, 26, 'mono'); c.fillStyle = 'rgba(29,26,22,0.55)'; c.fillText(t >= tType0 && t < L2.start - 0.2 ? 'typing…' : 'online', 156, 182);
    ink.sketch(c, [[0, 232], [740, 232]], { width: 1.6, t, seed: 42, passes: 1, alpha: 0.5, color: env.world.inkHex });
    // The question: the bubble draws itself on and the text types in.
    bubbles.drawBubble(c, { x: 40, y: 300, text: COPY.question, side: 'in', tone: 'ink', appear: clamp((t + 0.2) / 0.4), typed: clamp(t / 0.6) * COPY.question.length, time: '9:41', size: 44, maxW: 560, seed: 7 }, t);
    // Typing dots, then the customer's voice note (its waveform follows the line's real loudness).
    if (t > tType0 && t < L2.start - 0.15) bubbles.drawTyping(c, 70, 560, t, { color: env.world.inkHex });
    voicenote.drawVoiceNote(c, { x: 40, y: 520, w: 650, h: 132, line: L2, t, side: 'in', tone: 'paper', initials: COPY.contact[0], appear: clamp((t - (L2.start - 0.2)) / 0.3), seed: 13 });
    c.restore();
  }
  // The asks pile up: small bubbles fly out of the phone on threads during the customer's line.
  // [x, y] where each ask settles and [x, y] off-frame where its thread comes from (world units).
  const SLOTS = [[110, 1060, -420, 960], [950, 450, 1500, 330], [120, 1360, -420, 1460], [960, 1270, 1500, 1390]];
  function chorus(c, t) {
    const s = HAND.screen; const from = [s.cx, s.y0 + 120];
    COPY.chorus.forEach((q, k) => {
      const t0 = along('L02', 0.15 + k * 0.2); if (t < t0) return;
      const [sx, sy, ex, ey] = SLOTS[k % SLOTS.length];
      // They fly out of frame just before the morph (each a little later than the previous one).
      const fly = ease.outBack(clamp((t - t0) / 0.45), 1.4), away = ease.inCubic(clamp((t - (tMorph0 - 0.6) - k * 0.05) / 0.4));
      if (away >= 1) return;
      const x = lerp(lerp(from[0], sx, fly), ex, away), y = lerp(lerp(from[1], sy, fly), ey, away) - clamp((t - t0) / 6) * 50;
      const Lb = bubbles.layout(c, q, { size: 50, maxW: 520, weight: 600 });
      fx.inkThread(c, [ex, ey], [x + (ex < x ? -Lb.w / 2 : Lb.w / 2), y + 40], { t, seed: 100 + k, width: 2.4, alpha: 0.7 * (1 - away), slack: 0.2 + away * 0.4, progress: clamp((t - t0) / 0.35), color: env.world.inkHex });
      bubbles.drawBubble(c, { x: x - Lb.w / 2 - 28, y, text: q, side: k % 2 ? 'out' : 'in', tone: 'ink', wash: `rgba(${env.world.paperBase.join(',')},0.95)`, appear: clamp((t - t0) / 0.3), size: 50, maxW: 520, weight: 600, seed: 110 + k, L: Lb, alpha: 1 - away }, t);
    });
  }
  const hook = {
    name: 'hook', start: 0, end: tMorph0 + 0.02,
    draw(f, t) {
      f.cam = cam1(t);
      env.paper(f, t);
      // The hand engraves itself as the camera pulls back (darkest dots first); thinner while very close.
      const appear = clamp((t - (tBack0 - 0.4)) / 1.6);
      const thin = smoothstep(1.9, 1.1, f.cam.z) * 0.8 + 0.2;
      P.drawSet(f, HAND, { appear, alpha: thin, r0: 0.85, r1: 2.3, seed: 2 });
      f.flushInk();
      f.withLayer((c) => P.drawContours(c, HAND, { t, progress: clamp((t - tBack0) / 1.4), alpha: 0.7, width: 2.6, seed: 3 }), { tooth: 0.3 });
      f.withLayer((c) => { screen(c, t); chorus(c, t); }, { tooth: 0.15 });
      if (Frame.camSpeed(cam1, t) > 900) f.autoMotionBlur(cam1, t, 0.5, 120);
    },
  };

  // ---------------------------------------------------------------- 2 · cost
  const dial = () => CLOCK.dial;
  // Minutes on the clock: still while the morph lands, then jumping five at a time up to the stamp.
  function minutes(t) {
    const steps = COPY.clockLost / 5; const a = tMorph1 - 0.1, b = Math.max(a + 0.6, tStamp - 0.15);
    const k = clamp((t - a) / (b - a)) * steps; const i = Math.floor(k), fr = k - i;
    return Math.min(COPY.clockLost, (i + (k >= steps ? 0 : ease.outBack(clamp(fr / 0.35), 2.5))) * 5);
  }
  function cam2(t) {
    const a = cam1(tMorph0), d = dial();
    return camPath([[tMorph0, a.x, a.y, a.z], [tMorph1, 540, d.cy - 10, 0.86], [tStamp, 540, d.cy + 10, 0.92], [tFlood1, 540, d.cy + 40, 0.9]], t);
  }
  function hands(c, t) {
    const d = dial(); const m = COPY.clockFrom + minutes(t);
    const ma = ((m % 60) / 60) * TAU - Math.PI / 2, ha = (((m / 60) % 12) / 12) * TAU - Math.PI / 2;
    // The lost time, washed in the accent.
    const lost = minutes(t); if (lost > 0) {
      const a0 = -Math.PI / 2 + ((COPY.clockFrom % 60) / 60) * TAU;
      c.save(); c.globalAlpha *= 0.85; c.fillStyle = `rgba(${env.world.accent.map((v) => Math.round(v * 255)).join(',')},0.22)`;
      c.beginPath(); c.moveTo(d.cx, d.cy); c.arc(d.cx, d.cy, d.r * 0.92, a0, a0 + (lost / 60) * TAU); c.closePath(); c.fill(); c.restore();
    }
    ink.sketch(c, [[d.cx - Math.cos(ha) * 30, d.cy - Math.sin(ha) * 30], [d.cx + Math.cos(ha) * d.r * 0.5, d.cy + Math.sin(ha) * d.r * 0.5]], { width: 16, t, seed: 77, boil: 0.9, passes: 2, taper: 0.25, color: env.world.inkHex });
    ink.sketch(c, [[d.cx - Math.cos(ma) * 40, d.cy - Math.sin(ma) * 40], [d.cx + Math.cos(ma) * d.r * 0.82, d.cy + Math.sin(ma) * d.r * 0.82]], { width: 9, t, seed: 78, boil: 0.9, passes: 2, taper: 0.2, color: env.world.inkHex });
    c.fillStyle = env.world.inkHex; c.beginPath(); c.arc(d.cx, d.cy, 14, 0, TAU); c.fill();
  }
  const cost = {
    name: 'cost', start: tMorph0, end: tFlood1,
    draw(f, t) {
      f.cam = cam2(t);
      // A short shake when the stamp lands.
      const sh = cam.shake(t, tStamp, 14 / f.cam.z); f.cam.x += sh.x; f.cam.y += sh.y;
      env.paper(f, t);
      const m = clamp((t - tMorph0) / (tMorph1 - tMorph0));
      if (m < 1) P.drawMorph(f, HAND, CLOCK, m, { r0: 0.85, r1: 2.3, swirl: 90 });
      else P.drawSet(f, CLOCK, { r0: 0.85, r1: 2.3, seed: 5 });
      f.flushInk();
      // The phone's screen and the hand's pencil lines fade as its dots leave (no pop at the hand-off).
      const leave = 1 - smoothstep(tMorph0, tMorph0 + 0.4, t);
      if (leave > 0) {
        f.withLayer((c) => P.drawContours(c, HAND, { t, progress: 1, alpha: 0.7 * leave, width: 2.6, seed: 3 }), { tooth: 0.3 });
        f.withLayer((c) => screen(c, t), { tooth: 0.15, alpha: leave });
      }
      const handsIn = smoothstep(tMorph1 - 0.3, tMorph1 + 0.2, t);
      f.withLayer((c) => {
        P.drawContours(c, CLOCK, { t, progress: clamp((t - tMorph1 + 0.4) / 0.9), alpha: 0.6, width: 2.4, seed: 9, max: 30 });
        c.globalAlpha = handsIn; hands(c, t);
      }, { tooth: 0.3 });
      // The verdict stamp (accent-red ink, eroded by the paper tooth).
      f.withLayer((c) => fx.stamp(c, t, tStamp, { x: dial().cx + 150, y: dial().cy + dial().r * 0.62, rot: -0.16, scale: 0.95, label: COPY.verdict, color: env.world.redHex, family: env.brand.fonts.display }), { tooth: 0.5 });
      // Night falls: black ink floods the page from the top (screen space).
      const fl = clamp((t - tFlood0) / (tFlood1 - tFlood0));
      if (fl > 0) { f.setScreen(f.ctx); fx.flood(f.ctx, fl, t, { W: f.W, H: f.H }); }
    },
  };

  // ---------------------------------------------------------------- 3 · turn (the night world)
  function cam3(t) {
    const a = cam2(tFlood1);
    return camPath([[tLights, a.x, a.y, a.z], [tPerson0, 540, 1150, 0.86], [tPerson1, 540, 1060, 0.8], [lock, 540, 1000, 0.84]], t);
  }
  const head = () => PERSON.anchors.head;
  const turn = {
    name: 'turn', start: tLights, end: lock - GATHER,
    draw(f, t) {
      f.cam = cam3(t);
      env.night(f, t); env.nightPost(); env.captionTone = 'night';
      // The same dots, re-lit: they switch on from the dial outwards, then become the person.
      const on = clamp((t - tLights) / 0.7);
      const m = clamp((t - tPerson0) / (tPerson1 - tPerson0));
      const d = dial();
      if (m <= 0) {
        const lit = (x, y) => clamp((on * 1.4 - Math.hypot(x - d.cx, y - d.cy) / 1500) / 0.4);
        P.drawSet(f, CLOCK, { mode: 'light', col: env.world.light, r0: 0.8, r1: 1.9, gain: 0.95, boil: 0.5, seed: 5,
          tint: on < 1 ? (i, x, y) => env.world.light.map((v) => v * lit(x, y)) : null });
      } else {
        P.drawMorph(f, CLOCK, PERSON, m, { mode: 'light', col: env.world.light, colB: env.world.lightWarm, r0: 0.8, r1: 2.0, swirl: 80, gainA: 0.95, gainB: 1.25, boil: 0.5 });
      }
      f.flushLight(1, 0.8);
      // Once the person has formed: a comet of light circles them (the work being done for them).
      const ca = smoothstep(tPerson1 - 0.4, tPerson1 + 0.3, t) * (1 - smoothstep(lock - GATHER - 0.5, lock - GATHER - 0.05, t));
      if (ca > 0) {
        const [hx, hy] = head();
        fx.comet(f, (tt) => { const a = (tt - tPerson1) * 2.4; return [hx + Math.cos(a) * 330, hy + 60 + Math.sin(a) * 120]; }, t, { alpha: ca, width: 6, head: 30, color: env.world.lightWarm });
        f.flushLight(1, 1);
      }
    },
  };

  return {
    plates: {
      hand: { src: 'procedural:hand-phone', N: 30000, gamma: 1.1, edge: 0.8, floor: 0.03, screen: true },
      clock: { src: 'procedural:clock', N: 30000, gamma: 1.05, edge: 1.0, floor: 0.03 },
      person: { src: 'procedural:person', N: 30000, gamma: 1.3, edge: 1.0, floor: 0.04 },
    },
    setup,
    acts: [hook, cost, turn],
    // Captions sit low while the camera is close on the phone (its header is at the top), then at the top (y 290).
    captions: { y: (t) => (t < tBack1 - 0.2 ? 1180 : 290), maxWords: 4 },
    endCard: { lock, gather: GATHER, world: 'night', N: 7000, markY: 760, markSize: 380, wordY: 1035, wordH: 116,
      // Where the dots come from, and how they looked there (so the hand-over is seamless).
      source: (t) => ({ from: PERSON, fromCam: cam3(Math.min(t, lock - GATHER)), inkCol: env.world.lightWarm, style: { r0: 0.8, r1: 2.0, gain: 1.25 } }) },
    posterTime: along('L02', 0.85),
    events: [
      { t: Math.max(0, L1.start - 0.1), name: 'pop', gain_db: -12 },
      { t: tBack0, name: 'whoosh', gain_db: -18 },
      { t: tType0, name: 'typing', gain_db: -18 },
      { t: L2.start - 0.2, name: 'ding', gain_db: -14 },
      ...COPY.chorus.map((_, k) => ({ t: along('L02', 0.15 + k * 0.2), name: 'pop', gain_db: -19 })),
      { t: tMorph0, name: 'swoosh', gain_db: -14 },
      ...Array.from({ length: COPY.clockLost / 5 }, (_, i) => ({ t: tMorph1 - 0.1 + (i + 0.5) * (tStamp - 0.15 - tMorph1 + 0.1) / (COPY.clockLost / 5), name: 'tick', gain_db: -18 })),
      { t: tStamp - 0.02, name: 'hit', gain_db: -10 },
      { t: tFlood0, name: 'whoosh', gain_db: -16 },
      { t: tLights, name: 'ding', gain_db: -16 },
      { t: tPerson0, name: 'swoosh', gain_db: -16 },
      { t: lock - GATHER, name: 'riser', gain_db: -14 },
      { t: lock - 0.05, name: 'logo', gain_db: -8 },
    ],
  };
});
