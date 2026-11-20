/*PSD-START*/
// Reads the flattened picture out of a Photoshop file (the copy every PSD carries when it is saved with "Maximize Compatibility").
// 8 or 16 bit, RGB or grayscale. Returns { w, h, data } with data = RGBA bytes, opaque, the way the artist sees the file on white.
const Psd = (() => {
  function read(buf) {
    const d = new DataView(buf), u = new Uint8Array(buf); if (buf.byteLength < 30 || d.getUint32(0) !== 0x38425053) throw new Error('not a Photoshop file');
    if (d.getUint16(4) !== 1) throw new Error('large document (PSB) files are not supported: save as PSD or PNG');
    const ch = d.getUint16(12), h = d.getUint32(14), w = d.getUint32(18), depth = d.getUint16(22), mode = d.getUint16(24), bps = depth / 8, n = w * h;
    if (depth !== 8 && depth !== 16) throw new Error(depth + ' bit Photoshop files are not supported: use 8 or 16 bit'); if (mode !== 3 && mode !== 1) throw new Error('only RGB and grayscale Photoshop files are supported');
    let o = 26; for (let i = 0; i < 3; i++) o += 4 + d.getUint32(o);              // skip the colour table, the resources and the layers
    const comp = d.getUint16(o), want = Math.min(ch, mode === 3 ? 3 : 1), planes = []; o += 2;
    if (comp === 0) for (let c = 0; c < want; c++) { const pl = new Uint8Array(n); for (let i = 0; i < n; i++) pl[i] = u[o + (c * n + i) * bps]; planes.push(pl); }
    else if (comp === 1) { let q = o + ch * h * 2;                                 // PackBits, one row at a time, channel after channel
      for (let c = 0; c < want; c++) { const pl = new Uint8Array(n); let k = 0;
        for (let y = 0; y < h; y++) { const end = q + d.getUint16(o + (c * h + y) * 2); let col = 0; const put = v => { if (col % bps === 0) pl[k++] = v; col++; };
          while (q < end) { const m = d.getInt8(q++); if (m >= 0) for (let i = 0; i <= m; i++) put(u[q++]); else if (m !== -128) { const v = u[q++]; for (let i = 0; i < 1 - m; i++) put(v); } } }
        planes.push(pl); } }
    else throw new Error('this Photoshop file is packed in a way this reader does not know: save it with Maximize Compatibility on, or as PNG');
    const data = new Uint8ClampedArray(n * 4); for (let i = 0; i < n; i++) { data[i * 4] = planes[0][i]; data[i * 4 + 1] = planes[want > 1 ? 1 : 0][i]; data[i * 4 + 2] = planes[want > 2 ? 2 : 0][i]; data[i * 4 + 3] = 255; }
    return { w, h, data };
  }
  return { read };
})();
/*PSD-END*/
