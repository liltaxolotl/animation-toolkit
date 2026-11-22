// ============================== BOARD: STORYBOARD AND ANIMATIC ==============================
// Reads a board in panel order: pictures, the Start tab's PDF panels, or the frames of an animatic split at its cuts.
// For each panel: a shot size (it starts as a rough guess from the ink, and says so) and an angle she can change, how
// long it holds, a camera move drawn as a start frame and an end frame (pan, truck, zoom), and an overhead map where
// she places the camera and the characters. Between cuts it points out where the 180 line between A and B is crossed
// and where someone walking flips screen direction ("look here", since a jump can be a real choice). It plays the
// board back as an animatic and exports a shot list (CSV and a picture sheet) plus any overlay as a transparent PNG at
// the panel's exact size (Vec items from app/js/shot.js). Originals are only read.
// Uses the shared classic-script globals: $, $$, AT, PICS, fileImage, download, Store, newShot, Vec, layerRows.
//   import { start } from './board-tab.mjs'; const Board = start(containerEl);   (also sets window.Board)
// Saved through serve.py into work/<board>/shot.json under detections.board.

const D2R = Math.PI / 180, MW = 1.3, NEUTRAL = 0.04;
const SIZES = [['ECU', 'Extreme close-up'], ['CU', 'Close-up'], ['MCU', 'Medium close-up'], ['MS', 'Medium shot'], ['MLS', 'Medium long (cowboy)'],
  ['FS', 'Full shot'], ['LS', 'Long shot'], ['ELS', 'Extreme long shot'], ['OTS', 'Over the shoulder'], ['INS', 'Insert']];
const ANGLES = ['Eye level', 'High angle', 'Low angle', "Bird's eye", "Worm's eye", 'Dutch angle', 'POV'];
const MOVES = [['none', 'None'], ['pan', 'Pan or tilt'], ['truck', 'Truck in or out'], ['zoom', 'Zoom in or out']];
const CHAR_COL = { A: '#ff8fb8', B: '#4d8dff', C: '#2fbf71', D: '#ffa23a' };
const DEFMAP = { cam: { x: 0.65, y: 0.88, aim: -90, fov: 50 }, chars: [{ id: 'A', x: 0.45, y: 0.42, face: 0, walk: false }, { id: 'B', x: 0.85, y: 0.42, face: 180, walk: false }] };
const clone = o => JSON.parse(JSON.stringify(o));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ---------------------------------------------------------------- geometry of the overhead map (pure, testable)
// map: {cam: {x, y, aim (deg, 0 = +x, 90 = down the map), fov (deg)}, chars: [{id, x, y, face (deg), walk}]}
// The map is seen from above, y runs down the page. chars[0] is A and chars[1] is B: the 180 line runs through them.
export function across(m, q) {          // where a map point lands across this camera's frame: -1 left edge, +1 right edge, null behind
  const a = m.cam.aim * D2R, dx = q.x - m.cam.x, dy = q.y - m.cam.y;
  const fwd = dx * Math.cos(a) + dy * Math.sin(a), right = -dx * Math.sin(a) + dy * Math.cos(a);
  if (fwd <= 1e-6) return null;
  return right / fwd / Math.tan((m.cam.fov || 50) * D2R / 2);
}
export function side(m) {                // which side of the A-B line the camera is on: 1, -1, or 0 on (or very near) the line
  const [A, B] = m.chars; if (!A || !B) return null;
  const ux = B.x - A.x, uy = B.y - A.y, L = Math.hypot(ux, uy); if (L < 1e-6) return null;
  const d = (ux * (m.cam.y - A.y) - uy * (m.cam.x - A.x)) / L;
  return Math.abs(d) < NEUTRAL ? 0 : Math.sign(d);
}
export function order(m) {               // 'left' when A is screen left of B, 'right' when screen right, null if one is behind the camera
  const [A, B] = m.chars; if (!A || !B) return null;
  const a = across(m, A), b = across(m, B);
  return a == null || b == null ? null : a < b ? 'left' : 'right';
}
export function heading(m, c) {          // which way someone walking heads on screen: 1 right, -1 left, 0 straight at or away from camera
  const s = Math.sin((c.face - m.cam.aim) * D2R);
  return Math.abs(s) < 0.34 ? 0 : Math.sign(s);
}
// the "look here" notes between cuts. maps[i] is panel i's map, setups[i] true where she marked a deliberate new setup.
export function continuity(maps, setups) {
  const out = []; let last = null, lastAt = -1; const walk = {};
  maps.forEach((m, i) => {
    if (setups && setups[i]) { last = null; for (const k in walk) delete walk[k]; }
    const s = side(m);
    if (s != null) {
      if (last && s && s !== last) {
        const o0 = order(maps[lastAt]), o1 = order(m);
        out.push({ i, kind: 'line', short: 'Look here: crosses the 180 line (from panel ' + (lastAt + 1) + ')',
          text: 'Look here: the camera crosses the 180 line between A and B. ' +
            (o0 && o1 && o0 !== o1 ? 'A is screen ' + o0 + ' of B in panel ' + (lastAt + 1) + ' and screen ' + o1 + ' of B here. ' : 'The camera is on the other side of the line from panel ' + (lastAt + 1) + '. ') +
            'If you want the audience to stay oriented, keep the camera on one side, or bridge it with a shot on the line or a move across it. If the jump is on purpose, tick New setup here.' });
      }
      last = s; lastAt = i;                 // a shot right on the line (s = 0) resets it, so the next one can cross
    }
    for (const c of m.chars) {
      if (!c.walk) { delete walk[c.id]; continue; }
      const h = heading(m, c), w = walk[c.id];
      if (w && w.h && h && h !== w.h) out.push({ i, kind: 'dir', short: 'Look here: ' + c.id + ' flips screen direction',
        text: 'Look here: ' + c.id + ' heads screen ' + (w.h > 0 ? 'right' : 'left') + ' in panel ' + (w.i + 1) + ' and screen ' + (h > 0 ? 'right' : 'left') + ' here. ' +
          'If ' + c.id + ' did not turn around, keeping one screen direction reads clearer, or put a shot of ' + c.id + ' heading straight at or away from camera in between. If it is on purpose, tick New setup here.' });
      walk[c.id] = { h, i };
    }
  });
  return out;
}
// the part of a polygon on side s of the line through A and B (one Sutherland-Hodgman pass)
function clipHalf(poly, A, B, s) {
  const f = q => s * ((B.x - A.x) * (q[1] - A.y) - (B.y - A.y) * (q[0] - A.x)), out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], fp = f(p), fq = f(q);
    if (fp >= 0) out.push(p);
    if ((fp >= 0) !== (fq >= 0)) { const t = fp / (fp - fq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
  }
  return out;
}

// ---------------------------------------------------------------- pictures: a rough shot size guess, animatic cuts
// The guess only looks at where the biggest connected ink shape sits in the frame. It cannot tell a face from a body,
// so the answer always comes back marked as a guess.
export function guessSize(img, w, h) {
  const k = Math.min(1, 480 / Math.max(w, h)), sw = Math.max(9, Math.round(w * k)), sh = Math.max(9, Math.round(h * k));
  const c = document.createElement('canvas'); c.width = sw; c.height = sh;
  const g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#fff'; g.fillRect(0, 0, sw, sh); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, sw, sh);
  const d = g.getImageData(0, 0, sw, sh).data, n = sw * sh, gray = new Uint8Array(n), hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) { const v = (d[i * 4] * 77 + d[i * 4 + 1] * 150 + d[i * 4 + 2] * 29) >> 8; gray[i] = v; hist[v]++; }
  let acc = 0, paper = 255; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.6) { paper = v; break; } }
  const thr = paper - Math.max(40, paper * 0.25), ink = i => gray[i] < thr;
  // long straight lines across most of the panel (its own border, a horizon) are not the subject
  for (let y = 0; y < sh; y++) { let s = 0; for (let x = 0; x < sw; x++) s += ink(y * sw + x); if (s > sw * 0.6) for (let x = 0; x < sw; x++) gray[y * sw + x] = 255; }
  for (let x = 0; x < sw; x++) { let s = 0; for (let y = 0; y < sh; y++) s += ink(y * sw + x); if (s > sh * 0.6) for (let y = 0; y < sh; y++) gray[y * sw + x] = 255; }
  // pool into 3 px cells and grow by one cell, so sketchy strokes join into shapes
  const cw = Math.ceil(sw / 3), ch = Math.ceil(sh / 3), m0 = new Uint8Array(cw * ch), m = new Uint8Array(cw * ch);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) if (ink(y * sw + x)) m0[((y / 3) | 0) * cw + ((x / 3) | 0)] = 1;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (m0[y * cw + x]) for (let v = -1; v <= 1; v++) for (let u = -1; u <= 1; u++) { const X = x + u, Y = y + v; if (X >= 0 && Y >= 0 && X < cw && Y < ch) m[Y * cw + X] = 1; }
  const seen = new Uint8Array(cw * ch), stack = []; let best = null;
  for (let s0 = 0; s0 < cw * ch; s0++) {
    if (!m[s0] || seen[s0]) continue;
    let cnt = 0, x0 = cw, y0 = ch, x1 = -1, y1 = -1; seen[s0] = 1; stack.push(s0);
    while (stack.length) {
      const q = stack.pop(), x = q % cw, y = (q / cw) | 0; cnt++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let v = -1; v <= 1; v++) for (let u = -1; u <= 1; u++) { const X = x + u, Y = y + v; if (X < 0 || Y < 0 || X >= cw || Y >= ch) continue; const r = Y * cw + X; if (m[r] && !seen[r]) { seen[r] = 1; stack.push(r); } }
    }
    if (!best || cnt > best.cnt) best = { cnt, x0, y0, x1, y1 };
  }
  if (!best || best.cnt < cw * ch * 0.003) return { size: null, why: 'There is not enough ink in this panel to measure, so pick a size yourself.' };
  const bh = (best.y1 - best.y0 + 1) / ch, top = best.y0 <= 1, bot = best.y1 >= ch - 2, cut = top + bot + (best.x0 <= 1) + (best.x1 >= cw - 2);
  const pct = v => Math.round(v * 100) + '%';
  let size, why;
  if (bot && (top || cut >= 3)) { size = 'CU'; why = 'the biggest ink shape runs off ' + cut + ' sides of the frame'; }
  else if (bot && bh >= 0.55) { size = 'MS'; why = 'the biggest ink shape is cut by the bottom of the frame and fills ' + pct(bh) + ' of its height'; }
  else if (bot) { size = 'MLS'; why = 'the biggest ink shape is cut by the bottom of the frame and fills ' + pct(bh) + ' of its height'; }
  else if (bh >= 0.6) { size = 'FS'; why = 'the biggest ink shape fits inside the frame and fills ' + pct(bh) + ' of its height'; }
  else if (bh >= 0.25) { size = 'LS'; why = 'the biggest ink shape fits inside the frame with room around it (' + pct(bh) + ' of the height)'; }
  else { size = 'ELS'; why = 'the biggest ink shape is small in the frame (' + pct(bh) + ' of the height)'; }
  return { size, why: 'Guess: ' + why + '. It only sees shapes, not faces or bodies, so check it.' };
}
function tiny(img) {
  const c = document.createElement('canvas'); c.width = 48; c.height = 27;
  const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high'; g.fillStyle = '#fff'; g.fillRect(0, 0, 48, 27); g.drawImage(img, 0, 0, 48, 27);
  const d = g.getImageData(0, 0, 48, 27).data, o = new Float32Array(48 * 27 * 3);   // colour, not gray: two shots can share a brightness
  for (let i = 0; i < 48 * 27; i++) { o[i * 3] = d[i * 4]; o[i * 3 + 1] = d[i * 4 + 1]; o[i * 3 + 2] = d[i * 4 + 2]; }
  return o;
}
// the frames of an animatic -> [[from, to)] runs of near-identical frames: each run is one held panel
export function runs(imgs) {
  if (imgs.length < 2) return [[0, imgs.length]];
  const sig = imgs.map(tiny), diff = [];
  for (let i = 1; i < sig.length; i++) { let s = 0; for (let j = 0; j < sig[i].length; j++) s += Math.abs(sig[i][j] - sig[i - 1][j]); diff.push(s / sig[i].length); }
  const sorted = [...diff].sort((a, b) => a - b), med = sorted[Math.floor(sorted.length / 2)], thr = Math.max(8, med * 4 + 3), out = [];
  let a = 0; diff.forEach((v, i) => { if (v > thr) { out.push([a, i + 1]); a = i + 1; } });
  out.push([a, imgs.length]);
  return out;
}

// ---------------------------------------------------------------- the tab
let api = null;
export function start(el) {
  if (api) return api;
  el = el || document.getElementById('mode-board');
  const modeEl = el.closest('.mode') || el;
  el.innerHTML = `
<div class="bd-wrap" style="display:flex;flex:1;min-height:0;min-width:0;width:100%">
  <div class="side">
    <div class="card">
      <h2>Board</h2>
      <div class="row"><button class="primary" id="bdAdd" style="flex:1">Add panels</button><button id="bdFromStart" style="flex:1" title="Take the panels from what is picked in the Start tab">From Start</button></div>
      <input type="file" id="bdFiles" accept="image/*,.psd" multiple hidden>
      <div class="plist" id="bdList" style="max-height:240px"></div>
      <div class="row"><button id="bdUp" style="flex:1" title="Move this panel earlier">Earlier</button><button id="bdDown" style="flex:1" title="Move this panel later">Later</button><button id="bdDrop" title="Take this panel off the board (the file is not touched)">Remove</button></div>
      <div class="row"><button id="bdCuts" style="flex:1" title="For the frames of an animatic: one panel per held drawing">Find the cuts (animatic frames)</button><button id="bdClear" title="Empty the board (no files are touched)">Clear</button></div>
      <div class="muted" id="bdInfo">Add your panels in order, or open a PDF board or an animatic in the Start tab and press From Start.</div>
    </div>
    <div class="card">
      <h2>This panel</h2>
      <div class="f2"><span>Size</span><select id="bdSize"></select></div>
      <div class="muted" id="bdSizeWhy"></div>
      <div class="f2"><span>Angle</span><select id="bdAngle"></select></div>
      <div class="f2"><span>Holds</span><div class="row" style="margin:0;flex-wrap:nowrap"><input type="number" id="bdFrames" min="1" max="99999" step="1" style="width:76px"><span class="muted" id="bdSecs"></span></div></div>
      <label class="chk" title="A deliberate new setup: the 180 line and screen direction can change at this cut"><input type="checkbox" id="bdSetup">New setup here (a jump on purpose)</label>
      <div class="f2"><span>Note</span><input type="text" id="bdNote" placeholder="Action, dialogue, sound"></div>
    </div>
    <div class="card">
      <h2>Play</h2>
      <div class="row"><button class="primary" id="bdPlay" style="flex:1">Play</button><button id="bdFromHere" style="flex:1">From this panel</button></div>
      <div class="f2"><span>Rate</span><select id="bdFps"><option value="24" selected>24 fps</option><option value="25">25 fps</option><option value="30">30 fps</option><option value="12">12 fps</option></select></div>
      <label class="chk"><input type="checkbox" id="bdLoop" checked>Loop</label>
      <label class="chk"><input type="checkbox" id="bdPlayMoves" checked>Play the camera moves</label>
      <div class="muted" id="bdTotal"></div>
    </div>
  </div>
  <div class="stage" id="bdStage" style="display:flex;flex-direction:column">
    <div id="bdViewWrap" style="position:relative;flex:1;min-height:0"><canvas id="bdView"></canvas>
      <div class="readout" id="bdReadout" style="display:none"></div>
      <div class="hint">Drag the blue frames to set where a camera move starts and ends. Drag the right edge of a panel in the strip below to change how long it holds. Arrow keys step through, space plays.</div>
      <div class="soon" id="bdEmpty" style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:center"><b>Your board goes here</b>Add panels on the left, or open a PDF board or an animatic in the Start tab.</div>
    </div>
    <div style="position:relative;height:86px;flex:none;border-top:1px solid var(--line)"><canvas id="bdLine"></canvas></div>
  </div>
  <div class="side">
    <div class="card">
      <h2>Overhead map</h2>
      <canvas id="bdMap" style="width:100%;height:190px;display:block;border-radius:8px;background:#121116;touch-action:none"></canvas>
      <div class="row"><button id="bdAddChar" style="flex:1">Add a character</button><button id="bdDelChar" style="flex:1">Remove the last</button></div>
      <div id="bdWalk"></div>
      <div class="row"><button id="bdMapPrev" style="flex:1" title="Drop this panel's own map and follow the panel before it">Same as the panel before</button></div>
      <div class="muted" id="bdMapInfo"></div>
    </div>
    <div class="card">
      <h2>Camera move</h2>
      <div class="f2"><span>Move</span><select id="bdMove"></select></div>
      <div class="row"><button id="bdSwap" style="flex:1">Swap start and end</button></div>
      <div class="layers" id="bdLayers"></div>
      <div class="muted" id="bdMoveInfo"></div>
    </div>
    <div class="card">
      <h2>Continuity</h2>
      <div id="bdFlags" class="plist" style="max-height:220px"></div>
      <div class="muted">Points out where the camera crosses the 180 line between A and B, and where someone walking flips screen direction. Crossing can be the right call: tick New setup here and the note goes away.</div>
    </div>
    <div class="card">
      <h2>Export</h2>
      <div class="row"><button id="bdCsv" style="flex:1">Shot list (CSV)</button><button id="bdSheet" style="flex:1">Shot list sheet</button></div>
      <div class="row"><button id="bdSave" style="flex:1">Save the board</button></div>
      <div class="muted" id="bdSaveInfo"></div>
    </div>
  </div>
</div>`;
  const q = s => el.querySelector(s);
  const view = q('#bdView'), vctx = view.getContext('2d'), wrap = q('#bdViewWrap'), strip = q('#bdLine'), lctx = strip.getContext('2d'), mapCv = q('#bdMap'), mctx = mapCv.getContext('2d');
  q('#bdSize').innerHTML = SIZES.map(([c, n]) => '<option value="' + c + '">' + c + ', ' + n + '</option>').join('');
  q('#bdAngle').innerHTML = ANGLES.map(a => '<option>' + esc(a) + '</option>').join('');
  q('#bdMove').innerHTML = MOVES.map(([v, n]) => '<option value="' + v + '">' + n + '</option>').join('');

  const P = [];
  const S = { name: 'board', fps: 24, cur: -1, play: null, view: { s: 1, x: 0, y: 0 }, drag: null, mdrag: null, ldrag: null, flags: [],
    layers: { move: { on: true, op: 100 }, label: { on: false, op: 100 } } };
  let uid = 1;
  const isOn = () => modeEl.classList.contains('on');
  const total = () => P.reduce((a, p) => a + p.frames, 0);
  const starts = () => { const s = []; let t = 0; for (const p of P) { s.push(t); t += p.frames; } return s; };
  const panelAt = f => { let t = 0; for (let i = 0; i < P.length; i++) { t += P[i].frames; if (f < t) return i; } return P.length - 1; };
  const secs = f => Math.round(f / S.fps * 100) / 100 + ' s';
  const p2 = n => String(n).padStart(2, '0');
  const tc = f => { const s = Math.floor(f / S.fps); return p2(Math.floor(s / 3600)) + ':' + p2(Math.floor(s / 60) % 60) + ':' + p2(s % 60) + ':' + p2(f % S.fps); };
  const info = t => { q('#bdInfo').textContent = t; };
  const note = (id, t) => { q(id).textContent = t; };

  // ---------- maps: a panel without its own map follows the panel before it
  const mapOf = i => { for (let j = Math.min(i, P.length - 1); j >= 0; j--) if (P[j].map) return P[j].map; return DEFMAP; };
  const mapFrom = i => { for (let j = Math.min(i, P.length - 1); j >= 0; j--) if (P[j].map) return j; return -1; };
  const ownMap = i => { if (!P[i].map) P[i].map = clone(mapOf(i)); return P[i].map; };
  const checks = () => continuity(P.map((p, i) => mapOf(i)), P.map(p => p.setup));

  // ---------- loading
  function thumbOf(img, w, h) { const c = document.createElement('canvas'); c.height = 90; c.width = Math.max(1, Math.round(90 * w / h)); const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, c.width, c.height); return c; }
  function makePanel(file, img, frames) {
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const p = { id: uid++, name: file.name, file, img, w, h, frames: Math.max(1, Math.round(frames)), size: 'MS', sizeSet: false, sizeGuess: null, angle: 'Eye level', move: null, map: null, setup: false, note: '' };
    p.thumb = thumbOf(img, w, h);
    try { p.sizeGuess = guessSize(img, w, h); if (p.sizeGuess.size) p.size = p.sizeGuess.size; } catch (e) { p.sizeGuess = null; }
    return p;
  }
  function boardName(files) {
    const a = files[0].name.replace(/\.[^.]+$/, ''), b = files[files.length - 1].name.replace(/\.[^.]+$/, ''); let i = 0; while (i < a.length && a[i] === b[i]) i++;
    const s = a.slice(0, i).replace(/_panel\d*$/, '').replace(/_p\d*$/, '').replace(/[_\- .]+$/, ''); return s.length >= 2 ? s : 'board';
  }
  // opts: {name, add (append instead of replace), animatic (split frames at the cuts), pullFps (rate the frames were pulled at), frames (hold for each picture)}
  async function loadFiles(list, opts) {
    opts = opts || {};
    const files = [...(list || [])].filter(f => PICS.test(f.name)).sort((u, v) => u.name.localeCompare(v.name, undefined, { numeric: true }));
    if (!files.length) { info('Those are not pictures. PDF boards and videos go in through the Start tab first.'); return P.length; }
    stop();
    const got = [], bad = [];
    for (const f of files) { try { got.push({ f, img: await fileImage(f) }); } catch (e) { bad.push(f.name); } }
    if (!opts.add) { P.length = 0; S.name = Store.safe(opts.name || boardName(files)); }
    const first = P.length, per = S.fps / (opts.pullFps || S.fps);
    let msg;
    if (opts.animatic) {
      const r = runs(got.map(g => g.img));
      for (const [a, b] of r) { const mid = got[Math.floor((a + b - 1) / 2)]; P.push(makePanel(got[a].f, mid.img, (b - a) * per)); }
      msg = 'Found ' + r.length + ' shot' + (r.length === 1 ? '' : 's') + ' in ' + got.length + ' frames by looking for cuts. Pans, fades and animation inside a shot can split or merge them, so check the list.';
    } else {
      for (const g of got) P.push(makePanel(g.f, g.img, opts.frames || Math.round(2 * S.fps)));
      msg = (opts.add ? 'Added ' : 'Opened ') + got.length + ' panel' + (got.length === 1 ? '' : 's') + ' in name order. Each one starts at 2 seconds.';
    }
    if (bad.length) msg += ' Could not open: ' + bad.join(', ') + '.';
    info(msg);
    if (!opts.add) await restore();
    S.cur = P.length ? (opts.add ? first : 0) : -1;
    syncAll();
    return P.length;
  }
  async function fromStart() {
    const St = typeof Start !== 'undefined' ? Start : null; let it = null;   // a page-level const: modules see it by name, not on window try { it = St && St.sel(); } catch (e) {}
    if (!it) { info('Pick a board, a set of panels or an animatic in the Start tab first.'); return; }
    if (it.kind === 'pdf' && it.pages.length < it.doc.numPages) { info('The Start tab is still reading the PDF pages, one moment.'); return; }
    info('Getting the panels from the Start tab...');
    const files = await St.filesOf(it);
    if (!files || !files.length) { info(it.kind === 'pdf' ? 'No panels are switched on in the Start tab.' : 'Nothing to open yet.'); return; }
    await loadFiles(files, { name: it.name, animatic: it.kind === 'video', pullFps: it.fps });
  }

  // ---------- the shot file (work/<board>/shot.json, under detections.board)
  function boardData() {
    return { kind: 'animtk-board', version: 1, fps: S.fps, panels: P.map(p => ({ file: p.name, frames: p.frames, size: p.size, sizeSet: p.sizeSet, angle: p.angle, move: p.move, map: p.map, setup: p.setup, note: p.note })) };
  }
  async function restore() {
    if (!(await Store.check())) return;
    const shot = await Store.loadShot(S.name), b = shot && shot.detections && shot.detections.board; if (!b || !Array.isArray(b.panels)) return;
    const by = new Map(b.panels.map((x, k) => [x.file, { x, k }])); let hit = 0;
    for (const p of P) {
      const e = by.get(p.name); if (!e) continue; hit++; const x = e.x; p.order = e.k;
      if (x.frames > 0) p.frames = Math.round(x.frames); if (x.size) { p.size = x.size; p.sizeSet = !!x.sizeSet; } if (x.angle) p.angle = x.angle;
      p.move = x.move || null; p.map = x.map || null; p.setup = !!x.setup; p.note = x.note || '';
    }
    if (!hit) return;
    if (hit === P.length) P.sort((u, v) => u.order - v.order);
    if (b.fps) setFps(b.fps);
    info('Picked up where you left off: ' + hit + ' panel' + (hit === 1 ? '' : 's') + ' from work/' + S.name + '/shot.json.');
  }
  async function saveBoard() {
    if (!P.length) { note('#bdSaveInfo', 'Add panels first.'); return null; }
    const data = boardData();
    if (await Store.check()) {
      let shot = await Store.loadShot(S.name);
      if (!shot) shot = newShot(S.name, P.map(p => ({ name: p.name, size: p.file && p.file.size, w: p.w, h: p.h })));
      shot.detections = shot.detections || {}; shot.detections.board = data;
      if (!shot.help) shot.help = []; if (!shot.help.includes('storyboard')) shot.help.push('storyboard');
      const r = await Store.saveShot(S.name, shot);
      note('#bdSaveInfo', r.ok ? 'Saved in work/' + Store.safe(S.name) + '/shot.json. Open the same panels again and the board comes back.' : 'Could not save: ' + r.error);
      return r.ok ? 'work/' + Store.safe(S.name) + '/shot.json' : null;
    }
    download(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), Store.safe(S.name) + '_board.json');
    note('#bdSaveInfo', 'This page was opened as a plain file, so the board went to your Downloads folder as ' + Store.safe(S.name) + '_board.json. Open the app with the toolkit shortcut to keep it in work/.');
    return null;
  }

  // ---------- camera moves: a start frame and an end frame in the panel's own pixels, both the panel's shape
  function defaultMove(p, kind) {
    if (kind === 'pan') { const w = p.w * 0.7, h = p.h * 0.7; return { kind, a: [p.w * 0.04, (p.h - h) / 2, w, h], b: [p.w * 0.96 - w, (p.h - h) / 2, w, h], touched: false }; }
    const w = p.w * 0.55, h = p.h * 0.55; return { kind, a: [0, 0, p.w, p.h], b: [(p.w - w) / 2, (p.h - h) * 0.45, w, h], touched: false };
  }
  const mid = r => [r[0] + r[2] / 2, r[1] + r[3] / 2];
  function moveWords(p) {
    const m = p.move; if (!m || m.kind === 'none') return '';
    const ca = mid(m.a), cb = mid(m.b), sc = m.b[2] / m.a[2], dx = (cb[0] - ca[0]) / p.w, dy = (cb[1] - ca[1]) / p.h, out = [];
    if (m.kind !== 'pan') { if (sc < 0.97) out.push(m.kind.toUpperCase() + ' IN'); else if (sc > 1.03) out.push(m.kind.toUpperCase() + ' OUT'); }
    if (Math.abs(dx) > 0.03) out.push('PAN ' + (dx > 0 ? 'RIGHT' : 'LEFT'));
    if (Math.abs(dy) > 0.03) out.push('TILT ' + (dy > 0 ? 'DOWN' : 'UP'));
    return out.join(' + ') || 'NO MOVE YET';
  }
  function moveInfo(p) {
    if (!p.move) return 'Pick a move to get a start frame and an end frame on the panel to drag into place.';
    return moveWords(p) + '. Solid blue is where the camera starts, dashed is where it ends. Drag a frame to move it, drag a corner to resize it (it keeps the panel\'s shape).';
  }
  function setMove(kind, i) {
    i = i == null ? S.cur : i; const p = P[i]; if (!p) return;
    if (kind === 'none') p.move = null;
    else if (!p.move || !p.move.touched) p.move = defaultMove(p, kind);
    else p.move.kind = kind;
    S.layers.move.on = true; syncLayers(); syncPanel(); changed();
  }
  // ---------- the overlays as Vec layers (app/js/shot.js), drawn and exported at the panel's exact size
  function moveItems(p) {
    const m = p.move; if (!m || m.kind === 'none') return [];
    const kk = p.w / 3840, rect = r => ({ t: 'rect', a: [r[0], r[1]], b: [r[0] + r[2], r[1] + r[3]], w: 10 });
    const items = [rect(m.a), { ...rect(m.b), dash: [40, 22] }], ca = mid(m.a), cb = mid(m.b);
    if (Math.hypot(cb[0] - ca[0], cb[1] - ca[1]) > p.w * 0.04) items.push({ t: 'arrow', a: ca, b: cb, w: 10 });
    else {
      const cs = r => [[r[0], r[1]], [r[0] + r[2], r[1]], [r[0], r[1] + r[3]], [r[0] + r[2], r[1] + r[3]]], A = cs(m.a), B = cs(m.b);
      A.forEach((u, j) => { if (Math.hypot(B[j][0] - u[0], B[j][1] - u[1]) > p.w * 0.03) items.push({ t: 'arrow', a: u, b: B[j], w: 8 }); });
    }
    const lab = (r, s) => ({ t: 'text', at: [r[0] + p.w * 0.012, r[1] + p.w * 0.012 + 90 * kk], text: s, size: 90 });
    items.push(lab(m.a, 'START'), lab(m.b, 'END'));
    const words = moveWords(p), wx = (ca[0] + cb[0]) / 2 - words.length * 0.3 * 100 * kk, wy = (ca[1] + cb[1]) / 2 + 150 * kk;
    items.push({ t: 'text', at: [Math.max(p.w * 0.01, wx), Math.min(p.h - p.w * 0.01, wy)], text: words, size: 100 });
    return items;
  }
  function labelItems(p) {
    const kk = p.w / 3840, i = P.indexOf(p);
    return [{ t: 'text', at: [p.w * 0.015, p.w * 0.015 + 110 * kk], text: (i + 1) + '   ' + p.size + '   ' + p.angle.toUpperCase() + '   ' + secs(p.frames), size: 110 }];
  }
  function layerObj(p, key, full) {
    const st = S.layers[key];
    return { id: key, name: key === 'move' ? 'Camera move' : 'Shot label', color: key === 'move' ? '#2f7bff' : '#e24bb5',
      opacity: full ? 100 : st.op, visible: full ? true : st.on, items: key === 'move' ? moveItems(p) : labelItems(p) };
  }
  function syncLayers() {
    layerRows(q('#bdLayers'), { rows: () => [{ key: 'move', name: 'Camera move', color: '#2f7bff' }, { key: 'label', name: 'Shot label', color: '#e24bb5' }],
      get: k => S.layers[k], set: (k, patch) => { Object.assign(S.layers[k], patch); draw(); }, exportOne: k => exportLayer(k) });
  }
  async function exportLayer(key, i) {
    const p = P[i == null ? S.cur : i]; if (!p) { note('#bdMoveInfo', 'Add panels first.'); return null; }
    const L = layerObj(p, key, true);
    if (!L.items.length) { note('#bdMoveInfo', 'This panel has no camera move yet. Pick one above first.'); return null; }
    const blob = await new Promise(r => Vec.canvas([L], p.w, p.h).toBlob(r, 'image/png'));
    const name = p.name.replace(/\.[^.]+$/, '') + '_' + (key === 'move' ? 'cameramove' : 'label') + '.png';
    const path = await Store.exportFile(S.name, name, blob);
    note('#bdMoveInfo', 'Exported ' + name + ', ' + p.w + ' x ' + p.h + ' and transparent, so it drops straight onto the panel' + (path ? '. A copy is in ' + path : '') + '.');
    return name;
  }

  // ---------- shot list
  function shotList() {
    const st = starts(), fl = checks(), rows = [['Panel', 'File', 'Shot size', 'Angle', 'Camera move', 'Frames', 'Seconds', 'In', 'Out', 'Look here', 'Note']];
    P.forEach((p, i) => rows.push([i + 1, p.name, p.size, p.angle, moveWords(p) || 'None', p.frames, (p.frames / S.fps).toFixed(2), tc(st[i]), tc(st[i] + p.frames),
      fl.filter(f => f.i === i).map(f => f.short).join('; '), p.note]));
    rows.push(['Total', P.length + ' panels', '', '', '', total(), (total() / S.fps).toFixed(2), tc(0), tc(total()), '', 'at ' + S.fps + ' fps']);
    return rows;
  }
  const cell = v => { const s = String(v == null ? '' : v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  async function exportCsv() {
    if (!P.length) { note('#bdSaveInfo', 'Add panels first.'); return null; }
    const text = '﻿' + shotList().map(r => r.map(cell).join(',')).join('\r\n') + '\r\n', name = Store.safe(S.name) + '_shotlist.csv';
    const path = await Store.exportFile(S.name, name, new Blob([text], { type: 'text/csv' }));
    note('#bdSaveInfo', 'Saved ' + name + (path ? '. A copy is in ' + path : '') + '.');
    return name;
  }
  function fitText(g, s, w) { if (g.measureText(s).width <= w) return s; while (s.length > 1 && g.measureText(s + '...').width > w) s = s.slice(0, -1); return s + '...'; }
  async function exportSheet() {
    if (!P.length) { note('#bdSaveInfo', 'Add panels first.'); return null; }
    const cols = Math.min(4, P.length), cw = 520, th = 292, ch = th + 116, pad = 28, top = 104, nrows = Math.ceil(P.length / cols), st = starts(), fl = checks();
    const c = document.createElement('canvas'); c.width = pad + cols * (cw + pad); c.height = top + nrows * (ch + pad); const g = c.getContext('2d');
    const font = (wt, px) => wt + ' ' + px + 'px system-ui, "Segoe UI", sans-serif';
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#16151a'; g.font = font(700, 34); g.fillText(S.name, pad, 52);
    g.fillStyle = '#555'; g.font = font(400, 20); g.fillText(P.length + ' panels, ' + total() + ' frames, ' + secs(total()) + ' at ' + S.fps + ' fps', pad, 84);
    P.forEach((p, i) => {
      const x = pad + (i % cols) * (cw + pad), y = top + Math.floor(i / cols) * (ch + pad), k = Math.min(cw / p.w, th / p.h), w = p.w * k, h = p.h * k, ox = x + (cw - w) / 2, oy = y + (th - h) / 2;
      g.fillStyle = '#f1eff4'; g.fillRect(x, y, cw, th); g.drawImage(p.img, ox, oy, w, h);
      g.save(); g.beginPath(); g.rect(x, y, cw, th); g.clip(); g.translate(ox, oy); g.scale(k, k); Vec.draw(g, [layerObj(p, 'move', true)], p.w); g.restore();
      const look = fl.filter(f => f.i === i);
      g.strokeStyle = look.length ? '#e8202a' : '#16151a'; g.lineWidth = look.length ? 4 : 2; g.strokeRect(x, y, cw, th);
      g.fillStyle = '#16151a'; g.font = font(700, 24); g.fillText(fitText(g, (i + 1) + '    ' + p.size + '    ' + p.angle, cw), x, y + th + 32);
      g.fillStyle = '#333'; g.font = font(400, 19); g.fillText(fitText(g, secs(p.frames) + ' (' + p.frames + ' f)    in ' + tc(st[i]) + '    out ' + tc(st[i] + p.frames), cw), x, y + th + 58);
      const l3 = [moveWords(p), p.note].filter(Boolean).join('    '); let yy = y + th + 82;
      if (l3) { g.fillText(fitText(g, l3, cw), x, yy); yy += 24; }
      if (look.length) { g.fillStyle = '#e8202a'; g.fillText(fitText(g, look.map(f => f.short).join('; '), cw), x, yy); }
    });
    const blob = await new Promise(r => c.toBlob(r, 'image/png')), name = Store.safe(S.name) + '_shotlist_sheet.png';
    const path = await Store.exportFile(S.name, name, blob);
    note('#bdSaveInfo', 'Saved ' + name + (path ? '. A copy is in ' + path : '') + '.');
    return name;
  }

  // ---------- drawing: the panel, the strip, the map
  function sizeCanvas(cv, box) {
    const dpr = window.devicePixelRatio || 1, r = box.getBoundingClientRect(), W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    return { dpr, w: r.width, h: r.height };
  }
  function fit() {
    const p = P[S.cur], r = wrap.getBoundingClientRect();
    if (p && r.width > 60) { const k = Math.min((r.width - 40) / p.w, (r.height - 40) / p.h); S.view = { s: k, x: (r.width - p.w * k) / 2, y: (r.height - p.h * k) / 2 }; }
    draw();
  }
  function readout() {
    const p = P[S.cur], r = q('#bdReadout'); if (!p) { r.style.display = 'none'; return; }
    const st = starts()[S.cur], mv = moveWords(p);
    r.style.display = ''; r.textContent = 'Panel ' + (S.cur + 1) + ' of ' + P.length + '   ' + p.size + ', ' + p.angle.toLowerCase() + '\n' + secs(p.frames) + ' (' + p.frames + ' frames), in at ' + tc(st) + (mv ? '\n' + mv : '') + (S.play ? '\nPlaying ' + tc(S.play.f || 0) : '');
  }
  function draw() {
    const { dpr, w, h } = sizeCanvas(view, wrap);
    vctx.setTransform(1, 0, 0, 1, 0, 0); vctx.fillStyle = '#0e0d11'; vctx.fillRect(0, 0, view.width, view.height);
    q('#bdEmpty').style.display = P.length ? 'none' : 'flex';
    readout(); const p = P[S.cur]; if (!p) return;
    if (S.play && p.move && p.move.kind !== 'none' && q('#bdPlayMoves').checked) { drawThroughCamera(p, dpr, w, h); return; }
    const v = S.view; vctx.setTransform(v.s * dpr, 0, 0, v.s * dpr, v.x * dpr, v.y * dpr);
    vctx.fillStyle = '#fff'; vctx.fillRect(0, 0, p.w, p.h); vctx.drawImage(p.img, 0, 0, p.w, p.h);
    Vec.draw(vctx, [layerObj(p, 'move'), layerObj(p, 'label')], p.w);
    if (!S.play && p.move && p.move.kind !== 'none' && S.layers.move.on) {
      vctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (const which of ['a', 'b']) { const [x, y, fw, fh] = p.move[which]; for (const [hx, hy] of [[x, y], [x + fw, y], [x, y + fh], [x + fw, y + fh]]) { const X = v.x + hx * v.s, Y = v.y + hy * v.s; vctx.fillStyle = '#fff'; vctx.strokeStyle = '#2f7bff'; vctx.lineWidth = 2; vctx.fillRect(X - 5, Y - 5, 10, 10); vctx.strokeRect(X - 5, Y - 5, 10, 10); } }
    }
  }
  function drawThroughCamera(p, dpr, w, h) {          // the animatic view: the frame eases from the start frame to the end frame over the hold
    const st = starts()[S.cur], t = p.frames > 1 ? AT.clamp(((S.play.f || 0) - st) / (p.frames - 1), 0, 1) : 0, e = t * t * (3 - 2 * t);
    const r = p.move.a.map((v, k) => v + (p.move.b[k] - v) * e), k = Math.min((w - 40) / r[2], (h - 40) / r[3]), ox = (w - r[2] * k) / 2, oy = (h - r[3] * k) / 2;
    vctx.setTransform(dpr, 0, 0, dpr, 0, 0); vctx.save(); vctx.beginPath(); vctx.rect(ox, oy, r[2] * k, r[3] * k); vctx.clip();
    vctx.fillStyle = '#fff'; vctx.fillRect(ox, oy, r[2] * k, r[3] * k);
    vctx.setTransform(k * dpr, 0, 0, k * dpr, (ox - r[0] * k) * dpr, (oy - r[1] * k) * dpr); vctx.drawImage(p.img, 0, 0, p.w, p.h);
    vctx.restore();
  }
  const stripXf = () => { const r = strip.getBoundingClientRect(); return { r, x0: 10, ppf: Math.max(1e-4, (r.width - 20) / Math.max(1, total())) }; };
  function drawStrip() {
    const { dpr, w, h } = sizeCanvas(strip, strip.parentElement); lctx.setTransform(dpr, 0, 0, dpr, 0, 0); lctx.fillStyle = '#16151a'; lctx.fillRect(0, 0, w, h);
    if (!P.length) return;
    const t = stripXf(), st = starts(), flagged = new Set(S.flags.map(f => f.i)), y = 16, bh = h - 24, n = total();
    let step = 1; for (const s of [1, 2, 5, 10, 15, 30, 60, 120, 300]) { step = s; if (s * S.fps * t.ppf >= 46) break; }
    lctx.font = '10px system-ui, sans-serif';
    for (let s = 0; s * S.fps <= n; s += step) { const x = t.x0 + s * S.fps * t.ppf; lctx.fillStyle = '#7d788c'; lctx.fillRect(x, 0, 1, 6); lctx.fillText(s + 's', x + 3, 10); }
    P.forEach((p, i) => {
      const x = t.x0 + st[i] * t.ppf, bw = Math.max(1, p.frames * t.ppf);
      lctx.save(); lctx.beginPath(); lctx.rect(x, y, bw, bh); lctx.clip(); lctx.fillStyle = '#2a2832'; lctx.fillRect(x, y, bw, bh);
      lctx.globalAlpha = 0.85; lctx.drawImage(p.thumb, x + 1, y, p.thumb.width * bh / p.thumb.height, bh); lctx.globalAlpha = 1;
      lctx.fillStyle = 'rgba(22,21,26,.78)'; lctx.fillRect(x, y, 26, 15); lctx.fillStyle = '#eeebf3'; lctx.font = '700 11px system-ui, sans-serif'; lctx.fillText(String(i + 1), x + 4, y + 11);
      lctx.restore();
      lctx.strokeStyle = i === S.cur ? '#ff8fb8' : '#3b3846'; lctx.lineWidth = i === S.cur ? 2 : 1; lctx.strokeRect(x + 0.5, y + 0.5, bw - 1, bh - 1);
      if (flagged.has(i)) { lctx.fillStyle = '#ff5560'; lctx.beginPath(); lctx.moveTo(x - 6, y - 2); lctx.lineTo(x + 6, y - 2); lctx.lineTo(x, y + 8); lctx.closePath(); lctx.fill(); }
    });
    const f = S.play ? (S.play.f || 0) : (S.cur >= 0 ? st[S.cur] : 0); lctx.fillStyle = '#ff8fb8'; lctx.fillRect(t.x0 + f * t.ppf - 1, 0, 2, h);
  }
  const mapXf = () => { const r = mapCv.getBoundingClientRect(), k = Math.min(r.width / MW, r.height); return { r, k, ox: (r.width - MW * k) / 2, oy: (r.height - k) / 2 }; };
  function drawMap() {
    const r = mapCv.getBoundingClientRect(); if (r.width < 20) return;
    const dpr = window.devicePixelRatio || 1, W = Math.round(r.width * dpr), H = Math.round(r.height * dpr); if (mapCv.width !== W || mapCv.height !== H) { mapCv.width = W; mapCv.height = H; }
    const g = mctx; g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#121116'; g.fillRect(0, 0, W, H);
    if (S.cur < 0) { g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#a6a1b4'; g.font = '12px system-ui, sans-serif'; g.fillText('Add panels to set up the shots.', 12, 22); return; }
    const m = mapOf(S.cur), t = mapXf(), px = n => n / t.k, dot = (c, rr, col) => { g.fillStyle = col; g.beginPath(); g.arc(c[0], c[1], rr, 0, 7); g.fill(); };
    g.setTransform(dpr * t.k, 0, 0, dpr * t.k, dpr * t.ox, dpr * t.oy);
    g.strokeStyle = 'rgba(255,255,255,.06)'; g.lineWidth = px(1);
    for (let x = 0; x <= MW + 1e-9; x += 0.1) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 1); g.stroke(); }
    for (let y = 0; y <= 1 + 1e-9; y += 0.1) { g.beginPath(); g.moveTo(0, y); g.lineTo(MW, y); g.stroke(); }
    const [A, B] = m.chars, s = side(m);
    if (A && B && Math.hypot(B.x - A.x, B.y - A.y) > 1e-6) {
      if (s) { const poly = clipHalf([[0, 0], [MW, 0], [MW, 1], [0, 1]], A, B, s); if (poly.length > 2) { g.fillStyle = 'rgba(47,191,113,.10)'; g.beginPath(); poly.forEach((c, i) => i ? g.lineTo(c[0], c[1]) : g.moveTo(c[0], c[1])); g.closePath(); g.fill(); } }
      const ux = B.x - A.x, uy = B.y - A.y, L = Math.hypot(ux, uy);
      g.strokeStyle = '#ff5560'; g.lineWidth = px(1.6); g.setLineDash([px(6), px(5)]); g.beginPath(); g.moveTo(A.x - ux / L * 3, A.y - uy / L * 3); g.lineTo(A.x + ux / L * 3, A.y + uy / L * 3); g.stroke(); g.setLineDash([]);
    }
    const a = m.cam.aim * D2R, hf = (m.cam.fov || 50) * D2R / 2, reach = 0.55;
    g.fillStyle = 'rgba(255,255,255,.07)'; g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = px(1);
    g.beginPath(); g.moveTo(m.cam.x, m.cam.y); g.lineTo(m.cam.x + Math.cos(a - hf) * reach, m.cam.y + Math.sin(a - hf) * reach); g.lineTo(m.cam.x + Math.cos(a + hf) * reach, m.cam.y + Math.sin(a + hf) * reach); g.closePath(); g.fill(); g.stroke();
    g.save(); g.translate(m.cam.x, m.cam.y); g.rotate(a); g.fillStyle = '#eeebf3'; g.fillRect(-0.075, -0.03, 0.06, 0.06);
    g.beginPath(); g.moveTo(-0.015, -0.012); g.lineTo(0.02, -0.03); g.lineTo(0.02, 0.03); g.lineTo(-0.015, 0.012); g.closePath(); g.fill(); g.restore();
    const ah = [m.cam.x + Math.cos(a) * 0.2, m.cam.y + Math.sin(a) * 0.2]; g.strokeStyle = '#eeebf3'; g.lineWidth = px(1.2); g.beginPath(); g.moveTo(m.cam.x, m.cam.y); g.lineTo(ah[0], ah[1]); g.stroke(); dot(ah, px(5), '#eeebf3');
    for (const c of m.chars) {
      const f = c.face * D2R, fh = [c.x + Math.cos(f) * 0.1, c.y + Math.sin(f) * 0.1], col = CHAR_COL[c.id] || '#cccccc';
      g.strokeStyle = col; g.lineWidth = px(c.walk ? 2.6 : 1.4); g.beginPath(); g.moveTo(c.x, c.y); g.lineTo(fh[0], fh[1]); g.stroke(); dot(fh, px(4.5), col);
      dot([c.x, c.y], 0.045, col);
      g.fillStyle = '#16151a'; g.font = '700 ' + px(12) + 'px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(c.id, c.x, c.y + px(0.5)); g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      if (c.walk) { g.fillStyle = col; g.font = '600 ' + px(10) + 'px system-ui, sans-serif'; g.fillText('walking', c.x + 0.05, c.y + 0.08); }
    }
  }

  // ---------- side cards
  function syncList() {
    const el2 = q('#bdList'), flagged = new Set(S.flags.map(f => f.i)); el2.innerHTML = '';
    P.forEach((p, i) => {
      const d = document.createElement('div'); d.className = 'pitem' + (i === S.cur ? ' on' : ''); d.dataset.i = i;
      d.innerHTML = '<span>' + (i + 1) + '. ' + esc(p.name) + '</span><i class="muted" style="font-style:normal">' + esc(p.size) + ', ' + secs(p.frames) + '</i>' + (flagged.has(i) ? '<b style="color:var(--red)" title="There is a look-here note on this cut">!</b>' : '');
      d.onclick = () => pick(i); el2.appendChild(d);
    });
    if (S.cur >= 0) { const on = el2.children[S.cur]; if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' }); }
  }
  function syncPanel() {
    const p = P[S.cur];
    for (const id of ['#bdSize', '#bdAngle', '#bdFrames', '#bdSetup', '#bdNote', '#bdMove', '#bdSwap', '#bdAddChar', '#bdDelChar', '#bdMapPrev', '#bdUp', '#bdDown', '#bdDrop']) q(id).disabled = !p;
    if (!p) { note('#bdSizeWhy', ''); note('#bdSecs', ''); note('#bdMoveInfo', ''); q('#bdFrames').value = ''; q('#bdNote').value = ''; return; }
    q('#bdSize').value = p.size; q('#bdAngle').value = p.angle; q('#bdFrames').value = p.frames; q('#bdSetup').checked = p.setup; q('#bdNote').value = p.note;
    q('#bdMove').value = p.move ? p.move.kind : 'none';
    note('#bdSizeWhy', p.sizeSet ? 'Set by you.' : p.sizeGuess ? p.sizeGuess.why : '');
  }
  function syncWalk() {
    const el2 = q('#bdWalk'); el2.innerHTML = ''; if (S.cur < 0) return; const m = mapOf(S.cur);
    m.chars.forEach((c, k) => {
      const l = document.createElement('label'); l.className = 'chk';
      l.innerHTML = '<input type="checkbox"' + (c.walk ? ' checked' : '') + '><span class="dot" style="background:' + (CHAR_COL[c.id] || '#ccc') + '"></span><span>' + c.id + ' walks or runs where its arrow points</span>';
      l.querySelector('input').onchange = ev => { ownMap(S.cur).chars[k].walk = ev.target.checked; changed(); };
      el2.appendChild(l);
    });
  }
  function mapInfo() {
    if (S.cur < 0) { note('#bdMapInfo', ''); return; }
    const m = mapOf(S.cur), from = mapFrom(S.cur), bits = [];
    bits.push(from < 0 ? 'Starting layout. Drag the camera, the characters or the dots on their arrows to set up this shot.' : from !== S.cur ? 'Same map as panel ' + (from + 1) + '. Drag anything to give this panel its own.' : 'This panel has its own map. Later panels follow it until you change them.');
    const o = order(m), s = side(m);
    if (m.chars.length < 2) bits.push('Add a second character to get a 180 line.');
    else if (s === 0) bits.push('The camera sits right on the line between A and B, so the next shot can cross it.');
    else if (o) bits.push('From this camera A is screen ' + o + ' of B.');
    else bits.push('A or B is behind this camera.');
    note('#bdMapInfo', bits.join(' '));
  }
  function syncFlags() {
    S.flags = checks(); const el2 = q('#bdFlags'); el2.innerHTML = '';
    const msg = t => { const d = document.createElement('div'); d.className = 'muted'; d.textContent = t; el2.appendChild(d); };
    if (!P.length) { msg('Add panels to check them.'); return; }
    if (!S.flags.length) { msg(mapOf(0).chars.length < 2 && P.every((p, i) => mapOf(i).chars.length < 2) ? 'Put at least two characters on the map to check the 180 line.' : 'Nothing to look at: no 180 line crossings or screen direction flips between these panels.'); return; }
    for (const f of S.flags) {
      const d = document.createElement('div'); d.className = 'pitem'; d.style.alignItems = 'flex-start';
      d.innerHTML = '<b style="color:var(--red);padding:0 2px">' + (f.i + 1) + '</b><span style="white-space:normal">' + esc(f.text) + '</span>';
      d.onclick = () => pick(f.i); el2.appendChild(d);
    }
  }
  function syncTotal() {
    const n = total();
    note('#bdTotal', P.length ? P.length + ' panel' + (P.length === 1 ? '' : 's') + ', ' + n + ' frames, ' + secs(n) + ' at ' + S.fps + ' fps (' + tc(n) + ')' : '');
    const p = P[S.cur]; note('#bdSecs', p ? secs(p.frames) + ' at ' + S.fps + ' fps' : '');
  }
  function changed() {
    syncFlags(); syncList(); syncTotal(); syncWalk(); mapInfo(); draw(); drawStrip(); drawMap();
    const p = P[S.cur]; if (p) note('#bdMoveInfo', moveInfo(p));
  }
  function syncAll() { syncPanel(); syncLayers(); changed(); fit(); }
  function pick(i, keepPlaying) {
    if (!keepPlaying) stop();
    S.cur = P.length ? AT.clamp(i, 0, P.length - 1) : -1;
    syncPanel(); changed(); fit();
  }
  function setFps(v) { S.fps = Math.max(1, Math.round(+v) || 24); const sel = q('#bdFps'); if (![...sel.options].some(o => +o.value === S.fps)) sel.insertAdjacentHTML('beforeend', '<option value="' + S.fps + '">' + S.fps + ' fps</option>'); sel.value = String(S.fps); syncTotal(); drawStrip(); readout(); }

  // ---------- playback
  function play(from) {
    stop(); if (!P.length) return;
    const st = starts(); S.play = { f0: from != null && from >= 0 ? st[Math.min(from, P.length - 1)] : 0, t0: performance.now(), raf: 0 }; S.play.f = S.play.f0;
    q('#bdPlay').textContent = 'Stop';
    const tick = now => {
      if (!S.play) return;
      const n = total(); let f = S.play.f0 + Math.floor((now - S.play.t0) * S.fps / 1000);
      if (f >= n) { if (!q('#bdLoop').checked) { stop(); return; } S.play.f0 = 0; S.play.t0 = now; f = 0; }
      S.play.f = f; const i = panelAt(f);
      if (i !== S.cur) { S.cur = i; syncPanel(); syncList(); mapInfo(); syncWalk(); drawMap(); fit(); } else draw();
      drawStrip(); S.play.raf = requestAnimationFrame(tick);
    };
    S.play.raf = requestAnimationFrame(tick); draw(); drawStrip();
  }
  function stop() { if (!S.play) return; cancelAnimationFrame(S.play.raf); S.play = null; q('#bdPlay').textContent = 'Play'; draw(); drawStrip(); }

  // ---------- pointer: camera move frames on the panel
  const toPic = e => { const r = view.getBoundingClientRect(), v = S.view; return [(e.clientX - r.left - v.x) / v.s, (e.clientY - r.top - v.y) / v.s]; };
  function hitFrame(pt) {
    const p = P[S.cur]; if (!p || !p.move || p.move.kind === 'none' || !S.layers.move.on || S.play) return null;
    const tol = 12 / S.view.s;
    for (const which of ['b', 'a']) {
      const [x, y, w, h] = p.move[which], cs = { tl: [x, y], tr: [x + w, y], bl: [x, y + h], br: [x + w, y + h] };
      for (const k in cs) if (Math.abs(pt[0] - cs[k][0]) < tol && Math.abs(pt[1] - cs[k][1]) < tol) return { which, part: k };
    }
    for (const which of ['b', 'a']) { const [x, y, w, h] = p.move[which]; if (pt[0] > x && pt[0] < x + w && pt[1] > y && pt[1] < y + h) return { which, part: 'move' }; }
    return null;
  }
  view.addEventListener('pointerdown', e => { const pt = toPic(e), h = hitFrame(pt); if (!h) return; view.setPointerCapture(e.pointerId); S.drag = { ...h, p0: pt, r0: [...P[S.cur].move[h.which]] }; });
  view.addEventListener('pointermove', e => {
    const pt = toPic(e), d = S.drag;
    if (!d) { const h = hitFrame(pt); view.style.cursor = !h ? 'default' : h.part === 'move' ? 'move' : (h.part === 'tl' || h.part === 'br') ? 'nwse-resize' : 'nesw-resize'; return; }
    const p = P[S.cur], [x, y, w, h] = d.r0, ar = p.w / p.h;
    if (d.part === 'move') p.move[d.which] = [x + pt[0] - d.p0[0], y + pt[1] - d.p0[1], w, h];
    else {
      const ax = d.part[1] === 'l' ? x + w : x, ay = d.part[0] === 't' ? y + h : y;
      const nw = AT.clamp(Math.max(Math.abs(pt[0] - ax), Math.abs(pt[1] - ay) * ar), p.w * 0.08, p.w * 3), nh = nw / ar;
      p.move[d.which] = [d.part[1] === 'l' ? ax - nw : ax, d.part[0] === 't' ? ay - nh : ay, nw, nh];
    }
    p.move.touched = true; draw(); note('#bdMoveInfo', moveInfo(p));
  });
  view.addEventListener('pointerup', () => { if (S.drag) { S.drag = null; changed(); } });

  // ---------- pointer: the strip (pick a panel, drag a right edge to change its hold)
  strip.addEventListener('pointerdown', e => {
    if (!P.length) return; const t = stripXf(), x = e.clientX - t.r.left, st = starts();
    for (let i = 0; i < P.length; i++) { const xe = t.x0 + (st[i] + P[i].frames) * t.ppf; if (Math.abs(x - xe) <= 5) { strip.setPointerCapture(e.pointerId); stop(); S.ldrag = { i, x0: t.x0 + st[i] * t.ppf, ppf: t.ppf }; if (S.cur !== i) pick(i); return; } }
    const f = (x - t.x0) / t.ppf; if (f >= 0 && f < total()) pick(panelAt(Math.floor(f)));
  });
  strip.addEventListener('pointermove', e => {
    const t = stripXf(), x = e.clientX - t.r.left, d = S.ldrag;
    if (!d) { const st = starts(); strip.style.cursor = P.some((p, i) => Math.abs(x - (t.x0 + (st[i] + p.frames) * t.ppf)) <= 5) ? 'ew-resize' : 'pointer'; return; }
    const n = Math.max(1, Math.round((x - d.x0) / d.ppf));
    if (n !== P[d.i].frames) { P[d.i].frames = n; q('#bdFrames').value = n; syncTotal(); drawStrip(); readout(); }
  });
  strip.addEventListener('pointerup', () => { if (S.ldrag) { S.ldrag = null; changed(); } });

  // ---------- pointer: the overhead map (she places everything; nothing is recognised from the drawing)
  const toMap = e => { const t = mapXf(); return [(e.clientX - t.r.left - t.ox) / t.k, (e.clientY - t.r.top - t.oy) / t.k]; };
  function mapHit(pt) {
    const m = mapOf(S.cur), t = mapXf(), tol = 10 / t.k, a = m.cam.aim * D2R, near = (u, v, dd) => Math.hypot(u[0] - v[0], u[1] - v[1]) < dd;
    if (near(pt, [m.cam.x + Math.cos(a) * 0.2, m.cam.y + Math.sin(a) * 0.2], tol)) return { kind: 'aim' };
    for (let k = m.chars.length - 1; k >= 0; k--) { const c = m.chars[k], f = c.face * D2R; if (near(pt, [c.x + Math.cos(f) * 0.1, c.y + Math.sin(f) * 0.1], tol)) return { kind: 'face', k }; }
    for (let k = m.chars.length - 1; k >= 0; k--) if (near(pt, [m.chars[k].x, m.chars[k].y], 0.055)) return { kind: 'char', k };
    if (near(pt, [m.cam.x, m.cam.y], 0.07)) return { kind: 'cam' };
    return null;
  }
  mapCv.addEventListener('pointerdown', e => { if (S.cur < 0) return; const h = mapHit(toMap(e)); if (!h) return; mapCv.setPointerCapture(e.pointerId); stop(); ownMap(S.cur); S.mdrag = h; mapInfo(); });
  mapCv.addEventListener('pointermove', e => {
    if (S.cur < 0) return; const pt = toMap(e), d = S.mdrag;
    if (!d) { const h = mapHit(pt); mapCv.style.cursor = !h ? 'default' : (h.kind === 'aim' || h.kind === 'face') ? 'crosshair' : 'move'; return; }
    const m = ownMap(S.cur), cx = AT.clamp(pt[0], 0, MW), cy = AT.clamp(pt[1], 0, 1);
    if (d.kind === 'cam') { m.cam.x = cx; m.cam.y = cy; }
    else if (d.kind === 'char') { m.chars[d.k].x = cx; m.chars[d.k].y = cy; }
    else if (d.kind === 'aim') m.cam.aim = Math.atan2(pt[1] - m.cam.y, pt[0] - m.cam.x) / D2R;
    else { const c = m.chars[d.k]; c.face = Math.atan2(pt[1] - c.y, pt[0] - c.x) / D2R; }
    changed();
  });
  mapCv.addEventListener('pointerup', () => { S.mdrag = null; });

  // ---------- buttons and keys
  q('#bdAdd').onclick = () => q('#bdFiles').click();
  q('#bdFiles').onchange = e => { loadFiles(e.target.files, { add: P.length > 0 }); e.target.value = ''; };
  q('#bdFromStart').onclick = () => fromStart();
  q('#bdClear').onclick = () => { stop(); P.length = 0; S.cur = -1; info('The board is empty. No files were touched.'); syncAll(); };
  const swap = (i, j) => { [P[i], P[j]] = [P[j], P[i]]; };
  q('#bdUp').onclick = () => { if (S.cur > 0) { swap(S.cur, S.cur - 1); pick(S.cur - 1); } };
  q('#bdDown').onclick = () => { if (S.cur >= 0 && S.cur < P.length - 1) { swap(S.cur, S.cur + 1); pick(S.cur + 1); } };
  q('#bdDrop').onclick = () => { if (S.cur < 0) return; P.splice(S.cur, 1); pick(Math.min(S.cur, P.length - 1)); };
  q('#bdCuts').onclick = () => {
    if (P.length < 3) { info('This is for the frames of an animatic: it needs at least 3 pictures on the board.'); return; }
    stop(); const r = runs(P.map(p => p.img)), merged = r.map(([a, b]) => { const p = P[a]; p.frames = P.slice(a, b).reduce((s, x) => s + x.frames, 0); return p; });
    const n = P.length; P.length = 0; P.push(...merged);
    info('Found ' + r.length + ' shot' + (r.length === 1 ? '' : 's') + ' in ' + n + ' frames. Pans, fades and animation inside a shot can split or merge them, so check the list.');
    pick(0);
  };
  q('#bdSize').onchange = e => { const p = P[S.cur]; if (!p) return; p.size = e.target.value; p.sizeSet = true; syncPanel(); changed(); };
  q('#bdAngle').onchange = e => { const p = P[S.cur]; if (!p) return; p.angle = e.target.value; changed(); };
  q('#bdFrames').oninput = e => { const p = P[S.cur], v = Math.round(+e.target.value); if (!p || !(v >= 1)) return; p.frames = v; changed(); };
  q('#bdSetup').onchange = e => { const p = P[S.cur]; if (!p) return; p.setup = e.target.checked; changed(); };
  q('#bdNote').oninput = e => { const p = P[S.cur]; if (p) p.note = e.target.value; };
  q('#bdPlay').onclick = () => { if (S.play) stop(); else play(0); };
  q('#bdFromHere').onclick = () => play(S.cur);
  q('#bdFps').onchange = e => setFps(e.target.value);
  q('#bdPlayMoves').onchange = () => draw();
  q('#bdMove').onchange = e => setMove(e.target.value);
  q('#bdSwap').onclick = () => { const p = P[S.cur]; if (!p || !p.move) return; [p.move.a, p.move.b] = [p.move.b, p.move.a]; p.move.touched = true; changed(); };
  q('#bdAddChar').onclick = () => {
    if (S.cur < 0) return; const m = ownMap(S.cur), id = ['A', 'B', 'C', 'D'].find(x => !m.chars.some(c => c.id === x));
    if (!id) { note('#bdMapInfo', 'Four characters is the most this map holds.'); return; }
    m.chars.push({ id, x: 0.3 + 0.2 * m.chars.length, y: 0.22, face: 90, walk: false }); changed();
  };
  q('#bdDelChar').onclick = () => { if (S.cur < 0) return; const m = ownMap(S.cur); if (m.chars.length) m.chars.pop(); changed(); };
  q('#bdMapPrev').onclick = () => { if (S.cur < 0) return; P[S.cur].map = null; changed(); };
  q('#bdCsv').onclick = () => exportCsv();
  q('#bdSheet').onclick = () => exportSheet();
  q('#bdSave').onclick = () => saveBoard();
  window.addEventListener('keydown', e => {
    if (!isOn() || /INPUT|SELECT|TEXTAREA|BUTTON/.test((document.activeElement || {}).tagName || '')) return;
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && P.length) { e.preventDefault(); pick(S.cur + (e.key === 'ArrowRight' ? 1 : -1)); }
    else if (e.key === ' ' && P.length) { e.preventDefault(); if (S.play) stop(); else play(S.cur); }
  });
  window.addEventListener('resize', () => { if (isOn()) { fit(); drawStrip(); drawMap(); } });
  Store.check().then(on => { if (!q('#bdSaveInfo').textContent) note('#bdSaveInfo', on ? 'Saves the labels, holds, camera moves and maps in work/ inside the toolkit folder. Exports also land in your Downloads folder.' : 'Opened as a plain file: exports and saves go to your Downloads folder.'); });
  syncAll();

  api = { P, S, loadFiles, fromStart, pick, play, stop, checks, starts, total, tc, mapOf, ownMap, setMove, moveWords, layerObj, exportLayer, shotList,
    exportCsv, exportSheet, saveBoard, boardData, setFps, sync: changed, fit, guessSize, runs };
  window.Board = api;
  return api;
}
