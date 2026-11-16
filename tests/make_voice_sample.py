"""
Stand-ins for the lip sync tests (no real voice line needed). Writes into tests/out/lip/:
    bursts.wav        three bursts of noise with silence between (always made)
    voice.wav         a computer voice saying two short lines with a pause between them
                      (Windows only: uses the built-in speech voice. Skipped elsewhere.)
    mouths/A.png..X.png   plain lettered cards standing in for a mouth chart
    truth.json        where the sound and the silences are
"""
import os, json, subprocess, sys
import numpy as np
from scipy.io import wavfile
from PIL import Image, ImageDraw, ImageFont

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'lip'); os.makedirs(os.path.join(out, 'mouths'), exist_ok=True)
rate = 22050; r = np.random.RandomState(1)
bursts = [(0.5, 1.0), (1.5, 2.2), (3.0, 3.4)]; total = 4.0
s = np.zeros(int(total * rate), np.float32)
for a, b in bursts:
    n = int((b - a) * rate); env = np.minimum(1, np.minimum(np.arange(n), n - np.arange(n)) / (0.03 * rate))
    s[int(a * rate):int(a * rate) + n] = r.uniform(-0.6, 0.6, n) * env
wavfile.write(os.path.join(out, 'bursts.wav'), rate, (s * 32767).astype(np.int16))

for i, k in enumerate('ABCDEFGHX'):
    im = Image.new('RGBA', (320, 200), (0, 0, 0, 0)); d = ImageDraw.Draw(im); d.rounded_rectangle([10, 10, 310, 190], 30, fill=(40 + i * 22, 90, 200 - i * 18, 255))
    try: f = ImageFont.truetype('arialbd.ttf', 120)
    except Exception: f = ImageFont.load_default()
    d.text((120, 30), k, fill=(255, 255, 255, 255), font=f); im.save(os.path.join(out, 'mouths', k + '.png'))

truth = dict(bursts=bursts, total=total, voice=None)
voice = os.path.join(out, 'voice.wav')
if os.name == 'nt':
    ps = ("Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate = 0; $s.SetOutputToWaveFile('%s'); "
          "$p = New-Object System.Speech.Synthesis.PromptBuilder; $p.AppendText('Mama made me a bubble bath.'); $p.AppendBreak([TimeSpan]::FromMilliseconds(900)); $p.AppendText('Wow, look at you.'); $s.Speak($p); $s.Dispose()") % voice.replace("'", "''")
    q = subprocess.run(['powershell', '-NoProfile', '-Command', ps], capture_output=True, text=True)
    if q.returncode == 0 and os.path.exists(voice) and os.path.getsize(voice) > 20000:
        vr, v = wavfile.read(voice); v = v.astype(np.float32) / 32768.0; v = v.mean(axis=1) if v.ndim > 1 else v
        win = int(vr * 0.02); lv = np.array([np.abs(v[i:i + win]).max() for i in range(0, len(v) - win, win)]); loud = lv > 0.04
        on = [i * 0.02 for i in range(len(loud)) if loud[i]]; quiet = []; run_start = None        # silences longer than half a second, inside the line
        for i, q2 in enumerate(loud):
            if not q2 and run_start is None: run_start = i
            if q2 and run_start is not None:
                if (i - run_start) * 0.02 > 0.5 and run_start * 0.02 > on[0]: quiet.append([run_start * 0.02, i * 0.02])
                run_start = None
        truth['voice'] = dict(text='Mama made me a bubble bath. Wow, look at you.', duration=len(v) / vr, first_sound=on[0], last_sound=on[-1] + 0.02, pauses=quiet)
    else: print('no speech voice available: ' + q.stderr[-200:])
json.dump(truth, open(os.path.join(out, 'truth.json'), 'w'), indent=1)
print('wrote', out, '(voice line: %s)' % ('yes' if truth['voice'] else 'no'))
