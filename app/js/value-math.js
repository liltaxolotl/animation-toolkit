/*VAL-START*/
// Silhouette math for line art. Mirrors animtk/value.py (regions, outside_labels, silhouette_lines, otsu, posterize).
const ValueMath = (() => {
  const INK = 140;
  // grow (or shrink) a 0/1 picture by one pixel in every direction, n times
  function morph(src, w, h, n, grow) {
    let a = src, tmp = new Uint8Array(w * h);
    const edge = grow ? 0 : 1;                                   // outside the picture counts as empty when growing, full when shrinking
    for (let it = 0; it < n; it++) {
      const b = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x, l = x > 0 ? a[i - 1] : edge, c = a[i], rr = x < w - 1 ? a[i + 1] : edge; tmp[i] = grow ? (l | c | rr) : (l & c & rr); }
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x, u = y > 0 ? tmp[i - w] : edge, c = tmp[i], d = y < h - 1 ? tmp[i + w] : edge; b[i] = grow ? (u | c | d) : (u & c & d); }
      a = b;
    }
    return a === src ? src.slice() : a;
  }
  // thicken the ink so small gaps close, then number every patch of paper (0 = ink barrier)
  function regions(gray, w, h, gap) {
    const n = w * h, ink = new Uint8Array(n); for (let i = 0; i < n; i++) ink[i] = gray[i] < INK ? 1 : 0;
    const barrier = gap > 0 ? morph(ink, w, h, gap, true) : ink.slice(), labels = new Int32Array(n), info = [null], stack = new Int32Array(n);
    for (let s = 0; s < n; s++) {
      if (barrier[s] || labels[s]) continue;
      const id = info.length; let area = 0, L = 0, T = 0, R = 0, B = 0, sp = 0; stack[sp++] = s; labels[s] = id;
      while (sp) {
        const i = stack[--sp], x = i % w, y = (i - x) / w; area++;
        if (x === 0) L = 1; if (y === 0) T = 1; if (x === w - 1) R = 1; if (y === h - 1) B = 1;
        if (x > 0 && !barrier[i - 1] && !labels[i - 1]) { labels[i - 1] = id; stack[sp++] = i - 1; }
        if (x < w - 1 && !barrier[i + 1] && !labels[i + 1]) { labels[i + 1] = id; stack[sp++] = i + 1; }
        if (y > 0 && !barrier[i - w] && !labels[i - w]) { labels[i - w] = id; stack[sp++] = i - w; }
        if (y < h - 1 && !barrier[i + w] && !labels[i + w]) { labels[i + w] = id; stack[sp++] = i + w; }
      }
      info.push({ area, sides: L + T + R + B });
    }
    return { ink, barrier, labels, info };
  }
  // which patches are background: see outside_labels in value.py
  function outsideLabels(info, edge) {
    const touching = []; for (let i = 1; i < info.length; i++) if (info[i].sides > 0) touching.push(i);
    const out = new Set(), cut = []; if (!touching.length) return { out, cut };
    let big = touching[0]; for (const i of touching) if (info[i].area > info[big].area) big = i;
    for (const i of touching) { if (edge === 'open' || info[i].sides >= 2 || i === big) out.add(i); else cut.push(i); }
    return { out, cut };
  }
  function labelAt(labels, w, h, x, y) {
    x = Math.trunc(Math.min(Math.max(x, 0), w - 1)); y = Math.trunc(Math.min(Math.max(y, 0), h - 1));
    if (labels[y * w + x]) return labels[y * w + x];
    for (let q = 1; q <= 6; q++) for (let dy = -q; dy <= q; dy++) for (let dx = -q; dx <= q; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && X < w && Y >= 0 && Y < h && labels[Y * w + X]) return labels[Y * w + X]; }
    return 0;
  }
  // line art -> figure mask (1 = black). fills / clears = [[x, y]] in this picture's pixels.
  function silhouetteLines(gray, w, h, gap, fills, clears, edge) {
    const R = regions(gray, w, h, gap), o = outsideLabels(R.info, edge || 'auto'), out = o.out, auto = new Set(out);
    for (const p of clears || []) { const i = labelAt(R.labels, w, h, p[0], p[1]); if (i) out.add(i); }
    for (const p of fills || []) { const i = labelAt(R.labels, w, h, p[0], p[1]); if (i) out.delete(i); }
    const n = w * h; let fig = new Uint8Array(n);
    for (let i = 0; i < n; i++) fig[i] = out.has(R.labels[i]) ? 0 : 1;            // the barrier (label 0) counts until shrunk back
    if (gap > 0) fig = morph(fig, w, h, gap, false);
    for (let i = 0; i < n; i++) if (R.ink[i]) fig[i] = 1;
    return { mask: fig, patches: R.info.length - 1, cut_by_frame: o.cut.filter(i => !out.has(i)).length, labels: R.labels, out, auto };
  }
  // the gray that best splits a picture into a dark group and a light group
  function otsu(gray) {
    const hist = new Float64Array(256), n = gray.length; for (let i = 0; i < n; i++) hist[gray[i]]++;
    let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
    let wB = 0, sumB = 0, best = -1, thr = 0;
    for (let t = 0; t < 256; t++) { wB += hist[t]; if (!wB) continue; const wF = n - wB; if (!wF) break; sumB += t * hist[t]; const mB = sumB / wB, mF = (sum - sumB) / wF, v = wB * wF * (mB - mF) * (mB - mF); if (v > best) { best = v; thr = t; } }
    return thr;
  }
  const posterize = (g, levels) => { if (!levels || levels < 2) return g; const k = levels - 1; return Math.floor(Math.round(g / 255 * k) / k * 255 + 0.5); };
  return { INK, morph, regions, outsideLabels, labelAt, silhouetteLines, otsu, posterize };
})();
/*VAL-END*/
