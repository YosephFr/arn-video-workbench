#!/usr/bin/env node
// Content gate for a progress piece, before any voice is recorded and again before delivery.
//
//   node tools/check-claims.mjs <piece> [--strict]
//
// Checks, from script.json, evidence/claims.json, the film's on-screen copy and the captures:
//   - every line declares its claims ([] for brand lines); every claim exists, is live (in production) or approved
//     (by a provider: public listing, console), and has at least one checkable evidence item (commit, deploy,
//     release, ticket, query, store, console, doc) whose ref is filled in;
//   - evidence dates fall inside the piece's window;
//   - narration and on-screen copy are impersonal: no second person, no team names (evidence `forbidden`), and the
//     captures do not show those names either;
//   - every line is a complete sentence (capital first letter, final . ! ? or …) and numbers are written as words.
// Unfilled [slots] are warnings; --strict turns every warning into an error (use it before delivery).
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadTimeline, makeAnchors } from '../engine/lib/timeline.mjs'

const argv = process.argv.slice(2)
const strict = argv.includes('--strict')
const piece = resolve(argv.find((a) => !a.startsWith('--')) || '.')
const errors = [], warnings = []
const err = (m) => errors.push(m), warn = (m) => warnings.push(m)

const script = JSON.parse(readFileSync(join(piece, 'script.json'), 'utf8'))
const evFile = join(piece, 'evidence', 'claims.json')
const ev = existsSync(evFile) ? JSON.parse(readFileSync(evFile, 'utf8')) : null
if (!ev) err('evidence/claims.json is missing: every claim needs its evidence')
const claims = new Map((ev?.claims || []).map((c) => [c.id, c]))
const KINDS = new Set(['commit', 'deploy', 'release', 'ticket', 'query', 'store', 'console', 'doc'])
const slot = (s) => /\[[^\]]*\]/.test(String(s ?? ''))
const spoken = (t) => t.replace(/\[[^\]]*\]/g, ' ').replace(/\*/g, '').replace(/\s+/g, ' ').trim()

const SECOND = ev?.second_person || ['you', 'your', 'yours', "you're", 'youre', "you've", "you'll", 'yourself', 'yourselves']
const secondRe = new RegExp(`(^|[^\\p{L}'])(${SECOND.map((w) => w.replace(/'/g, "['’]")).join('|')})(?=$|[^\\p{L}'])`, 'iu')
const forbidden = (ev?.forbidden || []).filter((n) => !slot(n))
const forbiddenRe = forbidden.length ? new RegExp(`(^|[^\\p{L}])(${forbidden.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?=$|[^\\p{L}])`, 'iu') : null

// ---- the lines
const used = new Set()
for (const line of script.lines) {
  const text = spoken(line.text)
  if (!Array.isArray(line.claims)) warn(`${line.id}: no "claims" list (use [] for brand lines that state no fact)`)
  for (const id of line.claims || []) {
    used.add(id)
    const c = claims.get(id)
    if (!c) { err(`${line.id}: claim ${id} is not in evidence/claims.json`); continue }
  }
  if (!/^[\p{Lu}\d¿¡"“]/u.test(text)) warn(`${line.id}: does not start like a sentence: "${text.slice(0, 40)}"`)
  if (!/[.!?…]["”»]?$/.test(text)) err(`${line.id}: not a complete sentence (no final . ! ? …): "${text.slice(-40)}"`)
  if (/\d/.test(text)) warn(`${line.id}: has digits; write numbers as words so the captions match the voice`)
  if (secondRe.test(text)) err(`${line.id}: second person in the narration ("${text.match(secondRe)[2]}"): keep it impersonal`)
  if (forbiddenRe && forbiddenRe.test(text)) err(`${line.id}: names "${text.match(forbiddenRe)[2]}" (team names never go in the narration)`)
}

// ---- the claims
const win = ev?.window || script.window || {}
const inWindow = (at) => {
  const d = Date.parse(at); if (Number.isNaN(d) || !win.from || !win.to) return true
  return d >= Date.parse(win.from) && d <= Date.parse(win.to) + 86400000
}
for (const c of claims.values()) {
  if (!used.has(c.id)) warn(`${c.id}: not used by any line ("${c.says}")`)
  if (!['live', 'approved'].includes(c.status)) err(`${c.id}: status "${c.status}" — only what is live in production (or approved by the provider) goes in a video`)
  const items = c.evidence || []
  if (!items.length) err(`${c.id}: no evidence`)
  for (const e of items) {
    if (!KINDS.has(e.kind)) warn(`${c.id}: evidence kind "${e.kind}" is not one of ${[...KINDS].join(', ')}`)
    if (!e.ref || slot(e.ref)) warn(`${c.id}: ${e.kind} evidence not filled in yet (${e.ref || 'empty'})`)
    if (e.at && !slot(e.at) && !inWindow(e.at)) warn(`${c.id}: ${e.kind} at ${e.at} is outside the window ${win.from} → ${win.to}`)
  }
}

// ---- on-screen copy (the film) and the captures
const screenTexts = []
try {
  const filmFile = ['film.mjs', 'film.js'].map((f) => join(piece, f)).find(existsSync)
  if (filmFile) {
    const anchors = existsSync(join(piece, 'timeline.json')) ? makeAnchors(loadTimeline(piece)) : new Proxy({}, { get: () => () => 0 })
    const spec = (await import(pathToFileURL(filmFile).href)).default({ ...anchors, T: {}, script })
    // Every string a section shows; anchors, ids and capture names are not copy.
    const SKIP = new Set(['at', 'to', 'from', 'el', 'capture', 'captures', 'type', 'icon', 'kind', 'transition', 'frame', 'url', 'revealAt', 'countAt', 'landAt', 'flipAt', 'heroAt', 'tone', 'lead'])
    const walk = (o, path, key, parent) => {
      if (typeof o === 'string') { if (!SKIP.has(key) && !((key === 'before' || key === 'after') && parent !== 'labels')) screenTexts.push([path, o]); return }
      if (Array.isArray(o)) { o.forEach((x, i) => walk(x, `${path}[${i}]`, key, parent)); return }
      if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`, k, key)
    }
    walk(spec.sections, 'sections', 'sections', null)
  }
} catch (e) { warn(`could not read the film's on-screen copy (${e.message.split('\n')[0]})`) }
for (const [path, s] of screenTexts) {
  if (secondRe.test(s)) err(`on screen, ${path}: second person ("${s}")`)
  if (forbiddenRe && forbiddenRe.test(s)) err(`on screen, ${path}: names "${s.match(forbiddenRe)[2]}"`)
}
const capDirs = [join(piece, 'captures')]
for (const dir of capDirs.filter(existsSync)) {
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json') && x !== 'manifest.json')) {
    const meta = JSON.parse(readFileSync(join(dir, f), 'utf8'))
    const hit = forbiddenRe && (meta.elements || []).find((e) => forbiddenRe.test(e.text))
    if (hit) err(`capture ${f}: shows "${hit.text.match(forbiddenRe)[2]}" — hide it (capture.mjs "hide") or use other demo data`)
    if ((meta.problems || []).length) warn(`capture ${f}: the page logged ${meta.problems.length} errors while capturing`)
  }
}

// ---- report
const lines = script.lines.length, nClaims = claims.size
console.log(`${lines} lines, ${nClaims} claims, ${screenTexts.length} on-screen texts checked`)
for (const e of errors) console.log(`  error    ${e}`)
for (const w of warnings) console.log(`  ${strict ? 'error  ' : 'warning'}  ${w}`)
const fail = errors.length || (strict && warnings.length)
console.log(fail ? 'not ready' : warnings.length ? 'ok with warnings (fill the slots, then run with --strict)' : 'ok')
process.exit(fail ? 1 : 0)
