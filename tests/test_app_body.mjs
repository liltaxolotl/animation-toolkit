// Body mode of animation_app.html: the posable mannequin, its timeline, onion skin and timing slider.
//   node tests/test_app_body.mjs
// Part 1 (no browser): the mannequin math inside the HTML (joints, reaching, key poses, retiming).
// Part 2 (headless Chrome, needs `npm i puppeteer-core`): poses it with the real mouse, scrubs, plays,
//   saves and reopens a motion. Needs no artwork.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'tests', 'out'); fs.mkdirSync(out, { recursive: true });
const html = fs.readFileSync(path.join(root, 'animation_app.html'), 'utf8');
const M = new Function(html.split('/*BODY-START*/')[1].split('/*BODY-END*/')[0] + '; return BodyMath;')();
let fails = 0;
const check = (name, ok, detail) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ' + detail : '')); if (!ok) fails++; };
const close = (a, b, tol) => Math.abs(a - b) <= (tol || 1e-6);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ---------------------------------------------------------------- part 1: the math
const st = M.stand(), fs0 = M.fk(st);
check('standing: both feet flat on the ground', ['heelR', 'toeR', 'heelL', 'toeL'].every(n => close(fs0.J[n][1], 0, 1e-9)));
check('standing: about seven and a half heads tall', close(fs0.J.head[1], 7.5, 0.05), fs0.J.head[1].toFixed(3) + ' heads');
check('standing: hips near half the height, fingertips at mid thigh', close(fs0.J.pelvis[1] / fs0.J.head[1], 0.52, 0.03) && fs0.J.handR[1] > fs0.J.kneeR[1] && fs0.J.handR[1] < fs0.J.pelvis[1]);
let p = Object.assign({}, st, { shoulderR: 90, elbowR: 0, wristR: 0 }), f = M.fk(p);
check('shoulder +90 points the arm straight forward', f.J.handR[0] > f.J.shoulderR[0] + 3 && close(f.J.handR[1], f.J.shoulderR[1], 1e-9));
p = Object.assign({}, st, { elbowR: 90, shoulderR: 0 }); f = M.fk(p);
check('elbow +90 folds the forearm forward', f.J.wristR[0] > f.J.elbowR[0] + 1 && close(f.J.wristR[1], f.J.elbowR[1], 1e-9));
p = Object.assign({}, st, { hipR: 0, kneeR: 90 }); f = M.fk(p);
check('knee +90 folds the shin back', f.J.ankleR[0] < f.J.kneeR[0] - 1 && close(f.J.ankleR[1], f.J.kneeR[1], 1e-9));
p = Object.assign({}, st, { neck: 40 }); f = M.fk(p);
check('neck + bows the head forward', f.J.head[0] > f.J.neck[0] + 0.5);
p = M.leanTo(st, 35); f = M.fk(p);
check('leaning the body forward leaves the legs where they were', f.J.neck[0] > 1 && ['ankleR', 'ankleL', 'kneeR', 'kneeL', 'toeR'].every(n => dist(f.J[n], fs0.J[n]) < 1e-9));

let worst = 0;
for (const t of [[1.6, 4.6], [0.4, 7.9], [-1.2, 5.0], [2.2, 6.4], [0.9, 3.9]]) { const q = M.pullArm(st, 'R', t), d = dist(M.fk(q).J.wristR, t); worst = Math.max(worst, d); if (q.elbowR < 0) worst = 9; }
check('pulling a wrist puts it on the spot, elbow folding the natural way', worst < 1e-6, 'worst miss ' + worst.toExponential(1));
let q = M.pullArm(st, 'L', [9, 5.95]); f = M.fk(q);
check('a spot out of reach: the arm goes straight toward it', Math.abs(q.elbowL) < 0.5 && f.J.wristL[0] > 2.6 && close(f.J.wristL[1], 5.95, 0.01));
q = M.pullLeg(st, 'R', [0.9, 1.2]); f = M.fk(q);
check('pulling an ankle puts it on the spot, knee forward, foot still level', dist(f.J.ankleR, [0.9, 1.2]) < 1e-6 && q.kneeR > 20 && f.J.kneeR[0] > f.J.ankleR[0] - 0.2 && close(M.near(f.W.footR, 90), 90, 1e-6), 'knee ' + q.kneeR.toFixed(1));
q = M.moveHips(st, -0.3, st.y - 0.9, true); f = M.fk(q);
check('hips down with planted feet: ankles stay put, both knees bend, feet stay flat', dist(f.J.ankleR, fs0.J.ankleR) < 1e-6 && dist(f.J.ankleL, fs0.J.ankleL) < 1e-6 && q.kneeR > 40 && q.kneeL > 40 && Math.abs(M.lowest(q)) < 1e-6 && close(q.y, st.y - 0.9), 'knees ' + q.kneeR.toFixed(0) + ' and ' + q.kneeL.toFixed(0));
q = M.moveHips(st, 0.5, st.y + 0.2, false); f = M.fk(q);
check('hips moved without planting: the whole body goes along', close(f.J.ankleR[0] - fs0.J.ankleR[0], 0.5) && close(f.J.head[1] - fs0.J.head[1], 0.2));

const a = M.stand(), b = Object.assign(M.stand(), { shoulderR: 100, x: 2 }), keys = [{ frame: 5, ease: 'linear', pose: a }, { frame: 13, ease: 'inout', pose: b }, { frame: 21, ease: 'linear', pose: a }];
check('on a key frame the pose is that key pose', M.poseAt(keys, 13).shoulderR === 100 && M.poseAt(keys, 5).x === 0);
check('even speed: halfway is the halfway pose', close(M.poseAt(keys, 9).shoulderR, 54) && close(M.poseAt(keys, 9).x, 1) && close(M.poseAt(keys, 7).shoulderR, 31));
check('slow out, slow in: a quarter of the way has moved less than a quarter', (100 - M.poseAt(keys, 15).shoulderR) / 92 < 0.2 && close(M.poseAt(keys, 17).shoulderR, 54));
check('before the first key and after the last the pose holds', M.poseAt(keys, 1).shoulderR === 8 && M.poseAt(keys, 99).shoulderR === 8);
const crouch = M.moveHips(st, -0.3, st.y - 1.1, true), sk = [{ frame: 1, ease: 'inout', pose: st }, { frame: 13, ease: 'linear', pose: crouch }, { frame: 25, ease: 'inout', pose: Object.assign({}, st, { x: 1.5 }) }];
let slide = 0, lift = 0; for (let fr = 1; fr <= 13; fr += 0.5) { const pf = M.poseAt(sk, fr), ff = M.fk(pf); slide = Math.max(slide, dist(ff.J.ankleR, fs0.J.ankleR), dist(ff.J.ankleL, fs0.J.ankleL)); lift = Math.max(lift, Math.abs(M.lowest(pf))); }
check('feet planted in both key poses do not slide or lift on the frames between', slide < 1e-6 && lift < 1e-6, 'worst slide ' + slide.toExponential(1));
check('a foot that travels between two key poses is left to travel', close(M.fk(M.poseAt(sk, 19)).J.ankleR[0] - fs0.J.ankleR[0], 0.75, 0.35) && M.poseAt(sk, 19).x > 0.3);
check('timing: 200% halves the frames, 50% doubles them', M.retime([1, 13, 25], 2).join() === '1,7,13' && M.retime([1, 13, 25], 0.5).join() === '1,25,49' && M.retime([5, 13, 21], 1).join() === '5,13,21');
check('timing: squeezed keys never land on the same frame', M.retime([1, 2, 3, 20], 4).join() === '1,2,3,6');
check('angle bookkeeping stays continuous past a full turn', M.near(-170, 175) === 190 && M.near(10, 350) === 370 && M.near(45, 40) === 45);
check('a saved pose with gaps is filled in from the standing pose', M.clean({ x: 2, elbowR: '33', kneeL: null }).elbowR === 33 && M.clean({ x: 2 }).x === 2 && M.clean({}).kneeL === 0 && M.clean(null).hipR === 5);

// ---------------------------------------------------------------- part 2: the app itself
let puppeteer;
for (const base of [root, path.join(root, '_scratch'), process.cwd()]) { try { puppeteer = createRequire(path.join(base, 'x.js'))('puppeteer-core'); break; } catch (e) {} }
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(x => fs.existsSync(x));
if (!puppeteer || !chrome) { console.log('\nSkipping the browser part: ' + (!puppeteer ? 'puppeteer-core is not installed (npm i puppeteer-core).' : 'no Chrome or Edge found.')); console.log(fails ? fails + ' FAILED' : 'MATH PART PASSED'); process.exit(fails ? 1 : 0); }
const dl = path.join(out, 'app_body'); fs.rmSync(dl, { recursive: true, force: true }); fs.mkdirSync(dl, { recursive: true });
const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--window-size=1700,980'] });
const page = await browser.newPage(); await page.setViewport({ width: 1700, height: 980 });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const client = await page.createCDPSession(); await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitFile = async name => { for (let i = 0; i < 60; i++) { if (fs.existsSync(path.join(dl, name))) { await sleep(150); return true; } await sleep(100); } return false; };
await page.goto(pathToFileURL(path.join(root, 'animation_app.html')).href);
await page.evaluate(() => localStorage.clear()); await page.reload();
await page.click('[data-mode="body"]');

const at = n => page.evaluate(n => Body.at(n), n), fx = f => page.evaluate(f => Body.frameAt(f), f);
const S = () => page.evaluate(() => ({ cur: Body.B.cur, sel: Body.B.sel, playing: Body.B.playing, speed: Body.B.speed, frames: Body.B.keys.map(k => k.frame), pose: Body.pose() }));
const dragBy = async (from, dx, dy) => { await page.mouse.move(from[0], from[1]); await page.mouse.down(); await page.mouse.move(from[0] + dx, from[1] + dy, { steps: 12 }); await page.mouse.up(); };
const ink = rgb => page.evaluate(rgb => { const c = document.querySelector('#bView'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 60 && Math.abs(d[i] - rgb[0]) < 40 && Math.abs(d[i + 1] - rgb[1]) < 40 && Math.abs(d[i + 2] - rgb[2]) < 40) n++; return n; }, rgb);

let s = await S();
check('the Body tab opens on the starter motion with the mannequin drawn', s.frames.join() === '1,13,21,37' && s.cur === 1 && (await ink([236, 232, 244])) > 3000 && (await ink([127, 122, 144])) > 1500, s.frames.join());
check('the frame label says where it is', /Frame 1 of 37\s+key pose/.test(await page.$eval('#bFrameLbl', e => e.textContent)));

// posing
let w0 = await at('wristR'); await dragBy(w0, 90, -110); let w1 = await at('wristR'); let s1 = await S();
check('dragging the near wrist: the hand follows the mouse and the elbow folds', dist(w1, [w0[0] + 90, w0[1] - 110]) < 2 && s1.pose.elbowR > s.pose.elbowR + 20 && s1.sel === 'elbowR' && s1.frames.length === 4, 'elbow ' + s1.pose.elbowR.toFixed(0) + ', off by ' + dist(w1, [w0[0] + 90, w0[1] - 110]).toFixed(1) + ' px');
let e0 = await at('elbowR'), wl = await at('wristR'); await dragBy([(e0[0] + wl[0]) / 2, (e0[1] + wl[1]) / 2], -50, -30); let s2 = await S();
check('dragging the forearm itself bends only the elbow', Math.abs(s2.pose.elbowR - s1.pose.elbowR) > 10 && s2.pose.shoulderR === s1.pose.shoulderR && s2.pose.elbowL === s1.pose.elbowL && s2.sel === 'elbowR', 'elbow ' + s1.pose.elbowR.toFixed(0) + ' to ' + s2.pose.elbowR.toFixed(0));
let k0 = await at('kneeR'); await page.mouse.click(k0[0], k0[1]); s = await S();
check('clicking a dot picks that joint without moving anything', s.sel === 'kneeR' && s.pose.kneeR === s2.pose.kneeR && (await page.$eval('#bJointName', e => e.textContent)) === 'Near knee');
let aR = await at('ankleR'), aL = await at('ankleL'), pv = await at('pelvis'); await dragBy(pv, -10, 70); let aR2 = await at('ankleR'), aL2 = await at('ankleL'), pv2 = await at('pelvis'); s = await S();
check('dragging the hips down: the feet stay planted and the knees bend', dist(aR, aR2) < 1.5 && dist(aL, aL2) < 1.5 && dist(pv2, [pv[0] - 10, pv[1] + 70]) < 2 && s.pose.kneeR > 30 && s.pose.kneeL > 30, 'knees ' + s.pose.kneeR.toFixed(0) + ' and ' + s.pose.kneeL.toFixed(0));
await page.click('#bPlant'); pv = await at('pelvis'); aR = await at('ankleR'); await dragBy(pv, 40, -20); aR2 = await at('ankleR');
check('with planting switched off the feet travel with the hips', dist(aR2, [aR[0] + 40, aR[1] - 20]) < 2);
await page.click('#bPlant');
await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control'); aR2 = await at('ankleR');
check('Ctrl+Z takes back the last move', dist(aR2, aR) < 1.5);
k0 = await at('kneeR'); await page.mouse.click(k0[0], k0[1]);
await page.$eval('#bAngle', e => { e.value = 75; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }); s = await S();
check('the joint slider bends the selected joint', s.sel === 'kneeR' && s.pose.kneeR === 75);

// timeline
let x7 = await fx(7); await page.mouse.click(x7[0], x7[1] + 22); s = await S();
check('clicking the timeline jumps to that frame, between two key poses', s.cur === 7 && /Frame 7 of 37\s+inbetween/.test(await page.$eval('#bFrameLbl', e => e.textContent)));
let x9 = await fx(9), x17 = await fx(17); await page.mouse.move(x9[0], x9[1] + 22); await page.mouse.down(); await page.mouse.move(x17[0], x17[1] + 22, { steps: 8 }); const mid = await S(); await page.mouse.move(x9[0], x9[1] + 22, { steps: 8 }); await page.mouse.up(); s = await S();
check('dragging along the timeline scrubs through the motion', mid.cur === 17 && s.cur === 9 && Math.abs(mid.pose.shoulderR - s.pose.shoulderR) > 5);
let hd = await at('head'); await dragBy(hd, 60, 30); s = await S();
check('moving a joint on an inbetween frame makes a new key pose there', s.frames.join() === '1,9,13,21,37' && s.pose.neck > 5 && /New key pose at frame 9/.test(await page.$eval('#bReadout', e => e.textContent)), s.frames.join());
await page.click('#bDel'); s = await S();
check('Delete removes that key pose again', s.frames.join() === '1,13,21,37');
let x13 = await fx(13), x16 = await fx(16); await page.mouse.move(x13[0], x13[1]); await page.mouse.down(); await page.mouse.move(x16[0], x16[1], { steps: 6 }); await page.mouse.up(); s = await S();
check('dragging a diamond moves that key pose to another frame', s.frames.join() === '1,16,21,37' && s.cur === 16, s.frames.join());
await page.mouse.move(x16[0], x16[1]); await page.mouse.down(); await page.mouse.move(x16[0] + 900, x16[1], { steps: 6 }); await page.mouse.up(); s = await S();
check('a key pose cannot be dragged past its neighbour', s.frames.join() === '1,20,21,37', s.frames.join());
await page.click('#bDemo'); s = await S();

// onion skin
await page.mouse.click(x13[0], x13[1] + 22);
const blue0 = await ink([77, 141, 255]), orange0 = await ink([255, 162, 58]);
await page.click('#bOnion'); const blue1 = await ink([77, 141, 255]), orange1 = await ink([255, 162, 58]); let gh = await page.evaluate(() => Body.ghosts());
check('onion skin off: no ghosts. On: the key pose before in blue and the one after in orange', blue0 === 0 && orange0 === 0 && blue1 > 300 && orange1 > 300 && gh.map(g => g.frame * g.side).join() === '-1,21', blue1 + ' blue and ' + orange1 + ' orange pixels');
await page.screenshot({ path: path.join(out, 'app_body_onion.png') });
await page.select('#bOnionMode', 'frames'); await page.select('#bOnionN', '2'); gh = await page.evaluate(() => Body.ghosts());
check('onion skin can show nearby frames instead', gh.map(g => g.frame * g.side).sort((u, v) => u - v).join() === '-11,-9,15,17', gh.map(g => g.frame * g.side).join());
await page.click('#bOnion');
check('switching it off clears the ghosts', (await ink([77, 141, 255])) === 0);

// timing slider
await page.$eval('#bSpeed', e => { e.value = 10; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); });
let info = await page.$eval('#bTimeInfo', e => e.textContent); s = await S();
check('speed 200%: it says 36 frames become 18, keys not touched yet', s.speed === 2 && /runs 36 frames = 1\.5 s/.test(info) && /At 200% it takes 18 frames = 0\.75 s/.test(info) && s.frames.join() === '1,13,21,37', info);
await page.screenshot({ path: path.join(out, 'app_body_timing.png') });
await page.evaluate(() => { Body.B.loop = false; Body.B.cur = 1; Body.sync(); }); const t0 = Date.now(); await page.click('#bPlay');
for (let i = 0; i < 80 && (await S()).playing; i++) await sleep(25); const took = Date.now() - t0; s = await S();
check('playing at 200% takes about half the time and stops on the last pose', !s.playing && s.cur === 37 && took > 550 && took < 1250, took + ' ms for a 1.5 s motion');
await page.click('#bBake'); s = await S();
check('"Keep this timing" moves the key poses and puts the speed back to 100%', s.frames.join() === '1,7,11,19' && s.speed === 1 && s.cur === 19, s.frames.join());
await page.evaluate(() => { Body.B.loop = true; Body.B.cur = 1; Body.sync(); }); await page.keyboard.press('Space'); await sleep(1300); s = await S();
check('with Loop on it keeps going round (Space starts it)', s.playing && s.cur >= 1 && s.cur <= 19);
await page.keyboard.press('Space'); s = await S();
check('Space stops it on a whole frame', !s.playing && Number.isInteger(s.cur));

// save, open, remember
await page.click('#bSave'); const saved = (await waitFile('body_motion.json')) ? JSON.parse(fs.readFileSync(path.join(dl, 'body_motion.json'), 'utf8')) : null;
check('Save motion writes the key poses to a file', !!saved && saved.kind === 'animtk-body-motion' && saved.keys.map(k => k.frame).join() === '1,7,11,19' && Object.keys(saved.keys[0].pose).length === 17);
x7 = await fx(7); await page.mouse.click(x7[0], x7[1]); await page.click('#bStand'); await page.click('#bDel'); s = await S();
check('(changing it first)', s.frames.join() === '1,11,19');
const edited = { ...saved, keys: saved.keys.concat([{ frame: 30, ease: 'out', pose: { x: 1, shoulderR: 120 } }]) }; fs.writeFileSync(path.join(dl, 'edited_motion.json'), JSON.stringify(edited));
await (await page.$('#bLoad')).uploadFile(path.join(dl, 'edited_motion.json')); await sleep(300); s = await S();
const p30 = await page.evaluate(() => Body.pose(30));
check('Open a motion brings it back, and a hand-written key with missing joints still loads', s.frames.join() === '1,7,11,19,30' && p30.shoulderR === 120 && p30.x === 1 && p30.kneeR === 0);
fs.writeFileSync(path.join(dl, 'not_a_motion.json'), '{"keys":"nope"}'); await (await page.$('#bLoad')).uploadFile(path.join(dl, 'not_a_motion.json')); await sleep(300); s = await S();
check('a file that is not a motion is refused and nothing changes', s.frames.join() === '1,7,11,19,30' && /is not a saved body motion/.test(await page.$eval('#bSaveInfo', e => e.textContent)));
await page.click('#bPng');
check('Save this frame writes a PNG', await waitFile('body_frame_0001.png'));
await page.reload(); await page.click('[data-mode="body"]'); s = await S();
check('the motion is still there after closing and reopening the page', s.frames.join() === '1,7,11,19,30');
await page.click('#bDemo'); x13 = await fx(13); await page.mouse.click(x13[0], x13[1] + 22); await page.click('#bOnion'); await page.screenshot({ path: path.join(out, 'app_body.png') });
check('no script errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log('\n' + (fails ? fails + ' FAILED' : 'ALL PASSED')); process.exit(fails ? 1 : 0);
