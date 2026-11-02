"""Voice takes for every line of a piece.

    wb voice <piece> [LINE_ID ...] [--takes N] [--force] [--provider NAME]

Writes voice/<id>__t<k>.wav (48 kHz mono) and voice/<id>__t<k>.json ({text, words: [{text, start, end}]},
times relative to the take) plus voice/selection.json (the take used per line; edit it after listening).

Providers, chosen per voice in script.json (`provider`) or globally with WB_TTS_PROVIDER:
  elevenlabs  ELEVENLABS_API_KEY; `voice` = voice id; word timings from the API alignment.
  openai      OPENAI_API_KEY; `voice` = alloy, verse, ...; word timings from a word-level transcription.
  cosyvoice   local CosyVoice 3 (the engine VoiceStudio wraps; core/bin/install-cosyvoice.sh); `profile` = a .ps voice
              profile, or `reference` + `reference_text` (a 10–15 s clip of a voice you have permission to use).
              Relative paths are relative to the piece folder. Word timings from a local faster-whisper if installed,
              else OpenAI, else estimated.
  say         macOS `say`; `voice` = a system voice name; word timings transcribed with OpenAI if a key is set,
              otherwise estimated.
  silent      no audio, no keys: silence of the estimated speaking length, so layouts can be timed early.
  auto        the first available of elevenlabs, openai, cosyvoice (when the voice has a profile), say, silent.

Word-level transcriptions use OpenAI's WB_TRANSCRIBE_MODEL (default whisper-1; the model must return word timestamps).
A local faster-whisper uses WB_WHISPER_MODEL (default medium) and the language WB_LANGUAGE, else script.json "language".
"""
import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor

import numpy as np

from . import common
from .common import SR

CHARS_PER_SECOND = 14.5   # rough speaking rate used when a provider gives no timings
COSYVOICE_HOME = os.path.expanduser(os.environ.get('COSYVOICE_HOME', '~/.local/share/cosyvoice'))
COSYVOICE_CLI = os.environ.get('COSYVOICE_CLI', os.path.join(COSYVOICE_HOME, 'cosyvoice.cpp/build/bin/cosyvoice-cli'))
COSYVOICE_MODEL = os.environ.get('COSYVOICE_MODEL', os.path.join(COSYVOICE_HOME, 'models/CosyVoice3-2512_Q4_K_M.gguf'))
COSYVOICE_FRONTEND = os.environ.get('COSYVOICE_FRONTEND', os.path.join(COSYVOICE_HOME, 'models/frontend-onnx'))
SCRIPT_LANGUAGE = None    # script.json "language" of the piece being voiced (set by main)


def asr_language():
    """Language code for local speech recognition: WB_LANGUAGE, else the script's language ('en-US' → 'en')."""
    lang = (os.environ.get('WB_LANGUAGE') or SCRIPT_LANGUAGE or '').strip().lower()
    return lang.replace('_', '-').split('-')[0] or None


# ----------------------------------------------------------------------------- provider choice
def pick_provider(cfg):
    forced = os.environ.get('WB_TTS_PROVIDER') or cfg.get('provider', 'auto')
    if forced != 'auto':
        return forced
    if os.environ.get('ELEVENLABS_API_KEY') and cfg.get('voice'):
        return 'elevenlabs'
    if os.environ.get('OPENAI_API_KEY'):
        return 'openai'
    if (cfg.get('profile') or cfg.get('reference')) and os.path.exists(COSYVOICE_CLI):
        return 'cosyvoice'
    if shutil.which('say'):
        return 'say'
    return 'silent'


def _post_json(url, body, headers, timeout=240, retries=5):
    last = ''
    for attempt in range(retries):
        req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', **headers})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as err:
            last = err.read().decode(errors='replace')[:400]
            if err.code in (409, 429, 500, 502, 503) and attempt < retries - 1:
                time.sleep(4 * (attempt + 1))
                continue
            raise RuntimeError(f'{url.split("/v1/")[-1]} {err.code}: {last}')
    raise RuntimeError('retries exhausted: ' + last)


def _post_multipart(url, fields, files, headers, timeout=240):
    boundary = uuid.uuid4().hex
    body = bytearray()
    for name, value in fields:
        body += f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
    for name, filename, data, ctype in files:
        body += (f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'
                 f'Content-Type: {ctype}\r\n\r\n').encode() + data + b'\r\n'
    body += f'--{boundary}--\r\n'.encode()
    req = urllib.request.Request(url, data=bytes(body), headers={'Content-Type': f'multipart/form-data; boundary={boundary}', **headers})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


# ----------------------------------------------------------------------------- word timings
def words_from_alignment(al):
    chars, starts, ends = al['characters'], al['character_start_times_seconds'], al['character_end_times_seconds']
    words, cur, s0, prev_end = [], '', None, 0.0
    for ch, s, e in zip(chars, starts, ends):
        if ch.isspace():
            if cur:
                words.append({'text': cur, 'start': s0, 'end': prev_end})
                cur, s0 = '', None
        else:
            if s0 is None:
                s0 = s
            cur += ch
            prev_end = e
    if cur:
        words.append({'text': cur, 'start': s0, 'end': prev_end})
    return words


def estimate_words(text, duration, lead=0.12, tail=0.15):
    """Spread the words over the take by letter count, with small rests after punctuation."""
    tokens = common.spoken_text(text).split()
    if not tokens:
        return []
    weights = [max(1, len(common.norm(t))) + (2.5 if t[-1:] in ',;:' else 4 if t[-1:] in '.!?…' else 0.6) for t in tokens]
    span = max(0.2, duration - lead - tail)
    unit = span / sum(weights)
    words, t = [], lead
    for tok, w in zip(tokens, weights):
        speak = (max(1, len(common.norm(tok))) + 0.6) * unit
        words.append({'text': tok, 'start': round(t, 3), 'end': round(t + speak, 3)})
        t += w * unit
    return words


def estimate_duration(text, speed=1.0):
    return 0.35 + len(common.spoken_text(text)) / (CHARS_PER_SECOND * speed)


def transcribe_words(wav_path):
    """Word-level timestamps of a take with OpenAI's transcription API (used for providers without alignment).
    The model is WB_TRANSCRIBE_MODEL (default whisper-1) and must support word timestamps."""
    key = os.environ.get('OPENAI_API_KEY')
    if not key:
        return None
    try:
        with open(wav_path, 'rb') as fh:
            data = fh.read()
        model = os.environ.get('WB_TRANSCRIBE_MODEL') or 'whisper-1'
        out = _post_multipart('https://api.openai.com/v1/audio/transcriptions',
                              [('model', model), ('response_format', 'verbose_json'), ('timestamp_granularities[]', 'word')],
                              [('file', os.path.basename(wav_path), data, 'audio/wav')], {'Authorization': f'Bearer {key}'})
        return [{'text': w['word'], 'start': w['start'], 'end': w['end']} for w in out.get('words', [])]
    except Exception as err:  # noqa: BLE001 - timings fall back to an estimate
        print(f'  transcription failed ({err}); estimating word timings', file=sys.stderr)
        return None


def _to_wav48(src, dst):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-ac', '1', '-ar', str(SR), '-c:a', 'pcm_s16le', dst], check=True)


# ----------------------------------------------------------------------------- providers
def tts_elevenlabs(cfg, text, line, take, wav):
    key = os.environ.get('ELEVENLABS_API_KEY')
    if not key:
        raise RuntimeError('ELEVENLABS_API_KEY is not set')
    model = line.get('model', cfg.get('model', 'eleven_multilingual_v2'))
    spoken = common.strip_emphasis(text) if ('v3' in model or cfg.get('direction_tags')) else common.spoken_text(text)
    body = {'text': spoken, 'model_id': model, 'seed': line.get('seed', 1000 + 17 * take)}
    settings = {**cfg.get('settings', {}), **line.get('settings', {})}
    if 'speed' in cfg or 'speed' in line:
        settings['speed'] = line.get('speed', cfg.get('speed', 1.0))
    if settings:
        body['voice_settings'] = settings
    if line.get('previous_text'):
        body['previous_text'] = line['previous_text']
    raw = _post_json(f"https://api.elevenlabs.io/v1/text-to-speech/{cfg['voice']}/with-timestamps?output_format=mp3_44100_192",
                     body, {'xi-api-key': key})
    data = json.loads(raw)
    with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as tmp:
        tmp.write(base64.b64decode(data['audio_base64']))
    _to_wav48(tmp.name, wav)
    os.unlink(tmp.name)
    al = data.get('alignment') or data.get('normalized_alignment')
    return words_from_alignment(al)


def tts_openai(cfg, text, line, take, wav):
    key = os.environ.get('OPENAI_API_KEY')
    if not key:
        raise RuntimeError('OPENAI_API_KEY is not set')
    body = {'model': line.get('model', cfg.get('model', 'gpt-4o-mini-tts')), 'voice': cfg.get('voice') or 'alloy',
            'input': common.spoken_text(text), 'response_format': 'wav', 'speed': line.get('speed', cfg.get('speed', 1.0))}
    if cfg.get('instructions'):
        body['instructions'] = cfg['instructions']
    raw = _post_json('https://api.openai.com/v1/audio/speech', body, {'Authorization': f'Bearer {key}'})
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
        tmp.write(raw)
    _to_wav48(tmp.name, wav)
    os.unlink(tmp.name)
    return transcribe_words(wav) or estimate_words(text, common.duration_of(wav))


def local_words(wav_path):
    """Word timestamps from a local faster-whisper model, when it is installed (pip install faster-whisper)."""
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        return None
    global _WHISPER
    if '_WHISPER' not in globals():
        _WHISPER = WhisperModel(os.environ.get('WB_WHISPER_MODEL', 'medium'), device='cpu', compute_type='int8')
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', wav_path, '-f', 'f32le', '-ac', '1', '-ar', '16000', '-'], capture_output=True, check=True).stdout
    segments, _ = _WHISPER.transcribe(np.frombuffer(raw, np.float32), language=asr_language(), word_timestamps=True)
    return [{'text': w.word.strip(), 'start': float(w.start), 'end': float(w.end)} for s in segments for w in (s.words or [])]


def align_to_script(text, heard, duration):
    """Keep the script's own words (captions must match the script) and take their times from what was heard."""
    import difflib
    tokens = common.spoken_text(text).split()
    a = [common.norm(t) for t in tokens]
    b = [common.norm(w['text']) for w in heard]
    span = [[None, None] for _ in tokens]
    for blk in difflib.SequenceMatcher(None, a, b, autojunk=False).get_matching_blocks():
        for k in range(blk.size):
            span[blk.a + k] = [heard[blk.b + k]['start'], heard[blk.b + k]['end']]
    if all(s[0] is None for s in span):
        return estimate_words(text, duration)
    i = 0
    while i < len(tokens):   # words the recogniser wrote differently (numbers, names): share the gap by letters
        if span[i][0] is not None:
            i += 1
            continue
        j = i
        while j < len(tokens) and span[j][0] is None:
            j += 1
        t0 = span[i - 1][1] if i else 0.1
        t1 = span[j][0] if j < len(tokens) else max(t0 + 0.1, duration - 0.1)
        sizes = [max(1, len(common.norm(tokens[x]))) for x in range(i, j)]
        t = t0
        for x, n in zip(range(i, j), sizes):
            d = (t1 - t0) * n / sum(sizes)
            span[x] = [t, t + d]
            t += d
        i = j
    return [{'text': tok, 'start': round(s, 3), 'end': round(e, 3)} for tok, (s, e) in zip(tokens, span)]


def tts_cosyvoice(cfg, text, line, take, wav):
    """CosyVoice 3 on CPU through cosyvoice.cpp (the GGUF engine VoiceStudio uses). Only clone voices you may use."""
    if not os.path.exists(COSYVOICE_CLI):
        raise RuntimeError('cosyvoice-cli not found: run core/bin/install-cosyvoice.sh or set COSYVOICE_CLI')
    profile = cfg.get('profile')
    if not profile:
        ref = cfg.get('reference')
        if not ref or not cfg.get('reference_text'):
            raise RuntimeError('cosyvoice voices need "profile" (.ps) or "reference" + "reference_text"')
        profile = os.path.splitext(ref)[0] + '.ps'
        if not os.path.exists(profile):
            heard = local_words(ref) or transcribe_words(ref)
            if heard:   # the transcript must cover the whole clip, or the model skips the start of every line
                said, written = len(heard), len(common.spoken_text(cfg['reference_text']).split())
                if abs(said - written) > max(2, 0.12 * written):
                    raise RuntimeError(f'reference_text has {written} words but the clip says about {said}: '
                                       f'heard "{" ".join(w["text"] for w in heard)}". Fix the transcript or trim the clip.')
            subprocess.run([COSYVOICE_CLI, '--frontend-only', '--speech-tokenizer', os.path.join(COSYVOICE_FRONTEND, 'speech_tokenizer_v3.int8.onnx'),
                            '--campplus', os.path.join(COSYVOICE_FRONTEND, 'campplus.int8.onnx'), '--prompt-audio', ref,
                            '--prompt-text', cfg['reference_text'], '--prompt-speech-output', profile], check=True, capture_output=True)
    seeds = cfg.get('seeds', [11, 23, 37, 53, 71])
    with tempfile.TemporaryDirectory() as tmp:
        raw = os.path.join(tmp, 'raw.wav')
        # --cpu: the Metal path of this runtime produced garbled audio on Apple Silicon in our tests
        subprocess.run([COSYVOICE_CLI, '-q', '--cpu', '-m', COSYVOICE_MODEL, '--prompt-speech', profile, '--seed', str(line.get('seed', seeds[take % len(seeds)])),
                        '--speed', str(line.get('speed', cfg.get('speed', 1.0))), '--text', common.spoken_text(text), '-o', raw],
                       check=True, stdin=subprocess.DEVNULL, capture_output=True)
        trim = ('silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,'
                'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.12,areverse')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', raw, '-af', trim, '-ac', '1', '-ar', str(SR), '-c:a', 'pcm_s16le', wav], check=True)
    heard = local_words(wav) or transcribe_words(wav)
    return align_to_script(text, heard, common.duration_of(wav)) if heard else estimate_words(text, common.duration_of(wav))


def tts_say(cfg, text, line, take, wav):
    with tempfile.TemporaryDirectory() as tmp:
        aiff = os.path.join(tmp, 'take.aiff')
        cmd = ['say', '-o', aiff]
        if cfg.get('voice'):
            cmd += ['-v', cfg['voice']]
        rate = int(185 * line.get('speed', cfg.get('speed', 1.0)))
        cmd += ['-r', str(rate), common.spoken_text(text)]
        subprocess.run(cmd, check=True)
        _to_wav48(aiff, wav)
    return transcribe_words(wav) or estimate_words(text, common.duration_of(wav))


def tts_silent(cfg, text, line, take, wav):
    duration = estimate_duration(text, line.get('speed', cfg.get('speed', 1.0)))
    common.save_wav(wav, np.zeros(int(duration * SR), np.float32))
    return estimate_words(text, duration)


PROVIDERS = {'elevenlabs': tts_elevenlabs, 'openai': tts_openai, 'cosyvoice': tts_cosyvoice, 'say': tts_say, 'silent': tts_silent}


def piece_paths(cfg, pd):
    """A voice's files (a CosyVoice `reference` clip or `profile`) are relative to the piece folder, not the shell."""
    out = dict(cfg)
    for key in ('reference', 'profile'):
        if out.get(key):
            path = os.path.expanduser(out[key])
            out[key] = path if os.path.isabs(path) else os.path.join(pd, path)
    return out


def make_take(pd, voices, line, take, force, provider_override):
    base = os.path.join(pd, 'voice', f"{line['id']}__t{take}")
    if os.path.exists(base + '.wav') and not force:
        return line['id'], take, 'exists'
    cfg = piece_paths(voices.get(line['voice'], {}), pd)
    provider = provider_override or pick_provider(cfg)
    words = PROVIDERS[provider](cfg, line['text'], line, take, base + '.wav')
    common.save_json(base + '.json', {'id': line['id'], 'voice': line['voice'], 'provider': provider,
                                      'text': line['text'], 'words': words})
    return line['id'], take, provider


def main(argv):
    pd = common.piece_dir(argv[0])
    args = argv[1:]
    force = '--force' in args
    takes = int(args[args.index('--takes') + 1]) if '--takes' in args else None
    provider = args[args.index('--provider') + 1] if '--provider' in args else None
    skip = {takes and str(takes), provider}
    ids = [a for a in args if not a.startswith('--') and a not in skip]
    script = common.load_script(pd)
    global SCRIPT_LANGUAGE
    SCRIPT_LANGUAGE = script.get('language')
    voices = common.voices_of(script)
    os.makedirs(os.path.join(pd, 'voice'), exist_ok=True)
    jobs = [(line, k) for line in script['lines'] if not ids or line['id'] in ids
            for k in range(takes or line.get('takes', 1))]
    with ThreadPoolExecutor(4) as pool:
        for lid, k, status in pool.map(lambda j: make_take(pd, voices, j[0], j[1], force, provider), jobs):
            print(f'{lid} take {k}: {status}', flush=True)
    sel_path = os.path.join(pd, 'voice', 'selection.json')
    selection = common.load_json(sel_path, default={})
    for line in script['lines']:
        selection.setdefault(line['id'], 0)
    common.save_json(sel_path, selection)
