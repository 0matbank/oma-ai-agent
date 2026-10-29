"""
Live model discovery and health, so no retired model ID is ever hardcoded as "the" model.

- Claude Code: the CLI's own aliases (haiku / sonnet / opus) are passed as-is; the CLI resolves them to the current
  model, and the resolved ID it reports (stream-json init / modelUsage) is remembered here for display.
- Ollama: /api/tags with capabilities; text requests prefer a non-vision model (qwen3-vl ignores think=false and is
  much slower for text), vision requests prefer a vision model.
- OpenAI-compatible clouds (Gemini, OpenAI, DeepSeek, Groq, custom): the provider's own model list, then a tiny real
  probe. A model can be listed yet unavailable to this account (Gemini answers 404 "no longer available to new users"),
  so only a probe proves it. Results are cached in model_health.json:
    ok -> trusted 24 h;  404/400 (gone) -> skipped 7 days;  429/503/timeout (busy) -> skipped 5 min.
"""
import json
import os
import re
import time
import urllib.error
import urllib.request

HOME = os.path.expanduser('~')
DIR = os.environ.get('ATTICUS_DIR') or os.path.join(os.environ.get('APPDATA') or os.path.join(HOME, '.config'), 'Atticus')
HEALTH_FILE = os.path.join(DIR, 'model_health.json')
OLLAMA = 'http://127.0.0.1:11434'

TTL = {'ok': 24 * 3600, 'gone': 7 * 24 * 3600, 'busy': 300, 'auth': 600, 'error': 300}
CLAUDE_ALIASES = ['haiku', 'sonnet', 'opus']


def _load():
    try:
        with open(HEALTH_FILE, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


def _save(d):
    try:
        os.makedirs(DIR, exist_ok=True)
        tmp = HEALTH_FILE + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(d, f, indent=1)
        os.replace(tmp, HEALTH_FILE)
    except Exception:
        pass


def record(provider, model, state, detail='', resolved=''):
    """state: ok | gone | busy | auth | error."""
    d = _load()
    rec = {'state': state, 'at': time.time(), 'detail': (detail or '')[:200]}
    if resolved:
        rec['resolved'] = resolved
    d.setdefault(provider, {})[model] = rec
    _save(d)


def health(provider, model):
    """The cached state if still fresh, else None (unknown)."""
    rec = _load().get(provider, {}).get(model)
    if not rec or time.time() - rec.get('at', 0) > TTL.get(rec.get('state'), 300):
        return None
    return rec


def claude_resolved(alias):
    rec = _load().get('claude_code', {}).get(alias) or {}
    return rec.get('resolved', '')


def classify_http(code, body=''):
    b = (body or '').lower()
    if code in (401, 403):
        return 'auth'
    if code == 404 or code == 400 and ('not found' in b or 'no longer available' in b or 'not supported' in b):
        return 'gone'
    if code in (429, 500, 502, 503, 504):
        return 'busy'
    return 'error'


# ---------------- Ollama ----------------
def ollama_models():
    try:
        with urllib.request.urlopen(urllib.request.Request(f'{OLLAMA}/api/tags', headers={'User-Agent': 'Oma-AI'}), timeout=2) as r:
            data = json.loads(r.read().decode('utf-8'))
    except Exception:
        return []
    out = []
    for m in data.get('models', []):
        name = m.get('name', '')
        caps = m.get('capabilities') or []
        det = m.get('details') or {}
        out.append({'name': name, 'vision': 'vision' in caps or bool(re.search(r'vl|vision|llava', name, re.I)),
                    'thinking': 'thinking' in caps, 'tools': 'tools' in caps, 'parameter_size': det.get('parameter_size', ''),
                    'quantization': det.get('quantization_level', ''), 'size_bytes': m.get('size', 0)})
    return out


def ollama_pick(models=None, vision=False):
    """Best installed model for the job: text -> a non-vision model first (faster, honours think=false)."""
    models = models if models is not None else ollama_models()
    if not models:
        return []
    ranked = sorted(models, key=lambda m: (m['vision'] != vision, m.get('size_bytes') or 0))
    return [m['name'] for m in ranked]


# ---------------- OpenAI-compatible clouds ----------------
def list_models(base_url, api_key, provider=''):
    """The provider's own list (ids without a 'models/' prefix). Gemini's native list also says which can generate."""
    ids = []
    try:
        if provider == 'gemini':
            req = urllib.request.Request('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', headers={'x-goog-api-key': api_key})
            with urllib.request.urlopen(req, timeout=10) as r:
                data = json.loads(r.read().decode('utf-8'))
            ids = [m['name'].split('/')[-1] for m in data.get('models', []) if 'generateContent' in m.get('supportedGenerationMethods', [])]
        else:
            req = urllib.request.Request(f"{base_url.rstrip('/')}/models", headers={'Authorization': f'Bearer {api_key}', 'User-Agent': 'Oma-AI'})
            with urllib.request.urlopen(req, timeout=10) as r:
                data = json.loads(r.read().decode('utf-8'))
            ids = [str(m.get('id', '')).split('/')[-1] if provider == 'gemini' else str(m.get('id', '')) for m in data.get('data', [])]
    except Exception:
        return []
    return [i for i in ids if i]


def _version(mid):
    m = re.search(r'(\d+(?:\.\d+)?)', mid)
    return float(m.group(1)) if m else 0.0


def rank_chat_models(provider, ids, preferred=()):
    """Chat-capable candidates, best first: user/known preference, then newest general text models."""
    bad = re.compile(r'tts|image|audio|embed|vision-only|live|native-audio|veo|imagen|lyria|robotics|computer-use|aqa|learnlm|banana|deep-research|customtools|transcribe|realtime|search|moderation|whisper|dall', re.I)
    usable = [i for i in ids if not bad.search(i)]
    if provider == 'gemini':
        usable = [i for i in usable if i.startswith('gemini') or i.startswith('gemma')]
        key = lambda i: ('flash' not in i, 'lite' in i, 'preview' in i or 'exp' in i, 'latest' in i, i.startswith('gemma'), -_version(i))
    else:
        key = lambda i: (-_version(i), len(i))
    ordered = sorted(dict.fromkeys(usable), key=key)
    pref = [p for p in preferred if p in ids or not ids]
    return list(dict.fromkeys(pref + ordered))


def probe(base_url, api_key, provider, model, timeout=12):   # a 5-token reply from a healthy model takes a few seconds; a hung one should not hold Settings for 25 s per model
    """One tiny real request. -> (state, detail)."""
    body = json.dumps({'model': model, 'messages': [{'role': 'user', 'content': 'Reply with OK.'}], 'max_tokens': 5}).encode()
    req = urllib.request.Request(f"{base_url.rstrip('/')}/chat/completions", data=body,
                                 headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json', 'User-Agent': 'Oma-AI'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            json.loads(r.read().decode('utf-8'))
        state, detail = 'ok', 'answered'
    except urllib.error.HTTPError as e:
        b = e.read().decode('utf-8', 'ignore')
        state, detail = classify_http(e.code, b), f'HTTP {e.code}: {_msg(b)}'
    except Exception as e:
        state, detail = 'busy', str(e)[:120]
    record(provider, model, state, detail)
    return state, detail


def _msg(body):
    try:
        j = json.loads(body)
        j = j[0] if isinstance(j, list) else j
        return (j.get('error') or {}).get('message', '')[:160] or body[:160]
    except Exception:
        return body[:160]


def cloud_candidates(provider, base_url, api_key, preferred=(), limit=3):
    """Models worth trying now, best first, skipping ones known to be gone/busy. Never probes more than needed:
    a model with a fresh 'ok' is used directly; unknown ones are returned so the real request itself is the probe."""
    ids = list_models(base_url, api_key, provider)
    ranked = rank_chat_models(provider, ids, preferred)
    out = []
    for mid in ranked:
        h = health(provider, mid)
        if h and h['state'] != 'ok':
            continue
        out.append(mid)
        if len(out) >= limit:
            break
    ok_first = sorted(out, key=lambda m: (health(provider, m) or {}).get('state') != 'ok')
    return ok_first, len(ids)
