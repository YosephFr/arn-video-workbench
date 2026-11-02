"""Final mix: voices + music composed on the timeline + sound effects on the picture.

    wb mix <piece>        → audio/mix.wav (48 kHz stereo), audio/stems/*.wav and audio/mix-report.json

Every time comes from timeline.json (the same word marks that drive the animation) and events.json.
- Voices: levelled per line, optional line effect (phone, radio, far, voice-note), gentle compression.
- Music: set to script.music.level (LUFS, default −23.5), ducked under the voice with an envelope computed from the
  voice itself (script.music.duck, default −10 dB), so it stays audible between sentences.
- Effects: ducked a little under the voice too.
- The sum is normalised to script.mix.lufs (default −14 LUFS) with a peak limiter whose ceiling is verified after an
  AAC 256k encode, so the delivered file keeps true peak ≤ −1 dBTP.
"""
import os
import subprocess
import sys

import numpy as np

from . import common, sfx
from .common import SR, db

EFFECTS = {
    'voice-note': 'highpass=f=120,lowpass=f=10000,equalizer=f=3000:t=q:w=1.4:g=-1.5',
    'phone': 'highpass=f=320,lowpass=f=3600,acompressor=threshold=-24dB:ratio=3:attack=5:release=80',
    'radio': 'highpass=f=400,lowpass=f=3200,acrusher=bits=10:mix=0.25,acompressor=threshold=-20dB:ratio=4',
    'far': 'highpass=f=180,lowpass=f=5200,aecho=0.6:0.5:60:0.25',
}


def fade(x, fade_in=0.0, fade_out=0.0):
    x = x.copy()
    n = len(x)
    a, b = min(n, int(fade_in * SR)), min(n, int(fade_out * SR))
    if a:
        x[:a] *= (np.sin(np.linspace(0, np.pi / 2, a)) ** 2)[:, None]
    if b:
        x[n - b:] *= (np.cos(np.linspace(0, np.pi / 2, b)) ** 2)[:, None]
    return x


def place(bus, x, t, gain_db=0.0):
    i = int(round(t * SR))
    if i >= len(bus):
        return
    if i < 0:
        x, i = x[-i:], 0
    n = min(len(x), len(bus) - i)
    bus[i:i + n] += x[:n] * db(gain_db)


def pan(x, p):
    a = (p + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)], 1)


def measure(x, tmp):
    common.save_wav(tmp, x)
    return common.loudness(tmp)


def voice_stem(pd, script, timeline, n, tmp):
    spec = {line['id']: line for line in script['lines']}
    clips, rms = {}, {}
    for line in timeline['lines']:
        y = common.decode(os.path.join(pd, line['audio']))
        peak = float(np.abs(y).max()) if len(y) else 0.0
        active = y[np.abs(y) > 0.01 * peak] if peak > 0 else y
        rms[line['id']] = float(20 * np.log10(np.sqrt(np.mean(active ** 2)) + 1e-9)) if len(active) else -120.0
        clips[line['id']] = y
    audible = [v for v in rms.values() if v > -90]
    median = float(np.median(audible)) if audible else -120.0
    out = np.zeros((n, 2), np.float32)
    for line in timeline['lines']:
        y = clips[line['id']].copy()
        if rms[line['id']] <= -90:
            continue
        s = spec.get(line['id'], {})
        y *= db(float(np.clip((median - rms[line['id']]) * 0.6, -4, 6)) + s.get('gain_db', 0.0))
        if line.get('effect') in EFFECTS:
            y = common.ffilter(y, EFFECTS[line['effect']])
        place(out, pan(y, s.get('pan', 0.0)), line['start'])
    if not audible:
        return out, rms
    out = common.ffilter(out, 'highpass=f=70,acompressor=threshold=-27dB:ratio=3.2:attack=6:release=120:makeup=3dB,'
                              'equalizer=f=3200:t=q:w=1.2:g=1.5')
    level, _ = measure(out, tmp)
    return (out * db(-17.0 - level)).astype(np.float32), rms


def duck_envelope(voice, n, depth_db=-10.0, lookahead=0.06, attack=0.04, release=0.42):
    hop = int(0.01 * SR)
    mono = voice.mean(1)
    frames = len(mono) // hop
    r = np.sqrt(np.mean(mono[:frames * hop].reshape(frames, hop) ** 2, 1) + 1e-12)
    active = (20 * np.log10(r) > -40).astype(np.float32)
    bridge, run = int(0.18 / 0.01), 0
    for i in range(len(active)):          # bridge short gaps between words
        if active[i] == 0:
            run += 1
        else:
            if 0 < run <= bridge:
                active[i - run:i] = 1
            run = 0
    shift = int(lookahead / 0.01)
    active = np.concatenate([active[shift:], np.zeros(shift, np.float32)])
    y = np.zeros_like(active)
    a1, a2, cur = 1 - np.exp(-0.01 / attack), 1 - np.exp(-0.01 / release), 0.0
    for i, v in enumerate(active):
        cur += (v - cur) * (a1 if v > cur else a2)
        y[i] = cur
    gains = np.interp(np.arange(n) / SR, (np.arange(len(y)) + 0.5) * 0.01, depth_db * y)
    return db(gains).astype(np.float32)


def music_stem(pd, script, n, tmp):
    path = os.path.join(pd, 'audio', 'music.wav')
    if not os.path.exists(path):
        return np.zeros((n, 2), np.float32), False
    cfg = script.get('music', {})
    x = common.decode(path, channels=2)[:n]
    if len(x) < n:
        x = np.concatenate([x, np.zeros((n - len(x), 2), np.float32)])
    x = fade(x, 0.0, 0.6)
    level, _ = measure(x, tmp)
    x = x * db(cfg.get('level', -23.5) - level)
    return common.ffilter(x, 'equalizer=f=320:t=q:w=1.0:g=-1.5,equalizer=f=2500:t=q:w=1.2:g=-2'), True


def main(argv):
    pd = common.piece_dir(argv[0])
    script = common.load_script(pd)
    timeline = common.load_timeline(pd)
    n = int(round(timeline['duration'] * SR))
    target = float(script.get('mix', {}).get('lufs', -14.0))
    stems = os.path.join(pd, 'audio', 'stems')
    os.makedirs(stems, exist_ok=True)
    tmp = os.path.join(stems, '_meter.wav')

    voice, rms = voice_stem(pd, script, timeline, n, tmp)
    music, has_music = music_stem(pd, script, n, tmp)
    fx, events = sfx.render_events(pd, timeline, timeline['duration'])
    duck = duck_envelope(voice, n, script.get('music', {}).get('duck', -10.0))
    music_d = music * duck[:, None]
    fx_d = fx * (0.32 + 0.68 * duck)[:, None]
    mix = fade(voice + music_d + fx_d, 0.0, 0.35)
    for name, stem in (('voice', voice), ('music', music_d), ('sfx', fx_d)):
        common.save_wav(os.path.join(stems, f'{name}.wav'), stem)

    out = os.path.join(pd, 'audio', 'mix.wav')
    if float(np.abs(mix).max()) < 1e-6:
        common.save_wav(out, mix)
        common.save_json(os.path.join(pd, 'audio', 'mix-report.json'), {'silent': True, 'duration': timeline['duration']})
        print('silent mix (no voice, music or effects) →', out)
        return
    pre_i, pre_tp = measure(mix, tmp)
    gain, ceiling, aac = target - pre_i, -2.5, os.path.join(stems, '_aac.m4a')
    for _ in range(12):
        # the limiter runs 4× oversampled so it also catches inter-sample peaks; the result is checked after AAC encoding
        y = common.ffilter(mix * db(gain), f'aresample=192000,alimiter=limit={db(ceiling):.4f}:attack=3:release=60:level=disabled,aresample={SR}')
        common.save_wav(out, y)
        integrated, peak = common.loudness(out)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', out, '-c:a', 'aac', '-b:a', '256k', aac], check=True)
        aac_i, aac_tp = common.loudness(aac)
        if aac_tp > -1.0:                      # true peak first: a quieter file beats a clipped one
            ceiling -= (aac_tp + 1.0) + 0.3
            continue
        if abs(integrated - target) < 0.15:
            break
        gain += target - integrated
    if aac_tp > -1.0:
        print(f'WARNING: true peak after AAC is {aac_tp} dBTP; lower the music or effects level', file=sys.stderr)
    for f in (tmp, aac):
        if os.path.exists(f):
            os.remove(f)
    report = {'duration': timeline['duration'], 'target_lufs': target, 'voice_line_rms_db': {k: round(v, 1) for k, v in rms.items()},
              'pre': {'lufs': pre_i, 'true_peak': pre_tp}, 'gain_db': round(gain, 2), 'limiter_ceiling_dbfs': round(ceiling, 2),
              'final': {'lufs': integrated, 'true_peak': peak}, 'aac256': {'lufs': aac_i, 'true_peak': aac_tp},
              'music': has_music, 'events': len(events)}
    common.save_json(os.path.join(pd, 'audio', 'mix-report.json'), report)
    print(f'mix → {out}  {integrated} LUFS  TP {peak} dBTP  (AAC 256k: {aac_i} LUFS, TP {aac_tp})  events={len(events)}')


if __name__ == '__main__':
    main(sys.argv[1:])
