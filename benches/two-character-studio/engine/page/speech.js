// Lip sync from word timings. timeline.json gives every word's start and end; letters are spread over each word's span
// (vowels a little longer), mapped to phones with simple spelling rules per language, and the mouth shape at time t
// is a coarticulated blend: every phone pulls the mouth toward its shape with a dominance that falls off outside its
// own span (Cohen–Massaro). Vowels set the jaw, m/b/p win briefly and close the lips completely, tongue and palate
// consonants are weak and mostly inherit the vowels around them. Pauses close the mouth.
// The result is then gated by the voice loudness envelope (director.js), so silence never shows a moving mouth.

const SHAPES = {
  rest: { open:0.00, wide:0.00, round:0.00 },
  A:    { open:0.80, wide:0.30, round:0.00 },
  E:    { open:0.48, wide:0.62, round:0.00 },
  I:    { open:0.28, wide:0.85, round:0.00 },
  O:    { open:0.55, wide:0.00, round:0.75 },
  U:    { open:0.24, wide:0.00, round:1.00 },
  M:    { open:0.00, wide:0.05, round:0.00 },   // m b p: lips pressed
  F:    { open:0.10, wide:0.35, round:0.00 },   // f v: lower lip to the teeth
  T:    { open:0.30, wide:0.45, round:0.00 },   // t d n l s z th: teeth showing, jaw a little up
  K:    { open:0.38, wide:0.25, round:0.00 },   // k g ng
  CH:   { open:0.22, wide:0.00, round:0.55 },   // ch sh j
  Y:    { open:0.24, wide:0.55, round:0.00 },
  R:    { open:0.22, wide:0.10, round:0.35 },   // English r: a little rounded
  W:    { open:0.16, wide:0.00, round:0.90 },
};
// dominance: [strength, fall-off in seconds outside the phone's span]
const DOM = { vowel:[1.0, 0.075], M:[9.0, 0.030], F:[3.0, 0.035], weak:[0.35, 0.05], CH:[1.2, 0.05], W:[1.6, 0.05], rest:[2.0, 0.07] };
const VOWEL_W = 1.35, CONS_W = 0.8;

// letters of a word spread over [start, end], vowels a bit longer than consonants
function spreadWord(w){
  const letters = [...w.text.toLowerCase()].filter(ch => /\p{L}|\d/u.test(ch));
  if (!letters.length) return [];
  const wt = ch => /[aeiouyáéíóúü]/.test(ch) ? VOWEL_W : CONS_W;
  const total = letters.reduce((a, ch) => a + wt(ch), 0), span = Math.max(0.04, w.end - w.start);
  let t = w.start; const out = [];
  for (const ch of letters){ const d = span*wt(ch)/total; out.push({ ch, t0:t, t1:t + d }); t += d; }
  return out;
}

// ---------------------------------------------------------------- spelling -> phones
function phonesEnglish(L){
  const ph = [], s = L.map(c => c.ch), n = s.length;
  const add = (v, a, b, kind) => ph.push({ v, t0:L[a].t0, t1:L[b].t1, kind });
  for (let i = 0; i < n; i++){
    const c = s[i], nx = s[i + 1] || '', nn = s[i + 2] || '';
    const two = c + nx;
    if (c === 'h') continue;
    if (two === 'th'){ add('T', i, i + 1, 'weak'); i++; continue; }
    if (two === 'sh' || two === 'ch' || two === 'zh'){ add('CH', i, i + 1, 'CH'); i++; continue; }
    if (two === 'ph'){ add('F', i, i + 1, 'F'); i++; continue; }
    if (two === 'gh'){ i++; continue; }
    if (two === 'wh'){ add('W', i, i + 1, 'W'); i++; continue; }
    if (two === 'qu'){ add('K', i, i, 'weak'); add('W', i + 1, i + 1, 'W'); i++; continue; }
    if (two === 'ck' || two === 'ng'){ add('K', i, i + 1, 'weak'); i++; continue; }
    if (two === 'oo'){ add('U', i, i + 1, 'vowel'); i++; continue; }
    if (two === 'ou' || two === 'ow'){ add('A', i, i, 'vowel'); add('O', i + 1, i + 1, 'vowel'); i++; continue; }
    if (two === 'ee' || two === 'ea' || two === 'ie' || two === 'ey'){ add('I', i, i + 1, 'vowel'); i++; continue; }
    if (two === 'ai' || two === 'ay'){ add('E', i, i + 1, 'vowel'); i++; continue; }
    if (two === 'oa' || two === 'au' || two === 'aw'){ add('O', i, i + 1, 'vowel'); i++; continue; }
    if (two === 'oi' || two === 'oy'){ add('O', i, i, 'vowel'); add('I', i + 1, i + 1, 'vowel'); i++; continue; }
    if (c === 'e' && i === n - 1 && n > 2 && !/[aeiou]/.test(s[i - 1])) continue;      // silent final e
    if ('mbp'.includes(c)){ add('M', i, i, 'M'); continue; }
    if ('fv'.includes(c)){ add('F', i, i, 'F'); continue; }
    if (c === 'w'){ add('W', i, i, 'W'); continue; }
    if (c === 'r'){ add('R', i, i, 'weak'); continue; }
    if (c === 'j'){ add('CH', i, i, 'CH'); continue; }
    if (c === 'y'){ /[aeiou]/.test(nx) ? add('Y', i, i, 'weak') : add('I', i, i, 'vowel'); continue; }
    if (c === 'a'){ add('A', i, i, 'vowel'); continue; }
    if (c === 'e'){ add('E', i, i, 'vowel'); continue; }
    if (c === 'i'){ add(nx && nn === 'e' ? 'A' : 'I', i, i, 'vowel'); continue; }    // "time", "like": the long i opens
    if (c === 'o'){ add('O', i, i, 'vowel'); continue; }
    if (c === 'u'){ add(/[aeiou]/.test(nx) ? 'W' : 'A', i, i, nx && /[aeiou]/.test(nx) ? 'W' : 'vowel'); continue; }
    if ('kgqx'.includes(c) || (c === 'c' && !/[eiy]/.test(nx))){ add('K', i, i, 'weak'); continue; }
    add('T', i, i, 'weak');                       // t d n l s z c(soft) and anything else
  }
  return ph;
}
function phonesSpanish(L){
  const ph = [], s = L.map(c => c.ch), V = { a:'A', á:'A', e:'E', é:'E', i:'I', í:'I', o:'O', ó:'O', u:'U', ú:'U', ü:'U' };
  const add = (v, a, b, kind) => ph.push({ v, t0:L[a].t0, t1:L[b].t1, kind });
  for (let i = 0; i < s.length; i++){
    const c = s[i], nx = s[i + 1] || '';
    if (c === 'h') continue;
    if (V[c]){ if (c === 'u' && (s[i - 1] === 'q' || (s[i - 1] === 'g' && /[eéií]/.test(nx)))) continue; add(V[c], i, i, 'vowel'); continue; }
    if (c === 'c' && nx === 'h'){ add('CH', i, i + 1, 'CH'); i++; continue; }
    if (c === 'l' && nx === 'l'){ add('Y', i, i + 1, 'weak'); i++; continue; }
    if (c === 'r' && nx === 'r'){ add('T', i, i + 1, 'weak'); i++; continue; }
    if (c === 'y'){ /[aeiouáéíóú]/.test(nx) ? add('Y', i, i, 'weak') : add('I', i, i, 'vowel'); continue; }
    if ('mbpv'.includes(c) || (c === 'n' && 'bpmv'.includes(nx))){ add('M', i, i, 'M'); continue; }
    if (c === 'f'){ add('F', i, i, 'F'); continue; }
    if ('kgjqx'.includes(c) || (c === 'c' && !/[eéií]/.test(nx))){ add('K', i, i, 'weak'); continue; }
    add('T', i, i, 'weak');
  }
  return ph;
}
function phonesGeneric(L){
  return L.map(c => /[aeiouáéíóúàèìòùäëïöü]/.test(c.ch) ? { v:{ a:'A', e:'E', i:'I', o:'O', u:'U' }[c.ch.normalize('NFD')[0]] || 'A', t0:c.t0, t1:c.t1, kind:'vowel' }
                                                      : 'mbp'.includes(c.ch) ? { v:'M', t0:c.t0, t1:c.t1, kind:'M' } : { v:'T', t0:c.t0, t1:c.t1, kind:'weak' });
}

// phones of one spoken line, with rests at punctuation pauses and silence before and after
export function phonesForLine(words, lang = 'en', lead = 0.04){
  const fn = lang.startsWith('es') ? phonesSpanish : lang.startsWith('en') ? phonesEnglish : phonesGeneric;
  const ph = [];
  words.forEach((w, k) => {
    const L = spreadWord(w);
    if (L.length) ph.push(...fn(L));
    const next = words[k + 1];
    if (next && next.start - w.end > 0.12) ph.push({ v:'rest', t0:w.end + 0.02, t1:next.start - 0.02, kind:'rest' });   // pauses close the mouth
  });
  for (const p of ph){ p.t0 -= lead; p.t1 -= lead; }            // lips move a little before the sound
  if (ph.length){
    const a = ph[0].t0, b = ph[ph.length - 1].t1;
    ph.unshift({ v:'rest', t0:a - 0.6, t1:a - 0.02, kind:'rest' });
    ph.push({ v:'rest', t0:b + 0.04, t1:b + 0.6, kind:'rest' });
  }
  return ph.sort((x, y) => x.t0 - y.t0);
}

// mouth shape at time t from the phone lists of every line
export function mouthAt(phoneLists, t){
  let W = 0; const m = { open:0, wide:0, round:0 };
  for (const ph of phoneLists){
    if (!ph.length || t < ph[0].t0 - 0.3 || t > ph[ph.length - 1].t1 + 0.3) continue;
    for (const p of ph){
      if (p.t1 < t - 0.3 || p.t0 > t + 0.3) continue;
      const [alpha, s] = DOM[p.kind], core = 0.25*(p.t1 - p.t0);
      const tau = Math.max(0, Math.abs(t - (p.t0 + p.t1)/2) - core);
      const d = alpha*Math.exp(-((tau/s)**2));
      const S = SHAPES[p.v] || SHAPES.rest;
      m.open += d*S.open; m.wide += d*S.wide; m.round += d*S.round; W += d;
    }
  }
  if (W < 1e-4) return { ...SHAPES.rest };
  return { open:m.open/W, wide:m.wide/W, round:m.round/W };
}

// a loudness envelope from word timings, for silent placeholder voices: 1 inside words with a soft dip between
// syllable-sized chunks, so the mouth and the orb still move in a timing-only preview
export function syntheticEnvelope(words, t0, t1, rate = 50){
  const n = Math.max(1, Math.ceil((t1 - t0)*rate)), env = new Array(n).fill(0);
  for (const w of words){
    const syl = Math.max(1, Math.round((w.text.replace(/[^aeiouy]/gi, '').length || 1)*0.9));
    for (let i = Math.floor((w.start - t0)*rate); i < Math.ceil((w.end - t0)*rate); i++){
      if (i < 0 || i >= n) continue;
      const u = ((i/rate + t0) - w.start)/Math.max(0.05, w.end - w.start);
      env[i] = Math.max(env[i], 0.55 + 0.45*Math.abs(Math.sin(Math.PI*u*syl)));
    }
  }
  return env;
}
