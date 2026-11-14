"""
animtk.frames
Measuring drawings: where the ink is, what moved between two frames, how big the subject is.
Everything is measured on a small working copy (default 960 px wide) and reported in full-size pixels.
"""
import numpy as np, cv2
from PIL import Image
from . import imgio

WORK = 960

def load_work(path, width=WORK):
    """(gray small uint8, scale) where scale = full-size pixels per working pixel"""
    im = imgio.load_flat(path).convert('L'); W, H = im.size
    s = max(1.0, W / width)
    if s > 1: im = im.resize((int(round(W / s)), int(round(H / s))), Image.BOX)
    return np.array(im), W / im.size[0]

def ink(gray, dark=128):
    return gray < dark

def region_mask(shape, scale, region=None, ignore=()):
    """boolean mask of the part of the frame to look at (full-size boxes in, working-size mask out)"""
    m = np.ones(shape, bool)
    if region:
        x0, y0, x1, y1 = [int(round(v / scale)) for v in region]; m[:] = False; m[y0:y1, x0:x1] = True
    for x0, y0, x1, y1 in ignore:
        m[int(y0 / scale):int(y1 / scale), int(x0 / scale):int(x1 / scale)] = False
    return m

def changed(a, b, r=3):
    """ink of a that has no ink of b within r working pixels: the part that moved or is new"""
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    return a & ~(cv2.dilate(b.astype(np.uint8), k) > 0)

def static_ink(masks, share=0.8):
    """ink that sits in the same place in most frames (the background / held parts)"""
    acc = np.zeros(masks[0].shape, np.float32)
    for m in masks: acc += m
    return acc >= share * len(masks)

def dilate(mask, r):
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    return cv2.dilate(mask.astype(np.uint8), k) > 0

def filled(mask, close=15):
    """silhouette of a line drawing: gaps closed, outline filled in"""
    m = cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close, close)))
    cn, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = np.zeros_like(m); cv2.drawContours(out, cn, -1, 1, -1)
    return out > 0

def stats(mask, scale=1.0):
    """centroid, box and size of the ink in a mask, in full-size pixels (None if empty)"""
    ys, xs = np.nonzero(mask)
    if len(xs) < 8: return None
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    return dict(center=[float(xs.mean() * scale), float(ys.mean() * scale)],
                box=[float(x0 * scale), float(y0 * scale), float(x1 * scale), float(y1 * scale)],
                diag=float(np.hypot(x1 - x0, y1 - y0) * scale), ink=float(len(xs) * scale * scale))

def tint(rgb_img, color, strength=1.0):
    """recolour dark lines: black ink becomes `color`, white paper stays white (PIL RGB in and out)"""
    a = np.asarray(rgb_img.convert('L'), np.float32) / 255.0
    c = np.array(color, np.float32)
    out = 255 - (1 - a[..., None]) * (255 - c) * strength
    return Image.fromarray(out.astype(np.uint8))

def multiply(base_rgb, top_rgb):
    """stack two white-paper drawings so both sets of lines show"""
    a = np.asarray(base_rgb, np.float32); b = np.asarray(top_rgb, np.float32)
    return Image.fromarray((a * b / 255).astype(np.uint8))

def split_still(a, b, share=0.85, r=3):
    """split the ink of drawing a into (still, moving) against drawing b.
       Works stroke by stroke: a connected bit of linework counts as still only if nearly all of it
       sits where b also has ink. So a background line stays put as a whole, and a character that
       moved is taken as a whole, even where part of its outline happens to overlap its old place."""
    n, lab = cv2.connectedComponents(a.astype(np.uint8), connectivity=8)
    if n <= 1: return np.zeros_like(a), a.copy()
    same = a & ~changed(a, b, r)
    tot = np.bincount(lab.ravel(), minlength=n).astype(float); keep = np.bincount(lab[same], minlength=n)
    is_still = (keep / np.maximum(tot, 1)) >= share; is_still[0] = False
    still = is_still[lab]
    return still, a & ~still
