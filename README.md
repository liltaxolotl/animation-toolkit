# animation-toolkit

Tools for 2D animation boards and frames (PNG, 3840x1920 canvas; frame sequences are numbered PNGs in a folder).
One offline app plus Python scripts a Claude can run on drawings.

**Status: phase 1 of 4 is built (perspective).** Timing, camera, value, anatomy, lip sync and the tracker come next.
This README gets its full "learn it in one read" version in phase 4.

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
| `animation_app.html` | Perspective mode: upload a board, drag lines to find vanishing points and the horizon, lens sliders (Dutch tilt, fisheye, lens width, stylized skew), 3D blockout props, transparent guide PNG export. |
| `perspective_check.py` | Finds straight lines on a board, groups them into vanishing points, finds the horizon, flags lines that miss. |
| `scene_render.py` | Renders a 3D blockout scene (JSON) through a virtual camera: clean reference + transparent guide. |
| `animtk/` | Shared code: camera and props (`scene3d.py`), line and vanishing point finding (`lines.py`), safe file handling (`imgio.py`). |

## Commands

    python perspective_check.py BOARD.png [--out out/perspective_check] [--region x0,y0,x1,y1] [--ignore x0,y0,x1,y1] [--fov 60]
        -> BOARD_check.png (look at this first), BOARD_guide.png (transparent), BOARD_check.json

    python scene_render.py SCENE.json [--out out/scene_render] [--board BOARD.png] [--camera CHECK_OR_APP.json] [--wobble]
        -> SCENE_reference.png, SCENE_guide.png (transparent), SCENE_over_board.png (with --board)

`perspective_check.py` reads every long straight stroke, so arms and props can pull it off. Look at
`_check.png` before trusting the numbers, and use `--region` or `--ignore` to keep it on the background.
On a board that is mostly characters, mark the perspective by hand in the app instead.

Scene JSON format: see the top of `scene_render.py`, and `examples/`. The app's "Save scene" writes the
same format, and the app loads a `_check.json` too, so the three tools pass work between each other.

## Tests

    python tests/test_perspective.py     # generated rooms, no artwork needed
    node tests/test_app_core.mjs         # app camera math matches the Python library
    node tests/test_app_ui.mjs           # drives the app in headless Chrome (needs: npm i puppeteer-core)
