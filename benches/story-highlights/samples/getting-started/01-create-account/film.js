'use strict';
// Story 1 of 3 · Create your account. A web page this time (mode 'browser': the film draws the address bar).
// It ends on the first setup screen, which is exactly where story 2 opens (pack.carry()).
const C = 'onboarding/';
const URL_BAR = { x: 14, y: 774, w: 365, h: 50 };   // the address bar the kit draws, in device px
const WEB = { mode: 'browser', url: 'yourbrand.example', chip: 'Your phone' };

module.exports = ({ W, L, focus }) => {
  const w = (id, word, n = 0) => W(id, word, n).start;
  const tUrl = w('S2', 'yourbrand') - 0.1;
  const tName = w('S3', 'name') - 0.25, tEmail = w('S3', 'email') - 0.3, tCreate = w('S3', 'Create') + 0.05;
  return {
    shots: [
      { at: 0, cap: C + '01-welcome', ...WEB },
      { at: tName + 0.15, seq: C + '02-name.type', dt: 0.09, ...WEB, trans: 'cut' },
      { at: tName + 0.5, cap: C + '02-name', ...WEB, trans: 'cut' },
      { at: tEmail + 0.15, seq: C + '03-email.type', dt: 0.07, ...WEB, trans: 'cut' },
      { at: tEmail + 0.6, cap: C + '03-email', ...WEB, trans: 'cut' },
      { at: tCreate + 0.02, cap: C + '04-create-pressed', ...WEB, trans: 'cut' },
      { at: tCreate + 0.3, cap: C + '05-business-empty', ...WEB, trans: 'push' },
    ],
    phone: [
      { t: 0 },
      // the address bar is drawn by the kit, not captured: aim the camera at it in device px
      { t: tUrl + 0.2, dur: 0.5, z: 1.25, fx: 196, fy: 799, tx: 540, ty: 1120 },
      { t: L('S2').end + 0.2, z: 1.25, fx: 196, fy: 799, tx: 540, ty: 1120 },
      focus(C + '01-welcome', '@email', { t: tName + 0.1, until: tCreate + 0.3, z: 1.35, y: 900, dur: 0.5, mode: 'browser' }),
      { t: tCreate + 0.85, dur: 0.5 },
    ],
    marks: [
      { at: tUrl, to: L('S2').end + 0.3, el: URL_BAR, r: 25, pad: 4, shot: 0 },
      { at: tCreate - 0.35, to: tCreate + 0.02, el: '@create', shot: 4 },
    ],
    taps: [
      { at: tName, el: '@name', shot: 0 },
      { at: tEmail, el: '@email', shot: 2 },
      { at: tCreate, el: '@create', shot: 4 },
    ],
    events: [{ t: tName + 0.15, name: 'typing', gain_db: -30 }, { t: tEmail + 0.15, name: 'typing', gain_db: -30 }],
  };
};
