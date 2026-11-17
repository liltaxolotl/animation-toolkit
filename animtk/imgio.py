"""
animtk.imgio
Loading drawings and saving results without ever touching an original file.
"""
import os, re, glob
import numpy as np
from PIL import Image, ImageDraw, ImageFont

_INPUTS = set()

def _key(p): return os.path.normcase(os.path.abspath(p))

def protect(*paths):
    """remember input files so save() can refuse to write over them"""
    for p in paths:
        if p: _INPUTS.add(_key(p))

def out_path(out_dir, name):
    os.makedirs(out_dir, exist_ok=True)
    return os.path.join(out_dir, name)

def save(img, path, **kw):
    """save a PIL image (or numpy array) as a NEW file. Never writes over an input."""
    if _key(path) in _INPUTS:
        raise SystemExit('Refusing to overwrite an original file: %s' % path)
    os.makedirs(os.path.dirname(os.path.abspath(path)) or '.', exist_ok=True)
    if isinstance(img, np.ndarray): img = Image.fromarray(img)
    img.save(path, **kw)
    return path

def load_rgba(path):
    protect(path)
    return Image.open(path).convert('RGBA')

def load_flat(path, paper=(255, 255, 255)):
    """drawing flattened onto white paper, as an RGB PIL image (transparent PNGs become readable)"""
    im = load_rgba(path)
    bg = Image.new('RGBA', im.size, paper + (255,)); bg.alpha_composite(im)
    return bg.convert('RGB')

def load_gray(path):
    """drawing as a 2D uint8 array, white paper = 255, ink = dark"""
    return np.array(load_flat(path).convert('L'))

def ink_mask(gray, dark=128):
    """True where there is linework"""
    return gray < dark

def frame_files(folder_or_glob):
    """numbered frames in order (PNG, JPG, or PSD read as its flattened picture). Accepts a folder or a glob pattern."""
    if os.path.isdir(folder_or_glob):
        files = [f for f in glob.glob(os.path.join(folder_or_glob, '*')) if f.lower().endswith(('.png', '.jpg', '.jpeg', '.psd'))]
    else:
        files = glob.glob(folder_or_glob)
    num = lambda f: [int(n) for n in re.findall(r'\d+', os.path.basename(f))] or [0]
    files.sort(key=lambda f: (num(f), f))
    protect(*files)
    return files

def font(size, bold=True):
    names = ('arialbd.ttf', 'arial.ttf', 'DejaVuSans-Bold.ttf', 'DejaVuSans.ttf') if bold else ('arial.ttf', 'DejaVuSans.ttf')
    for n in names:
        try: return ImageFont.truetype(n, max(8, int(size)))
        except Exception: pass
    return ImageFont.load_default()

def tag(draw, xy, text, fill=(255, 255, 255), bg=(20, 20, 25), size=36, pad=8):
    """small readable label: text on a solid rounded chip"""
    f = font(size); x, y = xy
    l, t, r, b = draw.textbbox((x, y), text, font=f)
    draw.rounded_rectangle([l - pad, t - pad, r + pad, b + pad], radius=pad, fill=bg)
    draw.text((x, y), text, fill=fill, font=f)
    return (l - pad, t - pad, r + pad, b + pad)

def dim(img_rgb, amount=0.55):
    """fade a drawing toward white so marks drawn on top read clearly"""
    a = np.array(img_rgb.convert('RGB'), float)
    return Image.fromarray((255 - (255 - a) * (1 - amount)).astype(np.uint8))
