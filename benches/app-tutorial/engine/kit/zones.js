'use strict';
// What the social platforms cover on a 1080 × 1920 organic Reel, Short or TikTok: the header at the top, the
// column of buttons on the right and the account name, caption and audio line at the bottom. "risk" is what ads or
// a long caption cover as well (Meta's guidance: keep the top 14% and the bottom 35% free of key content).
// Re-check against the current overlays of the network you publish on: they change.
const ZONES = {
  covered: [
    { x: 0, y: 0, w: 1080, h: 200, n: 'header' },
    { x: 940, y: 820, w: 140, h: 900, n: 'buttons' },
    { x: 0, y: 1440, w: 1080, h: 480, n: 'caption and account' },
  ],
  risk: [
    { x: 0, y: 200, w: 1080, h: 70, n: 'ad header' },
    { x: 0, y: 1248, w: 1080, h: 192, n: 'long caption or ad' },
  ],
};

const hit = (r, z) => r.x < z.x + z.w && r.x + r.w > z.x && r.y < z.y + z.h && r.y + r.h > z.y;
// Which zone a rectangle (frame px) falls into, or null.
function zoneOf(r) {
  for (const k of ['covered', 'risk']) { const z = ZONES[k].find((q) => hit(r, q)); if (z) return `${k} (${z.n})`; }
  return null;
}

// Overlay for stills: WB_GUIDES=social.
function drawGuides(ctx, font) {
  ctx.save(); ctx.font = font ? font(600, 26, 'body') : '600 26px sans-serif'; ctx.textBaseline = 'top';
  for (const [k, col] of [['risk', '255,170,0'], ['covered', '230,40,40']]) for (const z of ZONES[k]) {
    ctx.fillStyle = `rgba(${col},0.22)`; ctx.fillRect(z.x, z.y, z.w, z.h);
    ctx.strokeStyle = `rgba(${col},0.9)`; ctx.lineWidth = 2; ctx.strokeRect(z.x + 1, z.y + 1, z.w - 2, z.h - 2);
    ctx.fillStyle = `rgba(${col},1)`; if (z.w > 300) ctx.fillText(z.n, z.x + 16, z.y + 10);
  }
  ctx.restore();
}

module.exports = { ZONES, zoneOf, drawGuides };
