// ============================== shared helpers ==============================
const $ = (s, el) => (el || document).querySelector(s), $$ = (s, el) => [...(el || document).querySelectorAll(s)];
const isPsd = f => /\.psd$/i.test(f.name);
async function psdCanvas(file) { const im = Psd.read(await file.arrayBuffer()), c = document.createElement('canvas'); c.width = im.w; c.height = im.h; c.getContext('2d').putImageData(new ImageData(im.data, im.w, im.h), 0, 0); return c; }
const fileBitmap = async f => isPsd(f) ? createImageBitmap(await psdCanvas(f)) : createImageBitmap(f);       // any picture file, Photoshop files included
const fileImage = f => isPsd(f) ? psdCanvas(f) : new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = () => rej(new Error('could not read ' + f.name)); img.src = URL.createObjectURL(f); });
const PICS = /\.(png|jpe?g|webp|gif|bmp|psd)$/i;
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
$$('#tabs .tab').forEach(t => t.onclick = () => {
  $$('#tabs .tab').forEach(x => x.classList.toggle('on', x === t));
  $$('.mode').forEach(m => m.classList.toggle('on', m.id === 'mode-' + t.dataset.mode));
  window.dispatchEvent(new Event('resize'));
});
