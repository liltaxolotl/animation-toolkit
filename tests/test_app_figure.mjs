// The Figure 3D tab: body and builds, joint angle conventions, IK, real mouse posing, limits, clips, pose files, pictures.
// The figure is the 3D reference an artist poses and draws over, so its joint math must be right and stay right.
// Needs no artwork: the figure ships with the app (app/assets/figures/human), everything else is generated here.
//   node tests/test_app_figure.mjs
// Needs puppeteer-core (npm i puppeteer-core, in _scratch/ is fine) and Chrome or Edge. It starts serve.py on a free port.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'tests', 'out'); fs.mkdirSync(out, { recursive: true });
const dl = path.join(out, 'figure_downloads'); fs.rmSync(dl, { recursive: true, force: true }); fs.mkdirSync(dl, { recursive: true });
let fails = 0;
const check = (name, ok, detail) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ' + detail : '')); if (!ok) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const f2 = v => (typeof v === 'number' ? v.toFixed(3) : String(v));
const t0 = Date.now();

let puppeteer;
for (const base of [root, path.join(root, '_scratch'), process.cwd()]) { try { puppeteer = createRequire(path.join(base, 'x.js'))('puppeteer-core'); break; } catch (e) {} }
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
if (!puppeteer || !chrome) { console.log('FAIL  cannot run: ' + (!puppeteer ? 'puppeteer-core is not installed' : 'no Chrome or Edge found')); process.exit(1); }

const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const port = await freePort();
const server = spawn('python', ['-P', path.join(root, 'serve.py'), '--port', String(port), '--no-open'], { cwd: root, stdio: 'ignore' });
let browser;
const finish = async code => { try { if (browser) await browser.close(); } catch (e) {} try { server.kill(); } catch (e) {} await sleep(300); process.exit(code); };
process.on('uncaughtException', async e => { console.log('FAIL  the test itself crashed: ' + (e && e.stack || e)); await finish(1); });
process.on('unhandledRejection', async e => { console.log('FAIL  the test itself crashed: ' + (e && e.stack || e)); await finish(1); });
for (let i = 0; i < 50; i++) { try { const r = await fetch('http://127.0.0.1:' + port + '/api/ping'); if (r.ok) break; } catch (e) {} await sleep(200); }
const URL = 'http://127.0.0.1:' + port + '/animation_app.html';

browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1700,980', '--autoplay-policy=no-user-gesture-required'] });

// error watcher used by both pages
const watch = (pg, bucket) => {
  pg.on('pageerror', e => bucket.push('pageerror: ' + e.message));
  pg.on('console', m => {
    if (m.type() !== 'error') return;
    const u = (m.location() && m.location().url) || '';
    if (/favicon\.ico/.test(u) || /\/work\//.test(u) || /\/api\/save/.test(u)) return;
    bucket.push('console: ' + m.text() + ' ' + u);
  });
};

// ================================================================ 1a: file:// shows the note
{
  const errs = [];
  const p0 = await browser.newPage(); await p0.setViewport({ width: 1700, height: 980 }); watch(p0, errs);
  await p0.goto(pathToFileURL(path.join(root, 'animation_app.html')).href);
  await p0.waitForSelector('[data-mode="figure"]'); await p0.click('[data-mode="figure"]'); await sleep(500);
  const r = await p0.evaluate(() => { const o = document.querySelector('#fOff'); return { disp: getComputedStyle(o).display, text: o.textContent, fig: !!window.Fig3D }; });
  check('file://: #fOff shows the "needs the toolkit shortcut" note', r.disp !== 'none' && /needs the toolkit shortcut/.test(r.text) && !r.fig, JSON.stringify({ disp: r.disp, fig: r.fig, text: r.text.slice(0, 60) }));
  check('file://: no script errors', errs.length === 0, errs.join(' | '));
  await p0.close();
}

// ================================================================ 1b: through the server
const errors = [];
const page = await browser.newPage(); await page.setViewport({ width: 1700, height: 980 }); watch(page, errors);
const client = await page.createCDPSession(); await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
await page.goto(URL); await page.waitForSelector('[data-mode="figure"]');
await page.click('[data-mode="figure"]');
try { await page.waitForFunction('window.Fig3D && Fig3D.F && Fig3D.F.kind', { timeout: 90000 }); check('server: the Figure 3D tab loads and window.Fig3D appears', true); }
catch (e) { check('server: the Figure 3D tab loads and window.Fig3D appears', false, await page.$eval('#fOff', o => o.textContent).catch(() => '')); console.log('cannot continue'); await finish(1); }
const ev = (fn, ...a) => page.evaluate(fn, ...a);
const guard = async (name, fn) => { try { await fn(); } catch (e) { check(name + ' (crashed)', false, String(e && e.message || e).slice(0, 300)); } };
const waitFile = async name => { for (let i = 0; i < 80; i++) { if (fs.existsSync(path.join(dl, name))) { await sleep(200); return true; } await sleep(100); } return false; };
const wp = n => ev(n => Fig3D.wpos(n).toArray(), n);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = v => Math.hypot(v[0], v[1], v[2]);
// the lowest point of the figure from the SKINNED vertices, in the world (m)
const lowest = () => ev(() => {
  const F = Fig3D.F, T = Fig3D.THREE; F.root.updateMatrixWorld(true); let lo = Infinity; const v = new T.Vector3();
  for (const m of F.meshes) { m.skeleton.update(); const P = m.geometry.attributes.position; for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i); m.applyBoneTransform(i, v); v.applyMatrix4(m.matrixWorld); if (v.y < lo) lo = v.y; } }
  return lo;
});
await ev(() => { Fig3D.S.limits = true; Fig3D.standing(); });

// ================================================================ 2: body, builds, floor
await guard('body', async () => {
  const hm = await ev(() => Fig3D.heads());
  check('man is about 1.83 m tall', Math.abs(hm.height - 1.83) < 0.04, f2(hm.height) + ' m');
  check('man is between 6.4 and 7.4 heads tall', hm.count >= 6.4 && hm.count <= 7.4, f2(hm.count) + ' heads');
  const lm = await lowest(); check('man stands on the floor (lowest skinned vertex within 1 cm of y = 0)', Math.abs(lm) < 0.01, 'lowest y = ' + f2(lm));
  await page.click('[data-fbody="woman"]');
  await page.waitForFunction("Fig3D.S.body === 'woman' && Fig3D.F.kind === 'woman'", { timeout: 60000 });
  const hw = await ev(() => Fig3D.heads()), lw = await lowest();
  check('woman loads via [data-fbody="woman"] with a plausible height and head count', hw.height > 1.5 && hw.height < 1.95 && hw.count >= 6 && hw.count <= 7.6, f2(hw.height) + ' m, ' + f2(hw.count) + ' heads');
  check('woman stands on the floor', Math.abs(lw) < 0.01, 'lowest y = ' + f2(lw));
  await page.click('[data-fbody="man"]'); await page.waitForFunction("Fig3D.S.body === 'man'", { timeout: 60000 });
  await ev(() => Fig3D.standing());
  const H = {}, floors = {};
  for (const b of ['average', 'heavier', 'thinner', 'teen', 'kid']) { await ev(b => Fig3D.setBuild(b, 0), b); H[b] = (await ev(() => Fig3D.heads())).height; floors[b] = await lowest(); }
  check('kid is shorter than teen, teen shorter than average', H.kid < H.teen && H.teen < H.average, ['kid', 'teen', 'average'].map(k => k + ' ' + f2(H[k])).join(', '));
  check('heavier and thinner are the same height within 2%', Math.abs(H.heavier - H.thinner) / H.average < 0.02, 'heavier ' + f2(H.heavier) + ' thinner ' + f2(H.thinner));
  await ev(() => Fig3D.setBuild('average', 0));
  const C = {}; for (const c of [0, 0.5, 1]) { await ev(c => Fig3D.setBuild('average', c), c); C[c] = (await ev(() => Fig3D.heads())).count; floors['cartoon' + c] = await lowest(); }
  check('cartoon 1.0 has fewer heads than 0.5, which has fewer than 0', C[1] < C[0.5] && C[0.5] < C[0], 'heads ' + f2(C[0]) + ' / ' + f2(C[0.5]) + ' / ' + f2(C[1]));
  const bad = Object.entries(floors).filter(([, y]) => Math.abs(y) >= 0.01);
  check('after every build change the lowest point sits on the floor (within 1 cm)', bad.length === 0, bad.length ? bad.map(([k, y]) => k + ' ' + f2(y)).join(', ') : Object.entries(floors).map(([k, y]) => k + ' ' + (y * 100).toFixed(2) + 'cm').join(', '));
  // the build select in the UI goes through the same path
  await page.select('#fBuild', 'kid'); await sleep(200);
  const hk = await ev(() => Fig3D.S.build); check('the Build dropdown changes the build', hk === 'kid', hk);
  await page.select('#fBuild', 'average'); await ev(() => Fig3D.setBuild('average', 0)); await sleep(100);
});

// ================================================================ 3: angle conventions
await guard('angles', async () => {
  const cases = [
    // name, bone, vals, from, to, test on d = to - from, description
    ['upperarm_l x 90: elbow in front (+Z)', 'upperarm_l', { x: 90 }, 'upperarm_l', 'lowerarm_l', d => d[2] > 0.8 * len(d)],
    ['upperarm_l z 90: elbow out to its left (+X)', 'upperarm_l', { z: 90 }, 'upperarm_l', 'lowerarm_l', d => d[0] > 0.8 * len(d)],
    ['upperarm_r x 90: elbow in front (+Z)', 'upperarm_r', { x: 90 }, 'upperarm_r', 'lowerarm_r', d => d[2] > 0.8 * len(d)],
    ['upperarm_r z 90: elbow out to its right (-X)', 'upperarm_r', { z: 90 }, 'upperarm_r', 'lowerarm_r', d => d[0] < -0.8 * len(d)],
    ['thigh_l x 90: knee forward (+Z)', 'thigh_l', { x: 90 }, 'thigh_l', 'calf_l', d => d[2] > 0.8 * len(d)],
    ['thigh_r x 90: knee forward (+Z)', 'thigh_r', { x: 90 }, 'thigh_r', 'calf_r', d => d[2] > 0.8 * len(d)],
    ['calf_l x 90: ankle behind the knee (-Z)', 'calf_l', { x: 90 }, 'calf_l', 'foot_l', d => d[2] < -0.7 * len(d)],
    ['calf_r x 90: ankle behind the knee (-Z)', 'calf_r', { x: 90 }, 'calf_r', 'foot_r', d => d[2] < -0.7 * len(d)],
    ['lowerarm_l y 90: wrist in front of the elbow (+Z)', 'lowerarm_l', { y: 90 }, 'lowerarm_l', 'hand_l', d => d[2] > 0.7 * len(d)],
    ['lowerarm_r y 90: wrist in front of the elbow (+Z)', 'lowerarm_r', { y: 90 }, 'lowerarm_r', 'hand_r', d => d[2] > 0.7 * len(d)]
  ];
  for (const [name, bone, vals, a, b, test] of cases) {
    await ev(() => Fig3D.standing());
    await ev((bone, vals) => Fig3D.setAngles(bone, vals, false), bone, vals);
    const d = sub(await wp(b), await wp(a));
    const back = await ev((bone) => Fig3D.angles(bone), bone);
    const ax = Object.keys(vals)[0], got = back.find(x => x.axis === ax).value;
    check('angles: ' + name, test(d), 'dx,dy,dz = ' + d.map(f2).join(', '));
    check('angles: ' + bone + ' ' + ax + ' ' + vals[ax] + ' reads back within 0.5 deg', Math.abs(got - vals[ax]) < 0.5, 'read ' + got.toFixed(3));
  }
  await ev(() => Fig3D.standing());
  const n0 = await wp('neck_01');
  await ev(() => Fig3D.setAngles('spine_01', { x: 30 }, false));
  const n1 = await wp('neck_01'), gs = (await ev(() => Fig3D.angles('spine_01'))).find(x => x.axis === 'x').value;
  check('angles: spine_01 x 30 tips the neck forward (+Z, and a little lower)', n1[2] - n0[2] > 0.08 && n1[1] < n0[1], 'neck moved ' + sub(n1, n0).map(f2).join(', '));
  check('angles: spine_01 x 30 reads back within 0.5 deg', Math.abs(gs - 30) < 0.5, 'read ' + gs.toFixed(3));
  // a wider readback sweep on every posable joint axis, inside a modest range
  const bad = await ev(() => {
    const out = [];
    for (const n of Fig3D.POSABLE) { Fig3D.standing(); for (const a of Fig3D.angles(n)) { for (const v of [-10, 20, 40]) { if (v < a.min || v > a.max) continue; Fig3D.standing(); Fig3D.setAngles(n, { [a.axis]: v }, false); const r = Fig3D.angles(n).find(x => x.axis === a.axis).value; if (Math.abs(r - v) > 0.5) out.push(n + ' ' + a.axis + ' set ' + v + ' read ' + r.toFixed(2)); } } }
    Fig3D.standing(); return out;
  });
  check('angles: every posable joint axis reads back what was set (-10, 20, 40 inside its range) within 0.5 deg', bad.length === 0, bad.slice(0, 6).join('; ') + (bad.length > 6 ? ' (+' + (bad.length - 6) + ' more)' : ''));
});

// ================================================================ 4: IK
await guard('ik', async () => {
  await ev(() => Fig3D.standing());
  const s = await wp('upperarm_l'), m = await wp('lowerarm_l'), w = await wp('hand_l');
  const reachLen = len(sub(m, s)) + len(sub(w, m)), dir = [0.25, -0.35, 0.9], dl2 = len(dir);
  const target = s.map((v, i) => v + dir[i] / dl2 * reachLen * 0.8);
  await ev(t => Fig3D.reach('hand_l', new Fig3D.THREE.Vector3(...t)), target);
  const e1 = len(sub(await wp('hand_l'), target));
  check('IK: reach(hand_l, target) puts the wrist within 1 cm of a reachable target (limits on)', e1 < 0.01, (e1 * 1000).toFixed(2) + ' mm off');
  await ev(() => Fig3D.standing());
  const sr = await wp('upperarm_r'), tr = sr.map((v, i) => v + [-0.5, -0.2, 0.6][i] / len([-0.5, -0.2, 0.6]) * reachLen * 0.7);
  await ev(t => Fig3D.reach('hand_r', new Fig3D.THREE.Vector3(...t)), tr);
  const e2 = len(sub(await wp('hand_r'), tr));
  check('IK: the right wrist reaches a reachable target too', e2 < 0.01, (e2 * 1000).toFixed(2) + ' mm off');
  await ev(() => Fig3D.standing());
  const fl = await wp('foot_l'), fr = await wp('foot_r'), pv = await wp('pelvis');
  await ev(t => Fig3D.moveHips(new Fig3D.THREE.Vector3(...t), true), [pv[0], pv[1] - 0.15, pv[2]]);
  const pv2 = await wp('pelvis'), fl2 = await wp('foot_l'), fr2 = await wp('foot_r');
  const kl = (await ev(() => Fig3D.angles('calf_l')))[0].value, kr = (await ev(() => Fig3D.angles('calf_r')))[0].value;
  check('IK: moveHips down 15 cm lowers the pelvis by 15 cm', Math.abs((pv[1] - pv2[1]) - 0.15) < 0.005, 'dropped ' + f2(pv[1] - pv2[1]) + ' m');
  check('IK: moveHips(plant) keeps both ankles within 5 mm', len(sub(fl2, fl)) < 0.005 && len(sub(fr2, fr)) < 0.005, 'left ' + (len(sub(fl2, fl)) * 1000).toFixed(2) + ' mm, right ' + (len(sub(fr2, fr)) * 1000).toFixed(2) + ' mm');
  check('IK: both knees bend between 20 and 120 degrees', kl > 20 && kl < 120 && kr > 20 && kr < 120, 'left ' + kl.toFixed(1) + ', right ' + kr.toFixed(1));
  await ev(() => Fig3D.standing());
});

// ================================================================ 5: real mouse
const front = () => ev(() => { const c = Fig3D.controls; c.object.position.set(0.4, 1.4, 4.4); c.target.set(0, 1.0, 0); c.update(); Fig3D.render(); });
const dotAt = n => ev(n => { const p = Fig3D.proj(Fig3D.wpos(n)), rc = document.querySelector('#fOver').getBoundingClientRect(); return [rc.left + p[0], rc.top + p[1]]; }, n);
const dragTo = async (a, b, steps = 14) => { await page.mouse.move(a[0], a[1]); await page.mouse.down(); for (let i = 1; i <= steps; i++) await page.mouse.move(a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps); await page.mouse.up(); await sleep(150); };
await guard('mouse', async () => {
  await page.click('#fStand'); await front(); await sleep(150);
  const sh = await dotAt('upperarm_l'), hd = await dotAt('hand_l');
  const L = Math.hypot(hd[0] - sh[0], hd[1] - sh[1]), outward = Math.sign(hd[0] - sh[0]) || 1;
  const dst = [sh[0] + outward * 0.3 * L, sh[1] - 0.85 * L];
  await dragTo(hd, dst);
  const r = await ev(() => ({ sel: Fig3D.S.sel, sh: Fig3D.angles('upperarm_l'), over: Fig3D.overLimits(), lim: Fig3D.S.limits, hand: Fig3D.wpos('hand_l').toArray(), shoulder: Fig3D.wpos('upperarm_l').toArray() }));
  const side = r.sh.find(a => a.label === 'Raise to the side').value;
  check('mouse: dragging the left wrist dot selects the left hand', r.sel === 'hand_l', String(r.sel));
  check('mouse: dragging the wrist up and outward raises "Raise to the side" above 90 (limits on)', r.lim && side > 90, 'raise to the side = ' + side.toFixed(1) + ', wrist ' + f2(r.hand[1] - r.shoulder[1]) + ' m above the shoulder');
  check('mouse: no joint is reported past range after the wrist drag', r.over.length === 0, JSON.stringify(r.over));
  await page.screenshot({ path: path.join(out, 'app_figure_drag_wrist.png') });
  await page.click('#fStand'); await front(); await sleep(150);
  const fl = await wp('foot_l'), fr = await wp('foot_r'), hp = await dotAt('pelvis');
  await dragTo(hp, [hp[0], hp[1] + 90], 10);
  const fl2 = await wp('foot_l'), fr2 = await wp('foot_r'), pv = await ev(() => Fig3D.wpos('pelvis').y);
  const dpv = (await ev(() => Fig3D.F.pelvisY0)); void dpv;
  check('mouse: dragging the hips diamond down moved the hips', r.sel !== null && (await ev(() => Fig3D.S.sel)) === 'pelvis' && pv < 0.95, 'pelvis y = ' + f2(pv));
  check('mouse: dragging the hips down keeps both feet planted (within 5 mm)', len(sub(fl2, fl)) < 0.005 && len(sub(fr2, fr)) < 0.005, 'left ' + (len(sub(fl2, fl)) * 1000).toFixed(2) + ' mm, right ' + (len(sub(fr2, fr)) * 1000).toFixed(2) + ' mm');
  const over2 = await ev(() => Fig3D.overLimits()); check('mouse: no joint past range after the hips drag', over2.length === 0, JSON.stringify(over2));
  await page.screenshot({ path: path.join(out, 'app_figure_drag_hips.png') });
  await page.click('#fStand');
});

// ================================================================ 6: limits
await guard('limits', async () => {
  await page.click('#fStand');
  const ok0 = await ev(() => Fig3D.overLimits().length); check('limits: the standing pose has no joint past range', ok0 === 0, String(ok0));
  await page.click('#fLimits'); // off
  const off = await ev(() => Fig3D.S.limits); check('limits: the checkbox turns S.limits off', off === false, String(off));
  await ev(() => Fig3D.setAngles('lowerarm_r', { y: -40 }, false));
  const o = await ev(() => Fig3D.overLimits()), hit = o.find(x => x.bone === 'lowerarm_r');
  check('limits: overLimits() reports the right elbow bent 40 past', !!hit && /bend/i.test(hit.label) && Math.abs(hit.by - 40) <= 2, JSON.stringify(o));
  await sleep(400);
  const txt = await ev(() => document.querySelector('#fOverList').textContent);
  check('limits: #fOverList mentions the elbow and 40 degrees past', /Elbow/.test(txt) && /40/.test(txt) && /past/.test(txt), txt.slice(0, 120));
  await page.click('#fLimits'); await page.click('#fStand');
  check('limits: back on, setAngles clamps (elbow y -40 becomes bend 0)', await ev(() => { Fig3D.S.limits = true; Fig3D.setAngles('lowerarm_r', { y: -40 }); return Math.abs(Fig3D.angles('lowerarm_r')[0].value) < 1; }));
  await page.click('#fStand');
});

// ================================================================ 7: clips
await guard('clips', async () => {
  await page.click('[data-fclip="walk"]');
  await page.waitForFunction("Fig3D.S.clip && Fig3D.S.clip.id === 'walk'", { timeout: 60000 });
  await ev(() => Fig3D.pause());
  const info = await ev(() => ({ keys: Fig3D.S.clip.keys, n: Math.round(Fig3D.S.clip.dur * Fig3D.FPS), fps: Fig3D.FPS }));
  const kinds = new Set(info.keys.map(k => k.kind));
  check('clips: walk loads and S.clip.keys has contact, down, passing and up', ['contact', 'down', 'passing', 'up'].every(k => kinds.has(k)), [...kinds].join(',') + ' (' + info.keys.length + ' keys, ' + info.n + ' frames)');
  const heights = await ev(() => { const n = Math.round(Fig3D.S.clip.dur * Fig3D.FPS), y = []; for (let i = 0; i < n; i++) { Fig3D.seek(i / Fig3D.FPS); y.push(Fig3D.wpos('pelvis').y); } return y; });
  const minI = heights.indexOf(Math.min(...heights)), minFrame = minI + 1, n = info.n;
  const downs = info.keys.filter(k => k.kind === 'down').map(k => k.frame);
  const cyc = (a, b) => { const d = Math.abs(a - b) % n; return Math.min(d, n - d); };
  const dist = Math.min(...downs.map(d => cyc(d, minFrame)));
  check('clips: over a full cycle the lowest pelvis is within 2 frames of a "down" frame', downs.length > 0 && dist <= 2, 'lowest at frame ' + minFrame + ', down frames ' + downs.join(',') + ', off by ' + dist);
  // the timeline
  await ev(() => Fig3D.seek(0)); await sleep(200);
  const rc = await ev(() => { const r = document.querySelector('#fTime').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; });
  const frac = 0.6, expF = Math.round(frac * (n - 1)) + 1;
  await page.mouse.click(rc.l + 8 + frac * (rc.w - 16), rc.t + rc.h / 2); await sleep(300);
  const got = await ev(() => ({ f: Fig3D.frameOf(Fig3D.S.t), t: Fig3D.S.t, playing: Fig3D.S.playing }));
  check('clips: clicking the timeline canvas #fTime seeks (and pauses)', Math.abs(got.f - expF) <= 1 && !got.playing, 'asked for frame ' + expF + ', at ' + got.f);
  // freeze
  const before = await ev(() => Fig3D.getPose());
  await page.click('#fFreeze'); await sleep(250);
  const after = await ev(() => ({ pose: Fig3D.getPose(), clip: !!Fig3D.S.clip, froze: Fig3D.S.frozeFrom, lbl: document.querySelector('#fClipLbl').textContent }));
  let worst = 0; for (const k in before.bones) for (let i = 0; i < 4; i++) worst = Math.max(worst, Math.abs(before.bones[k][i] - after.pose.bones[k][i]));
  const pw = Math.max(...before.pelvis.map((v, i) => Math.abs(v - after.pose.pelvis[i])));
  check('clips: "Pose this frame" turns the frame into a still pose (no clip, label says still pose)', !after.clip && !!after.froze && /Still pose/.test(after.lbl), after.lbl);
  check('clips: the still pose keeps the same bone rotations (and hip position)', worst < 1e-5 && pw < 1e-5, 'max quaternion diff ' + worst.toExponential(2) + ', pelvis ' + pw.toExponential(2));
  // every clip
  const ids = await ev(() => Fig3D.CLIPS.flatMap(g => g[1].map(c => c[0])));
  const res = await ev(async ids => { const bad = []; for (const id of ids) { try { await Fig3D.playClip(id); const c = Fig3D.S.clip; if (!c || c.id !== id || !(c.dur > 0)) bad.push(id + ': no clip'); else { Fig3D.seek(c.dur * 0.5); const p = Fig3D.wpos('pelvis'); if (!isFinite(p.x + p.y + p.z)) bad.push(id + ': NaN pose'); } } catch (e) { bad.push(id + ': ' + (e && e.message || e)); } } Fig3D.stopClip(); Fig3D.standing(); return bad; }, ids);
  check('clips: every id in Fig3D.CLIPS loads and plays (' + ids.length + ' clips)', res.length === 0, res.join('; '));
  await ev(() => Fig3D.standing());
});

// ================================================================ 8: save and open a pose
await guard('pose file', async () => {
  await page.click('#fStand'); await sleep(200);
  const A = await ev(() => Fig3D.getPose());
  await page.click('#fSavePose');
  const got = await waitFile('figure_pose.json'); check('pose: Save pose downloads figure_pose.json', got);
  if (!got) return;
  const J = JSON.parse(fs.readFileSync(path.join(dl, 'figure_pose.json'), 'utf8'));
  check("pose: the file has kind 'animtk-figure-pose' and bone rotations", J.kind === 'animtk-figure-pose' && J.bones && Object.keys(J.bones).length > 20, J.kind + ', ' + Object.keys(J.bones || {}).length + ' bones');
  await ev(() => { Fig3D.S.limits = true; Fig3D.setAngles('spine_02', { x: 25 }); Fig3D.setAngles('thigh_l', { x: 70 }); Fig3D.setAngles('upperarm_r', { z: 100 }); Fig3D.moveHips(Fig3D.wpos('pelvis').add(new Fig3D.THREE.Vector3(0, -0.1, 0.05)), false); });
  const moved = await ev(() => Fig3D.getPose()); let md = 0; for (const k in A.bones) for (let i = 0; i < 4; i++) md = Math.max(md, Math.abs(A.bones[k][i] - moved.bones[k][i]));
  check('pose: the pose was really changed before opening (test sanity)', md > 0.1, 'max diff ' + md.toFixed(3));
  await ev(() => { document.querySelector('#fSaveInfo').textContent = ''; });
  await (await page.$('#fPoseFile')).uploadFile(path.join(dl, 'figure_pose.json'));
  try { await page.waitForFunction(() => /Opened|Could not/.test(document.querySelector('#fSaveInfo').textContent), { timeout: 15000 }); } catch (e) {}
  const info = await ev(() => document.querySelector('#fSaveInfo').textContent), B = await ev(() => Fig3D.getPose());
  let worst = 0; for (const k in A.bones) for (let i = 0; i < 4; i++) worst = Math.max(worst, Math.abs(A.bones[k][i] - B.bones[k][i]));
  const pd = Math.max(...A.pelvis.map((v, i) => Math.abs(v - B.pelvis[i])));
  check('pose: Open a pose restores every bone rotation within 1e-4', worst < 1e-4, info + ' ; max diff ' + worst.toExponential(2));
  check('pose: Open a pose restores the hip position within 1e-4', pd < 1e-4, pd.toExponential(2));
  await page.click('#fStand');
});

// ================================================================ 9: pictures
await guard('pictures', async () => {
  await ev(() => { Fig3D.setStyle('toon'); Fig3D.standing(); });
  const px = (W, H, transparent) => ev(async (W, H, tr) => {
    const c = Fig3D.snapshot(W, H, tr), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let clear = 0, solid = 0, partial = 0;
    for (let i = 3; i < d.length; i += 400) { const a = d[i]; if (a === 0) clear++; else if (a === 255) solid++; else partial++; }
    return { w: c.width, h: c.height, clear, solid, partial };
  }, W, H, transparent);
  const big = await px(3840, 1920, true);
  check('picture: snapshot(3840, 1920, true) is 3840 x 1920', big.w === 3840 && big.h === 1920, big.w + ' x ' + big.h);
  check('picture: the background is transparent and the figure is opaque', big.clear > 0.5 * (big.clear + big.solid + big.partial) && big.solid > 200, JSON.stringify(big));
  const opaqueBg = await px(640, 360, false);
  check('picture: with transparent off the background is filled (no clear pixels)', opaqueBg.clear === 0, JSON.stringify(opaqueBg));
  // styles
  const R = {};
  for (const k of await ev(() => Object.keys(Fig3D.STYLES))) {
    try {
      R[k] = await ev(async k => {
        Fig3D.setStyle(k); const W = 1280, H = 720, c = Fig3D.snapshot(W, H, true), d = c.getContext('2d').getImageData(0, 0, W, H).data, A = (x, y) => d[(y * W + x) * 4 + 3];
        let ink = 0, edge = 0, dark = 0;
        for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
          const a = A(x, y); if (a > 0) ink++; if (a < 128) continue;
          if (A(x - 2, y) < 20 || A(x + 2, y) < 20 || A(x, y - 2) < 20 || A(x, y + 2) < 20) { edge++; const i = (y * W + x) * 4; if ((d[i] + d[i + 1] + d[i + 2]) / 3 < 90) dark++; }
        }
        return { ink, edge, dark, outline: !!Fig3D.STYLES[k].outline };
      }, k);
    } catch (e) { R[k] = { err: String(e && e.message || e) }; }
  }
  for (const [k, r] of Object.entries(R)) {
    if (r.err) { check('style ' + k + ' renders without error', false, r.err); continue; }
    check('style ' + k + ' renders a figure', r.ink > 2000, 'ink pixels ' + r.ink);
    if (r.outline) check('style ' + k + ': the outline hull draws dark pixels around the silhouette', r.edge > 100 && r.dark / r.edge > 0.5, 'dark ' + r.dark + ' of ' + r.edge + ' edge pixels (' + (100 * r.dark / Math.max(1, r.edge)).toFixed(0) + '%)');
    else if (k === 'shade') check('style ' + k + ': no outline (the silhouette edge is not dark)', r.edge > 100 && r.dark / r.edge < 0.3, 'dark ' + r.dark + ' of ' + r.edge);
  }
  await ev(() => { Fig3D.setStyle('toon'); });
  // the UI button too
  await page.click('[data-fstyle="contour"]'); await sleep(200); check('picture: a style button in the UI switches the style', await ev(() => Fig3D.S.style) === 'contour');
  await page.click('[data-fstyle="toon"]');
  await page.screenshot({ path: path.join(out, 'app_figure_final.png') });
});

// ================================================================ 10: errors
check('no page errors or console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
const secs = (Date.now() - t0) / 1000;
check('the whole run took under 3 minutes', secs < 180, secs.toFixed(0) + ' s');
console.log(fails ? fails + ' check(s) FAILED' : 'all checks passed');
await finish(fails ? 1 : 0);
