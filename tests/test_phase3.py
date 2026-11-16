"""
Checks camera_move, value_check and anatomy_guide on generated stand-ins (no artwork needed).
    python tests/test_phase3.py
"""
import os, sys, json, math, subprocess, hashlib
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, root); os.chdir(root)
import numpy as np, cv2
from PIL import Image
from animtk import cammove as CM, value as V, anatomy as A, imgio

out = os.path.join(root, 'tests', 'out'); os.makedirs(out, exist_ok=True)
fails = 0
def check(name, ok, detail=''):
    global fails; print(('PASS  ' if ok else 'FAIL  ') + name + ('  ' + str(detail) if detail != '' else '')); fails += 0 if ok else 1
def run(*args): return subprocess.run([sys.executable] + list(args), capture_output=True, text=True, cwd=root)

# ------------------------------------------------------------------ camera moves
keys = [dict(frame=1, x=0, y=0, zoom=1.0), dict(frame=25, x=1900, y=0, zoom=1.0), dict(frame=49, x=1900, y=-200, zoom=1.6)]
p = CM.plan(keys)
# worked by hand: x spans -1920..3820 = 5740 wide, y spans -960..960 = 1920 tall, times the tightest zoom 1.6
check('canvas size for a 1900 px pan then a 160% push', p['canvas'] == [9184, 3072], p['canvas'])
check('the view never leaves the canvas', CM.check(p) < 0.6, CM.check(p))
check('one row per frame, first to last key', [p['rows'][0]['frame'], p['rows'][-1]['frame'], len(p['rows'])] == [1, 49, 49])
r = p['rows'][-1]
check('tightest frame uses the canvas at 100%', abs(r['layer_scale'] - 100) < 1e-6 and abs(r['place_scale'] - 100) < 1e-6)
check('layer scale and drawing scale undo each other on every frame', all(abs(q['layer_scale'] * q['place_scale'] - 1e4) < 2 for q in p['rows']))
# putting the canvas layer where the table says must land the camera center in the middle of the comp
ok = True
for q in p['rows']:
    s = q['layer_scale'] / 100; cx = q['layer_x'] + (q['canvas_cx'] - p['canvas'][0] / 2) * s; cy = q['layer_y'] + (q['canvas_cy'] - p['canvas'][1] / 2) * s
    ok &= abs(cx - 1920) < 1.5 and abs(cy - 960) < 1.5
check('layer position puts the camera center mid-frame on every frame', ok)
check('a drawing placed by the table fills exactly what the camera sees', all(abs(q['place_x'] - (q['canvas_cx'] - q['view_w'] / 2)) < 0.2 and abs(q['place_y'] - (q['canvas_cy'] - q['view_h'] / 2)) < 0.2 for q in p['rows']))
rng = np.random.RandomState(4); worst = 0
for _ in range(40):
    ks = [dict(frame=1 + i * int(rng.randint(4, 30)), x=float(rng.randint(-4000, 4000)), y=float(rng.randint(-2000, 2000)), zoom=float(rng.uniform(0.4, 3)), ease=str(rng.choice(['inout', 'in', 'out', 'linear']))) for i in range(int(rng.randint(2, 5)))]
    worst = max(worst, CM.check(CM.plan(ks, 3840, 1920, float(rng.choice([0, 0.05])))))
check('40 random moves all stay on their canvas', worst < 0.6, 'worst overhang %.2f px' % worst)
# 5% spare on each side: (5740 + 2 * 192) * 1.6 = 9798.4 -> 9800, (1920 + 2 * 96) * 1.6 = 3379.2 -> 3380
check('margin adds room on every side', CM.plan(keys, margin=0.05)['canvas'] == [9800, 3380], CM.plan(keys, margin=0.05)['canvas'])
check('a single key is a locked-off shot the size of the field', CM.plan([dict(frame=1, x=0, y=0, zoom=1)])['canvas'] == [3840, 1920])
c = run('camera_move.py', '--key', '1,0,0,100', '--key', '25,1900,0,100', '--key', '49,1900,-200,160', '--out', os.path.join(out, 'camera'), '--name', 'typed')
check('camera_move.py prints the canvas and writes its three files', 'CANVAS NEEDED: 9184 x 3072' in c.stdout and all(os.path.exists(os.path.join(out, 'camera', 'typed' + e)) for e in ('_camera.csv', '_plan.png', '_camera.json')), c.stderr[-300:])

def room(W=1920, H=960, seed=3):
    r = np.random.RandomState(seed); big = np.full((H * 3, W * 3), 255, np.uint8)
    for _ in range(70):
        x, y = r.randint(0, W * 3), r.randint(0, H * 3); cv2.rectangle(big, (x, y), (x + r.randint(60, 500), y + r.randint(60, 400)), 0, int(r.randint(3, 7)))
    for _ in range(40):
        a = (int(r.randint(0, W * 3)), int(r.randint(0, H * 3))); cv2.line(big, a, (a[0] + int(r.randint(-600, 600)), a[1] + int(r.randint(-400, 400))), 0, int(r.randint(3, 6)))
    return big
def shoot(big, cx, cy, zoom, actor=None, W=1920, H=960):
    f = cv2.warpAffine(big, np.float32([[zoom, 0, W / 2 - cx * zoom], [0, zoom, H / 2 - cy * zoom]]), (W, H), flags=cv2.INTER_AREA, borderValue=255)
    if actor: cv2.circle(f, actor, 170, 0, 9); cv2.ellipse(f, (actor[0], actor[1] + 330), (120, 200), 0, 0, 360, 0, 9)
    return f
big = room(); A0 = shoot(big, 2880, 1440, 1.0, (500, 400))
for dx, dy, z in ((300, 0, 1.0), (250, -60, 1.5), (-180, 90, 1.0), (0, 0, 1.3)):
    e = CM.estimate(A0, shoot(big, 2880 + dx, 1440 + dy, z, (1300, 420)))
    check('reads a %d,%d px pan with x%.1f zoom off two drawings (a character moves in front)' % (dx, dy, z), abs(e['dx'] - dx) < 15 and abs(e['dy'] - dy) < 15 and abs(e['zoom_ratio'] / z - 1) < 0.03 and CM.sureness(e) == 'good', '%.0f %.0f x%.3f, %s %.2f' % (e['dx'], e['dy'], e['zoom_ratio'], CM.sureness(e), e['confidence']))
e = CM.estimate(shoot(big, 2880, 1440, 1.0), shoot(room(seed=9), 2880, 1440, 1.0))
check('two unrelated drawings are called NOT reliable', CM.sureness(e) == 'NOT reliable', '%.2f' % e['confidence'])
e = CM.estimate(shoot(big, 2880, 1440, 1.0), shoot(big, 2880 + 1100, 1440, 1.0))
check('a pan too long to read (keys share under half a frame) is not called good', CM.sureness(e) != 'good', '%s %.2f' % (CM.sureness(e), e['confidence']))

# ------------------------------------------------------------------ value
run(os.path.join('tests', 'make_value_samples.py'))
sv = os.path.join(out, 'synth_value'); T = json.load(open(os.path.join(out, 'synth_value_truth.json')))
before = {f: hashlib.md5(open(os.path.join(sv, f), 'rb').read()).hexdigest() for f in os.listdir(sv)}
g = imgio.load_gray(os.path.join(sv, '1_lines.png'))
m, info = V.silhouette(g)
at = lambda mask, pt: bool(mask[int(pt[1]), int(pt[0])])
check('line art is recognised as line art', info['mode'] == 'lines', info)
check('a body outline with a small gap fills in', at(m, T['body_point']))
check('the paper around it stays white', not at(m, T['paper_point']))
check('an arm coming in from the frame edge fills in', at(m, T['arm_point']))
check('a shape cut off by the corner is left for you to decide', not at(m, T['corner_point']))
want = T['body_share'] + T['arm_share']
check('silhouette area matches the shapes drawn', abs(info['coverage'] - want) < 1.5, '%.1f%% vs %.1f%% drawn' % (info['coverage'], want))
m2, i2 = V.silhouette(g, fills=[T['corner_point']])
check('--fill turns that corner shape black', at(m2, T['corner_point']) and abs(i2['coverage'] - want - T['corner_share']) < 1.5, i2['coverage'])
m3, i3 = V.silhouette(g, clears=[T['arm_point']])
check('--clear turns the arm back to white', not at(m3, T['arm_point']) and at(m3, T['body_point']))
m4, _ = V.silhouette(g, edge='open')
check('--edge open leaves everything that touches the frame white', not at(m4, T['arm_point']) and at(m4, T['body_point']))
m5, _ = V.silhouette(g, gap=0)
check('with gap closing off, the gapped outline leaks (so the gap setting matters)', not at(m5, T['body_point']))
tg = imgio.load_gray(os.path.join(sv, '2_tone.png')); tm, ti = V.silhouette(tg); sep = V.separation(tg, tm)
check('a painted frame is recognised and its figure found', ti['mode'] == 'tone' and abs(ti['coverage'] - T['tone_figure_share']) < 1.0, ti)
check('figure and background values are measured', abs(sep['figure'] - 96 / 2.55) < 1.5 and sep['separation'] > 40, sep)
rgba = np.array(imgio.load_rgba(os.path.join(sv, '3_alpha.png'))); am, ai = V.silhouette(V.luminance(np.array(imgio.load_flat(os.path.join(sv, '3_alpha.png')))), rgba[..., 3])
check('a transparent background is used as the silhouette', ai['mode'] == 'alpha' and abs(ai['coverage'] - T['alpha_share']) < 0.5, ai)
check('posterize to 3 values leaves 3 grays', len(np.unique(V.posterize(tg, 3))) <= 3 and len(np.unique(V.posterize(np.arange(256, dtype=np.uint8), 3))) == 3)
c = run('value_check.py', sv, '--out', os.path.join(out, 'value'))
check('value_check.py makes a contact sheet for a folder', os.path.exists(os.path.join(out, 'value', 'synth_value_value_sheet.png')), c.stderr[-300:])
c = run('value_check.py', os.path.join(sv, '1_lines.png'), '--out', os.path.join(out, 'value'), '--fill', '%d,%d' % tuple(T['corner_point']))
one = os.path.join(out, 'value', '1_lines_value.png')
check('value_check.py makes the side by side picture for one frame', os.path.exists(one) and Image.open(one).size[0] > 2 * T['size'][0] and Image.open(os.path.join(out, 'value', '1_lines_silhouette.png')).size == tuple(T['size']), c.stderr[-300:])
c = run('value_check.py', os.path.join(sv, '1_lines.png'), '--out', sv)
check('originals are untouched', before == {f: hashlib.md5(open(os.path.join(sv, f), 'rb').read()).hexdigest() for f in before})

# ------------------------------------------------------------------ anatomy
def human(**move):
    P = dict(head_top=[500, 100], chin=[500, 220], neck=[500, 250], l_shoulder=[420, 270], r_shoulder=[580, 270], l_elbow=[400, 420], r_elbow=[600, 420], l_wrist=[395, 560], r_wrist=[605, 560],
             pelvis=[500, 560], l_hip=[455, 540], r_hip=[545, 540], l_knee=[450, 720], r_knee=[550, 720], l_ankle=[448, 900], r_ankle=[552, 900], l_toe=[420, 915], r_toe=[580, 915])
    P.update(move); return dict(rig='human', points=P)
texts = lambda rep: ' | '.join(f['text'] for f in rep['flags'])
rep = A.check(human())
check('a balanced, even figure raises no flags', not rep['flags'], texts(rep))
check('  and it reports heads tall, balance and the shoulder and hip tilt', any('heads tall' in n for n in rep['notes']) and any('Balanced' in n for n in rep['notes']) and any('level' in n for n in rep['notes']), rep['notes'])
rep = A.check(human(r_wrist=[603, 500]))
check('a forearm drawn 43% short is pointed out, on the right arm', len(rep['flags']) == 1 and 'right forearm' in rep['flags'][0]['text'], texts(rep))
lean = {k: [v[0] + (900 - v[1]) * 0.5, v[1]] for k, v in human()['points'].items()}
rep = A.check(human(**lean))
check('a figure leaning far past its feet is flagged as off balance', any('weight sits' in f['text'] for f in rep['flags']), texts(rep))
rep = A.check(dict(human(**lean), airborne=True))
check('  unless it is marked airborne', not any('weight sits' in f['text'] for f in rep['flags']))
long_legs = {k: [v[0], 540 + (v[1] - 540) * 1.4] for k, v in human()['points'].items() if v[1] > 540}
rep = A.check(human(**long_legs), model=human())
check('legs 40% longer than the model sheet are flagged as off model', sum('Off model' in f['text'] for f in rep['flags']) >= 2, texts(rep))
rep = A.check(human(l_shoulder=[420, 250], r_shoulder=[580, 290], l_hip=[455, 550], r_hip=[545, 530]))
check('shoulders tilted against the hips is noticed', any('against each other' in n for n in rep['notes']), rep['notes'])

def cat(**move):
    P = dict(nose=[900, 300], crown=[840, 240], nape=[790, 290], withers=[700, 300], rump=[380, 310], tail_base=[350, 330], tail_tip=[150, 250], chest=[660, 420],
             f_shoulder=[720, 380], f_elbow=[670, 450], f_wrist=[690, 560], f_paw=[700, 640], h_hip=[400, 380], h_knee=[450, 480], h_hock=[370, 560], h_paw=[400, 640])
    P.update(move); return dict(rig='cat', points=P)
rep = A.check(cat())
check('a cat with its joints the right way round raises no flags', not rep['flags'], texts(rep))
rep = A.check(cat(h_hock=[480, 560]))
check('a hock that points forward is flagged', any('hock' in f['text'] for f in rep['flags']), texts(rep))
rep = A.check(cat(f_elbow=[760, 450]))
check('an elbow that points forward is flagged', any('elbow' in f['text'] for f in rep['flags']), texts(rep))
mirror = {k: [1000 - v[0], v[1]] for k, v in cat()['points'].items()}
check('the same cat facing left still passes', not A.check(dict(rig='cat', points=mirror))['flags'])
rep = A.check(cat(withers=[1300, 300], chest=[1260, 420], nose=[1500, 300], crown=[1440, 240], nape=[1390, 290]))
check('a cat whose weight is far ahead of its paws is flagged', any('weight sits' in f['text'] for f in rep['flags']), texts(rep))

def hand(**move):
    P = dict(wrist_a=[420, 900], wrist_b=[580, 900], thumb_1=[400, 800], thumb_2=[310, 700], thumb_tip=[260, 600])
    for f, x, top, ln in (('index', 400, 600, 300), ('middle', 470, 580, 330), ('ring', 540, 595, 305), ('pinky', 605, 630, 230)):
        P[f + '_1'] = [x, top]; P[f + '_2'] = [x, top - ln * 0.45]; P[f + '_3'] = [x, top - ln * 0.75]; P[f + '_tip'] = [x, top - ln]
    P.update(move); return dict(rig='hand', points=P)
rep = A.check(hand())
check('a well proportioned open hand raises no flags', not rep['flags'], texts(rep))
rep = A.check(hand(pinky_2=[605, 470], pinky_3=[605, 370], pinky_tip=[605, 290]))
check('a little finger as long as the others is flagged', any('little finger' in f['text'] for f in rep['flags']), texts(rep))
rep = A.check(hand(middle_1=[470, 640]))
check('knuckles that zigzag are flagged', any('knuckle' in f['text'].lower() for f in rep['flags']), texts(rep))
rep = A.check(hand(ring_tip=[540, 200]))
check('a tip segment longer than the middle one is flagged', any('tip segment' in f['text'] for f in rep['flags']), texts(rep))
rep = A.check(hand(wrist_a=[350, 900], wrist_b=[650, 900]))
check('a wrist wider than the palm is flagged', any('wrist is wider' in f['text'] for f in rep['flags']), texts(rep))

# the script itself, on a generated stick figure
fig = np.full((1000, 1000), 255, np.uint8); H0 = human(r_wrist=[603, 500])
for a, b, _ in [t for t in A.RIGS['human']['bones'] if t[0] in H0['points'] and t[1] in H0['points']]: cv2.line(fig, tuple(H0['points'][a]), tuple(H0['points'][b]), 0, 6)
os.makedirs(os.path.join(out, 'anatomy'), exist_ok=True); fp = os.path.join(out, 'anatomy', 'stick.png'); Image.fromarray(fig).save(fp); lp = os.path.join(out, 'anatomy', 'stick_points.json'); json.dump(H0, open(lp, 'w'))
h0 = hashlib.md5(open(fp, 'rb').read()).hexdigest()
c = run('anatomy_guide.py', fp, '--grid', '--out', os.path.join(out, 'anatomy'))
check('anatomy_guide.py --grid writes the numbered grid picture', os.path.exists(os.path.join(out, 'anatomy', 'stick_grid.png')), c.stderr[-300:])
c = run('anatomy_guide.py', fp, '--landmarks', lp, '--out', os.path.join(out, 'anatomy'))
gp = os.path.join(out, 'anatomy', 'stick_anatomy_guide.png')
ok = os.path.exists(gp) and 'right forearm' in c.stdout
if ok: ov = np.array(Image.open(gp)); ok = ov.shape == (1000, 1000, 4) and ov[5, 5, 3] == 0 and ov[..., 3].max() == 255
check('anatomy_guide.py writes a transparent overlay the size of the drawing and names the short forearm', ok, c.stdout[-200:] + c.stderr[-300:])
check('  and leaves the drawing untouched', h0 == hashlib.md5(open(fp, 'rb').read()).hexdigest())
c = run('anatomy_guide.py', '--template', 'cat')
check('anatomy_guide.py --template prints a blank landmark file', '"f_paw": null' in c.stdout)

print('\n%s' % ('ALL PASSED' if not fails else '%d FAILED' % fails)); sys.exit(1 if fails else 0)
