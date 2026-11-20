"""
serve.py: open the Animation Toolkit app on this computer only (http://127.0.0.1:8765).

    python serve.py [--port 8765] [--no-open]

Why a server: browsers will not load 3D models or ES modules from a double-clicked file, and the server lets the
app save straight into work/ so the Python scripts (and a Claude) can see the same shot files.

What it does
  - serves this folder read-only, to this computer only (it binds to 127.0.0.1, nothing on the network can reach it)
  - saves files the app sends into work/ and nowhere else
  - NEVER overwrites a file, with one exception: a shot's own shot.json (the app's notes on that shot)
  - work/<shot>/source/ holds copies of the artist's originals; those are write-once like everything else

API (used by app/js/shot.js)
  GET  /api/ping                       -> {"ok": true, "work": "<abs path>"}
  GET  /api/list?dir=work/<shot>       -> {"files": [{"name", "size", "dir"}]}
  POST /api/save?path=work/<shot>/<f>  body = file bytes -> {"ok": true, "path": ...}   409 if it exists
"""
import argparse
import http.server
import json
import os
import re
import socketserver
import sys
import threading
import urllib.parse
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(ROOT, 'work')
OVERWRITABLE = re.compile(r'^shot\.json$')
SAFE_PART = re.compile(r'^[A-Za-z0-9 _.\-()]+$')


def resolve_work(rel):
    """work/... relative path -> absolute path inside WORK, or None if it tries to leave it."""
    if not rel:
        return None
    parts = rel.replace('\\', '/').split('/')
    # Windows quietly drops trailing dots and spaces, so a name that is only dots or spaces, or ends in one, is refused
    if parts[0] != 'work' or any(not SAFE_PART.match(p) or p.strip('. ') == '' or p[-1] in '. ' for p in parts[1:]):
        return None
    full = os.path.abspath(os.path.join(ROOT, *parts))
    return full if full == WORK or full.startswith(WORK + os.sep) else None


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary',
                      '.wasm': 'application/wasm', '.task': 'application/octet-stream'}

    def log_message(self, fmt, *args):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def _json(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path == '/api/ping':
            return self._json(200, {'ok': True, 'work': WORK})
        if u.path == '/api/list':
            q = urllib.parse.parse_qs(u.query)
            d = resolve_work(q.get('dir', ['work'])[0])
            if not d:
                return self._json(400, {'error': 'bad folder'})
            if not os.path.isdir(d):
                return self._json(200, {'files': []})
            files = [{'name': n, 'size': os.path.getsize(os.path.join(d, n)), 'dir': os.path.isdir(os.path.join(d, n))}
                     for n in sorted(os.listdir(d))]
            return self._json(200, {'files': files})
        if u.path.startswith('/api/'):
            return self._json(404, {'error': 'unknown'})
        return super().do_GET()

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        if u.path != '/api/save':
            return self._json(404, {'error': 'unknown'})
        q = urllib.parse.parse_qs(u.query)
        full = resolve_work(q.get('path', [''])[0])
        if not full or full == WORK:
            return self._json(400, {'error': 'files can only be saved inside work/'})
        n = int(self.headers.get('Content-Length') or 0)
        if n > 400 * 1024 * 1024:
            return self._json(413, {'error': 'too big'})
        data = self.rfile.read(n)
        rel = os.path.relpath(full, ROOT).replace('\\', '/')
        try:
            os.makedirs(os.path.dirname(full), exist_ok=True)
            if OVERWRITABLE.match(os.path.basename(full)):
                tmp = '%s.%d.%d.part' % (full, os.getpid(), threading.get_ident())   # one temp file per request
                with open(tmp, 'wb') as f:
                    f.write(data)
                os.replace(tmp, full)
            else:
                # 'x' creates the file or fails if it exists, in one step: two saves at once can never both win
                with open(full, 'xb') as f:
                    f.write(data)
        except FileExistsError:
            return self._json(409, {'error': 'exists', 'path': rel})
        except OSError as e:
            return self._json(400, {'error': 'could not save: %s' % e.strerror})
        return self._json(200, {'ok': True, 'path': rel})


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--port', type=int, default=8765)
    ap.add_argument('--no-open', action='store_true', help='do not open the browser')
    a = ap.parse_args()
    os.makedirs(WORK, exist_ok=True)
    try:
        srv = Server(('127.0.0.1', a.port), Handler)
    except OSError:
        url = f'http://127.0.0.1:{a.port}/animation_app.html'
        print(f'Already running (port {a.port} is taken), opening {url}')
        if not a.no_open:
            webbrowser.open(url)
        return
    url = f'http://127.0.0.1:{a.port}/animation_app.html'
    print(f'Animation Toolkit: {url}\nSaving into {WORK}\nClose this window to stop it.')
    if not a.no_open:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    sys.exit(main())
