#!/usr/bin/env python3
"""Build a branded executive report (A4, 2–4 pages) from report.json + brand.json, then check its layout.

    python engine/report.py <piece> [--strict] [--no-qa]

Writes <piece>/renders/<meta.filename or report.pdf>, and in <piece>/renders/qa/: layout-check.json (every text box
and every problem found), readback.txt and readback-check.json (the text extracted back from the PDF), and
page-N.png (each page rendered for review). --strict exits 1 when the layout check or the read-back finds anything.

report.json:
  { "meta": { "title", "subject", "author", "date", "running_title", "filename",
              "currency": { "symbol": "$", "thousands": ",", "decimal": ".", "decimals": 0, "position": "prefix" } },
    "pages": [ { "blocks": [ { "type": "title", "text": "…" }, … ],
                 "sections": [ { "heading": "…", "heading_size": 13, "blocks": [ … ] }, … ] }, … ] }
A page's blocks come first, then each section: its heading, then its blocks. Block types and options: engine/blocks.py. Blocks flow from the top of the page; a page that overflows is
reported, never silently cut or reflowed: the author decides what goes on each page.
"""
import json
import os
import re
import sys

from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blocks  # noqa: E402
from design import SUPERSCRIPTS, Design, Page, money_formatter  # noqa: E402

BENCH = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
ROOT = os.path.abspath(os.path.join(BENCH, '..', '..'))


def load_brand(piece):
    own = os.path.join(piece, 'brand.json')
    path = own if os.path.exists(own) else os.path.join(BENCH, 'brand', 'brand.json')
    brand = json.load(open(path, encoding='utf-8'))
    brand['_dir'] = os.path.dirname(path)
    return brand


def find(brand, rel, piece):
    if not rel:
        return None
    for base in (BENCH, piece, brand['_dir']):
        p = os.path.join(base, rel)
        if os.path.exists(p):
            return p
    return None


def header(P, brand, meta, piece):
    d = P.d
    logo = find(brand, brand.get('pdf', {}).get('logo_png', 'brand/logo.png'), piece)
    lh = brand.get('pdf', {}).get('logo_height', 26)
    if logo:
        P.image(logo, d.margin, 32, h=lh)
    else:
        # Placeholder lockup drawn in vector: a rounded tile in the accent and the name in the display face.
        P.rect(d.margin, 32, lh, lh, d.accent, lh * 0.27)
        P.c.setStrokeColor(d.accent_ink)
        P.c.setLineWidth(lh * 0.1)
        P.c.setLineCap(1)
        P.c.setLineJoin(1)
        path = P.c.beginPath()
        x0, y0 = d.margin, d.H - 32 - lh
        for i, (px, py) in enumerate([(0.25, 0.33), (0.42, 0.53), (0.55, 0.42), (0.75, 0.65)]):
            (path.lineTo if i else path.moveTo)(x0 + px * lh, y0 + py * lh)
        P.c.drawPath(path, stroke=1, fill=0)
        P.text(d.margin + lh + 8, 32 + (lh - 15) / 2 - 0.5, brand.get('name', ''), 15, 'Display')
    if meta.get('date'):
        P.right(d.W - d.margin, 37, meta['date'], 8.5, 'Body', d.muted)


def footer(P, meta, n, total):
    d = P.d
    P.text(d.margin, 808, meta.get('running_title', meta.get('title', '')), 8, 'Body', d.muted)
    P.right(d.W - d.margin, 808, f'{n} / {total}', 8, 'Body', d.muted)


def page_blocks(page):
    """A page is a list of blocks, then optional sections: each section is a heading followed by its blocks."""
    out = list(page.get('blocks', []))
    for sec in page.get('sections', []):
        if sec.get('heading'):
            h = {'type': 'heading', 'text': sec['heading']}
            if 'heading_size' in sec:
                h['size'] = sec['heading_size']
            if 'gap' in sec:
                h['gap'] = sec['gap']
            out.append(h)
        out.extend(sec.get('blocks', []))
    return out


def layout_check(checks, d, pages, page_ends):
    texts = [c for c in checks if c['kind'] in ('text', 'para')]
    M, W, H = d.margin, d.W, d.H
    problems = []
    for c in texts:
        if c['x'] < M - 2 or c['x'] + c['w'] > W - M + 3 or c['t'] < 12 or c['t'] + c['h'] > H - 12:
            problems.append({'page': c['page'], 'kind': 'out of page bounds', 'text': c['text'][:80]})
        k = c.get('container')
        if k and (c['x'] < k['x'] - 0.5 or c['x'] + c['w'] > k['x'] + k['w'] + 0.5 or c['t'] + c['h'] > k['t'] + k['h'] + 0.5):
            problems.append({'page': c['page'], 'kind': f"overflows {k['name']}", 'text': c['text'][:80]})
    for p in range(1, pages + 1):
        on = [c for c in texts if c['page'] == p]
        for i, a in enumerate(on):
            for b in on[i + 1:]:
                ix = min(a['x'] + a['w'], b['x'] + b['w']) - max(a['x'], b['x'])
                iy = min(a['t'] + a['h'], b['t'] + b['h']) - max(a['t'], b['t'])
                if ix > 1 and iy > 1:
                    problems.append({'page': p, 'kind': 'overlap', 'text': f"{a['text'][:40]} ↔ {b['text'][:40]}"})
    for p, end in page_ends.items():
        if end > d.bottom:
            problems.append({'page': p, 'kind': f'content ends at {end:.0f} pt, below the limit of {d.bottom:.0f}', 'text': ''})
    # Glyphs the font does not have would print as blanks or boxes.
    for c in texts:
        font = pdfmetrics.getFont(c['font'])
        cmap = getattr(getattr(font, 'face', None), 'charToGlyph', None)
        if cmap is None:
            continue
        plain = re.sub(r'<[^>]+>', '', c['text']).replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
        miss = sorted({ch for ch in plain if not ch.isspace() and ord(ch) not in cmap})
        if miss:
            problems.append({'page': c['page'], 'kind': f"glyphs missing in {c['font']}: {''.join(miss)}", 'text': plain[:60]})
    # Footnote markers: every ¹ used on a page has its note on that page, and every note is referenced.
    for p in range(1, pages + 1):
        body = ''.join(c['text'] for c in texts if c['page'] == p and c.get('block') != 'footnotes')
        notes = ' '.join(c['text'] for c in texts if c['page'] == p and c.get('block') == 'footnotes')
        used = set(re.findall(f'[{SUPERSCRIPTS}]+', body))
        defined = set(re.findall(f'(?:^|\\s)([{SUPERSCRIPTS}]+)\\s', notes))
        for m in sorted(used - defined):
            problems.append({'page': p, 'kind': f'footnote marker {m} has no note on its page', 'text': ''})
        for m in sorted(defined - used):
            problems.append({'page': p, 'kind': f'note {m} is never referenced on its page', 'text': ''})
    if not 2 <= pages <= 4:
        problems.append({'page': 0, 'kind': f'{pages} pages: this format reads best in 2 to 4', 'text': ''})
    return {'text_objects': len(texts), 'links': sum(1 for c in checks if c['kind'] == 'link'), 'pages': pages,
            'problems': problems, 'boxes': checks}


def build(piece, strict=False, qa=True):
    report = json.load(open(os.path.join(piece, 'report.json'), encoding='utf-8'))
    brand = load_brand(piece)
    font_dirs = [p for p in (os.environ.get('WB_FONTS_DIR'), os.path.join(piece, 'assets', 'fonts'),
                             os.path.join(BENCH, 'assets', 'fonts'), os.path.join(ROOT, 'assets', 'fonts')) if p and os.path.isdir(p)]
    d = Design(brand, font_dirs)
    if d.missing_fonts:
        spec = ' '.join(f'"{f}"' for f in d.missing_fonts)
        print(f'fonts not found: {", ".join(d.missing_fonts)} → Helvetica stands in. Fetch them: core/bin/fetch-fonts.sh {spec}', file=sys.stderr)
    meta = report.get('meta', {})
    currency = meta.get('currency', {})
    ctx = {'money': money_formatter(currency), 'currency': currency}
    out_dir = os.path.join(piece, 'renders')
    os.makedirs(os.path.join(out_dir, 'qa'), exist_ok=True)
    path = os.path.join(out_dir, meta.get('filename', 'report.pdf'))
    # Reproducible by default: the same report.json gives the same bytes (and no local clock in the metadata).
    c = canvas.Canvas(path, pagesize=(d.W, d.H), pageCompression=1, invariant=int(meta.get('reproducible', True)))
    c.setTitle(meta.get('title', ''))
    c.setAuthor(meta.get('author', brand.get('name', '')))
    c.setSubject(meta.get('subject', ''))
    c.setCreator('arn-video-workbench · pdf-report')
    checks, page_ends = [], {}
    P = Page(c, d, checks)
    total = len(report['pages'])
    for n, page in enumerate(report['pages'], 1):
        header(P, brand, meta, piece)
        t = 88
        for i, b in enumerate(page_blocks(page)):
            kind = b['type']
            if kind not in blocks.RENDER:
                sys.exit(f'page {n}, block {i + 1}: unknown type "{kind}" (types: {", ".join(blocks.RENDER)})')
            t += b.get('gap', blocks.GAPS[kind]) if i else 0
            first = len(checks)
            t += blocks.RENDER[kind](P, b, t, ctx)
            for rec in checks[first:]:
                rec['block'] = kind
        page_ends[n] = t
        footer(P, meta, n, total)
        c.showPage()
    c.save()
    result = layout_check(checks, d, total, page_ends)
    json.dump(result, open(os.path.join(out_dir, 'qa', 'layout-check.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'{path}  ({total} pages, {result["text_objects"]} text boxes, {result["links"]} links)')
    for p in result['problems']:
        print(f"  layout  page {p['page']}: {p['kind']}" + (f"  \"{p['text']}\"" if p['text'] else ''))
    bad = len(result['problems'])
    if qa:
        import qa as qa_mod
        bad += qa_mod.readback(path, checks, os.path.join(out_dir, 'qa'))
        qa_mod.pages_png(path, os.path.join(out_dir, 'qa'))
    if not bad:
        print('layout check and read-back: clean')
    return path, bad


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    _, bad = build(os.path.abspath(sys.argv[1]), strict='--strict' in sys.argv, qa='--no-qa' not in sys.argv)
    sys.exit(1 if bad and '--strict' in sys.argv else 0)
