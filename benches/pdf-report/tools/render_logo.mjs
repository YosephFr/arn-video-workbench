#!/usr/bin/env node
// Render an SVG logo to a transparent PNG with headless Chromium, so live <text> in the SVG uses the brand font.
//
//   node tools/render_logo.mjs <logo.svg> <logo.png> [--scale 4] [--font "Family:weight=path/to/file.ttf" ...]
//
// Fonts named in the SVG (font-family + font-weight) are looked up as <Family>-<weight>.ttf in $WB_FONTS_DIR,
// <bench>/assets/fonts and <repo>/assets/fonts (what core/bin/fetch-fonts.sh writes) and embedded as data URLs;
// --font adds or overrides one. Headless only: no window opens.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const BENCH = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = resolve(BENCH, '..', '..')
const argv = process.argv.slice(2)
const pos = argv.filter((a, i) => !a.startsWith('--') && !['--scale', '--font'].includes(argv[i - 1]))
if (pos.length < 2) { console.error('usage: node tools/render_logo.mjs <logo.svg> <logo.png> [--scale 4] [--font "Family:weight=file.ttf"]'); process.exit(2) }
const [svgPath, pngPath] = pos.map((p) => resolve(p))
const scale = parseFloat(argv[argv.indexOf('--scale') + 1] || '4') || 4
const svg = readFileSync(svgPath, 'utf8')

const dirs = [process.env.WB_FONTS_DIR, join(BENCH, 'assets', 'fonts'), join(ROOT, 'assets', 'fonts')].filter((d) => d && existsSync(d))
const faces = new Map()
for (const m of svg.matchAll(/font-family\s*=\s*"([^"]+)"[^>]*?font-weight\s*=\s*"(\d+)"|font-weight\s*=\s*"(\d+)"[^>]*?font-family\s*=\s*"([^"]+)"/g)) {
  const family = (m[1] || m[4]).split(',')[0].replace(/['"]/g, '').trim(), weight = m[2] || m[3]
  const file = dirs.map((d) => join(d, `${family.replace(/\s+/g, '')}-${weight}.ttf`)).find(existsSync)
  if (file) faces.set(`${family}:${weight}`, file)
  else console.warn(`font ${family} ${weight} not found: fetch it with core/bin/fetch-fonts.sh "${family}:${weight}"`)
}
argv.forEach((a, i) => { if (a === '--font') { const [k, f] = argv[i + 1].split('='); faces.set(k, resolve(f)) } })
const css = [...faces].map(([k, f]) => { const [family, weight] = k.split(':'); return `@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/ttf;base64,${readFileSync(f).toString('base64')})}` }).join('')

const vb = (svg.match(/viewBox\s*=\s*"([^"]+)"/) || [])[1]?.split(/[\s,]+/).map(Number)
const w = Math.ceil(vb ? vb[2] : 200), h = Math.ceil(vb ? vb[3] : 50)
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale })
  await page.setContent(`<style>${css}html,body{margin:0;background:transparent}svg{display:block;width:${w}px;height:${h}px}</style>${svg}`)
  await page.evaluate(() => document.fonts.ready)
  await page.locator('svg').first().screenshot({ path: pngPath, omitBackground: true })
} finally {
  await browser.close()
}
console.log(`logo → ${pngPath} (${w * scale}×${h * scale}, fonts: ${[...faces.keys()].join(', ') || 'none'})`)
