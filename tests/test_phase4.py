"""
Checks lip_sync.py and tracker_update.py on generated stand-ins (no voice line or real tracker needed).
    python tests/test_phase4.py
The Rhubarb parts are skipped, and say so, when Rhubarb is not installed (python lip_sync.py --setup).
"""
import os, sys, json, csv, subprocess, hashlib, datetime, shutil
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, root); os.chdir(root)
import numpy as np
from PIL import Image
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import CellIsRule
import lip_sync as LS

out = os.path.join(root, 'tests', 'out'); fails = 0; skipped = 0
def check(name, ok, detail=''):
    global fails
    if ok and len(str(detail).splitlines()) > 1: detail = ''
    print(('PASS  ' if ok else 'FAIL  ') + name + ('  ' + str(detail) if detail != '' else '')); fails += 0 if ok else 1
def run(*args): return subprocess.run([sys.executable] + list(args), capture_output=True, text=True, cwd=root)
md5 = lambda p: hashlib.md5(open(p, 'rb').read()).hexdigest()

# ------------------------------------------------------------------ lip sync
subprocess.run([sys.executable, os.path.join('tests', 'make_voice_sample.py')], capture_output=True, cwd=root)
lip = os.path.join(out, 'lip'); T = json.load(open(os.path.join(lip, 'truth.json'))); lo = os.path.join(lip, 'out'); shutil.rmtree(lo, ignore_errors=True)
res, files = LS.run(os.path.join(lip, 'bursts.wav'), lo, rough=True); fr = [r['mouth'] for r in res['frames']]
check('rough mode: one mouth per frame for the whole line', len(fr) == 96, len(fr))
inside = lambda t: any(a + 0.06 <= t <= b - 0.06 for a, b in T['bursts']); far = lambda t: all(t < a - 0.2 or t > b + 0.2 for a, b in T['bursts'])
check('rough mode: mouth open during sound, at rest in the silences', all(m in 'BCD' for i, m in enumerate(fr) if inside((i + 0.5) / 24)) and all(m == 'X' for i, m in enumerate(fr) if far((i + 0.5) / 24)), ''.join(fr))
rows = list(csv.DictReader(open(files['csv'], encoding='utf-8')))
check('the CSV has a row per frame and marks every change', len(rows) == 96 and all((r['new'] == '*') == (i == 0 or rows[i - 1]['mouth'] != r['mouth']) for i, r in enumerate(rows)))
check('holds add up to the length of the line', sum(int(r['holds']) for r in rows if r['holds']) == 96)
check('the chart picture is written', os.path.exists(files['chart']) and Image.open(files['chart']).size[0] > 1000)
r2, _ = LS.run(os.path.join(lip, 'bursts.wav'), lo, rough=True, start=101, fps=12)
check('--start and --fps are respected', r2['frames'][0]['frame'] == 101 and len(r2['frames']) == 48)
twos = LS.per_frame([dict(start=0, end=1 / 24, mouth='C'), dict(start=1 / 24, end=2 / 24, mouth='A'), dict(start=2 / 24, end=6 / 24, mouth='D')], 6 / 24, 24, on=2)
check('on twos, a one-frame closed mouth is kept instead of dropped', twos == ['A', 'A', 'D', 'D', 'D', 'D'], twos)
c = run('lip_sync.py', os.path.join(lip, 'bursts.wav'), '--rough', '--out', lo)
check('lip_sync.py runs from the command line', c.returncode == 0 and 'mouths:' in c.stdout, c.stderr[-300:])

exe = LS.find_rhubarb()
if not exe or not T['voice']:
    skipped += 1; print('SKIP  Rhubarb checks (%s)' % ('Rhubarb is not installed: python lip_sync.py --setup' if not exe else 'no computer voice on this machine to make a test line'))
else:
    V = T['voice']; voice = os.path.join(lip, 'voice.wav'); h0 = md5(voice); m0 = {k: md5(os.path.join(lip, 'mouths', k + '.png')) for k in 'ABCDEFGHX'}
    res, files = LS.run(voice, lo, text=V['text'], mouths_dir=os.path.join(lip, 'mouths')); fr = [r['mouth'] for r in res['frames']]; t = lambda i: (i + 0.5) / 24
    check('Rhubarb: one mouth per frame (%d frames for %.2f s)' % (len(fr), V['duration']), len(fr) == int(np.ceil(V['duration'] * 24 - 1e-6)) and res['method'] == 'rhubarb')
    p0, p1 = V['pauses'][0]
    check('Rhubarb: mouth at rest through the pause between the two sentences', all(m in 'XA' for i, m in enumerate(fr) if p0 + 0.25 < t(i) < p1 - 0.25), ''.join(fr))
    first = next(i for i, m in enumerate(fr) if m != 'X')
    check('Rhubarb: the mouth starts moving when the voice does (within 3 frames)', abs(first / 24 - V['first_sound']) <= 3 / 24 + 0.02, 'mouth at %.2f s, sound at %.2f s' % (first / 24, V['first_sound']))
    s1 = ''.join(m for i, m in enumerate(fr) if t(i) < p0); closures = sum(1 for i, m in enumerate(s1) if m == 'A' and (i == 0 or s1[i - 1] != 'A'))
    check('Rhubarb: "Mama made me a bubble bath" closes the lips on its M and B sounds (7 of them)', 5 <= closures <= 8, '%d closures: %s' % (closures, s1))
    s2 = ''.join(m for i, m in enumerate(fr) if t(i) > p1)
    check('Rhubarb: "Wow, look at you" puckers for W and OO', 'F' in s2, s2)
    speaking = [m for i, m in enumerate(fr) if (V['first_sound'] + 0.1 < t(i) < p0 - 0.1) or (p1 + 0.15 < t(i) < V['last_sound'] - 0.15)]
    check('Rhubarb: the mouth is working for nearly all of the speech', sum(m != 'X' for m in speaking) / len(speaking) > 0.8, '%.0f%%' % (100 * sum(m != 'X' for m in speaking) / len(speaking)))
    md = files['mouths']; names = sorted(os.listdir(md))
    check('with --mouths: one mouth picture per frame, named by frame number', names == ['%04d.png' % (i + 1) for i in range(len(fr))])
    check('  each one is the matching drawing from the mouth folder, byte for byte', all(md5(os.path.join(md, '%04d.png' % (i + 1))) == m0[m] for i, m in enumerate(fr)))
    g = Image.open(files['gif']); dur = 0
    for k in range(g.n_frames): g.seek(k); dur += g.info['duration']
    check('  the preview GIF runs the length of the line', abs(dur / 1000 - len(fr) / 24) < 0.06, '%.2f s vs %.2f s' % (dur / 1000, len(fr) / 24))
    check('  the voice line and the mouth drawings are untouched', md5(voice) == h0 and all(md5(os.path.join(lip, 'mouths', k + '.png')) == v for k, v in m0.items()))
    few = os.path.join(lip, 'mouths_basic'); shutil.rmtree(few, ignore_errors=True); os.makedirs(few)
    for k in 'ABCDEF': shutil.copy(os.path.join(lip, 'mouths', k + '.png'), few)
    res, _ = LS.run(voice, os.path.join(lip, 'out_basic'), text=V['text'], mouths_dir=few)
    check('a mouth chart with only A to F still gets a mouth on every frame', all(r['mouth'] in 'ABCDEF' for r in res['frames']))

# ------------------------------------------------------------------ tracker
td = os.path.join(out, 'tracker'); shutil.rmtree(td, ignore_errors=True); os.makedirs(td); tp = os.path.join(td, 'Shot Tracker.xlsx')
wb = openpyxl.Workbook(); ws = wb.active; ws.title = 'Shots'
ws['A1'] = 'MY FILM  shot tracker'; ws.merge_cells('A1:H1'); ws['A1'].font = Font(bold=True, size=16)
heads = ['Shot', 'Description', 'Frames', 'Seconds', 'Status', 'Due', 'Lip sync', 'Notes']
thin = Side(style='thin', color='999999')
for c, h in enumerate(heads, 1):
    x = ws.cell(3, c, h); x.font = Font(bold=True, color='FFFFFF'); x.fill = PatternFill('solid', fgColor='C2185B'); x.alignment = Alignment(horizontal='center')
STAT = ['Not started', 'Rough', 'Tie-down', 'Cleanup', 'Color', 'Done']
for i in range(8):
    r = 4 + i; vals = ['%03d' % ((i + 1) * 10), 'shot number %d' % (i + 1), 24 + i * 12, '=C%d/24' % r, STAT[i % 4], datetime.datetime(2026, 12, 1 + i), 'no' if i % 2 else 'yes', None if i % 3 else 'check arc']
    for c, v in enumerate(vals, 1):
        x = ws.cell(r, c, v); x.border = Border(left=thin, right=thin, top=thin, bottom=thin); x.fill = PatternFill('solid', fgColor='FCE4EC' if i % 2 else 'FFFFFF')
    ws.cell(r, 4).number_format = '0.00'; ws.cell(r, 6).number_format = 'mmm d'; ws.cell(r, 3).font = Font(italic=True)
dv = DataValidation(type='list', formula1='"%s"' % ','.join(STAT), allow_blank=True); dv.add('E4:E11'); ws.add_data_validation(dv)
ws.conditional_formatting.add('E4:E11', CellIsRule(operator='equal', formula=['"Done"'], fill=PatternFill('solid', bgColor='C8E6C9')))
ws['B14'] = 'TOTAL'; ws['C14'] = '=SUM(C4:C12)'; ws.freeze_panes = 'A4'; ws.column_dimensions['B'].width = 34; ws.column_dimensions['H'].width = 40
w2 = wb.create_sheet('Schedule'); w2['A1'] = 'Week'; w2['B1'] = 'Goal'; w2['A2'] = 1; w2['B2'] = 'boards locked'
wb.save(tp); h0 = md5(tp)
def cells(path, skip_row=None):
    w = openpyxl.load_workbook(path); return {(s.title, c.coordinate): c.value for s in w.worksheets for row in s.iter_rows() for c in row if c.value is not None and not (s.title == 'Shots' and c.row == skip_row)}

c = run('tracker_update.py', tp, '--show')
check('--show finds the header under a title row, the shot column, the dropdown and the formula column', all(t in c.stdout for t in ('header on row 3', 'shot column: Shot', 'dropdown: Not started, Rough', 'formula, leave it alone', '8 shots')), c.stdout + c.stderr[-300:])
c = run('tracker_update.py', tp, '--shot', '30', '--set', 'status=cleanup', '--set', 'Frames=52', '--set', 'due=2026-12-20', '--append', 'Notes=arc fixed on f12', '--set', 'lipsync=yes')
up = os.path.join(td, 'Shot Tracker_updated.xlsx')
check('updating shot 30 (typed without its leading zero) saves a NEW file and says what changed', c.returncode == 0 and os.path.exists(up) and "Status: 'Tie-down' -> 'Cleanup'" in c.stdout and 'every other row and sheet is unchanged' in c.stdout, c.stdout + c.stderr[-400:])
check('the tracker itself is untouched', md5(tp) == h0)
w = openpyxl.load_workbook(up); s = w['Shots']; orig = openpyxl.load_workbook(tp)['Shots']
check('the values land in the right row, in the tracker\'s own kinds: dropdown spelling, number, date', [s['A6'].value, s['E6'].value, s['C6'].value, s['F6'].value, s['G6'].value] == ['030', 'Cleanup', 52, datetime.datetime(2026, 12, 20), 'yes'], [s['A6'].value, s['E6'].value, s['C6'].value, s['F6'].value, s['G6'].value])
check('--append adds to the note instead of replacing it', s['H6'].value == 'arc fixed on f12' and True)
check('no other cell in the workbook changed', cells(up, 6) == cells(tp, 6))
check('formatting is kept: fills, italic, number formats, widths, merged title, frozen header', s['C6'].font.italic and s['F6'].number_format == 'mmm d' and s['E6'].fill.fgColor.rgb == orig['E6'].fill.fgColor.rgb and s['A3'].fill.fgColor.rgb == orig['A3'].fill.fgColor.rgb
      and s.column_dimensions['B'].width == 34 and 'A1:H1' in [str(m) for m in s.merged_cells.ranges] and s.freeze_panes == 'A4')
check('the dropdown, the formula column and the colour rule are still there', len(s.data_validations.dataValidation) == 1 and s['D6'].value == '=C6/24' and len(s.conditional_formatting) == 1 and 'Schedule' in w.sheetnames)
c = run('tracker_update.py', up, '--shot', '030', '--append', 'Notes=second pass ok')
up2 = os.path.join(td, 'Shot Tracker_updated2.xlsx')
check('updating the updated file makes _updated2 and stacks the note', os.path.exists(up2) and openpyxl.load_workbook(up2)['Shots']['H6'].value == 'arc fixed on f12\nsecond pass ok', c.stdout + c.stderr[-300:])
n_before = len(os.listdir(td))
c = run('tracker_update.py', tp, '--shot', '030', '--set', 'Status=Finished')
check('a value that is not in the dropdown is refused, and lists the choices', c.returncode != 0 and 'not one of the choices' in c.stderr and 'Tie-down' in c.stderr and len(os.listdir(td)) == n_before, c.stderr[-300:])
c = run('tracker_update.py', tp, '--shot', '030', '--set', 'Mood=happy')
check('a column the tracker does not have is refused, and lists the real columns', c.returncode != 0 and 'only fills columns the tracker already has' in c.stderr and 'Lip sync' in c.stderr, c.stderr[-300:])
c = run('tracker_update.py', tp, '--shot', '095', '--set', 'Status=Rough')
check('an unknown shot is refused without --add', c.returncode != 0 and 'not in the tracker' in c.stderr and len(os.listdir(td)) == n_before, c.stderr[-300:])
c = run('tracker_update.py', tp, '--shot', '030', '--set', 'Seconds=3')
check('a formula cell is left alone unless forced', c.returncode != 0 and 'is a formula' in c.stderr, c.stderr[-300:])
c = run('tracker_update.py', tp, '--shot', '030', '--set', 'Status=Done', '--dry-run')
check('--dry-run reports and saves nothing', c.returncode == 0 and 'WOULD CHANGE' in c.stdout and len(os.listdir(td)) == n_before, c.stdout)
c = run('tracker_update.py', tp, '--shot', '090', '--add', '--set', 'Status=Rough', '--set', 'Frames=36', '--set', 'Description=new shot', '--out', os.path.join(td, 'added.xlsx'))
ok = c.returncode == 0 and os.path.exists(os.path.join(td, 'added.xlsx'))
if ok:
    s = openpyxl.load_workbook(os.path.join(td, 'added.xlsx'))['Shots']
    ok = [s['A12'].value, s['B12'].value, s['C12'].value, s['D12'].value, s['E12'].value] == ['090', 'new shot', 36, '=C12/24', 'Rough'] and 'E12' in s.data_validations.dataValidation[0].sqref and s['C12'].font.italic and s['F12'].number_format == 'mmm d' and s['A12'].border.left.style == 'thin'
check('--add puts a new shot under the last one with the row above\'s look, formula and dropdown', ok, c.stdout + c.stderr[-400:])
check('  all eight existing shots are exactly as they were, and nothing was deleted', ok and cells(os.path.join(td, 'added.xlsx'), 12) == cells(tp, 12) and s.max_row >= 14)
ip = os.path.join(td, 'inplace.xlsx'); shutil.copy(tp, ip)
c = run('tracker_update.py', ip, '--shot', '010', '--set', 'Status=Done', '--in-place')
bk = [f for f in os.listdir(os.path.join(td, 'tracker_backups'))] if os.path.isdir(os.path.join(td, 'tracker_backups')) else []
check('--in-place updates the file and first keeps a dated copy of it as it was', c.returncode == 0 and len(bk) == 1 and md5(os.path.join(td, 'tracker_backups', bk[0])) == h0 and openpyxl.load_workbook(ip)['Shots']['E4'].value == 'Done' and cells(ip, 4) == cells(tp, 4), c.stdout + c.stderr[-300:])
dup = os.path.join(td, 'dup.xlsx'); w = openpyxl.load_workbook(tp); w['Shots']['A7'] = '030'; w.save(dup)
c = run('tracker_update.py', dup, '--shot', '030', '--set', 'Status=Done')
check('a shot that appears twice is refused rather than guessed', c.returncode != 0 and '2 times' in c.stderr, c.stderr[-300:])

print('\n%s%s' % ('ALL PASSED' if not fails else '%d FAILED' % fails, ' (%d group skipped)' % skipped if skipped else '')); sys.exit(1 if fails else 0)
