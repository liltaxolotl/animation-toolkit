// Drives animation_app.html in a real (headless) Chrome: uploads a board, drags lines, adds props,
// moves sliders, exports the guide PNG and the scene file, then renders that scene with scene_render.py.
//
//   npm i puppeteer-core        (once, anywhere above this folder; it uses the Chrome already installed)
//   node tests/test_app_ui.mjs [path/to/board.png]
//
// Screenshots and exports land in tests/out/.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'tests', 'out'); fs.mkdirSync(out, { recursive: true });
let puppeteer;
for (const base of [root, path.join(root, '_scratch'), process.cwd()]) {
  try { puppeteer = createRequire(path.join(base, 'x.js'))('puppeteer-core'); break; } catch (e) {}
}
if (!puppeteer) { console.log('puppeteer-core is not installed. Run: npm i puppeteer-core'); process.exit(2); }
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
if (!chrome) { console.log('No Chrome or Edge found.'); process.exit(2); }

let board = process.argv[2] || path.join(out, 'synthetic_one_point.png');
if (!fs.existsSync(board)) execFileSync('python', [path.join(root, 'tests', 'test_perspective.py')], { stdio: 'ignore' });

let fails = 0;
const check = (name, ok, detail) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ' + detail : '')); if (!ok) fails++; };
const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--window-size=1700,980', '--allow-file-access-from-files'] });
const page = await browser.newPage(); await page.setViewport({ width: 1700, height: 980 });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const client = await page.createCDPSession(); await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: out });
await page.goto(pathToFileURL(path.join(root, 'animation_app.html')).href);
await page.evaluate(() => { localStorage.clear(); }); await page.reload();

// canvas pixel -> screen pixel
const toScreen = async (p) => page.evaluate(p => { const r = document.querySelector('#pCanvas').getBoundingClientRect(), v = Persp.UI.view; return [r.left + v.x + p[0] * v.s, r.top + v.y + p[1] * v.s]; }, p);
const drag = async (a, b, opts = {}) => { const s = await toScreen(a), e = await toScreen(b); await page.mouse.move(s[0], s[1]); if (opts.shift) await page.keyboard.down('Shift'); await page.mouse.down(); await page.mouse.move((s[0] + e[0]) / 2, (s[1] + e[1]) / 2, { steps: 4 }); await page.mouse.move(e[0], e[1], { steps: 4 }); await page.mouse.up(); if (opts.shift) await page.keyboard.up('Shift'); };
const toward = (from, vp, t) => [from[0] + (vp[0] - from[0]) * t, from[1] + (vp[1] - from[1]) * t];
const setRange = (sel, v) => page.evaluate((sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, sel, v);

// 1. upload a board
await (await page.$('#pBoardFile')).uploadFile(board);
await page.waitForFunction(() => document.querySelector('#pCanvasInfo').textContent.includes('('));
const size = await page.evaluate(() => [Persp.S.W, Persp.S.H]);
check('board upload sets the canvas size', size[0] > 0 && size[1] > 0, size.join(' x '));
const [W, H] = size;

// 2. depth lines aimed at one spot
const VA = [W * 0.55, H * 0.42];
await page.click('[data-tool="A"]');
for (const from of [[W * 0.08, H * 0.9], [W * 0.92, H * 0.95], [W * 0.1, H * 0.1]]) await drag(from, toward(from, VA, 0.45));
let st = await page.evaluate(() => { const d = Persp.D(); return { vp: d.vp.A, n: Persp.S.lines.length, camVP: AT.vanishingPoint(d.cam, [0, 0, 1]) }; });
check('three dragged lines become three depth lines', st.n === 3, 'count ' + st.n);
check('depth vanishing point found where the lines aim', Math.hypot(st.vp[0] - VA[0], st.vp[1] - VA[1]) < 12, `at ${st.vp.map(Math.round)} wanted ${VA.map(Math.round)}`);
check('camera snaps to it', Math.hypot(st.camVP[0] - VA[0], st.camVP[1] - VA[1]) < 12);
await page.screenshot({ path: path.join(out, 'app_1_depth_lines.png') });

// 3. side lines aimed far off to the left, slightly lower: gives lens width and a tilted horizon
const VB = [-W * 0.8, H * 0.47];
await page.click('[data-tool="B"]');
for (const from of [[W * 0.5, H * 0.85], [W * 0.45, H * 0.12], [W * 0.3, H * 0.6]]) await drag(from, toward(from, VB, 0.12));
st = await page.evaluate(() => { const d = Persp.D(); return { vpB: d.vp.B, fov: d.cam.fov, solved: d.solved, roll: Persp.S.cam.roll, vx: AT.vanishingPoint(d.cam, [1, 0, 0]), vz: AT.vanishingPoint(d.cam, [0, 0, 1]) }; });
check('side vanishing point found', Math.hypot(st.vpB[0] - VB[0], st.vpB[1] - VB[1]) < 60, `at ${st.vpB.map(Math.round)} wanted ${VB.map(Math.round)}`);
check('lens width solved from the two points', st.solved && st.fov > 20 && st.fov < 160, 'lens ' + st.fov.toFixed(1));
check('camera hits both points', Math.hypot(st.vz[0] - VA[0], st.vz[1] - VA[1]) < 15 && Math.hypot(st.vx[0] - st.vpB[0], st.vx[1] - st.vpB[1]) < 15);
const wantTilt = Math.atan2(VA[1] - VB[1], VA[0] - VB[0]) * 180 / Math.PI;
check('Dutch tilt follows the horizon through both points', Math.abs(st.roll - wantTilt) < 0.6, `${st.roll.toFixed(2)} vs ${wantTilt.toFixed(2)}`);

// 4. a deliberately wrong depth line gets a "misses by" tag (needs 3+ lines in the group)
await page.click('[data-tool="A"]');
const wrongFrom = [W * 0.8, H * 0.2]; await drag(wrongFrom, toward(wrongFrom, [VA[0], VA[1] + H * 0.2], 0.4));
const miss = await page.evaluate(() => { const d = Persp.D(); return Persp.S.lines.filter(l => l.g === 'A').map(l => AT.missOf(l, d.vp.A).deg); });
check('a line that misses is measured', Math.max(...miss) > 1.5, 'worst ' + Math.max(...miss).toFixed(1) + ' deg');
await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
check('undo removes it again', (await page.evaluate(() => Persp.S.lines.length)) === 6);

// 5. props: add, drag on the floor, lift, swing a door
await page.click('[data-add="box"]');
let p0 = await page.evaluate(() => Persp.S.props[0].pos.slice());
const boxPx = await page.evaluate(() => { const d = Persp.D(), q = Persp.S.props[0]; return AT.project(d.cam, [q.pos[0], q.pos[1] + 1, q.pos[2]]); });
await drag(boxPx, [boxPx[0] + W * 0.08, boxPx[1] + H * 0.03]);
let p1 = await page.evaluate(() => Persp.S.props[0].pos.slice());
check('dragging a box slides it along the floor', (p1[0] !== p0[0] || p1[2] !== p0[2]) && p1[1] === p0[1], `${p0} -> ${p1}`);
check('snap keeps it on the quarter-foot grid', [p1[0], p1[2]].every(v => Math.abs(v * 4 - Math.round(v * 4)) < 1e-9));
const boxPx2 = await page.evaluate(() => { const d = Persp.D(), q = Persp.S.props[0]; return AT.project(d.cam, [q.pos[0], q.pos[1] + 1, q.pos[2]]); });
await drag(boxPx2, [boxPx2[0], boxPx2[1] - H * 0.1], { shift: true });
const p2 = await page.evaluate(() => Persp.S.props[0].pos.slice());
check('shift-drag lifts it', p2[1] > p1[1] && p2[0] === p1[0] && p2[2] === p1[2], `height ${p1[1]} -> ${p2[1]}`);
for (const t of ['door', 'shelf', 'bottle', 'cylinder', 'jar', 'cabinet']) await page.click(`[data-add="${t}"]`);
check('all seven prop kinds add', (await page.evaluate(() => Persp.S.props.length)) === 7);
// spread them out so the picture reads, then swing the door wide
await page.evaluate(() => { const P = Persp.S.props, at = [[-4, 0, 9], [0, 0, 14], [5, 0, 13], [5, 1.71, 13], [-1.5, 0, 7], [2, 0, 7], [-5, 0, 13]]; P.forEach((q, i) => q.pos = at[i]); P[1].swing = 0; Persp.draw(); });
const doorEdge = async () => page.evaluate(() => { const d = Persp.D(), g = AT.propWorld(Persp.S.props[1], d.cam.C); return g.faces[0][1]; });   // free edge of the door panel, at the floor
const e0 = await doorEdge();
await page.evaluate(() => { Persp.UI.sel = { kind: 'prop', i: 1 }; Persp.setTool('S'); });
await page.evaluate(() => { Persp.S.props[1].swing = 90; Persp.draw(); });
const e90 = await doorEdge(); const hingeX = -1.5, doorW = Math.hypot(3, 0.06);   // 0.06 = half the door's thickness
check('door swings on its hinge: free edge keeps its distance from the hinge', Math.abs(Math.hypot(e90[0] - hingeX, e90[2] - 14) - doorW) < 1e-6 && Math.abs(Math.hypot(e0[0] - hingeX, e0[2] - 14) - doorW) < 1e-6);
check('at 90 degrees the door points straight at the viewer', Math.abs(e90[0] - hingeX) < 0.061 && Math.abs(e90[2] - 11) < 1e-6, `free edge at x ${e90[0].toFixed(2)}, z ${e90[2].toFixed(2)}`);
await page.evaluate(() => { Persp.S.props[1].swing = 60; Persp.S.props[6].swing = 70; Persp.S.solid = true; Persp.UI.sel = null; Persp.draw(); });
await page.screenshot({ path: path.join(out, 'app_2_props.png') });

// 6. lens sliders
await setRange('.sl[data-k="fish"] input', 55); await setRange('.sl[data-k="skew"] input', 12);
st = await page.evaluate(() => { const c = Persp.D().cam; return { k: c.k, skew: c.skew }; });
check('fisheye slider bends the lens', Math.abs(st.k - (1 - 0.55 * 0.98)) < 1e-9, 'k ' + st.k.toFixed(3));
check('skew slider shears the picture', st.skew === 12);
await page.screenshot({ path: path.join(out, 'app_3_fisheye_skew.png') });
await setRange('.sl[data-k="fish"] input', 0); await setRange('.sl[data-k="skew"] input', 0);
await page.evaluate(() => { document.querySelector('#pUseLines').click(); });
await setRange('.sl[data-k="roll"] input', 15);
check('with "camera follows my lines" off, Dutch tilt is free', Math.abs((await page.evaluate(() => AT.rToAngles(Persp.D().cam.R).roll)) - 15) < 1e-6);
await page.evaluate(() => { document.querySelector('#pUseLines').click(); });

// 7. export the guide (real download) and check it is full size and see-through
const png = path.join(out, path.basename(board).replace(/\.[^.]+$/, '') + '_guide.png'); if (fs.existsSync(png)) fs.unlinkSync(png);
await page.click('#pExport');
for (let i = 0; i < 50 && !fs.existsSync(png); i++) await new Promise(r => setTimeout(r, 100));
check('guide PNG downloads', fs.existsSync(png), png);
const g = await page.evaluate(() => { const c = Persp.guideCanvas(), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let clear = 0, inked = 0; for (let i = 3; i < d.length; i += 4) { if (d[i] === 0) clear++; else if (d[i] > 200) inked++; } return { w: c.width, h: c.height, clear: clear / (c.width * c.height), inked: inked / (c.width * c.height) }; });
check('guide is the full canvas size', g.w === W && g.h === H, `${g.w} x ${g.h}`);
check('guide is transparent with lines on it', g.clear > 0.5 && g.inked > 0.005, `${(g.clear * 100).toFixed(0)}% clear, ${(g.inked * 100).toFixed(1)}% ink`);

// 8. scene file round trip, then through scene_render.py
const scene = await page.evaluate(() => Persp.sceneJSON());
const sp = path.join(out, 'app_scene.json'); fs.writeFileSync(sp, JSON.stringify(scene, null, 1));
const before = await page.evaluate(() => AT.project(Persp.D().cam, [1, 2, 9]));
await page.evaluate(s => { Persp.S.props = []; Persp.S.lines = []; Persp.loadScene(s); }, scene);
const after = await page.evaluate(() => ({ uv: AT.project(Persp.D().cam, [1, 2, 9]), n: Persp.S.props.length, l: Persp.S.lines.length }));
check('scene saves and loads back the same', Math.hypot(after.uv[0] - before[0], after.uv[1] - before[1]) < 1e-6 && after.n === 7 && after.l === 6);
let py = '';
try { py = execFileSync('python', [path.join(root, 'scene_render.py'), sp, '--out', out, '--board', board], { encoding: 'utf8' }); } catch (e) { py = 'ERROR ' + e.message; }
check('scene_render.py renders the app scene', fs.existsSync(path.join(out, 'app_scene_guide.png')) && !py.startsWith('ERROR'), py.trim().split('\n').pop());
// same camera on both sides: a prop corner must land on the same pixel in the app and in Python
const cmp = execFileSync('python', ['-c', `
import sys, json; sys.path.insert(0, r'${root.replace(/\\/g, '/')}')
import numpy as np; from animtk import scene3d as S
spec = S.load_scene(r'${sp.replace(/\\/g, '/')}'); cam, items, groups, rb = S.build_scene(spec)
print(json.dumps(cam.project(np.array([[1, 2, 9]])).tolist()[0]))`], { encoding: 'utf8' });
const pyUV = JSON.parse(cmp);
check('app and scene_render.py agree on where things land', Math.hypot(pyUV[0] - before[0], pyUV[1] - before[1]) < 0.01, `difference ${Math.hypot(pyUV[0] - before[0], pyUV[1] - before[1]).toExponential(2)} px`);

check('no script errors in the page', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
