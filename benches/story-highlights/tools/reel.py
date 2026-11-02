#!/usr/bin/env python3
"""Join the stories of a pack into one reel, and deliver the pack.

    python3 tools/reel.py samples/getting-started                 -> <pack>/renders/reel.mp4
    python3 tools/reel.py samples/getting-started --deliver DIR   -> DIR/<folder>/01 · <title>.mp4 ..., the full reel and
                                                                     the extras, each copy checked by SHA-256

pack.json: {"title": "Getting started", "folder": "1 · Getting started", "stories": ["01-slug", ...],
            "titles": ["Create your account", ...], "extras": ["covers/1 · Getting started.png"]}
Each story is <pack>/<story>/renders/final.mp4; when <story>/renders/final_reel.mp4 exists (the version without the
pack header, rendered with WB_REEL=1) the reel uses it. Stories are joined with a short upward wipe (0.3 s, the same
length the pack's music was sliced with, so the bed never restarts) and an audio crossfade; the reel is then set to
-14 LUFS with true peak at or under -1 dBTP, measured on the encoded file. A pack of one story is already its own reel.
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
XF = 0.3   # seconds of each join; tools/pack_music.py slices the music with the same value


def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for block in iter(lambda: fh.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def duration(path):
    out = subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path])
    return float(out.decode().strip())


def loudness(path):
    """Integrated loudness (LUFS) and true peak (dBTP) of a file."""
    err = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', path, '-map', '0:a', '-af', 'ebur128=peak=true', '-f', 'null', '-'],
                         capture_output=True, text=True).stderr
    summary = err[err.rindex('Summary:'):]
    integrated = float(re.search(r'I:\s+(-?[\d.]+) LUFS', summary).group(1))
    peak = float(re.search(r'True peak:\s+Peak:\s+(-?[\d.]+|-inf) dBFS', summary).group(1))
    return integrated, peak


def deliver(pd, pack, files, reel, dest_root):
    dest = os.path.join(os.path.abspath(dest_root), pack.get('folder', pack['title']))
    os.makedirs(dest, exist_ok=True)
    titles = pack.get('titles') or pack['stories']
    copies = [(f, os.path.join(dest, f'{i:02d} · {t}.mp4')) for i, (f, t) in enumerate(zip(files, titles), 1)]
    if reel:
        copies.append((reel, os.path.join(dest, f"Full reel · {pack['title']}.mp4")))
    for extra in pack.get('extras', []):
        src = os.path.join(pd, extra)
        if os.path.exists(src):
            copies.append((src, os.path.join(dest, os.path.basename(extra))))
        else:
            print('extra not found, skipped:', extra)
    for src, dst in copies:
        shutil.copy2(src, dst)
        if sha(src) != sha(dst):
            sys.exit(f'copy does not match its source: {dst}')
    print('delivered to', dest)
    for name in sorted(os.listdir(dest)):
        print('  ', name)


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    pd = os.path.abspath(sys.argv[1])
    pack = json.load(open(os.path.join(pd, 'pack.json'), encoding='utf-8'))
    files = [os.path.join(pd, s, 'renders', 'final.mp4') for s in pack['stories']]
    missing = [f for f in files if not os.path.exists(f)]
    if missing:
        sys.exit('missing renders (tools/render-pack.sh first): ' + ', '.join(missing))
    reel_inputs = [f.replace('final.mp4', 'final_reel.mp4') if os.path.exists(f.replace('final.mp4', 'final_reel.mp4')) else f for f in files]
    out_dir = os.path.join(pd, 'renders')
    os.makedirs(out_dir, exist_ok=True)
    reel = os.path.join(out_dir, 'reel.mp4')
    single = len(files) == 1

    if '--deliver' in sys.argv:
        deliver(pd, pack, files, None if single else reel, sys.argv[sys.argv.index('--deliver') + 1])
        if not single and not os.path.exists(reel):
            print('note: no reel yet; run this tool without --deliver first')
        return
    if single:
        sys.exit('one story: it is also the reel, nothing to join')

    ds = [duration(f) for f in reel_inputs]
    inputs = sum([['-i', f] for f in reel_inputs], [])
    vf, af, prev_v, prev_a, offset = [], [], '0:v', '0:a', 0.0
    for i in range(1, len(reel_inputs)):
        offset += ds[i - 1] - XF
        vf.append(f'[{prev_v}][{i}:v]xfade=transition=smoothup:duration={XF}:offset={offset:.3f}[v{i}]')
        af.append(f'[{prev_a}][{i}:a]acrossfade=d={XF}:c1=tri:c2=tri[a{i}]')
        prev_v, prev_a = f'v{i}', f'a{i}'
    tmp = os.path.join(out_dir, '_reel_tmp.mkv')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', *inputs, '-filter_complex', ';'.join(vf + af), '-map', f'[{prev_v}]', '-map', f'[{prev_a}]',
                    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30',
                    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-c:a', 'pcm_s16le', tmp], check=True)
    # loudness: -14 LUFS with true peak ≤ -1 dBTP measured on the encoded file (AAC adds overshoot), so the gain and a
    # peak limiter are adjusted until the delivered reel holds both
    gain, ceiling = -14.0 - loudness(tmp)[0], -2.0
    for _ in range(6):
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', tmp, '-map', '0:v', '-map', '0:a', '-c:v', 'copy',
                        '-af', f'volume={gain:.2f}dB,alimiter=limit={10 ** (ceiling / 20):.4f}:attack=3:release=60:level=disabled',
                        '-ar', '48000', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', reel], check=True)
        integrated, peak = loudness(reel)
        peak_ok, level_ok = peak <= -1.2, abs(integrated + 14.0) <= 0.8
        if peak_ok and level_ok:
            break
        if not peak_ok:
            ceiling -= peak + 1.2 + 0.3
        if not level_ok:
            gain += -14.0 - integrated
    os.remove(tmp)
    total = sum(ds) - XF * (len(ds) - 1)
    print(f'reel -> {reel}  ({len(files)} stories, {total:.1f} s, {integrated:.1f} LUFS, true peak {peak:.1f} dBTP)', flush=True)
    wb = os.path.join(ROOT, 'core', 'bin', 'wb')
    if os.path.exists(wb):
        subprocess.run([wb, 'verify', reel, '--expected', f'{total:.2f}'])


if __name__ == '__main__':
    main()
