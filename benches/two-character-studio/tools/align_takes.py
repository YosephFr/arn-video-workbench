#!/usr/bin/env python3
"""Word timings for voice takes made outside `wb voice` (a local TTS server, a recording session, another tool).

    python3 tools/align_takes.py <piece> [LINE_ID ...] [--take K] [--model small]

Drop one WAV per line as <piece>/voice/<id>__t<K>.wav (any sample rate; mono or stereo), then run this. It writes the
matching voice/<id>__t<K>.json in the format `wb timeline` reads ({id, voice, provider, text, words}) with word times
from faster-whisper when it is installed, otherwise spread over the take by letter count, and points
voice/selection.json at take K. Then continue with `wb timeline`.
"""
import argparse
import json
import os
import re
import subprocess
import sys


def duration(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], capture_output=True, text=True).stdout
    return float(out.strip() or 0)


def pcm16k(path):
    """Mono 16 kHz float32 samples via ffmpeg (Whisper gets an array, so no extra audio decoder is needed)."""
    import numpy as np
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).copy()


def retime(script_words, heard):
    """Measured times on the script's own words: align the two letter sequences and give each script word the time
    span of the heard letters it matches (survives split or merged words such as 'sign-off' / 'sign -off')."""
    import difflib
    norm = lambda w: re.sub(r'[^0-9a-z]', '', w.lower())
    hs, ht = '', []
    for h in heard:
        n = norm(h['text']) or '_'
        k = len(n)
        for i in range(k):
            ht.append(h['start'] + (h['end'] - h['start']) * (i + 0.5) / k)
        hs += n
    ss, owner = '', []
    for j, w in enumerate(script_words):
        n = norm(w) or '_'
        ss += n; owner += [j] * len(n)
    pos = {}
    for b in difflib.SequenceMatcher(None, ss, hs, autojunk=False).get_matching_blocks():
        for i in range(b.size):
            pos.setdefault(owner[b.a + i], []).append(ht[b.b + i])
    out, last = [], heard[0]['start'] if heard else 0.0
    for j, w in enumerate(script_words):
        if j in pos:
            a, b = min(pos[j]), max(pos[j])
        else:                                            # unmatched word: squeeze it right after the previous one
            a, b = last, last + 0.12
        out.append({'text': w, 'start': round(a, 3), 'end': round(max(b, a + 0.04), 3)})
        last = out[-1]['end']
    return out


def spoken(text):
    return re.sub(r'\s+', ' ', re.sub(r'\[[^\]]*\]', ' ', text)).replace('*', '').strip()


def estimate(text, dur, lead=0.12, tail=0.15):
    toks = spoken(text).split()
    if not toks:
        return []
    weights = [len(re.sub(r'\W', '', t)) + (2.5 if t[-1] in ',;:' else 4 if t[-1] in '.!?' else 0.6) for t in toks]
    unit, t, out = (max(0.2, dur - lead - tail)) / sum(weights), lead, []
    for tok, w in zip(toks, weights):
        out.append({'text': tok, 'start': round(t, 3), 'end': round(t + (len(re.sub(r'\W', '', tok)) + 0.6) * unit, 3)})
        t += w * unit
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('piece'); ap.add_argument('ids', nargs='*'); ap.add_argument('--take', type=int, default=0); ap.add_argument('--model', default='small')
    A = ap.parse_args()
    pd = os.path.abspath(A.piece)
    script = json.load(open(os.path.join(pd, 'script.json'), encoding='utf-8'))
    try:
        from faster_whisper import WhisperModel
        wm = WhisperModel(A.model, device='cpu', compute_type='int8')
    except ImportError:
        wm = None
        print('faster-whisper not installed: word timings are estimated (pip install faster-whisper for real ones)', file=sys.stderr)
    sel_path = os.path.join(pd, 'voice', 'selection.json')
    selection = json.load(open(sel_path)) if os.path.exists(sel_path) else {}
    for line in script['lines']:
        if A.ids and line['id'] not in A.ids:
            continue
        wav = os.path.join(pd, 'voice', f"{line['id']}__t{A.take}.wav")
        if not os.path.exists(wav):
            print(f"{line['id']}: no {os.path.relpath(wav, pd)}, skipped")
            continue
        words = None
        if wm:
            segs, _ = wm.transcribe(pcm16k(wav), language=(script.get('language') or 'en')[:2], word_timestamps=True, vad_filter=False,
                                    initial_prompt=spoken(line['text']))
            heard = [{'text': w.word.strip(), 'start': round(w.start, 3), 'end': round(w.end, 3)} for s in segs for w in (s.words or [])]
            if heard:                                    # keep the script's spelling, take the measured times
                words = retime(spoken(line['text']).split(), heard)
        words = words or estimate(line['text'], duration(wav))
        json.dump({'id': line['id'], 'voice': line['voice'], 'provider': 'external', 'text': line['text'], 'words': words},
                  open(wav[:-4] + '.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        selection[line['id']] = A.take
        print(f"{line['id']}: {len(words)} words ({'measured' if wm else 'estimated'})")
    json.dump(selection, open(sel_path, 'w'), indent=1)
    print('next: core/bin/wb timeline', A.piece)


if __name__ == '__main__':
    main()
