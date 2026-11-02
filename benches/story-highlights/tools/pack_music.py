#!/usr/bin/env python3
"""One music bed for a whole pack, continuous from story to story.

    python3 tools/pack_music.py samples/getting-started [--force]

Needs every story's timeline.json (core/bin/wb timeline). Composes one bed as long as the reel (the stories end to
end, minus the 0.3 s joins of tools/reel.py) with `core/bin/wb music`, in the style of the first story's
script.json "music", with an arc over the whole pack: it starts on the beat, settles under the voice, lifts a little
before the end and resolves on the last story's brand close. Each story then gets its slice in
<story>/audio/music.wav (a 0.25 s fade-in when it does not start at 0) plus the stamp that tells `wb music` the slice
is up to date. Alone, each story has its music; in the reel the music never restarts.
Next: `core/bin/wb sfx <story>` and `core/bin/wb mix <story>` for every story (tools/audio-pack.sh does it all).
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
WB = os.path.join(ROOT, 'core', 'bin', 'wb')
XF = 0.3   # the joins of tools/reel.py


def load(path):
    with open(path, encoding='utf-8') as fh:
        return json.load(fh)


def save(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    pd = os.path.abspath(sys.argv[1])
    pack = load(os.path.join(pd, 'pack.json'))
    stories = [os.path.join(pd, s) for s in pack['stories']]
    missing = [s for s in stories if not os.path.exists(os.path.join(s, 'timeline.json'))]
    if missing:
        sys.exit('run core/bin/wb voice + timeline first for: ' + ', '.join(os.path.basename(s) for s in missing))
    tls = [load(os.path.join(s, 'timeline.json')) for s in stories]
    offsets, t = [], 0.0
    for tl in tls:
        offsets.append(t)
        t += tl['duration'] - XF
    total = offsets[-1] + tls[-1]['duration']
    last_end = offsets[-1] + tls[-1].get('last_end', tls[-1]['duration'])

    # The bed is a piece of its own, without lines: wb music composes over its duration (intro → main → lift → outro).
    music = dict(load(os.path.join(stories[0], 'script.json')).get('music', {}))
    music.pop('sections', None)   # line anchors of one story mean nothing over the whole pack
    bed = os.path.join(pd, 'audio', 'bed')
    save(os.path.join(bed, 'script.json'), {'title': f"{pack['title']} · music bed", 'lines': [], 'tail': 0, 'music': music})
    save(os.path.join(bed, 'timeline.json'), {'duration': round(total, 3), 'last_end': round(last_end, 3), 'fps': 30, 'lines': []})
    subprocess.run([WB, 'music', bed] + (['--force'] if '--force' in sys.argv else []), check=True)
    source = os.path.join(bed, 'audio', 'music.wav')

    for story, off, tl in zip(stories, offsets, tls):
        dst = os.path.join(story, 'audio', 'music.wav')
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        fade = 'afade=t=in:d=0.25' if off > 0 else 'anull'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{off:.3f}', '-t', f"{tl['duration']:.3f}", '-i', source, '-af', fade,
                        '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s24le', dst], check=True)
        # the stamp wb music writes, so it keeps this slice instead of composing a new bed for the story alone
        cfg = load(os.path.join(story, 'script.json')).get('music', {})
        save(os.path.join(story, 'audio', 'music.json'), {'music': cfg, 'duration': tl['duration'], 'marks': [round(l['start'], 2) for l in tl['lines']]})
        print(f"  {os.path.basename(story)}: {off:.2f}–{off + tl['duration']:.2f} s of the bed")
    print(f"pack bed {total:.1f} s → {len(stories)} slices")


if __name__ == '__main__':
    main()
