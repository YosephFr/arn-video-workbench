#!/usr/bin/env python3
"""Voice casting by audition: pick the best take of every line.

    python3 tools/audition.py <piece> [--generate] [--takes 3] [--judge none|openai|gemini] [--rounds 3] [--lines L01,L02]

1. --generate records the takes first with the workbench (core/bin/wb voice <piece> --takes N): 2 or 3 per line.
2. Every take is transcribed (OPENAI_API_KEY) and compared word by word with the script: a take that changes,
   drops or adds words beyond a small tolerance is out (fidelity).
3. A take must end its sentence: the last scripted words are in the transcript and the audio fades instead of
   stopping mid-word (complete endings), and it must not be whispered (voiced fraction of its speech).
4. Among the takes that pass, an optional audio judge (OpenAI or Gemini) listens to them in several shuffled
   rounds, blind, because judges favour takes by the order they hear them; votes are tallied. Without a judge,
   the closest transcript with the cleanest ending wins.
Writes voice/selection.json (read by `wb timeline`) and voice/audition.json (every take, every measure, why).
Listen to the chosen takes anyway: a judge does not replace the ear.
"""
import json
import os
import random
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import speech  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
JUDGE_PROMPT = (
    'You are casting the narrator of a short product progress video for partners and stakeholders. '
    'Line to be said (text in square brackets is a performance direction and must never be read aloud): "{text}". '
    'The takes follow, labelled {labels}. Choose the one that (1) says every word exactly, (2) ends the sentence '
    'completely and naturally, without a clipped or rising ending, (3) sounds confident, warm and natural at a full '
    'speaking voice, never whispered, (4) has no artefacts, breaths or glitches. '
    'Answer with JSON only: {{"best": "<label>", "why": "<one short sentence>"}}')


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def judge_openai(text, files):
    key = os.environ.get('OPENAI_API_KEY')
    labels = [chr(65 + i) for i in range(len(files))]
    content = [{'type': 'text', 'text': JUDGE_PROMPT.format(text=text, labels=', '.join(labels))}]
    for lab, f in zip(labels, files):
        content += [{'type': 'text', 'text': f'Take {lab}:'}, {'type': 'input_audio', 'input_audio': {'data': speech.b64(f), 'format': 'wav'}}]
    out = speech.post_json('https://api.openai.com/v1/chat/completions',
                           {'model': os.environ.get('WB_JUDGE_OPENAI_MODEL', 'gpt-audio-1.5'), 'modalities': ['text'],
                            'messages': [{'role': 'user', 'content': content}]}, {'Authorization': f'Bearer {key}'})
    return out['choices'][0]['message']['content'], labels


def judge_gemini(text, files):
    key = os.environ.get('GEMINI_API_KEY')
    labels = [chr(65 + i) for i in range(len(files))]
    parts = [{'text': JUDGE_PROMPT.format(text=text, labels=', '.join(labels))}]
    for lab, f in zip(labels, files):
        parts += [{'text': f'Take {lab}:'}, {'inline_data': {'mime_type': 'audio/wav', 'data': speech.b64(f)}}]
    model = os.environ.get('WB_JUDGE_GEMINI_MODEL', 'gemini-2.5-flash')
    out = speech.post_json(f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}',
                           {'contents': [{'parts': parts}], 'generationConfig': {'responseMimeType': 'application/json'}}, {}, timeout=90)
    return out['candidates'][0]['content']['parts'][0]['text'], labels


def blind_vote(kind, text, takes, files, rounds, cache):
    """Several rounds with the takes in a different order each time; returns {take: votes} and the reasons."""
    votes, why = {k: 0 for k in takes}, []
    rng = random.Random(7)
    for r in range(rounds):
        order = takes[:]
        rng.shuffle(order)
        key = f'{kind}|{text}|' + '|'.join(f'{k}:{os.path.getmtime(files[k]):.0f}' for k in order)
        if key not in cache:
            try:
                raw, labels = (judge_openai if kind == 'openai' else judge_gemini)(text, [files[k] for k in order])
                d = json.loads(raw[raw.index('{'):raw.rindex('}') + 1])
                cache[key] = {'best': order[labels.index(d['best'].strip()[0].upper())], 'why': d.get('why', '')}
            except Exception as e:  # noqa: BLE001 - one failed round just does not vote
                print(f'    judge round {r + 1} failed: {str(e)[:120]}', file=sys.stderr)
                continue
        votes[cache[key]['best']] += 1
        why.append(cache[key]['why'])
    return votes, why


def main():
    if len(sys.argv) < 2 or sys.argv[1].startswith('--'):
        sys.exit(__doc__)
    pd = os.path.abspath(sys.argv[1])
    script = json.load(open(os.path.join(pd, 'script.json')))
    language = script.get('language', 'en')
    takes_n = int(arg('--takes', 3))
    judge = arg('--judge', 'none')
    rounds = int(arg('--rounds', 3))
    only = set(arg('--lines', '').split(',')) - {''}
    if '--generate' in sys.argv:
        subprocess.run([os.path.join(ROOT, 'core', 'bin', 'wb'), 'voice', pd, '--takes', str(takes_n)] + sorted(only), check=True)
    if judge == 'openai' and not os.environ.get('OPENAI_API_KEY') or judge == 'gemini' and not os.environ.get('GEMINI_API_KEY'):
        print(f'no key for the {judge} judge: deciding by the measures alone', file=sys.stderr)
        judge = 'none'
    if not os.environ.get('OPENAI_API_KEY'):
        print('OPENAI_API_KEY is not set: no transcripts, so fidelity cannot be checked (listen to every take)', file=sys.stderr)
    vdir = os.path.join(pd, 'voice')
    cache_path = os.path.join(vdir, 'judge-cache.json')
    cache = json.load(open(cache_path)) if os.path.exists(cache_path) else {}
    sel_path = os.path.join(vdir, 'selection.json')
    selection = json.load(open(sel_path)) if os.path.exists(sel_path) else {}
    report = {}
    for line in script['lines']:
        lid = line['id']
        if only and lid not in only:
            continue
        files = {}
        k = 0
        while os.path.exists(os.path.join(vdir, f'{lid}__t{k}.wav')):
            files[k] = os.path.join(vdir, f'{lid}__t{k}.wav')
            k += 1
        if not files:
            print(f'{lid}: no takes (run with --generate, or core/bin/wb voice {pd} --takes {takes_n})')
            continue
        ref = speech.words(line['text'], language)
        tol = speech.tolerance(len(ref))
        rows = []
        for k, f in files.items():
            x = speech.decode16(f)
            row = {'take': k, 'seconds': round(len(x) / speech.SR, 2), 'voiced': speech.voicing(x), **speech.ending(x)}
            tr = speech.transcribe(f, language)
            if tr is not None:
                hyp = speech.words(tr['text'], language)
                row['transcript'] = tr['text']
                row['diff'] = speech.word_diff(ref, hyp)
                row['ends_complete'] = hyp[-2:] == ref[-2:] if len(ref) >= 2 else hyp[-1:] == ref[-1:]
            row['silent'] = row['voiced'] is None
            row['whispered'] = row['voiced'] is not None and row['voiced'] < 0.62
            rows.append(row)
        ok = [r for r in rows if not r['silent'] and not r['whispered'] and not r.get('cut')
              and r.get('diff', 0) <= tol and r.get('ends_complete', True)]
        pool = ok or rows
        why = 'passes fidelity, ending and voice checks' if ok else 'no take passes every check: closest one; record again'
        if judge != 'none' and len(pool) > 1:
            votes, reasons = blind_vote(judge, line['text'], [r['take'] for r in pool], files, rounds, cache)
            best = max(pool, key=lambda r: (votes[r['take']], -r.get('diff', 0), -(r['tail_db'] or 0)))['take']
            why = f'{judge} judge, {votes[best]}/{rounds} blind votes' + (f': {reasons[0]}' if reasons else '')
        else:
            best = min(pool, key=lambda r: (r.get('diff', 0), not r.get('ends_complete', True), r['tail_db'] if r['tail_db'] is not None else 0, -(r['voiced'] or 0)))['take']
        selection[lid] = best
        report[lid] = {'chosen': best, 'why': why, 'tolerance': tol, 'takes': rows}
        flags = ' '.join(f"t{r['take']}:" + ','.join(x for x, on in [('silent', r['silent']), ('whisper', r['whispered']), ('cut', r.get('cut')),
                         (f"diff{r.get('diff')}", r.get('diff', 0) > tol), ('ending', not r.get('ends_complete', True))] if on) for r in rows
                         if r['silent'] or r['whispered'] or r.get('cut') or r.get('diff', 0) > tol or not r.get('ends_complete', True))
        print(f'{lid:5} t{best}  {why}' + (f'   [{flags}]' if flags else ''))
    json.dump(selection, open(sel_path, 'w'), indent=1)
    json.dump(report, open(os.path.join(vdir, 'audition.json'), 'w'), indent=1, ensure_ascii=False)
    json.dump(cache, open(cache_path, 'w'), indent=1, ensure_ascii=False)
    print(f'selection → {sel_path}  (then: core/bin/wb timeline {pd})')


if __name__ == '__main__':
    main()
