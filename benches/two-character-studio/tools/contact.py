#!/usr/bin/env python3
"""Contact sheet of a delivered video, one tile per second (or --every S), with the timestamp on each tile.

    python3 tools/contact.py VIDEO.mp4 OUT.jpg [--every 1.0] [--cols 6] [--width 240]

An HLG file is decoded to display light (BT.2100, Lw 1000 nits) and shown in SDR with the UI white (300 nits) at 1.0,
so subtitles and evidence read as they would on a phone; an SDR file is shown as is. Review it frame by frame: lip sync,
props clipping, the orb's glow, overlap between the characters, text over faces, the last frame.
"""
import argparse
import json
import math
import subprocess

import numpy as np
from PIL import Image, ImageDraw, ImageFont

LW, GAMMA, WHITE = 1000.0, 1.2, 300.0
M2020_709 = np.linalg.inv(np.array([[0.6274, 0.3293, 0.0433], [0.0691, 0.9195, 0.0114], [0.0164, 0.0880, 0.8956]]))
Y2020 = np.array([0.2627, 0.6780, 0.0593])


def probe(path):
    pr = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', path], capture_output=True, text=True).stdout)
    v = next(s for s in pr['streams'] if s['codec_type'] == 'video')
    return v, float(pr['format']['duration'])


def hlg_to_nits(e):
    a, b, c = 0.17883277, 0.28466892, 0.55991073
    es = np.where(e <= 0.5, e * e / 3, (np.exp((e - c) / a) + b) / 12)
    ys = es @ Y2020
    return LW * es * (np.maximum(ys, 1e-9)[..., None] ** (GAMMA - 1))          # display light, BT.2020 primaries


def nits_to_view(fd):
    sd = (fd / WHITE) @ M2020_709.T
    sd = sd / (1 + np.maximum(sd.max(axis=2, keepdims=True) - 1, 0) * 0.5)          # soft roll-off above UI white
    sd = np.clip(sd, 0, 1)
    return (np.where(sd <= 0.0031308, 12.92 * sd, 1.055 * sd ** (1 / 2.4) - 0.055) * 255).astype(np.uint8)


def frames(path, times, hdr, w, h):
    """Yield (t, RGB uint8 view, display nits or None) for each time."""
    for t in times:
        if hdr:
            raw = subprocess.run(['ffmpeg', '-v', 'error', '-ss', f'{t:.3f}', '-i', path, '-frames:v', '1', '-vf',
                                  'scale=in_color_matrix=bt2020:in_range=tv,format=rgb48le', '-f', 'rawvideo', '-'], capture_output=True).stdout
            e = np.frombuffer(raw, '<u2').reshape(h, w, 3).astype(np.float64) / 65535
            fd = hlg_to_nits(e)
            yield t, nits_to_view(fd), fd
        else:
            raw = subprocess.run(['ffmpeg', '-v', 'error', '-ss', f'{t:.3f}', '-i', path, '-frames:v', '1', '-vf', 'format=rgb24', '-f', 'rawvideo', '-'],
                                 capture_output=True).stdout
            yield t, np.frombuffer(raw, np.uint8).reshape(h, w, 3), None


def sheet(path, out, every=1.0, cols=6, tile_w=240):
    v, dur = probe(path)
    w, h = int(v['width']), int(v['height'])
    hdr = v.get('color_transfer') in ('arib-std-b67', 'smpte2084')
    times = [min(dur - 0.05, every * (k + 0.5)) for k in range(max(1, math.ceil(dur / every)))]
    th = round(tile_w * h / w)
    rows = math.ceil(len(times) / cols)
    pad = 6
    canvas = Image.new('RGB', (cols * (tile_w + pad) + pad, rows * (th + pad) + pad), (10, 11, 16))
    d = ImageDraw.Draw(canvas)
    try:
        font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', 18)
    except OSError:
        font = ImageFont.load_default()
    for k, (t, view, _) in enumerate(frames(path, times, hdr, w, h)):
        x, y = pad + (k % cols) * (tile_w + pad), pad + (k // cols) * (th + pad)
        canvas.paste(Image.fromarray(view).resize((tile_w, th), Image.LANCZOS), (x, y))
        d.rounded_rectangle((x + 4, y + 4, x + 64, y + 28), 6, fill=(0, 0, 0))
        d.text((x + 9, y + 6), f'{t:.1f}s', fill=(255, 220, 90), font=font)
    canvas.save(out, quality=86)
    return out, len(times)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('video'); ap.add_argument('out'); ap.add_argument('--every', type=float, default=1.0)
    ap.add_argument('--cols', type=int, default=6); ap.add_argument('--width', type=int, default=240)
    A = ap.parse_args()
    print('%s (%d tiles)' % sheet(A.video, A.out, A.every, A.cols, A.width))
