"""
cycle_guide.py
Reference guides for cycles, sized to your character. Starts with a cat walk: correct leg order,
contact / down / passing / up poses, and the bob of the body and head. Guides only: stick skeleton,
joints, ground contacts. Draw your own character over them.

    python cycle_guide.py cat_walk [--frames 12] [--match CHARACTER.png] [--region x0,y0,x1,y1]
                                   [--length PX] [--at X,GROUND_Y] [--facing right|left] [--travel]
                                   [--canvas 3840x1920] [--out DIR]
    python cycle_guide.py --list

  --frames   drawings in one full cycle (12 = a brisk walk on twos, 16 or 24 = slower)
  --match    size and place the guide from a drawing of the character: it reads the box around the ink
             (use --region to box just the character). The feet sit on the bottom of that box.
  --length   or give the size yourself: shoulder-to-hip distance in pixels
  --at       where the middle of the body stands: X, and the Y of the ground
  --travel   walk across the frame (feet stay planted) instead of walking on the spot

Writes NEW files in --out (default out/cycle_guide/<cycle>):
    <cycle>_01.png ...     transparent guide per drawing, full canvas size
    <cycle>_sheet.png      every pose on one page with its name, a footfall chart and the bob curves
    <cycle>.json           joint positions per drawing, in pixels
"""
import argparse, json, os, sys
import numpy as np
from PIL import Image, ImageDraw
from animtk import imgio, frames as F
from animtk.cycles import CYCLES

NEAR, FAR, BODY, GROUND, GEST = (20, 110, 235, 255), (235, 125, 0, 255), (60, 60, 70, 255), (150, 150, 160, 255), (220, 40, 110, 255)

def nearest_name(names, phase, tol):
    best = min(names, key=lambda p: min(abs(p - phase), 1 - abs(p - phase)))
    d = min(abs(best - phase), 1 - abs(best - phase))
    return names[best] if d <= tol else ''

def smooth(pts, n=12):
    """Catmull-Rom through the points, so the line of action is one flowing stroke"""
    P = np.array(pts, float); P = np.vstack([P[0], P, P[-1]]); out = []
    for i in range(1, len(P) - 2):
        for t in np.linspace(0, 1, n, endpoint=False):
            out.append(0.5 * ((2 * P[i]) + (-P[i - 1] + P[i + 1]) * t + (2 * P[i - 1] - 5 * P[i] + 4 * P[i + 1] - P[i + 2]) * t * t + (-P[i - 1] + 3 * P[i] - 3 * P[i + 1] + P[i + 2]) * t ** 3))
    out.append(P[-2]); return [tuple(p) for p in out]

def draw_pose(d, pose, to_px, unit, sc, label=None, ground_x=None):
    w = lambda n: max(1, int(round(n * sc)))
    J = {k: to_px(v) for k, v in pose.joints.items()}
    if ground_x: d.line([(ground_x[0], to_px((0, 0))[1]), (ground_x[1], to_px((0, 0))[1])], fill=GROUND, width=w(5))
    col = {'near': NEAR, 'far': FAR, 'body': BODY}
    for a, b, g in sorted(pose.bones, key=lambda t: {'far': 0, 'body': 1, 'near': 2}[t[2]]):
        d.line([J[a], J[b]], fill=col[g], width=w(11 if g == 'near' else 8))
    for j, r, g in pose.circles:
        x, y = J[j]; rr = r * unit; d.ellipse([x - rr, y - rr, x + rr, y + rr], outline=col[g], width=w(6))
    if pose.gesture: d.line(smooth([J[k] for k in pose.gesture]), fill=GEST, width=w(9), joint='curve')
    limb = {}
    for a, b, g in pose.bones:
        if g != 'body': limb[a] = g; limb[b] = g
    for k, (x, y) in J.items():
        r = 9 * sc; c = col.get(limb.get(k, 'body'))
        d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255, 255), outline=c, width=w(5))
    for foot, on in pose.down.items():                     # planted feet get a solid bar, lifted feet a hollow ring
        x, y = J[foot + '_toe']; c = col[limb.get(foot + '_toe', 'near')]
        if on: d.rectangle([x - 26 * sc, y + 10 * sc, x + 26 * sc, y + 22 * sc], fill=c)
        else: d.ellipse([x - 20 * sc, y - 20 * sc, x + 20 * sc, y + 20 * sc], outline=c, width=w(4))
    if label:
        hx, hy = J.get('head', list(J.values())[0]); imgio.tag(d, (hx - 60 * sc, hy - 0.42 * unit), label, bg=(30, 30, 36), size=40 * sc)

def measure_character(path, region=None):
    g, s = F.load_work(path); m = F.ink(g) & F.region_mask(g.shape, s, region)
    st = F.stats(m, s)
    if st is None: raise SystemExit('No ink found in %s%s.' % (path, ' inside that region' if region else ''))
    return st

def run(cycle, out_dir=None, frames=12, match=None, region=None, length=None, at=None, facing='right', travel=False, canvas=(3840, 1920)):
    if cycle not in CYCLES: raise SystemExit('Unknown cycle "%s". Known: %s' % (cycle, ', '.join(CYCLES)))
    C = CYCLES[cycle]; W, H = canvas; note = ''
    if match:
        W, H = imgio.load_flat(match).size; st = measure_character(match, region); x0, y0, x1, y1 = st['box']
        unit = length or (y1 - y0) / C['height']; cx = (x0 + x1) / 2; ground = y1
        note = 'sized from %s: box %d x %d px, so shoulder-to-hip = %d px' % (os.path.basename(match), x1 - x0, y1 - y0, unit)
    else:
        unit = length or W * 0.16; cx, ground = W / 2, H * 0.8
    if at: cx, ground = at
    sgn = 1 if facing == 'right' else -1; sc = W / 3840
    out_dir = out_dir or os.path.join('out', 'cycle_guide', cycle)
    names = C['names'](); near = 'R' if facing == 'right' else 'L'
    total = C['speed'] * unit                               # how far the body travels in one cycle
    data = dict(cycle=cycle, about=C['about'], frames=frames, facing=facing, canvas=[W, H], unit_px=round(unit, 1), ground_y=round(ground, 1),
                travel_px_per_cycle=round(total, 1), note=note, drawings=[])
    files = {}; poses = []
    for k in range(frames):
        ph = (C['start'] + k / frames) % 1.0
        pose = C['pose'](ph, near); shift = sgn * total * (k / frames - 0.5) if travel else 0.0
        to_px = lambda p, shift=shift: (cx + shift + sgn * p[0] * unit, ground - p[1] * unit)
        name = nearest_name(names, ph, 0.5 / frames + 1e-9)
        img = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
        span = (cx - 1.4 * unit - (total / 2 if travel else 0), cx + 1.4 * unit + (total / 2 if travel else 0))
        draw_pose(d, pose, to_px, unit, sc, '%d  %s' % (k + 1, name) if name else str(k + 1), span)
        files['%02d' % (k + 1)] = imgio.save(img, imgio.out_path(out_dir, '%s_%02d.png' % (cycle, k + 1)))
        poses.append((pose, name, ph))
        data['drawings'].append(dict(n=k + 1, phase=round(ph, 4), pose=name, feet_down=[f for f in C['feet'] if pose.down[f]],
                                     joints={j: [round(v, 1) for v in to_px(p)] for j, p in pose.joints.items()}))
    files['sheet'] = imgio.save(sheet(C, cycle, poses, near), imgio.out_path(out_dir, cycle + '_sheet.png'))
    files['json'] = imgio.out_path(out_dir, cycle + '.json')
    with open(files['json'], 'w', encoding='utf-8') as fh: json.dump(data, fh, indent=1)
    return data, files

def sheet(C, cycle, poses, near):
    n = len(poses); cols = min(n, 6 if n <= 12 else 8); rows = (n + cols - 1) // cols
    cw, ch = 620, 470; pad = 30; chart = 430
    SW = cols * cw + pad * 2; SH = rows * ch + chart + pad * 2 + 70
    S = Image.new('RGBA', (SW, SH), (255, 255, 255, 255)); d = ImageDraw.Draw(S)
    d.text((pad, pad - 6), '%s: %s' % (cycle.replace('_', ' '), C['about']), fill=(40, 40, 48), font=imgio.font(30))
    unit = cw / 2.6
    for k, (pose, name, ph) in enumerate(poses):
        ox = pad + (k % cols) * cw + cw / 2; oy = pad + 70 + (k // cols) * ch + ch * 0.86
        to_px = lambda p, ox=ox, oy=oy: (ox + p[0] * unit, oy - p[1] * unit)
        draw_pose(d, pose, to_px, unit, 0.42, None, (ox - cw * 0.46, ox + cw * 0.46))
        imgio.tag(d, (ox - cw * 0.46, oy - ch * 0.80), '%d  %s' % (k + 1, name) if name else str(k + 1), bg=(30, 30, 36), size=24)
    # footfall chart: one row per foot, a bar wherever that foot is on the ground
    y0 = pad + 70 + rows * ch + 20; left = pad + 250; cwid = (SW - left - pad) / n
    d.text((pad, y0), 'Feet on the ground', fill=(40, 40, 48), font=imgio.font(28))
    label = {'LH': 'left hind', 'LF': 'left fore', 'RH': 'right hind', 'RF': 'right fore'}
    for r, foot in enumerate(C['feet']):
        yy = y0 + 46 + r * 44; col = NEAR if foot[0] == near else FAR
        d.text((pad, yy), label.get(foot, foot) + (' (near)' if foot[0] == near else ' (far)'), fill=col[:3], font=imgio.font(24, False))
        for k, (pose, name, ph) in enumerate(poses):
            x = left + k * cwid
            if pose.down[foot]: d.rectangle([x + 2, yy + 4, x + cwid - 2, yy + 30], fill=col)
            else: d.rectangle([x + 2, yy + 4, x + cwid - 2, yy + 30], outline=(200, 200, 208), width=2)
    yy = y0 + 46 + len(C['feet']) * 44
    for k in range(n): d.text((left + k * cwid + cwid / 2 - 8, yy), str(k + 1), fill=(90, 90, 100), font=imgio.font(22, False))
    # bob: how high the shoulders, hips and head ride on each drawing
    yy += 44; d.text((pad, yy), 'Up and down (bob)', fill=(40, 40, 48), font=imgio.font(28))
    for r, (j, nm, colr) in enumerate((('head', 'head', GEST), ('shoulder', 'shoulders', NEAR), ('hip', 'hips', FAR))):
        if j not in poses[0][0].joints: continue
        ys = np.array([p.joints[j][1] for p, _, _ in poses]); mid = ys.mean(); amp = max(np.abs(ys - mid).max(), 1e-6)
        base = yy + 60 + r * 36
        d.text((pad, base - 14), nm, fill=colr[:3], font=imgio.font(24, False))
        pts = [(left + k * cwid + cwid / 2, base - (ys[k] - mid) / amp * 13) for k in range(n)]
        d.line(pts, fill=colr, width=4, joint='curve')
        for x, y in pts: d.ellipse([x - 5, y - 5, x + 5, y + 5], fill=colr)
    return S.convert('RGB')

if __name__ == '__main__':
    ap = argparse.ArgumentParser(description='Reference guides for cycles (cat walk), sized to your character.')
    ap.add_argument('cycle', nargs='?'); ap.add_argument('--list', action='store_true'); ap.add_argument('--frames', type=int, default=12)
    ap.add_argument('--match'); ap.add_argument('--region'); ap.add_argument('--length', type=float); ap.add_argument('--at')
    ap.add_argument('--facing', default='right', choices=['right', 'left']); ap.add_argument('--travel', action='store_true')
    ap.add_argument('--canvas', default='3840x1920'); ap.add_argument('--out')
    a = ap.parse_args()
    if a.list or not a.cycle:
        for k, v in CYCLES.items(): print('%-10s %s' % (k, v['about']))
        sys.exit(0)
    data, files = run(a.cycle, a.out, a.frames, a.match, [int(v) for v in a.region.split(',')] if a.region else None, a.length,
                      [float(v) for v in a.at.split(',')] if a.at else None, a.facing, a.travel, tuple(int(v) for v in a.canvas.lower().split('x')))
    if data['note']: print(data['note'])
    print('%d drawings, shoulder-to-hip %d px, ground at y %d, body travels %d px per cycle' % (data['frames'], data['unit_px'], data['ground_y'], data['travel_px_per_cycle']))
    for dr in data['drawings']: print('  %2d  %-22s feet down: %s' % (dr['n'], dr['pose'], ' '.join(dr['feet_down'])))
    print('saved: %s ... %s, %s, %s' % (files['01'], os.path.basename(files['%02d' % data['frames']]), files['sheet'], files['json']))
