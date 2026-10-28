"""
Oma's own browser: a separate Chrome profile (its own logins, kept between runs) that Oma drives like a person would,
through Chrome's DevTools protocol on 127.0.0.1 only. The user signs in to sites in it once; Oma then opens pages,
reads them, clicks and types there. Risky clicks (Send, Buy, Delete ...) ask first through the engine's gate (risky()).

    atticus --browser open <url>          open (or reuse) a tab and wait for it to load
    atticus --browser read                the page's title, address and visible text
    atticus --browser click "<text|css>"  click a button / link by its visible text, or a CSS selector
    atticus --browser type "<field>" "<text>" [--enter]   field: its label, placeholder, name or a CSS selector
    atticus --browser key <Enter|Tab|Escape>
    atticus --browser shot                a screenshot (path printed)
    atticus --browser tabs                the open tabs
It never reads the profile's cookies or passwords; it only acts in the visible window.
"""
import base64
import json
import os
import subprocess
import tempfile
import time
import urllib.request

PORT = 9333
HOME = os.environ.get('ATTICUS_DIR') or os.path.join(os.environ.get('APPDATA', os.path.expanduser('~')), 'Atticus')
PROFILE = os.path.join(os.environ.get('LOCALAPPDATA', HOME), 'Atticus', 'browser-profile')
CHROME = [r'C:\Program Files\Google\Chrome\Application\chrome.exe', r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
          os.path.join(os.environ.get('LOCALAPPDATA', ''), r'Google\Chrome\Application\chrome.exe'),
          r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe', r'C:\Program Files\Microsoft\Edge\Application\msedge.exe']


class BrowserError(Exception):
    pass


def _http(path, method='GET', timeout=3):
    req = urllib.request.Request(f'http://127.0.0.1:{PORT}{path}', method=method)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode('utf-8') or 'null')


def running():
    try:
        return bool(_http('/json/version', timeout=1))
    except Exception:
        return False


def ensure():
    """Starts Oma's browser window if it is not open. -> True when it answers."""
    if running():
        return True
    exe = next((p for p in CHROME if os.path.exists(p)), '')
    if not exe:
        raise BrowserError('Chrome or Edge is not installed')
    os.makedirs(PROFILE, exist_ok=True)
    subprocess.Popen([exe, f'--user-data-dir={PROFILE}', f'--remote-debugging-port={PORT}', '--remote-debugging-address=127.0.0.1',
                      '--no-first-run', '--no-default-browser-check', '--new-window', 'about:blank'],
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True,   # the caller's pipes close now
                     creationflags=getattr(subprocess, 'DETACHED_PROCESS', 0) | getattr(subprocess, 'CREATE_NEW_PROCESS_GROUP', 0))
    for _ in range(60):
        time.sleep(0.25)
        if running():
            return True
    raise BrowserError("Oma's browser did not start")


def _pages():
    return [t for t in (_http('/json/list') or []) if t.get('type') == 'page']


def _tab():
    """The tab Oma works in: the first normal page (Chrome lists the most recently used first)."""
    ps = [p for p in _pages() if not p.get('url', '').startswith(('devtools://', 'chrome-extension://'))]
    if not ps:
        _http('/json/new?about:blank', method='PUT')
        ps = _pages()
    return ps[0]


class _Cdp:
    def __init__(self, tab):
        from websockets.sync.client import connect
        self.ws, self.n = connect(tab['webSocketDebuggerUrl'], max_size=40 * 2 ** 20, open_timeout=5), 0

    def __call__(self, method, timeout=15, **params):
        self.n += 1
        self.ws.send(json.dumps({'id': self.n, 'method': method, 'params': params}))
        end = time.time() + timeout
        while time.time() < end:
            m = json.loads(self.ws.recv(timeout=max(0.1, end - time.time())))
            if m.get('id') == self.n:
                if 'error' in m:
                    raise BrowserError(m['error'].get('message', 'CDP error'))
                return m.get('result', {})
        raise BrowserError(f'{method} timed out')

    def js(self, expr, timeout=15):
        r = self('Runtime.evaluate', timeout=timeout, expression=expr, returnByValue=True, awaitPromise=True)
        if r.get('exceptionDetails'):
            raise BrowserError(r['exceptionDetails'].get('text', 'script error'))
        return (r.get('result') or {}).get('value')

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass


def _with_tab(fn):
    ensure()
    c = _Cdp(_tab())
    try:
        return fn(c)
    finally:
        c.close()


def _wait_loaded(c, timeout=20):
    end = time.time() + timeout
    while time.time() < end:
        if c.js('document.readyState') == 'complete':
            return True
        time.sleep(0.25)
    return False


def open_url(url):
    if not url.startswith(('http://', 'https://', 'about:', 'file:')):
        url = 'https://' + url
    def go(c):
        c('Page.navigate', url=url)
        time.sleep(0.4)
        _wait_loaded(c)
        c('Page.bringToFront')
        here = c.js('location.href')
        return f"opened: {c.js('document.title')} ({here})" + login_note(here)
    return _with_tab(go)


def read(limit=6000):
    def r(c):
        t = c.js("(document.body ? document.body.innerText : '').replace(/\\n{3,}/g, '\\n\\n')") or ''
        return f"{c.js('document.title')}\n{c.js('location.href')}\n\n{t[:limit]}" + ('\n…(cut)' if len(t) > limit else '')
    return _with_tab(r)


# Finds an element the way a person names it: visible text of a button/link, aria-label, label, placeholder, name, or CSS.
_FIND = r"""(q => {
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
  const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase(), Q = norm(q);
  try { const e = document.querySelector(q); if (e && vis(e)) return e; } catch (_) {}
  const pick = (sel, key) => { let best = null;
    for (const e of document.querySelectorAll(sel)) { if (!vis(e)) continue; const t = norm(key(e));
      if (t === Q) return e; if (!best && t && t.includes(Q)) best = e; }
    return best; };
  return %s;
})(%s)"""
_CLICKABLE = "pick('button,a,[role=button],[role=link],[role=tab],[role=menuitem],input[type=submit],input[type=button],summary,label', e => e.innerText || e.value || e.getAttribute('aria-label') || e.title)"
_FIELD = ("pick('input,textarea,[contenteditable=true],[role=textbox],select', e => e.getAttribute('aria-label') || e.placeholder || e.name || e.id || "
          "(e.labels && e.labels[0] && e.labels[0].innerText) || '')")


def click(target):
    def k(c):
        found = c.js(f"(() => {{ const e = {_FIND % (_CLICKABLE, json.dumps(target))}; if (!e) return null; e.scrollIntoView({{block:'center'}}); e.click(); "
                     "return (e.innerText || e.value || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 80); })()")
        if not found:
            return f'Error: nothing clickable named "{target}" on this page'
        time.sleep(0.6)
        _wait_loaded(c, 10)
        return f'clicked "{found}" ({c.js("location.href")})'
    return _with_tab(k)


def type_text(field, text, enter=False):
    def t(c):
        ok = c.js(f"(() => {{ const e = {_FIND % (_FIELD, json.dumps(field))}; if (!e) return false; e.scrollIntoView({{block:'center'}}); e.focus(); "
                  "if ('value' in e) { e.select && e.select(); } return true; })()")
        if not ok:
            return f'Error: no text field "{field}" on this page'
        c('Input.insertText', text=text)
        if enter:
            key(c, 'Enter')
            time.sleep(0.6)
            _wait_loaded(c, 10)
        return f'typed into "{field}"' + (' and pressed Enter' if enter else '')
    return _with_tab(t)


KEYS = {'Enter': 13, 'Tab': 9, 'Escape': 27, 'Backspace': 8, 'ArrowDown': 40, 'ArrowUp': 38}


def key(c, name):
    code = KEYS.get(name, 0)
    for kind in ('keyDown', 'keyUp'):
        c('Input.dispatchKeyEvent', type=kind, key=name, code=name, windowsVirtualKeyCode=code, nativeVirtualKeyCode=code,
          **({'text': '\r'} if name == 'Enter' and kind == 'keyDown' else {}))


def press(name):
    return _with_tab(lambda c: (key(c, name), f'pressed {name}')[1])


def shot():
    def s(c):
        png = base64.b64decode(c('Page.captureScreenshot', format='png')['data'])
        p = os.path.join(tempfile.gettempdir(), f'oma-browser-{int(time.time())}.png')
        open(p, 'wb').write(png)
        return p
    return _with_tab(s)


def close_browser():
    if not running():
        return "Oma's browser is not open"
    from websockets.sync.client import connect
    ws = connect(_http('/json/version')['webSocketDebuggerUrl'], open_timeout=5)
    ws.send(json.dumps({'id': 1, 'method': 'Browser.close'}))
    ws.close()
    for _ in range(20):
        time.sleep(0.25)
        if not running():
            return "closed Oma's browser"
    return "Error: Oma's browser did not close"


def tabs():
    ensure()
    return '\n'.join(f"{i + 1}. {p.get('title', '')[:70]} — {p.get('url', '')[:100]}" for i, p in enumerate(_pages())) or 'no tabs'


# The user's own chat sites, used only when the user asks ("DeepSeek-ke jiggesh koro ..."), visibly in Oma's window:
# Oma types the question the way the user would and reads the answer on screen. Never a hidden or automatic fallback.
SITES = {
    'deepseek': {'url': 'https://chat.deepseek.com/', 'input': 'textarea', 'answer': '.ds-markdown',
                 'login': r'sign_in|/login|passport'},
    'chatgpt': {'url': 'https://chatgpt.com/', 'input': '#prompt-textarea, div[contenteditable=true]', 'answer': '[data-message-author-role="assistant"]',
                'login': r'auth\.openai|/auth/|login'},
    'gemini': {'url': 'https://gemini.google.com/app', 'input': 'rich-textarea .ql-editor, div[contenteditable=true]', 'answer': 'message-content',
               'login': r'accounts\.google\.com|signin'},
}
LOGIN_PAGE = r'accounts\.google\.com/.*signin|/login|/sign[_-]?in|/auth/|passport'


ACCOUNTS = os.path.join(HOME, 'browser_accounts.json')   # {"gemini": "<gmail>"}: which signed-in Google account a site uses


def site_account(site):
    try:
        return json.load(open(ACCOUNTS, encoding='utf-8')).get(site, '')
    except (OSError, ValueError):
        return ''


def site_url(site):
    """Several Google accounts can be signed in at once in Oma's browser (Add another account); Gemini opens with the
    one the user chose (authuser=<gmail>), so signing in to ChatGPT with another Gmail never changes it."""
    cfg, acct = SITES[site], site_account(site)
    return cfg['url'] + (f'?authuser={acct}' if acct and site == 'gemini' else '')


def ask_site(site, question, wait=50):
    """Asks the user's chat site in Oma's window and returns the answer text it shows (or why it could not)."""
    cfg = SITES.get(site.lower())
    if not cfg:
        return f'Error: unknown site "{site}" (deepseek, chatgpt, gemini)'
    site = site.lower()
    def run(c):
        import re
        c('Page.navigate', url=site_url(site))
        time.sleep(1)
        _wait_loaded(c)
        c('Page.bringToFront')
        box = None
        for _ in range(20):   # the chat box appears after the app loads
            box = c.js(f"(() => {{ const e = document.querySelector({json.dumps(cfg['input'])}); if (!e) return null; e.focus(); return true; }})()")
            if box or re.search(cfg['login'], c.js('location.href') or ''):
                break
            time.sleep(0.5)
        if not box:
            return (f"Error: {site} needs you to sign in in Oma's browser first (Settings > Integrations > Open Oma's browser), "
                    f"then ask again. Page: {c.js('location.href')}")
        count = c.js(f"document.querySelectorAll({json.dumps(cfg['answer'])}).length") or 0
        c('Input.insertText', text=question)
        time.sleep(0.3)
        key(c, 'Enter')
        last, same, end = '', 0, time.time() + wait
        while time.time() < end:   # done when a new answer exists and stops changing for ~3 s
            time.sleep(1)
            n, txt = c.js(f"(() => {{ const a = document.querySelectorAll({json.dumps(cfg['answer'])}); "
                          "return [a.length, a.length ? a[a.length - 1].innerText : '']; })()") or [0, '']
            if n > count and txt.strip():
                same = same + 1 if txt == last else 0
                last = txt
                if same >= 3:
                    return f'{site} answered:\n{txt.strip()[:6000]}'
        return f'{site} answered (may still be writing):\n{last.strip()[:6000]}' if last else f'Error: no answer from {site} in {wait} s'
    return _with_tab(run)


def login_note(url):
    """Shown after `open` when a site sent Oma's window to a sign-in page (an expired session)."""
    import re
    return "\nNote: this site asks you to sign in. Sign in once in Oma's browser; Oma never types passwords." if re.search(LOGIN_PAGE, url or '', re.I) else ''


def main(args):
    """atticus --browser <verb> ... -> prints the result (errors start with "Error:")."""
    verb, rest = (args[0] if args else 'open'), args[1:]
    try:
        if verb == 'open':
            print(open_url(rest[0]) if rest else (ensure() and "Oma's browser is open"))
        elif verb == 'read':
            print(read())
        elif verb == 'click' and rest:
            print(click(' '.join(rest)))
        elif verb == 'type' and len(rest) >= 2:
            enter = '--enter' in rest
            rest = [r for r in rest if r != '--enter']
            print(type_text(rest[0], ' '.join(rest[1:]), enter))
        elif verb == 'key' and rest:
            print(press(rest[0]))
        elif verb == 'shot':
            print(shot())
        elif verb == 'tabs':
            print(tabs())
        elif verb == 'ask' and len(rest) >= 2:
            print(ask_site(rest[0], ' '.join(rest[1:])))
        elif verb == 'close':   # closes Oma's browser window (its logins stay in the profile)
            print(close_browser())
        else:
            print('Error: usage: atticus --browser open <url> | read | click "<text>" | type "<field>" "<text>" [--enter] | key <name> | shot | tabs | ask <deepseek|chatgpt|gemini> "<question>" | close')
    except BrowserError as e:
        print(f'Error: {e}')
    except Exception as e:
        print(f'Error: browser: {e}')
