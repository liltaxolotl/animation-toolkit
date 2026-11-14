"""
Self-check for inbetween.py, motion_check.py and cycle_guide.py, on drawings it makes itself.

    python tests/test_motion.py
"""
import os, sys, json, math, shutil
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import numpy as np
from PIL import Image, ImageDraw
from animtk import frames as F, cycles
import inbetween, motion_check, cycle_guide

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'motion')
shutil.rmtree(OUT, ignore_errors=True); os.makedirs(OUT)
fails = []
def check(name, ok, detail=''):
    print(('PASS  ' if ok else 'FAIL  ') + name + ('  ' + detail if detail else ''))
    if not ok: fails.append(name)

W, H = 1920, 960
def blob(path, cx, cy, r=120, squash=1.0, tail=True, extra=None):
    """a lumpy little character: body, ear, tail, on a ground line that never moves"""
    im = Image.new('RGB', (W, H), 'white'); d = ImageDraw.Draw(im)
    d.line([(60, 800), (W - 60, 800)], fill='black', width=10)
    d.ellipse([cx - r, cy - r * squash, cx + r, cy + r * squash], outline='black', width=12)
    d.polygon([(cx - r * 0.5, cy - r * squash * 0.8), (cx - r * 0.2, cy - r * squash * 1.5), (cx + r * 0.1, cy - r * squash * 0.95)], outline='black', width=10)
    if tail: d.arc([cx - r * 2.2, cy - r * 0.4, cx - r * 0.8, cy + r * 0.8], 180, 320, fill='black', width=10)
    if extra: extra(d)
    im.save(path); return path

# ---------------------------------------------------------------- inbetween: a clean case
a = blob(os.path.join(OUT, 'a.png'), 500, 620); b = blob(os.path.join(OUT, 'b.png'), 640, 560, squash=0.92)
res, files = inbetween.run(a, b, os.path.join(OUT, 'inb'), n=1)
check('inbetween: similar poses get warped', res['mode'] == 'warp', json.dumps(res.get('report')))
if res['mode'] == 'warp':
    g = np.array(Image.open(files['inb01']).convert('L')); mov = F.changed(g < 128, np.array(Image.open(a).convert('L')) < 128, 2)
    ys, xs = np.nonzero((g < 128) & (np.arange(H)[:, None] < 780))
    cx = xs.mean()
    ya, xa = np.nonzero((np.array(Image.open(a).convert('L')) < 128) & (np.arange(H)[:, None] < 780)); yb, xb = np.nonzero((np.array(Image.open(b).convert('L')) < 128) & (np.arange(H)[:, None] < 780))
    mid = (xa.mean() + xb.mean()) / 2
    check('inbetween: the result sits halfway between the keys', abs(cx - mid) < 14, 'x %.0f, halfway is %.0f' % (cx, mid))
    ink = (g < 128).sum(); ia = (np.array(Image.open(a).convert('L')) < 128).sum()
    check('inbetween: it keeps the amount of linework (no smearing, no losses)', 0.85 < ink / ia < 1.15, 'ink ratio %.2f' % (ink / ia))
    ground = g[797:803, 100:1800]
    check('inbetween: lines that did not move stay exactly put', (ground < 128).mean() > 0.95)
    check('inbetween: original keys untouched', np.array_equal(np.array(Image.open(a)), np.array(Image.open(blob(os.path.join(OUT, 'a_again.png'), 500, 620)))))
res3, f3 = inbetween.run(a, b, os.path.join(OUT, 'inb3'), n=3, ease='inout')
check('inbetween: ease in/out spacing', res3['positions'][0] < 0.25 and abs(res3['positions'][1] - 0.5) < 1e-9 and res3['positions'][2] > 0.75, str(res3['positions']))

# ---------------------------------------------------------------- inbetween: poses too different -> guide, not a fake
def star(d):
    for k in range(7):
        t = k * math.pi * 2 / 7; d.line([(1300, 400), (1300 + 260 * math.cos(t), 400 + 260 * math.sin(t))], fill='black', width=12)
c = blob(os.path.join(OUT, 'c.png'), 1300, 400, r=30, tail=False, extra=star)
res2, files2 = inbetween.run(a, c, os.path.join(OUT, 'inb_far'), n=2, arc=(0, -150))
check('inbetween: very different poses are NOT warped', res2['mode'] == 'guide', '; '.join(res2['why']))
check('inbetween: a guide is written instead', os.path.exists(files2['guide']) and not any(k.startswith('inb') for k in files2))
gimg = Image.open(files2['guide'])
check('inbetween: the guide is transparent and full size', gimg.mode == 'RGBA' and gimg.size == (W, H) and np.array(gimg)[..., 3].min() == 0 and (np.array(gimg)[..., 3] > 0).mean() < 0.2)

# ---------------------------------------------------------------- motion_check
seq = os.path.join(OUT, 'seq'); os.makedirs(seq)
N = 9; pos = [(300 + 150 * i, 600 - 200 * math.sin(math.pi * i / (N - 1))) for i in range(N)]
pos[4] = (pos[4][0], pos[4][1] + 170)                      # frame 5 knocked off the arc
pos[7] = (pos[7][0] + 130, pos[7][1]); pos[8] = (pos[8][0] + 130, pos[8][1])   # a jump in spacing going into frame 8
for i, (x, y) in enumerate(pos): blob(os.path.join(seq, '%04d.png' % (i + 1)), x, y, r=90)
rep, mf = motion_check.run(seq, os.path.join(OUT, 'mc'))
kinds = [(f['kind'], f['frame']) for f in rep['flags']]
check('motion_check: measures only what moves (ground line ignored)', rep['measured'] == 'moving ink only')
check('motion_check: the frame knocked off the arc is flagged', any(k == 'ARC' and fr in (4, 5, 6) for k, fr in kinds), str(kinds))
check('motion_check: the jump in spacing is flagged', any(k == 'SPACING' and fr == 7 for k, fr in kinds), 'spacing ' + str(rep['spacing_px']))
check('motion_check: at most 6 marks on the sheet', len(rep['flags']) <= 6)
smooth = os.path.join(OUT, 'smooth'); os.makedirs(smooth)
for i in range(N): blob(os.path.join(smooth, '%04d.png' % (i + 1)), 300 + 150 * i, 600 - 200 * math.sin(math.pi * i / (N - 1)), r=90)
rep2, _ = motion_check.run(smooth, os.path.join(OUT, 'mc_smooth'))
check('motion_check: a clean arc with even spacing gets no flags', len(rep2['flags']) == 0, str([(f['kind'], f['frame']) for f in rep2['flags']]))

# ---------------------------------------------------------------- cycle_guide
data, cf = cycle_guide.run('cat_walk', os.path.join(OUT, 'cycle'), frames=24, travel=True, canvas=(W, H))
order = []
for i, dr in enumerate(data['drawings']):
    prev = data['drawings'][i - 1]['feet_down']
    order += [f for f in dr['feet_down'] if f not in prev]
want = ['LH', 'LF', 'RH', 'RF']; k = order.index('LH'); order = order[k:] + order[:k]
check('cat walk: feet land in the order left hind, left fore, right hind, right fore', order == want, ' '.join(order))
n_down = [len(dr['feet_down']) for dr in data['drawings']]
check('cat walk: always 2 or 3 feet on the ground', min(n_down) >= 2 and max(n_down) <= 3, 'between %d and %d' % (min(n_down), max(n_down)))
slide = 0
for foot in want:
    xs = [dr['joints'][foot + '_toe'][0] for dr in data['drawings'] if foot in dr['feet_down']]
    runs = []; cur = []
    for i, dr in enumerate(data['drawings']):
        if foot in dr['feet_down']: cur.append(dr['joints'][foot + '_toe'][0])
        elif cur: runs.append(cur); cur = []
    if cur: runs.append(cur)
    slide = max([slide] + [max(r) - min(r) for r in runs if len(r) > 1])
check('cat walk: planted feet do not slide when it travels', slide < 2.0, 'worst slide %.2f px' % slide)
sh = [dr['joints']['shoulder'][1] for dr in data['drawings']]
ups = sum(1 for i in range(len(sh)) if sh[i] < sh[i - 1] and sh[i] <= sh[(i + 1) % len(sh)])
check('cat walk: shoulders bob twice per cycle (once per front step)', ups == 2, '%d high points' % ups)
g1 = Image.open(cf['01'])
check('cat walk: guides are transparent and canvas sized', g1.mode == 'RGBA' and g1.size == (W, H) and (np.array(g1)[..., 3] == 0).mean() > 0.8)
d2, _ = cycle_guide.run('cat_walk', os.path.join(OUT, 'cycle_match'), frames=8, match=a, region=[300, 300, 760, 790])
check('cat walk: sizes itself from a drawing of the character', abs(d2['ground_y'] - 740) < 12 and 150 < d2['unit_px'] < 330, 'ground y %d, shoulder-to-hip %d px' % (d2['ground_y'], d2['unit_px']))
check('cycles: registry is ready for more', 'cat_walk' in cycles.CYCLES and all(k in cycles.CYCLES['cat_walk'] for k in ('pose', 'feet', 'names', 'start', 'height')))

print('\n%d failed' % len(fails) if fails else '\nall passed')
sys.exit(1 if fails else 0)
