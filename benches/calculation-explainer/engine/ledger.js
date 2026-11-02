'use strict';
// Calculation cards, drawn in the language of the app they explain: a light card on the background, titles in the
// display font, amounts in the mono font, deductions in the negative colour, the total on a tonal accent band.
// Every step of the calculation is a row that slides in when the voice names it, and its amount counts up.
// Everything lives between x 150 and 930 of the 1080 frame: clear of the platforms' button column (x ≥ 940).
const KIT = '../../app-tutorial/engine/kit/';
const { clamp, ease } = require(KIT + 'math');
const { rr } = require(KIT + 'device');
const { mix } = require(KIT + 'brand');

const X0 = 150, W0 = 780;
const c01 = (v) => Math.max(0, Math.min(1, v));

// brand: the kit brand (colours and fonts). money: { locale, currency, decimals }.
function makeLedger(brand, money = {}) {
  const C = brand.C; const font = brand.font; const MONO = 'mono';
  const fmt = new Intl.NumberFormat(money.locale || 'en-US', { style: 'currency', currency: money.currency || 'USD', minimumFractionDigits: money.decimals ?? 0, maximumFractionDigits: money.decimals ?? 0 });
  // $1,320 · −$12 · +$40 (a true minus sign; '+' only when asked)
  const fmtMoney = (n, sign = false) => (n < 0 ? '−' : sign ? '+' : '') + fmt.format(Math.abs(n));
  // An amount that counts up: k 0 → 1 over the count (eased), rounded to the currency's precision.
  const counted = (n, k) => { const d = money.decimals ?? 0; const v = n * ease.outCubic(c01(k)); return Math.round(v * 10 ** d) / 10 ** d; };
  const show = (m, k, sign) => (typeof m === 'number' ? fmtMoney(k == null ? m : counted(m, k), sign) : m);

  const rowH = (r) => (r.kind === 'total' ? 104 : r.sub ? 112 : 80) * c01(r.a ?? 1);
  // Geometry of a card without drawing it (the same numbers card() uses): its height and the y of every row.
  function measure(o) {
    const rows = o.rows || []; const headH = o.title ? (o.sub ? 142 : 112) : 0; const top = o.y + (headH ? 30 : 22) + headH + 8;
    let ry = top; const ys = rows.map((r) => { const g = { y: ry, h: rowH(r) }; ry += rowH(r); return g; });
    const rowsH = rows.reduce((s, r) => s + rowH(r), 0); const noteH = o.note ? 30 + 38 * o.note.split('\n').length : 0;
    return { h: (headH ? 30 : 22) + headH + 8 + rowsH + noteH + 26, rows: ys, x: o.x ?? X0, w: o.w ?? W0 };
  }

  // A card: { x, y, w, a, title, sub, amount, amountCount, rows: [{ t, sub, m, kind: 'neg'|'pos'|'muted'|'total', a, count, sign }], note }
  // Returns its height. Rows with a < 1 slide in (each with its own a); count 0 → 1 runs the amount up.
  function card(ctx, o) {
    const x = o.x ?? X0, w = o.w ?? W0, a = o.a ?? 1; if (a <= 0.001) return 0;
    const pad = 48, R = 44; const g = measure(o); const y = o.y;
    ctx.save(); ctx.globalAlpha *= a;
    ctx.shadowColor = C.shadow; ctx.shadowBlur = 40; ctx.shadowOffsetY = 16; ctx.fillStyle = C.surface; rr(ctx, x, y, w, g.h, R); ctx.fill(); ctx.shadowColor = 'transparent';
    let cy = y + (o.title ? 30 : 22);
    if (o.title) {
      ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.fillStyle = C.ink; ctx.font = font(700, 44); ctx.fillText(o.title, x + pad, cy + 56);
      if (o.sub) { ctx.fillStyle = C.muted; ctx.font = font(400, 31, 'body'); ctx.fillText(o.sub, x + pad, cy + 104); }
      if (o.amount != null) { ctx.textAlign = 'right'; ctx.fillStyle = C.ink; ctx.font = font(700, 60, MONO); ctx.fillText(show(o.amount, o.amountCount), x + w - pad, cy + 62); }
    }
    (o.rows || []).forEach((r, i) => {
      const ra = r.a ?? 1; if (ra <= 0.001) return; const { y: ry, h } = g.rows[i]; const dy = (1 - ra) * 14;
      ctx.save(); ctx.beginPath(); ctx.rect(x, ry - 4, w, h + 8); ctx.clip(); ctx.globalAlpha *= ra;
      if (r.kind === 'total') {
        ctx.fillStyle = C.accentSoft; rr(ctx, x + 22, ry + 6, w - 44, 92, 30); ctx.fill();
        ctx.textAlign = 'left'; ctx.fillStyle = C.ink; ctx.font = font(700, 39); ctx.fillText(r.t, x + pad, ry + 66 + dy);
        ctx.textAlign = 'right'; ctx.fillStyle = C.accentText; ctx.font = font(700, 50, MONO); ctx.fillText(show(r.m, r.count, r.sign), x + w - pad, ry + 68 + dy);
      } else {
        ctx.textAlign = 'left'; ctx.fillStyle = r.kind === 'muted' ? C.muted : C.ink; ctx.font = font(600, 37, 'body'); ctx.fillText(r.t, x + pad, ry + 52 + dy);
        if (r.sub) { ctx.fillStyle = C.muted; ctx.font = font(400, 29, 'body'); ctx.fillText(r.sub, x + pad, ry + 94 + dy); }
        if (r.m != null) {
          ctx.textAlign = 'right'; ctx.font = font(500, 40, MONO);
          ctx.fillStyle = r.kind === 'neg' ? C.negative : r.kind === 'pos' ? C.positive : r.kind === 'muted' ? C.muted : C.ink;
          ctx.fillText(show(r.m, r.count, r.sign), x + w - pad, ry + 52 + dy);
        }
      }
      ctx.restore();
    });
    if (o.note) { ctx.textAlign = 'left'; ctx.fillStyle = C.muted; ctx.font = font(400, 27, 'body'); o.note.split('\n').forEach((s, i) => ctx.fillText(s, x + pad, y + g.h - 26 - (o.note.split('\n').length - 1 - i) * 38)); }
    ctx.restore(); return g.h;
  }

  // A bar that splits an amount: { x, y, w, h, k (0 → 1 draws it), a, parts: [{ v, color, t, m, a }] }.
  // The legend sits under the bar in equal columns, so it never depends on how wide a part is.
  function bar(ctx, o) {
    const x = o.x ?? X0 + 30, w = o.w ?? W0 - 60, h = o.h ?? 38, y = o.y; const total = o.parts.reduce((s, p) => s + p.v, 0); const k = o.k ?? 1;
    ctx.save(); ctx.globalAlpha *= o.a ?? 1;
    ctx.fillStyle = C.sunk; rr(ctx, x, y, w, h, h / 2); ctx.fill();
    ctx.save(); rr(ctx, x, y, w * k, h, h / 2); ctx.clip();
    let cx = x; for (const p of o.parts) { const pw = (p.v / total) * w; ctx.globalAlpha = (o.a ?? 1) * (p.a ?? 1); ctx.fillStyle = p.color; ctx.fillRect(cx, y, pw, h); cx += pw; }
    ctx.restore();
    const n = o.parts.length; const col = w / n; ctx.textBaseline = 'alphabetic';
    o.parts.forEach((p, i) => {
      const la = (p.a ?? 1) * c01((k - i / n) * n); if (la <= 0.01) return;
      ctx.save(); ctx.globalAlpha *= la; const lx = x + i * col;
      ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(lx + 11, y + h + 36, 10, 0, Math.PI * 2); ctx.fill();
      ctx.textAlign = 'left'; ctx.fillStyle = C.muted; ctx.font = font(500, 29, 'body'); if (p.t) ctx.fillText(p.t, lx + 32, y + h + 46);
      if (p.m != null) { ctx.fillStyle = C.ink; ctx.font = font(500, 37, MONO); ctx.fillText(show(p.m), lx + 2, y + h + 90); }
      ctx.restore();
    });
    ctx.restore();
  }

  // A rule chip ("Share 30%"): { x, y, t, a, size } → its width.
  const chipWidth = (ctx, t, size = 28) => { ctx.save(); ctx.font = font(600, size, 'body'); const w = ctx.measureText(t).width + size * 1.6; ctx.restore(); return w; };
  function chip(ctx, o) {
    const size = o.size || 28; const w = chipWidth(ctx, o.t, size), h = size * 2.07;
    ctx.save(); ctx.globalAlpha *= o.a ?? 1; ctx.shadowColor = C.shadow; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
    ctx.fillStyle = o.bg || C.surface; rr(ctx, o.x, o.y, w, h, h / 2); ctx.fill(); ctx.shadowColor = 'transparent';
    ctx.fillStyle = o.color || C.ink; ctx.font = font(600, size, 'body'); ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(o.t, o.x + size * 0.8, o.y + h / 2 + 1);
    ctx.restore(); return w;
  }
  // A centred row of chips that enter one after the other: { y, items, a, at (s), t (now), size, gap }
  function chipRow(ctx, o) {
    const size = o.size || 28, gap = o.gap ?? 14; const ws = o.items.map((s) => chipWidth(ctx, s, size)); let x = 540 - (ws.reduce((s, v) => s + v, 0) + gap * (ws.length - 1)) / 2;
    o.items.forEach((s, i) => { const k = ease.outCubic(clamp((o.t - (o.at + i * 0.12)) / 0.3)); chip(ctx, { x, y: o.y + (1 - k) * 10, t: s, size, a: (o.a ?? 1) * k }); x += ws[i] + gap; });
  }

  // A ring that draws itself around a rectangle (the same mark used on app screens): k 0 → 1 draws it, a fades it.
  function ring(ctx, x, y, w, h, r, k, a = 1) {
    if (k <= 0 || a <= 0) return; const per = 2 * (w + h);
    ctx.save(); ctx.globalAlpha *= a; ctx.lineWidth = 5; ctx.strokeStyle = C.accent; ctx.lineCap = 'round';
    ctx.setLineDash([per * Math.min(1, k), per]); rr(ctx, x, y, w, h, r); ctx.stroke(); ctx.restore();
  }
  // Ring around row i of a card.
  function ringRow(ctx, o, i, k, a = 1) { const g = measure(o); const r = g.rows[i]; if (!r) return; ring(ctx, g.x + 14, r.y, g.w - 28, r.h, 28, k, a); }

  // Keeps a card alive while it is on screen: a slow push (0.22% a second, at most 4%), a gentle float (±5 px over 7 s)
  // and a drift on a small circle at a constant speed (10 px, one turn in 12 s; `drift: 0` turns it off, `turn: -1`
  // reverses it), around the middle of the content area. On a phone, a frame that does not move for a second reads as
  // frozen, and between two cues only a row of the card changes: the drift never stops, unlike the float.
  function live(ctx, t, t0, draw, o = {}) {
    const lt = Math.max(0, t - t0); const k = 1 + Math.min(o.max ?? 0.04, (o.rate ?? 0.0022) * lt); const dy = (o.float ?? 5) * Math.sin((2 * Math.PI * lt) / (o.period ?? 7));
    const r = o.drift ?? 10, a = (2 * Math.PI * lt) / 12, cx = (o.turn ?? 1) * r * Math.sin(a), cy = r * (1 - Math.cos(a));
    ctx.save(); ctx.translate(540 + cx, (o.cy ?? 900) + dy + cy); ctx.scale(k, k); ctx.translate(-540, -(o.cy ?? 900)); draw(ctx, t); ctx.restore();
  }

  // Bar colours that read on the background: a neutral grey, the accent and a mid accent.
  const colors = { neutral: mix(C.muted, C.background, 0.45), accent: C.accent, accentMid: mix(C.accent, C.surface, 0.55), accentSoft: C.accentSoft };
  return { X0, W0, colors, live, money: fmtMoney, counted, measure, card, bar, chip, chipWidth, chipRow, ring, ringRow };
}

module.exports = { makeLedger, X0, W0 };
