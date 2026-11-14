# animation-toolkit

Tools for 2D animation boards and frames (PNG, 3840x1920 canvas; frame sequences are numbered PNGs in a folder).
One offline app plus Python scripts a Claude can run on drawings.

**Status: phases 1 and 2 of 4 are built (perspective, timing, inbetweens, motion check, cycles).**
Camera, value, anatomy, lip sync and the tracker come next. This README gets its full "learn it in one read"
version in phase 4.

## Rules the tools follow

- Originals are never edited or overwritten. Every output is a new file in an `out/` folder.
- Guides and warps only. Nothing here redraws linework.
- Artwork, frames, audio and spreadsheets are git-ignored. Never commit them: this repo is public.

## Setup

    pip install -r requirements.txt

Python 3.10+. The app needs nothing: open `animation_app.html` in a browser.

## What is here now

| Tool | What it does |
|---|---|
| `animation_app.html` | **Perspective mode:** upload a board, drag lines to find vanishing points and the horizon, lens sliders (Dutch tilt, fisheye, lens width, stylized skew) with one-click looks, 3D blockout props, transparent guide PNG export. **Timing mode:** load a frame sequence, play at 24 fps on 1s/2s with a hold per drawing, onion skin, key/breakdown/inbetween marks, timing chart, audio waveform with accents, x-sheet CSV and preview GIF export. |
| `perspective_check.py` | Finds straight lines on a board, groups them into vanishing points, finds the horizon, flags lines that miss. |
| `scene_render.py` | Renders a 3D blockout scene (JSON) through a virtual camera: clean reference + transparent guide. |
| `inbetween.py` | Inbetweens by bending the real linework of two keys (thin-plate spline) along a path with ease in/out. Writes a placement guide instead when the poses are too different to bend. |
| `motion_check.py` | Reviews a frame sequence: arcs, spacing, pops, size changes, missing breakdowns. Annotated contact sheet. |
| `cycle_guide.py` | Stick-skeleton reference for cycles, sized to the character. Cat walk so far. |
| `animtk/` | Shared code: camera and props (`scene3d.py`), lines and vanishing points (`lines.py`), frame measuring (`frames.py`), matching and warping (`warp.py`), cycles (`cycles.py`), safe file handling (`imgio.py`). |

## Commands

    python perspective_check.py BOARD.png [--out DIR] [--region x0,y0,x1,y1] [--ignore x0,y0,x1,y1] [--pick N] [--fov 60]
        -> BOARD_check.png (look at this first), BOARD_guide.png (transparent), BOARD_check.json

    python scene_render.py SCENE.json [--out DIR] [--board BOARD.png] [--camera CHECK_OR_APP.json] [--wobble]
        -> SCENE_reference.png, SCENE_guide.png (transparent), SCENE_over_board.png (with --board)

    python inbetween.py KEY_A.png KEY_B.png [-n 1] [--ease inout|in|out|linear] [--at 0.33,0.66] [--arc dx,dy]
                        [--source nearest|a|b] [--region x0,y0,x1,y1] [--force] [--guide-only] [--out DIR]
        -> A_B_inb01.png ... (only when the bend is clean), A_B_guide.png (transparent), A_B_preview.png, A_B_report.json
        prints WARPED or GUIDE ONLY with the reason

    python motion_check.py FRAMES_FOLDER [--region ...] [--ignore ...] [--all-ink] [--max-flags 6] [--out DIR]
        -> FOLDER_motion.png (contact sheet with marks, path, spacing chart), FOLDER_motion.json

    python cycle_guide.py cat_walk [--frames 12] [--match CHARACTER.png --region x0,y0,x1,y1] [--length PX]
                                   [--at X,GROUND_Y] [--facing right|left] [--travel] [--out DIR]
        -> cat_walk_01.png ... (transparent, canvas size), cat_walk_sheet.png, cat_walk.json

Default output folders: `out/<tool>/...`. Every script prints a short summary and the files it saved.

### Reading the results

- `perspective_check.py` reads every long straight stroke, so arms and props can pull it off. Look at `_check.png`
  before trusting the numbers. Groups with little ink behind them are drawn thin and named "maybe 1", "maybe 2":
  if the picture shows one is the real thing, rerun with `--pick` and its number. Mask characters with `--ignore`.
  On a board that is mostly characters, mark the perspective by hand in the app instead.
- `inbetween.py` only bends strokes that move; lines that hold still are left exactly as they are. It decides
  by bending key A all the way to key B and checking the result. It refuses (guide only) when lines do not land,
  when parts would stretch or squash too far, or when the bend folds over. Storyboard beats usually get the guide;
  close poses of the same drawing get the warp.
- `motion_check.py` only sees where ink is. Every flag means "look here". On key poses or boards it says so and
  marks just the biggest jumps, because arcs and spacing need drawings that flow into each other.

Scene JSON format: see the top of `scene_render.py`, and `examples/`. The app's "Save scene" writes the
same format, and the app loads a `_check.json` too, so the three perspective tools pass work between each other.

### Adding a cycle

Write a `pose(phase, near)` function in `animtk/cycles.py` that returns a `Pose` (joints, bones, feet down), and
add it to `CYCLES`. The drawing, sizing, contact sheet and JSON come for free. See the notes at the top of that file.

## Tests

    python tests/test_perspective.py     # generated rooms
    python tests/test_motion.py          # inbetween, motion_check, cycle_guide on generated drawings
    node tests/test_app_core.mjs         # app camera math matches the Python library
    node tests/test_app_ui.mjs           # perspective mode in headless Chrome (needs: npm i puppeteer-core)
    node tests/test_app_timing.mjs       # timing mode in headless Chrome, generated frames and sound

None of the tests need artwork.
