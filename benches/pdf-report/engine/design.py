"""The design system of the report: page geometry, tokens from brand.json and the drawing helpers.

Coordinates are measured from the TOP of the page (t), like a layout tool, and converted to PDF space here. Every
text the helpers draw is recorded (page, box, font, size, container), so the layout check can find overflows,
collisions, text outside its card and glyphs the font does not have.
"""
import math
import os
import re

from reportlab.lib.colors import HexColor, white
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph

A4 = (595.276, 841.89)
SUPERSCRIPTS = '⁰¹²³⁴⁵⁶⁷⁸⁹'


def sup(n):
    """Footnote marker for an integer: 1 → ¹, 12 → ¹²."""
    return ''.join(SUPERSCRIPTS[int(d)] for d in str(n))


class Design:
    """Tokens: colours, fonts (four roles), radius, margins. Built from brand.json."""

    def __init__(self, brand, font_dirs):
        c = brand.get('colors', {})
        pdf = brand.get('pdf', {})
        self.brand = brand
        self.ink = HexColor(c.get('ink', '#161618'))
        self.muted = HexColor(c.get('muted', '#5E5E63'))
        self.soft = HexColor(pdf.get('soft', c.get('surface_tonal', '#F0F0F2')))
        self.zebra = HexColor(pdf.get('zebra', '#F7F7F8'))
        self.rule = HexColor(pdf.get('grid', '#EDEDEE'))
        self.accent = HexColor(c.get('accent', '#4F5BD5'))
        self.accent_ink = HexColor(c.get('accent_ink', '#FFFFFF'))
        self.positive = HexColor(c.get('positive', '#2F7D4F'))
        self.negative = HexColor(c.get('negative', '#B4432F'))
        self.on_dark_muted = HexColor(pdf.get('on_dark_muted', '#C8C8CD'))
        self.projected = HexColor(pdf.get('projected', '#85858B'))
        self.radius = min(20.0, float(pdf.get('radius', brand.get('radius', 12))))   # points
        self.margin = float(pdf.get('margin', 44))
        self.W, self.H = A4
        self.CW = self.W - 2 * self.margin
        self.bottom = float(pdf.get('content_bottom', 790))   # content must end above this (the footer sits at 808)
        self.fonts, self.missing_fonts = self._register(brand.get('fonts', {}), pdf.get('weights', {}), font_dirs)

    def _register(self, fonts, weights, dirs):
        """Four roles: Display (titles, big numbers), Title (card titles, headings, prices), Body, Bold."""
        display, body = fonts.get('display', 'Be Vietnam Pro'), fonts.get('body', 'Manrope')
        want = {'Display': (display, weights.get('display', 800)), 'Title': (display, weights.get('title', 600)),
                'Body': (body, weights.get('body', 400)), 'Bold': (body, weights.get('bold', 700))}
        fallback = {'Display': 'Helvetica-Bold', 'Title': 'Helvetica-Bold', 'Body': 'Helvetica', 'Bold': 'Helvetica-Bold'}
        out, missing = {}, []
        for role, (family, weight) in want.items():
            stem = family.replace(' ', '')
            path = next((os.path.join(d, f'{stem}-{weight}.ttf') for d in dirs if os.path.exists(os.path.join(d, f'{stem}-{weight}.ttf'))), None)
            name = f'{role}-{stem}-{weight}'
            if path:
                pdfmetrics.registerFont(TTFont(name, path))
                out[role] = name
            else:
                out[role] = fallback[role]
                missing.append(f'{family}:{weight}')
        pdfmetrics.registerFontFamily(out['Body'], normal=out['Body'], bold=out['Bold'], italic=out['Body'], boldItalic=out['Bold'])
        return out, sorted(set(missing))

    def font(self, role):
        return self.fonts[role]


class Page:
    """Drawing helpers bound to a canvas and the design. Every text call is recorded in self.checks."""

    def __init__(self, canvas, design, checks):
        self.c, self.d, self.checks = canvas, design, checks
        self.container = None   # (x, t, w, h, name): texts drawn now must fit inside it

    # -- geometry
    @property
    def n(self):
        return self.c.getPageNumber()

    def y(self, t):
        return self.d.H - t

    def record(self, x, t, w, h, s, font, size, kind='text'):
        self.checks.append({'page': self.n, 'x': round(x, 2), 't': round(t, 2), 'w': round(w, 2), 'h': round(h, 2), 'text': s,
                            'font': font, 'size': size, 'kind': kind, 'container': self.container})

    # -- shapes
    def rect(self, x, t, w, h, color, r=None):
        self.c.setFillColor(color)
        r = self.d.radius if r is None else r
        if r:
            self.c.roundRect(x, self.d.H - t - h, w, h, r, fill=1, stroke=0)
        else:
            self.c.rect(x, self.d.H - t - h, w, h, fill=1, stroke=0)

    # -- text
    def width(self, s, size, font='Body'):
        return pdfmetrics.stringWidth(s, self.d.font(font), size)

    def text(self, x, t, s, size=10, font='Body', color=None):
        f = self.d.font(font)
        self.c.setFillColor(color or self.d.ink)
        self.c.setFont(f, size)
        self.c.drawString(x, self.d.H - t - size, s)
        self.record(x, t, pdfmetrics.stringWidth(s, f, size), size, s, f, size)
        return pdfmetrics.stringWidth(s, f, size)

    def right(self, x, t, s, size=10, font='Body', color=None):
        return self.text(x - self.width(s, size, font), t, s, size, font, color)

    def fit_text(self, x, t, s, size, max_w, font='Display', color=None, min_size=None):
        """One line that shrinks (down to min_size) until it fits max_w; returns the size used."""
        min_size = min_size or size * 0.7
        while self.width(s, size, font) > max_w and size > min_size:
            size -= 0.5
        self.text(x, t, s, size, font, color)
        return size

    def para(self, x, t, w, s, size=10, leading=None, color=None, font='Body', align=0, measure=False):
        """A wrapped paragraph (mini-markup: <b>, <br/>); returns its height. measure=True only measures."""
        st = ParagraphStyle('p', fontName=self.d.font(font), fontSize=size, leading=leading or size * 1.45,
                            textColor=color or self.d.ink, spaceAfter=0, alignment=align)
        p = Paragraph(s, st)
        _, ph = p.wrap(w, 10000)
        if not measure:
            p.drawOn(self.c, x, self.d.H - t - ph)
            self.record(x, t, w, ph, s, self.d.font(font), size, kind='para')
        return ph

    def link(self, x, t, label, url, size=8):
        w = self.text(x, t, label, size, 'Body', self.d.muted)
        self.c.linkURL(url, (x, self.d.H - t - size - 2, x + w, self.d.H - t + 2), relative=0)
        self.checks.append({'page': self.n, 'kind': 'link', 'url': url, 'text': label, 'x': x, 't': t, 'w': w, 'h': size})
        return w

    def image(self, path, x, t, w=None, h=None):
        img = ImageReader(path)
        iw, ih = img.getSize()
        if w is None:
            w = h * iw / ih
        if h is None:
            h = w * ih / iw
        self.c.drawImage(img, x, self.d.H - t - h, width=w, height=h, mask='auto')
        return w, h


def money_formatter(cur):
    """Currency formatting from report.meta.currency: {symbol, thousands, decimal, decimals, position, space}."""
    symbol = cur.get('symbol', '$')
    thousands, decimal = cur.get('thousands', ','), cur.get('decimal', '.')
    decimals = int(cur.get('decimals', 0))
    suffix = cur.get('position', 'prefix') == 'suffix'
    space = ' ' if cur.get('space', suffix) else ''

    def money(n):
        v = math.floor(abs(n) * 10 ** decimals + 0.5) / 10 ** decimals
        s = f'{v:,.{decimals}f}'.replace(',', '\0').replace('.', decimal).replace('\0', thousands)
        s = (s + space + symbol) if suffix else (symbol + space + s)
        return ('−' if n < 0 else '') + s
    return money


def number_formatter(cur):
    thousands = cur.get('thousands', ',')
    return lambda n: f'{n:,.0f}'.replace(',', thousands) if isinstance(n, (int, float)) else str(n)


TEMPLATE = re.compile(r'\{(total|sum)(?:\s*\*\s*([\d.]+))?\}')


def fill_template(s, total, money):
    """'Budget with a 25% reserve: {total*1.25}' → the amount, formatted."""
    return TEMPLATE.sub(lambda m: money(total * float(m.group(2) or 1)), s)
