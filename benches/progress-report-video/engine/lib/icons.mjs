// Stroke icons on a 24×24 grid, drawn with Path2D. Path data from Lucide (https://lucide.dev), ISC License:
//
//   Copyright (c) Lucide Icons and Contributors. Permission to use, copy, modify, and/or distribute this software for
//   any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission
//   notice appear in all copies. THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES.
//
// Circles, rects and polylines were converted to plain path strings. Add an icon by copying its nodes from Lucide
// (or any 24×24 stroke set) into ICONS as path strings.
import { Path2D } from '@napi-rs/canvas'

export const ICONS = {
  'check': ["M20 6 9 17l-5-5"],
  'circle-check': ["M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0","m16 9-5.5 5.5L8 12"],
  'calendar-clock': ["M16 14v2.2l1.6 1","M16 2v3","M21 7.338V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2h2.338","M3 9h5.859","M8 2v3","M10 16a6 6 0 1 0 12 0a6 6 0 1 0 -12 0"],
  'clock': ["M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0","M12 6v6l4 2"],
  'send': ["M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z","m21.854 2.147-10.94 10.939"],
  'mail': ["m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7","M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2z"],
  'layout-dashboard': ["M4 3h5a1 1 0 0 1 1 1v7a1 1 0 0 1 -1 1h-5a1 1 0 0 1 -1 -1v-7a1 1 0 0 1 1 -1z","M15 3h5a1 1 0 0 1 1 1v3a1 1 0 0 1 -1 1h-5a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1z","M15 12h5a1 1 0 0 1 1 1v7a1 1 0 0 1 -1 1h-5a1 1 0 0 1 -1 -1v-7a1 1 0 0 1 1 -1z","M4 16h5a1 1 0 0 1 1 1v3a1 1 0 0 1 -1 1h-5a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1z"],
  'file-text': ["M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z","M14 2v5a1 1 0 0 0 1 1h5","M10 9H8","M16 13H8","M16 17H8"],
  'chart-column': ["M3 3v16a2 2 0 0 0 2 2h16","M18 17V9","M13 17V5","M8 17v-3"],
  'chart-line': ["M3 3v16a2 2 0 0 0 2 2h16","m19 9-5 5-4-4-3 3"],
  'zap': ["M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z"],
  'search': ["m21 21-4.34-4.34","M3 11a8 8 0 1 0 16 0a8 8 0 1 0 -16 0"],
  'bell': ["M10.268 21a2 2 0 0 0 3.464 0","M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"],
  'download': ["M12 15V3","M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4","m7 10 5 5 5-5"],
  'keyboard': ["M10 8h.01","M12 12h.01","M14 8h.01","M16 12h.01","M18 8h.01","M6 8h.01","M7 16h10","M8 12h.01","M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2z"],
  'sparkles': ["M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z","M20 2v4","M22 4h-4","M2 20a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"],
  'eye': ["M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0","M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"],
  'funnel': ["M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z"],
  'users': ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2","M16 3.128a4 4 0 0 1 0 7.744","M22 21v-2a4 4 0 0 0-3-3.87","M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0"],
  'shield-check': ["M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z","m9 12 2 2 4-4"],
  'refresh-cw': ["M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8","M21 3v5h-5","M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16","M8 16H3v5"],
  'rocket': ["M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5","M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09","M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z","M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05"],
  'arrow-left-right': ["M8 3 4 7l4 4","M4 7h16","m16 21 4-4-4-4","M20 17H4"],
  'moon': ["M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"],
  'table': ["M12 3v18","M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2z","M3 9h18","M3 15h18"],
  'list-checks': ["M13 5h8","M13 12h8","M13 19h8","m3 17 2 2 4-4","m3 7 2 2 4-4"],
  'bookmark': ["M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z"],
  'sliders-horizontal': ["M10 5H3","M12 19H3","M14 3v4","M16 17v4","M21 12h-9","M21 19h-5","M21 5h-7","M8 10v4","M8 12H3"],
  'trending-up': ["M16 7h6v6","m22 7-8.5 8.5-5-5L2 17"],
  'inbox': ["M22 12L16 12L14 15L10 15L8 12L2 12","M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"],
  'lock': ["M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-7a2 2 0 0 1 2 -2z","M7 11V7a5 5 0 0 1 10 0v4"],
  'gauge': ["m12 14 4-4","M3.34 19a10 10 0 1 1 17.32 0"],
  'file-spreadsheet': ["M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z","M14 2v5a1 1 0 0 0 1 1h5","M8 13h2","M14 13h2","M8 17h2","M14 17h2"],
  'chevrons-left-right': ["m9 7-5 5 5 5","m15 7 5 5-5 5"],
  'box': ["M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z","m3.3 7 8.7 5 8.7-5","M12 22V12"],
  'sun': ["M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0","M12 2v2","M12 20v2","m4.93 4.93 1.41 1.41","m17.66 17.66 1.41 1.41","M2 12h2","M20 12h2","m6.34 17.66-1.41 1.41","m19.07 4.93-1.41 1.41"],
  'trending-down': ["M16 17h6v-6","m22 17-8.5-8.5-5 5L2 7"],
  'minus': ["M5 12h14"],
}

const cache = new Map()

/** Draw icon `name` centred on (x, y), `size` px wide. o: { color, width (stroke in grid units), alpha, progress 0..1 } */
export function drawIcon(ctx, name, x, y, size, o = {}) {
  const paths = ICONS[name]
  if (!paths) throw new Error(`unknown icon "${name}"; available: ${Object.keys(ICONS).join(', ')}`)
  let p2 = cache.get(name)
  if (!p2) { p2 = paths.map((d) => new Path2D(d)); cache.set(name, p2) }
  const k = size / 24
  ctx.save()
  ctx.translate(x - size / 2, y - size / 2)
  ctx.scale(k, k)
  ctx.globalAlpha *= o.alpha ?? 1
  ctx.strokeStyle = o.color || '#000'
  ctx.lineWidth = o.width ?? 2
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const pr = o.progress ?? 1
  if (pr < 1) ctx.setLineDash([80 * pr, 200])   // icon paths are shorter than 80 grid units: a dash draws them on
  for (const p of p2) ctx.stroke(p)
  ctx.restore()
}
