/*CORE-START*/
// Camera + prop math. Mirrors animtk/scene3d.py line for line so the app and the scripts agree.
const AT = (() => {
  const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]], add = (a, b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
  const mul = (a, s) => [a[0]*s, a[1]*s, a[2]*s], dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
  const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const len = a => Math.hypot(a[0], a[1], a[2]), norm = a => mul(a, 1 / (len(a) || 1));
  const I3 = [[1,0,0],[0,1,0],[0,0,1]];

  function basis(fwd, roll) {
    let right = cross([0,1,0], fwd); if (len(right) < 1e-9) right = [1,0,0]; right = norm(right);
    const up = cross(fwd, right), r = rad(roll || 0), c = Math.cos(r), s = Math.sin(r);
    return [add(mul(right, c), mul(up, s)), add(mul(right, -s), mul(up, c)), fwd];
  }
  function anglesToR(yaw, pitch, roll) {
    const y = rad(yaw), p = rad(pitch);
    return basis([Math.sin(y)*Math.cos(p), Math.sin(p), Math.cos(y)*Math.cos(p)], roll);
  }
  function rToAngles(R) {
    const f = R[2], b = basis(f, 0);
    return { yaw: deg(Math.atan2(f[0], f[2])), pitch: deg(Math.asin(clamp(f[1], -1, 1))), roll: deg(Math.atan2(dot(R[0], b[1]), dot(R[0], b[0]))) };
  }
  // o: {pos, R | yaw,pitch,roll, fov, k, skew, W, H}
  function makeCamera(o) {
    const W = o.W || 3840, H = o.H || 1920, k = Math.max(o.k == null ? 1 : o.k, 1e-3), fov = o.fov || 60;
    return { C: (o.pos || [0,5,0]).slice(), R: o.R || anglesToR(o.yaw || 0, o.pitch || 0, o.roll || 0), k, fov, W, H,
             f: (W/2) * k / Math.tan(Math.min(k * rad(fov/2), 1.5)), skew: o.skew || 0, shear: Math.tan(rad(o.skew || 0)), roll: o.roll || 0, ox: (o.shift && o.shift[0]) || 0, oy: (o.shift && o.shift[1]) || 0 };      // ox, oy: how far the lens centre sits from the middle of the picture (3 point drawings)
  }
  const toCam = (cam, P) => { const d = sub(P, cam.C); return [dot(cam.R[0], d), dot(cam.R[1], d), dot(cam.R[2], d)]; };
  function projectCam(cam, c) {
    const th = Math.atan2(Math.hypot(c[0], c[1]), c[2]), ph = Math.atan2(c[1], c[0]);
    const r = cam.f * Math.tan(Math.min(cam.k * th, 1.5)) / cam.k;
    const cx = cam.W/2 + cam.ox, cy = cam.H/2 + cam.oy, u = cx + r*Math.cos(ph), v = cy - r*Math.sin(ph);
    return [u + cam.shear * (v - cy), v];
  }
  const project = (cam, P) => projectCam(cam, toCam(cam, P));
  function rayCam(cam, uv) {
    const cx = cam.W/2 + cam.ox, cy = cam.H/2 + cam.oy, v = uv[1], u = uv[0] - cam.shear * (v - cy);
    const x = u - cx, y = -(v - cy), r = Math.hypot(x, y);
    const th = Math.atan(r * cam.k / cam.f) / cam.k, ph = Math.atan2(y, x);
    return [Math.sin(th)*Math.cos(ph), Math.sin(th)*Math.sin(ph), Math.cos(th)];
  }
  function ray(cam, uv) { const d = rayCam(cam, uv); return add(add(mul(cam.R[0], d[0]), mul(cam.R[1], d[1])), mul(cam.R[2], d[2])); }
  function planePoint(cam, uv, y) {            // spot on the level plane at height y under a pixel
    const d = ray(cam, uv); if (Math.abs(d[1]) < 1e-9) return null;
    const t = ((y || 0) - cam.C[1]) / d[1]; return t <= 0 ? null : add(cam.C, mul(d, t));
  }
  function vanishingPoint(cam, dir) {
    let d = [dot(cam.R[0], dir), dot(cam.R[1], dir), dot(cam.R[2], dir)];
    if (d[2] < 0) d = mul(d, -1); if (d[2] < 1e-6) return null; return projectCam(cam, d);
  }
  function solveFov(p1, p2, o) {              // lens width that puts two vanishing points 90 degrees apart
    const g = fov => { const c = makeCamera({ ...o, fov, R: I3 }); return dot(rayCam(c, p1), rayCam(c, p2)); };
    let lo = 2, hi = 170, a = g(lo), b = g(hi); if (a * b > 0) return null;
    for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2, gm = g(m); if (a * gm <= 0) { hi = m; b = gm; } else { lo = m; a = gm; } }
    return (lo + hi) / 2;
  }
  // Three vanishing points (depth, side, upright): the lens width and lens centre that put all three 90 degrees apart, or null.
  // With a plain lens the centre is where the heights of the triangle cross; a bent or skewed lens is polished from there.
  function solveThree(pA, pB, pV, o) {
    const W = o.W || 3840, H = o.H || 1920, e1 = [pB[0] - pV[0], pB[1] - pV[1]], e2 = [pA[0] - pV[0], pA[1] - pV[1]], det = e1[0] * e2[1] - e1[1] * e2[0]; if (Math.abs(det) < 1e-9) return null;
    const c1 = pA[0] * e1[0] + pA[1] * e1[1], c2 = pB[0] * e2[0] + pB[1] * e2[1], hx = (c1 * e2[1] - e1[1] * c2) / det, hy = (e1[0] * c2 - c1 * e2[0]) / det;
    const f2 = -((pA[0] - hx) * (pB[0] - hx) + (pA[1] - hy) * (pB[1] - hy)); if (!(f2 > 0)) return null;
    let q = [hx - W / 2, hy - H / 2, deg(2 * Math.atan(W / 2 / Math.sqrt(f2)))];
    const F = q => { const c = makeCamera({ ...o, fov: q[2], shift: [q[0], q[1]], R: I3 }), a = rayCam(c, pA), b = rayCam(c, pB), v = rayCam(c, pV); return [dot(a, b), dot(a, v), dot(b, v)]; };
    const det3 = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    for (let it = 0; it < 40; it++) { const f0 = F(q); if (Math.max(Math.abs(f0[0]), Math.abs(f0[1]), Math.abs(f0[2])) < 1e-10) break;
      const J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], st = [0.5, 0.5, 0.01]; for (let j = 0; j < 3; j++) { const q2 = q.slice(); q2[j] += st[j]; const f1 = F(q2); for (let i = 0; i < 3; i++) J[i][j] = (f1[i] - f0[i]) / st[j]; }
      const d = det3(J); if (Math.abs(d) < 1e-30) break; const step = [0, 1, 2].map(j => det3(J.map((row, i) => row.map((v, k) => k === j ? -f0[i] : v))) / d);
      q = [q[0] + step[0], q[1] + step[1], clamp(q[2] + clamp(step[2], -20, 20), 2, 170)]; }
    const fe = F(q); return Math.max(Math.abs(fe[0]), Math.abs(fe[1]), Math.abs(fe[2])) < 1e-6 && q[2] > 2 && q[2] < 170 ? { fov: q[2], shift: [q[0], q[1]] } : null;
  }
  // vpA = depth (world z), vpB = side (world x, optional), vpV = uprights (world y, optional).
  // Depth + side give the lens width. All three give the lens width and where the lens centre sits (shift).
  function cameraFromVPs(vpA, vpB, vpV, o) {
    let fov = o.fov || 60, solved = false, shift = null; const notes = [];
    if (vpB && vpV && o.solveLens !== false) {
      const t = solveThree(vpA, vpB, vpV, o);
      if (t) { fov = t.fov; shift = t.shift; solved = true; }
      else notes.push('The three points cannot all be 90 degrees apart with any lens, so the upright point is left out.');
    }
    if (!shift && vpB && o.solveLens !== false) {
      const f = solveFov(vpA, vpB, o);
      if (f == null) notes.push('Depth and side points cannot be 90 degrees apart with any lens. Lens width left alone.');
      else { fov = f; solved = true; }
    }
    const c0 = makeCamera({ ...o, fov, shift, R: I3 }), zc = rayCam(c0, vpA); let xc, yc;
    if (vpB) {
      xc = rayCam(c0, vpB); xc = norm(sub(xc, mul(zc, dot(xc, zc)))); yc = cross(zc, xc);
      if (yc[1] < 0) { xc = mul(xc, -1); yc = mul(yc, -1); }
    } else {
      let g; if (vpV) { g = rayCam(c0, vpV); if (g[1] < 0) g = mul(g, -1); } else { const r = rad(o.roll || 0); g = [Math.sin(r), Math.cos(r), 0]; }
      yc = norm(sub(g, mul(zc, dot(g, zc)))); xc = cross(yc, zc);
    }
    return { R: [[xc[0], yc[0], zc[0]], [xc[1], yc[1], zc[1]], [xc[2], yc[2], zc[2]]], fov, solved, notes, shift };
  }
  // 2D: point closest to a bunch of drawn lines [{a:[x,y], b:[x,y]}]
  function lsqPoint(lines) {
    if (lines.length < 2) return null;
    let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0, mx = 0, my = 0;
    for (const l of lines) {
      let dx = l.b[0]-l.a[0], dy = l.b[1]-l.a[1]; const n = Math.hypot(dx, dy) || 1; const nx = dy/n, ny = -dx/n, c = nx*l.a[0] + ny*l.a[1];
      a11 += nx*nx; a12 += nx*ny; a22 += ny*ny; b1 += nx*c; b2 += ny*c;
      if (dx < 0 || (dx === 0 && dy < 0)) { dx = -dx; dy = -dy; } mx += dx/n; my += dy/n;
    }
    const det = a11*a22 - a12*a12;
    if (Math.abs(det) < 1e-7) { const m = Math.hypot(mx, my) || 1; return [lines[0].a[0] + mx/m*1e7, lines[0].a[1] + my/m*1e7]; }   // parallel
    return [(b1*a22 - b2*a12) / det, (a11*b2 - a12*b1) / det];
  }
  function missOf(l, vp) {                    // {px, deg}: how far a drawn line misses a point
    const dx = l.b[0]-l.a[0], dy = l.b[1]-l.a[1], n = Math.hypot(dx, dy) || 1;
    const px = Math.abs((vp[0]-l.a[0]) * (-dy/n) + (vp[1]-l.a[1]) * (dx/n));
    const mx = (l.a[0]+l.b[0])/2, my = (l.a[1]+l.b[1])/2, tx = vp[0]-mx, ty = vp[1]-my, tn = Math.hypot(tx, ty) || 1;
    return { px, deg: deg(Math.asin(clamp(Math.abs(dx/n*ty/tn - dy/n*tx/tn), 0, 1))) };
  }

  // ---------- props: each returns {lines:[[p,p,...]], faces:[[p,p,p,p]]} in its own space
  const DEF = {
    box: { w: 2, h: 2, d: 2 }, cylinder: { r: 0.5, h: 1.5 }, bottle: { r: 0.25, h: 1.4 }, jar: { r: 0.35, h: 1.0 },
    shelf: { w: 4, h: 6, d: 1, shelves: 3 }, cabinet: { w: 3, h: 3, d: 1.5, shelves: 1, doors: 2, swing: 30 },
    door: { w: 3, h: 6.8, swing: 45, hinge: 'left' }
  };
  function boxGeo(x0, x1, y0, y1, z0, z1, f) {
    f = f || ((x, y, z) => [x, y, z]);
    const c = [f(x0,y0,z0), f(x1,y0,z0), f(x1,y1,z0), f(x0,y1,z0), f(x0,y0,z1), f(x1,y0,z1), f(x1,y1,z1), f(x0,y1,z1)];
    const E = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
    const F = [[0,1,2,3],[4,5,6,7],[0,4,7,3],[1,5,6,2],[3,2,6,7],[0,1,5,4]];
    return { lines: E.map(e => [c[e[0]], c[e[1]]]), faces: F.map(q => q.map(i => c[i])) };
  }
  const merge = gs => ({ lines: [].concat(...gs.map(g => g.lines)), faces: [].concat(...gs.map(g => g.faces || [])), rounds: [].concat(...gs.map(g => g.rounds || [])) });
  function ringPts(y, r, n) { const o = []; for (let i = 0; i <= n; i++) { const t = i / n * 2 * Math.PI; o.push([r*Math.cos(t), y, r*Math.sin(t)]); } return o; }
  // rounds = stacked circles [y, r]; the outline between them is added per view in propWorld()
  function roundGeo(levels) { return { lines: levels.map(l => ringPts(l[0], l[1], 40)), faces: [], rounds: [levels] }; }
  function shelfGeo(p) {
    const w = p.w, h = p.h, d = p.d, t = p.t || 0.08, n = Math.max(0, Math.round(p.shelves || 0));
    const parts = [[-w/2, -w/2+t, 0, h], [w/2-t, w/2, 0, h], [-w/2, w/2, 0, t], [-w/2, w/2, h-t, h]];
    for (let i = 1; i <= n; i++) { const y = h*i/(n+1); parts.push([-w/2+t, w/2-t, y-t/2, y+t/2]); }
    const g = merge(parts.map(q => boxGeo(q[0], q[1], q[2], q[3], -d/2, d/2)));
    g.faces.push([[-w/2,0,d/2],[w/2,0,d/2],[w/2,h,d/2],[-w/2,h,d/2]]); return g;
  }
  function doorGeo(p, frame, off) {
    const w = p.w, h = p.h, t = p.t || 0.12, s = p.hinge === 'right' ? 1 : -1, hx = s*w/2, a = rad(p.swing || 0);
    off = off || [0, 0, 0];
    const sw = (x, y, z) => [hx - s*(x*Math.cos(a) - z*Math.sin(a)) + off[0], y + off[1], -(x*Math.sin(a) + z*Math.cos(a)) + off[2]];
    const gs = [boxGeo(0, w, 0, h, -t/2, t/2, sw)];
    if (frame) { const f = 0.25; for (const q of [[-w/2-f, -w/2, 0, h+f], [w/2, w/2+f, 0, h+f], [-w/2, w/2, h, h+f]]) gs.push(boxGeo(q[0], q[1], q[2], q[3], -t, t, (x, y, z) => [x+off[0], y+off[1], z+off[2]])); }
    const g = merge(gs);
    g.lines.push([sw(w*0.88, h*0.47, -t), sw(w*0.88, h*0.47, -t-0.25)]);
    if (Math.abs(p.swing || 0) > 1) { const arc = []; for (let i = 0; i <= 40; i++) { const b = a*i/40; arc.push([hx - s*w*Math.cos(b) + off[0], 0.01 + off[1], -w*Math.sin(b) + off[2]]); } g.lines.push(arc); g.arcIndex = g.lines.length - 1; }
    return g;
  }
  function propLocal(p) {
    const q = { ...DEF[p.type], ...p };
    switch (p.type) {
      case 'box': return boxGeo(-q.w/2, q.w/2, 0, q.h, -q.d/2, q.d/2);
      case 'cylinder': return roundGeo([[0, q.r], [q.h, q.r]]);
      case 'bottle': { const nr = q.neck_r == null ? q.r*0.38 : q.neck_r, nh = q.neck_h == null ? q.h*0.28 : q.neck_h, bh = q.h - nh - q.r*0.6;
        return roundGeo([[0, q.r], [bh, q.r], [q.h - nh, nr], [q.h, nr]]); }
      case 'jar': { const lh = q.lid_h == null ? q.h*0.16 : q.lid_h, bh = q.h - lh, lr = q.r*1.06; return merge([roundGeo([[0, q.r], [bh, q.r]]), roundGeo([[bh, lr], [q.h, lr]])]); }
      case 'shelf': return shelfGeo(q);
      case 'door': return doorGeo(q, q.frame !== false);
      case 'cabinet': { const gs = [shelfGeo(q)], t = q.t || 0.08, n = Math.round(q.doors || 0);
        if (n === 1) gs.push(doorGeo({ w: q.w, h: q.h, swing: q.swing, hinge: 'left', t }, false, [0, 0, -q.d/2]));
        else if (n >= 2) { gs.push(doorGeo({ w: q.w/2, h: q.h, swing: q.swing, hinge: 'left', t }, false, [-q.w/4, 0, -q.d/2])); gs.push(doorGeo({ w: q.w/2, h: q.h, swing: q.swing, hinge: 'right', t }, false, [q.w/4, 0, -q.d/2])); }
        return merge(gs); }
    }
    return { lines: [], faces: [] };
  }
  // world-space geometry for a prop, including the outline of round shapes as seen from camPos
  function propWorld(p, camPos) {
    const g = propLocal(p), a = rad(p.rot || 0), c = Math.cos(a), s = Math.sin(a), pos = p.pos || [0,0,0];
    const T = v => [v[0]*c + v[2]*s + pos[0], v[1] + pos[1], -v[0]*s + v[2]*c + pos[2]];
    const out = { lines: g.lines.map(L => L.map(T)), faces: (g.faces || []).map(F => F.map(T)) };
    if (camPos) for (const levels of (g.rounds || [])) {
      const dx = camPos[0] - pos[0], dz = camPos[2] - pos[2], dist = Math.hypot(dx, dz), p0 = Math.atan2(dz, dx);
      for (const sgn of [-1, 1]) { const L = []; for (const [y, r] of levels) { if (dist <= r) continue; const t = p0 + sgn * Math.acos(r / dist); L.push([pos[0] + r*Math.cos(t), pos[1] + y, pos[2] + r*Math.sin(t)]); } if (L.length > 1) out.lines.push(L); }
    }
    return out;
  }
  // project a 3D polyline to pixel pieces, splitting where it goes behind the camera
  function polyPieces(cam, pts, n) {
    n = n || 12; const out = []; let seg = [];
    const push = P => { const c = toCam(cam, P); if (c[2] > 0.05) { const uv = projectCam(cam, c); if (Math.abs(uv[0]) < 40000 && Math.abs(uv[1]) < 40000) { seg.push(uv); return; } } if (seg.length > 1) out.push(seg); seg = []; };
    for (let i = 0; i < pts.length - 1; i++) for (let j = 0; j < n; j++) { const t = j / n; push([pts[i][0] + (pts[i+1][0]-pts[i][0])*t, pts[i][1] + (pts[i+1][1]-pts[i][1])*t, pts[i][2] + (pts[i+1][2]-pts[i][2])*t]); }
    push(pts[pts.length - 1]); if (seg.length > 1) out.push(seg); return out;
  }
  return { rad, deg, clamp, sub, add, mul, dot, cross, len, norm, basis, anglesToR, rToAngles, makeCamera, toCam, projectCam, project,
           rayCam, ray, planePoint, vanishingPoint, solveFov, solveThree, cameraFromVPs, lsqPoint, missOf, DEF, propLocal, propWorld, polyPieces };
})();
/*CORE-END*/
