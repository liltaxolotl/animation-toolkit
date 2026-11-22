// ============================== REDLINE: notes and fixes drawn over a copy (build step 5) ==============================
// She opens a drawing (or the Start tab hands one over), then either pastes marks a Claude wrote, opens a marks file
// (redline.py and this tab save one next to every version), or draws her own. Marks are vector items on layers, so
// any of them can be dragged, reworded or deleted. Saving makes a NEW numbered trio and never touches her drawing:
//   <name>_redline_vN.png        the drawing (faded if she asks) with the marks on top
//   <name>_redline_vN_layer.png  the marks alone, transparent, at the drawing's exact size
//   <name>_redline_vN.json       the marks, to open again here or in redline.py
// The marks format is Vec's (app/js/shot.js) wrapped as {kind: 'animtk-redline', version: 1, W, H, layers}.
// parseDoc() below is the twin of normalize() in animtk/layers.py: tests/test_app_redline.mjs feeds both the same
// inputs and checks they agree, and checks the two renderers draw the same pixels.
// Shared globals used: $, $$, fileImage, PICS, Store, Vec, layerRows, BeforeAfter, newShot, download.

const KIND = 'animtk-redline', RED = '#e8202a', BLUE = '#2f6bff';
const TYPES = ['line', 'arrow', 'poly', 'circle', 'ellipse', 'rect', 'text', 'pin'];
const NEEDS = { line: ['a', 'b'], arrow: ['a', 'b'], rect: ['a', 'b'], pin: ['from', 'to'], poly: ['pts'], circle: ['c', 'r'], ellipse: ['c', 'rx', 'ry'], text: ['at', 'text'] };
const POINT_KEYS = ['a', 'b', 'from', 'to', 'c', 'at'];
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = { get(k, d) { try { const v = localStorage.getItem('animtk-redline:' + k); return v == null ? d : v; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem('animtk-redline:' + k, String(v)); } catch (e) {} } };

// ---------- reading marks (twin of animtk/layers.py normalize)
let probe = null;
function isColor(s) {
  if (typeof s !== 'string' || !s.trim()) return false;
  if (window.CSS && CSS.supports) return CSS.supports('color', s.trim());
  probe = probe || document.createElement('canvas').getContext('2d');
  probe.fillStyle = '#010203'; probe.fillStyle = s; return probe.fillStyle !== '#010203' || /^#?010203$/i.test(s.trim());
}
const num = v => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && isFinite(+v) ? +v : null;
function point(p) {
  if (p && typeof p === 'object' && !Array.isArray(p)) p = [p.x, p.y];
  if (!Array.isArray(p) || p.length < 2) return null;
  const x = num(p[0]), y = num(p[1]); return x == null || y == null ? null : [x, y];
}
function loads(text) {
  let t = String(text).trim(); const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (fence) t = fence[1].trim();
  try { return JSON.parse(t); } catch (e) {
    const starts = [t.indexOf('{'), t.indexOf('[')].filter(i => i >= 0);
    if (!starts.length) throw new Error('no JSON found (it should start with { or [)');
    return JSON.parse(t.slice(Math.min(...starts), Math.max(t.lastIndexOf('}'), t.lastIndexOf(']')) + 1));
  }
}
function item(it, where, warn) {
  if (!it || typeof it !== 'object' || Array.isArray(it)) { warn(where + ' is not an item, skipped'); return null; }
  const t = 't' in it ? it.t : it.type;
  if (!TYPES.includes(t)) { warn(where + ' has an unknown type ' + JSON.stringify(t) + ', skipped (known: ' + TYPES.join(', ') + ')'); return null; }
  const out = { t };
  for (const k of POINT_KEYS) if (k in it) { const p = point(it[k]); if (p) out[k] = p; }
  if (Array.isArray(it.pts)) out.pts = it.pts.map(point).filter(Boolean);
  for (const k of ['r', 'rx', 'ry', 'rot', 'w', 'size']) if (k in it && num(it[k]) != null) out[k] = num(it[k]);
  if (it.text != null) out.text = String(it.text);
  if ('closed' in it) out.closed = !!it.closed;
  if (Array.isArray(it.dash)) { const d = it.dash.map(num); if (d.length && d.every(v => v != null && v >= 0)) out.dash = d; else warn(where + ': dash should be two numbers like [18, 12], ignored'); }
  for (const k of ['color', 'fill']) {
    const v = it[k]; if (!(k in it) || v == null || v === '' || v === false || v === 0) continue;
    if (!isColor(v)) warn(where + ': ' + k + ' ' + JSON.stringify(v) + ' is not a colour, ignored'); else out[k] = v;
  }
  if (it.note != null) out.note = String(it.note);
  const missing = NEEDS[t].filter(k => !(k in out));
  if (t === 'poly' && (out.pts || []).length < 2) missing.push('two or more pts');
  if (t === 'text' && !out.text) missing.push('text');
  if (missing.length) { warn(where + ' (' + t + ') is missing ' + [...new Set(missing)].join(', ') + ', skipped'); return null; }
  for (const k of ['r', 'rx', 'ry']) if (k in out && out[k] < 0) out[k] = -out[k];
  return out;
}
export function scaleDoc(doc, W, H, warn) {
  const dW = doc.W, dH = doc.H, out = { ...doc, W, H };
  if (!dW || !dH || (Math.abs(dW - W) < 1e-9 && Math.abs(dH - H) < 1e-9)) return out;
  const sx = W / dW, sy = H / dH;
  if (warn && Math.abs(sx / sy - 1) > 0.01) warn('the marks were written for a ' + dW + ' x ' + dH + ' picture and this drawing is ' + W + ' x ' + H + ', so they were stretched to fit: check they land where they should');
  const sp = p => [p[0] * sx, p[1] * sy];
  out.layers = doc.layers.map(L => ({ ...L, items: L.items.map(it => {
    const n = { ...it }; for (const k of POINT_KEYS) if (k in n) n[k] = sp(n[k]);
    if (n.pts) n.pts = n.pts.map(sp); if ('r' in n) n.r = n.r * (sx + sy) / 2; if ('rx' in n) n.rx *= sx; if ('ry' in n) n.ry *= sy; return n;
  }) }));
  return out;
}
// any accepted shape (text or parsed) -> {doc, warnings}; with W and H the coordinates are scaled to that drawing
export function parseDoc(obj, W, H) {
  const warnings = [], warn = m => warnings.push(m);
  if (typeof obj === 'string') obj = loads(obj);
  const isObj = o => o && typeof o === 'object' && !Array.isArray(o);
  const looksItem = o => isObj(o) && ('t' in o || 'type' in o) && !('items' in o);
  let raw, dW = null, dH = null;
  if (isObj(obj) && Array.isArray(obj.layers)) { raw = obj.layers; dW = num(obj.W); dH = num(obj.H); }
  else if (isObj(obj) && Array.isArray(obj.items)) { raw = [obj]; dW = num(obj.W); dH = num(obj.H); }
  else if (Array.isArray(obj) && obj.length && obj.every(looksItem)) raw = [{ name: 'Fixes', color: RED, items: obj }];
  else if (Array.isArray(obj)) raw = obj;
  else if (looksItem(obj)) raw = [{ name: 'Fixes', color: RED, items: [obj] }];
  else throw new Error('this does not look like redline marks: expected {"kind": "' + KIND + '", "layers": [...]}');
  const layers = [];
  raw.forEach((L, i) => {
    const li = i + 1; if (!isObj(L)) { warn('layer ' + li + ' is not a layer, skipped'); return; }
    const name = String(L.name || 'Layer ' + li); let col = L.color;
    if (col != null && !isColor(col)) { warn('layer ' + JSON.stringify(name) + ': colour ' + JSON.stringify(col) + ' is not a colour, using red'); col = null; }
    const op = num(L.opacity);
    const lay = { id: String(L.id || 'L' + li), name, color: col || RED, opacity: op == null ? 100 : Math.max(0, Math.min(100, op)), visible: L.visible !== false, items: [] };
    (Array.isArray(L.items) ? L.items : []).forEach((it, j) => { const n = item(it, 'layer ' + JSON.stringify(name) + ' item ' + (j + 1), warn); if (n) lay.items.push(n); });
    layers.push(lay);
  });
  let doc = { kind: KIND, version: 1, W: dW, H: dH, layers };
  if (isObj(obj)) for (const k of ['source', 'made', 'fade', 'note']) if (k in obj) doc[k] = obj[k];
  if (W && H) doc = scaleDoc(doc, W, H, warn);
  return { doc, warnings };
}
export const blankDoc = (W, H) => ({ kind: KIND, version: 1, W, H, layers: [
  { id: 'fixes', name: 'Fixes', color: RED, opacity: 100, visible: true, items: [] },
  { id: 'construction', name: 'Construction', color: BLUE, opacity: 100, visible: true, items: [] }] });

// what to paste into a Claude chat so the answer comes back in this format
export function askClaude(W, H) {
  return 'Please redline my drawing (' + W + ' x ' + H + ' px). Reply with JSON only, in this format:\n' +
    '{"kind": "animtk-redline", "version": 1, "W": ' + W + ', "H": ' + H + ', "layers": [\n' +
    '  {"name": "Fixes", "color": "#e8202a", "items": [ ... ]},\n' +
    '  {"name": "Construction", "color": "#2f6bff", "items": [ ... ]}]}\n' +
    'Coordinates are pixels on a W x H picture. If you are looking at a smaller copy, put that copy\'s size in W and H and I will scale it up.\n' +
    'Items: line {"t":"line","a":[x,y],"b":[x,y]}, arrow {"t":"arrow","a","b"} (points at b), circle {"t":"circle","c":[x,y],"r"}, ' +
    'ellipse {"c","rx","ry","rot"}, rect {"a","b"}, poly {"pts":[[x,y],...],"closed"}, text {"at":[x,y],"text","size"}, ' +
    'pin {"from","to"} (where a bit of my line should move to).\n' +
    'Optional on any item: "note" (one short sentence on why), "w" (line width, 6 is normal), "dash" [18, 12].\n' +
    'Red is for fixes, blue for construction lines. Keep notes short, friendly and specific. Do not redraw the drawing, just mark it.';
}

// ---------- geometry for picking and dragging marks
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy; let t = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function ellipsePts(c, rx, ry, rot) { const out = [], cr = Math.cos(rot), sr = Math.sin(rot); for (let i = 0; i <= 64; i++) { const t = i / 64 * Math.PI * 2, x = rx * Math.cos(t), y = ry * Math.sin(t); out.push([c[0] + x * cr - y * sr, c[1] + x * sr + y * cr]); } return out; }
function polyDist(p, pts, closed) { let d = Infinity; for (let i = 1; i < pts.length; i++) d = Math.min(d, segDist(p, pts[i - 1], pts[i])); if (closed && pts.length > 2) d = Math.min(d, segDist(p, pts[pts.length - 1], pts[0])); return d; }
// the draggable points of an item: [{key, at}], key is a point key, 'pts.N', 'r', 'rx' or 'ry'
function handles(it) {
  const h = []; for (const k of POINT_KEYS) if (it[k]) h.push({ key: k, at: it[k] });
  if (it.pts) it.pts.forEach((p, i) => h.push({ key: 'pts.' + i, at: p }));
  if (it.t === 'circle') h.push({ key: 'r', at: [it.c[0] + it.r, it.c[1]] });
  if (it.t === 'ellipse') { const r = (it.rot || 0) * Math.PI / 180; h.push({ key: 'rx', at: [it.c[0] + it.rx * Math.cos(r), it.c[1] + it.rx * Math.sin(r)] }, { key: 'ry', at: [it.c[0] - it.ry * Math.sin(r), it.c[1] + it.ry * Math.cos(r)] }); }
  return h;
}
function moveItem(it, dx, dy) { for (const k of POINT_KEYS) if (it[k]) it[k] = [it[k][0] + dx, it[k][1] + dy]; if (it.pts) it.pts = it.pts.map(p => [p[0] + dx, p[1] + dy]); }
function setHandle(it, key, p) {
  if (key.startsWith('pts.')) { it.pts[+key.slice(4)] = p; return; }
  if (key === 'r') { it.r = Math.max(1, dist(p, it.c)); return; }
  if (key === 'rx' || key === 'ry') { const r = (it.rot || 0) * Math.PI / 180, dx = p[0] - it.c[0], dy = p[1] - it.c[1]; it[key] = Math.max(1, Math.abs(key === 'rx' ? dx * Math.cos(r) + dy * Math.sin(r) : -dx * Math.sin(r) + dy * Math.cos(r))); return; }
  it[key] = p;
}
const TOOLS = [['move', 'Move', 'Pick a mark and drag it, or drag its handles'], ['arrow', 'Arrow', 'Drag from where to where'], ['line', 'Line', 'Drag a straight line'],
  ['circle', 'Circle', 'Drag from the middle out'], ['rect', 'Box', 'Drag a box'], ['text', 'Text', 'Click where the words go'], ['pin', 'Warp pin', 'Drag from a bit of line to where it should move (for corrected copies)']];

// ---------- the tab
export async function start(root) {
  if (window.RedlineTab) return window.RedlineTab;
  root.innerHTML = `
  <div class="side">
    <div class="card">
      <h2>Your drawing</h2>
      <div class="row"><button class="primary" id="rlOpen" style="flex:1">Open a drawing</button></div>
      <input type="file" id="rlFile" accept="image/*,.psd" multiple hidden>
      <div class="plist" id="rlList" style="margin-top:6px"></div>
      <div class="muted" id="rlInfo">PNG, JPG or a flattened PSD. Your file is only read, never changed.</div>
    </div>
    <div class="card">
      <h2>Marks from Claude</h2>
      <button id="rlAsk" style="width:100%" title="Copies a short note explaining the marks format, with your drawing's size">Copy a request for Claude</button>
      <textarea id="rlPaste" rows="5" style="width:100%;margin-top:6px;font:12px ui-monospace,Consolas,monospace" placeholder="Paste Claude's answer here (JSON)"></textarea>
      <div class="row"><button class="primary" id="rlUse" style="flex:1">Draw these marks</button></div>
      <div class="row"><button id="rlOpenMarks" style="flex:1">Open a marks file</button><button id="rlLatest" style="flex:1" title="The newest marks saved for this drawing in its shot folder">Open my last saved</button></div>
      <input type="file" id="rlMarksFile" accept=".json,application/json" hidden>
      <div class="muted" id="rlWarn" style="margin-top:4px"></div>
    </div>
    <div class="card">
      <h2>Draw</h2>
      <div class="grid2" id="rlTools">${TOOLS.map(([k, l, t]) => '<button data-rltool="' + k + '" title="' + esc(t) + '">' + l + '</button>').join('')}</div>
      <div class="f2" style="margin-top:6px"><label>On layer</label><select id="rlLayer"></select></div>
      <div class="row"><button id="rlNewLayer" style="flex:1">New layer</button><button id="rlUndo" style="flex:1">Undo</button></div>
      <div id="rlSelBox" style="margin-top:8px;display:none">
        <b id="rlSelName"></b>
        <div class="f2" id="rlTextRow"><label>Words</label><input id="rlText" type="text"></div>
        <div class="f2"><label>Why</label><input id="rlNote" type="text" placeholder="a short note (optional)"></div>
        <div class="row"><button id="rlDel" style="flex:1">Delete this mark</button></div>
      </div>
    </div>
  </div>
  <div class="stage" id="rlStage"><canvas id="rlView"></canvas>
    <div class="soon" id="rlEmpty" style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;pointer-events:none"><b>Open a drawing to redline it</b>Or drop one here. Paste marks from Claude, or draw your own. Your drawing is never changed.</div>
    <div class="readout" id="rlReadout" style="display:none"></div>
    <div class="hint" id="rlHint">Pick a tool and drag on the drawing. With Move, click a mark to pick it and drag its dots. Delete removes it, Ctrl+Z undoes. Drag empty space to move around, scroll to zoom.</div>
  </div>
  <div class="side">
    <div class="card">
      <h2>Layers</h2>
      <div id="rlLayers"></div>
      <div class="f2" style="margin-top:6px"><label>Fade drawing</label><input type="range" id="rlFade" min="0" max="90" step="5"></div>
      <div class="muted" id="rlFadeInfo"></div>
      <label class="chk"><input type="checkbox" id="rlBA">Before / after slider</label>
    </div>
    <div class="card">
      <h2>Notes</h2>
      <div class="plist" id="rlNotes" style="max-height:220px"></div>
    </div>
    <div class="card">
      <h2>Save</h2>
      <button class="primary" id="rlSave" style="width:100%" title="A new numbered copy, never replacing an earlier one">Save a redline copy</button>
      <button id="rlExport" style="width:100%;margin-top:6px">Export the marks (transparent PNG)</button>
      <div class="muted" id="rlSaveInfo" style="margin-top:6px"></div>
    </div>
  </div>`;
  const stage = $('#rlStage', root), cv = $('#rlView', root), ctx = cv.getContext('2d');
  const S = { items: [], cur: null, fade: +store.get('fade', 0), tool: 'move', layer: 'fixes', showDrawing: { on: true, op: 100 } };
  const UI = { view: { x: 0, y: 0, s: 1 }, fitted: false, sel: null, drag: null, space: false };
  const BA = BeforeAfter(stage, () => draw()); UI.ba = BA;
  const active = () => root.classList.contains('on');
  const say = t => { $('#rlSaveInfo', root).textContent = t || ''; };
  const warnBox = (list, lead) => { $('#rlWarn', root).innerHTML = (lead ? '<div>' + esc(lead) + '</div>' : '') + (list || []).slice(0, 6).map(w => '<div>Heads up: ' + esc(w) + '</div>').join('') + ((list || []).length > 6 ? '<div>and ' + (list.length - 6) + ' more.</div>' : ''); };

  // ---------- drawings
  async function loadFiles(files, shotName) {
    const pics = [...(files || [])].filter(f => PICS.test(f.name));
    if (!pics.length) { $('#rlInfo', root).textContent = 'That is not a picture this tab can read. PNG, JPG or a flattened PSD.'; return null; }
    let first = null;
    for (const f of pics) {
      let img; try { img = await fileImage(f); } catch (e) { $('#rlInfo', root).textContent = 'Could not open ' + f.name + ': ' + e.message; continue; }
      const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
      const it = { file: f, name: f.name, shot: Store.safe(shotName || f.name), img, W, H, doc: blankDoc(W, H), undo: [], from: null };
      const old = S.items.findIndex(x => x.name === it.name && x.shot === it.shot);
      if (old >= 0) S.items.splice(old, 1, it); else S.items.push(it);
      first = first || it;
    }
    if (first) pick(first);
    return first;
  }
  function pick(it) { S.cur = it; UI.sel = null; if (it && !it.doc.layers.some(L => L.id === S.layer)) S.layer = it.doc.layers[0] ? it.doc.layers[0].id : 'fixes'; syncAll(); fit0(); }

  // ---------- marks in and out
  const snap = it => JSON.stringify(it.doc.layers);
  function pushUndo() { const it = S.cur; if (!it) return; it.undo.push(snap(it)); if (it.undo.length > 100) it.undo.shift(); }
  function undo() { const it = S.cur; if (!it || !it.undo.length) return; it.doc.layers = JSON.parse(it.undo.pop()); UI.sel = null; syncAll(); draw(); }
  // replace = the new marks take over; otherwise their layers are added (a layer with the same id is replaced)
  function useMarks(input, from, replace) {
    const it = S.cur; if (!it) { warnBox([], 'Open a drawing first, then the marks have somewhere to go.'); return null; }
    let res; try { res = parseDoc(input, it.W, it.H); } catch (e) { warnBox([], 'Could not read those marks: ' + e.message); return null; }
    pushUndo();
    if (replace || !it.doc.layers.some(L => L.items.length)) it.doc = { ...res.doc, W: it.W, H: it.H };
    else { const ids = new Set(res.doc.layers.map(L => L.id)); it.doc.layers = it.doc.layers.filter(L => !ids.has(L.id)).concat(res.doc.layers); }
    it.from = from || null; UI.sel = null;
    if (!it.doc.layers.some(L => L.id === S.layer)) S.layer = it.doc.layers[0] ? it.doc.layers[0].id : 'fixes';
    const n = res.doc.layers.reduce((a, L) => a + L.items.length, 0);
    warnBox(res.warnings, 'Drew ' + n + ' mark' + (n === 1 ? '' : 's') + ' on ' + res.doc.layers.length + ' layer' + (res.doc.layers.length === 1 ? '' : 's') + (from ? ' from ' + from : '') + '.' + (res.doc.note ? ' ' + res.doc.note : ''));
    syncAll(); draw(); return res;
  }
  async function latestMarks(it) {
    const base = Store.safe(it.name), re = new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '_[A-Za-z0-9]+_v(\\d+)\\.json$', 'i');
    const files = (await Store.list('work/' + it.shot)).filter(f => re.test(f.name));
    if (!files.length) return null;
    files.sort((a, b) => (+a.name.match(re)[1]) - (+b.name.match(re)[1]) || a.name.localeCompare(b.name));
    const name = files[files.length - 1].name;
    try { const r = await fetch('/work/' + encodeURIComponent(it.shot) + '/' + encodeURIComponent(name), { cache: 'no-store' }); return r.ok ? { name, text: await r.text() } : null; } catch (e) { return null; }
  }

  // ---------- view
  function size() { const r = stage.getBoundingClientRect(); return [Math.max(2, r.width), Math.max(2, r.height)]; }
  function fit0() {
    const it = S.cur, [rw, rh] = size(); if (!it) { draw(); return; }
    if (rw < 60 || rh < 60) { UI.fitted = false; draw(); return; }
    const s = Math.min((rw - 40) / it.W, (rh - 40) / it.H); UI.view = { s, x: (rw - it.W * s) / 2, y: (rh - it.H * s) / 2 }; UI.fitted = true; draw();
  }
  const toD = (sx, sy) => [(sx - UI.view.x) / UI.view.s, (sy - UI.view.y) / UI.view.s];
  const toS = (x, y) => [UI.view.x + x * UI.view.s, UI.view.y + y * UI.view.s];
  // the drawing as the copy shows it: on white, faded toward white by `fade` percent (same sum as animtk.imgio.dim)
  function paintDrawing(g, it, op, fade) {
    g.fillStyle = '#fff'; g.fillRect(0, 0, it.W, it.H);
    if (op > 0) { g.globalAlpha = op; g.drawImage(it.img, 0, 0, it.W, it.H); g.globalAlpha = 1; }
    if (fade > 0) { g.fillStyle = 'rgba(255,255,255,' + fade / 100 + ')'; g.fillRect(0, 0, it.W, it.H); }
  }
  const selItem = () => { const it = S.cur, s = UI.sel; return it && s && it.doc.layers[s.li] ? it.doc.layers[s.li].items[s.ii] || null : null; };
  function draw() {
    const [w, h] = size(), dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const it = S.cur; $('#rlEmpty', root).style.display = it ? 'none' : 'flex'; if (!it) { readout(); return; }
    const v = UI.view, px = n => n / v.s;
    ctx.setTransform(dpr * v.s, 0, 0, dpr * v.s, dpr * v.x, dpr * v.y);
    paintDrawing(ctx, it, S.showDrawing.on ? S.showDrawing.op / 100 : 0, S.fade);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, it.W, it.H); ctx.clip(); Vec.draw(ctx, it.doc.layers, it.W); ctx.restore();
    if (BA.on) { const xd = Math.min(it.W, (BA.x - v.x) / v.s); if (xd > 0) { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, xd, it.H); ctx.clip(); paintDrawing(ctx, it, 1, 0); ctx.restore(); } }
    const sel = selItem();
    if (sel) for (const hd of handles(sel)) {
      ctx.beginPath(); ctx.arc(hd.at[0], hd.at[1], px(6), 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = px(2.2); ctx.strokeStyle = '#ff2f86'; ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,143,184,.9)'; ctx.lineWidth = px(1); ctx.strokeRect(0, 0, it.W, it.H);
    readout();
  }
  function readout() {
    const it = S.cur, r = $('#rlReadout', root); if (!it) { r.style.display = 'none'; return; } r.style.display = '';
    const n = it.doc.layers.reduce((a, L) => a + L.items.length, 0), tool = TOOLS.find(t => t[0] === S.tool);
    r.textContent = it.name + ', ' + it.W + ' x ' + it.H + '\n' + n + ' mark' + (n === 1 ? '' : 's') + (S.tool !== 'move' ? '\n' + tool[1] + ': ' + tool[2] : '');
  }

  // ---------- picking
  function hitHandle(sx, sy) {
    const sel = selItem(); if (!sel) return null;
    for (const hd of handles(sel)) { const p = toS(...hd.at); if (Math.hypot(p[0] - sx, p[1] - sy) < 11) return hd.key; }
    return null;
  }
  function itemDist(it, p, k) {
    const half = (it.w || 6) * k / 2;
    switch (it.t) {
      case 'line': case 'arrow': return segDist(p, it.a, it.b) - half;
      case 'pin': return Math.min(segDist(p, it.from, it.to), dist(p, it.from) - (it.w || 6) * k * 1.6) - half;
      case 'rect': { const [a, b] = [it.a, it.b], c = [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]]; return polyDist(p, c, true) - half; }
      case 'circle': return Math.abs(dist(p, it.c) - it.r) - half;
      case 'ellipse': return polyDist(p, ellipsePts(it.c, it.rx, it.ry, (it.rot || 0) * Math.PI / 180), true) - half;
      case 'poly': return polyDist(p, it.pts, it.closed) - half;
      case 'text': { const s = (it.size || 34) * k; ctx.save(); ctx.font = '600 ' + s + 'px system-ui, Segoe UI, sans-serif'; const tw = ctx.measureText(it.text).width; ctx.restore();
        const x0 = it.at[0], y0 = it.at[1] - s * 0.8; return (p[0] >= x0 && p[0] <= x0 + tw && p[1] >= y0 && p[1] <= it.at[1] + s * 0.25) ? 0 : Infinity; }
    }
    return Infinity;
  }
  function hitItem(sx, sy) {
    const it = S.cur; if (!it) return null; const p = toD(sx, sy), k = it.W / 3840, tol = 9 / UI.view.s; let best = null, bd = tol;
    it.doc.layers.forEach((L, li) => { if (L.visible === false) return; L.items.forEach((m, ii) => { const d = itemDist(m, p, k); if (d < bd) { bd = d; best = { li, ii }; } }); });
    return best;
  }

  // ---------- pointer
  const layerIndex = () => { const it = S.cur; let i = it.doc.layers.findIndex(L => L.id === S.layer); if (i < 0) { it.doc.layers.push({ id: 'fixes', name: 'Fixes', color: RED, opacity: 100, visible: true, items: [] }); i = it.doc.layers.length - 1; S.layer = 'fixes'; syncLayerSel(); } return i; };
  cv.addEventListener('pointerdown', e => {
    const it = S.cur; if (!it) return; const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top, p = toD(sx, sy);
    cv.setPointerCapture(e.pointerId);
    if (e.button === 1 || e.button === 2 || UI.space) { UI.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, x: UI.view.x, y: UI.view.y }; return; }
    const hk = hitHandle(sx, sy);
    if (hk) { pushUndo(); UI.drag = { kind: 'handle', key: hk, moved: false }; return; }
    if (S.tool === 'move') {
      const hit = hitItem(sx, sy);
      if (hit) { pushUndo(); UI.sel = hit; UI.drag = { kind: 'move', last: p, moved: false }; syncSel(); draw(); return; }
      UI.sel = null; syncSel(); UI.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, x: UI.view.x, y: UI.view.y }; draw(); return;
    }
    pushUndo(); const li = layerIndex(), L = it.doc.layers[li]; L.visible = true; let m;
    if (S.tool === 'text') { m = { t: 'text', at: p, text: 'Note', size: 44 }; L.items.push(m); UI.sel = { li, ii: L.items.length - 1 }; UI.focusText = true; syncAll(); draw(); return; }
    if (S.tool === 'circle') m = { t: 'circle', c: p, r: 1 };
    else if (S.tool === 'pin') m = { t: 'pin', from: p, to: p.slice() };
    else m = { t: S.tool, a: p, b: p.slice() };
    if (L.id === 'construction' && (S.tool === 'line')) m.dash = [18, 12];
    L.items.push(m); UI.sel = { li, ii: L.items.length - 1 }; UI.drag = { kind: 'new', a: p }; draw();
  });
  cv.addEventListener('pointermove', e => {
    const d = UI.drag, r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    if (!d) { cv.style.cursor = hitHandle(sx, sy) ? 'grab' : S.tool !== 'move' ? 'crosshair' : hitItem(sx, sy) ? 'move' : 'default'; return; }
    if (d.kind === 'pan') { UI.view.x = d.x + e.clientX - d.sx; UI.view.y = d.y + e.clientY - d.sy; draw(); return; }
    const p = toD(sx, sy), m = selItem(); if (!m) return;
    if (d.kind === 'handle') { setHandle(m, d.key, p); d.moved = true; }
    else if (d.kind === 'move') { moveItem(m, p[0] - d.last[0], p[1] - d.last[1]); d.last = p; d.moved = true; }
    else if (d.kind === 'new') { if (m.t === 'circle') m.r = Math.max(1, dist(p, m.c)); else if (m.t === 'pin') m.to = p; else m.b = p; }
    draw();
  });
  cv.addEventListener('pointerup', () => {
    if (UI.focusText) { UI.focusText = false; const t = $('#rlText', root); t.focus(); t.select(); }   // after the click, or it would take the focus back
    const d = UI.drag, it = S.cur; UI.drag = null; if (!d || !it) return;
    if ((d.kind === 'handle' || d.kind === 'move') && !d.moved) it.undo.pop();
    if (d.kind === 'new') {
      const m = selItem(), tiny = 5 / UI.view.s;
      const small = !m || (m.t === 'circle' ? m.r < tiny : dist(m.t === 'pin' ? m.from : m.a, m.t === 'pin' ? m.to : m.b) < tiny);
      if (small) { it.doc.layers[UI.sel.li].items.splice(UI.sel.ii, 1); it.undo.pop(); UI.sel = null; }
    }
    syncAll(); draw();
  });
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('wheel', e => {
    e.preventDefault(); const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, v = UI.view;
    const s = Math.max(0.02, Math.min(8, v.s * Math.exp(-e.deltaY * 0.0015))); v.x = mx - (mx - v.x) * s / v.s; v.y = my - (my - v.y) * s / v.s; v.s = s; draw();
  }, { passive: false });
  stage.addEventListener('dragover', e => e.preventDefault());
  stage.addEventListener('drop', e => {
    e.preventDefault(); const fs = e.dataTransfer ? [...e.dataTransfer.files] : []; if (!fs.length) return;
    const js = fs.find(f => /\.json$/i.test(f.name)); if (js && S.cur) { js.text().then(t => useMarks(t, js.name)); return; }
    loadFiles(fs);
  });
  window.addEventListener('keydown', e => {
    if (!active() || /INPUT|SELECT|TEXTAREA/.test((document.activeElement || {}).tagName || '')) return;
    if (e.code === 'Space') { UI.space = true; e.preventDefault(); return; }
    const it = S.cur; if (!it) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && UI.sel) { e.preventDefault(); deleteSel(); return; }
    if (e.key === 'Escape') { UI.sel = null; setTool('move'); syncSel(); draw(); return; }
    const step = e.shiftKey ? 10 : 1, mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (mv && selItem()) { e.preventDefault(); pushUndo(); moveItem(selItem(), mv[0], mv[1]); draw(); }
  });
  window.addEventListener('keyup', e => { if (e.code === 'Space') UI.space = false; });
  window.addEventListener('resize', () => { if (active()) { if (!UI.fitted) fit0(); else draw(); } });
  new ResizeObserver(() => { if (active()) { if (!UI.fitted) fit0(); else draw(); } }).observe(stage);
  function deleteSel() { const it = S.cur, s = UI.sel; if (!it || !s) return; pushUndo(); it.doc.layers[s.li].items.splice(s.ii, 1); UI.sel = null; syncAll(); draw(); }

  // ---------- saving
  const base = it => Store.safe(it.name);
  const blobOf = c => new Promise(res => c.toBlob(res, 'image/png'));
  function copyCanvas(it) { const c = document.createElement('canvas'); c.width = it.W; c.height = it.H; const g = c.getContext('2d'); paintDrawing(g, it, 1, S.fade); Vec.draw(g, it.doc.layers, it.W); return c; }
  async function saveRedline() {
    const it = S.cur; if (!it) return null;
    if (!it.doc.layers.some(L => L.items.length)) { say('There are no marks yet. Paste some from Claude or draw a few first.'); return null; }
    const r = await Store.saveVersion(it.shot, base(it), 'redline', await blobOf(copyCanvas(it)));
    const stem = base(it) + '_redline_v' + r.v, dir = 'work/' + it.shot + '/';
    const recipe = { ...it.doc, W: it.W, H: it.H, source: it.name, made: new Date().toISOString().slice(0, 19), fade: S.fade, tag: 'redline', v: r.v };
    const layBlob = await blobOf(Vec.canvas(it.doc.layers, it.W, it.H)), jsBlob = new Blob([JSON.stringify(recipe, null, 1)], { type: 'application/json' });
    if (r.path) {
      await Store.save(dir + stem + '_layer.png', layBlob); await Store.save(dir + stem + '.json', jsBlob);
      let shot = await Store.loadShot(it.shot); if (!shot) shot = newShot(it.shot, [{ name: it.name, size: it.file.size, w: it.W, h: it.H }]);
      shot.edits = shot.edits || [];
      shot.edits.push({ v: r.v, file: stem + '.png', tag: 'redline', from: 'source', source: it.name, layer: stem + '_layer.png', marks: stem + '.json', fade: S.fade, created: new Date().toISOString() });
      if (it.file instanceof Blob && !it.kept) { await Store.keepOriginal(it.shot, it.file); it.kept = true; }
      await Store.saveShot(it.shot, shot);
      say('Saved ' + stem + '.png, its transparent layer and its marks in work/' + it.shot + '/. Your drawing is untouched.');
    } else {
      download(layBlob, stem + '_layer.png'); download(jsBlob, stem + '.json');
      say('Downloaded ' + stem + '.png, its transparent layer and its marks. Your drawing is untouched.');
    }
    return { v: r.v, name: r.name, path: r.path, stem };
  }
  async function exportLayer(id) {
    const it = S.cur; if (!it) return null;
    const layers = id ? it.doc.layers.filter(L => L.id === id) : it.doc.layers.filter(L => L.visible !== false);
    if (!layers.length) return null;
    const tag = id ? 'redline_' + Store.safe(layers[0].name).replace(/ /g, '_').toLowerCase() : 'redline_marks';
    const name = base(it) + '_' + tag + '.png', p = await Store.exportFile(it.shot, name, await blobOf(Vec.canvas(layers.map(L => ({ ...L, visible: true })), it.W, it.H)));
    say('Exported ' + name + ' (' + it.W + ' x ' + it.H + ', transparent)' + (p ? ', a copy is in ' + p.replace(/\/[^/]*$/, '/') : '') + '.'); return name;
  }
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; } catch (e) {
      const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (e2) {} ta.remove(); return ok;
    }
  }

  // ---------- side panels
  function syncList() {
    const el = $('#rlList', root);
    el.innerHTML = S.items.map((it, i) => '<div class="pitem' + (it === S.cur ? ' on' : '') + '" data-rli="' + i + '"><span>' + esc(it.name) + '</span><small class="muted">' + it.W + ' x ' + it.H + '</small></div>').join('');
    $$('[data-rli]', el).forEach(d => d.onclick = () => pick(S.items[+d.dataset.rli]));
  }
  function syncLayerSel() {
    const it = S.cur, sel = $('#rlLayer', root), layers = it ? it.doc.layers : blankDoc(1, 1).layers;
    sel.innerHTML = layers.map(L => '<option value="' + esc(L.id) + '">' + esc(L.name) + '</option>').join('');
    if (!layers.some(L => L.id === S.layer) && layers[0]) S.layer = layers[0].id; sel.value = S.layer;
  }
  function syncLayers() {
    const it = S.cur;
    layerRows($('#rlLayers', root), {
      rows: () => [{ key: '__drawing', name: 'Your drawing', noExport: true }].concat(it ? it.doc.layers.map(L => ({ key: L.id, name: esc(L.name) + ' <span class="muted">(' + L.items.length + ')</span>', color: L.color })) : []),
      get: key => key === '__drawing' ? S.showDrawing : (L => ({ on: L.visible !== false, op: L.opacity }))(it.doc.layers.find(L => L.id === key)),
      set: (key, p) => { if (key === '__drawing') Object.assign(S.showDrawing, p); else { const L = it.doc.layers.find(x => x.id === key); if ('on' in p) L.visible = p.on; if ('op' in p) L.opacity = p.op; } draw(); },
      exportOne: key => exportLayer(key)
    });
  }
  function syncNotes() {
    const it = S.cur, el = $('#rlNotes', root), rows = [];
    if (it) it.doc.layers.forEach((L, li) => L.items.forEach((m, ii) => { const t = m.note || (m.t === 'text' && !/^\s*(\d+|VP\s*\d+)\s*$/i.test(m.text) ? m.text : ''); /* bare labels (1, 2, VP1) are not notes */ if (t) rows.push({ li, ii, t, col: m.color || L.color }); }));
    el.innerHTML = rows.length ? rows.map(r => '<div class="pitem' + (UI.sel && UI.sel.li === r.li && UI.sel.ii === r.ii ? ' on' : '') + '" data-rln="' + r.li + ',' + r.ii + '"><i class="dot" style="flex:none;background:' + esc(r.col) + '"></i><span style="white-space:normal">' + esc(r.t) + '</span></div>').join('') : '<div class="muted">Notes on the marks show up here. Click one to pick its mark.</div>';
    $$('[data-rln]', el).forEach(d => d.onclick = () => { const [li, ii] = d.dataset.rln.split(',').map(Number); UI.sel = { li, ii }; setTool('move'); syncSel(); draw(); });
  }
  function syncSel() {
    const m = selItem(), box = $('#rlSelBox', root); box.style.display = m ? '' : 'none'; syncNotes(); if (!m) return;
    const L = S.cur.doc.layers[UI.sel.li], names = { line: 'Line', arrow: 'Arrow', poly: 'Shape', circle: 'Circle', ellipse: 'Ellipse', rect: 'Box', text: 'Text', pin: 'Warp pin' };
    $('#rlSelName', root).textContent = names[m.t] + ' on ' + L.name;
    $('#rlTextRow', root).style.display = m.t === 'text' ? '' : 'none';
    if (document.activeElement !== $('#rlText', root)) $('#rlText', root).value = m.text || '';
    if (document.activeElement !== $('#rlNote', root)) $('#rlNote', root).value = m.note || '';
  }
  function setTool(t) { S.tool = t; $$('[data-rltool]', root).forEach(b => b.classList.toggle('on', b.dataset.rltool === t)); readout(); }
  function syncFade() { $('#rlFade', root).value = S.fade; $('#rlFadeInfo', root).textContent = S.fade ? 'The copy fades your drawing ' + S.fade + '% toward white so the marks read, the way a paintover does.' : 'The copy shows your drawing at full strength under the marks.'; }
  function syncAll() {
    syncList(); syncLayerSel(); syncLayers(); syncSel(); syncFade();
    const it = S.cur, has = !!(it && it.doc.layers.some(L => L.items.length));
    $('#rlSave', root).disabled = $('#rlExport', root).disabled = !has; $('#rlLatest', root).disabled = $('#rlAsk', root).disabled = !it; readout();
  }

  // ---------- controls
  $('#rlOpen', root).onclick = () => $('#rlFile', root).click();
  $('#rlFile', root).onchange = async e => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) await loadFiles(fs); };
  $('#rlUse', root).onclick = () => { const t = $('#rlPaste', root).value; if (!t.trim()) { warnBox([], 'Paste the marks Claude sent first.'); return; } useMarks(t, 'the pasted text'); };
  $('#rlOpenMarks', root).onclick = () => $('#rlMarksFile', root).click();
  $('#rlMarksFile', root).onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (f) useMarks(await f.text(), f.name, true); };
  $('#rlLatest', root).onclick = async () => {
    const it = S.cur; if (!it) return; if (!(await Store.check())) { warnBox([], 'Saved marks live in the shot folder, which needs the toolkit shortcut (serve.py) running.'); return; }
    const got = await latestMarks(it); if (!got) { warnBox([], 'No saved marks for ' + it.name + ' in work/' + it.shot + '/ yet.'); return; }
    useMarks(got.text, got.name, true);
  };
  $('#rlAsk', root).onclick = async () => { const it = S.cur; if (!it) return; const ok = await copyText(askClaude(it.W, it.H)); warnBox([], ok ? 'Copied. Paste it into a Claude chat with your drawing, then paste the answer in the box above.' : 'Could not reach the clipboard, so the request is in the box above to copy by hand.'); if (!ok) $('#rlPaste', root).value = askClaude(it.W, it.H); };
  $$('[data-rltool]', root).forEach(b => b.onclick = () => setTool(b.dataset.rltool));
  $('#rlLayer', root).onchange = e => { S.layer = e.target.value; };
  $('#rlNewLayer', root).onclick = () => {
    const it = S.cur; if (!it) return; pushUndo(); let n = it.doc.layers.length + 1; while (it.doc.layers.some(L => L.id === 'L' + n)) n++;
    const cols = ['#e8202a', '#2f6bff', '#16a34a', '#d97706', '#9333ea'];
    it.doc.layers.push({ id: 'L' + n, name: 'Notes ' + n, color: cols[(n - 1) % cols.length], opacity: 100, visible: true, items: [] }); S.layer = 'L' + n; syncAll();
  };
  $('#rlUndo', root).onclick = () => undo();
  $('#rlDel', root).onclick = () => deleteSel();
  $('#rlText', root).addEventListener('focus', () => pushUndo());
  $('#rlNote', root).addEventListener('focus', () => pushUndo());
  $('#rlText', root).oninput = e => { const m = selItem(); if (m && m.t === 'text') { m.text = e.target.value || ' '; draw(); syncNotes(); } };
  $('#rlNote', root).oninput = e => { const m = selItem(); if (m) { if (e.target.value) m.note = e.target.value; else delete m.note; syncNotes(); } };
  $('#rlFade', root).oninput = e => { S.fade = +e.target.value; store.set('fade', S.fade); syncFade(); draw(); };
  $('#rlBA', root).onchange = e => BA.set(e.target.checked);
  $('#rlSave', root).onclick = () => saveRedline();
  $('#rlExport', root).onclick = () => exportLayer(null);
  setTool('move'); syncAll(); fit0();

  const api = { S, UI, loadFiles, useMarks, saveRedline, exportLayer, parseDoc, askClaude, undo, cur: () => S.cur, draw, fitView: fit0, setTool,
    select(li, ii) { UI.sel = { li, ii }; syncSel(); draw(); }, deleteSelected: deleteSel,
    screenOf(x, y) { const r = cv.getBoundingClientRect(), p = toS(x, y); return [r.left + p[0], r.top + p[1]]; } };
  window.RedlineTab = api;
  return api;
}
