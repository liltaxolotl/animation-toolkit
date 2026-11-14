"""
animtk.scene3d
3D blockout scenes + virtual camera (regular, fisheye, blended lens, Dutch tilt, stylized skew).

Grown out of perspective_toolkit.py: the camera math and the scene-item format are the same,
so anything that worked there works here.

Units: feet. x = left/right, y = up, z = depth away from the camera. The floor is y = 0.

Scene items are tuples: (kind, data, fill, outline, layer)
    kind 'poly'  = flat 3D polygon (list of points)
    kind 'blob'  = 3D point cloud drawn as its outline (round things)
    kind 'lines' = list of 3D polylines
    layer        = draw order, low first. Inside one layer, far things draw first.
"""
import json
import numpy as np
from PIL import Image, ImageDraw
from scipy.spatial import ConvexHull

# ----------------------------------------------------------------- camera
class Camera:
    """
    pos    : 3D point (feet) where the camera sits.
    target : 3D point it looks at (or pass R, or use Camera.from_angles).
    fov    : horizontal field of view in degrees across the frame width ("lens width").
    k      : lens bend. 1.0 = regular lens, 0.02 = fisheye, anything between blends them.
    roll   : Dutch tilt in degrees.
    skew   : stylized skew in degrees. A sideways shear of the finished picture around its center.
    W, H   : output size in pixels.
    R      : optional 3x3 rotation (rows = camera right, up, forward in world space).
    """
    def __init__(s, pos, target=None, fov=60.0, k=1.0, roll=0.0, W=3840, H=1920, skew=0.0, R=None):
        s.W, s.H = int(W), int(H)
        s.C = np.array(pos, float)
        s.fov, s.roll, s.skew = float(fov), float(roll), float(skew)
        if R is not None:
            s.R = np.array(R, float)
        else:
            if target is None:
                target = s.C + [0, 0, 10]
            fwd = np.array(target, float) - s.C
            s.R = _basis(fwd / np.linalg.norm(fwd), roll)
        s.k = max(float(k), 1e-3)
        half = np.radians(s.fov / 2)
        s.f = (s.W / 2) * s.k / np.tan(min(s.k * half, 1.5))
        s.shear = np.tan(np.radians(s.skew))

    # -- builders
    @classmethod
    def from_angles(cls, pos=(0, 5, 0), yaw=0.0, pitch=0.0, roll=0.0, **kw):
        """yaw = turn right (degrees), pitch = look up (degrees), roll = Dutch tilt."""
        y, p = np.radians(yaw), np.radians(pitch)
        fwd = np.array([np.sin(y) * np.cos(p), np.sin(p), np.cos(y) * np.cos(p)])
        return cls(pos, fov=kw.pop('fov', 60.0), roll=roll, R=_basis(fwd, roll), **kw)

    @classmethod
    def from_dict(cls, d, W=None, H=None):
        W = W or d.get('W', 3840); H = H or d.get('H', 1920)
        kw = dict(fov=d.get('fov', 60.0), k=d.get('k', 1.0), skew=d.get('skew', 0.0), W=W, H=H)
        pos = d.get('pos', [0, 5, 0])
        if d.get('R') is not None:
            return cls(pos, roll=d.get('roll', 0.0), R=d['R'], **kw)
        if d.get('target') is not None:
            return cls(pos, target=d['target'], roll=d.get('roll', 0.0), **kw)
        return cls.from_angles(pos, d.get('yaw', 0.0), d.get('pitch', 0.0), d.get('roll', 0.0), **kw)

    def to_dict(s):
        return dict(pos=[round(float(v), 4) for v in s.C], fov=s.fov, k=s.k, roll=s.roll, skew=s.skew,
                    R=[[round(float(v), 6) for v in row] for row in s.R], W=s.W, H=s.H)

    # -- math (same as perspective_toolkit.py, plus skew)
    def to_cam(s, P):
        return (s.R @ (np.atleast_2d(np.asarray(P, float)) - s.C).T).T

    def project_cam(s, c):
        x, y, z = c[:, 0], c[:, 1], c[:, 2]
        th = np.arctan2(np.hypot(x, y), z); ph = np.arctan2(y, x)
        r = s.f * np.tan(np.minimum(s.k * th, 1.5)) / s.k
        u = s.W / 2 + r * np.cos(ph); v = s.H / 2 - r * np.sin(ph)
        return np.stack([u + s.shear * (v - s.H / 2), v], 1)

    def project(s, P):
        return s.project_cam(s.to_cam(P))

    def ray_cam(s, uv):
        """camera-space direction through a pixel"""
        v = uv[1]; u = uv[0] - s.shear * (v - s.H / 2)
        x = u - s.W / 2; y = -(v - s.H / 2); r = np.hypot(x, y)
        th = np.arctan(r * s.k / s.f) / s.k; ph = np.arctan2(y, x)
        return np.array([np.sin(th) * np.cos(ph), np.sin(th) * np.sin(ph), np.cos(th)])

    def ray(s, uv):
        """world-space direction through a pixel"""
        return s.R.T @ s.ray_cam(uv)

    def floor_point(s, uv, y=0.0):
        """3D spot on the floor (or on the plane at height y) under a pixel, e.g. where feet touch down"""
        d = s.ray(uv)
        if abs(d[1]) < 1e-9:
            return None
        t = (y - s.C[1]) / d[1]
        return None if t <= 0 else s.C + t * d

    def vanishing_point(s, direction):
        """pixel where lines running along a world direction converge (None if behind the camera)"""
        d = s.R @ np.asarray(direction, float)
        if d[2] < 0: d = -d
        if d[2] < 1e-6: return None
        return s.project_cam(d[None, :])[0]


def _basis(fwd, roll=0.0):
    upw = np.array([0, 1.0, 0])
    right = np.cross(upw, fwd)
    if np.linalg.norm(right) < 1e-9:          # looking straight up or down
        right = np.array([1.0, 0, 0])
    right /= np.linalg.norm(right)
    up = np.cross(fwd, right)
    r = np.radians(roll)
    right, up = right * np.cos(r) + up * np.sin(r), -right * np.sin(r) + up * np.cos(r)
    return np.stack([right, up, fwd])


def make_camera(fov, k, roll, horizon_y, yaw=0.0, height=1.0, W=3840, H=1920, skew=0.0):
    """Camera at (0,height,0). horizon_y = where the horizon crosses the frame center (pixels).
       yaw turns the camera left/right in degrees. (Same call as perspective_toolkit.make_camera.)"""
    tmp = Camera((0, height, 0), (0, height, 10), fov, k, 0, W, H)
    r = H / 2 - horizon_y
    pitch = np.arctan(r * tmp.k / tmp.f) / tmp.k
    tgt = (np.sin(np.radians(yaw)) * 10, height - np.tan(pitch) * 10, np.cos(np.radians(yaw)) * 10)
    return Camera((0, height, 0), tgt, fov, k, roll, W, H, skew)


def camera_from_vps(vp_depth, vp_side=None, fov=60.0, roll=0.0, pos=(0, 5, 0), W=3840, H=1920, k=1.0, skew=0.0):
    """Build a camera whose world axes hit the vanishing points found on a drawing.
       vp_depth : pixel of the vanishing point for lines going away from the viewer (world z).
       vp_side  : optional second vanishing point (world x). With two, the lens width is solved
                  from them (they must be 90 degrees apart in the world) and roll comes from the horizon.
       Returns (camera, notes)."""
    notes = []
    if vp_side is not None:
        f_ok = _solve_fov(vp_depth, vp_side, W, H, k, skew)
        if f_ok is None:
            notes.append('The two vanishing points cannot be 90 degrees apart with any lens; kept lens width %.0f.' % fov)
        else:
            fov = f_ok
            notes.append('Lens width solved from the two vanishing points: %.1f degrees.' % fov)
    cam0 = Camera(pos, fov=fov, k=k, W=W, H=H, skew=skew, R=np.eye(3))
    zc = cam0.ray_cam(vp_depth)
    if vp_side is not None:
        xc = cam0.ray_cam(vp_side); xc = xc - (xc @ zc) * zc; xc /= np.linalg.norm(xc)
        yc = np.cross(zc, xc)
        if yc[1] < 0: xc, yc = -xc, -yc
    else:
        r = np.radians(roll)
        yc = np.array([np.sin(r), np.cos(r), 0.0]); yc = yc - (yc @ zc) * zc; yc /= np.linalg.norm(yc)
        xc = np.cross(yc, zc)
    R = np.stack([xc, yc, zc], 1)
    return Camera(pos, fov=fov, k=k, W=W, H=H, skew=skew, roll=roll, R=R), notes


def _solve_fov(vp1, vp2, W, H, k=1.0, skew=0.0):
    """lens width (degrees) that makes the rays through two pixels perpendicular, or None"""
    def dot(fov):
        c = Camera((0, 0, 0), fov=fov, k=k, W=W, H=H, skew=skew, R=np.eye(3))
        return float(c.ray_cam(vp1) @ c.ray_cam(vp2))
    lo, hi = 2.0, 170.0
    a, b = dot(lo), dot(hi)
    if a * b > 0: return None
    for _ in range(60):
        mid = (lo + hi) / 2; m = dot(mid)
        if a * m <= 0: hi, b = mid, m
        else: lo, a = mid, m
    return (lo + hi) / 2


# ----------------------------------------------------------------- geometry helpers
def quad(a, b, c, d): return [np.array(p, float) for p in (a, b, c, d)]

def box(x0, x1, y0, y1, z0, z1):
    v = lambda x, y, z: (x, y, z)
    return [quad(v(x0,y0,z0),v(x1,y0,z0),v(x1,y1,z0),v(x0,y1,z0)), quad(v(x0,y0,z1),v(x1,y0,z1),v(x1,y1,z1),v(x0,y1,z1)),
            quad(v(x0,y0,z0),v(x0,y0,z1),v(x0,y1,z1),v(x0,y1,z0)), quad(v(x1,y0,z0),v(x1,y0,z1),v(x1,y1,z1),v(x1,y1,z0)),
            quad(v(x0,y1,z0),v(x1,y1,z0),v(x1,y1,z1),v(x0,y1,z1)), quad(v(x0,y0,z0),v(x1,y0,z0),v(x1,y0,z1),v(x0,y0,z1))]

def ring(cx, y, cz, ax, az, n=48):
    t = np.linspace(0, 2*np.pi, n, endpoint=False)
    return np.stack([cx + ax*np.cos(t), np.full(n, y), cz + az*np.sin(t)], 1)

def densify(P, n=24, closed=True):
    P = np.asarray(P, float); out = []; m = len(P) if closed else len(P) - 1
    for i in range(m):
        a, b = P[i], P[(i+1) % len(P)]
        for t in np.linspace(0, 1, n, endpoint=False): out.append(a + (b - a)*t)
    if not closed: out.append(P[-1])
    return np.array(out)

def clip_near(poly, near=0.05):
    out = []; n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i+1) % n]; ia, ib = a[2] > near, b[2] > near
        if ia: out.append(a)
        if ia != ib: out.append(a + (b - a)*(near - a[2])/(b[2] - a[2]))
    return np.array(out)

def _roty(P, deg):
    a = np.radians(deg); c, s = np.cos(a), np.sin(a)
    P = np.asarray(P, float)
    return np.stack([P[..., 0]*c + P[..., 2]*s, P[..., 1], -P[..., 0]*s + P[..., 2]*c], -1)

def place(items, pos=(0, 0, 0), rot=0.0):
    """turn scene items around the vertical axis by rot degrees, then move them to pos"""
    pos = np.array(pos, float); out = []
    for kind, data, fill, ol, layer in items:
        if kind == 'lines': data = [_roty(L, rot) + pos for L in data]
        elif kind == 'blob': data = _roty(data, rot) + pos
        else: data = list(_roty(np.array(data, float), rot) + pos)
        out.append((kind, data, fill, ol, layer))
    return out


# ----------------------------------------------------------------- props
# Every prop is built around its own origin: centered left/right (x) and front/back (z),
# sitting on y = 0. Use place(items, pos, rot) or the scene spec to put it in the room.
def prop_box(w=2, h=2, d=2, fill='wood', layer=5):
    return [('poly', q, fill, 'ink', layer) for q in box(-w/2, w/2, 0, h, -d/2, d/2)]

def prop_cylinder(r=0.5, h=1.5, fill='glass', layer=5, n=40):
    return [('blob', np.concatenate([ring(0, 0, 0, r, r, n), ring(0, h, 0, r, r, n)]), fill, 'ink', layer),
            ('poly', list(ring(0, h, 0, r, r, n)), fill, 'ink', layer + 1)]

def prop_bottle(r=0.25, h=1.4, neck_r=None, neck_h=None, fill='glass', layer=5, n=36):
    """bottle: straight body, sloped shoulder, thin neck"""
    neck_r = r * 0.38 if neck_r is None else neck_r
    neck_h = h * 0.28 if neck_h is None else neck_h
    body_h = h - neck_h - r * 0.6
    return [('blob', np.concatenate([ring(0, 0, 0, r, r, n), ring(0, body_h, 0, r, r, n), ring(0, h - neck_h, 0, neck_r, neck_r, n)]), fill, 'ink', layer),
            ('lines', [np.vstack([ring(0, body_h, 0, r, r, n), ring(0, body_h, 0, r, r, n)[:1]])], None, 'ink', layer + 1),
            ('blob', np.concatenate([ring(0, h - neck_h, 0, neck_r, neck_r, n), ring(0, h, 0, neck_r, neck_r, n)]), fill, 'ink', layer + 1),
            ('poly', list(ring(0, h, 0, neck_r, neck_r, n)), fill, 'ink', layer + 2)]

def prop_jar(r=0.35, h=1.0, lid_h=None, fill='glass', layer=5, n=36):
    """wide jar with a lid slightly bigger than the body"""
    lid_h = h * 0.16 if lid_h is None else lid_h
    bh = h - lid_h; lr = r * 1.06
    return [('blob', np.concatenate([ring(0, 0, 0, r, r, n), ring(0, bh, 0, r, r, n)]), fill, 'ink', layer),
            ('blob', np.concatenate([ring(0, bh, 0, lr, lr, n), ring(0, h, 0, lr, lr, n)]), 'metal', 'ink', layer + 1),
            ('poly', list(ring(0, h, 0, lr, lr, n)), 'metal', 'ink', layer + 2)]

def prop_shelf(w=4, h=6, d=1, shelves=3, t=0.08, back=True, fill='wood', layer=4):
    """open shelf unit: two sides, top, bottom, and `shelves` boards between them"""
    out = []
    if back:
        out.append(('poly', quad((-w/2, 0, d/2), (w/2, 0, d/2), (w/2, h, d/2), (-w/2, h, d/2)), 'woodDark', 'ink', layer - 1))
    parts = [(-w/2, -w/2 + t, 0, h), (w/2 - t, w/2, 0, h), (-w/2, w/2, 0, t), (-w/2, w/2, h - t, h)]
    for i in range(1, int(shelves) + 1):
        y = h * i / (shelves + 1); parts.append((-w/2 + t, w/2 - t, y - t/2, y + t/2))
    for x0, x1, y0, y1 in parts:
        out += [('poly', q, fill, 'ink', layer) for q in box(x0, x1, y0, y1, -d/2, d/2)]
    return out

def shelf_heights(h=6, shelves=3, t=0.08):
    """y of every surface you can stand a bottle on (bottom board first)"""
    return [t] + [h * i / (shelves + 1) + t/2 for i in range(1, int(shelves) + 1)]

def prop_door(w=3, h=6.8, swing=0.0, hinge='left', t=0.12, frame=True, fill='door', layer=5):
    """door in a frame. The frame runs along x; the hinge is on the left or right post.
       swing = degrees open (0 = shut, 90 = straight out toward the viewer, negative = away)."""
    out = []; s = -1 if hinge == 'left' else 1
    hx = s * w / 2                                             # hinge line
    if frame:
        f = 0.25
        for x0, x1, y0, y1 in [(-w/2 - f, -w/2, 0, h + f), (w/2, w/2 + f, 0, h + f), (-w/2, w/2, h, h + f)]:
            out += [('poly', q, 'woodDark', 'ink', layer - 1) for q in box(x0, x1, y0, y1, -t, t)]
    a = np.radians(swing)
    def swung(x, y, z):                                         # x measured from the hinge along the closed door
        return (hx - s * (x * np.cos(a) - z * np.sin(a)) * 1.0, y, -(x * np.sin(a) + z * np.cos(a)))
    # panel as a thin box that turns around the hinge line
    X0, X1, Z0, Z1 = 0.0, w, -t/2, t/2
    c = lambda x, y, z: swung(x, y, z)
    faces = [quad(c(X0,0,Z0),c(X1,0,Z0),c(X1,h,Z0),c(X0,h,Z0)), quad(c(X0,0,Z1),c(X1,0,Z1),c(X1,h,Z1),c(X0,h,Z1)),
             quad(c(X0,0,Z0),c(X0,0,Z1),c(X0,h,Z1),c(X0,h,Z0)), quad(c(X1,0,Z0),c(X1,0,Z1),c(X1,h,Z1),c(X1,h,Z0)),
             quad(c(X0,h,Z0),c(X1,h,Z0),c(X1,h,Z1),c(X0,h,Z1))]
    out += [('poly', q, fill, 'ink', layer) for q in faces]
    # knob + the arc the free edge sweeps on the floor
    out.append(('lines', [np.array([c(w*0.88, h*0.47, -t), c(w*0.88, h*0.47, -t - 0.25)])], None, 'ink', layer + 1))
    if abs(swing) > 1:
        arc = []
        for b in np.linspace(0, np.radians(swing), 40):
            arc.append((hx - s * (w * np.cos(b)), 0.01, -(w * np.sin(b))))
        out.append(('lines', [np.array(arc)], None, 'arc', layer - 2))
    return out

def prop_cabinet(w=3, h=3, d=1.5, shelves=1, doors=2, swing=0.0, t=0.08, fill='wood', layer=4):
    """shelf unit with hinged doors on the front. doors = 0, 1 or 2. swing = degrees open."""
    out = prop_shelf(w, h, d, shelves, t, True, fill, layer)
    if doors == 1:
        out += place(prop_door(w, h, swing, 'left', t, False, fill, layer + 2), (0, 0, -d/2))
    elif doors >= 2:
        out += place(prop_door(w/2, h, swing, 'left', t, False, fill, layer + 2), (-w/4, 0, -d/2))
        out += place(prop_door(w/2, h, swing, 'right', t, False, fill, layer + 2), (w/4, 0, -d/2))
    return out

def room(L, R, D, ceil, tile=1.0, near=0.1):
    """box room: left wall x=L, right wall x=R, back wall z=D, floor y=0, ceiling y=ceil"""
    S = [('poly', quad((L,0,-5),(R,0,-5),(R,0,D),(L,0,D)), 'floor', None, 0),
         ('poly', quad((L,0,-5),(L,ceil,-5),(L,ceil,D),(L,0,D)), 'wallL', None, 0),
         ('poly', quad((R,0,-5),(R,ceil,-5),(R,ceil,D),(R,0,D)), 'wallR', None, 0),
         ('poly', quad((L,0,D),(R,0,D),(R,ceil,D),(L,ceil,D)), 'wallB', None, 0),
         ('poly', quad((L,ceil,-5),(R,ceil,-5),(R,ceil,D),(L,ceil,D)), 'ceil', None, 0)]
    if tile:
        grid = [np.array([[x, 0.005, z] for z in np.linspace(near, D, 200)]) for x in np.arange(L, R+1e-6, tile)]
        grid += [np.array([[x, 0.005, z] for x in np.linspace(L, R, 120)]) for z in np.arange(D, 0, -tile)]
        S.append(('lines', grid, None, 'tile', 1))
    E = [[(L,0,near),(L,0,D)],[(R,0,near),(R,0,D)],[(L,0,D),(R,0,D)],[(L,0,D),(L,ceil,D)],[(R,0,D),(R,ceil,D)],
         [(L,ceil,D),(R,ceil,D)],[(L,ceil,near),(L,ceil,D)],[(R,ceil,near),(R,ceil,D)]]
    S.append(('lines', [densify(e, 160, False) for e in E], None, 'ink', 2))
    return S

PROPS = dict(box=prop_box, cylinder=prop_cylinder, bottle=prop_bottle, jar=prop_jar,
             shelf=prop_shelf, door=prop_door, cabinet=prop_cabinet)
GUIDE_COLORS = [(0,90,220,255), (200,0,140,255), (230,120,0,255), (0,150,150,255), (120,60,200,255), (150,110,0,255)]

def build_prop(p):
    """one prop from a spec dict, e.g. {"type":"bottle","pos":[1,2.1,6],"r":0.2,"h":1.2,"rot":15}
       Shortcut: "size":[w,h,d] works for box, shelf, cabinet; "size":[w,h] for door."""
    p = dict(p); kind = p.pop('type'); pos = p.pop('pos', (0, 0, 0)); rot = p.pop('rot', 0.0)
    p.pop('name', None); p.pop('color', None)
    size = p.pop('size', None)
    if size is not None:
        keys = ('w', 'h') if kind == 'door' else ('w', 'h', 'd')
        for kname, v in zip(keys, size): p.setdefault(kname, v)
    return place(PROPS[kind](**p), pos, rot)

def build_scene(spec):
    """spec dict (see README, "scene JSON") -> (camera, scene_items, groups, room_box)
       groups = [(name, items, rgba)] for the guide layer."""
    W, H = spec.get('canvas', [3840, 1920])
    cam = Camera.from_dict(spec.get('camera', {}), W, H)
    items = []; rb = None
    r = spec.get('room')
    if r:
        rb = (r.get('L', -5), r.get('R', 5), r.get('D', 14), r.get('ceil', 8.5))
        items += room(*rb, tile=r.get('tile', 1.0))
    groups = []
    for i, p in enumerate(spec.get('props', [])):
        it = build_prop(p)
        col = tuple(p['color']) if p.get('color') else GUIDE_COLORS[i % len(GUIDE_COLORS)]
        groups.append((p.get('name', '%s %d' % (p['type'], i + 1)), it, col))
        items += it
    return cam, items, groups, rb

def load_scene(path):
    with open(path, encoding='utf-8') as fh:
        return json.load(fh)


# ----------------------------------------------------------------- rendering
PALETTE = dict(bg=(232,226,214), floor=(232,226,214), tile=(170,160,145), wallL=(238,232,222), wallR=(228,222,212),
               wallB=(242,237,228), ceil=(222,215,205), ink=(30,28,32), dark=(70,64,70), door=(236,230,220),
               porcelain=(252,252,250), wood=(214,190,160), woodDark=(186,160,130), mirror=(205,220,228),
               basin=(225,232,236), metal=(175,178,182), glass=(214,230,232), arc=(120,120,130))
_rng = np.random.default_rng(7)

def _wobble(pts, amp=4, freq=0.004):
    pts = np.asarray(pts, float)
    if len(pts) < 2: return pts
    s = np.r_[0, np.cumsum(np.hypot(*np.diff(pts, axis=0).T))]; ph = _rng.uniform(0, 6.28, 2)
    return pts + np.stack([np.sin(s*freq*6.28+ph[0]), np.cos(s*freq*5.1+ph[1])], 1)*amp + _rng.normal(0, 1.2, pts.shape)

def _segments(cam, pts3, n=None, closed=False, lim=40000):
    """project a 3D polyline, splitting it wherever it goes behind the camera"""
    P = np.asarray(pts3, float)
    if n: P = densify(P, n, closed)
    c = cam.to_cam(P); ok = c[:, 2] > 0.05; uv = cam.project_cam(c); out = []; seg = []
    for i in range(len(uv)):
        if ok[i] and np.all(np.abs(uv[i]) < lim): seg.append(tuple(uv[i]))
        else:
            if len(seg) > 1: out.append(seg)
            seg = []
    if len(seg) > 1: out.append(seg)
    return out

def render(cam, S, pal=PALETTE, line_scale=None, wobble=False, transparent=False):
    """clean reference picture: flat fills + ink outlines. wobble=True gives hand-drawn-looking lines."""
    line_scale = cam.W / 3840 if line_scale is None else line_scale
    img = Image.new('RGBA', (cam.W, cam.H), (0, 0, 0, 0) if transparent else pal['bg'] + (255,))
    d = ImageDraw.Draw(img); items = []
    col = lambda k: pal[k] if isinstance(k, str) else k
    for kind, data, fill, ol, layer in S:
        if kind == 'poly':
            c = clip_near(list(cam.to_cam(densify(np.array(data), 40))), 0.4)
            if len(c) < 3: continue
            uv = np.clip(cam.project_cam(c), -12000, 12000)
            items.append((layer, -np.linalg.norm(np.mean(np.array(data), 0) - cam.C), 'poly', uv, col(fill), col(ol) if ol else None))
        elif kind == 'blob':
            c = cam.to_cam(np.asarray(data))
            if (c[:, 2] < 0.1).any(): continue
            uv = cam.project_cam(c)
            try: hull = uv[ConvexHull(uv).vertices]
            except Exception: continue
            items.append((layer, -np.linalg.norm(np.mean(data, 0) - cam.C), 'poly', hull, col(fill), col(ol)))
        else:
            for Lp in data:
                far = -np.linalg.norm(np.mean(np.asarray(Lp, float), 0) - cam.C) if ol != 'tile' else 0
                for seg in _segments(cam, Lp, lim=30000):
                    items.append((layer, far, 'line', np.array(seg), None, col(ol)))
    w = lambda n: max(1, int(round(n * line_scale)))
    for layer, nd, k, pts, fill, ol in sorted(items, key=lambda t: (t[0], t[1])):
        if k == 'poly':
            d.polygon([tuple(p) for p in pts], fill=fill)
            if ol:
                closed = np.vstack([pts, pts[:1]])
                for ww in ((9, 5) if wobble else (6,)):
                    d.line([tuple(p) for p in (_wobble(closed) if wobble else closed)], fill=ol, width=w(ww), joint='curve')
        else:
            big = ol == pal['ink']
            for ww in (((9, 4) if big else (5,)) if wobble else ((6,) if big else (3,))):
                d.line([tuple(p) for p in (_wobble(pts, 3) if wobble else pts)], fill=ol, width=w(ww), joint='curve')
    return img

RED, BLUE, GREEN, GRID, INK = (230,30,40,255), (40,110,230,170), (0,160,80,150), (120,120,120,200), (20,20,25,255)

def guide(cam, room_box=None, groups=(), extra_walls=(), line_scale=None, tile=1.0, floor=None,
          horizon=True, vps=True, labels=True):
    """transparent guide layer: red horizon + vanishing points, gray floor grid, black room edges,
       blue depth lines and green verticals on the walls, colored prop outlines.
       room_box = (L, R, D, ceil) or None. Without a room, floor=(x0, x1, z0, z1) sets the grid area.
       groups = [(name, scene_items, rgba)]."""
    line_scale = cam.W / 3840 if line_scale is None else line_scale
    G = Image.new('RGBA', (cam.W, cam.H), (0, 0, 0, 0)); d = ImageDraw.Draw(G)
    w = lambda n: max(1, int(round(n * line_scale)))
    def line3(pts, color, width, n=120, closed=False):
        for seg in _segments(cam, np.array(pts, float), n, closed):
            d.line(seg, fill=color, width=w(width), joint='curve')
    if room_box:
        L, R, D, CEIL = room_box
        for y in np.arange(1, CEIL, 1.0): line3([(L,y,.2),(L,y,D)], BLUE, 4); line3([(R,y,.2),(R,y,D)], BLUE, 4)
        for x in np.arange(L+1, R, 1.5): line3([(x,CEIL,.2),(x,CEIL,D)], BLUE, 4)
        for z in np.arange(1.5, D, 1.5): line3([(L,0,z),(L,CEIL,z)], GREEN, 4); line3([(R,0,z),(R,CEIL,z)], GREEN, 4)
        for x in np.arange(L+1, R, 1.5): line3([(x,0,D),(x,CEIL,D)], GREEN, 4)
        floor = (L, R, 0.1, D)
    if floor and tile:
        x0, x1, z0, z1 = floor
        for x in np.arange(x0, x1+1e-6, tile): line3([(x,0,z0),(x,0,z1)], GRID, 4)
        for z in np.arange(np.ceil(z0/tile)*tile, z1+1e-6, tile): line3([(x0,0,z),(x1,0,z)], GRID, 4)
    if room_box:
        for e in [[(L,0,.1),(L,0,D)],[(R,0,.1),(R,0,D)],[(L,0,D),(R,0,D)],[(L,0,D),(L,CEIL,D)],[(R,0,D),(R,CEIL,D)],
                  [(L,CEIL,D),(R,CEIL,D)],[(L,CEIL,.1),(L,CEIL,D)],[(R,CEIL,.1),(R,CEIL,D)]]: line3(e, INK, 9)
    for kind, data, *_ in extra_walls:
        if kind == 'poly': line3(data, INK, 9, 30, True)
    if horizon:
        fw = cam.R[2]; head = np.arctan2(fw[0], fw[2])
        dirs = np.array([[np.sin(a), 0, np.cos(a)] for a in np.linspace(head - 1.55, head + 1.55, 400)])*1e5 + cam.C
        for seg in _segments(cam, dirs): d.line(seg, fill=RED, width=w(7))
    if vps:
        r = 26 * line_scale
        for axis, c in (((0, 0, 1), RED), ((1, 0, 0), RED), ((0, 1, 0), (0, 160, 80, 255))):
            vp = cam.vanishing_point(axis)
            if vp is not None and np.all(np.abs(vp) < 40000):
                d.ellipse([vp[0]-r, vp[1]-r, vp[0]+r, vp[1]+r], outline=c, width=w(7))
                d.line([vp[0]-r*1.6, vp[1], vp[0]+r*1.6, vp[1]], fill=c, width=w(4))
                d.line([vp[0], vp[1]-r*1.6, vp[0], vp[1]+r*1.6], fill=c, width=w(4))
    font = _font(int(40 * line_scale))
    for name, items, color in groups:
        anchor = None
        for kind, data, fill, ol, layer in items:
            if kind == 'poly':
                line3(data, color, 7, 30, True)
                if anchor is None: anchor = np.mean(np.array(data, float), 0)
            elif kind == 'blob':
                c = cam.to_cam(np.asarray(data))
                if (c[:, 2] < 0.1).any(): continue
                uv = cam.project_cam(c)
                try:
                    hull = uv[ConvexHull(uv).vertices]
                    d.line([tuple(p) for p in np.vstack([hull, hull[:1]])], fill=color, width=w(7), joint='curve')
                except Exception: pass
                if anchor is None: anchor = np.mean(np.asarray(data, float), 0)
            else:
                for Lp in data: line3(Lp, color, 5 if ol == 'arc' else 7, 4)
        if labels and anchor is not None and name:
            c = cam.to_cam(anchor)
            if c[0, 2] > 0.1:
                u, v = cam.project_cam(c)[0]
                if 0 <= u < cam.W and 0 <= v < cam.H: d.text((u + 10*line_scale, v), name, fill=color, font=font)
    return G

def _font(size):
    from PIL import ImageFont
    for name in ('arialbd.ttf', 'arial.ttf', 'DejaVuSans-Bold.ttf', 'DejaVuSans.ttf'):
        try: return ImageFont.truetype(name, max(8, size))
        except Exception: pass
    return ImageFont.load_default()

def person_scale(cam, feet_world, drawn_height_px, real_height_ft=5.33):
    """how much to scale a drawn person standing at feet_world so they are the right real height"""
    f = cam.project(np.array([feet_world]))[0]
    h = cam.project(np.array([[feet_world[0], real_height_ft, feet_world[2]]]))[0]
    return np.hypot(*(h - f)) / drawn_height_px, f
