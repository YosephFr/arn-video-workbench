#!/usr/bin/env python3
"""HDR+ grade: SDR render frames -> HLG BT.2020 HEVC Main 10 (or the SDR master when asked).

    python3 tools/grade_hdr.py --frames DIR --fps 60 --start N0 --count N --encoder libx265|hevc_videotoolbox
                               [--audio audio/mix.wav --audio-start S] --out final.mp4 [--preset plus|base] [--probe i,j]

DIR holds beauty/f_NNNNN.png (the 3D frame), ui/f_NNNNN.png (the 2D layer, RGBA) and mask/f_NNNNN.png (light sources at
half resolution: R practical lights, G the TV screen, B the city; white = the host, grey = the orb, both protected).

The 3D frame is expanded from SDR: everything under the knee stays where the SDR grade put it (reference white 203 nits,
times the scene exposure), only the real highlights open up toward the 1000-nit peak, and the mask lets the actual light
sources (dock ring, LED strip, lamp, TV, city) shine harder. Characters are protected: no highlight expansion and a soft
cap (250 nits on the host, 400 on the orb), so skin stays under ~250 nits and the orb glows without clipping. The 2D layer is mapped at a fixed UI white
(300 nits) with no expansion, so text never glares. Display light -> HLG via the BT.2100 inverse EOTF (Lw 1000, system
gamma 1.2); 16-bit RGB is piped to the encoder.

Preset 'plus' (the standard): scene x1.7 and +35% colour in BT.2020, knee at sRGB 0.93, soft shoulder from 650 nits,
lights x5, TV x2, city x2.6, UI at 300 nits. Any HDR_* environment variable overrides a value.
"""
import argparse
import json
import os
import subprocess
import sys
from multiprocessing import Pool

import numpy as np
from PIL import Image, ImageFilter

PRESETS = {'base': {}, 'plus': {'HDR_EXPO': 1.7, 'HDR_SAT': 1.35, 'HDR_KNEE': 0.93, 'HDR_G_LIGHT': 5.0, 'HDR_G_SCREEN': 2.0, 'HDR_G_CITY': 2.6,
                                'HDR_REF_UI': 300.0, 'HDR_UI_SAT': 1.2, 'HDR_SHOULDER': 650.0, 'HDR_PROTECT': 400.0, 'HDR_SKIN': 250.0}}
REF, PEAK, GAMMA = 203.0, 1000.0, 1.2
M709_2020 = np.array([[0.6274, 0.3293, 0.0433], [0.0691, 0.9195, 0.0114], [0.0164, 0.0880, 0.8956]], np.float32)
Y2020 = np.array([0.2627, 0.6780, 0.0593], np.float32)
LUT = np.array([(v / 255) / 12.92 if v / 255 <= 0.04045 else (((v / 255) + 0.055) / 1.055) ** 2.4 for v in range(256)], np.float32)
G = {}


def cfg(preset):
    ps = PRESETS[preset]
    e = lambda k, d: float(os.environ.get(k, ps.get(k, d)))
    return dict(EXPO=e('HDR_EXPO', 1.0), SAT=e('HDR_SAT', 1.10), KNEE=e('HDR_KNEE', 0.94), G_LIGHT=e('HDR_G_LIGHT', 4.0), G_SCREEN=e('HDR_G_SCREEN', 1.4),
                G_CITY=e('HDR_G_CITY', 1.8), REF_UI=e('HDR_REF_UI', 203.0), UI_SAT=e('HDR_UI_SAT', 1.0), SHOULDER=e('HDR_SHOULDER', 0.0), PROTECT=e('HDR_PROTECT', 400.0),
                SKIN=e('HDR_SKIN', 250.0))


def init(frames, c):
    G.update(frames=frames, **c)
    G['KN'] = float(LUT[int(round(c['KNEE'] * 255))])


def frame(n):
    F = G['frames']
    p = lambda sub: os.path.join(F, sub, f'f_{n:05d}.png')
    src = np.asarray(Image.open(p('beauty')).convert('RGB'))
    H, W = src.shape[:2]
    lin = LUT[src]
    m = lin.max(axis=2, keepdims=True)
    t = np.clip((m - G['KN']) / (1 - G['KN']), 0, 1)
    gain = 1 + (PEAK - REF) * t * t / np.maximum(m * REF, 1e-6)          # C1 knee: slope 1 at the knee, peak at SDR 1.0
    protect = None
    if os.path.exists(p('mask')):
        k = Image.open(p('mask')).convert('RGB').resize((W, H), Image.BILINEAR).filter(ImageFilter.GaussianBlur(2))
        k = np.asarray(k).astype(np.float32)
        R, Gc, B = k[..., 0], k[..., 1], k[..., 2]
        w = lambda a, b, c, d: np.clip((a - 0.5 * (b + c)) / d, 0, 1)
        mg = 1 + w(R, Gc, B, 150) * (G['G_LIGHT'] - 1) + w(Gc, R, B, 80) * (G['G_SCREEN'] - 1) + w(B, R, Gc, 150) * (G['G_CITY'] - 1)
        gain = np.maximum(gain, mg[..., None])
        mn = np.minimum(np.minimum(R, Gc), B)
        protect = np.clip((mn - 90) / 60, 0, 1)[..., None]              # grey or white: a character
        skin = np.clip((mn - 200) / 40, 0, 1)[..., None]                # white: the host (grey: the orb)
        gain = gain * (1 - protect) + protect                           # characters: no expansion
    rgb = (lin * REF * G['EXPO'] * gain) @ M709_2020.T
    y = (rgb @ Y2020)[..., None]
    rgb = np.maximum(y + G['SAT'] * (rgb - y), 0)
    if G['SHOULDER']:
        mx = rgb.max(axis=2, keepdims=True)
        S = G['SHOULDER']
        sh = np.where(mx > S, S + (PEAK - S) * (1 - np.exp(-(mx - S) / (PEAK - S))), mx)
        rgb = rgb * sh / np.maximum(mx, 1e-6)
    if protect is not None:                                              # soft cap: the host's skin, the orb's glow
        mx = rgb.max(axis=2, keepdims=True); C = G['PROTECT'] * (1 - skin) + G['SKIN'] * skin
        capped = np.where(mx > 0.8 * C, 0.8 * C + 0.2 * C * np.tanh((mx - 0.8 * C) / (0.2 * C)), mx)
        rgb = rgb * (1 - protect) + rgb * (capped / np.maximum(mx, 1e-6)) * protect
    rgb = np.minimum(rgb, PEAK)
    if os.path.exists(p('ui')):
        ov = np.asarray(Image.open(p('ui')).convert('RGBA'))
        a = ov[..., 3:4].astype(np.float32) / 255
        if a.max() > 0:
            c = (LUT[ov[..., :3]] * G['REF_UI']) @ M709_2020.T
            if G['UI_SAT'] != 1:
                yc = (c @ Y2020)[..., None]
                c = np.maximum(yc + G['UI_SAT'] * (c - yc), 0)
            rgb = c * a + rgb * (1 - a)
    fd = np.clip(rgb / PEAK, 0, 1)
    yd = np.maximum((fd @ Y2020)[..., None], 1e-7)
    es = fd * yd ** ((1 - GAMMA) / GAMMA)                                  # inverse OOTF -> scene light
    a_, b_, c_ = 0.17883277, 0.28466892, 0.55991073
    e = np.where(es <= 1 / 12, np.sqrt(3 * es), a_ * np.log(np.maximum(12 * es - b_, 1e-7)) + c_)
    return (np.clip(e, 0, 1) * 65535 + 0.5).astype('<u2').tobytes(), float(rgb.max()), float((rgb.max(axis=2) > REF * 1.05).mean()), (W, H)


def encoder_args(enc):
    if enc == 'libx265':
        return ['-vf', 'scale=out_color_matrix=bt2020:out_range=tv,format=yuv420p10le', '-c:v', 'libx265', '-preset', os.environ.get('X265_PRESET', 'slow'),
                '-crf', os.environ.get('X265_CRF', '16'), '-tag:v', 'hvc1',
                '-x265-params', 'colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc:range=limited:log-level=error']
    if enc == 'hevc_videotoolbox':
        return ['-vf', 'scale=out_color_matrix=bt2020:out_range=tv,format=p010le', '-c:v', 'hevc_videotoolbox', '-profile:v', 'main10',
                '-b:v', os.environ.get('VT_BITRATE', '28M'), '-tag:v', 'hvc1']
    raise SystemExit(f'unknown encoder {enc}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--frames', required=True); ap.add_argument('--fps', type=int, default=60)
    ap.add_argument('--start', type=int, default=0); ap.add_argument('--count', type=int, required=True)
    ap.add_argument('--encoder', default='libx265'); ap.add_argument('--audio'); ap.add_argument('--audio-start', type=float, default=0.0)
    ap.add_argument('--out', required=True); ap.add_argument('--preset', default=os.environ.get('HDR_PRESET', 'plus'))
    ap.add_argument('--probe'); ap.add_argument('--jobs', type=int, default=max(2, (os.cpu_count() or 4) // 2))
    A = ap.parse_args()
    c = cfg(A.preset)
    init(A.frames, c)
    if A.probe:
        for n in map(int, A.probe.split(',')):
            _, mx, share, _ = frame(n)
            print(f'frame {n}: peak {mx:.0f} nits, {100 * share:.2f}% of pixels above reference white')
        return
    first = Image.open(os.path.join(A.frames, 'beauty', f'f_{A.start:05d}.png'))
    W, H = first.size
    dur = A.count / A.fps
    cmd = ['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb48le', '-s', f'{W}x{H}', '-r', str(A.fps), '-i', '-']
    if A.audio:
        cmd += ['-ss', f'{A.audio_start:.4f}', '-t', f'{dur:.4f}', '-i', A.audio]
    cmd += encoder_args(A.encoder) + ['-r', str(A.fps), '-color_primaries', 'bt2020', '-color_trc', 'arib-std-b67', '-colorspace', 'bt2020nc', '-color_range', 'tv']
    if A.audio:
        cmd += ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-af', 'apad', '-t', f'{dur:.4f}']
    cmd += ['-movflags', '+faststart', A.out]
    enc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    stats = []
    with Pool(A.jobs, initializer=init, initargs=(A.frames, c)) as pool:
        for k, (buf, mx, share, _) in enumerate(pool.imap(frame, range(A.start, A.start + A.count), chunksize=4)):
            enc.stdin.write(buf)
            stats.append((mx, share))
            if k % 120 == 0:
                print(f'  grade {k}/{A.count}', flush=True)
    enc.stdin.close()
    if enc.wait() != 0:
        sys.exit('encoder failed')
    pk = [s[0] for s in stats]
    json.dump({'preset': A.preset, 'encoder': A.encoder, 'frames': A.count, 'peak_nits_max': max(pk), 'peak_nits_median': float(np.median(pk)),
               'share_above_ref_mean': float(np.mean([s[1] for s in stats]))}, open(A.out + '.stats.json', 'w'), indent=1)
    print(f'grade: {A.count} frames, peak {max(pk):.0f} nits (median frame peak {np.median(pk):.0f}) -> {A.out}')


if __name__ == '__main__':
    main()
