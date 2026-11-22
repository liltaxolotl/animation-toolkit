"""
animtk.layers
The app's vector overlay format (Vec in app/js/shot.js), drawn in Python. A Claude can make the same redlines and
guide layers the app makes, at the drawing's exact pixel size. Line widths, arrow heads, dashes, fills and the white
halo behind text follow the app's canvas code, so a layer looks the same whichever side drew it
(tests/test_app_redline.mjs renders the same layers in Chrome and compares them pixel by pixel).

    from animtk import layers as LY
    doc, warnings = LY.normalize(json_text_or_object, W, H)   # any accepted shape, scaled to a W x H drawing
    img = LY.render(doc['layers'], W, H)                      # transparent RGBA PIL image, W x H
    LY.draw(rgba_image, doc['layers'])                        # or draw onto an RGBA image you already have

The format (what Claude hands back, and what the app and redline.py save next to every redline version):
  {"kind": "animtk-redline", "version": 1, "W": 3840, "H": 1920, "layers": [layer, ...]}
  layer: {id, name, color, opacity (0 to 100), visible, items: [...]}, coordinates in the drawing's own pixels
  items: line {a, b} | arrow {a, b} | poly {pts, closed} | circle {c, r} | ellipse {c, rx, ry, rot (degrees)}
         | rect {a, b} | text {at, text, size} | pin {from, to} (a warp pin: where a bit of linework should move)
  optional on any item: color, w (line width in px at 3840 wide), dash [on, off], fill
  Red #e8202a = fixes, blue #2f6bff = construction.
W and H say what size of picture the coordinates were written for. When that is not the drawing's size (Claude
often sees a smaller copy) every coordinate is scaled to fit, and W 1, H 1 means the coordinates are fractions.
Widths, dashes and text sizes are already relative to the drawing's width, so scaling leaves them alone.
Also accepted, for a quick note: a list of layers, one layer ({items: [...]}), a list of items, or one item.
JSON wrapped in a ```json fence, or with a sentence before it, is fine too. The app's twin of normalize() is
parseDoc() in app/js/redline-tab.mjs; tests check that both give the same document.
"""
import json, math, re
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont, ImageColor, ImageFilter

W0 = 3840
RED, BLUE = '#e8202a', '#2f6bff'
KIND = 'animtk-redline'
TYPES = ('line', 'arrow', 'poly', 'circle', 'ellipse', 'rect', 'text', 'pin')
NEEDS = {'line': ('a', 'b'), 'arrow': ('a', 'b'), 'rect': ('a', 'b'), 'pin': ('from', 'to'), 'poly': ('pts',),
         'circle': ('c', 'r'), 'ellipse': ('c', 'rx', 'ry'), 'text': ('at', 'text')}
POINT_KEYS = ('a', 'b', 'from', 'to', 'c', 'at')
_SH = 4                     # sub-pixel bits for OpenCV's anti-aliased fills
_ONE = 1 << _SH
_FAR = 1e7                  # coordinates are clamped to this, far past any drawing


# ------------------------------------------------------------------ colours
def color(s):
    """CSS colour -> (r, g, b, a) with a from 0 to 1, or None when a browser would not read it either"""
    if not isinstance(s, str) or not s.strip():
        return None
    s = s.strip().lower()
    if s.startswith('#'):
        h = s[1:]
        if not re.fullmatch(r'[0-9a-f]+', h or 'x'):
            return None
        if len(h) in (3, 4):
            h = ''.join(ch * 2 for ch in h)
        if len(h) not in (6, 8):
            return None
        v = [int(h[i:i + 2], 16) for i in range(0, len(h), 2)]
        return (v[0], v[1], v[2], v[3] / 255 if len(v) == 4 else 1.0)
    m = re.fullmatch(r'rgba?\(([^)]*)\)', s)
    if m:
        parts = [p for p in re.split(r'[\s,/]+', m.group(1).strip()) if p]
        if len(parts) not in (3, 4):
            return None
        try:
            ch = lambda p: float(p[:-1]) * 2.55 if p.endswith('%') else float(p)
            r, g, b = (int(max(0, min(255, round(ch(p))))) for p in parts[:3])
            a = 1.0 if len(parts) == 3 else (float(parts[3][:-1]) / 100 if parts[3].endswith('%') else float(parts[3]))
        except ValueError:
            return None
        return (r, g, b, max(0.0, min(1.0, a)))
    if s == 'transparent':
        return (0, 0, 0, 0.0)
    try:
        r, g, b = ImageColor.getrgb(s)[:3]
        return (r, g, b, 1.0)
    except ValueError:
        return None


# ------------------------------------------------------------------ reading a document
def _num(v):
    if isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _point(p):
    """[x, y] or {"x": .., "y": ..} -> [x, y], or None"""
    if isinstance(p, dict):
        p = [p.get('x'), p.get('y')]
    if not isinstance(p, (list, tuple)) or len(p) < 2:
        return None
    x, y = _num(p[0]), _num(p[1])
    return None if x is None or y is None else [x, y]


def _loads(text):
    """JSON from Claude's reply: strips a ```json fence and any words before the first { or ["""
    t = text.strip()
    fence = re.search(r'```(?:json)?\s*([\s\S]*?)```', t)
    if fence:
        t = fence.group(1).strip()
    try:
        return json.loads(t)
    except ValueError:
        starts = [i for i in (t.find('{'), t.find('[')) if i >= 0]
        if not starts:
            raise ValueError('no JSON found (it should start with { or [)')
        i = min(starts)
        j = max(t.rfind('}'), t.rfind(']'))
        return json.loads(t[i:j + 1])


def _item(it, where, warn):
    if not isinstance(it, dict):
        warn('%s is not an item, skipped' % where)
        return None
    t = it.get('t', it.get('type'))
    if t not in TYPES:
        warn('%s has an unknown type %r, skipped (known: %s)' % (where, t, ', '.join(TYPES)))
        return None
    out = {'t': t}
    for k in POINT_KEYS:
        if k in it:
            p = _point(it[k])
            if p is not None:
                out[k] = p
    if 'pts' in it and isinstance(it['pts'], (list, tuple)):
        pts = [_point(p) for p in it['pts']]
        out['pts'] = [p for p in pts if p is not None]
    for k in ('r', 'rx', 'ry', 'rot', 'w', 'size'):
        if k in it and _num(it[k]) is not None:
            out[k] = _num(it[k])
    if 'text' in it and it['text'] is not None:
        out['text'] = str(it['text'])
    if 'closed' in it:
        out['closed'] = bool(it['closed'])
    if 'dash' in it and isinstance(it['dash'], (list, tuple)):
        d = [_num(v) for v in it['dash']]
        if d and all(v is not None and v >= 0 for v in d):
            out['dash'] = d
        else:
            warn('%s: dash should be two numbers like [18, 12], ignored' % where)
    for k in ('color', 'fill'):
        if k in it and it[k] not in (None, '', False):
            if color(it[k]) is None:
                warn('%s: %s %r is not a colour, ignored' % (where, k, it[k]))
            else:
                out[k] = it[k]
    if 'note' in it and it['note'] is not None:
        out['note'] = str(it['note'])                 # free text for people; the drawing code ignores it
    missing = [k for k in NEEDS[t] if k not in out]
    if t == 'poly' and len(out.get('pts', [])) < 2:
        missing.append('two or more pts')
    if t == 'text' and not out.get('text'):
        missing.append('text')
    if missing:
        warn('%s (%s) is missing %s, skipped' % (where, t, ', '.join(dict.fromkeys(missing))))
        return None
    for k in ('r', 'rx', 'ry'):
        if k in out and out[k] < 0:
            out[k] = -out[k]
    return out


def normalize(obj, W=None, H=None):
    """any accepted shape (JSON text or already parsed) -> (doc, warnings).
    With W and H (the drawing's size) every coordinate is scaled from the document's own W x H."""
    warns = []
    warn = warns.append
    if isinstance(obj, (bytes, bytearray)):
        obj = obj.decode('utf-8-sig')
    if isinstance(obj, str):
        obj = _loads(obj)
    looks_item = lambda o: isinstance(o, dict) and ('t' in o or 'type' in o) and 'items' not in o
    if isinstance(obj, dict) and isinstance(obj.get('layers'), list):
        raw_layers, dW, dH = obj['layers'], _num(obj.get('W')), _num(obj.get('H'))
    elif isinstance(obj, dict) and isinstance(obj.get('items'), list):
        raw_layers, dW, dH = [obj], _num(obj.get('W')), _num(obj.get('H'))
    elif isinstance(obj, list) and obj and all(looks_item(o) for o in obj):
        raw_layers, dW, dH = [{'name': 'Fixes', 'color': RED, 'items': obj}], None, None
    elif isinstance(obj, list):
        raw_layers, dW, dH = obj, None, None
    elif looks_item(obj):
        raw_layers, dW, dH = [{'name': 'Fixes', 'color': RED, 'items': [obj]}], None, None
    else:
        raise ValueError('this does not look like redline marks: expected {"kind": "%s", "layers": [...]}' % KIND)
    layers = []
    for li, L in enumerate(raw_layers, 1):
        if not isinstance(L, dict):
            warn('layer %d is not a layer, skipped' % li)
            continue
        name = str(L.get('name') or 'Layer %d' % li)
        col = L.get('color')
        if col is not None and color(col) is None:
            warn('layer %r: colour %r is not a colour, using red' % (name, col))
            col = None
        op = _num(L.get('opacity'))
        lay = {'id': str(L.get('id') or 'L%d' % li), 'name': name, 'color': col or RED,
               'opacity': 100 if op is None else max(0.0, min(100.0, op)), 'visible': L.get('visible') is not False,
               'items': []}
        for ii, it in enumerate(L.get('items') or [], 1):
            n = _item(it, 'layer %r item %d' % (name, ii), warn)
            if n:
                lay['items'].append(n)
        layers.append(lay)
    doc = {'kind': KIND, 'version': 1, 'W': dW, 'H': dH, 'layers': layers}
    for k in ('source', 'made', 'fade', 'note'):
        if isinstance(obj, dict) and k in obj:
            doc[k] = obj[k]
    if W and H:
        doc = scale(doc, W, H, warn)
    return doc, warns


def scale(doc, W, H, warn=None):
    """the same marks on a W x H drawing. A document without W and H is taken to be in the drawing's pixels."""
    dW, dH = doc.get('W'), doc.get('H')
    out = dict(doc, W=W, H=H)
    if not dW or not dH or (abs(dW - W) < 1e-9 and abs(dH - H) < 1e-9):
        return out
    sx, sy = W / dW, H / dH
    if warn and abs(sx / sy - 1) > 0.01:
        warn('the marks were written for a %g x %g picture and this drawing is %d x %d, so they were stretched '
             'to fit: check they land where they should' % (dW, dH, W, H))
    sp = lambda p: [p[0] * sx, p[1] * sy]
    layers = []
    for L in doc['layers']:
        items = []
        for it in L['items']:
            n = dict(it)
            for k in POINT_KEYS:
                if k in n:
                    n[k] = sp(n[k])
            if 'pts' in n:
                n['pts'] = [sp(p) for p in n['pts']]
            if 'r' in n:
                n['r'] = n['r'] * (sx + sy) / 2
            if 'rx' in n:
                n['rx'] = n['rx'] * sx
            if 'ry' in n:
                n['ry'] = n['ry'] * sy
            items.append(n)
        layers.append(dict(L, items=items))
    out['layers'] = layers
    return out


def doc_from_items(items, W, H, name='Fixes', color_=RED, layer_id='fixes'):
    """hook for code that works out WHAT to mark (perspective drift, critique notes): wrap Vec items as a document"""
    return {'kind': KIND, 'version': 1, 'W': W, 'H': H,
            'layers': [{'id': layer_id, 'name': name, 'color': color_, 'opacity': 100, 'visible': True, 'items': list(items)}]}


# ------------------------------------------------------------------ drawing
class _Op:
    """coverage of one canvas operation (one stroke or one fill), kept only over its bounding box.
    Strokes are measured, not filled: each pixel's coverage comes from its distance to the path, the way a canvas
    anti-aliases a round-capped line. Fills are drawn at up to 4 x 4 samples a pixel and averaged. (OpenCV's own
    anti-aliased fill grows every edge by about a pixel, which made lines visibly fatter than the app's.)"""
    def __init__(self, W, H, xs, ys, pad):
        self.x0 = max(0, int(math.floor(min(xs) - pad)) - 2)
        self.y0 = max(0, int(math.floor(min(ys) - pad)) - 2)
        x1 = min(W, int(math.ceil(max(xs) + pad)) + 3)
        y1 = min(H, int(math.ceil(max(ys) + pad)) + 3)
        self.ok = x1 > self.x0 and y1 > self.y0
        self.box = (self.x0 - pad - 2, self.y0 - pad - 2, x1 + pad + 2, y1 + pad + 2)
        self.m = np.zeros((y1 - self.y0, x1 - self.x0), np.uint8) if self.ok else None

    def poly(self, pts):
        if len(pts) < 3:
            return
        h, w = self.m.shape
        a = np.clip(np.asarray(pts, np.float64), -_FAR, _FAR) - (self.x0, self.y0)
        lo, hi = a.min(0), a.max(0)                      # only the part of the box the shape covers
        bx0, by0 = max(0, int(math.floor(lo[0])) - 1), max(0, int(math.floor(lo[1])) - 1)
        bx1, by1 = min(w, int(math.ceil(hi[0])) + 2), min(h, int(math.ceil(hi[1])) + 2)
        if bx1 <= bx0 or by1 <= by0:
            return
        area = (bx1 - bx0) * (by1 - by0)
        F = 4 if area * 16 <= 24e6 else 2 if area * 4 <= 24e6 else 1
        sub = np.zeros(((by1 - by0) * F, (bx1 - bx0) * F), np.uint8)
        # a sample counts when its centre is inside: canvas x maps to sample (x * F - 0.5)
        q = np.round(((a - (bx0, by0)) * F - 0.5) * _ONE).astype(np.int32)
        cv2.fillPoly(sub, [q], 255, cv2.LINE_8, _SH)
        cov = sub.reshape(by1 - by0, F, bx1 - bx0, F).mean(axis=(1, 3)) if F > 1 else sub
        win = self.m[by0:by1, bx0:bx1]
        np.maximum(win, np.round(cov).astype(np.uint8), out=win)

    def stroke(self, runs, hw):
        h, w = self.m.shape
        r = hw + 1.0
        for run in runs:
            segs = list(zip(run, run[1:])) or [(run[0], run[0])]
            for p, q in segs:
                seg = _clip(p, q, self.box) if (p[0], p[1]) != (q[0], q[1]) else (p, q)
                if seg is None:
                    continue
                (px, py), (qx, qy) = seg
                px, py, qx, qy = px - self.x0, py - self.y0, qx - self.x0, qy - self.y0
                bx0, by0 = max(0, int(math.floor(min(px, qx) - r))), max(0, int(math.floor(min(py, qy) - r)))
                bx1, by1 = min(w, int(math.ceil(max(px, qx) + r)) + 1), min(h, int(math.ceil(max(py, qy) + r)) + 1)
                if bx1 <= bx0 or by1 <= by0:
                    continue
                X = np.arange(bx0, bx1, dtype=np.float32)[None, :] + 0.5 - px
                Y = np.arange(by0, by1, dtype=np.float32)[:, None] + 0.5 - py
                dx, dy = qx - px, qy - py
                L2 = dx * dx + dy * dy
                if L2 > 1e-12:
                    t = np.clip((X * dx + Y * dy) / L2, 0, 1)
                    d = np.hypot(X - t * dx, Y - t * dy)
                else:
                    d = np.hypot(X, Y)
                cov = np.clip(hw + 0.5 - d, 0, 1) * 255
                win = self.m[by0:by1, bx0:bx1]
                np.maximum(win, np.round(cov).astype(np.uint8), out=win)


def _clip(p, q, box):
    """Liang-Barsky: the part of segment p-q inside box (x0, y0, x1, y1), or None"""
    x0, y0, x1, y1 = box
    dx, dy = q[0] - p[0], q[1] - p[1]
    t0, t1 = 0.0, 1.0
    for pp, qq in ((-dx, p[0] - x0), (dx, x1 - p[0]), (-dy, p[1] - y0), (dy, y1 - p[1])):
        if pp == 0:
            if qq < 0:
                return None
            continue
        t = qq / pp
        if pp < 0:
            t0 = max(t0, t)
        else:
            t1 = min(t1, t)
        if t0 > t1:
            return None
    return (p[0] + t0 * dx, p[1] + t0 * dy), (p[0] + t1 * dx, p[1] + t1 * dy)


def _ring(c, rx, ry, rot, step=4.0, lo=24, hi=1440):
    """points round an ellipse (the canvas path starts at angle 0 and runs clockwise on screen)"""
    n = int(max(lo, min(hi, math.ceil(2 * math.pi * max(rx, ry, 1e-9) / step))))
    cr, sr = math.cos(rot), math.sin(rot)
    out = []
    for i in range(n):
        t = 2 * math.pi * i / n
        x, y = rx * math.cos(t), ry * math.sin(t)
        out.append((c[0] + x * cr - y * sr, c[1] + x * sr + y * cr))
    return out


def _dash(d, k):
    """the canvas rules: bad values mean solid, an odd list is doubled, all zeros is solid"""
    if not d:
        return None
    try:
        v = [float(x) * k for x in d]
    except (TypeError, ValueError):
        return None
    if any(not math.isfinite(x) or x < 0 for x in v) or sum(v) <= 0:
        return None
    return v * 2 if len(v) % 2 else v


def _runs(seq, dash):
    """a polyline cut into the dashes the canvas would draw (the pattern carries on round corners)"""
    if not dash:
        return [seq]
    runs, cur, i, left, on = [], None, 0, dash[0], True
    lerp = lambda p, q, f: (p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f)
    for p, q in zip(seq, seq[1:]):
        L = math.hypot(q[0] - p[0], q[1] - p[1])
        if L <= 0:
            continue
        t = 0.0
        while t < L - 1e-9:
            step = min(left, L - t)
            if on:
                if cur is None:
                    cur = [lerp(p, q, t / L)]
                cur.append(lerp(p, q, (t + step) / L))
            t += step
            left -= step
            if left <= 1e-9:
                if on and cur is not None:
                    runs.append(cur)
                    cur = None
                i = (i + 1) % len(dash)
                left, on = dash[i], not on
    if cur is not None:
        runs.append(cur)
    return runs


_FONTS = {}


def _font(size):
    key = round(size * 4) / 4
    if key not in _FONTS:
        f = None
        for n in ('seguisb.ttf', 'segoeuib.ttf', 'arialbd.ttf', 'DejaVuSans-Bold.ttf'):   # Segoe UI Semibold = the app's 600
            try:
                f = ImageFont.truetype(n, max(1.0, key))
                break
            except OSError:
                pass
        _FONTS[key] = f or ImageFont.load_default(max(1.0, key))
    return _FONTS[key]


def _paint(img, m, x0, y0, rgba, g):
    al = rgba[3] * g
    if al <= 0 or m is None or not m.any():
        return
    patch = np.empty(m.shape + (4,), np.uint8)
    patch[..., 0], patch[..., 1], patch[..., 2] = rgba[0], rgba[1], rgba[2]
    patch[..., 3] = np.clip(np.round(m.astype(np.float32) * al), 0, 255).astype(np.uint8)
    img.alpha_composite(Image.fromarray(patch, 'RGBA'), dest=(x0, y0))


def _text(img, it, rgba, g, k):
    s = (it.get('size') or 34) * k
    text = it['text']
    x, y = it['at']
    f = _font(s)
    sw = s * 0.11                                         # the app strokes the halo at 0.22 x the size
    try:
        box = f.getbbox(text, anchor='ls', stroke_width=sw)
    except TypeError:
        sw = max(1, round(sw))
        box = f.getbbox(text, anchor='ls', stroke_width=sw)
    W, H = img.size
    x0, y0 = max(0, int(math.floor(x + box[0])) - 3), max(0, int(math.floor(y + box[1])) - 3)
    x1, y1 = min(W, int(math.ceil(x + box[2])) + 3), min(H, int(math.ceil(y + box[3])) + 3)
    if x1 <= x0 or y1 <= y0:
        return
    at = (x - x0, y - y0)

    def mask(stroke):
        im = Image.new('L', (x1 - x0, y1 - y0), 0)
        ImageDraw.Draw(im).text(at, text, fill=255, font=f, anchor='ls', stroke_width=stroke, stroke_fill=255)
        return im
    glyph = mask(0)
    dil = np.asarray(mask(sw), np.int16)
    e = int(round(sw))
    ero = np.asarray(glyph.filter(ImageFilter.MinFilter(2 * e + 1)) if e >= 1 else glyph, np.int16)
    band = np.clip(dil - ero, 0, 255).astype(np.uint8)
    _paint(img, band, x0, y0, (255, 255, 255, 0.92), g)
    _paint(img, np.asarray(glyph), x0, y0, rgba, g)


def _item_draw(img, it, layer_color, k, g):
    W, H = img.size
    col = color(it.get('color')) or color(layer_color) or color(RED)
    fil = color(it.get('fill')) or col
    w = (it.get('w') or 6) * k
    hw = w / 2
    dash = _dash(it.get('dash'), k)
    t = it['t']

    def stroke(seq, closed=False):
        seq = [tuple(p) for p in seq] + ([tuple(seq[0])] if closed else [])
        xs, ys = [p[0] for p in seq], [p[1] for p in seq]
        op = _Op(W, H, xs, ys, hw + 2)
        if op.ok:
            op.stroke(_runs(seq, dash), hw)
            _paint(img, op.m, op.x0, op.y0, col, g)

    def fill(pts, rgba):
        op = _Op(W, H, [p[0] for p in pts], [p[1] for p in pts], 2)
        if op.ok:
            op.poly(pts)
            _paint(img, op.m, op.x0, op.y0, rgba, g)

    if t == 'line':
        stroke([it['a'], it['b']])
    elif t in ('arrow', 'pin'):
        a, b = (it['from'], it['to']) if t == 'pin' else (it['a'], it['b'])
        ang = math.atan2(b[1] - a[1], b[0] - a[0])
        h = max(14 * k, w * 3.2)
        stroke([a, (b[0] - math.cos(ang) * h * 0.6, b[1] - math.sin(ang) * h * 0.6)])
        dash = None
        fill([tuple(b), (b[0] - h * math.cos(ang - 0.42), b[1] - h * math.sin(ang - 0.42)),
              (b[0] - h * math.cos(ang + 0.42), b[1] - h * math.sin(ang + 0.42))], fil)
        if t == 'pin':
            fill(_ring(a, w * 1.6, w * 1.6, 0.0, step=1.0, lo=12), fil)
    elif t == 'poly':
        if it.get('fill'):
            fill(it['pts'], fil)
        stroke(it['pts'], closed=bool(it.get('closed')))
    elif t in ('circle', 'ellipse'):
        rx, ry = (it['r'], it['r']) if t == 'circle' else (it['rx'], it['ry'])
        ring = _ring(it['c'], rx, ry, (it.get('rot') or 0) * math.pi / 180 if t == 'ellipse' else 0.0)
        if it.get('fill'):
            fill(ring, fil)
        stroke(ring, closed=True)
    elif t == 'rect':
        (ax, ay), (bx, by) = it['a'], it['b']
        x, y, x2, y2 = min(ax, bx), min(ay, by), max(ax, bx), max(ay, by)
        corners = [(x, y), (x2, y), (x2, y2), (x, y2)]
        if it.get('fill'):
            fill(corners, fil)
        stroke(corners, closed=True)
    elif t == 'text':
        _text(img, it, col, g, k)


def draw(img, layers, W=None):
    """draw layers onto an RGBA PIL image in place (line widths scale with W, the drawing's width)"""
    if img.mode != 'RGBA':
        raise ValueError('draw() needs an RGBA image')
    k = (W or img.size[0]) / W0
    for L in layers:
        if L.get('visible') is False or not L.get('items'):
            continue
        op = _num(L.get('opacity'))
        g = 1.0 if op is None else op / 100
        if not 0 <= g <= 1:
            g = 1.0                                     # the canvas ignores an alpha outside 0 to 1
        for it in L['items']:
            _item_draw(img, it, L.get('color'), k, g)
    return img


def render(layers, W, H):
    """a transparent RGBA picture of the layers at the drawing's exact size"""
    return draw(Image.new('RGBA', (int(W), int(H)), (0, 0, 0, 0)), layers, W)


def count(doc):
    return sum(len(L['items']) for L in doc['layers'])
