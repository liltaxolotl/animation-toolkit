// Frame import and perspective grids in animation_app.html: Photoshop files, finding lines and vanishing points in a
// picture, checking a drawing against the grid, placing and dragging vanishing points, a grid on a blank frame,
// the character height check, and one grid carried across the frames of a shot.
//   node tests/test_app_frames.mjs
// Part 1 (no browser): the PSD reader and the line finder inside the HTML, on pictures made here.
// Part 2 (headless Chrome, needs `npm i puppeteer-core`): the same through the Perspective tab. Needs no artwork.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'tests', 'out'); fs.mkdirSync(out, { recursive: true });
const html = fs.readFileSync(path.join(root, 'animation_app.html'), 'utf8'), block = n => html.split('/*' + n + '-START*/')[1].split('/*' + n + '-END*/')[0];
const Psd = new Function(block('PSD') + '; return Psd;')(), LF = new Function(block('LINES') + '; return LineFind;')();
let fails = 0;
const check = (name, ok, detail) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ' + detail : '')); if (!ok) fails++; };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ---------------------------------------------------------------- part 1a: Photoshop files
// a PSD written by hand: header, three empty sections, then the flattened picture (planes: all the red, all the green, all the blue)
function psd(w, h, planes, opt) {
  opt = opt || {}; const depth = opt.depth || 8, bps = depth / 8, ch = planes.length, parts = [], u16 = v => Buffer.from([v >> 8 & 255, v & 255]), u32 = v => Buffer.from([v >>> 24 & 255, v >> 16 & 255, v >> 8 & 255, v & 255]);
  parts.push(Buffer.from('8BPS'), u16(opt.version || 1), Buffer.alloc(6), u16(ch), u32(h), u32(w), u16(depth), u16(opt.mode == null ? 3 : opt.mode), u32(0), u32(14), Buffer.from('8BIM'), u16(1000), u16(0), u32(2), u16(0), u32(0));      // no colour table, one small image resource, no layers
  const wide = pl => { if (bps === 1) return Buffer.from(pl); const b = Buffer.alloc(pl.length * 2); pl.forEach((v, i) => { b[i * 2] = v; b[i * 2 + 1] = 7; }); return b; };
  if (!opt.rle) { parts.push(u16(0)); for (const pl of planes) parts.push(wide(pl)); }
  else { const rows = [], counts = [];                                // PackBits: runs of 3 or more are packed, the rest copied
    for (const pl of planes) { const b = wide(pl); for (let y = 0; y < h; y++) { const row = b.subarray(y * w * bps, (y + 1) * w * bps), o = []; let i = 0;
      while (i < row.length) { let run = 1; while (i + run < row.length && row[i + run] === row[i] && run < 128) run++;
        if (run >= 3) { o.push(257 - run, row[i]); i += run; } else { let j = i; const lit = []; while (j < row.length && lit.length < 128 && !(j + 2 < row.length && row[j] === row[j + 1] && row[j] === row[j + 2])) lit.push(row[j++]); o.push(lit.length - 1, ...lit); i = j; } }
      rows.push(Buffer.from(o)); counts.push(u16(o.length)); } }
    parts.push(u16(1), ...counts, ...rows); }
  return Buffer.concat(parts);
}
const ab = b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const W0 = 37, H0 = 11, R = [], Gn = [], Bl = []; for (let i = 0; i < W0 * H0; i++) { const x = i % W0, y = (i / W0) | 0; R.push(x < 20 ? 255 : (x * 7 + y) % 256); Gn.push(y % 2 ? 40 : 40 + x); Bl.push((x * y) % 256); }
const same = im => { for (let i = 0; i < W0 * H0; i++) if (im.data[i * 4] !== R[i] || im.data[i * 4 + 1] !== Gn[i] || im.data[i * 4 + 2] !== Bl[i] || im.data[i * 4 + 3] !== 255) return false; return im.w === W0 && im.h === H0; };
check('PSD: a plain RGB file reads back pixel for pixel', same(Psd.read(ab(psd(W0, H0, [R, Gn, Bl])))));
check('PSD: a packed (RLE) one too, and an extra alpha channel is ignored', same(Psd.read(ab(psd(W0, H0, [R, Gn, Bl], { rle: true })))) && same(Psd.read(ab(psd(W0, H0, [R, Gn, Bl, new Array(W0 * H0).fill(9)], { rle: true })))));
const g16 = Psd.read(ab(psd(W0, H0, [R], { depth: 16, mode: 1, rle: true }))), g16r = Psd.read(ab(psd(W0, H0, [R], { depth: 16, mode: 1 })));
check('PSD: 16 bit grayscale comes out as gray', [g16, g16r].every(im => { for (let i = 0; i < W0 * H0; i++) if (im.data[i * 4] !== R[i] || im.data[i * 4 + 1] !== R[i] || im.data[i * 4 + 2] !== R[i]) return false; return true; }));
const why = f => { try { f(); return ''; } catch (e) { return e.message; } };
check('PSD: files it cannot read say why', /not a Photoshop/.test(why(() => Psd.read(ab(Buffer.from('this is a text file, not a picture at all'))))) && /PSB/.test(why(() => Psd.read(ab(psd(4, 4, [[0], [0], [0]], { version: 2 }))))) && /RGB and grayscale/.test(why(() => Psd.read(ab(psd(2, 2, [[0, 0, 0, 0]], { mode: 4 }))))));

// ---------------------------------------------------------------- part 1b: finding lines
function paper(w, h) { const g = new Uint8Array(w * h).fill(255); return { g, w, h, line(a, b, wd) { const n = Math.ceil(dist(a, b) * 2), r = (wd || 3) / 2; for (let i = 0; i <= n; i++) { const x = a[0] + (b[0] - a[0]) * i / n, y = a[1] + (b[1] - a[1]) * i / n;
  for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) { const px = Math.round(x + dx), py = Math.round(y + dy); if (dx * dx + dy * dy <= r * r + 0.5 && px >= 0 && py >= 0 && px < w && py < h) g[py * w + px] = 0; } } } }; }
const VP = [470, 185], pg = paper(900, 450), toVP = (from, t0, t1) => [[from[0] + (VP[0] - from[0]) * t0, from[1] + (VP[1] - from[1]) * t0], [from[0] + (VP[0] - from[0]) * t1, from[1] + (VP[1] - from[1]) * t1]];
for (const from of [[20, 440], [880, 440], [20, 20], [880, 30], [250, 445], [700, 445]]) pg.line(...toVP(from, 0, 0.62));
pg.line([330, 110], [610, 110]); pg.line([330, 260], [610, 260]); pg.line([330, 110], [330, 260]); pg.line([610, 110], [610, 260]); pg.line([120, 60], [120, 400]);       // the back wall and a post
const off = [VP[0], VP[1] + 38], bad = [[60, 300], [60 + (off[0] - 60) * 0.55, 300 + (off[1] - 300) * 0.55]]; pg.line(bad[0], bad[1]);                                   // one stroke that aims under the point
let t0 = Date.now(); const segs = LF.segments(pg.g, pg.w, pg.h), ms = Date.now() - t0, found = LF.vps(segs, pg.w, pg.h);
check('lines: every straight stroke of a drawn room is found once', segs.length >= 11 && segs.length <= 14, segs.length + ' strokes in ' + ms + ' ms');
check('lines: the strokes that run back into the room agree on the depth point', found.vpA && dist(found.vpA, VP) < 6 && found.A.length === 6, found.vpA ? 'off by ' + dist(found.vpA, VP).toFixed(1) + ' px, from ' + found.A.length + ' strokes' : 'none');
check('lines: level and upright strokes are not turned into a second point', found.B.length === 0 && found.V.length === 0);
const dr = LF.drift(segs, { A: found.vpA }, 1.5, 9);
check('check my drawing: the stroke that aims under the point is the one flagged, with how far off it is', dr.off.length === 1 && Math.min(dist(dr.off[0].seg.a, bad[0]) + dist(dr.off[0].seg.b, bad[1]), dist(dr.off[0].seg.a, bad[1]) + dist(dr.off[0].seg.b, bad[0])) < 30 && dr.off[0].deg > 2 && dr.off[0].deg < 9 && dr.on.length === 6, dr.off.map(q => q.deg.toFixed(1) + ' deg').join(', '));
const mess = paper(900, 450); let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (let i = 0; i < 9; i++) { const a = [100 + rnd() * 700, 60 + rnd() * 330], an = rnd() * Math.PI, L = 130 + rnd() * 160; mess.line(a, [a[0] + Math.cos(an) * L, a[1] + Math.sin(an) * L]); }
const fm = LF.vps(LF.segments(mess.g, mess.w, mess.h), mess.w, mess.h);
check('lines: strokes thrown down at random (a character, say) are not given a vanishing point', fm.A.length === 0 && !fm.vpA, fm.A.length + ' strokes agreed');
const two = paper(900, 450), VA2 = [1250, 200], VB2 = [-420, 215];
for (const y of [40, 120, 300, 380, 430]) { two.line([430, y], [430 + (VA2[0] - 430) * 0.5, y + (VA2[1] - y) * 0.5]); two.line([410, y], [410 + (VB2[0] - 410) * 0.45, y + (VB2[1] - y) * 0.45]); }
two.line([420, 30], [420, 440]); const f2 = LF.vps(LF.segments(two.g, two.w, two.h), two.w, two.h);
check('lines: a two-point corner gives two points, the one nearer the middle first', f2.vpA && f2.vpB && dist(f2.vpA, VA2) < 40 && dist(f2.vpB, VB2) < 40 && f2.A.length === 5 && f2.B.length === 5, f2.vpA && f2.vpB ? 'off by ' + dist(f2.vpA, VA2).toFixed(0) + ' and ' + dist(f2.vpB, VB2).toFixed(0) + ' px' : 'missing');

// ---------------------------------------------------------------- part 2: the app
let puppeteer;
for (const base of [root, path.join(root, '_scratch'), process.cwd()]) { try { puppeteer = createRequire(path.join(base, 'x.js'))('puppeteer-core'); break; } catch (e) {} }
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
if (!puppeteer || !chrome) { console.log('\nSkipping the browser part: ' + (!puppeteer ? 'puppeteer-core is not installed (npm i puppeteer-core).' : 'no Chrome or Edge found.')); console.log(fails ? fails + ' FAILED' : 'ALL PASSED (math only)'); process.exit(fails ? 1 : 0); }
const board = path.join(out, 'synthetic_one_point.png');
if (!fs.existsSync(board)) execFileSync('python', [path.join(root, 'tests', 'test_perspective.py')], { stdio: 'ignore' });
const seqDir = path.join(out, 'frames_seq'); fs.rmSync(seqDir, { recursive: true, force: true }); fs.mkdirSync(seqDir, { recursive: true });
// six frames of a slow pan across the generated room, with frame 4 knocked sideways
execFileSync('python', ['-c', 'import sys\nfrom PIL import Image, ImageChops\nim = Image.open(sys.argv[1]).convert("RGB")\nfor i in range(6):\n    dx = 12 * i + (520 if i == 3 else 0)\n    fr = Image.new("RGB", im.size, "white"); fr.paste(im, (dx, 0)); fr.save(sys.argv[2] + "/%04d.png" % (i + 1))', board, seqDir]);
const psdBoard = path.join(out, 'frames_room.psd'); fs.writeFileSync(psdBoard, psd(pg.w, pg.h, [pg.g, pg.g, pg.g], { rle: true }));
const psdB = path.join(out, 'frames_room_b.psd'); fs.writeFileSync(psdB, psd(two.w, two.h, [two.g, two.g, two.g]));

const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--window-size=1700,980'] });
const page = await browser.newPage(); await page.setViewport({ width: 1700, height: 980 });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(pathToFileURL(path.join(root, 'animation_app.html')).href); await page.evaluate(() => localStorage.clear()); await page.reload();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const toScreen = p => page.evaluate(p => { const r = document.querySelector('#pCanvas').getBoundingClientRect(), v = Persp.UI.view; return [r.left + v.x + p[0] * v.s, r.top + v.y + p[1] * v.s]; }, p);
const drag = async (a, b) => { const s = await toScreen(a), e = await toScreen(b); await page.mouse.move(s[0], s[1]); await page.mouse.down(); await page.mouse.move((s[0] + e[0]) / 2, (s[1] + e[1]) / 2, { steps: 4 }); await page.mouse.move(e[0], e[1], { steps: 4 }); await page.mouse.up(); };
const click = async a => { const s = await toScreen(a); await page.mouse.click(s[0], s[1]); };
const P = () => page.evaluate(() => { const D = Persp.D(), S = Persp.S, U = Persp.UI; return { W: S.W, H: S.H, name: S.boardName, n: S.lines.length, by: { A: D.count.A, B: D.count.B, V: D.count.V }, vpA: D.vp.A, vpB: D.vp.B, note: U.note, found: U.found ? U.found.length : -1,
  drift: U.drift ? { on: U.drift.on.length, off: U.drift.off.map(q => ({ deg: q.deg, a: q.seg.a, b: q.seg.b, group: q.group })) } : null, figure: S.figure, poles: S.poles, boards: U.boards.length, bi: U.bi, tool: U.tool, read: document.querySelector('#pReadout').textContent }; });

await (await page.$('#pBoardFile')).uploadFile(board); await page.waitForFunction(() => document.querySelector('#pCanvasInfo').textContent.includes('('));
const truth = await page.evaluate(() => AT.vanishingPoint(AT.makeCamera({ pos: [0.8, 4.5, 0], yaw: 6, pitch: -4, roll: 0, fov: 70, k: 1, skew: 0, W: 3840, H: 1920 }), [0, 0, 1]));
await page.click('#pFind'); let s = await P();
check('Find the lines for me: the generated room gets its depth point back', s.by.A >= 3 && s.vpA && dist(s.vpA, truth) < 40 && s.found > 10, s.vpA ? 'off by ' + dist(s.vpA, truth).toFixed(1) + ' px of 3840, from ' + s.found + ' strokes' : s.note);
check('it says what it did and warns that characters can fool it', /Depth point from \d+ of them/.test(s.note) && /Characters can fool this/.test(s.read) && s.tool === 'S');
await page.screenshot({ path: path.join(out, 'app_frames_found.png') });
await page.click('#pCheck'); s = await P(); const badA = [600, 1700], hitBad = s.drift && s.drift.off.find(q => Math.min(dist(q.a, badA), dist(q.b, badA)) < 60);
check('Check my drawing: the stroke the test drew aiming 100 px under the point is flagged, and the true ones are not', !!hitBad && hitBad.deg > 1.5 && hitBad.deg < 9 && s.drift.on >= 3 && s.drift.off.length <= 3 && /\d+ strokes on the grid, \d+ drifting/.test(s.read), hitBad ? hitBad.deg.toFixed(1) + ' deg off, ' + s.drift.on + ' on the grid, ' + s.drift.off.length + ' flagged' : 'not flagged');
await page.screenshot({ path: path.join(out, 'app_frames_check.png') });
const vp0 = s.vpA; await drag(vp0, [vp0[0] + 160, vp0[1] + 70]); s = await P();
check('dragging a vanishing point re-aims its lines at the new spot', dist(s.vpA, [vp0[0] + 160, vp0[1] + 70]) < 12 && s.by.A >= 3, 'now at ' + s.vpA.map(Math.round));
await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control'); s = await P();
check('undo puts it back', dist(s.vpA, vp0) < 1);
await page.click('#pCheck');

// the height check, on the room's own camera (the lines the finder placed)
await page.click('[data-tool="H"]'); const cam = () => page.evaluate(() => { const c = Persp.D().cam; return { C: c.C }; });
const feet = [1500, 1650], headPx = [1500, 1250]; await drag(feet, headPx); s = await P();
check('Measure a character: dragging feet to head gives a height on the floor', s.figure && s.figure.h > 0.5 && s.poles.length === 0 && /Character: [\d.]+ ft tall/.test(s.read), s.figure ? s.figure.h.toFixed(2) + ' ft' : s.note);
const far = [2300, 1150]; await click(far); await click([900, 1800]); s = await P();
const tall = await page.evaluate(() => { const S = Persp.S, c = Persp.D().cam, px = (x, z) => { const a = AT.project(c, [x, 0, z]), b = AT.project(c, [x, S.figure.h, z]); return { h: Math.hypot(a[0] - b[0], a[1] - b[1]), base: a }; }; return { ref: px(S.figure.x, S.figure.z), poles: S.poles.map(q => px(q[0], q[1])) }; });
check('clicking the floor stands same-height markers there: smaller further back, bigger up close', s.poles.length === 2 && Math.abs(tall.ref.h - 400) < 12 && dist(tall.poles[0].base, far) < 3 && tall.poles[0].h < tall.ref.h * 0.75 && tall.poles[1].h > tall.ref.h * 1.1, 'drawn ' + Math.round(tall.ref.h) + ' px, then ' + tall.poles.map(q => Math.round(q.h)).join(' and ') + ' px');
const horizonY = await page.evaluate(() => { const c = Persp.D().cam; return AT.project(c, [c.C[0] + c.R[2][0] * 1e5, c.C[1], c.C[2] + c.R[2][2] * 1e5])[1]; });
await click([1900, horizonY - 200]); s = await P();
check('a click above the horizon is not on the floor and adds nothing', s.poles.length === 2 && /above the horizon/.test(s.note));
const inked = await page.evaluate(() => { const c = Persp.guideCanvas(), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let pink = 0, blue = 0; for (let i = 0; i < d.length; i += 4) { if (d[i + 3] > 200 && d[i] > 200 && d[i + 1] < 110 && d[i + 2] > 150) pink++; if (d[i + 3] > 200 && d[i] < 40 && d[i + 1] > 120 && d[i + 2] > 170) blue++; } return { pink, blue }; });
check('the markers are part of the exported guide', inked.pink > 500 && inked.blue > 500, JSON.stringify(inked));
await page.screenshot({ path: path.join(out, 'app_frames_height.png') });
await page.click('#pClearPoles'); s = await P(); check('Clear takes them away', !s.figure && s.poles.length === 0);

// a clean grid on a blank frame
await page.click('#pBlank'); await page.click('#pClearLines'); await page.click('[data-tool="A"]'); await click([2100, 820]); s = await P();
check('Blank frame: one click with the depth tool puts a vanishing point there (a 1 point grid)', s.name === 'blank' && s.by.A === 3 && dist(s.vpA, [2100, 820]) < 2 && s.by.B === 0, 'at ' + (s.vpA || []).map(Math.round));
await page.click('[data-tool="B"]'); await click([300, 860]); s = await P();
check('a click with the side tool adds the second point (a 2 point grid)', s.by.B === 2 && dist(s.vpB, [300, 860]) < 2 && dist(s.vpA, [2100, 820]) < 2);
await page.click('[data-tool="A"]'); await click([1700, 700]); s = await P();
check('clicking again moves the point instead of adding more lines', s.by.A === 3 && dist(s.vpA, [1700, 700]) < 2);
await page.click('[data-g="walls"]'); const grid = await page.evaluate(() => { const c = Persp.guideCanvas(), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let ink = 0, green = 0; for (let i = 3; i < d.length; i += 4) { if (d[i] > 40) ink++; if (d[i] > 150 && d[i - 3] < 80 && d[i - 2] > 130 && d[i - 1] < 130) green++; } return { ink: ink / (c.width * c.height), green, w: c.width, h: c.height }; });
check('the blank frame exports a transparent grid at full canvas size, uprights included', grid.w === s.W && grid.h === s.H && grid.ink > 0.005 && grid.ink < 0.5 && grid.green > 2000, (grid.ink * 100).toFixed(1) + '% ink, ' + grid.green + ' px of uprights');
await page.screenshot({ path: path.join(out, 'app_frames_blank_grid.png') });
await page.click('[data-tool="V"]'); await click([1100, 1850]); s = await P();
const tri = await page.evaluate(() => { const D = Persp.D(), c = D.cam; return { shift: D.shift, A: AT.vanishingPoint(c, [0, 0, 1]), B: AT.vanishingPoint(c, [1, 0, 0]), V: AT.vanishingPoint(c, [0, 1, 0]), solved: D.solved }; });
check('a click with the upright tool adds the third point: the grid aims at all three (a 3 point grid)', s.by.V === 2 && tri.solved && tri.shift && dist(tri.A, [1700, 700]) < 1 && dist(tri.B, [300, 860]) < 1 && dist(tri.V, [1100, 1850]) < 1 && /3 point: the lens looks/.test(s.read), tri.shift ? 'lens centre ' + tri.shift.map(Math.round) + ' px from the middle' : s.read);
await page.screenshot({ path: path.join(out, 'app_frames_blank_3point.png') });

// Photoshop files, and the frames of a shot
await (await page.$('#pBoardFile')).uploadFile(psdBoard); await page.waitForFunction(() => Persp.S.boardName === 'frames_room'); await page.click('#pFind'); s = await P();
check('a PSD opens as a board at its own size, and its lines are found', s.W === pg.w && s.H === pg.h && s.boards === 1 && s.vpA && dist(s.vpA, VP) < 8, s.vpA ? 'depth point off by ' + dist(s.vpA, VP).toFixed(1) + ' px' : s.note);
await page.click('[data-mode="timing"]'); await (await page.$('#tFiles')).uploadFile(psdBoard, psdB); await page.waitForFunction(() => Timing.T.frames.length === 2, { timeout: 8000 }).catch(() => {});
check('PSD frames load in the Timing tab too', await page.evaluate(() => Timing.T.frames.length === 2 && Timing.T.frames.map(f => f.name).sort().join() === 'frames_room.psd,frames_room_b.psd' && Timing.T.frames.every(f => f.w === 900 && f.h === 450)));
await page.click('[data-mode="perspective"]');
const seqFiles = fs.readdirSync(seqDir).sort().map(n => path.join(seqDir, n)); await (await page.$('#pBoardFile')).uploadFile(...seqFiles.slice().reverse()); await page.waitForFunction(() => Persp.UI.boards.length === 6);
s = await P(); const lblSeq = () => page.$eval('#pSeqLbl', e => e.textContent);
check('several frames load as one shot, in name order, on one grid', s.boards === 6 && s.bi === 0 && s.name === '0001' && /Frame 1 of 6: 0001\.png/.test(await lblSeq()) && s.W === 3840);
await page.click('#pFind'); const lines1 = (await P()).n; await page.click('#pNextB'); await page.keyboard.press('.'); s = await P();
check('stepping through the frames keeps the same grid', s.bi === 2 && s.name === '0003' && s.n === lines1 && lines1 >= 3 && /Frame 3 of 6/.test(await lblSeq()));
await page.click('#pSeqCheck'); await page.waitForFunction(() => Persp.UI.seq && Persp.UI.seq.length === 6, { timeout: 60000 });
const seq = await page.evaluate(() => Persp.UI.seq.map(q => ({ flag: q.flag, jump: q.jump, vp: q.vp }))), seqTxt = await page.$eval('#pSeqInfo', e => e.textContent);
check('Check every frame: the slow pan passes and the one frame knocked sideways is flagged', seq.every((q, i) => !!q.flag === (i === 3)) && seq[3].jump > 300 && /1 of 6 frames to look at/.test(seqTxt) && /Frame 4 \(0004\.png\)/.test(seqTxt), seq.map(q => q.jump == null ? '?' : Math.round(q.jump)).join(' ') + ' px');
await page.screenshot({ path: path.join(out, 'app_frames_sequence.png') });
await page.reload(); s = await P();
check('the grid is remembered, the pictures are not kept', s.n === lines1 && s.boards === 0);
check('no script errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await page.evaluate(() => localStorage.clear()); await browser.close();
console.log('\n' + (fails ? fails + ' FAILED' : 'ALL PASSED')); process.exit(fails ? 1 : 0);
