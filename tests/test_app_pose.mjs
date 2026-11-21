// The Pose match tab (build step 4): open a drawing, the guessed skeleton, dragging and hiding joints, the toward or
// away flips, fitting the 3D figure, the ghost layer, exports at the drawing's exact size, copies as new versions,
// the shot file, before / after, sending the pose to Figure 3D, and her Figure 3D pose coming back after every fit.
//   node tests/test_app_pose.mjs           (pose-fit.mjs is replaced by a stand-in, so this tests the tab, not the math)
// If app/js/pose-fit.mjs exists, a second pass runs the real solver on a drawn stick figure with known joints and
// prints how far each joint lands. Needs puppeteer-core (npm i puppeteer-core, in _scratch/ is fine) and Chrome or
// Edge. Starts serve.py on a free port. Every input is generated here, and every work/_test_* folder is removed after.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'tests', 'out'); fs.mkdirSync(out, { recursive: true });
const dl = path.join(out, 'pose_downloads'); fs.rmSync(dl, { recursive: true, force: true }); fs.mkdirSync(dl, { recursive: true });
const work = path.join(root, 'work');
let fails = 0;
const check = (name, ok, detail) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ' + detail : '')); if (!ok) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cleanWork = () => { try { for (const n of fs.readdirSync(work)) if (n.startsWith('_test_pose')) fs.rmSync(path.join(work, n), { recursive: true, force: true }); } catch (e) {} };
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

let puppeteer;
for (const base of [root, path.join(root, '_scratch'), process.cwd()]) { try { puppeteer = createRequire(path.join(base, 'x.js'))('puppeteer-core'); break; } catch (e) {} }
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
if (!puppeteer || !chrome) { console.log('FAIL  cannot run: ' + (!puppeteer ? 'puppeteer-core is not installed' : 'no Chrome or Edge found')); process.exit(1); }

// ---------------------------------------------------------------- inputs: a 3840 x 1920 board with a stick figure of known joints
const TRUE = { head: [1900, 360], neck: [1900, 470], chest: [1900, 610], pelvis: [1900, 900],
  shoulder_l: [2060, 510], elbow_l: [2260, 420], wrist_l: [2440, 330], shoulder_r: [1740, 510], elbow_r: [1715, 700], wrist_r: [1705, 880],
  hip_l: [1975, 905], knee_l: [1990, 1250], ankle_l: [2000, 1610], toe_l: [2060, 1680], hip_r: [1825, 905], knee_r: [1810, 1250], ankle_r: [1800, 1610], toe_r: [1740, 1680] };
const BONES = [['head', 'neck'], ['neck', 'chest'], ['chest', 'pelvis'], ['neck', 'shoulder_l'], ['shoulder_l', 'elbow_l'], ['elbow_l', 'wrist_l'], ['neck', 'shoulder_r'], ['shoulder_r', 'elbow_r'], ['elbow_r', 'wrist_r'],
  ['pelvis', 'hip_l'], ['hip_l', 'knee_l'], ['knee_l', 'ankle_l'], ['ankle_l', 'toe_l'], ['pelvis', 'hip_r'], ['hip_r', 'knee_r'], ['knee_r', 'ankle_r'], ['ankle_r', 'toe_r']];
const board = path.join(out, '_test_pose_board.png'), clear = path.join(out, '_test_pose_clear.png');
execFileSync('python', ['-P', '-c', [
  'import sys, json', 'from PIL import Image, ImageDraw',
  'J = json.loads(sys.argv[3]); B = json.loads(sys.argv[4])',
  'im = Image.new("RGB", (3840, 1920), (250, 246, 238)); d = ImageDraw.Draw(im)',
  'd.rectangle((20, 20, 3819, 1899), outline=(40, 38, 45), width=6)',             // a panel border: the guess must ignore it
  'd.ellipse((3460, 260, 3540, 340), outline=(40, 38, 45), width=8)',             // a small doodle far away
  'for a, b in B: d.line((tuple(J[a]), tuple(J[b])), fill=(30, 28, 35), width=14)',
  'hx, hy = J["head"]; d.ellipse((hx - 95, hy - 95, hx + 95, hy + 95), outline=(30, 28, 35), width=14)',
  'im.save(sys.argv[1])',
  't = Image.new("RGBA", (1000, 1400), (0, 0, 0, 0)); d2 = ImageDraw.Draw(t)',      // a transparent PNG, ink found by alpha
  'k = 0.8; S = lambda p: ((p[0] - 1900) * k + 500, (p[1] - 260) * k + 160)',
  'for a, b in B: d2.line((S(J[a]), S(J[b])), fill=(30, 40, 120, 255), width=10)',
  'cx, cy = S(J["head"]); d2.ellipse((cx - 76, cy - 76, cx + 76, cy + 76), outline=(30, 40, 120, 255), width=10)',
  't.save(sys.argv[2])'].join('\n'), board, clear, JSON.stringify(TRUE), JSON.stringify(BONES)]);
const boardSha = sha(board), clearSha = sha(clear);
const pngInfo = (p, pts) => JSON.parse(execFileSync('python', ['-P', '-c', [
  'import sys, json', 'from PIL import Image', 'im = Image.open(sys.argv[1]); a = im.convert("RGBA")',
  'pts = json.loads(sys.argv[2]); print(json.dumps({"w": im.width, "h": im.height, "mode": im.mode, "alpha": [a.getpixel((int(x), int(y)))[3] for x, y in pts]}))'].join('\n'), p, JSON.stringify(pts)]).toString());

// ---------------------------------------------------------------- the stand-in for pose-fit.mjs (the lead writes the real one)
const FAKE = `
export function fitPose(Fig, o) {
  window.__fitCalls = (window.__fitCalls || []).concat([JSON.parse(JSON.stringify(o))]);
  Fig.setAngles('lowerarm_l', { y: 100 }, false);          // a real fit moves the figure too: the tab must put her pose back
  const pose = Fig.getPose(), error = {}, joints2d = {};
  for (const n in o.joints) { const p = o.joints[n]; if (!p) continue; const e = n === 'wrist_l' ? 60 : 3; error[n] = e; joints2d[n] = [p[0] + e, p[1]]; }
  return { pose, camera: { pos: [0, 1, 5], right: [1, 0, 0], up: [0, 1, 0], back: [0, 0, 1], theta: 0.4, center: [o.W / 2, o.H / 2], f: 1000 },
    place: { x: 0, z: 0, height: 1.8, yaw: 0 }, error, confidence: 0.72, notes: ['Test fit, not the real solver.'], joints2d,
    depth: { arm_l: o.flips.arm_l ? 'away' : 'toward' } };
}
export function renderGhost(Fig, fit, W, H) {
  window.__ghostPose = Fig.getPose();
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'), call = window.__fitCalls[window.__fitCalls.length - 1];
  g.fillStyle = 'rgb(20,160,60)'; for (const n in call.joints) { const p = call.joints[n]; if (p) { g.beginPath(); g.arc(p[0], p[1], 90, 0, 7); g.fill(); } }
  return c;
}`;

// ---------------------------------------------------------------- server and browser
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const port = await freePort();
cleanWork();
const server = spawn('python', ['-P', path.join(root, 'serve.py'), '--port', String(port), '--no-open'], { cwd: root, stdio: 'ignore' });
let browser;
const finish = async code => { try { if (browser) await browser.close(); } catch (e) {} try { server.kill(); } catch (e) {} await sleep(300); cleanWork(); process.exit(code); };
process.on('uncaughtException', async e => { console.log('FAIL  the test itself crashed: ' + (e && e.stack || e)); await finish(1); });
process.on('unhandledRejection', async e => { console.log('FAIL  the test itself crashed: ' + (e && e.stack || e)); await finish(1); });
for (let i = 0; i < 50; i++) { try { const r = await fetch('http://127.0.0.1:' + port + '/api/ping'); if (r.ok) break; } catch (e) {} await sleep(200); }
const URL = 'http://127.0.0.1:' + port + '/animation_app.html';
browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1700,980'] });
const watch = (pg, bucket) => {
  pg.on('pageerror', e => bucket.push('pageerror: ' + e.message));
  pg.on('console', m => { if (m.type() !== 'error') return; const u = (m.location() && m.location().url) || ''; if (/favicon\.ico|\/work\/|\/api\/save|pose-fit\.mjs/.test(u + ' ' + m.text())) return; bucket.push('console: ' + m.text() + ' ' + u); });
};
// the tab's markup is pasted into animation_app.html by the lead; until then the test adds an empty section and a tab button
async function openPose(pg) {
  await pg.waitForFunction(() => typeof Store !== 'undefined' && typeof FigureTab !== 'undefined');
  await pg.evaluate(() => {
    let sec = document.getElementById('mode-pose');
    if (!sec) { sec = document.createElement('section'); sec.className = 'mode'; sec.id = 'mode-pose'; document.querySelector('#mode-figure').after(sec); }
    let b = document.querySelector('#tabs .tab[data-mode="pose"]');
    if (!b) { b = document.createElement('button'); b.className = 'tab'; b.dataset.mode = 'pose'; b.textContent = 'Pose match'; document.querySelector('#tabs').appendChild(b);
      b.onclick = () => { $$('#tabs .tab').forEach(x => x.classList.toggle('on', x === b)); $$('.mode').forEach(m => m.classList.toggle('on', m === sec)); window.dispatchEvent(new Event('resize')); }; }
  });
  await pg.click('#tabs .tab[data-mode="pose"]');
  await pg.evaluate(async () => { if (!window.PoseTab) { const m = await import('/app/js/pose-tab.mjs'); await m.start(document.getElementById('mode-pose')); } });
  await pg.waitForFunction(() => window.PoseTab && window.Fig3D && Fig3D.F && Fig3D.F.kind, { timeout: 120000 });
}
async function newPage(fake) {
  const errs = [], pg = await browser.newPage(); await pg.setViewport({ width: 1700, height: 980 }); watch(pg, errs);
  const client = await pg.createCDPSession(); await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
  if (fake) { await pg.setRequestInterception(true); pg.on('request', r => { if (/\/app\/js\/pose-fit\.mjs(\?|$)/.test(r.url())) r.respond({ status: 200, contentType: 'text/javascript', body: FAKE }); else r.continue(); }); }
  await pg.goto(URL); return { pg, errs };
}
const waitFile = async (p, ms = 15000) => { for (let t = 0; t < ms; t += 200) { if (fs.existsSync(p) && fs.statSync(p).size > 0) { await sleep(150); return true; } await sleep(200); } return false; };
const near = (a, b, tol) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;

// ================================================================ pass 1: the tab, with the stand-in solver
const { pg: page, errs: errors } = await newPage(true);
const ev = (fn, ...a) => page.evaluate(fn, ...a);
const guard = async (name, fn) => { try { await fn(); } catch (e) { check(name + ' (crashed)', false, String(e && e.message || e).slice(0, 300)); } };
await openPose(page);
check('the tab starts and the 3D figure loads', true);
const pose0 = await ev(() => JSON.stringify(Fig3D.getPose()));

await (await page.$('#pmFile')).uploadFile(board);
await page.waitForFunction(() => PoseTab.cur() && PoseTab.cur().name === '_test_pose_board.png', { timeout: 20000 });
await sleep(300);

await guard('the guess', async () => {
  const r = await ev(() => { const it = PoseTab.cur(); return { W: it.W, H: it.H, ink: it.ink, j: it.j }; });
  check('opens at the drawing\'s own size', r.W === 3840 && r.H === 1920, r.W + 'x' + r.H);
  check('ink box finds the figure, not the panel border or the doodle', r.ink.found && Math.abs(r.ink.y - 265) < 30 && Math.abs(r.ink.y + r.ink.h - 1687) < 40 && r.ink.x > 1600 && r.ink.x + r.ink.w < 2500, JSON.stringify(r.ink).slice(0, 120));
  const vis = Object.entries(r.j).filter(([, q]) => !q.hidden);
  check('16 joints guessed and shown, toes start off', vis.length === 16 && r.j.toe_l.hidden && r.j.toe_r.hidden, 'visible ' + vis.length);
  check('every guess is marked as the app\'s', Object.values(r.j).every(q => q.by === 'app'));
  const J = r.j;
  check('guess stands upright: head, neck, hips, knees, ankles top to bottom', J.head.y < J.neck.y && J.neck.y < J.chest.y && J.chest.y < J.pelvis.y && J.pelvis.y < J.knee_l.y && J.knee_l.y < J.ankle_l.y);
  check('guess faces the viewer: its left shoulder is on the picture\'s right', J.shoulder_l.x > J.shoulder_r.x && J.hip_l.x > J.hip_r.x && J.wrist_l.x > J.wrist_r.x);
  check('guess spans the ink: head near the top, ankles near the bottom', Math.abs(J.head.y - 360) < 120 && Math.abs(J.ankle_l.y - 1610) < 120, 'head ' + Math.round(J.head.y) + ', ankle ' + Math.round(J.ankle_l.y));
});
await page.screenshot({ path: path.join(out, 'pose_1_guess.png') });

await guard('dragging a joint with the mouse', async () => {
  const from = await ev(() => { const q = PoseTab.cur().j.wrist_l; return PoseTab.screenOf(q.x, q.y); });
  const to = await ev(() => PoseTab.screenOf(2440, 330));
  await page.mouse.move(from[0], from[1]); await page.mouse.down(); await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 4 }); await page.mouse.move(to[0], to[1], { steps: 4 }); await page.mouse.up();
  const q = await ev(() => PoseTab.cur().j.wrist_l), s = await ev(() => PoseTab.UI.view.s);
  check('dragged joint lands where it was let go', near([q.x, q.y], [2440, 330], 2 / s + 1), Math.round(q.x) + ',' + Math.round(q.y));
  check('dragged joint is now marked as yours', q.by === 'you' && !q.hidden);
  await page.waitForFunction(() => (window.__fitCalls || []).length >= 1, { timeout: 15000 }).catch(() => {});
  check('letting go of a joint fits again (the option is on by default)', (await ev(() => (window.__fitCalls || []).length)) >= 1);
});

await guard('hiding a joint and flipping a limb', async () => {
  await ev(T => { for (const n in T) if (!/^toe|wrist_l|elbow_r/.test(n)) PoseTab.setJoint(n, T[n][0], T[n][1]); }, TRUE);
  const p = await ev(() => { const q = PoseTab.cur().j.elbow_r; return PoseTab.screenOf(q.x, q.y); });
  await page.mouse.click(p[0], p[1]);
  check('clicking a joint selects it', (await ev(() => PoseTab.UI.sel)) === 'elbow_r');
  await page.click('#pmHidden');
  check('"This joint is hidden" hides the selected joint', await ev(() => PoseTab.cur().j.elbow_r.hidden));
  await page.click('[data-pmflip="arm_l"]');
  check('flip button switches that limb', await ev(() => PoseTab.cur().flips.arm_l === true));
});

await guard('fitting', async () => {
  const n0 = await ev(() => (window.__fitCalls || []).length);
  await page.waitForFunction(() => !PoseTab.UI.fitting, { timeout: 15000 });
  await page.click('#pmFit');
  await page.waitForFunction(n => (window.__fitCalls || []).length > n && !PoseTab.UI.fitting && PoseTab.cur().ghost, { timeout: 20000 }, n0);
  const c = await ev(() => window.__fitCalls[window.__fitCalls.length - 1]);
  check('fit gets the drawing size', c.W === 3840 && c.H === 1920);
  check('fit gets joints in drawing pixels', near(c.joints.wrist_l, [2440, 330], 8) && near(c.joints.knee_r, TRUE.knee_r, 0.2), JSON.stringify(c.joints.wrist_l));
  check('a hidden joint goes to the fit as null, toes too', c.joints.elbow_r === null && c.joints.toe_l === null && c.joints.toe_r === null);
  check('fit gets the flips and no camera by default', c.flips.arm_l === true && c.camera === null, JSON.stringify({ f: c.flips, cam: c.camera }));
  const conf = await page.$eval('#pmConf', e => e.textContent), notes = await page.$eval('#pmNotes', e => e.textContent);
  check('confidence shown in plain words', /Rough match/.test(conf) && /72% sure/.test(conf), conf);
  check('the biggest miss is named with its size', /Wrist \(its left\) 60 px/.test(notes), notes.slice(0, 120));
  check('the solver\'s own notes are shown', /Test fit, not the real solver/.test(notes));
  check('the fitted depth shows beside the flip', /now going away/.test(await page.$eval('#pmFlips', e => e.textContent)));
  const after = await ev(() => JSON.stringify(Fig3D.getPose())), ghostPose = await ev(() => JSON.stringify(window.__ghostPose));
  check('her Figure 3D pose is exactly as it was after the fit', after === pose0);
  check('the ghost was drawn with the fitted pose on the figure', ghostPose !== pose0 && /lowerarm/.test(ghostPose));
  const g = await ev(() => { const it = PoseTab.cur(); return [it.ghost.width, it.ghost.height]; });
  check('the ghost is the drawing\'s exact size', g[0] === 3840 && g[1] === 1920, g.join('x'));
});
await sleep(200); await page.screenshot({ path: path.join(out, 'pose_2_fit.png') });

// a pixel of the stage canvas under a drawing point
const px = (x, y) => ev((x, y) => { const c = document.querySelector('#pmView'), r = c.getBoundingClientRect(), d = window.devicePixelRatio || 1, p = PoseTab.screenOf(x, y);
  return [...c.getContext('2d').getImageData(Math.round((p[0] - r.left) * d), Math.round((p[1] - r.top) * d), 1, 1).data]; }, x, y);
const setLayer = (name, patch) => ev((name, patch) => { Object.assign(PoseTab.S.lay[name], patch); PoseTab.draw(); }, name, patch);
const diff = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

await guard('layers', async () => {
  const spot = [1960, 960];                      // inside the ghost disc around the hips, off the drawn lines
  const withG = await px(...spot); await setLayer('ghost', { on: false }); const noG = await px(...spot);
  check('the ghost layer shows on the drawing', diff(withG, noG) > 30, JSON.stringify([withG, noG]));
  await setLayer('ghost', { on: true, op: 0 }); const op0 = await px(...spot);
  check('ghost opacity 0 shows the drawing alone', diff(op0, noG) < 4);
  await setLayer('ghost', { op: 60 });
  const slider = await page.$$('#pmLayers .lrow input[type=range]');
  await slider[1].evaluate(el => { el.value = 20; el.dispatchEvent(new Event('input')); });
  check('the opacity slider in the layer list drives the ghost', (await ev(() => PoseTab.S.lay.ghost.op)) === 20);
  await slider[1].evaluate(el => { el.value = 60; el.dispatchEvent(new Event('input')); });
});

await guard('before / after', async () => {
  await setLayer('skel', { on: true });
  const spot = [1960, 960], on = await px(...spot);
  await page.click('#pmBA');
  await ev(() => { const st = document.querySelector('#pmStage').getBoundingClientRect(); PoseTab.UI.ba.x = st.width - 4; PoseTab.UI.ba.place(); PoseTab.draw(); });
  const before = await px(...spot);
  await ev(() => { for (const k of ['ghost', 'skel', 'miss']) PoseTab.S.lay[k].on = false; PoseTab.UI.ba.on = false; PoseTab.draw(); });
  const plain = await px(...spot);
  check('left of the before / after handle the drawing is untouched', diff(before, plain) < 4 && diff(on, plain) > 30, JSON.stringify([on, before, plain]));
  await ev(() => { for (const k of ['ghost', 'skel', 'miss']) PoseTab.S.lay[k].on = true; PoseTab.draw(); });
  await page.click('#pmBA');
});

await guard('exports', async () => {
  await page.click('#pmExportGhost');
  const gp = path.join(dl, '_test_pose_board_pose_ghost.png');
  check('ghost export downloads', await waitFile(gp));
  if (fs.existsSync(gp)) { const i = pngInfo(gp, [[5, 5], [1900, 900]]); check('ghost export is 3840 x 1920 with see-through background', i.w === 3840 && i.h === 1920 && i.mode === 'RGBA' && i.alpha[0] === 0 && i.alpha[1] > 0, JSON.stringify(i)); }
  const rows = await page.$$('#pmLayers .lrow');
  const ex = await rows[2].$('.lexp'); await ex.click();
  const jp = path.join(dl, '_test_pose_board_pose_joints.png');
  check('joints layer export downloads', await waitFile(jp));
  if (fs.existsSync(jp)) { const i = pngInfo(jp, [[5, 5], [1900, 900]]); check('joints layer is 3840 x 1920 and see-through away from the joints', i.w === 3840 && i.h === 1920 && i.alpha[0] === 0 && i.alpha[1] > 0, JSON.stringify(i)); }
  check('the drawing has no export button (it is her original)', (await rows[0].$('.lexp')) === null);
});

await guard('copies are new versions', async () => {
  await page.click('#pmCopy'); await sleep(600); await page.click('#pmCopy'); await sleep(600);
  const d = path.join(work, '_test_pose_board');
  check('two copies, v1 and v2, both kept', fs.existsSync(path.join(d, '_test_pose_board_ghost_v1.png')) && fs.existsSync(path.join(d, '_test_pose_board_ghost_v2.png')), fs.existsSync(d) ? fs.readdirSync(d).join(', ') : 'no folder');
  check('her original file is unchanged', sha(board) === boardSha);
});

await guard('the shot file', async () => {
  await sleep(900);
  const p = path.join(work, '_test_pose_board', 'shot.json');
  check('shot.json is written', fs.existsSync(p));
  if (!fs.existsSync(p)) return;
  const s = JSON.parse(fs.readFileSync(p, 'utf8')), d = s.detections && s.detections.pose && s.detections.pose.drawings['_test_pose_board.png'];
  check('joints saved under detections.pose with who placed them', d && d.joints.wrist_l.by === 'you' && d.joints.head.by === 'you' && d.joints.toe_l.by === 'app', d ? JSON.stringify(d.joints.wrist_l) : 'missing');
  check('hidden joint and flips saved', d && d.joints.elbow_r.hidden === true && d.flips.arm_l === true);
  check('fit result saved (confidence, pose)', d && d.fit && d.fit.confidence === 0.72 && d.fit.pose && d.fit.pose.kind === 'animtk-figure-pose');
  check('vector layers saved for scripts and other tabs', (s.layers || []).some(L => L.id === 'pose-joints:_test_pose_board.png' && L.items.length > 10) && (s.layers || []).some(L => L.id === 'pose-miss:_test_pose_board.png'));
  check('a read-only copy of the original is kept in source/', fs.existsSync(path.join(work, '_test_pose_board', 'source', '_test_pose_board.png')));
});

await guard('send the pose to Figure 3D', async () => {
  await page.click('#pmSend'); await sleep(300);
  const r = await ev(() => ({ on: document.querySelector('#mode-figure').classList.contains('on'), pose: JSON.stringify(Fig3D.getPose()), fit: JSON.stringify(PoseTab.cur().fit.pose) }));
  check('Send this pose to Figure 3D switches tabs and applies the pose', r.on && r.pose !== pose0 && JSON.parse(r.pose).bones.lowerarm_l.join() === JSON.parse(r.fit).bones.lowerarm_l.join());
  await page.screenshot({ path: path.join(out, 'pose_3_sent.png') });
  await page.click('#tabs .tab[data-mode="pose"]'); await sleep(200);
});

await guard('a transparent PNG and the box tool', async () => {
  await (await page.$('#pmFile')).uploadFile(clear);
  await page.waitForFunction(() => PoseTab.cur() && PoseTab.cur().name === '_test_pose_clear.png', { timeout: 20000 });
  const r = await ev(() => { const it = PoseTab.cur(); return { ink: it.ink, n: PoseTab.S.items.length }; });
  check('both drawings are in the list', r.n === 2 && (await page.$$('#pmList .pitem')).length === 2);
  check('ink on a transparent PNG is found by its alpha', r.ink.found && r.ink.y < 200 && r.ink.y + r.ink.h > 1250, JSON.stringify(r.ink).slice(0, 100));
  await ev(() => PoseTab.setJoint('head', 520, 240));
  await page.click('#pmBox');
  const a = await ev(() => PoseTab.screenOf(100, 300)), b = await ev(() => PoseTab.screenOf(600, 1300));
  await page.mouse.move(a[0], a[1]); await page.mouse.down(); await page.mouse.move(b[0], b[1], { steps: 6 }); await page.mouse.up();
  const j = await ev(() => PoseTab.cur().j);
  check('box tool moves the guessed joints into the box', j.ankle_l.y > 1150 && j.ankle_l.y < 1310 && j.neck.y > 300 && j.neck.y < 600 && j.pelvis.x > 300 && j.pelvis.x < 400, JSON.stringify({ a: j.ankle_l, n: j.neck, p: j.pelvis }).slice(0, 160));
  check('box tool leaves your joints alone', j.head.x === 520 && j.head.y === 240 && j.head.by === 'you');
  await page.keyboard.down('Control'); await page.keyboard.press('KeyZ'); await page.keyboard.up('Control');
  check('Ctrl+Z undoes the box', Math.abs((await ev(() => PoseTab.cur().j.neck.y)) - j.neck.y) > 20);
  check('the transparent original is unchanged', sha(clear) === clearSha);
});

await guard('no dashes', async () => {
  const src = fs.readFileSync(path.join(root, 'app', 'js', 'pose-tab.mjs'), 'utf8'), txt = await ev(() => document.getElementById('mode-pose').innerText);
  check('no em or en dashes in the tab\'s code or its text', !/[\u2013\u2014]/.test(src) && !/[\u2013\u2014]/.test(txt));
});
check('no script errors (stand-in pass)', errors.length === 0, errors.slice(0, 4).join(' | '));
await page.close();

// ================================================================ pass 2: her joints come back on the next visit
await guard('coming back later', async () => {
  const { pg, errs } = await newPage(true);
  await openPose(pg);
  await (await pg.$('#pmFile')).uploadFile(board);
  await pg.waitForFunction(() => PoseTab.cur() && PoseTab.cur().name === '_test_pose_board.png', { timeout: 20000 });
  await pg.waitForFunction(() => (window.__fitCalls || []).length >= 1 && PoseTab.cur().ghost, { timeout: 20000 }).catch(() => {});
  const r = await pg.evaluate(() => { const it = PoseTab.cur(); return { w: it.j.wrist_l, e: it.j.elbow_r, f: it.flips, calls: (window.__fitCalls || []).length, ghost: !!it.ghost }; });
  check('her joints come back from the shot file', r.w.by === 'you' && near([r.w.x, r.w.y], [2440, 330], 8) && r.e.hidden === true && r.f.arm_l === true, JSON.stringify(r).slice(0, 160));
  check('a drawing fitted before is fitted again on open', r.calls >= 1 && r.ghost);
  check('no script errors (second visit)', errs.length === 0, errs.slice(0, 3).join(' | '));
  await pg.close();
});

// ================================================================ pass 3: the real solver, if it is there yet
if (fs.existsSync(path.join(root, 'app', 'js', 'pose-fit.mjs'))) {
  await guard('the real pose-fit.mjs', async () => {
    cleanWork();
    const { pg, errs } = await newPage(false);
    await openPose(pg);
    const keep = await pg.evaluate(() => JSON.stringify(Fig3D.getPose()));
    await (await pg.$('#pmFile')).uploadFile(board);
    await pg.waitForFunction(() => PoseTab.cur() && PoseTab.cur().name === '_test_pose_board.png', { timeout: 20000 });
    await pg.evaluate(T => { for (const n in T) PoseTab.setJoint(n, T[n][0], T[n][1]); }, TRUE);
    const t0 = Date.now(); const res = await pg.evaluate(async () => { const f = await PoseTab.fit(); return f ? { kind: f.pose && f.pose.kind, cam: f.camera && ['pos', 'right', 'up', 'back', 'theta'].every(k => k in f.camera), conf: f.confidence, error: f.error, notes: f.notes, place: f.place } : null; });
    const ms = Date.now() - t0;
    check('real fit returns the agreed shape', res && res.kind === 'animtk-figure-pose' && res.cam && res.conf >= 0 && res.conf <= 1 && res.error && Array.isArray(res.notes), JSON.stringify(res || {}).slice(0, 200));
    if (res && res.error) {
      const e = Object.entries(res.error).filter(([, v]) => isFinite(v)).sort((a, b) => b[1] - a[1]), med = e.map(x => x[1]).sort((a, b) => a - b)[Math.floor(e.length / 2)];
      console.log('INFO  real fit took ' + ms + ' ms, ' + Math.round(res.conf * 100) + '% sure, median miss ' + Math.round(med) + ' px of a 1420 px tall figure; worst: ' + e.slice(0, 4).map(([n, v]) => n + ' ' + Math.round(v)).join(', '));
      check('real fit lands most joints close (median miss under 4% of the figure\'s height)', med < 0.04 * 1420, 'median ' + Math.round(med) + ' px');
    }
    const g = await pg.evaluate(() => { const it = PoseTab.cur(); if (!it.ghost) return null; const d = it.ghost.getContext('2d').getImageData(0, 0, it.W, it.H).data; let n = 0; for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 20) n++; return { w: it.ghost.width, h: it.ghost.height, ink: n }; });
    check('real ghost is the drawing\'s size and has a figure in it', g && g.w === 3840 && g.h === 1920 && g.ink > 50, JSON.stringify(g));
    check('her Figure 3D pose is unchanged after a real fit', (await pg.evaluate(() => JSON.stringify(Fig3D.getPose()))) === keep);
    await sleep(200); await pg.screenshot({ path: path.join(out, 'pose_4_real.png') });
    check('no script errors (real solver)', errs.length === 0, errs.slice(0, 3).join(' | '));
    await pg.close();
  });

  // ================================================================ pass 4: round trip with a known answer
  // The real figure reaches its left hand at the camera. Its joints are photographed through a known camera (front on,
  // then from 50 degrees round), and only those 2D dots go to the fit. It must find the pose, say the arm comes toward
  // the camera, turn it away when flipped, and honour a camera height wish.
  await guard('round trip through a known camera', async () => {
    const { pg, errs } = await newPage(false);
    await openPose(pg);
    const r = await pg.evaluate(async () => {
      const PF = await import('/app/js/pose-fit.mjs'), F = Fig3D, T = F.THREE, W = 3840, H = 1920, f = (W / 2) / Math.tan(17.5 * Math.PI / 180);
      F.standing();
      const fwd = Math.sign(F.wpos('ball_l').z - F.wpos('foot_l').z) || 1, sh = F.wpos('upperarm_l');
      F.reach('hand_l', sh.clone().add(new T.Vector3(0.05, -0.08, 0.52 * fwd)));
      const truePose = F.getPose(), P = F.wpos('pelvis'), out = [];
      for (const deg of [0, 50]) {
        F.setPose(truePose);
        const a = deg * Math.PI / 180, C = new T.Vector3(P.x + 4 * fwd * Math.sin(a), 1.2, P.z + 4 * fwd * Math.cos(a));
        const back = C.clone().sub(P).normalize(), right = new T.Vector3(0, 1, 0).cross(back).normalize(), up = back.clone().cross(right);
        const cam = { pos: C.toArray(), right: right.toArray(), up: up.toArray(), back: back.toArray(), center: [W / 2, H / 2], f };
        const joints = PF.projectJoints(F, { pose: truePose, camera: cam }), J = {};
        for (const n in joints) J[n] = /^toe/.test(n) ? null : joints[n];
        const fit = PF.fitPose(F, { joints: J, W, H, camera: null, flips: {} });
        const flip = PF.fitPose(F, { joints: J, W, H, camera: null, flips: { arm_l: true } });
        const tall = PF.fitPose(F, { joints: J, W, H, camera: { height: 1.2 }, flips: {} });
        const ys = Object.values(J).filter(Boolean).map(p => p[1]), figPx = Math.max(...ys) - Math.min(...ys);
        const errs = Object.values(fit.error).sort((x, y) => x - y), med = errs[Math.floor(errs.length / 2)];
        const fb = new T.Vector3(...fit.camera.back), view = Math.acos(Math.max(-1, Math.min(1, fb.dot(back)))) * 180 / Math.PI;
        out.push({ deg, med, rel: med / figPx, depth: fit.depth.arm_l, flipDepth: flip.depth.arm_l, camY: tall.camera.pos[1], view, conf: fit.confidence });
      }
      return out;
    });
    for (const v of r) {
      console.log('INFO  view ' + v.deg + ' deg: median miss ' + v.med.toFixed(1) + ' px (' + (v.rel * 100).toFixed(1) + '% of the figure), camera direction off by ' + v.view.toFixed(1) + ' deg, ' + Math.round(v.conf * 100) + '% sure');
      check('round trip ' + v.deg + ' deg: joints land within 2% of the figure height', v.rel < 0.02, (v.rel * 100).toFixed(2) + '%');
      check('round trip ' + v.deg + ' deg: the camera is found looking the right way (within 15 deg)', v.view < 15, v.view.toFixed(1) + ' deg');
      check('round trip ' + v.deg + ' deg: the reaching arm reads as coming toward the camera', v.depth === 'toward', v.depth);
      check('round trip ' + v.deg + ' deg: flipping that arm sends it away', v.flipDepth === 'away', v.flipDepth);
      check('round trip ' + v.deg + ' deg: a camera height wish of 1.2 m is honoured (within 0.35 m)', Math.abs(v.camY - 1.2) < 0.35, v.camY.toFixed(2) + ' m');
    }
    check('no script errors (round trip)', errs.length === 0, errs.slice(0, 3).join(' | '));
    await pg.close();
  });
} else console.log('SKIP  app/js/pose-fit.mjs is not there yet, so the real solver pass did not run');

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASSED');
await finish(fails ? 1 : 0);
