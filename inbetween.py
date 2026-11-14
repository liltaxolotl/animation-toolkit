"""
inbetween.py
Makes inbetweens between two keys by bending the ACTUAL linework of the keys (thin-plate-spline warp)
along a motion path, with ease in / ease out spacing. It never draws lines of its own.

If the two poses are too different to bend one into the other cleanly, it does not fake it. It writes
a transparent guide instead (placement, size and arc for each inbetween) for drawing over by hand.

    python inbetween.py KEY_A.png KEY_B.png [-n 1] [--ease inout|in|out|linear] [--at 0.33,0.66]
                        [--arc dx,dy] [--source nearest|a|b] [--region x0,y0,x1,y1]
                        [--out DIR] [--force] [--guide-only]

  -n          how many inbetweens (default 1)
  --ease      spacing between the keys: inout = slow out of A and slow into B (default)
  --at        exact positions instead of --ease, 0 = key A, 1 = key B (e.g. 0.33 favours A)
  --arc       bow the path: how far (pixels right, pixels down) the middle of the move swings off the
              straight line. --arc 0,-120 lifts the middle 120 px
  --source    whose lines get bent: nearest key (default), always A, or always B
  --region    only match inside this box (everything outside stays exactly as it is)

Lines that hold still between the two keys (background, held parts) are left exactly as they are;
only the strokes that move get bent. A stroke that touches the moving part moves with it.
  --force     warp even if the check says the poses are too different
  --guide-only  skip the warp and just make the guide

Writes NEW files in --out (default out/inbetween/<folder of key A>):
    <A>_<B>_inb01.png ...      the inbetweens (same size and paper as the keys), when the warp is clean
    <A>_<B>_guide.png          transparent guide: boxes for placement and size, arc with spacing ticks
    <A>_<B>_preview.png        A in blue, B in red, the result (or the guide) on top, to judge it fast
    <A>_<B>_report.json        the numbers behind the decision
"""
import argparse, json, os, sys
import numpy as np, cv2
from PIL import Image, ImageDraw
from animtk import imgio, frames as F, warp as Wp

BLUE, RED, GREEN, GRAY = (40, 110, 230), (225, 50, 60), (0, 150, 80), (90, 90, 95)
# beyond these the bend smears or tears the drawing instead of moving it
LIMITS = dict(gap=0.0045, leftover_a=0.07, leftover_b=0.07, stretch=1.9, squash=0.45, folds=0.004)

def analyse(a_path, b_path, region=None, n_pts=600):
    ga, s = F.load_work(a_path); gb, s2 = F.load_work(b_path)
    if ga.shape != gb.shape: raise SystemExit('The two keys are different sizes: %s vs %s.' % (ga.shape[::-1], gb.shape[::-1]))
    ia, ib = F.ink(ga), F.ink(gb)
    rm = F.region_mask(ia.shape, s, region)
    # lines that hold still (background, held parts) are set aside whole; only what moves gets bent
    still_a, mov_a = F.split_still(ia & rm, ib & rm); still_b, mov_b = F.split_still(ib & rm, ia & rm)
    still_a |= ia & ~rm; still_b |= ib & ~rm
    info = dict(scale=s, same=bool(mov_a.sum() + mov_b.sum() < 30), still=dict(a=still_a, b=still_b))
    if info['same']: return info
    sa, sb = F.stats(mov_a, s), F.stats(mov_b, s)
    if sa is None or sb is None:                 # something appears or disappears entirely
        only = sa or sb
        info.update(a=sa, b=sb, diag=only['diag'], ok=False, why=['one key has moving lines where the other has none at all'], pts=None)
        return info
    both = mov_a | mov_b; diag = F.stats(both, s)['diag']
    zone = F.dilate(both, max(6, int(0.12 * diag / s)))
    pa = Wp.ink_points(mov_a, n_pts) * s; pb = Wp.ink_points(mov_b, n_pts) * s
    T, m = Wp.match(pa, pb)
    rep = Wp.fit_report(pa, T, pb, np.zeros((0, 2)), mov_a, mov_b, zone, s, diag)
    info.update(a=sa, b=sb, diag=diag, pts=dict(a=pa, t=T, b=pb), report=rep)
    why = []
    if rep['gap'] > LIMITS['gap']: why.append('lines do not land on each other (average miss %.2f%% of the size)' % (rep['gap'] * 100))
    if rep['leftover_a'] > LIMITS['leftover_a']: why.append('%d%% of key A has no matching line in key B' % round(rep['leftover_a'] * 100))
    if rep['leftover_b'] > LIMITS['leftover_b']: why.append('%d%% of key B has no matching line in key A' % round(rep['leftover_b'] * 100))
    if rep['stretch'] > LIMITS['stretch'] or rep['squash'] < LIMITS['squash']: why.append('parts would have to stretch x%.1f or squash x%.2f' % (rep['stretch'], rep['squash']))
    if rep['folds'] > LIMITS['folds']: why.append('the bend folds over itself in %.1f%% of the drawing' % (rep['folds'] * 100))
    info['ok'] = not why; info['why'] = why
    return info

def layers(rgba, still_small, paper):
    """cut a key into (still layer, moving layer), each on clean paper, using the working-size still mask"""
    H, W = rgba.shape[:2]
    m = cv2.resize(F.dilate(still_small, 1).astype(np.uint8), (W, H), interpolation=cv2.INTER_NEAREST) > 0
    still = np.empty_like(rgba); still[:] = paper; still[m] = rgba[m]
    moving = rgba.copy(); moving[m] = paper
    return still, moving

def stack(still, moving, paper):
    """put the still lines back with the bent ones"""
    if paper[3] == 255:
        out = np.minimum(still, moving); out[..., 3] = 255; return out      # dark lines on light paper: keep the darker of the two
    a = still[..., 3:4].astype(np.float32) / 255
    out = (still.astype(np.float32) * a + moving.astype(np.float32) * (1 - a))
    out[..., 3] = np.maximum(still[..., 3], moving[..., 3]); return out.astype(np.uint8)

def warp_one(src_rgba, still_small, pts, e, arc, use_b, shape, paper):
    """one inbetween at position e (0..1). Returns (image array, share of the warp that folds over)."""
    pa, T = pts['a'], pts['t']
    P = pa + e * (T - pa) + np.array(arc, float) * (4 * e * (1 - e))
    step = 16
    mapx, mapy, disp = Wp.tps_backward_map(P, T if use_b else pa, shape, step=step)
    still, moving = layers(src_rgba, still_small, paper)
    bent = Wp.remap(moving, mapx, mapy, paper)
    return stack(still, bent, np.array(paper)), Wp.folds(disp, step)

def draw_guide(size, info, es, arc, labels=True):
    """transparent guide: where each inbetween sits, how big it is, and the arc it travels on"""
    W, H = size; sc = W / 3840; w = lambda n: max(1, int(round(n * sc)))
    G = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(G)
    sa, sb = info.get('a'), info.get('b')
    if sa is None or sb is None: sa = sb = (sa or sb)
    ca, cb = np.array(sa['center']), np.array(sb['center']); ba, bb = np.array(sa['box']), np.array(sb['box'])
    pos = lambda e: ca + e * (cb - ca) + np.array(arc, float) * (4 * e * (1 - e))
    def dashed_box(box, col, width, dash=34):
        x0, y0, x1, y1 = box
        for a, b in (((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))):
            a, b = np.array(a, float), np.array(b, float); L = np.hypot(*(b - a)); t = 0
            while t < L:
                p, q = a + (b - a) * t / L, a + (b - a) * min(t + dash * sc, L) / L
                d.line([tuple(p), tuple(q)], fill=col, width=width); t += dash * sc * 1.7
    d.rectangle(list(ba), outline=BLUE + (255,), width=w(6)); d.rectangle(list(bb), outline=RED + (255,), width=w(6))
    path = [tuple(pos(t)) for t in np.linspace(0, 1, 60)]
    d.line(path, fill=GRAY + (255,), width=w(6), joint='curve')
    r = 16 * sc
    for c, col in ((ca, BLUE), (cb, RED)): d.ellipse([c[0] - r, c[1] - r, c[0] + r, c[1] + r], fill=col + (255,))
    for i, e in enumerate(es, 1):
        c = pos(e); half_a = (ba[2:] - ba[:2]) / 2; half_b = (bb[2:] - bb[:2]) / 2; half = half_a + e * (half_b - half_a)
        off_a = (ba[:2] + ba[2:]) / 2 - ca; off_b = (bb[:2] + bb[2:]) / 2 - cb; mid = c + off_a + e * (off_b - off_a)
        dashed_box([mid[0] - half[0], mid[1] - half[1], mid[0] + half[0], mid[1] + half[1]], GREEN + (255,), w(6))
        d.line([c[0] - r * 1.6, c[1], c[0] + r * 1.6, c[1]], fill=GREEN + (255,), width=w(6)); d.line([c[0], c[1] - r * 1.6, c[0], c[1] + r * 1.6], fill=GREEN + (255,), width=w(6))
        if labels: imgio.tag(d, (c[0] + r * 1.4, c[1] + r * 0.6), str(i), bg=GREEN, size=44 * sc)
    if labels:
        imgio.tag(d, (ba[0] + 8 * sc, ba[1] + 8 * sc), 'A', bg=BLUE, size=44 * sc); imgio.tag(d, (bb[0] + 8 * sc, bb[1] + 8 * sc), 'B', bg=RED, size=44 * sc)
    return G

def preview(a_path, b_path, tops, guide=None, note=None):
    a = F.tint(imgio.load_flat(a_path), BLUE, 0.55); b = F.tint(imgio.load_flat(b_path), RED, 0.55)
    img = F.multiply(a, b)
    for t in tops: img = F.multiply(img, t.convert('RGB'))
    img = img.convert('RGBA')
    if guide is not None: img.alpha_composite(guide)
    if note:
        d = ImageDraw.Draw(img); imgio.tag(d, (30 * img.width / 3840, 24 * img.width / 3840), note, bg=(20, 20, 25), size=40 * img.width / 3840)
    return img.convert('RGB')

def run(a_path, b_path, out_dir, n=1, ease='inout', at=None, arc=(0, 0), source='nearest', region=None, force=False, guide_only=False):
    A = imgio.load_rgba(a_path); B = imgio.load_rgba(b_path)
    if A.size != B.size: raise SystemExit('The two keys are different sizes: %s vs %s.' % (A.size, B.size))
    W, H = A.size
    name = '%s_%s' % (os.path.splitext(os.path.basename(a_path))[0], os.path.splitext(os.path.basename(b_path))[0])
    es = [float(v) for v in at] if at else Wp.spacing(n, ease)
    info = analyse(a_path, b_path, region)
    files = {}; result = dict(keys=[os.path.basename(a_path), os.path.basename(b_path)], positions=[round(e, 4) for e in es], arc=list(arc))
    if info['same']:
        result.update(mode='none', why=['the two keys are the same drawing']); return result, files
    result['report'] = {k: round(v, 4) for k, v in info.get('report', {}).items()}
    do_warp = (info.get('ok') or force) and not guide_only and info.get('pts') is not None
    tops = []; worst_fold = 0.0
    if do_warp:
        Aa, Ba = np.array(A), np.array(B); paper = tuple(int(v) for v in Aa[2, 2])
        made = []
        for i, e in enumerate(es, 1):
            use_b = (source == 'b') or (source == 'nearest' and e > 0.5)
            img, fold = warp_one(Ba if use_b else Aa, info['still']['b' if use_b else 'a'], info['pts'], e, arc, use_b, (H, W), paper)
            worst_fold = max(worst_fold, fold); made.append((i, e, use_b, img))
        result['report']['folds'] = round(max(worst_fold, result['report'].get('folds', 0)), 4)
        if worst_fold > LIMITS['folds'] and not force:
            info['ok'] = False; info['why'] = info.get('why', []) + ['the bend folds over itself in %.1f%% of the picture' % (worst_fold * 100)]; do_warp = False
        else:
            for i, e, use_b, img in made:
                p = imgio.out_path(out_dir, '%s_inb%02d.png' % (name, i)); imgio.save(Image.fromarray(img), p)
                files['inb%02d' % i] = p; tops.append(Image.fromarray(img))
            result['bent_from'] = ['B' if m[2] else 'A' for m in made]
    result['mode'] = 'warp' if do_warp else 'guide'
    result['why'] = [] if (do_warp and info.get('ok')) else info.get('why', [])
    if do_warp and not info.get('ok'): result['forced'] = True
    g = draw_guide((W, H), info, es, arc)
    files['guide'] = imgio.save(g, imgio.out_path(out_dir, name + '_guide.png'))
    note = ('%d inbetween%s warped from your lines' % (len(es), '' if len(es) == 1 else 's')) if do_warp else 'too different to warp: draw over the green boxes'
    files['preview'] = imgio.save(preview(a_path, b_path, tops, None if do_warp else g, note), imgio.out_path(out_dir, name + '_preview.png'))
    files['report'] = imgio.out_path(out_dir, name + '_report.json')
    with open(files['report'], 'w', encoding='utf-8') as fh: json.dump(result, fh, indent=1)
    return result, files

if __name__ == '__main__':
    ap = argparse.ArgumentParser(description='Inbetweens by warping the real linework of two keys, or a guide when the poses are too different.')
    ap.add_argument('key_a'); ap.add_argument('key_b')
    ap.add_argument('-n', type=int, default=1); ap.add_argument('--ease', default='inout', choices=['inout', 'in', 'out', 'linear'])
    ap.add_argument('--at', help='exact positions between 0 and 1, comma separated'); ap.add_argument('--arc', default='0,0')
    ap.add_argument('--source', default='nearest', choices=['nearest', 'a', 'b']); ap.add_argument('--region')
    ap.add_argument('--out', help='default: out/inbetween/<folder of key A>'); ap.add_argument('--force', action='store_true'); ap.add_argument('--guide-only', action='store_true')
    a = ap.parse_args()
    out = a.out or os.path.join('out', 'inbetween', os.path.basename(os.path.dirname(os.path.abspath(a.key_a))))
    res, files = run(a.key_a, a.key_b, out, a.n, a.ease, a.at.split(',') if a.at else None, [float(v) for v in a.arc.split(',')],
                     a.source, [int(v) for v in a.region.split(',')] if a.region else None, a.force, a.guide_only)
    if res['mode'] == 'none': print('Nothing to do: ' + res['why'][0]); sys.exit(0)
    r = res.get('report', {})
    if r: print('fit: miss %.1f%%, unmatched A %d%% / B %d%%, stretch x%.2f, squash x%.2f, folds %.1f%%, biggest move %d%% of its size' %
                (r['gap'] * 100, r['leftover_a'] * 100, r['leftover_b'] * 100, r['stretch'], r['squash'], r.get('folds', 0) * 100, r['move'] * 100))
    if res['mode'] == 'warp':
        print('WARPED %d inbetween(s) at %s, bent from %s%s' % (len(res['positions']), res['positions'], res['bent_from'], '  (forced: ' + '; '.join(res['why']) + ')' if res.get('forced') else ''))
    else:
        print('GUIDE ONLY, not warped: ' + ('; '.join(res['why']) or 'asked for the guide'))
    print('saved: ' + ', '.join(files.values()))
