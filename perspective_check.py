"""
perspective_check.py
Reads a board, finds its straight lines, groups them into vanishing points, finds the horizon,
and flags lines that almost aim at a vanishing point but miss.

    python perspective_check.py BOARD.png [--out DIR] [--region x0,y0,x1,y1] [--ignore x0,y0,x1,y1] [--pick N] [--fov 60]

It reads every long straight stroke, so arms, legs and props can pull it off. Always look at
<name>_check.png before trusting the numbers, and use --region / --ignore to keep it on the background.
Groups with little ink behind them are drawn thin and labelled "maybe 1", "maybe 2"... If the picture
shows one of them is the real thing, rerun with --pick and its number to build the horizon, guide and
camera on it.

Writes three NEW files (the board itself is never changed):
    <name>_check.png   the board, faded, with the found lines, vanishing points, horizon and flags
    <name>_guide.png   transparent guide layer at full canvas size (horizon, VPs, perspective rays)
    <name>_check.json  everything as numbers, plus a camera guess that scene_render.py and the app can load
"""
import argparse, json, os, sys
import numpy as np
from PIL import Image, ImageDraw
from animtk import imgio, lines as L

COL = {'VP1': (30, 110, 235), 'VP2': (200, 0, 150), 'VP3': (120, 60, 200), 'verticals': (0, 150, 80), 'parallels': (0, 140, 150),
       'VP up': (0, 150, 80), 'VP down': (0, 150, 80), 'parallels 2': (120, 60, 200), 'verticals 2': (110, 130, 0)}
FLAG = (240, 120, 0); HORIZON = (230, 30, 40)
MAYBE = [(150, 110, 0), (120, 60, 200), (0, 140, 150), (120, 120, 120)]
def col_of(name):
    if name.startswith('maybe'): return MAYBE[(int(name.split()[1]) - 1) % len(MAYBE)]
    return COL.get(name, (90, 90, 90))

def _dash(d, a, b, fill, width, dash=28, gap=18):
    a, b = np.array(a, float), np.array(b, float); n = np.hypot(*(b - a))
    if n < 1: return
    u = (b - a) / n; t = 0
    while t < n:
        p, q = a + u * t, a + u * min(t + dash, n); d.line([tuple(p), tuple(q)], fill=fill, width=width); t += dash + gap

def _edge_point(c, target, W, H, inset):
    """where the line from the center toward an off-canvas point leaves the canvas"""
    d = np.array(target, float) - c; ts = []
    for lo, hi, k in ((inset, W - inset, 0), (inset, H - inset, 1)):
        if abs(d[k]) > 1e-9: ts += [(lo - c[k]) / d[k], (hi - c[k]) / d[k]]
    t = min(v for v in ts if v > 0)
    return c + d * min(t, 1.0)

def draw_guide(res, W, H, flags=False):
    """transparent layer: horizon, vanishing points, rays. Safe to drop over the board in any app."""
    sc = W / 3840; w = lambda n: max(1, int(round(n * sc)))
    G = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(G)
    big = 3 * (W + H)
    for vp in res['vanishing_points']:
        if not vp.get('sure', True): continue                 # the guide only carries groups we trust
        col = col_of(vp['name']) + (120,)
        if vp['xy'] is not None:
            x, y = vp['xy']
            for a in np.arange(0, 180, 7.5):
                dx, dy = np.cos(np.radians(a)) * big, np.sin(np.radians(a)) * big
                d.line([(x - dx, y - dy), (x + dx, y + dy)], fill=col, width=w(3))
        else:
            a = np.radians(vp['line_angle']); dx, dy = np.cos(a), np.sin(a); nx, ny = -dy, dx
            step = W / 24
            for k in range(-40, 41):
                cx, cy = W / 2 + nx * k * step, H / 2 + ny * k * step
                d.line([(cx - dx * big, cy - dy * big), (cx + dx * big, cy + dy * big)], fill=col, width=w(3))
    hz = res['horizon']
    if hz:
        d.line([(0, hz['y_at_left']), (W, hz['y_at_right'])], fill=HORIZON + (255,), width=w(8))
    for vp in res['vanishing_points']:
        if vp['xy'] is None or not vp.get('sure', True): continue
        x, y = vp['xy']; r = 26 * sc; col = col_of(vp['name']) + (255,)
        d.ellipse([x - r, y - r, x + r, y + r], outline=col, width=w(8))
        d.line([x - r * 1.7, y, x + r * 1.7, y], fill=col, width=w(4)); d.line([x, y - r * 1.7, x, y + r * 1.7], fill=col, width=w(4))
    return G

def draw_check(board_rgb, res):
    W, H = board_rgb.size; sc = W / 3840; w = lambda n: max(1, int(round(n * sc)))
    img = imgio.dim(board_rgb, 0.6).convert('RGBA')
    img.alpha_composite(draw_guide(dict(res, vanishing_points=[]), W, H))      # horizon only under the lines
    d = ImageDraw.Draw(img); c = np.array([W / 2, H / 2])
    vpxy = {v['name']: v['xy'] for v in res['vanishing_points']}; sure = {v['name']: v.get('sure', True) for v in res['vanishing_points']}
    for ln in res['lines']:
        x0, y0, x1, y1 = ln['xyxy']
        if ln['group']:
            d.line([(x0, y0), (x1, y1)], fill=col_of(ln['group']), width=w(9 if sure.get(ln['group'], True) else 5))
    for n, fl in enumerate(res['flags'], 1):
        x0, y0, x1, y1 = res['lines'][fl['line']]['xyxy']
        d.line([(x0, y0), (x1, y1)], fill=FLAG, width=w(11))
        vp = vpxy.get(fl['near'])
        if vp is not None:                                   # dotted line = where it would go if it hit the point
            a, b = np.array([x0, y0]), np.array([x1, y1])
            far, near = (a, b) if np.hypot(*(a - vp)) > np.hypot(*(b - vp)) else (b, a)
            u = (np.array(vp) - far); u /= np.linalg.norm(u)
            _dash(d, far, far + u * np.hypot(*(b - a)), FLAG, w(5))
        imgio.tag(d, ((x0 + x1) / 2 + 14 * sc, (y0 + y1) / 2 + 14 * sc), str(n), bg=FLAG, size=44 * sc)
    for vp in res['vanishing_points']:
        col = col_of(vp['name'])
        if vp['xy'] is None: continue
        x, y = vp['xy']; r = 26 * sc
        if 0 <= x < W and 0 <= y < H:
            d.ellipse([x - r, y - r, x + r, y + r], outline=col, width=w(9))
            imgio.tag(d, (x + r + 12 * sc, y - r), vp['name'], bg=col, size=44 * sc)
        else:
            e = _edge_point(c, (x, y), W, H, 90 * sc); u = (np.array([x, y]) - c); dist = np.hypot(*(np.array([x, y]) - e)); u /= np.linalg.norm(u)
            d.line([tuple(e - u * 110 * sc), tuple(e)], fill=col, width=w(12))
            n2 = np.array([-u[1], u[0]])
            d.polygon([tuple(e + u * 30 * sc), tuple(e - u * 20 * sc + n2 * 28 * sc), tuple(e - u * 20 * sc - n2 * 28 * sc)], fill=col)
            tx = min(max(e[0] - u[0] * 150 * sc - 150 * sc, 20 * sc), W - 520 * sc); ty = min(max(e[1] - u[1] * 150 * sc - 20 * sc, 20 * sc), H - 80 * sc)
            imgio.tag(d, (tx, ty), '%s is %d px off the page' % (vp['name'], dist), bg=col, size=40 * sc)
    # legend
    rows = []
    for vp in res['vanishing_points']:
        where = 'no meeting point (parallel)' if vp['xy'] is None else 'at %d, %d' % tuple(vp['xy'])
        rows.append((col_of(vp['name']), '%s: %d lines, %s%s' % (vp['name'], vp['line_count'], where, '' if vp.get('sure', True) else ' (not sure)')))
    if res['horizon']: rows.append((HORIZON, 'horizon: y %d at center, tilt %.1f deg' % (res['horizon']['y_at_center'], res['horizon']['angle'])))
    for n, fl in enumerate(res['flags'], 1):
        miss = '' if fl['miss_px'] is None else ', misses by %d px' % fl['miss_px']
        rows.append((FLAG, '%d: %.1f deg off %s%s' % (n, fl['off_deg'], fl['near'], miss)))
    if not res['vanishing_points']: rows.append(((90, 90, 90), 'no vanishing point found'))
    y = 24 * sc
    for col, text in rows[:14]:
        box = imgio.tag(d, (30 * sc, y), text, bg=col, size=38 * sc); y = box[3] + 14 * sc
    return img.convert('RGB')

def run(board, out_dir, region=None, tol=2.5, flag_tol=6.0, min_len=None, fov=60.0, max_vps=3, ignore=(), min_share=0.25, pick=()):
    rgb = imgio.load_flat(board); W, H = rgb.size
    gray = np.array(rgb.convert('L'))
    segs = L.find_lines(gray, region=region, min_len=min_len, ignore=ignore)
    res = L.analyze(segs, W, H, tol=tol, flag_tol=flag_tol, max_vps=max_vps, default_fov=fov, min_share=min_share, pick=pick)
    res['board'] = os.path.basename(board); res['region'] = region; res['ignore'] = [list(b) for b in ignore]
    name = os.path.splitext(os.path.basename(board))[0]
    files = dict(check=imgio.out_path(out_dir, name + '_check.png'), guide=imgio.out_path(out_dir, name + '_guide.png'),
                 json=imgio.out_path(out_dir, name + '_check.json'))
    imgio.save(draw_check(rgb, res), files['check'])
    imgio.save(draw_guide(res, W, H), files['guide'])
    with open(files['json'], 'w', encoding='utf-8') as fh: json.dump(res, fh, indent=1)
    return res, files

def summary(res):
    out = ['%d straight lines found on a %dx%d board' % (len(res['lines']), *res['canvas'])]
    for vp in res['vanishing_points']:
        where = 'parallel, no meeting point' if vp['xy'] is None else 'at (%d, %d)' % tuple(vp['xy'])
        out.append('  %-9s %2d lines, %s%s' % (vp['name'], vp['line_count'], where, '' if vp.get('sure', True) else '  (not sure)'))
    hz = res['horizon']
    out.append('  horizon   y=%d at center, tilt %.1f deg (%s)' % (hz['y_at_center'], hz['angle'], hz['basis']) if hz else '  horizon   not found')
    for n, fl in enumerate(res['flags'], 1):
        miss = '' if fl['miss_px'] is None else ', misses by %d px' % fl['miss_px']
        out.append('  flag %d    line %d is %.1f deg off %s%s' % (n, fl['line'], fl['off_deg'], fl['near'], miss))
    if not res['flags']: out.append('  flags     none')
    out += ['  note      ' + n for n in res['notes']]
    return '\n'.join(out)

if __name__ == '__main__':
    ap = argparse.ArgumentParser(description='Find vanishing points and the horizon on a board, and flag lines that miss.')
    ap.add_argument('board'); ap.add_argument('--out', default='out/perspective_check')
    ap.add_argument('--region', help='x0,y0,x1,y1 to read only part of the board (e.g. skip the characters)')
    ap.add_argument('--ignore', action='append', default=[], help='x0,y0,x1,y1 box to skip (characters, lettering). Repeat for more boxes')
    ap.add_argument('--tol', type=float, default=2.5, help='degrees a line may be off and still count as hitting a VP')
    ap.add_argument('--flag-tol', type=float, default=6.0, help='lines off by more than --tol but less than this get flagged')
    ap.add_argument('--min-len', type=float, help='shortest line to read, in pixels (default 4%% of the width)')
    ap.add_argument('--fov', type=float, default=60.0, help='lens width to assume when only one VP is found')
    ap.add_argument('--max-vps', type=int, default=3)
    ap.add_argument('--pick', default='', help='numbers of the "maybe" groups to trust after looking at the check picture, e.g. --pick 2 or --pick 1,3')
    ap.add_argument('--min-share', type=float, default=0.25, help='how much of the leftover linework a group needs to count (lower = more, shakier groups)')
    a = ap.parse_args()
    region = [int(v) for v in a.region.split(',')] if a.region else None
    ignore = [[int(v) for v in b.split(',')] for b in a.ignore]
    res, files = run(a.board, a.out, region, a.tol, a.flag_tol, a.min_len, a.fov, a.max_vps, ignore, a.min_share, [int(v) for v in a.pick.split(',') if v.strip()])
    print(summary(res))
    print('saved: ' + ', '.join(files.values()))
