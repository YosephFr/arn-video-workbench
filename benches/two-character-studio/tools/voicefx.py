#!/usr/bin/env python3
"""Voice treatments for the AI character, as plain DSP (ffmpeg + the rubberband CLI). No model, no keys.

    python3 tools/voicefx.py IN.wav OUT.wav [--preset robot|robot_light]

robot        a calm, deep, slightly metallic machine voice (the stoic film-robot kind): pitch −1 semitone with the
             formants preserved, an octave-down shadow at 20% (low-passed at 1.8 kHz), a 62 Hz amplitude ring at 12%,
             a short comb (6 and 11 ms), EQ (high-pass 75 Hz, +2 dB at 140 Hz, −2 dB at 320 Hz, +3 dB at 2.6 kHz,
             +1.5 dB shelf at 9 kHz, low-pass 11 kHz), 2.5:1 compression and a small room (55/90 ms).
robot_light  the same colour without the pitch work (ring, comb, EQ, compression, room): for a lighter assistant.

The pitch steps use the rubberband CLI (formants preserved). Without it, ffmpeg's rubberband filter is used if it was
compiled in; otherwise a resample shift (formants move, so the voice gets a little darker) with a warning.
The output keeps the input's length and timing, so it can be applied after the timeline is built.
"""
import os
import shutil
import subprocess
import sys
import tempfile

SR = 48000
REST = ('aeval=val(0)*(0.88+0.12*sin(2*PI*62*t)):c=same,'
        'aecho=0.9:0.55:6|11:0.20|0.12,'
        'highpass=f=75,equalizer=f=140:t=q:w=1.0:g=2,equalizer=f=320:t=q:w=1.0:g=-2,equalizer=f=2600:t=q:w=1.2:g=3,'
        'highshelf=f=9000:g=1.5,lowpass=f=11000,'
        'acompressor=threshold=0.12:ratio=2.5:attack=8:release=120,'
        'aecho=0.85:0.5:55|90:0.10|0.06')


def ff(args):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', *args], check=True)


def has_ff_rubberband():
    out = subprocess.run(['ffmpeg', '-hide_banner', '-filters'], capture_output=True, text=True).stdout
    return ' rubberband ' in out


def pitch(src, dst, semitones):
    if shutil.which('rubberband'):
        subprocess.run(['rubberband', '-q', '-p', str(semitones), '-F', '--fine', src, dst], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    elif has_ff_rubberband():
        ff(['-i', src, '-af', f'rubberband=pitch={2 ** (semitones / 12):.6f}:formant=preserved', dst])
    else:
        k = 2 ** (semitones / 12)
        print('  voicefx: no rubberband available, using a resample pitch shift (formants not preserved)', file=sys.stderr)
        ff(['-i', src, '-af', f'asetrate={SR * k:.2f},aresample={SR},atempo={1 / k:.6f}', dst])


def apply(src, dst, preset='robot'):
    if preset not in ('robot', 'robot_light'):
        raise SystemExit(f'unknown voice preset {preset!r} (robot, robot_light)')
    with tempfile.TemporaryDirectory() as d:
        a, b, c = (os.path.join(d, x) for x in ('in.wav', 'p1.wav', 'oct.wav'))
        ff(['-i', src, '-ac', '1', '-ar', str(SR), a])
        n = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', a],
                                 capture_output=True, text=True).stdout or 0)
        if preset == 'robot_light':
            ff(['-i', a, '-af', REST, '-ac', '1', '-ar', str(SR), '-t', f'{n:.4f}', dst])
            return
        pitch(a, b, -1)
        pitch(b, c, -12)
        ff(['-i', b, '-i', c, '-filter_complex', '[1:a]lowpass=f=1800,volume=0.20[o];[0:a][o]amix=inputs=2:weights=1 1:normalize=0,' + REST,
            '-ac', '1', '-ar', str(SR), '-t', f'{n:.4f}', dst])


if __name__ == '__main__':
    import argparse
    ap = argparse.ArgumentParser(description='Voice treatments for the AI character (robot, robot_light).')
    ap.add_argument('src'); ap.add_argument('dst'); ap.add_argument('--preset', default='robot')
    A = ap.parse_args()
    apply(A.src, A.dst, A.preset)
    print(A.dst)
