'use strict';
// Sample explainer: how one shift's pay adds up, for Sam, a barista at Acme Café (a made-up case with round,
// illustrative numbers). Three cards, each living while the voice explains it, then the app screen with the same
// numbers (captured from the demo app: `npm run capture`), then the end card.
//
// The rules of the method:
//   - every row and every amount appears on the word that names it, and the amount counts up;
//   - a row the voice asks about first shows "?", and resolves when the voice gives the answer;
//   - each card stays alive while it is on screen (ledger.live: a slow push and a gentle float): on a phone, a still
//     frame reads as frozen;
//   - the figures on the cards reappear on the real screen at the end, so "it adds up" is something you see.
const SHIFT = 'shift/01-shift';
const RULES = ['Share 30%', 'Tips 90%', 'Tax 10%', 'Withholding 10%'];
const Y_RULES = 466, Y_CARD = 560;

module.exports = ({ W, L, focus, ease, clamp, ledger, C }) => {
  const w = (id, word, n = 0) => W(id, word, n).start;
  const ap = (t, t0, d = 0.35) => ease.outCubic(clamp((t - t0) / d));       // enters
  const away = (t, t0, d = 0.3) => 1 - ease.inCubic(clamp((t - t0) / d));   // leaves
  const run = (t, t0, d = 0.8) => clamp((t - t0) / d);                     // an amount counting up
  // times, all from the voice
  const tQuestion = w('L01', 'How') - 0.05, tRules = w('L01', 'these') - 0.05;
  const tSales = w('L02', 'four') - 0.1, tTax = w('L02', 'Tax') - 0.05, tLeaves = w('L02', 'four', 1) - 0.1;
  const tThirty = w('L03', 'thirty') - 0.1, tShare = w('L03', 'one') - 0.1;
  const tTips = L('L04').start - 0.35, tFifty = w('L04', 'fifty') - 0.1, tNinety = w('L04', 'ninety') - 0.1, tForty = w('L04', 'forty') - 0.1;
  const tLedger = L('L05').start - 0.35, tWithholding = w('L05', 'Withholding') - 0.05, tOfShare = w('L05', 'share') - 0.1, tNot = w('L05', 'not') - 0.05, tTwelve = w('L05', 'twelve') - 0.1;
  const tTotal = w('L06', 'one') - 0.1;
  const tApp = L('L07').start - 0.45, tSame = w('L07', 'same') - 0.1, tShareApp = w('L07', 'share') - 0.1, tTipsApp = w('L07', 'tips') - 0.1, tWithApp = w('L07', 'withholding') - 0.1, tTotalApp = w('L07', 'total') - 0.1;
  const tEnd = L('L08').start;

  // A: sales → tax → before tax → Sam's share, with the split bar.
  function sales(ctx, t) {
    const a = ap(t, -0.25, 0.4) * away(t, tTips, 0.35); if (a <= 0) return; const dy = -(1 - away(t, tTips, 0.35)) * 40;
    const o = {
      y: Y_CARD + dy, a, title: 'Sam\'s shift', sub: 'Barista · sales with tax included', amount: t < tSales ? '' : 440, amountCount: run(t, tSales),
      rows: [
        { t: 'Tax 10%', sub: 'included in the price: it comes off first', m: -40, kind: 'neg', a: ap(t, tTax), count: run(t, tTax + 0.1, 0.5) },
        { t: 'Before tax', m: 400, a: ap(t, tLeaves), count: run(t, tLeaves) },
        t < tShare ? { t: 'Sam\'s share', m: '?', kind: 'muted', a: ap(t, tQuestion) } : { t: 'Sam\'s share', sub: '30% of sales before tax', m: 120, a: ap(t, tShare), count: run(t, tShare) },
      ],
    };
    const h = ledger.card(ctx, o);
    const k = ap(t, tThirty, 0.8);
    if (k > 0) ledger.bar(ctx, { y: Y_CARD + dy + h + 34, k, a, parts: [{ v: 40, color: ledger.colors.neutral, t: 'Tax', m: 40 }, { v: 120, color: C.accent, t: 'Sam', m: 120 }, { v: 240, color: ledger.colors.accentMid, t: 'Café', m: 240 }] });
  }

  // B: the tips and how they are shared.
  function tips(ctx, t) {
    const a = ap(t, tTips + 0.15, 0.4) * away(t, tLedger, 0.35); if (a <= 0) return; const dy = (1 - ap(t, tTips + 0.15, 0.4)) * 40 - (1 - away(t, tLedger, 0.35)) * 40;
    const o = {
      y: Y_CARD + dy, a, title: 'Tips', sub: 'Shared between Sam and the café', amount: t < tFifty ? '' : 50, amountCount: run(t, tFifty),
      rows: [
        { t: 'Sam keeps 90%', m: t < tForty ? '?' : 45, a: ap(t, tNinety), count: run(t, tForty) },
        { t: 'The café keeps 10%', m: 5, kind: 'muted', a: ap(t, tForty + 0.45) },
      ],
    };
    const h = ledger.card(ctx, o);
    const k = ap(t, tNinety, 0.8);
    if (k > 0) ledger.bar(ctx, { y: Y_CARD + dy + h + 34, k, a, parts: [{ v: 45, color: C.accent, t: 'Sam', m: 45 }, { v: 5, color: ledger.colors.accentMid, t: 'Café', m: 5 }] });
  }

  // C: the running ledger and the total.
  function earned(ctx, t) {
    const a = ap(t, tLedger + 0.15, 0.4) * away(t, tApp - 0.12, 0.28); if (a <= 0) return; const dy = (1 - ap(t, tLedger + 0.15, 0.4)) * 40;
    const o = {
      y: Y_CARD + dy, a, title: 'Sam earned', sub: 'This shift',
      rows: [
        { t: 'Sam\'s share', sub: '30% of $400', m: 120, sign: true, a: ap(t, tLedger + 0.3) },
        { t: 'Tips', sub: '90% of $50', m: 45, sign: true, a: ap(t, tLedger + 0.45) },
        { t: 'Withholding', sub: t < tNot ? '10% of the share' : '10% of the share, not of the tips', m: t < tTwelve ? '?' : -12, kind: 'neg', a: ap(t, tWithholding), count: run(t, tTwelve, 0.5) },
        { t: 'Sam earned', m: 153, kind: 'total', a: ap(t, tTotal), count: run(t, tTotal, 1.0) },
      ],
    };
    ledger.card(ctx, o);
    ledger.ringRow(ctx, o, 0, ap(t, tOfShare, 0.45), a * away(t, tNot + 0.7, 0.3));   // the base of the withholding
    ledger.ringRow(ctx, o, 3, ap(t, tTotal + 0.5, 0.5), a);
  }

  return {
    captions: {
      y: 372,
      replace: {   // spoken numbers become figures in the captions
        'four hundred forty dollars': '$440', 'four hundred': '$400', 'thirty percent': '30%', 'one hundred twenty': '$120',
        'fifty dollars': '$50', 'ninety percent': '90%', 'forty-five': '$45', 'ten percent': '10%', 'twelve': '$12',
        'one hundred fifty-three dollars': '$153',
      },
    },
    card: { lock: tEnd + 0.9 },
    shots: [{ at: tApp, cap: SHIFT, chip: 'Your app' }],
    phone: [
      { t: 0, alpha: 0, top: 640 }, { t: tApp + 0.12, alpha: 0, top: 640 }, { t: tApp + 0.6, alpha: 1, top: 548, dur: 0.45 },
      focus(SHIFT, '@ledger', { t: tSame + 0.2, until: tEnd + 0.3, z: 1.15, y: 880, dur: 0.6 }),
    ],
    marks: [
      { at: tSame, to: tShareApp - 0.1, el: '@ledger', r: 22, pad: 4 },
      { at: tShareApp, to: tTipsApp - 0.05, el: '@share' },
      { at: tTipsApp, to: tWithApp - 0.05, el: '@tips' },
      { at: tWithApp, to: tTotalApp - 0.05, el: '@withholding' },
      { at: tTotalApp, to: tEnd + 0.2, el: '@total' },
    ],
    over: [{
      at: 0, to: tApp + 0.5, draw: (u) => {
        const { ctx, t } = u;
        ledger.chipRow(ctx, { y: Y_RULES, items: RULES, at: tRules, t, size: 26, a: away(t, tApp - 0.12, 0.28) });
        // each card stays alive while it is on screen (a slow push, a gentle float and a drift that turns the other way
        // on the middle card)
        ledger.live(ctx, t, 0, sales); ledger.live(ctx, t, tTips, tips, { turn: -1 }); ledger.live(ctx, t, tLedger, earned);
      },
    }],
    events: [
      { t: tSales, name: 'tick', gain_db: -26 }, { t: tShare, name: 'tick', gain_db: -26 }, { t: tForty, name: 'tick', gain_db: -26 },
      { t: tTotal, name: 'coin', gain_db: -22 }, { t: tApp, name: 'whoosh', gain_db: -28 },
    ],
  };
};
