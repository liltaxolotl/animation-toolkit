"""
animtk.lines
Find the straight lines in a drawing, group them into vanishing points, find the horizon,
and point out lines that almost go to a vanishing point but miss it.
"""
import os
import numpy as np, cv2

# ----------------------------------------------------------------- straight lines
def find_lines(gray, region=None, min_len=None, work_width=1920, stroke=None, ignore=()):
    """straight strokes in a drawing as an (n,4) array of x0,y0,x1,y1 in full-size pixels.
       gray     : 2D uint8, white paper.
       region   : optional (x0,y0,x1,y1) to look inside only (e.g. just the background).
       min_len  : shortest line worth keeping (default 4% of the width).
       stroke   : how far apart two detections can sit and still be the same pen stroke
                  (default 0.5% of the width, about 19 px on a 3840 canvas)."""
    H, W = gray.shape
    min_len = W * 0.04 if min_len is None else min_len
    stroke = W * 0.005 if stroke is None else stroke
    s = min(1.0, work_width / W)
    g = cv2.resize(gray, None, fx=s, fy=s, interpolation=cv2.INTER_AREA) if s < 1 else gray.copy()
    if region:
        x0, y0, x1, y1 = [int(v * s) for v in region]
        keep = np.full_like(g, 255); keep[y0:y1, x0:x1] = g[y0:y1, x0:x1]; g = keep
    for x0, y0, x1, y1 in ignore:                        # boxes to skip, e.g. the characters
        g[int(y0 * s):int(y1 * s), int(x0 * s):int(x1 * s)] = 255
    g = cv2.GaussianBlur(g, (3, 3), 0)
    try:
        segs = cv2.createLineSegmentDetector(0).detect(g)[0]
        segs = np.zeros((0, 4)) if segs is None else np.asarray(segs, float).reshape(-1, 4)
    except Exception:                                   # older OpenCV builds without LSD
        m = (g < 128).astype(np.uint8) * 255
        L = cv2.HoughLinesP(m, 1, np.pi / 720, 60, minLineLength=int(min_len * s * 0.4), maxLineGap=8)
        segs = np.zeros((0, 4)) if L is None else np.asarray(L, float).reshape(-1, 4)
    segs = segs / s
    if len(segs) == 0: return segs
    ln = np.hypot(segs[:, 2] - segs[:, 0], segs[:, 3] - segs[:, 1])
    segs = segs[ln >= min_len * 0.25]
    merged = merge_collinear(segs, ang_tol=2.5, dist_tol=stroke, gap_tol=min_len * 0.35)
    ln = np.hypot(merged[:, 2] - merged[:, 0], merged[:, 3] - merged[:, 1]) if len(merged) else np.zeros(0)
    return merged[ln >= min_len]

def merge_collinear(segs, ang_tol=2.5, dist_tol=14.0, gap_tol=50.0):
    """join pieces that lie on the same straight stroke (both edges of a thick line, broken dashes)"""
    segs = np.asarray(segs, float)
    if len(segs) == 0: return segs.reshape(0, 4)
    ln = np.hypot(segs[:, 2] - segs[:, 0], segs[:, 3] - segs[:, 1])
    order = np.argsort(-ln); segs = segs[order]; ln = ln[order]
    ang = np.arctan2(segs[:, 3] - segs[:, 1], segs[:, 2] - segs[:, 0]) % np.pi
    used = np.zeros(len(segs), bool); out = []
    P0, P1 = segs[:, :2], segs[:, 2:]
    for i in range(len(segs)):
        if used[i]: continue
        used[i] = True; member = [i]
        for _ in range(3):
            pts = np.vstack([P0[member], P1[member]]); wts = np.r_[ln[member], ln[member]]
            c = (pts * wts[:, None]).sum(0) / wts.sum()
            q = (pts - c) * np.sqrt(wts)[:, None]
            d = np.linalg.svd(q, full_matrices=False)[2][0]; n = np.array([-d[1], d[0]])
            a0 = np.arctan2(d[1], d[0]) % np.pi
            da = np.abs(ang - a0); da = np.minimum(da, np.pi - da)
            near = (~used) & (da < np.radians(ang_tol)) & (np.abs((P0 - c) @ n) < dist_tol) & (np.abs((P1 - c) @ n) < dist_tol)
            cand = np.where(near)[0]
            if len(cand) == 0: break
            t = np.sort((pts - c) @ d); lo, hi = t[0], t[-1]; grew = False
            for j in cand[np.argsort(np.minimum(np.abs((P0[cand] - c) @ d), np.abs((P1[cand] - c) @ d)))]:
                a, b = sorted(((P0[j] - c) @ d, (P1[j] - c) @ d))
                if a <= hi + gap_tol and b >= lo - gap_tol:
                    member.append(j); used[j] = True; lo, hi = min(lo, a), max(hi, b); grew = True
            if not grew: break
        pts = np.vstack([P0[member], P1[member]]); wts = np.r_[ln[member], ln[member]]
        c = (pts * wts[:, None]).sum(0) / wts.sum()
        d = np.linalg.svd((pts - c) * np.sqrt(wts)[:, None], full_matrices=False)[2][0]
        t = (pts - c) @ d
        out.append(np.r_[c + d * t.min(), c + d * t.max()])
    return np.array(out)

# ----------------------------------------------------------------- vanishing points
def _prep(lines, W, H):
    L = np.asarray(lines, float); s = W / 2.0; c = np.array([W / 2.0, H / 2.0])
    a = (L[:, :2] - c) / s; b = (L[:, 2:] - c) / s
    mid = (a + b) / 2; d = b - a; ln = np.hypot(d[:, 0], d[:, 1]); d = d / ln[:, None]
    hom = np.cross(np.c_[a, np.ones(len(a))], np.c_[b, np.ones(len(b))])
    hom /= np.hypot(hom[:, 0], hom[:, 1])[:, None]
    return dict(a=a, b=b, mid=mid, d=d, len=ln, hom=hom, s=s, c=c)

def deviation(P, v):
    """angle in degrees between each line and the direction from its middle to point v (homogeneous).
       0 = the line aims exactly at v."""
    v = np.atleast_2d(v)
    t = v[:, None, :2] - v[:, None, 2:3] * P['mid'][None]
    cr = np.abs(P['d'][None, :, 0] * t[..., 1] - P['d'][None, :, 1] * t[..., 0])
    return np.degrees(np.arcsin(np.clip(cr / (np.hypot(t[..., 0], t[..., 1]) + 1e-12), 0, 1)))

def _beyond(P, v, frac=0.25):
    """True where v sits clearly past the end of the line (a real vanishing point), False where the
       line touches or crosses v (that is a corner where edges meet, not a vanishing point)."""
    v = np.atleast_2d(v); w = v[:, 2:3]
    far = np.abs(w) < 1e-6
    p = v[:, :2] / np.where(far, 1, w)
    da = np.hypot(*(P['a'][None] - p[:, None]).transpose(2, 0, 1))
    db = np.hypot(*(P['b'][None] - p[:, None]).transpose(2, 0, 1))
    return far | ((np.minimum(da, db) > frac * P['len'][None]) & (np.maximum(da, db) > P['len'][None] * 0.999))

def _refine(P, idx, wt):
    A = P['hom'][idx] * np.sqrt(wt[idx])[:, None]
    v = np.linalg.svd(A, full_matrices=False)[2][-1]
    return v / np.linalg.norm(v)

def _as_parallel(P, v, wt, free, tol):
    """A vanishing point is only believable if the lines really fan toward it.
       Compares it with the simpler story "these lines are just parallel": if one shared direction
       explains about as much linework as the point does, returns that direction (a point at
       infinity), else None."""
    if abs(v[2]) <= 1e-9: return None
    inl = (deviation(P, v)[0] < tol) & free
    if inl.sum() < 2: return None
    th = np.arctan2(P['d'][:, 1], P['d'][:, 0])
    mean = lambda m: 0.5 * np.arctan2((wt[m] * np.sin(2 * th[m])).sum(), (wt[m] * np.cos(2 * th[m])).sum())
    a = mean(inl)
    for _ in range(3):
        u = np.array([np.cos(a), np.sin(a), 0.0]); pin = (deviation(P, u)[0] < tol) & free
        if pin.sum() < 2: return None
        a = mean(pin)
    return u if wt[pin].sum() >= 0.8 * wt[inl].sum() else None

def find_vanishing_points(lines, W, H, tol=2.5, max_vps=3, min_lines=4, flag_tol=6.0, min_support=0.4, min_share=0.25,
                          max_maybe=4, maybe_share=0.08):
    """group lines into families that share a vanishing point.
       min_support : a family's lines must add up to this many canvas widths, so a few short
                     strokes that happen to line up do not count.
       min_share   : and to this share of the linework not yet explained. Sketchy character lines
                     line up by chance all the time; real architecture carries far more ink.
       Families that clear both bars are marked sure. Weaker ones (down to maybe_share) are kept as
       "maybe" so a person can look at the picture and decide; numbers alone cannot tell a floor grid
       from fingers that happen to fan out.
       Returns (families, assign): families = list of dicts {v (homogeneous, normalized coords),
       xy (pixels, or None if the lines are parallel), lines (indices), sure}; assign[i] = family or -1."""
    n = len(lines)
    if n < min_lines: return [], np.full(n, -1)
    P = _prep(lines, W, H); wt = P['len'] / P['len'].sum(); find_vanishing_points.dropped = 0
    need = min_support * W / (P['len'].sum() * P['s'])                 # support threshold in wt units
    top = np.argsort(-P['len'])[:160]
    free = np.ones(n, bool); seedable = np.ones(n, bool); fams = []; n_sure = n_maybe = 0
    for _ in range(max_vps + max_maybe + 3):
        if n_sure >= max_vps and n_maybe >= max_maybe: break
        cand_idx = [i for i in top if free[i] and seedable[i]]
        if len(cand_idx) < 2 or free.sum() < min_lines: break
        ii, jj = np.triu_indices(len(cand_idx), 1); ci = np.array(cand_idx)
        V = np.cross(P['hom'][ci[ii]], P['hom'][ci[jj]])
        nv = np.linalg.norm(V, axis=1); ok = nv > 1e-9; V = V[ok] / nv[ok][:, None]
        if len(V) == 0: break
        best = (0, None, None)
        for k in range(0, len(V), 2000):
            v = V[k:k + 2000]
            inl = (deviation(P, v) < tol) & _beyond(P, v) & free[None]
            sc = (inl * wt[None]).sum(1); cnt = inl.sum(1); sc[cnt < min_lines] = 0
            b = int(np.argmax(sc))
            if sc[b] > best[0]: best = (sc[b], v[b], inl[b])
        if best[1] is None: break
        v, inl = best[1], best[2]
        for _ in range(4):
            idx = np.where(inl)[0]
            if len(idx) < 2: break
            v = _refine(P, idx, wt)
            inl = (deviation(P, v)[0] < tol) & _beyond(P, v)[0] & free
        par = _as_parallel(P, v, wt, free, tol)
        if par is not None:
            v = par; inl = (deviation(P, v)[0] < tol) & free
        idx = np.where(inl)[0]
        if len(idx) == 0: break
        share = wt[idx].sum() / wt[free].sum()
        if os.environ.get('ANIMTK_DEBUG'): print('family', 'parallel' if par is not None else 'point', len(idx), 'lines, share of free ink %.2f' % share)
        if len(idx) < min_lines:
            seedable[idx] = False; continue
        sure = wt[idx].sum() >= max(need, min_share * wt[free].sum())
        if sure and n_sure < max_vps:
            fams.append(dict(v=v, parallel=par is not None, sure=True)); free[idx] = False; n_sure += 1
            seedable &= deviation(P, v)[0] > (12.0 if par is not None else flag_tol)   # near misses of this point never seed a new one
        elif share >= maybe_share and n_maybe < max_maybe:
            fams.append(dict(v=v, parallel=par is not None, sure=False)); free[idx] = False; n_maybe += 1
            seedable &= deviation(P, v)[0] > (12.0 if par is not None else flag_tol)
        else:
            seedable[idx] = False; find_vanishing_points.dropped += 1
    if not fams: return [], np.full(n, -1)
    D = np.stack([deviation(P, f['v'])[0] for f in fams]); OKb = np.stack([_beyond(P, f['v'])[0] for f in fams])
    D2 = np.where(OKb, D, 999); sure = np.array([f['sure'] for f in fams])
    assign = np.full(n, -1)
    for mask in (sure, ~sure):                              # sure families claim their lines first
        if not mask.any(): continue
        ks = np.where(mask)[0]; sub = D2[ks]; best = ks[np.argmin(sub, 0)]; okl = (sub.min(0) < tol) & (assign < 0)
        assign[okl] = best[okl]
    keep = []
    for k, f in enumerate(fams):
        idx = np.where(assign == k)[0]
        if len(idx) < min_lines: assign[assign == k] = -1; continue
        if not f['parallel']: f['v'] = _refine(P, idx, wt)
        keep.append(k)
    remap = {k: i for i, k in enumerate(keep)}
    assign = np.array([remap.get(a, -1) for a in assign]); fams = [fams[k] for k in keep]
    for k, f in enumerate(fams):
        f['lines'] = [int(i) for i in np.where(assign == k)[0]]
        v = f['v']; f['xy'] = None
        if abs(v[2]) > 1e-9:
            xy = v[:2] / v[2] * P['s'] + P['c']
            if np.hypot(*(xy - P['c'])) < 8 * W: f['xy'] = [float(xy[0]), float(xy[1])]
        dd = P['d'][f['lines']]; th2 = 2 * np.arctan2(dd[:, 1], dd[:, 0]); ww = P['len'][f['lines']]
        f['angle'] = float(np.degrees(0.5 * np.arctan2((ww * np.sin(th2)).sum(), (ww * np.cos(th2)).sum())))  # average direction of its lines
        f['weight'] = float(wt[f['lines']].sum())
        dv = deviation(P, v)[0]; band = dv[(dv < flag_tol)]
        f['looseness'] = float(1.4826 * np.median(band)) if len(band) else 0.0   # how wobbly the drawing is around this point
    return fams, assign

def analyze(lines, W, H, tol=2.5, flag_tol=6.0, flag_len=None, max_vps=3, default_fov=60.0, max_flags=8, min_share=0.25, pick=()):
    """full read of a drawing's perspective. Returns a plain dict ready for JSON.
       A line gets flagged when it runs close to a sure family but is clearly further off than that
       family's own wobble (so a loose sketch is not punished for being loose). Only the worst
       max_flags are kept. pick = numbers of "maybe" groups to trust (after looking at the picture)."""
    lines = np.asarray(lines, float); n = len(lines)
    flag_len = W * 0.06 if flag_len is None else flag_len
    fams, assign = find_vanishing_points(lines, W, H, tol, max_vps, flag_tol=flag_tol, min_share=min_share)
    dropped = getattr(find_vanishing_points, 'dropped', 0)
    out = dict(canvas=[W, H], vanishing_points=[], horizon=None, lines=[], flags=[], notes=[], camera=None)
    c = np.array([W / 2, H / 2])
    maybes = sorted([k for k in range(len(fams)) if not fams[k]['sure']], key=lambda k: -fams[k]['weight'])
    for num, k in enumerate(maybes, 1):
        fams[k]['maybe_no'] = num
        if num in pick: fams[k]['sure'] = True; fams[k]['picked'] = True
    for f in fams:
        a = abs(((f['angle'] + 90) % 180) - 90)                   # 0 = horizontal lines, 90 = vertical lines
        if f['xy'] is None: kind = 'vertical' if a > 62 else 'parallel'
        elif a > 62 and abs(f['xy'][1] - c[1]) > H * 0.75: kind = 'vertical'
        else: kind = 'vp'
        f['kind'] = kind
    order = sorted(range(len(fams)), key=lambda k: (not fams[k]['sure'], fams[k]['kind'] != 'vp', -fams[k]['weight']))
    names = {}; nvp = 0; seen = {}
    for k in order:
        f = fams[k]
        if not f['sure']: nm = 'maybe %d' % f['maybe_no']
        elif f['kind'] == 'vp': nvp += 1; nm = 'VP%d' % nvp
        elif f['kind'] == 'vertical': nm = 'verticals' if f['xy'] is None else ('VP up' if f['xy'][1] < c[1] else 'VP down')
        else: nm = 'parallels'
        seen[nm] = seen.get(nm, 0) + 1
        names[k] = nm if seen[nm] == 1 else '%s %d' % (nm, seen[nm])
        out['vanishing_points'].append(dict(name=names[k], kind=f['kind'], sure=bool(f['sure']), xy=f['xy'], line_angle=round(f['angle'], 2),
                                            line_count=len(f['lines']), looseness_deg=round(f['looseness'], 2)))
    all_fams = fams; all_names = names
    sure_k = [k for k in range(len(fams)) if fams[k]['sure']]
    P = _prep(lines, W, H) if n else None
    D = np.stack([deviation(P, f['v'])[0] for f in fams]) if fams else np.zeros((0, n))
    ln = np.hypot(lines[:, 2] - lines[:, 0], lines[:, 3] - lines[:, 1]) if n else np.zeros(0)
    cands = []
    for i in range(n):
        rec = dict(id=i, xyxy=[round(float(v), 1) for v in lines[i]], group=None, off_deg=None)
        if assign[i] >= 0:
            rec['group'] = names[int(assign[i])]; rec['off_deg'] = round(float(D[assign[i], i]), 2)
        elif sure_k:
            k = sure_k[int(np.argmin(D[sure_k, i]))]
            if max(tol, 3 * fams[k]['looseness']) < D[k, i] <= flag_tol and ln[i] >= flag_len:
                miss = None
                if fams[k]['xy'] is not None:
                    x0, y0, x1, y1 = lines[i]; d = np.array([x1 - x0, y1 - y0]) / ln[i]
                    miss = float(abs((np.array(fams[k]['xy']) - [x0, y0]) @ np.array([-d[1], d[0]])))
                cands.append((D[k, i] * ln[i], dict(line=i, near=names[k], off_deg=round(float(D[k, i]), 2),
                                                    miss_px=None if miss is None else round(miss))))
        out['lines'].append(rec)
    cands.sort(key=lambda t: -t[0])
    out['flags'] = [f for _, f in cands[:max_flags]]
    if len(cands) > max_flags:
        out['notes'].append('%d more lines are a little off; only the %d that stand out most are marked.' % (len(cands) - max_flags, max_flags))
    for f in out['flags']: out['lines'][f['line']]['flag'] = dict(near=f['near'], off_deg=f['off_deg'], miss_px=f['miss_px'])
    # horizon
    vps = [fams[k] for k in order if fams[k]['kind'] == 'vp' and fams[k]['sure']]
    par = [f for f in fams if f['kind'] == 'parallel' and f['sure']]
    ver = [f for f in fams if f['kind'] == 'vertical' and f['sure']]
    sure_f = [f for f in fams if f['sure']]; n_maybe = len(fams) - len(sure_f)
    hz = None
    if len(vps) >= 2:
        p, q = np.array(vps[0]['xy']), np.array(vps[1]['xy'])
        hz = dict(point=vps[0]['xy'], angle=_hang(q - p), basis='through VP1 and VP2')
    elif len(vps) == 1 and par:
        a = np.radians(par[0]['angle'])
        hz = dict(point=vps[0]['xy'], angle=_hang(np.array([np.cos(a), np.sin(a)])), basis='through VP1, along the parallel lines')
    elif len(vps) == 1 and ver:
        a = np.radians(ver[0]['angle'] + 90)
        hz = dict(point=vps[0]['xy'], angle=_hang(np.array([np.cos(a), np.sin(a)])), basis='through VP1, square to the verticals')
    elif len(vps) == 1:
        hz = dict(point=vps[0]['xy'], angle=0.0, basis='through VP1, assumed level (nothing else to go on)')
    if hz:
        hz['angle'] = round(hz['angle'], 2)
        t = np.tan(np.radians(hz['angle']))
        hz['y_at_left'] = round(hz['point'][1] + (0 - hz['point'][0]) * t, 1)
        hz['y_at_center'] = round(hz['point'][1] + (W / 2 - hz['point'][0]) * t, 1)
        hz['y_at_right'] = round(hz['point'][1] + (W - hz['point'][0]) * t, 1)
        out['horizon'] = hz
    # camera guess that scene_render.py and the app can load
    from .scene3d import camera_from_vps
    if vps:
        vv = sorted(vps[:2], key=lambda f: np.hypot(*(np.array(f['xy']) - c)))
        side = vv[1]['xy'] if len(vv) > 1 else None
        cam, notes = camera_from_vps(vv[0]['xy'], side, fov=default_fov, roll=hz['angle'] if hz else 0.0, W=W, H=H)
        out['camera'] = cam.to_dict(); out['notes'] += notes
        if side is None:
            out['notes'].append('One vanishing point only, so lens width is a guess (%.0f). Set it by eye in the app or with --fov.' % default_fov)
    elif (par or ver) and all(f['xy'] is None for f in sure_f):
        tilt = [f for f in par if abs(((f['angle'] + 90) % 180) - 90) < 28]
        out['notes'].append('Lines run side by side instead of meeting, so this reads as a flat-on view: no vanishing point or horizon to find.')
        if tilt: out['notes'].append('The level lines lean %.1f degrees (0 = dead level).' % tilt[0]['angle'])
        if ver: out['notes'].append('The upright lines lean %.1f degrees off straight up.' % (90 - abs(ver[0]['angle'])))
    elif not sure_f:
        out['notes'].append('No group of straight lines is strong enough to call a vanishing point for sure. '
                            'For a board that is mostly characters, mark the perspective by hand in the app instead.')
    if n_maybe:
        out['notes'].append('%d possible groups are drawn as "maybe": too little ink behind them to be sure (arms and fingers fan out too). '
                            'Look at the picture; if one is right, rerun with --pick and its number.' % n_maybe)
    return out

def _hang(d):
    """direction as a horizon angle in degrees, -90..90 (positive = drops toward the right)"""
    a = np.degrees(np.arctan2(d[1], d[0]))
    return float(((a + 90) % 180) - 90)

# kept from perspective_toolkit.py for scripts that already use them
def vanishing_point(lines):
    """least-squares point closest to all given lines (they should belong to one direction)"""
    A = []; b = []
    for x0, y0, x1, y1 in lines:
        n = np.array([y1 - y0, -(x1 - x0)]); n /= np.linalg.norm(n); A.append(n); b.append(n @ [x0, y0])
    return np.linalg.lstsq(np.array(A), np.array(b), rcond=None)[0]

def miss_distance(line, vp):
    """how many pixels a drawn line misses a vanishing point by"""
    x0, y0, x1, y1 = line; d = np.array([x1 - x0, y1 - y0]); d /= np.linalg.norm(d); n = np.array([-d[1], d[0]])
    return abs((np.asarray(vp) - [x0, y0]) @ n)
