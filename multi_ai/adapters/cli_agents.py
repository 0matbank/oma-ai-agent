"""
Account-login AI CLIs (no API key) as Oma's cloud fallbacks after Claude Code:
  codex_cli        OpenAI Codex CLI, "Sign in with ChatGPT" (the ChatGPT plan's allowance)
  antigravity_cli  Google Antigravity CLI `agy`, Google account sign-in (Gemini models)
  deepseek_cli     DeepSeek Harness `dsh` (developer preview), DeepSeek account sign-in
Each is used as a BRAIN only: it answers in JSON and never runs commands itself. Oma's tool agent runs the command
through the same safety gate (risky() + Allow card + DENY list) as every other model, so switching from Claude to
any of these never bypasses a permission.
"""
import json
import os
import re
import shutil
import subprocess
import tempfile
import time

CLI = {
    'codex_cli': {'name': 'ChatGPT (Codex CLI)', 'exe': ('codex',), 'login': 'codex login', 'models': ['default']},
    'antigravity_cli': {'name': 'Gemini (Antigravity CLI)', 'exe': ('agy', 'antigravity'), 'login': 'agy',
                        'models': ['gemini-3.8-flash-low', 'gemini-3.8-flash-medium']},
    # dsh's headless profile runs its own bash tool (it would skip Oma's gate) and signs in through `dsh web`:
    # listed, but used only once a gate-respecting mode passes a real test
    'deepseek_cli': {'name': 'DeepSeek (DeepSeek Harness)', 'exe': ('dsh',), 'login': 'dsh web', 'models': ['default'], 'experimental': True},
}
ORDER = ('codex_cli', 'antigravity_cli', 'deepseek_cli')   # after Claude Code, before API-key clouds and local models
STEP_SCHEMA = {'type': 'object', 'properties': {'command': {'type': 'string'}, 'reply': {'type': 'string'}}}


class CliError(Exception):
    def __init__(self, kind, msg):
        super().__init__(msg)
        self.kind, self.msg = kind, msg


def exe(pid):
    for name in CLI.get(pid, {}).get('exe', ()):
        p = shutil.which(name)
        if p:
            return p
    return ''


def installed():
    """Installed CLIs that Oma may use (an experimental one only after it is verified)."""
    return [pid for pid in ORDER if exe(pid) and not CLI[pid].get('experimental')]


def classify(text):
    """CLI error text -> the health monitor's error types."""
    t = (text or '').lower()
    if re.search(r'not (?:logged|signed) in|login required|please (?:log|sign) ?in|unauthori[sz]ed|authenticat', t):
        return 'auth_error'
    if re.search(r'usage limit|quota|limit reached|hit your limit|insufficient|exceeded your', t):
        return 'quota_exhausted'
    if re.search(r'rate.?limit|429|too many requests|overloaded|capacity', t):
        return 'rate_limited'
    if re.search(r'timed? ?out|deadline', t):
        return 'timeout'
    if re.search(r'model .*(not found|unavailable|not supported)|unknown model', t):
        return 'model_unavailable'
    if re.search(r'network|connection|resolve host|offline', t):
        return 'network_error'
    return 'error'


def _workdir():   # an empty folder: the CLIs never index or touch the user's files
    d = os.path.join(tempfile.gettempdir(), 'oma-cli-agents')
    os.makedirs(d, exist_ok=True)
    return d


def _json_in(text):
    """The last {...} object in free text (a CLI that ignores the schema)."""
    for m in reversed(list(re.finditer(r'\{[^{}]*\}', text or '', re.S))):
        try:
            return json.loads(m.group(0))
        except ValueError:
            continue
    return None


def _run(argv, stdin=None, timeout=120):
    try:
        r = subprocess.run(argv, input=stdin, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=timeout,
                           cwd=_workdir(), creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    except subprocess.TimeoutExpired:
        raise CliError('timeout', f'no answer in {timeout} s')
    except OSError as e:
        raise CliError('not_available', str(e))
    return r.returncode, r.stdout or '', r.stderr or ''


def ask(pid, prompt, model='', schema=None, timeout=120):
    """One non-interactive turn. -> (text, structured dict or None). Raises CliError(kind, msg)."""
    path = exe(pid)
    if not path:
        raise CliError('not_available', f"{CLI[pid]['name']} is not installed")
    model = '' if model in ('', 'default') else model
    if pid == 'antigravity_cli':
        argv = [path, '-p', prompt[-24000:], '--output-format', 'json', '--disable-slash-commands', '--sandbox',
                '--print-timeout', f'{timeout}s'] + (['--json-schema', json.dumps(schema)] if schema else []) + (['--model', model] if model else [])
        code, out, err = _run(argv, timeout=timeout + 15)
        try:
            j = json.loads(out.strip().splitlines()[-1]) if out.strip() else {}
        except ValueError:
            j = {}
        if code != 0 or str(j.get('status', '')).upper() not in ('SUCCESS', ''):
            msg = (j.get('error') or j.get('response') or err or out or f'exit {code}').strip()[:400]
            raise CliError(classify(msg), msg)
        text = (j.get('response') or '').strip()
        return text, j.get('structured_output') if isinstance(j.get('structured_output'), dict) else _json_in(text)
    if pid == 'codex_cli':
        o = tempfile.NamedTemporaryFile('w', suffix='.txt', delete=False); o.close()
        sf = ''
        if schema:   # the Responses API's strict JSON schema: every property listed and required
            props = {k: {'type': 'string'} for k in schema['properties']}
            f = tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8')
            json.dump({'type': 'object', 'properties': props, 'required': list(props), 'additionalProperties': False}, f); f.close()
            sf = f.name
        argv = [path, 'exec', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only', '--color', 'never', '-o', o.name] + \
               (['--output-schema', sf] if sf else []) + (['-m', model] if model else []) + ['-']
        try:
            code, out, err = _run(argv, stdin=prompt, timeout=timeout)
            text = open(o.name, encoding='utf-8', errors='replace').read().strip()
        finally:
            for p in (o.name, sf):
                if p and os.path.exists(p):
                    os.remove(p)
        if code != 0 or not text:
            msg = (err or out or f'exit {code}').strip()[-400:]
            raise CliError(classify(msg), msg)
        return text, _json_in(text)
    if pid == 'deepseek_cli':
        raise CliError('not_available', 'DeepSeek Harness has no verified non-interactive mode yet')
    raise CliError('not_available', f'unknown CLI {pid}')


def signed_in(pid):
    """Cheap sign-in check with no model request. -> (True | False | None, why)."""
    path = exe(pid)
    if not path:
        return False, 'not installed'
    try:
        if pid == 'codex_cli':
            code, out, err = _run([path, 'login', 'status'], timeout=20)
            t = (out + err).strip()
            return (code == 0 and 'not' not in t.lower()), t[:160] or f'exit {code}'
        if pid == 'antigravity_cli':
            code, out, err = _run([path, 'models'], timeout=40)
            return (code == 0 and '\t' in out), ('signed in' if code == 0 else (err or out)[:160])
    except CliError as e:
        return None, e.msg
    return None, 'no sign-in check for this CLI'


class CliAgentAdapter:
    """Router adapter for TEXT answers (no PC actions): same shape as the OpenAI-compatible adapter."""
    def __init__(self, pid):
        self.pid, self.name, self.local = pid, CLI[pid]['name'], False

    def is_available(self):
        return bool(exe(self.pid))

    def generate(self, model, prompt, system_prompt=''):
        t0 = time.time()
        try:
            text, j = ask(self.pid, (system_prompt + '\n\n' if system_prompt else '') + 'Do not use any tools; just answer.\n\n' + prompt,
                          model, schema={'type': 'object', 'properties': {'reply': {'type': 'string'}}}, timeout=90)
        except CliError as e:
            return {'success': False, 'error_type': e.kind, 'error': e.msg}
        reply = ((j or {}).get('reply') or text or '').strip()
        return {'success': bool(reply), 'reply': reply, 'error_type': '' if reply else 'empty_output', 'error': '' if reply else 'empty answer',
                'resolved_model': model, 'latency': time.time() - t0}
