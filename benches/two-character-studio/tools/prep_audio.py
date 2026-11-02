#!/usr/bin/env python3
"""Studio-specific audio, between `wb timeline` / `wb music` and `wb mix`.

    python3 tools/prep_audio.py <piece>

1. Voice treatment: every line whose voice (or the line itself) sets "fx" in script.json ("robot", "robot_light")
   gets that treatment on voice/proc/<id>.wav, the file `wb mix` reads. The untreated take is kept next to it as
   <id>.dry.wav, so running this twice never doubles the effect, and a new `wb timeline` is picked up automatically.
2. The frozen beat (plan.json "pause"): the music bed is low-passed and dipped (or cut) from the freeze to the colour
   return, with short crossfades, so the beat is heard as well as seen without anyone naming it.
3. A faint room tone under the music, so the mix never drops to digital silence (a cut stays a cut, not a dropout).

Run it after `studio plan` and `wb music`, then `wb mix` (script.json "mix": {"lufs": -15.5}).
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import voicefx  # noqa: E402

SR = 48000


def load(path, default=None):
    if not os.path.exists(path):
        return default
    with open(path, encoding='utf-8') as fh:
        return json.load(fh)


def sig(path):
    h = hashlib.sha1()
    with open(path, 'rb') as fh:
        h.update(fh.read())
    return h.hexdigest()


def decode(path, ch=2):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', str(ch), '-ar', str(SR), '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, ch).copy()


def encode(path, x):
    ch = x.shape[1] if x.ndim > 1 else 1
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ac', str(ch), '-ar', str(SR), '-i', '-', '-c:a', 'pcm_f32le', path],
                   input=np.ascontiguousarray(x, np.float32).tobytes(), check=True)


def ffilter(x, af):
    ch = x.shape[1]
    out = subprocess.run(['ffmpeg', '-v', 'error', '-f', 'f32le', '-ac', str(ch), '-ar', str(SR), '-i', '-', '-af', af, '-f', 'f32le', '-ac', str(ch), '-ar', str(SR), '-'],
                         input=np.ascontiguousarray(x, np.float32).tobytes(), capture_output=True, check=True).stdout
    return np.frombuffer(out, np.float32).reshape(-1, ch).copy()


def wet_dry(wet, dry, state, key, make):
    """Keep `dry` as the untreated source of `wet`; (re)apply `make(dry, wet)` only when the source or the recipe changed."""
    rec = state.get(key)
    if os.path.exists(wet) and (rec is None or rec.get('wet') != sig(wet)):
        shutil.copyfile(wet, dry)                       # a fresh file from the core tools: it becomes the new dry source
        rec = None
    if not os.path.exists(dry):
        return False
    recipe = make.__doc__ or ''
    if rec and rec.get('recipe') == recipe and os.path.exists(wet):
        return False
    make(dry, wet)
    state[key] = {'wet': sig(wet), 'recipe': recipe}
    return True


def main(argv):
    pd = os.path.abspath(argv[0])
    script, timeline, plan = load(os.path.join(pd, 'script.json')), load(os.path.join(pd, 'timeline.json')), load(os.path.join(pd, 'plan.json'), {})
    if not timeline:
        sys.exit('no timeline.json: run `core/bin/wb voice <piece>` and `core/bin/wb timeline <piece>` first')
    state_path = os.path.join(pd, 'audio', 'prep.json')
    os.makedirs(os.path.dirname(state_path), exist_ok=True)
    state = load(state_path, {})
    voices = script.get('voices', {})
    spec = {l['id']: l for l in script['lines']}

    # 1. voice treatment on the processed takes
    n_fx = 0
    for line in timeline['lines']:
        preset = spec.get(line['id'], {}).get('fx', voices.get(line['voice'], {}).get('fx'))
        wet = os.path.join(pd, line['audio'])
        if not preset or not os.path.exists(wet):
            continue
        dry = wet[:-4] + '.dry.wav'

        def make(src, dst, preset=preset):
            return voicefx.apply(src, dst, preset)
        make.__doc__ = f'voicefx:{preset}'
        if wet_dry(wet, dry, state, 'voice:' + line['id'], make):
            n_fx += 1
            print(f"  {line['id']}: {preset}")
    # 2 + 3. the music bed: frozen-beat treatment and room tone
    music = os.path.join(pd, 'audio', 'music.wav')
    pause = plan.get('pause')
    room_db = plan.get('room_tone_db', -62.0)
    if os.path.exists(music):
        def treat(src, dst):
            x = decode(src)
            n = len(x)
            t = np.arange(n) / SR
            if pause:
                snd = pause.get('sound', {})
                xf = max(0.02, snd.get('xf', 0.15))
                w = np.clip((t - pause['freeze']) / xf + 0.5, 0, 1) * np.clip((pause['col1'] - t) / xf + 0.5, 0, 1)
                if snd.get('mode', 'lowpass') == 'cut':
                    alt = np.zeros_like(x)
                else:
                    hz = snd.get('lowpass_hz', 700)
                    alt = ffilter(x, f'lowpass=f={hz},lowpass=f={hz}') * 10 ** (snd.get('dip_db', -12) / 20)
                x = x * (1 - w[:, None]) + alt[:n] * w[:, None]
            rng = np.random.default_rng(11)                 # pink-ish room tone: integrated white noise, high-passed
            noise = np.cumsum(rng.standard_normal((n, 2)), axis=0)
            c = np.cumsum(np.vstack([np.zeros((1, 2)), noise]), axis=0)          # moving average over 10 ms (cumsum trick)
            k = 480; ma = np.empty_like(noise); pos = np.arange(n); lo = np.clip(pos - k // 2, 0, n); hi = np.clip(pos + k // 2, 0, n)
            ma[:] = (c[hi] - c[lo]) / np.maximum(1, (hi - lo))[:, None]
            noise = (noise - ma).astype(np.float32)                             # high-passed brown noise: a soft room hum
            noise /= np.sqrt(np.mean(noise ** 2)) + 1e-9
            x = x + noise * 10 ** (room_db / 20)
            encode(dst, x.astype(np.float32))
        treat.__doc__ = f"pause:{json.dumps(pause, sort_keys=True)}|room:{room_db}"
        if wet_dry(music, music[:-4] + '.dry.wav', state, 'music', treat):
            print('  music bed: ' + ('frozen-beat treatment + ' if pause else '') + 'room tone')
    else:
        print('  no audio/music.wav yet (run `core/bin/wb music <piece>`): music treatment skipped')
    with open(state_path, 'w', encoding='utf-8') as fh:
        json.dump(state, fh, indent=1)
    print(f'prep: {n_fx} voice lines treated; next: core/bin/wb mix {argv[0]}')


if __name__ == '__main__':
    main(sys.argv[1:])
