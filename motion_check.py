"""
motion_check.py
Looks over a frame sequence and flags what hurts readability:

    ARC         the path of the action kinks or doubles back at this frame
    SPACING     this step is much bigger or smaller than the steps around it
    POP         the shape changes a lot in one frame (after allowing for it simply moving)
    SIZE        the subject suddenly grows or shrinks against the trend
    + BREAKDOWN a big move and a big change with nothing between: add a key or breakdown here

    python motion_check.py FRAMES_FOLDER [--out DIR] [--region x0,y0,x1,y1] [--ignore x0,y0,x1,y1]
                                         [--cols 4] [--all-ink] [--max-flags 6]

It measures the ink that moves (lines that sit still in most frames are treated as background).
--all-ink measures everything, for shots where the whole frame moves (a pan, a camera push).
It only sees where the ink is, not what it means, so treat every flag as "look here", not "this is wrong".
Each frame or step gets one mark at most, and only the 6 that matter most are drawn.
Arc, spacing and size are only judged where the subject keeps its shape from frame to frame. On key
poses or boards (every step a new shape) it says so and marks just the biggest jumps.

Writes NEW files in --out (default out/motion_check/<folder name>):
    <folder>_motion.png    contact sheet with the marks, plus the path and a spacing chart
    <folder>_motion.json   every measurement and flag
"""
import argparse, json, os
import numpy as np, cv2
from PIL import Image, ImageDraw
from animtk import imgio, frames as F

COL = {'ARC': (130, 60, 200), 'SPACING': (235, 125, 0), 'POP': (220, 40, 50), 'SIZE': (30, 110, 235), '+ BREAKDOWN': (0, 150, 80)}
WHAT = {'ARC': 'path kinks or doubles back here', 'SPACING': 'step much bigger or smaller than its neighbours',
        'POP': 'shape jumps in one frame', 'SIZE': 'sudden size change', '+ BREAKDOWN': 'big gap: add a key or breakdown'}

def measure(files, region=None, ignore=(), all_ink=False):
    grays = []; s = 1.0
    for f in files:
        g, s = F.load_work(f); grays.append(g)
    shape = grays[0].shape
    if any(g.shape != shape for g in grays): raise SystemExit('Frames are not all the same size.')
    rm = F.region_mask(shape, s, region, ignore)
    inks = [F.ink(g) & rm for g in grays]
    still = np.zeros(shape, bool)
    if not all_ink and len(inks) >= 4:
        still = F.dilate(F.static_ink(inks, 0.8), 2)
        mov = [m & ~still for m in inks]
        if np.median([m.sum() for m in mov]) < 0.1 * np.median([m.sum() for m in inks]): mov = inks; still[:] = False   # nearly everything holds still
    else: mov = inks
    st = [F.stats(m, s) for m in mov]
    sil = [float(F.filled(m).sum()) * s * s for m in mov]
    return dict(scale=s, shape=shape, moving=mov, stats=st, area=sil, still=bool(still.any()))

def shape_change(a, b, shift):
    """how different two masks are once a is slid by `shift` working pixels (0 = same shape, 1 = nothing in common)"""
    if a.sum() < 8 or b.sum() < 8: return 1.0
    M = np.float32([[1, 0, shift[0]], [0, 1, shift[1]]])
    a2 = cv2.warpAffine(a.astype(np.uint8), M, (a.shape[1], a.shape[0])) > 0
    r = max(3, int(0.006 * a.shape[1]))
    da, db = F.dilate(a2, r), F.dilate(b, r)
    return float(1 - (da & db).sum() / max(1, (da | db).sum()))

def analyse(m, W, max_flags=6):
    """one mark per frame or step at most, and only the max_flags that matter most"""
    st, n = m['stats'], len(m['stats']); s = m['scale']
    C = np.array([x['center'] if x else [np.nan, np.nan] for x in st])
    ok = ~np.isnan(C[:, 0])
    steps = np.diff(C, axis=0); sp = np.hypot(steps[:, 0], steps[:, 1])           # spacing per transition
    pop = np.array([shape_change(m['moving'][i], m['moving'][i + 1], np.nan_to_num(steps[i]) / s) for i in range(n - 1)])
    area = np.array(m['area']); lr = np.log(np.maximum(area[1:], 1) / np.maximum(area[:-1], 1))
    small = 0.004 * W                                                              # under this, call it standing still
    med_sp = float(np.nanmedian(sp[sp > small])) if (sp > small).any() else 0.0
    base = float(np.median(pop)) if len(pop) else 0.0
    mad = (float(np.median(np.abs(pop - base))) if len(pop) else 0.0) + 0.02
    boards = base > 0.72                                 # nearly every step is a new pose: keys or boards, not inbetweens
    same = lambda i: 0 <= i < n - 1 and pop[i] < 0.62    # the subject keeps its shape over this step, so position and size mean something
    step_flags = {}; frame_flags = {}
    def put(store, i, kind, score, text):
        if i not in store or store[i]['score'] < score: store[i] = dict(kind=kind, frame=i + 1, between=store is step_flags, text=text, score=float(score))
    for i in range(n - 1):
        if np.isnan(sp[i]): continue
        ratio = sp[i] / med_sp if med_sp > 0 else 0
        if boards:
            if pop[i] > base + 1.5 * mad and pop[i] > 0.9 or (ratio > 2.2 and pop[i] >= base):
                put(step_flags, i, '+ BREAKDOWN', 3 + pop[i] + ratio / 4, 'the biggest jump in the sequence: shape changes %d%%, moves %d px' % (pop[i] * 100, sp[i]))
            continue
        if pop[i] > 0.8 or (pop[i] > 0.6 and ratio > 2.0):
            put(step_flags, i, '+ BREAKDOWN', 3 + pop[i] + ratio / 4, 'shape changes %d%% in one step%s' % (pop[i] * 100, ', and the step is %.1fx the usual' % ratio if ratio > 2 else ''))
        elif pop[i] > base + 3.5 * mad and pop[i] > 0.5:
            put(step_flags, i, 'POP', 2 + pop[i], 'shape changes %d%% (usual here: %d%%)' % (pop[i] * 100, base * 100))
    if not boards:
        for i in range(1, n - 2):                                                  # spacing against both neighbours
            a, b, c = sp[i - 1], sp[i], sp[i + 1]
            if np.isnan([a, b, c]).any() or not same(i): continue
            if b > small and b > 1.6 * max(a, c, small): put(step_flags, i, 'SPACING', 1 + b / max(a, c, small) / 4, 'step %d px, neighbours %d and %d' % (b, a, c))
            elif min(a, c) > 2 * small and b < 0.45 * min(a, c): put(step_flags, i, 'SPACING', 1 + min(a, c) / max(b, 1) / 8, 'step %d px, neighbours %d and %d (stall)' % (b, a, c))
        for i in range(n - 1):                                                     # size against the trend
            nb = [lr[j] for j in (i - 1, i + 1) if 0 <= j < n - 1]
            if not nb or not (ok[i] and ok[i + 1]) or not same(i): continue
            if abs(lr[i]) > np.log(1.3) and abs(lr[i] - np.mean(nb)) > np.log(1.3):
                put(step_flags, i, 'SIZE', 1 + abs(lr[i]), 'size x%.2f in one frame (neighbours x%.2f)' % (np.exp(lr[i]), np.exp(np.mean(nb))))
        for i in range(1, n - 1):                                                  # arcs
            if not (ok[i - 1] and ok[i] and ok[i + 1]) or not (same(i - 1) and same(i)): continue
            a, b = steps[i - 1], steps[i]; la, lb = np.hypot(*a), np.hypot(*b)
            if la < 2 * small or lb < 2 * small: continue
            turn = np.degrees(np.arccos(np.clip(a @ b / (la * lb), -1, 1)))
            if turn > 115: put(frame_flags, i, 'ARC', 2 + turn / 180, 'path doubles back (turns %d deg)' % turn); continue
            nb = [j for j in (i - 2, i - 1, i + 1, i + 2) if 0 <= j < n and ok[j]]
            if len(nb) >= 3:
                t = np.array(nb, float) - i; deg = 2 if len(nb) >= 4 else 1
                pred = np.array([np.polyval(np.polyfit(t, C[nb, k], deg), 0) for k in (0, 1)])
                off = float(np.hypot(*(C[i] - pred)))
                if off > 0.45 * (la + lb) / 2 and off > 3 * small: put(frame_flags, i, 'ARC', 1.5 + off / ((la + lb) / 2), '%d px off the smooth path through its neighbours' % off)
    allf = sorted(list(step_flags.values()) + list(frame_flags.values()), key=lambda f: -f['score'])
    notes = []
    if boards: notes.append('Nearly every step is a whole new pose (shape changes %d%% on a typical step), so this reads as keys or boards, not finished inbetweens. Arc, spacing and size checks need drawings that flow into each other, so only the biggest jumps are marked.' % (base * 100))
    if len(allf) > max_flags: notes.append('%d smaller things were left off to keep the sheet readable (see the json, or raise --max-flags).' % (len(allf) - max_flags))
    flags = sorted(allf[:max_flags], key=lambda f: (f['frame'], not f['between']))
    for f in flags: f['score'] = round(f['score'], 2)
    return dict(centers=C, spacing=sp, pop=pop, area=area, flags=flags, all_flags=allf, notes=notes, median_spacing=med_sp, boards=boards)

def sheet(files, m, a, cols=4, title=''):
    n = len(files); tw = 900; W0, H0 = imgio.load_flat(files[0]).size; th = int(tw * H0 / W0); gap = 22; rows = (n + cols - 1) // cols
    panel = 520; legend = 150
    SW = cols * tw + (cols + 1) * gap; SH = rows * (th + gap) + gap + panel + legend
    S = Image.new('RGB', (SW, SH), (245, 244, 247)); d = ImageDraw.Draw(S)
    per_frame = {}; per_gap = {}
    for f in a['flags']: (per_gap if f['between'] else per_frame).setdefault(f['frame'], []).append(f)
    for i, fp in enumerate(files):
        x = gap + (i % cols) * (tw + gap); y = gap + (i // cols) * (th + gap)
        im = imgio.load_flat(fp).resize((tw, th), Image.LANCZOS); S.paste(im, (x, y)); d.rectangle([x, y, x + tw - 1, y + th - 1], outline=(190, 188, 198), width=2)
        imgio.tag(d, (x + 14, y + 12), str(i + 1), bg=(30, 30, 36), size=34)
        c = a['centers'][i]
        if not np.isnan(c[0]):
            cx, cy = x + c[0] * tw / W0, y + c[1] * th / H0; d.ellipse([cx - 9, cy - 9, cx + 9, cy + 9], outline=(30, 30, 36), width=3)
        yy = y + th - 58
        for f in per_frame.get(i + 1, []):
            b = imgio.tag(d, (x + 14, yy), f['kind'], bg=COL[f['kind']], size=34); yy -= 56
        yy = y + th - 58
        for f in per_gap.get(i + 1, []):                      # marks for the step from this frame to the next sit at the right edge
            label = f['kind'] + ' >'
            wtxt = d.textlength(label, font=imgio.font(34))
            imgio.tag(d, (x + tw - wtxt - 22, yy), label, bg=COL[f['kind']], size=34); yy -= 56
    # path of the action
    py = rows * (th + gap) + gap; pw = SW // 2 - gap * 2; ph = panel - 70
    d.text((gap, py), 'Path of the action (frame numbers)', fill=(60, 60, 70), font=imgio.font(30))
    C = a['centers']; good = ~np.isnan(C[:, 0])
    if good.sum() >= 2:
        lo, hi = C[good].min(0), C[good].max(0); span = np.maximum(hi - lo, 1); k = min((pw - 120) / span[0], (ph - 100) / span[1])
        k = min(k, 0.6)                                         # never blow a tiny move up to look like a big one
        off = np.array([gap + 60 + (pw - 120 - span[0] * k) / 2, py + 70 + (ph - 100 - span[1] * k) / 2])
        P = (C - lo) * k + off; pts = [tuple(p) for p in P[good]]
        d.line(pts, fill=(120, 120, 130), width=4, joint='curve')
        arcs = {f['frame'] for f in a['flags'] if f['kind'] == 'ARC'}
        for i in range(len(C)):
            if not good[i]: continue
            x, y = P[i]; col = COL['ARC'] if (i + 1) in arcs else (30, 30, 36); r = 13 if (i + 1) in arcs else 8
            d.ellipse([x - r, y - r, x + r, y + r], fill=col); d.text((x + 14, y - 30), str(i + 1), fill=col, font=imgio.font(26))
    # spacing chart
    bx = SW // 2 + gap; bw = SW // 2 - gap * 2
    d.text((bx, py), 'Spacing: how far it moves each step (px)', fill=(60, 60, 70), font=imgio.font(30))
    sp = np.nan_to_num(a['spacing']); mx = max(sp.max() if len(sp) else 1, 1); n1 = max(len(sp), 1); cw = bw / n1
    marked = {f['frame']: f['kind'] for f in a['flags'] if f['between'] and f['kind'] in ('SPACING', '+ BREAKDOWN')}
    base_y = py + ph + 10
    for i, v in enumerate(sp):
        h = (ph - 90) * v / mx; x0 = bx + i * cw + cw * 0.15; col = COL[marked[i + 1]] if (i + 1) in marked else (150, 150, 162)
        d.rectangle([x0, base_y - h, x0 + cw * 0.7, base_y], fill=col)
        d.text((x0, base_y + 6), '%d>%d' % (i + 1, i + 2), fill=(90, 90, 100), font=imgio.font(22, False))
        d.text((x0, base_y - h - 30), '%d' % v, fill=(60, 60, 70), font=imgio.font(22, False))
    # legend
    ly = SH - legend + 30; x = gap
    used = [k for k in COL if any(f['kind'] == k for f in a['flags'])]
    if not used: d.text((x, ly), 'No flags.' if a['boards'] else 'No flags: arcs, spacing, shapes and sizes all run smoothly by these measures.', fill=(60, 60, 70), font=imgio.font(32))
    if a['boards']: d.text((gap, SH - 52), 'Reads as key poses or boards (every step is a new shape), so only the biggest jumps are marked.', fill=(110, 110, 120), font=imgio.font(28, False))
    for k in used:
        b = imgio.tag(d, (x, ly), k, bg=COL[k], size=30); d.text((b[2] + 12, ly), WHAT[k], fill=(60, 60, 70), font=imgio.font(28, False))
        x = b[2] + 30 + d.textlength(WHAT[k], font=imgio.font(28, False))
        if x > SW - 700: x = gap; ly += 54
    return S

def run(folder, out_dir=None, region=None, ignore=(), cols=4, all_ink=False, max_flags=6):
    files = imgio.frame_files(folder)
    if len(files) < 3: raise SystemExit('Need at least 3 frames in %s (found %d).' % (folder, len(files)))
    name = os.path.basename(os.path.normpath(folder)) if os.path.isdir(folder) else 'frames'
    out_dir = out_dir or os.path.join('out', 'motion_check', name)
    W0 = imgio.load_flat(files[0]).size[0]
    m = measure(files, region, ignore, all_ink); a = analyse(m, W0, max_flags)
    out = dict(frames=[os.path.basename(f) for f in files], measured='moving ink only' if m['still'] else 'all ink',
               centers=[[None if np.isnan(v) else round(float(v), 1) for v in c] for c in a['centers']],
               spacing_px=[None if np.isnan(v) else round(float(v), 1) for v in a['spacing']],
               shape_change=[round(float(v), 3) for v in a['pop']], size_px2=[round(float(v)) for v in a['area']], flags=a['flags'], notes=a['notes'],
               left_off=[f for f in a['all_flags'] if f not in a['flags']])
    files_out = dict(sheet=imgio.save(sheet(files, m, a, cols), imgio.out_path(out_dir, name + '_motion.png')), json=imgio.out_path(out_dir, name + '_motion.json'))
    with open(files_out['json'], 'w', encoding='utf-8') as fh: json.dump(out, fh, indent=1)
    return out, files_out

if __name__ == '__main__':
    ap = argparse.ArgumentParser(description='Flag broken arcs, uneven spacing, pops, size changes and gaps in a frame sequence.')
    ap.add_argument('frames'); ap.add_argument('--out'); ap.add_argument('--region'); ap.add_argument('--ignore', action='append', default=[])
    ap.add_argument('--cols', type=int, default=4); ap.add_argument('--all-ink', action='store_true'); ap.add_argument('--max-flags', type=int, default=6)
    a = ap.parse_args()
    res, files = run(a.frames, a.out, [int(v) for v in a.region.split(',')] if a.region else None,
                     [[int(v) for v in b.split(',')] for b in a.ignore], a.cols, a.all_ink, a.max_flags)
    print('%d frames, measured: %s' % (len(res['frames']), res['measured']))
    print('spacing px: ' + ' '.join('-' if v is None else str(int(v)) for v in res['spacing_px']))
    for f in res['flags']:
        where = 'frames %d>%d' % (f['frame'], f['frame'] + 1) if f['between'] else 'frame %d' % f['frame']
        print('  %-11s %-12s %s' % (f['kind'], where, f['text']))
    if not res['flags']: print('  no flags')
    for nt in res['notes']: print('  note: ' + nt)
    print('saved: ' + ', '.join(files.values()))
