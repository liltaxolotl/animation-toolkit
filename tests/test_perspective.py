"""
Self-check for the perspective tools. Uses only drawings it generates itself (no artwork needed).

    python tests/test_perspective.py

Renders a room through a known camera, runs perspective_check on the picture, and confirms the
vanishing points, horizon and a deliberately wrong line come back right.
"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import numpy as np
from PIL import Image, ImageDraw
from animtk import scene3d as S, lines as L
import perspective_check as PC

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')
os.makedirs(OUT, exist_ok=True)
fails = []
def check(name, ok, detail=''):
    print(('PASS  ' if ok else 'FAIL  ') + name + ('  ' + detail if detail else ''))
    if not ok: fails.append(name)

def line_board(cam, scene, extra=()):
    """black lines on white, like a clean board"""
    img = Image.new('RGB', (cam.W, cam.H), 'white'); d = ImageDraw.Draw(img)
    for kind, data, fill, ol, layer in scene:
        if kind == 'poly':
            for seg in S._segments(cam, np.array(data, float), 30, True): d.line(seg, fill='black', width=10)
        elif kind == 'lines' and ol != 'tile':
            for Lp in data:
                for seg in S._segments(cam, Lp): d.line(seg, fill='black', width=10)
    for a, b in extra: d.line([tuple(a), tuple(b)], fill='black', width=10)
    return img

# 1. one-point room, camera slightly off-center and pitched down
cam = S.Camera.from_angles((0.8, 4.5, 0), yaw=6, pitch=-4, roll=0, fov=70)
scene = S.room(-5, 5, 16, 9, tile=0) + S.place(S.prop_box(3, 3, 3), (-2.5, 0, 9)) + S.place(S.prop_shelf(3, 6, 1.2, 3), (3, 0, 15.3))
vp_true = cam.vanishing_point((0, 0, 1))
bad_a = np.array([600.0, 1700.0]); bad_b = bad_a + (vp_true + [0, 100] - bad_a) * 0.45     # aims 100 px under the VP
board = line_board(cam, scene, [(bad_a, bad_b)])
p1 = os.path.join(OUT, 'synthetic_one_point.png'); board.save(p1)
res, files = PC.run(p1, OUT)
vps = [v for v in res['vanishing_points'] if v['kind'] == 'vp']
check('one-point: found a vanishing point', len(vps) >= 1)
if vps:
    best = min(vps, key=lambda v: np.hypot(*(np.array(v['xy']) - vp_true)))
    err = np.hypot(*(np.array(best['xy']) - vp_true))
    check('one-point: VP within 25 px of the truth', err < 25, 'off by %.1f px' % err)
hz_true = cam.project(np.array([[0, cam.C[1], 1e6]]))[0][1]
check('one-point: horizon within 25 px', res['horizon'] is not None and abs(res['horizon']['y_at_center'] - np.interp(cam.W/2, [vp_true[0]-1, vp_true[0]+1], [vp_true[1], vp_true[1]])) < 25)
check('one-point: the wrong line is flagged', any(abs(f['miss_px'] - 100) < 30 for f in res['flags'] if f['miss_px'] is not None),
      'flags: %s' % [(f['near'], f['off_deg'], f['miss_px']) for f in res['flags']])

# 2. two-point view of boxes
cam2 = S.Camera.from_angles((0, 5, 0), yaw=38, pitch=-6, roll=3, fov=62)
scene2 = S.place(S.prop_box(4, 5, 4), (9, 0, 12)) + S.place(S.prop_box(3, 8, 3), (16, 0, 14)) + S.place(S.prop_shelf(4, 7, 1.5, 3), (7, 0, 20)) + S.place(S.prop_box(5, 2, 3), (14, 0, 22))
board2 = line_board(cam2, scene2)
p2 = os.path.join(OUT, 'synthetic_two_point.png'); board2.save(p2)
res2, _ = PC.run(p2, OUT)
tz, tx = cam2.vanishing_point((0, 0, 1)), cam2.vanishing_point((1, 0, 0))
found = [np.array(v['xy']) for v in res2['vanishing_points'] if v['kind'] == 'vp']
check('two-point: found two vanishing points', len(found) >= 2, 'truth z=%s x=%s found=%s' % (tz.round(), tx.round(), [f.round().tolist() for f in found]))
if len(found) >= 2:
    ez = min(np.hypot(*(f - tz)) for f in found); ex = min(np.hypot(*(f - tx)) for f in found)
    check('two-point: both within 3% of their distance', ez < 0.03 * np.hypot(*(tz - [1920, 960])) + 30 and ex < 0.03 * np.hypot(*(tx - [1920, 960])) + 30, 'z off %.0f px, x off %.0f px' % (ez, ex))
    check('two-point: horizon tilt recovered', abs(res2['horizon']['angle'] - 3) < 1.0 or abs(res2['horizon']['angle'] + 3) < 1.0, 'angle %.2f' % res2['horizon']['angle'])
    if res2['camera']:
        check('two-point: lens width recovered', abs(res2['camera']['fov'] - 62) < 4, 'fov %.1f' % res2['camera']['fov'])
        camr = S.Camera.from_dict(res2['camera'])
        rz, rx = camr.vanishing_point((0, 0, 1)), camr.vanishing_point((1, 0, 0))
        e = min(np.hypot(*(rz - tz)) + np.hypot(*(rx - tx)), np.hypot(*(rz - tx)) + np.hypot(*(rx - tz)))
        check('two-point: rebuilt camera lands on the same VPs', e < 200, 'sum error %.0f px' % e)

# 3. camera round trips and lens variants
for k in (1.0, 0.6, 0.05):
    c = S.Camera.from_angles((1, 4, -2), yaw=12, pitch=-8, roll=7, fov=95, k=k, skew=5)
    pts = np.array([[2, 1, 9], [-3, 0, 6], [0.5, 7, 12]])
    uv = c.project(pts); back = [c.floor_point(p, y=pt[1]) for p, pt in zip(uv, pts)]
    check('camera k=%.2f: pixel -> ray -> point round trip' % k, all(b is not None and np.allclose(b, pt, atol=1e-4) for b, pt in zip(back, pts)))
c2 = S.Camera.from_dict(c.to_dict())
check('camera: to_dict / from_dict keeps the picture', np.allclose(c2.project(pts), c.project(pts)))

print('\n%d failed' % len(fails) if fails else '\nall passed')
sys.exit(1 if fails else 0)
