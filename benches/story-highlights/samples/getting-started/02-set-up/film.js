'use strict';
// Story 2 of 3 · Set up in three steps. Opens on the exact frame story 1 ended on (pack.carry()), and ends on the
// screen story 3 opens on.
const C = 'onboarding/';
const WEB = { mode: 'browser', url: 'yourbrand.example', chip: 'Your phone' };

module.exports = ({ W, L, focus, pack }) => {
  const w = (id, word, n = 0) => W(id, word, n).start;
  const start = pack.carry();
  const tType = w('S1', 'name') - 0.2, tNext1 = L('S1').end + 0.1, tDays = tNext1 + 0.3, tSat = w('S2', 'open') + 0.05, tNext2 = L('S2').end + 0.15, tReady = tNext2 + 0.3;
  return {
    shots: [
      { at: 0, ...start.shot },
      { at: tType + 0.15, seq: C + '06-business.type', dt: 0.1, ...WEB, trans: 'cut' },
      { at: tType + 0.6, cap: C + '06-business', ...WEB, trans: 'cut' },
      { at: tNext1 + 0.02, cap: C + '07-business-pressed', ...WEB, trans: 'cut' },
      { at: tDays, cap: C + '08-days', ...WEB, trans: 'push' },
      { at: tSat + 0.1, cap: C + '09-days-saturday', ...WEB, trans: 'cut' },
      { at: tNext2 + 0.02, cap: C + '10-days-pressed', ...WEB, trans: 'cut' },
      { at: tReady, cap: C + '11-ready', ...WEB, trans: 'push' },
    ],
    phone: [
      { t: 0, ...start.phone },
      focus(C + '05-business-empty', '@business', { t: tType, until: tNext1 - 0.45, z: 1.35, y: 900, dur: 0.45, mode: 'browser' }),
      // bottom buttons sit where the platforms write their caption: bring them up before the tap
      focus(C + '06-business', '@next', { t: tNext1 - 0.05, until: tDays + 0.1, z: 1.3, y: 1150, dur: 0.35, mode: 'browser' }),
      focus(C + '08-days', '@days', { t: Math.max(tDays + 0.6, w('S2', 'Pick') + 0.2), until: tNext2 - 0.45, z: 1.3, y: 900, dur: 0.5, mode: 'browser' }),
      focus(C + '09-days-saturday', '@next', { t: tNext2 - 0.05, until: tReady + 0.1, z: 1.3, y: 1150, dur: 0.35, mode: 'browser' }),
      { t: tReady + 0.5, dur: 0.45 },
    ],
    marks: [
      { at: w('S1', 'name') - 0.1, to: tNext1 - 0.45, el: '@business', shot: 1 },
      { at: w('S2', 'days') - 0.1, to: tSat + 0.05, el: '@days', shot: 4, pad: 8 },
      { at: w('S3', 'ready') - 0.15, to: L('S3').end + 0.4, el: 'Acme Café is ready for bookings.', shot: 7, pad: 8 },
    ],
    taps: [
      { at: tType, el: '@business', shot: 0 },
      { at: tNext1, el: '@next', shot: 2 },
      { at: tSat, el: 'Sat', shot: 4 },
      { at: tNext2, el: '@next', shot: 5 },
    ],
    events: [{ t: tType + 0.15, name: 'typing', gain_db: -30 }],
  };
};
