#!/usr/bin/env node
// The idea catalogue (ideas.json): one entry per episode with its hook, premise, single message, claim and
// production status. This tool shows the board, checks it, and updates fields.
//
//   node tools/catalogue.mjs                     the board, in production order
//   node tools/catalogue.mjs --check             validate every entry (exit 1 on problems)
//   node tools/catalogue.mjs --set 002 status=scripted [field=value ...]
//
// Status flow: idea → draft (folder created) → scripted (lint passes) → voiced → cut (picture locked)
//              → rendered (final verified) → delivered.   "sample" marks the bundled guiding episode.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BENCH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(BENCH, 'ideas.json');
const ideas = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const claims = JSON.parse(fs.readFileSync(path.join(BENCH, 'claims.json'), 'utf8'));
const STATUS = ['idea', 'draft', 'scripted', 'voiced', 'cut', 'rendered', 'delivered', 'sample', 'dropped'];
const FORMATS = ['ASMR', 'MONO', 'DUO', 'CHAT', 'TYPE', 'LIST', 'DEMO', 'POV', 'CLOCK', 'MORPH', 'FAQ'];
const WORLDS = ['paper', 'brand', 'night', 'kraft'];
const folderOf = (x) => path.join(BENCH, 'episodes', `${x.id}-${x.slug}`);

const args = process.argv.slice(2);
if (args[0] === '--set') {
  const x = ideas.find((i) => i.id === args[1]); if (!x) { console.error(`no idea ${args[1]}`); process.exit(1); }
  for (const kv of args.slice(2)) { const [k, ...v] = kv.split('='); const val = v.join('='); x[k] = /^\d+(\.\d+)?$/.test(val) ? Number(val) : val; }
  if (x.status && !STATUS.includes(x.status)) { console.error(`status must be one of ${STATUS.join(', ')}`); process.exit(1); }
  fs.writeFileSync(FILE, JSON.stringify(ideas, null, 1) + '\n');
  console.log(`${x.id} updated: ${args.slice(2).join(' ')}`);
  process.exit(0);
}
if (args[0] === '--check') {
  const problems = []; const seen = new Set();
  const need = ['id', 'slug', 'title', 'format', 'world', 'duration', 'hook', 'premise', 'message', 'claim', 'voices', 'status'];
  for (const x of ideas) {
    for (const k of need) if (x[k] === undefined || x[k] === '') problems.push(`${x.id || '?'}: missing ${k}`);
    if (!/^\d{3}$/.test(x.id)) problems.push(`${x.id}: id must be three digits`);
    if (!/^[a-z0-9-]+$/.test(x.slug || '')) problems.push(`${x.id}: slug must be lowercase-with-dashes`);
    if (seen.has(x.slug)) problems.push(`${x.id}: slug ${x.slug} repeated`); seen.add(x.slug);
    if (!FORMATS.includes(x.format)) problems.push(`${x.id}: format ${x.format} (use ${FORMATS.join(', ')})`);
    if (!WORLDS.includes(x.world)) problems.push(`${x.id}: world ${x.world} (use ${WORLDS.join(', ')})`);
    if (x.duration < 6 || x.duration > 25) problems.push(`${x.id}: duration ${x.duration} s is outside the 6–25 s format`);
    if (!STATUS.includes(x.status)) problems.push(`${x.id}: status ${x.status} (use ${STATUS.join(', ')})`);
    if (!claims.allowed.some((c) => c.id === x.claim)) problems.push(`${x.id}: claim ${x.claim} is not in claims.json`);
    if (!['idea', 'dropped'].includes(x.status) && !fs.existsSync(folderOf(x))) problems.push(`${x.id}: status ${x.status} but ${path.relative(BENCH, folderOf(x))} does not exist`);
  }
  for (const p of problems) console.log(`  PROBLEM  ${p}`);
  console.log(`${ideas.length} ideas · ${problems.length} problems`);
  process.exit(problems.length ? 1 : 0);
}
const rows = [...ideas].sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
// Columns as wide as their content (titles cut at 40 characters with an ellipsis), always two spaces apart.
const cut = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const cols = [['#', (x) => x.order], ['id', (x) => x.id], ['title', (x) => cut(x.title, 40)], ['format', (x) => x.format], ['world', (x) => x.world],
  ['s', (x) => x.duration], ['status', (x) => x.status], ['folder', (x) => (fs.existsSync(folderOf(x)) ? path.relative(BENCH, folderOf(x)) : '—')]];
const table = [cols.map(([h]) => h), ...rows.map((x) => cols.map(([, f]) => String(f(x) ?? '')))];
const widths = cols.map((_, i) => Math.max(...table.map((r) => r[i].length)));
for (const r of table) console.log(r.map((v, i) => (i === r.length - 1 ? v : v.padEnd(widths[i]))).join('  '));
