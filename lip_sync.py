"""
lip_sync.py
Turns a voice line into a mouth shape for every frame, using Rhubarb Lip Sync
(https://github.com/DanielSWolf/rhubarb-lip-sync). It tells you WHICH mouth goes on which frame;
the mouths themselves stay your drawings.

    python lip_sync.py --setup                 (once: downloads Rhubarb into tools/rhubarb, about 90 MB)
    python lip_sync.py LINE.wav [--text "what is said"] [--fps 24] [--start 1] [--on 1|2]
                                [--mouths MOUTH_FOLDER] [--recognizer pocketSphinx|phonetic]
                                [--rough] [--rhubarb PATH] [--out DIR]

  LINE.wav      the voice line. WAV works everywhere. Other formats (mp3, m4a) need ffmpeg installed;
                without it, export a WAV from your editor first.
  --text        the words spoken. Optional but it makes the result noticeably more accurate.
                --text-file FILE does the same from a text file.
  --start       frame number the audio starts on in the shot (default 1)
  --on 2        hold every mouth for 2 frames (animating on twos). A closed mouth for M, B, P is
                never dropped, because a missing closure is what makes lip sync look wrong.
  --mouths      a folder of YOUR mouth drawings named by shape: A.png B.png C.png D.png E.png F.png,
                and if you have them G.png H.png X.png. Then it also writes one mouth image per frame
                and a preview GIF, using your drawings untouched.
  --recognizer  phonetic for a line that is not in English (pocketSphinx, the default, is English only)
  --rough       no Rhubarb: guess open and closed from loudness alone. Good for a quick block-in,
                not for final sync. Used automatically, with a warning, if Rhubarb is not installed.

The mouth shapes (Rhubarb's standard set, the same letters most mouth charts use):
    A  closed lips                         M, B, P
    B  teeth together, lips slightly open  most consonants: K, S, T, and EE
    C  open                                EH, AE (bed, cat) and passing between other shapes
    D  wide open                           AA (father)
    E  slightly rounded                    AO, ER (off, bird)
    F  puckered                            UW, OW, W (you, show, way)
    G  top teeth on the bottom lip         F, V
    H  tongue up behind the top teeth      L
    X  at rest, not speaking

Writes NEW files in --out (default out/lip_sync):
    <name>_lipsync.csv    frame, time, mouth letter, what it is, * where the mouth changes, how long it holds
    <name>_lipsync.png    the waveform with the mouth letter under every frame
    <name>_lipsync.json   the same data plus Rhubarb's raw timing
    <name>_mouths/        (with --mouths) 0001.png, 0002.png, ... your mouth drawing for each frame
    <name>_lipsync_preview.gif   (with --mouths) the mouths playing at speed
"""
import argparse, csv, io, json, math, os, shutil, subprocess, sys, urllib.request, zipfile
import numpy as np
from PIL import Image, ImageDraw
from animtk import imgio

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.join(HERE, 'tools', 'rhubarb')
RELEASE = 'https://github.com/DanielSWolf/rhubarb-lip-sync/releases/download/v1.14.0/Rhubarb-Lip-Sync-1.14.0-%s.zip'
SHAPES = dict(A='closed lips (M, B, P)', B='teeth together, slightly open (most consonants, EE)', C='open (EH, AE)', D='wide open (AA)',
              E='slightly rounded (AO, ER)', F='puckered (UW, OW, W)', G='top teeth on bottom lip (F, V)', H='tongue up behind top teeth (L)', X='at rest')
COL = dict(A=(120, 120, 135), B=(60, 140, 235), C=(40, 170, 110), D=(235, 80, 80), E=(240, 150, 40), F=(170, 90, 210), G=(0, 160, 170), H=(215, 80, 160), X=(215, 213, 222))

# ----------------------------------------------------------------- Rhubarb
def find_rhubarb(explicit=None):
    exe = 'rhubarb.exe' if os.name == 'nt' else 'rhubarb'
    for c in (explicit, os.environ.get('RHUBARB'), os.path.join(TOOLS, exe), shutil.which('rhubarb')):
        if c and os.path.isdir(c): c = os.path.join(c, exe)
        if c and os.path.isfile(c): return c
    return None

def setup():
    """download the official Rhubarb release for this computer into tools/rhubarb (git-ignored)"""
    if find_rhubarb(): print('Rhubarb is already here: ' + find_rhubarb()); return
    plat = 'Windows' if os.name == 'nt' else 'macOS' if sys.platform == 'darwin' else 'Linux'; url = RELEASE % plat
    print('downloading ' + url + ' (about 90 MB)...')
    data = urllib.request.urlopen(url, timeout=600).read(); os.makedirs(TOOLS, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for m in z.infolist():                                  # the zip has one top folder: unpack its contents straight into tools/rhubarb
            parts = m.filename.replace('\\', '/').split('/', 1)
            if len(parts) < 2 or not parts[1] or m.is_dir(): continue
            dest = os.path.normpath(os.path.join(TOOLS, parts[1]))
            if not dest.startswith(os.path.normpath(TOOLS)): continue
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest, 'wb') as fh: fh.write(z.read(m))
    exe = find_rhubarb()
    if not exe: raise SystemExit('Unpacked, but the rhubarb program was not found in ' + TOOLS)
    if os.name != 'nt': os.chmod(exe, 0o755)
    print('Rhubarb is ready: ' + exe)

def run_rhubarb(exe, wav, out_json, text=None, extended='GHX', recognizer='pocketSphinx'):
    cmd = [exe, '-f', 'json', '-o', out_json, '--extendedShapes', extended, '-r', recognizer, '--quiet']
    if text:
        tf = out_json + '.txt'; open(tf, 'w', encoding='utf-8').write(text); cmd += ['-d', tf]
    r = subprocess.run(cmd + [wav], capture_output=True, text=True)
    if text and os.path.exists(out_json + '.txt'): os.remove(out_json + '.txt')
    if r.returncode != 0 or not os.path.exists(out_json): raise SystemExit('Rhubarb could not read the line:\n' + (r.stderr or r.stdout)[-800:])
    cues = json.load(open(out_json, encoding='utf-8'))['mouthCues']; os.remove(out_json)
    return [dict(start=float(c['start']), end=float(c['end']), mouth=c['value']) for c in cues]

# ----------------------------------------------------------------- sound
def read_wav(path):
    """mono samples -1..1 and the sample rate"""
    from scipy.io import wavfile
    rate, d = wavfile.read(path)
    if d.dtype.kind in 'iu': d = (d.astype(np.float32) - (128 if d.dtype == np.uint8 else 0)) / float(2 ** (8 * d.dtype.itemsize - 1))
    d = d.astype(np.float32)
    return (d.mean(axis=1) if d.ndim > 1 else d), int(rate)

def as_wav(path, out_dir):
    """Rhubarb and this script read WAV. Anything else goes through ffmpeg into a new WAV in the output folder."""
    if path.lower().endswith('.wav'): return path
    ff = shutil.which('ffmpeg')
    if not ff: raise SystemExit('%s is not a WAV. Export the line as a WAV, or install ffmpeg so this can convert it.' % os.path.basename(path))
    dst = imgio.out_path(out_dir, os.path.splitext(os.path.basename(path))[0] + '_converted.wav')
    r = subprocess.run([ff, '-y', '-loglevel', 'error', '-i', path, '-ac', '1', '-ar', '44100', dst], capture_output=True, text=True)
    if r.returncode != 0: raise SystemExit('ffmpeg could not convert the file:\n' + r.stderr[-500:])
    return dst

def loudness(samples, rate, fps):
    """0..1 loudness per frame"""
    n = int(math.ceil(len(samples) / rate * fps)); per = rate / fps
    v = np.array([float(np.sqrt(np.mean(samples[int(i * per):max(int(i * per) + 1, int((i + 1) * per))] ** 2))) for i in range(n)])
    return v / max(1e-6, float(np.percentile(v, 98)))

def rough_cues(samples, rate, fps):
    """no Rhubarb: mouth from loudness alone. Quiet = rest, a dip inside speech = closed, louder = wider."""
    lv = np.clip(loudness(samples, rate, fps), 0, 1.2); cues = []
    for i, v in enumerate(lv):
        near = lv[max(0, i - 3):i + 4].max()
        m = 'X' if near < 0.12 else 'A' if v < 0.1 else 'B' if v < 0.3 else 'C' if v < 0.7 else 'D'
        if cues and cues[-1]['mouth'] == m: cues[-1]['end'] = (i + 1) / fps
        else: cues.append(dict(start=i / fps, end=(i + 1) / fps, mouth=m))
    return cues

# ----------------------------------------------------------------- frames
def per_frame(cues, duration, fps, on=1):
    """one mouth per frame. Each frame takes the cue under its middle; on twos, closures (A) are kept."""
    n = int(math.ceil(duration * fps - 1e-6)); out = []
    for i in range(n):
        t = (i + 0.5) / fps
        out.append(next((c['mouth'] for c in cues if c['start'] <= t < c['end']), 'X'))
    if on > 1:
        held = []
        for b in range(0, n, on):
            blk = out[b:b + on]; m = blk[0]
            if 'A' in blk and (not held or held[-1] != 'A'): m = 'A'        # never lose a closed mouth
            held += [m] * len(blk)
        out = held
    return out

def table(mouths, fps, start):
    rows = []
    for i, m in enumerate(mouths):
        new = i == 0 or mouths[i - 1] != m; hold = ''
        if new:
            j = i
            while j < len(mouths) and mouths[j] == m: j += 1
            hold = j - i
        rows.append(dict(frame=start + i, time_s=round(i / fps, 3), mouth=m, shape=SHAPES.get(m, ''), new='*' if new else '', holds=hold))
    return rows

def chart(samples, rate, mouths, fps, start, title, per_row=48):
    n = len(mouths); cw = 34; left = 70; W = left + per_row * cw + 30; bands = -(-n // per_row); bh = 190
    used = [k for k in SHAPES if k in mouths]; H = 70 + bands * bh + 34 * len(used) + 30
    img = Image.new('RGB', (W, H), (250, 249, 252)); d = ImageDraw.Draw(img); f = imgio.font(20); fs = imgio.font(13, False)
    d.text((left, 18), title, fill=(30, 30, 38), font=imgio.font(24))
    per = rate / fps; peak = max(1e-6, float(np.abs(samples).max()))
    for b in range(bands):
        y0 = 70 + b * bh; mid = y0 + 55
        d.rectangle([left, y0, left + per_row * cw, y0 + 110], fill=(236, 234, 242))
        for i in range(b * per_row, min(n, (b + 1) * per_row)):
            x = left + (i - b * per_row) * cw
            for px in range(cw):                                   # waveform, one column per pixel
                a = int((i + px / cw) * per); seg = samples[a:max(a + 1, int((i + (px + 1) / cw) * per))]
                hgt = float(np.abs(seg).max()) / peak * 52 if len(seg) else 0
                d.line([x + px, mid - hgt, x + px, mid + hgt], fill=(90, 150, 170))
            m = mouths[i]; new = i == 0 or mouths[i - 1] != m
            d.rectangle([x, y0 + 114, x + cw - 1, y0 + 150], fill=COL[m], outline=(250, 249, 252))
            if new: d.text((x + 9, y0 + 119), m, fill=(255, 255, 255) if m != 'X' else (110, 108, 120), font=f)
            fr = start + i; sec = (i % int(round(fps))) == 0
            d.line([x, y0, x, y0 + (110 if sec else 8)], fill=(60, 60, 70) if sec else (170, 168, 180))
            if sec or i % 4 == 0: d.text((x + 3, y0 + 154), str(fr), fill=(40, 40, 50) if sec else (130, 128, 140), font=fs)
            if sec: d.text((x + 4, y0 + 92), '%gs' % (i / fps), fill=(60, 60, 70), font=fs)
        d.text((10, y0 + 45), 'sound', fill=(110, 108, 120), font=fs); d.text((10, y0 + 124), 'mouth', fill=(110, 108, 120), font=fs); d.text((10, y0 + 154), 'frame', fill=(110, 108, 120), font=fs)
    y = 70 + bands * bh + 6
    for k in used:
        d.rectangle([left, y, left + 30, y + 26], fill=COL[k]); d.text((left + 9, y + 2), k, fill=(255, 255, 255) if k != 'X' else (110, 108, 120), font=f)
        d.text((left + 44, y + 3), '%s   %d frames' % (SHAPES[k], mouths.count(k)), fill=(60, 60, 70), font=imgio.font(18, False)); y += 34
    return img

def mouth_files(folder):
    found = {}
    for f in os.listdir(folder):
        k = os.path.splitext(f)[0].upper()
        if f.lower().endswith(('.png', '.jpg', '.jpeg')) and (k in SHAPES or (len(k) > 1 and k[-1] in SHAPES and not k[-2].isalnum())): found[k[-1]] = os.path.join(folder, f)
    missing = [k for k in 'ABCDEF' if k not in found]
    if missing: raise SystemExit('The mouth folder needs drawings named A to F at least. Missing: ' + ', '.join(missing))
    imgio.protect(*found.values()); return found

def run(audio, out_dir='out/lip_sync', text=None, fps=24, start=1, on=1, mouths_dir=None, rough=False, rhubarb=None, recognizer='pocketSphinx'):
    imgio.protect(audio); name = os.path.splitext(os.path.basename(audio))[0]; os.makedirs(out_dir, exist_ok=True)
    wav = as_wav(audio, out_dir); samples, rate = read_wav(wav); duration = len(samples) / rate
    mine = mouth_files(mouths_dir) if mouths_dir else None
    exe = None if rough else find_rhubarb(rhubarb); note = ''
    if not rough and not exe: note = 'Rhubarb is not installed, so this is the rough loudness-only guess. Run: python lip_sync.py --setup'
    if exe:
        ext = ''.join(k for k in 'GHX' if (mine is None or k in mine))
        cues = run_rhubarb(exe, wav, imgio.out_path(out_dir, name + '_rhubarb_tmp.json'), text, ext, recognizer); method = 'rhubarb'
    else: cues = rough_cues(samples, rate, fps); method = 'rough (loudness only)'
    frames = per_frame(cues, duration, fps, on)
    if mine: frames = [m if m in mine else ('A' if m == 'X' else 'B') for m in frames]        # a shape with no drawing falls back the way Rhubarb suggests
    rows = table(frames, fps, start); files = {}
    files['csv'] = imgio.out_path(out_dir, name + '_lipsync.csv')
    with open(files['csv'], 'w', newline='', encoding='utf-8') as fh:
        w = csv.writer(fh); w.writerow(['frame', 'time_s', 'mouth', 'shape', 'new', 'holds'])
        for r in rows: w.writerow([r['frame'], r['time_s'], r['mouth'], r['shape'], r['new'], r['holds']])
    files['chart'] = imgio.save(chart(samples, rate, frames, fps, start, '%s   %.2f s, %d frames at %g fps%s   (%s)' % (os.path.basename(audio), duration, len(frames), fps, ', on %ds' % on if on > 1 else '', method)), imgio.out_path(out_dir, name + '_lipsync.png'))
    files['json'] = imgio.out_path(out_dir, name + '_lipsync.json')
    with open(files['json'], 'w', encoding='utf-8') as fh: json.dump(dict(audio=os.path.basename(audio), duration=round(duration, 3), fps=fps, start=start, on=on, method=method, text=text, cues=cues, frames=rows), fh, indent=1)
    if mine:
        md = os.path.join(out_dir, name + '_mouths'); os.makedirs(md, exist_ok=True); gif = []
        for r in rows:
            dst = os.path.join(md, '%04d.png' % r['frame'])
            if imgio._key(dst) in imgio._INPUTS: raise SystemExit('Refusing to overwrite an original file: ' + dst)
            shutil.copyfile(mine[r['mouth']], dst)                                  # her drawing, byte for byte
        seq = [(r['mouth'], r['holds']) for r in rows if r['new']]; cache = {}
        for m, hold in seq:
            if m not in cache:
                im = imgio.load_flat(mine[m]); im.thumbnail((480, 480)); cache[m] = im.convert('P', palette=Image.ADAPTIVE, colors=64)
            gif.append((cache[m], hold))
        t = 0; durs = []
        for _, hold in gif: a = round(t * 1000 / fps / 10) * 10; t += hold; durs.append(max(20, round(t * 1000 / fps / 10) * 10 - a))
        files['gif'] = imgio.out_path(out_dir, name + '_lipsync_preview.gif'); gif[0][0].save(files['gif'], save_all=True, append_images=[g for g, _ in gif[1:]], duration=durs, loop=0, disposal=2)
        files['mouths'] = md
    return dict(frames=rows, cues=cues, duration=duration, method=method, note=note), files

if __name__ == '__main__':
    ap = argparse.ArgumentParser(description='Mouth shape per frame from a voice line (Rhubarb Lip Sync).')
    ap.add_argument('audio', nargs='?'); ap.add_argument('--setup', action='store_true'); ap.add_argument('--text'); ap.add_argument('--text-file')
    ap.add_argument('--fps', type=float, default=24); ap.add_argument('--start', type=int, default=1); ap.add_argument('--on', type=int, default=1, choices=[1, 2, 3])
    ap.add_argument('--mouths'); ap.add_argument('--rough', action='store_true'); ap.add_argument('--rhubarb'); ap.add_argument('--recognizer', default='pocketSphinx', choices=['pocketSphinx', 'phonetic'])
    ap.add_argument('--out', default='out/lip_sync')
    a = ap.parse_args()
    if a.setup: setup(); sys.exit(0)
    if not a.audio: raise SystemExit('Give a voice line (WAV), or --setup to install Rhubarb.')
    text = open(a.text_file, encoding='utf-8').read() if a.text_file else a.text
    res, files = run(a.audio, a.out, text, a.fps, a.start, a.on, a.mouths, a.rough, a.rhubarb, a.recognizer)
    if res['note']: print('NOTE: ' + res['note'])
    rows = res['frames']; print('%s: %.2f s = %d frames at %g fps, method: %s' % (os.path.basename(a.audio), res['duration'], len(rows), a.fps, res['method']))
    print('mouths: ' + ' '.join('%s x%d' % (r['mouth'], r['holds']) for r in rows if r['new']))
    print('saved: ' + ', '.join(files.values()))
