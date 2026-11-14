"""
scene_render.py
Builds a simple 3D blockout (rooms, shelves, bottles, jars, cabinets, doors, boxes) from a scene
JSON file and renders it through a virtual camera (regular, fisheye, blended, tilted, skewed).

    python scene_render.py SCENE.json [--out DIR] [--board BOARD.png] [--camera CHECK_OR_APP.json]
                                      [--scale 1] [--wobble] [--no-labels]

Writes NEW files only:
    <name>_reference.png   clean picture: flat fills and ink outlines
    <name>_guide.png       transparent guide layer: horizon, vanishing points, floor grid, prop outlines
    <name>_over_board.png  only with --board: the guide laid over a faded copy of the sketch,
                           so you can see how well the scene matches before drawing over it

Scene JSON (all sizes in feet, floor is y = 0, +z goes away from the camera):
    {
      "canvas": [3840, 1920],
      "camera": {"pos": [0, 5, 0], "yaw": 0, "pitch": 0, "roll": 0, "fov": 60, "k": 1.0, "skew": 0},
      "room":   {"L": -5, "R": 5, "D": 14, "ceil": 8.5, "tile": 1},          (optional)
      "floor":  [-6, 6, 0.5, 16],                                            (optional grid area, no room)
      "props": [
        {"type": "box",      "pos": [x, y, z], "size": [w, h, d], "rot": 0, "name": "counter"},
        {"type": "cylinder", "pos": [x, y, z], "r": 0.5, "h": 1.5},
        {"type": "bottle",   "pos": [x, y, z], "r": 0.25, "h": 1.4},
        {"type": "jar",      "pos": [x, y, z], "r": 0.35, "h": 1.0},
        {"type": "shelf",    "pos": [x, y, z], "size": [w, h, d], "shelves": 3},
        {"type": "cabinet",  "pos": [x, y, z], "size": [w, h, d], "shelves": 1, "doors": 2, "swing": 35},
        {"type": "door",     "pos": [x, y, z], "size": [w, h], "swing": 60, "hinge": "left"}
      ]
    }
camera: k 1.0 = regular lens, 0.02 = fisheye, between = blend. roll = Dutch tilt. skew = stylized skew.
        Instead of yaw/pitch you may give "target": [x, y, z] or a full rotation "R" (the app and
        perspective_check.py write "R").
pos is the middle of a prop's footprint, at its base. rot turns it around the vertical axis (degrees).
"""
import argparse, json, os
import numpy as np
from PIL import Image
from animtk import imgio, scene3d as S

def run(scene_path, out_dir, board=None, camera=None, scale=1.0, wobble=False, labels=True):
    spec = S.load_scene(scene_path); imgio.protect(scene_path)
    if camera:
        cj = S.load_scene(camera); imgio.protect(camera)
        cam_d = cj.get('camera', cj)
        if not cam_d: raise SystemExit('%s has no camera in it (no vanishing point was found). Set the camera in the scene file instead.' % camera)
        keep_pos = spec.get('camera', {}).get('pos')
        spec['camera'] = dict(cam_d)
        if keep_pos is not None and 'pos' not in cam_d: spec['camera']['pos'] = keep_pos
    W, H = spec.get('canvas', [3840, 1920])
    if board:
        b = imgio.load_flat(board); W, H = b.size
    spec['canvas'] = [int(round(W * scale)), int(round(H * scale))]
    spec.get('camera', {}).pop('W', None); spec.get('camera', {}).pop('H', None)
    cam, items, groups, rb = S.build_scene(spec)
    name = os.path.splitext(os.path.basename(scene_path))[0]
    files = {}
    ref = S.render(cam, items, wobble=wobble)
    files['reference'] = imgio.save(ref.convert('RGB'), imgio.out_path(out_dir, name + '_reference.png'))
    g = S.guide(cam, rb, groups, floor=spec.get('floor'), tile=(spec.get('room') or {}).get('tile', 1.0) or 1.0, labels=labels)
    files['guide'] = imgio.save(g, imgio.out_path(out_dir, name + '_guide.png'))
    if board:
        base = imgio.dim(b, 0.45).convert('RGBA')
        if base.size != g.size: base = base.resize(g.size, Image.LANCZOS)
        base.alpha_composite(g)
        files['over_board'] = imgio.save(base.convert('RGB'), imgio.out_path(out_dir, name + '_over_board.png'))
    return cam, files

if __name__ == '__main__':
    ap = argparse.ArgumentParser(description='Render a 3D blockout scene: clean reference + transparent guide.')
    ap.add_argument('scene'); ap.add_argument('--out', default='out/scene_render')
    ap.add_argument('--board', help='the sketch this scene should match (adds an overlay preview, sets the canvas size)')
    ap.add_argument('--camera', help='take the camera from a perspective_check JSON or an app export instead of the scene file')
    ap.add_argument('--scale', type=float, default=1.0, help='2 = double size output')
    ap.add_argument('--wobble', action='store_true', help='hand-drawn-looking outlines on the reference')
    ap.add_argument('--no-labels', action='store_true', help='leave prop names off the guide')
    a = ap.parse_args()
    cam, files = run(a.scene, a.out, a.board, a.camera, a.scale, a.wobble, not a.no_labels)
    vz = cam.vanishing_point((0, 0, 1))
    print('camera: lens %.1f deg, bend k=%.2f, tilt %.1f, skew %.1f, %dx%d' % (cam.fov, cam.k, cam.roll, cam.skew, cam.W, cam.H))
    if vz is not None: print('depth vanishing point at (%d, %d)' % (vz[0], vz[1]))
    print('saved: ' + ', '.join(files.values()))
