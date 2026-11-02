"""Shared helpers for the workbench tools: piece folders, script/brand loading, text markup and audio I/O.

A *piece* is a folder with a `script.json` (see docs/CONTRACT.md). Every tool takes that folder as its first
argument and writes its outputs next to it.
"""
import json
import os
import re
import subprocess
import sys
import unicodedata

import numpy as np

SR = 48000
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))


# ----------------------------------------------------------------------------- piece and files
def piece_dir(arg):
    path = os.path.abspath(arg)
    if not os.path.isfile(os.path.join(path, 'script.json')):
        sys.exit(f'{arg}: not a piece folder (no script.json)')
    return path


def expand_env(value):
    """Expand ${VAR} placeholders so secrets and voice IDs stay in the environment, never in files."""
    if isinstance(value, str):
        return re.sub(r'\$\{([A-Z0-9_]+)\}', lambda m: os.environ.get(m.group(1), ''), value)
    if isinstance(value, dict):
        return {k: expand_env(v) for k, v in value.items()}
    if isinstance(value, list):
        return [expand_env(v) for v in value]
    return value


def load_json(path, default=None):
    if not os.path.exists(path):
        if default is not None:
            return default
        sys.exit(f'missing {path}')
    with open(path, encoding='utf-8') as fh:
        return json.load(fh)


def save_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)


def load_script(pd):
    script = load_json(os.path.join(pd, 'script.json'))
    ids = [line['id'] for line in script.get('lines', [])]
    if len(ids) != len(set(ids)):
        sys.exit('script.json: duplicated line ids')
    return script


def load_timeline(pd):
    return load_json(os.path.join(pd, 'timeline.json'))


def voices_of(script):
    return expand_env(script.get('voices', {}))


# ----------------------------------------------------------------------------- text markup
def strip_emphasis(text):
    """What is sent to the voice: performance hints stay, emphasis asterisks go."""
    return text.replace('*', '')


def strip_markup(text):
    """What is shown: no [direction] hints and no asterisks."""
    return re.sub(r'\s+', ' ', re.sub(r'\[[^\]]*\]', ' ', text.replace('*', ' '))).strip()


def spoken_text(text):
    """Text without direction hints (used to estimate durations and to align words)."""
    return re.sub(r'\s+', ' ', re.sub(r'\[[^\]]*\]', ' ', text)).replace('*', '').strip()


def tokens_with_emphasis(text):
    """[(word, emphasised)] for the visible words. One *emphasis* may span several words."""
    tokens, inside = [], False
    for tok in re.sub(r'\[[^\]]*\]', ' ', text).split():
        stars = tok.count('*')
        hot = inside or stars > 0
        if stars % 2 == 1:
            inside = not inside
        word = tok.replace('*', '')
        if word:
            tokens.append((word, hot))
    return tokens


def norm(word):
    """Lowercase, accent-free, alphanumeric only: used to match words between script, alignment and anchors."""
    w = unicodedata.normalize('NFD', word.lower())
    w = ''.join(ch for ch in w if unicodedata.category(ch) != 'Mn')
    return re.sub(r'[^a-z0-9]', '', w)


# ----------------------------------------------------------------------------- audio I/O (ffmpeg)
def decode(path, channels=1):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', str(channels), '-ar', str(SR), '-'],
                         capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype=np.float32).copy()
    return x.reshape(-1, channels) if channels > 1 else x


def save_wav(path, x):
    x = np.asarray(x, dtype=np.float32)
    channels = 1 if x.ndim == 1 else x.shape[1]
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ac', str(channels), '-ar', str(SR), '-i', '-', '-c:a', 'pcm_f32le', path],
                   input=x.tobytes(), check=True)


def ffilter(x, af):
    """Run a numpy signal through an ffmpeg audio filter chain."""
    channels = 1 if x.ndim == 1 else x.shape[1]
    out = subprocess.run(['ffmpeg', '-v', 'error', '-f', 'f32le', '-ac', str(channels), '-ar', str(SR), '-i', '-', '-af', af,
                          '-f', 'f32le', '-ac', str(channels), '-ar', str(SR), '-'],
                         input=np.asarray(x, np.float32).tobytes(), capture_output=True, check=True).stdout
    y = np.frombuffer(out, dtype=np.float32).copy()
    return y.reshape(-1, channels) if channels > 1 else y


def loudness(path):
    """Integrated loudness (LUFS) and true peak (dBTP) of a file, measured by ffmpeg's ebur128."""
    err = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-'],
                         capture_output=True, text=True).stderr
    integrated = float(re.findall(r'I:\s+(-?[\d.]+) LUFS', err)[-1])
    peak = float(re.findall(r'Peak:\s+(-?[\d.]+) dBFS', err)[-1])
    return integrated, peak


def db(gain):
    return 10 ** (gain / 20)


def duration_of(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
                         capture_output=True, text=True).stdout.strip()
    return float(out or 0)
