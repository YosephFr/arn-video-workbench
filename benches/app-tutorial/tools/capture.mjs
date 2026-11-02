#!/usr/bin/env node
// App captures for the tutorial kit: <name>.png (the phone viewport at 3x) and <name>.json (the rectangle, role and
// text of everything on screen, plus the elements you name with selectors), so focus(), tap() and rings land on
// real coordinates. Headless Chromium only, with a throwaway profile; nothing leaves the machine except requests to
// the app's own origin and the hosts you allow.
//
// One screen:
//   node tools/capture.mjs --url http://localhost:5173/settings --name settings --out captures/app \
//        --measure save=#save --measure "total=.summary .total" [--mode app|browser] [--wait '#ready'|500] [--full]
//
// A flow (several screens, taps, typing and animations, numbered 01-, 02-, …):
//   node tools/capture.mjs --flow samples/feature-tour/capture.json [--out DIR]
//
// Flow file:
//   { "name": "reminders", "url": "${BENCH}/samples/mock-app/index.html", "mode": "app",
//     "clock": "2026-03-06T09:41:00Z", "timezone": "UTC", "locale": "en-US", "fonts": "${ROOT}/assets/fonts",
//     "measure": { "save": "#save" },                       // named elements, measured on every capture
//     "allow": ["api.example.test"],                         // extra hosts the page may reach
//     "steps": [
//       { "goto": "#home" },                                 // a URL, or a #hash / ?query relative to "url"
//       { "capture": "home", "measure": { "tab": "#tab-settings" } },
//       { "press": "#tab-settings", "capture": "home-pressed" },   // finger down (pressed state), then released
//       { "tap": "text=Reminders" },                         // any Playwright selector
//       { "type": "#name", "text": "Alex", "every": 2, "capture": "name" },   // NN-name.type-01.png …
//       { "animate": "#save", "frames": 6, "ms": 900, "capture": "saving" },  // NN-name.anim-01.png …
//       { "scroll": "#total" }, { "scroll": 400 }, { "wait": 300 }, { "waitFor": ".loaded" }, { "eval": "window.demo = 1" }
//     ] }
// Placeholders: ${BENCH} (this bench), ${ROOT} (the repo), ${FLOW} (the flow file's folder), ${ENV_VAR}.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { fontFaces } from './fonts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.resolve(HERE, '..');
const ROOT = path.resolve(BENCH, '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad2 = (n) => String(n).padStart(2, '0');

const MODES = {
  app: { w: 393, h: 852, top: 59, bottom: 34 },       // a full-screen app: the film draws the status bar over it
  browser: { w: 393, h: 710, top: 0, bottom: 0 },     // a web page: the film draws the status bar and the address bar
};

function loadPlaywright() {
  for (const base of [path.join(BENCH, 'package.json'), path.join(ROOT, 'core', 'node', 'package.json'), process.env.WB_PLAYWRIGHT_FROM, path.join(process.cwd(), 'package.json')].filter(Boolean)) {
    try { return createRequire(base)('playwright'); } catch (e) { /* next */ }
  }
  throw new Error('playwright is not installed: run `npm install` in benches/app-tutorial (or set up core/node)');
}

// ------------------------------------------------------------------------------------------- in the page
// Measures what is visible: text, role and rectangle in CSS px of the viewport. Runs inside the page.
function measureInPage(named) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();
  const r1 = (n) => Math.round(n * 10) / 10;
  const drawn = (el) => typeof el.checkVisibility !== 'function' || el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  // An element counts if part of it, inside the viewport, is what a finger would touch there (not under a sheet or a fixed bar).
  const onScreen = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.right <= 0 || r.top >= vh || r.left >= vw || !drawn(el)) return null;
    const x0 = Math.max(r.left, 0), x1 = Math.min(r.right, vw), y0 = Math.max(r.top, 0), y1 = Math.min(r.bottom, vh);
    for (const fy of [0.5, 0.15, 0.85]) for (const fx of [0.5, 0.15, 0.85]) {
      const top = document.elementFromPoint(Math.min(Math.max(x0 + (x1 - x0) * fx, 0.5), vw - 0.5), Math.min(Math.max(y0 + (y1 - y0) * fy, 0.5), vh - 0.5));
      if (top && (el === top || el.contains(top) || top.contains(el))) return r;
    }
    return null;
  };
  const fullText = (root) => {
    if (root.tagName === 'INPUT' || root.tagName === 'TEXTAREA') return clean(root.value || root.placeholder);
    const parts = []; const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(n) { if (n.nodeType === 1 && (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(n.tagName) || !drawn(n))) return NodeFilter.FILTER_REJECT; return NodeFilter.FILTER_ACCEPT; },
    });
    let n;
    while ((n = walker.nextNode())) {
      if (n.nodeType === 3) { const t = clean(n.nodeValue); if (t) parts.push(t); continue; }
      if (n.tagName === 'INPUT' && !['checkbox', 'radio', 'hidden', 'submit', 'button'].includes(n.type)) { const v = n.type === 'password' && n.value ? '••••••••' : clean(n.value); if (v) parts.push(v); }
      else if (n.tagName === 'TEXTAREA') { const v = clean(n.value); if (v) parts.push(v); }
      else if (n.tagName === 'SELECT') { const v = clean(n.options?.[n.selectedIndex]?.text); if (v) parts.push(v); }
    }
    return clean(parts.join(' '));
  };
  const roleOf = (el) => {
    const tag = el.tagName.toLowerCase(); const role = el.getAttribute('role');
    if (role === 'tab') return 'tab'; if (role === 'switch') return 'switch'; if (role === 'checkbox') return 'checkbox';
    if (role === 'radio' || role === 'option') return 'option'; if (role === 'menuitem') return 'menu';
    if (role === 'dialog' || tag === 'dialog') return 'sheet'; if (role === 'progressbar') return 'progress'; if (role === 'status') return 'status';
    if (tag === 'a') return 'link'; if (tag === 'label') return 'label';
    if (tag === 'input') return el.type === 'checkbox' ? 'checkbox' : el.type === 'radio' ? 'option' : 'field';
    if (tag === 'textarea') return 'field'; if (tag === 'select') return 'select';
    if (/^h[1-6]$/.test(tag) || role === 'heading') return 'heading';
    if (tag === 'summary') return 'button';
    if (tag === 'button' || role === 'button') { if (el.closest('nav') && !el.hasAttribute('aria-pressed')) return 'tab'; return el.hasAttribute('aria-pressed') || el.hasAttribute('aria-checked') ? 'option' : 'button'; }
    if (tag === 'img' || role === 'img' || tag === 'svg') return 'icon';
    if (tag === 'li') return 'listitem';
    if (getComputedStyle(el).cursor === 'pointer') return 'button';
    return 'card';
  };
  const nameOf = (el) => {
    const tag = el.tagName.toLowerCase(); const aria = clean(el.getAttribute('aria-label'));
    if (tag === 'input' || tag === 'textarea') return clean(el.value || aria || el.placeholder || el.name || '');
    if (tag === 'select') return clean(aria || el.options?.[el.selectedIndex]?.text || '');
    if (tag === 'img') return clean(el.getAttribute('alt') || aria || '');
    const t = fullText(el); return (!t && aria ? aria : t).slice(0, 400);
  };
  const entry = (el, r, role, text) => {
    const cs = getComputedStyle(el); const item = { text, role, x: r1(r.x), y: r1(r.y), w: r1(r.width), h: r1(r.height) };
    const rad = parseFloat(cs.borderTopLeftRadius); if (rad > 0) item.radius = Math.min(rad, r.height / 2);
    const aria = clean(el.getAttribute('aria-label')); if (aria && aria !== text) item.label = aria;
    if (el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-checked') === 'true' || el.checked) item.selected = true;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') item.disabled = true;
    if ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.value) item.value = el.type === 'password' ? '••••••••' : el.value;
    if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') item.box = true;
    if (r.left < 0 || r.top < 0 || r.right > vw || r.bottom > vh) item.partial = true;
    return item;
  };

  const candidates = new Set();
  document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, summary, label, [role=button], [role=tab], [role=switch], [role=checkbox], [role=radio], [role=option], [role=menuitem], [role=link], h1, h2, h3, h4, [role=heading], img[alt]:not([alt=""]), svg[aria-label], [role=img][aria-label], dialog[open], [role=dialog], [role=progressbar], [role=status]').forEach((el) => candidates.add(el));
  document.querySelectorAll('li, article, section, [role=row]').forEach((el) => { const r = el.getBoundingClientRect(); if (r.width >= 40 && r.height >= 24 && r.width < vw - 1) candidates.add(el); });
  // Boxes with a body of their own (background and rounded corners): cards, tiles, sheets.
  document.querySelectorAll('div, form, aside').forEach((el) => {
    if (candidates.has(el)) return; const r = el.getBoundingClientRect();
    if (r.width < 60 || r.height < 36 || r.width > vw - 1 || r.bottom <= 0 || r.top >= vh) return;
    const cs = getComputedStyle(el); if (cs.backgroundColor === 'rgba(0, 0, 0, 0)' || cs.backgroundColor === 'transparent' || parseFloat(cs.borderTopLeftRadius) < 6) return;
    candidates.add(el);
  });
  document.querySelectorAll('div, span, p').forEach((el) => {   // tappable things that are not buttons
    if (candidates.has(el) || el.closest('button, a, summary, label')) return; const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 20 || r.bottom <= 0 || r.top >= vh) return;
    if (getComputedStyle(el).cursor === 'pointer') candidates.add(el);
  });

  const elements = []; const seen = new Set();
  for (const el of candidates) {
    const r = onScreen(el); if (!r) continue;
    const role = roleOf(el); const text = nameOf(el);
    if (role === 'card') { const cs = getComputedStyle(el); const body = (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') || (cs.boxShadow && cs.boxShadow !== 'none'); if (!body && el.tagName !== 'LI' && el.tagName !== 'ARTICLE') continue; }
    if (!text && !['field', 'card', 'sheet', 'switch'].includes(role)) continue;
    const key = `${role}|${text}|${Math.round(r.x)}|${Math.round(r.y)}|${Math.round(r.width)}|${Math.round(r.height)}`; if (seen.has(key)) continue; seen.add(key);
    elements.push(entry(el, r, role, text));
  }
  // Named elements: measured from their selectors even when something covers part of them.
  const missing = [];
  for (const [name, sel] of Object.entries(named || {})) {
    const el = document.querySelector(sel); const r = el && el.getBoundingClientRect();
    if (!el || r.width < 1 || r.height < 1) { missing.push(name); continue; }
    const text = nameOf(el); const same = elements.find((e) => Math.abs(e.x - r.x) < 0.6 && Math.abs(e.y - r.y) < 0.6 && Math.abs(e.w - r.width) < 0.6 && Math.abs(e.h - r.height) < 0.6);
    if (same) same.name = name; else elements.push({ ...entry(el, r, roleOf(el), text), name });
  }
  elements.sort((a, b) => a.y - b.y || a.x - b.x);

  // Loose text (for rings around a sentence and for loupes).
  const texts = []; const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let node;
  while ((node = walker.nextNode())) {
    const t = clean(node.nodeValue); const parent = node.parentElement;
    if (!t || !parent || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName) || !drawn(parent)) continue;
    const range = document.createRange(); range.selectNodeContents(node);
    const boxes = [...range.getClientRects()].filter((c) => c.width >= 1 && c.height >= 1); if (!boxes.length) continue;
    const x0 = Math.min(...boxes.map((c) => c.left)), y0 = Math.min(...boxes.map((c) => c.top)), x1 = Math.max(...boxes.map((c) => c.right)), y1 = Math.max(...boxes.map((c) => c.bottom));
    if (y1 <= 0 || y0 >= vh || x1 <= 0 || x0 >= vw) continue;
    const top = document.elementFromPoint(Math.min(Math.max((x0 + x1) / 2, 1), vw - 1), Math.min(Math.max((y0 + y1) / 2, 1), vh - 1));
    if (!top || !(parent === top || parent.contains(top) || top.contains(parent))) continue;
    texts.push({ text: t.slice(0, 200), x: r1(x0), y: r1(y0), w: r1(x1 - x0), h: r1(y1 - y0) });
  }
  document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea, select').forEach((el) => {
    const r = onScreen(el); if (!r) return;
    const v = el.tagName === 'SELECT' ? clean(el.options?.[el.selectedIndex]?.text) : el.type === 'password' && el.value ? '••••••••' : clean(el.value);
    if (v) texts.push({ text: v.slice(0, 200), x: r1(r.x), y: r1(r.y), w: r1(r.width), h: r1(r.height), field: true });
  });
  texts.sort((a, b) => a.y - b.y || a.x - b.x);
  const doc = document.scrollingElement || document.documentElement;
  return { viewport: { w: vw, h: vh, dpr: window.devicePixelRatio }, scroll: { x: Math.round(scrollX), y: Math.round(scrollY), maxY: Math.max(0, doc.scrollHeight - vh), height: doc.scrollHeight }, elements, texts, missing };
}

// What should never be in a final capture. Runs inside the page.
function reviewInPage() {
  const bad = []; const text = document.body.innerText || '';
  for (const [re, what] of [[/\bundefined\b/i, 'undefined'], [/\bNaN\b/, 'NaN'], [/\[object /i, '[object'], [/\bnull\b/i, 'null'], [/\bTypeError\b|\bError:/, 'error'], [/lorem ipsum/i, 'lorem ipsum']]) if (re.test(text)) bad.push(`text "${what}"`);
  const visible = (sel) => [...document.querySelectorAll(sel)].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && (typeof e.checkVisibility !== 'function' || e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })); });
  if (visible('.animate-pulse, [class*="skeleton"], [data-skeleton], [aria-busy="true"]').length) bad.push('loading skeleton');
  for (const t of visible('[data-toast], [class*="toast"], [role="alert"]').map((e) => (e.innerText || '').trim()).filter(Boolean)) bad.push(`notice on screen: "${t.slice(0, 80)}"`);
  return bad;
}

// ------------------------------------------------------------------------------------------- capture session
const CAPTURE_CSS = `*,*::before,*::after{caret-color:transparent!important}html{scrollbar-width:none!important}html,body{overflow-x:clip!important}::-webkit-scrollbar{display:none!important}`;

class Session {
  constructor({ page, cdp, mode, out, measure = {}, log = console.log, number = true }) {
    Object.assign(this, { page, cdp, mode, out, measure, log, number }); this.m = MODES[mode]; this.n = 0; this.captures = []; this.warnings = [];
  }
  async shot(scale = 3) { return this.page.screenshot({ type: 'png', animations: 'allow', scale: scale === 1 ? 'css' : 'device' }); }
  // Waits until the screen stops moving (three identical shots in a row) and fonts are loaded.
  async settle({ extra = 0, max = 4000 } = {}) {
    await this.page.evaluate(() => document.fonts.ready).catch(() => {});
    let prev = null, same = 0; const until = Date.now() + max;
    while (Date.now() < until && same < 3) { const s = await this.shot(1); same = prev && Buffer.compare(prev, s) === 0 ? same + 1 : 0; prev = s; await sleep(70); }
    if (extra) await sleep(extra);
  }
  base(name) { return this.number ? `${pad2(++this.n)}-${name}` : name; }
  // One screen: <base>.png, <base>.json and, when the page scrolls, <base>.full.png with rectangles for the whole page.
  async capture(name, { action = '', measure = {}, full, allow = [], png = null, quick = false, extra = 0, note = '' } = {}) {
    if (!quick && !png) await this.settle({ extra });
    const base = this.base(name); const named = { ...this.measure, ...measure };
    const data = await this.page.evaluate(measureInPage, named);
    if (data.missing.length) this.log(`  ! ${base}: no element for ${data.missing.join(', ')}`);
    if (png) fs.writeFileSync(path.join(this.out, base + '.png'), png); else await this.page.screenshot({ path: path.join(this.out, base + '.png'), animations: 'allow' });
    const json = { viewport: data.viewport, scroll: data.scroll, safeArea: { top: this.m.top, bottom: this.m.bottom }, mode: this.mode, url: this.page.url(), name, action, elements: data.elements, texts: data.texts };
    if (full === true || (full !== false && data.scroll.height > data.viewport.h + 4)) {
      const fullName = base + '.full.png'; const f = await this.fullPage(path.join(this.out, fullName), named);
      json.full = { file: fullName, w: this.m.w, h: f.height, elements: f.elements, texts: f.texts };
    }
    const problems = (await this.page.evaluate(reviewInPage)).filter((p) => !allow.some((q) => p.includes(q)));
    if (problems.length) { json.warnings = problems; this.warnings.push({ capture: base, problems }); this.log(`  ! ${base}: ${problems.join('; ')}`); }
    if (note) json.note = note;
    fs.writeFileSync(path.join(this.out, base + '.json'), JSON.stringify(json, null, 1));
    const main = [...data.elements.filter((e) => e.role === 'heading'), ...data.elements.filter((e) => ['button', 'option', 'link'].includes(e.role))].map((e) => e.text).filter(Boolean).slice(0, 12);
    const item = { order: this.n, name, file: base + '.png', json: base + '.json', full: json.full ? json.full.file : null, action, main };
    this.captures.push(item); this.log(`  ${base}${json.full ? ' (+full)' : ''}`);
    return { item, base };
  }
  // The whole page: the viewport grows to the document height (as if the phone were taller), so fixed headers stay
  // on top and fixed bottom bars at the very bottom, instead of floating mid-page as a fullPage screenshot leaves them.
  async fullPage(file, named) {
    const { height, y } = await this.page.evaluate(() => ({ height: Math.ceil((document.scrollingElement || document.documentElement).scrollHeight), y: scrollY }));
    if (height * 3 > 15000) { await this.page.screenshot({ path: file, fullPage: true, animations: 'allow' }); return { height, elements: null, texts: null }; }
    await this.page.setViewportSize({ width: this.m.w, height: Math.max(height, this.m.h) }); await sleep(300); await this.settle({ max: 2500 });
    await this.page.screenshot({ path: file, animations: 'allow' }); const d = await this.page.evaluate(measureInPage, named);
    await this.page.setViewportSize({ width: this.m.w, height: this.m.h }); await sleep(150); await this.page.evaluate((top) => scrollTo(0, top), y); await sleep(120);
    return { height, elements: d.elements, texts: d.texts };
  }
  async center(sel) { const loc = this.page.locator(sel).first(); await loc.scrollIntoViewIfNeeded(); const b = await loc.boundingBox(); if (!b) throw new Error(`${sel} has no box`); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
  // Finger down without lifting: the pressed state (:active, press animations). Returns the release.
  async press(sel) { const { x, y } = await this.center(sel); await this.page.mouse.move(x, y); await this.page.mouse.down(); await sleep(220); return async () => { await this.page.mouse.up(); }; }
  async tap(sel) { const { x, y } = await this.center(sel); await this.page.mouse.click(x, y); await sleep(120); }
  // Typing at finger pace: one full-resolution shot every `every` letters (NN-name.type-01.png …); the final capture is
  // the last shot, so the app has no time to react (a search with a delay, say).
  async type(name, sel, text, { every = 2, clear = true, action = '', ...rest } = {}) {
    const loc = this.page.locator(sel).first(); await loc.scrollIntoViewIfNeeded(); await loc.click(); if (clear) await loc.fill(''); await sleep(250);
    const base = `${pad2(this.n + 1)}-${name}`; const pieces = []; for (let i = 0; i < text.length; i += every) pieces.push(text.slice(i, i + every));
    if (pieces.length > 1 && pieces[pieces.length - 1].length === 1) pieces[pieces.length - 2] += pieces.pop();
    const frames = []; let last = null; let typed = '';
    for (const [i, piece] of pieces.entries()) { await this.page.keyboard.type(piece, { delay: 15 }); typed += piece; await sleep(40); last = await this.shot(3); const f = `${base}.type-${pad2(i + 1)}.png`; fs.writeFileSync(path.join(this.out, f), last); frames.push({ file: f, text: typed }); }
    const { item } = await this.capture(name, { action: action || `Type "${text}"`, png: last, ...rest });
    const jf = path.join(this.out, item.json); const j = JSON.parse(fs.readFileSync(jf, 'utf8')); j.typing = frames; fs.writeFileSync(jf, JSON.stringify(j, null, 1));
    this.log(`    ${frames.length} typing frames`);
  }
  // An animation the app plays (a spinner, a sheet rising): runs the action and keeps `frames` distinct shots spread
  // over time (NN-name.anim-01.png …), each with its milliseconds since the action.
  async animate(name, action, { frames = 6, ms = 1000, ...rest } = {}) {
    const got = []; let running = true;
    const loop = (async () => { while (running) { const t = Date.now(); const d = await this.shot(3).catch(() => null); if (d) got.push({ t, d }); } })();
    const t0 = Date.now(); await action(); await sleep(ms); running = false; await loop;
    const distinct = []; for (const f of got) if (!distinct.length || Buffer.compare(distinct[distinct.length - 1].d, f.d) !== 0) distinct.push(f);
    let chosen = distinct;
    if (distinct.length > frames) { chosen = []; const a = distinct[0].t, b = distinct[distinct.length - 1].t; for (let i = 0; i < frames; i++) { const goal = a + ((b - a) * i) / (frames - 1); let best = distinct[0]; for (const f of distinct) if (Math.abs(f.t - goal) < Math.abs(best.t - goal)) best = f; if (!chosen.includes(best)) chosen.push(best); } }
    const base = `${pad2(this.n + 1)}-${name}`; const list = chosen.map((f, i) => { const file = `${base}.anim-${pad2(i + 1)}.png`; fs.writeFileSync(path.join(this.out, file), f.d); return { file, ms: Math.max(0, f.t - t0) }; });
    const { item } = await this.capture(name, rest);
    const jf = path.join(this.out, item.json); const j = JSON.parse(fs.readFileSync(jf, 'utf8')); j.animation = { frames: list, ms, shots: got.length, distinct: distinct.length }; fs.writeFileSync(jf, JSON.stringify(j, null, 1));
    this.log(`    ${list.length} animation frames (${got.length} shots, ${distinct.length} distinct)`);
  }
}

// ------------------------------------------------------------------------------------------- browser
async function openBrowser({ mode, url, clock, timezone = 'UTC', locale = 'en-US', allow = [], fonts }) {
  const { chromium } = loadPlaywright(); const m = MODES[mode]; if (!m) throw new Error(`unknown mode ${mode} (app | browser)`);
  const browser = await chromium.launch({ headless: true, args: ['--disable-features=Translate'] });
  const context = await browser.newContext({ viewport: { width: m.w, height: m.h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale, timezoneId: timezone,
    colorScheme: 'light', reducedMotion: 'no-preference', serviceWorkers: 'block', acceptDownloads: false });
  const faces = fontFaces(fonts, (full, f) => `http://wb-fonts.invalid/${encodeURIComponent(f)}`);   // served by the route below (works for http and file pages)
  const css = `${CAPTURE_CSS}\n:root{--safe-top:${m.top}px;--safe-bottom:${m.bottom}px}\n${faces.css}`;
  await context.addInitScript({ content: `(${function (css) {
    const put = () => { const root = document.head || document.documentElement; if (!root) return false; if (document.getElementById('__wb_capture')) return true; const s = document.createElement('style'); s.id = '__wb_capture'; s.textContent = css; root.appendChild(s); return true; };
    if (!put()) new MutationObserver((_, o) => { if (put()) o.disconnect(); }).observe(document, { childList: true, subtree: true });
  }})(${JSON.stringify(css)})` });
  const origin = /^https?:/.test(url) ? new URL(url).host : null; const blocked = [];
  await context.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.host === 'wb-fonts.invalid') { const f = faces.files[decodeURIComponent(u.pathname.slice(1))]; return f ? route.fulfill({ body: fs.readFileSync(f), contentType: 'font/ttf', headers: { 'access-control-allow-origin': '*' } }) : route.abort(); }
    if (['file:', 'data:', 'blob:'].includes(u.protocol) || (origin && u.host === origin) || allow.includes(u.host)) return route.continue();
    blocked.push(`${route.request().method()} ${route.request().url()}`); return route.abort('blockedbyclient');
  });
  // Date.now() and new Date() return the chosen moment; timers and animations keep running (a fully paused clock
  // can leave single-page apps blank).
  if (clock) await context.clock.setFixedTime(new Date(clock));
  const page = await context.newPage(); const cdp = await context.newCDPSession(page);
  if (m.top || m.bottom) await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: m.top, bottom: m.bottom, left: 0, right: 0 } }).catch(() => {});
  return { browser, context, page, cdp, blocked };
}

const expand = (s, vars) => String(s).replace(/\$\{([A-Za-z0-9_]+)\}/g, (_, k) => vars[k] ?? process.env[k] ?? '');
function toUrl(u, baseDir) { if (/^(https?|file):/.test(u)) return u; const p = path.resolve(baseDir, u.replace(/[#?].*$/, '')); return pathToFileURL(p).href + (u.match(/[#?].*$/) || [''])[0]; }
function cleanOut(dir) {   // only the files this tool writes, never anything else in the folder
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (/^\d{2}[a-z]?-.+\.(png|json)$/.test(f) || f === 'manifest.json') fs.rmSync(path.join(dir, f));
}

async function runFlow(file, outArg) {
  const flowDir = path.dirname(path.resolve(file)); const vars = { BENCH, ROOT, FLOW: flowDir };
  const flow = JSON.parse(expand(fs.readFileSync(file, 'utf8'), vars));
  const mode = flow.mode || 'app'; const url = toUrl(flow.url, flowDir);
  const out = path.resolve(outArg || (flow.out ? path.resolve(flowDir, flow.out) : path.join(flowDir, 'captures', flow.name || path.basename(file, '.json'))));
  cleanOut(out); console.log(`capture ${flow.name || path.basename(file)} → ${path.relative(process.cwd(), out)}`);
  const B = await openBrowser({ mode, url, clock: flow.clock, timezone: flow.timezone, locale: flow.locale, allow: flow.allow || [], fonts: flow.fonts });
  const S = new Session({ page: B.page, cdp: B.cdp, mode, out, measure: flow.measure || {} });
  try {
    await B.page.goto(url); await S.settle();
    for (const st of flow.steps || []) {
      if (st.goto) { const target = /^[#?]/.test(st.goto) ? url.replace(/[#?].*$/, '') + st.goto : toUrl(st.goto, flowDir); await B.page.goto(target); await S.settle(); }
      if (st.wait) await sleep(st.wait);
      if (st.waitFor) await B.page.locator(st.waitFor).first().waitFor({ timeout: 10000 });
      if (st.eval) await B.page.evaluate(st.eval);
      if (st.scroll !== undefined) { if (typeof st.scroll === 'number') await B.page.evaluate((y) => scrollTo(0, y), st.scroll); else await B.page.locator(st.scroll).first().scrollIntoViewIfNeeded(); await sleep(250); }
      const opts = { action: st.action || '', measure: st.measure || {}, full: st.full, allow: st.allow || [], note: st.note || '', extra: st.extra || 0 };
      if (st.press) { const release = await S.press(st.press); if (st.capture) await S.capture(st.capture, { ...opts, quick: true, action: opts.action || `Press ${st.press}` }); await release(); await sleep(200); continue; }
      if (st.type) { await S.type(st.capture || 'typing', st.type, st.text || '', { every: st.every || 2, ...opts }); continue; }
      if (st.animate) { await S.animate(st.capture || 'animation', () => S.tap(st.animate), { frames: st.frames || 6, ms: st.ms || 1000, ...opts, action: opts.action || `Tap ${st.animate}` }); continue; }
      if (st.tap) await S.tap(st.tap);
      if (st.capture) await S.capture(st.capture, { ...opts, action: opts.action || (st.tap ? `Tap ${st.tap}` : '') });
    }
  } finally {
    const manifest = { flow: flow.name || path.basename(file), mode, viewport: { w: MODES[mode].w, h: MODES[mode].h, dpr: 3 }, safeArea: { top: MODES[mode].top, bottom: MODES[mode].bottom }, clock: flow.clock || null, url: flow.url, captures: S.captures, warnings: S.warnings, blocked: B.blocked };
    fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
    await B.browser.close();
  }
  console.log(`${S.captures.length} captures${S.warnings.length ? `, ${S.warnings.length} with warnings` : ''}${B.blocked.length ? `, ${B.blocked.length} requests blocked (see manifest.json)` : ''}`);
}

async function runOne(a) {
  const mode = a.mode || 'app'; const url = toUrl(a.url, process.cwd()); const out = path.resolve(a.out || '.'); fs.mkdirSync(out, { recursive: true });
  const measure = Object.fromEntries((a.measure || []).map((s) => { const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1)]; }));
  const B = await openBrowser({ mode, url, clock: a.clock, timezone: a.timezone, locale: a.locale, allow: a.allow || [], fonts: a.fonts });
  if (a.width || a.height) { MODES[mode] = { ...MODES[mode], w: +(a.width || MODES[mode].w), h: +(a.height || MODES[mode].h) }; await B.page.setViewportSize({ width: MODES[mode].w, height: MODES[mode].h }); }
  const S = new Session({ page: B.page, cdp: B.cdp, mode, out, measure, number: false });
  try {
    await B.page.goto(url);
    if (a.wait) { if (/^\d+$/.test(a.wait)) await sleep(+a.wait); else await B.page.locator(a.wait).first().waitFor({ timeout: 15000 }); }
    await S.capture(a.name || 'screen', { full: a.full ? true : undefined });
  } finally { await B.browser.close(); }
  console.log(`→ ${path.join(path.relative(process.cwd(), out) || '.', (a.name || 'screen') + '.png')} + .json${B.blocked.length ? ` (${B.blocked.length} requests blocked)` : ''}`);
}

function parse(argv) {
  const a = { measure: [], allow: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]; if (!k.startsWith('--')) continue; const key = k.slice(2); const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    if (key === 'measure' || key === 'allow') a[key].push(v); else a[key] = v;
  }
  return a;
}

const args = parse(process.argv.slice(2));
if (args.flow) await runFlow(args.flow, args.out);
else if (args.url) await runOne(args);
else { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 30).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(1); }
