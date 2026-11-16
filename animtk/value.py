"""
animtk.value
Value checks: a drawing as a pure black silhouette, and as plain grayscale.

Three ways to find the silhouette, picked automatically unless told:
    alpha   the PNG has a transparent background: everything painted is the figure
    lines   line art on white paper: small gaps in the linework are closed, then everything the
            paper outside cannot reach is filled in
    tone    painted or toned frames: everything darker than a threshold is the figure

The line-art method is mirrored in animation_app.html (value mode); tests/test_app_camera.mjs keeps them equal.
"""
import numpy as np, cv2

INK = 140          # darker than this is linework
WORK = 960         # silhouettes are worked out on a copy this wide
K3 = np.ones((3, 3), np.uint8)

def luminance(rgb):
    """RGB array -> grayscale array (0 black .. 255 white), the usual TV weights"""
    a = np.asarray(rgb, np.float32)
    return np.clip(a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114 + 0.5, 0, 255).astype(np.uint8)

def posterize(gray, levels):
    """squash the grays into a few flat steps (3 = dark, middle, light). 0 or 1 leaves it alone."""
    if not levels or levels < 2: return gray
    n = levels - 1
    return (np.round(gray.astype(np.float32) / 255 * n) / n * 255 + 0.5).astype(np.uint8)

def otsu(gray):
    t, _ = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return int(t)

def pick_mode(gray, alpha=None):
    if alpha is not None:
        clear = float((alpha < 128).mean())
        if 0.02 < clear < 0.995: return 'alpha'
    # painted or toned = dark areas too fat to be linework (they survive being shrunk by a brush width)
    s = min(1.0, WORK / gray.shape[1])
    small = cv2.resize(gray, (max(1, int(round(gray.shape[1] * s))), max(1, int(round(gray.shape[0] * s)))), interpolation=cv2.INTER_AREA) if s < 1 else gray
    solid = cv2.erode((small < 200).astype(np.uint8), K3, iterations=7)
    return 'tone' if float(solid.mean()) > 0.03 else 'lines'

def regions(gray, gap=4):
    """line-art step 1: thicken the ink so small gaps close, then number every patch of paper.
       Returns (ink, barrier, labels, info). labels: 0 = ink barrier, 1.. = paper patches.
       info[i] = dict(area, sides) for patch i; sides = how many frame edges it touches."""
    ink = gray < INK
    barrier = cv2.dilate(ink.astype(np.uint8), K3, iterations=int(gap)).astype(bool) if gap > 0 else ink.copy()
    n, labels = cv2.connectedComponents((~barrier).astype(np.uint8), connectivity=4)
    info = [None]
    area = np.bincount(labels.ravel(), minlength=n)
    edges = [labels[:, 0], labels[0, :], labels[:, -1], labels[-1, :]]
    touch = np.zeros((n, 4), bool)
    for k, e in enumerate(edges): touch[np.unique(e), k] = True
    for i in range(1, n): info.append(dict(area=int(area[i]), sides=int(touch[i].sum())))
    return ink, barrier, labels, info

def outside_labels(info, edge='auto'):
    """which paper patches are background. A patch touching the frame edge is background, except
       (edge='auto') a patch that touches only ONE side and is not the biggest: that is usually an arm or
       a body cut off by the frame, so it counts as figure. edge='open' = every patch that touches the frame is background."""
    touching = [i for i in range(1, len(info)) if info[i]['sides'] > 0]
    out = set()
    if not touching: return out, []
    big = max(touching, key=lambda i: (info[i]['area'], -i))
    cut = []
    for i in touching:
        if edge == 'open' or info[i]['sides'] >= 2 or i == big: out.add(i)
        else: cut.append(i)
    return out, cut

def _label_at(labels, x, y, reach=6):
    h, w = labels.shape; x = int(min(max(x, 0), w - 1)); y = int(min(max(y, 0), h - 1))
    if labels[y, x]: return int(labels[y, x])
    for r in range(1, reach + 1):                      # landed on a line: take the nearest patch
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                X, Y = x + dx, y + dy
                if 0 <= X < w and 0 <= Y < h and labels[Y, X]: return int(labels[Y, X])
    return 0

def silhouette_lines(gray, gap=4, fills=(), clears=(), edge='auto'):
    """line art -> figure mask (True = black). fills / clears = [(x, y)] in this array's pixels: the patch
       of paper at that point is forced to figure / to background. Returns (mask, note dict)."""
    ink, barrier, labels, info = regions(gray, gap)
    out, cut = outside_labels(info, edge)
    for x, y in clears:
        i = _label_at(labels, x, y)
        if i: out.add(i)
    for x, y in fills:
        i = _label_at(labels, x, y)
        if i: out.discard(i)
    lut = np.ones(len(info), bool); lut[list(out)] = False; lut[0] = True          # True = figure (barrier counts until shrunk back)
    fig = lut[labels]
    if gap > 0: fig = cv2.erode(fig.astype(np.uint8), K3, iterations=int(gap)).astype(bool)
    fig |= ink
    return fig, dict(patches=len(info) - 1, cut_by_frame=len([i for i in cut if i not in out]))

def silhouette(gray, alpha=None, mode='auto', gap=4, threshold=None, fills=(), clears=(), edge='auto'):
    """figure mask at the size of `gray`. Works on a copy WORK px wide and scales the answer back up.
       fills / clears are in full-size pixels. Returns (mask bool, info dict)."""
    h, w = gray.shape; s = min(1.0, WORK / w); sw, sh = max(1, int(round(w * s))), max(1, int(round(h * s)))
    if mode == 'auto': mode = pick_mode(gray, alpha)
    info = dict(mode=mode)
    if mode == 'alpha':
        if alpha is None: raise SystemExit('alpha mode needs a PNG with a transparent background.')
        mask = alpha >= 128
    elif mode == 'tone':
        t = otsu(gray) + 1 if threshold is None else int(threshold); info['threshold'] = t
        mask = gray < t
    else:
        small = cv2.resize(gray, (sw, sh), interpolation=cv2.INTER_AREA) if s < 1 else gray
        m, note = silhouette_lines(small, gap, [(x * s, y * s) for x, y in fills], [(x * s, y * s) for x, y in clears], edge)
        info.update(note); info['gap'] = gap
        mask = cv2.resize(m.astype(np.uint8) * 255, (w, h), interpolation=cv2.INTER_LINEAR) >= 128 if s < 1 else m
    info['coverage'] = round(float(mask.mean()) * 100, 1)
    n, _ = cv2.connectedComponents(cv2.resize(mask.astype(np.uint8), (sw, sh), interpolation=cv2.INTER_NEAREST), connectivity=8)
    info['pieces'] = int(n - 1)
    return mask, info

def separation(gray, mask):
    """how far apart the figure and the background are in value, on a 0..100 scale (0 = same gray).
       Only means something for toned or painted frames. Returns dict or None."""
    if mask.all() or not mask.any(): return None
    f, b = float(gray[mask].mean()) / 2.55, float(gray[~mask].mean()) / 2.55
    return dict(figure=round(f, 1), background=round(b, 1), separation=round(abs(f - b), 1))
