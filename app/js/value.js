// ============================== VALUE MODE ==============================
const Value = (() => {
  const WORK = 960;
  const Vs = { frames: [], cur: 0, mode: 'auto', gap: 4, thr: 128, thrAuto: true, edge: true, levels: 0, stack: false, flip: false, orig: false };
  const view = $('#vView'), ctx = view.getContext('2d');
  const active = () => $('#mode-value').classList.contains('on');
  let R = null, boxes = null;                       // R = the worked-out silhouette of the current frame

  const natural = s => (s.match(/\d+/g) || ['0']).map(Number);
  const cmpName = (a, b) => { const x = natural(a.name), y = natural(b.name); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return a.name.localeCompare(b.name); };
  async function loadFiles(list) {
    const files = [...list].filter(f => PICS.test(f.name)).sort(cmpName); if (!files.length) return;
    Vs.frames = []; Vs.cur = 0; $('#vInfo').textContent = 'Loading...';
    for (const f of files) {
      const bmp = await fileBitmap(f), k = Math.min(1, 1600 / bmp.width), c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);                       // kept with its transparency
      Vs.frames.push({ name: f.name, file: f, img: c, w: bmp.width, h: bmp.height, marks: [] }); bmp.close && bmp.close();
    }
    sync();
  }
  // gray + alpha of a picture at a given width (transparent parts read as white paper)
  function pixels(src, w, h) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data, n = w * h, gray = new Uint8Array(n), alpha = new Uint8Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) { const a = d[p + 3] / 255; alpha[i] = d[p + 3]; gray[i] = Math.min(255, Math.floor((d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114) * a + 255 * (1 - a) + 0.5)); }
    return { gray, alpha };
  }
  function pickMode(gray, alpha, w, h) {
    let clear = 0; const n = w * h; for (let i = 0; i < n; i++) if (alpha[i] < 128) clear++;
    if (clear / n > 0.02 && clear / n < 0.995) return 'alpha';
    const dark = new Uint8Array(n); for (let i = 0; i < n; i++) dark[i] = gray[i] < 200 ? 1 : 0;
    const solid = ValueMath.morph(dark, w, h, 7, false); let s = 0; for (let i = 0; i < n; i++) s += solid[i];
    return s / n > 0.03 ? 'tone' : 'lines';
  }
  function work(fr, extra) {
    const w = Math.min(WORK, fr.w), h = Math.max(1, Math.round(fr.h * w / fr.w)), px = pixels(fr.img, w, h), n = w * h;
    const mode = Vs.mode === 'auto' ? pickMode(px.gray, px.alpha, w, h) : Vs.mode, out = { w, h, mode, gray: px.gray };
    if (mode === 'alpha') { out.mask = new Uint8Array(n); for (let i = 0; i < n; i++) out.mask[i] = px.alpha[i] >= 128 ? 1 : 0; }
    else if (mode === 'tone') { out.thr = Vs.thrAuto ? ValueMath.otsu(px.gray) + 1 : Vs.thr; out.mask = new Uint8Array(n); for (let i = 0; i < n; i++) out.mask[i] = px.gray[i] < out.thr ? 1 : 0; }
    else {
      const marks = fr.marks.concat(extra || []), pt = m => [m.x * w, m.y * h];
      Object.assign(out, ValueMath.silhouetteLines(px.gray, w, h, Vs.gap, marks.filter(m => m.set === 'fill').map(pt), marks.filter(m => m.set === 'clear').map(pt), Vs.edge ? 'auto' : 'open'));
    }
    let cov = 0, fs = 0, bs = 0; for (let i = 0; i < n; i++) { if (out.mask[i]) { cov++; fs += px.gray[i]; } else bs += px.gray[i]; }
    out.coverage = cov / n * 100;
    if (mode !== 'lines' && cov && cov < n) { out.figure = fs / cov / 2.55; out.background = bs / (n - cov) / 2.55; out.separation = Math.abs(out.figure - out.background); }
    return out;
  }
  function maskCanvas(r, W, H) {                    // crisp black on white at any size
    const s = document.createElement('canvas'); s.width = r.w; s.height = r.h; const g = s.getContext('2d'), im = g.createImageData(r.w, r.h);
    for (let i = 0, p = 0; i < r.mask.length; i++, p += 4) { const v = r.mask[i] ? 0 : 255; im.data[p] = im.data[p + 1] = im.data[p + 2] = v; im.data[p + 3] = 255; }
    g.putImageData(im, 0, 0); if (!W || (W === r.w && H === r.h)) return s;
    const c = document.createElement('canvas'); c.width = W; c.height = H; const cg = c.getContext('2d', { willReadFrequently: true }); cg.imageSmoothingQuality = 'high'; cg.drawImage(s, 0, 0, W, H);
    const d = cg.getImageData(0, 0, W, H); for (let p = 0; p < d.data.length; p += 4) { const v = d.data[p] < 128 ? 0 : 255; d.data[p] = d.data[p + 1] = d.data[p + 2] = v; } cg.putImageData(d, 0, 0); return c;
  }
  function grayCanvas(src, W, H) {
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H);
    for (let p = 0; p < d.data.length; p += 4) { const v = ValueMath.posterize(Math.min(255, Math.floor(d.data[p] * 0.299 + d.data[p + 1] * 0.587 + d.data[p + 2] * 0.114 + 0.5)), Vs.levels); d.data[p] = d.data[p + 1] = d.data[p + 2] = v; }
    g.putImageData(d, 0, 0); return c;
  }
  function flat(src, W, H) { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.drawImage(src, 0, 0, W, H); return c; }

  function draw() {
    const dpr = window.devicePixelRatio || 1, rc = view.parentElement.getBoundingClientRect(); view.width = Math.round(rc.width * dpr); view.height = Math.round(rc.height * dpr);
    ctx.fillStyle = '#0e0d11'; ctx.fillRect(0, 0, view.width, view.height); const fr = Vs.frames[Vs.cur]; boxes = null;
    if (!fr) { ctx.fillStyle = '#a6a1b4'; ctx.font = 16 * dpr + 'px system-ui'; ctx.textAlign = 'center'; ctx.fillText('Load a frame to see its silhouette and its grayscale', view.width / 2, view.height / 2); ctx.textAlign = 'left'; $('#vReadout').textContent = ''; return; }
    const gap = 12 * dpr, pad = 16 * dpr, ar = fr.w / fr.h, W = view.width - 2 * pad, H = view.height - 2 * pad;
    let pw, ph, b; if (Vs.stack) { ph = Math.min((H - gap) / 2, W / ar); pw = ph * ar; const x = (view.width - pw) / 2, y = (view.height - 2 * ph - gap) / 2; b = [[x, y], [x, y + ph + gap]]; }
    else { pw = Math.min((W - gap) / 2, H * ar); ph = pw / ar; const x = (view.width - 2 * pw - gap) / 2, y = (view.height - ph) / 2; b = [[x, y], [x + pw + gap, y]]; }
    boxes = { pw, ph, sil: b[0], other: b[1] };
    const put = (c, at) => { ctx.save(); if (Vs.flip) { ctx.translate(at[0] + pw, at[1]); ctx.scale(-1, 1); } else ctx.translate(at[0], at[1]); ctx.drawImage(c, 0, 0, pw, ph); ctx.restore(); };
    ctx.imageSmoothingQuality = 'high'; put(maskCanvas(R), b[0]); put(Vs.orig ? flat(fr.img, fr.img.width, fr.img.height) : grayCanvas(fr.img, fr.img.width, fr.img.height), b[1]);
    ctx.font = '700 ' + 11 * dpr + 'px system-ui'; ctx.textBaseline = 'top'; [['SILHOUETTE', b[0]], [Vs.orig ? 'ORIGINAL' : 'GRAYSCALE' + (Vs.levels ? ', ' + Vs.levels + ' values' : ''), b[1]]].forEach(([t, at]) => { const tw = ctx.measureText(t).width; ctx.fillStyle = 'rgba(22,21,26,.82)'; ctx.fillRect(at[0] + 6 * dpr, at[1] + 6 * dpr, tw + 12 * dpr, 19 * dpr); ctx.fillStyle = '#ff8fb8'; ctx.fillText(t, at[0] + 12 * dpr, at[1] + 10 * dpr); });
    const kind = { alpha: 'transparent background', tone: 'painted or toned, darker than ' + R.thr, lines: 'line art, ' + R.patches + ' patches of paper' }[R.mode];
    let t = fr.name + '   (' + (Vs.cur + 1) + ' of ' + Vs.frames.length + ')\n' + kind + '\nblack covers ' + R.coverage.toFixed(1) + '% of the frame';
    if (R.separation != null) t += '\nfigure ' + R.figure.toFixed(0) + ', background ' + R.background.toFixed(0) + ' (0 black, 100 white)\napart by ' + R.separation.toFixed(0) + ': ' + (R.separation >= 30 ? 'reads clearly' : R.separation < 15 ? 'close in value, look here' : 'separates, but not by much');
    if (R.mode === 'lines' && R.cut_by_frame) t += '\n' + R.cut_by_frame + ' patch' + (R.cut_by_frame === 1 ? '' : 'es') + ' on the frame edge filled as cut off bodies';
    if (fr.marks.length) t += '\nyour clicks, for value_check.py:\n' + fr.marks.map(m => '--' + m.set + ' ' + Math.round(m.x * fr.w) + ',' + Math.round(m.y * fr.h)).join(' ');
    $('#vReadout').textContent = t;
  }
  function sync() {
    const fr = Vs.frames[Vs.cur]; R = fr ? work(fr) : null;
    const m = R ? R.mode : Vs.mode; $('#vGapRow').style.display = $('#vEdgeRow').style.display = (m === 'lines' || m === 'auto') ? '' : 'none'; $('#vThrRow').style.display = $('#vThrAutoRow').style.display = m === 'tone' ? '' : 'none';
    $('#vGap').nextElementSibling.textContent = Vs.gap; if (R && R.mode === 'tone' && Vs.thrAuto) { Vs.thr = R.thr; $('#vThr').value = R.thr; } $('#vThr').nextElementSibling.textContent = Vs.thr;
    $('#vInfo').textContent = fr ? Vs.frames.length + ' frame' + (Vs.frames.length === 1 ? '' : 's') + ', ' + fr.w + ' x ' + fr.h : 'Pick one frame or several. Arrow keys step through them.';
    if (active()) draw();
  }
  // a click on the silhouette flips the patch of paper under it
  function click(nx, ny) {
    const fr = Vs.frames[Vs.cur]; if (!fr || !R || R.mode !== 'lines') return false;
    const L = ValueMath.labelAt(R.labels, R.w, R.h, nx * R.w, ny * R.h); if (!L) return false;
    const wasOut = R.out.has(L); fr.marks = fr.marks.filter(m => ValueMath.labelAt(R.labels, R.w, R.h, m.x * R.w, m.y * R.h) !== L);
    if (R.auto.has(L) === wasOut) fr.marks.push({ x: nx, y: ny, set: wasOut ? 'fill' : 'clear' });      // only remember it when it differs from the automatic answer
    sync(); return true;
  }
  view.addEventListener('pointerdown', e => { if (!boxes) return; const r = view.getBoundingClientRect(), k = view.width / r.width, mx = (e.clientX - r.left) * k, my = (e.clientY - r.top) * k;
    for (const at of [boxes.sil, boxes.other]) { let nx = (mx - at[0]) / boxes.pw, ny = (my - at[1]) / boxes.ph; if (nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1) { if (Vs.flip) nx = 1 - nx; click(nx, ny); return; } } });

  // ---------- exports (worked out again from the file at full size)
  async function exportCanvas(only) {
    const fr = Vs.frames[Vs.cur]; if (!fr) return null; const bmp = await fileBitmap(fr.file), W = bmp.width, H = bmp.height, sil = maskCanvas(R, W, H);
    if (only) return sil; const g2 = grayCanvas(bmp, W, H), gapx = Math.max(8, Math.floor(W / 200)), c = document.createElement('canvas'); c.width = W * 2 + gapx; c.height = H;
    const g = c.getContext('2d'); g.fillStyle = '#ff78aa'; g.fillRect(0, 0, c.width, H); g.drawImage(sil, 0, 0); g.drawImage(g2, W + gapx, 0); return c;
  }
  const stem = () => Vs.frames[Vs.cur].name.replace(/\.[^.]+$/, '');
  $('#vPng').onclick = async () => { const c = await exportCanvas(false); if (c) c.toBlob(b => { download(b, stem() + '_value.png'); $('#vExportInfo').textContent = 'Saved ' + c.width + ' x ' + c.height + ' px.'; }); };
  $('#vSil').onclick = async () => { const c = await exportCanvas(true); if (c) c.toBlob(b => { download(b, stem() + '_silhouette.png'); $('#vExportInfo').textContent = 'Saved ' + c.width + ' x ' + c.height + ' px.'; }); };

  // ---------- controls
  const go = d => { if (Vs.frames.length) { Vs.cur = AT.clamp(Vs.cur + d, 0, Vs.frames.length - 1); sync(); } };
  $('#vLoadBtn').onclick = () => $('#vFiles').click(); $('#vFiles').onchange = e => { loadFiles(e.target.files); e.target.value = ''; };
  $('#vStage').addEventListener('dragover', e => e.preventDefault()); $('#vStage').addEventListener('drop', e => { e.preventDefault(); loadFiles(e.dataTransfer.files); });
  $('#vPrev').onclick = () => go(-1); $('#vNext').onclick = () => go(1);
  $('#vMode').onchange = e => { Vs.mode = e.target.value; sync(); };
  $('#vGap').oninput = e => { Vs.gap = +e.target.value; sync(); };
  $('#vThr').oninput = e => { Vs.thr = +e.target.value; Vs.thrAuto = false; $('#vThrAuto').checked = false; sync(); };
  $('#vThrAuto').onchange = e => { Vs.thrAuto = e.target.checked; sync(); };
  $('#vEdge').onchange = e => { Vs.edge = e.target.checked; sync(); };
  $('#vReset').onclick = () => { const fr = Vs.frames[Vs.cur]; if (fr) { fr.marks = []; sync(); } };
  $('#vLevels').onchange = e => { Vs.levels = +e.target.value; sync(); };
  $('#vStack').onchange = e => { Vs.stack = e.target.checked; sync(); }; $('#vFlip').onchange = e => { Vs.flip = e.target.checked; sync(); }; $('#vOrig').onchange = e => { Vs.orig = e.target.checked; sync(); };
  window.addEventListener('keydown', e => { if (!active() || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return; if (e.key === 'ArrowRight') { e.preventDefault(); go(1); } else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); } else if (e.key === 'f' || e.key === 'F') { Vs.flip = !Vs.flip; $('#vFlip').checked = Vs.flip; sync(); } });
  window.addEventListener('resize', () => { if (active()) draw(); });
  sync();
  return { Vs, loadFiles, work, result: () => R, click, sync, exportCanvas, boxes: () => boxes };
})();
