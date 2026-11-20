/*CAM-START*/
// Camera move math. Mirrors animtk/cammove.py (frames, plan, check) so the app and camera_move.py agree.
const CamMath = (() => {
  const r = (v, n) => { const k = Math.pow(10, n); return Math.round(v * k) / k; };
  function ease(t, kind) {
    t = Math.min(Math.max(t, 0), 1);
    if (kind === 'linear') return t;
    if (kind === 'in') return t * t;
    if (kind === 'out') return 1 - (1 - t) * (1 - t);
    return t * t * (3 - 2 * t);
  }
  const sorted = keys => keys.slice().sort((a, b) => a.frame - b.frame);
  // camera per frame from first key to last: position eases in a straight line, zoom changes by equal ratios
  function frames(keys) {
    keys = sorted(keys); const out = [];
    if (keys.length === 1) return [{ frame: Math.trunc(keys[0].frame), x: +keys[0].x, y: +keys[0].y, zoom: +keys[0].zoom }];
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i], b = keys[i + 1], f0 = Math.trunc(a.frame), f1 = Math.trunc(b.frame), last = i === keys.length - 2;
      for (let f = f0; f < f1 + (last ? 1 : 0); f++) {
        const e = ease((f - f0) / Math.max(1, f1 - f0), a.ease || 'inout');
        out.push({ frame: f, x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, zoom: a.zoom * Math.pow(b.zoom / a.zoom, e) });
      }
    }
    return out;
  }
  // canvas size and one row per frame. Same field names as the Python version.
  function plan(keys, W, H, margin) {
    W = W || 3840; H = H || 1920; margin = margin || 0;
    const fr = frames(keys); let zmax = 0, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const f of fr) {
      zmax = Math.max(zmax, f.zoom);
      x0 = Math.min(x0, f.x - W / (2 * f.zoom)); x1 = Math.max(x1, f.x + W / (2 * f.zoom));
      y0 = Math.min(y0, f.y - H / (2 * f.zoom)); y1 = Math.max(y1, f.y + H / (2 * f.zoom));
    }
    x0 -= margin * W; x1 += margin * W; y0 -= margin * H; y1 += margin * H;
    const cw = Math.ceil((x1 - x0) * zmax / 2 - 1e-9) * 2, ch = Math.ceil((y1 - y0) * zmax / 2 - 1e-9) * 2;
    const bcx = (x0 + x1) / 2, bcy = (y0 + y1) / 2, ox = bcx - cw / (2 * zmax), oy = bcy - ch / (2 * zmax);
    const rows = fr.map(f => { const z = f.zoom; return {
      frame: f.frame, x: r(f.x, 2), y: r(f.y, 2), zoom: r(z, 5),
      canvas_cx: r((f.x - ox) * zmax, 1), canvas_cy: r((f.y - oy) * zmax, 1),
      view_w: r(W / z * zmax, 1), view_h: r(H / z * zmax, 1),
      layer_scale: r(z / zmax * 100, 3),
      layer_x: r(W / 2 + (bcx - f.x) * z, 1), layer_y: r(H / 2 + (bcy - f.y) * z, 1),
      place_x: r((f.x - W / (2 * z) - ox) * zmax, 1), place_y: r((f.y - H / (2 * z) - oy) * zmax, 1),
      place_scale: r(zmax / z * 100, 3) }; });
    return { field: [W, H], canvas: [cw, ch], zoom_max: r(zmax, 5), origin: [r(ox, 2), r(oy, 2)], margin,
      keys: sorted(keys).map(k => ({ frame: Math.trunc(k.frame), x: +k.x, y: +k.y, zoom: +k.zoom, ease: k.ease || 'inout' })), rows };
  }
  // worst overhang past the canvas edge in pixels (0 = the move never runs off)
  function check(p) {
    const cw = p.canvas[0], ch = p.canvas[1]; let worst = 0;
    for (const q of p.rows) worst = Math.max(worst, q.view_w / 2 - q.canvas_cx, q.canvas_cx + q.view_w / 2 - cw, q.view_h / 2 - q.canvas_cy, q.canvas_cy + q.view_h / 2 - ch);
    return Math.max(0, worst);
  }
  const COLS = ['frame', 'x', 'y', 'zoom', 'canvas_cx', 'canvas_cy', 'view_w', 'view_h', 'layer_scale', 'layer_x', 'layer_y', 'place_x', 'place_y', 'place_scale'];
  return { ease, frames, plan, check, COLS };
})();
/*CAM-END*/
