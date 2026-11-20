// ============================== CAMERA MODE ==============================
const Camera = (() => {
  const KCOL = ['#1e6eeb', '#e1323c', '#009650', '#eb7d00', '#823cc8', '#009696'];
  const C = { W: 3840, H: 1920, margin: 0, keys: [{ frame: 1, x: 0, y: 0, zoom: 1, ease: 'inout' }, { frame: 25, x: 1200, y: 0, zoom: 1, ease: 'inout' }], sel: 1, cur: 1, playing: false };
  const view = $('#cView'), ctx = view.getContext('2d'), prev = $('#cPrev');
  const active = () => $('#mode-camera').classList.contains('on');
  let P = null, tf = null, frozen = false, drag = null, timer = null;
  const KEY = 'animtk-camera';

  const plan = () => P = CamMath.plan(C.keys, C.W, C.H, C.margin / 100);
  const rowAt = f => P.rows[AT.clamp(f - P.rows[0].frame, 0, P.rows.length - 1)];
  function save() { try { localStorage.setItem(KEY, JSON.stringify(moveJSON())); } catch (e) {} }
  function moveJSON() { return { field: [C.W, C.H], margin: C.margin / 100, keys: C.keys.slice().sort((a, b) => a.frame - b.frame).map(k => ({ frame: k.frame, x: k.x, y: k.y, zoom: k.zoom, ease: k.ease })) }; }
  function loadMove(j) {
    if (!j || !Array.isArray(j.keys) || !j.keys.length) return false;
    if (j.field) { C.W = +j.field[0] || 3840; C.H = +j.field[1] || 1920; }
    C.margin = Math.round((+j.margin || 0) * 100);
    C.keys = j.keys.map(k => ({ frame: Math.round(+k.frame), x: +k.x || 0, y: +k.y || 0, zoom: +k.zoom || 1, ease: k.ease || 'inout' }));
    C.sel = 0; C.cur = C.keys[0].frame; frozen = false; return true;
  }
  function setKeys(keys) { loadMove({ field: [C.W, C.H], margin: C.margin / 100, keys }); sync(); }

  // ---------- the picture: the world, with the canvas, every key's view and the path
  function fitCanvas(c) { const dpr = window.devicePixelRatio || 1, r = c.parentElement.getBoundingClientRect(), w = Math.round(r.width * dpr), h = Math.round(r.height * dpr); if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } return dpr; }
  function fitTo(w, h, pad) {                       // world -> pixels so the whole canvas shows
    const zm = P.zoom_max, ww = P.canvas[0] / zm, wh = P.canvas[1] / zm, s = Math.min((w - 2 * pad) / ww, (h - 2 * pad) / wh);
    return { s, ox: (w - ww * s) / 2 - P.origin[0] * s, oy: (h - wh * s) / 2 - P.origin[1] * s };
  }
  const viewRect = k => ({ x: k.x - C.W / (2 * k.zoom), y: k.y - C.H / (2 * k.zoom), w: C.W / k.zoom, h: C.H / k.zoom });
  function paintWorld(g, t, images) {               // the key drawings, each inside its own view
    if (!images) return;
    g.save(); g.globalCompositeOperation = 'multiply';
    for (const k of C.keys) if (k.img) { const r = viewRect(k); g.globalAlpha = 0.75; g.drawImage(k.img, t.ox + r.x * t.s, t.oy + r.y * t.s, r.w * t.s, r.h * t.s); }
    g.restore();
  }
  function paintPlan(g, w, h, t, px, title) {
    const zm = P.zoom_max, X = v => t.ox + v * t.s, Y = v => t.oy + v * t.s, ox = P.origin[0], oy = P.origin[1], ww = P.canvas[0] / zm, wh = P.canvas[1] / zm;
    g.fillStyle = '#fff'; g.fillRect(X(ox), Y(oy), ww * t.s, wh * t.s);
    g.strokeStyle = 'rgba(0,0,0,.07)'; g.lineWidth = px;                      // faint grid every half field so distances can be judged
    for (let v = Math.ceil(ox / (C.W / 2)) * (C.W / 2); v < ox + ww; v += C.W / 2) { g.beginPath(); g.moveTo(X(v), Y(oy)); g.lineTo(X(v), Y(oy + wh)); g.stroke(); }
    for (let v = Math.ceil(oy / (C.H / 2)) * (C.H / 2); v < oy + wh; v += C.H / 2) { g.beginPath(); g.moveTo(X(ox), Y(v)); g.lineTo(X(ox + ww), Y(v)); g.stroke(); }
    paintWorld(g, t, true);
    g.strokeStyle = '#3c3c46'; g.lineWidth = 2 * px; g.strokeRect(X(ox), Y(oy), ww * t.s, wh * t.s);
    g.strokeStyle = '#6e6e78'; g.lineWidth = 1.5 * px; g.beginPath(); P.rows.forEach((r, i) => { const x = X(r.x), y = Y(r.y); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
    g.fillStyle = '#6e6e78'; for (const r of P.rows) { g.beginPath(); g.arc(X(r.x), Y(r.y), 2.2 * px, 0, 7); g.fill(); }
    C.keys.forEach((k, i) => {
      const r = viewRect(k), col = KCOL[i % KCOL.length], on = i === C.sel;
      g.strokeStyle = col; g.lineWidth = (on ? 4 : 2.5) * px; g.strokeRect(X(r.x), Y(r.y), r.w * t.s, r.h * t.s);
      g.fillStyle = col; g.beginPath(); g.arc(X(k.x), Y(k.y), (on ? 7 : 5) * px, 0, 7); g.fill();
      const lbl = 'frame ' + k.frame + '   ' + Math.round(k.zoom * 100) + '%'; g.font = '700 ' + 12 * px + 'px system-ui'; const tw = g.measureText(lbl).width;
      const ly = Y(r.y) + (4 + (i % 2) * 20) * px; g.fillRect(X(r.x) + 4 * px, ly, tw + 10 * px, 18 * px); g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(lbl, X(r.x) + 9 * px, ly + 9.5 * px);
    });
    if (!title) {                                    // where the camera is on the frame being scrubbed
      const q = rowAt(C.cur), r = viewRect(q); g.setLineDash([8 * px, 6 * px]); g.strokeStyle = '#ff5c9a'; g.lineWidth = 2 * px; g.strokeRect(X(r.x), Y(r.y), r.w * t.s, r.h * t.s); g.setLineDash([]);
    }
    g.fillStyle = title ? '#1e1e24' : '#a6a1b4'; g.font = (title ? '700 ' : '') + 13 * px + 'px system-ui'; g.textBaseline = 'alphabetic'; g.textAlign = 'center';
    g.fillText(P.canvas[0] + ' px', X(ox + ww / 2), Y(oy) - 7 * px);
    g.save(); g.translate(X(ox) - 8 * px, Y(oy + wh / 2)); g.rotate(-Math.PI / 2); g.fillText(P.canvas[1] + ' px', 0, 0); g.restore(); g.textAlign = 'left';
  }
  function draw() {
    const dpr = fitCanvas(view); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#0e0d11'; ctx.fillRect(0, 0, view.width, view.height);
    if (!frozen || !tf) tf = fitTo(view.width, view.height, 46 * dpr);
    paintPlan(ctx, view.width, view.height, tf, dpr, false);
  }
  function drawPrev() {                             // what the audience sees on this frame
    const g = prev.getContext('2d'), w = prev.width, h = Math.round(w * C.H / C.W); if (prev.height !== h) prev.height = h;
    const q = rowAt(C.cur), s = w / (C.W / q.zoom), t = { s, ox: w / 2 - q.x * s, oy: h / 2 - q.y * s };
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(0,0,0,.16)'; g.lineWidth = 1; const step = C.W / 8, x0 = q.x - C.W / q.zoom / 2, y0 = q.y - C.H / q.zoom / 2;
    for (let v = Math.ceil(x0 / step) * step; v < x0 + C.W / q.zoom; v += step) { g.beginPath(); g.moveTo(t.ox + v * s, 0); g.lineTo(t.ox + v * s, h); g.stroke(); }
    for (let v = Math.ceil(y0 / step) * step; v < y0 + C.H / q.zoom; v += step) { g.beginPath(); g.moveTo(0, t.oy + v * s); g.lineTo(w, t.oy + v * s); g.stroke(); }
    paintWorld(g, t, true);
    C.keys.forEach((k, i) => { const r = viewRect(k); g.strokeStyle = KCOL[i % KCOL.length]; g.globalAlpha = 0.55; g.lineWidth = 2; g.strokeRect(t.ox + r.x * s, t.oy + r.y * s, r.w * s, r.h * s); g.globalAlpha = 1; });
  }

  // ---------- the table and the read-outs
  const HEAD = [['frame', 'frame'], ['x', 'cam x'], ['y', 'cam y'], ['zoom', 'zoom %'], ['canvas_cx', 'center on canvas x'], ['canvas_cy', 'y'], ['view_w', 'sees w'], ['view_h', 'h'], ['layer_scale', 'canvas layer scale %'], ['layer_x', 'layer x'], ['layer_y', 'layer y'], ['place_x', 'place drawing at x'], ['place_y', 'y'], ['place_scale', 'drawing scale %']];
  function fillTable() {
    const keyf = new Set(C.keys.map(k => k.frame)), fmt = (c, v) => c === 'zoom' ? (v * 100).toFixed(1) : c === 'frame' ? v : (c === 'layer_scale' || c === 'place_scale') ? v.toFixed(2) : Math.round(v);
    $('#cTable').innerHTML = '<thead><tr>' + HEAD.map(h => '<th>' + h[1] + '</th>').join('') + '</tr></thead><tbody>' +
      P.rows.map(r => '<tr data-f="' + r.frame + '"' + (keyf.has(r.frame) ? ' class="key"' : '') + '>' + HEAD.map(h => '<td>' + fmt(h[0], r[h[0]]) + '</td>').join('') + '</tr>').join('') + '</tbody>';
  }
  function markRow(scroll) {
    $$('#cTable tr.now').forEach(t => t.classList.remove('now')); const tr = $('#cTable tr[data-f="' + C.cur + '"]');
    if (tr) { tr.classList.add('now'); if (scroll) { const wrap = $('#cTableWrap'), top = tr.offsetTop - 28; if (top < wrap.scrollTop || top > wrap.scrollTop + wrap.clientHeight - 60) wrap.scrollTop = Math.max(0, top - wrap.clientHeight / 2); } }
  }
  function readouts() {
    const over = CamMath.check(P), q = rowAt(C.cur), n = P.rows.length;
    $('#cSize').textContent = P.canvas[0] + ' x ' + P.canvas[1] + ' px';
    $('#cSizeInfo').textContent = 'Field ' + C.W + ' x ' + C.H + ', tightest zoom ' + Math.round(P.zoom_max * 100) + '%, ' + n + ' frame' + (n === 1 ? '' : 's') + (C.margin ? ', ' + C.margin + '% spare room' : '') + '. ' +
      (over < 0.6 ? 'The view stays inside the canvas on every frame.' : 'RUNS OFF the canvas by ' + over.toFixed(1) + ' px.') + ' Draw the background this size and the tightest zoom still has a full pixel per pixel.';
    $('#cNow').textContent = 'Frame ' + q.frame + ', zoom ' + (q.zoom * 100).toFixed(1) + '%\nCamera center on the canvas: ' + Math.round(q.canvas_cx) + ', ' + Math.round(q.canvas_cy) + '\nIt sees ' + Math.round(q.view_w) + ' x ' + Math.round(q.view_h) + ' px of the canvas\n\nIn a ' + C.W + ' x ' + C.H + ' comp:\ncanvas layer scale ' + q.layer_scale.toFixed(2) + '%\nlayer center at ' + Math.round(q.layer_x) + ', ' + Math.round(q.layer_y) +
      '\n\nA drawing made for this frame goes on the canvas with its top-left corner at ' + Math.round(q.place_x) + ', ' + Math.round(q.place_y) + ', scaled ' + q.place_scale.toFixed(2) + '%';
    $('#cFrameLbl').textContent = 'frame ' + C.cur + ' of ' + P.rows[0].frame + ' to ' + P.rows[n - 1].frame;
  }
  function keyList() {
    $('#cKeys').innerHTML = ''; const order = C.keys.map((k, i) => i).sort((a, b) => C.keys[a].frame - C.keys[b].frame);
    for (const i of order) { const k = C.keys[i], d = document.createElement('div'); d.className = 'pitem' + (i === C.sel ? ' on' : '');
      d.innerHTML = '<i class="dot" style="background:' + KCOL[i % KCOL.length] + '"></i><span>frame ' + k.frame + ' &nbsp; (' + Math.round(k.x) + ', ' + Math.round(k.y) + ') &nbsp; ' + Math.round(k.zoom * 100) + '%' + (k.img ? ' &nbsp; +drawing' : '') + '</span>';
      d.onclick = () => { C.sel = i; C.cur = k.frame; sync(); }; $('#cKeys').appendChild(d); }
    const k = C.keys[C.sel], set = (id, v) => { const el = $(id); if (document.activeElement !== el) el.value = v; };
    set('#cKF', k.frame); set('#cKX', Math.round(k.x)); set('#cKY', Math.round(k.y)); set('#cKZ', +(k.zoom * 100).toFixed(1)); $('#cKE').value = k.ease || 'inout';
  }
  function sync(light) {
    plan(); C.cur = AT.clamp(C.cur, P.rows[0].frame, P.rows[P.rows.length - 1].frame);
    const sc = $('#cScrub'); sc.min = P.rows[0].frame; sc.max = P.rows[P.rows.length - 1].frame; sc.value = C.cur;
    $('#cMargin').value = C.margin; $('#cMargin').nextElementSibling.textContent = C.margin + '%';
    if (document.activeElement !== $('#cW')) $('#cW').value = C.W; if (document.activeElement !== $('#cH')) $('#cH').value = C.H;
    if (!light) { keyList(); fillTable(); save(); }
    markRow(!light || C.playing); readouts(); if (active()) { draw(); drawPrev(); }
  }

  // ---------- exports
  function csv() { return [CamMath.COLS.join(',')].concat(P.rows.map(r => CamMath.COLS.map(c => r[c]).join(','))).join('\r\n') + '\r\n'; }
  function planCanvas(width) {
    const zm = P.zoom_max, ww = P.canvas[0] / zm, wh = P.canvas[1] / zm, px = width / 1300, pad = 60 * px, top = 96 * px, s = (width - 2 * pad) / ww;
    const c = document.createElement('canvas'); c.width = width; c.height = Math.round(wh * s + top + pad); const g = c.getContext('2d');
    g.fillStyle = '#f5f4f7'; g.fillRect(0, 0, c.width, c.height);
    paintPlan(g, c.width, c.height, { s, ox: pad - P.origin[0] * s, oy: top - P.origin[1] * s }, px, true);
    g.fillStyle = '#1e1e24'; g.font = '700 ' + 22 * px + 'px system-ui'; g.fillText('Canvas needed: ' + P.canvas[0] + ' x ' + P.canvas[1] + ' px', pad, 34 * px);
    g.fillStyle = '#5a5a64'; g.font = 13 * px + 'px system-ui'; g.fillText('field ' + C.W + ' x ' + C.H + ', tightest zoom ' + Math.round(zm * 100) + '%, ' + P.rows.length + ' frames. Boxes = what the camera sees at each key. Dots = its center, one per frame.', pad, 58 * px);
    return c;
  }
  $('#cCsv').onclick = () => { download(new Blob([csv()], { type: 'text/csv' }), 'shot_camera.csv'); $('#cExportInfo').textContent = 'Table saved: ' + P.rows.length + ' frames.'; };
  $('#cPng').onclick = () => planCanvas(2600).toBlob(b => download(b, 'shot_plan.png'));
  $('#cSave').onclick = () => download(new Blob([JSON.stringify(moveJSON(), null, 1)], { type: 'application/json' }), 'shot_move.json');
  $('#cLoadBtn').onclick = () => $('#cLoad').click();
  $('#cLoad').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { if (loadMove(JSON.parse(await f.text()))) { sync(); $('#cExportInfo').textContent = 'Opened ' + f.name; } else $('#cExportInfo').textContent = 'That file has no camera keys in it.'; } catch (err) { $('#cExportInfo').textContent = 'Could not read that file.'; } };

  // ---------- controls
  const selKey = () => C.keys[C.sel];
  $('#cW').oninput = e => { const v = Math.round(+e.target.value); if (v >= 16) { C.W = v; sync(); } }; $('#cH').oninput = e => { const v = Math.round(+e.target.value); if (v >= 16) { C.H = v; sync(); } };
  $('#cMargin').oninput = e => { C.margin = +e.target.value; sync(); };
  $('#cKF').oninput = e => { const v = Math.round(+e.target.value); if (v >= 1 && !C.keys.some((k, i) => i !== C.sel && k.frame === v)) { selKey().frame = v; C.cur = v; sync(); } };
  $('#cKX').oninput = e => { if (e.target.value !== '') { selKey().x = +e.target.value; sync(); } }; $('#cKY').oninput = e => { if (e.target.value !== '') { selKey().y = +e.target.value; sync(); } };
  $('#cKZ').oninput = e => { const v = +e.target.value; if (v >= 10 && v <= 800) { selKey().zoom = v / 100; sync(); } };
  $('#cKE').onchange = e => { selKey().ease = e.target.value; sync(); };
  function addKey() {
    const last = C.keys.slice().sort((a, b) => a.frame - b.frame).pop();
    C.keys.push({ frame: last.frame + 24, x: last.x + Math.round(C.W / 4), y: last.y, zoom: last.zoom, ease: 'inout' }); C.sel = C.keys.length - 1; C.cur = last.frame + 24; sync();
  }
  $('#cAdd').onclick = addKey;
  $('#cDel').onclick = () => { if (C.keys.length < 2) return; C.keys.splice(C.sel, 1); C.sel = Math.max(0, C.sel - 1); sync(); };
  $$('[data-cmove]').forEach(b => b.onclick = () => { const m = b.dataset.cmove;
    setKeys([{ frame: 1, x: 0, y: 0, zoom: 1, ease: 'inout' }, { frame: 49, x: m === 'push' ? 0 : Math.round(C.W / 2), y: 0, zoom: m === 'pan' ? 1 : 1.5, ease: 'inout' }]); C.sel = 1; sync(); });
  $('#cImgBtn').onclick = () => $('#cImg').click();
  async function setImage(i, file) { const bmp = await fileBitmap(file), k = Math.min(1, 1600 / bmp.width), c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height); C.keys[i].img = c; sync(); }
  $('#cImg').onchange = e => { if (e.target.files[0]) setImage(C.sel, e.target.files[0]); e.target.value = ''; };
  $('#cImgClear').onclick = () => { delete selKey().img; sync(); };
  $('#cScrub').oninput = e => { C.cur = +e.target.value; sync(true); };
  $('#cTable').onclick = e => { const tr = e.target.closest('tr[data-f]'); if (tr) { C.cur = +tr.dataset.f; sync(true); } };
  function stop() { C.playing = false; clearInterval(timer); $('#cPlay').textContent = 'Play'; }
  function play() { if (P.rows.length < 2) return; C.playing = true; $('#cPlay').textContent = 'Stop'; if (C.cur >= P.rows[P.rows.length - 1].frame) C.cur = P.rows[0].frame;
    timer = setInterval(() => { if (C.cur >= P.rows[P.rows.length - 1].frame) { stop(); return; } C.cur++; sync(true); }, 1000 / 24); }
  $('#cPlay').onclick = () => C.playing ? stop() : play();

  const pos = e => { const r = view.getBoundingClientRect(), dpr = view.width / r.width; return [(e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr, dpr]; };
  function hit(mx, my, dpr) {                         // a key's center dot first, then the smallest box under the pointer
    let best = -1, bd = 14 * dpr;
    C.keys.forEach((k, i) => { const d = Math.hypot(tf.ox + k.x * tf.s - mx, tf.oy + k.y * tf.s - my); if (d < bd) { bd = d; best = i; } });
    if (best >= 0) return best; let area = Infinity;
    C.keys.forEach((k, i) => { const r = viewRect(k), x = tf.ox + r.x * tf.s, y = tf.oy + r.y * tf.s; if (mx >= x && mx <= x + r.w * tf.s && my >= y && my <= y + r.h * tf.s && (r.w * r.h < area || i === C.sel)) { if (i === C.sel) area = -1; else area = r.w * r.h; best = i; } });
    return best;
  }
  view.addEventListener('pointerdown', e => { const [mx, my, dpr] = pos(e), i = hit(mx, my, dpr); if (i < 0) return; view.setPointerCapture(e.pointerId); C.sel = i; C.cur = C.keys[i].frame; frozen = true; drag = { mx, my, x: C.keys[i].x, y: C.keys[i].y }; sync(); });
  view.addEventListener('pointermove', e => { if (!drag) return; const [mx, my] = pos(e), k = selKey(); let dx = (mx - drag.mx) / tf.s, dy = (my - drag.my) / tf.s; if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; } k.x = Math.round(drag.x + dx); k.y = Math.round(drag.y + dy); sync(); });
  const drop = () => { if (drag) { drag = null; frozen = false; sync(); } };
  view.addEventListener('pointerup', drop); view.addEventListener('pointercancel', drop);
  view.addEventListener('wheel', e => { e.preventDefault(); const k = selKey(); k.zoom = AT.clamp(Math.round(k.zoom * Math.exp(-e.deltaY * 0.0012) * 100) / 100, 0.1, 8); sync(); }, { passive: false });
  window.addEventListener('keydown', e => {
    if (!active() || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return; const k = selKey(), step = e.shiftKey ? 100 : 10;
    if (e.key === 'ArrowLeft') k.x -= step; else if (e.key === 'ArrowRight') k.x += step; else if (e.key === 'ArrowUp') k.y -= step; else if (e.key === 'ArrowDown') k.y += step;
    else if (e.code === 'Space') { e.preventDefault(); C.playing ? stop() : play(); return; } else return;
    e.preventDefault(); sync();
  });
  window.addEventListener('resize', () => { if (active()) { draw(); drawPrev(); } });
  try { const j = JSON.parse(localStorage.getItem(KEY) || 'null'); if (j) loadMove(j); } catch (e) {}
  sync();
  return { C, plan: () => P, setKeys, loadMove, moveJSON, csv, planCanvas, sync, setImage, transform: () => tf, play, stop };
})();
