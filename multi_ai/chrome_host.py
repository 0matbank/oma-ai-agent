"""
The native messaging host of the Oma Reader browser extension (integrations/chrome-oma-reader). Chrome or Edge starts it
when the extension connects; it then lets Oma's background reader (multi_ai/app_reader.py) ask the extension for the
tabs and for a tab's text, through 127.0.0.1 and a random token written to %APPDATA%\\Atticus\\chrome_reader_<pid>.json.
Standalone on purpose (run with python -I): the browser starts it, not Oma.
Messages with the browser: 4-byte little-endian length + UTF-8 JSON, on stdin / stdout.
"""
import http.server
import itertools
import json
import os
import secrets
import struct
import sys
import threading
import urllib.parse

if sys.platform == 'win32':
    import msvcrt
    msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
    msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)

DIR = os.environ.get('ATTICUS_DIR') or os.path.join(os.environ.get('APPDATA', ''), 'Atticus')
INFO = os.path.join(DIR, f'chrome_reader_{os.getpid()}.json')
TOKEN = secrets.token_hex(16)
lock, waiting, ids = threading.Lock(), {}, itertools.count(1)


def send(m):
    b = json.dumps(m).encode('utf-8')
    with lock:
        sys.stdout.buffer.write(struct.pack('<I', len(b)) + b)
        sys.stdout.buffer.flush()


def ask(m, timeout=15):
    i = next(ids)
    ev = threading.Event()
    waiting[i] = [ev, None]
    send({**m, 'id': i})
    if not ev.wait(timeout):
        waiting.pop(i, None)
        return {'error': 'the browser did not answer'}
    return waiting.pop(i)[1]


def from_browser():
    while True:
        head = sys.stdin.buffer.read(4)
        if len(head) < 4:
            break
        m = json.loads(sys.stdin.buffer.read(struct.unpack('<I', head)[0]).decode('utf-8'))
        w = waiting.get(m.get('id'))
        if w:
            w[1] = m
            w[0].set()
    try:   # the browser closed: this reader is gone
        os.remove(INFO)
    except OSError:
        pass
    os._exit(0)


class Ask(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        if q.get('token', [''])[0] != TOKEN:
            self.send_response(403)
            self.end_headers()
            return
        if u.path == '/tabs':
            r = ask({'op': 'tabs'})
        elif u.path == '/read' and q.get('tab', [''])[0].isdigit():
            r = ask({'op': 'read', 'tab': int(q['tab'][0])}, 20)
        else:
            self.send_response(404)
            self.end_headers()
            return
        b = json.dumps(r, ensure_ascii=False).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.end_headers()
        self.wfile.write(b)

    def log_message(self, *a):
        pass


def main():
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Ask)
    os.makedirs(DIR, exist_ok=True)
    with open(INFO, 'w', encoding='utf-8') as f:
        json.dump({'port': srv.server_address[1], 'token': TOKEN, 'pid': os.getpid(), 'origin': sys.argv[1] if len(sys.argv) > 1 else ''}, f)
    threading.Thread(target=from_browser, daemon=True).start()
    srv.serve_forever()


if __name__ == '__main__':
    main()
