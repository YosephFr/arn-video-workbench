'use strict';
// Sample tutorial: "Turn on booking reminders", on the demo app in ../mock-app, captured with `npm run capture`
// (captures/reminders/NN-name.png + .json). Every cue hangs from a word of the voice, so a new recording re-times the
// whole film; every box comes from a measured element, so a redesigned app only needs a new capture.
//
// Pattern for each step: the camera pushes in on the control the voice names (focus), a ring draws around it on
// that word, the finger taps on the action word, and the next capture arrives with the app's own transition.
// When the voice talks about the other side ("your customer gets"), the phone changes owner: a screen drawn in code
// and a new label above the phone.
const CAP = {
  home: 'reminders/01-home', homePressed: 'reminders/02-home-pressed',
  settings: 'reminders/03-settings', settingsPressed: 'reminders/04-settings-pressed',
  off: 'reminders/05-reminders', on: 'reminders/06-switch-on', hour: 'reminders/07-one-hour',
  savePressed: 'reminders/08-save-pressed', saved: 'reminders/09-saved', after: 'reminders/10-settings-on',
};
const APP = 'Your app', CUSTOMER = 'Your customer\'s phone';   // whose screen this is, above the phone
const MESSAGE = 'Hi Riley, see you at 10:00 today at Acme Café. Reply to change your booking.';

// A lock screen with the reminder arriving, drawn in device px (393 × 852). Replace it with a capture of the real
// message when you have one.
const lockScreen = (c, t, w, h, api) => {
  const { brand, font, rr, ease, clamp } = api;
  const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#262a36'); g.addColorStop(1, '#3d4456'); c.fillStyle = g; c.fillRect(0, 0, w, h);
  c.fillStyle = '#ffffff'; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  c.font = font(600, 19, 'body'); c.globalAlpha = 0.85; c.fillText('Friday, March 6', w / 2, 118); c.globalAlpha = 1;
  c.font = font(700, 86); c.fillText('9:41', w / 2, 206);
  const k = ease.outBack(clamp((api.lt - 0.35) / 0.5), 1.3); if (k <= 0) return;   // the notification slides in
  const y = 258 - (1 - k) * 60; c.globalAlpha = clamp(k * 3);
  c.fillStyle = 'rgba(255,255,255,0.9)'; rr(c, 12, y, w - 24, 104, 24); c.fill();
  if (brand.images.mark) c.drawImage(brand.images.mark, 26, y + 16, 38, 38);
  c.textAlign = 'left'; c.fillStyle = '#16171a'; c.font = font(600, 15, 'body'); c.fillText('Acme Café', 76, y + 31);
  c.textAlign = 'right'; c.fillStyle = '#6a6c72'; c.font = font(500, 13, 'body'); c.fillText('now', w - 30, y + 31);
  c.textAlign = 'left'; c.fillStyle = '#16171a'; c.font = font(400, 15, 'body');
  const words = MESSAGE.split(' '); const rows = []; let cur = '';
  for (const wd of words) { const nx = cur ? cur + ' ' + wd : wd; if (c.measureText(nx).width > w - 24 - 64 - 20 && cur) { rows.push(cur); cur = wd; } else cur = nx; }
  rows.push(cur); rows.slice(0, 3).forEach((r, i) => c.fillText(r, 76, y + 54 + i * 20)); c.globalAlpha = 1;
};

module.exports = ({ W, L, focus }) => {
  const w = (id, word, n = 0) => W(id, word, n).start;
  // L01 · hook: the bookings that will get a reminder
  const tBooking = w('L01', 'booking') - 0.15;
  // L02 · Settings
  const tSettings = w('L02', 'Settings') - 0.05, tTapSettings = L('L02').end + 0.05, tSettingsShot = tTapSettings + 0.25;
  // L03 · Reminders, switch on
  const tTapWord = w('L03', 'Tap') - 0.05, tTapReminders = w('L03', 'Reminders') + 0.15, tRemindersShot = tTapReminders + 0.25, tSwitch = w('L03', 'on') + 0.05;
  // L04 · choose when
  const tWhen = w('L04', 'when') - 0.1, tHour = w('L04', 'one') + 0.05;
  // L05 · what the customer gets
  const tCustomer = L('L05').start - 0.1;
  // L06 · back in the app: Save
  const tBackToApp = L('L06').start - 0.15, tSaveWord = w('L06', 'Tap') - 0.1, tSave = w('L06', 'Save') + 0.1;
  // L07 · confirmed, then back in Settings: Reminders is On
  const tDone = L('L07').start - 0.1, tBack = w('L07', 'every') - 0.1, tEvery = w('L07', 'booking') - 0.15;

  return {
    captions: { y: 372 },
    card: { lock: L('L08').start + 0.9 },
    shots: [
      { at: 0, cap: CAP.home, chip: APP },
      { at: tTapSettings + 0.02, cap: CAP.homePressed, chip: APP, trans: 'cut' },
      { at: tSettingsShot, cap: CAP.settings, chip: APP, trans: 'fade', dur: 0.25 },    // a tab switch fades
      { at: tTapReminders + 0.02, cap: CAP.settingsPressed, chip: APP, trans: 'cut' },
      { at: tRemindersShot, cap: CAP.off, chip: APP, trans: 'push' },                 // a new page pushes in
      { at: tSwitch + 0.1, cap: CAP.on, chip: APP, trans: 'cut' },
      { at: tHour + 0.1, cap: CAP.hour, chip: APP, trans: 'cut' },
      { at: tCustomer, draw: lockScreen, dark: true, chip: CUSTOMER, trans: 'fade', dur: 0.35 },
      { at: tBackToApp, cap: CAP.hour, chip: APP, trans: 'fade', dur: 0.3 },
      { at: tSave + 0.02, cap: CAP.savePressed, chip: APP, trans: 'cut' },
      { at: tSave + 0.3, cap: CAP.saved, chip: APP, trans: 'cut' },
      { at: tBack, cap: CAP.after, chip: APP, trans: 'back' },
    ],
    phone: [
      { t: 0 },
      focus(CAP.home, '@next', { t: tBooking + 0.1, until: L('L01').end + 0.15, z: 1.25, y: 960 }),
      focus(CAP.home, '@settings', { t: tSettings + 0.1, until: tSettingsShot + 0.1, z: 1.55, y: 1080, dur: 0.55 }),
      focus(CAP.settings, '@reminders', { t: tTapWord + 0.15, until: tRemindersShot, z: 1.5, y: 960, dur: 0.45 }),
      { t: tRemindersShot + 0.55, dur: 0.5 },
      focus(CAP.off, { q: 'Booking reminders', box: true }, { t: tSwitch - 0.1, until: tSwitch + 0.7, z: 1.4, y: 930, dur: 0.5 }),
      focus(CAP.on, '@when', { t: tWhen + 0.1, until: tHour + 0.6, z: 1.4, y: 960, dur: 0.45 }),
      { t: tCustomer + 0.1, dur: 0.45 },
      // a drawn screen has no measured elements: aim the camera with device px (fx, fy) directly
      { t: tCustomer + 1.1, dur: 0.55, z: 1.55, fx: 196, fy: 310, tx: 540, ty: 860 },
      { t: L('L05').end + 0.1, z: 1.55, fx: 196, fy: 310, tx: 540, ty: 860 },
      { t: tBackToApp + 0.1, dur: 0.4 },
      focus(CAP.hour, '@save', { t: tSaveWord + 0.1, until: tSave + 0.6, z: 1.45, y: 1060, dur: 0.45 }),
      focus(CAP.saved, '@saved', { t: tDone + 0.35, until: tBack - 0.05, z: 1.45, y: 900, dur: 0.45 }),
      { t: tBack + 0.35, dur: 0.4 },
      focus(CAP.after, '@reminders', { t: tEvery + 0.1, until: L('L08').start + 0.3, z: 1.4, y: 960, dur: 0.5 }),
    ],
    marks: [
      { at: tBooking, to: L('L01').end + 0.05, el: { q: 'Riley', box: true }, shot: 0 },   // box: the card that contains the text
      { at: tSettings, to: tTapSettings + 0.02, el: '@settings', shot: 0, r: 18 },
      { at: tTapWord, to: tTapReminders + 0.02, el: '@reminders', shot: 2 },
      { at: tWhen, to: tHour + 0.05, el: '@when', shot: 5, pad: 8 },
      { at: tSaveWord, to: tSave + 0.02, el: '@save', shot: 8 },
      { at: tDone + 0.3, to: tBack - 0.1, el: '@saved', shot: 10, pad: 8 },
      { at: tEvery, to: L('L08').start + 0.2, el: '@reminders', shot: 11 },
    ],
    taps: [
      { at: tTapSettings, el: '@settings', shot: 0 },
      { at: tTapReminders, el: '@reminders', shot: 2 },
      { at: tSwitch, el: '@switch', shot: 4 },
      { at: tHour, el: '1 hour before', shot: 5 },
      { at: tSave, el: '@save', shot: 8 },
    ],
    events: [
      { t: tCustomer + 0.45, name: 'ding', gain_db: -24 },   // the reminder arrives
      { t: tSave + 0.35, name: 'pop', gain_db: -28 },        // the app confirms
      { t: tBack, name: 'whoosh', gain_db: -30 },
    ],
  };
};
