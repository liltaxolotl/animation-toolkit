// The Redline tab (build step 5): marks pasted from Claude, marks drawn and dragged by hand, numbered copies that never
// touch the drawing, the shot file, and the two twins agreeing with each other:
//   parseDoc() in app/js/redline-tab.mjs  vs  normalize() in animtk/layers.py   (same documents from the same inputs)
//   Vec.draw() in app/js/shot.js          vs  render() in animtk/layers.py      (same pixels from the same layers)
//   node tests/test_app_redline.mjs
// Needs puppeteer-core (npm i puppeteer-core, in _scratch/ is fine) and Chrome or Edge. Starts serve.py on a free port.
// Every input is generated here, and every work/_test_redline* folder is removed after.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'tests', 'out'); fs.mkdirSync(out, { recursive: true });
const dl = path.join(out, 'redline_downloads'); fs.rmSync(dl, { recursive: true, force: true }); fs.mkdirSync(dl, { recursive: true });
const work = path.join(root, 'work');
let fails = 0;
const check = (name, ok, detail) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ' + detail : '')); if (!ok) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cleanWork = () => { try { for (const n of fs.readdirSync(work)) if (n.startsWith('_test_redline')) fs.rmSync(path.join(work, n), { recursive: true, force: true }); } catch (e) {} };
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const py = (code, ...args) => execFileSync('python', ['-P', '-c', 'import sys; sys.path.insert(0, sys.argv[1])\n' + code, root, ...args], { maxBuffer: 1 << 26 }).toString();

let puppeteer;
for (const base of [root, path.join(root, '_scratch'), process.cwd()]) { try { puppeteer = createRequire(path.join(base, 'x.js'))('puppeteer-core'); break; } catch (e) {} }
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
if (!puppeteer || !chrome) { console.log('FAIL  cannot run: ' + (!puppeteer ? 'puppeteer-core is not installed' : 'no Chrome or Edge found')); process.exit(1); }

// ---------------------------------------------------------------- inputs
const W = 1600, H = 800;
const board = path.join(out, '_test_redline_board.png');
py(['from PIL import Image, ImageDraw', 'im = Image.new("RGB", (1600, 800), (250, 246, 238)); d = ImageDraw.Draw(im)',
  'd.line((200, 650, 1400, 250), fill=(30, 28, 35), width=10); d.ellipse((700, 300, 900, 500), outline=(30, 28, 35), width=8)', 'im.save(sys.argv[2])'].join('\n'), board);
const boardSha = sha(board);

// ---------------------------------------------------------------- server and browser
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const port = await freePort();
cleanWork();
const server = spawn('python', ['-P', path.join(root, 'serve.py'), '--port', String(port), '--no-open'], { cwd: root, stdio: 'ignore' });
let browser;
const finish = async code => { try { if (browser) await browser.close(); } catch (e) {} try { server.kill(); } catch (e) {} await sleep(300); cleanWork(); process.exit(code); };
process.on('uncaughtException', async e => { console.log('FAIL  the test itself crashed: ' + (e && e.stack || e)); await finish(1); });
process.on('unhandledRejection', async e => { console.log('FAIL  the test itself crashed: ' + (e && e.stack || e)); await finish(1); });
for (let i = 0; i < 50; i++) { try { const r = await fetch('http://127.0.0.1:' + port + '/api/ping'); if (r.ok) break; } catch (e) {} await sleep(200); }
browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--window-size=1700,980'] });
const errors = [], page = await browser.newPage(); await page.setViewport({ width: 1700, height: 980 });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() !== 'error') return; const u = (m.location() && m.location().url) || ''; if (/favicon\.ico|\/work\/|\/api\/save/.test(u + ' ' + m.text())) return; errors.push('console: ' + m.text() + ' ' + u); });
await (await page.createCDPSession()).send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
await page.goto('http://127.0.0.1:' + port + '/animation_app.html');
await page.waitForFunction(() => typeof Store !== 'undefined' && typeof ModTabs !== 'undefined');
const ev = (fn, ...a) => page.evaluate(fn, ...a);
const guard = async (name, fn) => { try { await fn(); } catch (e) { check(name + ' (crashed)', false, String(e && e.message || e).slice(0, 300)); } };
const waitFile = async (p, ms = 15000) => { for (let t = 0; t < ms; t += 200) { if (fs.existsSync(p) && fs.statSync(p).size > 0) { await sleep(150); return true; } await sleep(200); } return false; };

// ================================================================ the twins
await guard('parseDoc agrees with layers.normalize', async () => {
  const cases = [
    'Sure! Here are the marks:\n```json\n{"kind":"animtk-redline","version":1,"W":800,"H":400,"layers":[{"name":"Fixes","color":"#e8202a","items":[{"t":"arrow","a":[100,50],"b":[200,80],"note":"lift the hip"},{"t":"text","at":[210,70],"text":"1"}]},{"name":"Construction","color":"#2f6bff","opacity":60,"items":[{"t":"line","a":[0,200],"b":[800,200],"dash":[18,12]}]}]}\n```',
    [{ t: 'circle', c: [0.5, 0.5], r: 0.1 }, { type: 'rect', a: { x: 0.1, y: 0.1 }, b: [0.2, 0.3], fill: 'rgba(232,32,42,.2)' }],
    { W: 1, H: 1, items: [{ t: 'ellipse', c: [0.5, 0.5], rx: -0.1, ry: 0.05, rot: 30 }, { t: 'poly', pts: [[0.1, 0.1], [0.2, 0.2], 'x', [0.3, 0.1]], closed: true }] },
    { layers: [{ name: 'Mixed', color: 'notacolour', items: [{ t: 'blob' }, { t: 'line', a: [1, 2] }, { t: 'pin', from: [10, 10], to: [20, 30], w: '8' }, { t: 'line', a: [0, 0], b: [5, 5], dash: ['x'] }, { t: 'text', at: [3, 3], text: '' }, 5] }, 'nope'] },
    { t: 'arrow', a: [10, 10], b: [100, 100], color: 'teal' },
    { W: 1600, H: 1600, layers: [{ items: [{ t: 'line', a: [0, 0], b: [1600, 1600] }] }] }];
  const js = await ev(async (cases, W, H) => { const m = await import('/app/js/redline-tab.mjs'); return cases.map(c => { try { const r = m.parseDoc(c, W, H); return { doc: r.doc, n: r.warnings.length }; } catch (e) { return { err: true }; } }); }, cases, W, H);
  const pyOut = JSON.parse(py(['import json', 'from animtk import layers as LY', 'out = []',
    'for c in json.loads(sys.argv[2]):', '    try:', '        d, w = LY.normalize(c, int(sys.argv[3]), int(sys.argv[4])); out.append({"doc": d, "n": len(w)})',
    '    except ValueError:', '        out.append({"err": True})', 'print(json.dumps(out))'].join('\n'), JSON.stringify(cases), String(W), String(H)));
  const same = (a, b) => {
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-6;
    if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]));
    if (a && typeof a === 'object') { const ka = Object.keys(a).sort(), kb = Object.keys(b || {}).sort(); return same(ka, kb) && ka.every(k => same(a[k], b[k])); }
    return a === b;
  };
  let bad = [];
  cases.forEach((c, i) => { if (!same(js[i], pyOut[i])) bad.push(i + ': js ' + JSON.stringify(js[i]).slice(0, 300) + ' py ' + JSON.stringify(pyOut[i]).slice(0, 300)); });
  check('parseDoc and layers.normalize give the same documents and warning counts (' + cases.length + ' inputs)', !bad.length, bad.join(' | '));
  check('a bad layer colour, unknown items and missing points are warned about, not drawn', js[3].n === 7 && js[3].doc.layers[0].items.length === 2, 'warnings ' + js[3].n);
});

await guard('the two renderers draw the same pixels', async () => {
  const layers = [
    { name: 'Fixes', color: '#e8202a', items: [{ t: 'line', a: [100, 100], b: [700, 160], w: 10 }, { t: 'arrow', a: [900, 600], b: [1200, 420], w: 8 },
      { t: 'pin', from: [300, 600], to: [420, 520] }, { t: 'poly', pts: [[1300, 100], [1500, 140], [1450, 300], [1320, 260]], closed: true, fill: 'rgba(232,32,42,.25)' }] },
    { name: 'Construction', color: '#2f6bff', opacity: 70, items: [{ t: 'line', a: [0, 400], b: [1600, 380], dash: [18, 12], w: 6 },
      { t: 'circle', c: [800, 400], r: 120, w: 8 }, { t: 'ellipse', c: [400, 250], rx: 160, ry: 60, rot: 25 }, { t: 'rect', a: [1100, 600], b: [1450, 760], w: 12 }] }];
  const jsPng = path.join(out, '_test_redline_js.png'), pyPng = path.join(out, '_test_redline_py.png');
  const url = await ev((L, W, H) => Vec.canvas(L, W, H).toDataURL('image/png'), layers, W, H);
  fs.writeFileSync(jsPng, Buffer.from(url.split(',')[1], 'base64'));
  const res = JSON.parse(py(['import json, numpy as np', 'from PIL import Image', 'from animtk import layers as LY',
    'L = json.loads(sys.argv[2]); W, H = int(sys.argv[3]), int(sys.argv[4])', 'LY.render(L, W, H).save(sys.argv[6])',
    'a = np.asarray(Image.open(sys.argv[5]).convert("RGBA"), np.int32); b = np.asarray(Image.open(sys.argv[6]), np.int32)',
    'ink = (a[..., 3] > 0) | (b[..., 3] > 0)',
    'pa = a[..., :3] * a[..., 3:] // 255; pb = b[..., :3] * b[..., 3:] // 255',
    'bad = (np.abs(a[..., 3] - b[..., 3]) > 96) | (np.abs(pa - pb).max(-1) > 96)',
    'print(json.dumps({"ink": int(ink.sum()), "bad": int((bad & ink).sum()), "mean": float(np.abs(a[..., 3] - b[..., 3])[ink].mean())}))'].join('\n'),
    JSON.stringify(layers), String(W), String(H), jsPng, pyPng));
  const share = res.bad / res.ink;
  check('Chrome and Python agree on lines, arrows, pins, dashes, circles, ellipses, boxes and fills', share < 0.01 && res.mean < 8,
    (share * 100).toFixed(2) + '% of ' + res.ink + ' inked pixels differ, mean alpha gap ' + res.mean.toFixed(1));
  const textL = [{ color: '#e8202a', items: [{ t: 'text', at: [200, 300], text: 'lift the hip', size: 60 }] }];
  const url2 = await ev((L, W, H) => Vec.canvas(L, W, H).toDataURL('image/png'), textL, W, H);
  fs.writeFileSync(jsPng, Buffer.from(url2.split(',')[1], 'base64'));
  const box = JSON.parse(py(['import json, numpy as np', 'from PIL import Image', 'from animtk import layers as LY',
    'b = np.asarray(LY.render(json.loads(sys.argv[2]), 1600, 800))[..., 3]; a = np.asarray(Image.open(sys.argv[3]).convert("RGBA"))[..., 3]',
    'def bb(m):', '    ys, xs = np.nonzero(m > 60); return [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]',
    'A, B = bb(a), bb(b); ix = max(0, min(A[2], B[2]) - max(A[0], B[0])) * max(0, min(A[3], B[3]) - max(A[1], B[1]))',
    'ar = lambda q: (q[2] - q[0]) * (q[3] - q[1]); print(json.dumps({"iou": ix / (ar(A) + ar(B) - ix), "js": A, "py": B}))'].join('\n'), JSON.stringify(textL), jsPng));
  check('text lands in the same place in both (fonts differ a little)', box.iou > 0.7, 'overlap ' + box.iou.toFixed(2) + ' js ' + box.js + ' py ' + box.py);
  fs.rmSync(jsPng, { force: true }); fs.rmSync(pyPng, { force: true });
});

// ================================================================ the tab
await page.click('#tabs .tab[data-mode="redline"]');
await page.waitForFunction(() => window.RedlineTab, { timeout: 20000 });
check('the Redline tab opens through the module loader', true);
await (await page.$('#rlFile')).uploadFile(board);
await page.waitForFunction(() => RedlineTab.cur() && RedlineTab.cur().name === '_test_redline_board.png', { timeout: 20000 });
check('a drawing opens at its own size with no marks', await ev(() => { const c = RedlineTab.cur(); return c.W === 1600 && c.H === 800 && c.doc.layers.every(L => !L.items.length) && $('#rlSave').disabled; }));

await guard('pasting marks', async () => {
  const reply = 'Here you go!\n```json\n' + JSON.stringify({ kind: 'animtk-redline', version: 1, W: 800, H: 400, layers: [
    { name: 'Fixes', color: '#e8202a', items: [{ t: 'arrow', a: [400, 300], b: [400, 220], note: 'lift the chin a touch' }, { t: 'blob' }] },
    { name: 'Construction', color: '#2f6bff', items: [{ t: 'line', a: [0, 120], b: [800, 120], dash: [18, 12] }] }] }) + '\n```';
  await page.$eval('#rlPaste', (el, v) => { el.value = v; }, reply);
  await page.click('#rlUse');
  const st = await ev(() => { const c = RedlineTab.cur(); return { n: c.doc.layers.map(L => L.items.length), a: c.doc.layers[0].items[0], warn: $('#rlWarn').textContent, notes: $('#rlNotes').textContent }; });
  check('marks pasted with words and a fence around them are drawn, scaled from the smaller copy', st.n.join() === '1,1' && st.a.a[0] === 800 && st.a.a[1] === 600, JSON.stringify(st.n) + ' ' + JSON.stringify(st.a.a));
  check('the bad item is skipped with a heads up', /Heads up/.test(st.warn) && /unknown type/.test(st.warn), st.warn.slice(0, 160));
  check('notes from the marks are listed', /lift the chin/.test(st.notes));
});

await guard('drawing and dragging marks', async () => {
  await ev(() => { RedlineTab.fitView(); });
  const at = (x, y) => ev((x, y) => RedlineTab.screenOf(x, y), x, y);
  await page.click('[data-rltool="arrow"]');
  let p = await at(300, 200), q = await at(600, 300);
  await page.mouse.move(p[0], p[1]); await page.mouse.down(); await page.mouse.move((p[0] + q[0]) / 2, (p[1] + q[1]) / 2); await page.mouse.move(q[0], q[1]); await page.mouse.up();
  const tol = await ev(() => 3 / RedlineTab.UI.view.s);
  let m = await ev(() => { const L = RedlineTab.cur().doc.layers[0]; return L.items[L.items.length - 1]; });
  check('the arrow tool draws an arrow where the mouse went', m.t === 'arrow' && Math.hypot(m.a[0] - 300, m.a[1] - 200) < tol && Math.hypot(m.b[0] - 600, m.b[1] - 300) < tol, JSON.stringify(m));
  p = await at(600, 300); q = await at(650, 420);
  await page.mouse.move(p[0], p[1]); await page.mouse.down(); await page.mouse.move(q[0], q[1], { steps: 4 }); await page.mouse.up();
  m = await ev(() => { const L = RedlineTab.cur().doc.layers[0]; return L.items[L.items.length - 1]; });
  check('its end dot drags the tip', Math.hypot(m.b[0] - 650, m.b[1] - 420) < tol && Math.hypot(m.a[0] - 300, m.a[1] - 200) < tol, JSON.stringify(m));
  await page.click('[data-rltool="move"]');
  p = await at(475, 310); q = await at(525, 360);
  await page.mouse.move(p[0], p[1]); await page.mouse.down(); await page.mouse.move(q[0], q[1], { steps: 4 }); await page.mouse.up();
  m = await ev(() => { const L = RedlineTab.cur().doc.layers[0]; return L.items[L.items.length - 1]; });
  check('Move drags the whole mark', Math.hypot(m.a[0] - 350, m.a[1] - 250) < tol && Math.hypot(m.b[0] - 700, m.b[1] - 470) < tol, JSON.stringify(m));
  await page.$eval('#rlNote', el => el.focus()); await page.keyboard.type('more room here');
  check('a picked mark can be given a note', (await ev(() => { const L = RedlineTab.cur().doc.layers[0]; return L.items[L.items.length - 1].note; })) === 'more room here');
  await page.$eval('#rlNote', el => el.blur());
  await page.keyboard.press('Delete');
  check('Delete removes the picked mark', (await ev(() => RedlineTab.cur().doc.layers[0].items.length)) === 1);
  await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
  check('Ctrl+Z brings it back', (await ev(() => RedlineTab.cur().doc.layers[0].items.length)) === 2);
  await page.select('#rlLayer', 'L2');
  await page.click('[data-rltool="text"]');
  p = await at(1000, 150); await page.mouse.click(p[0], p[1]);
  await page.keyboard.type('nice');
  m = await ev(() => RedlineTab.cur().doc.layers[1].items.slice(-1)[0]);
  check('the text tool puts words on the chosen layer', m.t === 'text' && m.text === 'nice' && Math.hypot(m.at[0] - 1000, m.at[1] - 150) < tol, JSON.stringify(m));
  await page.$eval('#rlText', el => el.blur()); await page.keyboard.press('Escape');
});

await guard('saving copies', async () => {
  await page.$eval('#rlFade', el => { el.value = 40; el.dispatchEvent(new Event('input')); });
  const r1 = await ev(() => RedlineTab.saveRedline()), r2 = await ev(() => RedlineTab.saveRedline());
  const dir = path.join(work, '_test_redline_board'), stem = n => path.join(dir, '_test_redline_board_redline_v' + n);
  check('two saves give v1 and v2, never replacing one', r1.v === 1 && r2.v === 2 && [1, 2].every(n => ['.png', '_layer.png', '.json'].every(e => fs.existsSync(stem(n) + e))));
  check('her drawing is untouched', sha(board) === boardSha);
  const info = JSON.parse(py(['import json', 'from PIL import Image', 'L = Image.open(sys.argv[2]); C = Image.open(sys.argv[3]).convert("RGB")',
    'print(json.dumps({"size": L.size, "mode": L.mode, "clear": L.getpixel((50, 50))[3], "paper": C.getpixel((50, 50)), "mark": L.getpixel((800, 500))[3]}))'].join('\n'), stem(1) + '_layer.png', stem(1) + '.png'));
  check('the layer is transparent and the drawing size', info.mode === 'RGBA' && info.size.join() === '1600,800' && info.clear === 0 && info.mark > 200, JSON.stringify(info));
  check('the copy is faded 40% toward white under the marks', info.paper.every((v, i) => Math.abs(v - Math.round(255 - (255 - [250, 246, 238][i]) * 0.6)) <= 2), JSON.stringify(info.paper));
  const marks = JSON.parse(fs.readFileSync(stem(2) + '.json', 'utf8'));
  check('the saved marks say what they are', marks.kind === 'animtk-redline' && marks.W === 1600 && marks.v === 2 && marks.source === '_test_redline_board.png' && marks.fade === 40);
  const shot = JSON.parse(fs.readFileSync(path.join(dir, 'shot.json'), 'utf8'));
  check('the shot file lists both copies as redline edits', shot.edits.filter(e => e.tag === 'redline').map(e => e.v).join() === '1,2', JSON.stringify(shot.edits));
  const pyOut = py(['import json, redline', 'res = redline.save_redline(sys.argv[2], sys.argv[3], shot="_test_redline_board")', 'print(res["v"])'].join('\n'), board, stem(2) + '.json').trim();
  check('redline.py reads the tab\'s marks and carries on the numbering', pyOut === '3' && fs.existsSync(stem(3) + '_layer.png'), pyOut);
  await ev(() => { RedlineTab.cur().doc.layers.forEach(L => { L.items = []; }); });
  await page.click('#rlLatest');
  await page.waitForFunction(() => RedlineTab.cur().doc.layers.some(L => L.items.length), { timeout: 10000 });
  const n = await ev(() => RedlineTab.cur().doc.layers.reduce((a, L) => a + L.items.length, 0));
  check('"Open my last saved" brings back the newest marks', n === marks.layers.reduce((a, L) => a + L.items.length, 0), n + ' marks');
});

await guard('exporting a layer', async () => {
  const name = await ev(() => RedlineTab.exportLayer(RedlineTab.cur().doc.layers[0].id));
  const f = path.join(dl, name);
  check('one layer exports as a transparent PNG at the drawing size', await waitFile(f) && JSON.parse(py('from PIL import Image; im = Image.open(sys.argv[2]); print(list(im.size) == [1600, 800] and im.mode == "RGBA" and "true" or "false")', f)), name);
});

await guard('before / after and the request for Claude', async () => {
  await page.click('#rlBA');
  check('the before / after handle shows', await ev(() => RedlineTab.UI.ba.on && getComputedStyle(document.querySelector('#rlStage .ba-handle')).display !== 'none'));
  await page.click('#rlBA');
  const ask = await ev(() => RedlineTab.askClaude(1600, 800));
  check('the request for Claude names the size and the format, with no dashes as punctuation', /1600 x 800/.test(ask) && /animtk-redline/.test(ask) && !/[\u2013\u2014]/.test(ask));
});

await guard('the Start tab route', async () => {
  await page.click('#tabs .tab[data-mode="start"]');
  await (await page.$('#sFiles')).uploadFile(board);
  await sleep(800);
  await ev(() => { RedlineTab.S.items.length = 0; });
  await page.click('[data-help="redline"]');
  await page.waitForFunction(() => RedlineTab.cur() && RedlineTab.cur().name === '_test_redline_board.png' && document.querySelector('#mode-redline').classList.contains('on'), { timeout: 15000 });
  check('Start > Redline opens the drawing in the Redline tab', true);
});

const src = fs.readFileSync(path.join(root, 'app', 'js', 'redline-tab.mjs'), 'utf8') + fs.readFileSync(path.join(root, 'redline.py'), 'utf8') + fs.readFileSync(path.join(root, 'animtk', 'layers.py'), 'utf8');
check('no em or en dashes in the redline code', !/[\u2013\u2014]/.test(src));
check('no errors on the page', !errors.length, errors.slice(0, 5).join(' | '));
console.log('\n' + (fails ? fails + ' FAILED' : 'ALL PASS'));
await finish(fails ? 1 : 0);
