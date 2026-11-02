"""Music bed composed over the piece's timeline.

    wb music <piece> [--force]

script.json → "music": {
  "provider": "procedural" | "elevenlabs",   # procedural (default) needs nothing; elevenlabs needs ELEVENLABS_API_KEY
  "style": "pulse" | "tutorial" | "playful" | "ambient" | "news" | "tension",   # default tutorial
  "bpm": 96, "key": "A", "scale": "major" | "minor",                            # defaults: the style's bpm, A, major
  "sections": [{"at": 0, "mood": "intro"}, {"at": "L03", "mood": "build"}, {"at": "L06", "mood": "main"}],
  "prompt": ["extra style words for the elevenlabs provider"],
  "none": true,                               # no music at all
  "level": -23.5,                             # read by wb mix: loudness of the bed in LUFS before ducking
  "duck": -10                                 # read by wb mix: dB the bed dips while a voice speaks
}
Moods: intro, build, main, lift, break, outro. A section's "at" is seconds or an anchor ("L03", "L03:word"). Without
sections the arc is intro → main → lift → outro, and the last bars resolve on a long chord with a bell, so the music
ends with the piece instead of being cut. Writes audio/music.wav.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

import numpy as np

from . import common, timeline as tl
from .common import SR

NOTES = {'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8, 'Ab': 8,
         'A': 9, 'A#': 10, 'Bb': 10, 'B': 11}
PROGRESSIONS = {'major': [(0, 'maj'), (7, 'maj'), (9, 'min'), (5, 'maj')], 'minor': [(0, 'min'), (8, 'maj'), (3, 'maj'), (10, 'maj')]}
TRIADS = {'maj': (0, 4, 7), 'min': (0, 3, 7)}
STYLES = {  # layers per style: which instruments play and how busy
    'pulse':    {'kick': 'four', 'hat': 'eighths', 'bass': 'pulse', 'pad': 0.35, 'pluck': 'arp', 'bpm': 104},
    'tutorial': {'kick': 'half', 'hat': 'eighths', 'bass': 'roots', 'pad': 0.30, 'pluck': 'arp', 'bpm': 98},
    'playful':  {'kick': 'half', 'hat': 'offbeat', 'bass': 'bounce', 'pad': 0.20, 'pluck': 'staccato', 'bpm': 112},
    'ambient':  {'kick': None, 'hat': None, 'bass': 'roots', 'pad': 0.55, 'pluck': 'sparse', 'bpm': 84},
    'news':     {'kick': 'four', 'hat': 'sixteenths', 'bass': 'pulse', 'pad': 0.25, 'pluck': 'stabs', 'bpm': 120},
    'tension':  {'kick': 'heartbeat', 'hat': 'ticks', 'bass': 'drone', 'pad': 0.40, 'pluck': 'sparse', 'bpm': 96},
}
MOOD_LAYERS = {
    'intro': {'pad', 'pluck'}, 'build': {'pad', 'pluck', 'hat', 'bass'}, 'main': {'pad', 'pluck', 'hat', 'bass', 'kick'},
    'lift': {'pad', 'pluck', 'hat', 'bass', 'kick', 'high'}, 'break': {'pad'}, 'outro': {'pad', 'bell'},
}


def midi_hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def env(n, a=0.005, r=0.3):
    t = np.arange(n) / SR
    return np.clip(t / a, 0, 1) * np.exp(-t / max(r, 1e-3))


def tone(freq, seconds, kind='sine', a=0.005, r=0.3):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    if kind == 'pluck':
        x = np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(4 * np.pi * freq * t) + 0.12 * np.sin(6 * np.pi * freq * t)
    elif kind == 'pad':
        x = sum(np.sin(2 * np.pi * freq * d * t + p) for d, p in ((1.0, 0), (1.003, 1.1), (0.997, 2.3), (2.0, 0.4)))
        x *= 0.3
    elif kind == 'bass':
        x = np.sin(2 * np.pi * freq * t) + 0.2 * np.sin(4 * np.pi * freq * t)
    else:
        x = np.sin(2 * np.pi * freq * t)
    return x * env(n, a, r)


def kick():
    t = np.arange(int(0.35 * SR)) / SR
    return np.sin(2 * np.pi * np.cumsum(48 + 110 * np.exp(-t * 32)) / SR) * np.exp(-t * 9)


def hat(rng):
    n = int(0.06 * SR)
    x = rng.standard_normal(n)
    x = x - np.convolve(x, np.ones(6) / 6, mode='same')
    return x * np.exp(-np.arange(n) / SR * 70) * 0.35


def add(bus, x, t, gain=1.0):
    i = int(t * SR)
    if i >= len(bus):
        return
    n = min(len(x), len(bus) - i)
    bus[i:i + n] += x[:n] * gain


def section_plan(cfg, timeline, duration):
    if cfg.get('sections'):
        marks = []
        for s in cfg['sections']:
            at = s['at']
            t = 0.0 if at == 0 else (tl.anchor_time(timeline, at) - 0.15 if isinstance(at, str) else float(at))
            marks.append((max(0.0, t), s.get('mood', 'main')))
    else:
        last = timeline.get('last_end', duration)
        marks = [(0.0, 'intro'), (last * 0.25, 'main'), (last * 0.7, 'lift'), (last + 0.2, 'outro')]
    marks.sort()
    return marks


def mood_at(marks, t):
    mood = marks[0][1]
    for at, m in marks:
        if t >= at:
            mood = m
    return mood


def compose(cfg, timeline, duration):
    style = STYLES.get(cfg.get('style', 'tutorial'), STYLES['tutorial'])
    bpm = float(cfg.get('bpm', style['bpm']))
    beat = 60.0 / bpm
    bar = 4 * beat
    root = 48 + NOTES.get(cfg.get('key', 'A'), 9)
    prog = PROGRESSIONS[cfg.get('scale', 'major')]
    marks = section_plan(cfg, timeline, duration)
    rng = np.random.default_rng(11)
    n = int(duration * SR) + SR
    bus = np.zeros(n)
    k = kick()
    outro_at = next((at for at, m in marks if m == 'outro'), None)
    nbars = int(np.ceil(duration / bar))
    for b in range(nbars):
        t0 = b * bar
        mood = mood_at(marks, t0)
        layers = MOOD_LAYERS.get(mood, MOOD_LAYERS['main'])
        deg, quality = prog[b % len(prog)]
        chord = [root + deg + i for i in TRIADS[quality]]
        if outro_at is not None and t0 >= outro_at:
            # resolve: one long tonic chord with a bell, then silence
            for m in (root, root + 4 if prog is PROGRESSIONS['major'] else root + 3, root + 7, root + 12):
                add(bus, tone(midi_hz(m), min(4.0, duration - t0 + 1.0), 'pad', a=0.05, r=1.6), t0, style['pad'] * 0.9)
            add(bus, tone(midi_hz(root + 36), 2.5, 'pluck', a=0.002, r=0.9), t0 + 0.02, 0.25)
            break
        if 'pad' in layers:
            for m in chord:
                add(bus, tone(midi_hz(m + 12), bar + 0.3, 'pad', a=0.12, r=bar * 0.8), t0, style['pad'] / 3)
        if 'bass' in layers and style['bass']:
            pattern = {'pulse': [i * beat / 2 for i in range(8)], 'roots': [0, 2 * beat], 'bounce': [0, 1.5 * beat, 2 * beat, 3.5 * beat],
                       'drone': [0]}[style['bass']]
            for p in pattern:
                length = bar if style['bass'] == 'drone' else beat * 0.45
                add(bus, tone(midi_hz(chord[0] - 12), length, 'bass', a=0.004, r=length * 0.6), t0 + p, 0.32)
        if 'kick' in layers and style['kick']:
            hits = {'four': [0, 1, 2, 3], 'half': [0, 2], 'heartbeat': [0, 0.3, 2, 2.3]}[style['kick']]
            for h in hits:
                add(bus, k, t0 + h * beat, 0.55)
        if 'hat' in layers and style['hat']:
            steps = {'eighths': [i / 2 for i in range(8)], 'offbeat': [0.5, 1.5, 2.5, 3.5], 'sixteenths': [i / 4 for i in range(16)],
                     'ticks': [i / 2 for i in range(8)]}[style['hat']]
            for s in steps:
                add(bus, hat(rng), t0 + s * beat, 0.5 if s % 1 else 0.3)
        if 'pluck' in layers and style['pluck']:
            if style['pluck'] == 'arp':
                notes = [chord[i % 3] + 12 * (1 + i // 3 % 2) for i in range(8)]
                for i, m in enumerate(notes):
                    add(bus, tone(midi_hz(m + (12 if 'high' in layers else 0)), beat * 0.6, 'pluck', r=beat * 0.35), t0 + i * beat / 2, 0.12)
            elif style['pluck'] == 'staccato':
                for i in (0, 0.75, 1.5, 2.5, 3.25):
                    add(bus, tone(midi_hz(chord[int(i) % 3] + 24), beat * 0.25, 'pluck', r=0.06), t0 + i * beat, 0.16)
            elif style['pluck'] == 'stabs':
                for i in (0, 1.5, 3):
                    for m in chord:
                        add(bus, tone(midi_hz(m + 12), beat * 0.3, 'pluck', r=0.09), t0 + i * beat, 0.07)
            else:
                add(bus, tone(midi_hz(chord[b % 3] + 24), bar, 'pluck', r=bar * 0.4), t0, 0.12)
    bus = bus[: int(duration * SR)]
    fade = int(0.04 * SR)
    bus[:fade] *= np.linspace(0, 1, fade)
    stereo = np.stack([bus, np.roll(bus, int(0.011 * SR)) * 0.92 + bus * 0.08], axis=1)
    return (stereo / (np.max(np.abs(stereo)) or 1) * 0.8).astype(np.float32)


def compose_elevenlabs(cfg, timeline, duration, out_wav):
    key = os.environ.get('ELEVENLABS_API_KEY')
    if not key:
        raise RuntimeError('ELEVENLABS_API_KEY is not set')
    marks = section_plan(cfg, timeline, duration)
    words = {'intro': 'sparse, attention-grabbing from the first beat', 'build': 'the groove settles under the voice',
             'main': 'full groove, uncluttered midrange', 'lift': 'brighter lift toward the ending', 'break': 'drop to a soft pad',
             'outro': 'one final warm chord with a bell, short ring-out, ends cleanly'}
    sections = []
    for i, (at, mood) in enumerate(marks):
        end = marks[i + 1][0] if i + 1 < len(marks) else duration
        ms = int(round((end - at) * 1000))
        if ms < 3000 and sections:
            sections[-1]['duration_ms'] += ms
            continue
        sections.append({'section_name': mood, 'positive_local_styles': [words.get(mood, mood)], 'negative_local_styles': [],
                         'duration_ms': ms, 'lines': []})
    sections[-1]['duration_ms'] += int(round(duration * 1000)) - sum(s['duration_ms'] for s in sections)
    style = cfg.get('style', 'tutorial')
    plan = {'positive_global_styles': ['instrumental', f'{style} background music', f"{cfg.get('bpm', STYLES.get(style, STYLES['tutorial'])['bpm'])} BPM",
                                       'clean mix'] + list(cfg.get('prompt', [])),
            'negative_global_styles': ['vocals', 'singing', 'lyrics', 'choir'], 'sections': sections}
    body = json.dumps({'composition_plan': plan, 'model_id': 'music_v1'}).encode()
    for attempt in range(3):
        req = urllib.request.Request('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_192', data=body,
                                     headers={'Content-Type': 'application/json', 'xi-api-key': key})
        try:
            with urllib.request.urlopen(req, timeout=600) as resp:
                mp3 = out_wav[:-4] + '.mp3'
                with open(mp3, 'wb') as fh:
                    fh.write(resp.read())
            common.save_wav(out_wav, common.decode(mp3, channels=2))
            return
        except urllib.error.HTTPError as err:
            if err.code in (429, 500, 502, 503) and attempt < 2:
                time.sleep(6 * (attempt + 1))
                continue
            raise RuntimeError(f'music {err.code}: {err.read().decode(errors="replace")[:300]}')


def main(argv):
    pd = common.piece_dir(argv[0])
    out = os.path.join(pd, 'audio', 'music.wav')
    script = common.load_script(pd)
    cfg = script.get('music', {})
    if cfg.get('none'):
        print('music disabled in script.json')
        return
    timeline = common.load_timeline(pd)
    duration = timeline['duration']
    # Regenerate when the brief or the timeline changed; a paid provider is only called again with --force.
    stamp = {'music': cfg, 'duration': duration, 'marks': [round(l['start'], 2) for l in timeline['lines']]}
    stamp_path = os.path.join(pd, 'audio', 'music.json')
    unchanged = common.load_json(stamp_path, default={}) == stamp
    if os.path.exists(out) and '--force' not in argv and (unchanged or cfg.get('provider') == 'elevenlabs'):
        print('up to date', out if unchanged else f'{out} (the timeline changed: run with --force to recompose)')
        return
    os.makedirs(os.path.dirname(out), exist_ok=True)
    if cfg.get('provider') == 'elevenlabs':
        compose_elevenlabs(cfg, timeline, duration, out)
    else:
        common.save_wav(out, compose(cfg, timeline, duration))
    common.save_json(stamp_path, stamp)
    print('music →', out)


if __name__ == '__main__':
    main(sys.argv[1:])
