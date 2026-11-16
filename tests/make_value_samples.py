"""
Generated stand-ins for the value tests (no artwork needed). Writes tests/out/synth_value/:
    1_lines.png   line art: a body outline with a small gap, an arm that comes in from the bottom edge,
                  and a shape cut off by the bottom-right corner
    2_tone.png    a mid-gray painted figure on a light background
    3_alpha.png   a painted figure on a transparent background
and synth_value_truth.json with the numbers the tests compare against.
"""
import os, json, math
import numpy as np, cv2
from PIL import Image

W, H = 1920, 960
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'synth_value'); os.makedirs(out, exist_ok=True)

# 1. line art
g = np.full((H, W), 255, np.uint8)
body = dict(c=(620, 420), ax=(300, 230))
cv2.ellipse(g, body['c'], body['ax'], 0, 3, 360, 0, 8)                          # outline with a gap of about 12 px at the right
arm = dict(x0=1150, x1=1330, top=560, fist=(1240, 470), r=120)
cv2.line(g, (arm['x0'], H - 1), (arm['x0'], arm['top']), 0, 8); cv2.line(g, (arm['x1'], H - 1), (arm['x1'], arm['top']), 0, 8)
cv2.ellipse(g, arm['fist'], (arm['r'], arm['r']), 0, 132, 408, 0, 8)            # a fist on top of the arm, open where the arm joins
corner = dict(c=(W - 1, H - 1), r=260)
cv2.circle(g, corner['c'], corner['r'], 0, 8)                                   # a quarter circle cut off by the corner
Image.fromarray(g).save(os.path.join(out, '1_lines.png'))

# 2. toned
t = np.full((H, W), 232, np.uint8); cv2.ellipse(t, (960, 500), (330, 300), 0, 0, 360, 96, -1); cv2.rectangle(t, (0, 840), (W, H), 180, -1)
Image.fromarray(t).save(os.path.join(out, '2_tone.png'))

# 3. transparent background
a = np.zeros((H, W, 4), np.uint8); m = np.zeros((H, W), np.uint8); cv2.ellipse(m, (700, 480), (260, 340), 0, 0, 360, 255, -1)
a[..., 0] = 200; a[..., 1] = 90; a[..., 2] = 120; a[..., 3] = m
Image.fromarray(a).save(os.path.join(out, '3_alpha.png'))

truth = dict(size=[W, H],
             body_share=math.pi * body['ax'][0] * body['ax'][1] / (W * H) * 100,
             arm_share=((arm['x1'] - arm['x0']) * (H - arm['top']) + math.pi * arm['r'] ** 2 * 0.86) / (W * H) * 100,
             corner_share=math.pi * corner['r'] ** 2 / 4 / (W * H) * 100,
             body_point=list(body['c']), arm_point=[1240, 800], corner_point=[W - 90, H - 90], paper_point=[200, 120],
             tone_figure_share=math.pi * 330 * 300 / (W * H) * 100, alpha_share=math.pi * 260 * 340 / (W * H) * 100)
json.dump(truth, open(os.path.join(os.path.dirname(out), 'synth_value_truth.json'), 'w'), indent=1)
print('wrote', out)
