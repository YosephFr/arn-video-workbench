#!/usr/bin/env node
// Start an episode from an idea of the catalogue: creates episodes/<id>-<slug>/ with a script.json built
// from the idea (its hook, message and voices as slots) and a film.js copied from the sample episode, then
// marks the idea as "draft".
//
//   node tools/new-episode.mjs 002
//
// Then: write the lines, run the lint, record voices and re-time the scenes (see the README).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BENCH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(BENCH, 'ideas.json');
const ideas = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const id = process.argv[2];
const x = ideas.find((i) => i.id === id);
if (!x) { console.error(`usage: node tools/new-episode.mjs <id>   (ids: ${ideas.map((i) => i.id).join(', ')})`); process.exit(1); }
const dest = path.join(BENCH, 'episodes', `${x.id}-${x.slug}`);
if (fs.existsSync(dest)) { console.error(`${path.relative(process.cwd(), dest)} already exists`); process.exit(1); }
const sample = path.join(BENCH, 'episodes', fs.readdirSync(path.join(BENCH, 'episodes')).sort()[0]);
fs.mkdirSync(dest, { recursive: true });

const voices = {};
for (const v of x.voices || ['narrator']) voices[v] = { provider: 'auto', voice: `\${WB_VOICE_${v.toUpperCase().replace(/[^A-Z0-9]/g, '_')}}`, model: 'eleven_multilingual_v2', speed: 1.05 };
const first = (x.voices || ['narrator'])[0], second = (x.voices || [])[1] || first;
const script = {
  title: x.title,
  idea: x.id,
  format: { width: 1080, height: 1920, fps: 30 },
  language: 'en',
  tail: 4.2,
  voices,
  lines: [
    { id: 'L01', voice: first, text: `[direction] Hook: ${strip(x.hook)}`, start: 0.3 },
    { id: 'L02', voice: first, text: `[direction] Message: ${strip(x.message)}`, after: 'L01', gap: 0.3 },
    { id: 'L03', voice: second, text: '[direction] Proof or payoff, in one line.', after: 'L02', gap: 0.35 },
  ],
  card: { offer: 'Your offer, in one line', sub: 'Its conditions, in small print', cta: 'yourbrand.example' },
  music: { provider: 'procedural', style: x.world === 'night' ? 'ambient' : 'playful', bpm: 108, key: 'A', scale: 'major', gain_db: -20, sections: [{ at: 0, mood: 'intro' }, { at: 'L02', mood: 'main' }, { at: 'L03', mood: 'lift' }] },
};
fs.writeFileSync(path.join(dest, 'script.json'), JSON.stringify(script, null, 2) + '\n');
// The sample's film.js is the starting point: keep its craft, replace its scenes.
const film = fs.readFileSync(path.join(sample, 'film.js'), 'utf8')
  .replace(/^\/\/ 001 · .*$/m, `// ${x.id} · ${x.title} (${x.format}, ${x.world} world). Premise: ${strip(x.premise)}\n// Started from the sample episode: rewrite the scenes for this idea.`)
  .replace(/world: '[a-z]+',/, `world: '${x.world}',`);
fs.writeFileSync(path.join(dest, 'film.js'), film);
x.status = 'draft';
fs.writeFileSync(FILE, JSON.stringify(ideas, null, 1) + '\n');
console.log(`episode → ${path.relative(process.cwd(), dest)} (idea ${x.id} is now "draft")`);
console.log('next: write the lines in script.json, then node tools/lint-script.mjs ' + path.relative(process.cwd(), dest));

function strip(s) { return String(s || '').replace(/^\[|\]$/g, ''); }
