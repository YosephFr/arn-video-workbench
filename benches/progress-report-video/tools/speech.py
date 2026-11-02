"""Speech helpers shared by audition.py and transcribe_master.py: decoding, transcription, word comparison,
sentence-ending and whisper measurements. Standard library plus numpy; keys only from the environment."""
import base64
import json
import os
import re
import subprocess
import time
import unicodedata
import urllib.error
import urllib.request
import uuid

import numpy as np

SR = 16000


# ----------------------------------------------------------------------------- audio
def decode16(path):
    """Any audio or video file → mono float32 at 16 kHz."""
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-vn', '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).copy()


def wav16(path, out):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', path, '-vn', '-ac', '1', '-ar', str(SR), '-c:a', 'pcm_s16le', out], check=True)


def frame_rms_db(x, win=0.03, hop=0.01):
    w, h = int(win * SR), int(hop * SR)
    n = max(0, (len(x) - w) // h)
    if n == 0:
        return np.array([])
    sel = np.arange(w)[None, :] + h * np.arange(n)[:, None]
    return 10 * np.log10(np.mean(x[sel] ** 2, axis=1) + 1e-12)


def voicing(x):
    """Fraction of energetic frames that are voiced (periodic between 70 and 350 Hz). Whispered speech has the
    energy of speech without the periodicity, so this fraction drops; audio judges rarely hear it, people do."""
    if len(x) < SR * 0.2:
        return None
    # A gentle low-pass (moving average) keeps the pitch region and drops hiss.
    y = np.convolve(x, np.ones(8) / 8, mode='same')
    db = frame_rms_db(x)
    if not len(db):
        return None
    floor = np.percentile(db, 99.5) - 38
    w, h = int(0.03 * SR), int(0.01 * SR)
    lo, hi = SR // 350, SR // 70
    voiced = total = 0
    for i, e in enumerate(db):
        if e < floor:
            continue
        f = y[i * h:i * h + w]
        f = f - f.mean()
        spec = np.fft.rfft(f, 2 * w)
        ac = np.fft.irfft(spec * np.conj(spec))[:w]
        if ac[0] <= 0:
            continue
        total += 1
        if np.max(ac[lo:hi] / ac[0]) > 0.5:
            voiced += 1
    return round(voiced / total, 2) if total else None


def ending(x, words=None):
    """How the take ends: level of its last 60 ms relative to the speech (a take cut mid-word stays loud) and
    the silence after the last word."""
    db = frame_rms_db(x)
    if not len(db):
        return {'tail_db': None}
    speech = float(np.percentile(db, 90))
    tail = float(np.mean(db[-6:])) if len(db) >= 6 else float(db[-1])
    return {'tail_db': round(tail - speech, 1), 'cut': bool(tail - speech > -26)}


# ----------------------------------------------------------------------------- words
ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
        'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']


def num_en(n):
    if n < 20:
        return ONES[n]
    if n < 100:
        return TENS[n // 10] + (' ' + ONES[n % 10] if n % 10 else '')
    if n < 1000:
        return ONES[n // 100] + ' hundred' + (' ' + num_en(n % 100) if n % 100 else '')
    if n < 1_000_000:
        return num_en(n // 1000) + ' thousand' + (' ' + num_en(n % 1000) if n % 1000 else '')
    return str(n)


def words(text, language='en'):
    """Comparable words: no [directions], no accents, lower case; in English, digits and % become words."""
    s = re.sub(r'\[[^\]]*\]', ' ', text).replace('*', ' ').lower()
    if language.startswith('en'):
        s = re.sub(r'(\d),(\d{3})', r'\1\2', s)
        s = s.replace('%', ' percent ')
        s = re.sub(r'\d+', lambda m: ' ' + num_en(int(m.group(0))) + ' ', s)
    s = s.replace('-', ' ')
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()
    return [w for w in re.sub(r"[^a-z0-9' ]", ' ', s).replace("'", '').split() if w]


def word_diff(ref, hyp):
    """Word-level Levenshtein distance."""
    d = list(range(len(hyp) + 1))
    for i in range(1, len(ref) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(hyp) + 1):
            cur = d[j]
            d[j] = min(d[j] + 1, d[j - 1] + 1, prev + (ref[i - 1] != hyp[j - 1]))
            prev = cur
    return d[len(hyp)]


def tolerance(n_words):
    return 0 if n_words <= 4 else 1 if n_words <= 9 else 2


# ----------------------------------------------------------------------------- APIs
def _multipart(url, fields, file_field, filename, data, ctype, headers, timeout=180):
    b = uuid.uuid4().hex
    body = bytearray()
    for k, v in fields:
        body += f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
    body += (f'--{b}\r\nContent-Disposition: form-data; name="{file_field}"; filename="{filename}"\r\n'
             f'Content-Type: {ctype}\r\n\r\n').encode() + data + f'\r\n--{b}--\r\n'.encode()
    req = urllib.request.Request(url, data=bytes(body), headers={'Content-Type': f'multipart/form-data; boundary={b}', **headers})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503) and attempt < 3:
                time.sleep(4 * (attempt + 1))
                continue
            raise RuntimeError(f'{url} {e.code}: {e.read().decode(errors="replace")[:300]}')


def post_json(url, body, headers, timeout=120):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', **headers})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503) and attempt < 2:
                time.sleep(4 * (attempt + 1))
                continue
            raise RuntimeError(f'{url} {e.code}: {e.read().decode(errors="replace")[:300]}')


def transcribe(path, language='en', timestamps=False):
    """OpenAI transcription. Returns {'text', 'words': [{word, start, end}] | None} or None without a key."""
    key = os.environ.get('OPENAI_API_KEY')
    if not key:
        return None
    tmp = path + '.16k.wav'
    wav16(path, tmp)
    data = open(tmp, 'rb').read()
    os.unlink(tmp)
    # WB_TRANSCRIBE_MODEL (it must return word timestamps) replaces both defaults when it is set
    model = os.environ.get('WB_TRANSCRIBE_MODEL') or ('whisper-1' if timestamps else 'gpt-4o-transcribe')
    fields = [('model', model), ('language', language.split('-')[0])]
    if timestamps:
        fields += [('response_format', 'verbose_json'), ('timestamp_granularities[]', 'word')]
    out = _multipart('https://api.openai.com/v1/audio/transcriptions', fields, 'file', 'audio.wav', data, 'audio/wav',
                     {'Authorization': f'Bearer {key}'})
    return {'text': out.get('text', ''), 'words': out.get('words')}


def b64(path):
    tmp = path + '.16k.wav'
    wav16(path, tmp)
    data = base64.b64encode(open(tmp, 'rb').read()).decode()
    os.unlink(tmp)
    return data
