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
    atticus --browser sites | status [id ...] | login <id> | account <gemini|gmail> [email] | add-site "<name>" <url> | remove-site <id>
                                          sign-in sites (Settings > Integrations); status looks at the pages, never at cookies
    atticus --browser signout-all         closes Oma's browser and deletes its own profile (the user's Chrome is untouched)
It never reads the profile's cookies or passwords; it only acts in the visible window.
"""
import base64
import json
import re
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
    if re.match(r'https://gemini\.google\.com(/app)?/?$', url) and site_account('gemini'):   # the user's Gemini account, not Google's first one
        url = site_url('gemini')
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
    """A real key press as Chrome makes it (rawKeyDown, char, keyUp): chat apps built on React ignore a bare keyDown."""
    code = KEYS.get(name, 0)
    c('Input.dispatchKeyEvent', type='rawKeyDown', key=name, code=name, windowsVirtualKeyCode=code, nativeVirtualKeyCode=code)
    if name == 'Enter':
        c('Input.dispatchKeyEvent', type='char', key=name, code=name, text='\r', unmodifiedText='\r', windowsVirtualKeyCode=code, nativeVirtualKeyCode=code)
    c('Input.dispatchKeyEvent', type='keyUp', key=name, code=name, windowsVirtualKeyCode=code, nativeVirtualKeyCode=code)


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


_BOX_TEXT = "(() => { const e = document.activeElement; return e ? (e.value || e.innerText || '') : ''; })()"
# the right-most visible button next to the chat box is its send button (no site-specific class needed)
_SEND_XY = """(() => { const t = document.activeElement && /TEXTAREA|DIV|P/.test(document.activeElement.tagName) ? document.activeElement : document.querySelector('textarea');
  if (!t) return null; const tr = t.getBoundingClientRect(); let p = t, best = null;
  for (let i = 0; i < 8 && p && !best; i++) { p = p.parentElement;
    const bs = [...p.querySelectorAll('button,[role=button]')].map(e => [e, e.getBoundingClientRect()])
      .filter(([e, r]) => r.width > 0 && r.height > 0 && r.top >= tr.top - 20 && r.bottom <= tr.bottom + 80);
    if (bs.length) best = bs.sort((a, b) => b[1].right - a[1].right)[0]; }
  if (!best) return null; const r = best[1]; return [r.x + r.width / 2, r.y + r.height / 2]; })()"""
# what the page shows after the last copy of the question, without the chat box and its buttons
_AFTER = r"""(q => { const all = document.body.innerText; const i = all.lastIndexOf(q); if (i < 0) return '';
  let t = all.slice(i + q.length); const box = document.querySelector('textarea, [contenteditable=true]');
  const ph = box && (box.getAttribute('placeholder') || box.getAttribute('aria-label')); if (ph && t.includes(ph)) t = t.slice(0, t.lastIndexOf(ph));
  return t.replace(/\n{2,}/g, '\n').trim(); })(%s)"""


def _site_tab(url):
    """The site's own tab in Oma's window (an open one on the same host, else a new one): never a tab the user is using
    for something else."""
    import urllib.parse
    host = urllib.parse.urlparse(url).netloc
    for t in _pages():
        if urllib.parse.urlparse(t.get('url', '')).netloc == host:
            try:   # answers plain text ("Target activated"), not JSON
                urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/activate/{t['id']}", timeout=3).read()
            except Exception:
                pass
            return t
    return _http('/json/new?' + urllib.parse.quote(url, safe=':/?=&@'), method='PUT')


def ask_site(site, question, wait=50):
    """Asks the user's chat site in Oma's window and returns the answer text it shows (or why it could not)."""
    cfg = SITES.get(site.lower())
    if not cfg:
        return f'Error: unknown site "{site}" (deepseek, chatgpt, gemini)'
    site = site.lower()
    ensure()
    c = _Cdp(_site_tab(site_url(site)))
    try:
        return _ask_in(c, site, cfg, question, wait)
    finally:
        c.close()


def _ask_in(c, site, cfg, question, wait):
    if True:
        import re
        c('Emulation.setFocusEmulationEnabled', enabled=True)   # keys and clicks count even when the window is behind another
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
            here = c.js('location.href') or ''
            if 'google.com/sorry' in here:   # Google's "unusual traffic" check: a person must answer it; Oma never solves CAPTCHAs
                return ("Error: Google is asking to confirm you are not a robot. Open Oma's browser (Settings > Integrations), "
                        "answer it once yourself, then ask again.")
            return (f"Error: {site} needs you to sign in in Oma's browser first (Settings > Integrations > Open Oma's browser), "
                    f"then ask again. Page: {here}")
        count = c.js(f"document.querySelectorAll({json.dumps(cfg['answer'])}).length") or 0
        for ch in question:   # typed key by key like a person: chat apps ignore text pasted in without key events
            c('Input.dispatchKeyEvent', type='keyDown', text=ch, key=ch, unmodifiedText=ch)
            c('Input.dispatchKeyEvent', type='keyUp', key=ch)
        time.sleep(0.4)
        key(c, 'Enter')
        time.sleep(1.5)
        if question[:30] in (c.js(_BOX_TEXT) or ''):   # Enter did not send: the send button, by its name, else the right-most one
            named = c.js("(() => { const s = [...document.querySelectorAll('button,[role=button]')].find(x => /^(send|submit|send message|send prompt)$/i"
                         ".test((x.getAttribute('aria-label') || '').trim()) || x.dataset.testid === 'send-button'); if (!s || s.disabled) return false; s.click(); return true; })()")
            time.sleep(1.5) if named else None
            xy = None if named else c.js(_SEND_XY)
            if xy:
                for t in ('mouseMoved', 'mousePressed', 'mouseReleased'):
                    c('Input.dispatchMouseEvent', type=t, x=xy[0], y=xy[1], button='left', clickCount=1)
                time.sleep(1.5)
            if question[:30] in (c.js(_BOX_TEXT) or ''):
                return f'Error: {site} did not accept the question (the send button did not work)'
        last, same, end = '', 0, time.time() + wait
        while time.time() < end:   # done when a new answer exists and stops changing for ~3 s
            time.sleep(1)
            n, txt = c.js(f"(() => {{ const a = document.querySelectorAll({json.dumps(cfg['answer'])}); "
                          "return [a.length, a.length ? a[a.length - 1].innerText : '']; })()") or [0, '']
            if not (n > count and txt.strip()):   # the site renamed its answer element: the text after the question
                txt = c.js(_AFTER % json.dumps(question)) or ''
            if txt.strip():
                same = same + 1 if txt == last else 0
                last = txt
                if same >= 3:
                    return f'{site} answered:\n{_clean(txt)[:6000]}'
        return f'{site} answered (may still be writing):\n{_clean(last)[:6000]}' if last else f'Error: no answer from {site} in {wait} s'


# the chat sites' own labels around an answer, not part of it
_NOISE = re.compile(r'^(chatgpt said:?|you said:?|chatgpt can make mistakes.*|latest response|thinking effort|low|medium|high|response complete|'
                    r'deepthink|search|ai-generated, for reference only|copy|share|gemini (said|can make mistakes).*|show thinking|regenerate)$', re.I)


def _clean(text):
    return '\n'.join(l for l in (x.strip() for x in str(text).splitlines()) if l and not _NOISE.match(l))


def login_note(url):
    """Shown after `open` when a site sent Oma's window to a sign-in page (an expired session)."""
    import re
    return "\nNote: this site asks you to sign in. Sign in once in Oma's browser; Oma never types passwords." if re.search(LOGIN_PAGE, url or '', re.I) else ''


# Sign-in sites (Settings > Integrations): the user signs in by themselves in Oma's window; Oma only looks at what the
# page shows (its address, a chat box, a sign-in button), never at cookies, tokens or storage.
#   app: the site's own UI when signed in; out: sign-in markers; guest: the site also works signed out (its sign-in
#   button beats the chat box); in_url/out_url: addresses that already tell the state; in_text/out_text: words the page shows.
SIGNIN = {
    'chatgpt': {'name': 'ChatGPT', 'url': 'https://chatgpt.com/', 'login': 'https://chatgpt.com/auth/login', 'guest': True,
                'app': '#prompt-textarea, div[contenteditable=true]', 'out': '[data-testid="login-button"], [data-testid="signup-button"]'},
    'gemini': {'name': 'Gemini', 'url': 'https://gemini.google.com/app', 'guest': True,
               'app': 'rich-textarea', 'out': 'a[href*="accounts.google.com/ServiceLogin"], a[href*="accounts.google.com/v3/signin"]'},
    'deepseek': {'name': 'DeepSeek', 'url': 'https://chat.deepseek.com/', 'login': 'https://chat.deepseek.com/sign_in', 'app': 'textarea'},
    'gmail': {'name': 'Gmail', 'url': 'https://mail.google.com/mail/', 'app': 'div[gh="cm"], [role="navigation"] a[href*="#inbox"]',
              'in_url': r'mail\.google\.com/mail/u/\d+', 'out_url': r'workspace\.google\.com|google\.com/(intl/[^/]+/)?gmail/about'},
    'whatsapp': {'name': 'WhatsApp', 'url': 'https://web.whatsapp.com/', 'app': '#pane-side, [aria-label="Chat list"]',
                 'out': 'canvas[aria-label*="scan" i], div[data-ref] canvas', 'out_text': r'scan to log in|scan the qr code|link with phone number',
                 'in_text': r'loading your chats'},
    'facebook': {'name': 'Facebook', 'url': 'https://www.facebook.com/', 'login': 'https://www.facebook.com/login/',
                 'app': '[aria-label="Your profile"], [aria-label="Account controls and settings"], [role="feed"]',
                 'out': 'input[name="pass"], form[data-testid="royal_login_form"]'},
}
GOOGLE = ('gemini', 'gmail')   # sites that use one of the Google accounts signed in to Oma's browser
SITES_FILE = os.path.join(HOME, 'browser_sites.json')     # the user's own sign-in sites: [{id, name, url}]
STATUS_FILE = os.path.join(HOME, 'browser_status.json')   # the last check: {id: {state, detail, at}}
EMAIL = re.compile(r'^[\w.+-]+@[\w-]+(\.[\w-]+)+$')

# What a page shows, read from the page itself (no cookies, storage or form values): its address, the site's markers,
# a visible password box (only that it exists), sign-in buttons and robot checks.
_SIGNALS = r"""((app, out, outText, inText) => {
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
  const any = s => { if (!s) return false; try { return [...document.querySelectorAll(s)].some(vis); } catch (_) { return false; } };
  const btn = [...document.querySelectorAll('a,button,[role=button]')].some(e => { const t = (e.innerText || e.getAttribute('aria-label') || '').trim();
    return t.length < 40 && /^(log ?in|sign ?in)\b/i.test(t) && vis(e); });
  const words = (document.body ? document.body.innerText : '').slice(0, 3000), has = rx => !!rx && new RegExp(rx, 'i').test(words);
  return {url: location.href, title: document.title, ready: document.readyState, app: any(app) || has(inText), out: any(out) || has(outText),
    pass: any('input[type=password]'),
    button: btn, captcha: any('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="challenges.cloudflare.com"],#challenge-form,#captcha-form') ||
      /just a moment|unusual traffic|are you a robot|verify you are human/i.test(document.title)};
})(%s, %s, %s, %s)"""


def _load(path, empty):
    try:
        with open(path, encoding='utf-8') as f:
            v = json.load(f)
        return v if isinstance(v, type(empty)) else empty
    except (OSError, ValueError):
        return empty


def _save(path, value):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(value, f, ensure_ascii=False, indent=1)


def slug(name):
    return re.sub(r'[^a-z0-9]+', '-', str(name).lower()).strip('-')[:40]


def custom_sites():
    return [s for s in _load(SITES_FILE, []) if isinstance(s, dict) and s.get('id') and s.get('url')]


def signin_url(sid, login=False):
    """A site's address in Oma's browser; login=True: its sign-in page (Google sites: the account chooser, where the user
    picks or adds the account, e.g. the AI Pro one)."""
    import urllib.parse
    cfg = SIGNIN.get(sid) or next((s for s in custom_sites() if s['id'] == sid), None)
    if not cfg:
        return ''
    acct = site_account(sid) if sid in GOOGLE else ''
    url = cfg['url'] + (f'?authuser={acct}' if acct and sid == 'gemini' else '')
    if acct and sid == 'gmail':
        url = f'https://mail.google.com/mail/u/{acct}/'
    if login and sid in GOOGLE:
        return 'https://accounts.google.com/AccountChooser?continue=' + urllib.parse.quote(url, safe='')
    return (cfg.get('login') or url) if login else url


def sites():
    """Built-in and user-added sign-in sites with the last checked state ('' when never checked)."""
    last = _load(STATUS_FILE, {})
    rows = [{'id': k, 'name': v['name'], 'url': signin_url(k), 'custom': False} for k, v in SIGNIN.items()]
    rows += [{'id': s['id'], 'name': s.get('name') or s['id'], 'url': s['url'], 'custom': True} for s in custom_sites()]
    for r in rows:
        st = last.get(r['id']) if isinstance(last.get(r['id']), dict) else {}
        r.update(account=site_account(r['id']) if r['id'] in GOOGLE else '', state=st.get('state', ''), detail=st.get('detail', ''), at=st.get('at', ''))
    return rows


def decide(sid, s):
    """What a page's signals say about the sign-in. -> (signed_in | signed_out | blocked | unknown, why)."""
    cfg = SIGNIN.get(sid, {})
    url = (s or {}).get('url') or ''
    host = re.sub(r'^https?://([^/?#]+).*$', r'\1', url)
    if re.search(r'google\.com/sorry', url) or (s.get('captcha') and not s.get('app')):
        return 'blocked', 'the site asks to confirm you are not a robot (answer it yourself in Oma\'s browser)'
    if 'accounts.google.com' in url or re.search(LOGIN_PAGE, url, re.I) or (cfg.get('out_url') and re.search(cfg['out_url'], url)):
        return 'signed_out', f'sign-in page ({host})'
    if s.get('out') or s.get('pass') or (cfg.get('guest') and s.get('button')):
        return 'signed_out', 'the page shows a sign-in form or button' if sid != 'whatsapp' else 'WhatsApp shows the QR code to scan'
    if s.get('app') or (cfg.get('in_url') and re.search(cfg['in_url'], url)):
        return 'signed_in', 'the site opened its app' + (f' ({host})' if host else '')
    if s.get('button'):
        return 'signed_out', 'the page shows a sign-in button'
    if not cfg and s.get('ready') == 'complete' and url.startswith('http'):
        return 'unknown', 'no sign-in form seen (probably signed in)'
    return 'unknown', 'the page did not show its app or a sign-in page in time'


def _check_tab(sid, target, cap):
    """Watches one background tab until the verdict holds for two looks in a row (or the cap). -> (state, detail)."""
    cfg = SIGNIN.get(sid, {})
    expr = _SIGNALS % tuple(json.dumps(cfg.get(k, '')) for k in ('app', 'out', 'out_text', 'in_text'))
    end, last, seen, c = time.time() + cap, ('unknown', 'the page did not load in time'), 0, None
    try:
        c = _Cdp({'webSocketDebuggerUrl': f'ws://127.0.0.1:{PORT}/devtools/page/{target}'})
        while time.time() < end:
            time.sleep(0.6)
            try:
                s = c.js(expr, timeout=3) or {}
            except Exception:   # the page is navigating (a redirect to the sign-in page): look again
                continue
            v = decide(sid, s)
            seen = seen + 1 if v == last else 0
            last = v
            if v[0] != 'unknown' and seen >= 1 and (s.get('ready') == 'complete' or not cfg.get('guest')):   # guest sites: after the app's own check
                break
            if v[0] == 'unknown' and not cfg and s.get('ready') == 'complete' and seen >= 3:
                break   # a user-added site: no app marker to wait for
    except Exception as e:
        return 'unknown', f'could not look at the page: {str(e)[:120]}'
    finally:
        c and c.close()
    return last


def status(ids=None, cap=15):
    """Opens each site in a new background tab of Oma's browser, decides from what the page shows, closes those tabs.
    -> [{id, state, detail}] (also kept in browser_status.json)."""
    import threading
    known = {r['id']: r for r in sites()}
    ids = [i for i in (ids or list(known)) if i]
    out = {i: ('unknown', 'no such site') for i in ids if i not in known}
    todo = [i for i in ids if i in known]
    if todo:
        was_open = running()
        ensure()
        b = _Cdp({'webSocketDebuggerUrl': _http('/json/version')['webSocketDebuggerUrl']})
        tabs = {}
        try:
            for i in todo:
                try:
                    tabs[i] = b('Target.createTarget', url=signin_url(i), background=True)['targetId']
                except BrowserError as e:
                    out[i] = ('unknown', f'could not open a tab: {e}')
            res = {}
            th = [threading.Thread(target=lambda i=i, t=t: res.__setitem__(i, _check_tab(i, t, cap)), daemon=True) for i, t in tabs.items()]
            for t in th:
                t.start()
            for t in th:
                t.join(cap + 8)
            out.update({i: res.get(i, ('unknown', 'the check did not finish')) for i in tabs})
        finally:
            for t in tabs.values():   # only the tabs this check opened
                try:
                    b('Target.closeTarget', timeout=5, targetId=t)
                except Exception:
                    pass
            b.close()
            if not was_open:   # opened only for this check: no empty window is left in front of the user
                try:
                    close_browser()
                except Exception:
                    pass
    cache, at = _load(STATUS_FILE, {}), time.strftime('%Y-%m-%d %H:%M:%S')
    cache.update({i: {'state': s, 'detail': d, 'at': at} for i, (s, d) in out.items() if i in known})
    _save(STATUS_FILE, cache)
    return [{'id': i, 'state': out[i][0], 'detail': out[i][1]} for i in ids]


def login(sid):
    """Opens the site's sign-in page in a new tab of Oma's window, in front: the user signs in by themselves."""
    import urllib.parse
    url = signin_url(sid, login=True)
    if not url:
        return f'Error: unknown site "{sid}"'
    ensure()
    t = _http('/json/new?' + urllib.parse.quote(url, safe=':/?=&@%'), method='PUT')
    c = _Cdp(t)
    try:
        c('Page.bringToFront')
    finally:
        c.close()
    name = (SIGNIN.get(sid) or {}).get('name') or next((s.get('name') for s in custom_sites() if s['id'] == sid), sid)
    return f"opened {name} sign-in in Oma's browser: sign in there yourself (Oma never types passwords)"


def set_account(sid, email=''):
    email = (email or '').strip()
    if sid not in GOOGLE:
        return f'Error: only {" and ".join(GOOGLE)} use a chosen Google account'
    if email and not EMAIL.match(email):
        return f'Error: "{email}" is not an email address'
    acc = _load(ACCOUNTS, {})
    if email:
        acc[sid] = email
    else:
        acc.pop(sid, None)
    _save(ACCOUNTS, acc)
    return f'{SIGNIN[sid]["name"]} uses {email}' if email else f'{SIGNIN[sid]["name"]} uses the first signed-in Google account'


def add_site(name, url):
    import urllib.parse
    name, url, sid = ' '.join(str(name).split())[:60], str(url).strip(), slug(name)
    u = urllib.parse.urlparse(url)
    if u.scheme != 'https' or '.' not in u.netloc or ' ' in url:
        return 'Error: the address must start with https:// (for example https://example.com/)'
    if not sid:
        return 'Error: give the site a name'
    hosts = {urllib.parse.urlparse(v['url']).netloc for v in SIGNIN.values()}
    rows = custom_sites()
    if sid in SIGNIN or u.netloc in hosts:
        return f'Error: {name} is already in the list'
    if any(s['id'] == sid for s in rows):
        return f'Error: a site named "{name}" is already in the list'
    if len(rows) >= 30:
        return 'Error: at most 30 sites of your own'
    _save(SITES_FILE, rows + [{'id': sid, 'name': name, 'url': url}])
    return f'added {name}'


def remove_site(sid):
    if sid in SIGNIN:
        return f'Error: {SIGNIN[sid]["name"]} is built in and cannot be removed'
    rows = custom_sites()
    if not any(s['id'] == sid for s in rows):
        return f'Error: unknown site "{sid}"'
    _save(SITES_FILE, [s for s in rows if s['id'] != sid])
    cache = _load(STATUS_FILE, {})
    if cache.pop(sid, None) is not None:
        _save(STATUS_FILE, cache)
    return f'removed {sid}'


def signout_all():
    """Signs out of everything in Oma's browser: closes it and deletes ONLY its own profile folder (never the user's Chrome)."""
    import shutil
    prof = os.path.normcase(os.path.abspath(PROFILE))
    base = os.path.normcase(os.path.abspath(os.path.join(os.environ.get('LOCALAPPDATA', '') or '?', 'Atticus')))
    if os.path.basename(prof) != 'browser-profile' or os.path.dirname(prof) != base or os.path.islink(PROFILE):
        return f'Error: refusing to delete {PROFILE} (not Oma\'s browser profile)'
    if running():
        r = close_browser()
        if r.startswith('Error'):
            return r
    for n in range(12):   # Chrome lets go of its files a moment after the window closes
        try:
            if os.path.exists(PROFILE):
                shutil.rmtree(PROFILE)
            break
        except OSError as e:
            if n == 11:
                return f'Error: could not delete Oma\'s browser profile: {e}'
            time.sleep(0.5)
    try:
        os.remove(STATUS_FILE)
    except OSError:
        pass
    return "signed out of every site in Oma's browser (its profile was deleted; your own Chrome is untouched)"


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
        elif verb == 'sites':
            print(json.dumps(sites(), ensure_ascii=False))
        elif verb == 'status':
            print(json.dumps(status(rest), ensure_ascii=False))
        elif verb == 'login' and rest:
            print(login(rest[0]))
        elif verb == 'account' and rest:
            print(set_account(rest[0], rest[1] if len(rest) > 1 else ''))
        elif verb == 'add-site' and len(rest) >= 2:
            print(add_site(' '.join(rest[:-1]), rest[-1]))
        elif verb == 'remove-site' and rest:
            print(remove_site(rest[0]))
        elif verb == 'signout-all':
            print(signout_all())
        else:
            print('Error: usage: atticus --browser open <url> | read | click "<text>" | type "<field>" "<text>" [--enter] | key <name> | shot | tabs | '
                  'ask <deepseek|chatgpt|gemini> "<question>" | close | sites | status [id ...] | login <id> | account <gemini|gmail> [email] | '
                  'add-site "<name>" <https url> | remove-site <id> | signout-all')
    except BrowserError as e:
        print(f'Error: {e}')
    except Exception as e:
        print(f'Error: browser: {e}')
