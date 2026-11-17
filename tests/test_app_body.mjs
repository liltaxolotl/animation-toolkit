// Body mode of animation_app.html: the posable mannequin, its timeline, onion skin and timing slider,
// the preset motions (walk, pick up, raise a hand, the walk and run library, jump, stop short), the teaching overlays
// (line of action, balance, pivots, joint limits, muscles, hair and scarf), the proportion guide and the hands and feet sheet.
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

// ---- the preset motions
const W = M.presets.walk(), wk = W.keys, wf = n => M.fk(wk[n].pose);
check('walk: 9 named poses on threes, contact, down, passing, up and round again', wk.map(k => k.frame).join() === '1,4,7,10,13,16,19,22,25' && wk.map(k => k.label).join() === 'Contact,Down,Passing,Up,Contact,Down,Passing,Up,Contact');
check('walk: contacts are keys, passing is the breakdown, down and up are inbetweens', wk.map(k => k.kind[0]).join('') === 'kibikibik');
check('walk: it ends on the pose it started with, and the second step mirrors the first', M.FIELDS.every(n => close(wk[0].pose[n], wk[8].pose[n])) && close(wk[4].pose.hipL, wk[0].pose.hipR) && close(wk[5].pose.kneeR, wk[1].pose.kneeL) && close(wk[6].pose.shoulderL, wk[2].pose.shoulderR));
check('walk: the hips are lowest on the down pose and highest on the up pose', wk[1].pose.y < wk[0].pose.y && wk[0].pose.y < wk[2].pose.y && wk[2].pose.y < wk[3].pose.y, wk.slice(0, 4).map(k => k.pose.y.toFixed(2)).join(' '));
check('walk: contact has the front heel down with the toes up, and the back foot on its toes', Math.abs(wf(0).J.heelR[1]) < 1e-6 && wf(0).J.toeR[1] > 0.25 && Math.abs(wf(0).J.toeL[1]) < 1e-6 && wf(0).J.heelL[1] > 0.25 && wf(0).J.ankleR[0] > 1 && wf(0).J.ankleL[0] < -1);
check('walk: the arms swing against the legs', wk[0].pose.shoulderR < -15 && wk[0].pose.shoulderL > 15 && wk[4].pose.shoulderR > 15 && wk[4].pose.shoulderL < -15);
check('walk: the passing leg is lifted and bent, the standing leg nearly straight', wk[2].pose.kneeL > 45 && wk[2].pose.kneeR < 22 && wf(2).J.ankleL[1] > 0.6);
let lowW = 9, highW = -9, back = true, prevX = 9; for (let fr = 1; fr <= 25; fr += 0.25) { const pf = M.poseAt(wk, fr), v = M.lowest(pf); lowW = Math.min(lowW, v); highW = Math.max(highW, v); if (fr <= 13) { const x = M.fk(pf).J.ankleR[0]; if (x > prevX + 1e-9) back = false; prevX = x; } }
check('walk: on every frame a foot is on the ground and none sinks into it', lowW > -0.02 && highW < 0.02, 'lowest point from ' + lowW.toFixed(3) + ' to ' + highW.toFixed(3));
check('walk: the planted foot slides back steadily (walking on the spot)', back && close(M.fk(M.poseAt(wk, 5)).J.ankleR[0] - M.fk(M.poseAt(wk, 6)).J.ankleR[0], M.fk(M.poseAt(wk, 8)).J.ankleR[0] - M.fk(M.poseAt(wk, 9)).J.ankleR[0], 0.01));
const PU = M.presets.pickUp(), pk = PU.keys, grabI = pk.findIndex(k => k.label === 'Grab'), gJ = M.fk(pk[grabI].pose).J;
let slip = 0; for (let fr = 1; fr <= 54; fr += 0.5) { const J = M.fk(M.poseAt(pk, fr)).J; slip = Math.max(slip, dist(J.ankleR, fs0.J.ankleR), dist(J.toeL, fs0.J.toeL)); }
check('pick up: keys, breakdowns and inbetweens are all there and named', ['key', 'breakdown', 'inbetween'].every(t => pk.some(k => k.kind === t)) && pk.every(k => k.label) && pk[0].label === 'Stand' && pk[pk.length - 1].kind === 'key', pk.map(k => k.label).join(', '));
check('pick up: the near foot never moves and the far foot keeps its toes on the spot (its heel peels up in the deep bend)', slip < 1e-6 && gJ.heelL[1] > 0.2 && Math.abs(gJ.toeL[1]) < 1e-6);
check('pick up: on the grab the hand is at the thing, the knees are bent and the body is still balanced', dist([(gJ.wristR[0] + gJ.handR[0]) / 2, (gJ.wristR[1] + gJ.handR[1]) / 2], [PU.prop.x, PU.prop.y]) < 0.5 && pk[grabI].pose.kneeR > 90 && M.balance(pk[grabI].pose).state === 'balanced' && PU.prop.grab === pk[grabI].frame, 'hand ' + dist([(gJ.wristR[0] + gJ.handR[0]) / 2, (gJ.wristR[1] + gJ.handR[1]) / 2], [PU.prop.x, PU.prop.y]).toFixed(2) + ' heads from it');
check('pick up: the thing stays put until the grab, then travels with the hand', dist(M.propAt(PU.prop, pk, 10), [PU.prop.x, PU.prop.y]) === 0 && dist(M.propAt(PU.prop, pk, 24), [PU.prop.x, PU.prop.y]) < 1e-9 && M.propAt(PU.prop, pk, 54)[1] > 3 && pk.every(k => M.balance(k.pose).state === 'balanced'));
const RH = M.presets.raiseHand(), rk = RH.keys, rEnd = M.fk(rk[rk.length - 1].pose).J;
check('raise a hand: a dip the other way first, the elbow leads, the hand overshoots, then settles above the head', rk[1].pose.shoulderR < rk[0].pose.shoulderR - 10 && rk[2].pose.elbowR > 90 && rk[2].kind === 'breakdown' && rk[3].pose.shoulderR > rk[4].pose.shoulderR + 5 && rEnd.handR[1] > rEnd.head[1] + 0.5 && rk[4].kind === 'key', rk.map(k => k.label).join(', '));
check('every preset has feet on the ground on every stored pose and says what it teaches', ['walk', 'pickUp', 'raiseHand', 'starter'].every(n => { const m = M.presets[n](); return m.about.length > 40 && m.keys.every(k => Math.abs(M.lowest(k.pose)) < 1e-6 && M.KINDS.includes(k.kind)); }));

// ---- balance and line of action
let bal = M.balance(st);
check('standing: the centre of gravity is a bit above the hips and over the feet', bal.state === 'balanced' && bal.com[1] > st.y + 0.1 && bal.com[1] < st.y + 0.8 && bal.support[0] < bal.com[0] && bal.com[0] < bal.support[1], 'at ' + bal.com.map(v => v.toFixed(2)).join(', ') + ', feet cover ' + bal.support.map(v => v.toFixed(2)).join(' to '));
const tip = M.leanTo(M.moveHips(st, 0.9, st.y - 0.15, true), 30), okLean = M.leanTo(M.moveHips(st, -0.2, st.y - 0.15, true), 30);
check('hips pushed out past the toes with a forward lean tips forward, and leaning back tips back', M.balance(tip).state === 'forward' && M.balance(tip).off > 0.05 && M.balance(M.leanTo(st, -45)).state === 'back', 'forward by ' + M.balance(tip).off.toFixed(2) + ' heads');
check('the same lean with the hips back over the feet is balanced again', M.balance(okLean).state === 'balanced' && M.actionLine(M.leanTo(Object.assign({}, st, { spine: 30 }), 70)).top === 'head');
check('off the ground it says in the air', M.balance(Object.assign({}, st, { y: st.y + 1 })).state === 'air' && M.support(Object.assign({}, st, { y: st.y + 1 })) === null);
check('raising both arms lifts the centre of gravity', M.com(Object.assign({}, st, { shoulderR: 175, shoulderL: 175 }))[1] > bal.com[1] + 0.1);
check('on tiptoe the feet cover much less ground', (() => { const t = M.posed({ y: st.y + 0.3, legR: [M.ankleOn(0.9, 50, 'toe'), 50], legL: [M.ankleOn(0.6, 50, 'toe'), 50] }), sp = M.support(t); return sp && sp[1] - sp[0] < 0.6 && Math.abs(M.lowest(t)) < 1e-6; })());
check('walk: balanced on the contact pose, falling forward on the up pose', M.balance(wk[0].pose).state === 'balanced' && M.balance(wk[3].pose).state === 'forward');
let ln = M.actionLine(st);
check('line of action: standing straight is a straight line from the head to a foot', ln.shape === 'straight' && ln.top === 'head' && dist(ln.bez[0], fs0.J.head) === 0 && dist(ln.bez[3], fs0.J['ankle' + ln.leg]) === 0);
ln = M.actionLine(M.presets.starter().keys[1].pose);
check('line of action: a crouch is a C curve', ln.shape === 'C' && ln.bend > 0.15, 'bend ' + ln.bend.toFixed(2));
ln = M.actionLine(Object.assign({}, st, { lean: -28, spine: 50, neck: 20, hipR: -30, hipL: -30, kneeR: 55, kneeL: 55, ankleR: -10, ankleL: -10 }));
check('line of action: hips forward with the chest and knees folding back over them is an S curve', ln.shape === 'S', ln.shape + ', bend ' + ln.bend.toFixed(2));
check('line of action: a hand reaching over the head starts the line, and a forward lean runs out through the back leg', M.actionLine(rk[4].pose).top === 'handR' && M.actionLine(wk[0].pose).leg === 'L' && M.actionLine(wk[4].pose).leg === 'R');
const fit = M.bezFit([[0, 0], [1, 2], [2, 3], [3, 3], [4, 2], [5, 0]]), bz = t => [0, 1].map(k => (1 - t) ** 3 * fit[0][k] + 3 * (1 - t) ** 2 * t * fit[1][k] + 3 * (1 - t) * t * t * fit[2][k] + t ** 3 * fit[3][k]);
check('the curve fit starts and ends on the end points and arches over the middle ones', dist(fit[0], [0, 0]) === 0 && dist(fit[3], [5, 0]) === 0 && close(bz(0.5)[0], 2.5, 0.05) && bz(0.5)[1] > 2.6 && bz(0.5)[1] < 3.4, 'top at ' + bz(0.5).map(v => v.toFixed(2)).join(', '));

// ---------------------------------------------------------------- part 2: the app itself
// ---- phase 4: the walk and run library, joint ranges, proportions
const sweep = (m, stepF) => { let low = 9, high = -9, air = 0, lim = 0, n = 0; const k = m.keys; for (let fr = k[0].frame; fr <= k[k.length - 1].frame; fr += stepF || 0.5) { const pf = M.poseAt(k, fr), v = M.lowest(pf); low = Math.min(low, v); high = Math.max(high, v); n++; if (M.balance(pf).state === 'air') air++; lim += M.limits(pf).length; } return { low, high, air, lim, n }; };
const lib = { happyWalk: 10, sneak: 24, tiredWalk: 16, run: 8 }, G = {}; for (const id in lib) G[id] = M.presets[id]();
check('library: happy walk, sneak, tired walk and run are two-step cycles of 10, 24, 16 and 8 frames a step', Object.keys(lib).every(id => { const k = G[id].keys; return k.length === 9 && k[8].frame === 1 + 2 * lib[id] && k[4].frame === 1 + lib[id] && M.FIELDS.every(n => close(k[0].pose[n], k[8].pose[n])); }));
check('library: in each the second step mirrors the first and every pose is named and typed', Object.keys(lib).every(id => { const k = G[id].keys; return close(k[4].pose.hipL, k[0].pose.hipR) && close(k[6].pose.shoulderL, k[2].pose.shoulderR) && k.every(q => q.label && M.KINDS.includes(q.kind)) && k[0].kind === 'key' && k[2].kind === 'breakdown' && G[id].about.length > 60; }));
const sw = {}; for (const id of Object.keys(lib).concat(['walk', 'jump', 'stopShort', 'pickUp', 'raiseHand', 'starter'])) sw[id] = sweep(M.presets[id]());
check('library: no foot sinks into the ground on any frame of any motion', Object.values(sw).every(v => v.low > -0.01), Object.entries(sw).map(([n, v]) => n + ' ' + v.low.toFixed(3)).join(', '));
check('library: the walks always have a foot on the ground, and the run has frames with both feet in the air', ['walk', 'happyWalk', 'sneak', 'tiredWalk'].every(n => sw[n].air === 0 && sw[n].high < 0.02) && sw.run.air > 4 && M.balance(G.run.keys[3].pose).state === 'air' && G.run.keys[3].label === 'In the air');
const bounce = k => Math.max(...k.map(q => q.pose.y)) - Math.min(...k.map(q => q.pose.y)), wy = bounce(wk);
check('library: the happy walk bounces more than the plain walk and the tired walk less, with its back rounded and its head hanging', bounce(G.happyWalk.keys) > wy * 1.4 && bounce(G.tiredWalk.keys) < wy * 0.5 && G.tiredWalk.keys.every(q => q.pose.spine > 15 && q.pose.neck > 15) && G.happyWalk.keys.every(q => q.pose.spine < 0), 'walk ' + wy.toFixed(2) + ', happy ' + bounce(G.happyWalk.keys).toFixed(2) + ', tired ' + bounce(G.tiredWalk.keys).toFixed(2));
const sn0 = M.fk(G.sneak.keys[0].pose).J;
check('library: the sneak stays low and puts the toe down first', G.sneak.keys.every(q => q.pose.y < 3.3) && Math.abs(sn0.toeR[1]) < 1e-6 && sn0.heelR[1] > 0.15 && Math.abs(sn0.heelL[1]) < 1e-6, 'hips at ' + G.sneak.keys.map(q => q.pose.y.toFixed(2)).slice(0, 4).join(' '));
const JP = M.presets.jump(), jk = JP.keys, jl = n => jk.find(q => q.label === n), span = q => { const J = M.fk(q.pose).J; return Math.max(J.head[1], J.handR[1]) - Math.min(J.toeR[1], J.heelR[1]); }, ld = M.fk(jl('Land').pose).J;
check('jump: squash on the anticipation, stretch at push off, in the air at the top, lands on the toes, squashes again and settles', span(jl('Anticipation')) < span(jk[0]) * 0.75 && span(jl('Push off')) > span(jk[0]) * 1.2 && M.balance(jl('Top of the jump').pose).state === 'air' && jl('Top of the jump').pose.y === Math.max(...jk.map(q => q.pose.y))
  && Math.abs(ld.toeR[1]) < 1e-6 && ld.heelR[1] > 0.3 && jl('Squash').pose.y < jl('Land').pose.y - 1 && M.FIELDS.every(n => close(jk[0].pose[n], jk[jk.length - 1].pose[n])), 'tall ' + [jk[0], jl('Anticipation'), jl('Push off')].map(q => span(q).toFixed(1)).join(' -> '));
check('joint ranges: a standing figure is inside them, and so is every frame of every motion', M.limits(st).length === 0 && Object.values(sw).every(v => v.lim === 0), Object.entries(sw).filter(e => e[1].lim).map(e => e[0]).join(', '));
let lm = M.limits(Object.assign({}, st, { elbowR: -40, kneeL: 160, shoulderR: 400 }));
check('joint ranges: an elbow bent 40 the wrong way is flagged as 35 past, a knee at 160 as a 10 degree stretch, and a full extra turn is not a fault', lm.length === 2 && lm.find(v => v.joint === 'elbowR').level === 'past' && close(lm.find(v => v.joint === 'elbowR').by, -35) && lm.find(v => v.joint === 'kneeL').level === 'stretch' && close(lm.find(v => v.joint === 'kneeL').by, 10));
check('proportions: eight bodies, and each stands as many of its own heads tall as it says', M.BODIES.length === 8 && M.BODIES.every(b => close(M.tallOf(b.P), b.heads, 0.03)) && ['adult', 'child', 'toddler', 'cartoon', 'chibi'].every(id => M.BODIES.some(b => b.id === id)), M.BODIES.map(b => b.name + ' ' + M.tallOf(b.P).toFixed(2)).join(', '));
const hipAt = id => { const b = M.BODIES.find(q => q.id === id); return M.stand(b.P).y / M.tallOf(b.P); };
check('proportions: halfway up is at the hips on the adult, above them on the child and well above on the toddler', close(hipAt('adult'), 0.5, 0.03) && hipAt('child') < hipAt('adult') - 0.02 && hipAt('toddler') < 0.4 && hipAt('chibi') < hipAt('toddler'));
check('proportions: any pose can be put on any body with its lowest point on the ground', M.BODIES.every(b => Math.abs(M.lowest(M.fit(wk[0].pose, b.P), b.P)) < 1e-9 && Object.values(M.fit(jl('Anticipation').pose, b.P)).every(Number.isFinite)));

// ---- phase 5: muscles, hands and feet, loose things
const mus = q => { const o = {}; for (const m of M.muscles(q)) if (m.side !== 'L') o[m.name] = m; return o; }, len = m => dist(m.a, m.b), m0 = mus(st), m1 = mus(Object.assign({}, st, { elbowR: 125, kneeR: 110, ankleR: -40, spine: 35 }));
check('muscles: nothing is bunched or stretched in the standing pose', Object.values(m0).every(m => Math.abs(m.flex) < 0.2) && Object.keys(m0).length === 14, Object.keys(m0).join(', '));
check('muscles: bending the elbow bunches the biceps (shorter and fatter) and stretches the triceps (longer and thinner)', m1.Biceps.flex > 0.8 && len(m1.Biceps) < len(m0.Biceps) * 0.9 && m1.Biceps.t > m0.Biceps.t * 1.3 && m1.Triceps.flex < -0.8 && len(m1.Triceps) > len(m0.Triceps) * 1.1 && m1.Triceps.t < m0.Triceps.t * 0.7);
check('muscles: a bent knee stretches the quads and bunches the hamstrings, pointed toes bunch the calf, a bowed spine bunches the abs', m1.Quads.flex < -0.6 && m1.Hamstrings.flex > 0.6 && m1.Calf.flex > 0.8 && m1.Shin.flex < -0.8 && m1.Abs.flex > 0.7 && m1['Lower back'].flex < -0.7);
const hd0 = id => M.hand(M.HANDS.find(g => g.id === id)), ho = hd0('open'), hf = hd0('fist'), hp = hd0('point'), hw = M.HANDS.find(g => g.id === 'wave');
check('hands: eight gestures, with gripping, pointing and waving among them', M.HANDS.length === 8 && ['grip', 'point', 'wave', 'fist', 'open', 'pinch'].every(id => M.HANDS.some(g => g.id === id)) && M.HANDS.every(g => g.note.length > 20));
check('hands: the knuckles sit on an arc and the middle finger reaches furthest', ho.fingers[1][0][1] > ho.fingers[0][0][1] && ho.fingers[1][0][1] > ho.fingers[2][0][1] && ho.fingers[2][0][1] > ho.fingers[3][0][1] && ho.tips[1][1] === Math.max(...ho.tips.slice(0, 4).map(t => t[1])) && ho.tips[1][1] > 1.9);
check('hands: a fist folds every fingertip back onto the palm, and pointing leaves one finger out', hf.tips.slice(0, 4).every((t, i) => t[1] < hf.fingers[i][0][1] - 0.15 && Math.abs(t[0]) < 0.5) && hp.tips[0][1] > 1.8 && hp.tips.slice(1, 4).every((t, i) => t[1] < hp.fingers[i + 1][0][1]));
check('hands: in the pinch the thumb tip meets the fingertip, and the wave swings the whole hand both ways', dist(hd0('pinch').tips[0], hd0('pinch').tips[4]) < 0.1 && hw.rot !== 0 && M.hand(hw).tips[1][0] > 0.3 && M.hand(hw, -hw.rot).tips[1][0] < -0.3, 'gap ' + dist(hd0('pinch').tips[0], hd0('pinch').tips[4]).toFixed(3));
const ft = id => M.foot(M.FEET.find(g => g.id === id)), heelY = id => ft(id).rear[0][1];
check('feet: flat has heel, ball and toes down; the heel strike only the heel; push off and tiptoe the ball and toes with the heel up; pointed and flexed touch nothing', ft('flat').heelDown && ft('flat').ballDown && ft('flat').toesDown && ft('heel').heelDown && !ft('heel').ballDown && !ft('heel').toesDown
  && ['push', 'tiptoe'].every(id => !ft(id).heelDown && ft(id).ballDown && ft(id).toesDown) && heelY('tiptoe') > heelY('push') && heelY('push') > 0.4 && ['pointed', 'flexed'].every(id => !ft(id).heelDown && !ft(id).ballDown && !ft(id).toesDown) && M.FEET.length === 6);
const SS = M.presets.stopShort(), sk2 = SS.keys, stopF = sk2.find(q => q.label === 'Body stops').frame, tr = fr => { const o = {}; for (const c of M.trails(sk2, fr)) o[c.name] = c.pts; return o; }, tipX = (c, fr) => { const q = tr(fr)[c]; return q[q.length - 1][0] - q[0][0]; };
const t1 = tr(1), links = Object.values(tr(18)).every(q => q.slice(1).every((v, i) => close(dist(v, q[i]), dist(q[1], q[0]), 0.03)));
check('loose things: hair, scarf and coat tail hang straight down while the body is still, and their links keep their length', Object.keys(t1).join() === 'hair,scarf,coat' && Object.values(t1).every(q => q.every(v => Math.abs(v[0] - q[0][0]) < 0.05) && q[q.length - 1][1] < q[0][1] - 1) && links);
let fwd = -9; for (let fr = stopF; fr <= stopF + 10; fr++) fwd = Math.max(fwd, tipX('scarf', fr));
const headMove = Math.abs(M.fk(M.poseAt(sk2, stopF + 10)).J.head[0] - M.fk(M.poseAt(sk2, stopF)).J.head[0]), endQ = tr(50).scarf, endP = tr(49).scarf;
check('stop short: the loose things trail behind while the body moves, swing on past it after it stops, and have settled by the end', tipX('hair', 10) < -0.5 && tipX('scarf', 10) < -0.5 && fwd > 0.4 && headMove < 0.6 && dist(endQ[5], endP[5]) < 0.03 && Math.abs(tipX('hair', 50)) < 0.6, 'scarf trails ' + tipX('scarf', 10).toFixed(2) + ', then swings ' + fwd.toFixed(2) + ' ahead');
const armAt = fr => M.fk(M.poseAt(sk2, fr)).J.handR[0] - M.poseAt(sk2, fr).x;
check('stop short: the arms carry on after the body stops, swing back past rest, and settle', armAt(18) > armAt(stopF) + 1 && armAt(23) < armAt(50) - 0.3 && armAt(29) > armAt(50) && SS.trails === true && sk2.find(q => q.label === 'Arms carry on').kind === 'breakdown' && Math.abs(M.poseAt(sk2, 20).x - M.poseAt(sk2, stopF).x) < 0.1);
const wa = M.trails(wk, 1, undefined, true), wb = M.trails(wk, 25, undefined, true);
check('loose things: the same frame always gives the same answer, and on a cycle the swing has found its rhythm', JSON.stringify(tr(30)) === JSON.stringify(tr(30)) && wa.every((c, i) => dist(c.pts[c.pts.length - 1], wb[i].pts[wb[i].pts.length - 1]) < 0.25), wa.map((c, i) => dist(c.pts[c.pts.length - 1], wb[i].pts[wb[i].pts.length - 1]).toFixed(2)).join(' '));

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

// preset motions and their labels
const lbl = () => page.$eval('#bPoseLbl', e => e.innerText.replace(/\s+/g, ' ').trim()), goto = async fr => { const q = await fx(fr); await page.mouse.click(q[0], q[1] + 22); };
await page.click('#bWalk'); s = await S();
check('Walk cycle loads 9 poses and says what it teaches', s.frames.join() === '1,4,7,10,13,16,19,22,25' && /contact poses are the keys/.test(await page.$eval('#bAbout', e => e.textContent)) && (await page.evaluate(() => Body.isCycle())));
check('frame 1 is labelled Contact, a key pose', /^Contact KEY POSE/.test(await lbl()) && /Frame 1 of 25\s+key pose/.test(await page.$eval('#bFrameLbl', e => e.textContent)), await lbl());
await goto(7); const l7 = await lbl(); await goto(10); const l10 = await lbl(); await goto(5); const l5 = await lbl();
check('passing is labelled a breakdown, up an inbetween, and frame 5 says which poses it sits between', /^Passing BREAKDOWN/.test(l7) && /^Up INBETWEEN/.test(l10) && /^inbetween from Down to Passing/.test(l5), [l7, l10, l5].join(' | '));
await page.screenshot({ path: path.join(out, 'app_body_walk.png') });
await page.evaluate(() => { Body.B.cur = 1; Body.sync(); }); await page.keyboard.press('Space'); await sleep(1500); s = await S();
check('the walk loops without stopping', s.playing && s.cur >= 1 && s.cur < 25); await page.keyboard.press('Space');
await goto(4); await page.select('#bKK', 'breakdown'); await page.click('#bKL', { clickCount: 3 }); await page.keyboard.type('Squash'); await page.keyboard.press('Tab');
let k4 = await page.evaluate(() => Body.B.keys[1]);
check('a pose can be renamed and its type changed', k4.kind === 'breakdown' && k4.label === 'Squash' && /^Squash BREAKDOWN/.test(await lbl()), await lbl());
let hd2 = await at('head'); await goto(6); hd2 = await at('head'); await dragBy(hd2, 30, 20); k4 = await page.evaluate(() => Body.B.keys.find(k => k.frame === 6));
check('a pose made by hand starts as an unnamed key pose', !!k4 && k4.kind === 'key' && k4.label === '' && /^Frame 6 KEY POSE/.test(await lbl()), await lbl());
await page.click('#bPick'); s = await S(); let ball = await page.evaluate(() => Body.propNow());
const teal = () => ink([60, 199, 180]);
check('Pick something up loads with the thing on the ground in front', s.frames.join() === '1,6,14,24,30,40,48,54' && ball[1] < 0.5 && ball[0] > 1.2 && (await teal()) > 400, 'ball at ' + ball.map(v => v.toFixed(2)).join(', '));
await goto(54); ball = await page.evaluate(() => Body.propNow());
check('by the last pose the hand has carried it up', ball[1] > 3 && /^Holding it KEY POSE/.test(await lbl()), 'ball at ' + ball.map(v => v.toFixed(2)).join(', '));
await page.click('#bRaise'); s = await S(); await goto(11);
check('Raise a hand loads, the thing is gone, and frame 11 is the breakdown', s.frames.join() === '1,5,11,17,22,34' && (await teal()) === 0 && /^Elbow leads BREAKDOWN/.test(await lbl()), await lbl());

// teaching overlays
await page.click('#bWalk');
const gold = () => ink([255, 216, 77]), cyan = () => ink([88, 214, 232]), green = () => ink([47, 191, 113]), red = () => ink([255, 85, 96]);
const g0 = await gold(), c0 = await cyan(), n0 = await green();
await page.click('#bShowAction'); const g1 = await gold();
check('Line of action draws one gold curve and names its shape', g0 === 0 && g1 > 800 && /Line of action: a C curve/.test(await lbl()), g1 + ' gold pixels, ' + (await lbl()));
await page.click('#bShowBalance'); const n1 = await green(); let bl = await page.evaluate(() => Body.balance());
check('Balance on the contact pose: green, centre of gravity between the feet', n0 === 0 && n1 > 400 && bl.state === 'balanced' && /Balanced: the weight is over the feet/.test(await lbl()), n1 + ' green pixels');
await goto(10); bl = await page.evaluate(() => Body.balance());
check('Balance on the up pose: red, tipping forward', bl.state === 'forward' && (await red()) > 300 && (await green()) === 0 && /Off balance: tipping forward/.test(await lbl()), await lbl());
await page.screenshot({ path: path.join(out, 'app_body_overlays.png') });
await page.click('#bShowPivots'); const c1 = await cyan();
check('Pivots marks every joint and how far it is bent', c0 === 0 && c1 > 600 && /Pivots:/.test(await lbl()), c1 + ' cyan pixels');
await page.reload(); await page.click('[data-mode="body"]');
check('the overlays and the motion are remembered', await page.evaluate(() => Body.B.action && Body.B.balance && Body.B.pivots && Body.B.name === 'Walk cycle' && Body.B.keys[2].label === 'Passing' && Body.B.keys[2].kind === 'breakdown'));
await page.click('#bShowAction'); await page.click('#bShowBalance'); await page.click('#bShowPivots');
check('switching them off clears them', (await gold()) === 0 && (await cyan()) === 0 && !/Line of action|Balance|Pivots/.test(await lbl()));
await page.click('#bPick'); await page.click('#bSave'); await sleep(400); const files = fs.readdirSync(dl).filter(n => /^body_motion.*\.json$/.test(n)).map(n => path.join(dl, n)).sort((u, v) => fs.statSync(v).mtimeMs - fs.statSync(u).mtimeMs), sv2 = JSON.parse(fs.readFileSync(files[0], 'utf8'));
check('a saved motion keeps the names, the types, the thing and the note', sv2.name === 'Pick something up' && sv2.prop.grab === 24 && sv2.keys[2].kind === 'breakdown' && sv2.keys[2].label === 'Hips back' && sv2.about.length > 40);
await page.click('#bRaise'); await (await page.$('#bLoad')).uploadFile(files[0]); await sleep(300);
check('and opening it brings them all back', await page.evaluate(() => Body.B.name === 'Pick something up' && Body.B.prop && Body.B.prop.grab === 24 && Body.B.keys[5].kind === 'breakdown' && Body.B.keys[5].label === 'Legs push'));
// ---- phases 4 and 5 in the app
const sum = () => page.evaluate(() => { const c = document.querySelector('#bView'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 16) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) | 0; return h; });
const BS = () => page.evaluate(() => ({ name: Body.B.name, n: Body.B.keys.length, view: Body.B.view, zoom: Body.B.zoom, trails: Body.B.trails, limits: Body.B.limits, muscles: Body.B.muscles, cycle: Body.isCycle(), last: Body.B.keys[Body.B.keys.length - 1].frame }));
const names = {}; for (const [id, nm] of [['bHappy', 'Happy walk'], ['bSneak', 'Sneak'], ['bTired', 'Tired walk'], ['bRun', 'Run'], ['bJump', 'Jump']]) { await page.click('#' + id); names[nm] = await BS(); }
check('the library buttons load the happy walk, sneak, tired walk, run and jump', Object.entries(names).every(([nm, v]) => v.name === nm && v.n >= 8) && names.Run.cycle && names.Run.last === 17 && names.Sneak.last === 49);
check('a motion that goes high zooms the picture out just enough to stay in it', names.Jump.zoom < 0.97 && names.Jump.zoom > 0.7 && names.Run.zoom === 1, 'jump zoom ' + names.Jump.zoom.toFixed(2));
await page.click('#bPlay'); await sleep(500); s = await S(); await page.click('#bPlay');
check('the jump plays', s.playing && s.cur > 3);
await page.click('#bDemo'); const pinkB = () => ink([255, 61, 110]), mint = () => ink([127, 224, 168]);
await page.evaluate(() => { Body.B.sel = 'elbowR'; Body.sync(); }); const mintOn = await mint(), pk0 = await pinkB();
const setAngle = v => page.evaluate(v => { const a = document.querySelector('#bAngle'); a.value = v; a.dispatchEvent(new Event('input')); a.dispatchEvent(new Event('change')); }, v);
await setAngle(-40); let lim = await page.evaluate(() => Body.limits()), rangeTxt = await page.$eval('#bRange', e => e.textContent);
check('joint limits are on from the start: the selected joint shows its real range, and nothing is flagged on a fresh motion', (await BS()).limits && mintOn > 150 && pk0 === 0 && /-5° to 150°/.test(rangeTxt));
check('bending the elbow 40 the wrong way rings it, says so on the picture, in the label and under the slider', lim.length === 1 && lim[0].joint === 'elbowR' && (await pinkB()) > 150 && /Past what a real joint does: near elbow by 35°/.test(await lbl()) && /35° past it/.test(rangeTxt), rangeTxt.slice(0, 60));
await page.click('#bShowLimits');
check('switching Joint limits off clears the warning and the range', (await pinkB()) === 0 && (await mint()) === 0 && !/real joint/.test(await lbl()));
await page.click('#bShowLimits'); await setAngle(120); const plain = await sum(); await page.click('#bShowMuscles'); const withM = await sum(), mlbl = await lbl();
check('Muscles draws the muscle groups and names what the selected joint does to them', withM !== plain && /Muscles: red = bunched up/.test(mlbl) && /biceps bunches up, triceps stretches/.test(mlbl), mlbl.slice(-70));
await page.click('#bShowMuscles'); check('and switches off again', (await sum()) === plain && !/Muscles/.test(await lbl()));
await page.click('#bStop'); const hairC = () => ink([181, 140, 255]); let bs = await BS();
check('Stop short switches Hair and scarf on by itself and draws them', bs.name === 'Stop short' && bs.trails && (await hairC()) > 300 && (await ink([255, 122, 168])) > 300 && await page.$eval('#bShowTrails', e => e.checked));
const sc = await page.evaluate(() => [10, 18].map(fr => { const t = Body.trails(fr).find(c => c.name === 'scarf').pts; return t[t.length - 1][0] - t[0][0]; }));
check('in the app the scarf trails behind on the step and swings ahead after the stop', sc[0] < -0.5 && sc[1] > 0.3, sc.map(v => v.toFixed(2)).join(' then '));
await page.click('#bShowTrails'); check('Hair and scarf switches off', (await hairC()) === 0 && !(await BS()).trails);
const poseSum = await sum(), keysBefore = await page.evaluate(() => JSON.stringify(Body.B.keys));
await page.click('[data-view="chart"]'); const chartSum = await sum(); bs = await BS();
check('Proportions shows the eight bodies in a row instead of the mannequin', bs.view === 'chart' && chartSum !== poseSum && (await ink([236, 232, 244])) > 8000 && (await lbl()) === '' && await page.$eval('#bHint', e => e.style.display === 'none'));
await page.click('#bChartSame'); const sameSum = await sum(); await page.evaluate(() => { Body.B.cur = 10; }); await page.click('#bChartPose'); const posedSum = await sum();
check('the guide can draw them all the same height, and in the pose on this frame', sameSum !== chartSum && posedSum !== sameSum);
await page.click('#bPng'); const gotPng = await waitFile('body_proportions.png') || (await sleep(6000), await waitFile('body_proportions.png')); check('it saves as its own picture', gotPng, await page.$eval('#bSaveInfo', e => e.textContent) + ' | ' + fs.readdirSync(dl).join(' '));
await page.click('#bChartSame'); await page.click('#bChartPose'); await page.screenshot({ path: path.join(out, 'app_body_proportions.png') });
await page.click('[data-view="sheet"]'); const sheetSum = await sum(), vb = await page.$eval('#bView', e => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
await dragBy(vb, 80, 60); await dragBy([vb[0] - 200, vb[1] - 100], 50, 50);
check('Hands and feet shows the sheet: the bar in the gripping hand and the green ground marks under the feet', (await BS()).view === 'sheet' && sheetSum !== chartSum && (await teal()) > 500 && (await green()) > 100);
check('dragging on the guide or the sheet does not pose anything', (await page.evaluate(() => JSON.stringify(Body.B.keys))) === keysBefore && (await sum()) === sheetSum);
await page.screenshot({ path: path.join(out, 'app_body_hands_feet.png') });
await page.reload(); await page.click('[data-mode="body"]'); bs = await BS();
check('the view and the new switches are remembered', bs.view === 'sheet' && bs.limits && !bs.trails && bs.name === 'Stop short');
await page.click('#bWalk'); bs = await BS();
check('picking a motion goes back to the mannequin', bs.view === 'pose' && bs.name === 'Walk cycle' && /Contact/.test(await lbl()));
await page.click('#bDemo'); x13 = await fx(13); await page.mouse.click(x13[0], x13[1] + 22); await page.click('#bOnion'); await page.screenshot({ path: path.join(out, 'app_body.png') });
check('no script errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log('\n' + (fails ? fails + ' FAILED' : 'ALL PASSED')); process.exit(fails ? 1 : 0);
