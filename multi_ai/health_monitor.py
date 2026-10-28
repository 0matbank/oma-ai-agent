"""
AI Provider Health Monitor: which models are likely to work BEFORE a command arrives.

- refresh() is lightweight and never runs inference: Claude Code = CLI present + signed in + plan-limit cooldown;
  Ollama = /api/tags (installed, capabilities) + /api/ps (what is loaded in VRAM); clouds = their free model-list
  endpoint (proves the key and lists live models). Atticus.exe calls it at startup, every healthInterval seconds
  (default 300) and when AI settings change, on a background thread.
- record() is called with the outcome of every real request, so real traffic is the probe. Repeated failures open a
  circuit breaker (COOLDOWN with exponential backoff); quota / rate-limit reset times are kept.
- Everything persists in provider_health.json, so cooldowns survive restarts.
- order() filters and ranks the router's candidates by health. A manual model that is unavailable is never silently
  replaced: it is reported, and another model is used only when Fallback is on, with the reason recorded.

States: READY DEGRADED RATE_LIMITED QUOTA_EXHAUSTED AUTH_REQUIRED MODEL_RETIRED OFFLINE UNKNOWN COOLDOWN
"""
import json
import os
import re
import shutil
import subprocess
import time
import urllib.error
import urllib.request

HOME = os.path.expanduser('~')
DIR = os.environ.get('ATTICUS_DIR') or os.path.join(os.environ.get('APPDATA') or os.path.join(HOME, '.config'), 'Atticus')
FILE = os.path.join(DIR, 'provider_health.json')
OLLAMA = 'http://localhost:11434'
BLOCKING = {'RATE_LIMITED', 'QUOTA_EXHAUSTED', 'AUTH_REQUIRED', 'MODEL_RETIRED', 'OFFLINE', 'COOLDOWN'}
BREAKER = 3   # consecutive failures that open the circuit
# request error_type -> (state, default seconds until it may be tried again; 0 = until something changes)
ERRORS = {'quota_exhausted': ('QUOTA_EXHAUSTED', 1800), 'rate_limited': ('RATE_LIMITED', 60), 'busy': ('RATE_LIMITED', 60),
          'auth_error': ('AUTH_REQUIRED', 0), 'auth': ('AUTH_REQUIRED', 0), 'model_unavailable': ('MODEL_RETIRED', 7 * 86400),
          'gone': ('MODEL_RETIRED', 7 * 86400), 'network_error': ('OFFLINE', 60), 'timeout': ('DEGRADED', 120),
          'empty_output': ('DEGRADED', 120), 'not_available': ('OFFLINE', 300), 'not_configured': ('AUTH_REQUIRED', 0)}


def _now():
    return time.time()


def load():
    try:
        with open(FILE, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {'providers': {}, 'switch': None, 'checked': 0}


def save(d):
    try:
        os.makedirs(DIR, exist_ok=True)
        tmp = FILE + f'.{os.getpid()}.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(d, f, indent=1)
        os.replace(tmp, FILE)
    except Exception:
        pass


def _settings():
    try:
        with open(os.path.join(DIR, 'settings.json'), encoding='utf-8-sig') as f:
            return json.load(f)
    except Exception:
        return {}


def _prov(d, pid):
    return d.setdefault('providers', {}).setdefault(pid, {'state': 'UNKNOWN', 'reason': '', 'checked': 0, 'models': {}})


def _model(p, mid):
    return p.setdefault('models', {}).setdefault(mid, {'state': 'UNKNOWN', 'reason': '', 'fails': 0})


def _effective(rec):
    """A blocking state whose retry time has passed is UNKNOWN again: the next real request is the bounded recheck."""
    st = rec.get('state', 'UNKNOWN')
    if st in BLOCKING and rec.get('retry_at') and rec['retry_at'] <= _now():
        return 'UNKNOWN'
    return st


def status(pid, mid=''):
    """-> (state, reason, retry_at) for a provider, or a model of it (the worse of the two)."""
    p = load().get('providers', {}).get(pid) or {}
    pst = _effective(p) if p else 'UNKNOWN'
    if pst in BLOCKING:
        return pst, p.get('reason', ''), p.get('retry_at', 0)
    m = (p.get('models') or {}).get(mid) if mid else None
    if m:
        mst = _effective(m)
        if mst != 'UNKNOWN' or pst == 'UNKNOWN':
            return mst, m.get('reason', ''), m.get('retry_at', 0)
    return pst, p.get('reason', ''), p.get('retry_at', 0)


def usable(pid, mid=''):
    return status(pid, mid)[0] not in BLOCKING


def record(pid, mid, ok, error_type='', detail='', latency=0.0, retry_at=0.0):
    """The outcome of one real request. Quota / rate limits are provider-wide; a retired model is per model."""
    d = load()
    p = _prov(d, pid)
    m = _model(p, mid or '-')
    t = _now()
    if ok:
        m.update(state='READY', reason=f'answered in {latency:.1f}s' if latency else 'answered', fails=0, last_ok=t, at=t, retry_at=0)
        if latency:
            m['latency'] = round(latency, 1)
        if p.get('state') != 'READY' or p.get('retry_at'):
            p.update(state='READY', reason='a request succeeded', retry_at=0)
        p['fails'] = 0
    elif error_type:
        state, wait = ERRORS.get(error_type, ('DEGRADED', 120))
        m['fails'] = m.get('fails', 0) + 1
        p['fails'] = p.get('fails', 0) + 1
        until = retry_at or (t + wait if wait else 0)
        if m['fails'] >= BREAKER and state in ('DEGRADED', 'OFFLINE', 'RATE_LIMITED'):
            state, until = 'COOLDOWN', t + min(60 * 2 ** (m['fails'] - BREAKER), 1800)   # circuit open: 1, 2, 4 ... 30 min
            detail = f'{m["fails"]} failures in a row: {detail}'
        m.update(state=state, reason=(detail or error_type)[:200], at=t, retry_at=until)
        if state in ('QUOTA_EXHAUSTED', 'AUTH_REQUIRED') or (state == 'OFFLINE' and pid in ('ollama', 'lm_studio')):
            p.update(state=state, reason=(detail or error_type)[:200], retry_at=until)
    save(d)


def note_switch(frm, to, reason):
    d = load()
    d['switch'] = {'at': _now(), 'from': frm, 'to': to, 'reason': reason[:240]}
    save(d)


# ---------------- lightweight checks (no inference) ----------------
def _get(url, headers=None, timeout=6):
    req = urllib.request.Request(url, headers={'User-Agent': 'Oma-AI', **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode('utf-8'))


def _gpu_free_mb():
    try:
        out = subprocess.run(['nvidia-smi', '--query-gpu=memory.used,memory.total', '--format=csv,noheader,nounits'],
                             capture_output=True, text=True, timeout=5, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)).stdout
        used, total = [int(x) for x in out.splitlines()[0].split(',')]
        return total - used, total
    except Exception:
        return None, None


def _check_claude(p):
    t = _now()
    if not shutil.which('claude'):
        p.update(state='OFFLINE', reason='Claude Code CLI is not installed', checked=t)
        return
    creds = os.path.join(HOME, '.claude', '.credentials.json')
    if not os.path.exists(creds) and not os.environ.get('ANTHROPIC_API_KEY'):
        p.update(state='AUTH_REQUIRED', reason='Claude Code is not signed in (run claude, then /login)', checked=t)
        return
    if p.get('state') == 'QUOTA_EXHAUSTED' and p.get('retry_at', 0) > t:
        p['checked'] = t   # keep the cooldown: Claude is not launched until the reported reset time
        return
    if p.get('state') in ('OFFLINE', 'AUTH_REQUIRED', 'QUOTA_EXHAUSTED', 'UNKNOWN'):
        p.update(state='READY' if p.get('state') != 'QUOTA_EXHAUSTED' else 'UNKNOWN',
                 reason='CLI installed and signed in' if p.get('state') != 'QUOTA_EXHAUSTED' else 'plan limit reset time passed; the next request rechecks',
                 retry_at=0)
    p['checked'] = t
    for alias in ('haiku', 'sonnet', 'opus'):
        _model(p, alias).setdefault('caps', {'tools': True, 'vision': True})


def _check_ollama(p):
    t = _now()
    try:
        tags = _get(f'{OLLAMA}/api/tags', timeout=2)
        ps = _get(f'{OLLAMA}/api/ps', timeout=2)
    except Exception as e:
        p.update(state='OFFLINE', reason=f'Ollama is not running ({str(e)[:80]})', checked=t, retry_at=0)
        return
    loaded = {m.get('name'): m.get('size_vram', 0) for m in ps.get('models', [])}
    free, total = _gpu_free_mb()
    names = set()
    for m in tags.get('models', []):
        name = m.get('name', '')
        names.add(name)
        caps = m.get('capabilities') or []
        rec = _model(p, name)
        rec['caps'] = {'tools': 'tools' in caps, 'vision': 'vision' in caps or bool(re.search(r'vl|vision|llava', name, re.I)),
                       'thinking': 'thinking' in caps}
        rec['size_mb'] = round((m.get('size') or 0) / 2 ** 20)
        rec['loaded'] = name in loaded
        if rec.get('state') == 'MODEL_RETIRED':
            rec.update(state='UNKNOWN', reason='installed again', retry_at=0)
    for name, rec in p['models'].items():
        if name not in names and rec.get('state') != 'MODEL_RETIRED':
            rec.update(state='MODEL_RETIRED', reason='no longer installed in Ollama', retry_at=0)
    p.update(state='READY' if names else 'DEGRADED', reason=f'{len(names)} models installed, {len(loaded)} loaded' if names else 'no models installed',
             checked=t, retry_at=0, loaded=sorted(loaded), vram_free_mb=free, vram_total_mb=total)


def _check_cloud(p, pid, d_def, key):
    from multi_ai.model_catalog import list_models, rank_chat_models, health
    t = _now()
    if not key:
        p.update(state='AUTH_REQUIRED', reason='no API key saved', checked=t, retry_at=0)
        return
    try:
        if pid == 'gemini':
            data = _get('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {'x-goog-api-key': key}, timeout=8)
            ids = [m['name'].split('/')[-1] for m in data.get('models', []) if 'generateContent' in m.get('supportedGenerationMethods', [])]
        else:
            data = _get(f"{d_def['base_url'].rstrip('/')}/models", {'Authorization': f'Bearer {key}'}, timeout=8)
            ids = [str(m.get('id', '')) for m in data.get('data', [])]
    except urllib.error.HTTPError as e:
        state = 'AUTH_REQUIRED' if e.code in (401, 403) else 'RATE_LIMITED' if e.code == 429 else 'DEGRADED'
        p.update(state=state, reason=f'model list HTTP {e.code}', checked=t, retry_at=t + (0 if state == 'AUTH_REQUIRED' else 300))
        return
    except Exception as e:
        p.update(state='OFFLINE', reason=f'unreachable ({str(e)[:80]})', checked=t, retry_at=t + 300)
        return
    live = set(ids)
    for mid in rank_chat_models(pid, ids, d_def.get('preferred_models', ()))[:8]:
        rec = _model(p, mid)
        h = health(pid, mid)   # the probe/request cache of model_catalog
        if h and rec.get('state') in ('UNKNOWN', None):
            rec.update(state={'ok': 'READY', 'gone': 'MODEL_RETIRED', 'busy': 'RATE_LIMITED', 'auth': 'AUTH_REQUIRED'}.get(h['state'], 'DEGRADED'),
                       reason=h.get('detail', ''), at=h.get('at', t))
        rec.setdefault('caps', {'tools': True, 'vision': pid in ('gemini', 'openai')})
    for mid, rec in p['models'].items():
        if live and mid not in live:
            rec.update(state='MODEL_RETIRED', reason=f'{pid} no longer lists this model', retry_at=0)
    if p.get('state') not in ('QUOTA_EXHAUSTED',) or p.get('retry_at', 0) <= t:
        p.update(state='READY', reason=f'key valid, {len(ids)} models listed', retry_at=0)
    p['checked'] = t


def refresh():
    """One lightweight pass over every provider. Returns the snapshot."""
    from multi_ai.providers import get_secret, provider_mgr
    d = load()
    _check_claude(_prov(d, 'claude_code'))
    _check_ollama(_prov(d, 'ollama'))
    for pid in ('gemini', 'openai', 'deepseek', 'groq') + tuple(c['id'] for c in provider_mgr.customs()):
        d_def = provider_mgr.definition(pid) or {}
        if d_def.get('base_url'):
            _check_cloud(_prov(d, pid), pid, d_def, get_secret(f'ai_key_{pid}'))
    s = _settings()
    active = str(s.get('activeModel') or '')
    if '/' in active:   # the user's own pick: flagged when gone, never replaced in the setting
        pid, mid = active.split('/', 1)
        pid = 'claude_code' if pid == 'claude' else pid
        st, why, _ = status_in(d, pid, mid)
        d['selected'] = {'id': active, 'state': st, 'reason': why}
    d['checked'] = _now()
    d['interval'] = int(s.get('healthInterval') or 300)
    save(d)
    return snapshot(d)


def status_in(d, pid, mid):
    p = d.get('providers', {}).get(pid) or {}
    m = (p.get('models') or {}).get(mid) or {}
    pst, mst = _effective(p) if p else 'UNKNOWN', _effective(m) if m else 'UNKNOWN'
    if pst in BLOCKING:
        return pst, p.get('reason', ''), p.get('retry_at', 0)
    if mst != 'UNKNOWN':
        return mst, m.get('reason', ''), m.get('retry_at', 0)
    return pst, p.get('reason', ''), p.get('retry_at', 0)


def snapshot(d=None):
    """For the Settings page: per provider, its state, reason, next retry and models."""
    d = d or load()
    out = []
    for pid, p in sorted(d.get('providers', {}).items()):
        models = [{'id': mid, 'state': _effective(m), 'reason': m.get('reason', ''), 'retry_at': m.get('retry_at', 0),
                   'latency': m.get('latency'), 'loaded': m.get('loaded'), 'tools': (m.get('caps') or {}).get('tools')}
                  for mid, m in sorted(p.get('models', {}).items()) if mid != '-']
        out.append({'id': pid, 'state': _effective(p), 'reason': p.get('reason', ''), 'retry_at': p.get('retry_at', 0),
                    'checked': p.get('checked', 0), 'models': models, 'vram_free_mb': p.get('vram_free_mb'), 'loaded': p.get('loaded')})
    return {'providers': out, 'switch': d.get('switch'), 'selected': d.get('selected'), 'checked': d.get('checked', 0),
            'interval': d.get('interval', 300), 'now': _now()}


def order(cands, settings=None, need_tools=False):
    """Router candidates [(pid, mid)] -> healthy, task-capable ones first; blocked ones dropped. -> (ordered, skipped)."""
    d = load()
    keep, skipped = [], []
    for pid, mid in cands:
        st, why, until = status_in(d, pid, mid)
        caps = ((d.get('providers', {}).get(pid) or {}).get('models', {}).get(mid) or {}).get('caps') or {}
        if st in BLOCKING:
            skipped.append({'provider': pid, 'model': mid, 'state': st, 'reason': why, 'retry_at': until})
        elif need_tools and caps.get('tools') is False:
            skipped.append({'provider': pid, 'model': mid, 'state': st, 'reason': 'cannot call tools'})
        else:
            keep.append((pid, mid, st))
    rank = {'READY': 0, 'UNKNOWN': 1, 'DEGRADED': 2}
    keep.sort(key=lambda c: rank.get(c[2], 3))   # stable: user order kept within a state
    return [(p, m) for p, m, _ in keep], skipped


def ollama_fit(names):
    """Prefer an Ollama model that is already loaded, else one that fits in free VRAM: never load a second big model."""
    p = load().get('providers', {}).get('ollama') or {}
    models, free = p.get('models', {}), p.get('vram_free_mb')
    loaded = [n for n in names if (models.get(n) or {}).get('loaded')]
    fits = [n for n in names if n not in loaded and (free is None or not p.get('loaded') or (models.get(n) or {}).get('size_mb', 0) < free - 512)]
    return loaded + fits or names[:1]


def main(args):
    if args and args[0] == '--health-refresh':
        print(json.dumps(refresh()))
    else:
        print(json.dumps(snapshot()))
