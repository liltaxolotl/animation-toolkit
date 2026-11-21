// ============================== POSE FROM A DRAWING ==============================
// Fits the 3D figure (window.Fig3D) to joints marked on a drawing, and draws it back over the drawing as a ghost.
//
//   fitPose(Fig3D, {joints: {name: [x, y] | null}, W, H, camera: {fov, height} | null, flips: {limb: true|false}})
//     -> {pose, camera: {pos, right, up, back, theta, center, f}, place, error: {joint: px}, confidence: 0..1, notes: [..],
//         joints2d: {name: [x, y]} (where the fitted figure puts each joint), depth: {limb: 'toward' | 'away'}}
//   A flip (arm_l, arm_r, leg_l, leg_r) means "the other way from what the fit guessed". camera.height (metres) is a
//   soft wish: among facings that fit about equally well, the one with the camera nearest that height wins.
//   renderGhost(Fig3D, fit, W, H) -> W x H transparent canvas, registered to the drawing
//
// Joint names (l = the character's left): head, neck, chest, pelvis, shoulder_l/r, elbow_l/r, wrist_l/r, hip_l/r,
// knee_l/r, ankle_l/r, toe_l/r. Any can be null (hidden or not marked).
//
// How it works, in plain steps:
//   1. Facing: the torso joints (shoulders, hips, neck, chest, pelvis, head) of the standing figure are turned through
//      every yaw and tilt; for each, the best 2D scale, roll and shift are solved exactly (a 2D similarity fit), and the
//      turn with the smallest leftover wins. Left and right labels settle front versus back.
//   2. Depth of each bone: a bone drawn shorter than it really is points toward or away from the camera by exactly the
//      missing length (foreshortening). Which way is the one thing a single drawing cannot say, so: her flip if she set
//      one, else whichever way keeps the joints inside a real body's range, and the note says it was a guess.
//   3. Limbs are bent with the real hinges: the elbow or knee bend comes from the shoulder-to-wrist distance, the upper
//      bone swings the wrist into place, then turns about that line so the elbow lands where she drew it.
//   4. The camera is a plain lens (default 35 degrees across the long side) at the distance that makes the figure the
//      size she drew it; the error per joint is measured through that same camera.
const DEFAULT_FOV = 35;
const MAP = {                                     // drawing joint -> how to find it on the figure
  pelvis: ['pelvis'], chest: ['spine_03'], neck: ['neck_01', 'head', 0.5], head: ['head', 'head_leaf', 1.9],
  shoulder_l: ['upperarm_l'], elbow_l: ['lowerarm_l'], wrist_l: ['hand_l'], shoulder_r: ['upperarm_r'], elbow_r: ['lowerarm_r'], wrist_r: ['hand_r'],
  hip_l: ['thigh_l'], knee_l: ['calf_l'], ankle_l: ['foot_l'], toe_l: ['ball_l'], hip_r: ['thigh_r'], knee_r: ['calf_r'], ankle_r: ['foot_r'], toe_r: ['ball_r']
};
const TORSO = { shoulder_l: 1, shoulder_r: 1, hip_l: 1, hip_r: 1, pelvis: 1, chest: 0.8, neck: 0.8, head: 0.4 };
const LIMBS = [                                   // [name, upper bone, mid bone, end bone, top joint, mid joint, end joint]
  ['arm_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'shoulder_l', 'elbow_l', 'wrist_l'],
  ['arm_r', 'upperarm_r', 'lowerarm_r', 'hand_r', 'shoulder_r', 'elbow_r', 'wrist_r'],
  ['leg_l', 'thigh_l', 'calf_l', 'foot_l', 'hip_l', 'knee_l', 'ankle_l'],
  ['leg_r', 'thigh_r', 'calf_r', 'foot_r', 'hip_r', 'knee_r', 'ankle_r']
];
const SAY = { arm_l: 'its left arm', arm_r: 'its right arm', leg_l: 'its left leg', leg_r: 'its right leg' };

function api(F) {
  const T = F.THREE, B = () => F.F.bones;
  const wpos = n => B()[n].getWorldPosition(new T.Vector3());
  const point = name => { const m = MAP[name]; if (!m) return null; if (m.length === 1) return wpos(m[0]); const a = wpos(m[0]), b = wpos(m[1]); return a.clone().add(b.sub(a).multiplyScalar(m[2])); };
  const upd = () => F.F.root.updateMatrixWorld(true);
  function setWorldQ(name, qw) { const b = B()[name], pq = b.parent.getWorldQuaternion(new T.Quaternion()); b.quaternion.copy(pq.invert().multiply(qw)); upd(); }
  function rotateWorld(name, q) { const b = B()[name]; setWorldQ(name, q.clone().multiply(b.getWorldQuaternion(new T.Quaternion()))); }
  function swing(name, from, to, share) { let q = new T.Quaternion().setFromUnitVectors(from.clone().normalize(), to.clone().normalize()); if (share != null && share < 1) q = new T.Quaternion().slerp(q, share); rotateWorld(name, q); }
  return { T, B, wpos, point, upd, setWorldQ, rotateWorld, swing };
}

// 2D similarity (no mirror) from model points A to drawn points B, weighted. y is up in both.
function similarity(A, Bp, w) {
  let sw = 0, ma = [0, 0], mb = [0, 0];
  for (let i = 0; i < A.length; i++) { sw += w[i]; ma[0] += w[i] * A[i][0]; ma[1] += w[i] * A[i][1]; mb[0] += w[i] * Bp[i][0]; mb[1] += w[i] * Bp[i][1]; }
  ma = ma.map(v => v / sw); mb = mb.map(v => v / sw);
  let sxx = 0, sxy = 0, va = 0;
  for (let i = 0; i < A.length; i++) { const a = [A[i][0] - ma[0], A[i][1] - ma[1]], b = [Bp[i][0] - mb[0], Bp[i][1] - mb[1]]; sxx += w[i] * (a[0] * b[0] + a[1] * b[1]); sxy += w[i] * (a[0] * b[1] - a[1] * b[0]); va += w[i] * (a[0] * a[0] + a[1] * a[1]); }
  const th = Math.atan2(sxy, sxx), c = Math.cos(th), s = Math.sin(th), k = va > 0 ? (c * sxx + s * sxy) / va : 1;
  const map = a => [k * (c * a[0] - s * a[1]) + mb[0] - k * (c * ma[0] - s * ma[1]), k * (s * a[0] + c * a[1]) + mb[1] - k * (s * ma[0] + c * ma[1])];
  let res = 0; for (let i = 0; i < A.length; i++) { const p = map(A[i]); res += w[i] * ((p[0] - Bp[i][0]) ** 2 + (p[1] - Bp[i][1]) ** 2); }
  return { th, k, map, res: res / sw };
}

export function fitPose(F, opt) {
  const { T, B, wpos, point, upd, swing, rotateWorld } = api(F), J = opt.joints || {}, W = opt.W, H = opt.H, flips = opt.flips || {};
  const notes = [], keepLimits = F.S.limits;
  const img = n => J[n] ? [J[n][0], -J[n][1]] : null;           // drawing pixels, y flipped up
  const given = Object.keys(MAP).filter(n => J[n]);
  if (given.length < 3) return { pose: F.getPose(), camera: null, place: null, error: {}, confidence: 0, notes: ['Mark at least three joints (shoulders and hips are the most useful) and it can fit a pose.'] };

  const torsoGiven = Object.keys(TORSO).filter(n => J[n]);
  if (torsoGiven.length < 2) return { pose: F.getPose(), camera: null, place: null, error: {}, confidence: 0, joints2d: {}, depth: {}, notes: ['Mark at least two of the shoulders, hips, neck, chest and pelvis. The fit needs them to tell which way the body faces.'] };

  F.standing(); F.S.limits = false; upd();
  const P0 = wpos('pelvis'), restQ = { hand_l: B().hand_l.quaternion.clone(), hand_r: B().hand_r.quaternion.clone() };
  // ---------- 1. facing: yaw, tilt (grid then fine), with roll, scale and shift solved in 2D
  const torso = torsoGiven, X = torso.map(n => point(n).sub(P0)), Bp = torso.map(img), w = torso.map(n => TORSO[n]);
  const qOf = (yaw, tilt, roll) => { const qz = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), roll || 0), qx = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), tilt), qy = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), yaw); return qz.multiply(qx).multiply(qy); };
  const D2R = Math.PI / 180, fov = (opt.camera && opt.camera.fov) || DEFAULT_FOV, long = Math.max(W, H), f = (long / 2) / Math.tan(fov / 2 * D2R), cx = W / 2, cy = H / 2;
  // the camera for one facing: a plain lens across the long side, at the distance that makes the figure her size
  function camFor(r) {
    const Q = qOf(r.yaw, r.tilt, r.th), Qi = Q.clone().invert(), Dist = f / r.k, pImg = r.map([0, 0]);   // where the pelvis lands (y up)
    const xc = (pImg[0] - cx) / f * Dist, yc = (pImg[1] + cy) / f * Dist;        // pImg y is -v, so v - cy = -(pImg[1]) - cy
    return { Q, Qi, Dist, pos: P0.clone().sub(new T.Vector3(xc, yc, -Dist).applyQuaternion(Qi)) };
  }
  // her camera height wish, as a cost in the same units as the 2D fit: half a metre off costs as much as joints that
  // miss by 3% of the body's height on average
  const wantH = opt.camera && isFinite(opt.camera.height) && opt.camera.height > 0 ? +opt.camera.height : null;
  const score = r => { if (wantH == null) return r.res; const hgt = F.F.height * r.k, dy = (camFor(r).pos.y - wantH) / 0.5; return r.res + (0.03 * hgt) ** 2 * dy * dy; };
  const tryOne = (yaw, tilt) => { const q = qOf(yaw, tilt), A = X.map(v => { const c = v.clone().applyQuaternion(q); return [c.x, c.y]; }); const r = { yaw, tilt, ...similarity(A, Bp, w) }; r.score = score(r); return r; };
  let best = null; const TMAX = wantH != null ? 80 : 60;
  for (let y = -180; y < 180; y += 6) for (let t = -TMAX; t <= TMAX; t += 10) { const r = tryOne(y * D2R, t * D2R); if (!best || r.score < best.score) best = r; }
  for (let y = -6; y <= 6; y += 1) for (let t = -10; t <= 10; t += 2) { const r = tryOne(best.yaw + y * D2R, best.tilt + t * D2R); if (r.score < best.score) best = r; }
  if (torso.length < 3) notes.push('Only ' + torso.length + ' torso joints marked, so which way the body faces is a rough guess. Shoulders and hips pin it down.');
  // second best facing well away from the winner: if nearly as good, the facing is ambiguous
  let alt = null; for (let y = -180; y < 180; y += 6) { const d = Math.abs(((y * D2R - best.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI); if (d < 50 * D2R) continue; const r = tryOne(y * D2R, best.tilt); if (!alt || r.res < alt.res) alt = r; }
  const k = best.k, figH = F.heads().height, cam0 = camFor(best), Q = cam0.Q, Qi = cam0.Qi, camPos = cam0.pos;   // world -> camera space, and back
  if (wantH != null && Math.abs(camPos.y - wantH) > 0.6) notes.push('The camera ended up ' + camPos.y.toFixed(1) + ' m up, not the ' + wantH.toFixed(1) + ' m you picked: the torso you drew reads better from there. Set the height to "Let the fit guess" to see its own pick.');
  const toCam = v => v.clone().sub(camPos).applyQuaternion(Q);
  const project = v => { const c = toCam(v); return [cx + f * c.x / -c.z, cy - f * c.y / -c.z]; };
  // drawn 2D vector between two joints -> 3D direction in world with the foreshortened depth, both signs
  function dirs(a, b, len, depthNow) {
    const pa = J[a], pb = J[b]; if (!pa || !pb) return null;
    const dx = (pb[0] - pa[0]) / k, dy = -(pb[1] - pa[1]) / k, flat = Math.hypot(dx, dy);
    const stretch = flat / len, dz = stretch >= 1 ? 0 : Math.sqrt(len * len - flat * flat);
    const mk = s => new T.Vector3(dx, dy, s * dz).normalize().applyQuaternion(Qi);
    return { toward: mk(1), away: mk(-1), stretch, flat, dz, near: depthNow >= 0 ? 1 : -1 };
  }
  // ---------- 2a. spine and head (share the bend over the three back bones)
  if (J.pelvis && (J.neck || J.chest)) {
    const top = J.neck ? 'neck' : 'chest', cur = point(top).sub(wpos('pelvis')), d = dirs('pelvis', top, cur.length(), toCam(point(top)).z - toCam(wpos('pelvis')).z);
    // each back bone takes an even share of what is left (a third, then half the rest, then the rest), so the whole
    // spine lands on the drawn bend instead of about 70% of it
    if (d) { const want = d.near > 0 ? d.toward : d.away; [['spine_01', 1 / 3], ['spine_02', 1 / 2], ['spine_03', 1]].forEach(([n, sh]) => { const now = point(top).sub(wpos('pelvis')); swing(n, now, want, sh); }); }
  }
  if (J.head && (J.neck || J.chest)) {
    const base = J.neck ? 'neck' : 'chest', cur = point('head').sub(point(base)), d = dirs(base, 'head', cur.length(), toCam(point('head')).z - toCam(point(base)).z);
    if (d) { const want = d.near > 0 ? d.toward : d.away; swing('neck_01', point('head').sub(wpos('neck_01')), want.clone().multiplyScalar(cur.length()).add(point(base)).sub(wpos('neck_01'))); }
  }
  // ---------- 2b. limbs
  const choices = {}, depth = {};
  for (const [limb, up, mid, end, ja, jb, jc] of LIMBS) {
    // which way is "in front of the body": the body's own forward, flat on the floor (the hips are not turned by the fit)
    const toe = wpos('ball_l').sub(wpos('foot_l')); toe.y = 0; const fwdW = toe.lengthSq() > 1e-8 ? toe.normalize() : new T.Vector3(0, 0, 1);
    if (!J[ja] || (!J[jb] && !J[jc])) continue;
    const S0 = wpos(up), L1 = wpos(mid).distanceTo(S0), L2 = wpos(end).distanceTo(wpos(mid));
    const d1 = J[jb] ? dirs(ja, jb, L1, 0) : null, d2 = J[jb] && J[jc] ? dirs(jb, jc, L2, 0) : null, dEnd = !J[jb] ? dirs(ja, jc, L1 + L2, 0) : null;
    for (const [d, seg, len] of [[d1, up, L1], [d2, mid, L2]]) if (d && d.stretch > 1.12) notes.push((SAY[limb] || limb) + ': the ' + (seg.startsWith('upper') || seg.startsWith('thigh') ? 'upper' : 'lower') + ' part is drawn ' + Math.round((d.stretch - 1) * 100) + '% longer than the figure\'s. A proportion difference, or a stretch on purpose? The fit keeps it flat to the camera.');
    // every toward / away pair is tried; the one that stays inside a real body's range is the guess, and her flip
    // takes the opposite of the guess on each foreshortened part
    const cands = [];
    for (const s1 of d1 ? [1, -1] : [0]) for (const s2 of d2 ? [1, -1] : [0]) cands.push([s1, s2]);
    const keep = F.getPose(); let bestC = null; const tried = [];
    for (const [s1, s2] of cands) {
      F.setPose(keep); upd();
      let E, Wp;
      if (d1) { E = S0.clone().add((s1 > 0 ? d1.toward : d1.away).clone().multiplyScalar(L1)); Wp = d2 ? E.clone().add((s2 > 0 ? d2.toward : d2.away).clone().multiplyScalar(L2)) : null; }
      else { const dd = dEnd; Wp = S0.clone().add((dd.near > 0 ? dd.toward : dd.away).clone().multiplyScalar(Math.min(L1 + L2, dd.flat))); }
      if (Wp) {
        F.reach(end, Wp); upd();
        if (E) {                                    // turn the upper bone about shoulder-to-wrist so the elbow lands where drawn
          const ax = wpos(end).sub(S0).normalize(), e0 = wpos(mid).sub(S0), e1 = E.clone().sub(S0);
          e0.sub(ax.clone().multiplyScalar(e0.dot(ax))); e1.sub(ax.clone().multiplyScalar(e1.dot(ax)));
          if (e0.length() > 1e-4 && e1.length() > 1e-4) { const a = Math.atan2(ax.dot(e0.clone().cross(e1)), e0.dot(e1)); rotateWorld(up, new T.Quaternion().setFromAxisAngle(ax, a)); }
        }
      } else if (E) { swing(up, wpos(mid).sub(S0), E.clone().sub(S0)); }
      // the hand is not fitted (no joint says how it turns), so it goes back to a relaxed wrist on the new forearm.
      // Leaving it turned the old way made the range check judge the arm by a wrist twist nobody drew.
      if (/^hand_/.test(end)) { B()[end].quaternion.copy(restQ[end]); upd(); }
      // the range cost of the shoulder or hip and the elbow or knee, in degrees past a real body's range, plus a
      // gentle lean toward the hand or foot being in front of the body (up to 10 degrees' worth for fully behind),
      // which only decides it when both ways are inside the range
      const over = F.overLimits().filter(o => o.bone === up || o.bone === mid).reduce((a, o) => a + o.by, 0);
      const behind = Math.max(0, -wpos(end).sub(S0).dot(fwdW)) / (L1 + L2), cost = over + 10 * behind;
      const c = { s1, s2, over, cost, pose: F.getPose() }; tried.push(c);
      if (!bestC || cost < bestC.cost - 1e-6) bestC = c;
    }
    // a part drawn at nearly full length has no real toward or away, so a flip leaves it alone. 0.4 of the length in
    // depth is about 8% shorter on the page: less than that is camera perspective and proportions, not a choice
    const deep1 = d1 && d1.dz > 0.4 * L1, deep2 = d2 && d2.dz > 0.4 * L2, flipped = !!flips[limb];
    if (flipped && (deep1 || deep2)) {
      const w1 = deep1 ? -bestC.s1 : bestC.s1, w2 = deep2 ? -bestC.s2 : bestC.s2, c = tried.find(t => t.s1 === w1 && t.s2 === w2);
      if (c) { if (c.over > bestC.over + 2) notes.push((SAY[limb] || limb) + ' is flipped the way you set it. That way bends it further past a real body\'s range, which can be on purpose.'); bestC = c; }
    }
    F.setPose(bestC.pose); upd();
    const guessed = !flipped && (deep1 || deep2);
    const word = s => s > 0 ? 'toward' : s < 0 ? 'away' : 'flat';
    choices[limb] = { upper: word(bestC.s1), lower: word(bestC.s2), guessed, flipped };
    // the part that is most foreshortened says which way the hand or foot goes
    depth[limb] = deep2 && (!deep1 || d2.dz / L2 > d1.dz / L1) ? word(bestC.s2) : deep1 ? word(bestC.s1) : 'flat';
    if (guessed) notes.push((SAY[limb] || limb) + ' is foreshortened, and a drawing cannot say toward or away from the camera, so it took the way that stays inside a real body\'s range (' + choices[limb].upper + (d2 ? ', then ' + choices[limb].lower : '') + '). Flip it if that is wrong.');
    if (bestC.over > 2) notes.push((SAY[limb] || limb) + ' only fits by bending past a real body\'s range. That can be a choice; the ringed joints show where.');
  }
  // feet: point the toes
  for (const s of ['l', 'r']) if (J['ankle_' + s] && J['toe_' + s]) { const a = wpos('foot_' + s), b = wpos('ball_' + s), d = dirs('ankle_' + s, 'toe_' + s, a.distanceTo(b), toCam(b).z - toCam(a).z); if (d) swing('foot_' + s, b.clone().sub(a), d.near > 0 ? d.toward : d.away); }
  F.S.limits = keepLimits; upd();

  // ---------- 3. how well it fits, through the same camera
  const error = {}, joints2d = {}; let sum = 0, n = 0;
  for (const j of Object.keys(MAP)) { const p = project(point(j)); joints2d[j] = [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]; }
  for (const j of given) { const p = joints2d[j], e = Math.hypot(p[0] - J[j][0], p[1] - J[j][1]); error[j] = Math.round(e * 10) / 10; sum += e; n++; }
  const drawnH = figH * k, mean = sum / Math.max(1, n), rel = mean / Math.max(1, drawnH);
  const ambiguous = alt && alt.res < best.res * 1.25 && torso.length < 4;
  let confidence = Math.max(0, Math.min(1, 1 - rel * 6)) * Math.min(1, given.length / 10) * (ambiguous ? 0.6 : 1) * (torso.length >= 4 ? 1 : 0.7);
  confidence = Math.round(confidence * 100) / 100;
  if (ambiguous) notes.unshift('The torso fits two ways about equally well, so which way the body turns is unsure. Marking both shoulders and both hips settles it.');
  const worst = Object.entries(error).sort((a, b) => b[1] - a[1])[0];
  if (worst && worst[1] > drawnH * 0.06) notes.push('The ' + worst[0].replace('_l', ' (its left)').replace('_r', ' (its right)') + ' is ' + Math.round(worst[1]) + ' px from where the figure can put it. Either the drawing stretches there, or that joint is marked on the wrong side.');
  const camera = { pos: camPos.toArray(), right: new T.Vector3(1, 0, 0).applyQuaternion(Qi).toArray(), up: new T.Vector3(0, 1, 0).applyQuaternion(Qi).toArray(), back: new T.Vector3(0, 0, 1).applyQuaternion(Qi).toArray(), theta: Math.atan((long / 2) / f), center: [cx, cy], f, fov };
  return { pose: F.getPose(), camera, place: { x: 0, z: 0, height: F.F.height, yaw: 0 }, error, confidence, notes, joints2d, depth, choices, facing: { yaw: best.yaw / D2R, tilt: best.tilt / D2R, roll: best.th / D2R }, scale: k };
}

// The fitted figure drawn over the drawing: a W x H transparent canvas. The figure's own pose is put back afterwards.
export function renderGhost(F, fit, W, H) {
  if (!fit || !fit.camera) return null;
  const keep = F.getPose(), long = Math.max(W, H), N = Math.min(4096, long), sc = N / long;
  F.setPose(fit.pose);
  const sq = F.renderThrough({ pos: fit.camera.pos, right: fit.camera.right, up: fit.camera.up, back: fit.camera.back, theta: fit.camera.theta, N, place: fit.place, outlinePx: 1.6 * N / 1000 });
  F.setPose(keep);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  if (sq) c.getContext('2d').drawImage(sq, fit.camera.center[0] - long / 2, fit.camera.center[1] - long / 2, long, long);
  void sc; return c;
}

// where every joint of a fitted figure lands on the drawing (for drawing the ghost's dots and for tests)
export function projectJoints(F, fit) {
  if (!fit || !fit.camera) return {};
  const { T, point } = api(F), keep = F.getPose(); F.setPose(fit.pose);
  const Qi = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(new T.Vector3(...fit.camera.right), new T.Vector3(...fit.camera.up), new T.Vector3(...fit.camera.back))), Q = Qi.clone().invert(), C = new T.Vector3(...fit.camera.pos);
  const out = {}; for (const n of Object.keys(MAP)) { const c = point(n).sub(C).applyQuaternion(Q); out[n] = [fit.camera.center[0] + fit.camera.f * c.x / -c.z, fit.camera.center[1] - fit.camera.f * c.y / -c.z]; }
  F.setPose(keep); return out;
}
export const JOINT_NAMES = Object.keys(MAP);
