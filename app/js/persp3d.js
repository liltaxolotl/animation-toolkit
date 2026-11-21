// ============================== PERSPECTIVE: THE 3D FIGURE IN THE SHOT ==============================
// Renders the posed figure from the Figure 3D tab through the Perspective tab's own camera, so it sits on the grid
// exactly: same lens, fisheye, skew and 3 point lens shift. How:
//   1. three.js draws the figure with a plain wide camera at the same spot, looking the same way (a square picture).
//   2. every pixel of the drawing asks AT.rayCam (the app's own lens math) which way it looks, and reads that
//      direction out of the square picture. So whatever the grid does, the figure does too.
// Units: the Perspective tab works in feet (floor y = 0, z away from the camera); three.js in metres with z flipped.
const Persp3D = (() => {
  const FT = 0.3048, DEG = Math.PI / 180;
  const flip = a => [a[0], a[1], -a[2]];
  let cache = null, ver = 0, timer = 0, hooked = false, want = null;

  // where the figure stands and how tall it is (feet): its own spot if placed, else on the height marker; the height
  // of the marker's character if measured, else the body's own height (so a kid build stays kid sized)
  function spot(S) {
    const own = window.Fig3D && Fig3D.F ? Fig3D.F.height / FT : 5.33, at = S.fig3d && S.fig3d.at;
    return { x: at ? at.x : S.figure ? S.figure.x : 0, z: at ? at.z : S.figure ? S.figure.z : 12, h: S.figure ? S.figure.h : own };
  }
  function view(cam, fig, turn, outW) {
    // how wide the square picture must be to cover every pixel of the drawing (fisheye corners past 76 degrees are cut)
    let mx = 0; const W = cam.W, H = cam.H;
    for (let i = 0; i <= 8; i++) for (const uv of [[W * i / 8, 0], [W * i / 8, H], [0, H * i / 8], [W, H * i / 8]]) mx = Math.max(mx, Math.acos(Math.max(-1, Math.min(1, AT.rayCam(cam, uv)[2]))));
    const theta = Math.min(mx + 2 * DEG, 76 * DEG), fOut = cam.f * outW / W;
    const N = Math.max(256, Math.min(4096, Math.ceil(2 * Math.tan(theta) * fOut * 1.05)));
    const C3 = flip(cam.C).map(v => v * FT), place = { x: fig.x * FT, z: -fig.z * FT, height: fig.h * FT };
    place.yaw = Math.atan2(C3[0] - place.x, C3[2] - place.z) + (turn || 0) * DEG;     // 0 turn = facing the camera
    // the outline is a fixed width on the DRAWING (W / 600 px, about 6 px at 3840), whatever size this render is
    const outOut = (W / 600) * outW / W, outlinePx = Math.max(0.8, outOut * N / (2 * Math.tan(theta) * fOut));
    return { pos: C3, right: flip(cam.R[0]), up: flip(cam.R[1]), back: flip(cam.R[2]).map(v => -v), theta, N, place, outlinePx };
  }
  // the figure at outW x outH covering the whole drawing (transparent canvas), or null when the figure is not loaded
  function render(cam, fig, turn, outW, outH) {
    const F = window.Fig3D; if (!F || !F.F || !fig) return null;
    const v = view(cam, fig, turn, outW), tex = F.renderThrough(v); if (!tex) return null;
    const N = v.N, src = tex.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, N, N).data, t = Math.tan(v.theta), cosT = Math.cos(v.theta);
    const out = document.createElement('canvas'); out.width = outW; out.height = outH; const g = out.getContext('2d'), img = g.createImageData(outW, outH), d = img.data;
    const sx = cam.W / outW, sy = cam.H / outH;
    for (let j = 0; j < outH; j++) for (let i = 0; i < outW; i++) {
      const r = AT.rayCam(cam, [(i + 0.5) * sx, (j + 0.5) * sy]); if (r[2] <= cosT) continue;
      const px = ((r[0] / r[2]) / t + 1) / 2 * N - 0.5, py = (1 - (r[1] / r[2]) / t) / 2 * N - 0.5;
      const x0 = Math.floor(px), y0 = Math.floor(py); if (x0 < 0 || y0 < 0 || x0 >= N - 1 || y0 >= N - 1) continue;
      const fx = px - x0, fy = py - y0; let R = 0, G = 0, B = 0, A = 0;
      for (const [dx, dy, w] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]]) {
        const k = ((y0 + dy) * N + x0 + dx) * 4, a = src[k + 3] * w; R += src[k] * a; G += src[k + 1] * a; B += src[k + 2] * a; A += a; }
      if (A < 0.5) continue; const o = (j * outW + i) * 4; d[o] = R / A; d[o + 1] = G / A; d[o + 2] = B / A; d[o + 3] = A;
    }
    g.putImageData(img, 0, 0); return out;
  }
  // screen copy. Throttled, not debounced: while a clip plays in Figure 3D it still updates (every ~150 ms)
  function preview(cam, S) {
    const f = S.fig3d; if (!f || !f.on || !window.Fig3D) return null;
    const fig = spot(S), outW = Math.min(S.W, 1400), outH = Math.round(outW * S.H / S.W);
    const key = JSON.stringify([cam.C, cam.R, cam.f, cam.k, cam.ox, cam.oy, cam.shear, cam.W, cam.H, fig, f.turn, ver, outW]);
    if (cache && cache.key === key) return cache.canvas;
    want = { cam, fig, turn: f.turn, outW, outH, key };
    if (!timer) timer = setTimeout(() => { timer = 0; const w = want; const c = render(w.cam, w.fig, w.turn, w.outW, w.outH); if (c) { cache = { key: w.key, canvas: c }; Persp.draw(); } }, cache ? 150 : 30);
    return cache ? cache.canvas : null;            // the last picture until the new one is ready
  }
  async function load() {
    const F = await FigureTab.load(); if (!F) return null;
    if (!hooked) { hooked = true; F.on(() => { ver++; if (Persp.S.fig3d && Persp.S.fig3d.on && $('#mode-perspective').classList.contains('on')) Persp.draw(); }); }
    return F;
  }
  return { render, preview, load, view, spot };
})();
