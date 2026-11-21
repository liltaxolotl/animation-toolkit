"""
Checks serve.py, the little local server that lets the app save into work/.

    python -P tests/test_serve.py

Starts serve.py on a free port, then proves: saves land in work/ and nowhere else, nothing is ever overwritten
(except a shot's own shot.json), every way of climbing out of work/ is refused, and numbered versions work the way
Store.saveVersion in app/js/shot.js calls it. Every work/_test_* folder it makes is removed at the end.
(The same numbering is also driven through the real app in tests/test_app_start.mjs.)
"""
import http.client
import json
import os
import random
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.path.join(ROOT, 'work')
RUN = '_test_' + ''.join(random.choice('abcdefghjkmnpqrstuvwxyz23456789') for _ in range(6))
fails = []


def check(name, ok, detail=''):
    print(('PASS  ' if ok else 'FAIL  ') + name + ('  ' + detail if detail else ''))
    if not ok:
        fails.append(name)


def free_port():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    p = s.getsockname()[1]
    s.close()
    return p


PORT = free_port()
BASE = 'http://127.0.0.1:%d' % PORT


def call(method, path, body=None, headers=None):
    """-> (status, parsed json or raw bytes)"""
    req = urllib.request.Request(BASE + path, data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw, code = r.read(), r.status
    except urllib.error.HTTPError as e:
        raw, code = e.read(), e.code
    try:
        return code, json.loads(raw.decode('utf-8'))
    except Exception:
        return code, raw


def save(path, data):
    return call('POST', '/api/save?path=' + urllib.parse.quote(path, safe='/'), data)


def listing(d):
    code, j = call('GET', '/api/list?dir=' + urllib.parse.quote(d, safe='/'))
    return code, j


def read(rel):
    p = os.path.join(ROOT, *rel.split('/'))
    return open(p, 'rb').read() if os.path.isfile(p) else None


def clean():
    if os.path.isdir(WORK):
        for n in os.listdir(WORK):
            if n.startswith(RUN):            # only this run's folders: other tests may be running too
                shutil.rmtree(os.path.join(WORK, n), ignore_errors=True)


def snapshot_root():
    """every file name in the repo root and one level of siblings that a bad save could create"""
    out = set()
    for base in (ROOT, os.path.dirname(ROOT), os.path.join(ROOT, 'samples'), WORK):
        if os.path.isdir(base):
            out |= {os.path.join(base, n) for n in os.listdir(base)}
    return out


server = None
try:
    clean()
    server = subprocess.Popen([sys.executable, '-P', os.path.join(ROOT, 'serve.py'), '--port', str(PORT), '--no-open'],
                              cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    up = False
    for _ in range(60):
        try:
            code, j = call('GET', '/api/ping')
            if code == 200:
                up = True
                break
        except Exception:
            time.sleep(0.2)
    check('the server starts on the port it was given', up, 'port %d' % PORT)
    if not up:
        raise SystemExit(1)
    before = snapshot_root()

    # ---- ping and static
    code, j = call('GET', '/api/ping')
    check('/api/ping says ok and names the work folder', code == 200 and j.get('ok') is True and os.path.normcase(os.path.abspath(j.get('work', ''))) == os.path.normcase(WORK), json.dumps(j)[:120])
    code, raw = call('GET', '/animation_app.html')
    check('a static GET of /animation_app.html returns 200 with the app', code == 200 and b'Animation Toolkit' in raw and b'id="sView"' in raw, '%d, %d bytes' % (code, len(raw)))
    code, raw = call('GET', '/app/js/shot.js')
    check('the app scripts are served as JavaScript', code == 200 and b'const Store' in raw)
    code, j = call('GET', '/api/nothing-here')
    check('an unknown /api/ route is a 404, not a crash', code == 404)
    code, j = call('POST', '/api/nothing-here', b'x')
    check('an unknown POST route is a 404', code == 404)

    # ---- saving
    D = 'work/%s' % RUN
    data = bytes(range(256)) * 4 + b'\x89PNG tail'
    code, j = save(D + '/a.png', data)
    check('POST /api/save into work/<folder>/a.png saves (200, ok, path echoed)', code == 200 and j.get('ok') is True and j.get('path') == D + '/a.png', '%d %s' % (code, j))
    check('the bytes on disk are exactly the bytes sent (binary safe)', read(D + '/a.png') == data)
    check('no .part scratch file is left behind', not [n for n in os.listdir(os.path.join(WORK, RUN)) if n.endswith('.part')])
    code, raw = call('GET', '/' + D + '/a.png')
    check('the saved file can be fetched back through the server', code == 200 and raw == data)
    code, j = save(D + '/a.png', b'SOMETHING ELSE ENTIRELY')
    check('a second POST to the same path is refused with 409', code == 409 and j.get('error') == 'exists', '%d %s' % (code, j))
    check('and the file on disk is unchanged', read(D + '/a.png') == data)
    code, j = save(D + '/a.png', b'')
    check('even an empty body cannot replace an existing file', code == 409 and read(D + '/a.png') == data)
    code, j = save(D + '/shot.json', b'{"v": 1}')
    check('a new work/<shot>/shot.json saves', code == 200 and read(D + '/shot.json') == b'{"v": 1}')
    code, j = save(D + '/shot.json', b'{"v": 2, "more": true}')
    check('shot.json CAN be overwritten (it is the shot\'s own notes)', code == 200 and read(D + '/shot.json') == b'{"v": 2, "more": true}', '%d' % code)
    code, j = save(D + '/source/deep/b.png', b'bbb')
    check('nested folders are created on the way (source/ and exports/ use this)', code == 200 and read(D + '/source/deep/b.png') == b'bbb')
    code, j = save(D + '/source/shot.json', b'{"x":1}')
    code2, j2 = save(D + '/source/shot.json', b'{"x":2}')
    check('shot.json is overwritable in any folder under work/ (known exception, by name)', code == 200 and code2 == 200)
    D2 = 'work/%s_case' % RUN
    code, j = save(D2 + '/Shot.JSON', b'1')
    code2, j2 = save(D2 + '/Shot.JSON', b'2')
    check('a different spelling of shot.json is NOT special (second save is refused)', code == 200 and code2 == 409 and read(D2 + '/Shot.JSON') == b'1', '%d then %d' % (code, code2))
    code, j = save(D + '/name with spaces (1).png', b'sp')
    check('names with spaces and brackets (the safe set) are fine', code == 200 and read(D + '/name with spaces (1).png') == b'sp')

    # ---- many writers at once: still only one winner (never overwrite)
    results, bodies = [], {}

    def writer(i):
        b = ('writer-%d-' % i).encode() * 5000
        bodies[i] = b
        try:
            results.append((i, save(D + '/race.png', b)[0]))
        except Exception as e:
            results.append((i, 'dropped (%s)' % type(e).__name__))
    ts = [threading.Thread(target=writer, args=(i,)) for i in range(20)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    wins = [i for i, c in results if c == 200]
    final = read(D + '/race.png')
    check('twenty simultaneous saves to one new path: exactly one wins (200), the other nineteen get 409', len(wins) == 1 and [c for _, c in results].count(409) == 19, 'answers: ' + ', '.join(str(c) for _, c in sorted(results)))
    check('no save was dropped without an answer (the server must answer every request)', all(isinstance(c, int) for _, c in results), 'answers: ' + ', '.join(str(c) for _, c in sorted(results)))
    check('no .part scratch file is left after the race', not [n for n in os.listdir(os.path.join(WORK, RUN)) if n.endswith('.part')])
    check('and the file holds the winner\'s bytes, whole', len(wins) == 1 and final == bodies[wins[0]], 'file is %d bytes' % (len(final or b'')))

    # ---- paths that must be refused
    bad = ['../x.png', 'work/../x.png', 'samples/x.png', 'x.png', 'work', 'work/', '', '/x.png', '/work/x.png',
           'C:/Windows/x.png', 'C:\\x.png', '\\\\server\\share\\x.png', 'work\\..\\x.png', '..\\x.png', 'work/..\\x.png',
           'work\\..\\..\\x.png', 'work/%s/../../x.png' % RUN, 'work/%s/..\\..\\x.png' % RUN, 'work/./x.png', 'work//x.png',
           'work/%s/./x.png' % RUN, 'work/.../x.png', 'work/..', 'work/%s/..' % RUN, 'work/a:b.png', 'work/%s/a.png:stream' % RUN,
           'work/%s/a*.png' % RUN, 'work/%s/a?.png' % RUN, 'work/%s/<x>.png' % RUN, 'Work/x.png', 'WORK/x.png', 'work/%s/x\x00.png' % RUN,
           'work/%2e%2e/x.png', 'work/' + RUN + '/%2e%2e/%2e%2e/x.png', 'file:///x.png', 'work/ ', 'src/x.png', 'animation_app.html', 'serve.py']
    outcomes = []
    for p in bad:
        try:
            req = urllib.request.Request(BASE + '/api/save?path=' + urllib.parse.quote(p, safe='/\\'), data=b'EVIL', method='POST')
            try:
                with urllib.request.urlopen(req, timeout=10) as r:
                    code = r.status
            except urllib.error.HTTPError as e:
                code = e.code
        except Exception as e:
            code = 'ERR ' + type(e).__name__
        outcomes.append((p, code))
    notrefused = [(p, c) for p, c in outcomes if c != 400]
    check('all %d ways out of work/ (dot-dot, backslashes, absolute, drive letters, streams, odd names) answer 400' % len(bad), not notrefused, 'not refused: ' + repr(notrefused) if notrefused else '')
    # %-encoded dot-dot inside the query value is decoded before the check
    code, j = call('POST', '/api/save?path=work%2F..%2Fx.png', b'EVIL')
    check('a %-encoded work/../x.png is refused too', code == 400)
    code, j = call('POST', '/api/save', b'EVIL')
    check('no path at all is refused', code == 400)
    after = snapshot_root()
    new = sorted(os.path.basename(p) for p in (after - before) if not p.startswith(os.path.join(WORK, RUN)))
    check('nothing was written outside work/ by any of that (repo root, samples/, the folder above)', not [n for n in new if n != RUN], ', '.join(new))
    check('no file called x.png / x appeared anywhere near', not any(os.path.exists(os.path.join(b, n)) for b in (ROOT, os.path.dirname(ROOT), WORK, os.path.join(ROOT, 'samples')) for n in ('x', 'x.png')))

    # ---- too big is refused before reading it
    c = http.client.HTTPConnection('127.0.0.1', PORT, timeout=10)
    c.putrequest('POST', '/api/save?path=' + urllib.parse.quote(D + '/huge.bin', safe='/'))
    c.putheader('Content-Length', str(500 * 1024 * 1024))
    c.endheaders()
    r = c.getresponse()
    check('a 500 MB Content-Length is answered 413 without waiting for the body', r.status == 413 and read(D + '/huge.bin') is None, str(r.status))
    c.close()

    # ---- list
    code, j = listing(D)
    names = [f['name'] for f in j.get('files', [])]
    check('/api/list lists the folder (sorted, with size and dir flags)', code == 200 and 'a.png' in names and 'shot.json' in names and 'source' in names and names == sorted(names), ', '.join(names))
    a = next((f for f in j.get('files', []) if f['name'] == 'a.png'), {})
    src = next((f for f in j.get('files', []) if f['name'] == 'source'), {})
    check('list reports the size, and marks folders', a.get('size') == len(data) and a.get('dir') is False and src.get('dir') is True, json.dumps(a))
    code, j = listing('work/%s_nothing' % RUN)
    check('listing a folder that does not exist gives an empty list, not an error', code == 200 and j == {'files': []}, '%d %s' % (code, j))
    for d in ['../', 'work/..', 'samples', '/', 'C:/', 'work\\..', 'work/%s/../..' % RUN]:
        code, j = listing(d)
        if code != 400:
            check('/api/list refuses %r' % d, False, '%d %s' % (code, str(j)[:80]))
            break
    else:
        check('/api/list refuses folders outside work/ (../, samples, absolute, backslashes)', True)
    code, j = listing('work')
    check('/api/list of work itself works and shows this test folder', code == 200 and RUN in [f['name'] for f in j.get('files', [])])

    # ---- numbered versions, the way Store.saveVersion calls it:
    #      list work/<shot>, find the highest base_tag_vN.ext, try N+1, and on 409 try the next number
    def next_free(shot_dir, base, tag, ext):
        n = 0
        prefix, suffix = '%s_%s_v' % (base, tag), '.' + ext
        for f in listing(shot_dir)[1].get('files', []):
            nm = f['name']
            if nm.startswith(prefix) and nm.endswith(suffix) and nm[len(prefix):-len(suffix)].isdigit():
                n = max(n, int(nm[len(prefix):-len(suffix)]))
        return n + 1

    VD = 'work/%s_ver' % RUN
    got = []
    for i in range(3):
        n = next_free(VD, 'shot01', 'edit', 'png')
        name = 'shot01_edit_v%d.png' % n
        code, j = save(VD + '/' + name, ('edit number %d' % (i + 1)).encode())
        got.append((name, code))
    check('three saves the way saveVersion does them are numbered v1, v2, v3', [g[0] for g in got] == ['shot01_edit_v1.png', 'shot01_edit_v2.png', 'shot01_edit_v3.png'] and all(g[1] == 200 for g in got), str(got))
    check('all three files exist with their own content (nothing replaced)', all(read(VD + '/shot01_edit_v%d.png' % (i + 1)) == ('edit number %d' % (i + 1)).encode() for i in range(3)))
    code, j = save(VD + '/shot01_edit_v2.png', b'overwrite attempt')
    check('re-saving v2 is refused, so the app moves on to v4', code == 409 and next_free(VD, 'shot01', 'edit', 'png') == 4 and read(VD + '/shot01_edit_v2.png') == b'edit number 2')
    other = next_free(VD, 'shot01', 'rough', 'png')
    check('a different tag or base starts its own count at v1', other == 1 and next_free(VD, 'shot02', 'edit', 'png') == 1)

    # ---- the server only listens on this computer
    out = subprocess.run([sys.executable, '-P', '-c', 'import socket,sys\ns=socket.socket()\ntry:\n    s.connect((sys.argv[1], int(sys.argv[2]))); print("open")\nexcept Exception:\n    print("closed")', socket.gethostbyname(socket.gethostname()), str(PORT)], capture_output=True, text=True, timeout=20)
    lan = socket.gethostbyname(socket.gethostname())
    check('it is bound to 127.0.0.1 only (this machine\'s network address %s does not answer)' % lan, lan.startswith('127.') or out.stdout.strip() == 'closed', out.stdout.strip())
finally:
    if server is not None:
        server.kill()
        try:
            server.wait(timeout=10)
        except Exception:
            pass
    clean()

print('\n' + (str(len(fails)) + ' FAILED' if fails else 'ALL PASSED'))
sys.exit(1 if fails else 0)
