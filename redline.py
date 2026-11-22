"""
redline.py: a supervisor style paintover of a drawing, from marks a Claude (or the app) wrote down.

    python redline.py DRAWING MARKS.json [--shot NAME | --out DIR] [--fade 35] [--check]

What you get, all NEW files, numbered, so an earlier version is never replaced:
  <name>_redline_vN.png         the drawing with the marks on top (red = fixes, blue = construction)
  <name>_redline_vN_layer.png   the marks alone, transparent, at the drawing's exact size: drop it on as a layer
  <name>_redline_vN.json        the marks themselves, so the app's Redline tab can open them, drag them and save vN+1
Where: --out DIR, else work/<shot>/ with --shot, else the drawing's own work/<shot>/ folder when it lives in one,
else out/redline/. The drawing itself is only ever read.

MARKS.json is the vector layer format in animtk/layers.py (the same one the app uses), for example
  {"kind": "animtk-redline", "version": 1, "W": 3840, "H": 1920, "layers": [
    {"name": "Fixes", "color": "#e8202a", "items": [
      {"t": "arrow", "a": [1200, 900], "b": [1320, 860], "note": "lift the hip"},
      {"t": "text", "at": [1330, 850], "text": "1"}]},
    {"name": "Construction", "color": "#2f6bff", "items": [
      {"t": "line", "a": [0, 700], "b": [3840, 700], "dash": [18, 12]}]}]}
W and H are the size of the picture the coordinates were written on. If Claude looked at a smaller copy, give that
copy's size and everything is scaled up to the drawing (W 1 and H 1 means the coordinates are fractions).

  --fade 35   fades the drawing 35 percent toward white under the marks, the way a paintover reads
  --check     reads the marks and says what it would draw, writes nothing
  --tag WORD  another word than "redline" in the file names (construction, notes, ...)

Marks worked out for you, instead of a MARKS.json:
    python redline.py BOARD.png --from-perspective                 # finds the lines and checks them first
    python redline.py BOARD.png --from-perspective BOARD_check.json   # or uses a perspective_check.py result
  Every line perspective_check flags gets a red line showing where it would sit if it aimed at its vanishing point
  (turned about its own middle, same length), an arrow at each end that has to move far enough to see, and its
  number. The Construction layer (blue) carries the horizon, the vanishing points it trusts and a dashed ray from
  each fixed line to its point. Use perspective_check.py with --region / --ignore first when characters confuse it.

From Python, the hook for code that works out WHAT to mark (a perspective drift check, critique notes):
    import redline
    doc = redline.doc_from_items(items, W, H, name='Drift')        # items in the format above
    doc = redline.perspective_marks(check_result)                  # the --from-perspective marks as a document
    res = redline.save_redline('board.png', doc, shot='shot01')     # -> {'v': 3, 'copy': ..., 'layer': ..., 'marks': ...}
"""
import argparse, datetime, json, math, os, re, sys
from animtk import imgio, layers as LY

ROOT = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(ROOT, 'work')
doc_from_items = LY.doc_from_items
RED, BLUE = LY.RED, LY.BLUE


def safe(s):
    """file name rules shared with Store.safe in app/js/shot.js"""
    s = re.sub(r'\.[^.]+$', '', str(s or 'shot'))
    s = re.sub(r'[^A-Za-z0-9 _.\-()]+', '_', s)
    s = re.sub(r'^[ .]+|[ .]+$', '', s)[:80]
    return s or 'shot'


def out_dir_for(drawing, shot=None, out=None):
    if out:
        return os.path.abspath(out)
    if shot:
        return os.path.join(WORK, safe(shot))
    try:
        rel = os.path.relpath(os.path.abspath(drawing), WORK)
    except ValueError:                                   # another drive
        rel = '..'
    parts = rel.split(os.sep)
    if parts[0] != '..' and len(parts) >= 2:
        return os.path.join(WORK, parts[0])
    return os.path.join(ROOT, 'out', 'redline')


def next_version(folder, base, tag='redline'):
    rx = re.compile('^' + re.escape(base) + '_' + re.escape(tag) + r'_v(\d+)(?:_layer)?\.(?:png|json)$', re.I)
    n = 0
    if os.path.isdir(folder):
        for f in os.listdir(folder):
            m = rx.match(f)
            if m:
                n = max(n, int(m.group(1)))
    return n + 1


def _claim(folder, base, tag):
    """the next free version number, with its three files created empty so nothing else can take them"""
    os.makedirs(folder, exist_ok=True)
    for _ in range(50):
        v = next_version(folder, base, tag)
        paths = [os.path.join(folder, '%s_%s_v%d%s' % (base, tag, v, end)) for end in ('.png', '_layer.png', '.json')]
        got = []
        try:
            for p in paths:
                if imgio._key(p) in imgio._INPUTS:
                    raise SystemExit('Refusing to overwrite an original file: %s' % p)
                got.append((p, open(p, 'xb')))
            return v, got
        except FileExistsError:
            for p, fh in got:                            # only the empty files this call just made
                fh.close()
                os.remove(p)
    raise SystemExit('could not find a free version number in ' + folder)


def read_marks(marks):
    """a path, JSON text or an already parsed object -> parsed object"""
    if isinstance(marks, str) and not marks.lstrip().startswith(('{', '[', '`')) and os.path.isfile(marks):
        with open(marks, 'rb') as fh:
            return fh.read().decode('utf-8-sig')
    return marks


def save_redline(drawing, marks, shot=None, out=None, fade=0.0, tag='redline', check=False):
    """drawing + marks -> numbered redline copy, transparent layer and marks JSON. Returns what it did."""
    imgio.protect(drawing)
    rgb = imgio.load_flat(drawing)
    W, H = rgb.size
    doc, warns = LY.normalize(read_marks(marks), W, H)
    fade = max(0.0, min(90.0, float(fade or 0)))
    res = {'drawing': drawing, 'W': W, 'H': H, 'doc': doc, 'warnings': warns, 'marks': LY.count(doc), 'v': None}
    if check:
        return res
    lay = LY.render(doc['layers'], W, H)
    copy = (imgio.dim(rgb, fade / 100) if fade else rgb).convert('RGBA')
    copy.alpha_composite(lay)
    folder = out_dir_for(drawing, shot, out)
    base = safe(os.path.basename(drawing))
    v, handles = _claim(folder, base, tag)
    recipe = dict(doc, source=os.path.basename(drawing), made=datetime.datetime.now().isoformat(timespec='seconds'),
                  fade=fade, tag=tag, v=v)
    (pc, fc), (pl, fl), (pj, fj) = handles
    with fc:
        copy.convert('RGB').save(fc, 'PNG')
    with fl:
        lay.save(fl, 'PNG')
    with fj:
        fj.write(json.dumps(recipe, indent=1).encode('utf-8'))
    res.update(v=v, copy=pc, layer=pl, recipe=pj, folder=folder)
    return res


# ------------------------------------------------------------------ marks worked out from a perspective check
def perspective_marks(res):
    """perspective_check / animtk.lines.analyze result -> a redline document in the board's own pixels.
    Fixes (red): where each flagged line would sit if it aimed at its vanishing point. Construction (blue): the
    horizon, the trusted vanishing points, and a dashed ray from each fixed line to its point."""
    W, H = res['canvas']
    k = W / LY.W0
    vps = {v['name']: v for v in res['vanishing_points']}
    fixes, cons = [], []
    inside = lambda x, y: [min(max(x, 30 * k), W - 60 * k), min(max(y, 50 * k), H - 20 * k)]
    for n, fl in enumerate(res['flags'], 1):
        vp = vps.get(fl['near'])
        if vp is None:
            continue
        x0, y0, x1, y1 = res['lines'][fl['line']]['xyxy']
        mx, my, half = (x0 + x1) / 2, (y0 + y1) / 2, math.hypot(x1 - x0, y1 - y0) / 2
        if vp['xy'] is not None:
            dx, dy = vp['xy'][0] - mx, vp['xy'][1] - my
        else:                                             # a parallel group: aim along its lines
            a = math.radians(vp['line_angle'])
            dx, dy = math.cos(a), math.sin(a)
        d = math.hypot(dx, dy)
        if d < 1e-9 or half < 1:
            continue
        ux, uy = dx / d, dy / d
        if ux * (x1 - x0) + uy * (y1 - y0) < 0:           # keep the drawn line's own direction, so ends pair up
            ux, uy = -ux, -uy
        a2, b2 = [mx - ux * half, my - uy * half], [mx + ux * half, my + uy * half]
        miss = '' if fl.get('miss_px') is None else ', missing it by %d px' % fl['miss_px']
        fixes.append({'t': 'line', 'a': a2, 'b': b2, 'w': 5,
                      'note': '%d: this line is %.1f degrees off %s%s. The red line is where it would aim at %s.'
                              % (n, fl['off_deg'], fl['near'], miss, fl['near'])})
        for p, q in (([x0, y0], a2), ([x1, y1], b2)):
            if math.hypot(q[0] - p[0], q[1] - p[1]) > 30 * k:
                fixes.append({'t': 'arrow', 'a': p, 'b': q, 'w': 4})
        nx, ny = -uy, ux
        fixes.append({'t': 'text', 'at': inside(mx + nx * 46 * k, my + ny * 46 * k + 14 * k), 'text': str(n), 'size': 44})
        if vp['xy'] is not None:                          # the ray from the end nearer the point, up to the point
            e = min((a2, b2), key=lambda p: math.hypot(p[0] - vp['xy'][0], p[1] - vp['xy'][1]))
            cons.append({'t': 'line', 'a': e, 'b': list(vp['xy']), 'w': 3, 'dash': [18, 12]})
    hz = res.get('horizon')
    if hz:
        cons.append({'t': 'line', 'a': [0, hz['y_at_left']], 'b': [W, hz['y_at_right']], 'w': 4})
        cons.append({'t': 'text', 'at': inside(40 * k, (hz['y_at_left'] + hz['y_at_right']) / 2 - 16 * k), 'text': 'horizon', 'size': 34})
    cx, cy = W / 2, H / 2
    for vp in res['vanishing_points']:
        if not vp.get('sure', True) or vp['xy'] is None:
            continue
        x, y = vp['xy']
        if 0 <= x < W and 0 <= y < H:
            r = 26 * k
            cons += [{'t': 'circle', 'c': [x, y], 'r': r, 'w': 6},
                     {'t': 'line', 'a': [x - r * 1.7, y], 'b': [x + r * 1.7, y], 'w': 3},
                     {'t': 'line', 'a': [x, y - r * 1.7], 'b': [x, y + r * 1.7], 'w': 3},
                     {'t': 'text', 'at': inside(x + r + 12 * k, y - r), 'text': vp['name'], 'size': 34}]
        else:                                             # off the page: an arrow at the edge pointing at it
            ux, uy = x - cx, y - cy
            d = math.hypot(ux, uy)
            ux, uy = ux / d, uy / d
            t = min(((W / 2 - 90 * k) / abs(ux)) if ux else 1e18, ((H / 2 - 90 * k) / abs(uy)) if uy else 1e18)
            ex, ey = cx + ux * t, cy + uy * t
            far = math.hypot(x - ex, y - ey)
            cons += [{'t': 'arrow', 'a': [ex - ux * 110 * k, ey - uy * 110 * k], 'b': [ex, ey], 'w': 8},
                     {'t': 'text', 'at': inside(ex - ux * 150 * k - 150 * k, ey - uy * 150 * k), 'size': 30,
                      'text': '%s is %d px off the page' % (vp['name'], far)}]
    notes = list(res.get('notes') or [])
    if not res['vanishing_points']:
        notes.append('No vanishing point was found, so there is nothing to check lines against.')
    elif not fixes:
        notes.append('No line is off enough to mark.')
    return {'kind': LY.KIND, 'version': 1, 'W': W, 'H': H, 'note': ' '.join(notes),
            'layers': [{'id': 'fixes', 'name': 'Fixes', 'color': RED, 'opacity': 100, 'visible': True, 'items': fixes},
                       {'id': 'construction', 'name': 'Construction', 'color': BLUE, 'opacity': 100, 'visible': True, 'items': cons}]}


def check_perspective(drawing, check_json=None):
    """the perspective check behind --from-perspective: read a saved result, or run it now (nothing written)"""
    if check_json:
        with open(check_json, encoding='utf-8-sig') as fh:
            return json.load(fh)
    import numpy as np
    from animtk import lines as LN
    rgb = imgio.load_flat(drawing)
    W, H = rgb.size
    return LN.analyze(LN.find_lines(np.array(rgb.convert('L'))), W, H)


def _rel(p):
    try:
        r = os.path.relpath(p)
        return p if r.startswith('..') else r
    except ValueError:
        return p


def describe(res):
    doc = res['doc']
    head = '%s (%d x %d): %d layer%s, %d mark%s' % (os.path.basename(res['drawing']), res['W'], res['H'], len(doc['layers']),
                                                   '' if len(doc['layers']) == 1 else 's', res['marks'], '' if res['marks'] == 1 else 's')
    out = ['Redline v%d for %s' % (res['v'], head) if res['v'] else 'Marks for %s. Nothing written (--check).' % head]
    for L in doc['layers']:
        kinds = {}
        for it in L['items']:
            kinds[it['t']] = kinds.get(it['t'], 0) + 1
        what = ', '.join('%d %s' % (n, t) for t, n in kinds.items()) or 'empty'
        out.append('  %-14s %s%s' % (L['name'], what, '' if L['visible'] else '  (hidden)'))
    if res['v']:
        out += ['  copy    ' + _rel(res['copy']),
                '  layer   ' + _rel(res['layer']) + '  (transparent, same size as the drawing)',
                '  marks   ' + _rel(res['recipe']) + '  (open it in the Redline tab to drag marks and save the next version)']
    notes = [(it.get('note') or '') for L in doc['layers'] for it in L['items'] if it.get('note')]
    for i, n in enumerate(notes[:12], 1):
        out.append('  note %d  %s' % (i, n))
    out += ['heads up: ' + w for w in res['warnings']]
    return '\n'.join(out)


def main(argv=None):
    ap = argparse.ArgumentParser(description='Draw redline marks over a drawing as a new numbered copy plus a transparent layer.')
    ap.add_argument('drawing', help='PNG, JPG or PSD. Only read, never changed')
    ap.add_argument('marks', nargs='?', help='the marks JSON (see the top of redline.py), or - to read it from stdin')
    ap.add_argument('--from-perspective', nargs='?', const=True, metavar='CHECK.json',
                    help='mark the lines a perspective check flags (runs the check, or reads a perspective_check.py result)')
    ap.add_argument('--shot', help='save into work/<shot>/')
    ap.add_argument('--out', help='save into this folder instead')
    ap.add_argument('--fade', type=float, default=0, help='fade the drawing toward white under the marks, in percent (0 to 90)')
    ap.add_argument('--tag', default='redline', help='the word in the file names (default redline)')
    ap.add_argument('--check', action='store_true', help='only read the marks and report, write nothing')
    a = ap.parse_args(argv)
    if not os.path.isfile(a.drawing):
        raise SystemExit('cannot find the drawing: %s' % a.drawing)
    if a.from_perspective and a.marks:
        raise SystemExit('give either a marks file or --from-perspective, not both')
    if a.from_perspective:
        cj = None if a.from_perspective is True else a.from_perspective
        if cj and not os.path.isfile(cj):
            raise SystemExit('cannot find the perspective check: %s' % cj)
        marks = perspective_marks(check_perspective(a.drawing, cj))
        if a.tag == 'redline':
            a.tag = 'perspective'
        if marks.get('note'):
            print(marks['note'])
    elif not a.marks:
        raise SystemExit('give a marks file (see the top of redline.py) or --from-perspective')
    else:
        marks = sys.stdin.read() if a.marks == '-' else a.marks
        if marks is a.marks and not os.path.isfile(marks):
            raise SystemExit('cannot find the marks file: %s' % marks)
    try:
        res = save_redline(a.drawing, marks, shot=a.shot, out=a.out, fade=a.fade, tag=safe(a.tag), check=a.check)
    except ValueError as e:
        raise SystemExit('could not read the marks: %s' % e)
    print(describe(res))
    return res


if __name__ == '__main__':
    main()
