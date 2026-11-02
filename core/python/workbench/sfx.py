"""Procedural sound effects and the SFX stem of a piece.

    wb sfx <piece>            # renders events.json → audio/sfx.wav
    wb sfx --list             # names in the library
    wb sfx --audition DIR     # writes every effect to DIR/<name>.wav to listen to them

events.json: [{"t": 1.2 | "at": "L02:word", "name": "pop", "gain_db": -12, "pan": 0.0, "rev": false, "dur": null}]
A WAV in <piece>/audio/sfx/<name>.wav overrides the procedural effect of the same name.
Everything here is synthesised: no third-party samples are shipped.
"""
import os
import sys

import numpy as np

from . import common, timeline as tl
from .common import SR

RNG = np.random.default_rng(7)


def _t(seconds):
    return np.arange(int(seconds * SR)) / SR


def _env(n, attack=0.002, decay=0.2, curve=4.0):
    t = np.arange(n) / SR
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    d = np.exp(-curve * np.clip(t - attack, 0, None) / max(decay, 1e-4))
    return a * d


def _lowpass(x, cutoff):
    """One-pole low-pass; cutoff may be an array (sweeps)."""
    cutoff = np.broadcast_to(np.asarray(cutoff, dtype=np.float64), x.shape)
    alpha = 1 - np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc += alpha[i] * (x[i] - acc)
        y[i] = acc
    return y


def _highpass(x, cutoff):
    return x - _lowpass(x, cutoff)


def _norm(x, peak=0.9):
    m = float(np.max(np.abs(x))) or 1.0
    return (x / m * peak).astype(np.float32)


def pop():
    t = _t(0.12)
    f = 900 * np.exp(-t * 28) + 220
    return _norm(np.sin(2 * np.pi * np.cumsum(f) / SR) * _env(len(t), 0.001, 0.05))


def click():
    n = int(0.03 * SR)
    return _norm(_highpass(RNG.standard_normal(n), 2500) * _env(n, 0.0005, 0.008))


def tap():
    t = _t(0.08)
    body = np.sin(2 * np.pi * 180 * t) * _env(len(t), 0.001, 0.03)
    k = click()
    body[: len(k)] += 0.35 * k[: len(body)]
    return _norm(body)


def tick():
    t = _t(0.05)
    return _norm(np.sin(2 * np.pi * 3200 * t) * _env(len(t), 0.0005, 0.012))


def whoosh(length=0.55, up=True):
    n = int(length * SR)
    t = np.linspace(0, 1, n)
    shape = np.sin(np.pi * t) ** 1.6
    sweep = 400 + 5200 * (t if up else 1 - t)
    x = _lowpass(RNG.standard_normal(n), sweep) * shape
    return _norm(_highpass(x, 180))


def swoosh():
    return whoosh(0.32, up=False)


def riser(length=1.6):
    n = int(length * SR)
    t = np.linspace(0, 1, n)
    noise = _lowpass(RNG.standard_normal(n), 300 + 7000 * t ** 2) * t ** 2
    tone = np.sin(2 * np.pi * np.cumsum(220 + 660 * t ** 2) / SR) * 0.25 * t
    return _norm(noise + tone)


def hit():
    t = _t(0.7)
    kick = np.sin(2 * np.pi * np.cumsum(55 + 140 * np.exp(-t * 30)) / SR) * _env(len(t), 0.001, 0.35)
    crack = _highpass(RNG.standard_normal(len(t)), 1500) * _env(len(t), 0.0005, 0.06) * 0.5
    return _norm(kick + crack)


def thud():
    t = _t(0.4)
    return _norm(np.sin(2 * np.pi * np.cumsum(70 + 60 * np.exp(-t * 25)) / SR) * _env(len(t), 0.002, 0.15))


def ding(freq=1318.5):
    t = _t(1.4)
    partials = [(1, 1.0), (2.76, 0.35), (5.4, 0.18), (8.9, 0.08)]
    x = sum(a * np.sin(2 * np.pi * freq * r * t) * np.exp(-t * (2.2 + r)) for r, a in partials)
    return _norm(x * _env(len(t), 0.001, 1.2, curve=1.0))


def bell():
    return ding(987.8)


def coin():
    a, b = ding(1567.98)[: int(0.09 * SR)], ding(2093.0)
    return _norm(np.concatenate([a, b]))


def typing(length=1.2, rate=11):
    n = int(length * SR)
    out = np.zeros(n)
    k = click()
    t = 0.0
    while t < length - 0.05:
        i = int(t * SR)
        g = 0.5 + 0.5 * RNG.random()
        out[i:i + len(k)] += k[: n - i] * g
        t += (1 / rate) * (0.6 + 0.8 * RNG.random())
    return _norm(out)


def paper():
    n = int(0.45 * SR)
    t = np.linspace(0, 1, n)
    grain = (RNG.random(n) > 0.92) * RNG.standard_normal(n)
    return _norm(_highpass(_lowpass(grain + 0.3 * RNG.standard_normal(n), 6000), 900) * np.sin(np.pi * t))


def camera():
    return _norm(np.concatenate([click(), np.zeros(int(0.06 * SR)), click()]))


def logo():
    """Brand sting: a soft whoosh into a warm chord with a bell on top."""
    t = _t(2.2)
    chord = sum(np.sin(2 * np.pi * f * t) for f in (261.6, 329.6, 392.0, 523.3)) * _env(len(t), 0.01, 1.6, curve=2.0) * 0.4
    sting = np.zeros_like(t)
    sw = whoosh(0.4)
    sting[: len(sw)] += sw * 0.6
    b = bell()
    off = int(0.32 * SR)
    sting[off: off + len(b)] += b[: len(sting) - off] * 0.7
    return _norm(chord + sting)


LIBRARY = {'pop': pop, 'click': click, 'tap': tap, 'tick': tick, 'whoosh': whoosh, 'swoosh': swoosh, 'riser': riser,
           'hit': hit, 'thud': thud, 'ding': ding, 'bell': bell, 'coin': coin, 'typing': typing, 'paper': paper,
           'camera': camera, 'logo': logo}


def effect(name, piece=None):
    if piece:
        custom = os.path.join(piece, 'audio', 'sfx', f'{name}.wav')
        if os.path.exists(custom):
            return common.decode(custom)
    if name not in LIBRARY:
        raise KeyError(f'unknown sound effect {name!r}; available: {", ".join(sorted(LIBRARY))}')
    return LIBRARY[name]()


def pan_stereo(x, p):
    a = (p + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)], axis=1)


def render_events(pd, timeline, duration):
    events = common.load_json(os.path.join(pd, 'events.json'), default=[])
    bus = np.zeros((int(round(duration * SR)), 2), np.float32)
    cache = {}
    for ev in events:
        t = float(ev['t']) if 't' in ev else tl.anchor_time(timeline, ev['at'])
        key = (ev['name'], ev.get('rev', False), ev.get('dur'))
        if key not in cache:
            x = effect(ev['name'], pd)
            if ev.get('dur'):
                x = x[: int(ev['dur'] * SR)]
            if ev.get('rev'):
                x = x[::-1].copy()
            cache[key] = x
        x = pan_stereo(cache[key] * common.db(ev.get('gain_db', -12)), ev.get('pan', 0.0))
        i = int(round(t * SR))
        if i >= len(bus):
            continue
        if i < 0:            # an effect anchored before the start keeps only its audible tail
            x, i = x[-i:], 0
        n = min(len(x), len(bus) - i)
        bus[i:i + n] += x[:n]
    return bus, events


def main(argv):
    if argv and argv[0] == '--list':
        print('\n'.join(sorted(LIBRARY)))
        return
    if argv and argv[0] == '--audition':
        out = argv[1] if len(argv) > 1 else 'sfx-audition'
        for name in LIBRARY:
            common.save_wav(os.path.join(out, f'{name}.wav'), effect(name))
        print('wrote', len(LIBRARY), 'effects to', out)
        return
    pd = common.piece_dir(argv[0])
    timeline = common.load_timeline(pd)
    bus, events = render_events(pd, timeline, timeline['duration'])
    common.save_wav(os.path.join(pd, 'audio', 'sfx.wav'), bus)
    print(f'{len(events)} events → audio/sfx.wav')


if __name__ == '__main__':
    main(sys.argv[1:])
