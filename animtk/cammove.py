"""
animtk.cammove
Camera moves over a big background: pans, zooms, or both.

Words used here
    field    the finished frame the audience sees (3840 x 1920 unless told otherwise)
    key      a camera position at a frame: where its center is, and how far it is zoomed in
             x, y  = center of the view, in field pixels at 100%, measured from wherever you like
                     (usually the first key is 0,0; right and down are positive)
             zoom  = 1.0 is 100% (the view covers one field), 2.0 is 200% (zoomed in, sees half as much)
    canvas   the big artwork the camera travels over. It is sized so that every view fits inside it
             and so that the tightest zoom still has one canvas pixel per finished pixel.

The same math is mirrored in animation_app.html (camera mode); tests/test_app_camera.mjs keeps them equal.
"""
import numpy as np, cv2

def ease(t, kind='inout'):
    t = min(max(t, 0.0), 1.0)
    if kind == 'linear': return t
    if kind == 'in': return t * t
    if kind == 'out': return 1 - (1 - t) ** 2
    return t * t * (3 - 2 * t)

def frames(keys):
    """camera per frame from first key to last. keys = [{frame, x, y, zoom, ease?}], sorted by frame.
       Position moves in a straight line with easing; zoom changes by equal ratios so it feels even."""
    keys = sorted(keys, key=lambda k: k['frame']); out = []
    if len(keys) == 1: return [dict(frame=int(keys[0]['frame']), x=float(keys[0]['x']), y=float(keys[0]['y']), zoom=float(keys[0]['zoom']))]
    for a, b in zip(keys[:-1], keys[1:]):
        f0, f1 = int(a['frame']), int(b['frame'])
        for f in range(f0, f1 + (1 if b is keys[-1] else 0)):
            e = ease((f - f0) / max(1, f1 - f0), a.get('ease', 'inout'))
            out.append(dict(frame=f, x=a['x'] + (b['x'] - a['x']) * e, y=a['y'] + (b['y'] - a['y']) * e,
                            zoom=a['zoom'] * (b['zoom'] / a['zoom']) ** e))
    return out

def plan(keys, W=3840, H=1920, margin=0.0):
    """everything needed to build and shoot the move.
       margin = extra room around the whole move, as a share of the field (0.05 = 5% spare on every side).
       Returns dict:
         canvas        [w, h] of the big artwork in pixels
         zoom_max      tightest zoom in the move
         origin        world position of the canvas's top-left corner
         rows          one per frame:
            frame, x, y, zoom            the camera
            canvas_cx, canvas_cy         camera center on the big canvas (pixels)
            view_w, view_h               how much of the canvas the frame covers (pixels)
            layer_scale                  scale % to give the canvas layer in a field-sized comp
            layer_x, layer_y             where the CENTER of the canvas layer goes in that comp (pixels)
            place_x, place_y, place_scale  where a field-sized drawing made for this frame sits on the
                                         big canvas: its top-left corner, and the scale % to give it"""
    fr = frames(keys); zmax = max(f['zoom'] for f in fr)
    x0 = min(f['x'] - W / (2 * f['zoom']) for f in fr) - margin * W; x1 = max(f['x'] + W / (2 * f['zoom']) for f in fr) + margin * W
    y0 = min(f['y'] - H / (2 * f['zoom']) for f in fr) - margin * H; y1 = max(f['y'] + H / (2 * f['zoom']) for f in fr) + margin * H
    cw = int(np.ceil((x1 - x0) * zmax / 2 - 1e-9) * 2); ch = int(np.ceil((y1 - y0) * zmax / 2 - 1e-9) * 2)
    bcx, bcy = (x0 + x1) / 2, (y0 + y1) / 2
    ox, oy = bcx - cw / (2 * zmax), bcy - ch / (2 * zmax)            # world position of canvas pixel (0, 0)
    rows = []
    for f in fr:
        z = f['zoom']
        rows.append(dict(frame=f['frame'], x=round(f['x'], 2), y=round(f['y'], 2), zoom=round(z, 5),
                         canvas_cx=round((f['x'] - ox) * zmax, 1), canvas_cy=round((f['y'] - oy) * zmax, 1),
                         view_w=round(W / z * zmax, 1), view_h=round(H / z * zmax, 1),
                         layer_scale=round(z / zmax * 100, 3),
                         layer_x=round(W / 2 + (bcx - f['x']) * z, 1), layer_y=round(H / 2 + (bcy - f['y']) * z, 1),
                         place_x=round((f['x'] - W / (2 * z) - ox) * zmax, 1), place_y=round((f['y'] - H / (2 * z) - oy) * zmax, 1),
                         place_scale=round(zmax / z * 100, 3)))
    return dict(field=[W, H], canvas=[cw, ch], zoom_max=round(zmax, 5), origin=[round(ox, 2), round(oy, 2)], margin=margin,
                keys=[dict(frame=int(k['frame']), x=float(k['x']), y=float(k['y']), zoom=float(k['zoom']), ease=k.get('ease', 'inout')) for k in sorted(keys, key=lambda k: k['frame'])],
                rows=rows)

def check(p):
    """proof that the move never runs off the canvas: worst overhang in pixels (0 = safe)"""
    cw, ch = p['canvas']; worst = 0.0
    for r in p['rows']:
        worst = max(worst, r['view_w'] / 2 - r['canvas_cx'], r['canvas_cx'] + r['view_w'] / 2 - cw, r['view_h'] / 2 - r['canvas_cy'], r['canvas_cy'] + r['view_h'] / 2 - ch)
    return max(0.0, worst)

# ----------------------------------------------------------------- reading a move off two key drawings
_EW = 480                                    # drawings are compared on copies this wide

def _ink(gray):
    s = _EW / gray.shape[1]
    g = cv2.resize(gray, (_EW, int(round(gray.shape[0] * s))), interpolation=cv2.INTER_AREA)
    return (g < 140).astype(np.uint8), s

def _agreement(a, b, z, dx, dy, tol=2):
    """lay B over A using a guessed move and count how much linework lands on linework.
       Returns (score 0..1 above chance, share of the frame the two drawings have in common)."""
    h, w = a.shape
    M = np.float32([[1 / z, 0, w / 2 * (1 - 1 / z) - dx], [0, 1 / z, h / 2 * (1 - 1 / z) - dy]])
    bw = cv2.warpAffine(b * 255, M, (w, h), flags=cv2.INTER_LINEAR) > 100
    seen = cv2.warpAffine(np.full((h, w), 255, np.uint8), M, (w, h), flags=cv2.INTER_NEAREST) > 0
    k = np.ones((2 * tol + 1, 2 * tol + 1), np.uint8)
    am = (a > 0) & seen; bm = bw & seen; common = float(seen.mean())
    if am.sum() < 40 or bm.sum() < 40: return 0.0, common
    fat_a = cv2.dilate(am.astype(np.uint8), k) > 0; fat_b = cv2.dilate(bm.astype(np.uint8), k) > 0
    def score(ink, fat):
        hit = float((ink & fat).sum()) / ink.sum(); chance = float(fat[seen].mean())
        return max(0.0, (hit - chance) / max(1e-6, 1 - chance))
    return (score(am, fat_b) + score(bm, fat_a)) / 2, common

def estimate(gray_a, gray_b, zooms=None):
    """how the camera moved between two key drawings, read from the lines they share (the background).
       Returns dict(zoom_ratio, dx, dy, confidence, common):
         zoom_ratio  zoom of B divided by zoom of A (1 = no zoom)
         dx, dy      how far the camera center moved from A to B, in A's field pixels at A's zoom
         confidence  0..1: how much of the linework lands on linework once B is laid over A with this move
                     (0 = no better than chance). 0.5 and up is a good match, under 0.3 do not trust it.
         common      share of the frame the two drawings have in common after the move
       It can only see lines that are in both drawings and hold still in the world. A character moving
       through the shot lowers the confidence; keys that share less than about half a frame cannot be read."""
    a, s = _ink(gray_a); b, _ = _ink(gray_b); h, w = a.shape
    A = cv2.GaussianBlur(a.astype(np.float32), (0, 0), 2.0); B = cv2.GaussianBlur(b.astype(np.float32), (0, 0), 2.0)
    win = cv2.createHanningWindow((w, h), cv2.CV_32F)
    zooms = np.exp(np.linspace(np.log(0.5), np.log(2.0), 29)) if zooms is None else np.asarray(zooms, float)
    def slide(z):
        # undo B's extra zoom about the center, then see how well it slides onto A
        M = np.float32([[1 / z, 0, w / 2 * (1 - 1 / z)], [0, 1 / z, h / 2 * (1 - 1 / z)]])
        (dx, dy), resp = cv2.phaseCorrelate(A, cv2.warpAffine(B, M, (w, h), flags=cv2.INTER_LINEAR), win)
        return resp, dx, dy
    def judge(z):
        resp, dx, dy = slide(z); sc, common = _agreement(a, b, z, dx, dy)
        return sc, common, dx, dy, z
    rough = sorted(((slide(z)[0], z) for z in zooms), reverse=True)[:5]            # the five most promising zooms
    best = max((judge(z) for _, z in rough), key=lambda t: t[0])
    for span, n in ((1.05, 11), (1.012, 7)):                                        # then tighten the zoom around the winner
        zc = best[4]
        for z2 in np.exp(np.linspace(np.log(zc / span), np.log(zc * span), n)):
            t = judge(z2)
            if t[0] > best[0]: best = t
    sc, common, dx, dy, z = best
    # the slide moves A's lines onto B's: the picture moved by (dx, dy), so the camera moved the other way
    return dict(zoom_ratio=float(z), dx=float(-dx / s), dy=float(-dy / s), confidence=float(min(1.0, sc)), common=float(common))

def sureness(e):
    """plain word for an estimate: 'good', 'shaky' or 'NOT reliable'"""
    if e['confidence'] >= 0.5 and e['common'] >= 0.3: return 'good'
    return 'shaky' if e['confidence'] >= 0.3 else 'NOT reliable'
