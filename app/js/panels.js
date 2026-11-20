/*PANELS-START*/
// Finding storyboard panels on a page. Two ways, tried in order:
//   1. bordered panels: the white gutter is everything light that the page edge can reach. Whatever it cannot
//      reach is a panel (border + drawing inside). Kept when it fills its own box (a closed frame does).
//   2. no borders: split the page along empty rows, then empty columns (an XY cut), and trim each piece to its ink.
// gray: Uint8Array (0 black .. 255 white), w x h, already scaled down (about 900 px wide is plenty).
// -> {panels: [{x, y, w, h, use}], how: 'borders' | 'gaps' | 'none', note}
const Panels = (() => {
  const DARK = 165;
  function gutter(gray, w, h, x0, y0, x1, y1) {   // flood the light pixels reachable from the edge of the box
    const g = new Uint8Array(w * h), st = [];
    const push = (x, y) => { const i = y * w + x; if (!g[i] && gray[i] >= DARK) { g[i] = 1; st.push(i); } };
    for (let x = x0; x <= x1; x++) { push(x, y0); push(x, y1); }
    for (let y = y0; y <= y1; y++) { push(x0, y); push(x1, y); }
    while (st.length) { const i = st.pop(), x = i % w, y = (i - x) / w;
      if (x > x0) push(x - 1, y); if (x < x1) push(x + 1, y); if (y > y0) push(x, y - 1); if (y < y1) push(x, y + 1); }
    return g;
  }
  function blobs(g, w, h, x0, y0, x1, y1) {        // boxes of everything the gutter did not reach (8-connected)
    const seen = new Uint8Array(w * h), out = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i0 = y * w + x; if (g[i0] || seen[i0]) continue;
      let n = 0, bx0 = x, bx1 = x, by0 = y, by1 = y; const st = [i0]; seen[i0] = 1;
      while (st.length) { const i = st.pop(), px = i % w, py = (i - px) / w; n++;
        if (px < bx0) bx0 = px; if (px > bx1) bx1 = px; if (py < by0) by0 = py; if (py > by1) by1 = py;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const qx = px + dx, qy = py + dy; if (qx < x0 || qx > x1 || qy < y0 || qy > y1) continue; const j = qy * w + qx; if (!g[j] && !seen[j]) { seen[j] = 1; st.push(j); } } }
      out.push({ x: bx0, y: by0, w: bx1 - bx0 + 1, h: by1 - by0 + 1, n });
    }
    return out;
  }
  function bordered(gray, w, h, box, depth) {
    const g = gutter(gray, w, h, box.x, box.y, box.x + box.w - 1, box.y + box.h - 1);
    const area = box.w * box.h, found = blobs(g, w, h, box.x, box.y, box.x + box.w - 1, box.y + box.h - 1)
      .filter(b => b.w * b.h > area * 0.012 && b.w > box.w * 0.06 && b.h > box.h * 0.04 && b.n / (b.w * b.h) > 0.82);
    let out = [];
    for (const b of found) {
      // one frame around everything (a page border): look inside it, just past its line
      if (depth < 2 && b.w * b.h > area * 0.45) { const t = Math.max(3, Math.round(Math.min(b.w, b.h) * 0.012)), inner = { x: b.x + t, y: b.y + t, w: b.w - 2 * t, h: b.h - 2 * t }, sub = bordered(gray, w, h, inner, depth + 1); if (sub.length >= 2) { out.push(...sub); continue; } }
      out.push(b);
    }
    return out;
  }
  function inkProfile(gray, w, x0, y0, x1, y1, rows) {
    const n = rows ? y1 - y0 + 1 : x1 - x0 + 1, p = new Float32Array(n);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (gray[y * w + x] < DARK) p[rows ? y - y0 : x - x0]++;
    return p;
  }
  function cuts(p, minGap, len) {                    // runs of non-empty rows (or columns) separated by empty gaps
    const tol = Math.max(1, len * 0.003), out = []; let s = -1, gap = 0;
    for (let i = 0; i < p.length; i++) { if (p[i] > tol) { if (s < 0) s = i; gap = 0; } else if (s >= 0) { gap++; if (gap >= minGap) { out.push([s, i - gap]); s = -1; gap = 0; } } }
    if (s >= 0) out.push([s, p.length - 1 - gap]);
    return out;
  }
  function xycut(gray, w, h) {
    const out = [], minR = Math.max(4, Math.round(h * 0.015)), minC = Math.max(4, Math.round(w * 0.015));
    for (const [r0, r1] of cuts(inkProfile(gray, w, 0, 0, w - 1, h - 1, true), minR, w)) {
      for (const [c0, c1] of cuts(inkProfile(gray, w, 0, r0, w - 1, r1, false), minC, r1 - r0 + 1)) {
        const rr = cuts(inkProfile(gray, w, c0, r0, c1, r1, true), minR, c1 - c0 + 1);     // trim the piece to its ink
        if (!rr.length) continue; const y0 = r0 + rr[0][0], y1 = r0 + rr[rr.length - 1][1];
        out.push({ x: c0, y: y0, w: c1 - c0 + 1, h: y1 - y0 + 1 });
      }
    }
    return out.filter(b => b.w * b.h > w * h * 0.015 && b.w > w * 0.06 && b.h > h * 0.04);
  }
  // reading order: rows top to bottom (boxes whose middles overlap in height are one row), then left to right
  function order(list) {
    const L = list.slice().sort((a, b) => a.y - b.y), rows = [];
    for (const b of L) { const cy = b.y + b.h / 2, r = rows.find(r => cy > r.y0 && cy < r.y1); if (r) { r.items.push(b); r.y0 = Math.min(r.y0, b.y); r.y1 = Math.max(r.y1, b.y + b.h); } else rows.push({ y0: b.y, y1: b.y + b.h, items: [b] }); }
    rows.sort((a, b) => a.y0 - b.y0); return rows.flatMap(r => r.items.sort((a, b) => a.x - b.x));
  }
  // boxes that are nothing like the rest (a dialogue box, a title block) are kept but switched off
  function markOdd(list) {
    if (list.length < 3) return list.map(b => ({ ...b, use: true }));
    const med = a => { const s = a.slice().sort((u, v) => u - v); return s[s.length >> 1]; };
    const ar = med(list.map(b => b.w / b.h)), ac = med(list.map(b => b.w * b.h));
    return list.map(b => ({ ...b, use: Math.abs(Math.log((b.w / b.h) / ar)) < 0.35 && b.w * b.h > ac * 0.4 && b.w * b.h < ac * 2.5 }));
  }
  function find(gray, w, h) {
    const b = bordered(gray, w, h, { x: 0, y: 0, w, h }, 0);
    if (b.length >= 1 && !(b.length === 1 && b[0].w * b[0].h > w * h * 0.8)) {
      const panels = markOdd(order(b)), off = panels.filter(p => !p.use).length;
      return { panels, how: 'borders', note: 'Found ' + panels.length + ' framed panel' + (panels.length > 1 ? 's' : '') + (off ? ' (' + off + ' look different from the rest, so they start switched off: tick them if they are panels)' : '') + '. Drag a box to fix it.' };
    }
    const g = xycut(gray, w, h);
    if (g.length >= 2) return { panels: markOdd(order(g)), how: 'gaps', note: 'No panel borders, so it split the page along the white gaps. That is a rougher guess: check each box, and add or remove any.' };
    return { panels: [{ x: 0, y: 0, w, h, use: true }], how: 'none', note: 'Could not tell the panels apart, so the whole page is one panel. Draw a box around each panel to split it.' };
  }
  return { find, order, gutter, xycut };
})();
/*PANELS-END*/
