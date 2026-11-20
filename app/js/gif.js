/*GIF-START*/
// Small GIF89a writer (LZW). frames: [{data: Uint8Array of palette indexes, delay: hundredths of a second}]
const GifWriter = (() => {
  // palette: 6x6x6 colour cube (216) + 40 grays, which keeps line art clean
  const PAL = new Uint8Array(256 * 3);
  for (let r = 0; r < 6; r++) for (let g = 0; g < 6; g++) for (let b = 0; b < 6; b++) { const i = (r * 36 + g * 6 + b) * 3; PAL[i] = r * 51; PAL[i + 1] = g * 51; PAL[i + 2] = b * 51; }
  for (let k = 0; k < 40; k++) { const v = Math.round(k * 255 / 39), i = (216 + k) * 3; PAL[i] = PAL[i + 1] = PAL[i + 2] = v; }
  function index(rgba) {                       // RGBA pixels -> palette indexes
    const n = rgba.length / 4, out = new Uint8Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const a = rgba[p + 3] / 255, r = rgba[p] * a + 255 * (1 - a), g = rgba[p + 1] * a + 255 * (1 - a), b = rgba[p + 2] * a + 255 * (1 - a);
      if (Math.abs(r - g) < 14 && Math.abs(g - b) < 14 && Math.abs(r - b) < 14) out[i] = 216 + Math.round((r + g + b) / 3 * 39 / 255);
      else out[i] = Math.round(r / 51) * 36 + Math.round(g / 51) * 6 + Math.round(b / 51);
    }
    return out;
  }
  function lzw(data, out) {
    const minCode = 8, clear = 256, eoi = 257; let size = 9, next = 258, cur = 0, bits = 0;
    let block = []; const flush = () => { if (block.length) { out.push(block.length, ...block); block = []; } };
    const emit = c => { cur |= c << bits; bits += size; while (bits >= 8) { block.push(cur & 255); if (block.length === 255) flush(); cur >>>= 8; bits -= 8; } };
    out.push(minCode); let dict = new Map(); emit(clear); let prefix = data[0];
    for (let i = 1; i < data.length; i++) {
      const k = data[i], key = (prefix << 8) | k, hit = dict.get(key);
      if (hit !== undefined) { prefix = hit; continue; }
      emit(prefix); dict.set(key, next++);
      if (next > (1 << size) && size < 12) size++;
      if (next >= 4095) { emit(clear); dict = new Map(); size = 9; next = 258; }
      prefix = k;
    }
    emit(prefix); emit(eoi); if (bits > 0) block.push(cur & 255); flush(); out.push(0);
  }
  function encode(w, h, frames, loop) {
    const out = []; const u16 = v => out.push(v & 255, (v >> 8) & 255);
    for (const c of 'GIF89a') out.push(c.charCodeAt(0));
    u16(w); u16(h); out.push(0xF7, 255, 0); for (let i = 0; i < 768; i++) out.push(PAL[i]);
    if (loop !== false) { out.push(0x21, 0xFF, 11); for (const c of 'NETSCAPE2.0') out.push(c.charCodeAt(0)); out.push(3, 1, 0, 0, 0); }
    for (const f of frames) {
      out.push(0x21, 0xF9, 4, 0); u16(f.delay); out.push(0, 0);
      out.push(0x2C); u16(0); u16(0); u16(w); u16(h); out.push(0);
      const body = []; lzw(f.data, body); for (let i = 0; i < body.length; i++) out.push(body[i]);
    }
    out.push(0x3B); return new Uint8Array(out);
  }
  return { encode, index, PAL };
})();
/*GIF-END*/
