#!/usr/bin/env python3
"""Pre-delivery QA for a two-character studio piece. Every check is PASS / WARN / FAIL; exit 1 on any FAIL.

    python3 tools/qa.py <piece> [--video renders/final.mp4] [--no-whisper] [--no-idpass] [--whisper-model small]

format        1080x1920, 60 fps CFR, HEVC Main 10 hvc1 + HLG BT.2020 (or H.264 BT.709 for an SDR master), AAC 48 kHz,
              the Apple full-frame-rate tag, the planned duration
loudness      integrated -15.5 LUFS +-0.5 (WARN within +-1), true peak <= -1 dBTP, measured on the delivered file
shots         no shot under min_shot, median length, at most two TV moments; the visual cuts found in the file match
              the planned ones (a TV that changes between cuts reads as a second cut)
speaker       the camera frames whoever speaks (the TV focus and inserts may carry voice-over, never a host line)
lines         Whisper intelligibility of every line: the share of its words heard in its own window (FAIL < 60%)
overlap       ID pass (host red, orb green, no depth) at 10 samples/s: the two characters never touch on screen
orb           its radius stays steady while it talks (no waveform vibration), and in HDR it never clips (< 430 nits)
skin          the host stays under ~250 nits in HDR (99th percentile of his pixels)
end           the last 0.3 s is a real frame: no fade to black; frozen: no still picture over 1.5 s (wb verify agrees)
unnamed beat  the frozen beat is never named: no forbidden word on screen or in the transcript
music         a music bed under the whole piece (outside a deliberate cut)
contact       renders/qa/contact.jpg, one tile per second, for the human review
Writes renders/qa/report.md and report.json.
"""
import argparse
import difflib
import json
import os
import re
import statistics
import subprocess
import sys
import unicodedata
from fractions import Fraction

import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
BENCH = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from plan import FRAMES  # noqa: E402
import contact  # noqa: E402

R = []


def rep(sec, st, msg):
    R.append((sec, st, msg))
    print(f'[{st:4s}] {sec}: {msg}', flush=True)


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def load(p, d=None):
    return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else d


def words(s):
    s = unicodedata.normalize('NFD', s.lower())
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return re.findall(r"[a-z0-9ñ']+", s)


NUM_EN = dict(zip('0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20'.split(),
                  'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'.split()))


def pcm(path, t0=None, t1=None, sr=16000):
    cmd = ['ffmpeg', '-v', 'error'] + (['-ss', f'{t0:.3f}', '-to', f'{t1:.3f}'] if t0 is not None else []) + ['-i', path, '-ac', '1', '-ar', str(sr), '-f', 'f32le', '-']
    return np.frombuffer(subprocess.run(cmd, capture_output=True).stdout, np.float32).copy()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('piece'); ap.add_argument('--video'); ap.add_argument('--no-whisper', action='store_true'); ap.add_argument('--no-idpass', action='store_true')
    ap.add_argument('--whisper-model', default='small'); ap.add_argument('--idpass-fps', type=int, default=10)
    A = ap.parse_args()
    pd = os.path.abspath(A.piece)
    video = os.path.abspath(A.video or os.path.join(pd, 'renders', 'final.mp4'))
    out = os.path.join(pd, 'renders', 'qa'); os.makedirs(out, exist_ok=True)
    script, plan = load(os.path.join(pd, 'script.json')), load(os.path.join(pd, 'plan.json'))
    if not os.path.exists(video):
        sys.exit(f'no video at {video}')
    fmt = script.get('format', {}); W0, H0, FPS = fmt.get('width', 1080), fmt.get('height', 1920), fmt.get('fps', 60)
    target = script.get('mix', {}).get('lufs', -15.5)
    lines, shots = plan['lines'], plan['shots']

    # ------------------------------------------------------------------ format
    pr = json.loads(run(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', video]).stdout)
    v = next(s for s in pr['streams'] if s['codec_type'] == 'video'); au = [s for s in pr['streams'] if s['codec_type'] == 'audio']
    dur = float(pr['format']['duration'])
    hdr = v.get('color_transfer') == 'arib-std-b67'
    rep('format', 'PASS' if (v['width'], v['height']) == (W0, H0) else 'FAIL', f"{v['width']}x{v['height']} (want {W0}x{H0})")
    rate = lambda x: float(Fraction(x)) if x and x != '0/0' else 0.0          # ffprobe rates are 'num/den' strings
    fr, afr = rate(v['r_frame_rate']), rate(v.get('avg_frame_rate'))
    rep('format', 'PASS' if abs(fr - FPS) < 0.01 and abs(afr - FPS) < 0.05 else 'FAIL', f'{fr:.2f} fps (avg {afr:.2f}; want {FPS} CFR, never above 60)')
    if hdr:
        ok = v['codec_name'] == 'hevc' and 'Main 10' in v.get('profile', '') and v.get('codec_tag_string') == 'hvc1' and v.get('pix_fmt') == 'yuv420p10le'
        rep('format', 'PASS' if ok else 'FAIL', f"{v['codec_name']} {v.get('profile')} {v.get('codec_tag_string')} {v.get('pix_fmt')} (want hevc Main 10 hvc1 yuv420p10le)")
        ok = v.get('color_primaries') == 'bt2020' and v.get('color_space') == 'bt2020nc'
        rep('format', 'PASS' if ok else 'FAIL', f"HLG: primaries {v.get('color_primaries')} matrix {v.get('color_space')} transfer {v.get('color_transfer')}")
    else:
        ok = v['codec_name'] == 'h264' and v.get('color_primaries') == 'bt709' and v.get('color_transfer') == 'bt709'
        rep('format', 'PASS' if ok else 'WARN', f"SDR master: {v['codec_name']} {v.get('pix_fmt')} {v.get('color_primaries')}/{v.get('color_transfer')} (the HDR+ master is the standard)")
    tag = run(['exiftool', '-s3', '-Keys:FullFrameRatePlaybackIntent', video]).stdout.strip() if run(['which', 'exiftool']).returncode == 0 else ''
    rep('format', 'PASS' if tag == '1' else 'WARN', f'Apple full-frame-rate tag = {tag or "missing"} (exiftool -Keys:FullFrameRatePlaybackIntent=1)')
    rep('format', 'PASS' if abs(dur - plan['duration']) < 0.12 else 'WARN', f"duration {dur:.2f} s (plan {plan['duration']:.2f} s)")
    if not au:
        rep('format', 'FAIL', 'no audio stream')
    else:
        a = au[0]
        rep('format', 'PASS' if a['codec_name'] == 'aac' and a.get('sample_rate') == '48000' and a.get('channels') == 2 else 'WARN',
            f"audio {a['codec_name']} {a.get('sample_rate')} Hz {a.get('channels')} ch")
        e = run(['ffmpeg', '-hide_banner', '-nostats', '-i', video, '-map', '0:a:0', '-af', 'ebur128=peak=true', '-f', 'null', '-']).stderr
        li = float(re.findall(r'I:\s+(-?[\d.]+) LUFS', e)[-1]); tp = float(re.findall(r'Peak:\s+(-?[\d.]+|-inf) dBFS', e)[-1].replace('-inf', '-99'))
        d = abs(li - target)
        rep('loudness', 'PASS' if d <= 0.5 else 'WARN' if d <= 1.0 else 'FAIL', f'{li:.1f} LUFS integrated (target {target} +-0.5)')
        rep('loudness', 'PASS' if tp <= -1.0 else 'FAIL', f'true peak {tp:.1f} dBTP (want <= -1)')

    # ------------------------------------------------------------------ shots and cuts
    lens = [s['t1'] - s['t'] for s in shots]
    ms = load(os.path.join(pd, 'direction.json'), {}).get('min_shot', 2.0)
    short = [f"{s['kind']} {s['t']:.2f}-{s['t1']:.2f}" for s in shots if s['t1'] - s['t'] < ms - 1e-3]
    rep('shots', 'FAIL' if short else 'PASS', f'{len(shots)} shots, median {statistics.median(lens):.2f} s, shortest {min(lens):.2f} s' + (f'; under {ms} s: {short}' if short else ''))
    if statistics.median(lens) < 3.0:
        rep('shots', 'WARN', 'median shot under 3 s: let the shots breathe (one per turn, slow push-ins)')
    ntv = sum(1 for s in shots if s['kind'] == 'tv')
    rep('shots', 'PASS' if ntv <= 2 else 'WARN', f'{ntv} TV moment(s) (keep one or two)')
    e = run(['ffmpeg', '-hide_banner', '-nostats', '-i', video, '-an', '-vf', "scale=270:480,select='gt(scene,0.30)',showinfo", '-f', 'null', '-']).stderr
    cuts = [float(x) for x in re.findall(r'pts_time:([\d.]+)', e)]
    planned = [s['t'] for s in shots[1:]]
    fast = [(a, b) for a, b in zip([0.0] + cuts, cuts + [dur]) if b - a < 1.5 and b < dur - 0.05]
    stray = [c for c in cuts if not planned or min(abs(c - p) for p in planned) > 0.15]
    rep('cuts', 'FAIL' if fast else 'PASS', f'{len(cuts)} visual cuts detected' + (f'; too close: {fast}' if fast else ', none closer than 1.5 s'))
    if stray:
        rep('cuts', 'WARN', f'visual cuts that are not planned shot changes (a TV change or a flash between cuts?): {[round(c, 2) for c in stray]}')

    # ------------------------------------------------------------------ speaker on screen
    bad = 0
    for s in shots:
        for l in lines:
            ov = min(s['t1'], l['end']) - max(s['t'], l['start'])
            if ov <= 0.1 or not l.get('who'):
                continue
            if s['kind'] in ('tv', 'insert'):
                if s['kind'] == 'insert' and l['who'] == 'host':
                    bad += 1; rep('speaker', 'FAIL', f"insert {s['t']:.2f}-{s['t1']:.2f} covers the host's line {l['id']}")
                continue
            fr_ = {FRAMES.get(s['a']), FRAMES.get(s['b'])}
            shows = {'host', 'orb'} if 'both' in fr_ else fr_
            if l['who'] not in shows:
                bad += 1; rep('speaker', 'FAIL', f"{s['a']} {s['t']:.2f}-{s['t1']:.2f} frames {sorted(x for x in shows if x)} while the {l['who']} says {l['id']}")
    if not bad:
        rep('speaker', 'PASS', 'every line plays on a shot that frames its speaker (TV focus = voice-over)')

    # ------------------------------------------------------------------ the frozen beat is never named
    P = plan.get('pause')
    forbidden = [w.lower() for w in (P or {}).get('forbidden_words', ['pause', 'paused'])]
    texts = [s['text'] for s in plan.get('subs', [])] + [' '.join(t['lines']) for t in plan.get('titles', [])] + [' '.join(c['lines']) for c in (P or {}).get('cards', [])]
    named = [t for t in texts if any(f in words(t) for f in forbidden)]
    rep('unnamed beat', 'FAIL' if named else 'PASS', (f'named on screen: {named}' if named else f'{len(texts)} on-screen strings, none names the beat') if P else 'no frozen beat in this piece')

    # ------------------------------------------------------------------ Whisper intelligibility per line
    stem = os.path.join(pd, 'audio', 'stems', 'voice.wav')
    src = stem if os.path.exists(stem) else video
    voice = pcm(src)
    transcript = []
    if A.no_whisper:
        rep('lines', 'WARN', 'skipped (--no-whisper)')
    elif float(np.abs(voice).max() if len(voice) else 0) < 1e-4:
        rep('lines', 'WARN', 'the voices are silent placeholders: intelligibility not checked (record or synthesise the lines, then run QA again)')
    else:
        try:
            from faster_whisper import WhisperModel
        except ImportError:
            WhisperModel = None
        if not WhisperModel:
            rep('lines', 'WARN', 'faster-whisper is not installed (pip install faster-whisper): intelligibility not checked')
        else:
            lang = (script.get('language') or 'en')[:2]
            wm = WhisperModel(A.whisper_model, device='cpu', compute_type='int8')
            tr = lambda x: [(w.start, w.end, w.word) for sg in wm.transcribe(x, language=lang, beam_size=5, word_timestamps=True, vad_filter=False,
                                                                        condition_on_previous_text=False)[0] for w in (sg.words or [])]
            heard = tr(voice)
            transcript = heard
            with open(os.path.join(out, 'whisper.txt'), 'w') as fh:
                fh.write('\n'.join(f'{a:7.2f} {b:7.2f} {w}' for a, b, w in heard))
            norm = lambda s: [NUM_EN.get(x, x) for x in words(s)]
            nfail = 0; covs = []
            for l in lines:
                want = norm(l['text'])
                got = norm(' '.join(w for a, b, w in heard if b > l['start'] - 0.3 and a < l['end'] + 0.3))
                cov = sum(m.size for m in difflib.SequenceMatcher(None, want, got, autojunk=False).get_matching_blocks()) / max(1, len(want))
                if cov < 0.8:      # second opinion on the line's own window (whisper merges words on long files)
                    seg = voice[int(max(0, l['start'] - 0.4) * 16000):int((l['end'] + 0.4) * 16000)]
                    got2 = norm(' '.join(w for _, _, w in tr(seg)))
                    cov2 = sum(m.size for m in difflib.SequenceMatcher(None, want, got2, autojunk=False).get_matching_blocks()) / max(1, len(want))
                    if cov2 > cov:
                        cov, got = cov2, got2
                covs.append(cov)
                st = 'PASS' if cov >= 0.8 else 'WARN' if cov >= 0.6 else 'FAIL'
                nfail += st == 'FAIL'
                if st != 'PASS':
                    rep('lines', st, f"{l['id']} {100 * cov:.0f}% heard | said: {l['text']} | heard: {' '.join(got)}")
            rep('lines', 'FAIL' if nfail else 'PASS', f'{len(lines)} lines, {100 * float(np.mean(covs)):.0f}% of words heard on average (whisper-{A.whisper_model})')
            said = [w for _, _, w in heard if any(f == x for f in forbidden for x in words(w))]
            if P:
                rep('unnamed beat', 'FAIL' if said else 'PASS', f'heard {said}' if said else 'nobody names the frozen beat')

    # ------------------------------------------------------------------ music bed
    mstem = os.path.join(pd, 'audio', 'stems', 'music.wav')
    if os.path.exists(mstem):
        y = pcm(mstem); w = 8000
        cut = P and P.get('sound', {}).get('mode') == 'cut'
        lv = [20 * np.log10(np.sqrt(np.mean(y[k:k + w] ** 2)) + 1e-9) for k in range(0, len(y) - w, w)
              if not (cut and P['freeze'] - 0.25 <= k / 16000 <= P['col1'] + 0.25)]
        cov = float(np.mean([x > -60 for x in lv])) if lv else 0
        rep('music', 'PASS' if cov >= 0.8 else 'FAIL', f'music bed audible in {100 * cov:.0f}% of 0.5 s windows')
    else:
        rep('music', 'WARN', 'no audio/stems/music.wav (run wb music + wb mix)')

    # ------------------------------------------------------------------ end of the piece: a real frame, no black tail
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-sseof', '-0.8', '-i', video, '-vf', 'scale=108:192,format=gray', '-f', 'rawvideo', '-'], capture_output=True).stdout
    tail = np.frombuffer(raw, np.uint8).reshape(-1, 192, 108)
    if len(tail):
        k = max(1, int(round(0.3 * len(tail) / 0.8))); last = tail[-k:]
        nb = sum((f <= 16).mean() >= 0.98 for f in last)
        rep('end', 'FAIL' if nb else 'PASS', f'last 0.3 s: {nb} black frames; last frame mean luma {last[-1].mean():.0f}')
        ref = tail[max(0, len(tail) - k - int(0.5 * len(tail) / 0.8))].mean()
        if ref > 5 and last[-1].mean() < 0.35 * ref:
            rep('end', 'WARN', f'the picture fades out at the end ({last[-1].mean():.0f} vs {ref:.0f}): end on the punchline frame')

    # ------------------------------------------------------------------ frozen picture (the frozen beat must still move: a slow camera creep)
    e = run(['ffmpeg', '-hide_banner', '-nostats', '-i', video, '-an', '-vf', 'freezedetect=n=0.002:d=1.5', '-f', 'null', '-']).stderr
    frozen = [round(float(x), 2) for x in re.findall(r'freeze_start: ([\d.]+)', e)]
    rep('frozen', 'FAIL' if frozen else 'PASS', f'frozen pictures longer than 1.5 s at {frozen}' if frozen else 'no frozen picture longer than 1.5 s')

    # ------------------------------------------------------------------ ID pass: overlap, orb steadiness
    idmasks = {}
    if not A.no_idpass:
        d = os.path.join(pd, 'renders', 'qa', 'idpass')
        r = run(['node', os.path.join(BENCH, 'engine', 'render.mjs'), pd, 'idpass', '--fps', str(A.idpass_fps), '--scale', '0.25', '--out', d])
        fs = sorted(f for f in os.listdir(d) if f.endswith('.png')) if os.path.isdir(d) else []
        if r.returncode or not fs:
            rep('overlap', 'FAIL', 'ID pass render failed: ' + (r.stderr or r.stdout)[-400:])
        else:
            def dil(m):
                z = m.copy(); z[1:] |= m[:-1]; z[:-1] |= m[1:]; z[:, 1:] |= m[:, :-1]; z[:, :-1] |= m[:, 1:]; return z
            touch, radius = [], []
            for f in fs:
                a = np.asarray(Image.open(os.path.join(d, f)).convert('RGB')).astype(np.int16)
                Hm, Om = a[..., 0] > 200, a[..., 1] > 180
                t = int(f[2:7]) / A.idpass_fps
                idmasks[t] = (Hm, Om)
                if Hm.any() and Om.any() and (dil(Hm) & dil(Om)).any():
                    touch.append(round(t, 1))
                ys, xs = np.nonzero(Om)
                edge = len(xs) and (xs.min() <= 1 or ys.min() <= 1 or xs.max() >= Om.shape[1] - 2 or ys.max() >= Om.shape[0] - 2)
                ok_ = len(xs) > 30 and not edge
                radius.append((t, float(np.sqrt(Om.sum() / np.pi)) if ok_ else None, float(ys.mean()) if ok_ else None))
            rep('overlap', 'FAIL' if touch else 'PASS', f'{len(fs)} ID frames: ' + (f'host and orb touch at {touch[:12]}' if touch else 'host and orb never touch on screen'))
            talk = [(l['start'], l['end']) for l in lines if l.get('who') == 'orb']
            worst, bob, shrink = 0.0, 0.0, []
            rstd = lambda x: float(1.4826 * np.median(np.abs(x - np.median(x))))
            for s in shots:
                if s['kind'] == 'pause':
                    continue
                seq = [(t, r_, y_) for t, r_, y_ in radius if s['t'] + 0.2 <= t < s['t1'] - 0.2 and r_]
                if len(seq) < 12 or statistics.median(r_ for _, r_, _ in seq) < 12:
                    continue
                tt = np.array([t for t, _, _ in seq]); rr = np.array([r_ for _, r_, _ in seq]); yy = np.array([y_ for _, _, y_ in seq]); med = float(np.median(rr))
                k = np.array([any(a <= t <= b for a, b in talk) for t in tt])
                if k[1:-1].sum() > 6:                          # frame-to-frame acceleration of the radius and of the height
                    worst = max(worst, rstd((np.diff(rr, 2) / med)[k[1:-1]]))
                    bob = max(bob, rstd((np.diff(yy, 2) / med)[k[1:-1]]))
                if k.sum() > 6 and (~k).sum() > 6:
                    res = rr / np.polyval(np.polyfit(tt - tt[0], rr, 2), tt - tt[0]) - 1
                    if res[k].mean() < -0.012:
                        shrink.append(f"{s['t']:.1f}s")
            rep('orb', 'PASS' if worst <= 0.006 and bob <= 0.006 else 'FAIL',
                f'while the orb talks: radius jitter {100 * worst:.2f}%, vertical bob {100 * bob:.2f}% per frame (limit 0.60%: calm, no waveform)')
            if shrink:
                rep('orb', 'FAIL', f'the orb shrinks while it talks in shots at {shrink}')

    # ------------------------------------------------------------------ HDR levels: orb never clips, skin under ~250 nits
    if hdr:
        mids = [round((s['t'] + s['t1']) / 2, 2) for s in shots]
        orb_pk, host_pk, frame_pk = [], [], []
        uid = os.path.join(out, 'ui')                   # the 2D layer at the same instants: titles and subtitles are not skin
        run(['node', os.path.join(BENCH, 'engine', 'render.mjs'), pd, 'still', ','.join(f'{t:.2f}' for t in mids), '--pass', 'ui', '--scale', '0.5', '--out', uid])
        def ui_mask(t):
            f = os.path.join(uid, f'still-{t:.2f}-ui.png')
            if not os.path.exists(f):
                return np.zeros((H0, W0), bool)
            a = Image.open(f).convert('RGBA').getchannel('A').resize((W0, H0), Image.BILINEAR).filter(ImageFilter.MaxFilter(9))
            return np.asarray(a) > 8
        for t, _, fd in contact.frames(video, mids, True, W0, H0):
            frame_pk.append(float(fd.max()))
            if idmasks:
                tk = min(idmasks, key=lambda x: abs(x - t))
                Hm, Om = idmasks[tk]
                scale = lambda m: np.asarray(Image.fromarray(m.astype(np.uint8) * 255).resize((W0, H0), Image.NEAREST)) > 0
                U = ui_mask(t)
                Hm, Om = scale(Hm) & ~U, scale(Om) & ~U
                y = fd @ contact.Y2020
                if Om.sum() > 400:                       # the orb's body: a disc at 90% of its footprint (not the ring below it)
                    oy, ox = np.nonzero(Om); r_eq = np.sqrt(Om.sum() / np.pi)
                    yy, xx = np.ogrid[:H0, :W0]
                    body = (yy - oy.mean()) ** 2 + (xx - ox.mean()) ** 2 <= (0.9 * r_eq) ** 2
                    orb_pk.append((t, float(np.percentile(fd.max(axis=2)[body & Om], 99.5))))
                if Hm.sum() > 400:
                    host_pk.append((t, float(np.percentile(y[Hm], 99))))
        if orb_pk:
            m = max(orb_pk, key=lambda x: x[1])
            rep('orb', 'PASS' if m[1] <= 430 else 'FAIL', f'HDR: brightest orb pixels {m[1]:.0f} nits at {m[0]:.1f} s (it may glow, never clip: <= 430)')
        if host_pk:
            m = max(host_pk, key=lambda x: x[1])
            rep('skin', 'PASS' if m[1] <= 250 else 'WARN', f'HDR: host 99th percentile {m[1]:.0f} nits at {m[0]:.1f} s (skin under ~250)')
        rep('hdr', 'PASS', f'frame peaks {min(frame_pk):.0f}-{max(frame_pk):.0f} nits at the shot mid-points (lights may reach 1000)')

    # ------------------------------------------------------------------ contact sheet
    cs, n = contact.sheet(video, os.path.join(out, 'contact.jpg'))
    rep('contact', 'PASS', f'{cs} ({n} tiles): review lip sync, overlap, text over faces and the last frame by eye')

    nF = sum(r[1] == 'FAIL' for r in R); nW = sum(r[1] == 'WARN' for r in R)
    with open(os.path.join(out, 'report.md'), 'w') as fh:
        fh.write(f'# QA {os.path.basename(video)}\n\n{dur:.2f} s, {"HDR+ HLG" if hdr else "SDR"} — **{nF} FAIL, {nW} WARN**\n\n')
        for sec, st, msg in R:
            fh.write(f'- **{st}** `{sec}` {msg}\n')
    json.dump([dict(section=a, status=b, message=c) for a, b, c in R], open(os.path.join(out, 'report.json'), 'w'), indent=1)
    print(f'\n== {nF} FAIL, {nW} WARN -> {os.path.join(out, "report.md")}')
    sys.exit(1 if nF else 0)


if __name__ == '__main__':
    main()
