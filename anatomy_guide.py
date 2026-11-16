"""
anatomy_guide.py
Draws a proportion and balance guide over a figure drawing and points at things worth a second look:
uneven limbs, weight that is not over the feet, a cat leg bending the wrong way, knuckles off their arc.
It only guides. It never redraws anything, and it measures the drawing against itself (or against a
model sheet you mark up the same way), not against a generic realistic body.

It cannot find joints on its own. Three steps:

  1. python anatomy_guide.py DRAWING.png --grid [--region X0,Y0,X1,Y1] [--step N]
        writes <name>_grid.png: the drawing with a numbered pixel grid, to read joint positions from.
        --region zooms into one part so small things (a hand) can be read accurately.
  2. python anatomy_guide.py --template human|cat|hand [--save FILE.json]
        prints a blank landmark file. Fill in "points" with [x, y] from the grid picture. Leave any
        hidden or undrawn point as null.
  3. python anatomy_guide.py DRAWING.png --landmarks POINTS.json [--model MODEL_POINTS.json] [--max-flags 6] [--out DIR]
        --model  landmarks of the same character on a model sheet: adds "off model" checks

Writes NEW files in --out (default out/anatomy_guide):
    <name>_anatomy_guide.png  transparent overlay at the drawing's size: bones, joints, plumb line,
                              numbered marks. Put it on a layer above the drawing.
    <name>_anatomy_over.png   the same overlay on a faded copy of the drawing, with the notes written out
    <name>_anatomy.json       every flag, note and measurement
"""
import argparse, json, os, sys, textwrap
import numpy as np
from PIL import Image, ImageDraw
from animtk import imgio, anatomy as A

COL = dict(mid=(20, 160, 90), l=(30, 110, 235), r=(235, 110, 20))
FLAG = (225, 40, 70)

def grid_picture(path, region=None, step=None, width=2000):
    im = imgio.load_flat(path); W, H = im.size
    x0, y0, x1, y1 = region if region else (0, 0, W, H)
    x0, y0, x1, y1 = max(0, int(x0)), max(0, int(y0)), min(W, int(x1)), min(H, int(y1))
    crop = im.crop((x0, y0, x1, y1)); s = width / crop.width
    crop = crop.resize((width, max(1, int(round(crop.height * s)))), Image.LANCZOS)
    if not step:
        raw = (x1 - x0) / 20
        step = next((n for n in (5, 10, 20, 25, 50, 100, 200, 250, 500) if n >= raw), 500)
    m = 70; out = Image.new('RGB', (crop.width + m, crop.height + m), (255, 255, 255)); out.paste(imgio.dim(crop, 0.25), (m, m))
    d = ImageDraw.Draw(out, 'RGBA'); f = imgio.font(20); fs = imgio.font(15, False)
    for i, gx in enumerate(range((x0 // step + 1) * step if x0 % step else x0, x1 + 1, step)):
        X = m + (gx - x0) * s; major = (gx // step) % 2 == 0
        d.line([X, m, X, out.height], fill=(230, 40, 90, 150 if major else 70), width=2 if major else 1)
        if major: d.text((X - 20, 22 + (i % 2) * 20), str(gx), fill=(180, 20, 60), font=f)
    for gy in range((y0 // step + 1) * step if y0 % step else y0, y1 + 1, step):
        Y = m + (gy - y0) * s; major = (gy // step) % 2 == 0
        d.line([m, Y, out.width, Y], fill=(30, 110, 235, 150 if major else 70), width=2 if major else 1)
        if major: d.text((6, Y - 12), str(gy), fill=(20, 80, 190), font=f)
    for gx in range((x0 // (step * 4) + 1) * step * 4, x1, step * 4):          # coordinates repeated inside the picture
        for gy in range((y0 // (step * 4) + 1) * step * 4, y1, step * 4):
            d.text((m + (gx - x0) * s + 4, m + (gy - y0) * s + 3), '%d,%d' % (gx, gy), fill=(90, 90, 100, 210), font=fs)
    return out, step

def draw_guide(size, rep, scale=1.0):
    """transparent overlay. scale = line weight multiplier (1 = sized for the drawing)."""
    W, H = size; u = max(2.0, W / 640.0) * scale; img = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    P = {k: np.array(v) for k, v in rep['points'].items()}
    for m in rep['marks']:
        if m['kind'] == 'curve':
            pts = np.array(m['pts'], float); t = np.linspace(0, 1, len(pts)); tt = np.linspace(0, 1, 60)
            deg = min(3, len(pts) - 1); xs = np.polyval(np.polyfit(t, pts[:, 0], deg), tt); ys = np.polyval(np.polyfit(t, pts[:, 1], deg), tt)
            d.line(list(zip(xs, ys)), fill=(160, 60, 200, 200), width=int(u * 1.6), joint='curve')
        elif m['kind'] == 'balance':
            cx, cy = m['com']; g = m['ground']; ok = m['lo'] <= cx <= m['hi']; col = (20, 160, 90, 230) if ok else FLAG + (230,)
            for y in np.arange(cy, g, u * 9): d.line([cx, y, cx, min(g, y + u * 5)], fill=col, width=int(u * 1.3))       # plumb line from the weight to the ground
            d.ellipse([cx - u * 5, cy - u * 5, cx + u * 5, cy + u * 5], outline=col, width=int(u * 1.5)); d.line([cx - u * 5, cy, cx + u * 5, cy], fill=col, width=int(u)); d.line([cx, cy - u * 5, cx, cy + u * 5], fill=col, width=int(u))
            d.line([m['lo'], g + u * 4, m['hi'], g + u * 4], fill=(20, 160, 90, 230), width=int(u * 3))                   # what holds the character up
    for a, b, side in A.RIGS[rep['rig']]['bones']:
        if a in P and b in P: d.line([tuple(P[a]), tuple(P[b])], fill=COL[side] + (235,), width=int(u * 2))
    for names, side in A.RIGS[rep['rig']].get('chains', []):                # a chain skips any joint that was left out
        have = [n for n in names if n in P]
        for a, b in zip(have[:-1], have[1:]): d.line([tuple(P[a]), tuple(P[b])], fill=COL[side] + (235,), width=int(u * 2))
    if rep['rig'] == 'human' and 'head_top' in P and 'chin' in P:
        c = (P['head_top'] + P['chin']) / 2; r = np.linalg.norm(P['head_top'] - P['chin']) / 2
        d.ellipse([c[0] - r * 0.8, c[1] - r, c[0] + r * 0.8, c[1] + r], outline=COL['mid'] + (235,), width=int(u * 1.5))
    for k, p in P.items(): d.ellipse([p[0] - u * 2.6, p[1] - u * 2.6, p[0] + u * 2.6, p[1] + u * 2.6], fill=(255, 255, 255, 255), outline=(30, 30, 40, 255), width=int(max(1, u)))
    f = imgio.font(u * 11)
    for fl in rep['flags']:
        x, y = fl['at']; r = u * 11
        d.ellipse([x - r * 1.9, y - r * 1.9, x + r * 1.9, y + r * 1.9], outline=FLAG + (255,), width=int(u * 2))
        bx, by = min(W - r * 2.4, x + r * 2.0), max(r * 1.2, y - r * 2.0)
        d.ellipse([bx - r, by - r, bx + r, by + r], fill=FLAG + (255,)); t = str(fl['n']); l, tp, rr, bt = d.textbbox((0, 0), t, font=f); d.text((bx - (rr - l) / 2 - l, by - (bt - tp) / 2 - tp), t, fill=(255, 255, 255, 255), font=f)
    return img

def over_picture(path, overlay, rep):
    base = imgio.dim(imgio.load_flat(path), 0.5).convert('RGBA'); base.alpha_composite(overlay); W, H = base.size
    fs = max(18, W // 95); f = imgio.font(fs, False); fb = imgio.font(fs); wrap = int(W / (fs * 0.52))
    lines = []
    for fl in rep['flags']: lines += [(FLAG, fb, ln if i else '%d. %s' % (fl['n'], ln)) for i, ln in enumerate(textwrap.wrap(fl['text'], wrap - 4))]
    if not rep['flags']: lines.append(((20, 140, 80), fb, 'Nothing flagged.'))
    for n in rep['notes']: lines += [((70, 70, 82), f, ln) for ln in textwrap.wrap(n, wrap)]
    lh = int(fs * 1.4); out = Image.new('RGB', (W, H + lh * len(lines) + fs * 2), (250, 249, 252)); out.paste(base.convert('RGB'), (0, 0)); d = ImageDraw.Draw(out)
    for i, (col, font, ln) in enumerate(lines): d.text((fs, H + fs + i * lh), ln, fill=col, font=font)
    return out

def run(path, landmarks, model=None, out_dir='out/anatomy_guide', max_flags=6):
    rep = A.check(landmarks, model, max_flags); im = imgio.load_flat(path); name = os.path.splitext(os.path.basename(path))[0]
    overlay = draw_guide(im.size, rep)
    files = [imgio.save(overlay, imgio.out_path(out_dir, name + '_anatomy_guide.png')), imgio.save(over_picture(path, overlay, rep), imgio.out_path(out_dir, name + '_anatomy_over.png'))]
    rep['image'] = os.path.basename(path); rp = imgio.out_path(out_dir, name + '_anatomy.json')
    with open(rp, 'w', encoding='utf-8') as fh: json.dump(rep, fh, indent=1)
    return rep, files + [rp]

if __name__ == '__main__':
    ap = argparse.ArgumentParser(description='Proportion and balance guide over a figure drawing.')
    ap.add_argument('drawing', nargs='?'); ap.add_argument('--grid', action='store_true'); ap.add_argument('--region', type=lambda t: [float(v) for v in t.split(',')]); ap.add_argument('--step', type=int)
    ap.add_argument('--template', choices=list(A.RIGS)); ap.add_argument('--save'); ap.add_argument('--landmarks'); ap.add_argument('--model'); ap.add_argument('--max-flags', type=int, default=6)
    ap.add_argument('--out', default='out/anatomy_guide')
    a = ap.parse_args()
    if a.template:
        t = json.dumps(A.template(a.template), indent=1)
        if a.save:
            if os.path.exists(a.save): raise SystemExit('%s already exists. Pick a new name so nothing is overwritten.' % a.save)
            open(a.save, 'w', encoding='utf-8').write(t); print('saved: ' + a.save)
        else: print(t)
        sys.exit(0)
    if not a.drawing: raise SystemExit('Give a drawing, or --template human|cat|hand.')
    name = os.path.splitext(os.path.basename(a.drawing))[0]
    if a.grid:
        img, step = grid_picture(a.drawing, a.region, a.step)
        p = imgio.save(img, imgio.out_path(a.out, name + ('_grid.png' if not a.region else '_grid_%d_%d.png' % (a.region[0], a.region[1]))))
        print('grid every %d px (labels on every second line), red numbers = x, blue numbers = y, in full-size pixels' % step); print('saved: ' + p); sys.exit(0)
    if not a.landmarks: raise SystemExit('Give --landmarks POINTS.json (see --grid and --template for how to make one).')
    imgio.protect(a.landmarks, a.model)
    rep, files = run(a.drawing, json.load(open(a.landmarks, encoding='utf-8')), json.load(open(a.model, encoding='utf-8')) if a.model else None, a.out, a.max_flags)
    print('%s rig, %d points' % (rep['rig'], len(rep['points'])))
    for f in rep['flags']: print('  %d. at (%d, %d): %s' % (f['n'], f['at'][0], f['at'][1], f['text']))
    if not rep['flags']: print('  nothing flagged')
    for n in rep['notes']: print('  note: ' + n)
    print('saved: ' + ', '.join(files))
