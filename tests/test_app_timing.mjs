// Drives the app's timing mode in headless Chrome: loads frames, holds, marks, sound, x-sheet, GIF, playback.
//
//   npm i puppeteer-core        (once)
//   node tests/test_app_timing.mjs [frames_folder] [audio_file]
//
// With no arguments it uses generated stand-ins (a ball on an arc, two clicks at known frames).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'tests', 'out'); fs.mkdirSync(out, { recursive: true });
let puppeteer;
for (const base of [root, path.join(root, '_scratch'), process.cwd()]) { try { puppeteer = createRequire(path.join(base, 'x.js'))('puppeteer-core'); break; } catch (e) {} }
if (!puppeteer) { console.log('puppeteer-core is not installed. Run: npm i puppeteer-core'); process.exit(2); }
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
if (!chrome) { console.log('No Chrome or Edge found.'); process.exit(2); }

execFileSync('python', [path.join(root, 'tests', 'make_timing_samples.py')], { stdio: 'ignore' });
const synthetic = !process.argv[2];
const folder = process.argv[2] || path.join(out, 'synth_frames');
const audio = process.argv[3] || path.join(out, 'synth_clicks.wav');
const truth = JSON.parse(fs.readFileSync(path.join(out, 'synth_truth.json'), 'utf8'));
const files = fs.readdirSync(folder).filter(f => /\.png$/i.test(f)).sort().map(f => path.join(folder, f));
const tag = synthetic ? 'synth' : path.basename(folder);

let fails = 0;
const check = (name, ok, detail) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ' + detail : '')); if (!ok) fails++; };
const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--window-size=1700,980', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage(); await page.setViewport({ width: 1700, height: 980 });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const client = await page.createCDPSession(); await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: out });
await page.goto(pathToFileURL(path.join(root, 'animation_app.html')).href);
await page.click('[data-mode="timing"]');

// 1. load frames (given out of order on purpose: they must sort by number)
await (await page.$('#tFiles')).uploadFile(...files.slice().reverse());
await page.waitForFunction(n => Timing.T.frames.length === n, {}, files.length);
let st = await page.evaluate(() => ({ names: Timing.T.frames.map(f => f.name), total: Timing.total(), hold: Timing.T.frames[0].hold }));
check('frames load in number order', st.names.join() === files.map(f => path.basename(f)).join(), st.names.slice(0, 3).join(' ') + ' ...');
check('default is on 2s', st.hold === 2 && st.total === files.length * 2, st.total + ' frames');

// 2. on 1s / 2s, and a longer hold on one drawing
await page.click('[data-on="1"]'); check('"on 1s" gives one frame per drawing', (await page.evaluate(() => Timing.total())) === files.length);
await page.click('[data-on="2"]');
await page.evaluate(() => Timing.goDrawing(2)); await page.click('#tHoldUp'); await page.click('#tHoldUp');
st = await page.evaluate(() => ({ hold: Timing.T.frames[2].hold, total: Timing.total(), cur: Timing.curDrawing() }));
check('holding one drawing longer stretches the shot', st.hold === 4 && st.total === files.length * 2 + 2 && st.cur === 2, `drawing 3 holds ${st.hold}, shot is ${st.total} frames`);

// 3. marks with the keyboard
await page.evaluate(() => Timing.goFrame(0, true)); await page.keyboard.press('k');
await page.evaluate(n => Timing.goFrame(Timing.starts()[n - 1], true), files.length); await page.keyboard.press('k');
await page.evaluate(() => Timing.goFrame(Timing.starts()[3], true)); await page.keyboard.press('b');
await page.keyboard.press('ArrowRight'); await page.keyboard.press('i');
st = await page.evaluate(() => Timing.T.frames.map(f => f.mark || '-').join(''));
check('keys, breakdown and inbetween get marked', st[0] === 'K' && st[st.length - 1] === 'K' && st[3] === 'B' && st[4] === 'I', st);

// 4. spacing measured from the drawings
const travel = await page.evaluate(() => Timing.travel());
if (synthetic) {
  const worst = Math.max(...travel.map((v, i) => Math.abs(v - truth.steps[i]) / truth.steps[i]));
  check('spacing matches how far the ball really moves', worst < 0.2, 'measured ' + travel.map(v => Math.round(v)).join(' ') + ' | true ' + truth.steps.map(v => Math.round(v)).join(' '));
  check('ease in and out shows up (small, big, small)', travel[0] < travel[3] && travel[travel.length - 1] < travel[3]);
} else check('spacing measured for every step', travel.length === files.length - 1, travel.map(v => Math.round(v)).join(' '));

// 5. sound: waveform and accents
await (await page.$('#tAudio')).uploadFile(audio);
await page.waitForFunction(() => Timing.T.audio.buf, { timeout: 20000 });
st = await page.evaluate(() => ({ dur: Timing.T.audio.buf.duration, acc: Timing.T.audio.accents, peaks: Timing.T.audio.peaks.length, len: Timing.lengthFrames() }));
check('audio decodes and gets a waveform', st.dur > 0.2 && st.peaks > 10, st.dur.toFixed(2) + ' s');
if (synthetic) check('accents land on the frames where the clicks are', truth.clicks.every(c => st.acc.some(a => Math.abs(a - c) <= 1)) && st.acc.length === truth.clicks.length, 'found at frames ' + st.acc.map(a => a + 1).join(', ') + ' (clicks on ' + truth.clicks.map(c => c + 1).join(', ') + ')');
else check('accents found in the audio', st.acc.length > 0, st.acc.length + ' accents');
check('timeline is as long as the longer of picture and sound', st.len >= Math.ceil(st.dur * 24));
await page.evaluate(() => { Timing.T.onion.before = 2; Timing.T.onion.after = 1; Timing.goFrame(Timing.starts()[Math.min(4, Timing.T.frames.length - 2)], true); });
await page.screenshot({ path: path.join(out, `app_timing_${tag}.png`) });

// 6. x-sheet
const csvPath = path.join(out, (synthetic ? 'shot' : (path.basename(files[0]).replace(/\.[^.]+$/, '').replace(/[\s_-]*\d+$/, '') || 'shot')) + '_xsheet.csv');
if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
await page.click('#tCsv');
for (let i = 0; i < 50 && !fs.existsSync(csvPath); i++) await new Promise(r => setTimeout(r, 100));
check('x-sheet CSV downloads', fs.existsSync(csvPath), csvPath);
const rows = (await page.evaluate(() => Timing.xsheet())).trim().split('\r\n').map(r => r.split(','));
const body = rows.slice(1), info = await page.evaluate(() => ({ total: Timing.total(), len: Timing.lengthFrames() }));
check('x-sheet has one row per frame', body.length === info.len, body.length + ' rows');
check('x-sheet shows each drawing once, then hold lines', body.filter(r => /^\d+$/.test(r[2])).length === files.length && body.filter(r => r[2] === '|').length === info.total - files.length);
check('x-sheet carries the marks and holds', body[0][4] === 'KEY' && body[0][5] === '2' && body.some(r => r[4] === 'BREAKDOWN') && body.some(r => r[4] === 'INBETWEEN'));
if (synthetic) check('x-sheet stars the accent frames', truth.clicks.every(c => body.slice(c - 1, c + 2).some(r => r[7] === '*')), 'stars on frames ' + body.filter(r => r[7] === '*').map(r => r[0]).join(', '));

// 7. GIF
const b64 = await page.evaluate(() => { const b = Timing.gifBytes(480); let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192)); return btoa(s); });
const gifPath = path.join(out, `timing_${tag}.gif`); fs.writeFileSync(gifPath, Buffer.from(b64, 'base64'));
const gi = JSON.parse(execFileSync('python', ['-c', `
import json, sys
from PIL import Image
im = Image.open(sys.argv[1]); d = []
for i in range(im.n_frames):
    im.seek(i); d.append(im.info.get('duration', 0))
im.seek(0); px = im.convert('RGB').getpixel((2, 2))
print(json.dumps(dict(n=im.n_frames, size=im.size, ms=d, corner=px, loop=im.info.get('loop'))))`, gifPath], { encoding: 'utf8' }));
check('GIF opens and has one image per drawing', gi.n === files.length, `${gi.n} images, ${gi.size.join(' x ')}`);
const wantMs = info.total / 24 * 1000, gotMs = gi.ms.reduce((a, b) => a + b, 0);
check('GIF runs the same length as the shot', Math.abs(gotMs - wantMs) <= 10, `${gotMs} ms vs ${wantMs.toFixed(0)} ms`);
check('GIF holds the longer drawing longer', gi.ms[2] > gi.ms[1] * 1.6, `drawing 3: ${gi.ms[2]} ms, drawing 2: ${gi.ms[1]} ms`);
check('GIF keeps white paper white and loops', gi.corner.every(v => v > 245) && gi.loop === 0, 'corner ' + gi.corner.join(','));

// 8. playback runs at speed
await page.evaluate(() => { Timing.T.loop = true; Timing.goFrame(0, true); Timing.play(); });
await new Promise(r => setTimeout(r, 620));
const cur = await page.evaluate(() => { const c = Timing.T.cur; Timing.stop(); return c; });
check('playback advances at about 24 frames a second', cur >= 9 && cur <= 20, `frame ${cur + 1} after 0.62 s`);
check('no script errors in the page', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
