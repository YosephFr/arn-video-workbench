#!/usr/bin/env node
// Check an episode's script against what the product can really claim (claims.json) and the rules that
// keep ads approvable and voices clean. Run it before recording voices, and again before delivery.
//
//   node tools/lint-script.mjs episodes/002-slug         exit 1 on ERRORS; WARNINGS never block
//   node tools/lint-script.mjs --all                     every episode folder
//
// Checks: forbidden claims and competitor names (errors), risky wording (warnings), whisper-prone direction
// tags (errors), the idea's claim id exists in claims.json, digits in spoken text (write numbers as words so
// captions match the voice), lines without a [direction], the hook starting late, and the spoken length
// against the series' 6–25 s format. The end-card copy (script.json "card") is checked like the lines.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BENCH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const claims = JSON.parse(fs.readFileSync(path.join(BENCH, 'claims.json'), 'utf8'));
const ideas = JSON.parse(fs.readFileSync(path.join(BENCH, 'ideas.json'), 'utf8'));

const flat = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const spoken = (s) => String(s).replace(/\[[^\]]*\]/g, ' ').replace(/\*/g, '').replace(/\s+/g, ' ').trim();
const WORDS_PER_SECOND = 2.7;   // compressed ad delivery; adjust if your voices are slower

function lint(dir) {
  const errs = [], warns = [];
  const scriptFile = path.join(dir, 'script.json');
  if (!fs.existsSync(scriptFile)) return { errs: [`${dir}: no script.json`], warns };
  const s = JSON.parse(fs.readFileSync(scriptFile, 'utf8'));
  const id = s.idea || path.basename(dir).slice(0, 3);
  const idea = ideas.find((x) => x.id === id);
  if (!idea) warns.push(`no idea ${id} in ideas.json (set "idea" in script.json)`);
  else if (!claims.allowed.some((c) => c.id === idea.claim)) errs.push(`idea ${id}: claim "${idea.claim}" is not in claims.json "allowed"`);
  const texts = (s.lines || []).map((l) => ({ where: l.id, raw: l.text, voice: l.voice }));
  for (const [k, v] of Object.entries(s.card || {})) if (typeof v === 'string') texts.push({ where: `card.${k}`, raw: v, card: true });
  const ids = new Set(); let words = 0;
  for (const l of s.lines || []) {
    if (ids.has(l.id)) errs.push(`${l.id}: duplicated id`); ids.add(l.id);
    if (!s.voices || !s.voices[l.voice]) errs.push(`${l.id}: voice "${l.voice}" is not declared in "voices"`);
  }
  for (const x of texts) {
    const said = spoken(x.raw); const f = flat(x.raw);
    if (!x.card) words += said.split(/\s+/).filter(Boolean).length;
    for (const r of claims.forbidden) if (new RegExp(r.pattern, 'i').test(f)) errs.push(`${x.where}: ${r.why}  ← "${said}"`);
    for (const r of claims.warn || []) if (new RegExp(r.pattern, 'i').test(f)) warns.push(`${x.where}: ${r.why}  ← "${said}"`);
    for (const c of claims.competitors || []) { const n = flat(c).replace(/[\[\]]/g, '').trim(); if (n && !/^(competitor name|another competitor)$/.test(n) && f.includes(n)) errs.push(`${x.where}: names a competitor ("${c}")`); }
    if (!x.card && /\d/.test(said)) warns.push(`${x.where}: digits in spoken text; write numbers as words so captions match the voice  ← "${said}"`);
    if (!x.card && !/\[[^\]]+\]/.test(x.raw)) warns.push(`${x.where}: no [direction]; a performance hint improves the take`);
  }
  const lines = s.lines || [];
  if (lines.length && (lines[0].start ?? 0) > 0.6) warns.push(`the first line starts at ${lines[0].start} s: the hook must land in the first two seconds`);
  const est = words / WORDS_PER_SECOND; const total = est + (s.tail ?? 2.5) + 0.3 * Math.max(0, lines.length - 1);
  if (total > 25) warns.push(`estimated length ${total.toFixed(1)} s (voice ≈ ${est.toFixed(1)} s): longer than the 6–25 s format; cut a line`);
  if (total < 6) warns.push(`estimated length ${total.toFixed(1)} s: shorter than the format's 6 s`);
  if (idea && idea.message && /^\[/.test(idea.message)) warns.push(`idea ${id}: "message" is still a placeholder; write the single message first`);
  if (!s.card || !s.card.offer) warns.push('no end-card copy: add "card": { "offer", "sub", "cta" } to script.json');
  return { errs, warns, words, est: total, title: s.title };
}

const arg = process.argv[2];
if (!arg) { console.log('usage: node tools/lint-script.mjs <episode folder> | --all'); process.exit(1); }
const dirs = arg === '--all' ? fs.readdirSync(path.join(BENCH, 'episodes')).map((d) => path.join(BENCH, 'episodes', d)).filter((d) => fs.statSync(d).isDirectory()) : [path.resolve(arg)];
let bad = 0;
for (const d of dirs) {
  const r = lint(d);
  console.log(`\n${path.relative(process.cwd(), d)}${r.title ? `  · ${r.title}` : ''}`);
  for (const e of r.errs) console.log(`  ERROR    ${e}`);
  for (const w of r.warns) console.log(`  WARNING  ${w}`);
  if (r.words !== undefined) console.log(`  ${r.words} spoken words, ≈ ${r.est.toFixed(1)} s with the end card · ${r.errs.length} errors, ${r.warns.length} warnings`);
  if (r.errs.length) bad++;
}
process.exit(bad ? 1 : 0);
