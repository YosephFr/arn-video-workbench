#!/usr/bin/env python3
"""Read the master back: transcribe the delivered video and compare it with the script, line by line.

    python3 tools/transcribe_master.py <piece> [video.mp4]        (default: <piece>/renders/final.mp4)

The mix can hide words (music too loud under a quiet word, an effect on top of a key word) and an edit can clip a
sentence. Listening catches most of it; this catches the rest: every line of timeline.json is compared with what a
speech-to-text model hears in that stretch of the master. Needs OPENAI_API_KEY. Writes <video>.transcript.json and
exits 1 when a line lost words beyond the tolerance.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import speech  # noqa: E402


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    pd = os.path.abspath(sys.argv[1])
    video = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else os.path.join(pd, 'renders', 'final.mp4')
    script = json.load(open(os.path.join(pd, 'script.json')))
    tl = json.load(open(os.path.join(pd, 'timeline.json')))
    language = script.get('language', 'en')
    if not os.environ.get('OPENAI_API_KEY'):
        sys.exit('OPENAI_API_KEY is not set: listen to the master end to end instead, with the script in front of you')
    tr = speech.transcribe(video, language, timestamps=True)
    heard = tr.get('words') or []
    report, bad = {'video': video, 'text': tr['text'], 'lines': []}, 0
    for line in tl['lines']:
        ref = speech.words(line['text'], language)
        got = [w for w in heard if w['start'] >= line['start'] - 0.35 and w['end'] <= line['end'] + 0.35]
        hyp = speech.words(' '.join(w['word'] for w in got), language)
        diff = speech.word_diff(ref, hyp)
        tol = speech.tolerance(len(ref))
        row = {'id': line['id'], 'diff': diff, 'tolerance': tol, 'script': ' '.join(ref), 'heard': ' '.join(hyp)}
        report['lines'].append(row)
        mark = 'ok ' if diff <= tol else 'LOST'
        bad += diff > tol
        print(f"{line['id']:5} {mark} diff {diff}/{len(ref)}" + ('' if diff <= tol else f"\n      script: {row['script']}\n      heard:  {row['heard']}"))
    out = video + '.transcript.json'
    json.dump(report, open(out, 'w'), indent=1, ensure_ascii=False)
    print(f'{len(tl["lines"]) - bad}/{len(tl["lines"])} lines read back intact → {out}')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
