// The Start tab (uploads, PDF storyboard panels, video frames, routing to the other tabs) plus the Perspective guide
// layers (opacity, one-layer export, before/after). Needs no artwork: every input is generated here.
//   node tests/test_app_start.mjs
// Needs puppeteer-core (npm i puppeteer-core, in _scratch/ is fine) and Chrome or Edge. It starts serve.py on a free
// port (the PDF reader needs http), and removes the work/_test_* folders it caused (only its own) when it is done.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'tests', 'out'); fs.mkdirSync(out, { recursive: true });
const dl = path.join(out, 'start_downloads'); fs.rmSync(dl, { recursive: true, force: true }); fs.mkdirSync(dl, { recursive: true });
const work = path.join(root, 'work');
let fails = 0;
const check = (name, ok, detail) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ' + detail : '')); if (!ok) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
// only this test's own folders, so a pose or serve test running at the same time keeps its own
const MINE = /^_test_(story|board3840|seq|ver|dot)/;
const cleanWork = () => { try { for (const n of fs.readdirSync(work)) if (MINE.test(n)) fs.rmSync(path.join(work, n), { recursive: true, force: true }); } catch (e) {} };

let puppeteer;
for (const base of [root, path.join(root, '_scratch'), process.cwd()]) { try { puppeteer = createRequire(path.join(base, 'x.js'))('puppeteer-core'); break; } catch (e) {} }
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
if (!puppeteer || !chrome) { console.log('FAIL  cannot run: ' + (!puppeteer ? 'puppeteer-core is not installed' : 'no Chrome or Edge found')); process.exit(1); }

// ---------------------------------------------------------------- a hand-built PDF (vector only, correct xref)
function buildPdf(pages) {                       // pages: array of content-stream strings, each page 612 x 792 pt
  const objs = []; const add = s => objs.push(s) && objs.length;
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('<< /Type /Pages /Kids [' + pages.map((_, i) => (3 + i * 2) + ' 0 R').join(' ') + '] /Count ' + pages.length + ' >>');
  pages.forEach((c, i) => {
    add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ' + (4 + i * 2) + ' 0 R /Resources << >> >>');
    add('<< /Length ' + Buffer.byteLength(c, 'latin1') + ' >>\nstream\n' + c + '\nendstream');
  });
  let body = '%PDF-1.4\n', offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(body, 'latin1')); body += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  const xref = Buffer.byteLength(body, 'latin1');
  body += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') +
    'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(body, 'latin1');
}
const PW = 612, PH = 792;
const topRect = (x, yt, w, h) => (x) + ' ' + (PH - yt - h) + ' ' + w + ' ' + h + ' re S\n';
// diagonal scribble lines inside a box given from the top-left (x, yt, w, h)
const scribble = (x, yt, w, h, n = 7) => { let s = ''; for (let i = 0; i < n; i++) { const a = x + 10 + (w - 20) * i / n, b = x + 10 + (w - 20) * (i + 1.5) / n; s += a.toFixed(1) + ' ' + (PH - yt - 12) + ' m ' + Math.min(b, x + w - 10).toFixed(1) + ' ' + (PH - yt - h + 12) + ' l S\n'; } return s; };
const COLS = [45, 231, 417], ROWS = [50, 350], PWID = 150, PHGT = 280;
const DLG = { x: 221, y: 660, w: 170, h: 56 };
const expected = [];                             // in reading order, as fractions of the page
let p1 = '2 w\n' + topRect(20, 20, 572, 752);
for (const r of ROWS) for (const c of COLS) { p1 += '1.5 w\n' + topRect(c, r, PWID, PHGT) + '1 w\n' + scribble(c, r, PWID, PHGT); expected.push({ x: c / PW, y: r / PH, w: PWID / PW, h: PHGT / PH }); }
p1 += '1.5 w\n' + topRect(DLG.x, DLG.y, DLG.w, DLG.h) + '1 w\n' + scribble(DLG.x, DLG.y, DLG.w, DLG.h, 4);
const dlgExp = { x: DLG.x / PW, y: DLG.y / PH, w: DLG.w / PW, h: DLG.h / PH };
// page 2: no borders, just scribbles in four groups with wide white gaps
const G2 = [[60, 70], [330, 70], [60, 420], [330, 420]]; let p2 = '3 w\n';
const gexp = G2.map(([x, y]) => ({ x: x / PW, y: y / PH, w: 220 / PW, h: 280 / PH }));
for (const [x, y] of G2) { p2 += scribble(x, y, 220, 280, 9); p2 += (x + 20) + ' ' + (PH - y - 140) + ' m ' + (x + 200) + ' ' + (PH - y - 100) + ' l S\n'; }
const pdfPath = path.join(out, '_test_story.pdf'); fs.writeFileSync(pdfPath, buildPdf([p1, p2]));

// ---------------------------------------------------------------- inputs: a 5 frame PNG sequence, a 3840x1920 board
const seqPaths = [];
// the frames and the board are made with PIL (already a dependency of the toolkit)
const board = path.join(out, '_test_board3840.png');
execFileSync('python', ['-P', '-c', [
  'import sys', 'from PIL import Image, ImageDraw',
  'out = sys.argv[1]',
  'for i in range(5):',
  '    im = Image.new("RGB", (320, 180), "white"); d = ImageDraw.Draw(im); x = 30 + i * 50; d.ellipse((x, 60, x + 40, 100), outline="black", width=4); im.save(out + "/_test_seq_%d.png" % (i + 1))',
  'b = Image.new("RGB", (3840, 1920), (250, 245, 235)); b.save(sys.argv[2])'].join('\n'), out, board]);
for (let i = 1; i <= 5; i++) seqPaths.push(path.join(out, '_test_seq_' + i + '.png'));

// ---------------------------------------------------------------- the server (the PDF reader needs http)
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
cleanWork();
const port = await freePort();
const server = spawn('python', ['-P', path.join(root, 'serve.py'), '--port', String(port), '--no-open'], { cwd: root, stdio: 'ignore' });
let browser;
const finish = async code => { try { if (browser) await browser.close(); } catch (e) {} try { server.kill(); } catch (e) {} await sleep(300); cleanWork(); process.exit(code); };
process.on('uncaughtException', async e => { console.log('FAIL  the test itself crashed: ' + (e && e.stack || e)); await finish(1); });
process.on('unhandledRejection', async e => { console.log('FAIL  the test itself crashed: ' + (e && e.stack || e)); await finish(1); });
for (let i = 0; i < 50; i++) { try { const r = await fetch('http://127.0.0.1:' + port + '/api/ping'); if (r.ok) break; } catch (e) {} await sleep(200); }
const URL = 'http://127.0.0.1:' + port + '/animation_app.html';

browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--window-size=1700,980', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage(); await page.setViewport({ width: 1700, height: 980 });
const errors = [], seen409 = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => {
  if (m.type() !== 'error') return;
  const u = (m.location() && m.location().url) || '';
  if (/favicon\.ico/.test(u) || /\/work\//.test(u) || /\/api\/save/.test(u)) { seen409.push(m.text()); return; }   // expected network noise: first-time shot.json 404, write-once 409
  errors.push(m.text() + ' ' + u);
});
const client = await page.createCDPSession(); await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
await page.goto(URL); await page.evaluate(() => localStorage.clear()); await page.reload();
await page.waitForFunction(() => typeof Start !== "undefined" && typeof Persp !== "undefined" && typeof Timing !== "undefined" && window.pdfjsLib);

const toScreen = (sel, v, p) => page.evaluate((sel, v, p) => { const r = document.querySelector(sel).getBoundingClientRect(); return [r.left + v.x + p[0] * v.s, r.top + v.y + p[1] * v.s]; }, sel, v, p);
const view = () => page.evaluate(() => ({ ...Start.UI.view }));
const startPage = () => page.evaluate(() => { const it = Start.sel(); const P = it.pages[it.pi]; return { w: P.w, h: P.h, how: P.how, panels: P.panels.map(b => ({ ...b })), box: Start.UI.box, n: it.pi, note: P.note }; });
const picPt = async p => toScreen('#sView', await view(), p);
const mouseDrag = async (a, b) => { await page.mouse.move(a[0], a[1]); await page.mouse.down(); await page.mouse.move((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, { steps: 4 }); await page.mouse.move(b[0], b[1], { steps: 4 }); await page.mouse.up(); };
const near = (b, e, tol) => Math.abs(b.x - e.x) < tol && Math.abs(b.y - e.y) < tol && Math.abs(b.w - e.w) < tol && Math.abs(b.h - e.h) < tol;
const maxDiff = (b, e) => Math.max(Math.abs(b.x - e.x), Math.abs(b.y - e.y), Math.abs(b.w - e.w), Math.abs(b.h - e.h));

// ================================================================ 1 and 2: PDF panel finding
await (await page.$('#sFiles')).uploadFile(pdfPath);
await page.waitForFunction(() => { const it = Start.sel(); return it && it.kind === 'pdf' && it.pages.length === 2; }, { timeout: 30000 });
let s = await startPage();
const used = s.panels.filter(b => b.use), off = s.panels.filter(b => !b.use);
const errs = used.map((b, i) => expected[i] ? maxDiff(b, expected[i]) : 9);
check('PDF page 1: six panels used, in reading order, within 2% of the page', used.length === 6 && errs.every(e => e < 0.02), 'max error ' + (Math.max(...errs) * 100).toFixed(2) + '% ; how=' + s.how + ' ; ' + s.panels.length + ' boxes');
check('PDF page 1: found by borders', s.how === 'borders', s.how);
check('PDF page 1: the small dialogue box is present but switched off', off.length === 1 && maxDiff(off[0], dlgExp) < 0.02 && s.panels.indexOf(off[0]) === 6, off.length ? 'off box error ' + (maxDiff(off[0], dlgExp) * 100).toFixed(2) + '%, index ' + s.panels.indexOf(off[0]) : 'none off');
check('PDF page 1: the list says six panels (page 2 counted too)', await page.evaluate(() => /2 pages, \d+ panels/.test(document.querySelector('#sList').textContent)), await page.$eval('#sList', e => e.textContent));
await page.screenshot({ path: path.join(out, 'app_start_pdf_page1.png') });
await page.click('#sNextPage'); s = await startPage();
const gused = s.panels.filter(b => b.use), gerrs = gused.map((b, i) => gexp[i] ? maxDiff(b, gexp[i]) : 9);
check('PDF page 2 (no borders): four panels found by the white gaps', s.how === 'gaps' && s.panels.length === 4 && gused.length === 4, 'how=' + s.how + ' panels=' + s.panels.length);
check('PDF page 2: the four groups are in reading order and match where they were drawn', gused.length === 4 && gerrs.every(e => e < 0.04), gerrs.map(e => (e * 100).toFixed(1) + '%').join(' '));
await page.screenshot({ path: path.join(out, 'app_start_pdf_page2.png') });
await page.click('#sPrevPage');

// ================================================================ 4: help routing (done before the crop edits, so the counts are the detected ones)
await page.click('[data-help="perspective"]');
await page.waitForFunction(() => document.querySelector('#mode-perspective').classList.contains('on') && Persp.UI.boards.length > 0, { timeout: 30000 });
await sleep(400);
let r = await page.evaluate(() => ({ tab: document.querySelector('#mode-perspective').classList.contains('on'), startOn: document.querySelector('#mode-start').classList.contains('on'), names: Persp.UI.boards.map(b => b.name), info: document.querySelector('#sHelpInfo').textContent }));
const wantNames = []; for (let i = 1; i <= 6; i++) wantNames.push('_test_story_p01_panel' + String(i).padStart(2, '0') + '.png'); for (let i = 1; i <= 4; i++) wantNames.push('_test_story_p02_panel' + String(i).padStart(2, '0') + '.png');
check('Help > Perspective shows the Perspective tab', r.tab && !r.startOn);
check('Help > Perspective: one board per used panel, each a PNG named <pdf>_pNN_panelNN.png', r.names.join() === wantNames.join(), r.names.length + ' boards: ' + r.names.slice(0, 3).join(', ') + ' ...');
const dims = await page.evaluate(() => Persp.UI.boards.map(b => [b.img.naturalWidth, b.img.naturalHeight]));
check('the panel pictures are real crops (right shape, big enough to draw on)', dims.slice(0, 6).every(d => d[0] > 400 && Math.abs(d[0] / d[1] - 150 / 280) < 0.06) && dims.slice(6).every(d => d[0] > 400), dims.slice(0, 2).map(d => d.join('x')).join(' ; '));
const shotOnDisk = fs.existsSync(path.join(work, '_test_story', 'shot.json')) && fs.existsSync(path.join(work, '_test_story', 'source', '_test_story.pdf'));
check('the shot file and a copy of the original PDF were saved into work/ (through the server)', shotOnDisk);
await page.click('[data-mode="start"]');

// ================================================================ 3: fixing the panel crops with the real mouse
await page.evaluate(() => Start.pick(Start.items[0])); await sleep(100);
s = await startPage(); const before = s.panels.map(b => ({ ...b })); const PW1 = s.w, PH1 = s.h;
// drag the bottom right corner of box 0 inward
let b0 = before[0], br = [(b0.x + b0.w) * PW1, (b0.y + b0.h) * PH1], v = await view();
let from = await picPt(br), to = [from[0] - 40, from[1] - 50]; await mouseDrag(from, to); s = await startPage();
const dxExp = 40 / v.s / PW1, dyExp = 50 / v.s / PH1;
check('dragging a box corner changes its size (and only the dragged corner moves)', s.panels[0].w < b0.w - dxExp * 0.8 && s.panels[0].h < b0.h - dyExp * 0.8 && Math.abs(s.panels[0].x - b0.x) < 1e-6 && Math.abs(s.panels[0].y - b0.y) < 1e-6,
  'width ' + (b0.w * PW1).toFixed(0) + ' -> ' + (s.panels[0].w * PW1).toFixed(0) + ' px, height ' + (b0.h * PH1).toFixed(0) + ' -> ' + (s.panels[0].h * PH1).toFixed(0) + ' px (expected about ' + (40 / v.s).toFixed(0) + ' and ' + (50 / v.s).toFixed(0) + ' less)');
check('the box that was dragged is the selected one', s.box === 0);
// badge click: switch box 1 off then on
let b1 = s.panels[1], bp = await picPt([b1.x * PW1 + 10 / v.s, b1.y * PH1 + 9 / v.s]);
await page.mouse.click(bp[0], bp[1]); let s1 = await startPage();
const listOff = await page.$eval('#sList', e => e.textContent);
check('clicking a box number badge switches the box off', s1.panels[1].use === false && s1.panels.filter(b => b.use).length === 5, 'use=' + s1.panels[1].use);
check('the list count follows (5 panels on page 1 + 4 on page 2 = 9)', /9 panels/.test(listOff), listOff);
await page.mouse.click(bp[0], bp[1]); s1 = await startPage();
check('clicking the badge again switches it back on', s1.panels[1].use === true && s1.panels.filter(b => b.use).length === 6);
// draw a new box in an empty corner of the page (right of the dialogue box)
const nBefore = s1.panels.length;
await page.click('#sPanelAdd'); check('"Draw a box" switches the tool on', await page.$eval('#sPanelAdd', e => e.classList.contains('on')));
const nb = { x: 430, y: 650, w: 140, h: 100 };
await mouseDrag(await picPt([nb.x / PW * PW1, nb.y / PH * PH1]), await picPt([(nb.x + nb.w) / PW * PW1, (nb.y + nb.h) / PH * PH1]));
s = await startPage();
const added = s.panels.find(b => Math.abs(b.x - nb.x / PW) < 0.02 && Math.abs(b.y - nb.y / PH) < 0.02);
check('drawing a box adds a panel at that spot, switched on, and turns the tool off', s.panels.length === nBefore + 1 && added && added.use === true && added && Math.abs(added.w - nb.w / PW) < 0.02 && !(await page.$eval('#sPanelAdd', e => e.classList.contains('on'))),
  s.panels.length + ' boxes (was ' + nBefore + ')');
const selBox = s.box != null && s.box >= 0 ? s.panels[s.box] : null;
check('the new box is the selected one (so Delete would remove it)', !!selBox && added && near(selBox, added, 1e-6), 'selected index ' + s.box + ' of ' + s.panels.length);
// Delete key removes the selected one
await page.keyboard.press('Delete'); let sd = await startPage();
check('pressing Delete removes the selected box', sd.panels.length === nBefore && !sd.panels.some(b => Math.abs(b.x - nb.x / PW) < 0.02 && Math.abs(b.y - nb.y / PH) < 0.02) && sd.box === null, sd.panels.length + ' boxes');
// a box that sorts FIRST in reading order (top strip): after Delete exactly that box must be gone, not the last one
const lastBefore = { ...sd.panels[sd.panels.length - 1] }; const top = { x: 440, y: 24, w: 140, h: 22 };
await page.click('#sPanelAdd');
await mouseDrag(await picPt([top.x / PW * PW1, top.y / PH * PH1]), await picPt([(top.x + top.w) / PW * PW1, (top.y + top.h) / PH * PH1]));
s = await startPage(); const topAdded = s.panels.find(b => Math.abs(b.x - top.x / PW) < 0.02 && Math.abs(b.y - top.y / PH) < 0.02);
await page.keyboard.press('Delete'); sd = await startPage();
check('Delete after drawing a box that sorts first removes that box, not another one', !!topAdded && sd.panels.length === nBefore && sd.panels.some(b => near(b, lastBefore, 1e-6)) && !sd.panels.some(b => Math.abs(b.x - top.x / PW) < 0.02 && Math.abs(b.y - top.y / PH) < 0.02),
  'new box at index ' + (topAdded ? s.panels.indexOf(topAdded) : '?') + ', selected index ' + s.box + '; last box still there: ' + sd.panels.some(b => near(b, lastBefore, 1e-6)));
// click inside a panel (selects it), then Delete
const b3 = sd.panels[3]; const mid = await picPt([(b3.x + b3.w / 2) * PW1, (b3.y + b3.h / 2) * PH1]); await page.mouse.click(mid[0], mid[1]);
let sc = await startPage(); const selOk = sc.box === 3; await page.keyboard.press('Delete'); sd = await startPage();
check('click a box to select it, Delete removes exactly that one', selOk && sd.panels.length === nBefore - 1 && !sd.panels.some(b => near(b, b3, 1e-6)), 'selected ' + sc.box + ', now ' + sd.panels.length + ' boxes');
check('the Delete button does the same', await (async () => { const b = sd.panels[0], m = await picPt([(b.x + b.w / 2) * PW1, (b.y + b.h / 2) * PH1]); await page.mouse.click(m[0], m[1]); await page.click('#sPanelDel'); return (await startPage()).panels.length === nBefore - 2; })());
await page.screenshot({ path: path.join(out, 'app_start_pdf_edited.png') });
// "Find them again" puts the detection back
await page.click('#sRedetect'); s = await startPage();
check('"Find them again" restores the detected panels', s.panels.length === nBefore && s.how === 'borders');

// ================================================================ 4b: image sequence -> Animation
await (await page.$('#sFiles')).uploadFile(...seqPaths.slice().reverse());
await page.waitForFunction(() => { const it = Start.sel(); return it && it.kind === 'frames' && it.files.length === 5; }, { timeout: 10000 });
const seqInfo = await page.evaluate(() => { const it = Start.sel(); return { name: it.name, files: it.files.map(f => f.name) }; });
check('5 PNGs are taken as one frame sequence, in number order', seqInfo.files.join() === [1, 2, 3, 4, 5].map(i => '_test_seq_' + i + '.png').join() && /_test_seq/.test(seqInfo.name), seqInfo.name);
await page.click('[data-help="animation"]');
await page.waitForFunction(() => document.querySelector('#mode-timing').classList.contains('on') && Timing.T.frames.length === 5, { timeout: 15000 }).catch(() => {});
await sleep(300);
const tm = await page.evaluate(() => ({ on: document.querySelector('#mode-timing').classList.contains('on'), n: Timing.T.frames.length, names: Timing.T.frames.map(f => f.name), info: document.querySelector('#tInfo').textContent }));
check('Help > Animation shows Timing with all 5 frames loaded, in order', tm.on && tm.n === 5 && tm.names.join() === [1, 2, 3, 4, 5].map(i => '_test_seq_' + i + '.png').join() && /^5 drawings/.test(tm.info), tm.n + ' frames; "' + tm.info + '"');
await page.click('[data-mode="start"]');
await page.evaluate(() => Start.pick(Start.items.find(i => i.kind === 'frames')));
await page.keyboard.press('ArrowRight'); await sleep(250);
check('on the Start tab the arrow keys step through a sequence', /2 of 5/.test(await page.$eval('#sReadout', e => e.textContent)), await page.$eval('#sReadout', e => e.textContent));

// ================================================================ 5: video
const webm = path.join(out, '_test_dot.webm');
const vid = await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 320; c.height = 180; const g = c.getContext('2d'), stream = c.captureStream(30);
  const types = ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm'], mt = types.find(t => MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(stream, { mimeType: mt }), chunks = []; rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const done = new Promise(r => rec.onstop = r); const T = 2.0; let t0 = null, stop = false;
  const frame = ts => { if (t0 === null) t0 = ts; const t = (ts - t0) / 1000, x = 30 + (t / 1.5) * 260; g.fillStyle = '#fff'; g.fillRect(0, 0, 320, 180); g.fillStyle = '#e02020'; g.beginPath(); g.arc(Math.min(x, 290), 90, 14, 0, 7); g.fill(); if (t < T) requestAnimationFrame(frame); else { stop = true; rec.stop(); } };
  rec.start(); requestAnimationFrame(frame); await done;
  const b = new Blob(chunks, { type: 'video/webm' }), buf = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode(...buf.subarray(i, i + 8192));
  return { b64: btoa(s), mt, size: buf.length };
});
fs.writeFileSync(webm, Buffer.from(vid.b64, 'base64'));
await (await page.$('#sFiles')).uploadFile(webm);
await page.waitForFunction(() => { const it = Start.sel(); return it && it.kind === 'video'; }, { timeout: 15000 }).catch(() => {});
const vinfo = await page.evaluate(() => { const it = Start.sel(); return it && it.kind === 'video' ? { dur: it.dur, w: it.w, h: it.h, to: it.to, txt: document.querySelector('#sVideoInfo').textContent, from: document.querySelector('#sFrom').value, toVal: document.querySelector('#sTo').value } : null; });
check('a recorded WebM opens as a video with a real duration', !!vinfo && Number.isFinite(vinfo.dur) && vinfo.dur > 1 && vinfo.w === 320 && vinfo.h === 180, vinfo ? 'duration ' + vinfo.dur + ', ' + vinfo.w + 'x' + vinfo.h + ', "' + vinfo.txt + '"' : 'no video item (' + vid.mt + ', ' + vid.size + ' bytes)');
await page.select('#sFps', '12');
await page.$eval('#sFrom', e => { e.value = '0'; e.dispatchEvent(new Event('change', { bubbles: true })); });
await page.$eval('#sTo', e => { e.value = '1.5'; e.dispatchEvent(new Event('change', { bubbles: true })); });
await page.click('#sPull');
await page.waitForFunction(() => { const it = Start.sel(); return it && it.frames; }, { timeout: 90000 }).catch(() => {});
const fr = await page.evaluate(async () => {
  const it = Start.sel(); if (!it || !it.frames) return null; const xs = [];
  for (const f of it.frames) { const im = await createImageBitmap(f), c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data; let sx = 0, n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 170 && d[i + 1] < 90 && d[i + 2] < 90) { sx += (i / 4) % c.width; n++; } xs.push(n > 20 ? sx / n : null); }
  return { n: it.frames.length, types: it.frames.map(f => f.type), names: it.frames.map(f => f.name), isFile: it.frames.every(f => f instanceof File), xs, info: document.querySelector('#sVideoInfo').textContent };
});
check('pulling frames at 12 a second from 1.5 s gives about 19 frames (17 to 21)', !!fr && fr.n >= 17 && fr.n <= 21, fr ? fr.n + ' frames; ' + fr.info : 'no frames pulled');
check('each frame is a JPEG File', !!fr && fr.isFile && fr.types.every(t => t === 'image/jpeg') && fr.names.every(n => /\.jpg$/.test(n)) && /_dot_0001\.jpg$/.test(fr.names[0]), fr ? fr.names.slice(0, 2).join(', ') : '');
const xs = fr ? fr.xs : [], good = xs.filter(x => x != null);
let mono = good.length === xs.length && good.length > 5; for (let i = 1; i < good.length; i++) if (good[i] < good[i - 1] - 1) mono = false;
check('the dot moves across the frames (position changes, steadily left to right)', mono && good[good.length - 1] - good[0] > 100, good.length ? 'x from ' + good[0].toFixed(0) + ' to ' + good[good.length - 1].toFixed(0) + ' over ' + good.length + ' frames' : 'dot not found in any frame');
check('the dot is not stuck: at least 10 different positions', new Set(good.map(x => Math.round(x / 3))).size >= 10);
await page.click('[data-help="animation"]');
await page.waitForFunction(n => document.querySelector('#mode-timing').classList.contains('on') && Timing.T.frames.length === n, { timeout: 15000 }, fr ? fr.n : 0).catch(() => {});
check('Help > Animation on the video loads its pulled frames into Timing', fr && await page.evaluate(n => Timing.T.frames.length === n, fr.n), String(await page.evaluate(() => Timing.T.frames.length)));

// ================================================================ 6: Perspective layers
await page.click('[data-mode="perspective"]');
await (await page.$('#pBoardFile')).uploadFile(board);
await page.waitForFunction(() => Persp.S.W === 3840 && Persp.S.boardName === '_test_board3840' && Persp.UI.boards.length === 1, { timeout: 10000 });
const rowOf = key => page.evaluateHandle(k => document.querySelector('[data-g="' + k + '"]').closest('.lrow'), key);
const waitFile = async (pat, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const f = fs.readdirSync(dl).find(n => pat.test(n) && !/\.crdownload$/.test(n)); if (f) return path.join(dl, f); await sleep(150); } return null; };
const pngInfo = async f => { const b64 = fs.readFileSync(f).toString('base64'); return page.evaluate(async b64 => { const im = new Image(); await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = 'data:image/png;base64,' + b64; }); const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; const g = c.getContext('2d'); g.drawImage(im, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data; let clear = 0, solid = 0, partial = 0; for (let i = 3; i < d.length; i += 4) { if (d[i] === 0) clear++; else if (d[i] >= 200) solid++; else partial++; } return { w: c.width, h: c.height, clear, solid, partial, total: c.width * c.height }; }, b64); };
const ihdr = f => { const b = fs.readFileSync(f); return { sig: b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };

const gridRow = await rowOf('grid'); const gridBtn = await gridRow.asElement().$('.lexp');
check('every layer row has an export button (the down arrow)', await page.$$eval('#pLayers .lrow', rows => rows.length > 5 && rows.every(r => r.querySelector('.lexp'))), String(await page.$$eval('#pLayers .lrow', rows => rows.length)) + ' rows');
await gridBtn.click();
const gridFile = await waitFile(/_test_board3840_grid\.png$/);
check('exporting "Floor grid" downloads <board>_grid.png', !!gridFile, gridFile ? path.basename(gridFile) : 'nothing downloaded: ' + fs.readdirSync(dl).join(','));
if (gridFile) {
  const h = ihdr(gridFile), p = await pngInfo(gridFile);
  check('the exported layer is a PNG of exactly 3840 x 1920', h.sig && h.w === 3840 && h.h === 1920 && p.w === 3840 && p.h === 1920, h.w + 'x' + h.h);
  check('it is transparent (most pixels clear) with some opaque ink', p.clear > p.total * 0.8 && p.solid > 5000 && p.clear + p.solid + p.partial === p.total, 'clear ' + (100 * p.clear / p.total).toFixed(1) + '%, opaque ' + p.solid + ', soft ' + p.partial);
  // it must hold ONLY the grid: no red horizon, no blue rays
  const only = await page.evaluate(async b64 => { const im = new Image(); await new Promise(r => { im.onload = r; im.src = 'data:image/png;base64,' + b64; }); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data; let red = 0, blue = 0; for (let i = 0; i < d.length; i += 4) { if (d[i + 3] > 100 && d[i] > 200 && d[i + 1] < 90) red++; if (d[i + 3] > 100 && d[i + 2] > 180 && d[i] < 90) blue++; } return { red, blue }; }, fs.readFileSync(gridFile).toString('base64'));
  check('the one-layer export holds only that layer (no red horizon, no blue depth rays)', only.red === 0 && only.blue === 0, JSON.stringify(only));
}
const exportsOnDisk = (() => { try { return fs.readdirSync(path.join(work, '_test_board3840', 'exports')); } catch (e) { return []; } })();
check('a copy of the export was also saved into work/<board>/exports/ (through the server)', exportsOnDisk.includes('_test_board3840_grid.png'), exportsOnDisk.join());
// opacity: horizon at 100 then 30
const horizonMax = (only) => page.evaluate(only => { const c = Persp.guideCanvas(only), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let m = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > m) m = d[i]; return m; }, only);
const horizonAt = () => page.evaluate(() => { const c = Persp.guideCanvas('horizon'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let m = 0, y = -1; for (let i = 3; i < d.length; i += 4) if (d[i] > m) { m = d[i]; y = ((i - 3) / 4 / c.width) | 0; } return { m, y }; });
const hRow = await rowOf('horizon'); const slider = await hRow.asElement().$('input[type=range]');
const setSlider = async (el, val) => el.evaluate((e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, val);
const full100 = await horizonAt(); await setSlider(slider, 30); const full30 = await horizonAt();
check('the Horizon opacity slider at 100 draws a solid horizon', full100.m >= 250 && full100.y > 0, 'max alpha ' + full100.m + ' at y=' + full100.y);
check('at 30 the drawn horizon is fainter (about 30% of full)', full30.m > 50 && full30.m < 110 && full30.m < full100.m * 0.5, 'max alpha ' + full30.m + ' (was ' + full100.m + ')');
// the same in the complete guide (all layers on) along the horizon row
const alongRow = y => page.evaluate(y => { const c = Persp.guideCanvas(), d = c.getContext('2d').getImageData(0, y - 2, c.width, 5).data; let m = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > m) m = d[i]; return m; }, y);
check('and the setting is remembered on the page (slider value 30, saved in the guide settings)', await page.evaluate(() => Persp.S.guide.op.horizon === 30) && (await slider.evaluate(e => +e.value)) === 30);
await setSlider(slider, 100);
// the layer opacity also reaches the full export: at 0 the horizon is gone from the whole guide
await setSlider(slider, 0); const zero = await horizonAt(); check('at 0 the horizon is invisible in its export', zero.m === 0, 'max alpha ' + zero.m); await setSlider(slider, 100);
// before / after
const shotCanvas = async () => page.evaluate(() => { const cv = document.querySelector('#pCanvas'), g = cv.getContext('2d'), v = Persp.UI.view, r = document.querySelector('#pStage').getBoundingClientRect(), dpr = cv.width / r.width; return { w: cv.width, h: cv.height, dpr, v: { ...v }, S: { W: Persp.S.W, H: Persp.S.H }, ba: Persp.BA.x }; });
const region = (x0, x1) => page.evaluate((x0, x1) => { const cv = document.querySelector('#pCanvas'), g = cv.getContext('2d'), v = Persp.UI.view, dpr = cv.width / document.querySelector('#pStage').getBoundingClientRect().width, y0 = Math.round((v.y + 8) * dpr), y1 = Math.round((v.y + Persp.S.H * v.s - 8) * dpr), d = g.getImageData(Math.round(x0), y0, Math.max(1, Math.round(x1 - x0)), y1 - y0).data; let bg = 0, other = 0; for (let i = 0; i < d.length; i += 4) { const same = Math.abs(d[i] - 250) < 6 && Math.abs(d[i + 1] - 245) < 6 && Math.abs(d[i + 2] - 235) < 6; const dark = d[i] < 40 && d[i + 1] < 40; if (same) bg++; else if (!dark) other++; } return { bg, other }; }, x0, x1);
await page.evaluate(() => Persp.fit && Persp.fit()); await sleep(200);
let sc2 = await shotCanvas(); const imgL = (sc2.v.x + 12) * sc2.dpr, imgR = (sc2.v.x + sc2.S.W * sc2.v.s - 12) * sc2.dpr;
const base = await region(imgL, imgR);
check('before turning the slider on, the picture carries the guide all over (sanity)', base.other > 2000, JSON.stringify(base));
await page.click('#pBA'); await sleep(200); sc2 = await shotCanvas();
const splitX = sc2.ba * sc2.dpr;
const left = await region(imgL, splitX - 8 * sc2.dpr), right = await region(splitX + 8 * sc2.dpr, imgR);
check('before / after: the left of the handle shows the plain board (no grid colours at all)', left.bg > 20000 && left.other === 0, JSON.stringify(left));
check('before / after: the right of the handle still has the grid', right.other > 500, JSON.stringify(right));
// drag the handle with the real mouse: the split must follow
const hbox = await (await page.$('.ba-handle')).boundingBox();
const hx = hbox.x + hbox.width / 2, hy = hbox.y + hbox.height / 2;
await page.mouse.move(hx, hy); await page.mouse.down(); await page.mouse.move(hx - 120, hy, { steps: 6 }); await page.mouse.up(); await sleep(150);
const sc3 = await shotCanvas();
check('dragging the handle moves the split (about 120 px left)', Math.abs((sc2.ba - sc3.ba) - 120) < 12, 'moved ' + (sc2.ba - sc3.ba).toFixed(0) + ' px');
const left2 = await region(imgL, sc3.ba * sc3.dpr - 8 * sc3.dpr);
check('and the plain board still fills the left of the new position', left2.other === 0 && left2.bg > 10000, JSON.stringify(left2));
await page.screenshot({ path: path.join(out, 'app_start_before_after.png') });
await page.click('#pBA'); await sleep(150);
check('turning before / after off hides the handle and the guide returns on the left', (await page.$eval('.ba-handle', e => getComputedStyle(e).display)) === 'none' && (await region(imgL, imgL + 200)).other > 100);

// ================================================================ 6b: numbered versions through the real Store and the server
const ver = await page.evaluate(async () => {
  const res = [];
  for (let i = 1; i <= 3; i++) res.push(await Store.saveVersion('_test_ver', 'shot01', 'edit', new Blob(['edit body ' + i], { type: 'image/png' })));
  return res;
});
const verDir = path.join(work, '_test_ver');
check('Store.saveVersion three times gives shot01_edit_v1.png, _v2.png, _v3.png', ver.map(v => v.name).join() === 'shot01_edit_v1.png,shot01_edit_v2.png,shot01_edit_v3.png' && ver.map(v => v.v).join() === '1,2,3', ver.map(v => v.name).join(', '));
check('all three exist in work/_test_ver/ with their own bytes', [1, 2, 3].every(i => { try { return fs.readFileSync(path.join(verDir, 'shot01_edit_v' + i + '.png'), 'utf8') === 'edit body ' + i; } catch (e) { return false; } }) && ver.every(v => v.path && /^work\/_test_ver\/shot01_edit_v\d\.png$/.test(v.path)));
// a stale browser memory must not cause an overwrite: forget the counter, the server folder still says v3 is taken
await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
const again = await page.evaluate(async () => Store.saveVersion('_test_ver', 'shot01', 'edit', new Blob(['edit body 4'])));
check('with the browser own counter wiped, the next one is still v4 (the folder is the truth)', again.name === 'shot01_edit_v4.png' && fs.readFileSync(path.join(verDir, 'shot01_edit_v1.png'), 'utf8') === 'edit body 1', again.name);
const clash = await page.evaluate(async () => { const r = await Store.save('work/_test_ver/shot01_edit_v1.png', new Blob(['clobber'])); return r; });
check('Store.save onto an existing version reports {exists: true} and leaves the file alone', clash.ok === false && clash.exists === true && fs.readFileSync(path.join(verDir, 'shot01_edit_v1.png'), 'utf8') === 'edit body 1', JSON.stringify(clash));
const sh = await page.evaluate(async () => { const a = await Store.saveShot('_test_ver', { n: 1 }), b = await Store.saveShot('_test_ver', { n: 2 }); return [a.ok, b.ok, await Store.loadShot('_test_ver')]; });
check('Store.saveShot can be repeated (shot.json is replaced) and loadShot reads the latest', sh[0] && sh[1] && sh[2] && sh[2].n === 2, JSON.stringify(sh));

// ================================================================ 7
check('no script errors in the page', errors.length === 0, errors.slice(0, 4).join(' | '));
console.log('\n(expected network noise filtered out: ' + seen409.length + ' write-once 409 / first-time 404 console lines)');
console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
await finish(fails ? 1 : 0);
