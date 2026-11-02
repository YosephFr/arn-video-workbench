#!/usr/bin/env node
// Capture a list of URLs to PNG with headless Chromium, plus a JSON map of every visible element (text, role, box)
// so the film can ring a control by its text at the word that names it.
//
//   node tools/capture.mjs <shots.json> [--out DIR] [--var NAME=VALUE ...]
//   node tools/capture.mjs --url URL --id NAME [--out DIR] [--width 1024 --height 1320 --dpr 2] [--clock ISO] [--wait-for SELECTOR]
//
// shots.json:
//   { "viewport": { "width": 1024, "height": 1320, "dpr": 2 },     defaults for every shot (1024×1320 at 2× by default)
//     "clock": "2026-11-02T09:00:00Z",                              frozen Date.now()/new Date(): both builds show the same day
//     "timezone": "UTC", "locale": "en-US",
//     "read_only": true,                                            abort every POST/PUT/PATCH/DELETE the page tries
//     "allow_hosts": ["api.example.com"],                           extra hosts the page may reach (local hosts always can)
//     "shots": [ { "id": "before-reports", "url": "${BEFORE}/#reports", "wait_for": "body[data-ready]",
//                  "actions": [ { "click": "text=Schedule" }, { "press": "Meta+K" }, { "scroll": 400 }, { "wait": 300 } ],
//                  "hide": [".account-name"], "full_page": false } ] }
//
// ${NAME} in URLs expands from --var NAME=VALUE or the environment. Output per shot: <out>/<id>.png and <id>.json;
// plus <out>/manifest.json with each file's SHA-256. Headless only: no window ever opens.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { chromium } from 'playwright'

const argv = process.argv.slice(2)
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d }
const vars = {}
argv.forEach((a, i) => { if (a === '--var') { const [k, ...v] = argv[i + 1].split('='); vars[k] = v.join('=') } })

let manifest, base
if (opt('url')) {
  manifest = { viewport: { width: +opt('width', 1024), height: +opt('height', 1320), dpr: +opt('dpr', 2) }, clock: opt('clock'), read_only: true, shots: [{ id: opt('id', 'shot'), url: opt('url'), wait_for: opt('wait-for') }] }
  base = process.cwd()
} else {
  const file = argv.find((a, i) => !a.startsWith('--') && !['--out', '--var', '--url', '--id'].includes(argv[i - 1]))
  if (!file) { console.error('usage: node tools/capture.mjs <shots.json> [--out DIR] [--var NAME=VALUE]'); process.exit(2) }
  manifest = JSON.parse(readFileSync(file, 'utf8')); base = dirname(resolve(file))
}
const out = resolve(opt('out') || join(base, 'captures'))
mkdirSync(out, { recursive: true })
const expand = (s) => String(s).replace(/\$\{(\w+)\}/g, (_, k) => vars[k] ?? process.env[k] ?? (() => { throw new Error(`\${${k}} is not set (use --var ${k}=...)`) })())

// Inside the page: no blinking caret, no scrollbars, no animations caught halfway.
const CAPTURE_CSS = `*,*::before,*::after{caret-color:transparent!important;transition-duration:0s!important;animation-play-state:paused!important}
html{scrollbar-width:none!important}::-webkit-scrollbar{display:none!important}`

/** Runs in the page: every visible element worth pointing at, with its box in CSS px of the viewport. */
function measure() {
  const vw = innerWidth, vh = innerHeight
  const clean = (t) => (t || '').replace(/\s+/g, ' ').trim()
  const r1 = (n) => Math.round(n * 10) / 10
  const box = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) return null
    if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return null
    if (r.bottom <= 0 || r.right <= 0 || r.top >= vh || r.left >= vw) return null
    const x = Math.min(Math.max(r.left + r.width / 2, 1), vw - 1), y = Math.min(Math.max(r.top + r.height / 2, 1), vh - 1)
    const top = document.elementFromPoint(x, y)   // hidden behind a sheet or a scrim → not visible
    if (!top || !(el === top || el.contains(top) || top.contains(el))) return null
    return r
  }
  const INTERACTIVE = 'button, a[href], input, select, textarea, summary, [role=button], [role=tab], [role=checkbox], [role=radio], [role=option], [role=menuitem], [role=link], [role=switch]'
  const roleOf = (el) => {
    const tag = el.tagName.toLowerCase(), role = el.getAttribute('role')
    if (role && ['tab', 'checkbox', 'radio', 'option', 'menuitem', 'switch', 'link', 'button', 'dialog'].includes(role)) return role
    if (tag === 'a') return 'link'
    if (tag === 'input') return ['checkbox', 'radio'].includes(el.type) ? el.type : 'input'
    if (tag === 'textarea') return 'input'
    if (tag === 'select') return 'select'
    if (tag === 'button' || tag === 'summary') return 'button'
    if (/^h[1-6]$/.test(tag) || role === 'heading') return 'heading'
    if (tag === 'img') return 'image'
    if (tag === 'svg' || role === 'img') return 'icon'
    if (tag === 'dialog' || tag === 'aside') return 'dialog'
    return el.dataset.wbRole || 'card'
  }
  const textOf = (el) => {
    const tag = el.tagName.toLowerCase(), aria = clean(el.getAttribute('aria-label'))
    if (tag === 'input' || tag === 'textarea') return clean((el.labels && el.labels[0] && el.labels[0].innerText) || aria || el.placeholder || el.value || '')
    if (tag === 'select') return clean(aria || el.options?.[el.selectedIndex]?.text || '')
    if (tag === 'img') return clean(el.alt || aria)
    return clean(el.innerText).slice(0, 300) || aria
  }
  const set = new Set()
  document.querySelectorAll(`${INTERACTIVE}, h1, h2, h3, h4, [role=heading], img[alt]:not([alt=""]), svg[aria-label], [role=img][aria-label], dialog[open], [role=dialog], aside`).forEach((el) => set.add(el))
  document.querySelectorAll('body *').forEach((el) => {
    if (set.has(el) || el.closest('script, style, noscript')) return
    const r = el.getBoundingClientRect(); if (r.width < 40 || r.height < 24) return
    const cs = getComputedStyle(el)
    const filled = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent'
    const shadow = cs.boxShadow && cs.boxShadow !== 'none'
    if ((filled || shadow) && (parseFloat(cs.borderTopLeftRadius) || 0) >= 6 && clean(el.innerText)) set.add(el)
    else if (cs.cursor === 'pointer' && clean(el.innerText) && !(el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer')) set.add(el)
  })
  // Loose text: leaves with their own text that are not inside something already listed as a control.
  document.querySelectorAll('p, span, label, small, strong, b, li, td, th, time, kbd, div').forEach((el) => {
    if (set.has(el) || el.closest(`${INTERACTIVE}, h1, h2, h3, h4, script, style, noscript`)) return
    if (![...el.childNodes].some((n) => n.nodeType === 3 && clean(n.nodeValue))) return
    el.dataset.wbRole = 'text'; set.add(el)
  })
  const out = [], seen = new Set()
  for (const el of set) {
    const r = box(el); if (!r) continue
    const role = roleOf(el); const text = textOf(el)
    if (!text && role !== 'input' && role !== 'dialog') continue
    if (role === 'card' && r.width > vw - 2 && r.height > vh - 2) continue
    const key = `${role}|${text}|${Math.round(r.x)}|${Math.round(r.y)}|${Math.round(r.width)}`
    if (seen.has(key)) continue
    seen.add(key)
    const item = { text, role, x: r1(r.x), y: r1(r.y), w: r1(r.width), h: r1(r.height), radius: parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0 }
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') item.disabled = true
    if (el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-pressed') === 'true' || el.checked) item.selected = true
    out.push(item)
  }
  document.querySelectorAll('[data-wb-role]').forEach((el) => delete el.dataset.wbRole)
  return out.sort((a, b) => a.y - b.y || a.x - b.x)
}

const browser = await chromium.launch({ headless: true, args: ['--force-color-profile=srgb', '--disable-features=Translate'] })
const summary = []
try {
  for (const shot of manifest.shots) {
    const vp = { width: 1024, height: 1320, dpr: 2, ...(manifest.viewport || {}), ...(shot.viewport || {}) }
    const url = expand(shot.url)
    const local = new Set([new URL(url).host])
    const allow = new Set([...(manifest.allow_hosts || []), ...(shot.allow_hosts || []), 'fonts.googleapis.com', 'fonts.gstatic.com'])
    const readOnly = shot.read_only ?? manifest.read_only ?? true
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dpr,
      locale: manifest.locale || 'en-US', timezoneId: manifest.timezone || 'UTC', colorScheme: shot.color_scheme || manifest.color_scheme || 'light',
      reducedMotion: 'reduce', serviceWorkers: 'block', acceptDownloads: false,
    })
    await context.addInitScript({ content: `(() => { const css = ${JSON.stringify(CAPTURE_CSS)}; const put = () => { const h = document.head || document.documentElement; if (!h) return false; const s = document.createElement('style'); s.textContent = css; h.appendChild(s); return true }; if (!put()) new MutationObserver((_, o) => { if (put()) o.disconnect() }).observe(document, { childList: true, subtree: true }) })()` })
    if (manifest.clock || shot.clock) await context.clock.setFixedTime(new Date(shot.clock || manifest.clock))
    const blocked = [], problems = []
    await context.route('**/*', (route) => {
      const req = route.request(); const u = new URL(req.url())
      if (u.protocol === 'data:' || u.protocol === 'blob:') return route.continue()
      if (readOnly && !['GET', 'HEAD', 'OPTIONS'].includes(req.method())) { blocked.push(`${req.method()} ${req.url()}`); return route.abort('blockedbyclient') }
      if (local.has(u.host) || u.hostname === '127.0.0.1' || u.hostname === 'localhost' || allow.has(u.hostname)) return route.continue()
      blocked.push(`${req.method()} ${req.url()}`); return route.abort('blockedbyclient')
    })
    const page = await context.newPage()
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`) })
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 })
    if (shot.wait_for) await page.waitForSelector(shot.wait_for, { timeout: 30000 })
    for (const a of shot.actions || []) {
      if (a.click) await page.click(a.click)
      if (a.press) await page.keyboard.press(a.press)
      if (a.type) await page.keyboard.type(a.type)
      if (a.scroll) await page.mouse.wheel(0, a.scroll)
      if (a.wait) await page.waitForTimeout(a.wait)
    }
    for (const sel of shot.hide || []) await page.locator(sel).evaluateAll((els) => els.forEach((e) => { e.style.visibility = 'hidden' }))
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(shot.settle ?? 250)
    const png = join(out, `${shot.id}.png`)
    const buf = await page.screenshot({ path: png, fullPage: !!shot.full_page, animations: 'disabled', caret: 'hide' })
    const elements = await page.evaluate(measure)
    const meta = { id: shot.id, url, viewport: { width: vp.width, height: vp.height, dpr: vp.dpr }, clock: shot.clock || manifest.clock || null, captured_at: new Date().toISOString(), read_only: readOnly, blocked, problems, elements }
    writeFileSync(join(out, `${shot.id}.json`), JSON.stringify(meta, null, 1) + '\n')
    summary.push({ id: shot.id, url, png: `${shot.id}.png`, sha256: createHash('sha256').update(buf).digest('hex'), elements: elements.length, blocked: blocked.length, problems: problems.length })
    console.log(`${shot.id}: ${elements.length} elements${blocked.length ? `, ${blocked.length} blocked requests` : ''}${problems.length ? `, ${problems.length} page errors (see ${shot.id}.json)` : ''} → ${png}`)
    await context.close()
  }
} finally {
  await browser.close()
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify({ captured_at: new Date().toISOString(), shots: summary }, null, 1) + '\n')
