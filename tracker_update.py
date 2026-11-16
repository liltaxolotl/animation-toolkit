"""
tracker_update.py
Updates ONE shot's row in a shot tracker spreadsheet (.xlsx), using the tracker's own columns and
formatting. It never deletes a row, never touches another shot's row, and proves that before it keeps
the result. It never invents columns: a column that is not already in the tracker is an error.

ASK THE ARTIST WHERE THE TRACKER LIVES before the first use, and look at it with --show first.

    python tracker_update.py TRACKER.xlsx --show                       what is in it: sheet, columns, allowed values, shots
    python tracker_update.py TRACKER.xlsx --shot 012 --show            one shot's row
    python tracker_update.py TRACKER.xlsx --shot 012 --set "Status=Cleanup" --set "Frames=48" --append "Notes=arc fixed on f12"
      [--add] [--sheet NAME] [--key-column "Shot"] [--header-row N] [--dry-run] [--in-place] [--out FILE] [--force]

  --shot      which shot. Matched against the shot column; 12 finds 012.
  --set       "Column=Value". The column is matched to an existing header (case and spaces do not matter).
              The value is fitted to the column: numbers stay numbers, dates stay dates (2026-12-01, 12/1/2026
              or "today"), and if the column has a dropdown list the value must be one of its choices.
              "Column=" with nothing after it empties the cell.
  --append    "Column=text": adds the text to what is already in the cell (on a new line) instead of replacing it
  --add       if the shot is not in the tracker, add it as a new row under the last shot, copying the
              look, formulas and dropdowns of the row above. Without --add an unknown shot is an error.
  --dry-run   say what would change and save nothing
  --in-place  update the tracker file itself. A dated copy of the file as it was goes into a
              tracker_backups folder beside it first. Without this flag the tracker is left alone and the
              result is saved as a NEW file beside it: <name>_updated.xlsx (then _updated2, ...).
  --force     allow replacing a formula cell, or (with --in-place) saving a workbook that holds things
              this tool cannot carry over

What it keeps: cell styles, number formats, column widths, merged cells, frozen panes, dropdowns,
conditional formatting, other sheets. What a save cannot carry over cleanly (it warns, and refuses
--in-place without --force): charts (rebuilt, can lose styling), drawn shapes, text boxes, slicers
and sparklines.
"""
import argparse, datetime, os, re, shutil, sys, zipfile
from copy import copy
import openpyxl
from openpyxl.formula.translate import Translator
from openpyxl.utils import get_column_letter, range_boundaries

KEY_NAMES = re.compile(r'^(shot|shots|shot ?(#|no|no\.|number|num|id|name|code)|sh|sc|scene|scene ?(#|no|no\.|number)|#)$', re.I)
norm = lambda s: re.sub(r'[^a-z0-9#]+', '', str(s).lower())

def die(msg): raise SystemExit('tracker_update: ' + msg)

def key_of(v):
    """a shot id in a comparable form: '012', 12 and 12.0 are the same shot; 'SH_012' is itself"""
    if v is None: return None
    s = str(v).strip().lower()
    if not s: return None
    try: return ('n', float(s))
    except ValueError: return ('s', s)

def find_header(ws, header_row=None, key_column=None):
    """(header row number, {column index: header text}, key column index)"""
    best = None
    rows = [header_row] if header_row else range(1, min(ws.max_row, 30) + 1)
    for r in rows:
        heads = {c.column: str(c.value).strip() for c in ws[r] if isinstance(c.value, str) and c.value.strip()}
        if len(heads) < 2: continue
        if key_column: keys = [c for c, h in heads.items() if norm(h) == norm(key_column)]
        else: keys = [c for c, h in heads.items() if KEY_NAMES.match(h.strip())]
        score = len(heads) + (100 if keys else 0)
        if best is None or score > best[0]: best = (score, r, heads, keys[0] if keys else None)
        if keys and not header_row: break
    if not best: return None
    _, r, heads, key = best
    if key is None:
        if key_column: die('no column called "%s". Columns are: %s' % (key_column, ', '.join(heads.values())))
        key = min(heads)                                           # no column is plainly the shot column: take the first one
    return r, heads, key

def pick_sheet(wb, name=None, header_row=None, key_column=None):
    if name:
        m = [s for s in wb.sheetnames if s.lower() == name.lower()]
        if not m: die('no sheet called "%s". Sheets are: %s' % (name, ', '.join(wb.sheetnames)))
        ws = wb[m[0]]; h = find_header(ws, header_row, key_column)
        if not h: die('could not find a header row in sheet "%s". Point at it with --header-row N.' % ws.title)
        return ws, h
    found = []
    for ws in [wb.active] + [s for s in wb.worksheets if s is not wb.active]:
        if ws.sheet_state != 'visible' and len(wb.worksheets) > 1: continue
        h = find_header(ws, header_row, key_column)
        if h: found.append((ws, h))
    if not found: die('could not find a header row in any sheet. Use --sheet and --header-row.')
    named = [f for f in found if KEY_NAMES.match(f[1][1][f[1][2]].strip())]
    return (named or found)[0]

def shot_rows(ws, hrow, key):
    """[(row number, key value)] for every row under the header that has something in the shot column"""
    return [(r, ws.cell(r, key).value) for r in range(hrow + 1, ws.max_row + 1) if key_of(ws.cell(r, key).value) is not None]

def match_column(heads, name):
    n = norm(name); exact = [c for c, h in heads.items() if norm(h) == n]
    if len(exact) == 1: return exact[0]
    if len(exact) > 1: die('more than one column is called "%s" (columns %s). Rename one in the tracker first.' % (name, ', '.join(get_column_letter(c) for c in exact)))
    close = [c for c, h in heads.items() if norm(h).startswith(n) or n in norm(h)]
    if len(close) == 1: return close[0]
    die('no column called "%s". This tool only fills columns the tracker already has: %s' % (name, ', '.join(heads.values())))

def allowed_values(ws, cell):
    """choices of the dropdown on this cell, or None when it has no dropdown"""
    for dv in ws.data_validations.dataValidation:
        if dv.type != 'list' or cell.coordinate not in dv.sqref: continue
        f = (dv.formula1 or '').strip()
        if f.startswith('"') and f.endswith('"'): return [v.strip() for v in f[1:-1].split(',')]
        try:
            f = f.lstrip('='); sheet = ws
            if '!' in f: sn, f = f.rsplit('!', 1); sheet = ws.parent[sn.strip("'")]
            c0, r0, c1, r1 = range_boundaries(f.replace('$', ''))
            return [str(sheet.cell(r, c).value) for r in range(r0, r1 + 1) for c in range(c0, c1 + 1) if sheet.cell(r, c).value is not None]
        except Exception: return None
    return None

def parse_date(text):
    t = text.strip().lower()
    if t == 'today': return datetime.date.today()
    for fmt in ('%Y-%m-%d', '%m/%d/%Y', '%m/%d/%y', '%d %b %Y', '%b %d %Y', '%B %d %Y', '%b %d, %Y', '%B %d, %Y'):
        try: return datetime.datetime.strptime(text.strip(), fmt).date()
        except ValueError: pass
    return None

def fit_value(ws, cell, text, rows, notes, head):
    """turn typed text into the kind of value this column holds"""
    if text == '': return None
    choices = allowed_values(ws, cell)
    if choices is not None:
        m = [c for c in choices if c.lower() == text.lower()]
        if not m: die('"%s" is not one of the choices for %s. Choices: %s' % (text, head, ', '.join(choices)))
        return m[0]
    samples = [cell.value] + [ws.cell(r, cell.column).value for r, _ in rows if r != cell.row]
    samples = [v for v in samples if v is not None and not (isinstance(v, str) and v.startswith('='))]
    kinds = [type(v) for v in samples]
    if samples and all(isinstance(v, (datetime.date, datetime.datetime)) for v in samples):
        d = parse_date(text)
        if d is None: die('%s holds dates, and "%s" does not read as one. Use 2026-12-01, 12/1/2026 or today.' % (head, text))
        return datetime.datetime(d.year, d.month, d.day) if kinds and kinds[0] is datetime.datetime else d
    if samples and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in samples):
        try: f = float(text); return int(f) if f == int(f) and '.' not in text else f
        except ValueError: notes.append('%s holds numbers everywhere else; "%s" was written as text.' % (head, text)); return text
    strs = sorted({v.strip() for v in samples if isinstance(v, str) and v.strip()})
    same = [v for v in strs if v.lower() == text.lower()]
    if same: return same[0]                                         # keep the spelling the tracker already uses
    if 1 < len(strs) <= 8 and len(samples) >= 5 and len(strs) <= len(samples) * 0.6: notes.append('"%s" is a new value for %s. The tracker so far uses: %s' % (text, head, ', '.join(strs)))
    return text

def unsupported(path):
    """things in the workbook file that a save through this tool cannot carry over"""
    with zipfile.ZipFile(path) as z: names = z.namelist(); found = []
    if any(n.startswith('xl/drawings/') and n.endswith('.xml') for n in names):
        with zipfile.ZipFile(path) as z:
            body = b''.join(z.read(n) for n in names if n.startswith('xl/drawings/drawing') and n.endswith('.xml'))
        if b'<xdr:sp' in body or b'<xdr:cxnSp' in body: found.append('drawn shapes or text boxes')
    if any(n.startswith('xl/charts/') for n in names): found.append('charts (they get rebuilt and can lose styling)')
    if any('slicer' in n for n in names): found.append('slicers')
    if any(n.startswith('xl/worksheets/sheet') for n in names):
        with zipfile.ZipFile(path) as z:
            if any(b'sparklineGroup' in z.read(n) for n in names if n.startswith('xl/worksheets/sheet') and n.endswith('.xml')): found.append('sparklines')
    if any(n.endswith('vbaProject.bin') for n in names) and not path.lower().endswith('.xlsm'): found.append('macros')
    return found

def snapshot(path, skip=None):
    """every cell of every sheet as {sheet: {(row, col): value}}, formulas as text. skip = (sheet, row) to leave out."""
    wb = openpyxl.load_workbook(path); snap = {}
    for ws in wb.worksheets:
        cells = {}
        for row in ws.iter_rows():
            for c in row:
                if c.value is not None and not (skip and ws.title == skip[0] and c.row == skip[1]): cells[(c.row, c.column)] = c.value
        snap[ws.title] = dict(cells=cells, rows=ws.max_row, merged=sorted(str(m) for m in ws.merged_cells.ranges))
    return snap

def next_free(path):
    stem, ext = os.path.splitext(path); m = re.search(r'_updated(\d*)$', stem); base = stem[:m.start()] if m else stem; n = (int(m.group(1) or 1) + 1) if m else 1
    while True:
        p = '%s_updated%s%s' % (base, '' if n == 1 else n, ext)
        if not os.path.exists(p): return p
        n += 1

def show(ws, hrow, heads, key, rows, shot_row=None):
    print('sheet "%s", header on row %d, shot column: %s (%s), %d shots' % (ws.title, hrow, heads[key], get_column_letter(key), len(rows)))
    if shot_row:
        for c in sorted(heads): print('  %-22s %s' % (heads[c] + ':', '' if ws.cell(shot_row, c).value is None else ws.cell(shot_row, c).value))
        return
    probe = rows[0][0] if rows else hrow + 1
    for c in sorted(heads):
        ch = allowed_values(ws, ws.cell(probe, c)); vals = [ws.cell(r, c).value for r, _ in rows]; f = sum(1 for v in vals if isinstance(v, str) and v.startswith('='))
        kind = 'formula, leave it alone' if rows and f > len(rows) / 2 else 'dropdown: ' + ', '.join(ch) if ch else ''
        print('  %s  %-22s %s' % (get_column_letter(c).rjust(2), heads[c], kind))
    print('shots: ' + ', '.join(str(k) for _, k in rows[:60]) + (' ...' if len(rows) > 60 else ''))

def main(argv=None):
    ap = argparse.ArgumentParser(description="Update one shot's row in the shot tracker (.xlsx).")
    ap.add_argument('tracker'); ap.add_argument('--shot'); ap.add_argument('--set', action='append', default=[]); ap.add_argument('--append', action='append', default=[])
    ap.add_argument('--add', action='store_true'); ap.add_argument('--show', action='store_true'); ap.add_argument('--sheet'); ap.add_argument('--key-column'); ap.add_argument('--header-row', type=int)
    ap.add_argument('--dry-run', action='store_true'); ap.add_argument('--in-place', action='store_true'); ap.add_argument('--out'); ap.add_argument('--force', action='store_true')
    a = ap.parse_args(argv); path = a.tracker
    if not os.path.isfile(path): die('no such file: %s. Ask where the tracker lives.' % path)
    if not path.lower().endswith(('.xlsx', '.xlsm')): die('the tracker has to be an .xlsx file (a Google Sheet can be downloaded as one).')
    wb = openpyxl.load_workbook(path, keep_vba=path.lower().endswith('.xlsm'))
    ws, (hrow, heads, key) = pick_sheet(wb, a.sheet, a.header_row, a.key_column); rows = shot_rows(ws, hrow, key)
    target = None
    if a.shot is not None:
        hits = [r for r, k in rows if key_of(k) == key_of(a.shot)]
        if len(hits) > 1: die('shot %s is in the tracker %d times (rows %s). Fix that in the tracker first.' % (a.shot, len(hits), ', '.join(map(str, hits))))
        target = hits[0] if hits else None
    if a.show:
        if a.shot is not None and target is None: die('shot %s is not in the tracker. Shots: %s' % (a.shot, ', '.join(str(k) for _, k in rows[:60])))
        show(ws, hrow, heads, key, rows, target); return 0
    if a.shot is None: die('say which shot with --shot, or use --show to look at the tracker.')
    edits = [(t, False) for t in a.set] + [(t, True) for t in a.append]
    if not edits and not a.add: die('nothing to do: give --set "Column=Value" (or --append, or --add).')
    for t, _ in edits:
        if '=' not in t: die('write changes as "Column=Value" (got "%s").' % t)
    notes = []; changes = []; added = False
    if target is None:
        if not a.add: die('shot %s is not in the tracker (shots: %s). Use --add to add it as a new row.' % (a.shot, ', '.join(str(k) for _, k in rows[:40])))
        last = rows[-1][0] if rows else hrow; target = last + 1
        if any(ws.cell(target, c).value is not None for c in range(1, ws.max_column + 1)): die('row %d, right under the last shot, is not empty, so a new shot cannot be added safely. Add the row in the spreadsheet first.' % target)
        if any(ws.cell(r, c).value is not None for r in range(target + 1, min(ws.max_row, target + 3) + 1) for c in range(1, ws.max_column + 1)): notes.append('there is something just below the new row (a totals line?). Check that it still covers the new shot.')
        if rows:                                                    # dress the new row like the one above it
            for c in range(1, ws.max_column + 1):
                src, dst = ws.cell(last, c), ws.cell(target, c)
                if src.has_style: dst._style = copy(src._style)
                if isinstance(src.value, str) and src.value.startswith('='): dst.value = Translator(src.value, origin=src.coordinate).translate_formula(dst.coordinate)
                for dv in ws.data_validations.dataValidation:
                    if src.coordinate in dv.sqref and dst.coordinate not in dv.sqref: dv.add(dst)
            if ws.row_dimensions[last].height: ws.row_dimensions[target].height = ws.row_dimensions[last].height
        kc = ws.cell(target, key); sample = rows[-1][1] if rows else None
        kc.value = a.shot if isinstance(sample, str) or sample is None else (int(float(a.shot)) if key_of(a.shot)[0] == 'n' else a.shot)
        added = True; changes.append((heads[key], None, kc.value)); rows = rows + [(target, kc.value)]
    for text, append in edits:
        name, val = text.split('=', 1); col = match_column(heads, name.strip()); cell = ws.cell(target, col); head = heads[col]; val = val.strip()
        if col == key and not added: die('this tool does not rename shots. Change the shot column by hand.')
        for m in ws.merged_cells.ranges:
            if cell.coordinate in m and cell.coordinate != m.start_cell.coordinate: die('%s on this row is part of a merged block (%s). Edit that by hand.' % (head, m))
        old = cell.value
        if isinstance(old, str) and old.startswith('=') and not a.force: die('%s on this row is a formula (%s). It works itself out; use --force to replace it anyway.' % (head, old))
        if append:
            new = val if old in (None, '') else '%s\n%s' % (old, val)
            if old not in (None, ''): al = copy(cell.alignment); al.wrap_text = True; cell.alignment = al
        else: new = fit_value(ws, cell, val, rows, notes, head)
        if new != old: cell.value = new; changes.append((head, old, new))
    label = 'shot %s (row %d of "%s")' % (ws.cell(target, key).value, target, ws.title)
    if not changes: print('%s already says that. Nothing to change.' % label); return 0
    print(('WOULD CHANGE ' if a.dry_run else 'new row for ' if added else '') + label + ':')
    for head, old, new in changes: print('  %s: %s -> %s' % (head, '(empty)' if old in (None, '') else repr(old) if isinstance(old, str) else old, '(empty)' if new is None else repr(new) if isinstance(new, str) else new))
    for n in notes: print('  note: ' + n)
    if a.dry_run: print('dry run: nothing saved.'); return 0

    lossy = unsupported(path)
    if lossy: print('  WARNING: this workbook has %s, which a save through this tool cannot carry over.' % ' and '.join(lossy))
    before = snapshot(path, (ws.title, target))
    if a.in_place:
        if lossy and not a.force: die('not updating in place, because the %s would be lost. Leave off --in-place to get a separate file, or add --force.' % ' and '.join(lossy))
        if os.path.exists(os.path.join(os.path.dirname(os.path.abspath(path)), '~$' + os.path.basename(path))): die('the tracker looks open in Excel. Close it there first.')
        bdir = os.path.join(os.path.dirname(os.path.abspath(path)), 'tracker_backups'); os.makedirs(bdir, exist_ok=True)
        stem, ext = os.path.splitext(os.path.basename(path)); backup = os.path.join(bdir, '%s_%s%s' % (stem, datetime.datetime.now().strftime('%Y%m%d-%H%M%S'), ext))
        shutil.copy2(path, backup); out = path; tmp = path + '.saving' + ext
    else:
        out = a.out or next_free(path); backup = None; tmp = out
        if os.path.abspath(out) == os.path.abspath(path): die('--out is the tracker itself. Use --in-place if that is what you mean.')
        if os.path.exists(out): die('%s already exists. Pick another --out name.' % out)
    try: wb.save(tmp)
    except PermissionError: die('could not write %s. Is it open in Excel?' % tmp)
    # proof: apart from this one row, every cell of every sheet is exactly what it was, and no row is gone
    after = snapshot(tmp, (ws.title, target)); bad = []
    for sheet, b in before.items():
        if sheet not in after: bad.append('sheet "%s" is missing' % sheet); continue
        x = after[sheet]
        if x['rows'] < b['rows']: bad.append('sheet "%s" lost rows' % sheet)
        if x['merged'] != b['merged']: bad.append('merged cells changed in "%s"' % sheet)
        diff = [k for k in set(b['cells']) | set(x['cells']) if b['cells'].get(k) != x['cells'].get(k)]
        if diff: bad.append('%d cells outside the shot row changed in "%s" (first: %s%d)' % (len(diff), sheet, get_column_letter(sorted(diff)[0][1]), sorted(diff)[0][0]))
    if bad:
        os.remove(tmp); die('STOPPED, nothing was kept, because the result did not match the original outside this shot: ' + '; '.join(bad))
    if a.in_place: os.replace(tmp, out)
    print('checked: every other row and sheet is unchanged (%d cells compared).' % sum(len(b['cells']) for b in before.values()))
    print('saved: ' + out + ('   (the tracker as it was: %s)' % backup if backup else '   (a new file; the tracker itself is untouched)'))
    return 0

if __name__ == '__main__':
    sys.exit(main())
