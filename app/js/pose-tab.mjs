// ============================== POSE MATCH: the 3D figure posed from her drawing (build step 4) ==============================
// 1. She opens a drawing, or the Start tab hands one over. Her files are only read, never changed.
// 2. The app guesses a standing skeleton from the ink's size and average proportions. Joints it guessed are hollow,
//    joints she has moved are filled. Any joint can be marked hidden (behind the body, off the panel).
// 3. Per limb she says whether the hand or foot comes toward the camera or goes away, because a flat drawing
//    cannot tell those two apart.
// 4. pose-fit.mjs (the lead's math, not this file) poses the real 3D figure, and renders it as a ghost already lined
//    up with the drawing. This tab shows the ghost, how far each joint misses and how sure the fit is.
//    Her Figure 3D pose is kept and put back after every fit; "Send this pose to Figure 3D" is the only way in.
// Contract with pose-fit.mjs:
//    fitPose(Fig3D, {joints: {name: [x, y] | null}, W, H, camera: {fov, height} | null, flips: {limb: bool}})
//      -> {pose, camera, place, error: {joint: px}, confidence: 0..1, notes: [text], joints2d?: {name: [x, y]}}
//    renderGhost(Fig3D, fit, W, H) -> a W x H transparent canvas registered to the drawing.
// Shared globals used: $, $$, fileImage, PICS, Store, Vec, layerRows, BeforeAfter, newShot, showTab, download (helpers.js,
// shot.js) and FigureTab (figure-tab.js). Saves joints into work/<shot>/shot.json under detections.pose.

const CENTER = [['head', 'Head', 'the middle of the head, between the ears'], ['neck', 'Neck', 'the base of the neck, where it meets the shoulders'],
  ['chest', 'Chest', 'the middle of the ribcage'], ['pelvis', 'Hips', 'the middle of the pelvis, halfway between the hip joints']];
const SIDED = [['shoulder', 'Shoulder', 'the shoulder joint, inside the top of the arm'], ['elbow', 'Elbow', 'the point of the elbow'],
  ['wrist', 'Wrist', 'the wrist, where the hand starts'], ['hip', 'Hip joint', 'the top of the thigh, at the crease of the leg'],
  ['knee', 'Knee', 'the middle of the knee'], ['ankle', 'Ankle', 'the ankle bone'], ['toe', 'Toes', 'the ball of the foot (optional, off until you place it)']];
const SIDE_WORD = { l: 'its left', r: 'its right' };
// [name, label, where to put it, side]. "l" is the character's own left, which is on the picture's right when it faces you.
const JOINTS = [...CENTER.map(j => [...j, '']), ...['l', 'r'].flatMap(s => SIDED.map(([n, l, w]) => [n + '_' + s, l + ' (' + SIDE_WORD[s] + ')', w, s]))];
const JMAP = Object.fromEntries(JOINTS.map(j => [j[0], j]));
const OPTIONAL = new Set(['toe_l', 'toe_r']);
const BONES = [['head', 'neck'], ['neck', 'chest'], ['chest', 'pelvis'],
  ...['l', 'r'].flatMap(s => [['neck', 'shoulder_' + s], ['shoulder_' + s, 'elbow_' + s], ['elbow_' + s, 'wrist_' + s],
    ['pelvis', 'hip_' + s], ['hip_' + s, 'knee_' + s], ['knee_' + s, 'ankle_' + s], ['ankle_' + s, 'toe_' + s]])];
const LIMBS = [['arm_l', 'Arm (its left)', 'hand'], ['arm_r', 'Arm (its right)', 'hand'], ['leg_l', 'Leg (its left)', 'foot'], ['leg_r', 'Leg (its right)', 'foot']];
const COL = { l: '#3b6cff', r: '#ff8a1f', '': '#b45cff' }, MISS = '#e8202a';
const colOf = n => COL[(JMAP[n] || [])[3] || ''];
const HEADS = [['7.5', 'Realistic adult (7.5 heads)'], ['6', 'Stylized (6 heads)'], ['4.5', 'Cartoony (4.5 heads)'], ['3', 'Chibi (3 heads)']];
const LENSES = [['auto', 'Let the fit guess'], ['70', 'Wide (70°)'], ['45', 'Normal (45°)'], ['28', 'Long (28°)'], ['12', 'Very long, flat (12°)']];
const HEIGHTS = [['auto', 'Let the fit guess'], ['0.25', "Down at the feet (worm's eye)"], ['1.0', 'Waist height'], ['1.6', 'Eye level'], ['3.0', "Up high (bird's eye)"]];
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = { get(k, d) { try { const v = localStorage.getItem('animtk-pose:' + k); return v == null ? d : v; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem('animtk-pose:' + k, String(v)); } catch (e) {} } };

// ---------- the starting guess: standing, facing the viewer, fitted to a box around the character
// box {x, y, w, h} in drawing pixels, heads = how many heads tall. Fractions are of the whole height, top to toe.
function guessJoints(box, heads) {
  const hd = 1 / Math.max(2, heads), neckY = hd * 1.08, B = 1 - neckY;
  const T = { head: [0, hd / 2], neck: [0, neckY], chest: [0, neckY + 0.14 * B], pelvis: [0, neckY + 0.39 * B],
    shoulder: [0.135 * B, neckY + 0.04 * B], elbow: [0.155 * B, neckY + 0.275 * B], wrist: [0.16 * B, neckY + 0.41 * B],
    hip: [0.065 * B, neckY + 0.4 * B], knee: [0.062 * B, neckY + 0.67 * B], ankle: [0.058 * B, neckY + 0.94 * B], toe: [0.075 * B, 0.995] };
  const cx = box.x + box.w / 2, out = {};
  for (const [n, , , s] of JOINTS) {
    const t = T[s ? n.slice(0, -2) : n], dx = t[0] * box.h * (s === 'l' ? 1 : s === 'r' ? -1 : 0);
    out[n] = { x: cx + dx, y: box.y + t[1] * box.h, by: 'app', hidden: OPTIONAL.has(n) };
  }
  return out;
}

// ---------- where the character is: the biggest connected blob of ink that is not a frame around the picture
function inkBox(img, W, H) {
  const k = Math.min(1, 480 / Math.max(W, H)), w = Math.max(8, Math.round(W * k)), h = Math.max(8, Math.round(H * k)), n = w * h;
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, h); const d = g.getImageData(0, 0, w, h).data, lum = new Float32Array(n);
  let clear = 0; for (let i = 0; i < n; i++) { if (d[i * 4 + 3] < 20) clear++; lum[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; }
  const byAlpha = clear > n * 0.15;                // a transparent PNG: the ink is whatever is not see-through
  const border = []; for (let x = 0; x < w; x++) border.push(lum[x], lum[(h - 1) * w + x]); for (let y = 0; y < h; y++) border.push(lum[y * w], lum[y * w + w - 1]);
  border.sort((a, b) => a - b); const paper = border[Math.floor(border.length * 0.6)];
  const m = new Uint8Array(n); for (let i = 0; i < n; i++) m[i] = d[i * 4 + 3] > 60 && (byAlpha || lum[i] < paper - 40) ? 1 : 0;
  for (let pass = 0; pass < 2; pass++) {         // join sketchy, broken strokes: grow the ink by a pixel, twice
    const o = m.slice(); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (!o[i] && ((x > 0 && o[i - 1]) || (x < w - 1 && o[i + 1]) || (y > 0 && o[i - w]) || (y < h - 1 && o[i + w]))) m[i] = 1; }
  }
  const lab = new Uint8Array(n), stack = new Int32Array(n); let best = null;
  for (let s0 = 0; s0 < n; s0++) {
    if (!m[s0] || lab[s0]) continue; let top = 0, cnt = 0, x0 = w, x1 = -1, y0 = h, y1 = -1; stack[top++] = s0; lab[s0] = 1;
    while (top) {
      const i = stack[--top], x = i % w, y = (i - x) / w; cnt++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && m[i - 1] && !lab[i - 1]) { lab[i - 1] = 1; stack[top++] = i - 1; }
      if (x < w - 1 && m[i + 1] && !lab[i + 1]) { lab[i + 1] = 1; stack[top++] = i + 1; }
      if (y > 0 && m[i - w] && !lab[i - w]) { lab[i - w] = 1; stack[top++] = i - w; }
      if (y < h - 1 && m[i + w] && !lab[i + w]) { lab[i + w] = 1; stack[top++] = i + w; }
    }
    const edges = (x0 <= 1) + (x1 >= w - 2) + (y0 <= 1) + (y1 >= h - 2);
    if (cnt < 12 || edges >= 3) continue;          // specks, and a border drawn around the panel
    if (!best || cnt > best.cnt) best = { cnt, x0, x1, y0, y1 };
  }
  if (!best) return { x: W * 0.3, y: H * 0.08, w: W * 0.4, h: H * 0.84, found: false };
  const X0 = (best.x0 + 2) / k, X1 = (best.x1 - 1) / k, Y0 = (best.y0 + 2) / k, Y1 = (best.y1 - 1) / k;   // undo the two pixels of growing
  return { x: X0, y: Y0, w: Math.max(4, X1 - X0), h: Math.max(4, Y1 - Y0), found: true };
}

// ---------- the tab
export async function start(root) {
  if (window.PoseTab) return window.PoseTab;
  root.innerHTML = `
  <div class="side">
    <div class="card">
      <h2>Your drawing</h2>
      <div class="row"><button class="primary" id="pmOpen" style="flex:1">Open a drawing</button></div>
      <input type="file" id="pmFile" accept="image/*,.psd" multiple hidden>
      <div class="plist" id="pmList" style="margin-top:6px"></div>
      <div class="muted" id="pmInfo">PNG, JPG or a flattened PSD. Your file is only read, never changed.</div>
    </div>
    <div class="card">
      <h2>Joints</h2>
      <div class="f2"><label>Guess as</label><select id="pmHeads">${HEADS.map(([v, l]) => '<option value="' + v + '">' + l + '</option>').join('')}</select></div>
      <div class="row"><button id="pmGuess" style="flex:1" title="Put the joints you have not moved back on the guess">Guess again</button><button id="pmBox" style="flex:1" title="Drag a box around the character and the guess fits inside it">Box the character</button></div>
      <div style="margin-top:8px"><b id="pmSelName">Click a joint</b></div>
      <div class="muted" id="pmSelWhere"></div>
      <label class="chk"><input type="checkbox" id="pmHidden">This joint is hidden (behind the body or off the panel)</label>
      <div class="muted" id="pmCount" style="margin-top:4px"></div>
      <details style="margin-top:6px"><summary class="muted" style="cursor:pointer">All joints</summary><div class="plist" id="pmJoints" style="max-height:260px;margin-top:4px"></div></details>
      <div class="row"><button id="pmUndo" style="flex:1">Undo</button><button id="pmReset" style="flex:1" title="Every joint back on the guess, yours too">Start over</button></div>
    </div>
    <div class="card">
      <h2>Toward or away</h2>
      <div class="muted" style="margin-bottom:4px">A drawing cannot show whether a hand or foot comes at you or goes back. If the ghost has one backwards, flip that limb.</div>
      <div id="pmFlips"></div>
    </div>
    <div class="card">
      <h2>Camera</h2>
      <div class="f2"><label>Lens</label><select id="pmLens">${LENSES.map(([v, l]) => '<option value="' + v + '">' + l + '</option>').join('')}</select></div>
      <div class="f2"><label>Height</label><select id="pmCamH">${HEIGHTS.map(([v, l]) => '<option value="' + v + '">' + l + '</option>').join('')}</select></div>
    </div>
  </div>
  <div class="stage" id="pmStage"><canvas id="pmView"></canvas>
    <div class="soon" id="pmEmpty" style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;pointer-events:none"><b>Open a drawing to match a pose</b>Or drop one here. The app guesses the joints, you drag the ones that are off.</div>
    <div class="readout" id="pmReadout" style="display:none"></div>
    <div class="hint" id="pmHint">Drag a joint onto your drawing. Hollow dots are the app's guesses, filled dots are yours. Drag empty space to move around, scroll to zoom. H hides the selected joint, Ctrl+Z undoes.</div>
  </div>
  <div class="side">
    <div class="card">
      <h2>Fit the 3D figure</h2>
      <button class="primary" id="pmFit" style="width:100%" disabled>Fit the figure</button>
      <label class="chk"><input type="checkbox" id="pmAuto">Fit again when I let go of a joint</label>
      <div class="f2"><label>Body</label><select id="pmBody"></select></div>
      <div class="f2"><label>Build</label><select id="pmBuild"></select></div>
      <div class="muted">The body and build are shared with the Figure 3D tab.</div>
      <div id="pmConf" style="margin-top:8px"></div>
      <div class="muted" id="pmNotes"></div>
    </div>
    <div class="card">
      <h2>Layers</h2>
      <div id="pmLayers"></div>
      <label class="chk"><input type="checkbox" id="pmTint" checked>Tint the ghost blue</label>
      <label class="chk"><input type="checkbox" id="pmBA">Before / after slider</label>
    </div>
    <div class="card">
      <h2>Save</h2>
      <button id="pmExportGhost" style="width:100%">Export the ghost (transparent PNG)</button>
      <button id="pmCopy" style="width:100%;margin-top:6px" title="A new numbered copy, never replacing an earlier one">Save drawing + ghost as a copy</button>
      <button id="pmSend" style="width:100%;margin-top:6px">Send this pose to Figure 3D</button>
      <div class="muted" id="pmSaveInfo" style="margin-top:6px"></div>
    </div>
  </div>`;
  const stage = $('#pmStage', root), cv = $('#pmView', root), ctx = cv.getContext('2d');
  const S = { items: [], cur: null, heads: +store.get('heads', 6), lens: store.get('lens', 'auto'), camH: store.get('camH', 'auto'), autoFit: store.get('auto', '1') === '1', tint: store.get('tint', '1') === '1',
    lay: { drawing: { on: true, op: 100 }, ghost: { on: true, op: 60 }, skel: { on: true, op: 100 }, miss: { on: true, op: 100 } } };
  const UI = { view: { x: 0, y: 0, s: 1 }, fitted: false, sel: null, drag: null, tool: null, space: false, fitting: false, again: false, undo: [] };
  let Fig = null, PF = null, pfTries = 0;
  const BA = BeforeAfter(stage, () => draw()); UI.ba = BA;
  const active = () => root.classList.contains('on');
  const say = t => { $('#pmSaveInfo', root).textContent = t || ''; };

  // ---------- the 3D figure and the fitting module, both loaded in the background
  const figReady = (async () => {
    try { Fig = typeof FigureTab !== 'undefined' ? await FigureTab.load() : null; } catch (e) { Fig = null; }
    Fig = Fig || window.Fig3D || null; syncFit(); return Fig;
  })();
  async function fitModule() {
    if (PF) return PF;
    try { PF = await import(new URL('./pose-fit.mjs' + (pfTries++ ? '?try=' + pfTries : ''), import.meta.url).href); } catch (e) { PF = null; }
    if (PF && (typeof PF.fitPose !== 'function' || typeof PF.renderGhost !== 'function')) PF = null;
    return PF;
  }
  fitModule().then(syncFit);

  // ---------- drawings
  async function loadFiles(files, shotName) {
    const pics = [...(files || [])].filter(f => PICS.test(f.name));
    if (!pics.length) { $('#pmInfo', root).textContent = 'That is not a picture this tab can read. PNG, JPG or a flattened PSD.'; return; }
    let first = null;
    for (const f of pics) {
      let img; try { img = await fileImage(f); } catch (e) { $('#pmInfo', root).textContent = 'Could not open ' + f.name + ': ' + e.message; continue; }
      const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
      const it = { file: f, name: f.name, shot: Store.safe(shotName || f.name), img, W, H, j: null, flips: {}, fit: null, ghost: null, tinted: null, box: null, ink: null };
      it.ink = inkBox(img, W, H); it.j = guessJoints(it.ink, S.heads);
      const old = S.items.findIndex(x => x.name === it.name && x.shot === it.shot);
      if (old >= 0) S.items.splice(old, 1, it); else S.items.push(it);
      first = first || it;
      await restore(it);
    }
    if (first) { pick(first); if (first.restored && first.restored.fit) fitModule().then(m => { if (m && S.cur === first) refitSoon(); }); }
  }
  async function restore(it) {                     // her joints from an earlier visit, if the shot file has them
    const shot = await Store.loadShot(it.shot), P = shot && shot.detections && shot.detections.pose, d = P && P.drawings && P.drawings[it.name];
    if (!d || d.W !== it.W || d.H !== it.H || !d.joints) return;
    for (const n in d.joints) { const q = d.joints[n]; if (JMAP[n] && q && isFinite(q.x) && isFinite(q.y)) it.j[n] = { x: q.x, y: q.y, by: q.by === 'you' ? 'you' : 'app', hidden: !!q.hidden }; }
    it.flips = { ...(d.flips || {}) }; it.restored = d;
  }
  function pick(it) {
    for (const x of S.items) if (x !== it) { x.ghost = null; x.tinted = null; }   // ghosts are big: only the open drawing keeps one
    S.cur = it; UI.sel = null; UI.undo = []; UI.fitted = false;
    if (it && it.fit && !it.ghost) refitSoon();
    syncAll(); fit0();
  }

  // ---------- view
  function size() { const r = stage.getBoundingClientRect(); return [Math.max(2, r.width), Math.max(2, r.height)]; }
  function fit0() {
    const it = S.cur, [rw, rh] = size(); if (!it) { draw(); return; }
    if (rw < 60 || rh < 60) { UI.fitted = false; draw(); return; }   // the tab is hidden: fit when it shows
    const s = Math.min((rw - 40) / it.W, (rh - 40) / it.H); UI.view = { s, x: (rw - it.W * s) / 2, y: (rh - it.H * s) / 2 }; UI.fitted = true; draw();
  }
  const toD = (sx, sy) => [(sx - UI.view.x) / UI.view.s, (sy - UI.view.y) / UI.view.s];
  const toS = (x, y) => [UI.view.x + x * UI.view.s, UI.view.y + y * UI.view.s];
  function tinted(it) {
    if (!it.ghost) return null; if (!S.tint) return it.ghost; if (it.tinted) return it.tinted;
    const c = document.createElement('canvas'); c.width = it.W; c.height = it.H; const g = c.getContext('2d');
    g.drawImage(it.ghost, 0, 0); g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(59,108,255,.42)'; g.fillRect(0, 0, it.W, it.H);
    return (it.tinted = c);
  }
  function missLimit(it) {                         // how far off a joint can be before it is called out: 1.5% of the body's height
    const ys = JOINTS.map(([n]) => it.j[n]).filter(q => q && !q.hidden).map(q => q.y);
    return Math.max(4, 0.015 * (Math.max(...ys) - Math.min(...ys) || it.H));
  }
  function misses(it) {
    if (!it.fit || !it.fit.error) return []; const lim = missLimit(it);
    return Object.entries(it.fit.error).filter(([n, e]) => JMAP[n] && isFinite(e) && e > lim && it.j[n] && !it.j[n].hidden).sort((a, b) => b[1] - a[1]);
  }

  // ---------- drawing the stage
  function paintDrawing(g, it, op) { g.fillStyle = '#fff'; g.fillRect(0, 0, it.W, it.H); if (op > 0) { g.globalAlpha = op; g.drawImage(it.img, 0, 0, it.W, it.H); g.globalAlpha = 1; } }
  function paintSkel(g, it, px) {
    g.lineCap = 'round';
    for (const [a, b] of BONES) {
      const p = it.j[a], q = it.j[b]; if (!p || !q) continue; const hid = p.hidden || q.hidden; if (hid && (OPTIONAL.has(a) || OPTIONAL.has(b))) continue;
      g.strokeStyle = colOf(b); g.lineWidth = px(hid ? 1.5 : 3); g.setLineDash(hid ? [px(5), px(5)] : []); g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke();
    }
    g.setLineDash([]);
    for (const [n] of JOINTS) {
      const q = it.j[n]; if (!q) continue; const sel = UI.sel === n, r = px(sel ? 8 : 6.5), col = colOf(n);
      if (q.hidden && OPTIONAL.has(n) && !sel) { g.fillStyle = col; g.globalAlpha = 0.45; g.beginPath(); g.arc(q.x, q.y, px(3), 0, 7); g.fill(); g.globalAlpha = 1; continue; }
      g.beginPath(); g.arc(q.x, q.y, r, 0, 7);
      if (q.hidden) {
        g.strokeStyle = col; g.lineWidth = px(1.6); g.setLineDash([px(3), px(3)]); g.stroke(); g.setLineDash([]);
        const e = r * 0.55; g.beginPath(); g.moveTo(q.x - e, q.y - e); g.lineTo(q.x + e, q.y + e); g.moveTo(q.x + e, q.y - e); g.lineTo(q.x - e, q.y + e); g.stroke();
      } else if (q.by === 'you') { g.fillStyle = col; g.fill(); g.strokeStyle = '#fff'; g.lineWidth = px(2); g.stroke(); }
      else { g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = px(5); g.stroke(); g.strokeStyle = col; g.lineWidth = px(2.6); g.stroke(); }
      if (sel) { g.strokeStyle = '#ff2f86'; g.lineWidth = px(2); g.beginPath(); g.arc(q.x, q.y, r + px(5), 0, 7); g.stroke(); }
    }
    if (UI.sel && it.j[UI.sel]) { const q = it.j[UI.sel], t = JMAP[UI.sel][1]; g.font = '600 ' + px(13) + 'px system-ui, Segoe UI, sans-serif'; g.lineWidth = px(4); g.strokeStyle = 'rgba(255,255,255,.95)'; g.strokeText(t, q.x + px(14), q.y - px(10)); g.fillStyle = '#1f1a24'; g.fillText(t, q.x + px(14), q.y - px(10)); }
  }
  function paintMiss(g, it, px) {
    const j2 = it.fit && it.fit.joints2d;
    g.strokeStyle = MISS; g.fillStyle = MISS;
    for (const [n, e] of misses(it)) {
      const q = it.j[n], f = j2 && j2[n];
      if (f) { g.lineWidth = px(2.5); g.beginPath(); g.moveTo(q.x, q.y); g.lineTo(f[0], f[1]); g.stroke(); g.beginPath(); g.arc(f[0], f[1], px(4), 0, 7); g.fill(); }
      else { g.lineWidth = px(2); g.setLineDash([px(6), px(5)]); g.beginPath(); g.arc(q.x, q.y, e, 0, 7); g.stroke(); g.setLineDash([]); }
      const t = Math.round(e) + ' px'; g.font = '700 ' + px(12) + 'px system-ui, Segoe UI, sans-serif'; g.lineWidth = px(3.5); g.strokeStyle = 'rgba(255,255,255,.95)';
      g.strokeText(t, q.x + px(10), q.y + px(18)); g.fillText(t, q.x + px(10), q.y + px(18)); g.strokeStyle = MISS;
    }
  }
  function draw() {
    const [w, h] = size(), dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const it = S.cur; $('#pmEmpty', root).style.display = it ? 'none' : 'flex'; if (!it) { readout(); return; }
    const v = UI.view, px = n => n / v.s, L = S.lay;
    ctx.setTransform(dpr * v.s, 0, 0, dpr * v.s, dpr * v.x, dpr * v.y);
    paintDrawing(ctx, it, L.drawing.on ? L.drawing.op / 100 : 0);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, it.W, it.H); ctx.clip();
    const gh = tinted(it); if (gh && L.ghost.on) { ctx.globalAlpha = L.ghost.op / 100; ctx.drawImage(gh, 0, 0); ctx.globalAlpha = 1; }
    if (L.miss.on) { ctx.globalAlpha = L.miss.op / 100; paintMiss(ctx, it, px); ctx.globalAlpha = 1; }
    ctx.restore();
    if (L.skel.on) { ctx.save(); ctx.globalAlpha = L.skel.op / 100; paintSkel(ctx, it, px); ctx.restore(); }
    if (BA.on) {                                   // left of the handle: the drawing untouched
      const xd = Math.min(it.W, (BA.x - v.x) / v.s);
      if (xd > 0) { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, xd, it.H); ctx.clip(); paintDrawing(ctx, it, 1); ctx.restore(); }
    }
    if (UI.drag && UI.drag.kind === 'box') { const d = UI.drag; ctx.strokeStyle = '#ff2f86'; ctx.lineWidth = px(2); ctx.setLineDash([px(8), px(6)]); ctx.strokeRect(Math.min(d.a[0], d.b[0]), Math.min(d.a[1], d.b[1]), Math.abs(d.b[0] - d.a[0]), Math.abs(d.b[1] - d.a[1])); ctx.setLineDash([]); }
    ctx.strokeStyle = 'rgba(255,143,184,.9)'; ctx.lineWidth = px(1); ctx.strokeRect(0, 0, it.W, it.H);
    readout();
  }
  function readout() {
    const it = S.cur, r = $('#pmReadout', root); if (!it) { r.style.display = 'none'; return; } r.style.display = '';
    const lines = [it.name + ', ' + it.W + ' x ' + it.H];
    if (UI.tool === 'box') lines.push('Drag a box around the character.');
    else if (UI.sel && it.j[UI.sel]) { const q = it.j[UI.sel]; lines.push(JMAP[UI.sel][1] + ': ' + (q.hidden ? 'hidden' : (q.by === 'you' ? 'placed by you' : "the app's guess") + ' at ' + Math.round(q.x) + ', ' + Math.round(q.y))); }
    if (UI.fitting) lines.push('Fitting the figure...');
    else if (it.fit) { const c = it.fit.confidence; lines.push(sureWords(c)[0] + (isFinite(c) ? ' (' + Math.round(c * 100) + '% sure)' : '')); }
    else lines.push('Not fitted yet.');
    r.textContent = lines.join('\n');
  }
  function sureWords(c) {
    if (!isFinite(c)) return ['Fitted', 'var(--dim)'];
    return c >= 0.8 ? ['Good match', 'var(--green)'] : c >= 0.55 ? ['Rough match', 'var(--warn)'] : ['Unsure', 'var(--red)'];
  }

  // ---------- pointer: joints drag, empty space pans, the box tool draws a box
  function hitJoint(sx, sy) {
    const it = S.cur; if (!it) return null; let best = null, bd = 13;
    for (const [n] of JOINTS) { const q = it.j[n]; if (!q) continue; const p = toS(q.x, q.y), d = Math.hypot(p[0] - sx, p[1] - sy) - (n === UI.sel ? 2 : 0); if (d < bd) { bd = d; best = n; } }
    return best;
  }
  const snap = it => JSON.stringify(it.j);
  function pushUndo() { const it = S.cur; if (!it) return; UI.undo.push(snap(it)); if (UI.undo.length > 80) UI.undo.shift(); }
  cv.addEventListener('pointerdown', e => {
    const it = S.cur; if (!it) return; const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    cv.setPointerCapture(e.pointerId);
    if (e.button === 1 || e.button === 2 || UI.space) { UI.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, x: UI.view.x, y: UI.view.y }; return; }
    if (UI.tool === 'box') { const p = toD(sx, sy); UI.drag = { kind: 'box', a: p, b: p }; return; }
    const n = hitJoint(sx, sy);
    if (n) { pushUndo(); UI.sel = n; const q = it.j[n], p = toD(sx, sy); UI.drag = { kind: 'joint', n, dx: q.x - p[0], dy: q.y - p[1], moved: false }; syncSel(); draw(); return; }
    UI.sel = null; syncSel(); UI.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, x: UI.view.x, y: UI.view.y, click: true }; draw();
  });
  cv.addEventListener('pointermove', e => {
    const d = UI.drag, r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    if (!d) { cv.style.cursor = UI.tool === 'box' ? 'crosshair' : hitJoint(sx, sy) ? 'grab' : 'default'; return; }
    if (d.kind === 'pan') { UI.view.x = d.x + e.clientX - d.sx; UI.view.y = d.y + e.clientY - d.sy; draw(); return; }
    const p = toD(sx, sy), it = S.cur;
    if (d.kind === 'box') { d.b = p; draw(); return; }
    if (d.kind === 'joint') { const q = it.j[d.n]; q.x = Math.max(0, Math.min(it.W, p[0] + d.dx)); q.y = Math.max(0, Math.min(it.H, p[1] + d.dy)); q.by = 'you'; q.hidden = false; d.moved = true; syncSel(); draw(); }
  });
  cv.addEventListener('pointerup', () => {
    const d = UI.drag, it = S.cur; UI.drag = null; if (!d || !it) return;
    if (d.kind === 'box') {
      UI.tool = null; $('#pmBox', root).classList.remove('on');
      const x = Math.min(d.a[0], d.b[0]), y = Math.min(d.a[1], d.b[1]), w = Math.abs(d.b[0] - d.a[0]), h = Math.abs(d.b[1] - d.a[1]);
      if (w > 8 && h > 8) { pushUndo(); it.box = { x, y, w, h }; reguess(false); } else draw();
      return;
    }
    if (d.kind === 'joint') { if (!d.moved) UI.undo.pop(); else { changed(); if (S.autoFit) fit(); } }
  });
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('wheel', e => {
    e.preventDefault(); const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, v = UI.view;
    const s = Math.max(0.02, Math.min(8, v.s * Math.exp(-e.deltaY * 0.0015))); v.x = mx - (mx - v.x) * s / v.s; v.y = my - (my - v.y) * s / v.s; v.s = s; draw();
  }, { passive: false });
  stage.addEventListener('dragover', e => e.preventDefault());
  stage.addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer && e.dataTransfer.files.length) loadFiles(e.dataTransfer.files); });
  window.addEventListener('keydown', e => {
    if (!active() || /INPUT|SELECT|TEXTAREA/.test((document.activeElement || {}).tagName || '')) return;
    if (e.code === 'Space') { UI.space = true; e.preventDefault(); return; }
    const it = S.cur; if (!it) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (e.key.toLowerCase() === 'h' && UI.sel) { setHidden(UI.sel, !it.j[UI.sel].hidden); return; }
    if (e.key === 'Escape') { UI.tool = null; UI.sel = null; $('#pmBox', root).classList.remove('on'); syncSel(); draw(); return; }
    const step = e.shiftKey ? 10 : 1, mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (mv && UI.sel) { e.preventDefault(); pushUndo(); const q = it.j[UI.sel]; q.x += mv[0]; q.y += mv[1]; q.by = 'you'; changed(); syncSel(); draw(); }
  });
  window.addEventListener('keyup', e => { if (e.code === 'Space') UI.space = false; });
  window.addEventListener('resize', () => { if (active()) { if (!UI.fitted) fit0(); else draw(); } });
  new ResizeObserver(() => { if (active()) { if (!UI.fitted) fit0(); else draw(); } }).observe(stage);

  // ---------- joints
  function setHidden(n, on) { const it = S.cur; if (!it || !it.j[n]) return; pushUndo(); it.j[n].hidden = on; if (!on && OPTIONAL.has(n)) it.j[n].by = 'you'; changed(); syncSel(); draw(); if (S.autoFit && it.fit) fit(); }
  function undo() { const it = S.cur; if (!it || !UI.undo.length) return; it.j = JSON.parse(UI.undo.pop()); changed(); syncSel(); draw(); }
  function reguess(all) {                          // the joints she has not moved (or all of them) go back on the guess
    const it = S.cur; if (!it) return; const g = guessJoints(it.box || it.ink, S.heads);
    for (const n in g) if (all || !it.j[n] || it.j[n].by !== 'you') it.j[n] = g[n];
    changed(); syncSel(); draw();
  }
  function changed() { saveSoon(); }

  // ---------- fitting
  function cameraOpt() { const fov = S.lens === 'auto' ? null : +S.lens, height = S.camH === 'auto' ? null : +S.camH; return fov == null && height == null ? null : { fov, height }; }
  function jointsOut(it) { const o = {}; for (const [n] of JOINTS) { const q = it.j[n]; o[n] = q && !q.hidden ? [Math.round(q.x * 10) / 10, Math.round(q.y * 10) / 10] : null; } return o; }
  let refitT = 0; function refitSoon() { clearTimeout(refitT); refitT = setTimeout(() => fit(), 30); }
  async function fit() {
    const it = S.cur; if (!it) return null;
    if (UI.fitting) { UI.again = true; return null; }
    UI.fitting = true; syncFit(); readout();
    let res = null, msg = '';
    try {
      await figReady; if (!Fig) { msg = location.protocol === 'file:' ? 'The 3D figure needs the toolkit shortcut (or python serve.py). Your joints still save with the shot.' : 'The 3D figure did not load. See the Figure 3D tab for why.'; return null; }
      if (!(await fitModule())) { msg = 'Pose fitting is still being built. You can place the joints now, they are kept with the shot.'; return null; }
      const keep = Fig.getPose(), clip = Fig.S.clip ? { id: Fig.S.clip.id, t: Fig.S.t, playing: Fig.S.playing } : null;
      try {
        res = await PF.fitPose(Fig, { joints: jointsOut(it), W: it.W, H: it.H, camera: cameraOpt(), flips: { ...it.flips } });
        if (res && res.pose) { Fig.setPose(res.pose); it.ghost = await PF.renderGhost(Fig, res, it.W, it.H); it.tinted = null; }
      } finally {
        Fig.setPose(keep);                           // her Figure 3D pose, exactly as it was
        if (clip) { Fig.playClip(clip.id).then(() => { Fig.seek(clip.t); if (clip.playing) Fig.play(); }).catch(() => {}); }
      }
      if (!res) msg = 'The fit gave nothing back. Try placing a few more joints.';
      else if (S.cur === it) { it.fit = res; saveSoon(); }
      return res;
    } catch (e) { console.error(e); msg = 'The fit stopped with an error: ' + (e && e.message || e); return null; }
    finally {
      UI.fitting = false; if (msg) say(msg); syncFit(); draw();
      if (UI.again) { UI.again = false; fit(); }
    }
  }

  // ---------- saving: joints into the shot file, layers as transparent PNGs, copies as new versions
  function vecLayers(it) {
    const k = it.W / 3840, skel = [], miss = [];
    for (const [a, b] of BONES) { const p = it.j[a], q = it.j[b]; if (p && q && !p.hidden && !q.hidden) skel.push({ t: 'line', a: [p.x, p.y], b: [q.x, q.y], color: colOf(b), w: 5 }); }
    for (const [n] of JOINTS) { const q = it.j[n]; if (q && !q.hidden) skel.push({ t: 'circle', c: [q.x, q.y], r: 11 * k, color: colOf(n), w: 4, ...(q.by === 'you' ? { fill: colOf(n) } : {}) }); }
    const j2 = it.fit && it.fit.joints2d;
    for (const [n, e] of misses(it)) {
      const q = it.j[n]; if (j2 && j2[n]) miss.push({ t: 'line', a: [q.x, q.y], b: j2[n].slice(0, 2), w: 5 }, { t: 'circle', c: j2[n].slice(0, 2), r: 8 * k, fill: MISS });
      else miss.push({ t: 'circle', c: [q.x, q.y], r: e, w: 4, dash: [12, 10] });
      miss.push({ t: 'text', at: [q.x + 20 * k, q.y + 36 * k], text: Math.round(e) + ' px', size: 30 });
    }
    return [{ id: 'pose-joints:' + it.name, name: 'Pose joints', color: COL[''], opacity: 100, visible: true, items: skel },
      { id: 'pose-miss:' + it.name, name: 'Where the figure misses', color: MISS, opacity: 100, visible: true, items: miss }];
  }
  let saveT = 0; function saveSoon() { clearTimeout(saveT); const it = S.cur; saveT = setTimeout(() => saveShot(it), 400); }
  async function saveShot(it) {
    if (!it || !(await Store.check())) return false;
    let shot = await Store.loadShot(it.shot); if (!shot) shot = newShot(it.shot, [{ name: it.name, size: it.file.size, w: it.W, h: it.H }]);
    shot.detections = shot.detections || {}; const P = shot.detections.pose = shot.detections.pose || { version: 1, drawings: {} }; P.drawings = P.drawings || {};
    const joints = {}; for (const [n] of JOINTS) { const q = it.j[n]; if (q) joints[n] = { x: Math.round(q.x * 10) / 10, y: Math.round(q.y * 10) / 10, by: q.by, hidden: !!q.hidden }; }
    const f = it.fit;
    P.drawings[it.name] = { W: it.W, H: it.H, heads: S.heads, joints, flips: { ...it.flips }, camera: cameraOpt(), saved: new Date().toISOString(),
      fit: f ? { confidence: f.confidence, error: f.error, notes: f.notes || [], place: f.place || null, camera: f.camera || null, pose: f.pose || null } : null };
    const ids = new Set(vecLayers(it).map(L => L.id)); shot.layers = (shot.layers || []).filter(L => !ids.has(L.id)).concat(vecLayers(it));
    if (it.file instanceof Blob && !it.kept) { await Store.keepOriginal(it.shot, it.file); it.kept = true; }
    const r = await Store.saveShot(it.shot, shot); return !!(r && r.ok);
  }
  const base = it => Store.safe(it.name);
  const blobOf = c => new Promise(res => c.toBlob(res, 'image/png'));
  async function exportLayer(key) {
    const it = S.cur; if (!it) return null; let c = null, tag = key;
    if (key === 'ghost') { c = tinted(it); tag = 'pose_ghost'; if (!c) { say('Fit the figure first, then the ghost can be exported.'); return null; } }
    else if (key === 'skel') { c = Vec.canvas([vecLayers(it)[0]], it.W, it.H); tag = 'pose_joints'; }
    else if (key === 'miss') { c = Vec.canvas([vecLayers(it)[1]], it.W, it.H); tag = 'pose_misses'; }
    else return null;
    const name = base(it) + '_' + tag + '.png', p = await Store.exportFile(it.shot, name, await blobOf(c));
    say('Exported ' + name + ' (' + it.W + ' x ' + it.H + ', transparent)' + (p ? ', a copy is in ' + p.replace(/\/[^/]*$/, '/') : '') + '.'); return name;
  }
  async function saveCopy() {
    const it = S.cur; if (!it) return null; if (!it.ghost) { say('Fit the figure first, then the copy has a ghost on it.'); return null; }
    const c = document.createElement('canvas'); c.width = it.W; c.height = it.H; const g = c.getContext('2d'), L = S.lay;
    paintDrawing(g, it, 1); g.globalAlpha = L.ghost.op / 100; g.drawImage(tinted(it), 0, 0); g.globalAlpha = 1;
    if (L.skel.on) Vec.draw(g, [vecLayers(it)[0]], it.W);
    const r = await Store.saveVersion(it.shot, base(it), 'ghost', await blobOf(c));
    say('Saved ' + r.name + (r.path ? ' in work/' + it.shot + '/' : ' (downloaded)') + '. Your drawing is untouched.'); return r;
  }
  async function sendToFigure() {
    const it = S.cur; if (!it || !it.fit || !it.fit.pose) { say('Fit the figure first.'); return false; }
    await figReady; if (!Fig) return false;
    if (Fig.pushUndo) Fig.pushUndo();
    Fig.setPose(it.fit.pose); showTab('figure'); return true;
  }

  // ---------- side panels
  function syncList() {
    const el = $('#pmList', root); el.innerHTML = '';
    for (const it of S.items) {
      const d = document.createElement('div'); d.className = 'pitem' + (it === S.cur ? ' on' : '');
      d.innerHTML = '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(it.name) + '</span><span class="muted">' + it.W + ' x ' + it.H + '</span>';
      d.onclick = () => pick(it); el.appendChild(d);
    }
    const it = S.cur;
    $('#pmInfo', root).textContent = it ? (it.ink.found ? 'The guess is fitted to the ink it found. Not the right part? Use Box the character.' : 'No clear character found, so the guess sits in the middle. Use Box the character.') + ' Your file is only read, never changed.' : 'PNG, JPG or a flattened PSD. Your file is only read, never changed.';
  }
  function syncSel() {
    const it = S.cur, n = UI.sel, q = it && n && it.j[n];
    $('#pmSelName', root).textContent = q ? JMAP[n][1] : 'Click a joint';
    $('#pmSelWhere', root).textContent = q ? 'Put it on ' + JMAP[n][2] + '.' : 'Hollow dots are guesses, filled ones are yours.';
    const hb = $('#pmHidden', root); hb.disabled = !q; hb.checked = !!(q && q.hidden);
    if (it) {
      const all = JOINTS.filter(([j]) => it.j[j]), you = all.filter(([j]) => it.j[j].by === 'you' && !it.j[j].hidden).length, hid = all.filter(([j]) => it.j[j].hidden && !OPTIONAL.has(j)).length;
      $('#pmCount', root).textContent = you + ' of ' + JOINTS.length + ' placed by you' + (hid ? ', ' + hid + ' hidden' : '') + '.';
      $('#pmJoints', root).innerHTML = JOINTS.map(([j, l]) => { const q2 = it.j[j]; return '<div class="pitem' + (j === n ? ' on' : '') + '" data-pmj="' + j + '"><span class="dot" style="background:' + colOf(j) + ';width:9px;height:9px;border-radius:50%;flex:none"></span><span style="flex:1">' + esc(l) + '</span><span class="muted">' + (q2.hidden ? 'hidden' : q2.by === 'you' ? 'yours' : 'guess') + '</span></div>'; }).join('');
      $$('[data-pmj]', root).forEach(d => d.onclick = () => { UI.sel = d.dataset.pmj; syncSel(); draw(); });
    } else { $('#pmCount', root).textContent = ''; $('#pmJoints', root).innerHTML = ''; }
    syncFlips(); readout();
  }
  function syncFlips() {
    const it = S.cur, el = $('#pmFlips', root), dep = it && it.fit && it.fit.depth;
    el.innerHTML = LIMBS.map(([k, l, end]) => {
      const on = !!(it && it.flips[k]), now = dep && dep[k] ? ' <span class="muted">(now ' + (dep[k] === 'toward' ? 'toward you' : 'going away') + ')</span>' : '';
      return '<div class="row" style="margin:3px 0"><span style="flex:1">' + l + now + '</span><button data-pmflip="' + k + '"' + (on ? ' class="on"' : '') + ' title="Flip whether the ' + end + ' comes toward the camera or goes away">' + (on ? 'Flipped' : 'Flip') + '</button></div>';
    }).join('');
    $$('[data-pmflip]', el).forEach(b => b.onclick = () => { const it2 = S.cur; if (!it2) return; it2.flips[b.dataset.pmflip] = !it2.flips[b.dataset.pmflip]; syncFlips(); changed(); if (it2.fit || S.autoFit) fit(); });
  }
  function syncFit() {
    const it = S.cur, btn = $('#pmFit', root); btn.disabled = !it || UI.fitting || !Fig; btn.textContent = UI.fitting ? 'Fitting...' : it && it.fit ? 'Fit again' : 'Fit the figure';
    if (!Fig) btn.title = 'Waiting for the 3D figure to load'; else btn.title = '';
    const bodySel = $('#pmBody', root), buildSel = $('#pmBuild', root);
    if (Fig && !bodySel.options.length) {
      bodySel.innerHTML = Object.entries(Fig.BODIES).map(([k, b]) => '<option value="' + k + '">' + esc(b.label) + '</option>').join('');
      buildSel.innerHTML = Object.entries(Fig.BUILDS).map(([k, b]) => '<option value="' + k + '">' + esc(b.label) + '</option>').join('');
    }
    if (Fig) { bodySel.value = Fig.S.body; buildSel.value = Fig.S.build; }
    bodySel.disabled = buildSel.disabled = !Fig;
    const conf = $('#pmConf', root), notes = $('#pmNotes', root), f = it && it.fit;
    if (!f) { conf.innerHTML = Fig ? (PF ? '' : '<div class="muted">Pose fitting is still being built. The joints you place are kept with the shot.</div>') : '<div class="muted">Loading the 3D figure...</div>'; notes.innerHTML = ''; }
    else {
      const [word, col] = sureWords(f.confidence), pct = isFinite(f.confidence) ? Math.round(f.confidence * 100) + '% sure' : '';
      conf.innerHTML = '<b style="color:' + col + '">' + word + '</b>' + (pct ? ' <span class="muted">(' + pct + ')</span>' : '');
      const m = misses(it), list = m.slice(0, 4).map(([n, e]) => esc(JMAP[n][1]) + ' ' + Math.round(e) + ' px').join(', ');
      let html = m.length ? '<div>Biggest misses: ' + list + '.</div>' : '<div>Every joint lands within ' + Math.round(missLimit(it)) + ' px of yours.</div>';
      if (isFinite(f.confidence) && f.confidence < 0.55) html += '<div style="margin-top:4px">The figure could not match this well. Check the hidden joints and the toward or away flips, or drag the joints it misses.</div>';
      for (const t of f.notes || []) html += '<div style="margin-top:4px">' + esc(t) + '</div>';
      notes.innerHTML = html;
    }
    $('#pmExportGhost', root).disabled = $('#pmCopy', root).disabled = $('#pmSend', root).disabled = !(it && it.ghost);
    syncFlips(); readout();
  }
  function syncAll() { syncList(); syncSel(); syncFit(); }

  // ---------- controls
  $('#pmOpen', root).onclick = () => $('#pmFile', root).click();
  $('#pmFile', root).onchange = async e => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) await loadFiles(fs); };
  $('#pmHeads', root).value = String(S.heads); if (!$('#pmHeads', root).value) { S.heads = 6; $('#pmHeads', root).value = '6'; }
  $('#pmHeads', root).onchange = e => { S.heads = +e.target.value; store.set('heads', S.heads); pushUndo(); reguess(false); };
  $('#pmGuess', root).onclick = () => { const it = S.cur; if (!it) return; if (JOINTS.every(([n]) => it.j[n].by === 'you')) { say('Every joint is yours, so there is nothing to guess. Start over puts them all back on the guess.'); return; } pushUndo(); reguess(false); };
  $('#pmReset', root).onclick = () => { if (!S.cur) return; pushUndo(); S.cur.box = null; reguess(true); };
  $('#pmBox', root).onclick = () => { if (!S.cur) return; UI.tool = UI.tool === 'box' ? null : 'box'; $('#pmBox', root).classList.toggle('on', UI.tool === 'box'); cv.style.cursor = UI.tool === 'box' ? 'crosshair' : 'default'; draw(); };
  $('#pmUndo', root).onclick = () => undo();
  $('#pmHidden', root).onchange = e => { if (UI.sel) setHidden(UI.sel, e.target.checked); };
  $('#pmLens', root).value = S.lens; if (!$('#pmLens', root).value) { S.lens = 'auto'; $('#pmLens', root).value = 'auto'; }
  $('#pmCamH', root).value = S.camH; if (!$('#pmCamH', root).value) { S.camH = 'auto'; $('#pmCamH', root).value = 'auto'; }
  $('#pmLens', root).onchange = e => { S.lens = e.target.value; store.set('lens', S.lens); changed(); if (S.cur && S.cur.fit) fit(); };
  $('#pmCamH', root).onchange = e => { S.camH = e.target.value; store.set('camH', S.camH); changed(); if (S.cur && S.cur.fit) fit(); };
  $('#pmAuto', root).checked = S.autoFit; $('#pmAuto', root).onchange = e => { S.autoFit = e.target.checked; store.set('auto', S.autoFit ? '1' : '0'); };
  $('#pmFit', root).onclick = () => fit();
  $('#pmBody', root).onchange = async e => { if (!Fig) return; e.target.disabled = true; await Fig.setBody(e.target.value); e.target.disabled = false; if (S.cur && S.cur.fit) fit(); };
  $('#pmBuild', root).onchange = e => { if (!Fig) return; Fig.setBuild(e.target.value, null); if (S.cur && S.cur.fit) fit(); };
  $('#pmTint', root).checked = S.tint; $('#pmTint', root).onchange = e => { S.tint = e.target.checked; store.set('tint', S.tint ? '1' : '0'); for (const it of S.items) it.tinted = null; draw(); };
  $('#pmBA', root).onchange = e => BA.set(e.target.checked);
  $('#pmExportGhost', root).onclick = () => exportLayer('ghost');
  $('#pmCopy', root).onclick = () => saveCopy();
  $('#pmSend', root).onclick = () => sendToFigure();
  layerRows($('#pmLayers', root), {
    rows: () => [{ key: 'drawing', name: 'Your drawing', noExport: true }, { key: 'ghost', name: '3D ghost', color: '#3b6cff' }, { key: 'skel', name: 'Joints and bones', color: COL[''] }, { key: 'miss', name: 'Where the figure misses', color: MISS }],
    get: key => S.lay[key], set: (key, p) => { Object.assign(S.lay[key], p); draw(); }, exportOne: key => exportLayer(key)
  });
  figReady.then(() => syncAll());
  syncAll(); fit0();

  const api = { S, UI, JOINTS, BONES, LIMBS, loadFiles, fit, guess: reguess, exportLayer, saveCopy, sendToFigure, saveShot: () => saveShot(S.cur), cur: () => S.cur,
    setJoint(n, x, y, by) { const it = S.cur; if (!it || !it.j[n]) return; it.j[n].x = x; it.j[n].y = y; it.j[n].by = by || 'you'; it.j[n].hidden = false; syncSel(); draw(); },
    screenOf(x, y) { const r = cv.getBoundingClientRect(), p = toS(x, y); return [r.left + p[0], r.top + p[1]]; }, figure: () => figReady, draw, fitView: fit0,
    inkBox, guessJoints };
  window.PoseTab = api;
  return api;
}
