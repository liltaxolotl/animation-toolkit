# Roadmap

The build order from the artist's plan. Each step gets a check-in with her before the next one starts, and nothing is
pushed without her OK. How to use what is already built: `README.md`.

## Built before this plan

- The original four phases: Perspective, Timing, Camera and Value modes, and every script in the README (up to d0c2796).
- Body 2D, phases 1 to 5: mannequin, motions, overlays, proportions, joint limits, muscles, hands and feet (e5528c1, baf44e4, cb72f39).
- Perspective phase 6: PSD import, find the lines, check a drawing against the grid, 1, 2 and 3 point grids on a blank
  frame, character height, a grid across a shot (b7d2b40).

## The plan

- [x] **0. Split, server, shot file.** The one big HTML file split into `animation_app.html` + `app/`; `serve.py`
      (local only, saves into `work/`, never overwrites); the shot file and numbered versions in `app/js/shot.js`. (6e0f163)
- [x] **1. Upload flow with overlay layers and transparent export.** The Start tab (pictures, frames, PSDs, PDF
      storyboards split into panels she can fix, video to frames, routing to the right tab); Perspective layer rows with
      opacity, one-layer export and a before/after slider; the `Vec` overlay format. (6e0f163)
- [x] **2. Detailed 3D figure with toon outline and posing.** The Figure 3D tab: two CC0 bodies, builds and a cartoon
      slider, five looks, a joint table in plain words, IK dragging, 42 clips with key poses, pose files, PNG export. (cc8a98c)
- [x] **3. Perspective from the drawing, plus 3D scene renders through a virtual camera.** Detect, adjust and drift
      check were already there (phase 6). Added: 12 shot presets, the posed 3D figure rendered through the Perspective
      camera (fisheye, skew and lens shift included) as its own layer, placed on the floor and sized by the height marker.
- [x] **4. Pose from the drawing, with a ghost overlay.** The Pose match tab: a guessed skeleton from the ink, joints
      she drags, toward or away flips per limb, the 3D figure fitted through a matched camera, a ghost layer, misses in
      px, honest confidence, transparent exports, numbered copies, the fit saved in the shot file. Start > Anatomy opens
      it. Also the step 3 review fixes (a playing clip, outline width, light, Turn slider, empty export, kid height,
      stacking presets).
- [x] **5. Redline copies and reference drawings.** The Redline tab: marks pasted from a Claude chat (it copies the
      request for you), opened from a file, or drawn by hand, all draggable, with notes, layers and a paintover fade.
      Saves a numbered copy, a transparent layer and the marks JSON. `redline.py` does the same from Python, and
      `--from-perspective` marks every line the perspective check flags with where it should aim. Python and the app
      draw the same pixels (tested). Reference drawings were already covered by `scene_render.py --camera` and the
      3D figure's "Save picture".
- [ ] **6. Corrected copies that warp her linework.** Bend her own lines toward a fix (`pin` items mark where a bit of
      line should move to). Always a new numbered version, never a redraw.
- [ ] **7. Critique, with no API.** The app builds a packet (pictures, measurements, the shot file) to copy into a
      Claude chat or Claude Code; the answer comes back as JSON pasted into the app and drawn as a layer.
- [ ] **8. Frame sequence tools.** Tools that work across a whole shot's frames.
- [ ] **9. Storyboard continuity and animatic timing.** Checks across panels (screen direction, props, sizes) and
      timing a board as an animatic. (The Start tab's "storyboard" button opens Timing and Perspective until this exists.)
- [ ] **10. Hands and feet.**
- [ ] **11. Everything else.** Including the two older phase lists, built only where nothing covers them yet:
  - Old phase 7, Frame Lab: camera move with rotation, lens variant comparison sheets with blending, clip check, puppet
    inbetweens, cleanup checker, options-first sheets. (Pose pops, the timing chart and GIF export already exist.)
  - Old phase 8, production extras: mouth chart in the app, colour continuity against a model sheet, squash, stretch
    and smear measure, staging thumbnails, review notes on video, reference board, in-app shot list. (Lip sync, value
    check, spacing, x-sheet and tracker update already exist.)
