"""Block renderers. Each draws at the top position t and returns the height it used.

Block types (keys of report.json → pages[].blocks[]):
  title       { text, size }                                   display title, one line, shrinks to fit
  lead        { text }                                         muted lead paragraph
  heading     { text, size }                                   section heading
  paragraph   { text, size, muted }                            body text with <b>…</b> and <br/>
  metrics     { items: [{ value, label, note }] }              soft rounded band with 2–4 KPIs; note → ¹ marker
  comparison  { cards: [{ theme: dark|light, title, price, unit, meta, items: [{ title, detail, price }], footer }] }
  table       { columns: [{ label, width, align, format: money|raw }], groups: [{ label, from, to }], rows, zebra,
                band_from (rows from here on a soft band: projections), bold_rows, compact, row_height, size, header_ink }
  columns     { items: [{ title, body }] }                     three (or two, or four) short columns
  chart       { labels, values, projected_from, y_max, grid, caption_left, caption_right, height }
  footnotes   { items: ["¹ …", "² …"] }                         small muted notes
  note        { text }                                         small muted paragraph
  sources     { label, links: [{ label, url }] }                clickable links in one row
  spacer      { height }
Every block also takes `gap` (space above it, in points).
"""
from reportlab.lib.colors import white

from design import fill_template, number_formatter, sup

GAPS = {'title': 0, 'lead': 12, 'heading': 26, 'paragraph': 14, 'metrics': 20, 'comparison': 20, 'table': 14,
        'columns': 12, 'chart': 20, 'footnotes': 14, 'note': 10, 'sources': 10, 'spacer': 0}


def _container(P, x, t, w, h, name):
    P.container = {'x': x, 't': t, 'w': w, 'h': h, 'name': name}


def title(P, b, t, ctx):
    size = P.fit_text(P.d.margin, t, b['text'], b.get('size', 26), P.d.CW, 'Display', min_size=18)
    return size * 1.15


def lead(P, b, t, ctx):
    return P.para(P.d.margin, t, P.d.CW, b['text'], b.get('size', 11), b.get('leading', 16), P.d.muted)


def heading(P, b, t, ctx):
    size = b.get('size', 14)
    P.fit_text(P.d.margin, t, b['text'], size, P.d.CW, 'Title')
    return size * 1.2


def paragraph(P, b, t, ctx):
    size = b.get('size', 10.2)
    return P.para(P.d.margin, t, b.get('width', P.d.CW), b['text'], size, b.get('leading', size * 1.47), P.d.muted if b.get('muted') else None)


def metrics(P, b, t, ctx):
    d, items = P.d, b['items']
    n = len(items)
    colw = d.CW / n
    label_size = b.get('label_size', 8.2)
    labels = [it['label'] + (sup(it['note']) if it.get('note') else '') for it in items]
    lh = max(P.para(0, 0, colw - 19, s, label_size, label_size * 1.34, measure=True) for s in labels)
    h = max(67, 44 + lh + 8)
    P.rect(d.margin, t, d.CW, h, d.soft)
    for i, (it, label) in enumerate(zip(items, labels)):
        x = d.margin + 15 + i * colw
        _container(P, x - 4, t, colw - 11, h, f'metric {i + 1}')
        P.fit_text(x, t + 11, str(it['value']), b.get('value_size', 21), colw - 19, 'Display', min_size=14)
        P.para(x, t + 44, colw - 19, label, label_size, label_size * 1.34, d.muted)
    P.container = None
    return h


def comparison(P, b, t, ctx):
    d, money = P.d, ctx['money']
    cards = b['cards']
    gap = b.get('gutter', 16)
    cw = (d.CW - gap * (len(cards) - 1)) / len(cards)
    pad = 17
    # Measure every card first: they share one height.
    plans = []
    for card in cards:
        rows, y = [], 120
        for it in card.get('items', []):
            ph = P.para(0, 0, cw - 2 * pad, it.get('detail', ''), 7.7, 9.5, measure=True) if it.get('detail') else 0
            step = max(29, 13 + ph + 7)
            rows.append((y, it, step))
            y += step
        plans.append((card, rows, y))
    h = max(y for _, _, y in plans) + (34 if any(c.get('footer') for c in cards) else 8)
    for j, (card, rows, _) in enumerate(plans):
        x = d.margin + j * (cw + gap)
        dark = card.get('theme', 'light') == 'dark'
        bg, fg, sub = (d.ink, white, d.on_dark_muted) if dark else (d.soft, d.ink, d.muted)
        P.rect(x, t, cw, h, bg)
        _container(P, x, t, cw, h, f'card {card.get("title", j + 1)}')
        total = sum(float(it.get('price', 0)) for it in card.get('items', []))
        price = total if card.get('price', 'sum') == 'sum' else float(card['price'])
        P.fit_text(x + pad, t + 16, card.get('title', ''), 18, cw - 2 * pad, 'Title', fg)
        pw = P.fit_text(x + pad, t + 46, money(price), 31, cw * 0.62, 'Display', fg)
        if card.get('unit'):
            P.text(x + pad + P.width(money(price), pw, 'Display') + 10, t + 68, card['unit'], 8.5, 'Body', sub)
        if card.get('meta'):
            P.fit_text(x + pad, t + 89, card['meta'], 8.4, cw - 2 * pad, 'Body', sub)
        for y, it, step in rows:
            pr = money(float(it['price'])) if 'price' in it else ''
            prw = P.width(pr, 9.8, 'Title')
            P.fit_text(x + pad, t + y, it['title'], 9.1, cw - 2 * pad - prw - 12, 'Bold', fg)
            if pr:
                P.right(x + cw - pad, t + y, pr, 9.8, 'Title', fg)
            if it.get('detail'):
                P.para(x + pad, t + y + 13, cw - 2 * pad, it['detail'], 7.7, 9.5, sub)
        if card.get('footer'):
            P.fit_text(x + pad, t + h - 26, fill_template(card['footer'], price, money), 8.4, cw - 2 * pad, 'Bold', fg)
    P.container = None
    return h


def _cell(v, col, money, number):
    fmt = col.get('format')
    if isinstance(v, (int, float)):
        return money(v) if fmt == 'money' else number(v) if fmt != 'raw' else str(v)
    return str(v)


def table(P, b, t, ctx):
    d, money, number = P.d, ctx['money'], number_formatter(ctx['currency'])
    cols = b['columns']
    size = b.get('size', 10.2 if not b.get('compact') else 8.5)
    rh = b.get('row_height', 33 if not b.get('compact') else 15.8)
    # Column edges: widths are fractions of the content width (default: equal).
    widths = [c.get('width', 1) for c in cols]
    edges, x = [], d.margin
    for w in widths:
        edges.append(x)
        x += d.CW * w / sum(widths)
    edges.append(d.margin + d.CW)
    y = t
    head = b.get('header_size', 9 if not b.get('compact') else 8.3)
    if b.get('groups'):
        for g in b['groups']:   # centred over the columns it spans
            gx = (edges[g['from']] + edges[g['to'] + 1]) / 2 - P.width(g['label'], head, 'Bold') / 2
            P.text(gx, y, g['label'], head, 'Bold')
        y += head + 12
    hc = d.ink if b.get('header_ink') else d.muted
    for i, c in enumerate(cols):
        if c.get('align') == 'right':
            P.right(edges[i + 1] - 12, y, c['label'], head, 'Bold', hc)
        else:
            P.text(edges[i] + 12, y, c['label'], head, 'Bold', hc)
    y += head + (14 if not b.get('compact') else 8)
    bold = set(b.get('bold_rows', []))
    band = b.get('band_from')
    for r, row in enumerate(b['rows']):
        if band is not None and r >= band:
            P.rect(d.margin, y, d.CW, rh, d.soft, 0)
        elif b.get('zebra', True) and r % 2 == 0:
            P.rect(d.margin, y, d.CW, rh, d.soft if not b.get('compact') else d.zebra, b.get('zebra_radius', 8 if not b.get('compact') else 0))
        ty = y + (rh - size) / 2 - 0.5
        for i, (v, c) in enumerate(zip(row, cols)):
            s = _cell(v, c, money, number)
            font = 'Bold' if r in bold or (i == 0 and b.get('bold_first')) else ('Title' if c.get('format') == 'money' and not b.get('compact') else 'Body')
            _container(P, edges[i], y, edges[i + 1] - edges[i], rh, f'cell r{r + 1}c{i + 1}')
            if c.get('align') == 'right':
                P.right(edges[i + 1] - 12, ty, s, size, font)
            else:
                P.text(edges[i] + 12, ty, s, size, font)
        y += rh + (2 if not b.get('compact') else 0)
    P.container = None
    return y - t


def columns(P, b, t, ctx):
    d = P.d
    items = b['items']
    n = len(items)
    gut = b.get('gutter', 15)
    w = (d.CW - gut * (n - 1)) / n
    h = 0
    for i, it in enumerate(items):
        x = d.margin + i * (w + gut)
        _container(P, x, t, w, 400, f'column {i + 1}')
        P.fit_text(x, t, it['title'], 9.2, w, 'Bold')
        h = max(h, 17 + P.para(x, t + 17, w, it['body'], 8.5, 12, d.muted))
    P.container = None
    return h


def chart(P, b, t, ctx):
    """Line chart: observed points solid, projected points dashed and grey, a value over every point."""
    d, c = P.d, P.c
    labels, values = b['labels'], b['values']
    split = b.get('projected_from', len(values))
    ymax = b.get('y_max', max(values) * 1.15)
    height = b.get('height', 80)
    x0, w = d.margin + 14, d.CW - 28
    top = t + 20
    if b.get('caption_left'):
        P.text(d.margin, t, b['caption_left'], 7.8, 'Bold', d.muted)
    if b.get('caption_right'):
        P.right(d.margin + d.CW, t, b['caption_right'], 7.6, 'Body', d.muted)
    bottom_pdf = d.H - top - height
    xs = [x0 + i * w / (len(values) - 1) for i in range(len(values))]
    ys = [bottom_pdf + v / ymax * height for v in values]
    c.setStrokeColor(d.rule)
    c.setLineWidth(0.7)
    for g in b.get('grid', []):
        gy = bottom_pdf + g / ymax * height
        c.line(x0, gy, x0 + w, gy)
    c.setStrokeColor(d.ink)
    c.setLineWidth(2.0)
    p = c.beginPath()
    p.moveTo(xs[0], ys[0])
    for i in range(1, min(split, len(values))):
        p.lineTo(xs[i], ys[i])
    c.drawPath(p)
    if split < len(values):
        c.setDash(4, 3)
        c.setStrokeColor(d.projected)
        p = c.beginPath()
        p.moveTo(xs[split - 1], ys[split - 1])
        for i in range(split, len(values)):
            p.lineTo(xs[i], ys[i])
        c.drawPath(p)
        c.setDash()
    fmt = b.get('value_format')
    for i, (x, y) in enumerate(zip(xs, ys)):
        observed = i < split
        c.setFillColor(d.ink if observed else d.projected)
        c.circle(x, y, 2.7, fill=1, stroke=0)
        label = (ctx['money'](values[i]) if fmt == 'money' else number_formatter(ctx['currency'])(values[i]))
        P.right(x + 4, d.H - y - 17, label, 8, 'Bold', d.ink if observed else d.muted)
        P.text(x - P.width(labels[i], 7.8) / 2, top + height + 7, labels[i], 7.8, 'Body', d.muted)
    return 20 + height + 7 + 10


def footnotes(P, b, t, ctx):
    text = '  '.join(b['items']) if b.get('inline', True) else '<br/>'.join(b['items'])
    return P.para(P.d.margin, t, P.d.CW, text, b.get('size', 8.4), b.get('leading', 12), P.d.muted)


def note(P, b, t, ctx):
    return P.para(P.d.margin, t, P.d.CW, b['text'], b.get('size', 8.3), b.get('leading', 11.5), P.d.muted)


def sources(P, b, t, ctx):
    x = P.d.margin
    size = b.get('size', 7.6)
    if b.get('label'):
        x += P.text(x, t, b['label'], size, 'Bold', P.d.muted) + 8
    for ln in b['links']:
        x += P.link(x, t, ln['label'], ln['url'], size) + 15
    return size + 2


def spacer(P, b, t, ctx):
    return b.get('height', 10)


RENDER = {'title': title, 'lead': lead, 'heading': heading, 'paragraph': paragraph, 'metrics': metrics,
          'comparison': comparison, 'table': table, 'columns': columns, 'chart': chart, 'footnotes': footnotes,
          'note': note, 'sources': sources, 'spacer': spacer}
