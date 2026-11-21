// ============================== PERSPECTIVE MODE ==============================
const Persp = (() => {
  const COL = { A: '#2f7bff', B: '#e24bb5', V: '#1faa5c' }, NAME = { A: 'Depth', B: 'Side', V: 'Upright' };
  const PCOL = ['#005adc', '#c8008c', '#e67800', '#009696', '#783cc8', '#966e00'];
  const S = {
    W: 3840, H: 1920, boardOp: 55, boardName: 'board',
    cam: { yaw: 0, pitch: 0, roll: 0, fov: 60, fish: 0, skew: 0, height: 5 },
    useLines: true, solveLens: true, snap: true, solid: false,
    lines: [], props: [], figure: null, poles: [], fig3d: { on: false, turn: 0 },
    guide: { horizon: true, vps: true, grid: true, rays: true, walls: false, props: true, lines: false, tile: 1, extent: 12, weight: 1 }
  };
  const UI = { tool: 'A', sel: null, view: { s: 0.3, x: 0, y: 0 }, drag: null, space: false, note: '', found: null, check: false, drift: null, boards: [], bi: 0, hover: null, seq: null };
  let board = null, D = { cam: null, vp: {}, locked: {}, notes: [], solved: false }, undo = [], pid = 1;
  const cv = $('#pCanvas'), ctx = cv.getContext('2d'), stage = $('#pStage');
  const kOf = () => 1 - (S.cam.fish / 100) * 0.98;
  const BA = BeforeAfter(stage, () => draw());
  const LAYERS = [['horizon', 'Horizon', '#e61e28'], ['vps', 'Vanishing points', '#2f7bff'], ['grid', 'Floor grid', '#787878'], ['rays', 'Depth lines', '#286ee6'],
    ['walls', 'Uprights (walls)', '#1faa5c'], ['props', 'Props', '#e67800'], ['height', 'Character height', '#e24bb5'], ['drift', 'Drift check', '#ff7a1a'], ['figure3d', '3D figure', '#8a5cf6'], ['lines', 'My drawn lines (in the export)', '#2f7bff']];
  const DEFAULT_ON = { height: true, drift: true, figure3d: true };

  // ---------- state
  const snapshot = () => JSON.stringify({ cam: S.cam, lines: S.lines, props: S.props, figure: S.figure, poles: S.poles }, (k, v) => k === '_px' ? undefined : v);
  function pushUndo() { undo.push(snapshot()); if (undo.length > 60) undo.shift(); }
  function doUndo() { if (!undo.length) return; const o = JSON.parse(undo.pop()); S.cam = o.cam; S.lines = o.lines; S.props = o.props; S.figure = o.figure || null; S.poles = o.poles || []; UI.sel = null; UI.note = ''; syncAll(); }
  function derive() {
    const grp = { A: [], B: [], V: [] }; S.lines.forEach(l => grp[l.g].push(l));
    D.vp = { A: AT.lsqPoint(grp.A), B: AT.lsqPoint(grp.B), V: AT.lsqPoint(grp.V) }; D.count = { A: grp.A.length, B: grp.B.length, V: grp.V.length };
    D.notes = []; D.locked = {}; D.solved = false; D.shift = null; let R = null;
    const o = { W: S.W, H: S.H, k: kOf(), skew: S.cam.skew, fov: S.cam.fov, roll: S.cam.roll, solveLens: S.solveLens };
    if (S.useLines && D.vp.A) {
      const r = AT.cameraFromVPs(D.vp.A, D.vp.B, D.vp.V, o); R = r.R; D.notes = r.notes; D.solved = r.solved; D.shift = r.shift;
      const a = AT.rToAngles(R); S.cam.yaw = a.yaw; S.cam.pitch = a.pitch; D.locked.yaw = D.locked.pitch = true;
      if (D.vp.B || D.vp.V) { S.cam.roll = a.roll; D.locked.roll = true; }
      if (r.solved) { S.cam.fov = r.fov; D.locked.fov = true; }
    }
    D.cam = AT.makeCamera({ pos: [0, S.cam.height, 0], R: R || undefined, yaw: S.cam.yaw, pitch: S.cam.pitch, roll: S.cam.roll, fov: S.cam.fov, k: o.k, skew: S.cam.skew, W: S.W, H: S.H, shift: D.shift });
  }

  // ---------- drawing (canvas pixel space; used for the screen and for the export)
  function strokePieces(c, pieces) { for (const seg of pieces) { c.beginPath(); c.moveTo(seg[0][0], seg[0][1]); for (let i = 1; i < seg.length; i++) c.lineTo(seg[i][0], seg[i][1]); c.stroke(); } }
  function line3(c, cam, pts, n) { strokePieces(c, AT.polyPieces(cam, pts, n)); }
  function drawGuide(c, cam, minPx) {
    const G = S.guide, lw = n => Math.max(minPx || 1, n * cam.W / 3840 * G.weight), A = k => { c.globalAlpha = ((G.op || {})[k] ?? 100) / 100; };
    c.lineJoin = c.lineCap = 'round';
    c.save();
    if (G.grid) { A('grid');
      c.strokeStyle = 'rgba(120,120,120,0.8)'; c.lineWidth = lw(4); const e = G.extent, t = G.tile;
      for (let x = -e; x <= e + 1e-6; x += t) line3(c, cam, [[x, 0, 0.25], [x, 0, 2*e]], 60);
      for (let z = t; z <= 2*e + 1e-6; z += t) line3(c, cam, [[-e, 0, z], [e, 0, z]], 40);
    }
    if (S.fig3d && S.fig3d.on && G.figure3d !== false) {   // the posed 3D figure, under the guide lines
      const im = c === ctx ? Persp3D.preview(cam, S) : Persp3D.render(cam, Persp3D.spot(S), S.fig3d.turn, S.W, S.H);
      if (im) { A('figure3d'); c.drawImage(im, 0, 0, S.W, S.H); }
    }
    if (G.rays) { A('rays');
      c.strokeStyle = 'rgba(40,110,230,0.6)'; c.lineWidth = lw(3);
      for (let i = 0; i < 24; i++) { const a = i / 24 * 2 * Math.PI, x = cam.C[0] + 4*Math.cos(a), y = cam.C[1] + 4*Math.sin(a); line3(c, cam, [[x, y, cam.C[2] + 1], [x, y, cam.C[2] + 400]], 80); }
    }
    if (G.horizon) { A('horizon');
      c.strokeStyle = 'rgba(230,30,40,1)'; c.lineWidth = lw(7); const f = cam.R[2], head = Math.atan2(f[0], f[2]), pts = [];
      for (let i = 0; i <= 200; i++) { const a = head - 1.55 + 3.1 * i / 200; pts.push([cam.C[0] + Math.sin(a)*1e5, cam.C[1], cam.C[2] + Math.cos(a)*1e5]); }
      line3(c, cam, pts, 1);
    }
    if (G.vps) { A('vps');
      const r = 26 * cam.W / 3840;
      for (const [axis, col] of [[[0,0,1], COL.A], [[1,0,0], COL.B], [[0,1,0], COL.V]]) {
        const vp = AT.vanishingPoint(cam, axis); if (!vp || Math.abs(vp[0]) > 40000 || Math.abs(vp[1]) > 40000) continue;
        c.strokeStyle = col; c.lineWidth = lw(7); c.beginPath(); c.arc(vp[0], vp[1], r, 0, 7); c.stroke();
        c.lineWidth = lw(4); c.beginPath(); c.moveTo(vp[0] - r*1.7, vp[1]); c.lineTo(vp[0] + r*1.7, vp[1]); c.moveTo(vp[0], vp[1] - r*1.7); c.lineTo(vp[0], vp[1] + r*1.7); c.stroke();
      }
    }
    if (G.walls) { A('walls');                    // uprights along the side walls and the back wall of the floor grid
      c.strokeStyle = 'rgba(31,170,92,0.75)'; c.lineWidth = lw(3); const e = G.extent, t = Math.max(G.tile, 1) * 2, hgt = 8;
      for (let z = t; z <= 2 * e + 1e-6; z += t) for (const x of [-e, e]) line3(c, cam, [[x, 0, z], [x, hgt, z]], 8);
      for (let x = -e + t; x < e - 1e-6; x += t) line3(c, cam, [[x, 0, 2 * e], [x, hgt, 2 * e]], 8);
      for (const x of [-e, e]) line3(c, cam, [[x, hgt, t], [x, hgt, 2 * e]], 40); line3(c, cam, [[-e, hgt, 2 * e], [e, hgt, 2 * e]], 40);
    }
    if (G.props) { A('props'); drawProps(c, cam, lw); }
    if (S.figure && G.height !== false) { A('height'); pole(c, cam, S.figure.x, S.figure.z, S.figure.h, '#e24bb5', lw); for (const q of S.poles) pole(c, cam, q[0], q[1], S.figure.h, '#0096c8', lw); }
    if (G.lines) { A('lines'); drawUserLines(c, lw(6)); }
    if (c !== ctx && G.drift !== false && UI.check && UI.drift) { A('drift'); drawDrift(c, n => n * cam.W / 3840 * 2.4, true); }   // export only: the screen draws it in draw()
    c.restore();
  }
  // the drift check: green = on the grid, orange = nearly aims at a vanishing point but misses (with how far off)
  function drawDrift(c, px, labels) {
    const dr = UI.drift; c.lineCap = 'round';
    for (const g of dr.on) { c.strokeStyle = 'rgba(47,191,113,.85)'; c.lineWidth = px(2.5); c.beginPath(); c.moveTo(g.a[0], g.a[1]); c.lineTo(g.b[0], g.b[1]); c.stroke(); }
    for (const q of dr.off) { const g = q.seg, t = q.deg.toFixed(1) + '° off the ' + NAME[q.group].toLowerCase() + ' point'; c.strokeStyle = '#ff7a1a'; c.lineWidth = px(5); c.beginPath(); c.moveTo(g.a[0], g.a[1]); c.lineTo(g.b[0], g.b[1]); c.stroke();
      if (!labels) continue; c.font = '600 ' + px(12) + 'px system-ui'; const tw = c.measureText(t).width, x = (g.a[0] + g.b[0]) / 2 + px(8), y = (g.a[1] + g.b[1]) / 2 + px(20); c.fillStyle = '#ff7a1a'; c.fillRect(x - px(4), y - px(13), tw + px(8), px(18)); c.fillStyle = '#231200'; c.fillText(t, x, y); }
  }
  function pole(c, cam, x, z, hgt, col, lw) {      // a marker as tall as the measured character: feet line, body line, head circle
    c.strokeStyle = col; c.lineWidth = lw(7); line3(c, cam, [[x, 0, z], [x, hgt, z]], 8); line3(c, cam, [[x - 0.7, 0, z], [x + 0.7, 0, z]], 4);
    const top = AT.project(cam, [x, hgt, z]), chin = AT.project(cam, [x, hgt * (1 - 1 / 7.5), z]); if (top && chin) { c.beginPath(); c.arc((top[0] + chin[0]) / 2, (top[1] + chin[1]) / 2, Math.hypot(top[0] - chin[0], top[1] - chin[1]) / 2, 0, 7); c.stroke(); }
  }
  function heightAt(cam, g, uv) {                  // how high above the floor spot g the pixel uv is
    const n = AT.norm([cam.C[0] - g[0], 0, cam.C[2] - g[2]]), r = AT.ray(cam, uv), den = AT.dot(r, n); if (Math.abs(den) < 1e-6) return null; const t = AT.dot(AT.sub(g, cam.C), n) / den; return t > 0 ? AT.add(cam.C, AT.mul(r, t))[1] : null;
  }
  function drawProps(c, cam, lw) {
    const geos = S.props.map(p => AT.propWorld(p, cam.C));
    if (S.solid) {
      const faces = [];
      geos.forEach(g => g.faces.forEach(F => { const m = F.reduce((a, p) => AT.add(a, p), [0,0,0]).map(v => v / F.length); faces.push([AT.len(AT.sub(m, cam.C)), F]); }));
      faces.sort((a, b) => b[0] - a[0]); c.fillStyle = 'rgba(255,255,255,0.62)';
      for (const [, F] of faces) { const pcs = AT.polyPieces(cam, F.concat([F[0]]), 6); if (pcs.length !== 1) continue; c.beginPath(); pcs[0].forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath(); c.fill(); }
    }
    geos.forEach((g, i) => {
      const p = S.props[i], sel = UI.sel && UI.sel.kind === 'prop' && UI.sel.i === i && c === ctx;
      c.strokeStyle = p.color || PCOL[i % PCOL.length]; c.lineWidth = lw(sel ? 11 : 7);
      if (c === ctx) p._px = []; g.lines.forEach(L => { const pcs = AT.polyPieces(cam, L, L.length > 2 ? 1 : 10); strokePieces(c, pcs); if (c === ctx) p._px.push(...pcs); });
    });
  }
  function drawUserLines(c, w) { c.lineCap = 'round'; for (const l of S.lines) { c.strokeStyle = COL[l.g]; c.lineWidth = w; c.beginPath(); c.moveTo(l.a[0], l.a[1]); c.lineTo(l.b[0], l.b[1]); c.stroke(); } }

  function draw() {
    derive();
    const dpr = window.devicePixelRatio || 1, r = stage.getBoundingClientRect();
    if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
    const v = UI.view; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#0e0d11'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(v.s * dpr, 0, 0, v.s * dpr, v.x * dpr, v.y * dpr);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, S.W, S.H);
    if (board) { ctx.globalAlpha = 1 - S.boardOp / 100; ctx.drawImage(board, 0, 0, S.W, S.H); ctx.globalAlpha = 1; }
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, S.W, S.H); ctx.clip();
    drawGuide(ctx, D.cam, 1.2 / v.s);
    ctx.restore();
    // drawn lines, their reach toward the vanishing point, and handles (screen only)
    const px = n => n / v.s;
    for (let i = 0; i < S.lines.length; i++) {
      const l = S.lines[i], vp = D.count[l.g] > 1 ? D.vp[l.g] : null, sel = UI.sel && UI.sel.kind === 'line' && UI.sel.i === i;
      if (vp && Math.abs(vp[0]) < 1e6) { ctx.strokeStyle = COL[l.g]; ctx.globalAlpha = 0.35; ctx.lineWidth = px(1.2); ctx.setLineDash([px(8), px(7)]); ctx.beginPath(); const m = [(l.a[0]+l.b[0])/2, (l.a[1]+l.b[1])/2]; ctx.moveTo(m[0], m[1]); ctx.lineTo(vp[0], vp[1]); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; }
      ctx.strokeStyle = COL[l.g]; ctx.lineWidth = px(sel ? 4.5 : 3); ctx.beginPath(); ctx.moveTo(l.a[0], l.a[1]); ctx.lineTo(l.b[0], l.b[1]); ctx.stroke();
      for (const p of [l.a, l.b]) { ctx.fillStyle = '#fff'; ctx.strokeStyle = COL[l.g]; ctx.lineWidth = px(2); ctx.beginPath(); ctx.arc(p[0], p[1], px(sel ? 6 : 4.5), 0, 7); ctx.fill(); ctx.stroke(); }
      if (vp && D.count[l.g] > 2) { const ms = AT.missOf(l, vp); if (ms.deg > 1.5) { const t = 'misses by ' + Math.round(ms.px) + ' px'; ctx.font = '600 ' + px(12) + 'px system-ui'; const w = ctx.measureText(t).width; const x = (l.a[0]+l.b[0])/2 + px(8), y = (l.a[1]+l.b[1])/2 - px(8); ctx.fillStyle = '#ffa23a'; ctx.fillRect(x - px(4), y - px(13), w + px(8), px(18)); ctx.fillStyle = '#231200'; ctx.fillText(t, x, y); } }
    }
    for (const g of ['A', 'B', 'V']) { const vp = D.count[g] > 1 ? D.vp[g] : null; if (!vp || Math.abs(vp[0]) > 1e6) continue; ctx.fillStyle = COL[g]; ctx.beginPath(); ctx.arc(vp[0], vp[1], px(6), 0, 7); ctx.fill(); ctx.font = '700 ' + px(12) + 'px system-ui'; ctx.fillText(NAME[g] + ' VP', vp[0] + px(10), vp[1] - px(8)); }
    UI.drift = null;
    if (UI.check && board) { if (!UI.found) UI.found = findSegs(board); const pts = {}; for (const g of ['A', 'B', 'V']) if (D.count[g] > 1 && D.vp[g]) pts[g] = D.vp[g];
      UI.drift = LineFind.drift(UI.found, pts, 1.5, 9);
      if (S.guide.drift !== false) { ctx.save(); ctx.globalAlpha = ((S.guide.op || {}).drift ?? 100) / 100; drawDrift(ctx, px, true); ctx.restore(); } }
    if (BA.on) {                                   // before / after: left of the handle shows the drawing untouched
      const xd = Math.min(S.W, (BA.x - v.x) / v.s);
      if (xd > 0) { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, xd, S.H); ctx.clip(); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, S.W, S.H); if (board) ctx.drawImage(board, 0, 0, S.W, S.H); ctx.restore(); }
    }
    if (UI.drag && UI.drag.kind === 'height') { const d = UI.drag; ctx.strokeStyle = '#e24bb5'; ctx.lineWidth = px(3); ctx.setLineDash([px(8), px(6)]); ctx.beginPath(); ctx.moveTo(d.p0[0], d.p0[1]); ctx.lineTo(d.p1[0], d.p1[1]); ctx.stroke(); ctx.setLineDash([]); }
    else if (UI.tool === 'H' && S.figure && UI.hover) { const g = AT.planePoint(D.cam, UI.hover, 0); if (g) { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, S.W, S.H); ctx.clip(); ctx.globalAlpha = 0.55; pole(ctx, D.cam, g[0], g[2], S.figure.h, '#0096c8', n => Math.max(1.2 / v.s, n * S.W / 3840)); ctx.restore(); } }
    ctx.strokeStyle = 'rgba(255,143,184,.9)'; ctx.lineWidth = px(1); ctx.strokeRect(0, 0, S.W, S.H);
    readout();
  }
  function readout() {
    const f = p => p ? (Math.abs(p[0]) > 1e6 ? 'parallel (no meeting point)' : Math.round(p[0]) + ', ' + Math.round(p[1])) : 'needs 2+ lines';
    const cam = D.cam, hz = AT.vanishingPoint(cam, [0, 0, 1]), a = AT.rToAngles(cam.R);
    let t = 'Depth VP: ' + (D.count.A ? f(D.count.A > 1 ? D.vp.A : null) : 'no lines yet') + '\n';
    if (D.count.B) t += 'Side VP: ' + f(D.count.B > 1 ? D.vp.B : null) + '\n';
    if (D.count.V) t += 'Upright VP: ' + f(D.count.V > 1 ? D.vp.V : null) + '\n';
    t += 'Camera: lens ' + cam.fov.toFixed(1) + (D.solved ? ' (solved)' : '') + ', tilt ' + a.roll.toFixed(1) + ', bend k ' + cam.k.toFixed(2) + '\n';
    if (D.shift) t += '3 point: the lens looks ' + Math.round(Math.abs(D.shift[0])) + ' px ' + (D.shift[0] < 0 ? 'left' : 'right') + ' and ' + Math.round(Math.abs(D.shift[1])) + ' px ' + (D.shift[1] < 0 ? 'above' : 'below') + ' the middle of the picture\n';
    if (hz) t += 'Horizon straight ahead at y ' + Math.round(AT.project(cam, [cam.C[0] + cam.R[2][0]*1e5, cam.C[1], cam.C[2] + cam.R[2][2]*1e5])[1]);
    if (D.notes.length) t += '\n' + D.notes.join('\n');
    if (S.figure) t += '\nCharacter: ' + S.figure.h.toFixed(1) + ' ft tall' + (S.poles.length ? ', ' + S.poles.length + ' marker' + (S.poles.length > 1 ? 's' : '') : '');
    if (UI.drift) t += '\nCheck: ' + UI.drift.on.length + ' strokes on the grid, ' + (UI.drift.off.length + UI.drift.more) + ' drifting' + (UI.drift.more ? ' (the ' + UI.drift.off.length + ' worst are marked)' : '') + (Object.keys(UI.drift.on).length + UI.drift.off.length ? '' : ' (it needs a vanishing point first)');
    if (UI.note) t += '\n' + UI.note;
    $('#pReadout').textContent = t;
    $('#pHint').textContent = UI.tool === 'S' ? 'Drag a prop to slide it on the floor. Shift-drag lifts it. Drag line ends or a vanishing point to adjust. Delete removes. Wheel zooms, space-drag pans.'
      : UI.tool === 'H' ? (S.figure ? 'Click on the floor to stand a same-height marker there. Drag feet to head again to re-measure.' : 'Drag from the feet to the top of the head of one character.')
      : 'Click to put the ' + NAME[UI.tool].toLowerCase() + ' vanishing point there, or drag along an edge in the drawing to add ' + (UI.tool === 'V' ? 'an ' : 'a ') + NAME[UI.tool].toLowerCase() + ' line. Wheel zooms, space-drag pans.';
  }

  // ---------- view + pointer
  function fit() { const r = stage.getBoundingClientRect(); UI.fitted = r.width > 60; if (!UI.fitted) return; const s = Math.min((r.width - 40) / S.W, (r.height - 40) / S.H); UI.view = { s, x: (r.width - S.W*s) / 2, y: (r.height - S.H*s) / 2 }; draw(); }
  const toCanvas = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left - UI.view.x) / UI.view.s, (e.clientY - r.top - UI.view.y) / UI.view.s]; };
  const dseg = (p, a, b) => { const dx = b[0]-a[0], dy = b[1]-a[1], L = dx*dx + dy*dy || 1, t = AT.clamp(((p[0]-a[0])*dx + (p[1]-a[1])*dy) / L, 0, 1); return Math.hypot(p[0] - a[0] - t*dx, p[1] - a[1] - t*dy); };
  function hit(p) {
    const tol = 9 / UI.view.s;
    for (let i = S.lines.length - 1; i >= 0; i--) { const l = S.lines[i]; if (Math.hypot(p[0]-l.a[0], p[1]-l.a[1]) < tol*1.3) return { kind: 'line', i, part: 'a' }; if (Math.hypot(p[0]-l.b[0], p[1]-l.b[1]) < tol*1.3) return { kind: 'line', i, part: 'b' }; }
    for (let i = S.lines.length - 1; i >= 0; i--) { const l = S.lines[i]; if (dseg(p, l.a, l.b) < tol) return { kind: 'line', i, part: 'all' }; }
    let best = null, bd = tol * 1.4;
    S.props.forEach((q, i) => (q._px || []).forEach(seg => { for (let j = 0; j < seg.length - 1; j++) { const d = dseg(p, seg[j], seg[j+1]); if (d < bd) { bd = d; best = { kind: 'prop', i }; } } }));
    if (best) return best;
    let area = Infinity;                         // inside a prop's outline box counts too (smallest wins)
    S.props.forEach((q, i) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; (q._px || []).forEach(seg => seg.forEach(u => { x0 = Math.min(x0, u[0]); x1 = Math.max(x1, u[0]); y0 = Math.min(y0, u[1]); y1 = Math.max(y1, u[1]); })); const ar = (x1-x0)*(y1-y0); if (p[0] > x0 && p[0] < x1 && p[1] > y0 && p[1] < y1 && ar < area) { area = ar; best = { kind: 'prop', i }; } });
    return best;
  }
  function aim(from, p) {                           // turn lines to point at p: the end further from p stays where it is
    for (const q of from) { const fa = Math.hypot(q.a[0] - p[0], q.a[1] - p[1]) >= Math.hypot(q.b[0] - p[0], q.b[1] - p[1]) ? q.a : q.b, len = Math.hypot(q.b[0] - q.a[0], q.b[1] - q.a[1]), dx = p[0] - fa[0], dy = p[1] - fa[1], n = Math.hypot(dx, dy) || 1; q.l.a = fa.slice(); q.l.b = [fa[0] + dx / n * Math.min(len, n * 0.9), fa[1] + dy / n * Math.min(len, n * 0.9)]; }
  }
  function placeVP(g, p) {                          // a click with a line tool: that vanishing point goes there
    let mine = S.lines.filter(l => l.g === g);
    if (mine.length < 2) { S.lines = S.lines.filter(l => l.g !== g); const W = S.W, H = S.H, left = p[0] < W / 2, an = g === 'A' ? [[W * 0.1, H * 0.94], [W * 0.9, H * 0.94], [W * (left ? 0.92 : 0.08), H * 0.08]] : g === 'B' ? [[W * (left ? 0.85 : 0.15), H * 0.15], [W * (left ? 0.85 : 0.15), H * 0.88]] : [[W * 0.15, H * (p[1] < H / 2 ? 0.85 : 0.15)], [W * 0.85, H * (p[1] < H / 2 ? 0.85 : 0.15)]];
      for (const a of an) S.lines.push({ g, a, b: [a[0] + (p[0] - a[0]) * 0.35, a[1] + (p[1] - a[1]) * 0.35] }); }
    else aim(mine.map(l => ({ l, a: l.a.slice(), b: l.b.slice() })), p);
    S.useLines = true; UI.note = NAME[g] + ' vanishing point placed. Drag it, or its lines, to adjust.';
  }
  function endHeight(d) {
    const cam = D.cam, px = 12 / UI.view.s;
    if (Math.hypot(d.p1[0] - d.p0[0], d.p1[1] - d.p0[1]) >= px) { const feet = d.p0[1] > d.p1[1] ? d.p0 : d.p1, head = feet === d.p0 ? d.p1 : d.p0, g = AT.planePoint(cam, feet, 0), hgt = g && heightAt(cam, g, head);
      if (!g || !(hgt > 0.05)) { UI.note = 'That did not land on the floor. Start at the feet, below the horizon, and drag up to the head.'; return; }
      pushUndo(); S.figure = { x: g[0], z: g[2], h: hgt }; UI.note = ''; }
    else if (!S.figure) UI.note = 'Drag from the feet to the top of the head of one character first.';
    else { const g = AT.planePoint(cam, d.p1, 0); if (!g) { UI.note = 'That spot is above the horizon, so it is not on the floor.'; return; } pushUndo(); S.poles.push([g[0], g[2]]); UI.note = ''; }
  }
  const snapv = v => S.snap ? Math.round(v * 4) / 4 : Math.round(v * 100) / 100;
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId); const p = toCanvas(e);
    if (e.button === 1 || e.button === 2 || UI.space) { UI.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, x: UI.view.x, y: UI.view.y }; return; }
    if (UI.tool === 'H') { UI.drag = { kind: 'height', p0: p, p1: p }; return; }
    if (UI.tool === 'F') { const g = AT.planePoint(D.cam, p, 0); if (g) { pushUndo(); S.fig3d.at = { x: g[0], z: g[2] }; UI.note = ''; } else UI.note = 'That spot is above the horizon, so it is not on the floor.'; setTool('S'); syncAll(); return; }
    if (UI.tool === 'S') for (const g of ['A', 'B', 'V']) { const vp = D.count[g] > 1 ? D.vp[g] : null; if (vp && Math.abs(vp[0]) < 1e6 && Math.hypot(p[0] - vp[0], p[1] - vp[1]) < 12 / UI.view.s) { pushUndo(); UI.sel = null; UI.drag = { kind: 'vp', g, from: S.lines.filter(l => l.g === g).map(l => ({ l, a: l.a.slice(), b: l.b.slice() })) }; return; } }
    if (UI.tool !== 'S') { pushUndo(); S.lines.push({ g: UI.tool, a: p, b: p.slice() }); UI.sel = { kind: 'line', i: S.lines.length - 1 }; UI.drag = { kind: 'line', i: S.lines.length - 1, part: 'b', fresh: true }; draw(); return; }
    const h = hit(p); UI.sel = h ? { kind: h.kind, i: h.i } : null;
    if (h && h.kind === 'line') { pushUndo(); const l = S.lines[h.i]; UI.drag = { kind: 'line', i: h.i, part: h.part, p0: p, a0: l.a.slice(), b0: l.b.slice() }; }
    else if (h) { pushUndo(); const q = S.props[h.i]; UI.drag = { kind: 'prop', i: h.i, pos0: q.pos.slice(), uv0: p, g0: AT.planePoint(D.cam, p, q.pos[1]) }; }
    syncProps(); draw();
  });
  cv.addEventListener('pointermove', e => {
    const d = UI.drag; if (!d) { if (UI.tool === 'H' && S.figure) { UI.hover = toCanvas(e); draw(); } return; } const p = toCanvas(e);
    if (d.kind === 'height') d.p1 = p; else if (d.kind === 'vp') aim(d.from, p); else
    if (d.kind === 'pan') { UI.view.x = d.x + e.clientX - d.sx; UI.view.y = d.y + e.clientY - d.sy; }
    else if (d.kind === 'line') { const l = S.lines[d.i]; if (d.part === 'all') { const dx = p[0]-d.p0[0], dy = p[1]-d.p0[1]; l.a = [d.a0[0]+dx, d.a0[1]+dy]; l.b = [d.b0[0]+dx, d.b0[1]+dy]; } else l[d.part] = p; }
    else if (d.kind === 'prop') {
      const q = S.props[d.i], cam = D.cam;
      if (e.shiftKey) {                          // lift: slide on an upright plane facing the camera
        const n = AT.norm([cam.C[0]-d.pos0[0], 0, cam.C[2]-d.pos0[2]]), hitP = uv => { const r = AT.ray(cam, uv), den = AT.dot(r, n); if (Math.abs(den) < 1e-6) return null; const t = AT.dot(AT.sub(d.pos0, cam.C), n) / den; return t > 0 ? AT.add(cam.C, AT.mul(r, t)) : null; };
        const h0 = hitP(d.uv0), h1 = hitP(p); if (h0 && h1) q.pos = [d.pos0[0], Math.max(0, snapv(d.pos0[1] + h1[1] - h0[1])), d.pos0[2]];
      } else { const g1 = AT.planePoint(cam, p, d.pos0[1]); if (d.g0 && g1) q.pos = [snapv(d.pos0[0] + g1[0] - d.g0[0]), d.pos0[1], snapv(d.pos0[2] + g1[2] - d.g0[2])]; }
      fillPropForm(true);
    }
    draw();
  });
  const endDrag = () => { const d = UI.drag; UI.drag = null; if (d && d.kind === 'line' && d.fresh) { const l = S.lines[d.i]; if (Math.hypot(l.b[0]-l.a[0], l.b[1]-l.a[1]) < 12 / UI.view.s) { const g = l.g, at = l.a.slice(); S.lines.splice(d.i, 1); UI.sel = null; placeVP(g, at); } } if (d && d.kind === 'height') endHeight(d); if (d) { syncSliders(); save(); draw(); } };
  cv.addEventListener('pointerup', endDrag); cv.addEventListener('pointercancel', endDrag);
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('wheel', e => { e.preventDefault(); const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, k = Math.exp(-e.deltaY * 0.0015), v = UI.view, s = AT.clamp(v.s * k, 0.02, 8); v.x = mx - (mx - v.x) * s / v.s; v.y = my - (my - v.y) * s / v.s; v.s = s; draw(); }, { passive: false });
  window.addEventListener('keydown', e => {
    if (!$('#mode-perspective').classList.contains('on') || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (e.code === 'Space') { UI.space = true; e.preventDefault(); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && UI.sel) { pushUndo(); (UI.sel.kind === 'line' ? S.lines : S.props).splice(UI.sel.i, 1); UI.sel = null; syncAll(); }
    if (e.key === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doUndo(); }
    const tk = { '1': 'A', '2': 'B', '3': 'V', 'v': 'S', 'h': 'H' }[e.key]; if (tk) setTool(tk);
    if (e.key === ',') showBoard(UI.bi - 1); if (e.key === '.') showBoard(UI.bi + 1);
  });
  window.addEventListener('keyup', e => { if (e.code === 'Space') UI.space = false; });
  window.addEventListener('resize', () => { if ($('#mode-perspective').classList.contains('on')) { if (!UI.fitted) fit(); else draw(); } });

  // ---------- controls
  function setTool(t) { UI.tool = t; $$('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t)); cv.style.cursor = t === 'S' ? 'default' : 'crosshair'; draw(); }
  $$('[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
  layerRows($('#pLayers'), {
    rows: () => LAYERS.map(([key, name, color]) => ({ key, name, color, attr: ' data-g="' + key + '"' })),
    get: key => ({ on: S.guide[key] ?? DEFAULT_ON[key] ?? false, op: (S.guide.op || {})[key] }),
    set: (key, p) => { if ('on' in p) S.guide[key] = p.on; if ('op' in p) { S.guide.op = { ...(S.guide.op || {}), [key]: p.op }; } save(); draw(); },
    exportOne: key => exportLayer(key)
  });
  $('#pBA').onchange = e => BA.set(e.target.checked);
  const FMT = { roll: v => v.toFixed(1) + '°', fish: v => Math.round(v) + '%', fov: v => v.toFixed(1) + '°', skew: v => v.toFixed(1) + '°', pitch: v => v.toFixed(1) + '°', yaw: v => v.toFixed(1) + '°', height: v => v.toFixed(1) + ' ft' };
  function syncSliders() {
    if ($('#pFigTurn')) { $('#pFigTurn').value = S.fig3d.turn || 0; $('#pFigTurn').nextElementSibling.textContent = (S.fig3d.turn || 0) + '°'; $('#pFig3d').checked = !!S.fig3d.on; }
    derive();
    $$('#mode-perspective .sl[data-k]').forEach(el => { const k = el.dataset.k, inp = $('input', el); inp.value = S.cam[k]; $('output', el).textContent = FMT[k](+S.cam[k]); inp.disabled = !!D.locked[k]; el.classList.toggle('locked', !!D.locked[k]); });
    $('#pBoardOp').value = S.boardOp; $('#pBoardOp').nextElementSibling.textContent = S.boardOp + '%';
    $('#pTile').value = S.guide.tile; $('#pTile').nextElementSibling.textContent = S.guide.tile + ' ft';
    $('#pExtent').value = S.guide.extent; $('#pExtent').nextElementSibling.textContent = S.guide.extent + ' ft';
    $('#pWeight').value = S.guide.weight; $('#pWeight').nextElementSibling.textContent = 'x' + (+S.guide.weight).toFixed(1);
    $$('[data-g]').forEach(c => { const k = c.dataset.g; c.checked = !!(S.guide[k] ?? DEFAULT_ON[k]); const op = c.closest('.lrow') && $('input[type=range]', c.closest('.lrow')); if (op) op.value = (S.guide.op || {})[k] ?? 100; });
    $('#pUseLines').checked = S.useLines; $('#pSolveLens').checked = S.solveLens; $('#pSnap').checked = S.snap; $('#pSolid').checked = S.solid;
    $('#pCanvasInfo').textContent = 'Canvas ' + S.W + ' x ' + S.H + (board ? '  (' + S.boardName + ')' : '');
  }
  $$('#mode-perspective .sl[data-k] input').forEach(inp => { inp.addEventListener('pointerdown', pushUndo); inp.oninput = () => { S.cam[inp.parentElement.dataset.k] = +inp.value; syncSliders(); save(); draw(); }; });
  $('#pBoardOp').oninput = e => { S.boardOp = +e.target.value; syncSliders(); draw(); };
  $('#pTile').oninput = e => { S.guide.tile = +e.target.value; syncSliders(); save(); draw(); };
  $('#pExtent').oninput = e => { S.guide.extent = +e.target.value; syncSliders(); save(); draw(); };
  $('#pWeight').oninput = e => { S.guide.weight = +e.target.value; syncSliders(); save(); draw(); };
  $$('[data-g]').forEach(c => c.onchange = () => { S.guide[c.dataset.g] = c.checked; save(); draw(); });
  $('#pUseLines').onchange = e => { S.useLines = e.target.checked; syncSliders(); save(); draw(); };
  $('#pSolveLens').onchange = e => { S.solveLens = e.target.checked; syncSliders(); save(); draw(); };
  $('#pSnap').onchange = e => { S.snap = e.target.checked; save(); };
  $('#pSolid').onchange = e => { S.solid = e.target.checked; save(); draw(); };
  $('#pClearLines').onclick = () => { if (!S.lines.length) return; pushUndo(); S.lines = []; UI.sel = null; UI.note = ''; syncAll(); };
  $('#pClearPoles').onclick = () => { if (!S.figure) return; pushUndo(); S.figure = null; S.poles = []; UI.note = ''; syncAll(); };
  $('#pFind').onclick = findLines; $('#pCheck').onchange = e => { UI.check = e.target.checked; if (UI.check && !board) UI.note = 'Upload a picture first: there is nothing to check.'; draw(); };
  $('#pUndo').onclick = doUndo;
  $('#pResetLens').onclick = () => { pushUndo(); S.cam = { yaw: 0, pitch: 0, roll: 0, fov: 60, fish: 0, skew: 0, height: 5 }; syncAll(); };
  // lens looks: a starting point for stylized rooms (very wide, lines that bow, a tilted camera)
  const PRESET = { straight: { fov: 60, fish: 0, roll: 0, skew: 0 }, wide: { fov: 105, fish: 0, roll: 0, skew: 0 },
    bendy: { fov: 152, fish: 22, roll: 5, skew: 0 }, fisheye: { fov: 170, fish: 70, roll: 0, skew: 0 },
    high: { fov: 125, fish: 30, roll: -8, skew: 0, pitch: -38, height: 9 }, low: { fov: 125, fish: 30, roll: 7, skew: 0, pitch: 28, height: 1 } };
  $$('[data-preset]').forEach(b => b.onclick = () => { pushUndo(); derive(); const p = PRESET[b.dataset.preset]; for (const k in p) if (!D.locked[k]) S.cam[k] = p[k]; syncAll(); });
  $('#pFit').onclick = fit;

  // ---------- shot presets: a camera (and a few props) to start from, never a finished answer
  const SHOTS = {
    p1: { cam: { yaw: 0, pitch: 0, roll: 0, fov: 60, fish: 0, skew: 0, height: 5 }, about: '1 point: looking straight down the depth lines.' },
    p2: { cam: { yaw: 35, pitch: 0, roll: 0, fov: 60, fish: 0, skew: 0, height: 5 }, about: '2 point: turned to the room, verticals stay straight.' },
    p3: { cam: { yaw: 35, pitch: 24, roll: 0, fov: 70, fish: 0, skew: 0, height: 4 }, about: '3 point: tilted up, so the verticals meet above.' },
    low: { cam: { yaw: 20, pitch: 12, roll: 0, fov: 70, fish: 0, skew: 0, height: 1.8 }, about: 'Low angle: camera near the floor, a little tilt up. Characters loom.' },
    high: { cam: { yaw: 25, pitch: -30, roll: 0, fov: 60, fish: 0, skew: 0, height: 14 }, about: 'High angle: above head height looking down. Characters shrink.' },
    dutch: { cam: { yaw: 30, pitch: 0, roll: 16, fov: 60, fish: 0, skew: 0, height: 5 }, about: 'Dutch: the camera rolled, the horizon tilts. Unease, tension.' },
    bird: { cam: { yaw: 30, pitch: -62, roll: 0, fov: 55, fish: 0, skew: 0, height: 32 }, about: "Bird's eye: high and steep. The floor plan reads." },
    worm: { cam: { yaw: 15, pitch: 42, roll: 0, fov: 90, fish: 10, skew: 0, height: 0.4 }, about: "Worm's eye: on the floor looking up. Everything towers." },
    ots: { cam: { yaw: 6, pitch: -3, roll: 0, fov: 50, fish: 0, skew: 0, height: 5.4 }, figure: { x: -0.9, z: 2.6, h: 5.33 }, poles: [[1.2, 11]], turn: 180, fig3d: true, about: 'Over the shoulder: the 3D figure is the near shoulder (back to camera), the blue marker is the one being looked at.' },
    hall: { cam: { yaw: 0, pitch: 0, roll: 0, fov: 75, fish: 0, skew: 0, height: 5 }, guide: { walls: true, grid: true, extent: 4 }, about: 'Hallway: 1 point, walls 4 ft each side. Widen it with Grid reach.' },
    room: { cam: { yaw: 25, pitch: -4, roll: 0, fov: 90, fish: 8, skew: 0, height: 5 }, guide: { walls: true, grid: true, extent: 10 }, props: [{ type: 'door', pos: [-3, 0, 20] }], about: 'Room interior: wide lens from a corner, a door on the back wall.' },
    corner: { cam: { yaw: 45, pitch: 6, roll: 0, fov: 70, fish: 0, skew: 0, height: 5.5 }, guide: { grid: true, extent: 30 }, props: [{ type: 'box', pos: [42, 0, 42], rot: 0, w: 40, h: 34, d: 40, name: 'building' }], about: 'Street corner: a building corner points at the camera, and both streets run to their own points.' }
  };
  function applyShot(id) {
    const sh = SHOTS[id]; if (!sh) return; pushUndo();
    S.useLines = false; Object.assign(S.cam, sh.cam); S.props = S.props.filter(q => !q.preset);
    Object.assign(S.guide, { walls: false, grid: true, extent: 12 }, sh.guide || {}); S.fig3d.at = null;
    if (sh.props) for (const q of sh.props) S.props.push({ id: pid++, rot: 0, ...JSON.parse(JSON.stringify(AT.DEF[q.type])), name: q.name || q.type, ...q, pos: q.pos.slice(), preset: true });
    if (sh.figure) { S.figure = { ...sh.figure }; S.poles = (sh.poles || []).map(q => q.slice()); }
    if (sh.turn != null) { S.fig3d.turn = sh.turn; $('#pFigTurn').value = sh.turn; $('#pFigTurn').nextElementSibling.textContent = sh.turn + '°'; }
    if (sh.fig3d) setFig3d(true);
    $('#pShotInfo').textContent = sh.about + (S.lines.length ? ' Your drawn lines are kept but switched off ("Use my lines" turns them back on).' : '');
    syncAll();
  }
  $$('[data-shot]').forEach(b => b.onclick = () => applyShot(b.dataset.shot));
  // ---------- the 3D figure in the shot
  async function setFig3d(on) {
    S.fig3d.on = on; $('#pFig3d').checked = on; save();
    if (on) {
      $('#pFigInfo').textContent = 'Loading the figure...'; const F = await Persp3D.load();
      if (!F) { S.fig3d.on = false; $('#pFig3d').checked = false; $('#pFigInfo').textContent = location.protocol === 'file:' ? 'The 3D figure needs the app opened with the toolkit shortcut (python serve.py).' : 'The 3D figure did not load.'; draw(); return; }
      $('#pFigInfo').textContent = S.figure ? 'Standing on the pink height marker, ' + S.figure.h.toFixed(1) + ' ft tall. Pose it in Figure 3D and it updates here.' : 'No height marker yet, so it stands 12 ft away at 5 ft 4 in. Measure a character or click "Place it". Pose it in Figure 3D and it updates here.';
    }
    draw();
  }
  $('#pFig3d').onchange = e => setFig3d(e.target.checked);
  $('#pFigPlace').onclick = () => { setTool('F'); UI.note = 'Click a spot on the floor for the 3D figure to stand on.'; draw(); };
  $('#pFigTurn').oninput = e => { S.fig3d.turn = +e.target.value; e.target.nextElementSibling.textContent = e.target.value + '°'; save(); draw(); };
  $('#pFigTurn').nextElementSibling.textContent = '0°';


  // ---------- props
  const FIELDS = { box: ['w', 'h', 'd'], cylinder: ['r', 'h'], bottle: ['r', 'h'], jar: ['r', 'h'], shelf: ['w', 'h', 'd', 'shelves'], cabinet: ['w', 'h', 'd', 'shelves', 'doors', 'swing'], door: ['w', 'h', 'swing', 'hinge'] };
  const LABEL = { w: 'Width', h: 'Height', d: 'Depth', r: 'Radius', shelves: 'Shelves', doors: 'Doors', swing: 'Swing', hinge: 'Hinge', rot: 'Turn' };
  function addProp(type) {
    pushUndo(); const cam = D.cam, g = AT.planePoint(cam, [S.W/2, S.H*0.72], 0);
    const pos = g && AT.len(AT.sub(g, cam.C)) < 60 ? [snapv(g[0]), 0, snapv(g[2])] : [0, 0, 8];
    const n = S.props.filter(q => q.type === type).length + 1;
    S.props.push({ id: pid++, type, name: type + ' ' + n, pos, rot: 0, ...JSON.parse(JSON.stringify(AT.DEF[type])) });
    UI.sel = { kind: 'prop', i: S.props.length - 1 }; setTool('S'); syncAll();
  }
  $$('[data-add]').forEach(b => b.onclick = () => addProp(b.dataset.add));
  function syncProps() {
    const list = $('#pList'); list.innerHTML = '';
    S.props.forEach((q, i) => { const el = document.createElement('div'); el.className = 'pitem' + (UI.sel && UI.sel.kind === 'prop' && UI.sel.i === i ? ' on' : ''); el.innerHTML = '<i class="dot"></i><span></span><b title="Delete">x</b>'; $('.dot', el).style.background = q.color || PCOL[i % PCOL.length]; $('span', el).textContent = q.name; el.onclick = ev => { if (ev.target.tagName === 'B') { pushUndo(); S.props.splice(i, 1); UI.sel = null; } else { UI.sel = { kind: 'prop', i }; setTool('S'); } syncAll(); }; list.appendChild(el); });
    fillPropForm(false);
  }
  function fillPropForm(light) {
    const card = $('#pPropCard'), q = UI.sel && UI.sel.kind === 'prop' ? S.props[UI.sel.i] : null; card.style.display = q ? '' : 'none'; if (!q) return;
    const form = $('#pPropForm');
    if (light && form.dataset.id == q.id) { $$('[data-pos]', form).forEach(inp => inp.value = q.pos[+inp.dataset.pos]); return; }
    form.dataset.id = q.id; form.innerHTML = '';
    const row = (label, el) => { const d = document.createElement('div'); d.className = 'f2'; const l = document.createElement('label'); l.textContent = label; d.append(l, el); form.appendChild(d); };
    const num = (val, step, set, attrs) => { const inp = document.createElement('input'); inp.type = 'number'; inp.step = step; inp.value = val; Object.assign(inp.dataset, attrs || {}); inp.onfocus = pushUndo; inp.oninput = () => { if (inp.value === '' || isNaN(+inp.value)) return; set(+inp.value); save(); draw(); }; return inp; };
    const name = document.createElement('input'); name.type = 'text'; name.value = q.name; name.oninput = () => { q.name = name.value; $$('#pList .pitem span')[UI.sel.i].textContent = q.name; save(); }; row('Name', name);
    ['Left/right', 'Height', 'Depth'].forEach((lb, k) => row(lb, num(q.pos[k], 0.25, v => q.pos[k] = v, { pos: k })));
    const rng = (key, min, max) => { const w = document.createElement('div'); w.style.cssText = 'display:grid;grid-template-columns:1fr 52px;gap:5px'; const r = document.createElement('input'); r.type = 'range'; r.min = min; r.max = max; r.step = 1; r.value = q[key] || 0; const n = num(q[key] || 0, 1, v => { q[key] = v; r.value = v; }); r.addEventListener('pointerdown', pushUndo); r.oninput = () => { q[key] = +r.value; n.value = r.value; save(); draw(); }; w.append(r, n); return w; };
    row('Turn', rng('rot', -180, 180));
    for (const f of FIELDS[q.type]) {
      if (f === 'swing') row('Swing', rng('swing', -170, 170));
      else if (f === 'hinge') { const s = document.createElement('select'); s.innerHTML = '<option value="left">left</option><option value="right">right</option>'; s.value = q.hinge; s.onchange = () => { pushUndo(); q.hinge = s.value; save(); draw(); }; row('Hinge', s); }
      else row(LABEL[f], num(q[f], f === 'shelves' || f === 'doors' ? 1 : 0.05, v => q[f] = (f === 'shelves' || f === 'doors') ? Math.max(0, Math.round(v)) : Math.max(0.02, v)));
    }
  }
  $('#pDel').onclick = () => { if (!UI.sel) return; pushUndo(); S.props.splice(UI.sel.i, 1); UI.sel = null; syncAll(); };
  $('#pDup').onclick = () => { if (!UI.sel) return; pushUndo(); const q = JSON.parse(JSON.stringify(S.props[UI.sel.i], (k, v) => k === '_px' ? undefined : v)); q.id = pid++; q.name += ' copy'; q.pos[0] += 1; S.props.push(q); UI.sel = { kind: 'prop', i: S.props.length - 1 }; syncAll(); };
  function syncAll() { syncSliders(); syncProps(); save(); draw(); }

  // ---------- board, export, scene files
  function setBoard(img, name) { board = img; S.W = img.naturalWidth || img.width; S.H = img.naturalHeight || img.height; S.boardName = (name || 'board').replace(/\.[^.]+$/, ''); UI.found = null; UI.boards = [{ img, name: name || 'board' }]; UI.bi = 0; UI.seq = null; syncSeq(); syncSliders(); fit(); }
  function showBoard(i) { if (UI.boards.length < 2 || i < 0 || i >= UI.boards.length) return; UI.bi = i; board = UI.boards[i].img; S.boardName = UI.boards[i].name.replace(/\.[^.]+$/, ''); UI.found = null; syncSeq(); syncSliders(); draw(); }
  function syncSeq() { const n = UI.boards.length, many = n > 1; $('#pSeqRow').style.display = many ? '' : 'none'; $('#pSeqCheck').style.display = many ? '' : 'none'; if (many) $('#pSeqLbl').textContent = 'Frame ' + (UI.bi + 1) + ' of ' + n + ': ' + UI.boards[UI.bi].name; if (!UI.seq) $('#pSeqInfo').textContent = many ? 'The grid stays the same on every frame.' : ''; }
  async function loadBoardFiles(list) {             // one picture, or the frames of a shot (they share one grid)
    const files = [...list].filter(f => PICS.test(f.name)).sort((u, v) => u.name.localeCompare(v.name, undefined, { numeric: true })); if (!files.length) return; const got = [];
    for (const f of files) { try { got.push({ img: await fileImage(f), name: f.name }); } catch (err) { UI.note = 'Could not open ' + f.name + ': ' + err.message; } }
    if (!got.length) { draw(); return; } UI.note = ''; setBoard(got[0].img, got[0].name); UI.boards = got; syncSeq();
  }
  const loadBoardFile = f => loadBoardFiles([f]);
  $('#pBoardBtn').onclick = () => $('#pBoardFile').click();
  $('#pBoardFile').onchange = e => { loadBoardFiles(e.target.files); e.target.value = ''; };
  $('#pBlank').onclick = () => { board = null; UI.boards = []; UI.bi = 0; UI.found = null; UI.seq = null; S.boardName = 'blank'; UI.note = 'Blank frame, ' + S.W + ' x ' + S.H + '. Click with a line tool to place each vanishing point, then export the guide to draw on.'; syncSeq(); syncSliders(); fit(); };
  $('#pPrevB').onclick = () => showBoard(UI.bi - 1); $('#pNextB').onclick = () => showBoard(UI.bi + 1);
  stage.addEventListener('dragover', e => e.preventDefault());
  stage.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (!f) return; if (/json$/i.test(f.name)) f.text().then(t => loadScene(JSON.parse(t))); else loadBoardFiles(e.dataTransfer.files); });
  // ---------- finding the lines in the picture
  function findSegs(img) {                          // the long straight strokes of a picture, in canvas pixels
    const k = Math.min(1, 1600 / Math.max(S.W, S.H)), w = Math.round(S.W * k), h = Math.round(S.H * k), c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h); const d = g.getImageData(0, 0, w, h).data, gray = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) gray[i] = (d[i * 4] * 77 + d[i * 4 + 1] * 150 + d[i * 4 + 2] * 29) >> 8;
    return LineFind.segments(gray, w, h).map(q => ({ a: [q.a[0] / k, q.a[1] / k], b: [q.b[0] / k, q.b[1] / k], len: q.len / k }));
  }
  function findLines() {
    if (!board) { UI.note = 'Upload a picture first: there is nothing to look for lines in.'; draw(); return; }
    const segs = findSegs(board), r = LineFind.vps(segs, S.W, S.H); UI.found = segs; pushUndo(); S.lines = [];
    for (const g of ['A', 'B', 'V']) r[g].slice().sort((u, v) => v.len - u.len).slice(0, 4).forEach(q => S.lines.push({ g, a: q.a.slice(), b: q.b.slice() }));
    UI.sel = null; if (r.A.length) S.useLines = true;
    UI.note = segs.length + ' long straight strokes found. ' + (r.A.length ? 'Depth point from ' + r.A.length + ' of them' + (r.B.length ? ', side point from ' + r.B.length : '') + (r.V.length ? ', uprights from ' + r.V.length : '') + '. Drag a line or a point to correct it, or Undo.'
      : 'They do not agree on a vanishing point, so nothing was added. Mark it by hand: drag along edges, or click to place the point.') + '\nCharacters can fool this (arms and props line up by chance), so trust your eye over it.';
    setTool('S'); syncAll();
  }
  async function checkSequence() {                  // the depth point on every frame, and the frames where it jumps away from its neighbours
    const n = UI.boards.length; if (n < 2) return; const res = [], info = $('#pSeqInfo');
    for (let i = 0; i < n; i++) { info.textContent = 'Looking at frame ' + (i + 1) + ' of ' + n + '...'; await new Promise(r => setTimeout(r, 0)); const r = LineFind.vps(findSegs(UI.boards[i].img), S.W, S.H); const near = r.vpA && Math.hypot(r.vpA[0] - S.W / 2, r.vpA[1] - S.H / 2) < 3 * Math.hypot(S.W, S.H); res.push({ name: UI.boards[i].name, vp: near ? r.vpA : null, lines: near ? r.A.length : 0 }); }      // a point many pictures away is too loose to compare
    const tol = Math.hypot(S.W, S.H) * 0.04, med = a => { const b = a.slice().sort((u, v) => u - v), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; }; let flags = 0, worst = 0;
    const guess = (nb, i, c) => { const sl = []; for (let a = 0; a < nb.length; a++) for (let b = a + 1; b < nb.length; b++) sl.push((nb[b].vp[c] - nb[a].vp[c]) / (nb[b].i - nb[a].i)); const m = sl.length ? med(sl) : 0; return med(nb.map(o => o.vp[c] - m * (o.i - i))); };      // where the neighbours say this frame's point should be: a steady slide through them, ignoring one that is out of line
    res.forEach((q, i) => { q.i = i; });
    res.forEach((q, i) => { const nb = res.filter((o, j) => j !== i && Math.abs(j - i) <= 4 && o.vp); q.flag = '';
      if (!q.vp) { if (nb.length >= 2) q.flag = 'no depth point found here, though its neighbours have one'; }
      else if (nb.length >= 2) { q.jump = Math.hypot(q.vp[0] - guess(nb, i, 0), q.vp[1] - guess(nb, i, 1)); worst = Math.max(worst, q.jump); if (q.jump > tol) q.flag = 'the depth point is ' + Math.round(q.jump) + ' px away from where its neighbours put it'; }
      if (q.flag) flags++; });
    UI.seq = res; const have = res.filter(q => q.vp).length;
    info.textContent = !have ? 'No frame gave a clear depth point, so there is nothing to compare. Mark the grid by hand and flip through the frames instead.'
      : (flags ? flags + ' of ' + n + ' frames to look at:\n' + res.map((q, i) => q.flag ? 'Frame ' + (i + 1) + ' (' + q.name + '): ' + q.flag : '').filter(Boolean).join('\n') : 'All ' + n + ' frames agree: the depth point stays within ' + Math.round(worst) + ' px of its neighbours.')
        + '\nA camera move slides the point smoothly, and that is fine: only sudden jumps are flagged.';
  }
  $('#pSeqCheck').onclick = checkSequence;
  // the guide at the drawing's exact size, transparent. only = one layer key: just that layer, fully on
  function guideCanvas(only) {
    derive(); const c = document.createElement('canvas'); c.width = S.W; c.height = S.H; const keep = S.guide;
    if (only) { S.guide = { ...keep, op: { ...(keep.op || {}) } }; for (const [k] of LAYERS) S.guide[k] = k === only; }
    try { drawGuide(c.getContext('2d'), D.cam, 1); } finally { S.guide = keep; }
    return c;
  }
  function exportLayer(key) {
    if (key === 'figure3d' && !(S.fig3d.on && window.Fig3D)) { UI.note = 'Tick "Show the posed figure" first: the 3D figure layer is empty until then.'; draw(); return; }
    if (key === 'drift' && !(UI.check && UI.drift)) { UI.note = 'Turn on "Check my drawing against the grid" first: the drift layer is empty until then.'; draw(); return; }
    guideCanvas(key).toBlob(b => Store.exportFile(S.boardName, S.boardName + '_' + key + '.png', b), 'image/png');
  }
  $('#pExport').onclick = () => guideCanvas().toBlob(b => Store.exportFile(S.boardName, S.boardName + '_guide.png', b), 'image/png');
  const clean = q => { const o = {}; for (const k in q) if (k !== '_px' && k !== 'id') o[k] = q[k]; return o; };
  function sceneJSON() {
    derive(); const cam = D.cam, a = AT.rToAngles(cam.R), r4 = v => Math.round(v * 1e6) / 1e6;
    return { canvas: [S.W, S.H], camera: { pos: cam.C, fov: r4(cam.fov), k: r4(cam.k), roll: r4(a.roll), yaw: r4(a.yaw), pitch: r4(a.pitch), skew: S.cam.skew, R: cam.R.map(r => r.map(r4)), ...(cam.ox || cam.oy ? { shift: [r4(cam.ox), r4(cam.oy)] } : {}) },
             floor: [-S.guide.extent, S.guide.extent, 0.25, 2 * S.guide.extent], props: S.props.map(clean),
             app: { lines: S.lines, cam: S.cam, guide: S.guide, useLines: S.useLines, solveLens: S.solveLens, figure: S.figure, poles: S.poles, fig3d: S.fig3d } };
  }
  function loadScene(o) {
    pushUndo();
    if (o.app) { S.lines = o.app.lines || []; Object.assign(S.cam, o.app.cam || {}); Object.assign(S.guide, o.app.guide || {}); S.useLines = o.app.useLines !== false; S.solveLens = o.app.solveLens !== false; S.figure = o.app.figure || null; S.poles = o.app.poles || []; if (o.app.fig3d) S.fig3d = { on: false, turn: o.app.fig3d.turn || 0, at: o.app.fig3d.at || null }; }
    else {
      S.lines = [];
      if (o.lines && o.vanishing_points) {        // a perspective_check JSON: bring its grouped lines in
        const vps = o.vanishing_points.filter(v => v.kind === 'vp').map(v => v.name), map = {}; if (vps[0]) map[vps[0]] = 'A'; if (vps[1]) map[vps[1]] = 'B';
        o.vanishing_points.forEach(v => { if (v.kind === 'vertical') map[v.name] = 'V'; });
        o.lines.forEach(l => { if (map[l.group]) S.lines.push({ g: map[l.group], a: [l.xyxy[0], l.xyxy[1]], b: [l.xyxy[2], l.xyxy[3]] }); });
      }
      const c = o.camera;
      if (c) { const a = c.R ? AT.rToAngles(c.R) : { yaw: c.yaw || 0, pitch: c.pitch || 0, roll: c.roll || 0 }; Object.assign(S.cam, { yaw: a.yaw, pitch: a.pitch, roll: a.roll, fov: c.fov || 60, fish: AT.clamp((1 - (c.k == null ? 1 : c.k)) / 0.98 * 100, 0, 100), skew: c.skew || 0, height: c.pos ? c.pos[1] : S.cam.height }); }
      if (!S.lines.length) S.useLines = false;
    }
    if (o.props) S.props = o.props.map(q => { const d = { id: pid++, rot: 0, name: q.type, ...JSON.parse(JSON.stringify(AT.DEF[q.type] || {})), ...q, pos: (q.pos || [0, 0, 0]).slice() }; if (q.size) { (q.type === 'door' ? ['w', 'h'] : ['w', 'h', 'd']).forEach((k, i) => { if (q.size[i] != null) d[k] = q.size[i]; }); delete d.size; } return d; });
    if (o.canvas && !board) { S.W = o.canvas[0]; S.H = o.canvas[1]; }
    UI.sel = null; syncAll(); fit();
  }
  $('#pSaveScene').onclick = () => download(new Blob([JSON.stringify(sceneJSON(), null, 1)], { type: 'application/json' }), S.boardName + '_scene.json');
  $('#pLoadScene').onclick = () => $('#pSceneFile').click();
  $('#pSceneFile').onchange = e => { const f = e.target.files[0]; if (f) f.text().then(t => loadScene(JSON.parse(t))).catch(err => alert('Could not read that file: ' + err.message)); e.target.value = ''; };
  function save() { try { localStorage.setItem('animtk-persp', JSON.stringify(sceneJSON())); } catch (e) {} }

  // ---------- start
  try { const o = JSON.parse(localStorage.getItem('animtk-persp') || 'null'); if (o) { loadScene(o); undo = []; } } catch (e) {}
  // optional start-up links for testing or for opening a prepared scene:
  //   animation_app.html#board=path/to/board.png&scene=<url-encoded scene JSON>
  const hp = new URLSearchParams(location.hash.slice(1));
  if (hp.get('scene')) { try { loadScene(JSON.parse(hp.get('scene'))); undo = []; } catch (e) {} }
  if (hp.get('board')) { const img = new Image(); img.onload = () => setBoard(img, hp.get('board').split('/').pop()); img.src = hp.get('board'); }
  setTool(hp.get('tool') || 'A'); syncSeq(); syncAll(); fit();
  return { S, UI, D: () => D, applyShot, setFig3d, draw, fit, loadScene, sceneJSON, guideCanvas, setBoard, addProp, setTool, findLines, findSegs, checkSequence, showBoard, loadBoardFiles, BA, board: () => board,
    setCheck: on => { UI.check = on; $('#pCheck').checked = on; draw(); } };
})();
