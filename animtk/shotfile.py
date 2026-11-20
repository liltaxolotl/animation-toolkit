"""
Shot files: the same work/<shot>/shot.json the app writes (app/js/shot.js), for scripts and for a Claude.

    from animtk import shotfile
    shot = shotfile.load('shot01')                 # None if there is no shot file yet
    shot = shot or shotfile.new('shot01', ['shot01.png'])
    shot['detections']['pose'] = {...}
    shotfile.save(shot)                            # only shot.json is ever replaced
    path = shotfile.next_version('shot01', 'shot01', 'edit')   # work/shot01/shot01_edit_v3.png (never an existing file)

Fields (same as newShot in app/js/shot.js): kind 'animtk-shot', version 1, name, created, help [..],
sources [{file, size, w, h}], detections {..}, layers [Vec layers], edits [..], notes [..].
"""
import datetime
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.path.join(ROOT, 'work')


def safe(name):
    """The folder-safe shot name, exactly as Store.safe in the app makes it."""
    s = re.sub(r'\.[^.]+$', '', str(name or 'shot'))
    s = re.sub(r'[^A-Za-z0-9 _.\-()]+', '_', s).strip(' .')[:80]
    return s or 'shot'


def folder(shot):
    return os.path.join(WORK, safe(shot))


def new(name, sources=()):
    return {'kind': 'animtk-shot', 'version': 1, 'name': safe(name),
            'created': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'help': [],
            'sources': [{'file': os.path.basename(s), 'size': os.path.getsize(s) if os.path.exists(s) else None, 'w': None, 'h': None}
                        for s in sources],
            'detections': {}, 'layers': [], 'edits': [], 'notes': []}


def load(shot):
    p = os.path.join(folder(shot), 'shot.json')
    if not os.path.exists(p):
        return None
    with open(p, encoding='utf-8') as f:
        return json.load(f)


def save(obj):
    """Writes work/<name>/shot.json (the one file in work/ that may be replaced)."""
    d = folder(obj['name'])
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, 'shot.json')
    tmp = p + '.%d.part' % os.getpid()
    with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(obj, f, indent=1)
    os.replace(tmp, p)
    return p


def next_version(shot, base, tag, ext='png'):
    """work/<shot>/<base>_<tag>_vN.<ext> with N one past the highest that exists."""
    d = folder(shot)
    os.makedirs(d, exist_ok=True)
    rx = re.compile('^' + re.escape(safe(base)) + '_' + re.escape(tag) + r'_v(\d+)\.' + re.escape(ext) + '$', re.I)
    n = max([int(m.group(1)) for m in (rx.match(f) for f in os.listdir(d)) if m] or [0])
    return os.path.join(d, '%s_%s_v%d.%s' % (safe(base), tag, n + 1, ext))
