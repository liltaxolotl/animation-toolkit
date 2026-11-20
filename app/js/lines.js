/*LINES-START*/
// Finds the long straight strokes in a picture and the points they aim at.
// gray = Uint8Array of w * h values (0 black, 255 paper). Segments come back as { a: [x, y], b: [x, y], len }.
const LineFind = (() => {
  const D = Math.PI / 180;
  function segments(gray, w, h, opt) {
    opt = opt || {}; const diag = Math.ceil(Math.hypot(w, h)), minLen = opt.minLen || diag * 0.07, NT = 720, NR = 2 * diag + 1, T = opt.edge || 90;
    const ori = new Float32Array(w * h).fill(NaN), acc = new Int32Array(NT * NR), cs = new Float32Array(NT), sn = new Float32Array(NT);
    for (let t = 0; t < NT; t++) { cs[t] = Math.cos(t * 0.5 * D); sn[t] = Math.sin(t * 0.5 * D); }
    { const tmp = new Float32Array(w * h), sm = new Float32Array(w * h); let src = gray;            // soften first: a hard pixel line has stair steps, and stair steps face the wrong way
      for (let pass = 0; pass < 2; pass++) { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; tmp[i] = (src[x > 0 ? i - 1 : i] + 2 * src[i] + src[x < w - 1 ? i + 1 : i]) / 4; }
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; sm[i] = (tmp[y > 0 ? i - w : i] + 2 * tmp[i] + tmp[y < h - 1 ? i + w : i]) / 4; } src = sm; }
      gray = sm; }
    const mag = new Float32Array(w * h), dir = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x;            // edges, and which way each one faces (a stroke has two: one facing each way)
      const gx = gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1] - gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1], gy = gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1] - gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1], m = gx * gx + gy * gy;
      if (m >= T * T) { mag[i] = m; dir[i] = Math.atan2(gy, gx); } }
    for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) { const i = y * w + x, m = mag[i]; if (!m) continue;      // keep only the crest of each edge, one pixel wide
      const sx = Math.round(Math.cos(dir[i])), sy = Math.round(Math.sin(dir[i])); if (m < mag[i + sy * w + sx] || m <= mag[i - sy * w - sx]) continue;
      let a = dir[i] / D; if (a < 0) a += 360; if (a >= 360) a -= 360; ori[i] = a;
      const t0 = Math.round(a * 2); for (let k = -16; k <= 16; k++) { const t = ((t0 + k) % NT + NT) % NT; acc[t * NR + Math.round(x * cs[t] + y * sn[t]) + diag]++; } }      // every edge votes for the lines it could lie on: the ones within 8 degrees of the way it faces
    const peaks = [], minV = minLen * 0.6;
    for (let t = 0; t < NT; t++) for (let r = 1; r < NR - 1; r++) { const v = acc[t * NR + r]; if (v >= minV && v >= acc[t * NR + r - 1] && v >= acc[t * NR + r + 1]) peaks.push([v, t, r]); }
    peaks.sort((u, v) => v[0] - u[0]); const kept = [];
    for (const pk of peaks) { if (kept.length >= 400) break; if (!kept.some(q => { const dt = Math.abs(q[1] - pk[1]); return Math.min(dt, NT - dt) <= 5 && Math.abs(q[2] - pk[2]) <= 4; })) kept.push(pk); }
    const turn = (o, th) => { const df = Math.abs(o - th) % 360; return df > 180 ? 360 - df : df; };
    const walk = (nx, ny, rho, th, band) => {                                      // the unbroken stretches of one edge along a line: every crest pixel close to it that faces the same way
      const ux = -ny, uy = nx, bx = rho * nx, by = rho * ny, runs = []; let run = null, gap = 0; const flush = () => { if (run && run.steps >= 8) runs.push(run); run = null; gap = 0; };
      for (let q = -diag; q <= diag; q++) { const x = bx + ux * q, y = by + uy * q; if (x < 4 || y < 4 || x >= w - 4 || y >= h - 4) { flush(); continue; } let hit = false;
        for (let k = -band; k <= band; k++) { const xi = Math.round(x + nx * k), yi = Math.round(y + ny * k), o = ori[yi * w + xi]; if (o === o && turn(o, th) < 14) { if (!run) run = { pts: [], steps: 0 }; run.pts.push(xi, yi); hit = true; } }
        if (hit) { run.steps++; gap = 0; } else if (run && ++gap > 10) flush(); }
      flush(); return runs; };
    const fitLine = (pts, th0) => {                                                // the straight line that fits a run of edge pixels best (pts = x, y, x, y, ...), facing the way th0 does
      const n = pts.length / 2; let mx = 0, my = 0; for (let i = 0; i < pts.length; i += 2) { mx += pts[i]; my += pts[i + 1]; } mx /= n; my /= n; let sxx = 0, sxy = 0, syy = 0; for (let i = 0; i < pts.length; i += 2) { const dx = pts[i] - mx, dy = pts[i + 1] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
      const an = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(an), uy = Math.sin(an); let lo = 1e9, hi = -1e9, res = 0; for (let i = 0; i < pts.length; i += 2) { const dx = pts[i] - mx, dy = pts[i + 1] - my, t = dx * ux + dy * uy, e = dx * uy - dy * ux; res += e * e; if (t < lo) lo = t; if (t > hi) hi = t; }
      let nx = -uy, ny = ux; if (nx * Math.cos(th0 * D) + ny * Math.sin(th0 * D) < 0) { nx = -nx; ny = -ny; } let th = Math.atan2(ny, nx) / D; if (th < 0) th += 360; return { mx, my, ux, uy, lo, hi, th, nx, ny, rms: Math.sqrt(res / n) }; };
    const raw = [];
    for (const [, t, r] of kept) for (const run of walk(cs[t], sn[t], r - diag, t * 0.5, 3)) { if (run.steps < minLen * 0.4) continue; let f = fitLine(run.pts, t * 0.5), cur = run;
      for (let pass = 0; pass < 4; pass++) { let top = null;                       // walk again along the fitted line, closer in: it follows the stroke further than the first guess did
        for (const r2 of walk(f.nx, f.ny, f.mx * f.nx + f.my * f.ny, f.th, 2)) { const m = (r2.pts.length >> 2) * 2, tc = (r2.pts[m] - f.mx) * f.ux + (r2.pts[m + 1] - f.my) * f.uy; if (tc > f.lo - 4 && tc < f.hi + 4 && (!top || r2.steps > top.steps)) top = r2; }
        if (!top || top.steps < cur.steps * 0.9) break; cur = top; f = fitLine(cur.pts, f.th); }
      const len = f.hi - f.lo; if (len >= minLen && cur.steps >= len * 0.7 && f.rms < 1.3) raw.push({ a: [f.mx + f.ux * f.lo, f.my + f.uy * f.lo], b: [f.mx + f.ux * f.hi, f.my + f.uy * f.hi], len, th: f.th % 180 }); }
    raw.sort((u, v) => v.len - u.len); const out = [];                             // a stroke has two edges, and each can be found twice: keep the longest of each bundle
    for (const g of raw) { const mx = (g.a[0] + g.b[0]) / 2, my = (g.a[1] + g.b[1]) / 2;
      if (!out.some(k => { let df = Math.abs(k.th - g.th); if (df > 90) df = 180 - df; if (df > 3) return false; const dx = k.b[0] - k.a[0], dy = k.b[1] - k.a[1], n = k.len || 1, along = ((mx - k.a[0]) * dx + (my - k.a[1]) * dy) / n, off = Math.abs((mx - k.a[0]) * dy - (my - k.a[1]) * dx) / n; return off < 9 && along > -g.len / 2 && along < k.len + g.len / 2; })) out.push(g); }
    return out.map(g => ({ a: g.a, b: g.b, len: g.len }));
  }
  const missDeg = (g, p) => { const dx = g.b[0] - g.a[0], dy = g.b[1] - g.a[1], n = Math.hypot(dx, dy) || 1, tx = p[0] - (g.a[0] + g.b[0]) / 2, ty = p[1] - (g.a[1] + g.b[1]) / 2, tn = Math.hypot(tx, ty) || 1; return Math.asin(Math.min(1, Math.abs(dx / n * ty / tn - dy / n * tx / tn))) / D; };
  function cross(g, k) { const x1 = g.a[0], y1 = g.a[1], x2 = g.b[0], y2 = g.b[1], x3 = k.a[0], y3 = k.a[1], x4 = k.b[0], y4 = k.b[1], den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4); if (Math.abs(den) < 1e-9) return null;
    const u = x1 * y2 - y1 * x2, v = x3 * y4 - y3 * x4; return [(u * (x3 - x4) - (x1 - x2) * v) / den, (u * (y3 - y4) - (y1 - y2) * v) / den]; }
  function meet(list) {                                                            // the point closest to all the lines, longer lines counting more
    let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0; for (const g of list) { const dx = g.b[0] - g.a[0], dy = g.b[1] - g.a[1], n = Math.hypot(dx, dy) || 1, nx = dy / n, ny = -dx / n, c = nx * g.a[0] + ny * g.a[1], wt = g.len || n; a11 += wt * nx * nx; a12 += wt * nx * ny; a22 += wt * ny * ny; b1 += wt * nx * c; b2 += wt * ny * c; }
    const det = a11 * a22 - a12 * a12; return Math.abs(det) < 1e-7 * (a11 + a22) * (a11 + a22) ? null : [(b1 * a22 - b2 * a12) / det, (a11 * b2 - a12 * b1) / det];
  }
  function best(pool, tol) { let top = null; for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) { const p = cross(pool[i], pool[j]); if (!p) continue; let score = 0; const inl = []; for (const g of pool) if (missDeg(g, p) < tol) { score += g.len; inl.push(g); } if (!top || score > top.score) top = { p, score, inl }; } return top; }
  // Sorts segments into up to two vanishing points (A = the one nearest the middle of the picture = depth, B = side) and converging uprights (V).
  // A point is only believed when at least 3 strokes carrying a quarter of the remaining ink agree on it: characters make straight lines too.
  // flat = strokes that run parallel to each other (level edges, say), which get no point.
  function vps(segs, w, h, opt) {
    opt = opt || {}; const tol = opt.tol || 1.5, share = opt.share || 0.25, up = [], pool = [];
    for (const g of segs) { const a = Math.abs(Math.atan2(g.b[0] - g.a[0], g.b[1] - g.a[1]) / D); (a < 20 || a > 160 ? up : pool).push(g); }
    const found = [], flat = [], mid = [w / 2, h / 2], far = b => Math.hypot(b.p[0] - mid[0], b.p[1] - mid[1]), diag = Math.hypot(w, h); let rest = pool.slice();
    const spread = inl => { let sx = 0, sy = 0, n = 0, e = 0; for (const g of inl) { const a = 2 * Math.atan2(g.b[1] - g.a[1], g.b[0] - g.a[0]); sx += g.len * Math.cos(a); sy += g.len * Math.sin(a); } const m = Math.atan2(sy, sx) / 2;       // how far from parallel a bundle is, in degrees
      for (const g of inl) { let d = (Math.atan2(g.b[1] - g.a[1], g.b[0] - g.a[0]) - m) / D; d -= 180 * Math.round(d / 180); e += g.len * d * d; n += g.len; } return Math.sqrt(e / n); };
    const miss = (inl, p) => { let e = 0, n = 0; for (const g of inl) { const d = missDeg(g, p); e += g.len * d * d; n += g.len; } return Math.sqrt(e / n); };
    const parallel = b => far(b) > 12 * diag || (far(b) > 3 * diag && miss(b.inl, b.p) > 0.6 * spread(b.inl));        // a far point has to explain the strokes clearly better than "these are just parallel" does
    for (let k = 0; k < 5 && found.length < 2; k++) { const total = rest.reduce((u, g) => u + g.len, 0), b = rest.length >= 3 ? best(rest, tol) : null; if (!b || b.inl.length < 3 || b.score < total * share) break;
      b.p = meet(b.inl) || b.p; rest = rest.filter(g => !b.inl.includes(g)); if (parallel(b)) flat.push(...b.inl); else found.push(b); }       // strokes that are simply parallel (level edges, say) get no point
    found.sort((u, v) => far(u) - far(v));
    let V = [], vpV = null; if (found.length < 2 && up.length >= 3) { const b = best(up, tol); if (b && b.inl.length >= 3 && b.score >= up.reduce((u, g) => u + g.len, 0) * 0.5 && Math.abs(b.p[1] - h / 2) < 12 * h) { V = b.inl; vpV = meet(V) || b.p; } }
    const A = found[0] ? found[0].inl : [], B = found[1] ? found[1].inl : [];
    return { A, B, V, flat, vpA: found[0] ? found[0].p : null, vpB: found[1] ? found[1].p : null, vpV, rest: segs.filter(g => !A.includes(g) && !B.includes(g) && !V.includes(g)) };
  }
  // Which strokes sit on the grid and which drift: a stroke that nearly aims at a vanishing point (between lo and hi degrees off) is drifting.
  function drift(segs, pts, lo, hi, cap) {
    const on = [], off = []; for (const g of segs) { let bg = '', bd = 1e9; for (const n in pts) { const dg = missDeg(g, pts[n]); if (dg < bd) { bd = dg; bg = n; } } if (!bg) continue; if (bd <= lo) on.push(g); else if (bd < hi) off.push({ seg: g, group: bg, deg: bd }); }
    off.sort((u, v) => v.deg * v.seg.len - u.deg * u.seg.len); return { on, off: off.slice(0, cap || 8), more: Math.max(0, off.length - (cap || 8)) };
  }
  return { segments, vps, drift, missDeg, meet };
})();
/*LINES-END*/
