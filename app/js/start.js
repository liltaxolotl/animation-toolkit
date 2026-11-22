// ============================== START: UPLOAD ==============================
// Takes in pictures, PSDs, PDF storyboard pages (split into panels the artist can fix) and short videos (pulled into
// frames), then hands plain picture files to the tab that matches what she wants help with. Originals are only read.
const Start = (() => {
  const items = []; let sel = null, uid = 1;
  const cv = $('#sView'), ctx = cv.getContext('2d'), stage = $('#sStage');
  const UI = { view: { s: 1, x: 0, y: 0 }, drag: null, box: null, adding: false, frameI: 0 };
  const isPdf = f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf';
  const isVideo = f => /^video\//.test(f.type) || /\.(mp4|mov|webm|m4v|mkv|avi)$/i.test(f.name);
  const base = n => n.replace(/\.[^.]+$/, '');
  const pad = (n, k) => String(n).padStart(k || 2, '0');
  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'app/vendor/pdfjs/pdf.worker.min.js';

  // ---------- adding files
  async function add(list) {
    const files = [...list]; if (!files.length) return;
    const pics = files.filter(f => PICS.test(f.name)).sort((u, v) => u.name.localeCompare(v.name, undefined, { numeric: true }));
    for (const f of files.filter(isPdf)) await addPdf(f);
    for (const f of files.filter(isVideo)) await addVideo(f);
    if (pics.length === 1) await addPics(base(pics[0].name), pics, 'image');
    else if (pics.length > 1) await addPics(seqName(pics), pics, 'frames');
    const skipped = files.filter(f => !PICS.test(f.name) && !isPdf(f) && !isVideo(f));
    if (skipped.length) note('Skipped ' + skipped.length + ' file' + (skipped.length > 1 ? 's' : '') + ' that are not pictures, PDFs or videos.');
    syncList();
  }
  function seqName(pics) { const a = base(pics[0].name), b = base(pics[pics.length - 1].name); let i = 0; while (i < a.length && a[i] === b[i]) i++; const s = a.slice(0, i).replace(/[_\- .]+$/, ''); return s.length >= 2 ? s : (pics[0].webkitRelativePath || '').split('/')[0] || 'frames'; }
  async function addPics(name, files, kind) {
    const it = { id: uid++, name, kind, files, imgs: [] };
    try { it.imgs[0] = await fileImage(files[0]); } catch (e) { note('Could not open ' + files[0].name + ': ' + e.message); return; }
    it.w = it.imgs[0].naturalWidth || it.imgs[0].width; it.h = it.imgs[0].naturalHeight || it.imgs[0].height;
    items.push(it); pick(it);
  }
  async function addPdf(f) {
    if (!window.pdfjsLib) { note('The PDF reader did not load, so ' + f.name + ' cannot be opened.'); return; }
    let doc; try { doc = await pdfjsLib.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise; } catch (e) { note('Could not read ' + f.name + ': ' + e.message); return; }
    const it = { id: uid++, name: base(f.name), kind: 'pdf', files: [f], doc, pages: [], pi: 0 };
    items.push(it); pick(it);
    for (let n = 1; n <= doc.numPages; n++) { it.pages.push(await pdfPage(doc, n)); if (sel === it) { syncList(); draw(); } }
    syncList(); syncSide(); draw();
  }
  async function renderPage(doc, n, width) {
    const pg = await doc.getPage(n), v1 = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale: width / v1.width });
    const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvasContext: g, viewport: vp }).promise; return c;
  }
  async function pdfPage(doc, n) {
    const show = await renderPage(doc, n, 1800), p = { n, canvas: show, w: show.width, h: show.height };
    detect(p); return p;
  }
  function detect(p) {             // finds panels on a ~900 px copy, stores them as fractions of the page
    const k = Math.min(1, 900 / p.w), w = Math.round(p.w * k), h = Math.round(p.h * k), c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(p.canvas, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data, gray = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) gray[i] = (d[i * 4] * 77 + d[i * 4 + 1] * 150 + d[i * 4 + 2] * 29) >> 8;
    const r = Panels.find(gray, w, h);
    p.panels = r.panels.map(b => ({ x: b.x / w, y: b.y / h, w: b.w / w, h: b.h / h, use: b.use })); p.how = r.how; p.note = r.note;
  }
  async function addVideo(f) {
    const url = URL.createObjectURL(f), el = document.createElement('video'); el.muted = true; el.preload = 'auto'; el.src = url; el.playsInline = true;
    try { await new Promise((res, rej) => { el.onloadeddata = res; el.onerror = () => rej(new Error('this browser cannot play that video format')); }); }
    catch (e) { note('Could not open ' + f.name + ': ' + e.message + '. MP4 (H.264) and WebM work best.'); return; }
    const it = { id: uid++, name: base(f.name), kind: 'video', files: [f], el, dur: el.duration, w: el.videoWidth, h: el.videoHeight, frames: null };
    it.to = Math.min(it.dur, 10); items.push(it); pick(it);
  }
  const seek = (el, t) => new Promise(res => { const done = () => { el.removeEventListener('seeked', done); res(); }; el.addEventListener('seeked', done); el.currentTime = t; });
  async function pullFrames(it) {
    const fps = +$('#sFps').value, from = Math.max(0, +$('#sFrom').value || 0), to = Math.min(it.dur, +$('#sTo').value || it.dur), long = +$('#sSize').value;
    const n = Math.floor((to - from) * fps + 1e-6) + 1, cap = 480;
    if (n > cap) { $('#sVideoInfo').textContent = 'That is ' + n + ' frames. Keep it under ' + cap + ' (' + (cap / fps).toFixed(0) + ' seconds at ' + fps + ' a second): pick a shorter From and To.'; return null; }
    const k = Math.min(1, long / Math.max(it.w, it.h)), w = Math.round(it.w * k), h = Math.round(it.h * k), c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
    const out = [], digits = Math.max(4, String(n).length);
    for (let i = 0; i < n; i++) {
      $('#sVideoInfo').textContent = 'Pulling frame ' + (i + 1) + ' of ' + n + '...';
      await seek(it.el, Math.min(it.dur - 1e-3, from + i / fps + 0.5 / fps * 0.02));
      g.drawImage(it.el, 0, 0, w, h);
      const b = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92)); out.push(new File([b], it.name + '_' + pad(i + 1, digits) + '.jpg', { type: 'image/jpeg' }));
    }
    it.frames = out; it.fps = fps;
    $('#sVideoInfo').textContent = n + ' frames at ' + fps + ' a second, ' + w + ' x ' + h + '. Each frame is the picture showing at that moment of the clip, so the timing matches the clock even if the phone filmed at 30 or 60.';
    return out;
  }

  // ---------- the files a tab gets
  async function panelFiles(it) {
    const out = [];
    for (const p of it.pages) {
      const use = p.panels.filter(b => b.use); if (!use.length) continue;
      if (!p.hi) p.hi = await renderPage(it.doc, p.n, 3600);
      use.forEach((b, j) => {
        const x = Math.round(b.x * p.hi.width), y = Math.round(b.y * p.hi.height), w = Math.round(b.w * p.hi.width), h = Math.round(b.h * p.hi.height), c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(p.hi, x, y, w, h, 0, 0, w, h); out.push({ c, name: it.name + '_p' + pad(p.n) + '_panel' + pad(j + 1) + '.png' });
      });
    }
    return Promise.all(out.map(o => new Promise(r => o.c.toBlob(b => r(new File([b], o.name, { type: 'image/png' })), 'image/png'))));
  }
  async function filesOf(it) {
    if (it.kind === 'pdf') return panelFiles(it);
    if (it.kind === 'video') return it.frames || (await pullFrames(it)) || [];
    return it.files;
  }

  // ---------- what she wants help with
  const ABOUT = {
    perspective: 'Opens Perspective with your drawing. Try "Find the lines for me", then "Check my drawing against the grid".',
    anatomy: 'Opens Pose match: the app guesses the joints on your drawing, you drag any that are off, and the 3D figure is fitted and laid over it as a ghost. The silhouette and value check is in Value.',
    storyboard: 'For now the panels open in Perspective (step through them with &lt; and &gt;) and in Timing as an animatic. Continuity checks are on their way.',
    redline: 'Opens Redline: paste notes and fixes a Claude wrote (the tab copies the request for you), or draw your own, then save a numbered copy plus a transparent layer.',
    animation: 'Opens Timing with your frames: onion skin, keys and breakdowns, the timing chart, an x-sheet.',
    all: 'Runs the line finder and the drift check in Perspective, and loads the frames into Timing and Value too.'
  };
  async function help(kind) {
    const it = sel; if (!it) { $('#sHelpInfo').textContent = 'Add a drawing first.'; return; }
    if (it.kind === 'pdf' && it.pages.length < it.doc.numPages) { $('#sHelpInfo').textContent = 'Still reading the PDF pages, one moment.'; return; }
    $('#sHelpInfo').textContent = 'Getting the pictures ready...';
    const files = await filesOf(it); if (!files.length) { $('#sHelpInfo').textContent = it.kind === 'pdf' ? 'No panels are switched on.' : 'Nothing to open yet.'; return; }
    record(it, kind, files);
    const toPersp = async () => { showTab('perspective'); await Persp.loadBoardFiles(files); };
    if (kind === 'perspective') await toPersp();
    else if (kind === 'animation') { showTab('timing'); await Timing.loadFiles(files); }
    else if (kind === 'anatomy') { showTab('pose'); const P = await ModTabs.get('pose'); if (P) await P.loadFiles(files); else { showTab('value'); await Value.loadFiles(files); } }
    else if (kind === 'redline') { showTab('redline'); const R = await ModTabs.get('redline'); if (R) await R.loadFiles(files); }
    else if (kind === 'storyboard') { await Timing.loadFiles(files); await toPersp(); }
    else if (kind === 'all') { await Value.loadFiles(files); if (files.length > 1) await Timing.loadFiles(files); await toPersp(); Persp.findLines(); Persp.setCheck(true); }
    $('#sHelpInfo').innerHTML = ABOUT[kind];
  }
  async function record(it, kind, files) {   // a shot file in work/<name>/ (only through serve.py), plus copies of the originals
    if (!(await Store.check())) return;
    let shot = await Store.loadShot(it.name);
    if (!shot) shot = newShot(it.name, it.files.map(f => ({ name: f.name, size: f.size, w: it.w, h: it.h })));
    if (!shot.help.includes(kind)) shot.help.push(kind);
    if (it.kind === 'pdf') shot.detections.panels = it.pages.map(p => ({ page: p.n, how: p.how, panels: p.panels }));
    if (it.kind === 'video') shot.detections.video = { fps: it.fps, frames: files.length };
    for (const f of it.files) await Store.keepOriginal(it.name, f);
    await Store.saveShot(it.name, shot);
  }

  // ---------- list and side cards
  function pick(it) { sel = it; UI.box = null; UI.adding = false; UI.frameI = 0; syncList(); syncSide(); fit(); }
  function syncList() {
    const el = $('#sList'); el.innerHTML = '';
    for (const it of items) {
      const d = document.createElement('div'); d.className = 'pitem' + (it === sel ? ' on' : '');
      const what = it.kind === 'image' ? it.w + ' x ' + it.h : it.kind === 'frames' ? it.files.length + ' frames' : it.kind === 'pdf' ? it.pages.length + ' page' + (it.pages.length === 1 ? '' : 's') + ', ' + it.pages.reduce((a, p) => a + p.panels.filter(b => b.use).length, 0) + ' panels' : (it.frames ? it.frames.length + ' frames' : it.dur.toFixed(1) + ' s video');
      d.innerHTML = '<span>' + it.name + '</span><i class="muted" style="font-style:normal">' + what + '</i><b title="Remove from this list (the file is not touched)">x</b>';
      d.onclick = e => { if (e.target.tagName === 'B') { items.splice(items.indexOf(it), 1); if (sel === it) sel = items[items.length - 1] || null; syncList(); syncSide(); fit(); return; } pick(it); };
      el.appendChild(d);
    }
    $('#sEmpty').style.display = items.length ? 'none' : 'flex';
  }
  function syncSide() {
    const it = sel, pdf = it && it.kind === 'pdf', vid = it && it.kind === 'video';
    $('#sPanelCard').style.display = pdf ? '' : 'none'; $('#sVideoCard').style.display = vid ? '' : 'none';
    if (pdf) { const p = it.pages[it.pi]; $('#sPageLbl').textContent = 'Page ' + (it.pi + 1) + ' of ' + it.doc.numPages; $('#sPanelNote').textContent = p ? p.note : 'Reading...'; $('#sPanelAdd').classList.toggle('on', UI.adding); }
    if (vid) { $('#sFrom').max = $('#sTo').max = it.dur.toFixed(2); $('#sFrom').value = it.from || 0; $('#sTo').value = (it.to || it.dur).toFixed(1); if (!it.frames) $('#sVideoInfo').textContent = it.w + ' x ' + it.h + ', ' + it.dur.toFixed(1) + ' seconds.'; }
    $('#sHelpInfo').textContent = it ? 'Opening ' + it.name + '.' : 'Add a drawing first.';
  }
  function note(t) { const r = $('#sReadout'); r.textContent = t; r.style.display = t ? '' : 'none'; }

  // ---------- the picture
  function shown() {
    const it = sel; if (!it) return null;
    if (it.kind === 'pdf') { const p = it.pages[it.pi]; return p ? { src: p.canvas, w: p.w, h: p.h, page: p } : null; }
    if (it.kind === 'video') return { src: it.el, w: it.w, h: it.h };
    const img = it.imgs[UI.frameI] || it.imgs[0]; return { src: img, w: it.w, h: it.h };
  }
  function fit() {
    const r = stage.getBoundingClientRect(), s = shown(); if (!s || r.width < 60) { draw(); return; }
    const k = Math.min((r.width - 40) / s.w, (r.height - 40) / s.h); UI.view = { s: k, x: (r.width - s.w * k) / 2, y: (r.height - s.h * k) / 2 }; draw();
  }
  function draw() {
    const dpr = window.devicePixelRatio || 1, r = stage.getBoundingClientRect();
    if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#0e0d11'; ctx.fillRect(0, 0, cv.width, cv.height);
    const s = shown(); if (!s) return; const v = UI.view;
    ctx.setTransform(v.s * dpr, 0, 0, v.s * dpr, v.x * dpr, v.y * dpr); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, s.w, s.h);
    try { ctx.drawImage(s.src, 0, 0, s.w, s.h); } catch (e) {}
    const px = n => n / v.s;
    if (s.page) {
      const P = s.page; let n = 0;
      P.panels.forEach((b, i) => {
        const x = b.x * P.w, y = b.y * P.h, w = b.w * P.w, h = b.h * P.h, on = b.use, picked = UI.box === i; if (on) n++;
        ctx.fillStyle = on ? 'rgba(255,143,184,.10)' : 'rgba(0,0,0,.25)'; ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = on ? (picked ? '#ff2f86' : '#ff8fb8') : '#8a8597'; ctx.lineWidth = px(picked ? 3.5 : 2.2); ctx.setLineDash(on ? [] : [px(7), px(6)]); ctx.strokeRect(x, y, w, h); ctx.setLineDash([]);
        const lbl = on ? String(n) : 'off', bw = px(lbl.length > 2 ? 34 : 24), bh = px(22);
        ctx.fillStyle = on ? '#ff8fb8' : '#8a8597'; ctx.fillRect(x, y, bw, bh); ctx.fillStyle = '#2a0b18'; ctx.font = '700 ' + px(13) + 'px system-ui'; ctx.textAlign = 'center'; ctx.fillText(lbl, x + bw / 2, y + px(15.5)); ctx.textAlign = 'left';
        if (picked) for (const [hx, hy] of corners(b, P)) { ctx.fillStyle = '#fff'; ctx.strokeStyle = '#ff2f86'; ctx.lineWidth = px(2); ctx.fillRect(hx - px(5), hy - px(5), px(10), px(10)); ctx.strokeRect(hx - px(5), hy - px(5), px(10), px(10)); }
      });
      if (UI.drag && UI.drag.kind === 'new') { const d = UI.drag; ctx.strokeStyle = '#ff2f86'; ctx.lineWidth = px(2.5); ctx.setLineDash([px(8), px(6)]); ctx.strokeRect(Math.min(d.a[0], d.b[0]), Math.min(d.a[1], d.b[1]), Math.abs(d.b[0] - d.a[0]), Math.abs(d.b[1] - d.a[1])); ctx.setLineDash([]); }
    }
  }
  const corners = (b, P) => [[b.x * P.w, b.y * P.h], [(b.x + b.w) * P.w, b.y * P.h], [b.x * P.w, (b.y + b.h) * P.h], [(b.x + b.w) * P.w, (b.y + b.h) * P.h]];
  const toPic = e => { const r = cv.getBoundingClientRect(), v = UI.view; return [(e.clientX - r.left - v.x) / v.s, (e.clientY - r.top - v.y) / v.s]; };
  function hit(p, P) {             // which box, and which part of it, is under the pointer
    const tol = 9 / UI.view.s;
    for (let i = P.panels.length - 1; i >= 0; i--) {
      const b = P.panels[i], x0 = b.x * P.w, y0 = b.y * P.h, x1 = x0 + b.w * P.w, y1 = y0 + b.h * P.h;
      if (p[0] < x0 - tol || p[0] > x1 + tol || p[1] < y0 - tol || p[1] > y1 + tol) continue;
      if (p[0] < x0 + 24 / UI.view.s && p[1] < y0 + 22 / UI.view.s && p[0] >= x0 && p[1] >= y0) return { i, part: 'badge' };
      const L = Math.abs(p[0] - x0) < tol, R = Math.abs(p[0] - x1) < tol, T = Math.abs(p[1] - y0) < tol, B = Math.abs(p[1] - y1) < tol;
      if (L || R || T || B) return { i, part: (T ? 't' : B ? 'b' : '') + (L ? 'l' : R ? 'r' : '') };
      return { i, part: 'move' };
    }
    return null;
  }
  cv.addEventListener('pointerdown', e => {
    const s = shown(); if (!s || !s.page) return; const P = s.page, p = toPic(e); cv.setPointerCapture(e.pointerId);
    if (UI.adding) { UI.drag = { kind: 'new', a: p, b: p }; return; }
    const h = hit(p, P); if (!h) { UI.box = null; draw(); return; }
    UI.box = h.i;
    if (h.part === 'badge') { P.panels[h.i].use = !P.panels[h.i].use; syncList(); draw(); return; }
    UI.drag = { kind: 'edit', part: h.part, p0: p, b0: { ...P.panels[h.i] } }; draw();
  });
  cv.addEventListener('pointermove', e => {
    const s = shown(); if (!s || !s.page) return; const P = s.page, p = toPic(e);
    if (!UI.drag) { const h = hit(p, P); cv.style.cursor = UI.adding ? 'crosshair' : !h ? 'default' : h.part === 'move' ? 'move' : h.part === 'badge' ? 'pointer' : /^[tb]$/.test(h.part) ? 'ns-resize' : /^[lr]$/.test(h.part) ? 'ew-resize' : (h.part === 'tl' || h.part === 'br') ? 'nwse-resize' : 'nesw-resize'; return; }
    const d = UI.drag; if (d.kind === 'new') { d.b = p; draw(); return; }
    const b = P.panels[UI.box], o = d.b0, dx = (p[0] - d.p0[0]) / P.w, dy = (p[1] - d.p0[1]) / P.h, m = 0.01;
    if (d.part === 'move') { b.x = AT.clamp(o.x + dx, 0, 1 - o.w); b.y = AT.clamp(o.y + dy, 0, 1 - o.h); }
    else {
      let x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
      if (d.part.includes('l')) x0 = AT.clamp(o.x + dx, 0, x1 - m); if (d.part.includes('r')) x1 = AT.clamp(x1 + dx, x0 + m, 1);
      if (d.part.includes('t')) y0 = AT.clamp(o.y + dy, 0, y1 - m); if (d.part.includes('b')) y1 = AT.clamp(y1 + dy, y0 + m, 1);
      Object.assign(b, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
    draw();
  });
  cv.addEventListener('pointerup', () => {
    const s = shown(), d = UI.drag; UI.drag = null; if (!s || !s.page || !d) return; const P = s.page;
    if (d.kind === 'new') {
      const x0 = Math.max(0, Math.min(d.a[0], d.b[0])) / P.w, y0 = Math.max(0, Math.min(d.a[1], d.b[1])) / P.h, x1 = Math.min(P.w, Math.max(d.a[0], d.b[0])) / P.w, y1 = Math.min(P.h, Math.max(d.a[1], d.b[1])) / P.h;
      if (x1 - x0 > 0.02 && y1 - y0 > 0.02) { P.panels.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, use: true }); reorder(P); UI.box = P.panels.findIndex(b => Math.abs(b.x - x0) < 1e-6 && Math.abs(b.y - y0) < 1e-6); if (UI.box < 0) UI.box = null; }
      UI.adding = false; syncSide();
    } else reorder(P);
    syncList(); draw();
  });
  function reorder(P) { const keep = P.panels[UI.box]; P.panels = Panels.order(P.panels.map(b => ({ ...b, x: b.x * 1e4, y: b.y * 1e4, w: b.w * 1e4, h: b.h * 1e4 }))).map(b => ({ ...b, x: b.x / 1e4, y: b.y / 1e4, w: b.w / 1e4, h: b.h / 1e4 })); if (keep) UI.box = P.panels.findIndex(b => Math.abs(b.x - keep.x) < 1e-9 && Math.abs(b.y - keep.y) < 1e-9); }
  function delBox() { const s = shown(); if (!s || !s.page || UI.box == null || UI.box < 0 || UI.box >= s.page.panels.length) return; s.page.panels.splice(UI.box, 1); UI.box = null; syncList(); draw(); }
  window.addEventListener('keydown', e => {
    if (!$('#mode-start').classList.contains('on') || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (e.key === 'Delete' || e.key === 'Backspace') delBox();
    const it = sel; if (it && it.kind === 'frames' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { UI.frameI = AT.clamp(UI.frameI + (e.key === 'ArrowRight' ? 1 : -1), 0, it.files.length - 1); if (!it.imgs[UI.frameI]) fileImage(it.files[UI.frameI]).then(im => { it.imgs[UI.frameI] = im; draw(); }); draw(); note(it.files[UI.frameI].name + ' (' + (UI.frameI + 1) + ' of ' + it.files.length + ')'); }
  });

  // ---------- buttons
  $('#sAdd').onclick = () => $('#sFiles').click(); $('#sAddDir').onclick = () => $('#sDir').click();
  $('#sFiles').onchange = e => { add(e.target.files); e.target.value = ''; }; $('#sDir').onchange = e => { add(e.target.files); e.target.value = ''; };
  stage.addEventListener('dragover', e => e.preventDefault());
  stage.addEventListener('drop', e => { e.preventDefault(); add(e.dataTransfer.files); });
  $$('[data-help]').forEach(b => b.onclick = () => help(b.dataset.help));
  $('#sPrevPage').onclick = () => { if (sel && sel.kind === 'pdf' && sel.pi > 0) { sel.pi--; UI.box = null; syncSide(); fit(); } };
  $('#sNextPage').onclick = () => { if (sel && sel.kind === 'pdf' && sel.pi < sel.pages.length - 1) { sel.pi++; UI.box = null; syncSide(); fit(); } };
  $('#sPanelAdd').onclick = () => { UI.adding = !UI.adding; syncSide(); };
  $('#sPanelDel').onclick = delBox;
  $('#sRedetect').onclick = () => { const s = shown(); if (s && s.page) { detect(s.page); UI.box = null; syncSide(); syncList(); draw(); } };
  $('#sFrom').onchange = e => { if (sel) sel.from = +e.target.value; }; $('#sTo').onchange = e => { if (sel) sel.to = +e.target.value; };
  $('#sVideoCard').addEventListener('change', e => { if (sel && sel.kind === 'video' && e.target.id !== 'sPull') sel.frames = null; });
  $('#sPull').onclick = () => sel && sel.kind === 'video' && pullFrames(sel).then(syncList);
  window.addEventListener('resize', () => { if ($('#mode-start').classList.contains('on')) fit(); });
  Store.check().then(on => { $('#sSaveInfo').innerHTML = on
    ? 'Saving on this computer, in <b>work/</b> inside the toolkit folder: a copy of each original, a shot file, and every edited copy as a new version (v1, v2, ...). Nothing is uploaded anywhere.'
    : 'This page was opened as a plain file, so exports go to your Downloads folder and versions are numbered in this browser. Open the app with the Animation Toolkit shortcut (or <b>python serve.py</b>) to keep everything together in work/.'; });
  return { items, add, help, pick, sel: () => sel, filesOf, pullFrames, draw, fit, UI };
})();
