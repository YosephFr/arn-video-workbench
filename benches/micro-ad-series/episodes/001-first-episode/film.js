'use strict';
// 001 · First episode: the EMPTY guiding sample of the series (format MORPH, paper world, ~15 s).
// Hook → message → proof → end card, one idea, one visual punch:
//   A  hook     a clock engraves itself in dots and its hands race (the problem, in three words)
//   B  message  the clock's dots swirl into a light bulb (the change), with a burst when it lands
//   C  proof    a phone: the customer's voice note arrives with its transcript, then a confirmation
//   card        paper rises, the dots gather into the logo, the offer from script.json "card"
// Big kinetic text (autoText) carries the narrator's words; the voice note shows its own transcript, so its
// line has "caption": false in script.json. Every time comes from the voice (L, Hot, along).

// The renderer sets WB_ENGINE to this bench's engine folder, so an episode works wherever it lives.
const { defineEpisode } = require(`${process.env.WB_ENGINE}/kit`);

// On-screen props (never spoken). Slots: replace with your product's real situation.
const COPY = {
  contact: 'Sam Rivera',                     // Slot: who sends the voice note
  confirm: 'Done',                           // Slot: the confirmation the product shows
  confirmLines: ['Friday, 6:00 pm', 'Booked by Acme'],   // Slot: what was confirmed (use your real screen)
};

module.exports = defineEpisode(__dirname, ({ L, Hot, along, T, sfx, ui }) => {
  const L1 = L('L01'), L2 = L('L02'), L3 = L('L03');
  const tB = L2.start - 0.15, tC = L2.end + 0.28;            // scene changes (C waits for the headline to clear)
  const XF = 0.4;                                            // B and C overlap: the bulb blows away as the phone rises
  const tMorph = tB + 0.05, dMorph = 1.1;                    // clock → bulb
  const lock = T.lastEnd + 1.6;                              // the logo completes 1.6 s after the last word
  const PLACE = { cx: 540, cy: 1180, h: 1500, n: 24000 };    // morph pairs share placement and dot count

  // The clock's hands race through the hook (ink strokes over the stippled dial).
  const hands = (u, alpha = 1) => {
    const S = u.placed('clock', PLACE); const d = S.dial; if (!d) return;
    const m = 600 + u.ease.inOutCubic(u.clamp((u.t - 0.2) / (tB - 0.2))) * 180;   // minutes since midnight
    const ma = ((m % 60) / 60) * u.TAU - Math.PI / 2, ha = (((m / 60) % 12) / 12) * u.TAU - Math.PI / 2;
    u.f.withLayer((c) => {
      c.globalAlpha = alpha;
      u.sketch(c, [[d.cx, d.cy], [d.cx + Math.cos(ha) * d.r * 0.5, d.cy + Math.sin(ha) * d.r * 0.5]], { width: 16, t: u.t, seed: 7, boil: 0.9, passes: 2, taper: 0.25, color: u.world.text });
      u.sketch(c, [[d.cx, d.cy], [d.cx + Math.cos(ma) * d.r * 0.82, d.cy + Math.sin(ma) * d.r * 0.82]], { width: 9, t: u.t, seed: 8, boil: 0.9, passes: 2, taper: 0.2, color: u.world.text });
    });
  };

  return {
    world: 'paper',
    plates: ['clock', 'bulb'],
    captions: false,
    autoText: { y: 360 },
    card: { lock },
    posterTime: Hot('L01').end + 0.45,
    scenes: [
      // A · hook: the clock engraves itself (darkest dots first) and its hands race.
      { at: 0, to: tMorph + 0.02, draw(u) {
        u.paper();
        u.cam({ y: 1000 + 30 * (1 - u.p(0, 2.5, 'outCubic')), z: 1.0 + 0.04 * u.p(0, tB, 'linear') });
        u.plate('clock', { ...PLACE, appear: u.p(-0.1, 0.9, 'linear'), seed: 3 });
        u.outline('clock', { ...PLACE, progress: u.p(0.4, 1.0), alpha: 0.6 });
        hands(u, u.p(0.3, 0.4));
      } },
      // B · message: the clock's dots become the bulb; a burst of ink when it lands.
      { at: tMorph, to: tC + XF, draw(u) {
        u.paper();
        u.cam({ y: 1000 + 20 * u.p(0, 2, 'inOutCubic'), z: 1.04 });
        const m = u.clamp(u.lt / dMorph);
        if (m < 1) u.morph('clock', 'bulb', m, { ...PLACE, swirl: 90 });
        else u.plate('bulb', { ...PLACE, fade: u.clamp((u.t - tC) / XF), wind: 1.3, seed: 4 });
        hands(u, 1 - u.p(0, 0.25, 'linear'));
        u.burst({ x: 540, y: 1050, at: dMorph - 0.05, dur: 0.8, n: 140, speed: 420 });
        if (m >= 1) u.outline('bulb', { ...PLACE, progress: u.p(dMorph, 0.7), alpha: 0.55 * (1 - u.clamp((u.t - tC) / 0.2)) });
      } },
      // C · proof: the customer's voice note arrives in a phone, then the confirmation.
      { at: tC, to: 'card', draw(u) {
        if (u.lt >= XF) u.paper();   // during the overlap, scene B's paper (and its last dots) stay underneath
        // The phone rises in, then the camera pushes in so the transcript can be read on a phone.
        const k = u.p(0, 0.45, 'outBack');
        u.cam({ x: 540, y: 1000 + 40 * u.p(0.3, 1.2, 'inOutCubic'), z: 1 + 0.38 * u.p(0.3, 1.2, 'inOutCubic') });
        u.phone((c, t, h) => ui.drawChat(c, t, { h, contact: COPY.contact, valign: 'center', items: [
          { type: 'voice', side: 'in', line: L3, t0: L3.start - 0.25, initials: 'SR' },
          { type: 'card', title: COPY.confirm, lines: COPY.confirmLines, t0: along('L03', 0.7) },
        ], typing: [[tC + 0.1, L3.start - 0.25]] }), { x: 540, y: 1040 + (1 - k) * 260, w: 560, alpha: u.p(0, 0.12) });
      } },
    ],
    events: [
      sfx(0.05, 'pop', -16),
      ...[0.6, 1.0, 1.4, 1.8, 2.2].filter((x) => x < tB - 0.2).map((x) => sfx(x, 'tick', -20)),
      sfx(Hot('L01').start, 'hit', -16),
      sfx(tMorph, 'swoosh', -16),
      sfx(tMorph + dMorph - 0.05, 'pop', -14),
      sfx(tC, 'whoosh', -20),
      sfx(L3.start - 0.25, 'ding', -18),
      sfx(along('L03', 0.7), 'coin', -16),
    ],
  };
});
