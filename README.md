# animation-toolkit

Tools for hand-drawn 2D animation: perspective, timing, inbetweens, camera moves, lip sync, value and
anatomy checks, and a shot tracker updater. One offline app for the artist, plus Python scripts a Claude
(or anyone) can run on boards and frames.

**If you are a Claude: this page is the whole manual. Read it once, then use the tools.**

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
   every image, audio, video and spreadsheet type plus `samples/`, `out/`, `tools/`. Do not force-add past it.
5. **Ask the artist before pushing**, and ask where the shot tracker lives before touching it.

## Setup

    pip install -r requirements.txt        # numpy, opencv-python, pillow, scipy, openpyxl  (Python 3.10+)
    python lip_sync.py --setup             # only for lip sync: downloads Rhubarb Lip Sync into tools/rhubarb (about 90 MB)

The app needs nothing installed: open `animation_app.html` in Chrome or Edge. It works offline and no file leaves the computer.

## Which tool for which job

| The artist says | Use |
|---|---|
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
| "Show me how a body bends / let me pose a figure and time it" | Body mode in the app |
| "How many heads tall is a kid / a chibi?" / "what does a walk, sneak, run, jump look like?" / "show me a hand gripping" | Body mode in the app (Proportions, the motion library, Hands and feet) |
| "Mark shot 12 as cleaned up" | `tracker_update.py` |

Every script prints a short plain summary and the list of files it saved. Run any script with `-h`, or read the
comment at the top of the file, for every option.

---

## The app: `animation_app.html`

One self-contained file, five tabs. Load files with the buttons or by dragging them onto the picture. Every tab that
takes pictures takes PNG, JPG and PSD (the flattened picture inside the PSD; layers are not read).

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
- Guide layers (tick boxes): horizon, vanishing points, floor grid, depth lines, uprights (walls), props, my drawn
  lines. Exports a transparent guide PNG at full canvas size, and saves or loads a scene JSON (the same format
  `scene_render.py` reads; it also opens the `_check.json` from `perspective_check.py`).

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

**Body.** A posable side-view mannequin for anatomy and body mechanics. Three views, picked above the picture:
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

---

## The scripts

### perspective_check.py: vanishing points, horizon, lines that miss

    python perspective_check.py BOARD.png [--region x0,y0,x1,y1] [--ignore x0,y0,x1,y1] [--pick N] [--fov 60] [--out DIR]

Out: `BOARD_check.png` (look at this first), `BOARD_guide.png` (transparent guide), `BOARD_check.json`.

It reads every long straight stroke, so arms and props can pull it off. Groups with little ink behind them are drawn
thin and named "maybe 1", "maybe 2": if the picture shows one is real, rerun with `--pick` and its number. Mask
characters with `--ignore`. On a board that is mostly characters, mark the perspective by hand in the app instead.

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

## Layout

    animation_app.html       the app (plain HTML and JavaScript, no build step)
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
    (app only: BODY block)   the mannequin math for Body mode, no Python twin
    (app only: PSD block)    reads the flattened picture out of a Photoshop file
    (app only: LINES block)  finds straight strokes and vanishing points in the browser (lines.py is the Python one; they are separate)
    examples/                a sample scene, blank landmark files
    tests/                   see below
    samples/ out/ tools/     git-ignored: artwork, results, Rhubarb

Math that exists in both Python and the app is kept identical on purpose and tested against each other. If you change
one side, change the other and run the matching test.

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

The five browser tests need `npm i puppeteer-core` (it drives the Chrome or Edge already installed).

## Known limits (say these out loud when they apply)

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
- Body mode: a flat side view. It cannot turn to face the camera, and the far arm hides behind the torso when it hangs
  (grab its dots). The joint ranges are for an average adult seen from the side, and a joint is never stopped, only
  flagged. The muscles are a cartoon of the real thing: one blob per group, driven by one or two joint angles. Hair,
  scarf and coat tail are simple chains with made-up weight; they pass in front of the body instead of wrapping round
  it. The hands are flat palm views (a curled finger is just drawn shorter) and cannot be posed. The other bodies in the
  proportion guide are for looking at: the motions only play on the adult. The library motions and every pose in them
  were planned by a Claude, not an animator, so treat them as a starting point to push. Balance uses average
  adult body weights, ignores anything being carried, and only knows front and back. In a walk it honestly reads "tipping"
  for much of each step, because walking is falling and catching. The line of action is a fitted curve: a guide to
  compare poses with, not a judgement.
- Lip sync: English recognition by default; a computer cannot hear acting, so treat the result as a first pass to adjust.
- Tracker: a save through this tool rebuilds charts (they can lose styling) and drops drawn shapes, text boxes,
  slicers and sparklines. It warns when the workbook has any, and refuses `--in-place` without `--force`.
