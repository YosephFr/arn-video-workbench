// The wall TV. Panoramic screen on a stand, with the city visible around it.
// - Default content (whenever there is nothing to show): a bar chart over a dark designed background with soft drifting
//   particles. No text, no numbers, no logos: the heights are an ordering, not data. Four highlighted bars in the brand
//   palette carry small abstract 3D tokens that pop in on top of them; unnamed "filler" bars sit between them.
// - Evidence: a screenshot, chart, post or number drawn ON the screen, over the same particle background (never a
//   different background, never a full-frame card). The camera focuses the screen without entering it.
// Both are pure functions of t (seeded particles), so the beauty pass and the HDR mask pass stay frame-locked.
import * as THREE from 'three';
import { clamp, eOut, eBack, u01, rng, mixHex } from './kit.js';

export const TV_SCREEN = { x:-1.43, y:1.72, z:-4.2, w:7.2, h:3.09 };   // 2.33:1, fully in frame in the wide shots

// layout of the default chart: 13 slots, 'm' = highlighted bar (index into the palette), 'f' = filler height
const ROWS = [ { f:0.86 }, { m:0 }, { f:0.90 }, { f:0.85 }, { m:1 }, { f:0.76 }, { f:0.72 }, { m:2 }, { f:0.63 }, { f:0.60 }, { m:3 }, { f:0.50 }, { f:0.45 } ];
const MAIN_H = [0.94, 0.80, 0.67, 0.55];      // highlighted bars keep this order; no filler is taller than the first
const FILLER = ['#3d4462', '#474e6c', '#41475f'];

export function particleField(seed = 20261028){
  const rnd = rng(seed), P = [];
  for (let k = 0; k < 150; k++){ const big = k < 24;
    P.push({ x:rnd(), y:rnd(), r: big ? 18 + 30*rnd() : 3.0 + 5.5*rnd()*rnd(), a: big ? 0.05 + 0.06*rnd() : 0.30 + 0.38*rnd(),
      vy: big ? 6 + 8*rnd() : 10 + 26*rnd(), sw: 4 + 14*rnd(), om: 0.4 + 0.9*rnd(), ph: 6.283*rnd(), tw: 0.6 + 1.6*rnd(),
      col: rnd() < 0.68 ? [205, 215, 255] : (rnd() < 0.5 ? [196, 170, 255] : [170, 225, 255]) }); }
  return P;
}

// dark designed background: night gradient (tinted by the brand), glow behind the plot, sheen, corner bloom, particles, vignette
export function drawBackground(cx, W, H, t, P, tint){
  const bg = cx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0c1a45'); bg.addColorStop(0.55, '#16135a'); bg.addColorStop(1, mixHex('#2e1660', tint, 0.25));
  cx.fillStyle = bg; cx.fillRect(0, 0, W, H);
  const glow = cx.createRadialGradient(W*0.52, H*0.60, 0, W*0.52, H*0.60, W*0.48); glow.addColorStop(0, 'rgba(125,140,255,0.26)'); glow.addColorStop(1, 'rgba(120,135,255,0)');
  cx.fillStyle = glow; cx.fillRect(0, 0, W, H);
  const sheen = cx.createLinearGradient(0, 0, 0, H*0.35); sheen.addColorStop(0, 'rgba(255,255,255,0.07)'); sheen.addColorStop(1, 'rgba(255,255,255,0)');
  cx.fillStyle = sheen; cx.fillRect(0, 0, W, H*0.35);
  const bloom = cx.createRadialGradient(W*0.92, H*0.08, 0, W*0.92, H*0.08, W*0.38); bloom.addColorStop(0, 'rgba(160,110,255,0.18)'); bloom.addColorStop(1, 'rgba(160,110,255,0)');
  cx.fillStyle = bloom; cx.fillRect(0, 0, W, H);
  for (const q of P){
    const y = ((q.y*H - q.vy*t) % (H + 2*q.r) + H + 2*q.r) % (H + 2*q.r) - q.r, x = q.x*W + q.sw*Math.sin(q.om*t + q.ph);
    const a = q.a*(0.75 + 0.25*Math.sin(q.tw*t + q.ph*1.7));
    const g = cx.createRadialGradient(x, y, 0, x, y, q.r); const [r, gg, b] = q.col;
    g.addColorStop(0, `rgba(${r},${gg},${b},${a})`); g.addColorStop(q.r > 10 ? 0.55 : 0.35, `rgba(${r},${gg},${b},${a*(q.r > 10 ? 0.8 : 0.45)})`); g.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    cx.fillStyle = g; cx.beginPath(); cx.arc(x, y, q.r, 0, 6.2832); cx.fill();
  }
  const lo = Math.min(W, H), hi = Math.max(W, H);          // works for the panoramic screen and for a portrait insert
  const vig = cx.createRadialGradient(W*0.5, H*0.5, lo*0.35, W*0.5, H*0.5, hi*0.62); vig.addColorStop(0, 'rgba(4,6,20,0)'); vig.addColorStop(1, 'rgba(4,6,20,0.45)');
  cx.fillStyle = vig; cx.fillRect(0, 0, W, H);
}

export function roundRect(cx, x, y, w, h, r){ cx.beginPath(); cx.moveTo(x + r, y); cx.arcTo(x + w, y, x + w, y + h, r); cx.arcTo(x + w, y + h, x, y + h, r); cx.arcTo(x, y + h, x, y, r); cx.arcTo(x, y, x + w, y, r); cx.closePath(); }
function fitText(cx, text, maxW, size, weight, family){
  let s = size; cx.font = `${weight} ${s}px ${family}`;
  while (cx.measureText(text).width > maxW && s > 18){ s -= 2; cx.font = `${weight} ${s}px ${family}`; }
  return s;
}
function wrapText(cx, text, maxW){
  const words = String(text).split(/\s+/), lines = [''];
  for (const w of words){ const c = (lines[lines.length - 1] + ' ' + w).trim(); if (cx.measureText(c).width <= maxW || !lines[lines.length - 1]) lines[lines.length - 1] = c; else lines.push(w); }
  return lines;
}

// ---------------------------------------------------------------- evidence placeholders (generic, brand-coloured)
// All copy in them is a slot to replace; all numbers are obviously illustrative.
export function drawPost(cx, W, H, s, B, F){
  const cw = W*0.74, ch = H*0.84, x0 = (W - cw)/2, y0 = (H - ch)/2 + H*0.03;
  cx.save(); cx.shadowColor = 'rgba(0,0,10,0.55)'; cx.shadowBlur = 40; cx.shadowOffsetY = 12;
  roundRect(cx, x0, y0, cw, ch, 36); cx.fillStyle = 'rgba(250,250,252,0.97)'; cx.fill(); cx.restore();
  const pad = 56, ax = x0 + pad + 54, ay = y0 + pad + 54;
  cx.fillStyle = B.accent; cx.beginPath(); cx.arc(ax, ay, 54, 0, 6.2832); cx.fill();
  cx.fillStyle = B.accent_ink; cx.font = `800 46px ${F.display}`; cx.textAlign = 'center'; cx.textBaseline = 'middle';
  cx.fillText(s.initials || 'AB', ax, ay + 2);
  cx.textAlign = 'left'; cx.textBaseline = 'alphabetic';
  cx.fillStyle = '#111318'; cx.font = `800 56px ${F.body}`; cx.fillText(s.name || 'Account Name', ax + 80, ay - 6);
  cx.fillStyle = '#6b6f7a'; cx.font = `500 44px ${F.body}`; cx.fillText(s.handle || '@handle · 2h', ax + 80, ay + 48);
  cx.fillStyle = '#111318'; const ts = fitText(cx, 'M', 9999, s.size || 76, 650, F.body); cx.font = `650 ${ts}px ${F.body}`;
  const lines = wrapText(cx, s.text || 'The post the dialogue reacts to goes here, in one or two lines.', cw - 2*pad).slice(0, 3);
  lines.forEach((l, i) => cx.fillText(l, x0 + pad, ay + 160 + i*ts*1.22));
  const sy = y0 + ch - pad - 6; cx.fillStyle = '#6b6f7a'; cx.font = `600 40px ${F.body}`;
  const stats = s.stats || ['1.2K', '340', '87']; let sx = x0 + pad;
  stats.forEach((v, i) => {            // three generic icons drawn as shapes: heart, repeat arrows, bubble
    cx.save(); cx.strokeStyle = '#6b6f7a'; cx.lineWidth = 5; cx.translate(sx + 20, sy - 14);
    if (i === 0){ cx.beginPath(); cx.moveTo(0, 14); cx.bezierCurveTo(-26, -4, -12, -24, 0, -10); cx.bezierCurveTo(12, -24, 26, -4, 0, 14); cx.stroke(); }
    else if (i === 1){ cx.beginPath(); cx.arc(0, 0, 16, 0.3, 2.8); cx.stroke(); cx.beginPath(); cx.arc(0, 0, 16, 3.4, 5.9); cx.stroke(); }
    else { roundRect(cx, -18, -15, 36, 26, 10); cx.stroke(); cx.beginPath(); cx.moveTo(-6, 11); cx.lineTo(-12, 20); cx.lineTo(2, 11); cx.stroke(); }
    cx.restore(); cx.fillText(v, sx + 52, sy); sx += 52 + cx.measureText(v).width + 70;
  });
}
export function drawChart(cx, W, H, s, B, F, t, t0){
  const cw = W*0.74, ch = H*0.82, x0 = (W - cw)/2, y0 = (H - ch)/2 + H*0.02;
  cx.save(); roundRect(cx, x0, y0, cw, ch, 34); cx.fillStyle = 'rgba(6,8,22,0.74)'; cx.fill();
  cx.strokeStyle = 'rgba(190,200,255,0.22)'; cx.lineWidth = 3; cx.stroke(); cx.restore();
  const pad = 70; cx.fillStyle = '#eef0fb'; fitText(cx, s.title || 'Your metric, over time', cw - 2*pad, 72, 800, F.display);
  cx.fillText(s.title || 'Your metric, over time', x0 + pad, y0 + pad + 40);
  cx.fillStyle = 'rgba(200,206,235,0.75)'; cx.font = `500 44px ${F.body}`; cx.fillText(s.subtitle || 'Illustrative data', x0 + pad, y0 + pad + 96);
  const px0 = x0 + pad, px1 = x0 + cw - pad - 180, py0 = y0 + pad + 150, py1 = y0 + ch - pad;
  cx.strokeStyle = 'rgba(190,200,255,0.16)'; cx.lineWidth = 2.5;
  for (let k = 0; k <= 3; k++){ const y = py1 - (py1 - py0)*k/3; cx.beginPath(); cx.moveTo(px0, y); cx.lineTo(px1, y); cx.stroke(); }
  let vals = s.values || [0.18, 0.22, 0.20, 0.31, 0.35, 0.33, 0.48, 0.55, 0.62, 0.86];   // 0..1, one point per step
  if (vals.length < 2) vals = [0, vals[0] ?? 1];
  const grow = t0 == null ? 1 : eOut(u01(t, t0 + 0.15, 0.9));        // the line draws itself after the cut
  const pts = vals.map((v, i) => [px0 + (px1 - px0)*i/(vals.length - 1), py1 - (py1 - py0)*v]);
  const n = 1 + (pts.length - 1)*grow, k = Math.floor(n), f = n - k;
  cx.save(); cx.lineJoin = 'round'; cx.lineCap = 'round'; cx.strokeStyle = B.accent; cx.lineWidth = 10;
  cx.beginPath(); cx.moveTo(...pts[0]);
  for (let i = 1; i < Math.min(k, pts.length); i++) cx.lineTo(...pts[i]);
  let end = pts[Math.min(k, pts.length) - 1];
  if (k < pts.length && f > 0){ const a = pts[k - 1], b = pts[k]; end = [a[0] + (b[0] - a[0])*f, a[1] + (b[1] - a[1])*f]; cx.lineTo(...end); }
  cx.stroke(); cx.restore();
  const area = cx.createLinearGradient(0, py0, 0, py1); area.addColorStop(0, mixHex(B.accent, '#000000', 0) + '55'); area.addColorStop(1, mixHex(B.accent, '#000000', 0) + '00');
  cx.save(); cx.beginPath(); cx.moveTo(pts[0][0], py1); cx.lineTo(...pts[0]);
  for (let i = 1; i < Math.min(k, pts.length); i++) cx.lineTo(...pts[i]);
  cx.lineTo(...end); cx.lineTo(end[0], py1); cx.closePath(); cx.fillStyle = area; cx.fill(); cx.restore();
  cx.fillStyle = '#ffffff'; cx.beginPath(); cx.arc(end[0], end[1], 16, 0, 6.2832); cx.fill();
  cx.fillStyle = B.accent; cx.beginPath(); cx.arc(end[0], end[1], 10, 0, 6.2832); cx.fill();
  if (grow > 0.98){                                                  // callout chip on the last point
    const label = s.callout || '+38%'; cx.font = `800 56px ${F.display}`; const lw = cx.measureText(label).width;
    const bx = Math.min(end[0] + 28, x0 + cw - pad - lw - 40), by = end[1] - 40;
    roundRect(cx, bx, by - 50, lw + 44, 76, 38); cx.fillStyle = B.accent; cx.fill();
    cx.fillStyle = B.accent_ink; cx.fillText(label, bx + 22, by + 8);
  }
}
export function drawNumber(cx, W, H, s, B, F){
  cx.textAlign = 'center'; cx.fillStyle = '#ffffff';
  fitText(cx, s.value || '3 of 4', W*0.8, 300, 900, F.display); cx.fillText(s.value || '3 of 4', W/2, H*0.58);
  cx.fillStyle = 'rgba(220,226,250,0.85)'; fitText(cx, s.label || 'What the number means, in five words', W*0.8, 70, 600, F.body);
  cx.fillText(s.label || 'What the number means, in five words', W/2, H*0.78); cx.textAlign = 'left';
}
export function drawImage(cx, W, H, img){
  const mw = W*0.84, mh = H*0.84, k = Math.min(mw/img.width, mh/img.height), w = img.width*k, h = img.height*k, x = (W - w)/2, y = (H - h)/2;
  cx.save(); cx.shadowColor = 'rgba(0,0,10,0.55)'; cx.shadowBlur = 40; cx.shadowOffsetY = 12; roundRect(cx, x, y, w, h, 24); cx.fillStyle = '#000'; cx.fill(); cx.restore();
  cx.save(); roundRect(cx, x, y, w, h, 24); cx.clip(); cx.drawImage(img, x, y, w, h); cx.restore();
}
export function drawCaption(cx, W, text, F){
  cx.font = `650 44px ${F.body}`; const w = cx.measureText(text).width, x = (W - w - 56)/2;
  roundRect(cx, x, 30, w + 56, 74, 37); cx.fillStyle = 'rgba(6,8,22,0.78)'; cx.fill();
  cx.fillStyle = '#e2e6f6'; cx.fillText(text, x + 28, 81);
}

// ---------------------------------------------------------------- 3D tokens over the highlighted bars (abstract shapes)
function tokenGeometry(i, size){
  const s = size/2;
  switch (i % 4){
    case 0: return new THREE.IcosahedronGeometry(s*0.9, 2);
    case 1: return new THREE.BoxGeometry(s*1.4, s*1.4, s*1.4);
    case 2: return new THREE.TorusGeometry(s*0.7, s*0.26, 12, 32);
    default: return new THREE.OctahedronGeometry(s*1.05, 0);
  }
}

export async function makeTV(scene, o){
  const SCR = { ...TV_SCREEN, ...(o.screen || {}) }, B = o.brand, F = o.fonts;
  const W = 2048, H = Math.round(W*SCR.h/SCR.w);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const cx = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const level = o.level ?? 0.55, evLevel = o.evidenceLevel ?? 0.66;
  const scrMat = new THREE.MeshBasicMaterial({ map:tex, color:new THREE.Color().setScalar(level) });
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(SCR.w, SCR.h), scrMat); scr.position.set(SCR.x, SCR.y, SCR.z); scr.userData.hdr = 'screen'; scr.name = 'tvScreen';
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(SCR.w + 0.3, SCR.h + 0.3, 0.2), new THREE.MeshStandardMaterial({ color:'#07090f', roughness:0.4, metalness:0.5 }));
  bezel.position.set(SCR.x, SCR.y, SCR.z - 0.12);
  const floorY = o.floorY ?? -8.75;
  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.35, SCR.y - SCR.h/2 - floorY, 0.25), new THREE.MeshStandardMaterial({ color:'#141826', roughness:0.5, metalness:0.4 }));
  stand.position.set(SCR.x, (floorY + SCR.y - SCR.h/2)/2, SCR.z - 0.15);
  const wallLight = new THREE.SpotLight('#8fb0ff', 7, 14, 0.75, 0.9, 1.3); wallLight.position.set(SCR.x, SCR.y + 0.45, -3.9); wallLight.target.position.set(1.2, -1.4, 1.2);
  scene.add(scr, bezel, stand, wallLight, wallLight.target);

  // default chart geometry (canvas px)
  const pal = o.palette || [B.accent, B.positive, '#8f9bd8', B.negative];
  const padL = W*0.17, padR = W*0.13, yTop = H*0.33, yBase = H*0.76, NS = ROWS.length, slot = (W - padL - padR)/NS;
  const bwM = slot*0.70, bwF = slot*0.58, tokPx = slot*0.62, gapPx = tokPx*0.30;
  const axX = padL - W*0.028, xR = W - padR + W*0.012, plotH = yBase - yTop;
  const barX = j => padL + slot*(j + 0.5);
  const bars = ROWS.map((r, j) => r.m !== undefined ? { j, main:true, m:r.m, height:MAIN_H[r.m], bw:bwM, col:pal[r.m % pal.length] } : { j, main:false, height:r.f, bw:bwF, col:FILLER[j % FILLER.length] });
  const P = particleField(o.seed || 20261028), tint = B.accent;
  const barPath = (x0, bw, hh, r, yb = yBase) => { cx.beginPath(); cx.moveTo(x0, yb); cx.lineTo(x0, yb - hh + r); cx.quadraticCurveTo(x0, yb - hh, x0 + r, yb - hh);
    cx.lineTo(x0 + bw - r, yb - hh); cx.quadraticCurveTo(x0 + bw, yb - hh, x0 + bw, yb - hh + r); cx.lineTo(x0 + bw, yb); cx.closePath(); };
  function drawChartDefault(prog, t){
    drawBackground(cx, W, H, t, P, tint);
    const yAt = v => yBase - plotH*v;
    cx.lineCap = 'round';
    for (let k = 1; k <= 4; k++){ cx.strokeStyle = 'rgba(190,200,255,0.12)'; cx.lineWidth = 3; cx.setLineDash([]); cx.beginPath(); cx.moveTo(axX, yAt(k/4)); cx.lineTo(xR, yAt(k/4)); cx.stroke(); }
    cx.strokeStyle = 'rgba(190,200,255,0.06)'; cx.lineWidth = 2; cx.setLineDash([10, 14]);
    for (let k = 1; k <= 7; k += 2){ cx.beginPath(); cx.moveTo(axX, yAt(k/8)); cx.lineTo(xR, yAt(k/8)); cx.stroke(); }
    cx.setLineDash([]);
    cx.strokeStyle = 'rgba(215,222,255,0.52)'; cx.lineWidth = 4.5; cx.beginPath(); cx.moveTo(axX, yBase); cx.lineTo(axX, yAt(1.10)); cx.stroke();
    for (let k = 1; k <= 8; k++){ const maj = k % 2 === 0; cx.lineWidth = maj ? 4 : 3; cx.strokeStyle = maj ? 'rgba(215,222,255,0.52)' : 'rgba(215,222,255,0.36)';
      cx.beginPath(); cx.moveTo(axX - (maj ? 24 : 13), yAt(k/8)); cx.lineTo(axX, yAt(k/8)); cx.stroke(); }
    cx.fillStyle = 'rgba(225,230,255,0.6)'; cx.beginPath(); cx.arc(axX, yAt(1.10), 5.5, 0, 6.2832); cx.fill();
    // reflective bevelled platform under the bars
    const platTop = yBase + 4, platD = 58, platEdge = 20, ext = 26, pL0 = axX, pR0 = xR, pL1 = pL0 - ext, pR1 = pR0 + ext, yF = platTop + platD;
    const topG = cx.createLinearGradient(0, platTop, 0, yF); topG.addColorStop(0, 'rgba(150,165,255,0.20)'); topG.addColorStop(1, 'rgba(70,80,160,0.10)');
    const plat = () => { cx.beginPath(); cx.moveTo(pL0, platTop); cx.lineTo(pR0, platTop); cx.lineTo(pR1, yF); cx.lineTo(pL1, yF); cx.closePath(); };
    cx.fillStyle = topG; plat(); cx.fill();
    cx.save(); plat(); cx.clip();
    for (const b of bars){ const hh = plotH*b.height*prog[b.j]; if (hh < 1) continue;     // mirrored reflections, fading
      const x0 = barX(b.j) - b.bw/2, rh = Math.min(hh*0.42, platD), c = new THREE.Color(b.col);
      const rr = Math.round(255*Math.min(1, c.r + 0.05)), gg = Math.round(255*Math.min(1, c.g + 0.05)), bb = Math.round(255*Math.min(1, c.b + 0.05));
      const rg = cx.createLinearGradient(0, platTop, 0, platTop + rh); rg.addColorStop(0, `rgba(${rr},${gg},${bb},${b.main ? 0.42 : 0.26})`); rg.addColorStop(1, `rgba(${rr},${gg},${bb},0)`);
      cx.fillStyle = rg; cx.fillRect(x0, platTop, b.bw, rh); }
    const spec = cx.createLinearGradient(pL0, 0, pR0, 0); spec.addColorStop(0, 'rgba(255,255,255,0)'); spec.addColorStop(0.5, 'rgba(255,255,255,0.06)'); spec.addColorStop(1, 'rgba(255,255,255,0)');
    cx.fillStyle = spec; cx.fillRect(pL1, platTop, pR1 - pL1, platD*0.45);
    cx.restore();
    const edge = cx.createLinearGradient(0, yF, 0, yF + platEdge); edge.addColorStop(0, 'rgba(40,46,96,0.95)'); edge.addColorStop(1, 'rgba(14,16,44,0.95)');
    cx.fillStyle = edge; cx.fillRect(pL1, yF, pR1 - pL1, platEdge);
    cx.strokeStyle = 'rgba(210,220,255,0.55)'; cx.lineWidth = 3; cx.beginPath(); cx.moveTo(pL1, yF); cx.lineTo(pR1, yF); cx.stroke();
    cx.strokeStyle = 'rgba(190,200,255,0.22)'; cx.lineWidth = 2.5; cx.beginPath(); cx.moveTo(pL0, platTop); cx.lineTo(pL1, yF); cx.moveTo(pR0, platTop); cx.lineTo(pR1, yF); cx.stroke();
    const sh = cx.createLinearGradient(0, yF + platEdge, 0, yF + platEdge + 30); sh.addColorStop(0, 'rgba(2,4,16,0.45)'); sh.addColorStop(1, 'rgba(2,4,16,0)');
    cx.fillStyle = sh; cx.fillRect(pL1, yF + platEdge, pR1 - pL1, 30);
    cx.strokeStyle = 'rgba(225,230,255,0.50)'; cx.lineWidth = 4; cx.beginPath(); cx.moveTo(axX, yBase); cx.lineTo(xR, yBase); cx.stroke();
    for (const pass of [false, true]) for (const b of bars){ if (b.main !== pass) continue;        // fillers first, highlighted on top
      const hh = plotH*b.height*prog[b.j]; if (hh < 1) continue;
      const x0 = barX(b.j) - b.bw/2, r = Math.min(10, hh/2);
      cx.save(); if (b.main){ cx.shadowColor = 'rgba(190,200,255,0.35)'; cx.shadowBlur = 24; }
      cx.globalAlpha = b.main ? 1 : 0.80; cx.fillStyle = b.col; barPath(x0, b.bw, hh, r); cx.fill(); cx.restore();
      const lit = cx.createLinearGradient(0, yBase - hh, 0, yBase); lit.addColorStop(0, `rgba(255,255,255,${b.main ? 0.16 : 0.08})`); lit.addColorStop(1, 'rgba(255,255,255,0)');
      cx.fillStyle = lit; barPath(x0, b.bw, hh, r); cx.fill();
      cx.strokeStyle = b.main ? 'rgba(255,255,255,0.30)' : 'rgba(200,210,255,0.10)'; cx.lineWidth = b.main ? 3.5 : 2; barPath(x0, b.bw, hh, r); cx.stroke();
      if (b.main){ const cyL = yBase - hh - gapPx - tokPx/2, halo = cx.createRadialGradient(barX(b.j), cyL, 0, barX(b.j), cyL, tokPx*0.9);
        halo.addColorStop(0, `rgba(150,165,255,${0.22*prog[b.j]})`); halo.addColorStop(1, 'rgba(150,165,255,0)');
        cx.fillStyle = halo; cx.fillRect(barX(b.j) - tokPx, cyL - tokPx, tokPx*2, tokPx*2); }
    }
  }

  // 3D tokens: pivot at the token's bottom centre, placed on top of each highlighted bar
  const wx = px => SCR.x + (px/W - 0.5)*SCR.w, wy = py => SCR.y + (0.5 - py/H)*SCR.h;
  const tokens = new THREE.Group(); tokens.name = 'tvTokens'; scene.add(tokens);
  const size = (tokPx/W)*SCR.w, gap = (gapPx/W)*SCR.w, items = [];
  if (o.tokens !== false) for (const b of bars.filter(b => b.main)){
    const col = new THREE.Color(b.col).lerp(new THREE.Color('#ffffff'), 0.25);
    const m = new THREE.MeshStandardMaterial({ color:col, roughness:0.45, metalness:0.1, emissive:col, emissiveIntensity:0.22 });
    const mesh = new THREE.Mesh(tokenGeometry(b.m, size), m); mesh.position.y = size/2;
    const pivot = new THREE.Group(); pivot.add(mesh); pivot.position.set(wx(barX(b.j)), wy(yBase), SCR.z + 0.03 + size/2); tokens.add(pivot);
    items.push({ pivot, mesh, b });
  }
  const progAt = (t, tS) => bars.map(b => b.main ? eOut(u01(t, tS + 0.12 + 0.09*b.m, 0.55)) : eOut(u01(t, tS + 0.10 + 0.028*b.j, 0.55)));

  // evidence images (screenshots dropped into the piece folder)
  const IMG = {};
  for (const [k, url] of Object.entries(o.images || {})) IMG[k] = await new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => { console.error('evidence image failed: ' + url); res(null); }; im.src = url; });

  const buildAt = o.buildAt ?? null;      // seconds: the chart animates in; null = always fully built
  let lastKey = '';
  const api = { mesh:scr, mat:scrMat, bezel, stand, wallLight, tokens, screen:SCR, mask:false, level, evLevel,
    // c: null (default chart) or an evidence spec { kind:'post'|'chart'|'number'|'image', ... , t0 }
    update(t, c){
      const tS = buildAt ?? -99, prog = progAt(t, tS);
      tokens.visible = !c;
      for (const it of items){ const p = prog[it.b.j];
        const s = buildAt == null ? 1 : eBack(u01(t, tS + 0.30 + 0.09*it.b.m, 0.45));
        it.pivot.visible = s > 0; it.pivot.scale.setScalar(Math.max(1e-3, s));
        it.pivot.position.y = wy(yBase - plotH*it.b.height*p) + gap;
        it.mesh.rotation.y = 0.35*Math.sin(0.4*t + it.b.m*1.7); it.mesh.rotation.x = 0.15*Math.sin(0.3*t + it.b.m);
      }
      if (api.mask) return;
      const tp = buildAt != null && t < tS - 0.05 ? tS - 0.05 : t;
      const key = (c ? (c.id || c.kind) : 'chart') + '|' + tp.toFixed(4);
      if (key === lastKey) return;
      lastKey = key;
      if (!c) drawChartDefault(prog, tp);
      else {
        drawBackground(cx, W, H, tp, P, tint);
        if (c.kind === 'post') drawPost(cx, W, H, c, B, F);
        else if (c.kind === 'chart') drawChart(cx, W, H, c, B, F, t, c.t0);
        else if (c.kind === 'number') drawNumber(cx, W, H, c, B, F);
        else if (c.kind === 'image' && IMG[c.image]) drawImage(cx, W, H, IMG[c.image]);
        if (c.caption) drawCaption(cx, W, c.caption, F);
      }
      tex.needsUpdate = true;
    },
    // emission level of the screen: evidence a little brighter than the default chart so text reads in the focus shot
    baseLevel(c){ return c ? evLevel : level; } };
  drawChartDefault(bars.map(() => 1), 0);
  return api;
}
