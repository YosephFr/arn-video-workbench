'use strict';
// Story 3 of 3 · You're ready. Opens where story 2 ended; the last story of the pack carries the brand close.
const C = 'onboarding/';
const WEB = { mode: 'browser', url: 'yourbrand.example', chip: 'Your phone' };

module.exports = ({ W, L, focus, pack }) => {
  const w = (id, word, n = 0) => W(id, word, n).start;
  const start = pack.carry();
  const tGo = w('S1', 'today') + 0.1, tHome = tGo + 0.3, tEvery = w('S2', 'Every') - 0.1;
  return {
    card: { lock: L('S3').start + 0.9 },
    shots: [
      { at: 0, ...start.shot },
      { at: tGo + 0.02, cap: C + '12-ready-pressed', ...WEB, trans: 'cut' },
      { at: tHome, cap: C + '13-home', ...WEB, trans: 'push' },
    ],
    phone: [
      { t: 0, ...start.phone },
      focus(C + '11-ready', '@go', { t: w('S1', 'Tap') + 0.1, until: tHome, z: 1.35, y: 1000, dur: 0.45, mode: 'browser' }),
      { t: tHome + 0.4, dur: 0.45 },
      focus(C + '13-home', '@next', { t: tEvery + 0.1, until: L('S3').start + 0.4, z: 1.25, y: 920, dur: 0.5, mode: 'browser' }),
    ],
    marks: [
      { at: w('S1', 'Go') - 0.15, to: tGo + 0.02, el: '@go', shot: 0 },
      { at: tEvery, to: L('S3').start + 0.2, el: '@next', shot: 2, pad: 8 },
    ],
    taps: [{ at: tGo, el: '@go', shot: 0 }],
  };
};
