#!/usr/bin/env python3
"""Direction plan for the two-character studio.

    python3 tools/plan.py <piece>          (render.mjs runs it automatically when plan.json is stale)

Reads <piece>/script.json, timeline.json (from `wb timeline`; estimated from the text when it does not exist yet),
direction.json and cast.json, and writes:
  plan.json    shots and camera moves, TV evidence per shot, the frozen beat, host expressions, gestures and gaze, orb
               states, room light, title cards, inserts and subtitles: everything the page needs for any time t
  events.json  sound effects on the timeline (contract format, rendered by `wb sfx` / `wb mix`)
and prints the shot list with the montage checks.

Anchors (any time field in direction.json): a number (seconds) | "L03" (line start) | "L03:word" (first word starting
with it; "word#2" = second match) | "L03:end" | "L03:end+0.3" | "L03:-0.1" (from the line start) | "dur-0.5".
Inside "lines": {"L03": {...}} the line id may be omitted: "end+0.2", "word", "+0.4".

Montage rules applied here (from production):
- the camera shows whoever speaks; one shot per turn, so a shot breathes over several lines of the same speaker;
- cuts fall a hair before the first syllable (0.10 s), never in dead air;
- no shot shorter than min_shot (2.0 s): short ones are merged into the previous shot, which becomes a two-shot when
  that is needed to keep both speakers in frame;
- the TV changes content only on a cut (its evidence lives in its own shot), so a screen change never reads as a
  second cut; at most two TV moments per piece;
- the frozen beat is one static camera; the piece ends on a silent wide shot of real frames (no fade to black).
"""
import json
import math
import os
import re
import statistics
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
FRAMES = {   # who each camera preset frames (mirrors engine/page/cameras.js)
    'wide': 'both', 'wide_in': 'both', 'two': 'both', 'two_in': 'both', 'two_low': 'both', 'two_low_in': 'both', 'pause_wide': 'both', 'pause_wide_in': 'both', 'cover': 'both',
    'host_med': 'host', 'host_med_in': 'host', 'host_cu': 'host', 'host_cu_in': 'host', 'host_high': 'host', 'host_high_in': 'host',
    'host_side': 'host', 'host_side_in': 'host', 'host_ovr': 'host', 'host_ovr_in': 'host',
    'orb_cu': 'orb', 'orb_cu_in': 'orb', 'orb_ecu': 'orb', 'orb_med': 'orb', 'orb_med_in': 'orb', 'orb_high': 'orb', 'orb_high_in': 'orb',
    'tv': 'tv', 'tv_in': 'tv', 'tv_focus': 'tv', 'tv_focus_in': 'tv',
}
DEFAULT_CAMS = {'host': [['two_in', 'two'], ['host_med', 'host_med_in']], 'orb': [['orb_cu', 'orb_cu_in'], ['orb_cu_in', 'orb_cu']], None: [['two', 'two_in']]}
# subtitle height (fraction of the frame) per camera: near the speaker's head without covering the face, above the TV
SUB_Y = {'two': 0.42, 'two_in': 0.42, 'two_low': 0.25, 'two_low_in': 0.25, 'wide': 0.46, 'wide_in': 0.46, 'pause_wide': 0.31,
         'host_med': 0.12, 'host_med_in': 0.12, 'host_cu': 0.12, 'host_cu_in': 0.12, 'host_high': 0.20, 'host_high_in': 0.20,
         'host_side': 0.18, 'host_side_in': 0.18, 'host_ovr': 0.20, 'host_ovr_in': 0.20,
         'orb_cu': 0.27, 'orb_cu_in': 0.27, 'orb_ecu': 0.24, 'orb_med': 0.25, 'orb_med_in': 0.25, 'orb_high': 0.22, 'orb_high_in': 0.22,
         'tv': 0.31, 'tv_in': 0.31, 'tv_focus': 0.31, 'tv_focus_in': 0.31, 'pause_wide_in': 0.31, 'insert': 0.76}
FUNC = set('a an the of to in on at for with and or but so if is are was be it its that this your my our their his her as by from than then not no we you i they he she me us them'.split())
CLAUSE = set('that but and so because when if which who while'.split())


def norm(w):
    w = unicodedata.normalize('NFD', w.lower())
    return re.sub(r'[^a-z0-9]', '', ''.join(c for c in w if unicodedata.category(c) != 'Mn'))


def strip_markup(text):
    return re.sub(r'\s+', ' ', re.sub(r'\[[^\]]*\]', ' ', text.replace('*', ' '))).strip()


def load(path, default=None):
    if not os.path.exists(path):
        return default
    with open(path, encoding='utf-8') as fh:
        return json.load(fh)


# ----------------------------------------------------------------------------- provisional timeline (no audio yet)
def provisional_timeline(script):
    """Same placement rules as `wb timeline`, with speaking time estimated from the text (14.5 characters per second)."""
    try:
        sys.path.insert(0, os.path.join(HERE, '..', '..', '..', 'core', 'python'))
        from workbench.voice import estimate_duration, estimate_words  # noqa: E402
    except Exception:  # noqa: BLE001 - core not installed: local estimate
        def estimate_duration(text, speed=1.0):
            return 0.35 + len(strip_markup(text)) / (14.5 * speed)

        def estimate_words(text, duration, lead=0.12, tail=0.15):
            toks = strip_markup(text).split()
            weights = [max(1, len(norm(t))) + (2.5 if t[-1:] in ',;:' else 4 if t[-1:] in '.!?' else 0.6) for t in toks]
            unit, t, out = (duration - lead - tail) / max(1e-6, sum(weights)), lead, []
            for tok, w in zip(toks, weights):
                out.append({'text': tok, 'start': t, 'end': t + (max(1, len(norm(tok))) + 0.6) * unit})
                t += w * unit
            return out
    voices = script.get('voices', {})
    starts, ends, lines = {}, {}, []
    for line in script['lines']:
        speed = line.get('speed', voices.get(line['voice'], {}).get('speed', 1.0))
        tempo = line.get('tempo', voices.get(line['voice'], {}).get('tempo', 1.0))
        d = estimate_duration(line['text'], speed) / tempo
        words = estimate_words(line['text'], d)
        if 'start' in line:
            t0 = float(line['start'])
        elif 'after' in line:
            t0 = ends[line['after']] + line.get('gap', 0.2)
        elif 'with' in line:
            t0 = starts[line['with']] + line.get('offset', 0.0)
        else:
            t0 = (max(ends.values()) + 0.25) if ends else 0.3
        starts[line['id']], ends[line['id']] = t0, t0 + d
        toks = [t for t in re.sub(r'\[[^\]]*\]', ' ', line['text']).split()]
        hot = [('*' in t) for t in toks]
        lines.append({'id': line['id'], 'voice': line['voice'], 'text': strip_markup(line['text']), 'start': round(t0, 3), 'end': round(t0 + d, 3),
                      'caption': line.get('caption', True), 'effect': line.get('effect'), 'env': [],
                      'words': [{'text': w['text'].replace('*', ''), 'start': round(t0 + w['start'], 3), 'end': round(t0 + w['end'], 3),
                                 'emphasis': hot[i] if i < len(hot) else False} for i, w in enumerate(words)]})
    last = max(ends.values()) if ends else 0
    return {'duration': round(last + script.get('tail', 2.5), 3), 'fps': script.get('format', {}).get('fps', 60), 'lines': lines, 'provisional': True}


# ----------------------------------------------------------------------------- anchors
class Anchors:
    def __init__(self, timeline):
        self.L = {l['id']: l for l in timeline['lines']}
        self.dur = timeline['duration']

    def __call__(self, a, ctx=None):
        if a is None:
            return None
        if isinstance(a, (int, float)):
            return float(a)
        a = str(a).strip()
        m = re.match(r'^dur([+-][\d.]+)?$', a)
        if m:
            return self.dur + float(m.group(1) or 0)
        if ':' in a:
            ctx, a = a.split(':', 1)
        elif a in self.L:
            return self.L[a]['start']
        if ctx not in self.L:
            raise SystemExit(f'anchor {a!r}: unknown line {ctx!r}')
        line = self.L[ctx]
        m = re.match(r'^([+-][\d.]+)$', a)
        if m:
            return line['start'] + float(m.group(1))
        m = re.match(r'^(start|end)([+-][\d.]+)?$', a)
        if m:
            return (line['start'] if m.group(1) == 'start' else line['end']) + float(m.group(2) or 0)
        m = re.match(r'^(.*?)([+-][\d.]+)?$', a)
        word, off = m.group(1), float(m.group(2) or 0)
        n = 1
        if '#' in word:
            word, n = word.split('#')
            n = int(n)
        hits = [w for w in line['words'] if norm(w['text']).startswith(norm(word))]
        if len(hits) < n:
            raise SystemExit(f'anchor word {word!r} not found in {ctx}: {line["text"]}')
        return hits[n - 1]['start'] + off


# ----------------------------------------------------------------------------- subtitles
def split_long(ws, maxlen):
    txt = lambda q: ' '.join(w['text'] for w in q)
    if len(txt(ws)) <= maxlen or len(ws) < 2:
        return [ws]

    def score(k):
        left, right = txt(ws[:k]), txt(ws[k:])
        sc = abs(len(left) - len(right)) + 50 * (len(left) > maxlen) + 50 * (len(right) > maxlen)
        if norm(ws[k - 1]['text']) in FUNC:
            sc += 25
        if norm(ws[k]['text']) in CLAUSE:
            sc -= 8
        return sc
    k = min(range(1, len(ws)), key=score)
    return split_long(ws[:k], maxlen) + split_long(ws[k:], maxlen)


def subtitle_pieces(line, maxlen):
    runs, cur = [], []
    for w in line['words']:
        cur.append(w)
        t = ' '.join(x['text'] for x in cur)
        if re.search(r'[.?!…]$', w['text']) or (w['text'].endswith(',') and len(t) >= 12):
            runs.append(cur)
            cur = []
    if cur:
        runs.append(cur)
    return [piece for r in runs for piece in split_long(r, maxlen)]


# ----------------------------------------------------------------------------- the plan
def main(argv):
    pd = os.path.abspath(argv[0])
    script = load(os.path.join(pd, 'script.json'))
    if not script:
        sys.exit(f'{pd}: no script.json')
    timeline = load(os.path.join(pd, 'timeline.json')) or provisional_timeline(script)
    D = load(os.path.join(pd, 'direction.json'), {})
    A = Anchors(timeline)
    dur, fps = timeline['duration'], script.get('format', {}).get('fps', timeline.get('fps', 60))
    speakers = {'host': 'host', 'orb': 'orb', **D.get('speakers', {})}
    DL = D.get('lines', {})
    min_shot = D.get('min_shot', 2.0)
    lines = sorted(timeline['lines'], key=lambda l: l['start'])
    for l in lines:
        l['who'] = speakers.get(l['voice'])
    warn = []

    def cut_before(i):
        if i == 0:
            return 0.0
        return max(lines[i - 1]['end'] + 0.03, lines[i]['start'] - 0.10)

    # ---- the frozen beat
    PZ = D.get('pause')
    pause = None
    if PZ:
        at = PZ.get('at')
        freeze = cut_before(next(i for i, l in enumerate(lines) if l['id'] == at)) if at in A.L else A(at)
        last_id = PZ.get('through', at if at in A.L else None)
        col0 = A(PZ.get('col0', f'{last_id}:end+0.15'))
        col1 = A(PZ.get('col1', f'{last_id}:end+0.40'))
        cards = [{'t0': round(A(c['at']), 3), 't1': round(A(c['until']), 3), 'lines': c['text'], 'covers': c.get('covers', []),
                  'y': c.get('y', 0.22), 'size': c.get('size', 60)} for c in PZ.get('cards', [])]
        cam = PZ.get('cam', ['pause_wide', 'pause_wide_in'])
        cam = [cam, cam] if isinstance(cam, str) else cam
        pause = {'freeze': round(freeze, 3), 'col0': round(col0, 3), 'col1': round(col1, 3), 'cam': cam, 'cards': cards,
                 'sound': {'mode': PZ.get('sound', 'lowpass'), 'lowpass_hz': PZ.get('lowpass_hz', 700), 'dip_db': PZ.get('dip_db', -12), 'xf': PZ.get('xf', 0.15)},
                 'forbidden_words': PZ.get('forbidden_words', ['pause', 'paused', 'pausing'])}
        for l in lines:
            if pause['freeze'] - 0.05 <= l['start'] < pause['col0'] and l['who'] == 'orb':
                warn.append(f"{l['id']}: the orb speaks inside the frozen beat (it is frozen there); give the line to the host or move the beat")

    # ---- shots
    shots, alt, prev_who = [], {}, '__none__'

    def add(t, kind, a, b, **kw):
        shots.append({'t': round(t, 3), 'kind': kind, 'a': a, 'b': b, **{k: v for k, v in kw.items() if v is not None}})
    for i, l in enumerate(lines):
        d, who = DL.get(l['id'], {}), l['who']
        in_pause = pause and pause['freeze'] - 1e-6 <= l['start'] < pause['col0']
        if in_pause:
            prev_who = who
            continue
        t_cut = A(d['cut_at'], l['id']) if 'cut_at' in d else cut_before(i)
        if d.get('tv'):
            tv = d['tv']
            t_tv = A(tv['at'], l['id']) if 'at' in tv else t_cut
            a, b = tv.get('cam', ['tv', 'tv_focus'])
            add(t_tv, 'tv', a, b, mv=tv.get('mv', 1.0), line=l['id'], evidence=tv.get('evidence', {'kind': 'post'}))
        elif d.get('insert'):
            ins = d['insert']
            a, b = ins.get('cam', ['tv', 'tv_focus'])
            add(A(ins['at'], l['id']) if 'at' in ins else t_cut, 'insert', a, b, mv=ins.get('mv', 0.8), line=l['id'], insert=ins)
        elif d.get('join'):
            pass
        elif who != prev_who or d.get('cam') or d.get('cut'):
            a, b = d.get('cam') or DEFAULT_CAMS.get(who, DEFAULT_CAMS[None])[alt.get(who, 0) % 2]
            alt[who] = alt.get(who, 0) + 1
            add(t_cut, 'speak', a, b, line=l['id'], mv=d.get('mv'))
        prev_who = who
    if pause:                       # shots of lines that start while the colour returns open right after it
        for s in shots:
            if pause['col0'] - 1e-6 <= s['t'] < pause['col1']:
                s['t'] = pause['col1']
        shots = [s for s in shots if not (pause['freeze'] - 1e-6 <= s['t'] < pause['col1'] - 1e-6)]
        add(pause['freeze'], 'pause', pause['cam'][0], pause['cam'][1], still=True)
    tail = D.get('tail', {})
    if not tail.get('skip'):
        t_tail = A(tail['at']) if 'at' in tail else lines[-1]['end'] + tail.get('lead', 0.35)
        a, b = tail.get('cam', ['wide_in', 'wide'])
        add(t_tail, 'wide', a, b)
    shots.sort(key=lambda s: s['t'])
    shots[0]['t'] = 0.0

    def close():
        for k, s in enumerate(shots):
            s['t1'] = round(shots[k + 1]['t'] if k + 1 < len(shots) else dur, 3)
    close()
    # merge short shots into their predecessor (explicit TV, insert, pause and tail shots stay; they only warn)
    def keep_both_in_frame(s):
        whos = {l['who'] for l in lines if l['start'] < s['t1'] - 0.1 and l['end'] > s['t'] + 0.1 and l['who']}
        if len(whos) > 1 and FRAMES.get(s['a']) != 'both':
            s['a'], s['b'] = 'two_in', 'two'
    stuck = set()
    for _ in range(100):
        k = next((k for k, s in enumerate(shots) if s['t1'] - s['t'] < min_shot - 1e-6 and s['kind'] == 'speak' and id(s) not in stuck), None)
        if k is None:
            break
        s = shots[k]
        prev = shots[k - 1] if k > 0 else None
        nxt = shots[k + 1] if k + 1 < len(shots) else None
        if prev is not None and prev['kind'] == 'speak':            # the previous shot keeps running over this one
            shots.pop(k); close(); keep_both_in_frame(prev)
            warn.append(f"shot at {s['t']:.2f} ({s['t1'] - s['t']:.2f} s < {min_shot}) merged into the previous one")
        elif nxt is not None and nxt['kind'] == 'speak':            # or the next one starts earlier
            nxt['t'] = s['t']; shots.pop(k); close(); keep_both_in_frame(nxt)
            warn.append(f"shot at {s['t']:.2f} ({s['t1'] - s['t']:.2f} s < {min_shot}) merged into the next one")
        else:
            stuck.add(id(s))
    for s in shots:
        if s['t1'] - s['t'] < min_shot - 1e-6:
            warn.append(f"{s['kind']} shot {s['t']:.2f}-{s['t1']:.2f} is {s['t1'] - s['t']:.2f} s (< {min_shot})")
        if s['kind'] == 'tv' and s['t1'] - s['t'] - s.get('mv', 0) < 2.0:
            warn.append(f"TV shot at {s['t']:.2f}: the evidence is legible for less than 2 s after the push-in")
    if sum(1 for s in shots if s['kind'] == 'tv') > 2:
        warn.append('more than two TV moments: keep the TV for one or two pieces of evidence')

    # speaker on screen (the TV focus and inserts may carry any voice: voice-over)
    for s in shots:
        if s['kind'] in ('tv', 'insert'):
            for l in lines:
                ov = min(s['t1'], l['end']) - max(s['t'], l['start'])
                if ov > 0.1 and l['who'] == 'host' and s['kind'] == 'insert':
                    warn.append(f"insert at {s['t']:.2f} covers a host line ({l['id']}): his lip sync is lost")
            continue
        fr = {FRAMES.get(s['a']), FRAMES.get(s['b'])}
        shows = {'host', 'orb'} if 'both' in fr else fr
        for l in lines:
            ov = min(s['t1'], l['end']) - max(s['t'], l['start'])
            if ov > 0.1 and l['who'] and l['who'] not in shows:
                warn.append(f"shot {s['a']} at {s['t']:.2f} does not frame the {l['who']} while {l['id']} plays ({ov:.2f} s)")

    # ---- performance: host tags, orb states, gestures, looks, room, sfx
    host_tags, orb_states, gestures, looks, room, events = [], [], [], [], [{'t': 0.0, 'level': 1.0}], []
    tag = lambda g, ctx, dflt_until: {'t0': round(A(g.get('at', '-0.1'), ctx), 3), 't1': round(A(g['until'], ctx) if 'until' in g else A(dflt_until, ctx), 3), 'amp': g.get('amp', 1.0)}
    side = lambda g: -1 if g.get('hand', 'right') == 'left' else 1      # 'right' = viewer right = toward the orb
    for l in lines:
        d = DL.get(l['id'], {})
        for g in d.get('host', []):
            host_tags.append({'tag': g['tag'], **tag(g, l['id'], 'end+0.1')})
        if l['who'] == 'orb' and d.get('orb_default', True):
            orb_states.append({'state': 'speak', 't0': round(l['start'] - 0.05, 3), 't1': round(l['end'] + 0.10, 3), 'pri': 0})
        for g in d.get('orb', []):
            orb_states.append({'state': g['state'], **tag(g, l['id'], 'end+0.1'), 'pri': 1})
        for g in d.get('gesture', []):
            gestures.append({'side': side(g), 'kind': g.get('kind', 'open'), 'target': g.get('target'), **tag(g, l['id'], 'end')})
        for g in d.get('look', []):
            looks.append({'who': g.get('who', 'host'), 'target': g.get('target', 'camera'), **tag(g, l['id'], 'end+0.1')})
        for s in d.get('sfx', []):
            events.append({'t': round(A(s['at'], l['id']), 3), 'name': s['name'], 'gain_db': s.get('gain_db', -12), 'pan': s.get('pan', 0.0)})
    for s in shots:                                       # optional: the orb turns to the TV while it shows evidence
        if s['kind'] == 'tv' and D.get('tv_look', False):
            looks.append({'who': 'orb', 'target': 'tv', 't0': s['t'], 't1': s['t1'], 'amp': 0.6})
    t_tail = next((s['t'] for s in shots if s['kind'] == 'wide'), None)
    if t_tail is not None:
        for g in tail.get('host', [{'tag': 'smile', 'amp': 0.35}]):
            host_tags.append({'tag': g['tag'], 't0': round(t_tail + g.get('at', 0.0), 3), 't1': round(dur + 1, 3), 'amp': g.get('amp', 1.0)})
        for g in tail.get('orb', []):
            orb_states.append({'state': g['state'], 't0': round(t_tail + g.get('at', 0.0), 3), 't1': round(dur + 1, 3), 'pri': 1})
    for ev in D.get('events', []):
        t = A(ev['at'])
        if 'room' in ev:
            room.append({'t': round(t, 3), 'level': ev['room'], 'fade': ev.get('fade', 0.04)})
        if 'sfx' in ev:
            events.append({'t': round(t - ev.get('pre', 0.0), 3), 'name': ev['sfx'], 'gain_db': ev.get('gain_db', -12)})
        if 'orb' in ev:
            orb_states.append({'state': ev['orb'], 't0': round(t, 3), 't1': round(A(ev['until']) if 'until' in ev else t + ev.get('dur', 1.0), 3), 'pri': 2})

    # ---- titles and inserts (2D layer)
    titles = [{'t0': round(A(T['at']), 3), 't1': round(A(T['until']), 3), 'lines': T['text'], 'y': T.get('y', 0.20), 'size': T.get('size', 84)}
              for T in D.get('titles', [])]
    inserts = []
    for s in shots:
        if s['kind'] != 'insert':
            continue
        ins = s.pop('insert')
        seq = [{'t': round(A(q['at'], s.get('line')) if 'at' in q else s['t'], 3), **{k: v for k, v in q.items() if k != 'at'}} for q in ins['seq']]
        inserts.append({'t0': s['t'], 't1': s['t1'], 'seq': seq, 'zin': ins.get('zin', 0.45), 'zfrom': ins.get('zfrom', 0.30), 'zout': ins.get('zout'), 'cy': ins.get('cy', 0.5)})

    # ---- automatic sound design (subtle, every one optional)
    auto = D.get('auto_sfx', True)
    if auto:
        if pause:
            events.append({'t': round(pause['freeze'] - 0.01, 3), 'name': 'tick', 'gain_db': -10})
            events.append({'t': round(pause['col0'] - 0.08, 3), 'name': 'whoosh', 'gain_db': -14})
        for T in titles:
            events.append({'t': round(T['t0'] - 0.02, 3), 'name': 'pop', 'gain_db': -16})
        for s in shots:
            if s['kind'] in ('tv', 'insert'):
                events.append({'t': round(s['t'] - 0.05, 3), 'name': 'swoosh', 'gain_db': -18})
        if pause:
            for c in pause['cards']:
                events.append({'t': round(c['t0'] - 0.01, 3), 'name': 'paper', 'gain_db': -18})
    for e in events:
        e['t'] = max(0.0, e['t'])                         # nothing before the first frame
    events.sort(key=lambda e: e['t'])

    # ---- subtitles: static pieces near the speaker, never during a card that carries the same fact
    SS = {'size': 62, 'weight': 700, 'max_chars': 48, 'emphasis': True, **D.get('sub_style', {})}
    pos = {**SUB_Y, **D.get('sub_pos', {})}
    subs = []
    for i, l in enumerate(lines):
        if not l.get('caption', True) or not l['words']:
            continue
        nxt = next((x['start'] for x in lines[i + 1:] if x.get('caption', True)), None)
        pieces = subtitle_pieces(l, SS['max_chars'])
        for k, ws in enumerate(pieces):
            a = max(ws[0]['start'] - 0.03, subs[-1]['t1'] if subs else 0)
            b = pieces[k + 1][0]['start'] - 0.03 if k + 1 < len(pieces) else min(l['end'] + 0.30, (nxt - 0.10) if nxt else dur)
            sh = max((s for s in shots if s['t'] <= a + 1e-6), key=lambda s: s['t'])
            key = 'insert' if sh['kind'] == 'insert' else sh['b'] if sh['kind'] == 'tv' else sh['a']
            subs.append({'text': ' '.join(w['text'] for w in ws), 'words': [{'t': w['text'], 'em': bool(w.get('emphasis'))} for w in ws],
                         't0': round(a, 3), 't1': round(b, 3), 'line': l['id'], 'who': l['who'], 'x': 0.5, 'y': pos.get(key, 0.30)})

    poster = {'t': round(dur - 1.0, 3), 'cam': 'cover', 'title': [script.get('title', 'Your title')], 'y': 0.5, **D.get('poster', {})}
    plan = {'version': 1, 'provisional': bool(timeline.get('provisional')), 'language': script.get('language', 'en'), 'fps': fps, 'duration': dur,
            'lines': [{k: l.get(k) for k in ('id', 'voice', 'who', 'text', 'start', 'end', 'words', 'env', 'caption')} for l in lines],
            'shots': shots, 'host_tags': host_tags, 'orb_states': orb_states, 'gestures': gestures, 'looks': looks, 'room': room,
            'pause': pause, 'titles': titles, 'inserts': inserts, 'subs': subs, 'sub_style': SS, 'poster': poster, 'warnings': warn}
    with open(os.path.join(pd, 'plan.json'), 'w', encoding='utf-8') as fh:
        json.dump(plan, fh, ensure_ascii=False, indent=1)
    with open(os.path.join(pd, 'events.json'), 'w', encoding='utf-8') as fh:
        json.dump(events, fh, ensure_ascii=False, indent=1)

    lens = [s['t1'] - s['t'] for s in shots]
    print(f"plan: {len(shots)} shots over {dur:.2f} s (median {statistics.median(lens):.2f} s, shortest {min(lens):.2f} s)"
          + ('  [timings estimated: no timeline.json yet]' if plan['provisional'] else ''))
    for s in shots:
        extra = s.get('evidence', {}).get('kind', '') if s['kind'] == 'tv' else ''
        print(f"  {s['t']:6.2f}-{s['t1']:6.2f} {s['t1'] - s['t']:5.2f}s {s['kind']:6s} {s['a']:>12s} -> {s['b']:<12s} {s.get('line', '')} {extra}")
    if pause:
        print(f"  frozen beat {pause['freeze']:.2f}-{pause['col1']:.2f} (colour returns {pause['col0']:.2f}-{pause['col1']:.2f})")
    if dur > 35.5:
        warn.append(f'{dur:.1f} s: dialogues of this style land best at 35 s or less (tail included)')
    for w in warn:
        print('  ! ' + w)
    print(f"{len(subs)} subtitles, {len(events)} sound effects -> plan.json, events.json")


if __name__ == '__main__':
    main(sys.argv[1:])
