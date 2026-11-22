"""
Self-check for redline.py and animtk/layers.py. Uses only drawings it generates itself (no artwork needed).

    python tests/test_redline.py

Confirms the marks format is read the way the app reads it (fenced JSON, bare items, scaling from a smaller copy,
bad items skipped with a warning), that a redline is always a NEW numbered trio of files and the drawing is never
changed, that --check writes nothing, and that --from-perspective puts its red line exactly where the deliberately
wrong line in a generated room would aim at the vanishing point.
"""
import hashlib, json, math, os, shutil, subprocess, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import numpy as np
from PIL import Image, ImageDraw
from animtk import layers as LY, scene3d as S, lines as L
import redline as RL

OUT = os.path.join(ROOT, 'tests', 'out', '_redline_%d' % os.getpid())
fails = []
def check(name, ok, detail=''):
    print(('PASS  ' if ok else 'FAIL  ') + name + ('  ' + detail if detail else ''))
    if not ok: fails.append(name)
cross2 = lambda a, b: a[0] * b[1] - a[1] * b[0]
md5 = lambda p: hashlib.md5(open(p, 'rb').read()).hexdigest()
shutil.rmtree(OUT, ignore_errors=True); os.makedirs(OUT)

try:
    # ---------------------------------------------------------------- reading marks
    doc, w = LY.normalize('Here you go:\n```json\n[{"t": "arrow", "a": [10, 20], "b": [30, 40]}]\n```', 200, 100)
    check('fenced JSON with words before it reads as one Fixes layer', len(doc['layers']) == 1 and doc['layers'][0]['name'] == 'Fixes'
          and doc['layers'][0]['items'][0]['a'] == [10, 20] and not w, str(w))
    doc, w = LY.normalize({'W': 1, 'H': 1, 'layers': [{'items': [{'t': 'circle', 'c': [0.5, 0.5], 'r': 0.1}]}]}, 400, 200)
    it = doc['layers'][0]['items'][0]
    check('W 1 H 1 means fractions of the drawing', it['c'] == [200, 100] and abs(it['r'] - 30) < 1e-9, str(it))
    doc, w = LY.normalize({'W': 960, 'H': 480, 'layers': [{'items': [{'t': 'line', 'a': [96, 48], 'b': [960, 480], 'w': 6}]}]}, 3840, 1920)
    it = doc['layers'][0]['items'][0]
    check('marks written on a smaller copy scale up, widths stay put', it['a'] == [384, 192] and it['b'] == [3840, 1920] and it['w'] == 6, str(it))
    doc, w = LY.normalize([{'t': 'blob'}, {'t': 'line', 'a': [0, 0]}, {'t': 'text', 'at': [5, 5], 'text': 'ok'}, {'type': 'rect', 'a': {'x': 1, 'y': 2}, 'b': [3, 4]}], 100, 100)
    check('bad items are skipped with a plain warning, good ones kept', len(doc['layers'][0]['items']) == 2 and len(w) == 2
          and 'unknown type' in w[0] and 'missing b' in w[1], str(w))
    try:
        LY.normalize('no marks here', 10, 10); ok = False
    except ValueError:
        ok = True
    check('text with no JSON in it is refused', ok)

    # ---------------------------------------------------------------- the renderer
    lay = LY.render([{'color': '#2f6bff', 'items': [{'t': 'line', 'a': [10, 50], 'b': [190, 50], 'w': 6 * 3840 / 200}]}], 200, 100)
    a = np.asarray(lay)
    check('a layer is transparent where nothing is drawn', a[10, 10, 3] == 0 and a[50, 100, 3] == 255 and tuple(a[50, 100, :3]) == (47, 107, 255))
    check('line width is px at 3840 wide, scaled to the drawing', 5 <= (a[:, 100, 3] > 127).sum() <= 7, '%d px' % (a[:, 100, 3] > 127).sum())
    half = LY.render([{'opacity': 50, 'items': [{'t': 'rect', 'a': [20, 20], 'b': [80, 80], 'fill': '#e8202a'}]}], 100, 100)
    check('layer opacity is kept in the alpha', abs(int(np.asarray(half)[50, 50, 3]) - 128) <= 2)

    # ---------------------------------------------------------------- saving
    board = os.path.join(OUT, 'board.png')
    Image.new('RGB', (800, 400), 'white').save(board)
    ImageDraw.Draw(im := Image.open(board).convert('RGB')).line([(100, 300), (700, 100)], fill='black', width=8); im.save(board)
    before = md5(board)
    marks = {'kind': 'animtk-redline', 'version': 1, 'W': 800, 'H': 400, 'layers': [
        {'name': 'Fixes', 'color': '#e8202a', 'items': [{'t': 'arrow', 'a': [400, 300], 'b': [400, 200], 'note': 'lift it'}]}]}
    mp = os.path.join(OUT, 'marks.json'); json.dump(marks, open(mp, 'w'))
    r1 = RL.save_redline(board, mp, out=OUT, fade=35)
    r2 = RL.save_redline(board, json.dumps(marks), out=OUT)
    names = sorted(f for f in os.listdir(OUT) if '_redline_' in f)
    check('two runs give v1 and v2, three files each', r1['v'] == 1 and r2['v'] == 2 and names == [
        'board_redline_v1.json', 'board_redline_v1.png', 'board_redline_v1_layer.png',
        'board_redline_v2.json', 'board_redline_v2.png', 'board_redline_v2_layer.png'], str(names))
    check('the drawing itself is untouched', md5(board) == before)
    L1 = Image.open(r1['layer']); C1 = np.asarray(Image.open(r1['copy']).convert('RGB'))
    check('the layer is RGBA at the drawing size', L1.mode == 'RGBA' and L1.size == (800, 400))
    check('fade 35 lightens the paper side of the line, not the marks', C1[300, 100].min() > 60 and any(px[0] > 200 and px[1] < 140 for px in C1[230:270, 397:404].reshape(-1, 3)), str(C1[300, 100]))
    j1 = json.load(open(r1['recipe']))
    check('the saved marks say where they came from and can be read back', j1['source'] == 'board.png' and j1['v'] == 1 and LY.count(LY.normalize(j1)[0]) == 1)
    n0 = len(os.listdir(OUT))
    out = subprocess.run([sys.executable, os.path.join(ROOT, 'redline.py'), board, mp, '--out', OUT, '--check'], capture_output=True, text=True)
    check('--check reports and writes nothing', out.returncode == 0 and 'Nothing written' in out.stdout and len(os.listdir(OUT)) == n0, out.stdout + out.stderr)

    # ---------------------------------------------------------------- --from-perspective
    cam = S.Camera.from_angles((0.8, 4.5, 0), yaw=6, pitch=-4, roll=0, fov=70)
    scene = S.room(-5, 5, 16, 9, tile=0) + S.place(S.prop_box(3, 3, 3), (-2.5, 0, 9))
    vp = cam.vanishing_point((0, 0, 1))
    bad_a = np.array([600.0, 1700.0]); bad_b = bad_a + (vp + [0, 100] - bad_a) * 0.45
    img = Image.new('RGB', (cam.W, cam.H), 'white'); d = ImageDraw.Draw(img)
    for kind, data, fill, ol, layer in scene:
        if kind == 'poly':
            for seg in S._segments(cam, np.array(data, float), 30, True): d.line(seg, fill='black', width=10)
        elif kind == 'lines' and ol != 'tile':
            for Lp in data:
                for seg in S._segments(cam, Lp): d.line(seg, fill='black', width=10)
    d.line([tuple(bad_a), tuple(bad_b)], fill='black', width=10)
    room = os.path.join(OUT, 'room.png'); img.save(room)
    res = RL.check_perspective(room)
    pdoc = RL.perspective_marks(res)
    fixes = [i for i in pdoc['layers'][0]['items'] if i['t'] == 'line']
    mid = (bad_a + bad_b) / 2
    hit = [f for f in fixes if np.hypot(*((np.array(f['a']) + f['b']) / 2 - mid)) < 30]
    check('the wrong line gets a red fix through its own middle', len(hit) == 1, '%d fixes' % len(fixes))
    if hit:
        f = hit[0]; A, B = np.array(f['a']), np.array(f['b']); u = (B - A) / np.linalg.norm(B - A)
        found = next(v['xy'] for v in res['vanishing_points'] if v['name'] == 'VP1')
        off = abs(cross2(u, np.array(found) - A))
        check('the red fix aims at the vanishing point it found', off < 2, '%.2f px off the line' % off)
        true_off = abs(cross2(u, vp - A))
        check('and so lands within 30 px of the true one', true_off < 30, '%.1f px' % true_off)
        check('the fix keeps the drawn length', abs(np.linalg.norm(B - A) - np.linalg.norm(bad_b - bad_a)) < 40)
    cons = pdoc['layers'][1]['items']
    check('construction carries the horizon and the vanishing point', any(i.get('text') == 'horizon' for i in cons) and any(i['t'] == 'circle' for i in cons))
    out = subprocess.run([sys.executable, os.path.join(ROOT, 'redline.py'), room, '--from-perspective', '--out', OUT], capture_output=True, text=True)
    check('the command line writes a numbered perspective redline', out.returncode == 0 and os.path.isfile(os.path.join(OUT, 'room_perspective_v1_layer.png')), out.stdout[-400:] + out.stderr[-400:])
    blank = os.path.join(OUT, 'blank.png'); Image.new('RGB', (600, 300), 'white').save(blank)
    nd = RL.perspective_marks(RL.check_perspective(blank))
    check('a picture with no perspective says so instead of inventing marks', LY.count(nd) == 0 and 'No vanishing point' in nd['note'], nd['note'])
finally:
    shutil.rmtree(OUT, ignore_errors=True)

print('\n%s' % ('ALL PASS' if not fails else '%d FAILED: %s' % (len(fails), ', '.join(fails))))
sys.exit(1 if fails else 0)
