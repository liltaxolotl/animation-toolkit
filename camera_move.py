"""
camera_move.py
Plans a pan, a zoom, or both: how big the background canvas has to be so the move never runs off
the edge, and a per-frame table of camera center and layer scale, plus where each field-sized
drawing sits on the big canvas. Same math as camera mode in the app.

    python camera_move.py --key 1,0,0,100 --key 25,1900,0,100 --key 49,1900,-200,160 [--name shot]
    python camera_move.py --images 1:KEY_A.png 25:KEY_B.png            (reads the move off the drawings)
    python camera_move.py --json MOVE.json                             (a move saved from the app)
      [--size 3840x1920] [--ease inout|in|out|linear] [--margin 0.05] [--out DIR]

  --key     frame,x,y,zoom%   x,y = where the camera center is, in field pixels at 100%, counted from
            the first key (right and down are positive). zoom 100 = normal, 200 = pushed in to twice the size.
            Add ,in / ,out / ,linear / ,inout to set the easing leaving that key.
  --images  frame:file pairs. It lines up the lines the drawings share (the background) to work out the
            pan and zoom between them, and prints how sure it is. Low confidence = type --key numbers.
            The drawings are also laid onto the plan picture where they belong.
  --margin  spare room around the whole move, as a share of the field (0.05 = 5% on every side)

Writes NEW files in --out (default out/camera_move):
    <name>_camera.csv    one row per frame: camera center on the canvas, view size, layer scale and
                         position, and where a drawing made for that frame goes on the canvas
    <name>_plan.png      the canvas with the camera frame at every key and the path between them
    <name>_camera.json   canvas size, keys and the whole table
"""
import argparse, csv, json, os
import numpy as np
from PIL import Image, ImageDraw
from animtk import imgio, cammove as CM

COLS = [(30, 110, 235), (225, 50, 60), (0, 150, 80), (235, 125, 0), (130, 60, 200), (0, 150, 150)]

def parse_key(text, default_ease):
    p = text.split(',')
    if len(p) < 4: raise SystemExit('A key needs frame,x,y,zoom%% (got "%s").' % text)
    return dict(frame=int(float(p[0])), x=float(p[1]), y=float(p[2]), zoom=float(p[3]) / 100.0, ease=p[4] if len(p) > 4 else default_ease)

def keys_from_images(pairs, default_ease, W, H):
    """work out the camera keys from drawings of the keys"""
    pairs = sorted(pairs, key=lambda t: t[0]); notes = []
    keys = [dict(frame=pairs[0][0], x=0.0, y=0.0, zoom=1.0, ease=default_ease)]
    prev = imgio.load_gray(pairs[0][1])
    for f, path in pairs[1:]:
        g = imgio.load_gray(path); e = CM.estimate(prev, g); k = keys[-1]
        zoom = k['zoom'] * e['zoom_ratio']
        if abs(e['zoom_ratio'] - 1) < 0.03: zoom = k['zoom']                    # call a hair of zoom no zoom
        dx, dy = [0.0 if abs(v) < W * 0.004 else v for v in (e['dx'], e['dy'])]       # a few pixels of drift between hand-drawn keys is no move
        keys.append(dict(frame=f, x=k['x'] + dx / k['zoom'], y=k['y'] + dy / k['zoom'], zoom=zoom, ease=default_ease))
        sure = CM.sureness(e)
        notes.append('frame %d to %d: camera moves %d right, %d down, zoom x%.2f  (match %s: %d%% of the lines agree)' % (keys[-2]['frame'], f, dx, dy, zoom / k['zoom'], sure, round(e['confidence'] * 100)))
        if sure == 'NOT reliable': notes.append('  -> the two drawings share too little still linework. Give --key numbers for this one instead.')
        prev = g
    return keys, notes

def plan_picture(p, images=None, width=2600):
    cw, ch = p['canvas']; W, H = p['field']; s = (width - 120) / cw; pad = 60; top = 110
    img = Image.new('RGB', (width, int(ch * s) + top + pad + 60), (245, 244, 247)); d = ImageDraw.Draw(img)
    X = lambda v: pad + v * s; Y = lambda v: top + v * s
    d.rectangle([X(0), Y(0), X(cw), Y(ch)], fill=(255, 255, 255), outline=(60, 60, 70), width=4)
    rows = {r['frame']: r for r in p['rows']}
    if images:                                             # lay each key drawing where it belongs on the canvas
        base = np.full((int(ch * s) + 1, int(cw * s) + 1, 3), 255, np.float32)
        for f, path in images:
            r = rows.get(f)
            if not r: continue
            k = r['place_scale'] / 100 * s; im = imgio.load_flat(path)
            im = im.resize((max(1, int(im.width * k)), max(1, int(im.height * k))), Image.LANCZOS)
            a = np.asarray(im, np.float32); a = 255 - (255 - a) * 0.55
            x, y = int(round(r['place_x'] * s)), int(round(r['place_y'] * s))
            x0, y0 = max(x, 0), max(y, 0); x1, y1 = min(x + a.shape[1], base.shape[1]), min(y + a.shape[0], base.shape[0])
            if x1 > x0 and y1 > y0: base[y0:y1, x0:x1] *= a[y0 - y:y1 - y, x0 - x:x1 - x] / 255
        img.paste(Image.fromarray(base.astype(np.uint8)), (pad, top)); d.rectangle([X(0), Y(0), X(cw), Y(ch)], outline=(60, 60, 70), width=4)
    pts = [(X(r['canvas_cx']), Y(r['canvas_cy'])) for r in p['rows']]
    if len(pts) > 1: d.line(pts, fill=(110, 110, 120), width=3)
    for x, y in pts: d.ellipse([x - 3, y - 3, x + 3, y + 3], fill=(110, 110, 120))
    for i, k in enumerate(p['keys']):
        r = rows[k['frame']]; col = COLS[i % len(COLS)]
        x0, y0 = X(r['canvas_cx'] - r['view_w'] / 2), Y(r['canvas_cy'] - r['view_h'] / 2); x1, y1 = X(r['canvas_cx'] + r['view_w'] / 2), Y(r['canvas_cy'] + r['view_h'] / 2)
        d.rectangle([x0, y0, x1, y1], outline=col, width=6)
        d.ellipse([X(r['canvas_cx']) - 9, Y(r['canvas_cy']) - 9, X(r['canvas_cx']) + 9, Y(r['canvas_cy']) + 9], fill=col)
        imgio.tag(d, (x0 + 10, y0 + 10 + (i % 2) * 46), 'frame %d  %d%%' % (k['frame'], round(k['zoom'] * 100)), bg=col, size=28)
    d.text((pad, 22), 'Canvas needed: %d x %d px' % (cw, ch), fill=(30, 30, 36), font=imgio.font(40))
    d.text((pad, 70), 'field %d x %d, tightest zoom %d%%, %d frames. Boxes = what the camera sees at each key. Dots = its center, one per frame.' %
           (W, H, round(p['zoom_max'] * 100), len(p['rows'])), fill=(90, 90, 100), font=imgio.font(24, False))
    return img

def run(keys, out_dir='out/camera_move', name='shot', W=3840, H=1920, margin=0.0, images=None):
    p = CM.plan(keys, W, H, margin); over = CM.check(p)
    files = dict(csv=imgio.out_path(out_dir, name + '_camera.csv'), json=imgio.out_path(out_dir, name + '_camera.json'))
    cols = ['frame', 'x', 'y', 'zoom', 'canvas_cx', 'canvas_cy', 'view_w', 'view_h', 'layer_scale', 'layer_x', 'layer_y', 'place_x', 'place_y', 'place_scale']
    with open(files['csv'], 'w', newline='', encoding='utf-8') as fh:
        w = csv.writer(fh); w.writerow(cols)
        for r in p['rows']: w.writerow([r[c] for c in cols])
    with open(files['json'], 'w', encoding='utf-8') as fh: json.dump(p, fh, indent=1)
    files['plan'] = imgio.save(plan_picture(p, images), imgio.out_path(out_dir, name + '_plan.png'))
    return p, over, files

if __name__ == '__main__':
    ap = argparse.ArgumentParser(description='Plan a pan or zoom: canvas size, per-frame table, layer placement.')
    ap.add_argument('--key', action='append', default=[]); ap.add_argument('--images', nargs='+'); ap.add_argument('--json')
    ap.add_argument('--size', default='3840x1920'); ap.add_argument('--ease', default='inout', choices=['inout', 'in', 'out', 'linear'])
    ap.add_argument('--margin', type=float, default=0.0); ap.add_argument('--out', default='out/camera_move'); ap.add_argument('--name', default='shot')
    a = ap.parse_args(); W, H = [int(v) for v in a.size.lower().split('x')]; images = None; notes = []
    if a.json:
        j = json.load(open(a.json, encoding='utf-8')); imgio.protect(a.json); keys = j['keys']; W, H = j.get('field', [W, H]); a.margin = j.get('margin', a.margin)
    elif a.images:
        images = [(int(t.split(':', 1)[0]), t.split(':', 1)[1]) for t in a.images]
        W, H = imgio.load_flat(images[0][1]).size
        keys, notes = keys_from_images(images, a.ease, W, H)
        for k in a.key:                                    # typed keys override what was read off the drawings
            kk = parse_key(k, a.ease); keys = [q for q in keys if q['frame'] != kk['frame']] + [kk]
    else:
        if not a.key: raise SystemExit('Give --key frame,x,y,zoom%% (two or more), or --images, or --json.')
        keys = [parse_key(k, a.ease) for k in a.key]
    p, over, files = run(keys, a.out, a.name, W, H, a.margin, images)
    for n in notes: print(n)
    print('keys: ' + '  '.join('f%d (%d, %d) %d%%' % (k['frame'], k['x'], k['y'], round(k['zoom'] * 100)) for k in p['keys']))
    print('CANVAS NEEDED: %d x %d px  (field %d x %d, tightest zoom %d%%, %d frames%s)' % (p['canvas'][0], p['canvas'][1], W, H, round(p['zoom_max'] * 100), len(p['rows']), ', %d%% margin' % round(a.margin * 100) if a.margin else ''))
    print('edge check: ' + ('the view stays inside the canvas on every frame' if over < 0.6 else 'RUNS OFF by %.1f px' % over))
    r0, r1 = p['rows'][0], p['rows'][-1]
    print('first frame %d: canvas layer scale %.1f%%, layer center at (%d, %d) in the comp' % (r0['frame'], r0['layer_scale'], r0['layer_x'], r0['layer_y']))
    print('last frame %d:  canvas layer scale %.1f%%, layer center at (%d, %d) in the comp' % (r1['frame'], r1['layer_scale'], r1['layer_x'], r1['layer_y']))
    print('saved: ' + ', '.join(files.values()))
