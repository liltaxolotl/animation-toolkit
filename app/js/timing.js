// ============================== TIMING MODE ==============================
const Timing = (() => {
  const T = { frames: [], fps: 24, cur: 0, playing: false, loop: true, onion: { on: true, before: 1, after: 1, strength: 45 },
              audio: { buf: null, name: '', offset: 0, levels: [], accents: [], peaks: null }, ppf: 0, scroll: 0, scrub: true };
  const MARK = { K: '#ff5560', B: '#4d8dff', I: '#2fbf71' }, MARKNAME = { K: 'KEY', B: 'BREAKDOWN', I: 'INBETWEEN' };
  const view = $('#tView'), vctx = view.getContext('2d'), line = $('#tLine'), lctx = line.getContext('2d'), chart = $('#tChart');
  const active = () => $('#mode-timing').classList.contains('on');
  let actx = null, playing = null, travel = [];

  // ---------- timeline helpers: every drawing holds for `hold` frames
  const starts = () => { const s = []; let f = 0; for (const fr of T.frames) { s.push(f); f += fr.hold; } return s; };
  const total = () => T.frames.reduce((a, f) => a + f.hold, 0);
  const lengthFrames = () => Math.max(total(), T.audio.buf ? Math.ceil(T.audio.buf.duration * T.fps) + T.audio.offset : 0);
  function drawingAt(f) { let acc = 0; for (let i = 0; i < T.frames.length; i++) { acc += T.frames[i].hold; if (f < acc) return i; } return T.frames.length - 1; }
  const curDrawing = () => T.frames.length ? drawingAt(Math.min(T.cur, total() - 1)) : -1;

  // ---------- loading
  const natural = s => (s.match(/\d+/g) || ['0']).map(Number);
  function cmpName(a, b) { const x = natural(a.name), y = natural(b.name); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return a.name.localeCompare(b.name); }
  async function loadFiles(list) {
    const files = [...list].filter(f => PICS.test(f.name)).sort(cmpName);
    if (!files.length) return;
    stop(); T.frames = []; T.cur = 0; $('#tInfo').textContent = 'Loading ' + files.length + ' frames...';
    for (const f of files) {
      const bmp = await fileBitmap(f), k = Math.min(1, 1600 / bmp.width);
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
      T.frames.push({ name: f.name, img: c, w: bmp.width, h: bmp.height, hold: 2, mark: '', tint: {}, ink: inkOf(c) }); bmp.close && bmp.close();
    }
    measure(); T.ppf = 0; T.scroll = 0;
    $('#tInfo').textContent = T.frames.length + ' drawings, ' + T.frames[0].w + ' x ' + T.frames[0].h; sync();
  }
  // where the ink is, on a small copy (for measuring how far things move)
  function inkOf(c) {
    const w = 240, h = Math.max(1, Math.round(c.height * w / c.width)), s = document.createElement('canvas'); s.width = w; s.height = h;
    const g = s.getContext('2d', { willReadFrequently: true }); g.drawImage(c, 0, 0, w, h); const d = g.getImageData(0, 0, w, h).data, m = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < m.length; i++, p += 4) m[i] = (d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114) < 140 ? 1 : 0;
    return { m, w, h };
  }
  // travel[i] = how far the lines move between drawing i and i+1 (in full-size pixels): the middle of the ink
  // that left its place, to the middle of the ink that arrived
  function measure() {
    travel = [];
    for (let i = 0; i < T.frames.length - 1; i++) {
      const a = T.frames[i].ink, b = T.frames[i + 1].ink, w = a.w, h = a.h;
      if (b.w !== w || b.h !== h) { travel.push(0); continue; }
      const near = (m, x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h && m[Y * w + X]) return true; } return false; };
      let ax = 0, ay = 0, an = 0, bx = 0, by = 0, bn = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const k = y * w + x; if (a.m[k] && !near(b.m, x, y)) { ax += x; ay += y; an++; } if (b.m[k] && !near(a.m, x, y)) { bx += x; by += y; bn++; } }
      travel.push(an > 6 && bn > 6 ? Math.hypot(bx / bn - ax / an, by / bn - ay / an) * T.frames[i].w / w : 0);
    }
  }

  // ---------- viewer
  function tinted(fr, col) {                   // black lines -> colour, white paper stays white
    if (fr.tint[col]) return fr.tint[col];
    const c = document.createElement('canvas'); c.width = fr.img.width; c.height = fr.img.height; const g = c.getContext('2d');
    g.drawImage(fr.img, 0, 0); g.globalCompositeOperation = 'screen'; g.fillStyle = col; g.fillRect(0, 0, c.width, c.height);
    return fr.tint[col] = c;
  }
  function fitCanvas(c) { const dpr = window.devicePixelRatio || 1, r = c.parentElement.getBoundingClientRect(), w = Math.round(r.width * dpr), h = Math.round(r.height * dpr); if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } return dpr; }
  function drawView() {
    const dpr = fitCanvas(view); vctx.setTransform(1, 0, 0, 1, 0, 0); vctx.fillStyle = '#0e0d11'; vctx.fillRect(0, 0, view.width, view.height);
    const i = curDrawing(); if (i < 0) { vctx.fillStyle = '#a6a1b4'; vctx.font = 16 * dpr + 'px system-ui'; vctx.textAlign = 'center'; vctx.fillText('Load a frame sequence to start', view.width / 2, view.height / 2); vctx.textAlign = 'left'; $('#tReadout').textContent = ''; return; }
    const fr = T.frames[i], s = Math.min((view.width - 30 * dpr) / fr.img.width, (view.height - 30 * dpr) / fr.img.height), w = fr.img.width * s, h = fr.img.height * s, x = (view.width - w) / 2, y = (view.height - h) / 2;
    vctx.fillStyle = '#fff'; vctx.fillRect(x, y, w, h);
    if (T.onion.on && !T.playing) {
      vctx.globalCompositeOperation = 'multiply';
      for (let k = T.onion.before; k >= 1; k--) if (T.frames[i - k]) { vctx.globalAlpha = T.onion.strength / 100 / k; vctx.drawImage(tinted(T.frames[i - k], '#e8663c'), x, y, w, h); }
      for (let k = T.onion.after; k >= 1; k--) if (T.frames[i + k]) { vctx.globalAlpha = T.onion.strength / 100 / k; vctx.drawImage(tinted(T.frames[i + k], '#2f9e6e'), x, y, w, h); }
      vctx.globalAlpha = 1;
    }
    vctx.globalCompositeOperation = 'multiply'; vctx.drawImage(fr.img, x, y, w, h); vctx.globalCompositeOperation = 'source-over';
    const st = starts()[i];
    $('#tReadout').textContent = 'Drawing ' + (i + 1) + ' of ' + T.frames.length + (fr.mark ? '  ' + MARKNAME[fr.mark] : '') + '\n' + fr.name + '\nframe ' + (T.cur + 1) + ' of ' + lengthFrames() + '   ' + (T.cur / T.fps).toFixed(2) + ' s\nholds ' + fr.hold + (fr.hold === 1 ? ' frame (on 1s)' : ' frames (on ' + fr.hold + 's)');
    $('#tHold').textContent = fr.hold; $('#tPos').textContent = 'Shot length: ' + total() + ' frames, ' + (total() / T.fps).toFixed(2) + ' s';
  }

  // ---------- timeline strip: ruler, drawings, waveform, spacing
  const ROW = { ruler: 22, draw: 96, wave: 78, space: 70 };
  function drawLine() {
    const dpr = fitCanvas(line), W = line.width / dpr, H = line.height / dpr; lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    lctx.fillStyle = '#16151a'; lctx.fillRect(0, 0, W, H); const n = lengthFrames(); if (!n) return;
    if (!T.ppf) T.ppf = Math.max(8, Math.min(40, (W - 20) / n));
    const ppf = T.ppf; T.scroll = AT.clamp(T.scroll, 0, Math.max(0, n * ppf - W + 20)); const X = f => 10 + f * ppf - T.scroll;
    lctx.font = '11px system-ui'; lctx.textBaseline = 'middle';
    for (let f = 0; f <= n; f++) {                // ruler: a tick per frame, a label every second and every few frames
      const x = X(f); if (x < -20 || x > W + 20) continue; const sec = f % T.fps === 0;
      lctx.strokeStyle = sec ? '#a6a1b4' : '#3b3846'; lctx.beginPath(); lctx.moveTo(x, sec ? 2 : 12); lctx.lineTo(x, ROW.ruler); lctx.stroke();
      if (sec || (ppf > 14 && f % 4 === 0) || ppf > 30) { lctx.fillStyle = sec ? '#eeebf3' : '#7d788c'; lctx.fillText(sec ? (f / T.fps) + 's' : String(f + 1), x + 3, 8); }
    }
    let y = ROW.ruler; const st = starts(), cur = curDrawing();
    T.frames.forEach((fr, i) => {
      const x0 = X(st[i]), w = fr.hold * ppf; if (x0 > W || x0 + w < 0) return;
      lctx.fillStyle = '#fff'; lctx.fillRect(x0 + 1, y + 1, w - 2, ROW.draw - 2);
      const th = ROW.draw - 22, tw = th * fr.img.width / fr.img.height;
      lctx.save(); lctx.beginPath(); lctx.rect(x0 + 1, y + 1, w - 2, ROW.draw - 2); lctx.clip();
      lctx.drawImage(fr.img, x0 + Math.max(1, (w - tw) / 2), y + 20, tw, th); lctx.restore();
      lctx.fillStyle = fr.mark ? MARK[fr.mark] : '#2a2832'; lctx.fillRect(x0 + 1, y + 1, w - 2, 18);
      lctx.fillStyle = fr.mark ? '#16151a' : '#eeebf3'; lctx.font = '700 11px system-ui'; lctx.fillText((i + 1) + (fr.mark ? ' ' + fr.mark : ''), x0 + 5, y + 10);
      for (let k = 1; k < fr.hold; k++) { lctx.strokeStyle = 'rgba(0,0,0,.18)'; lctx.beginPath(); lctx.moveTo(x0 + k * ppf, y + 20); lctx.lineTo(x0 + k * ppf, y + ROW.draw - 1); lctx.stroke(); }
      if (i === cur) { lctx.strokeStyle = '#ff8fb8'; lctx.lineWidth = 2.5; lctx.strokeRect(x0 + 1.5, y + 1.5, w - 3, ROW.draw - 3); lctx.lineWidth = 1; }
    });
    y += ROW.draw + 4;
    // waveform, lined up with the frames
    lctx.fillStyle = '#201e26'; lctx.fillRect(0, y, W, ROW.wave); const A = T.audio;
    if (A.buf) {
      const mid = y + ROW.wave / 2, pk = A.peaks, per = pk.length / (A.buf.duration * T.fps);   // peaks per frame
      lctx.fillStyle = '#7fd6c8';
      for (let px = Math.max(0, Math.floor(X(A.offset))); px < W; px++) { const f = (px + T.scroll - 10) / ppf - A.offset, a = Math.floor(f * per), b = Math.max(a + 1, Math.floor((f + 1 / ppf) * per)); if (a >= pk.length) break; if (a < 0) continue; let v = 0; for (let k = a; k < b && k < pk.length; k++) v = Math.max(v, pk[k]); const hh = Math.max(1, v * (ROW.wave - 10)); lctx.fillRect(px, mid - hh / 2, 1, hh); }
      lctx.fillStyle = '#ffa23a';
      for (const f of A.accents) { const x = X(f + A.offset); lctx.beginPath(); lctx.moveTo(x, y + 1); lctx.lineTo(x + 5, y + 9); lctx.lineTo(x - 5, y + 9); lctx.fill(); lctx.fillRect(x - 0.5, y + 9, 1, ROW.wave - 10); }
      lctx.fillStyle = '#a6a1b4'; lctx.font = '11px system-ui'; lctx.fillText(A.name, 8, y + ROW.wave - 8);
    } else { lctx.fillStyle = '#6f6a7d'; lctx.font = '12px system-ui'; lctx.fillText('No sound loaded', 10, y + ROW.wave / 2); }
    for (let f = 0; f <= n; f += T.fps) { lctx.strokeStyle = 'rgba(255,255,255,.14)'; lctx.beginPath(); lctx.moveTo(X(f), y); lctx.lineTo(X(f), y + ROW.wave); lctx.stroke(); }
    y += ROW.wave + 4;
    // spacing: how far the lines move going into each drawing
    const mx = Math.max(1, ...travel); lctx.fillStyle = '#6f6a7d'; lctx.font = '11px system-ui'; lctx.fillText('spacing (px moved)', 8, y + 8);
    travel.forEach((v, i) => { const x0 = X(st[i + 1]), hh = (ROW.space - 22) * v / mx; lctx.fillStyle = i + 1 === cur ? '#ff8fb8' : '#8f8aa3'; lctx.fillRect(x0 + 2, y + ROW.space - 4 - hh, Math.max(3, Math.min(ppf * T.frames[i + 1].hold - 4, 26)), hh); if (ppf * T.frames[i + 1].hold > 26) { lctx.fillStyle = '#a6a1b4'; lctx.fillText(Math.round(v), x0 + 2, y + ROW.space - 10 - hh); } });
    // playhead
    const px = X(T.cur) + ppf / 2; lctx.strokeStyle = '#ff8fb8'; lctx.lineWidth = 2; lctx.beginPath(); lctx.moveTo(px, 0); lctx.lineTo(px, H); lctx.stroke(); lctx.lineWidth = 1;
  }

  // ---------- classic timing chart for the key-to-key stretch around the current drawing
  function drawChart() {
    const c = chart.getContext('2d'), W = chart.width, H = chart.height; c.fillStyle = '#fff'; c.fillRect(0, 0, W, H); const n = T.frames.length;
    if (n < 2) { c.fillStyle = '#888'; c.font = '26px system-ui'; c.fillText('Load frames to see it', 30, 60); return; }
    const cur = curDrawing(); let a = 0, b = n - 1;
    for (let i = cur; i >= 0; i--) if (T.frames[i].mark === 'K') { a = i; break; }
    for (let i = Math.max(cur, a + 1); i < n; i++) if (T.frames[i].mark === 'K') { b = i; break; }
    if (b <= a) b = Math.min(n - 1, a + 1);
    let cum = [0]; for (let i = a; i < b; i++) cum.push(cum[cum.length - 1] + (travel[i] || 0));
    const tot = cum[cum.length - 1], even = tot < 1, x = 220, top = 60, bot = H - 60;
    c.strokeStyle = '#222'; c.lineWidth = 4; c.beginPath(); c.moveTo(x, top); c.lineTo(x, bot); c.stroke();
    let lastY = -99, side = 1;
    for (let i = a; i <= b; i++) {
      const t = even ? (i - a) / (b - a) : cum[i - a] / tot, y = top + t * (bot - top), fr = T.frames[i], end = i === a || i === b, len = end ? 54 : fr.mark === 'B' ? 40 : 26;
      side = (y - lastY < 34 && side === 1) ? -1 : 1; lastY = y;          // crowded ticks take turns left and right so the numbers stay readable
      c.strokeStyle = i === cur ? '#e0407c' : '#222'; c.lineWidth = end ? 5 : 3; c.beginPath(); c.moveTo(x - len, y); c.lineTo(x + len, y); c.stroke();
      c.fillStyle = i === cur ? '#e0407c' : '#222'; c.font = (end ? '700 34px' : '28px') + ' system-ui'; c.textBaseline = 'middle'; const lbl = String(i + 1), tw = c.measureText(lbl).width, lx = side === 1 ? x + 76 : x - 76 - tw; c.fillText(lbl, lx, y);
      if (fr.mark === 'K' || end) { c.lineWidth = 3; c.strokeStyle = MARK.K; c.beginPath(); c.arc(lx + tw / 2, y, 26, 0, 7); c.stroke(); }
      else if (fr.mark === 'B') { c.lineWidth = 3; c.strokeStyle = MARK.B; c.beginPath(); c.moveTo(lx - 4, y + 20); c.lineTo(lx + 4 + tw, y + 20); c.stroke(); }
      if (fr.hold > 1 && side === 1) { c.fillStyle = '#999'; c.font = '22px system-ui'; c.fillText('x' + fr.hold, x + 150, y); }
    }
    c.fillStyle = '#666'; c.font = '22px system-ui'; c.textBaseline = 'alphabetic';
    c.fillText(even ? 'even spacing (no movement measured)' : 'close ticks = slow, wide gaps = fast', 20, H - 16);
  }

  // ---------- playback + sound
  function audioCtx() { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); return actx; }
  function playSound(fromFrame, frames) {
    const A = T.audio; if (!A.buf) return null; const ctx = audioCtx(); if (ctx.state === 'suspended') ctx.resume();
    const src = ctx.createBufferSource(); src.buffer = A.buf; src.connect(ctx.destination);
    const t = (fromFrame - A.offset) / T.fps, dur = frames ? frames / T.fps : undefined;
    if (t >= A.buf.duration) return null;
    if (t >= 0) src.start(0, t, dur); else src.start(ctx.currentTime - t, 0, dur);
    return src;
  }
  function play() {
    if (!T.frames.length) return; const n = lengthFrames(); if (T.cur >= n - 1) T.cur = 0;
    T.playing = true; const f0 = T.cur, t0 = performance.now(); let snd = playSound(f0);
    $('#tPlay').textContent = 'Pause';
    const tick = now => {
      if (!T.playing) return; let f = f0 + Math.floor((now - t0) * T.fps / 1000);
      if (f >= n) { if (T.loop) { if (snd) try { snd.stop(); } catch (e) {} T.playing = false; T.cur = 0; play(); return; } T.cur = n - 1; stop(); return; }
      if (f !== T.cur) { T.cur = f; follow(); drawView(); drawLine(); drawChart(); }
      playing = requestAnimationFrame(tick);
    };
    playing = requestAnimationFrame(tick); play.snd = snd; drawView();
  }
  function stop() { T.playing = false; cancelAnimationFrame(playing); if (play.snd) { try { play.snd.stop(); } catch (e) {} play.snd = null; } $('#tPlay').textContent = 'Play'; sync(); }
  function follow() { const W = line.width / (window.devicePixelRatio || 1), x = 10 + T.cur * T.ppf - T.scroll; if (x > W - 60) T.scroll += x - W + 200; if (x < 40) T.scroll = Math.max(0, T.scroll + x - 200); }
  function goFrame(f, quiet) { T.cur = AT.clamp(Math.round(f), 0, Math.max(0, lengthFrames() - 1)); follow(); if (!quiet && T.scrub && !T.playing) playSound(T.cur, 1); sync(); }
  function goDrawing(d) { if (!T.frames.length) return; const i = AT.clamp(curDrawing() + d, 0, T.frames.length - 1); goFrame(starts()[i]); }
  async function loadAudio(file) {
    $('#tAudioInfo').textContent = 'Reading ' + file.name + '...';
    try {
      const buf = await audioCtx().decodeAudioData(await file.arrayBuffer()); setAudio(buf, file.name);
    } catch (e) { $('#tAudioInfo').textContent = 'Could not read that audio file (' + e.message + ').'; }
  }
  function setAudio(buf, name) {
    const A = T.audio; A.buf = buf; A.name = name; const ch = buf.numberOfChannels, n = buf.length, slots = Math.ceil(buf.duration * T.fps * 8), pk = new Float32Array(slots), per = n / slots;
    const data = []; for (let c = 0; c < ch; c++) data.push(buf.getChannelData(c));
    let mx = 1e-6; for (let s = 0; s < slots; s++) { let v = 0; const a = Math.floor(s * per), b = Math.min(n, Math.floor((s + 1) * per)); for (let i = a; i < b; i += 2) { let x = 0; for (let c = 0; c < ch; c++) x += Math.abs(data[c][i]); x /= ch; if (x > v) v = x; } pk[s] = v; if (v > mx) mx = v; }
    for (let s = 0; s < slots; s++) pk[s] /= mx; A.peaks = pk; analyseAudio();
    $('#tAudioInfo').textContent = name + ': ' + buf.duration.toFixed(2) + ' s, ' + A.accents.length + ' accents marked'; sync();
  }
  // loudness per frame, and accents = frames where the sound jumps up (a hit, a hard consonant, a beat)
  function analyseAudio() {
    const A = T.audio; if (!A.buf) return; const nf = Math.ceil(A.buf.duration * T.fps), per = A.peaks.length / nf; A.levels = []; A.accents = [];
    for (let f = 0; f < nf; f++) { let v = 0; for (let k = Math.floor(f * per); k < Math.floor((f + 1) * per) && k < A.peaks.length; k++) v = Math.max(v, A.peaks[k]); A.levels.push(v); }
    let last = -99;
    for (let f = 0; f < nf; f++) { const prev = Math.max(A.levels[f - 1] || 0, A.levels[f - 2] || 0, A.levels[f - 3] || 0) ; if (A.levels[f] > 0.3 && A.levels[f] > prev * 1.7 + 0.08 && f - last > 2) { A.accents.push(f); last = f; } }
  }

  // ---------- exports
  function xsheet() {
    const st = starts(), n = lengthFrames(), A = T.audio, rows = [['frame', 'time_s', 'drawing', 'file', 'type', 'hold', 'sound_level', 'accent']];
    for (let f = 0; f < n; f++) {
      const inShot = f < total(), i = inShot ? drawingAt(f) : -1, first = inShot && st[i] === f, fr = inShot ? T.frames[i] : null, af = f - A.offset;
      const lvl = A.buf && af >= 0 && af < A.levels.length ? Math.round(A.levels[af] * 9) : '';
      rows.push([f + 1, (f / T.fps).toFixed(3), inShot ? (first ? i + 1 : '|') : '', first ? fr.name : '', first && fr.mark ? MARKNAME[fr.mark] : '', first ? fr.hold : '', lvl, A.buf && A.accents.includes(af) ? '*' : '']);
    }
    return rows.map(r => r.map(v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v).join(',')).join('\r\n') + '\r\n';
  }
  function gifBytes(width) {
    const f0 = T.frames[0], w = Math.min(width, f0.img.width), h = Math.round(f0.img.height * w / f0.img.width), c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true }), frames = []; let t = 0;
    for (const fr of T.frames) {                 // one GIF frame per drawing; its delay carries the hold. Rounding is carried forward so the total length stays right.
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(fr.img, 0, 0, w, h);
      const a = Math.round(t * 100 / T.fps), b = Math.round((t + fr.hold) * 100 / T.fps); t += fr.hold;
      frames.push({ data: GifWriter.index(g.getImageData(0, 0, w, h).data), delay: Math.max(1, b - a) });
    }
    return GifWriter.encode(w, h, frames, true);
  }
  const base = () => (T.frames[0] ? T.frames[0].name.replace(/\.[^.]+$/, '').replace(/[\s_-]*\d+$/, '') || 'shot' : 'shot');
  $('#tCsv').onclick = () => { if (!T.frames.length) return; download(new Blob([xsheet()], { type: 'text/csv' }), base() + '_xsheet.csv'); };
  $('#tGif').onclick = () => { if (!T.frames.length) return; $('#tExportInfo').textContent = 'Building GIF...'; setTimeout(() => { const b = gifBytes(+$('#tGifW').value); download(new Blob([b], { type: 'image/gif' }), base() + '_preview.gif'); $('#tExportInfo').textContent = 'GIF saved: ' + (b.length / 1024).toFixed(0) + ' KB. Browsers play GIFs at 1/100 s steps, so it runs within 1 frame of true speed.'; }, 30); };

  // ---------- controls
  function sync() {
    const i = curDrawing(), fr = T.frames[i];
    $$('[data-mark]').forEach(b => b.classList.toggle('on', !!fr && b.dataset.mark !== '' && fr.mark === b.dataset.mark));
    $('#tBefore').nextElementSibling.textContent = T.onion.before; $('#tAfter').nextElementSibling.textContent = T.onion.after; $('#tStrength').nextElementSibling.textContent = T.onion.strength + '%';
    if (active()) { drawView(); drawLine(); drawChart(); }
  }
  $('#tLoadBtn').onclick = () => $('#tFiles').click(); $('#tFolderBtn').onclick = () => $('#tFolder').click();
  $('#tFiles').onchange = e => { loadFiles(e.target.files); e.target.value = ''; }; $('#tFolder').onchange = e => { loadFiles(e.target.files); e.target.value = ''; };
  $('#tStage').addEventListener('dragover', e => e.preventDefault());
  $('#tStage').addEventListener('drop', e => { e.preventDefault(); const fs = [...e.dataTransfer.files], au = fs.find(f => /^audio|\.(wav|mp3|m4a|ogg|flac)$/i.test(f.type + f.name)); if (au) loadAudio(au); if (fs.some(f => /^image/.test(f.type) || isPsd(f))) loadFiles(fs); });
  $('#tPlay').onclick = () => T.playing ? stop() : play();
  $('#tLoop').onchange = e => T.loop = e.target.checked;
  $('#tFps').onchange = e => { T.fps = +e.target.value; analyseAudio(); T.ppf = 0; sync(); };
  $$('[data-on]').forEach(b => b.onclick = () => { const d = curDrawing(); T.frames.forEach(f => f.hold = +b.dataset.on); if (d >= 0) T.cur = starts()[d]; T.ppf = 0; sync(); });
  const hold = d => { const i = curDrawing(); if (i < 0) return; T.frames[i].hold = AT.clamp(T.frames[i].hold + d, 1, 48); T.cur = starts()[i]; sync(); };
  $('#tHoldDn').onclick = () => hold(-1); $('#tHoldUp').onclick = () => hold(1);
  $('#tOnion').onchange = e => { T.onion.on = e.target.checked; sync(); };
  $('#tBefore').oninput = e => { T.onion.before = +e.target.value; sync(); }; $('#tAfter').oninput = e => { T.onion.after = +e.target.value; sync(); }; $('#tStrength').oninput = e => { T.onion.strength = +e.target.value; sync(); };
  const mark = m => { const i = curDrawing(); if (i < 0) return; T.frames[i].mark = T.frames[i].mark === m ? '' : m; sync(); };
  $$('[data-mark]').forEach(b => b.onclick = () => mark(b.dataset.mark));
  $('#tAudioBtn').onclick = () => $('#tAudio').click(); $('#tAudio').onchange = e => { if (e.target.files[0]) loadAudio(e.target.files[0]); e.target.value = ''; };
  $('#tAudioClear').onclick = () => { T.audio.buf = null; T.audio.accents = []; T.audio.levels = []; $('#tAudioInfo').textContent = 'No sound loaded.'; sync(); };
  $('#tOffset').oninput = e => { T.audio.offset = Math.max(0, (+e.target.value || 1) - 1); sync(); };
  $('#tScrub').onchange = e => T.scrub = e.target.checked;
  let scrubbing = false; const lf = e => { const r = line.getBoundingClientRect(); return Math.floor((e.clientX - r.left - 10 + T.scroll) / T.ppf); };
  line.addEventListener('pointerdown', e => { line.setPointerCapture(e.pointerId); scrubbing = true; if (T.playing) stop(); goFrame(lf(e)); });
  line.addEventListener('pointermove', e => { if (scrubbing) { const f = lf(e); if (f !== T.cur) goFrame(f); } });
  line.addEventListener('pointerup', () => scrubbing = false);
  line.addEventListener('wheel', e => { e.preventDefault(); if (e.ctrlKey) { T.ppf = AT.clamp(T.ppf * Math.exp(-e.deltaY * 0.002), 3, 80); } else T.scroll += e.deltaY + e.deltaX; sync(); }, { passive: false });
  window.addEventListener('keydown', e => {
    if (!active() || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return; const k = e.key;
    if (e.code === 'Space') { e.preventDefault(); T.playing ? stop() : play(); }
    else if (k === 'ArrowRight') { e.preventDefault(); e.shiftKey ? goFrame(T.cur + 1) : goDrawing(1); } else if (k === 'ArrowLeft') { e.preventDefault(); e.shiftKey ? goFrame(T.cur - 1) : goDrawing(-1); }
    else if (k === 'k' || k === 'K') mark('K'); else if (k === 'b' || k === 'B') mark('B'); else if (k === 'i' || k === 'I') mark('I');
    else if (k === ']') hold(1); else if (k === '[') hold(-1); else if (k === 'o' || k === 'O') { T.onion.on = !T.onion.on; $('#tOnion').checked = T.onion.on; sync(); }
  });
  window.addEventListener('resize', () => { if (active()) { T.ppf = 0; sync(); } });
  sync();
  return { T, loadFiles, loadAudio, setAudio, xsheet, gifBytes, play, stop, goFrame, goDrawing, travel: () => travel, starts, total, lengthFrames, curDrawing, sync };
})();
