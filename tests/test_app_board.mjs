// The Storyboard tab (build step 9): the 180 line and screen direction checks, the shot size guess, finding the cuts in
// an animatic, holds, camera moves dragged on the panel, the overhead map, playback, the shot list (CSV and sheet),
// transparent overlays at the panel's exact size, saving and picking up the board again, and Start > Storyboard.
//   node tests/test_app_board.mjs
// Needs puppeteer-core (npm i puppeteer-core, in _scratch/ is fine) and Chrome or Edge. Starts serve.py on a free port.
// Every input is generated here, and every work/_test_board* folder is removed after.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'tests', 'out'); fs.mkdirSync(out, { recursive: true });
const dl = path.join(out, 'board_downloads'); fs.rmSync(dl, { recursive: true, force: true }); fs.mkdirSync(dl, { recursive: true });
const inDir = path.join(out, '_test_board_in'); fs.rmSync(inDir, { recursive: true, force: true }); fs.mkdirSync(inDir, { recursive: true });
const work = path.join(root, 'work');
let fails = 0;
const check = (name, ok, detail) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ' + detail : '')); if (!ok) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cleanWork = () => { try { for (const n of fs.readdirSync(work)) if (n.startsWith('_test_board')) fs.rmSync(path.join(work, n), { recursive: true, force: true }); } catch (e) {} };
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const py = (code, ...args) => execFileSync('python', ['-P', '-c', code, ...args], { maxBuffer: 1 << 26 }).toString();

let puppeteer;
for (const base of [root, path.join(root, '_scratch'), process.cwd()]) { try { puppeteer = createRequire(path.join(base, 'x.js'))('puppeteer-core'); break; } catch (e) {} }
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
if (!puppeteer || !chrome) { console.log('FAIL  cannot run: ' + (!puppeteer ? 'puppeteer-core is not installed' : 'no Chrome or Edge found')); process.exit(1); }

// ---------------------------------------------------------------- inputs: four 1280 x 720 panels, named so name order is not text order
// 1 a small full figure (long shot), 2 a figure cut by the bottom (medium), 10 a face running off the frame (close-up), 3 empty
py([
  'import sys, os', 'from PIL import Image, ImageDraw', 'd0 = sys.argv[1]',
  'def panel(name, draw):', '    im = Image.new("RGB", (1280, 720), (252, 250, 246)); d = ImageDraw.Draw(im); d.rectangle((4, 4, 1275, 715), outline=(20, 20, 20), width=6); draw(d); im.save(os.path.join(d0, name))',
  'def fig(d, cx, top, h):',
  '    hd = h / 6; d.ellipse((cx - hd / 2, top, cx + hd / 2, top + hd), outline=(25, 25, 30), width=6)',
  '    d.line((cx, top + hd, cx, top + h * 0.55), fill=(25, 25, 30), width=8); d.line((cx - h * 0.18, top + h * 0.3, cx + h * 0.18, top + h * 0.3), fill=(25, 25, 30), width=8)',
  '    d.line((cx, top + h * 0.55, cx - h * 0.12, top + h), fill=(25, 25, 30), width=8); d.line((cx, top + h * 0.55, cx + h * 0.12, top + h), fill=(25, 25, 30), width=8)',
  'panel("_test_board_p1.png", lambda d: fig(d, 640, 260, 300))',
  'panel("_test_board_p2.png", lambda d: fig(d, 640, 120, 1100))',
  'panel("_test_board_p10.png", lambda d: (d.ellipse((240, -160, 1040, 900), outline=(25, 25, 30), width=10), d.ellipse((480, 330, 540, 390), fill=(25, 25, 30)), d.ellipse((740, 330, 800, 390), fill=(25, 25, 30))))',
  'panel("_test_board_p3.png", lambda d: None)'].join('\n'), inDir);
const panels = ['_test_board_p1.png', '_test_board_p2.png', '_test_board_p3.png', '_test_board_p10.png'].map(n => path.join(inDir, n));
const shas = panels.map(sha);

// ---------------------------------------------------------------- server and browser
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const port = await freePort();
cleanWork();
const server = spawn('python', ['-P', path.join(root, 'serve.py'), '--port', String(port), '--no-open'], { cwd: root, stdio: 'ignore' });
let browser;
const finish = async code => { try { if (browser) await browser.close(); } catch (e) {} try { server.kill(); } catch (e) {} await sleep(300); cleanWork(); fs.rmSync(inDir, { recursive: true, force: true }); process.exit(code); };
process.on('uncaughtException', async e => { console.log('FAIL  the test itself crashed: ' + (e && e.stack || e)); await finish(1); });
process.on('unhandledRejection', async e => { console.log('FAIL  the test itself crashed: ' + (e && e.stack || e)); await finish(1); });
for (let i = 0; i < 50; i++) { try { const r = await fetch('http://127.0.0.1:' + port + '/api/ping'); if (r.ok) break; } catch (e) {} await sleep(200); }
browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--window-size=1700,980'] });
const errors = [];
async function newPage() {
  const pg = await browser.newPage(); await pg.setViewport({ width: 1700, height: 980 });
  pg.on('pageerror', e => errors.push('pageerror: ' + e.message));
  pg.on('console', m => { if (m.type() !== 'error') return; const u = (m.location() && m.location().url) || ''; if (/favicon\.ico|\/work\/|\/api\/save/.test(u + ' ' + m.text())) return; errors.push('console: ' + m.text() + ' ' + u); });
  await (await pg.createCDPSession()).send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
  await pg.goto('http://127.0.0.1:' + port + '/animation_app.html');
  await pg.waitForFunction(() => typeof Store !== 'undefined' && typeof ModTabs !== 'undefined');
  return pg;
}
let page = await newPage();
const ev = (fn, ...a) => page.evaluate(fn, ...a);
const guard = async (name, fn) => { try { await fn(); } catch (e) { check(name + ' (crashed)', false, String(e && e.message || e).slice(0, 300)); } };
const waitFile = async (p, ms = 15000) => { for (let t = 0; t < ms; t += 200) { if (fs.existsSync(p) && fs.statSync(p).size > 0) { await sleep(150); return true; } await sleep(200); } return false; };

// ================================================================ the continuity math (pure functions)
await guard('the 180 line and screen direction', async () => {
  const r = await ev(async () => {
    const m = await import('/app/js/board-tab.mjs');
    const A = { id: 'A', x: 0.4, y: 0.5, face: 0, walk: false }, B = { id: 'B', x: 0.9, y: 0.5, face: 180, walk: false };
    const map = (cx, cy, aim, chars) => ({ cam: { x: cx, y: cy, aim, fov: 50 }, chars: chars || [{ ...A }, { ...B }] });
    const south = map(0.65, 0.95, -90), north = map(0.65, 0.05, 90), onLine = map(0.1, 0.5, 0);
    const walkR = map(0.65, 0.95, -90, [{ ...A, walk: true, face: 0 }, { ...B }]), walkL = map(0.65, 0.95, -90, [{ ...A, walk: true, face: 180 }, { ...B }]), walkAt = map(0.65, 0.95, -90, [{ ...A, walk: true, face: 90 }, { ...B }]);
    return {
      orderSouth: m.order(south), orderNorth: m.order(north), sides: [m.side(south), m.side(north), m.side(onLine)],
      across: [m.across(south, { x: 0.65, y: 0.5 }), m.across(south, { x: 0.65, y: 1 })],
      heads: [m.heading(walkR, walkR.chars[0]), m.heading(walkL, walkL.chars[0]), m.heading(walkAt, walkAt.chars[0])],
      cross: m.continuity([south, south, north]).map(f => [f.i, f.kind]),
      setup: m.continuity([south, south, north], [false, false, true]).length,
      bridge: m.continuity([south, onLine, north]).length,
      flip: m.continuity([walkR, walkL]).map(f => [f.i, f.kind]),
      flipBridged: m.continuity([walkR, walkAt, walkL]).length,
      dashes: m.continuity([south, north]).map(f => f.text).join(' ')
    };
  });
  check('from south of the line A is screen left of B, from north screen right', r.orderSouth === 'left' && r.orderNorth === 'right', r.orderSouth + ' / ' + r.orderNorth);
  check('the camera side flips across the line and is 0 on it', r.sides.join() === '1,-1,0' || r.sides.join() === '-1,1,0', r.sides.join());
  check('a point straight ahead is mid frame, one behind is null', Math.abs(r.across[0]) < 1e-9 && r.across[1] === null);
  check('walking right, left and straight at the camera read as 1, -1, 0', r.heads.join() === '1,-1,0', r.heads.join());
  check('crossing the line between cuts is flagged on the panel that crosses', JSON.stringify(r.cross) === '[[2,"line"]]', JSON.stringify(r.cross));
  check('"New setup here" clears that note', r.setup === 0);
  check('a shot right on the line lets the next one cross with no note', r.bridge === 0);
  check('a walk that flips screen direction is flagged', JSON.stringify(r.flip) === '[[1,"dir"]]', JSON.stringify(r.flip));
  check('a shot of the walk head on in between bridges the flip', r.flipBridged === 0);
  check('the notes say "look here" and have no em or en dashes', /Look here/.test(r.dashes) && !/[\u2013\u2014]/.test(r.dashes));
});

// ================================================================ the tab
await page.click('#tabs .tab[data-mode="board"]');
await page.waitForFunction(() => window.Board, { timeout: 20000 });
check('the Storyboard tab opens through the module loader', true);
await (await page.$('#bdFiles')).uploadFile(...panels.slice().reverse());
await page.waitForFunction(() => Board.P.length === 4, { timeout: 20000 });

await guard('opening panels', async () => {
  const st = await ev(() => ({ names: Board.P.map(p => p.name), frames: Board.P.map(p => p.frames), sizes: Board.P.map(p => p.size), why: Board.P.map(p => p.sizeGuess && p.sizeGuess.why), name: Board.S.name, total: Board.total() }));
  check('panels open in number order (p1, p2, p3, p10), whatever order they were picked in', st.names.join() === '_test_board_p1.png,_test_board_p2.png,_test_board_p3.png,_test_board_p10.png', st.names.join());
  check('each holds 2 seconds at 24 fps to start', st.frames.every(f => f === 48) && st.total === 192);
  check('the board is named after the shared part of the file names', st.name === '_test_board', st.name);
  check('shot size guesses: small figure long, cut figure medium, big face close-up', st.sizes[0] === 'LS' && ['MS', 'MLS'].includes(st.sizes[1]) && st.sizes[3] === 'CU', st.sizes.join());
  check('every guess says it is a guess, and an empty panel says to pick', st.why[0].startsWith('Guess:') && /pick a size yourself/.test(st.why[2]), st.why[2]);
});

await guard('holds and timing', async () => {
  await ev(() => Board.pick(1));
  await page.$eval('#bdFrames', el => { el.value = '30'; el.dispatchEvent(new Event('input')); });
  const st = await ev(() => ({ f: Board.P[1].frames, total: Board.total(), starts: Board.starts(), tc: Board.tc(Board.total()) }));
  check('typing a hold changes that panel and the running total', st.f === 30 && st.total === 174 && st.starts.join() === '0,48,78,126', JSON.stringify(st));
  check('timecode counts frames at the board rate', st.tc === '00:00:07:06', st.tc);
  const strip = await page.$('#bdLine'), box = await strip.boundingBox();
  const edge = await ev(() => { const r = document.querySelector('#bdLine').getBoundingClientRect(), ppf = (r.width - 20) / Board.total(); return { x: r.left + 10 + 78 * ppf, ppf }; });
  await page.mouse.move(edge.x, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(edge.x + 12 * edge.ppf, box.y + box.height / 2, { steps: 4 }); await page.mouse.up();
  const f2 = await ev(() => Board.P[1].frames);
  check('dragging a panel\'s right edge in the strip changes its hold', Math.abs(f2 - 42) <= 1, f2 + ' frames');
});

await guard('camera moves', async () => {
  await ev(() => Board.pick(0)); await page.select('#bdMove', 'truck');
  const m0 = await ev(() => JSON.parse(JSON.stringify(Board.P[0].move)));
  check('a truck move starts on the full panel and ends tighter', m0.kind === 'truck' && m0.a.join() === '0,0,1280,720' && m0.b[2] < 1280, JSON.stringify(m0));
  check('it is described in plain words', (await ev(() => Board.moveWords(Board.P[0]))) === 'TRUCK IN', await ev(() => Board.moveWords(Board.P[0])));
  const c = await ev(() => { const v = Board.S.view, r = document.querySelector('#bdView').getBoundingClientRect(), b = Board.P[0].move.b; return { x: r.left + v.x + (b[0] + b[2] / 2) * v.s, y: r.top + v.y + (b[1] + b[3] / 2) * v.s, s: v.s }; });
  await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.move(c.x + 200 * c.s, c.y, { steps: 5 }); await page.mouse.up();
  const m1 = await ev(() => JSON.parse(JSON.stringify(Board.P[0].move)));
  check('the end frame drags on the panel', Math.abs(m1.b[0] - (m0.b[0] + 200)) < 3 && m1.touched, m1.b[0] + ' vs ' + (m0.b[0] + 200));
  check('a sideways drag adds a pan to the words', (await ev(() => Board.moveWords(Board.P[0]))) === 'TRUCK IN + PAN RIGHT');
  const name = await ev(() => Board.exportLayer('move', 0));
  const f = path.join(dl, name);
  const info = await waitFile(f) && JSON.parse(py('import sys, json\nfrom PIL import Image\nim = Image.open(sys.argv[1]).convert("RGBA")\nprint(json.dumps({"size": im.size, "corner": im.getpixel((200, 650))[3], "edge": im.getpixel((1, 360))[3]}))', f));
  check('the camera move exports at the panel\'s exact size, transparent', info && info.size.join() === '1280,720' && info.corner === 0 && info.edge > 100, JSON.stringify(info));
});

await guard('the overhead map', async () => {
  await ev(() => Board.pick(2));
  const before = await ev(() => Board.checks().length);
  const r = await ev(() => { const cv = document.querySelector('#bdMap'), b = cv.getBoundingClientRect(), MW = 1.3, k = Math.min(b.width / MW, b.height), ox = (b.width - MW * k) / 2, oy = (b.height - k) / 2, m = Board.mapOf(2);
    const P = (x, y) => [b.left + ox + x * k, b.top + oy + y * k]; return { cam: P(m.cam.x, m.cam.y), to: P(m.cam.x, 0.06), aimTo: P(m.cam.x, 0.6) }; });
  await page.mouse.move(r.cam[0], r.cam[1]); await page.mouse.down(); await page.mouse.move(r.to[0], r.to[1], { steps: 8 }); await page.mouse.up();
  const st = await ev(() => ({ own: !!Board.P[2].map, follow: !Board.P[3].map, flags: Board.checks().map(f => [f.i, f.kind]), info: document.querySelector('#bdMapInfo').textContent, list: document.querySelector('#bdFlags').textContent }));
  check('dragging the camera gives this panel its own map, later panels follow it', st.own && st.follow);
  check('moving the camera across the A-B line flags that cut', before === 0 && JSON.stringify(st.flags) === '[[2,"line"]]', JSON.stringify(st.flags));
  check('the note is in plain words with the panel numbers', /crosses the 180 line/.test(st.list) && /panel 2/.test(st.list), st.list.slice(0, 160));
  await page.click('#bdSetup');
  check('ticking "New setup here" clears it', (await ev(() => Board.checks().length)) === 0);
  await page.click('#bdSetup');
});

await guard('the shot list', async () => {
  await ev(() => Board.pick(3)); await page.$eval('#bdNote', el => { el.value = 'she waves, "hi!"'; el.dispatchEvent(new Event('input')); });
  const csvName = await ev(() => Board.exportCsv()), csvF = path.join(dl, csvName);
  const csv = (await waitFile(csvF)) ? fs.readFileSync(csvF, 'utf8') : '';
  const lines = csv.replace(/^\uFEFF/, '').trim().split(/\r\n/);
  check('the CSV has a header, one row per panel and a total', lines.length === 6 && lines[0].startsWith('Panel,File,Shot size') && lines[5].startsWith('Total'), lines.length + ' lines');
  check('a note with commas and quotes survives in the CSV', lines[4].includes('"she waves, ""hi!"""'), lines[4]);
  check('the crossing note is on panel 3\'s row', /crosses the 180 line/.test(lines[3]), lines[3].slice(0, 120));
  check('in and out timecodes follow the holds', lines[1].includes('00:00:00:00') && lines[2].includes('00:00:02:00'), lines[2]);
  const sheet = await ev(() => Board.exportSheet()), sf = path.join(dl, sheet);
  const si = (await waitFile(sf)) && JSON.parse(py('import sys, json\nfrom PIL import Image\nim = Image.open(sys.argv[1])\nprint(json.dumps(im.size))', sf));
  check('the shot list sheet is a picture of all four panels in a row', si && si[0] > 2000 && si[1] > 400, JSON.stringify(si));
});

await guard('playback', async () => {
  await ev(() => Board.setFps(48));
  await page.click('#bdPlay'); await sleep(1500);
  const st = await ev(() => ({ playing: !!Board.S.play, f: Board.S.play && Board.S.play.f, cur: Board.S.cur }));
  await page.click('#bdPlay');
  check('Play runs through the board in time', st.playing && st.f > 30 && st.cur >= 0, JSON.stringify(st));
  check('Stop stops it', !(await ev(() => !!Board.S.play)));
  await ev(() => Board.setFps(24));
});

await guard('saving and picking up again', async () => {
  const p = await ev(() => Board.saveBoard());
  const f = path.join(work, '_test_board', 'shot.json'), shot = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null, b = shot && shot.detections.board;
  check('the board saves into the shot file', p === 'work/_test_board/shot.json' && b && b.panels.length === 4 && b.panels[3].note === 'she waves, "hi!"' && b.panels[2].map, p);
  check('her panels are untouched', panels.every((q, i) => sha(q) === shas[i]));
  page = await newPage();
  await page.click('#tabs .tab[data-mode="board"]'); await page.waitForFunction(() => window.Board, { timeout: 20000 });
  await (await page.$('#bdFiles')).uploadFile(...panels);
  await page.waitForFunction(() => Board.P.length === 4, { timeout: 20000 });
  await sleep(500);
  const st = await ev(() => ({ frames: Board.P.map(p => p.frames), note: Board.P[3].note, move: Board.P[0].move && Board.P[0].move.kind, flags: Board.checks().length, info: document.querySelector('#bdInfo').textContent }));
  check('opening the same panels picks up the holds, notes, moves and maps', st.frames[1] === b.panels[1].frames && st.note === 'she waves, "hi!"' && st.move === 'truck' && st.flags === 1, JSON.stringify(st));
  check('and says so', /Picked up where you left off/.test(st.info), st.info);
});

await guard('finding the cuts in an animatic', async () => {
  const r = await ev(async () => {
    const m = await import('/app/js/board-tab.mjs'), frames = [];
    const shot = (bg, n, wob) => { for (let i = 0; i < n; i++) { const c = document.createElement('canvas'); c.width = 320; c.height = 180; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 320, 180); g.fillStyle = bg; g.fillRect(40 + (wob ? i % 2 : 0), 40, 120, 100); frames.push(c); } };
    shot('#222', 6, true); shot('#c33', 4, false); shot('#36c', 5, true);
    return m.runs(frames);
  });
  check('three held drawings in 15 frames come back as three shots', JSON.stringify(r) === '[[0,6],[6,10],[10,15]]', JSON.stringify(r));
});

await guard('the Start tab route', async () => {
  await page.click('#tabs .tab[data-mode="start"]');
  await (await page.$('#sFiles')).uploadFile(panels[1]);
  await sleep(800);
  await page.click('[data-help="storyboard"]');
  await page.waitForFunction(() => Board.P.length === 1 && Board.P[0].name.includes('_test_board_p2') && document.querySelector('#mode-board').classList.contains('on'), { timeout: 15000 });
  check('Start > Storyboard opens the picture in the Storyboard tab', true);
});

const src = fs.readFileSync(path.join(root, 'app', 'js', 'board-tab.mjs'), 'utf8');
check('no em or en dashes in the storyboard code', !/[\u2013\u2014]/.test(src));
check('no errors on the page', !errors.length, errors.slice(0, 5).join(' | '));
console.log('\n' + (fails ? fails + ' FAILED' : 'ALL PASS'));
await finish(fails ? 1 : 0);
