#!/usr/bin/env python3
"""Checks a script.json before paying for voices.

    python3 tools/lint_script.py <piece> [--max-seconds 60]      exit code 1 when there are ERRORS

Errors: duplicated ids, unknown voices, placements that point nowhere, and direction tags that lower the voice
(they come out whispered, and a whispered take has to be regenerated).
Warnings: digits in spoken text (write numbers as words and turn them into figures with the captions' `replace`),
lines without a direction tag, long sentences, promises the product may not keep, and a voice longer than the format.
Product rules: put {"errors": [["regex", "why"]], "warnings": [["regex", "why"]]} in <piece>/lint.json or in the
folder above it (claims your product cannot make, names you must not say, the right spelling of your domain).
"""
import json
import os
import re
import sys
import unicodedata

QUIET = r'whisper|softly|quietly|hushed|low voice|intimate|gently|tender|breathy|secret|murmur|sheepish|smiling'
PROMISES = r'\bguarantee|\b100 ?%|\bnever fails\b|\balways works\b|\binstantly\b|\bin seconds\b|\bdouble your\b|\btriple your\b|\bno risk\b'
CHARS_PER_SECOND = 14.5   # the speaking rate the silent voice provider estimates with


def flat(s):
    return unicodedata.normalize('NFD', s.lower()).encode('ascii', 'ignore').decode()


def spoken(text):
    return re.sub(r'\s+', ' ', re.sub(r'\[[^\]]*\]', ' ', text).replace('*', '')).strip()


def rules(pd):
    for f in (os.path.join(pd, 'lint.json'), os.path.join(os.path.dirname(pd), 'lint.json')):
        if os.path.exists(f):
            with open(f, encoding='utf-8') as fh:
                return json.load(fh)
    return {}


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    pd = os.path.abspath(sys.argv[1])
    with open(os.path.join(pd, 'script.json'), encoding='utf-8') as fh:
        script = json.load(fh)
    max_s = float(sys.argv[sys.argv.index('--max-seconds') + 1]) if '--max-seconds' in sys.argv else 60.0
    extra = rules(pd)
    errors, warnings, ids, chars = [], [], set(), 0
    voices = set(script.get('voices', {}))
    for line in script.get('lines', []):
        lid, text = line.get('id', '?'), line.get('text', '')
        if lid in ids:
            errors.append(f'{lid}: duplicated id')
        ids.add(lid)
        if voices and line.get('voice') not in voices:
            errors.append(f"{lid}: unknown voice \"{line.get('voice')}\"")
        for key in ('after', 'with'):
            if line.get(key) and line[key] not in ids:
                errors.append(f'{lid}: "{key}" points to {line[key]}, which is not an earlier line')
        for tag in re.findall(r'\[([^\]]+)\]', text):
            if re.search(QUIET, flat(tag)):
                errors.append(f'{lid}: [{tag}] lowers the voice and comes out whispered; use [clear, full voice], [confident], [explaining] or [upbeat]')
        said = spoken(text)
        chars += len(said)
        if re.search(r'\d', said):
            warnings.append(f'{lid}: digits in spoken text; write numbers as words and show figures with captions.replace  ← "{said}"')
        if not re.search(r'\[[^\]]+\]', text):
            warnings.append(f'{lid}: no [direction] tag (a performance hint improves the take)')
        for sentence in re.split(r'(?<=[.!?…])\s+', said):
            if len(sentence.split()) > 18:
                warnings.append(f'{lid}: a sentence of {len(sentence.split())} words is hard to follow by ear  ← "{sentence}"')
        if re.search(PROMISES, flat(said)):
            warnings.append(f'{lid}: a promise of results: claim only what the product does today  ← "{said}"')
        for pattern, why in extra.get('errors', []):
            if re.search(pattern, flat(said)):
                errors.append(f'{lid}: {why}  ← "{said}"')
        for pattern, why in extra.get('warnings', []):
            if re.search(pattern, flat(said)):
                warnings.append(f'{lid}: {why}  ← "{said}"')
    seconds = chars / CHARS_PER_SECOND
    if seconds > max_s:
        warnings.append(f'about {seconds:.0f} s of voice: long for this format (limit {max_s:.0f} s with --max-seconds)')
    for e in errors:
        print('ERROR   ', e)
    for w in warnings:
        print('WARNING ', w)
    print(f"{len(script.get('lines', []))} lines, about {seconds:.0f} s of voice · {len(errors)} errors, {len(warnings)} warnings")
    sys.exit(1 if errors else 0)


if __name__ == '__main__':
    main()
