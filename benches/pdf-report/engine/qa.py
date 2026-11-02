"""QA of a built report: read the text back out of the PDF, render the pages for review, make the poster.

A clean layout check proves the boxes fit; the read-back proves the words survived: a glyph the font lacks, a
paragraph that lost a line or text drawn under a shape all show up as strings that cannot be found again.
"""
import json
import os
import re
import unicodedata

import pypdfium2 as pdfium

SOFT = re.compile(r'[\s­​]+')


def _plain(s):
    s = re.sub(r'<br\s*/?>', ' ', s)
    s = re.sub(r'<[^>]+>', '', s).replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>').replace('&nbsp;', ' ')
    return SOFT.sub('', unicodedata.normalize('NFKC', s))


def readback(pdf_path, checks, qa_dir):
    """Extract every page's text and look for every string the builder drew. Returns the number of problems."""
    doc = pdfium.PdfDocument(pdf_path)
    pages, report = [], {'missing': [], 'links_expected': [], 'links_found': 0}
    with open(os.path.join(qa_dir, 'readback.txt'), 'w', encoding='utf-8') as fh:
        for i in range(len(doc)):
            tp = doc[i].get_textpage()
            text = tp.get_text_range()
            pages.append(SOFT.sub('', unicodedata.normalize('NFKC', text)))
            fh.write(f'===== page {i + 1} =====\n{text}\n')
            tp.close()
    doc.close()
    for c in checks:
        if c['kind'] == 'link':
            report['links_expected'].append(c['url'])
        if c['kind'] not in ('text', 'para'):
            continue
        want = _plain(c['text'])
        if want and want not in pages[c['page'] - 1]:
            report['missing'].append({'page': c['page'], 'text': c['text'][:120]})
    raw = open(pdf_path, 'rb').read()
    report['links_found'] = len(re.findall(rb'/URI\s*\(', raw))
    problems = len(report['missing']) + (report['links_found'] < len(report['links_expected']))
    json.dump(report, open(os.path.join(qa_dir, 'readback-check.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    for m in report['missing']:
        print(f"  readback page {m['page']}: not found in the extracted text \"{m['text'][:70]}\"")
    if report['links_found'] < len(report['links_expected']):
        print(f"  readback: {report['links_found']} link annotations for {len(report['links_expected'])} links drawn")
    return problems


def pages_png(pdf_path, out_dir, dpi=110):
    doc = pdfium.PdfDocument(pdf_path)
    files = []
    for i in range(len(doc)):
        img = doc[i].render(scale=dpi / 72).to_pil()
        f = os.path.join(out_dir, f'page-{i + 1}.png')
        img.save(f, optimize=True)
        files.append(f)
    doc.close()
    return files


def poster(pdf_path, out, width=540, max_kb=400):
    """Page 1 as a PNG `width` px wide; reduced to a palette if it would exceed max_kb."""
    doc = pdfium.PdfDocument(pdf_path)
    page = doc[0]
    img = page.render(scale=width / page.get_width()).to_pil().convert('RGB')
    doc.close()
    os.makedirs(os.path.dirname(out), exist_ok=True)
    img.save(out, optimize=True)
    if os.path.getsize(out) > max_kb * 1024:
        img.quantize(colors=128, dither=1).save(out, optimize=True)
    return out, os.path.getsize(out)
