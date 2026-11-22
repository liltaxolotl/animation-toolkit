# animation-toolkit

Tools for hand-drawn 2D animation: perspective, timing, inbetweens, camera moves, lip sync, value and
anatomy checks, and a shot tracker updater. One offline app for the artist, plus Python scripts a Claude
(or anyone) can run on boards and frames.

**If you are a Claude: this page is the whole manual. Read it once, then use the tools.** What is built and what
comes next: `ROADMAP.md`.

Drawings are PNGs on a 3840 x 1920 canvas. A frame sequence is a folder of numbered PNGs (`0001.png`, `0002.png`, ...).
Other sizes work; 3840 x 1920 is just the default.

## Rules every tool follows (keep them when you add one)

1. **Originals are never edited or overwritten.** Every output is a new file, by default under `out/<tool>/`.
   `animtk/imgio.py` refuses to save over anything it loaded.
2. **Guide or warp, never redraw.** The tools draw guides on transparent layers, measure, or bend the artist's own
   lines. Nothing here replaces linework with generated drawings.
3. **A flag means "look here", not "this is wrong".** The tools only see ink and numbers. Stylized perspective
   (wide, bowed, tilted rooms) and stylized proportions are choices, so report flags as questions.
4. **This repo is public. Never commit artwork, frames, audio, mouth charts or spreadsheets.** `.gitignore` blocks
   every image, audio, video, PDF and spreadsheet type plus `samples/`, `out/`, `tools/`, `work/`. Do not force-add past
   it. (The 3D bodies in `app/assets/` are CC0 and committed on purpose: see `app/assets/CREDITS.md`.)
5. **Ask the artist before pushing**, and ask where the shot tracker lives before touching it.

## Setup

    pip install -r requirements.txt        # numpy, opencv-python, pillow, scipy, openpyxl  (Python 3.10+)
    python lip_sync.py --setup             # only for lip sync: downloads Rhubarb Lip Sync into tools/rhubarb (about 90 MB)

    python serve.py                        # opens the app at http://127.0.0.1:8765/animation_app.html  [--port N] [--no-open]

The app needs nothing beyond Python and Chrome or Edge. It works offline and no file leaves the computer.
Double-clicking `animation_app.html` still works for most tabs, but Figure 3D and PDF storyboards need the server, and
without it nothing saves into `work/` (exports go to Downloads).

## Which tool for which job

| The artist says | Use |
|---|---|
| "Here is my storyboard PDF / a video / a folder of frames" | Start tab: add it, fix the panel boxes, pick what to get help with |
| "Is my perspective right?" / "find the vanishing points" | Perspective mode in the app ("Find the lines for me", then "Check my drawing against the grid"), or `perspective_check.py` for a saved report |
| "Give me a clean 1, 2 or 3 point grid to draw over" | Perspective mode: Blank, then click where each vanishing point goes, then Export guide PNG |
| "Is this character the right size back there?" | Perspective mode: Measure a character |
| "Does the perspective hold across this shot?" | Perspective mode: upload all the frames, then "Check every frame for jumps" |
| "Block out this room / prop so I can draw over it" | `scene_render.py`, or the props in Perspective mode |
| "Make me an inbetween" | `inbetween.py` |
| "Does this shot move right?" (arcs, spacing, pops) | `motion_check.py` |
| "Help me time this" / x-sheet / onion skin / waveform | Timing mode in the app |
| "I need a walk cycle reference" | `cycle_guide.py` |
| "How big does the background need to be for this pan or zoom?" | `camera_move.py`, or Camera mode in the app |
| "Does this pose read?" / silhouette / values | `value_check.py`, or Value mode in the app |
| "Check the proportions / balance / this hand / this cat" | `anatomy_guide.py` |
| "Which mouth goes on which frame?" | `lip_sync.py` |
| "Show me how a body bends / let me pose a figure and time it" | Body 2D tab |
| "How many heads tall is a kid / a chibi?" / "what does a walk, sneak, run, jump look like?" / "show me a hand gripping" | Body 2D tab (Proportions, the motion library, Hands and feet) |
| "Pose a real figure from any angle" / "a reference render of this pose" / "show me this walk in 3D" | Figure 3D tab |
| "Match a 3D figure to the pose I drew" / "is this foreshortening right?" / "a ghost over my drawing" | Pose match tab |
| "Redline this" / "draw your notes on my drawing" / "mark the lines that miss the vanishing point" | Redline tab, or `redline.py` (`--from-perspective`) |
| "Does my board keep screen direction?" / "time this board as an animatic" / "a shot list" | Storyboard tab |
| "A clean reference drawing of this room or pose from my camera" | `scene_render.py --camera`, or Figure 3D / Perspective "Save picture" |
| "Mark shot 12 as cleaned up" | `tracker_update.py` |

Every script prints a short plain summary and the list of files it saved. Run any script with `-h`, or read the
comment at the top of the file, for every option.

---

## The app: `animation_app.html`

Ten tabs: Start, Perspective, Timing, Camera, Value, Body 2D, Figure 3D, Pose match, Redline, Storyboard. Load files with the buttons or by dragging
them onto the picture. Every tab that takes pictures takes PNG, JPG and PSD (the flattened picture inside the PSD;
layers are not read). No build step: the page is plain HTML, `app/app.css` and the scripts in `app/js/` (see Layout).

**Start.** The front door. Add pictures, a folder of frames, PSDs, PDF storyboard pages or a short video, then pick what
to get help with; it hands plain picture files to the matching tab. Originals are only read.

- Several pictures at once become one frame sequence, in name order (frame 2 before frame 10).
- PDF panels (`app/js/panels.js`), found on a small copy of each page. Bordered panels first: the white gutter is
  everything light the page edge can reach, and whatever it cannot reach and fills its own box is a panel (a frame
  around the whole page is looked inside). No borders: the page is split along empty rows, then empty columns, and
  each piece is trimmed to its ink (a rougher guess, and it says so). Neither: the whole page is one panel. Panels are
  numbered in reading order; boxes unlike the rest (a dialogue box, a title block) are kept but start switched off.
- Fixing the crops: drag a box to move it, drag an edge or corner to resize it, click its number to switch it on or
  off, Draw a box to add one, Delete box (or the Delete key), Find them again to start over. Each panel is cut from a
  3600 px wide render of its page: `NAME_p01_panel01.png`.
- Video to frames: From and To (seconds), frames a second and size, then Pull the frames (480 at most):
  `NAME_0001.jpg ...`. Each frame is the picture showing at that moment, so timing matches the clock whatever the phone
  filmed at. MP4 (H.264) and WebM work best.
- What to get help with: Perspective, Animation (Timing), Anatomy (Value for now; 3D pose matching is step 4),
  Storyboard (Timing as an animatic, plus Perspective to step through the panels), Check everything (Value, Timing when
  there is more than one frame, and Perspective with the line finder and the drift check on).
- Through `serve.py` it also writes the shot file and copies of the originals (see Shot files below).

**Perspective.** Load a board, the frames of a whole shot, or start from a blank frame. The grid follows the drawing's
own angles: nothing is ever "corrected".

- Marking by hand. Three line tools: depth, side, upright. Drag along an edge, or just click where the vanishing point
  should be (the app lays the lines for you; click again to move the point). Depth only = 1 point, depth + side =
  2 point (the horizon and the lens width come from them), depth + side + uprights = 3 point (the lens centre moves off
  the middle of the picture to fit all three). With the Select tool, drag a line, a line end or a vanishing point.
- **Find the lines for me.** Finds the long straight strokes in the picture, groups the ones that agree on a point, and
  lays up to four lines per group for you to adjust. Strokes that are simply parallel (level edges) get no point. If
  the strokes do not agree, it adds nothing and says so.
- **Check my drawing against the grid.** Strokes that sit on the grid turn green; strokes that nearly aim at a
  vanishing point but miss it turn orange with how many degrees off they are (the eight worst). Lines that have nothing
  to do with a vanishing point are left alone.
- **Character height.** Drag from the feet to the top of the head of one character, then click anywhere on the floor:
  a marker of the same height stands there, so a character further back or closer can be sized against it.
- **A shot.** Upload several frames at once: they load in name order on one grid, with < and > (or , and .) to step
  through. "Check every frame for jumps" finds the depth point on each frame and lists the frames where it jumps away
  from where its neighbours put it. A steady slide (a camera move) passes.
- Lens sliders: Dutch tilt, fisheye, lens width, stylized skew, with one-click looks (straight, wide, bendy, fisheye,
  high, low).
- 3D blockout props that sit on the perspective: boxes, cylinders, bottles, jars, shelves, cabinets, doors with a real
  hinge swing.
- Shot presets: 1, 2 and 3 point, low angle, high angle, Dutch, bird's eye, worm's eye, over the shoulder, hallway,
  room interior, street corner. Each sets a camera (and a few props, walls or markers) to drag from. They switch "Use my
  lines" off so the preset drives the camera; her drawn lines are kept.
- 3D figure in this shot (needs `serve.py`): the posed figure from the Figure 3D tab, rendered through this tab's own
  camera, so it matches the grid exactly, fisheye, skew and the 3 point lens shift included. It stands on the pink height
  marker at that character's height (or 12 ft away at 5 ft 4 in); "Place it" puts it on any floor spot, Turn spins it (0 =
  facing the camera). It is the "3D figure" layer: opacity, export alone, before/after. How (app/js/persp3d.js): three.js
  draws a square wide picture from the same spot; every drawing pixel asks `AT.rayCam` which way it looks and reads that
  direction from the square. Feet to metres: 0.3048, and the depth axis flips (Perspective z runs away from the camera).
- Guide layers, one row each: horizon, vanishing points, floor grid, depth lines, uprights (walls), props, character
  height, drift check, my drawn lines (character height and drift start ticked). Every row has a tick box, an opacity
  slider (it carries into the export) and a button that exports that layer alone as `BOARD_<layer>.png` (the drift
  layer is empty until "Check my drawing" is on, and it says so). Export guide PNG saves every ticked layer as one
  transparent `BOARD_guide.png` at the drawing's exact size. Exports always download; through `serve.py` a copy also
  lands in `work/BOARD/exports/`.
- Before / after slider on the picture: drag the handle, and left of it shows the drawing untouched.
- Saves or loads a scene JSON (the same format `scene_render.py` reads; it also opens the `_check.json` from
  `perspective_check.py`).

**Timing.** Load a frame sequence. Plays at 24 fps (12, 25, 30 too), everything on 1s, 2s or 3s, with a hold per
drawing. Onion skin with separate before and after counts. Mark keys, breakdowns and inbetweens (K, B, I); the timing
chart shows where the drawings fall between keys, measured from how far the lines move. Load audio to see its waveform
under the frames with a tick on every accent. Exports an x-sheet CSV (frame, time, drawing, file, type, hold, sound
level, accent) and a preview GIF.

**Camera.** Type or drag camera keys (frame, center X, center Y, zoom %, easing). Shows the canvas size needed so the
move never runs off the edge, the path, what the camera sees on any frame, and a table with one row per frame: camera
center on the canvas, canvas layer scale and position for the comp, and where to place a drawing made for that frame.
A key can carry its drawing so keys can be lined up by eye. Exports the table as CSV (same columns as
`camera_move.py`), a plan picture, and a move file that `camera_move.py --json` opens.

**Value.** Load frames. Shows a pure black silhouette beside the grayscale. Line art: closes small gaps and fills the
figure; click any patch to flip it between black and white. Painted frames: darker than a cutoff. Transparent
backgrounds: used directly. Grayscale can be squashed to 2 to 5 values. Flip, stack, and full-size PNG export.

**Body 2D.** A posable side-view mannequin for anatomy and body mechanics. Three views, picked above the picture:
**Mannequin** (pose it, play it), **Proportions** (a guide in head heights) and **Hands and feet** (a gesture sheet).

- Posing. Joints: neck, spine, hips, and both shoulders, elbows, wrists, knees and ankles. Drag a body part to swing it
  from its joint, drag a wrist or ankle dot to pull the whole limb, drag the hip diamond to move the body (the feet stay
  planted). Click a dot to pick a joint and bend it with the slider.
- Timeline. Every stored pose shows as a little figure with its name and a mark: red diamond = key pose, blue diamond =
  breakdown, green dot = inbetween (the Timing tab's colours). Click or drag to scrub, drag a mark to move that pose,
  and posing on a frame with no mark makes a new key pose. The top left of the picture names the pose you are on, or
  says which two poses an inbetween frame sits between. A foot that is on the ground in two neighbouring poses stays on
  the ground on the frames between them.
- Motions to study: walk cycle (contact, down, passing, up; 12 frames a step, walking on the spot), pick something up
  (anticipation, hips back, grab, legs push, settle), raise a hand (anticipation, elbow leads, overshoot, settle), and a
  crouch-and-stretch to practise on. Each says under the buttons what it teaches.
- Walks, runs and jumps: happy walk (10 frames a step, bouncy, chest out), sneak (24 frames a step, low, toe first),
  tired walk (16 frames a step, slumped, feet dragging), run (8 frames a step, with an "in the air" pose), jump
  (anticipation, push off, top, land, squash, settle) and stop short (the overlapping action demo: the body stops, the
  arms carry on, swing back and settle). A picture that would run off the top or the side zooms out to fit.
- Onion skin: the neighbouring stored poses or nearby frames, blue before and orange after.
- Timing: the speed slider plays the motion faster or slower and shows where the poses would land; "Keep this timing"
  moves them there.
- Overlays (tick boxes beside Play): **Line of action** draws one gold curve from the head (or a hand reaching above
  it) down the spine and out through a leg, and says straight, C curve or S curve. **Balance** shows the centre of
  gravity, a plumb line under it and the stretch of ground the feet cover: green = over the feet, orange = only just,
  red = tipping, with the direction. **Pivots** marks every joint, a wedge for how far it is bent from rest, and the
  arc the selected joint swings on. **Joint limits** (on by default) draws the range a real joint has around the
  selected joint, and puts a ring and "12 degrees past" on any joint bent further than that: orange up to 15 past, pink
  beyond. It is a heads up, not a rule (breaking a joint for a frame is a real technique). **Muscles** draws the main
  muscle groups as blobs that go red, short and fat when they bunch up (squash) and blue, long and thin when they are
  pulled (stretch), and names what the selected joint does to them. **Hair and scarf** hangs a ponytail, a scarf and
  a coat tail on the figure: they drag behind while it moves and swing on after it stops (follow through).
- Proportions view: adult (7.5 heads), heroic (8.5), teen (7), child of about 8 (6), toddler (4), cartoon (3), chibi (2)
  and lanky (9.5) standing in a row, each with a ruler of its own heads and a gold line at half its height. Options in
  the side panel: all the same height, and all in the pose on the current frame.
- Hands and feet view: eight hands (relaxed, open, fist, gripping, pointing, pinching, thumbs up, waving) and six feet
  (flat, heel strike, push off, tiptoe, pointed, flexed), each with one line on what to notice. Green marks show what
  touches the ground.
- Saves and opens a motion file, and saves the current frame (or the guide, or the sheet) as a PNG.

A motion file is small enough to write by hand, so you can author a motion for the artist and have her open it:

    {"kind": "animtk-body-motion", "version": 1, "fps": 24, "name": "Wave", "about": "One line on what it teaches.",
     "keys": [
      {"frame": 1,  "kind": "key",       "label": "Stand",       "ease": "inout", "pose": {"shoulderR": 8, "elbowR": 12}},
      {"frame": 9,  "kind": "breakdown", "label": "Elbow leads", "ease": "linear", "pose": {"shoulderR": 82, "elbowR": 118}},
      {"frame": 15, "kind": "key",       "label": "Hand up",     "ease": "inout", "pose": {"shoulderR": 150, "elbowR": 22}}]}

`kind` is `key`, `breakdown` or `inbetween`. An optional `"prop": {"x": 1.6, "y": 0.3, "r": 0.3, "grab": 24, "hand":
"R"}` draws a ball that rests at x, y and travels with that hand from the grab frame on.

Pose fields: `x`, `y` (hips, in head heights, ground at 0, standing hips at about 3.89), then angles in degrees:
`lean`, `spine`, `neck`, and `shoulder`, `elbow`, `wrist`, `hip`, `knee`, `ankle` each with `R` (near side) or `L` (far
side). 0 is the resting position and positive is the natural bend: arms and thighs swing forward, elbows and knees
fold, the torso and head bow forward, toes lift. Anything left out is taken from the standing pose. `ease` is how the
motion leaves that key: `inout`, `in`, `out` or `linear`.

**Figure 3D.** A real rigged human for posing and reference renders. Needs `serve.py`. `app/js/figure3d.mjs` is the
figure, `figure-ui.mjs` the tab, and `figure-tab.js` loads them the first time the tab opens; from then on
`window.Fig3D` is the API other tabs use.

- Bodies: Adult man and Adult woman (Mesh2Motion, CC0), one 66-bone skeleton with fingers. Switching keeps the pose.
- Builds: Average, Heavier, Thinner, Teen, Kid (about 8), each a length and girth scale per bone, applied in the bind
  pose so bent joints never shear. The Cartoon slider (0 to 100%) goes realistic, cartoon, chibi: up to a 2.3 times
  head, shorter torso, legs and arms, bigger hands and feet. The readout gives heads tall (from the vertices that move
  with the head) and the height in ft and m. The feet always stand on the ground.
- Looks: Toon + outline (three tone steps and an inverted-hull outline about 1.6 px wide), Light and shadow,
  Cross-contour (blue rings round every limb), Wooden mannequin, Skeleton (x-ray). Light direction sliders, Floor and
  shadow, Show the skeleton on top.
- Posing: a dot on every joint (orange diamond = hips, green = hands and feet, pink = selected). Drag a wrist or ankle
  for two-bone IK (shoulder and elbow, or hip and knee; the hand or foot keeps its angle). Drag any other dot and its
  parent turns to point at it. Drag the hips to move the body; with "Feet stay put when the hips move" (on by default)
  the legs follow by IK. Drags move on a plane facing the camera. Empty space orbits, right drag pans, the wheel zooms.
  Click a dot for its sliders, named in the joint's own words with its real range. Reset this joint, Standing pose, a
  hands slider (flat to fist), Undo (60 steps).
- "Keep joints inside a real body's range" (on by default) clamps the sliders and the drags. A joint past its range
  (from a clip, or with the box off) gets a pink ring and a line in the list, "12° past": a heads up, not a rule.
- Actions: 42 Mesh2Motion clips in five groups (walks; runs and jumps; bend, sit, kneel; reach and act; moods). They
  keep only the rotations plus the hips' travel scaled to the current build. Play, speed, and a 24 fps timeline to
  scrub. Walks and runs get their key poses marked from the feet and hips: contact (red), down (blue), passing (green),
  up (orange). Pose this frame (or grabbing any dot or slider) turns the frame on screen into a still pose to change.
- Save picture (PNG): 3840 x 1920, 1920 x 1080 or this view's size, transparent by default (figure only, no floor), the
  outline scaled to the size: `figure_man_pose.png`, or `figure_man_walk_f12.png` from a clip. It downloads and is kept
  in `work/figure/exports/`.

Joints. Angles are in degrees with their real range; "its left" means the figure's own left, `_l` and `_r` the sides.

| Joint | Bone | Angles (axis): real range |
|---|---|---|
| Hips | `pelvis` | turn to its left (y) -180 to 180, tip forward (x) -90 to 90, tip to its left (z) -60 to 60. Free: never flagged |
| Lower back | `spine_01` | bend forward (x) -15 to 30, lean to its left (z) -12 to 12, twist to its left (y) -12 to 12 |
| Mid back | `spine_02` | bend forward -12 to 30, lean -12 to 12, twist -15 to 15 |
| Chest | `spine_03` | bend forward -12 to 25, lean -10 to 10, twist -15 to 15 |
| Neck | `neck_01` | bend forward -40 to 45, lean -25 to 25, twist -45 to 45 |
| Head | `head` | bend forward -30 to 30, lean -18 to 18, twist -35 to 35 |
| Collarbone | `clavicle_l/_r` | shrug up (z) -10 to 35, forward (y) -15 to 25, roll (x) -10 to 10 |
| Shoulder | `upperarm_l/_r` | raise forward (x) -60 to 180, raise to the side (z) -35 to 180, turn out (y) -90 to 90 |
| Elbow | `lowerarm_l/_r` | bend (y) 0 to 150. A hinge: the other two turns are held within 8 |
| Wrist | `hand_l/_r` | bend toward the palm (z) -70 to 80, toward the thumb (y) -30 to 20, roll the hand (x) -90 to 90 |
| Hip joint | `thigh_l/_r` | swing forward (x) -30 to 125, out to the side (z) -25 to 45, turn the knee out (y) -40 to 45 |
| Knee | `calf_l/_r` | bend (x) 0 to 150. A hinge, held within 6 |
| Ankle | `foot_l/_r` | point the toes (x) -25 to 50, roll the sole in (z) -20 to 25, turn the toes in (y) -25 to 25 |
| Toes | `ball_l/_r` | toes up (x) -30 to 60. A hinge, held within 5 |

Angle conventions: each angle is measured in the body's frame at rest (X = the figure's left, Y = up, Z = forward) and
carried along by the parent bone: `local = (Wp^-1 * D * Wp) * restLocal`, where Wp is the parent's rest world rotation
and D is built from the angles (Euler, in the order the joint lists them). 0 is the rest pose. Shoulders are measured
from "arm hanging down", so they read like the hips. The right side mirrors the left (angles about Y and Z flip sign),
so the same numbers make the same pose on either side. Every rotation has two Euler readings; the one inside the
joint's range wins, so an arm raised past level never reads as bent backwards.

To pose it from code: `Fig3D.setAngles('lowerarm_l', {y: 90})` bends its left elbow 90 degrees, and
`Fig3D.angles(bone)` lists each angle's label, axis, value and range. Also on `Fig3D`: `setBody`, `setBuild(build,
cartoon)`, `setStyle`, `setLight(az, el)`, `standing`, `curlFingers(side, 0 to 1)`, `moveHips`, `reach(end, target)`,
`getPose`, `setPose`, `playClip(id, {play})`, `seek(seconds)`, `play`, `pause`, `freeze`, `overLimits`, `heads`,
`snapshot(W, H, transparent)` (a canvas), `on(listener)`, and `scene`, `camera`, `renderer`, `JOINTS`, `BUILDS`,
`STYLES`, `CLIPS`.

Save pose / Open a pose use a pose file:

    {"kind": "animtk-figure-pose", "version": 1, "body": "man", "build": "average", "cartoon": 0,
     "pelvis": [x, y, z], "pelvisRest": [x, y, z], "bones": {"pelvis": [qx, qy, qz, qw], "spine_01": [...], ...}}

`bones` holds every bone's local rotation as a quaternion (three.js order x, y, z, w), so pose with `setAngles` and save
rather than writing one by hand. `body` is `man` or `woman`, `build` one of `average`, `heavier`, `thinner`, `teen`,
`kid`, and `cartoon` 0 to 1. Opening a pose switches the body and build to match and rescales the hips' position.

### Pose match tab (`app/js/pose-tab.mjs`, the fit in `app/js/pose-fit.mjs`)

Poses the 3D figure to match a drawing and lays it over the drawing as a ghost. Needs `serve.py` (it loads the 3D
figure). Start > Anatomy opens it with the chosen pictures.

1. Open a drawing. The app finds the biggest blob of ink (a panel border and small doodles are ignored) and guesses a
   standing skeleton in it from "Guess as" (7.5, 6, 4.5 or 3 heads). Hollow dots are the app's guesses, filled dots are
   hers. "Box the character" when it picked the wrong ink. Toes start off; any joint can be marked hidden.
2. She drags the joints that are off. "Fit again when I let go of a joint" is on by default.
3. The fit, in plain steps:
   - Facing: the standing figure's torso joints are turned through every yaw and tilt; for each, the best 2D scale,
     roll and shift is solved exactly, and the smallest leftover wins. If a facing well away fits nearly as well, a note
     says the turn is unsure.
   - Depth: a bone drawn shorter than it is points toward or away from the camera by exactly the missing length. A
     drawing cannot say which way, so the fit takes the way inside a real body's joint ranges, and on a tie the hand or
     foot in front of the body. "Flip" on a limb takes the other way. A part drawn at more than about 92% of its length
     counts as flat to the camera, since perspective and proportions alone shorten that much.
   - Camera: a plain lens (35 degrees across the long side unless Lens is set) at the distance that makes the figure
     her size. Height is a soft wish: among facings that fit about as well, the one nearest that height wins.
4. Shows the ghost (tinted blue, own opacity), her joints, where the figure misses (red, with the distance in px), how
   sure it is in plain words, and the fit's notes. Her Figure 3D pose is put back after every fit; "Send this pose to
   Figure 3D" is the only way a fit reaches that tab.
5. Saves: the ghost, the joints or the misses as transparent PNGs at the drawing's exact size;
   `<name>_ghost_vN.png` (drawing plus ghost) as a new numbered copy; the joints (who placed each one), flips, camera
   and fit into `shot.json` under `detections.pose.drawings[<file name>]`, plus two Vec layers ("Pose joints", "Where
   the figure misses").

From code (the tab, a test, or a Claude driving the page):

    import { fitPose, renderGhost, projectJoints, JOINT_NAMES } from './app/js/pose-fit.mjs'
    fitPose(Fig3D, {joints: {head: [x, y], neck: [x, y], ...}, W, H, camera: {fov, height} | null, flips: {arm_l: true}})
      -> {pose (animtk-figure-pose), camera: {pos, right, up, back, theta, center, f, fov}, place, error: {joint: px},
          joints2d: {joint: [x, y]}, depth: {arm_l: 'toward' | 'away' | 'flat', ...}, confidence: 0 to 1, notes: [text],
          choices, facing: {yaw, tilt, roll}, scale}
    renderGhost(Fig3D, fit, W, H)   -> a W x H transparent canvas, already lined up with the drawing
    projectJoints(Fig3D, fit)       -> where each joint of that pose lands through that camera

Joints (drawing pixels, y down; `l` is the character's own left): head, neck, chest, pelvis, shoulder, elbow, wrist,
hip, knee, ankle, toe (`_l` / `_r`). Any can be null. It needs two torso joints at least. Measured in
`tests/test_app_pose.mjs`: the figure posed, photographed through a known camera and fitted back lands its joints within
1% of the figure's height, with the camera direction within about 6 degrees, front on and from 50 degrees round.

### Redline tab (`app/js/redline-tab.mjs`)

Notes and fixes drawn over a copy of a drawing, never on the drawing itself. Three ways to get marks:
- **From Claude, with no API.** "Copy a request for Claude" puts a short note on the clipboard that explains the marks
  format and gives the drawing's size. She pastes it into a Claude chat with her drawing, then pastes the answer into the
  box and clicks "Draw these marks". Words or a ```json fence around the JSON are fine, and marks written on a smaller
  copy are scaled up from the W and H Claude gives. Anything it cannot read is skipped with a plain "heads up".
- **From a file:** a marks JSON from `redline.py` or an earlier save ("Open a marks file", "Open my last saved", or
  drop the JSON on the picture).
- **By hand:** Arrow, Line, Circle, Box, Text and Warp pin (a pin says where a bit of line should move to, for the
  corrected copies of step 6), on any layer. Fixes is red, Construction is blue (its lines come out dashed), "New layer"
  adds more.

Move picks a mark: drag it, drag its dots, give it a "why" note, Delete removes it, Ctrl+Z undoes. Notes show in a list,
and clicking one picks its mark. Layers have their own tick box, opacity and export. "Fade drawing" lightens the drawing
under the marks the way a paintover reads (the same sum as `animtk/imgio.dim`). "Save a redline copy" writes a new
numbered trio into `work/<shot>/`: `<name>_redline_vN.png` (the copy), `_layer.png` (marks alone, transparent, the
drawing's exact size) and `.json` (the marks, to open again here or in `redline.py`), and lists it in the shot file's
`edits`. `redline.py` and the tab share the numbering, so either can carry on from the other.

### Storyboard tab (`app/js/board-tab.mjs`)

A board in panel order: pictures (sorted by the numbers in their names, so p2 comes before p10), the Start tab's PDF
panels, or a video split at its cuts ("From Start", or Start > Storyboard). "Find the cuts" does the same for a folder of
animatic frames: frames that barely change are one held drawing.
- **Each panel:** a shot size (it starts as a guess from where the biggest ink shape sits in the frame, and says it is a
  guess), an angle, a hold in frames, a note, and "New setup here" for a jump on purpose.
- **Camera move:** pan or tilt, truck, or zoom, drawn as a solid start frame and a dashed end frame on the panel. Drag
  a frame or its corners (it keeps the panel's shape). It is described in words (TRUCK IN + PAN RIGHT) and exports as a
  transparent PNG at the panel's exact size.
- **Overhead map:** she places the camera (and where it aims) and up to four characters (and where they face). A and B
  make the 180 line. Nothing is read from the drawing. A panel follows the map before it until she changes something.
- **Continuity:** "look here" notes when the camera crosses the 180 line between cuts, and when someone walking flips
  screen direction. A shot right on the line, a walk head on, or "New setup here" bridges it, the way it does on screen.
- **Animatic:** plays the board at 24, 25, 30 or 12 fps, easing through each camera move. Drag a panel's right edge in
  the strip to change its hold.
- **Export:** a shot list CSV (size, angle, move, frames, seconds, in and out timecode, look-here notes, notes) and a
  shot list sheet PNG. "Save the board" keeps it all in `work/<board>/shot.json` under `detections.board`, and opening
  the same panels again picks it back up.

### Shot files, saving and layers (`app/js/shot.js`, shared by every tab)

- **Store** saves into `work/<shot>/` through `serve.py`, or downloads when the page was opened as a plain file. Names
  are cleaned to letters, digits, spaces and `_ . - ( )`.
  - `work/<shot>/shot.json`: the shot file, the only file anything ever overwrites.
  - `work/<shot>/source/`: write-once copies of the originals.
  - `work/<shot>/<base>_<tag>_vN.<ext>`: edited copies (`Store.saveVersion`), numbered from what is already in the
    folder (and this browser's memory when offline), so `shot01_edit_v1.png`, `_v2`, ... never replace each other.
  - `work/<shot>/exports/`: a copy of every export. The export itself always downloads, where the artist picks it up.
- The shot file:

      {"kind": "animtk-shot", "version": 1, "name": "shot01", "created": "<ISO time>", "help": ["perspective"],
       "sources": [{"file": "shot01.png", "size": 123456, "w": 3840, "h": 1920}],
       "detections": {"panels": [{"page": 1, "how": "borders", "panels": [{"x": 0.05, "y": 0.04, "w": 0.4, "h": 0.3, "use": true}]}],
                      "video": {"fps": 24, "frames": 48}},
       "layers": [], "edits": [], "notes": []}

  `help` lists every help button used on it; panel boxes are fractions of the page. `layers`, `edits` and `notes` are
  empty for now and wait for the later steps (redlines, corrected copies, critique).
- **Vec**, the vector overlay format. A layer is `{id, name, color, opacity (0 to 100), visible, items}` in the
  drawing's own pixels, so an exported layer drops straight onto the drawing in any program. Items, with `t` the type:
  `line {a, b}`, `arrow {a, b}`, `poly {pts, closed}`, `circle {c, r}`, `ellipse {c, rx, ry, rot}` (rot in degrees),
  `rect {a, b}`, `text {at, text, size}`, `pin {from, to}` (a warp pin: where a bit of linework should move to). Points
  are `[x, y]`. Any item can carry `color`, `w` (line width in px at 3840 wide, default 6, scaled with the drawing),
  `dash: [on, off]` and `fill`. For example `{"t": "arrow", "a": [1200, 900], "b": [1340, 860], "color": "#e8202a"}`.
  `Vec.canvas(layers, W, H)` draws them on a transparent canvas at the drawing's size. Nothing draws with it yet:
  redlines (step 5) and critique answers (step 7) will come back in it.
- `layerRows(el, {rows, get, set, exportOne})` builds the tick box, opacity and export-one-layer rows for any tab, and
  `BeforeAfter(stage, onChange)` adds the draggable split handle.

### serve.py: the app's local server

    python serve.py [--port 8765] [--no-open]

Serves the toolkit folder read-only to this computer only (it binds to 127.0.0.1) and opens the app. If the port is
taken it assumes the server is already running and just opens the browser. It saves only into `work/` and never
overwrites a file, except a shot's own `shot.json` (written to a temp file, then swapped in). Every other save is
create-only, so two saves at once can never both win. Each path part may only use letters, digits, spaces and
`_ . - ( )`, and a part that is only dots or spaces, or ends in one, is refused (Windows would quietly drop them). The
API, used by `Store`:

    GET  /api/ping                        -> {"ok": true, "work": "<absolute path of work/>"}
    GET  /api/list?dir=work/<shot>        -> {"files": [{"name", "size", "dir"}]}   (empty if the folder is not there yet)
    POST /api/save?path=work/<shot>/<f>   body = the file's bytes -> {"ok": true, "path"}
                                          409 if it exists, 400 outside work/, 413 over 400 MB

The Python scripts (and a Claude) can read the same `work/<shot>/` folders.

---

## The scripts

### perspective_check.py: vanishing points, horizon, lines that miss

    python perspective_check.py BOARD.png [--region x0,y0,x1,y1] [--ignore x0,y0,x1,y1] [--pick N] [--fov 60] [--out DIR]

Out: `BOARD_check.png` (look at this first), `BOARD_guide.png` (transparent guide), `BOARD_check.json`.

It reads every long straight stroke, so arms and props can pull it off. Groups with little ink behind them are drawn
thin and named "maybe 1", "maybe 2": if the picture shows one is real, rerun with `--pick` and its number. Mask
characters with `--ignore`. On a board that is mostly characters, mark the perspective by hand in the app instead.

### redline.py: marks drawn over a drawing as a new numbered copy

    python redline.py DRAWING MARKS.json [--shot NAME | --out DIR] [--fade 35] [--tag WORD] [--check]
    python redline.py DRAWING --from-perspective [CHECK.json] [--shot NAME | --out DIR] [--fade 35]

Out (new files, numbered, the drawing is only read): `<name>_redline_vN.png`, `<name>_redline_vN_layer.png`
(transparent, the drawing's size) and `<name>_redline_vN.json`, into `--out`, else `work/<shot>/`, else the drawing's
own `work/` folder, else `out/redline/`. MARKS.json is the format at the top of the script (the same one the Redline tab
reads and writes, drawn by `animtk/layers.py`). `--from-perspective` works out the marks itself: every line the
perspective check flags gets a red line where it would sit if it aimed at its vanishing point (turned about its own
middle), arrows at ends that move far enough to see, and a number; the blue Construction layer has the horizon, the
trusted vanishing points and a dashed ray from each fixed line to its point. It runs the check itself, or reads a
`_check.json` from `perspective_check.py` (use that when `--region` / `--ignore` are needed). Its files are tagged
`perspective`. From Python: `redline.perspective_marks(check)`, `redline.doc_from_items(items, W, H)` and
`redline.save_redline(drawing, doc, shot=...)`.

### scene_render.py: 3D blockout through a virtual camera

    python scene_render.py SCENE.json [--board BOARD.png] [--camera CHECK_OR_APP.json] [--wobble] [--no-labels] [--out DIR]

Out: `SCENE_reference.png`, `SCENE_guide.png` (transparent), `SCENE_over_board.png` (with `--board`).
The scene format is described at the top of the script; `examples/room_scene.json` is a starting point. The camera
can be regular, fisheye or anything between (`k`: 1 = regular, 0.02 = full fisheye), with tilt and skew.

### inbetween.py: inbetweens made from the two keys' own lines

    python inbetween.py KEY_A.png KEY_B.png [-n 1] [--ease inout|in|out|linear] [--at 0.33,0.66] [--arc dx,dy]
                        [--source nearest|a|b] [--region x0,y0,x1,y1] [--force] [--guide-only] [--out DIR]

Out: `A_B_inb01.png ...` (only when the bend is clean), `A_B_guide.png` (transparent), `A_B_preview.png`, `A_B_report.json`.
Prints **WARPED** or **GUIDE ONLY** with the reason.

Only strokes that move are bent; lines that hold still are left exactly as they are. It tests itself by bending key A
all the way onto key B, and refuses (guide only) when lines do not land, when parts would stretch or squash too far,
or when the bend folds over. Close poses of the same drawing get the warp. Storyboard beats usually get the guide,
which shows where the inbetween should sit and how far along the arc.

### motion_check.py: arcs, spacing, pops

    python motion_check.py FRAMES_FOLDER [--region ...] [--ignore ...] [--all-ink] [--max-flags 6] [--out DIR]

Out: `FOLDER_motion.png` (contact sheet with numbered marks, the path of action, a spacing chart), `FOLDER_motion.json`.
Flags: ARC (a frame off the path), SPACING (an uneven jump), POP (a shape that changes suddenly), SIZE, and
+ BREAKDOWN (a gap that wants a drawing). On key poses or boards it says so and marks only the biggest jumps.

### cycle_guide.py: stick references for cycles

    python cycle_guide.py cat_walk [--frames 12] [--match CHARACTER.png --region x0,y0,x1,y1] [--length PX]
                                   [--at X,GROUND_Y] [--facing right|left] [--travel] [--out DIR]
    python cycle_guide.py --list

Out: `cat_walk_01.png ...` (transparent, canvas size), `cat_walk_sheet.png`, `cat_walk.json`.
To add a cycle, write a `pose(phase, near)` function in `animtk/cycles.py` and add it to `CYCLES`.

### camera_move.py: canvas size and per-frame table for a pan or zoom

    python camera_move.py --key 1,0,0,100 --key 25,1900,0,100 --key 49,1900,-200,160 [--name shot]
    python camera_move.py --images 1:KEY_A.png 25:KEY_B.png
    python camera_move.py --json MOVE.json                      (a move saved from the app)
      [--size 3840x1920] [--ease inout|in|out|linear] [--margin 0.05] [--out DIR]

A key is `frame,x,y,zoom%`: where the camera center is in field pixels at 100% (right and down are positive, the first
key is usually 0,0) and how far it is pushed in (200 = twice the size).

Out: `NAME_camera.csv`, `NAME_plan.png`, `NAME_camera.json`. Prints `CANVAS NEEDED: W x H px`.

CSV columns, one row per frame: `frame, x, y, zoom` (the camera); `canvas_cx, canvas_cy` (camera center on the big
canvas); `view_w, view_h` (how much canvas it sees); `layer_scale, layer_x, layer_y` (scale % and center position to
give the canvas layer in a field-sized comp); `place_x, place_y, place_scale` (top-left corner and scale % for a
field-sized drawing made for that frame, placed on the big canvas: this is where a character layer goes).
The canvas is sized so the tightest zoom still has one canvas pixel per finished pixel.

`--images` reads the pan and zoom off the lines two key drawings share (the background) and says how sure it is:
good, shaky, or NOT reliable. It is fooled when a character fills the frame, and cannot read keys that share less
than about half a frame. When it is not "good", type `--key` numbers instead.

### value_check.py: silhouette and grayscale

    python value_check.py FRAME.png            -> FRAME_value.png (silhouette | grayscale), FRAME_silhouette.png
    python value_check.py FRAMES_FOLDER        -> FOLDER_value_sheet.png (original, silhouette, grayscale per frame), FOLDER_value.json
      [--mode auto|lines|tone|alpha] [--gap 4] [--threshold N] [--levels 3] [--edge auto|open]
      [--fill X,Y ...] [--clear X,Y ...] [--frames 1,5,9] [--each] [--out DIR]

Line art is filled by closing small gaps and blacking in whatever the outside paper cannot reach. Look at the result:
if the black leaked out, raise `--gap`; if a part of the figure stayed white or some background turned black, fix it
with `--fill X,Y` or `--clear X,Y` (full-size pixel of any point inside that patch), or `--edge open`. A body that
leaves the frame through one edge is filled automatically; one that leaves through a corner needs `--fill`.
For painted frames it also prints how far apart figure and background are in value (0 to 100; under 15 = look here).

### anatomy_guide.py: proportion and balance guide

It cannot find joints by itself. You (the Claude) place them:

    python anatomy_guide.py DRAWING.png --grid [--region x0,y0,x1,y1]     1. writes DRAWING_grid.png with a numbered pixel grid. Open it and read off the joints.
    python anatomy_guide.py --template human|cat|hand                     2. prints a blank landmark file (also in examples/anatomy_*.json). Fill in "points" as [x, y]; leave hidden ones null.
    python anatomy_guide.py DRAWING.png --landmarks POINTS.json [--model MODEL_POINTS.json] [--max-flags 6]

Out: `DRAWING_anatomy_guide.png` (transparent overlay: bones, joints, plumb line, numbered marks),
`DRAWING_anatomy_over.png` (overlay on the faded drawing with the notes written out), `DRAWING_anatomy.json`.

Checks. **human:** left limb against right, heads tall, shoulder tilt against hip tilt, line of action, weight over
the feet (set `"airborne": true` for jumps, or give `"support"` points when sitting or leaning). **cat** (side view):
elbow, knee and hock bending the right way, near legs against far legs, hind legs against front legs, weight between
the planted paws. **hand:** knuckles on one arc, finger length order, segments shortening toward the tip, wrist against
palm. Everything is measured against the drawing itself. `--model` adds "off model" checks against the same character
marked up on a model sheet. The results are only as good as the landmarks: use `--region` to zoom the grid on small
parts, and say so when a view (three-quarter, foreshortened) makes a check unreliable.

### lip_sync.py: a mouth shape for every frame

    python lip_sync.py LINE.wav [--text "the words spoken"] [--fps 24] [--start 1] [--on 2] [--mouths MOUTH_FOLDER]
                                [--recognizer phonetic] [--rough] [--out DIR]

Out: `LINE_lipsync.csv` (frame, time_s, mouth, shape, new, holds), `LINE_lipsync.png` (waveform with the mouth letter
under every frame), `LINE_lipsync.json`. With `--mouths` (a folder of the artist's own mouth drawings named `A.png` to
`F.png`, plus `G`, `H`, `X` if they exist): `LINE_mouths/0001.png ...` (her drawing for each frame, copied untouched)
and `LINE_lipsync_preview.gif`.

Mouth letters are Rhubarb's: A closed (M, B, P), B teeth together (most consonants, EE), C open (EH, AE), D wide open
(AA), E slightly rounded (AO, ER), F puckered (UW, OW, W), G teeth on lip (F, V), H tongue up (L), X at rest.
`--text` makes it noticeably more accurate. `--on 2` holds mouths for two frames but never drops a closed mouth.
Needs a WAV (other formats only if ffmpeg is installed). English by default; `--recognizer phonetic` for other
languages. Without Rhubarb, or with `--rough`, it guesses from loudness only and says so: fine for blocking, not final.

### tracker_update.py: one shot's row in the tracker spreadsheet

**Ask the artist where the tracker lives. Always `--show` first.**

    python tracker_update.py TRACKER.xlsx --show                      sheet, header row, columns, dropdown choices, shots
    python tracker_update.py TRACKER.xlsx --shot 012 --show           that shot's row
    python tracker_update.py TRACKER.xlsx --shot 012 --set "Status=Cleanup" --set "Frames=48" --append "Notes=arc fixed on f12"
      [--add] [--dry-run] [--in-place] [--out FILE] [--sheet NAME] [--key-column "Shot"] [--header-row N] [--force]

It finds the header row and the shot column itself, matches `--set` columns to the tracker's own headers, and fits the
value to the column (numbers, dates, the exact spelling of a dropdown choice). It refuses: a column the tracker does
not have, a value outside a dropdown, a shot listed twice, a formula cell (unless `--force`), an unknown shot (unless
`--add`, which adds a row under the last shot with the look, formulas and dropdown of the row above).

After saving it reloads the result and compares every cell of every sheet with the original. If anything outside that
one row differs, or a row is missing, it deletes the result and stops. So it cannot delete rows or overwrite other shots.

By default the tracker file is left alone and the result is a new file beside it (`NAME_updated.xlsx`, then
`_updated2`, ...). `--in-place` updates the tracker itself after putting a dated copy in `tracker_backups/` beside it.
Use whichever the artist asked for.

---

## How the tools pass work to each other

- `perspective_check.py` -> `_check.json` -> opens in the app (Perspective) and in `scene_render.py --camera`.
- App "Save scene" <-> `scene_render.py SCENE.json`.
- App Camera "Save move" -> `camera_move.py --json`. Both write the same CSV columns.
- App Value: clicks are shown as `--fill` / `--clear` flags to paste into `value_check.py`.
- App Timing x-sheet CSV and `lip_sync.py` CSV both count frames from 1 at the same fps, so the mouth column lines up
  with the x-sheet rows (`--start` shifts it when the line starts later in the shot).
- `motion_check.py` says where a breakdown is missing -> `inbetween.py` on those two frames.
- App Start -> Perspective, Timing, Value, Pose match, Redline, Storyboard: plain picture files (PDF panels, video frames), never the originals.
- `perspective_check.py` `_check.json` -> `redline.py --from-perspective` -> the marks JSON opens in the Redline tab,
  and the tab's saved marks open in `redline.py`. A Claude chat's marks go in through the tab's paste box.
- Everything the app saves through `serve.py` sits in `work/<shot>/` (shot file, copies of originals, numbered
  versions, exports), where the scripts can read it.

## Layout

    animation_app.html       the app's page: the markup, an import map for three.js, and the scripts below in order
    serve.py                 the app's local server (127.0.0.1:8765), saves into work/
    app/app.css              the app's styles
    app/js/*.js              classic scripts sharing globals, in page order:
        core.js              camera, props, rendering                (CORE block, twin of animtk/scene3d.py)
        cam-math.js          camera move math                        (CAM block, twin of animtk/cammove.py)
        value-math.js        silhouette and grayscale                (VAL block, twin of animtk/value.py)
        psd.js               the flattened picture out of a PSD      (PSD block, app only)
        lines.js             straight strokes, vanishing points      (LINES block; lines.py is a separate one)
        body-math.js         the Body 2D mannequin math              (BODY block, app only)
        helpers.js           $, $$, fileImage, PICS, download, the tab switcher
        shot.js              Store, the shot file, Vec layers, layerRows, BeforeAfter
        panels.js            storyboard panel finding                (PANELS block, app only)
        gif.js               GIF export                              (GIF block)
        perspective.js, timing.js, camera.js, value.js, body.js, start.js     one per tab
        persp3d.js           the 3D figure in Perspective: render through the Perspective camera, lens remap
        figure-tab.js        loads Figure 3D the first time its tab opens
        module-tabs.js       loads the ES module tabs (Pose match, Redline, Storyboard) the first time each opens: ModTabs.get(name)
    app/js/figure3d.mjs      the 3D figure (ES module): bodies, builds, looks, joints, IK, clips, snapshot
    app/js/figure-ui.mjs     the Figure 3D tab's controls (ES module)
    app/js/pose-tab.mjs      the Pose match tab (ES module): drawings, joints, flips, ghost layers, saving
    app/js/pose-fit.mjs      the pose fit: 2D joints to a 3D pose and camera, the ghost render
    app/js/redline-tab.mjs   the Redline tab (ES module), and parseDoc(), the twin of animtk/layers.normalize
    app/js/board-tab.mjs     the Storyboard tab (ES module): panels, holds, moves, the overhead map and its 180 line checks
    app/vendor/              three.js 0.186.1, pdf.js 3.11.174
    app/assets/figures/      the CC0 bodies and clips (licenses: app/assets/CREDITS.md)
    *.py                     the scripts above
    animtk/                  shared code
        imgio.py             loading and saving that never overwrites an input
        scene3d.py           camera, props, rendering        (mirrored in the app: CORE block)
        lines.py             line finding, vanishing points
        frames.py            ink masks, what moved between frames
        warp.py              point matching and thin-plate-spline bending
        cycles.py            cycle poses
        cammove.py           camera move math                (mirrored in the app: CAM block)
        value.py             silhouette and grayscale        (mirrored in the app: VAL block)
        anatomy.py           rigs and checks
        layers.py            the Vec overlay format drawn in Python (twin of Vec in app/js/shot.js)
    examples/                a sample scene, blank landmark files
    tests/                   see below
    samples/ out/ tools/ work/    git-ignored: artwork, results, Rhubarb, the app's working folder

Math that exists in both Python and the app is kept identical on purpose and tested against each other. If you change
one side, change the other and run the matching test. Tests find each app block by its `/*NAME-START*/ ...
/*NAME-END*/` markers through `tests/appsrc.mjs`, which pulls every `<script src="app/...">` into one string in page
order, so a block can move between files without breaking a test.

## Tests

None of them need artwork: they generate their own stand-ins into `tests/out/`.

    python tests/test_perspective.py     # vanishing points on generated rooms
    python tests/test_motion.py          # inbetween, motion_check, cycle_guide
    python tests/test_phase3.py          # camera_move, value_check, anatomy_guide
    python tests/test_phase4.py          # lip_sync (Rhubarb parts skip if it is not installed), tracker_update
    node tests/test_app_core.mjs         # app camera math equals Python
    node tests/test_app_ui.mjs           # Perspective mode in headless Chrome
    node tests/test_app_timing.mjs       # Timing mode
    node tests/test_app_camera.mjs       # Camera and Value modes, and their math against Python
    node tests/test_app_body.mjs         # Body mode: mannequin math, motions, balance, joint ranges, muscles, hands, feet, the three views
    node tests/test_app_frames.mjs       # PSD files, finding lines, checking a drawing, 1, 2 and 3 point grids, character height, a shot's frames
    python -P tests/test_serve.py        # serve.py: saves only into work/, never overwrites, refuses every way out, numbered versions
    node tests/test_app_start.mjs        # Start tab (uploads, PDF panels, video frames, routing) and the Perspective layer rows
    node tests/test_app_figure.mjs       # Figure 3D: bodies and builds, joint angle conventions, IK, mouse posing, limits, clips, pose files, pictures
    node tests/test_app_pose.mjs         # Pose match: the tab with a stand-in fit, then the real fit, then a round trip through a known camera
    python tests/test_redline.py         # redline.py: reading marks, numbered copies, --check, --from-perspective on a generated room
    node tests/test_app_redline.mjs      # Redline tab: paste, draw, drag, save; parseDoc vs normalize; Chrome vs Python pixels
    node tests/test_app_board.mjs        # Storyboard: the 180 line and screen direction math, size guess, cuts, moves, map, shot list, save and reload

The browser tests need `npm i puppeteer-core` (in `_scratch/` is fine; it drives the Chrome or Edge already installed).
`test_serve.py`, `test_app_start.mjs`, `test_app_figure.mjs`, `test_app_pose.mjs`, `test_app_redline.mjs` and `test_app_board.mjs` start `serve.py` on a free port
themselves, and each removes only the `work/_test_*` folders it made, so they can run at the same time.

## Known limits (say these out loud when they apply)

- Pose match: it fits the big joints only. Hands, fingers, the forearm's twist, the face and which way the head turns
  are not fitted (the head only tilts). Toward or away is a guess whenever a limb is foreshortened, and the note says
  so: check the ghost and flip. A stylized character (big head, short legs) is fitted with the adult figure's
  proportions, so its misses show the style, not a mistake. Tested on generated stick figures and the 3D figure itself,
  not yet on real drawings.
- Redline: Python and the app draw lines, arrows, shapes and fills to within 1% of the same pixels, but text uses
  whatever font each side has (Segoe UI Semibold here), so words can sit a pixel or two apart. `--from-perspective`
  only marks what the perspective check flags, so it inherits that check's limits (below).
- Storyboard: the shot size guess only sees where the biggest ink shape sits in the frame, not faces or bodies, so it
  is a starting point and says so. The 180 line and screen direction come from the overhead map she sets up, not from
  the drawings. Finding cuts in an animatic can split a shot at a fast move or a fade, and merge two very similar shots.
- Vanishing points: character linework can look like perspective. Trust the `_check.png`, not just the numbers.
- Find the lines for me (app): it only sees long, straight, fairly clean strokes (about 7% of the picture's diagonal or
  longer). Sketchy, curved or bowed lines are skipped, so a fisheye room has to be marked by hand. Arms, props and
  panel borders can line up by chance and pull a point off. It never gives depth + side + uprights at once; add the
  third by hand. Tested on generated rooms only, not yet on real boards.
- Check my drawing: it judges straight strokes against the vanishing points, nothing else. A stroke more than 9 degrees
  off is assumed to be about something else and is left alone.
- Check every frame: it compares where the finder puts the depth point, so a frame where the finder is fooled is
  flagged just like a real jump, and a frame with no clear depth point is only reported when its neighbours have one.
  It needs about five frames to tell one bad frame from a camera move.
- PSD: only the flattened picture saved inside the file (Photoshop: Maximize Compatibility on; Clip Studio and Procreate
  exports include it). 8 or 16 bit, RGB or grayscale. No layers, no CMYK, no PSB. A transparent background comes out black
  or white depending on the program that saved it.
- 3 point grids: three hand-placed points only fit a real lens when each pair can be 90 degrees apart (the triangle
  they make has no wide corner). When they cannot, the app says so and uses depth + side.
- Inbetweens: only close poses bend cleanly. Most key-to-key pairs get a guide, by design.
- Motion check and the timing chart measure ink, not meaning: a redrawn background reads as movement.
- Camera move from drawings: it follows whatever lines the two drawings share, which is the character if the character fills the frame.
- Silhouette of line art: which closed shapes are "figure" is a guess when the figure leaves the frame; check the picture.
- Anatomy: depends entirely on where the joints were placed. Foreshortening explains many flags.
- Body 2D: a flat side view. It cannot turn to face the camera, and the far arm hides behind the torso when it hangs
  (grab its dots). The joint ranges are for an average adult seen from the side, and a joint is never stopped, only
  flagged. The muscles are a cartoon of the real thing: one blob per group, driven by one or two joint angles. Hair,
  scarf and coat tail are simple chains with made-up weight; they pass in front of the body instead of wrapping round
  it. The hands are flat palm views (a curled finger is just drawn shorter) and cannot be posed. The other bodies in the
  proportion guide are for looking at: the motions only play on the adult. The library motions and every pose in them
  were planned by a Claude, not an animator, so treat them as a starting point to push. Balance uses average
  adult body weights, ignores anything being carried, and only knows front and back. In a walk it honestly reads "tipping"
  for much of each step, because walking is falling and catching. The line of action is a fitted curve: a guide to
  compare poses with, not a judgement.
- Figure 3D: needs `serve.py` (from a double-clicked file the tab only explains how to open it). The builds and the
  cartoon slider re-proportion the two CC0 bodies; they are not separate models. The mannequin bodies have no face. In
  Perspective the figure is drawn over the props (no hiding behind a cabinet yet), and past about 76 degrees from the
  lens centre (extreme fisheye corners) it is cut off. The joint ranges are for an average adult. Key pose marks
  are found from the feet and hips, so only walks and runs get them.
- Start: a page with no panel borders is split along its white gaps, a rougher guess, so panels with no gap between
  them come out as one box: check every box. A video gives at most 480 frames per pull, only in formats the browser
  can play.
- Lip sync: English recognition by default; a computer cannot hear acting, so treat the result as a first pass to adjust.
- Tracker: a save through this tool rebuilds charts (they can lose styling) and drops drawn shapes, text boxes,
  slicers and sparklines. It warns when the workbook has any, and refuses `--in-place` without `--force`.
