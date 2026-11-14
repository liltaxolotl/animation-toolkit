"""
Makes stand-in test material (no artwork needed): a ball easing across the frame as 8 numbered PNGs,
and a short WAV with two clicks at known frames.

    python tests/make_timing_samples.py     -> tests/out/synth_frames/0001.png ..., tests/out/synth_clicks.wav
"""
import os, wave, struct, math, json
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')
FR = os.path.join(OUT, 'synth_frames'); os.makedirs(FR, exist_ok=True)
W, H, N = 1920, 960, 8
ease = lambda t: t * t * (3 - 2 * t)
xs = [300 + 1300 * ease(i / (N - 1)) for i in range(N)]
for i, x in enumerate(xs):
    im = Image.new('RGB', (W, H), 'white'); d = ImageDraw.Draw(im)
    y = 620 - 260 * math.sin(math.pi * i / (N - 1))                  # a simple arc
    d.ellipse([x - 90, y - 90, x + 90, y + 90], outline='black', width=14)
    d.line([(100, 760), (W - 100, 760)], fill='black', width=10)      # ground line that never moves
    im.save(os.path.join(FR, '%04d.png' % (i + 1)))
steps = [math.hypot(xs[i + 1] - xs[i], (620 - 260 * math.sin(math.pi * (i + 1) / (N - 1))) - (620 - 260 * math.sin(math.pi * i / (N - 1)))) for i in range(N - 1)]

SR, FPS, CLICKS = 22050, 24, [12, 24]                                 # clicks start exactly on frames 13 and 25 (0-based 12, 24)
n = int(SR * 1.5); data = [0.0] * n
for f in CLICKS:
    s0 = int(f / FPS * SR)
    for k in range(int(SR * 0.06)):
        data[s0 + k] = 0.8 * math.sin(2 * math.pi * 880 * k / SR) * math.exp(-k / (SR * 0.015))
with wave.open(os.path.join(OUT, 'synth_clicks.wav'), 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, v)) * 32767)) for v in data))
json.dump(dict(steps=steps, clicks=CLICKS, frames=N, size=[W, H]), open(os.path.join(OUT, 'synth_truth.json'), 'w'))
print('made %d frames and a %.1f s wav in %s' % (N, n / SR, OUT))
