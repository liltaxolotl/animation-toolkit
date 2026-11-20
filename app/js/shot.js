// ============================== SHOT FILES, SAVING, LAYERS, BEFORE/AFTER ==============================
// Shared by every tab. Three pieces:
//   Store   saves into work/<shot>/ through serve.py when it is running, otherwise downloads. Never overwrites
//           anything except a shot's own shot.json. Edits are numbered: shot01_edit_v1.png, _v2, ...
//   Vec     the vector overlay format (also what redlines and Claude's notes come back as). Drawn at the
//           drawing's own pixel size, so an exported layer drops straight onto the drawing in any program.
//   BeforeAfter  a draggable split handle on a stage: left of it shows the untouched drawing.

const Store = (() => {
  let online = null;
  const safe = s => String(s || 'shot').replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9 _.\-()]+/g, '_').replace(/^[ .]+|[ .]+$/g, '').slice(0, 80) || 'shot';
  async function check() {
    if (online !== null) return online;
    if (location.protocol === 'file:') return (online = false);
    try { const r = await fetch('/api/ping', { cache: 'no-store' }); online = r.ok && (await r.json()).ok === true; } catch (e) { online = false; }
    return online;
  }
  async function list(dir) {
    if (!(await check())) return [];
    try { const r = await fetch('/api/list?dir=' + encodeURIComponent(dir)); return r.ok ? (await r.json()).files : []; } catch (e) { return []; }
  }
  // -> {ok, path} | {ok: false, exists: true} | {ok: false, error}
  async function save(path, blob) {
    if (!(await check())) return { ok: false, error: 'offline' };
    try {
      const r = await fetch('/api/save?path=' + encodeURIComponent(path), { method: 'POST', body: blob });
      const j = await r.json(); return r.ok ? { ok: true, path: j.path } : { ok: false, exists: r.status === 409, error: j.error };
    } catch (e) { return { ok: false, error: e.message }; }
  }
  // next free number for base_tag_vN.ext, looking at work/<shot>/ (and this browser's own memory when offline)
  async function nextVersion(shot, base, tag, ext) {
    const re = new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '_' + tag + '_v(\\d+)\\.' + ext + '$', 'i');
    let n = 0; for (const f of await list('work/' + safe(shot))) { const m = f.name.match(re); if (m) n = Math.max(n, +m[1]); }
    const key = 'animtk-ver:' + safe(shot) + '/' + base + '_' + tag;
    try { n = Math.max(n, +(localStorage.getItem(key) || 0)); } catch (e) {}
    return { n: n + 1, remember: () => { try { localStorage.setItem(key, String(n + 1)); } catch (e) {} } };
  }
  // an edited copy: never replaces an earlier version. -> {name, path|null}
  async function saveVersion(shot, base, tag, blob, ext) {
    ext = ext || 'png'; shot = safe(shot); base = safe(base);
    for (let tries = 0; tries < 50; tries++) {
      const v = await nextVersion(shot, base, tag, ext), name = base + '_' + tag + '_v' + v.n + '.' + ext;
      if (!(await check())) { v.remember(); download(blob, name); return { name, path: null, v: v.n }; }
      const r = await save('work/' + shot + '/' + name, blob);
      if (r.ok) { v.remember(); return { name, path: r.path, v: v.n }; }
      if (!r.exists) { download(blob, name); return { name, path: null, v: v.n, error: r.error }; }
      v.remember();                                    // somebody else took that number: try the next one
    }
    throw new Error('could not find a free version number');
  }
  // an overlay export: always downloads (that is where the artist picks it up), and keeps a copy in work/ when it can
  async function exportFile(shot, name, blob) {
    download(blob, name);
    if (await check()) { const p = 'work/' + safe(shot) + '/exports/'; let r = await save(p + name, blob), i = 2; while (!r.ok && r.exists && i < 100) r = await save(p + name.replace(/(\.[^.]+)$/, '_' + i++ + '$1'), blob); return r.path || null; }
    return null;
  }
  // a copy of an original, write-once (a second upload of the same file is fine: it is already there)
  async function keepOriginal(shot, file) {
    if (!(await check())) return null;
    const p = 'work/' + safe(shot) + '/source/' + safe(file.name) + (file.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    const r = await save(p, file); return r.ok || r.exists ? p : null;
  }
  async function saveShot(shot, obj) { return save('work/' + safe(shot) + '/shot.json', new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' })); }
  async function loadShot(shot) {
    if (!(await check())) return null;
    try { const r = await fetch('/work/' + encodeURIComponent(safe(shot)) + '/shot.json', { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch (e) { return null; }
  }
  return { check, online: () => online, list, save, saveVersion, exportFile, keepOriginal, saveShot, loadShot, safe };
})();

// A new shot file. Python twin: animtk/shotfile.py (same fields).
function newShot(name, sources) {
  return { kind: 'animtk-shot', version: 1, name: Store.safe(name), created: new Date().toISOString(), help: [],
    sources: (sources || []).map(f => ({ file: f.name, size: f.size, w: f.w || null, h: f.h || null })),
    detections: {}, layers: [], edits: [], notes: [] };
}

// ---------- vector overlays
// layer: {id, name, color, opacity (0-100), visible, items: [...]}, coordinates in the drawing's own pixels.
// items: line {a,b} | arrow {a,b} | poly {pts, closed} | circle {c, r} | ellipse {c, rx, ry, rot} | rect {a, b}
//        | text {at, text, size} | pin {from, to} (a warp pin: where a bit of linework should move to)
// optional on any item: color, w (line width in px at 3840 wide), dash: [on, off], fill
const Vec = (() => {
  const W0 = 3840;
  function drawItem(c, it, layer, k) {
    const col = it.color || layer.color || '#e8202a', w = (it.w || 6) * k;
    c.strokeStyle = col; c.fillStyle = it.fill || col; c.lineWidth = w; c.setLineDash(it.dash ? it.dash.map(v => v * k) : []);
    c.lineCap = c.lineJoin = 'round';
    const P = p => p;
    switch (it.t) {
      case 'line': c.beginPath(); c.moveTo(...P(it.a)); c.lineTo(...P(it.b)); c.stroke(); break;
      case 'arrow': case 'pin': {
        const a = it.t === 'pin' ? it.from : it.a, b = it.t === 'pin' ? it.to : it.b, ang = Math.atan2(b[1] - a[1], b[0] - a[0]), h = Math.max(14 * k, w * 3.2);
        c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0] - Math.cos(ang) * h * 0.6, b[1] - Math.sin(ang) * h * 0.6); c.stroke(); c.setLineDash([]);
        c.beginPath(); c.moveTo(b[0], b[1]); c.lineTo(b[0] - h * Math.cos(ang - 0.42), b[1] - h * Math.sin(ang - 0.42)); c.lineTo(b[0] - h * Math.cos(ang + 0.42), b[1] - h * Math.sin(ang + 0.42)); c.closePath(); c.fill();
        if (it.t === 'pin') { c.beginPath(); c.arc(a[0], a[1], w * 1.6, 0, 7); c.fill(); }
        break; }
      case 'poly': if (!it.pts || it.pts.length < 2) break; c.beginPath(); it.pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); if (it.closed) c.closePath(); if (it.fill) c.fill(); c.stroke(); break;
      case 'circle': c.beginPath(); c.arc(it.c[0], it.c[1], it.r, 0, 7); if (it.fill) c.fill(); c.stroke(); break;
      case 'ellipse': c.beginPath(); c.ellipse(it.c[0], it.c[1], it.rx, it.ry, (it.rot || 0) * Math.PI / 180, 0, 7); if (it.fill) c.fill(); c.stroke(); break;
      case 'rect': { const x = Math.min(it.a[0], it.b[0]), y = Math.min(it.a[1], it.b[1]); c.beginPath(); c.rect(x, y, Math.abs(it.b[0] - it.a[0]), Math.abs(it.b[1] - it.a[1])); if (it.fill) c.fill(); c.stroke(); break; }
      case 'text': { const s = (it.size || 34) * k; c.setLineDash([]); c.font = '600 ' + s + 'px system-ui, Segoe UI, sans-serif'; c.lineWidth = s * 0.22; c.strokeStyle = 'rgba(255,255,255,.92)'; c.strokeText(it.text, it.at[0], it.at[1]); c.fillStyle = col; c.fillText(it.text, it.at[0], it.at[1]); break; }
    }
    c.setLineDash([]);
  }
  // draw layers onto a context already in drawing-pixel space; W = drawing width (line widths scale with it)
  function draw(c, layers, W) {
    const k = (W || W0) / W0;
    for (const L of layers) { if (L.visible === false || !L.items) continue; c.save(); c.globalAlpha = (L.opacity == null ? 100 : L.opacity) / 100; for (const it of L.items) drawItem(c, it, L, k); c.restore(); }
  }
  // a transparent PNG canvas at the drawing's exact size
  function canvas(layers, W, H) { const cv = document.createElement('canvas'); cv.width = W; cv.height = H; draw(cv.getContext('2d'), layers, W); return cv; }
  return { draw, canvas, drawItem };
})();

// ---------- the layer list in a side card: tick box, opacity, export one layer
// opts: {rows: () => [{key, name, color}], get: key => {on, op}, set: (key, patch) => void, exportOne: key => void}
function layerRows(el, opts) {
  el.innerHTML = '';
  for (const r of opts.rows()) {
    const st = opts.get(r.key), row = document.createElement('div'); row.className = 'lrow';
    row.innerHTML = '<label class="chk"><input type="checkbox"' + (r.attr || '') + '>' + (r.color ? '<span class="dot" style="background:' + r.color + '"></span>' : '') + '<span>' + r.name + '</span></label>' +
      '<input type="range" min="0" max="100" step="5" title="Opacity">' + (opts.exportOne && !r.noExport ? '<button class="lexp" title="Export this layer alone as a transparent PNG">&#8681;</button>' : '');
    const cb = row.querySelector('input[type=checkbox]'), op = row.querySelector('input[type=range]'), ex = row.querySelector('.lexp');
    cb.checked = !!st.on; op.value = st.op == null ? 100 : st.op;
    cb.onchange = () => opts.set(r.key, { on: cb.checked }); op.oninput = () => opts.set(r.key, { op: +op.value });
    if (ex) ex.onclick = () => opts.exportOne(r.key);
    el.appendChild(row);
  }
}

// ---------- before / after split handle
// const ba = BeforeAfter(stageEl, onChange); ba.on (bool), ba.x (CSS px from the stage's left edge)
function BeforeAfter(stage, onChange) {
  const h = document.createElement('div'); h.className = 'ba-handle'; h.innerHTML = '<span class="ba-l">Before</span><i></i><span class="ba-r">After</span>';
  stage.appendChild(h);
  const o = { on: false, x: 0 };
  const place = () => { h.style.left = o.x + 'px'; h.style.display = o.on ? 'block' : 'none'; };
  h.addEventListener('pointerdown', e => {
    e.stopPropagation(); e.preventDefault(); h.setPointerCapture(e.pointerId);
    const move = ev => { const r = stage.getBoundingClientRect(); o.x = Math.max(0, Math.min(r.width, ev.clientX - r.left)); place(); onChange(); };
    const up = () => { h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); };
    h.addEventListener('pointermove', move); h.addEventListener('pointerup', up);
  });
  o.set = on => { o.on = on; if (on && !o.x) o.x = stage.getBoundingClientRect().width / 2; place(); onChange(); };
  o.place = place;
  return o;
}

function showTab(mode) { const t = document.querySelector('#tabs .tab[data-mode="' + mode + '"]'); if (t) t.click(); }
