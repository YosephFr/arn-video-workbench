"""The timeline that drives the whole edit.

    wb timeline <piece>

For the selected take of every line (voice/selection.json):
- shortens long internal pauses (keeps the dramatic ones listed in script.keep_pauses);
- applies the voice tempo (pitch preserved, ffmpeg atempo);
- places the line on the absolute timeline (start | after + gap | with + offset);
- writes voice/proc/<id>.wav and timeline.json (word timings, emphasis, a 50 Hz loudness envelope for mouth sync).
"""
import os

import numpy as np

from . import common
from .common import SR

MAX_GAP = 0.2       # internal pauses longer than this are shortened...
KEEP_RATIO = 0.35   # ...to this fraction of the excess
INNER_GAP = 0.2     # silences inside a word's span longer than this are cut down to ~0.08 s


def tempo_stretch(x, tempo):
    if abs(tempo - 1) < 1e-3:
        return x
    return common.ffilter(x, f'atempo={tempo}')


def drop_direction_words(words):
    """Alignment of models that read [direction] tags returns them as words: remove them, even multi-word ones."""
    out, depth = [], 0
    for w in words:
        t = w['text']
        if depth > 0 or t.startswith('['):
            depth += t.count('[') - t.count(']')
            if depth <= 0:
                depth = 0
                rest = t.split(']')[-1]
                if rest:
                    out.append({**w, 'text': rest})
            continue
        out.append(w)
    return out


def mark_emphasis(words, text):
    tokens = common.tokens_with_emphasis(text)
    if len(tokens) == len(words):
        for w, (_, hot) in zip(words, tokens):
            w['emphasis'] = hot
        return
    j = 0
    for w in words:
        w['emphasis'] = False
        while j < len(tokens) and common.norm(tokens[j][0]) != common.norm(w['text']):
            j += 1
        if j < len(tokens):
            w['emphasis'] = tokens[j][1]
            j += 1


def fix_collapsed(words, min_dur=0.035):
    """Aligners sometimes squeeze short leading words to ~10 ms and give their time to the next word.
    Share that stretch by letter count so captions step in naturally and pause trimming never eats speech."""
    i = 0
    while i < len(words):
        if words[i]['end'] - words[i]['start'] < min_dur:
            j = i
            while j + 1 < len(words) and words[j + 1]['end'] - words[j + 1]['start'] < min_dur:
                j += 1
            k = min(j + 1, len(words) - 1)
            if k > i:
                a, b = words[i]['start'], words[k]['end']
                sizes = [max(1, len(common.norm(words[x]['text']))) for x in range(i, k + 1)]
                t = a
                for x, n in zip(range(i, k + 1), sizes):
                    d = (b - a) * n / sum(sizes)
                    words[x]['start'], words[x]['end'] = t, t + d
                    t += d
            i = k + 1
        else:
            i += 1
    return words


def process_take(pd, line, take, tempo, keep):
    lid = line['id']
    base = os.path.join(pd, 'voice', f'{lid}__t{take}')
    meta = common.load_json(base + '.json')
    x = common.decode(base + '.wav')
    words = fix_collapsed(drop_direction_words(meta['words']))
    if not words:
        return x, []
    mark_emphasis(words, line['text'])
    s0 = max(0.0, words[0]['start'] - 0.12 - line.get('pre', 0.0))
    s1 = min(len(x) / SR, words[-1]['end'] + 0.18)
    cuts = []
    for i, w in enumerate(words[:-1]):
        gap = words[i + 1]['start'] - w['end']
        limit = keep.get((lid, i + 1))
        target = min(gap, limit) if limit is not None else (MAX_GAP + (gap - MAX_GAP) * KEEP_RATIO if gap > MAX_GAP else gap)
        if gap - target > 0.02:
            a = w['end'] + target / 2
            cuts.append((a, a + gap - target))
    hop = SR // 100
    frames = len(x) // hop
    if frames:
        env = np.sqrt(np.mean(x[:frames * hop].reshape(frames, hop) ** 2, axis=1))
        thr = 0.06 * env.max()
        if thr > 0:
            for i, w in enumerate(words):
                kp = keep.get((lid, i + 1), 0.08)
                f, fb, run = int(w['start'] * 100), min(frames, int(w['end'] * 100)), None
                while f <= fb:
                    quiet = f < fb and env[f] < thr
                    if quiet and run is None:
                        run = f
                    if not quiet and run is not None:
                        if (f - run) / 100 > max(INNER_GAP, kp + 0.04):
                            h = int(kp * 50)
                            cuts.append(((run + h) / 100, (f - h) / 100))
                        run = None
                    f += 1
    cuts.sort()
    merged = []
    for a, b in cuts:
        if merged and a <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(b, merged[-1][1]))
        else:
            merged.append((a, b))
    cuts = [(max(a, s0), min(b, s1)) for a, b in merged if b > s0 and a < s1]

    def remap(t):
        return t - s0 - sum(min(b, t) - a for a, b in cuts if a < t)

    out_words = [{'text': w['text'], 'start': remap(w['start']), 'end': remap(w['end']), 'emphasis': w.get('emphasis', False)} for w in words]
    segments, cur = [], s0
    for a, b in cuts:
        segments.append((cur, a))
        cur = b
    segments.append((cur, s1))
    pieces = []
    for a, b in segments:
        seg = x[int(a * SR):int(b * SR)].copy()
        f = min(len(seg) // 4, int(0.012 * SR))
        if f > 0:
            seg[:f] *= np.linspace(0, 1, f)
            seg[-f:] *= np.linspace(1, 0, f)
        pieces.append(seg)
    y = tempo_stretch(np.concatenate(pieces), tempo)
    for w in out_words:
        w['start'] /= tempo
        w['end'] /= tempo
    return y, out_words


def main(argv):
    pd = common.piece_dir(argv[0])
    script = common.load_script(pd)
    voices = common.voices_of(script)
    selection = common.load_json(os.path.join(pd, 'voice', 'selection.json'), default={})
    keep = {(p['line'], p['after_word']): p['max'] for p in script.get('keep_pauses', [])}
    os.makedirs(os.path.join(pd, 'voice', 'proc'), exist_ok=True)
    fps = script.get('format', {}).get('fps', 30)
    starts, ends, out = {}, {}, []
    for line in script['lines']:
        lid = line['id']
        tempo = line.get('tempo', voices.get(line['voice'], {}).get('tempo', 1.0))
        y, words = process_take(pd, line, selection.get(lid, 0), tempo, keep)
        if 'start' in line:
            t0 = float(line['start'])
        elif 'after' in line:
            t0 = ends[line['after']] + line.get('gap', 0.2)
        elif 'with' in line:
            t0 = starts[line['with']] + line.get('offset', 0.0)
        else:
            t0 = (max(ends.values()) + 0.25) if ends else 0.3
        t0 = max(0.0, t0)
        starts[lid], ends[lid] = t0, t0 + len(y) / SR
        hop = SR // 50
        n = max(1, len(y) // hop)
        rms = np.sqrt(np.mean(y[:n * hop].reshape(n, hop) ** 2, axis=1)) if len(y) >= hop else np.zeros(1)
        rms = rms / max(float(rms.max()), 1e-6)
        rel = f'voice/proc/{lid}.wav'
        common.save_wav(os.path.join(pd, rel), y)
        out.append({'id': lid, 'voice': line['voice'], 'text': common.strip_markup(line['text']),
                    'start': round(t0, 3), 'end': round(ends[lid], 3), 'audio': rel,
                    'effect': line.get('effect'), 'caption': line.get('caption', True),
                    'words': [{'text': w['text'], 'start': round(t0 + w['start'], 3), 'end': round(t0 + w['end'], 3),
                               'emphasis': w['emphasis']} for w in words],
                    'env': [round(float(v), 2) for v in rms]})
    last = max(ends.values()) if ends else 0.0
    timeline = {'duration': round(last + script.get('tail', 2.5), 3), 'last_end': round(last, 3), 'fps': fps, 'lines': out}
    common.save_json(os.path.join(pd, 'timeline.json'), timeline)
    for line in out:
        shown = ' '.join(f"*{w['text']}*" if w['emphasis'] else w['text'] for w in line['words'])
        print(f"{line['id']:5} {line['start']:7.2f} – {line['end']:7.2f}  {shown}")
    print(f"duration {timeline['duration']} s (voice ends at {timeline['last_end']} s)")


def anchor_time(timeline, ref, edge='start'):
    """Resolve an anchor: seconds, '<line>' or '<line>:<word>' (first word starting with that text)."""
    if isinstance(ref, (int, float)):
        return float(ref)
    line_id, _, word = str(ref).partition(':')
    line = next((l for l in timeline['lines'] if l['id'] == line_id), None)
    if line is None:
        raise KeyError(f'unknown line {line_id}')
    if not word:
        return line[edge]
    for w in line['words']:
        if common.norm(w['text']).startswith(common.norm(word)):
            return w[edge]
    raise KeyError(f'word {word!r} not found in {line_id}')
