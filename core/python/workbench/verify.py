"""Technical delivery check of an MP4.

    wb verify <video.mp4> [--size 1080x1920] [--fps 30] [--lufs -14] [--expected 21.4] [--max-mb 40]
                          [--hold-end 2.0] [--no-audio]

Checks resolution, frame rate, duration, loudness and true peak, black or frozen stretches, and that the first frames
already show content (a hook cannot open on an empty screen). Writes <video>.verify.json and exits 1 on any problem.
"""
import json
import re
import statistics
import subprocess
import sys


def arg(argv, key, default=None):
    return argv[argv.index(key) + 1] if key in argv else default


def main(argv):
    path = argv[0]
    width, height = map(int, arg(argv, '--size', '1080x1920').split('x'))
    fps_expected = float(arg(argv, '--fps', 30))
    target = float(arg(argv, '--lufs', -14))
    expected = float(arg(argv, '--expected')) if arg(argv, '--expected') else None
    max_mb = float(arg(argv, '--max-mb', 60))
    hold_end = float(arg(argv, '--hold-end', 2.5))
    probe = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', path],
                                      capture_output=True, text=True).stdout)
    v = next(s for s in probe['streams'] if s['codec_type'] == 'video')
    a = next((s for s in probe['streams'] if s['codec_type'] == 'audio'), None)
    num, den = map(int, v['r_frame_rate'].split('/'))
    duration = float(probe['format']['duration'])
    report = {'file': path, 'size_mb': round(int(probe['format']['size']) / 1e6, 2), 'duration_s': round(duration, 3),
              'video': f"{v['codec_name']} {v['width']}x{v['height']} {num / den:.3f} fps {v.get('pix_fmt')}",
              'color': {k: v.get(k) for k in ('color_space', 'color_transfer', 'color_primaries')},
              'audio': f"{a['codec_name']} {a['sample_rate']} Hz {a['channels']} ch" if a else None}
    problems = []
    if a and '--no-audio' not in argv:
        err = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', path, '-map', '0:a', '-af', 'ebur128=peak=true', '-f', 'null', '-'],
                             capture_output=True, text=True).stderr
        try:
            report['loudness_lufs'] = float(re.findall(r'I:\s+(-?[\d.]+) LUFS', err)[-1])
            report['true_peak_dbtp'] = float(re.findall(r'Peak:\s+(-?[\d.]+) dBFS', err)[-1])
        except (IndexError, ValueError):
            report['loudness_lufs'] = None
        if report.get('loudness_lufs') is None:
            problems.append('audio is silent')
        else:
            if abs(report['loudness_lufs'] - target) > 1.0:
                problems.append(f"loudness {report['loudness_lufs']} LUFS is far from {target}")
            if report['true_peak_dbtp'] > -1.0:
                problems.append(f"true peak {report['true_peak_dbtp']} dBTP above -1")
    elif '--no-audio' not in argv:
        problems.append('no audio stream')
    err = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', path, '-vf', 'blackdetect=d=0.3:pix_th=0.06,freezedetect=n=0.002:d=1.5',
                          '-an', '-f', 'null', '-'], capture_output=True, text=True).stderr
    report['black'] = [(float(s), float(e)) for s, e in re.findall(r'black_start:([\d.]+) black_end:([\d.]+)', err)]
    report['frozen'] = [float(s) for s in re.findall(r'freeze_start: ([\d.]+)', err)]
    frozen = [s for s in report['frozen'] if s < duration - hold_end - 0.2]
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-vf', r'select=eq(n\,3),scale=270:480,format=gray', '-frames:v', '1',
                          '-f', 'rawvideo', '-'], capture_output=True).stdout
    if raw:
        report['first_frame_luma_std'] = round(statistics.pstdev(list(raw)), 1)
    if (v['width'], v['height']) != (width, height):
        problems.append(f"resolution {v['width']}x{v['height']} != {width}x{height}")
    if abs(num / den - fps_expected) > 0.01:
        problems.append(f'fps {num / den:.3f} != {fps_expected}')
    if report['size_mb'] > max_mb:
        problems.append(f"file is {report['size_mb']} MB (> {max_mb})")
    if report['black']:
        problems.append(f"black stretches: {report['black']}")
    if frozen:
        problems.append(f'frozen stretches starting at {frozen}')
    if expected and abs(duration - expected) > 0.25:
        problems.append(f'duration {duration:.2f} != expected {expected}')
    if report.get('first_frame_luma_std', 99) < 8:
        problems.append('the first frames are almost empty (the hook needs content)')
    report['problems'] = problems
    with open(path + '.verify.json', 'w', encoding='utf-8') as fh:
        json.dump(report, fh, ensure_ascii=False, indent=1)
    print(json.dumps(report, ensure_ascii=False, indent=1))
    sys.exit(1 if problems else 0)


if __name__ == '__main__':
    main(sys.argv[1:])
