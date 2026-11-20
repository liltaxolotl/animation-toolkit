/*BODY-START*/
// The mannequin's math. Side view, facing right, measured in head heights, y up, ground at 0.
// Every angle is in degrees and reads the same way: 0 = at rest, positive = the natural bend
// (an arm or thigh swings forward, an elbow or knee folds, the torso and head bow forward, toes lift).
// R is the side nearest the viewer, L is the far side.
const BodyMath = (() => {
  const D = Math.PI / 180;
  const PROPS = { head: 1, neck: 0.3, chest: 1.2, waist: 1.1, shoulderDrop: 0.25, upperArm: 1.45, forearm: 1.2, hand: 0.75, thigh: 1.85, shin: 1.75, foot: 0.85, heel: 0.25, ankleH: 0.3 };
  const ANGLES = ['lean', 'spine', 'neck', 'shoulderR', 'elbowR', 'wristR', 'shoulderL', 'elbowL', 'wristL', 'hipR', 'kneeR', 'ankleR', 'hipL', 'kneeL', 'ankleL'];
  const FIELDS = ['x', 'y'].concat(ANGLES), SIDES = ['R', 'L'];
  const dir = a => [Math.sin(a * D), -Math.cos(a * D)];               // 0 = down, 90 = forward, 180 = up
  const ang = (dx, dy) => Math.atan2(dx, -dy) / D;                     // and back again
  const near = (a, ref) => a + 360 * Math.round((ref - a) / 360);      // the same direction, as the number closest to ref
  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
  function ease(t, kind) { t = clamp(t, 0, 1); if (kind === 'linear') return t; if (kind === 'in') return t * t; if (kind === 'out') return 1 - (1 - t) * (1 - t); return t * t * (3 - 2 * t); }

  // pose -> where every joint is (J) and which way every bone points (W)
  function fk(p, props) {
    const P = props || PROPS, J = {}, W = {}, add = (o, a, len) => { const d = dir(a); return [o[0] + d[0] * len, o[1] + d[1] * len]; };
    J.pelvis = [p.x, p.y];
    W.waist = 180 - p.lean; J.spine = add(J.pelvis, W.waist, P.waist);
    W.chest = W.waist - p.spine; J.neck = add(J.spine, W.chest, P.chest);
    W.head = W.chest - p.neck; J.head = add(J.neck, W.head, P.neck + P.head);
    const sh = add(J.spine, W.chest, P.chest - P.shoulderDrop);
    for (const s of SIDES) {
      J['shoulder' + s] = sh.slice();
      W['upperArm' + s] = W.chest + 180 + p['shoulder' + s]; J['elbow' + s] = add(sh, W['upperArm' + s], P.upperArm);
      W['forearm' + s] = W['upperArm' + s] + p['elbow' + s]; J['wrist' + s] = add(J['elbow' + s], W['forearm' + s], P.forearm);
      W['hand' + s] = W['forearm' + s] + p['wrist' + s]; J['hand' + s] = add(J['wrist' + s], W['hand' + s], P.hand);
      W['thigh' + s] = W.waist + 180 + p['hip' + s]; J['knee' + s] = add(J.pelvis, W['thigh' + s], P.thigh);
      W['shin' + s] = W['thigh' + s] - p['knee' + s]; J['ankle' + s] = add(J['knee' + s], W['shin' + s], P.shin);
      W['foot' + s] = W['shin' + s] + 90 + p['ankle' + s];
      const a = J['ankle' + s], al = dir(W['foot' + s]), dn = dir(W['foot' + s] - 90);          // the sole sits ankleH under the ankle
      J['heel' + s] = [a[0] + dn[0] * P.ankleH - al[0] * P.heel, a[1] + dn[1] * P.ankleH - al[1] * P.heel];
      J['toe' + s] = [a[0] + dn[0] * P.ankleH + al[0] * P.foot, a[1] + dn[1] * P.ankleH + al[1] * P.foot];
    }
    return { J, W };
  }
  const lowest = (p, P) => { const J = fk(p, P).J; return Math.min(J.heelR[1], J.toeR[1], J.heelL[1], J.toeL[1]); };
  function stand(P) {
    const p = { x: 0, y: 0, lean: 0, spine: 0, neck: 0, shoulderR: 8, elbowR: 12, wristR: 0, shoulderL: -8, elbowL: 12, wristL: 0, hipR: 5, kneeR: 0, ankleR: -5, hipL: -5, kneeL: 0, ankleL: 5 };
    p.y = -lowest(p, P); return p;
  }
  function clean(p) { const s = stand(), o = {}; for (const k of FIELDS) o[k] = p && Number.isFinite(+p[k]) && p[k] !== null && p[k] !== '' ? +p[k] : s[k]; return o; }

  // two bones from a to the target t: [which way the first bone points, how far the middle joint folds].
  // side = 1 when the second bone folds forward (an elbow), -1 when it folds back (a knee).
  function reach(a, t, l1, l2, side) {
    const dx = t[0] - a[0], dy = t[1] - a[1], d = clamp(Math.hypot(dx, dy), Math.abs(l1 - l2) + 1e-6, l1 + l2 - 1e-6);
    const al = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1)) / D;
    return [ang(dx, dy) - side * al, 180 - Math.acos(clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1)) / D];
  }
  function pullArm(p, s, t, P) {                      // put the wrist on t; the hand keeps its bend
    P = P || PROPS; const f = fk(p, P), side = p['elbow' + s] < 0 ? -1 : 1, r = reach(f.J['shoulder' + s], t, P.upperArm, P.forearm, side), q = Object.assign({}, p);
    q['shoulder' + s] = near(r[0] - f.W.chest - 180, p['shoulder' + s]); q['elbow' + s] = side * r[1]; return q;
  }
  function pullLeg(p, s, t, P, footW) {               // put the ankle on t; the foot keeps pointing the way it was (or the way footW says)
    P = P || PROPS; const f = fk(p, P), side = p['knee' + s] < 0 ? 1 : -1, r = reach(f.J.pelvis, t, P.thigh, P.shin, side), q = Object.assign({}, p);
    q['hip' + s] = near(r[0] - f.W.waist - 180, p['hip' + s]); q['knee' + s] = -side * r[1];
    q['ankle' + s] = near((footW == null ? f.W['foot' + s] : footW) - (f.W.waist + 180 + q['hip' + s] - q['knee' + s]) - 90, p['ankle' + s]); return q;
  }
  function moveHips(p, x, y, plant, P) {             // move the body; with plant the ankles stay where they were
    const f = fk(p, P); let q = Object.assign({}, p, { x, y });
    if (plant) for (const s of SIDES) q = pullLeg(q, s, f.J['ankle' + s], P); return q;
  }
  function leanTo(p, lean) { const q = Object.assign({}, p, { lean }); for (const s of SIDES) q['hip' + s] = p['hip' + s] + lean - p.lean; return q; }   // tip the body, legs stay

  // ---------- time: key poses, the pose on any frame, and stretching or squeezing the timing
  function mix(a, b, t) { const o = {}; for (const k of FIELDS) o[k] = a[k] + (b[k] - a[k]) * t; return o; }
  function poseAt(keys, f, P) {                       // keys sorted by frame; the first and last pose hold outside the motion
    const n = keys.length - 1; if (f <= keys[0].frame) return Object.assign({}, keys[0].pose); if (f >= keys[n].frame) return Object.assign({}, keys[n].pose);
    let i = 0; while (keys[i + 1].frame <= f) i++; const a = keys[i], b = keys[i + 1];
    const t = ease((f - a.frame) / (b.frame - a.frame), a.ease), fa = fk(a.pose, P), fb = fk(b.pose, P); let q = mix(a.pose, b.pose, t);
    for (const s of SIDES) {                              // a foot on the ground in both key poses stays on the ground in between, turning on the part that stays down
      const A = fa.J, Z = fb.J, PP = P || PROPS, dn = (J, n) => Math.abs(J[n + s][1]) < 0.05, piv = dn(A, 'toe') && dn(Z, 'toe') ? 'toe' : dn(A, 'heel') && dn(Z, 'heel') ? 'heel' : touching(A, s) && touching(Z, s) ? 'ankle' : '';
      if (!piv) { const g = fk(q, P), low = Math.min(g.J['heel' + s][1], g.J['toe' + s][1]); if (low < 0) q = pullLeg(q, s, [g.J['ankle' + s][0], g.J['ankle' + s][1] - low], P); continue; }
      const u = A[piv + s], v = Z[piv + s], w0 = fa.W['foot' + s], w = w0 + (near(fb.W['foot' + s], w0) - w0) * t, c = [u[0] + (v[0] - u[0]) * t, u[1] + (v[1] - u[1]) * t];
      if (piv !== 'ankle') { const al = dir(w), d2 = dir(w - 90), k = piv === 'toe' ? -PP.foot : PP.heel; c[0] += -d2[0] * PP.ankleH + al[0] * k; c[1] += -d2[1] * PP.ankleH + al[1] * k; }
      q = pullLeg(q, s, c, P, w); }
    return q;
  }
  const touching = (J, s) => Math.abs(Math.min(J['heel' + s][1], J['toe' + s][1])) < 0.05;
  function retime(frames, speed) {                    // 2 = twice as fast = half the frames; keys never land on the same frame
    const out = []; frames.forEach((f, i) => { let v = frames[0] + Math.round((f - frames[0]) / speed); if (i && v <= out[i - 1]) v = out[i - 1] + 1; out.push(v); }); return out;
  }

  // ---------- balance: where the weight is and what holds it up
  const MASS = { head: 0.08, chest: 0.28, waist: 0.22, upperArm: 0.028, forearm: 0.016, hand: 0.006, thigh: 0.1, shin: 0.0465, foot: 0.0145 };
  function com(p, P) {                                // centre of gravity: every body part weighed by its share of the body
    const J = fk(p, P).J, parts = [[J.neck, J.head, 0.62, MASS.head], [J.spine, J.neck, 0.5, MASS.chest], [J.pelvis, J.spine, 0.5, MASS.waist]];
    for (const s of SIDES) parts.push([J['shoulder' + s], J['elbow' + s], 0.436, MASS.upperArm], [J['elbow' + s], J['wrist' + s], 0.43, MASS.forearm], [J['wrist' + s], J['hand' + s], 0.5, MASS.hand],
      [J.pelvis, J['knee' + s], 0.433, MASS.thigh], [J['knee' + s], J['ankle' + s], 0.433, MASS.shin], [J['heel' + s], J['toe' + s], 0.45, MASS.foot]);
    let x = 0, y = 0, m = 0; for (const [a, b, k, w] of parts) { x += (a[0] + (b[0] - a[0]) * k) * w; y += (a[1] + (b[1] - a[1]) * k) * w; m += w; } return [x / m, y / m];
  }
  function support(p, P) {                            // the stretch of ground the feet cover: [back edge, front edge], or null in the air
    const J = fk(p, P).J; let lo = Infinity, hi = -Infinity;
    for (const s of SIDES) { const h = J['heel' + s], t = J['toe' + s], hd = Math.abs(h[1]) < 0.05, td = Math.abs(t[1]) < 0.05; if (!hd && !td) continue;
      const a = hd ? h[0] : t[0] - 0.25, b = td ? t[0] : h[0] + 0.2; lo = Math.min(lo, a, b); hi = Math.max(hi, a, b); }
    return lo > hi ? null : [lo, hi];
  }
  function balance(p, P) {                            // state: balanced / forward / back (tipping that way) / air. edge = how far inside the nearest edge
    const c = com(p, P), sp = support(p, P); if (!sp) return { com: c, support: null, state: 'air', off: 0, edge: 0, side: '' };
    const off = c[0] < sp[0] ? c[0] - sp[0] : c[0] > sp[1] ? c[0] - sp[1] : 0;
    return { com: c, support: sp, state: off > 0 ? 'forward' : off < 0 ? 'back' : 'balanced', off, edge: Math.min(c[0] - sp[0], sp[1] - c[0]), side: c[0] - sp[0] < sp[1] - c[0] ? 'back' : 'front' };
  }

  // ---------- line of action: one simple curve through the whole pose
  function bezFit(Q) {                                // the cubic curve from the first point to the last that passes closest to the ones between
    const n = Q.length, t = [0]; for (let i = 1; i < n; i++) t.push(t[i - 1] + Math.hypot(Q[i][0] - Q[i - 1][0], Q[i][1] - Q[i - 1][1]));
    const L = t[n - 1] || 1, A = Q[0], Z = Q[n - 1]; let a11 = 0, a12 = 0, a22 = 0; const r1 = [0, 0], r2 = [0, 0];
    for (let i = 1; i < n - 1; i++) { const u = t[i] / L, v = 1 - u, b0 = v * v * v, b1 = 3 * v * v * u, b2 = 3 * v * u * u, b3 = u * u * u; a11 += b1 * b1; a12 += b1 * b2; a22 += b2 * b2;
      for (const k of [0, 1]) { const d = Q[i][k] - b0 * A[k] - b3 * Z[k]; r1[k] += b1 * d; r2[k] += b2 * d; } }
    const det = a11 * a22 - a12 * a12; if (Math.abs(det) < 1e-9) return [A, [A[0] + (Z[0] - A[0]) / 3, A[1] + (Z[1] - A[1]) / 3], [A[0] + (Z[0] - A[0]) * 2 / 3, A[1] + (Z[1] - A[1]) * 2 / 3], Z];
    return [A, [0, 1].map(k => (r1[k] * a22 - r2[k] * a12) / det), [0, 1].map(k => (a11 * r2[k] - a12 * r1[k]) / det), Z];
  }
  function actionLine(p, P) {                         // from the head (or a hand reaching above it) down the spine and out through a leg
    const J = fk(p, P).J; let top = 'head'; for (const s of SIDES) if (J['hand' + s][1] > J[top][1] + 0.3 && J['hand' + s][1] > J.neck[1] + 0.8) top = 'hand' + s;
    let leg = '', best = -1e9; const down = SIDES.filter(s => touching(J, s)), fwd = J[top][0] >= J.pelvis[0] ? 1 : -1;       // the leg on the ground that carries the lean on: the back leg under a forward lean
    for (const s of down.length ? down : SIDES) { const a = J['ankle' + s], d = Math.hypot(J[top][0] - a[0], J[top][1] - a[1]) + 0.6 * fwd * (J.pelvis[0] - a[0]); if (d > best) { best = d; leg = s; } }
    const k = J['knee' + leg], a = J['ankle' + leg], mid = [(k[0] * 2 + J.pelvis[0] + a[0]) / 4, (k[1] * 2 + J.pelvis[1] + a[1]) / 4];
    const pts = (top === 'head' ? [J.head, J.neck] : [J[top], J['elbow' + top.slice(-1)], J.neck]).concat([J.spine, J.pelvis, mid, a]), bez = bezFit(pts);
    const cx = bez[3][0] - bez[0][0], cy = bez[3][1] - bez[0][1], L = Math.hypot(cx, cy) || 1, off = c => ((c[0] - bez[0][0]) * -cy + (c[1] - bez[0][1]) * cx) / (L * L), d1 = off(bez[1]), d2 = off(bez[2]);
    const bend = Math.max(Math.abs(d1), Math.abs(d2)), shape = bend < 0.05 ? 'straight' : d1 * d2 < 0 && Math.min(Math.abs(d1), Math.abs(d2)) > 0.05 ? 'S' : 'C';
    return { top, leg, pts, bez, bend, shape };
  }

  // ---------- other bodies: the same mannequin with other proportions, each measured in its own head heights.
  // heads = how many of its own heads tall; tall = its real size beside the adult, in adult heads (a guess for the stylised ones)
  const body = o => Object.assign({}, PROPS, { girth: 1, headW: 0.4 }, o);
  const BODIES = [
    { id: 'adult', name: 'Adult', heads: 7.5, tall: 7.5, note: 'Halfway up is at the hips. The fingertips reach the middle of the thigh.', P: body({}) },
    { id: 'hero', name: 'Heroic', heads: 8.5, tall: 8.1, note: 'A smaller head and longer legs. Used for heroes and fashion drawings.', P: body({ neck: 0.35, chest: 1.35, waist: 1.2, shoulderDrop: 0.28, upperArm: 1.65, forearm: 1.4, hand: 0.8, thigh: 2.2, shin: 2.1, foot: 0.95, heel: 0.27, girth: 1.05 }) },
    { id: 'teen', name: 'Teen', heads: 7, tall: 6.8, note: 'Almost adult: the head is a little bigger for the body and the legs a little shorter.', P: body({ neck: 0.28, chest: 1.1, waist: 1.02, shoulderDrop: 0.22, upperArm: 1.35, forearm: 1.1, hand: 0.7, thigh: 1.7, shin: 1.6, foot: 0.8, heel: 0.24, girth: 0.92 }) },
    { id: 'child', name: 'Child, about 8', heads: 6, tall: 5.5, note: 'Shorter legs, so halfway up is above the hips. A bigger head for the body.', P: body({ neck: 0.22, chest: 0.95, waist: 0.88, shoulderDrop: 0.2, upperArm: 1.1, forearm: 0.92, hand: 0.6, thigh: 1.4, shin: 1.3, foot: 0.7, heel: 0.2, ankleH: 0.25, girth: 0.8 }) },
    { id: 'toddler', name: 'Toddler', heads: 4, tall: 3.7, note: 'The head is a quarter of the height. Halfway up is near the belly button. Short, soft limbs.', P: body({ neck: 0.1, chest: 0.72, waist: 0.68, shoulderDrop: 0.12, upperArm: 0.62, forearm: 0.52, hand: 0.38, thigh: 0.7, shin: 0.62, foot: 0.48, heel: 0.14, ankleH: 0.18, girth: 0.62 }) },
    { id: 'cartoon', name: 'Cartoon', heads: 3, tall: 4.4, note: 'Stylised: the head is a third of the height, so the face does the acting. Hands and feet stay big.', P: body({ neck: 0.05, chest: 0.55, waist: 0.45, shoulderDrop: 0.1, upperArm: 0.45, forearm: 0.4, hand: 0.32, thigh: 0.42, shin: 0.4, foot: 0.46, heel: 0.12, ankleH: 0.13, girth: 0.55, headW: 0.47 }) },
    { id: 'chibi', name: 'Chibi', heads: 2, tall: 3.1, note: 'Stylised: the head is half the character. The limbs are stubs, so poses have to be big and simple.', P: body({ neck: 0.02, chest: 0.34, waist: 0.26, shoulderDrop: 0.06, upperArm: 0.24, forearm: 0.2, hand: 0.2, thigh: 0.16, shin: 0.14, foot: 0.26, heel: 0.06, ankleH: 0.08, girth: 0.4, headW: 0.5 }) },
    { id: 'lanky', name: 'Lanky', heads: 9.5, tall: 8.3, note: 'Stylised the other way: a tiny head on very long legs and arms.', P: body({ neck: 0.45, chest: 1.3, waist: 1.2, shoulderDrop: 0.3, upperArm: 1.9, forearm: 1.6, hand: 0.85, thigh: 2.75, shin: 2.5, foot: 1.0, heel: 0.28, girth: 0.82 }) }];
  const tallOf = P => fk(stand(P), P).J.head[1];
  function fit(p, P) { const q = Object.assign({}, p); q.y -= lowest(q, P); return q; }       // the same angles on another body, its lowest point on the ground

  // ---------- how far a real joint goes, seen from the side: [least, most] in the pose's own angles
  const LIMITS = { spine: [-30, 50], neck: [-55, 50] };
  for (const s of SIDES) Object.assign(LIMITS, { ['shoulder' + s]: [-55, 180], ['elbow' + s]: [-5, 150], ['wrist' + s]: [-70, 80], ['hip' + s]: [-25, 130], ['knee' + s]: [-5, 150], ['ankle' + s]: [-55, 40] });
  function limits(p) {                                // every joint bent past its range: by = how many degrees past, level = 'stretch' (a little) or 'past'
    const out = []; for (const n in LIMITS) { const [lo, hi] = LIMITS[n], v = near(p[n], (lo + hi) / 2), by = v < lo ? v - lo : v > hi ? v - hi : 0; if (Math.abs(by) > 0.5) out.push({ joint: n, value: v, by, level: Math.abs(by) > 15 ? 'past' : 'stretch' }); }
    return out;
  }

  // ---------- muscles: the main groups, each lying along one side of a bone.
  // flex runs from -1 to 1: above 0 the muscle is bunched up, shorter and fatter (squash); below 0 it is pulled long and thin (stretch); 0 is the standing pose.
  // [name, joint it shows best, bone from, bone to, bone direction, side of the bone (1 = the side dir + 90 points to), start, end, thickness, flex]
  const arc = v => v > 0 ? Math.min(v, 180 - v) / 90 : v / 60;
  const MUSCLES = [
    ['Chest', 'shoulder', 'spine', 'neck', 'chest', -1, 0.42, 0.92, 0.3, p => arc(p.shoulderR)], ['Upper back', 'shoulder', 'spine', 'neck', 'chest', 1, 0.15, 0.9, 0.26, p => p.shoulderR > 0 ? -p.shoulderR / 170 : -p.shoulderR / 55],
    ['Abs', 'spine', 'pelvis', 'spine', 'waist', -1, 0.1, 1.05, 0.26, p => p.spine / 40], ['Lower back', 'spine', 'pelvis', 'spine', 'waist', 1, 0.2, 1.0, 0.22, p => -p.spine / 40]];
  const LIMB = [
    ['Shoulder', 'shoulder', 'shoulder', 'elbow', 'upperArm', 0, -0.06, 0.34, 0.3, (p, s) => Math.abs(p['shoulder' + s]) / 120],
    ['Biceps', 'elbow', 'shoulder', 'elbow', 'upperArm', 1, 0.3, 0.92, 0.2, (p, s) => p['elbow' + s] / 130], ['Triceps', 'elbow', 'shoulder', 'elbow', 'upperArm', -1, 0.25, 0.95, 0.2, (p, s) => -p['elbow' + s] / 130],
    ['Inner forearm', 'wrist', 'elbow', 'wrist', 'forearm', 1, 0.05, 0.7, 0.17, (p, s) => p['wrist' + s] / 70], ['Outer forearm', 'wrist', 'elbow', 'wrist', 'forearm', -1, 0.05, 0.7, 0.17, (p, s) => -p['wrist' + s] / 70],
    ['Glutes', 'hip', 'pelvis', 'knee', 'thigh', -1, -0.1, 0.26, 0.34, (p, s) => -p['hip' + s] / 80],
    ['Quads', 'knee', 'pelvis', 'knee', 'thigh', 1, 0.12, 0.95, 0.28, (p, s) => -p['knee' + s] / 135], ['Hamstrings', 'knee', 'pelvis', 'knee', 'thigh', -1, 0.3, 0.97, 0.24, (p, s) => p['knee' + s] / 135 - Math.max(0, p['hip' + s]) / 150],
    ['Calf', 'ankle', 'knee', 'ankle', 'shin', -1, 0.04, 0.62, 0.24, (p, s) => -p['ankle' + s] / 40], ['Shin', 'ankle', 'knee', 'ankle', 'shin', 1, 0.08, 0.7, 0.12, (p, s) => p['ankle' + s] / 40]];
  const HALF = { chest: 0.5, waist: 0.47, upperArm: 0.16, forearm: 0.135, thigh: 0.23, shin: 0.17 };      // half the thickness of each body part
  function muscles(p, P) {                            // every muscle as a blob: from a to b, t thick, with its flex
    P = P || PROPS; const { J, W } = fk(p, P), out = [], G = P.girth || 1;
    const one = (m, s) => { const A = J[m[2] === 'pelvis' || m[2] === 'spine' ? m[2] : m[2] + s], Bn = J[m[3] === 'spine' || m[3] === 'neck' ? m[3] : m[3] + s], w = W[m[4] === 'chest' || m[4] === 'waist' ? m[4] : m[4] + s], d = dir(w), nr = dir(w + 90);
      const len = Math.hypot(Bn[0] - A[0], Bn[1] - A[1]), flex = clamp(m[9](p, s), -1, 1), L = len * (m[7] - m[6]) * (1 - 0.2 * flex), mid = len * (m[6] + m[7]) / 2, off = m[5] * HALF[m[4]] * G * 0.72, c = [A[0] + d[0] * mid + nr[0] * off, A[1] + d[1] * mid + nr[1] * off];
      out.push({ name: m[0], joint: m[1], side: s, flex, t: m[8] * G * (1 + 0.55 * flex), a: [c[0] - d[0] * L / 2, c[1] - d[1] * L / 2], b: [c[0] + d[0] * L / 2, c[1] + d[1] * L / 2] }); };
    for (const m of MUSCLES) one(m, ''); for (const s of SIDES) for (const m of LIMB) one(m, s); return out;
  }

  // ---------- hands: the palm seen flat on, one unit = the width of the palm, wrist at 0,0, fingers up, thumb on the right.
  // A finger curls toward you, so a curled bone looks shorter (and folds back down over the palm once it has curled past 90).
  const KNUCKLE = [[0.36, 1.0], [0.12, 1.07], [-0.12, 1.02], [-0.35, 0.9]], FINGER = [[0.42, 0.26, 0.2], [0.47, 0.3, 0.21], [0.43, 0.28, 0.2], [0.33, 0.2, 0.17]], SPLAY = [9, 1, -7, -17], THUMB = [0.4, 0.3, 0.24];
  const FIST = [88, 100, 70], HANDS = [
    { id: 'relaxed', name: 'Relaxed', note: 'At rest the fingers curl a little, the little finger most.', curl: [[15, 25, 15], [20, 30, 18], [25, 35, 20], [30, 40, 22]], spread: 0.8, thumb: [40, 12, 0] },
    { id: 'open', name: 'Open', note: 'The knuckles sit on an arc, and the fingers fan out from the wrist.', curl: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], spread: 1.6, thumb: [62, 0, 0], guide: true },
    { id: 'fist', name: 'Fist', note: 'The fingers fold onto the palm and the thumb locks across them.', curl: [FIST, FIST, FIST, FIST], spread: 0.3, thumb: [35, 75, 0] },
    { id: 'grip', name: 'Gripping', note: 'The fingers wrap one way and the thumb the other. The knuckle line tilts along the bar.', curl: [[70, 75, 40], [70, 75, 40], [72, 78, 40], [75, 80, 40]], spread: 0.3, thumb: [30, 62, 0], bar: true },
    { id: 'point', name: 'Pointing', note: 'One straight finger. The rest make a loose fist, with the thumb over them.', curl: [[0, 0, 0], FIST, FIST, FIST], spread: 0.3, thumb: [28, 70, 0] },
    { id: 'pinch', name: 'Pinching', note: 'The thumb tip meets the fingertip. The other fingers stay soft.', curl: [[60, 70, 30], [28, 32, 18], [22, 26, 16], [18, 24, 14]], spread: 0.9, thumb: [10, 22, 50] },
    { id: 'thumb', name: 'Thumbs up', note: 'A fist, turned, with the thumb straight up.', curl: [FIST, FIST, FIST, FIST], spread: 0.3, thumb: [78, 0, 0], rot: -78 },
    { id: 'wave', name: 'Waving', note: 'The wrist leads and the fingertips drag behind, so the hand bends like a leaf as it changes direction.', curl: [[4, 6, 4], [4, 6, 4], [5, 7, 4], [6, 8, 5]], spread: 1.3, thumb: [55, 4, 0], rot: 20, wave: true }];
  function hand(g, rot) {                             // where every knuckle and fingertip is: { palm, fingers (4 x 4 points), thumb (4 points), tips }
    const r = (rot == null ? g.rot || 0 : rot) * D, cs = Math.cos(r), sn = Math.sin(r), R = q => [q[0] * cs + q[1] * sn, -q[0] * sn + q[1] * cs];
    const fingers = KNUCKLE.map((k, i) => { const a = SPLAY[i] * g.spread * D, u = [Math.sin(a), Math.cos(a)], pts = [k.slice()]; let fl = 0;
      FINGER[i].forEach((len, j) => { fl += g.curl[i][j]; const q = pts[j], c = len * Math.cos(fl * D); pts.push([q[0] + u[0] * c, q[1] + u[1] * c]); }); return pts.map(R); });
    const th = [[0.44, 0.28]], lift = Math.cos(g.thumb[2] * D); THUMB.forEach((len, j) => { const a = (g.thumb[0] - g.thumb[1] * j) * D, q = th[j]; th.push([q[0] + Math.sin(a) * len * lift, q[1] + Math.cos(a) * len * lift]); });
    const palm = [[-0.3, 0], [0.3, 0], [0.52, 0.34], [0.5, 0.98], [0.12, 1.1], [-0.14, 1.06], [-0.47, 0.9], [-0.43, 0.3]].map(R), thumb = th.map(R);
    return { palm, fingers, thumb, tips: fingers.map(f => f[3]).concat([thumb[3]]), arm: [R([0, -0.62]), R([0, 0.04])] };
  }

  // ---------- feet, from the side. One unit = heel to ball. pitch = how far the heel is lifted, toes = how far the toes bend up from the sole,
  // shin = how far the shin leans forward, air = off the ground
  const FEET = [
    { id: 'flat', name: 'Flat', note: 'Standing: the weight is spread between the heel and the ball of the foot.', pitch: 0, toes: 0, shin: 0 },
    { id: 'heel', name: 'Heel strike', note: 'The contact pose of a walk: the heel lands first with the toes up.', pitch: -22, toes: 8, shin: -18 },
    { id: 'push', name: 'Push off', note: 'The heel peels up and the foot bends at the ball. The toes stay flat on the ground.', pitch: 48, toes: 48, shin: 28 },
    { id: 'tiptoe', name: 'Tiptoe', note: 'All the weight on the ball and the toes, heel high.', pitch: 68, toes: 68, shin: 6 },
    { id: 'pointed', name: 'Pointed', note: 'In the air with the toes stretched: the top of the foot carries on the line of the shin.', pitch: 60, toes: -16, shin: 18, air: true },
    { id: 'flexed', name: 'Flexed', note: 'In the air with the toes pulled up, ready to land on the heel.', pitch: -18, toes: 24, shin: 0, air: true }];
  function foot(g) {                                  // the outline of the back of the foot and of the toes, the ankle, the top of the shin stub, and which parts touch the ground
    const rot = (q, deg) => { const a = deg * D, c = Math.cos(a), s = Math.sin(a); return [q[0] * c - q[1] * s, q[0] * s + q[1] * c]; };
    let rear = [[-0.72, 0], [-0.8, 0.12], [-0.68, 0.44], [-0.36, 0.44], [-0.1, 0.2], [0, 0.14], [0, 0]].map(q => rot(q, -g.pitch)), toes = [[0, 0], [0, 0.14], [0.26, 0.09], [0.31, 0.04], [0.28, 0]].map(q => rot(q, g.toes - g.pitch));
    let ankle = rot([-0.52, 0.36], -g.pitch), top = [ankle[0] + Math.sin(g.shin * D) * 0.95, ankle[1] + Math.cos(g.shin * D) * 0.95];
    const low = Math.min(...rear.concat(toes).map(q => q[1])), up = g.air ? 0.45 - low : -low, mv = q => [q[0], q[1] + up]; rear = rear.map(mv); toes = toes.map(mv); ankle = mv(ankle); top = mv(top);
    const on = q => Math.abs(q[1]) < 0.02; return { rear, toes, ankle, top, heelDown: on(rear[0]), ballDown: on(rear[6]), toesDown: on(toes[4]) && on(toes[0]) };
  }

  // ---------- loose things (hair, a scarf, a coat tail): chains that hang from the body and are dragged along by it.
  // Worked out by replaying the motion from its first frame, so any frame always gives the same answer.
  const TRAILS = [['hair', 5, 0.26], ['scarf', 5, 0.3], ['coat', 4, 0.34]];
  function trailRig(p, P) {                           // where each chain is tied on: the back of the head, the side of the neck, the side of the hip
    const { J, W } = fk(p, P), up = dir(W.head), hb = dir(W.head + 90), cu = dir(W.chest), wu = dir(W.waist), k = P.neck + P.head / 2, hc = [J.neck[0] + up[0] * k, J.neck[1] + up[1] * k];
    return { hair: [hc[0] + up[0] * 0.15 + hb[0] * 0.5, hc[1] + up[1] * 0.15 + hb[1] * 0.5], scarf: [J.neck[0] - cu[0] * 0.12, J.neck[1] - cu[1] * 0.12], coat: [J.pelvis[0] + wu[0] * 0.3, J.pelvis[1] + wu[1] * 0.3], head: hc };
  }
  function trails(keys, f, P, loop) {                 // -> [{ name, pts }] on frame f. loop = the motion is a cycle, so start from a chain that is already swinging
    P = P || PROPS; const f0 = keys[0].frame, len = keys[keys.length - 1].frame - f0, h = 0.5, G = 0.1 * h * h, DAMP = 0.94;
    const at = t => poseAt(keys, loop && len > 0 ? f0 + (((t - f0) % len) + len) % len : t, P), start = loop ? f0 - len : f0, steps = Math.max(0, Math.round((Math.min(f, f0 + len + 240) - start) / h));
    let rig = trailRig(at(start), P); const ch = TRAILS.map(([name, n, seg]) => { const a = rig[name], pts = []; for (let i = 0; i <= n; i++) pts.push([a[0], a[1] - i * seg]); return { name, seg, pts, old: pts.map(q => q.slice()) }; });
    const stepAll = () => { for (const c of ch) { c.pts[0] = rig[c.name].slice();
      for (let i = 1; i < c.pts.length; i++) { const q = c.pts[i], o = c.old[i], vx = (q[0] - o[0]) * DAMP, vy = (q[1] - o[1]) * DAMP; c.old[i] = q.slice(); q[0] += vx; q[1] += vy - G; }
      for (let it = 0; it < 8; it++) for (let i = 1; i < c.pts.length; i++) { const u = c.pts[i - 1], q = c.pts[i], dx = q[0] - u[0], dy = q[1] - u[1], d = Math.hypot(dx, dy) || 1e-6, e = (d - c.seg) / d, ku = i === 1 ? 0 : 0.5;      // each link pulls both its ends back to its length
        u[0] += dx * e * ku; u[1] += dy * e * ku; q[0] -= dx * e * (1 - ku); q[1] -= dy * e * (1 - ku);
        if (c.name === 'hair') { const hx = q[0] - rig.head[0], hy = q[1] - rig.head[1], hd = Math.hypot(hx, hy); if (hd < 0.5 && hd > 1e-6) { q[0] = rig.head[0] + hx / hd * 0.5; q[1] = rig.head[1] + hy / hd * 0.5; } }
        if (q[1] < 0.03) q[1] = 0.03; } } };
    for (let i = 0; i < 24; i++) stepAll();           // let them hang still first
    for (let i = 1; i <= steps; i++) { rig = trailRig(at(start + i * h), P); stepAll(); }
    return ch.map(c => ({ name: c.name, pts: c.pts }));
  }

  // ---------- motions to study, planned the way an animator would: keys first, then breakdowns, then inbetweens
  const swap = p => { const q = Object.assign({}, p); for (const n of ['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle']) { q[n + 'R'] = p[n + 'L']; q[n + 'L'] = p[n + 'R']; } return q; };
  function ankleOn(x, w, by, P) {                     // where the ankle is when the foot points along w (90 = level) and its heel or toe touches the ground at x
    P = P || PROPS; if (by === 'flat') return [x, P.ankleH]; const al = dir(w), dn = dir(w - 90), u = by === 'toe' ? -P.foot : P.heel;
    return [x - dn[0] * P.ankleH + al[0] * u, -dn[1] * P.ankleH + al[1] * u];
  }
  function posed(o, P) {                              // a pose from a short description: hips, torso, arms as [shoulder, elbow, wrist], legs as [ankle spot, foot direction]
    let p = Object.assign(stand(P), { x: o.x || 0, y: o.y, lean: o.lean || 0, spine: o.spine || 0, neck: o.neck || 0 });
    for (const s of SIDES) { const a = o['arm' + s]; if (a) { p['shoulder' + s] = a[0]; p['elbow' + s] = a[1]; p['wrist' + s] = a[2] || 0; } }
    for (const s of SIDES) { const l = o['leg' + s]; if (l) p = pullLeg(p, s, l[0], P, l[1]); if (o['reach' + s]) p = pullArm(p, s, o['reach' + s], P); }
    return p;
  }
  const K = (frame, kind, label, ease, pose) => ({ frame, kind, label, ease, pose });
  // a two-step cycle walked on the spot. Four poses make one step (the near foot lands, the body sinks, passes over it, rises); the second step is the mirror.
  // front / back = [where the heel or toe touches, which way the foot points, 'heel' | 'toe' | 'flat'] for the two feet on the contact pose.
  // The planted foot slides back at an even speed. A pose can give sup (the planted foot's direction once its heel lifts), legR / legL (a foot in the air: [ankle spot, direction]).
  function gait(o, P) {
    P = P || PROPS; const n = o.n, at = o.at || [0, n / 4, n / 2, 3 * n / 4], kinds = o.kinds || ['key', 'inbetween', 'breakdown', 'inbetween'];
    const front = [ankleOn(o.front[0], o.front[1], o.front[2], P), o.front[1]], back = o.back ? [ankleOn(o.back[0], o.back[1], o.back[2], P), o.back[1]] : null;
    const step = o.step || (front[0][0] - back[0][0]) / n, sup = i => front[0][0] - step * at[i];
    const half = o.poses.map((ph, i) => posed({ x: ph.x, y: ph.y, lean: ph.lean, spine: ph.spine, neck: ph.neck, armR: ph.armR, armL: ph.armL,
      legR: i === 0 ? front : ph.legR || [[sup(i), (ph.sup || 90) === 90 ? P.ankleH : ankleOn(0, ph.sup, 'toe', P)[1]], ph.sup || 90], legL: ph.legL || back }, P)), keys = [];
    for (let i = 0; i < 8; i++) { const h = i % 4; keys.push(K(1 + Math.round(at[h]) + (i < 4 ? 0 : n), kinds[h], o.labels[h], 'linear', i < 4 ? half[h] : swap(half[h]))); }
    keys.push(K(1 + 2 * n, kinds[0], o.labels[0], 'linear', Object.assign({}, half[0])));
    return { name: o.name, about: o.about, prop: null, keys };
  }
  const STEP = ['Contact', 'Down', 'Passing', 'Up'];
  const walk = P => gait({ name: 'Walk cycle', n: 12, front: [1.1, 112, 'heel'], back: [-0.85, 68, 'toe'], labels: STEP,          // 12 frames a step
    about: 'The two contact poses are the keys. Passing is the breakdown between them. Down and up are the inbetweens that give the walk its bounce: lowest just after contact, highest just after passing.',
    poses: [{ y: 3.74, lean: 4, armR: [-26, 14], armL: [28, 30] }, { y: 3.6, lean: 6, spine: 2, armR: [-32, 16], armL: [34, 34], legL: [[-1.3, 1.02], 54] },
      { y: 3.87, lean: 4, armR: [-4, 14], armL: [6, 18], legL: [[0.05, 0.8], 72] }, { y: 3.96, lean: 3, spine: -1, armR: [18, 24], armL: [-16, 14], sup: 76, legL: [[0.95, 0.8], 100] }] }, P);
  const happyWalk = P => gait({ name: 'Happy walk', n: 10, at: [0, 3, 5, 8], front: [1.2, 118, 'heel'], back: [-0.9, 60, 'toe'], labels: STEP,
    about: 'The same four poses as the plain walk, pushed: chest out, head up, a deeper down and a higher up (up on the toes), big arm swings and a high knee on the passing pose. It is also quicker: 10 frames a step.',
    poses: [{ y: 3.72, lean: -2, spine: -6, neck: -8, armR: [-42, 16], armL: [40, 66] }, { y: 3.5, lean: 0, spine: -3, neck: -4, armR: [-48, 20], armL: [46, 76], legL: [[-1.35, 1.15], 48] },
      { y: 3.86, lean: -2, spine: -7, neck: -10, armR: [-6, 20], armL: [8, 24], legL: [[0.25, 1.3], 70] }, { y: 4.1, lean: -3, spine: -9, neck: -12, armR: [30, 52], armL: [-32, 16], sup: 62, legL: [[1.1, 1.0], 104] }] }, P);
  const sneak = P => gait({ name: 'Sneak', n: 24, front: [1.7, 70, 'toe'], back: [-0.7, 90, 'flat'], labels: ['Toe touches', 'Weight over', 'Knee up', 'Reach'],
    about: 'Slow, 24 frames a step, and low. The toe touches first while the body hangs back, then the weight rolls forward over the foot. The knee comes up high and the foot reaches out again. The arms stay up in front and the back stays curled.',
    poses: [{ x: -0.6, y: 3.2, lean: -8, spine: 14, neck: 2, armR: [48, 112, 40], armL: [62, 104, 40] },
      { x: 0.2, y: 2.95, lean: 24, spine: 14, neck: -22, armR: [56, 118, 45], armL: [70, 108, 45], legL: [ankleOn(-0.28, 50, 'toe', P), 50] },
      { x: 0.1, y: 3.1, lean: 18, spine: 14, neck: -18, armR: [60, 112, 42], armL: [52, 116, 42], legL: [[0.6, 1.5], 60] },
      { x: -0.2, y: 3.2, lean: 2, spine: 14, neck: -6, armR: [64, 106, 40], armL: [46, 114, 40], legL: [[1.25, 0.95], 62] }] }, P);
  const tiredWalk = P => gait({ name: 'Tired walk', n: 16, front: [0.75, 100, 'heel'], back: [-0.6, 78, 'toe'], labels: STEP,
    about: 'Slow, 16 frames a step, and heavy. The back is rounded, the head hangs, the arms hang and hardly swing, the steps are short and the feet barely leave the ground. Almost no bounce: the up pose is hardly higher than the down.',
    poses: [{ y: 3.6, lean: 8, spine: 22, neck: 28, armR: [24, 6], armL: [34, 8] }, { y: 3.5, lean: 10, spine: 24, neck: 30, armR: [22, 6], armL: [36, 8], legL: [[-0.95, 0.62], 66] },
      { y: 3.62, lean: 8, spine: 22, neck: 28, armR: [28, 6], armL: [30, 8], legL: [[-0.1, 0.45], 84] }, { y: 3.64, lean: 7, spine: 21, neck: 27, armR: [33, 8], armL: [25, 6], sup: 84, legL: [[0.55, 0.42], 96] }] }, P);
  const run = P => gait({ name: 'Run', n: 8, step: 0.6, front: [0.75, 104, 'heel'], labels: ['Contact', 'Down', 'Push off', 'In the air'],
    about: 'Fast: 8 frames a step. A run has a pose with both feet off the ground, and a walk never does. The body leans into it, the arms are bent and pump hard, and the back heel kicks up high.',
    poses: [{ y: 3.5, lean: 14, spine: 4, neck: -8, armR: [-50, 88], armL: [48, 100], legL: [[-1.5, 1.55], 20] }, { y: 3.3, lean: 16, spine: 6, neck: -8, armR: [-22, 92], armL: [20, 96], legL: [[-0.75, 1.5], 10] },
      { y: 3.72, lean: 18, spine: 2, neck: -10, armR: [52, 98], armL: [-48, 84], sup: 48, legL: [[1.0, 1.75], 70] },
      { y: 3.9, lean: 15, spine: 2, neck: -8, armR: [44, 95], armL: [-40, 86], legR: [[-1.75, 1.35], 25], legL: [[1.35, 1.25], 96] }] }, P);
  function jump(P) {                                  // crouch (squash), push off (stretch), up, down, land on the toes, squash, settle
    P = P || PROPS; const s0 = stand(P), J = fk(s0, P).J, aR = J.ankleR, aL = J.ankleL, flat = { legR: [aR, 90], legL: [aL, 90] }, mk = o => posed(o, P);
    const toes = w => ({ legR: [ankleOn(aR[0] + P.foot, w, 'toe', P), w], legL: [ankleOn(aL[0] + P.foot, w, 'toe', P), w] });      // heels up, the toes stay where they were
    const antic = mk(Object.assign({ x: -0.9, y: 2.45, lean: 38, spine: 12, neck: -20, armR: [-52, 25], armL: [-46, 22] }, flat));
    const push = mk(Object.assign({ x: 0.1, y: 4.3, lean: 6, spine: -6, neck: -10, armR: [150, 12], armL: [140, 14] }, toes(38)));
    const top = mk({ x: 0.1, y: 6.0, lean: 4, spine: -2, neck: -4, armR: [165, 20], armL: [155, 22], legR: [[0.55, 3.25], 60], legL: [[0.05, 3.1], 50] });
    const fall = mk({ x: 0.1, y: 5.0, lean: 6, spine: 2, neck: 0, armR: [115, 25], armL: [105, 26], legR: [[0.45, 1.55], 55], legL: [[-0.15, 1.5], 50] });
    const land = mk(Object.assign({ x: 0.05, y: 3.95, lean: 8, spine: 4, neck: 4, armR: [70, 30], armL: [60, 30] }, toes(52)));
    const squash = mk(Object.assign({ x: -0.85, y: 2.6, lean: 32, spine: 12, neck: -14, armR: [40, 30], armL: [30, 30] }, flat));
    return { name: 'Jump', prop: null, about: 'Squash, stretch, squash. The crouch is the anticipation and the body is at its shortest. At push off it is at its longest, up on the toes with the arms thrown up. It slows to the top, speeds up on the way down, lands on the toes and squashes again before it settles.',
      keys: [K(1, 'key', 'Stand', 'inout', s0), K(9, 'key', 'Anticipation', 'in', antic), K(13, 'breakdown', 'Push off', 'out', push), K(19, 'key', 'Top of the jump', 'in', top), K(23, 'inbetween', 'Reaching down', 'linear', fall),
        K(25, 'key', 'Land', 'out', land), K(30, 'breakdown', 'Squash', 'inout', squash), K(42, 'key', 'Settle', 'inout', Object.assign({}, s0))] };
  }
  function stopShort(P) {                             // one big step and a dead stop: the body stops, the arms (and anything loose) carry on
    P = P || PROPS; const s0 = Object.assign(stand(P), { x: -2 }), J = fk(s0, P).J, toe = ankleOn(J.ankleL[0] + P.foot, 40, 'toe', P), mk = o => posed(o, P), h = stand(P).y;
    const antic = mk({ x: -2.15, y: h - 0.12, lean: -4, spine: -2, neck: 2, armR: [20, 20], armL: [10, 18], legR: [J.ankleR, 90], legL: [J.ankleL, 90] });
    const step = mk({ x: -1.0, y: 3.7, lean: 14, spine: 4, neck: -6, armR: [-40, 20], armL: [45, 40], legR: [[-0.1, 0.75], 100], legL: [ankleOn(J.ankleL[0] + P.foot, 55, 'toe', P), 55] });
    const stop = mk({ x: 0, y: 3.72, lean: 6, spine: 3, neck: -2, armR: [-35, 25], armL: [40, 45], legR: [[0.45, P.ankleH], 90], legL: [toe, 40] });
    const carry = mk({ x: 0.05, y: 3.8, lean: 2, spine: -2, neck: 2, armR: [55, 30, 22], armL: [70, 35, 22], legR: [[0.45, P.ankleH], 90], legL: [[-0.7, 0.7], 70] });
    const feet = { legR: [[0.45, P.ankleH], 90], legL: [[-0.31, P.ankleH], 90] };
    const back = mk(Object.assign({ x: 0.05, y: h - 0.05, lean: -2, spine: -1, armR: [-22, 8, -15], armL: [-28, 8, -15] }, feet)), small = mk(Object.assign({ x: 0.05, y: h - 0.04, armR: [16, 16, 8], armL: [6, 16, 8] }, feet));
    const rest = mk(Object.assign({ x: 0.05, y: h - 0.04, armR: [8, 12], armL: [-8, 12] }, feet));
    return { name: 'Stop short', prop: null, trails: true, about: 'Overlapping action. The body stops dead on the pose called Body stops, but not everything stops with it: the arms carry on forward, swing back and settle a little later, and the wrists drag behind the elbows. Tick Hair and scarf to see loose things do the same, later still.',
      keys: [K(1, 'key', 'Stand', 'inout', s0), K(5, 'inbetween', 'Anticipation', 'in', antic), K(10, 'breakdown', 'Step', 'linear', step), K(14, 'key', 'Body stops', 'out', stop), K(18, 'breakdown', 'Arms carry on', 'inout', carry),
        K(23, 'inbetween', 'Swing back', 'inout', back), K(29, 'inbetween', 'Small swing', 'inout', small), K(36, 'key', 'Settle', 'inout', rest), K(50, 'key', 'Hold', 'inout', Object.assign({}, rest))] };
  }
  function pickUp(P) {                                // bend the knees, hips back, grab, legs push back up
    P = P || PROPS; const s0 = stand(P), J = fk(s0, P).J, legs = { legR: [J.ankleR, 90], legL: [J.ankleL, 90] }, mk = o => posed(Object.assign({}, legs, o), P), ball = { r: 0.3, x: 1.6, y: 0.3 }, heelUp = w => [ankleOn(J.ankleL[0] + P.foot, w, 'toe', P), w];      // the back heel peels up in the deep bend
    const antic = mk({ x: -0.05, y: s0.y - 0.02, lean: -3, spine: -2, neck: 18, armR: [-8, 14], armL: [-14, 12] });
    const bend = mk({ x: -0.3, y: 3.15, lean: 30, spine: 10, neck: 14, armR: [40, 24], armL: [22, 28], legL: heelUp(84) });
    const grab = mk({ x: -0.45, y: 1.95, lean: 48, spine: 18, neck: -4, legL: heelUp(62), reachR: [ball.x - 0.32, ball.y + 0.55], reachL: [ball.x - 0.5, ball.y + 0.42] });
    const push = mk({ x: -0.25, y: 3.0, lean: 26, spine: 8, neck: 2, armR: [30, 62], armL: [22, 72], legL: heelUp(80) });
    const settle = mk({ x: 0.03, y: s0.y - 0.01, lean: -3, spine: -2, neck: 6, armR: [22, 102], armL: [15, 108] });
    const hold = mk({ y: s0.y - 0.01, neck: 4, armR: [24, 92], armL: [18, 98] });
    return { name: 'Pick something up', about: 'Stand, grab and holding it are the keys. The breakdowns show how it gets there: hips go back on the way down, legs push on the way up. A small anticipation starts it and a settle ends it.', prop: Object.assign({ grab: 24, hand: 'R' }, ball), keys: [K(1, 'key', 'Stand', 'inout', s0), K(6, 'inbetween', 'Anticipation', 'in', antic), K(14, 'breakdown', 'Hips back', 'linear', bend),
      K(24, 'key', 'Grab', 'linear', grab), K(30, 'key', 'Grip', 'in', Object.assign({}, grab)), K(40, 'breakdown', 'Legs push', 'out', push), K(48, 'inbetween', 'Settle', 'inout', settle), K(54, 'key', 'Holding it', 'inout', hold)] };
  }
  function raiseHand(P) {                             // a small dip the other way first, the elbow leads, the hand overshoots and settles
    P = P || PROPS; const s0 = stand(P), J = fk(s0, P).J, legs = { legR: [J.ankleR, 90], legL: [J.ankleL, 90] }, mk = o => posed(Object.assign({ y: s0.y }, legs, o), P);
    const antic = mk({ y: s0.y - 0.05, lean: 1, spine: 3, neck: 4, armR: [-16, 22, 8], armL: [-6, 12] }), lead = mk({ spine: -2, neck: -3, armR: [82, 118, -30], armL: [-10, 13] });
    const over = mk({ spine: -6, neck: -9, armR: [166, 5, 22], armL: [-13, 14] }), up = mk({ spine: -3, neck: -6, armR: [150, 22, 8], armL: [-9, 12] });
    return { name: 'Raise a hand', about: 'Stand and hand up are the keys. In the breakdown the elbow leads and the hand drags behind. The anticipation dips the other way first, then the hand overshoots and settles back.', prop: null, keys: [K(1, 'key', 'Stand', 'inout', s0), K(5, 'inbetween', 'Anticipation', 'in', antic), K(11, 'breakdown', 'Elbow leads', 'linear', lead),
      K(17, 'inbetween', 'Overshoot', 'inout', over), K(22, 'key', 'Hand up', 'inout', up), K(34, 'key', 'Hold', 'inout', Object.assign({}, up))] };
  }
  function starter(P) {                               // crouch, stretch up, settle
    const a = stand(P); let c = leanTo(moveHips(a, -0.5, a.y - 0.85, true, P), 30); c = Object.assign(c, { spine: 14, neck: -14, shoulderR: -38, elbowR: 30, shoulderL: -54, elbowL: 24 });
    const u = Object.assign({}, a, { spine: -7, neck: -16, shoulderR: 170, elbowR: 8, shoulderL: 156, elbowL: 12 });
    return { name: 'Crouch and stretch', about: 'Three key poses to practise on: drag the joints, slide the marks on the timeline, try the speed slider.', prop: null, keys: [K(1, 'key', 'Stand', 'inout', a), K(13, 'key', 'Crouch', 'inout', c), K(21, 'key', 'Stretch', 'out', u), K(37, 'key', 'Settle', 'inout', stand(P))] };
  }
  function propAt(prop, keys, f, P) {                 // where the thing being picked up is: on its spot until the grab frame, then it goes with the hand
    if (!prop.grab || f < prop.grab) return [prop.x, prop.y]; const h = prop.hand === 'L' ? 'L' : 'R', mid = q => { const J = fk(q, P).J; return [(J['wrist' + h][0] + J['hand' + h][0]) / 2, (J['wrist' + h][1] + J['hand' + h][1]) / 2]; };
    const g = mid(poseAt(keys, prop.grab, P)), m = mid(poseAt(keys, f, P)); return [prop.x + m[0] - g[0], prop.y + m[1] - g[1]];
  }
  const KINDS = ['key', 'breakdown', 'inbetween'], presets = { walk, pickUp, raiseHand, starter, happyWalk, sneak, tiredWalk, run, jump, stopShort };
  return { PROPS, ANGLES, FIELDS, KINDS, dir, ang, near, ease, fk, lowest, stand, clean, reach, pullArm, pullLeg, moveHips, leanTo, mix, poseAt, retime,
    com, support, balance, bezFit, actionLine, swap, ankleOn, posed, gait, presets, propAt, BODIES, tallOf, fit, LIMITS, limits, muscles, HANDS, hand, FEET, foot, trails };
})();
/*BODY-END*/
