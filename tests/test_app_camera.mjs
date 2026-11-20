// Camera mode and value mode of animation_app.html.
//   node tests/test_app_camera.mjs
// Part 1 (no browser): the camera move math and the silhouette math inside the HTML give the same
//   numbers as animtk/cammove.py and animtk/value.py.
// Part 2 (headless Chrome, needs `npm i puppeteer-core`): drives both modes with the real mouse,
//   file inputs and downloads. Uses generated stand-ins, no artwork.
import fs from 'node:fs';
import { appSource } from './appsrc.mjs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'tests', 'out'); fs.mkdirSync(out, { recursive: true });
const html = appSource(root);
const CamMath = new Function(html.split('/*CAM-START*/')[1].split('/*CAM-END*/')[0] + '; return CamMath;')();
const ValueMath = new Function(html.split('/*VAL-START*/')[1].split('/*VAL-END*/')[0] + '; return ValueMath;')();
let fails = 0;
const check = (name, ok, detail) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ' + detail : '')); if (!ok) fails++; };
const py = (code, ...args) => JSON.parse(execFileSync('python', ['-c', "import sys\nsys.path.insert(0, r'" + root.replace(/\\/g, '/') + "')\n" + code, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 }));

// ---------------------------------------------------------------- part 1: same math as Python
const moves = [
  { keys: [{ frame: 1, x: 0, y: 0, zoom: 1 }, { frame: 25, x: 1900, y: 0, zoom: 1 }, { frame: 49, x: 1900, y: -200, zoom: 1.6 }], W: 3840, H: 1920, margin: 0 },
  { keys: [{ frame: 10, x: -300, y: 120, zoom: 0.6, ease: 'in' }, { frame: 31, x: 800, y: -410, zoom: 2.25, ease: 'out' }, { frame: 40, x: 811, y: 77, zoom: 1.1, ease: 'linear' }, { frame: 77, x: -1500, y: 0, zoom: 1.1 }], W: 1920, H: 1080, margin: 0.05 },
  { keys: [{ frame: 5, x: 40, y: 40, zoom: 1.37 }], W: 3840, H: 1920, margin: 0.1 },
];
const pyPlans = py(`import json
from animtk import cammove as CM
print(json.dumps([dict(CM.plan(m['keys'], m['W'], m['H'], m['margin']), over=CM.check(CM.plan(m['keys'], m['W'], m['H'], m['margin']))) for m in json.loads(sys.argv[1])]))`, JSON.stringify(moves));
const tol = { x: 0.011, y: 0.011, zoom: 2e-5, layer_scale: 0.0011, place_scale: 0.0011 };
moves.forEach((m, i) => {
  const a = CamMath.plan(m.keys, m.W, m.H, m.margin), b = pyPlans[i]; let worst = 0, where = '';
  a.rows.forEach((r, k) => { for (const c of CamMath.COLS) { const d = Math.abs(r[c] - b.rows[k][c]) / (tol[c] || 0.11); if (d > worst) { worst = d; where = c + ' frame ' + r.frame; } } });
  check('move ' + (i + 1) + ': canvas size matches Python', a.canvas[0] === b.canvas[0] && a.canvas[1] === b.canvas[1], a.canvas.join(' x '));
  check('move ' + (i + 1) + ': all ' + a.rows.length + ' frame rows match Python', a.rows.length === b.rows.length && worst <= 1, 'worst ' + where);
  check('move ' + (i + 1) + ': edge check agrees', Math.abs(CamMath.check(a) - b.over) < 0.2);
});
const vcases = [{ gap: 3 }, { gap: 0 }, { gap: 5, edge: 'open' }, { gap: 3, fills: [[150, 70]] }, { gap: 3, clears: [[60, 40]], fills: [[20, 85]] }];
const pv = py(`import json, numpy as np, cv2
from animtk import value as V
g = np.full((100, 200), 255, np.uint8)
cv2.ellipse(g, (60, 40), (38, 26), 0, 8, 360, 0, 2); cv2.rectangle(g, (120, 55), (175, 99), 0, 2); cv2.line(g, (0, 70), (40, 99), 0, 2); cv2.circle(g, (150, 25), 14, 0, 2); cv2.line(g, (90, 0), (95, 99), 0, 1)
t = np.clip(np.add.outer(np.arange(100) * 1.4, np.arange(200) * 0.5), 0, 255).astype(np.uint8)
res = []
for c in json.loads(sys.argv[1]):
    m, note = V.silhouette_lines(g, c.get('gap', 4), c.get('fills', ()), c.get('clears', ()), c.get('edge', 'auto'))
    res.append(dict(mask=''.join('1' if v else '0' for v in m.ravel()), patches=note['patches'], cut=note['cut_by_frame']))
print(json.dumps(dict(gray=g.ravel().tolist(), res=res, otsu=V.otsu(t), tone=t.ravel().tolist(), post=V.posterize(np.arange(256, dtype=np.uint8), 3).tolist())))`, JSON.stringify(vcases));
const gray = Uint8Array.from(pv.gray);
vcases.forEach((c, i) => {
  const r = ValueMath.silhouetteLines(gray, 200, 100, c.gap, c.fills, c.clears, c.edge), mine = Array.from(r.mask).join('');
  let diff = 0; for (let k = 0; k < mine.length; k++) if (mine[k] !== pv.res[i].mask[k]) diff++;
  check('silhouette case ' + (i + 1) + ' ' + JSON.stringify(c) + ' matches Python pixel for pixel', diff === 0 && r.patches === pv.res[i].patches && r.cut_by_frame === pv.res[i].cut, diff + ' pixels differ, ' + r.patches + ' patches');
});
check('automatic tone cutoff matches Python', ValueMath.otsu(Uint8Array.from(pv.tone)) === pv.otsu, ValueMath.otsu(Uint8Array.from(pv.tone)) + ' vs ' + pv.otsu);
check('3-value grayscale matches Python', pv.post.every((v, g) => ValueMath.posterize(g, 3) === v));

// ---------------------------------------------------------------- part 2: the app itself
let puppeteer;
for (const base of [root, path.join(root, '_scratch'), process.cwd()]) { try { puppeteer = createRequire(path.join(base, 'x.js'))('puppeteer-core'); break; } catch (e) {} }
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
if (!puppeteer || !chrome) { console.log('\nSkipping the browser part: ' + (!puppeteer ? 'puppeteer-core is not installed (npm i puppeteer-core).' : 'no Chrome or Edge found.')); console.log(fails ? fails + ' FAILED' : 'MATH PART PASSED'); process.exit(fails ? 1 : 0); }
execFileSync('python', [path.join(root, 'tests', 'make_value_samples.py')], { stdio: 'ignore' });
const sv = path.join(out, 'synth_value'), T = JSON.parse(fs.readFileSync(path.join(out, 'synth_value_truth.json'), 'utf8'));
const dl = path.join(out, 'app_camera'); fs.rmSync(dl, { recursive: true, force: true }); fs.mkdirSync(dl, { recursive: true });
const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--window-size=1700,980'] });
const page = await browser.newPage(); await page.setViewport({ width: 1700, height: 980 });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const client = await page.createCDPSession(); await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitFile = async name => { for (let i = 0; i < 60; i++) { if (fs.existsSync(path.join(dl, name))) { await sleep(150); return true; } await sleep(100); } return false; };
const type = async (sel, v) => { await page.click(sel, { clickCount: 3 }); await page.keyboard.type(String(v)); };
await page.goto(pathToFileURL(path.join(root, 'animation_app.html')).href);
await page.evaluate(() => localStorage.clear()); await page.reload();

// camera mode: build the 3-key move by clicking and typing
await page.click('[data-mode="camera"]');
await page.click('[data-cmove="pan"]');
await page.click('#cKeys .pitem:nth-child(2)'); await type('#cKF', 25); await type('#cKX', 1900);
await page.click('#cAdd'); await type('#cKF', 49); await type('#cKX', 1900); await type('#cKY', -200); await type('#cKZ', 160);
check('typing three keys gives the canvas size worked out by hand', (await page.$eval('#cSize', e => e.textContent)) === '9184 x 3072 px', await page.$eval('#cSize', e => e.textContent));
check('it says the view stays inside the canvas', /stays inside the canvas on every frame/.test(await page.$eval('#cSizeInfo', e => e.textContent)));
check('the table has one row per frame and marks the keys', (await page.$$eval('#cTable tbody tr', r => r.length)) === 49 && (await page.$$eval('#cTable tr.key', r => r.length)) === 3);
await page.click('#cCsv'); check('frame table CSV downloads', await waitFile('shot_camera.csv'));
execFileSync('python', [path.join(root, 'camera_move.py'), '--key', '1,0,0,100', '--key', '25,1900,0,100', '--key', '49,1900,-200,160', '--out', dl, '--name', 'py'], { cwd: root });
const rows = f => fs.readFileSync(path.join(dl, f), 'utf8').trim().split(/\r?\n/).map(l => l.split(','));
const A = rows('shot_camera.csv'), B = rows('py_camera.csv'); let worst = 0;
for (let i = 1; i < A.length; i++) for (let k = 0; k < A[0].length; k++) worst = Math.max(worst, Math.abs(+A[i][k] - +B[i][k]) / (tol[A[0][k]] || 0.11));
check('the app CSV equals the camera_move.py CSV (same columns, same numbers)', A[0].join() === B[0].join() && A.length === B.length && worst <= 1, A.length - 1 + ' rows');
await page.click('#cSave'); await waitFile('shot_move.json');
const viaJson = execFileSync('python', [path.join(root, 'camera_move.py'), '--json', path.join(dl, 'shot_move.json'), '--out', dl, '--name', 'fromapp'], { cwd: root, encoding: 'utf8' });
check('a move saved from the app opens in camera_move.py with the same answer', /CANVAS NEEDED: 9184 x 3072/.test(viaJson));
await page.click('#cPng'); check('plan picture downloads', await waitFile('shot_plan.png') && fs.statSync(path.join(dl, 'shot_plan.png')).size > 20000);
// drag the last key's box 240 screen px to the right: the key moves by exactly that much of the world
const g = await page.evaluate(() => { const r = document.querySelector('#cView').getBoundingClientRect(), t = Camera.transform(), k = Camera.C.keys[2], d = window.devicePixelRatio || 1; return { x: r.left + (t.ox + k.x * t.s) / d, y: r.top + (t.oy + k.y * t.s) / d, s: t.s / d }; });
await page.mouse.move(g.x, g.y); await page.mouse.down(); await page.mouse.move(g.x + 120, g.y, { steps: 4 }); await page.mouse.move(g.x + 240, g.y, { steps: 4 }); await page.mouse.up();
const moved = await page.evaluate(() => Camera.C.keys[2].x);
check('dragging a key box moves that key by the distance dragged', Math.abs(moved - (1900 + 240 / g.s)) < 3 && (await page.evaluate(() => Camera.C.keys[2].y)) === -200, 'x 1900 -> ' + moved + ', expected ' + Math.round(1900 + 240 / g.s));
const grown = await page.evaluate(() => ({ c: Camera.plan().canvas, over: CamMath.check(Camera.plan()) }));
check('  and the canvas grows to fit', grown.c[0] > 9184 && grown.over < 0.6, JSON.stringify(grown));
const z0 = await page.evaluate(() => Camera.C.keys[2].zoom); await page.mouse.move(g.x, g.y); await page.mouse.wheel({ deltaY: -200 }); await sleep(60);
const z1 = await page.evaluate(() => Camera.C.keys[2].zoom);
check('scrolling zooms the selected key in', z1 > z0 * 1.2, z0 + ' -> ' + z1);
await page.$eval('#cScrub', e => { e.value = 13; e.dispatchEvent(new Event('input')); });
check('scrubbing shows that frame', /^Frame 13,/.test(await page.$eval('#cNow', e => e.textContent)) && (await page.$eval('#cTable tr.now', e => e.dataset.f)) === '13');
await page.evaluate(() => { Camera.C.sel = 0; Camera.sync(); }); await (await page.$('#cImg')).uploadFile(path.join(sv, '1_lines.png')); await sleep(500);
check('a key drawing loads and shows in its box', await page.evaluate(() => !!Camera.C.keys[0].img) && /\+drawing/.test(await page.$eval('#cKeys', e => e.textContent)));
await page.reload(); await page.click('[data-mode="camera"]');
check('the move is still there after closing and reopening', (await page.evaluate(() => Camera.C.keys.length)) === 3 && Math.abs((await page.evaluate(() => Camera.C.keys.find(k => k.frame === 49).x)) - moved) < 1);
await page.screenshot({ path: path.join(out, 'app_camera.png') });

// value mode
await page.click('[data-mode="value"]');
await (await page.$('#vFiles')).uploadFile(...['3_alpha.png', '1_lines.png', '2_tone.png'].map(f => path.join(sv, f))); await page.waitForFunction(() => Value.Vs.frames.length === 3);
const pyv = py(`import json, numpy as np
from animtk import value as V, imgio
res = {}
for f in ('1_lines', '2_tone', '3_alpha'):
    p = sys.argv[1] + '/' + f + '.png'; g = V.luminance(np.array(imgio.load_flat(p))); m, info = V.silhouette(g, np.array(imgio.load_rgba(p))[..., 3]); res[f] = dict(info, sep=V.separation(g, m))
print(json.dumps(res))`, sv.replace(/\\/g, '/'));
const R = () => page.evaluate(() => { const r = Value.result(); return { mode: r.mode, coverage: r.coverage, separation: r.separation, figure: r.figure, name: Value.Vs.frames[Value.Vs.cur].name }; });
let r = await R();
check('frames sort by number, line art is recognised', r.name === '1_lines.png' && r.mode === 'lines');
check('silhouette covers the same share as value_check.py', Math.abs(r.coverage - pyv['1_lines'].coverage) < 0.6, r.coverage.toFixed(1) + '% vs ' + pyv['1_lines'].coverage + '%');
const clickAt = async pt => { const b = await page.evaluate(() => { const b = Value.boxes(), rc = document.querySelector('#vView').getBoundingClientRect(), d = window.devicePixelRatio || 1; return { x: rc.left + b.sil[0] / d, y: rc.top + b.sil[1] / d, w: b.pw / d, h: b.ph / d }; }); await page.mouse.click(b.x + pt[0] / T.size[0] * b.w, b.y + pt[1] / T.size[1] * b.h); await sleep(80); };
await clickAt(T.corner_point); let r2 = await R();
check('clicking the shape cut off by the corner fills it', Math.abs(r2.coverage - r.coverage - T.corner_share) < 1.2, '+' + (r2.coverage - r.coverage).toFixed(1) + '% (shape is ' + T.corner_share.toFixed(1) + '%)');
check('  and the click is shown as a value_check.py flag', /--fill 18\d\d,8\d\d/.test(await page.$eval('#vReadout', e => e.textContent)));
await clickAt(T.arm_point); let r3 = await R();
check('clicking the arm turns it white', Math.abs(r2.coverage - r3.coverage - T.arm_share) < 1.2 && (await page.evaluate(() => Value.Vs.frames[Value.Vs.cur].marks.length)) === 2);
await clickAt(T.arm_point); check('clicking it again puts it back, and forgets the click', Math.abs((await R()).coverage - r2.coverage) < 0.01 && (await page.evaluate(() => Value.Vs.frames[Value.Vs.cur].marks.length)) === 1);
await page.click('#vReset'); check('"Undo my clicks" returns to the automatic answer', Math.abs((await R()).coverage - r.coverage) < 0.01);
await page.$eval('#vGap', e => { e.value = 0; e.dispatchEvent(new Event('input')); });
check('with gap closing at 0 the gapped outline leaks', (await R()).coverage < r.coverage - T.body_share * 0.8);
await page.$eval('#vGap', e => { e.value = 4; e.dispatchEvent(new Event('input')); });
await page.click('#vPng'); check('side by side PNG downloads', await waitFile('1_lines_value.png'));
await page.click('#vSil'); check('silhouette PNG downloads', await waitFile('1_lines_silhouette.png'));
const dims = py(`import json
from PIL import Image
import numpy as np
a = Image.open(sys.argv[1] + '/1_lines_value.png'); b = Image.open(sys.argv[1] + '/1_lines_silhouette.png').convert('L'); n = np.array(b)
print(json.dumps(dict(a=a.size, b=b.size, grays=len(np.unique(n)), black=float((n < 128).mean() * 100))))`, dl.replace(/\\/g, '/'));
check('exports are full size: silhouette ' + T.size.join(' x ') + ', pure black and white', dims.b[0] === T.size[0] && dims.b[1] === T.size[1] && dims.grays === 2 && dims.a[0] > 2 * T.size[0] && Math.abs(dims.black - r.coverage) < 0.6, JSON.stringify(dims));
await page.keyboard.press('ArrowRight'); r = await R();
check('painted frame: recognised, figure and background values measured', r.mode === 'tone' && Math.abs(r.coverage - pyv['2_tone'].coverage) < 0.6 && Math.abs(r.separation - pyv['2_tone'].sep.separation) < 1.5, r.coverage.toFixed(1) + '%, apart ' + r.separation.toFixed(1) + ' (Python ' + pyv['2_tone'].sep.separation + ')');
await page.select('#vLevels', '3');
const shades = await page.evaluate(() => { const b = Value.boxes(), c = document.querySelector('#vView'), d = c.getContext('2d').getImageData(Math.round(b.other[0]) + 8, Math.round(b.other[1] + b.ph * 0.3), Math.round(b.pw) - 16, Math.round(b.ph * 0.65)).data; let odd = 0; for (let i = 0; i < d.length; i += 4) if ([0, 128, 255].every(t => Math.abs(d[i] - t) > 6)) odd++; return odd / (d.length / 4) * 100; });
check('3-value grayscale shows only black, mid gray and white (bar the soft edges)', shades < 1.5, shades.toFixed(2) + '% of the picture is any other gray');
await page.screenshot({ path: path.join(out, 'app_value.png') });
await page.keyboard.press('ArrowRight'); r = await R();
check('transparent background: used as the silhouette', r.mode === 'alpha' && Math.abs(r.coverage - pyv['3_alpha'].coverage) < 0.6, r.coverage.toFixed(1) + '%');
await page.click('#vFlip'); await page.click('#vStack');
check('flip and stack redraw without trouble', await page.evaluate(() => { const b = Value.boxes(); return b.sil[0] === b.other[0] && b.other[1] > b.sil[1]; }));
check('no script errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log('\n' + (fails ? fails + ' FAILED' : 'ALL PASSED')); process.exit(fails ? 1 : 0);
