"""
value_check.py
Shows a drawing as a pure black silhouette and as plain grayscale, side by side, so you can judge
whether the pose reads without its inside lines and whether the values separate. Same idea as value
mode in the app. One frame, or a whole folder as a contact sheet.

    python value_check.py FRAME.png            -> side by side picture + the silhouette on its own
    python value_check.py FRAMES_FOLDER        -> contact sheet: original, silhouette, grayscale per frame
      [--mode auto|lines|tone|alpha] [--gap 4] [--threshold N] [--levels N] [--edge auto|open]
      [--fill X,Y ...] [--clear X,Y ...] [--frames 1,5,9] [--cols 6] [--each] [--out DIR]

  --mode       auto picks: alpha if the PNG background is transparent, tone if the frame is painted or
               toned, lines for line art on white paper
  --gap        line art only: how big a gap in the linework still counts as closed (work pixels; the
               drawing is 960 wide while it is worked out, so 4 is about 16 px on a 3840 board). Raise it
               if the silhouette leaks, lower it if fingers or legs glue together.
  --threshold  tone only: anything darker than this gray (0..255) is figure. Default: picked per frame.
  --levels     squash the grayscale into N flat steps (3 = dark, middle, light). 0 = leave it smooth.
  --fill X,Y   line art only: force the patch of paper at that point to black (full-size pixels). Use it
               when the automatic guess left part of the figure white, for example a body that leaves
               the frame through a corner. With a folder it only applies when --frames picks one frame.
  --clear X,Y  the opposite: force that patch back to white (a gap between legs that filled in,
               or background that got taken for a body).
  --edge       auto: a patch that touches only one side of the frame is treated as a body cut off by the
               frame and filled. open: everything that touches the frame edge is background.
  --each       with a folder: also save the side by side picture for every frame

Writes NEW files in --out (default out/value_check):
    <name>_value.png        silhouette | grayscale at full size
    <name>_silhouette.png   pure black on white, full size
    <folder>_value_sheet.png, <folder>_value.json   for a folder
"""
import argparse, json, os
import numpy as np
from PIL import Image, ImageDraw
from animtk import imgio, value as V

def analyse(path, a, points=True):
    rgba = np.array(imgio.load_rgba(path)); alpha = rgba[..., 3]
    flat = np.array(imgio.load_flat(path)); gray = V.luminance(flat)
    mask, info = V.silhouette(gray, alpha, a.mode, a.gap, a.threshold, a.fill if points else (), a.clear if points else (), a.edge)
    sep = V.separation(gray, mask) if info['mode'] != 'lines' else None
    if sep: info.update(sep)
    return flat, V.posterize(gray, a.levels), mask, info

def sil_image(mask): return Image.fromarray(np.where(mask, 0, 255).astype(np.uint8)).convert('RGB')

def side_by_side(mask, gray, info):
    h, w = gray.shape; gapx = max(8, w // 200)
    img = Image.new('RGB', (w * 2 + gapx, h), (255, 120, 170)); img.paste(sil_image(mask), (0, 0)); img.paste(Image.fromarray(gray).convert('RGB'), (w + gapx, 0))
    d = ImageDraw.Draw(img); s = max(18, w // 80)
    imgio.tag(d, (s, s), 'SILHOUETTE  (%s, covers %s%% of the frame)' % (info['mode'], info['coverage']), size=s)
    imgio.tag(d, (w + gapx + s, s), 'GRAYSCALE' + ('  figure %(figure)s, background %(background)s, apart by %(separation)s of 100' % info if 'separation' in info else ''), size=s)
    return img

def describe(info):
    t = '%s, covers %s%% of the frame, %d separate piece%s' % (info['mode'], info['coverage'], info['pieces'], '' if info['pieces'] == 1 else 's')
    if info.get('cut_by_frame'): t += ', %d patch%s touching one frame edge filled as cut off bodies (use --edge open or --clear X,Y if that is wrong)' % (info['cut_by_frame'], '' if info['cut_by_frame'] == 1 else 'es')
    if 'separation' in info:
        sep = info['separation']; t += '; figure %s vs background %s (0 black, 100 white): %s' % (info['figure'], info['background'], 'reads clearly' if sep >= 30 else 'close in value, look here' if sep < 15 else 'separates, but not by much')
    return t

def run_one(path, a):
    flat, gray, mask, info = analyse(path, a); name = os.path.splitext(os.path.basename(path))[0]
    f1 = imgio.save(side_by_side(mask, gray, info), imgio.out_path(a.out, name + '_value.png'))
    f2 = imgio.save(sil_image(mask), imgio.out_path(a.out, name + '_silhouette.png'))
    return info, [f1, f2]

def run_folder(folder, a):
    files = imgio.frame_files(folder)
    if a.frames: files = [files[i - 1] for i in a.frames if 0 < i <= len(files)]
    if not files: raise SystemExit('No frames found in %s' % folder)
    name = os.path.basename(os.path.normpath(folder)); tw = 480; rows = []; made = []
    for f in files:
        flat, gray, mask, info = analyse(f, a, points=len(files) == 1); info['file'] = os.path.basename(f); rows.append((flat, gray, mask, info))
        if a.each: made.append(imgio.save(side_by_side(mask, gray, info), imgio.out_path(a.out, os.path.splitext(info['file'])[0] + '_value.png')))
    th = int(round(tw * rows[0][0].shape[0] / rows[0][0].shape[1])); cols = min(a.cols, len(rows)); bands = -(-len(rows) // cols)
    pad, lab, left = 10, 30, 150; bh = lab + 3 * (th + pad) + 14
    sheet = Image.new('RGB', (left + cols * (tw + pad) + pad, bands * bh + 20), (245, 244, 247)); d = ImageDraw.Draw(sheet)
    small = lambda im: im.resize((tw, th), Image.LANCZOS)
    for i, (flat, gray, mask, info) in enumerate(rows):
        b, c = divmod(i, cols); x = left + c * (tw + pad); y = 10 + b * bh
        d.text((x + 2, y + 2), '%s   %s%%' % (info['file'], info['coverage']) + ('   apart %s' % info['separation'] if 'separation' in info else ''), fill=(40, 40, 50), font=imgio.font(18))
        for k, im in enumerate([Image.fromarray(flat), sil_image(mask), Image.fromarray(gray).convert('RGB')]):
            sheet.paste(small(im), (x, y + lab + k * (th + pad))); d.rectangle([x, y + lab + k * (th + pad), x + tw - 1, y + lab + k * (th + pad) + th - 1], outline=(190, 188, 198))
        if c == 0:
            for k, t in enumerate(['original', 'silhouette', 'grayscale']): d.text((12, y + lab + k * (th + pad) + th // 2 - 10), t, fill=(90, 90, 100), font=imgio.font(20))
    made.insert(0, imgio.save(sheet, imgio.out_path(a.out, name + '_value_sheet.png')))
    report = imgio.out_path(a.out, name + '_value.json')
    with open(report, 'w', encoding='utf-8') as fh: json.dump([r[3] for r in rows], fh, indent=1)
    return [r[3] for r in rows], made + [report]

if __name__ == '__main__':
    pt = lambda t: tuple(float(v) for v in t.split(','))
    ap = argparse.ArgumentParser(description='Silhouette and grayscale of a frame or a folder of frames.')
    ap.add_argument('src'); ap.add_argument('--mode', default='auto', choices=['auto', 'lines', 'tone', 'alpha'])
    ap.add_argument('--gap', type=int, default=4); ap.add_argument('--threshold', type=int); ap.add_argument('--levels', type=int, default=0)
    ap.add_argument('--edge', default='auto', choices=['auto', 'open']); ap.add_argument('--fill', type=pt, nargs='+', default=[]); ap.add_argument('--clear', type=pt, nargs='+', default=[])
    ap.add_argument('--frames', type=lambda t: [int(v) for v in t.split(',')]); ap.add_argument('--cols', type=int, default=6); ap.add_argument('--each', action='store_true')
    ap.add_argument('--out', default='out/value_check')
    a = ap.parse_args()
    if os.path.isdir(a.src):
        infos, files = run_folder(a.src, a)
        for i in infos: print('%s: %s' % (i['file'], describe(i)))
    else:
        info, files = run_one(a.src, a); print(describe(info))
    print('saved: ' + ', '.join(files))
