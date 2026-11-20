// ============================== BODY MODE ==============================
const Body = (() => {
  const M = BodyMath, P = M.PROPS, KEY = 'animtk-body', FPS = 24, SIDES = ['R', 'L'], EASES = ['inout', 'in', 'out', 'linear'];
  const B = { keys: [], cur: 1, sel: 'elbowR', playing: false, loop: true, onion: false, onionMode: 'keys', onionN: 1, speed: 1, ik: true, plant: true, zoom: 1, cx: 0, cy: 4.5, name: '', about: '', prop: null, action: false, balance: false, pivots: false, limits: true, muscles: false, trails: false, view: 'pose', chartSame: false, chartPose: false };
  const view = $('#bView'), ctx = view.getContext('2d'), tl = $('#bTime'), tctx = tl.getContext('2d');
  const active = () => $('#mode-body').classList.contains('on');
  const OUT = '#0e0d11', NEAR = '#ece8f4', MID = '#cbc5d8', FAR = '#7f7a90', BEFORE = '#4d8dff', AFTER = '#ffa23a', ACC = '#ff8fb8', GOLD = '#ffd84d', GREEN = '#2fbf71', RED = '#ff5560', CYAN = '#58d6e8', BALL = '#3cc7b4';
  const LIMOK = '#7fe0a8', LIMWARN = '#ffc061', LIMBAD = '#ff3d6e', TCOL = { hair: '#b58cff', scarf: '#ff7aa8', coat: '#6f8fe0' }, TWIDE = { hair: 0.24, scarf: 0.2, coat: 0.3 }, VIEWS = ['pose', 'chart', 'sheet'], FLAGS = ['loop', 'onion', 'ik', 'plant', 'action', 'balance', 'pivots', 'limits', 'muscles', 'trails', 'chartSame', 'chartPose'];
  const KCOL = { key: '#ff5560', breakdown: '#4d8dff', inbetween: '#2fbf71' }, KNAME = { key: 'key pose', breakdown: 'breakdown', inbetween: 'inbetween' };       // same colours as the Timing tab
  let tf = null, ttf = null, drag = null, tdrag = null, raf = 0, undo = [], note = '', sliding = false;

  // which angle each joint owns, where it pivots, and which way a drag turns it
  const LABEL = { lean: 'Hips (whole body lean)', spine: 'Spine', neck: 'Neck' };
  const ACT = { lean: ['pelvis', -1], spine: ['spine', -1], neck: ['neck', -1] };
  const OWN = { pelvis: 'lean', spine: 'spine', neck: 'neck', head: 'neck', shoulderR: 'shoulderR' };
  const DOTACT = { pelvis: 'move', spine: 'lean', neck: 'spine', head: 'neck', shoulderR: '' };
  for (const s of SIDES) {
    const w = s === 'R' ? 'Near ' : 'Far ';
    Object.assign(LABEL, { ['shoulder' + s]: w + 'shoulder', ['elbow' + s]: w + 'elbow', ['wrist' + s]: w + 'wrist', ['hip' + s]: w + 'hip', ['knee' + s]: w + 'knee', ['ankle' + s]: w + 'ankle' });
    Object.assign(ACT, { ['shoulder' + s]: ['shoulder' + s, 1], ['elbow' + s]: ['elbow' + s, 1], ['wrist' + s]: ['wrist' + s, 1], ['hip' + s]: ['pelvis', 1], ['knee' + s]: ['knee' + s, -1], ['ankle' + s]: ['ankle' + s, 1] });
    Object.assign(OWN, { ['elbow' + s]: 'elbow' + s, ['wrist' + s]: 'wrist' + s, ['hand' + s]: 'wrist' + s, ['knee' + s]: 'knee' + s, ['ankle' + s]: 'ankle' + s, ['toe' + s]: 'ankle' + s });
    Object.assign(DOTACT, { ['elbow' + s]: 'shoulder' + s, ['wrist' + s]: 'arm' + s, ['hand' + s]: 'wrist' + s, ['knee' + s]: 'hip' + s, ['ankle' + s]: 'leg' + s, ['toe' + s]: 'ankle' + s });
  }
  const armDots = s => ['hand' + s, 'wrist' + s, 'elbow' + s], legDots = s => ['toe' + s, 'ankle' + s, 'knee' + s];
  const DOTS = [...armDots('R'), 'shoulderR', ...legDots('R'), 'head', 'neck', 'spine', 'pelvis', ...legDots('L'), ...armDots('L')];     // front first
  const armBones = s => [['shoulder' + s, 'elbow' + s, 0.32, 'shoulder' + s], ['elbow' + s, 'wrist' + s, 0.27, 'elbow' + s], ['wrist' + s, 'hand' + s, 0.2, 'wrist' + s]];
  const legBones = s => [['pelvis', 'knee' + s, 0.46, 'hip' + s], ['knee' + s, 'ankle' + s, 0.34, 'knee' + s], ['ankle' + s, 'toe' + s, 0.3, 'ankle' + s], ['ankle' + s, 'heel' + s, 0.3, 'ankle' + s]];
  const BONE = { lean: ['waist', P.waist], spine: ['chest', P.chest], neck: ['head', P.neck + P.head] };       // the bone each joint turns, and its length
  for (const s of SIDES) Object.assign(BONE, { ['shoulder' + s]: ['upperArm' + s, P.upperArm], ['elbow' + s]: ['forearm' + s, P.forearm], ['wrist' + s]: ['hand' + s, P.hand], ['hip' + s]: ['thigh' + s, P.thigh], ['knee' + s]: ['shin' + s, P.shin], ['ankle' + s]: ['foot' + s, P.foot] });
  const BONES = [...armBones('R'), ...legBones('R'), ['neck', 'head', 0.8, 'neck'], ['spine', 'neck', 1.0, 'spine'], ['pelvis', 'spine', 0.95, 'lean'], ...legBones('L'), ...armBones('L')];

  // ---------- key poses
  const sortKeys = () => B.keys.sort((a, b) => a.frame - b.frame);
  const first = () => B.keys[0].frame, last = () => B.keys[B.keys.length - 1].frame;
  const keyAt = f => B.keys.findIndex(k => k.frame === Math.round(f));
  const pose = f => M.poseAt(B.keys, f == null ? B.cur : f);
  const cycle = () => { const a = B.keys[0].pose, b = B.keys[B.keys.length - 1].pose; return B.keys.length > 2 && M.FIELDS.every(k => Math.abs(a[k] - b[k]) < 0.01); };
  const snap = () => JSON.stringify({ keys: B.keys, cur: Math.round(B.cur), prop: B.prop, name: B.name, about: B.about });
  function pushUndo() { undo.push(snap()); if (undo.length > 60) undo.shift(); }
  function doUndo() { const u = undo.pop(); if (!u) return; if (B.playing) stop(); const o = JSON.parse(u); B.keys = o.keys; B.cur = o.cur; B.prop = o.prop || null; B.name = o.name || ''; B.about = o.about || ''; note = 'Undone'; sync(); }
  function ensureKey() {                               // the key pose on this frame, made from the inbetween if there was none
    const f = Math.round(B.cur); B.cur = f; const i = keyAt(f); if (i >= 0) return B.keys[i];
    let prev = null; for (const k of B.keys) if (k.frame < f) prev = k;
    const k = { frame: f, ease: prev ? prev.ease : 'inout', kind: 'key', label: '', pose: pose(f) }; B.keys.push(k); sortKeys(); note = 'New key pose at frame ' + f; return k;
  }
  function fitView() {                                 // zoom out just enough that the whole motion stays in the picture (a jump goes high, a big step goes wide)
    let x0 = 9, x1 = -9, y1 = 0; for (let f = first(); f <= last(); f++) { const J = M.fk(pose(f)).J; for (const n in J) { x0 = Math.min(x0, J[n][0]); x1 = Math.max(x1, J[n][0]); y1 = Math.max(y1, J[n][1]); } }
    B.zoom = Math.min(1, 10.8 / (y1 + 1.2), 9 / (x1 - x0 + 1.5)); B.cy = 4.5 / B.zoom; B.cx = x0 < -4 / B.zoom || x1 > 4 / B.zoom ? (x0 + x1) / 2 : 0;
  }
  function loadPreset(id) { const m = M.presets[id](); B.keys = m.keys; B.prop = m.prop; B.name = m.name; B.about = m.about || ''; B.cur = B.keys[0].frame; B.speed = 1; if (m.trails) B.trails = true; B.view = 'pose'; fitView(); }
  const r2 = v => Math.round(v * 100) / 100;
  function motionJSON() { return { kind: 'animtk-body-motion', version: 1, fps: FPS, name: B.name, about: B.about, prop: B.prop, keys: B.keys.map(k => { const pose = {}; for (const n of M.FIELDS) pose[n] = r2(k.pose[n]); return { frame: k.frame, kind: k.kind, label: k.label || '', ease: k.ease, pose }; }) }; }
  function loadMotion(j) {
    if (!j || !Array.isArray(j.keys) || !j.keys.length) return false; const seen = {};
    B.keys = j.keys.map(k => ({ frame: Math.max(1, Math.round(+k.frame) || 1), ease: EASES.includes(k.ease) ? k.ease : 'inout', kind: M.KINDS.includes(k.kind) ? k.kind : 'key', label: k.label ? String(k.label).slice(0, 24) : '', pose: M.clean(k.pose) }))
      .sort((a, b) => a.frame - b.frame).filter(k => !seen[k.frame] && (seen[k.frame] = 1));
    const pr = j.prop; B.prop = pr && [pr.x, pr.y, pr.r].every(v => typeof v === 'number' && isFinite(v)) ? { x: pr.x, y: pr.y, r: pr.r, grab: Math.max(0, Math.round(+pr.grab) || 0), hand: pr.hand === 'L' ? 'L' : 'R' } : null;
    B.name = j.name ? String(j.name).slice(0, 60) : ''; B.about = j.about ? String(j.about).slice(0, 400) : ''; B.cur = B.keys[0].frame; B.speed = 1; return true;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify({ motion: motionJSON(), ui: Object.assign({ onionMode: B.onionMode, onionN: B.onionN, view: B.view }, Object.fromEntries(FLAGS.map(n => [n, B[n]]))) })); } catch (e) {} }

  // ---------- the picture
  function fitCanvas(c) { const dpr = window.devicePixelRatio || 1, r = c.parentElement.getBoundingClientRect(), w = Math.round(r.width * dpr), h = Math.round(r.height * dpr); if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } return dpr; }
  const scr = p => [tf.ox + p[0] * tf.s, tf.oy - p[1] * tf.s], wld = m => [(m[0] - tf.ox) / tf.s, (tf.oy - m[1]) / tf.s];
  function headShape(g, f, Q) { Q = Q || P; const d = M.dir(f.W.head), n = f.J.neck, k = Q.neck + Q.head / 2, c = scr([n[0] + d[0] * k, n[1] + d[1] * k]); g.beginPath(); g.ellipse(c[0], c[1], Q.head / 2 * tf.s, (Q.headW || 0.4) * tf.s, Math.atan2(-d[1], d[0]), 0, 7); }
  function figure(g, f, Q, mus) {                      // Q = the body's proportions (the adult if left out), mus = draws the muscles of each part as it is laid down
    Q = Q || P; const s = tf.s, dpr = tf.dpr, J = f.J, W = f.W, S = n => scr(J[n]), G = Q.girth || 1, F = Q.foot / 0.85;
    const seg = (a, b, wd, col) => { g.lineCap = 'round'; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.strokeStyle = OUT; g.lineWidth = wd * G * s + 3 * dpr; g.stroke(); g.strokeStyle = col; g.lineWidth = wd * G * s; g.stroke(); };
    const from = (n, a, u, v) => { const d = M.dir(a), e = M.dir(a - 90), p = J[n]; return scr([p[0] + d[0] * u + e[0] * (v || 0), p[1] + d[1] * u + e[1] * (v || 0)]); };
    const arm = (sd, col) => { seg(S('shoulder' + sd), S('elbow' + sd), 0.32, col); seg(S('elbow' + sd), S('wrist' + sd), 0.27, col); seg(S('wrist' + sd), S('hand' + sd), 0.2, col); };
    const leg = (sd, col) => {
      seg(S('pelvis'), S('knee' + sd), 0.46, col); seg(S('knee' + sd), S('ankle' + sd), 0.34, col);
      const a = W['foot' + sd], n = 'ankle' + sd, h = Q.ankleH, pts = [from(n, a, -Q.heel, h), from(n, a, Q.foot, h), from(n, a, Q.foot * 0.62, h - 0.2 * F), from(n, a, 0.15 * F, -0.08 * F), from(n, a, -0.15 * F, -0.08 * F), from(n, a, -Q.heel - 0.02 * F, h - 0.12 * F)];
      g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.lineJoin = 'round';
      g.strokeStyle = OUT; g.lineWidth = 0.1 * F * s + 3 * dpr; g.stroke(); g.strokeStyle = col; g.lineWidth = 0.1 * F * s; g.stroke(); g.fillStyle = col; g.fill();
    };
    arm('L', FAR); leg('L', FAR); if (mus) mus('L');
    seg(S('pelvis'), S('spine'), 0.95, MID); seg(S('spine'), from('spine', W.chest, Q.chest * 0.65), 1.02, MID); seg(S('neck'), from('neck', W.head, Q.neck + 0.1), 0.3, MID);
    const k = Q.neck + Q.head / 2, hw = (Q.headW || 0.4) - 0.04, nose = [from('neck', W.head, k + 0.06, hw), from('neck', W.head, k - 0.04, hw + 0.2), from('neck', W.head, k - 0.16, hw)];
    g.beginPath(); nose.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.lineJoin = 'round'; g.strokeStyle = OUT; g.lineWidth = 3 * dpr; g.stroke(); g.fillStyle = MID; g.fill();
    headShape(g, f, Q); g.strokeStyle = OUT; g.lineWidth = 3 * dpr; g.stroke(); g.fillStyle = MID; g.fill();
    const eye = from('neck', W.head, k + 0.1, hw / 2); g.beginPath(); g.arc(eye[0], eye[1], 0.045 * s, 0, 7); g.fillStyle = OUT; g.fill();
    if (mus) mus('');
    leg('R', NEAR); if (mus) mus('R', false); arm('R', NEAR); if (mus) mus('R', true);
  }
  function ghost(g, f, col, alpha, lw) {
    const S = n => scr(f.J[n]), path = ns => { g.beginPath(); ns.forEach((n, i) => { const p = S(n); i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); }); g.stroke(); };
    g.save(); g.globalAlpha = alpha; g.strokeStyle = col; g.lineWidth = (lw || 2.5) * tf.dpr; g.lineCap = g.lineJoin = 'round';
    path(['pelvis', 'spine', 'neck']); headShape(g, f); g.stroke();
    for (const s of SIDES) { path(['shoulder' + s, 'elbow' + s, 'wrist' + s, 'hand' + s]); path(['pelvis', 'knee' + s, 'ankle' + s, 'heel' + s, 'toe' + s, 'ankle' + s]); }
    g.restore();
  }
  function ghosts() {                                  // which frames the onion skin shows: side -1 = before, 1 = after, rank 1 = nearest
    const out = [], f = B.cur, n = B.onionN;
    if (B.onionMode === 'keys') {
      B.keys.filter(k => k.frame < f - 1e-6).reverse().slice(0, n).forEach((k, i) => out.push({ frame: k.frame, side: -1, rank: i + 1 }));
      B.keys.filter(k => k.frame > f + 1e-6).slice(0, n).forEach((k, i) => out.push({ frame: k.frame, side: 1, rank: i + 1 }));
    } else for (let i = 1; i <= n; i++) { if (f - 2 * i >= first()) out.push({ frame: f - 2 * i, side: -1, rank: i }); if (f + 2 * i <= last()) out.push({ frame: f + 2 * i, side: 1, rank: i }); }
    return out;
  }
  // ---------- teaching overlays
  function drawPivots(g, f, p) {                       // every joint's pivot, a wedge for how far it is bent from rest, and the arc the selected one swings on
    const dpr = tf.dpr, th = a => (90 - a) * Math.PI / 180; g.save(); g.lineCap = 'round';
    for (const n of M.ANGLES.slice().reverse()) {
      const [bone, len] = BONE[n], c = scr(f.J[ACT[n][0]]), cur = f.W[bone], v = AT.clamp(p[n], -359, 359), rest = cur - ACT[n][1] * v; g.globalAlpha = /L$/.test(n) ? 0.45 : 1;
      if (Math.abs(v) > 1) { g.beginPath(); g.moveTo(c[0], c[1]); g.arc(c[0], c[1], 0.42 * tf.s, th(rest), th(cur), cur > rest); g.closePath(); g.fillStyle = 'rgba(88,214,232,.3)'; g.fill(); g.strokeStyle = CYAN; g.lineWidth = 1.5 * dpr; g.stroke(); }
      if (n === B.sel) { g.setLineDash([6 * dpr, 6 * dpr]); g.beginPath(); g.arc(c[0], c[1], len * tf.s, 0, 7); g.strokeStyle = CYAN; g.lineWidth = 1.5 * dpr; g.stroke(); g.setLineDash([]); }
      g.beginPath(); g.arc(c[0], c[1], 6 * dpr, 0, 7); g.moveTo(c[0] - 10 * dpr, c[1]); g.lineTo(c[0] + 10 * dpr, c[1]); g.moveTo(c[0], c[1] - 10 * dpr); g.lineTo(c[0], c[1] + 10 * dpr); g.strokeStyle = CYAN; g.lineWidth = 1.5 * dpr; g.stroke();
    }
    g.restore();
  }
  function drawAction(g, p) {
    const b = M.actionLine(p).bez.map(scr), dpr = tf.dpr; g.save(); g.lineCap = 'round'; g.beginPath(); g.moveTo(b[0][0], b[0][1]); g.bezierCurveTo(b[1][0], b[1][1], b[2][0], b[2][1], b[3][0], b[3][1]);
    g.strokeStyle = OUT; g.lineWidth = 9 * dpr; g.globalAlpha = 0.55; g.stroke(); g.globalAlpha = 0.95; g.strokeStyle = GOLD; g.lineWidth = 5 * dpr; g.stroke(); g.restore();
  }
  const balCol = b => b.state === 'air' ? '#a6a1b4' : b.state !== 'balanced' ? RED : b.edge < 0.12 ? AFTER : GREEN;
  const balText = b => b.state === 'air' ? 'In the air' : b.state === 'forward' ? 'Off balance: tipping forward' : b.state === 'back' ? 'Off balance: tipping back' : b.edge < 0.12 ? 'Balanced, but only just (weight at the ' + b.side + ' edge of the feet)' : 'Balanced: the weight is over the feet';
  function drawBalance(g, p) {                         // the centre of gravity, a plumb line down from it, and the ground the feet cover
    const b = M.balance(p), dpr = tf.dpr, col = balCol(b), c = scr(b.com), gy = tf.oy, r = 11 * dpr; g.save(); g.lineCap = 'round';
    if (b.support) { const a = scr([b.support[0], 0]), e = scr([b.support[1], 0]); g.beginPath(); g.moveTo(a[0], gy + 8 * dpr); g.lineTo(e[0], gy + 8 * dpr); g.strokeStyle = col; g.lineWidth = 7 * dpr; g.stroke(); }
    g.setLineDash([5 * dpr, 6 * dpr]); g.beginPath(); g.moveTo(c[0], c[1]); g.lineTo(c[0], gy); g.strokeStyle = col; g.lineWidth = 2 * dpr; g.stroke(); g.setLineDash([]);
    g.beginPath(); g.moveTo(c[0], gy + dpr); g.lineTo(c[0] - 7 * dpr, gy - 11 * dpr); g.lineTo(c[0] + 7 * dpr, gy - 11 * dpr); g.closePath(); g.fillStyle = col; g.fill();
    g.beginPath(); g.arc(c[0], c[1], r, 0, 7); g.fillStyle = OUT; g.fill();
    for (const q of [0, 2]) { g.beginPath(); g.moveTo(c[0], c[1]); g.arc(c[0], c[1], r, q * Math.PI / 2, (q + 1) * Math.PI / 2); g.closePath(); g.fillStyle = col; g.fill(); }
    g.beginPath(); g.arc(c[0], c[1], r, 0, 7); g.strokeStyle = '#fff'; g.lineWidth = 2 * dpr; g.stroke(); g.restore();
  }
  // ---------- joint limits, muscles, loose things
  const short = n => LABEL[n].toLowerCase(), deg = v => Math.round(Math.abs(v)) + '°';
  function drawLimits(g, f, p) {                       // the range a real joint has (for the selected one), and a ring on every joint bent past its own
    const dpr = tf.dpr, th = a => (90 - a) * Math.PI / 180, L = M.LIMITS[B.sel]; g.save(); g.lineCap = 'round';
    if (L && !B.playing) { const [bone, len] = BONE[B.sel], c = scr(f.J[ACT[B.sel][0]]), sg = ACT[B.sel][1], rest = f.W[bone] - sg * p[B.sel];
      g.beginPath(); g.arc(c[0], c[1], len * tf.s * 0.84, th(rest + sg * L[0]), th(rest + sg * L[1]), sg > 0); g.strokeStyle = LIMOK; g.globalAlpha = 0.75; g.lineWidth = 4 * dpr; g.stroke(); g.globalAlpha = 1; }
    g.font = '700 ' + 12 * dpr + 'px system-ui,"Segoe UI",sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
    for (const v of M.limits(p)) { const c = scr(f.J[ACT[v.joint][0]]), col = v.level === 'past' ? LIMBAD : LIMWARN, t = deg(v.by) + ' past'; g.beginPath(); g.arc(c[0], c[1], 14 * dpr, 0, 7); g.strokeStyle = col; g.lineWidth = 3.5 * dpr; g.stroke();
      g.lineWidth = 3 * dpr; g.strokeStyle = OUT; g.strokeText(t, c[0] + 19 * dpr, c[1] + 16 * dpr); g.fillStyle = col; g.fillText(t, c[0] + 19 * dpr, c[1] + 16 * dpr); }
    g.restore();
  }
  const MIXC = (a, b, t) => 'rgb(' + a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',') + ')', MNEU = [205, 160, 175], MSQ = [255, 110, 90], MST = [90, 160, 255], ARMM = /Shoulder|Biceps|Triceps|forearm/;
  const selMuscles = ms => { const base = B.sel.replace(/[RL]$/, ''), sd = (B.sel.match(/[RL]$/) || [''])[0]; return ms.filter(m => m.joint === base && (m.side === sd || (m.side === '' && sd !== 'L'))); };
  const flexWord = m => m.flex > 0.15 ? 'bunches up' : m.flex < -0.15 ? 'stretches' : 'is at rest';
  function muscleDraw(g, p, Q) {                       // red = bunched up short and fat, blue = pulled long and thin
    const ms = M.muscles(p, Q), named = B.playing ? [] : selMuscles(ms), dpr = tf.dpr;
    return (side, arms) => { for (const m of ms) { if (m.side !== side || (arms != null && ARMM.test(m.name) !== arms)) continue;
      const a = scr(m.a), b = scr(m.b), cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2; g.save(); g.globalAlpha = side === 'L' ? 0.55 : 0.92; g.beginPath(); g.ellipse(cx, cy, Math.hypot(b[0] - a[0], b[1] - a[1]) / 2, m.t * tf.s / 2, Math.atan2(b[1] - a[1], b[0] - a[0]), 0, 7);
      g.fillStyle = MIXC(MNEU, m.flex > 0 ? MSQ : MST, Math.abs(m.flex)); g.fill(); g.strokeStyle = OUT; g.lineWidth = 1.5 * dpr; g.stroke(); g.restore(); } };
  }
  function muscleNames(g, p) { const dpr = tf.dpr; g.save(); g.font = '700 ' + 11 * dpr + 'px system-ui,"Segoe UI",sans-serif'; g.textBaseline = 'middle';
    for (const m of selMuscles(M.muscles(p))) { const c = scr([(m.a[0] + m.b[0]) / 2, (m.a[1] + m.b[1]) / 2]), front = /Chest|Abs|Biceps|Inner|Quads|Shin/.test(m.name); g.textAlign = front ? 'left' : 'right';
      const x = c[0] + (front ? 1 : -1) * (m.t * tf.s / 2 + 8 * dpr); g.lineWidth = 3 * dpr; g.strokeStyle = OUT; g.strokeText(m.name, x, c[1]); g.fillStyle = '#fff'; g.fillText(m.name, x, c[1]); } g.restore(); }
  function drawTrails(g) {                             // hair, scarf and coat tail: smooth ribbons through the chains
    g.save(); g.lineCap = g.lineJoin = 'round';
    for (const t of M.trails(B.keys, B.cur, P, cycle())) { const q = t.pts.map(scr), path = () => { g.beginPath(); g.moveTo(q[0][0], q[0][1]); for (let i = 1; i < q.length - 1; i++) g.quadraticCurveTo(q[i][0], q[i][1], (q[i][0] + q[i + 1][0]) / 2, (q[i][1] + q[i + 1][1]) / 2); g.lineTo(q[q.length - 1][0], q[q.length - 1][1]); };
      path(); g.strokeStyle = OUT; g.lineWidth = TWIDE[t.name] * tf.s + 3 * tf.dpr; g.stroke(); path(); g.strokeStyle = TCOL[t.name]; g.lineWidth = TWIDE[t.name] * tf.s; g.stroke(); }
    g.restore();
  }

  // ---------- the proportion guide: every body standing in a row, each with a ruler of its own heads
  function wrapText(g, txt, x, y, maxW, lh) { let line = ''; for (const w of txt.split(' ')) { const t = line ? line + ' ' + w : w; if (line && g.measureText(t).width > maxW) { g.fillText(line, x, y); y += lh; line = w; } else line = t; } if (line) { g.fillText(line, x, y); y += lh; } return y; }
  function drawChart() {
    const dpr = fitCanvas(view), w = view.width, h = view.height, g = ctx; if (!w || !h) return; g.clearRect(0, 0, w, h);
    const list = M.BODIES.map(b => { const tall = M.tallOf(b.P), k = (B.chartSame ? 7.5 : b.tall) / tall; return { b, tall, k, wide: Math.max(2.5, k * 1.5 + 1.2) }; }), total = list.reduce((a, c) => a + c.wide, 0);
    const textH = 124 * dpr, s = Math.min((w - 20 * dpr) / total, (h - textH - 56 * dpr) / 8.6), gy = h - textH, cur = pose(); let x = (w - total * s) / 2;
    g.fillStyle = '#17151d'; g.fillRect(0, gy, w, h - gy); g.fillStyle = '#3b3846'; g.fillRect(0, gy, w, Math.max(1, dpr));
    for (const c of list) { const cw = c.wide * s, cx = x + cw / 2, hs = c.k * s, H = c.tall * hs, x0 = x + 5 * dpr, bw = cw - 10 * dpr; g.textBaseline = 'alphabetic';
      for (let j = 0; j * hs < H - 1; j++) { const y0 = gy - H + j * hs, y1 = Math.min(gy, y0 + hs); if (j % 2 === 0) { g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(x0, y0, bw, y1 - y0); } g.fillStyle = '#5b566b'; g.fillRect(x0, Math.round(y0), bw, Math.max(1, dpr));
        if (hs > 15 * dpr) { g.font = 10 * dpr + 'px system-ui,"Segoe UI",sans-serif'; g.textAlign = 'left'; g.fillStyle = '#8d889d'; g.fillText(j + 1, x0 + 3 * dpr, y0 + 12 * dpr); } }
      g.setLineDash([5 * dpr, 5 * dpr]); g.beginPath(); g.moveTo(x0, gy - H / 2); g.lineTo(x0 + bw, gy - H / 2); g.strokeStyle = GOLD; g.lineWidth = 1.5 * dpr; g.stroke(); g.setLineDash([]);
      g.font = 10 * dpr + 'px system-ui,"Segoe UI",sans-serif'; g.textAlign = 'right'; g.fillStyle = GOLD; g.fillText('half', x0 + bw - 3 * dpr, gy - H / 2 - 4 * dpr);
      const p = B.chartPose ? M.fit(Object.assign({}, cur, { x: 0 }), c.b.P) : M.stand(c.b.P); tf = { s: hs, ox: cx, oy: gy, dpr }; figure(g, M.fk(p, c.b.P), c.b.P);
      g.textAlign = 'center'; g.fillStyle = '#fff'; g.font = '700 ' + 13 * dpr + 'px system-ui,"Segoe UI",sans-serif'; g.fillText(c.b.name, cx, gy + 20 * dpr);
      g.fillStyle = GOLD; g.font = '600 ' + 12 * dpr + 'px system-ui,"Segoe UI",sans-serif'; g.fillText(c.b.heads + ' heads tall', cx, gy + 36 * dpr);
      g.fillStyle = '#a6a1b4'; g.font = 11.5 * dpr + 'px system-ui,"Segoe UI",sans-serif'; wrapText(g, c.b.note, cx, gy + 53 * dpr, cw - 12 * dpr, 14 * dpr); x += cw; }
    g.textAlign = 'left'; g.fillStyle = '#a6a1b4'; g.font = 12 * dpr + 'px system-ui,"Segoe UI",sans-serif';
    g.fillText(B.chartSame ? 'All the same height: only the proportions differ.' : 'Stripes: that body\'s own heads. Gold line: halfway up.', 14 * dpr, 26 * dpr);
  }

  // ---------- the hands and feet sheet
  function drawHand(g, gs, ox, oy, u, dpr, rot, alpha) {
    const H = M.hand(gs, rot), S = q => [ox + q[0] * u, oy - q[1] * u]; g.save(); g.globalAlpha = alpha || 1; g.lineCap = g.lineJoin = 'round';
    const cap = (a, b, wd, col) => { a = S(a); b = S(b); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.strokeStyle = OUT; g.lineWidth = wd * u + 3 * dpr; g.stroke(); g.strokeStyle = col; g.lineWidth = wd * u; g.stroke(); };
    cap(H.arm[0], H.arm[1], 0.5, FAR);
    g.beginPath(); H.palm.forEach((q, i) => { const c = S(q); i ? g.lineTo(c[0], c[1]) : g.moveTo(c[0], c[1]); }); g.closePath(); g.strokeStyle = OUT; g.lineWidth = 0.2 * u + 3 * dpr; g.stroke(); g.strokeStyle = MID; g.lineWidth = 0.2 * u; g.stroke(); g.fillStyle = MID; g.fill();
    if (gs.bar) cap([-1.05, 0.98], [1.05, 0.98], 0.36, BALL);
    H.fingers.forEach((f, i) => { for (let j = 0; j < 3; j++) cap(f[j], f[j + 1], (i === 3 ? 0.17 : 0.2) - j * 0.015, NEAR); });
    for (let j = 0; j < 3; j++) cap(H.thumb[j], H.thumb[j + 1], 0.24 - j * 0.025, NEAR);
    if (gs.guide) { g.setLineDash([4 * dpr, 4 * dpr]); g.strokeStyle = CYAN; g.lineWidth = 1.5 * dpr; g.beginPath(); H.fingers.forEach((f, i) => { const c = S(f[0]); i ? g.lineTo(c[0], c[1]) : g.moveTo(c[0], c[1]); }); g.stroke();
      for (const f of H.fingers) { const a = S([0, 0.1]), b = S(f[3]); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); } g.setLineDash([]); }
    g.restore();
  }
  function drawFoot(g, fs, ox, oy, u, dpr) {
    const F = M.foot(fs), S = q => [ox + q[0] * u, oy - q[1] * u]; g.save(); g.lineCap = g.lineJoin = 'round';
    const a = S(F.ankle), t = S(F.top); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(t[0], t[1]); g.strokeStyle = OUT; g.lineWidth = 0.34 * u + 3 * dpr; g.stroke(); g.strokeStyle = MID; g.lineWidth = 0.34 * u; g.stroke();
    for (const pts of [F.rear, F.toes]) { g.beginPath(); pts.forEach((q, i) => { const c = S(q); i ? g.lineTo(c[0], c[1]) : g.moveTo(c[0], c[1]); }); g.closePath(); g.strokeStyle = OUT; g.lineWidth = 0.07 * u + 3 * dpr; g.stroke(); g.strokeStyle = NEAR; g.lineWidth = 0.07 * u; g.stroke(); g.fillStyle = NEAR; g.fill(); }
    const mark = (x0, x1) => { g.beginPath(); g.moveTo(ox + x0 * u, oy + 7 * dpr); g.lineTo(ox + x1 * u, oy + 7 * dpr); g.strokeStyle = GREEN; g.lineWidth = 5 * dpr; g.stroke(); };
    if (F.heelDown) mark(F.rear[0][0] - 0.06, F.rear[0][0] + 0.14); if (F.ballDown) mark(F.rear[6][0] - 0.12, F.rear[6][0] + 0.04); if (F.toesDown) mark(F.toes[0][0], F.toes[4][0]);
    for (const q of [F.ankle, F.rear[6]]) { const c = S(q); g.beginPath(); g.arc(c[0], c[1], 5 * dpr, 0, 7); g.fillStyle = OUT; g.fill(); g.strokeStyle = CYAN; g.lineWidth = 1.5 * dpr; g.stroke(); }
    g.restore();
  }
  function drawSheet() {
    const dpr = fitCanvas(view), w = view.width, h = view.height, g = ctx; if (!w || !h) return; g.clearRect(0, 0, w, h); const topPad = 44 * dpr, capH = 66 * dpr, rowH = (h - topPad) / 3;
    const caption = (name, note, cx, y, mw) => { g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillStyle = '#fff'; g.font = '700 ' + 13 * dpr + 'px system-ui,"Segoe UI",sans-serif'; g.fillText(name, cx, y); g.fillStyle = '#a6a1b4'; g.font = 10.5 * dpr + 'px system-ui,"Segoe UI",sans-serif'; wrapText(g, note, cx, y + 15 * dpr, mw, 12.5 * dpr); };
    const hw = w / 4, hu = Math.min(hw / 3.6, (rowH - capH - 10 * dpr) / 2.85);
    M.HANDS.forEach((gs, i) => { const cx = (i % 4 + 0.5) * hw, top = topPad + Math.floor(i / 4) * rowH, oy = top + rowH - capH - 0.62 * hu, turned = gs.id === 'thumb', ox = cx + (turned ? 0.8 * hu : 0), y0 = turned ? oy - 0.9 * hu : oy;
      if (gs.wave) { drawHand(g, gs, ox, y0, hu, dpr, -gs.rot, 0.3); g.save(); g.strokeStyle = GOLD; g.fillStyle = GOLD; g.lineWidth = 2.5 * dpr; g.lineCap = 'round'; const r = 2.45 * hu, a0 = (-90 - 26) * Math.PI / 180, a1 = (-90 + 26) * Math.PI / 180; g.beginPath(); g.arc(ox, y0, r, a0, a1); g.stroke();
        for (const [a, d] of [[a0, -1], [a1, 1]]) { const px = ox + Math.cos(a) * r, py = y0 + Math.sin(a) * r, tx = -Math.sin(a) * d, ty = Math.cos(a) * d, nx = Math.cos(a), ny = Math.sin(a), k = 9 * dpr; g.beginPath(); g.moveTo(px + tx * k, py + ty * k); g.lineTo(px + nx * k * 0.6, py + ny * k * 0.6); g.lineTo(px - nx * k * 0.6, py - ny * k * 0.6); g.closePath(); g.fill(); } g.restore(); }
      drawHand(g, gs, ox, y0, hu, dpr); caption(gs.name, gs.note, cx, top + rowH - capH + 16 * dpr, hw - 24 * dpr); });
    const fw = w / M.FEET.length, fu = Math.min(fw / 2.5, (rowH - capH - 14 * dpr) / 2.5), top = topPad + 2 * rowH, gy = top + rowH - capH - 12 * dpr;
    g.fillStyle = '#3b3846'; g.fillRect(0, gy, w, Math.max(1, dpr));
    M.FEET.forEach((fs, i) => { const cx = (i + 0.5) * fw; drawFoot(g, fs, cx + 0.25 * fu, gy, fu, dpr); caption(fs.name, fs.note, cx, top + rowH - capH + 22 * dpr, fw - 16 * dpr); });
    g.textAlign = 'left'; g.fillStyle = '#a6a1b4'; g.font = 12 * dpr + 'px system-ui,"Segoe UI",sans-serif'; g.fillText('Green: touching the ground. Blue rings: where it bends.', 14 * dpr, 26 * dpr);
  }

  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function poseLabel(p) {                              // top left of the picture: which pose this is, and what the overlays say about it
    const f = Math.round(B.cur), i = keyAt(f), nm = k => k.label || 'frame ' + k.frame, row = (col, t) => '<div style="margin-top:5px;font-weight:600"><span class="dot" style="background:' + col + '"></span>' + esc(t) + '</div>'; let h = '';
    if (i >= 0) { const k = B.keys[i]; h = '<div style="font-size:24px;font-weight:800;line-height:1.15">' + esc(k.label || 'Frame ' + k.frame) + '</div><span style="display:inline-block;margin-top:3px;padding:1px 9px;border-radius:999px;font-size:11px;font-weight:800;letter-spacing:.6px;text-shadow:none;color:#0e0d11;background:' + KCOL[k.kind] + '">' + KNAME[k.kind].toUpperCase() + '</span>'; }
    else if (f > first() && f < last()) { let a = B.keys[0]; for (const k of B.keys) if (k.frame < f) a = k; const b = B.keys[B.keys.indexOf(a) + 1];
      h = '<div style="font-size:16px;font-weight:700;color:var(--dim)">inbetween</div><div class="muted">from ' + esc(nm(a)) + ' to ' + esc(nm(b)) + '</div>'; }
    if (B.action) h += row(GOLD, 'Line of action: ' + ({ straight: 'straight (stiff)', C: 'a C curve', S: 'an S curve' })[M.actionLine(p).shape]);
    if (B.balance) { const b = M.balance(p); h += row(balCol(b), balText(b)); }
    if (B.pivots) h += row(CYAN, 'Pivots: each wedge shows how far that joint is bent from rest');
    if (B.limits) { const v = M.limits(p); if (v.length) h += row(v.some(q => q.level === 'past') ? LIMBAD : LIMWARN, 'Past what a real joint does: ' + v.slice(0, 3).map(q => short(q.joint) + ' by ' + deg(q.by)).join(', ') + (v.length > 3 ? ' and ' + (v.length - 3) + ' more' : '')); }
    if (B.muscles) { const ms = selMuscles(M.muscles(p)); h += row('rgb(' + MSQ + ')', 'Muscles: red = bunched up (squash), blue = pulled long (stretch)') + (ms.length ? '<div class="muted" style="margin-left:15px">' + esc(LABEL[B.sel]) + ': ' + ms.map(m => esc(m.name.toLowerCase() + ' ' + flexWord(m))).join(', ') + '</div>' : ''); }
    if (B.trails) h += row(TCOL.hair, 'Hair, scarf and coat tail drag behind and settle after the body');
    const el = $('#bPoseLbl'); if (el.innerHTML !== h) el.innerHTML = h;
  }
  function dots(g, f, p) {
    const dpr = tf.dpr;
    for (let i = DOTS.length - 1; i >= 0; i--) {
      const n = DOTS[i], c = scr(f.J[n]), r = (n === 'pelvis' ? 7.5 : /^(wrist|ankle)/.test(n) ? 6 : 4.5) * dpr; g.beginPath();
      if (n === 'pelvis') { g.moveTo(c[0], c[1] - r); g.lineTo(c[0] + r, c[1]); g.lineTo(c[0], c[1] + r); g.lineTo(c[0] - r, c[1]); g.closePath(); } else g.arc(c[0], c[1], r, 0, 7);
      g.fillStyle = OUT; g.fill(); g.strokeStyle = /L$/.test(n) ? '#a8627f' : ACC; g.lineWidth = 2 * dpr; g.stroke();
    }
    const c = scr(f.J[ACT[B.sel][0]]), txt = LABEL[B.sel] + '  ' + Math.round(p[B.sel]) + '°';
    g.beginPath(); g.arc(c[0], c[1], 10 * dpr, 0, 7); g.strokeStyle = '#fff'; g.lineWidth = 2 * dpr; g.stroke(); g.beginPath(); g.arc(c[0], c[1], 4 * dpr, 0, 7); g.fillStyle = ACC; g.fill();
    g.font = '600 ' + 12 * dpr + 'px system-ui,"Segoe UI",sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left';
    const tw = g.measureText(txt).width, bx = Math.min(c[0] + 16 * dpr, view.width - tw - 18 * dpr), by = Math.max(c[1] - 24 * dpr, 14 * dpr);
    g.fillStyle = 'rgba(22,21,26,.9)'; g.beginPath(); g.roundRect(bx - 7 * dpr, by - 11 * dpr, tw + 14 * dpr, 22 * dpr, 7 * dpr); g.fill(); g.strokeStyle = ACC; g.lineWidth = dpr; g.stroke(); g.fillStyle = '#fff'; g.fillText(txt, bx, by + dpr);
  }
  function draw() {
    if (B.view !== 'pose') { B.view === 'chart' ? drawChart() : drawSheet(); tf = null; const el = $('#bPoseLbl'); if (el.innerHTML) el.innerHTML = ''; return; }
    const dpr = fitCanvas(view), w = view.width, h = view.height; if (!w || !h) return;
    const s = Math.min(h / 10.8, w / 9) * B.zoom; tf = { s, ox: w / 2 - B.cx * s, oy: h / 2 + B.cy * s, dpr };
    ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#17151d'; ctx.fillRect(0, tf.oy, w, Math.max(0, h - tf.oy)); ctx.fillStyle = '#3b3846'; ctx.fillRect(0, tf.oy, w, Math.max(1, dpr));
    if (B.onion) for (const gh of ghosts().reverse()) ghost(ctx, M.fk(pose(gh.frame)), gh.side < 0 ? BEFORE : AFTER, 0.85 / Math.pow(gh.rank, 0.8));
    const p = pose(), f = M.fk(p); figure(ctx, f, P, B.muscles ? muscleDraw(ctx, p) : null); if (B.trails) drawTrails(ctx);
    if (B.prop) { const c = scr(M.propAt(B.prop, B.keys, B.cur)); ctx.beginPath(); ctx.arc(c[0], c[1], B.prop.r * s, 0, 7); ctx.fillStyle = BALL; ctx.fill(); ctx.strokeStyle = OUT; ctx.lineWidth = 2 * dpr; ctx.stroke(); }
    if (B.pivots) drawPivots(ctx, f, p); if (B.limits) drawLimits(ctx, f, p); if (B.action) drawAction(ctx, p); if (B.balance) drawBalance(ctx, p);
    if (!B.playing) { dots(ctx, f, p); if (B.muscles) muscleNames(ctx, p); } poseLabel(p);
  }
  function drawTime() {
    const dpr = fitCanvas(tl), w = tl.width, h = tl.height; if (!w || !h) return; const g = tctx, fr = B.keys.map(k => k.frame), rt = M.retime(fr, B.speed), f0 = Math.round(B.cur);
    const end = Math.max(last() + 6, rt[rt.length - 1] + 3, 30), x0 = 30 * dpr, px = (w - 60 * dpr) / (end - 1), X = f => x0 + (f - 1) * px, th = Math.max(20 * dpr, h - 84 * dpr), ky = th + 34 * dpr; ttf = { x0, px, end, dpr, ky };
    g.clearRect(0, 0, w, h); g.font = '600 ' + 11 * dpr + 'px system-ui,"Segoe UI",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    const keep = tf, ts = th / 8.8; let edge = -1e9;      // every stored pose as a little figure with its name
    B.keys.forEach(k => { const on = !B.playing && k.frame === f0, x = X(k.frame); tf = { s: ts, ox: x - k.pose.x * ts, oy: th + 2 * dpr, dpr }; ghost(g, M.fk(k.pose), on ? '#fff' : KCOL[k.kind], on ? 1 : 0.85, 1.3);
      const tw = k.label ? g.measureText(k.label).width : 0; if (k.label && (on || x - tw / 2 > edge + 5 * dpr)) { g.fillStyle = on ? '#fff' : KCOL[k.kind]; g.fillText(k.label, x, th + 18 * dpr); edge = x + tw / 2; } });
    tf = keep;
    g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(X(first()), ky - 11 * dpr, X(last()) - X(first()), 22 * dpr);
    let step = 1; for (const c of [1, 2, 4, 6, 12, 24, 48, 96, 240]) { step = c; if (c * px >= 30 * dpr) break; }
    g.font = 11 * dpr + 'px system-ui,"Segoe UI",sans-serif';
    for (let f = 1; f <= end; f++) { const big = (f - 1) % step === 0; if (!big && px < 4 * dpr) continue; g.fillStyle = big ? '#6f6a80' : '#3b3846'; g.fillRect(Math.round(X(f)), h - (big ? 24 : 19) * dpr, Math.max(1, dpr), (big ? 9 : 4) * dpr); if (big) { g.fillStyle = '#a6a1b4'; g.fillText(f, X(f), h - 4 * dpr); } }
    const dia = (x, y, r) => { g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath(); };
    if (B.speed !== 1) rt.forEach((f, i) => { g.strokeStyle = AFTER; g.globalAlpha = 0.5; g.lineWidth = dpr; g.beginPath(); g.moveTo(X(fr[i]), ky); g.lineTo(X(f), ky + 15 * dpr); g.stroke(); g.globalAlpha = 1; dia(X(f), ky + 15 * dpr, 4.5 * dpr); g.lineWidth = 1.5 * dpr; g.stroke(); });
    B.keys.forEach(k => { const x = X(k.frame); if (k.kind === 'inbetween') { g.beginPath(); g.arc(x, ky, 4.5 * dpr, 0, 7); } else dia(x, ky, (k.kind === 'key' ? 7 : 5.5) * dpr);
      g.fillStyle = KCOL[k.kind]; g.fill(); if (!B.playing && k.frame === f0) { g.strokeStyle = '#fff'; g.lineWidth = 2 * dpr; g.stroke(); } });
    g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(X(B.cur) - 0.75 * dpr, ky - 13 * dpr, 1.5 * dpr, h - 26 * dpr - (ky - 13 * dpr));
  }

  // ---------- panel
  function sync(light) {
    const f = Math.round(B.cur), i = keyAt(B.cur), p = pose(), n = last() - first(), pct = Math.round(B.speed * 100);
    $('#bFrameLbl').textContent = 'Frame ' + (B.playing ? Math.floor(B.cur) : f) + ' of ' + last() + (B.playing ? '' : i >= 0 ? '   ' + KNAME[B.keys[i].kind] : f > first() && f < last() ? '   inbetween' : '');
    if (!B.playing || !light) {
      $('#bAdd').disabled = i >= 0; $('#bDel').disabled = i < 0 || B.keys.length < 2;
      const kf = $('#bKF'); kf.disabled = i < 0; if (document.activeElement !== kf) kf.value = f;
      const kk = $('#bKK'), kl = $('#bKL'); kk.disabled = kl.disabled = i < 0; kk.value = i >= 0 ? B.keys[i].kind : 'inbetween'; if (document.activeElement !== kl) kl.value = i >= 0 ? B.keys[i].label : '';
      $('#bAbout').textContent = B.about || 'Pick one to load it. Each pose on the timeline is named and marked as a key, a breakdown or an inbetween.';
      $('#bShowAction').checked = B.action; $('#bShowBalance').checked = B.balance; $('#bShowPivots').checked = B.pivots; $('#bShowLimits').checked = B.limits; $('#bShowMuscles').checked = B.muscles; $('#bShowTrails').checked = B.trails;
      $('#bChartSame').checked = B.chartSame; $('#bChartPose').checked = B.chartPose; $$('#bViews .tab').forEach(t => t.classList.toggle('on', t.dataset.view === B.view));
      $('#bHint').style.display = B.view === 'pose' ? '' : 'none';
      { const L = M.LIMITS[B.sel], v = M.limits(p).find(q => q.joint === B.sel); $('#bRange').textContent = !L ? 'This tips the whole body from the hips, so it has no range of its own.' : 'A real one goes from ' + L[0] + '° to ' + L[1] + '°.' + (v ? ' This is ' + deg(v.by) + ' past it. Breaking a joint for a frame or two is an old animation trick, so take it as a heads up, not a rule.' : ''); }
      let kb = B.keys[0]; for (const k of B.keys) if (k.frame <= f) kb = k; $('#bKE').value = kb.ease;
      const sp = $('#bSpeed'); sp.value = Math.round(Math.log2(B.speed) * 10); sp.nextElementSibling.textContent = pct + '%';
      const rt = M.retime(B.keys.map(k => k.frame), B.speed), n2 = rt[rt.length - 1] - rt[0], sec = v => (v / FPS).toFixed(2).replace(/\.?0+$/, '') + ' s';
      $('#bTimeInfo').textContent = 'The motion runs ' + n + ' frames = ' + sec(n) + ' at ' + FPS + ' frames a second.' + (B.speed === 1 ? ' Slide to watch it faster or slower.' : ' At ' + pct + '% it takes ' + n2 + ' frames = ' + sec(n2) + '. The hollow diamonds show where each key pose would land.');
      $('#bBake').disabled = B.speed === 1;
      $('#bJointName').textContent = LABEL[B.sel]; const an = $('#bAngle'); if (!sliding) an.value = AT.clamp(Math.round(p[B.sel]), -200, 200); an.nextElementSibling.textContent = Math.round(p[B.sel]) + '°';
      $('#bLoop').checked = B.loop; $('#bOnion').checked = B.onion; $('#bOnionMode').value = B.onionMode; $('#bOnionN').value = B.onionN; $('#bIK').checked = B.ik; $('#bPlant').checked = B.plant;
      $('#bUndo').disabled = !undo.length; const ro = $('#bReadout'); ro.textContent = note; ro.style.display = note ? '' : 'none';
    }
    draw(); drawTime(); if (!light) save();
  }

  // ---------- playing
  function stop() { B.playing = false; cancelAnimationFrame(raf); B.cur = AT.clamp(Math.round(B.cur), first(), last()); $('#bPlay').textContent = 'Play'; sync(true); }
  function play() {
    if (B.keys.length < 2) return; B.playing = true; note = ''; $('#bPlay').textContent = 'Stop';
    let t0 = performance.now(), n0 = B.cur >= last() || B.cur < first() ? 0 : (B.cur - first()) / B.speed;
    const tick = now => {
      if (!B.playing) return; let f = first() + (n0 + Math.floor((now - t0) / 1000 * FPS)) * B.speed;      // one step per 24th of a second, as the retimed motion would show
      if (cycle() ? f >= last() - 1e-9 : f > last() + 1e-9) { if (!B.loop) { B.cur = last(); stop(); return; } t0 = now; n0 = 0; f = first(); }
      if (f !== B.cur) { B.cur = f; sync(true); } raf = requestAnimationFrame(tick);
    };
    sync(true); raf = requestAnimationFrame(tick);
  }
  function jump(d) { if (B.playing) stop(); const f = Math.round(B.cur), ks = B.keys.filter(k => d < 0 ? k.frame < f : k.frame > f); if (ks.length) { B.cur = (d < 0 ? ks[ks.length - 1] : ks[0]).frame; note = ''; sync(true); } }

  // ---------- controls
  const blur = e => e.target.blur();
  $('#mode-body').addEventListener('click', e => { const b = e.target.closest('button'); if (b) b.blur(); });      // so Space plays instead of pressing the last button again
  $('#bPlay').onclick = () => B.playing ? stop() : play();
  $('#bPrevK').onclick = () => jump(-1); $('#bNextK').onclick = () => jump(1);
  $('#bLoop').onchange = e => { B.loop = e.target.checked; blur(e); sync(); };
  $('#bOnion').onchange = e => { B.onion = e.target.checked; blur(e); sync(); };
  $('#bOnionMode').onchange = e => { B.onionMode = e.target.value; B.onion = true; sync(); }; $('#bOnionN').onchange = e => { B.onionN = +e.target.value; B.onion = true; sync(); };
  $('#bIK').onchange = e => { B.ik = e.target.checked; blur(e); sync(); }; $('#bPlant').onchange = e => { B.plant = e.target.checked; blur(e); sync(); };
  $('#bAdd').onclick = () => { if (B.playing) stop(); if (keyAt(B.cur) >= 0) return; pushUndo(); ensureKey(); sync(); };
  $('#bDel').onclick = () => { if (B.playing) stop(); const i = keyAt(B.cur); if (i < 0 || B.keys.length < 2) return; pushUndo(); B.keys.splice(i, 1); note = 'Key pose removed'; sync(); };
  $('#bKF').onchange = e => { const i = keyAt(B.cur), v = Math.max(1, Math.round(+e.target.value) || 1); if (i < 0) return; if (keyAt(v) >= 0) { if (keyAt(v) !== i) note = 'Frame ' + v + ' already has a key pose'; } else { pushUndo(); B.keys[i].frame = v; sortKeys(); B.cur = v; note = ''; } e.target.blur(); sync(); };
  $('#bKE').onchange = e => { let kb = B.keys[0]; for (const k of B.keys) if (k.frame <= Math.round(B.cur)) kb = k; pushUndo(); kb.ease = e.target.value; sync(); };
  $('#bSpeed').oninput = e => { B.speed = +e.target.value === 0 ? 1 : Math.round(Math.pow(2, +e.target.value / 10) * 100) / 100; sync(true); }; $('#bSpeed').onchange = e => { blur(e); sync(); };
  $('#bSpeedReset').onclick = () => { B.speed = 1; sync(); };
  $('#bBake').onclick = () => { if (B.speed === 1) return; const was = B.playing; if (was) stop(); pushUndo(); const k = keyAt(B.cur), rt = M.retime(B.keys.map(q => q.frame), B.speed), f0 = first();
    B.cur = k >= 0 ? rt[k] : AT.clamp(f0 + Math.round((B.cur - f0) / B.speed), rt[0], rt[rt.length - 1]); B.keys.forEach((q, i) => q.frame = rt[i]); B.speed = 1; note = 'Timing kept: the key poses moved'; sync(); if (was) play(); };
  $('#bAngle').addEventListener('input', e => { if (B.playing) stop(); if (!sliding) { pushUndo(); sliding = true; } const k = ensureKey(), v = +e.target.value; k.pose = B.sel === 'lean' ? M.leanTo(k.pose, v) : Object.assign({}, k.pose, { [B.sel]: v }); sync(true); });
  $('#bAngle').addEventListener('change', e => { sliding = false; blur(e); sync(); });
  $('#bStand').onclick = () => { if (B.playing) stop(); pushUndo(); const k = ensureKey(); k.pose = Object.assign(M.stand(), { x: k.pose.x }); sync(); };
  for (const [id, pre] of [['bWalk', 'walk'], ['bPick', 'pickUp'], ['bRaise', 'raiseHand'], ['bDemo', 'starter'], ['bHappy', 'happyWalk'], ['bSneak', 'sneak'], ['bTired', 'tiredWalk'], ['bRun', 'run'], ['bJump', 'jump'], ['bStop', 'stopShort']]) $('#' + id).onclick = () => { if (B.playing) stop(); pushUndo(); loadPreset(pre); note = ''; sync(); };
  $$('#bViews .tab').forEach(t => t.onclick = () => { B.view = t.dataset.view; note = ''; sync(); });
  for (const [id, n] of [['bShowAction', 'action'], ['bShowBalance', 'balance'], ['bShowPivots', 'pivots'], ['bShowLimits', 'limits'], ['bShowMuscles', 'muscles'], ['bShowTrails', 'trails'], ['bChartSame', 'chartSame'], ['bChartPose', 'chartPose']]) $('#' + id).onchange = e => { B[n] = e.target.checked; blur(e); sync(); };
  $('#bKK').onchange = e => { const i = keyAt(B.cur); if (i < 0) return; pushUndo(); B.keys[i].kind = e.target.value; blur(e); sync(); };
  $('#bKL').onchange = e => { const i = keyAt(B.cur); if (i < 0) return; pushUndo(); B.keys[i].label = e.target.value.trim().slice(0, 24); blur(e); sync(); };
  $('#bUndo').onclick = doUndo;
  $('#bSave').onclick = () => { download(new Blob([JSON.stringify(motionJSON(), null, 1)], { type: 'application/json' }), 'body_motion.json'); $('#bSaveInfo').textContent = 'Saved body_motion.json (' + B.keys.length + ' key poses).'; };
  $('#bLoadBtn').onclick = () => $('#bLoad').click();
  async function openFile(file) { let j = null; try { j = JSON.parse(await file.text()); } catch (e) {} if (B.playing) stop(); const keep = snap();
    if (j && j.kind === 'animtk-body-motion' && loadMotion(j)) { undo.push(keep); B.view = 'pose'; fitView(); $('#bSaveInfo').textContent = 'Opened ' + file.name + ' (' + B.keys.length + ' key poses).'; note = ''; } else $('#bSaveInfo').textContent = file.name + ' is not a saved body motion.'; sync(); }
  $('#bLoad').onchange = e => { if (e.target.files[0]) openFile(e.target.files[0]); e.target.value = ''; };
  $('#bPng').onclick = () => { const c = document.createElement('canvas'); c.width = view.width; c.height = view.height; const g = c.getContext('2d'); g.fillStyle = OUT; g.fillRect(0, 0, c.width, c.height); g.drawImage(view, 0, 0);
    c.toBlob(b => { const name = B.view === 'chart' ? 'body_proportions.png' : B.view === 'sheet' ? 'hands_and_feet.png' : 'body_frame_' + String(Math.round(B.cur)).padStart(4, '0') + '.png'; download(b, name); $('#bSaveInfo').textContent = 'Saved ' + name + '.'; }); };

  // ---------- posing with the mouse
  const pos = e => { const r = view.getBoundingClientRect(), d = view.width / r.width; return [(e.clientX - r.left) * d, (e.clientY - r.top) * d]; };
  const dseg = (m, a, b) => { const vx = b[0] - a[0], vy = b[1] - a[1], t = AT.clamp(((m[0] - a[0]) * vx + (m[1] - a[1]) * vy) / (vx * vx + vy * vy || 1), 0, 1); return Math.hypot(m[0] - a[0] - vx * t, m[1] - a[1] - vy * t); };
  function hit(m) {                                    // a dot first, then the body part in front
    const J = M.fk(pose()).J, dpr = tf.dpr; let best = null, bd = 11 * dpr;
    for (const n of DOTS) { const p = scr(J[n]), d = Math.hypot(p[0] - m[0], p[1] - m[1]); if (d < bd) { bd = d; best = n; } }
    if (best) { let a = DOTACT[best]; if (!B.ik && /^(arm|leg)/.test(a)) a = (a[0] === 'a' ? 'elbow' : 'knee') + a.slice(-1); return { act: a, own: OWN[best] }; }
    for (const [a, b, wd, par] of BONES) if (dseg(m, scr(J[a]), scr(J[b])) <= Math.max(wd * tf.s / 2, 6 * dpr)) return { act: par, own: par };
    return null;
  }
  function begin() {                                   // the first real movement of a drag: make sure this frame is a key pose, remember where it started
    pushUndo(); const k = ensureKey(), p0 = Object.assign({}, k.pose), f = M.fk(p0), w = wld(drag.m), a = drag.act; Object.assign(drag, { live: true, key: k, p0, q: p0 });
    if (a === 'move') { drag.off = [w[0] - p0.x, w[1] - p0.y]; B.sel = 'lean'; }
    else if (/^(arm|leg)/.test(a)) { const s = a.slice(-1), arm = a[0] === 'a', j = f.J[(arm ? 'wrist' : 'ankle') + s]; drag.off = [w[0] - j[0], w[1] - j[1]]; B.sel = (arm ? 'elbow' : 'knee') + s; }
    else { drag.piv = f.J[ACT[a][0]]; drag.a0 = drag.last = M.ang(w[0] - drag.piv[0], w[1] - drag.piv[1]); B.sel = a; }
  }
  view.addEventListener('pointerdown', e => { if (B.view !== 'pose') return; if (B.playing) stop(); const m = pos(e), h = hit(m); view.setPointerCapture(e.pointerId); note = '';
    drag = h ? Object.assign(h, { m, live: false }) : { pan: true, m, cx: B.cx, cy: B.cy }; });
  view.addEventListener('pointermove', e => {
    const m = pos(e); if (!drag) { view.style.cursor = tf && B.view === 'pose' && hit(m) ? 'grab' : 'default'; return; }
    if (drag.pan) { B.cx = drag.cx - (m[0] - drag.m[0]) / tf.s; B.cy = drag.cy + (m[1] - drag.m[1]) / tf.s; draw(); return; }
    if (!drag.act) return; if (!drag.live) { if (Math.hypot(m[0] - drag.m[0], m[1] - drag.m[1]) < 3 * tf.dpr) return; begin(); }
    const w = wld(m), a = drag.act; let q;
    if (a === 'move') q = M.moveHips(drag.p0, w[0] - drag.off[0], w[1] - drag.off[1], B.plant);
    else if (/^arm/.test(a)) q = M.pullArm(drag.q, a.slice(-1), [w[0] - drag.off[0], w[1] - drag.off[1]]);
    else if (/^leg/.test(a)) q = M.pullLeg(drag.q, a.slice(-1), [w[0] - drag.off[0], w[1] - drag.off[1]]);
    else { const t = M.near(M.ang(w[0] - drag.piv[0], w[1] - drag.piv[1]), drag.last); drag.last = t; let v = drag.p0[a] + (t - drag.a0) * ACT[a][1]; if (e.shiftKey) v = Math.round(v / 15) * 15;
      q = a === 'lean' ? M.leanTo(drag.p0, v) : Object.assign({}, drag.p0, { [a]: v }); }
    drag.q = q; drag.key.pose = q; sync(true);
  });
  const drop = () => { if (!drag) return; const d = drag; drag = null; if (d.pan) return; if (!d.live) { if (d.own) B.sel = d.own; sync(true); } else sync(); };
  view.addEventListener('pointerup', drop); view.addEventListener('pointercancel', drop);
  view.addEventListener('wheel', e => { e.preventDefault(); if (B.view !== 'pose') return; B.zoom = AT.clamp(B.zoom * Math.exp(-e.deltaY * 0.0012), 0.4, 3); draw(); }, { passive: false });
  view.addEventListener('dblclick', e => { if (B.view === 'pose' && !hit(pos(e))) { B.zoom = 1; B.cx = 0; B.cy = 4.5; draw(); } });

  // ---------- the timeline: click or drag to scrub, drag a diamond to move that key pose
  const tpos = e => { const r = tl.getBoundingClientRect(), d = tl.width / r.width; return [(e.clientX - r.left) * d, (e.clientY - r.top) * d]; };
  const tFrame = mx => AT.clamp(Math.round((mx - ttf.x0) / ttf.px) + 1, 1, ttf.end);
  tl.addEventListener('pointerdown', e => { if (B.playing) stop(); const [mx, my] = tpos(e); tl.setPointerCapture(e.pointerId); note = '';
    let k = -1, bd = 10 * ttf.dpr; if (Math.abs(my - ttf.ky) < 14 * ttf.dpr) B.keys.forEach((q, i) => { const d = Math.abs(ttf.x0 + (q.frame - 1) * ttf.px - mx); if (d < bd) { bd = d; k = i; } });
    if (k >= 0) { tdrag = { key: B.keys[k], moved: false }; B.cur = B.keys[k].frame; } else { tdrag = { scrub: true }; B.cur = tFrame(mx); } sync(true); });
  tl.addEventListener('pointermove', e => {
    if (!tdrag) return; const f = tFrame(tpos(e)[0]); if (tdrag.scrub) { if (f !== B.cur) { B.cur = f; sync(true); } return; }
    const i = B.keys.indexOf(tdrag.key), nf = AT.clamp(f, i ? B.keys[i - 1].frame + 1 : 1, i < B.keys.length - 1 ? B.keys[i + 1].frame - 1 : 1e6);
    if (nf !== tdrag.key.frame) { if (!tdrag.moved) { pushUndo(); tdrag.moved = true; } tdrag.key.frame = nf; B.cur = nf; sync(true); }
  });
  const tdrop = () => { if (!tdrag) return; const m = tdrag.moved; tdrag = null; if (m) sync(); };
  tl.addEventListener('pointerup', tdrop); tl.addEventListener('pointercancel', tdrop);

  window.addEventListener('keydown', e => {
    if (!active() || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return; const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); doUndo(); }
    else if (e.ctrlKey || e.metaKey || e.altKey) return;
    else if (e.code === 'Space') { e.preventDefault(); B.playing ? stop() : play(); }
    else if (k === 'arrowleft' || k === 'arrowright') { e.preventDefault(); const d = k === 'arrowleft' ? -1 : 1; if (e.shiftKey) jump(d); else { if (B.playing) stop(); B.cur = AT.clamp(Math.round(B.cur) + d, 1, ttf ? ttf.end : last()); note = ''; sync(true); } }
    else if (k === 'k') $('#bAdd').click(); else if (k === 'o') $('#bOnion').click(); else if (k === 'delete') $('#bDel').click();
  });
  window.addEventListener('resize', () => { if (active()) { draw(); drawTime(); } });
  try { const o = JSON.parse(localStorage.getItem(KEY) || 'null'); if (o && loadMotion(o.motion) && o.ui) { for (const n of FLAGS) if (typeof o.ui[n] === 'boolean') B[n] = o.ui[n]; if (VIEWS.includes(o.ui.view)) B.view = o.ui.view; }
    if (o && o.ui) { if (o.ui.onionMode === 'frames') B.onionMode = 'frames'; if ([1, 2, 3].includes(o.ui.onionN)) B.onionN = o.ui.onionN; } } catch (e) {}
  if (!B.keys.length) loadPreset('starter'); else fitView();
  sync(true);
  const at = n => { const p = scr(M.fk(pose()).J[n]), r = view.getBoundingClientRect(); return [r.left + p[0] / tf.dpr, r.top + p[1] / tf.dpr]; };          // where a joint is on the page (for the tests)
  const frameAt = f => { const r = tl.getBoundingClientRect(); return [r.left + (ttf.x0 + (f - 1) * ttf.px) / ttf.dpr, r.top + ttf.ky / ttf.dpr]; };
  return { B, pose, at, frameAt, ghosts, motionJSON, loadMotion, loadPreset, sync, play, stop, isCycle: cycle, balance: () => M.balance(pose()), line: () => M.actionLine(pose()), limits: () => M.limits(pose()), trails: f => M.trails(B.keys, f == null ? B.cur : f, P, cycle()), propNow: () => B.prop ? M.propAt(B.prop, B.keys, B.cur) : null };
})();
