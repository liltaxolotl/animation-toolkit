"""
animtk.warp
Matching the linework of two drawings and bending one toward the other with a thin-plate spline.
Only ever moves existing pixels; it never draws new lines.
"""
import numpy as np, cv2
from scipy.interpolate import RBFInterpolator
from scipy.spatial import cKDTree

# ----------------------------------------------------------------- points on the linework
def ink_points(mask, n=500, focus=None):
    """about n points spread evenly along the ink of a boolean mask, as (x, y) in mask pixels.
       focus: optional boolean mask; ink inside it is sampled twice as densely (the part that changes)."""
    ys, xs = np.nonzero(mask)
    if len(xs) == 0: return np.zeros((0, 2))
    def cells(c, sel):
        if not sel.any(): return np.zeros((0, 2))
        kx, ky = (xs[sel] // c).astype(np.int64), (ys[sel] // c).astype(np.int64)
        key = ky * 100003 + kx; order = np.argsort(key); key = key[order]
        start = np.r_[0, np.nonzero(np.diff(key))[0] + 1]; cnt = np.diff(np.r_[start, len(key)])
        return np.stack([np.add.reduceat(xs[sel][order].astype(float), start) / cnt, np.add.reduceat(ys[sel][order].astype(float), start) / cnt], 1)
    infocus = focus[ys, xs] if focus is not None else np.ones(len(xs), bool)
    lo, hi = 1.0, float(max(mask.shape))
    for _ in range(18):                               # find the cell size that gives about n points
        c = (lo + hi) / 2
        m = len(cells(c, infocus)) + len(cells(c * 2, ~infocus))
        if m > n: lo = c
        else: hi = c
    return np.vstack([cells(hi, infocus), cells(hi * 2, ~infocus)])

# ----------------------------------------------------------------- matching (Coherent Point Drift, non-rigid)
def cpd(X, Y, beta=0.8, lam=8.0, w=0.1, iters=100, floor=2.5, tol=1e-7):
    """move point set Y onto point set X smoothly (Coherent Point Drift: Myronenko and Song, 2010).
       Returns (T, P1, Pt1): T = where each Y point ends up; P1 = how firmly each Y point found a partner
       (0..1); Pt1 = how firmly each X point was explained.
       beta  = how far the motion stays coherent (in units of the drawing's spread). Big = whole parts
               move together, which is what keeps lines from tearing.
       floor = stop tightening once points are matched to within this many point-spacings. Without it
               every point snaps to the nearest bit of ink and the drawing folds over itself."""
    X = np.asarray(X, float); Y = np.asarray(Y, float)
    mu = np.vstack([X, Y]).mean(0); sc = np.vstack([X, Y]).std() + 1e-9
    Xn, Yn = (X - mu) / sc, (Y - mu) / sc
    N, M, D = len(Xn), len(Yn), 2
    smin2 = (floor * cKDTree(Yn).query(Yn, k=2)[0][:, 1].mean()) ** 2
    G = np.exp(-((Yn[:, None] - Yn[None]) ** 2).sum(-1) / (2 * beta ** 2))
    T = Yn.copy(); P1 = np.ones(M); Pt1 = np.ones(N)
    sig2 = ((Xn[None] - Yn[:, None]) ** 2).sum() / (D * M * N)
    for _ in range(iters):
        d2 = ((Xn[None] - T[:, None]) ** 2).sum(-1)                    # M x N
        Pm = np.exp(-d2 / (2 * sig2))
        c = (2 * np.pi * sig2) ** (D / 2) * w / (1 - w) * M / N
        Pm /= (Pm.sum(0, keepdims=True) + c)
        P1, Pt1 = Pm.sum(1), Pm.sum(0); Np = P1.sum()
        if Np < 1e-9: break
        A = P1[:, None] * G + lam * sig2 * np.eye(M)
        Wm = np.linalg.solve(A, Pm @ Xn - P1[:, None] * Yn)
        T = Yn + G @ Wm
        new = (np.sum(Pt1 * (Xn ** 2).sum(1)) - 2 * np.sum((Pm @ Xn) * T) + np.sum(P1 * (T ** 2).sum(1))) / (Np * D)
        new = max(new, smin2)
        if abs(new - sig2) < tol * sig2: break
        sig2 = new
    return T * sc + mu, np.clip(P1, 0, 1), np.clip(Pt1, 0, 1)

def match(A_pts, B_pts):
    """where does each point of drawing A go in drawing B? Returns (T, info)."""
    T, P1, Pt1 = cpd(B_pts, A_pts)
    return T, dict(P1=P1, Pt1=Pt1)

def fit_report(A_pts, T, B_pts, anchors, ink_a, ink_b, zone, scale, diag):
    """Can drawing A really be bent into drawing B? Bends A all the way and looks at the result.
       ink_a, ink_b, zone are working-size masks; points are full-size; scale = full px per working px.
       Returns plain numbers:
         gap         average distance between the bent A and B, as a share of the subject's size
         leftover_a  share of bent-A ink with no B line near it
         leftover_b  share of B ink that nothing in A reached
         stretch     how much the worst parts get pulled longer (1 = not at all)
         squash      how much the worst parts get pushed shorter (1 = not at all)
         folds       share of the bent area that turns inside out
         move        how far things travel, as a share of the size"""
    h, w = ink_a.shape; step = 6
    dst = np.vstack([T, anchors]) / scale; src = np.vstack([A_pts, anchors]) / scale
    mapx, mapy, disp = tps_backward_map(dst, src, (h, w), step=step)
    bent = cv2.remap(ink_a.astype(np.float32), mapx, mapy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0) > 0.35
    za, zb = bent & zone, ink_b & zone
    d_work = diag / scale; tol = max(2.5, 0.02 * d_work)
    if za.sum() < 8 or zb.sum() < 8:
        gap, la, lb = 1.0, 1.0, 1.0
    else:
        dt_b = cv2.distanceTransform((~ink_b).astype(np.uint8), cv2.DIST_L2, 3)
        dt_a = cv2.distanceTransform((~bent).astype(np.uint8), cv2.DIST_L2, 3)
        da, db = dt_b[za], dt_a[zb]
        gap = float((da.mean() + db.mean()) / 2 / d_work); la = float((da > tol).mean()); lb = float((db > tol).mean())
    # how hard the picture is being pulled about, measured on the bend itself near the ink
    gy, gx = disp.shape[:2]
    X = np.arange(gx)[None, :] * step + disp[..., 0]; Y = np.arange(gy)[:, None] * step + disp[..., 1]
    a11 = np.diff(X, axis=1)[:-1] / step; a12 = np.diff(X, axis=0)[:, :-1] / step
    a21 = np.diff(Y, axis=1)[:-1] / step; a22 = np.diff(Y, axis=0)[:, :-1] / step
    near = cv2.resize((zone & (bent | ink_b)).astype(np.uint8), (gx - 1, gy - 1), interpolation=cv2.INTER_AREA) > 0
    near = cv2.dilate(near.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    if near.sum() < 4: near[:] = True
    det = (a11 * a22 - a12 * a21)[near]
    tr = (a11 ** 2 + a12 ** 2 + a21 ** 2 + a22 ** 2)[near]
    disc = np.sqrt(np.maximum(tr ** 2 / 4 - det ** 2, 0))
    smax = np.sqrt(np.maximum(tr / 2 + disc, 1e-12)); smin = np.sqrt(np.maximum(tr / 2 - disc, 1e-12))
    # the map runs output -> source, so a source that shrinks (smin) means the output stretched
    moved = np.linalg.norm(T - A_pts, axis=1)
    return dict(gap=gap, leftover_a=la, leftover_b=lb,
                stretch=float(1 / max(np.percentile(smin, 2), 1e-6)), squash=float(1 / np.percentile(smax, 98)),
                folds=float((det <= 0.02).mean()), move=float(np.percentile(moved, 90) / diag))

# ----------------------------------------------------------------- thin-plate-spline warp
def tps_backward_map(dst_pts, src_pts, shape, step=16, smoothing=3e-3):
    """for every pixel of the output, the pixel of the source it should take its ink from.
       dst_pts = where control points sit in the output, src_pts = where they sit in the source.
       Returns (mapx, mapy, coarse displacement grid)."""
    H, W = shape
    # the four corners keep everything far from the drawing in place
    corners = np.array([[0, 0], [W, 0], [0, H], [W, H]], float)
    d = np.vstack([dst_pts, corners]); s = np.vstack([src_pts, corners])
    _, keep = np.unique(np.round(d), axis=0, return_index=True); d, s = d[keep], s[keep]
    rbf = RBFInterpolator(d / W, (s - d) / W, kernel='thin_plate_spline', smoothing=smoothing, degree=1)
    gx = np.arange(0, W + step, step); gy = np.arange(0, H + step, step)
    GX, GY = np.meshgrid(gx, gy)
    disp = (rbf(np.stack([GX.ravel(), GY.ravel()], 1) / W) * W).reshape(len(gy), len(gx), 2).astype(np.float32)
    M = np.float32([[step, 0, 0], [0, step, 0]])                 # grid node i lands on pixel i * step
    full = cv2.warpAffine(disp, M, (W, H), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    xx, yy = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32))
    return xx + full[..., 0], yy + full[..., 1], disp

def folds(disp, step):
    """share of the warp grid that turns inside out (ink would tear or smear there)"""
    gy, gx = disp.shape[:2]
    X = np.arange(gx)[None, :] * step + disp[..., 0]; Y = np.arange(gy)[:, None] * step + disp[..., 1]
    dxx = np.diff(X, axis=1)[:-1]; dxy = np.diff(X, axis=0)[:, :-1]
    dyx = np.diff(Y, axis=1)[:-1]; dyy = np.diff(Y, axis=0)[:, :-1]
    return float(((dxx * dyy - dxy * dyx) <= 0).mean())

def remap(img, mapx, mapy, border):
    """pull pixels through the map. img is HxWxC uint8; border = colour for anything pulled from outside."""
    return cv2.remap(img, mapx, mapy, interpolation=cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, borderValue=border)

# ----------------------------------------------------------------- spacing
def ease(t, kind='inout'):
    """0..1 in, 0..1 out. linear, in (slow start), out (slow stop), inout (slow both ends)."""
    t = np.clip(np.asarray(t, float), 0, 1)
    if kind == 'linear': return t
    if kind == 'in': return t * t
    if kind == 'out': return 1 - (1 - t) ** 2
    return t * t * (3 - 2 * t)

def spacing(n, kind='inout'):
    """positions (0..1) of n inbetweens between two keys"""
    return [float(ease((i + 1) / (n + 1), kind)) for i in range(n)]
