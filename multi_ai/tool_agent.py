"""
Tool-calling fallback: when Claude Code (the Atticus engine) cannot run, a tools-capable model (Gemini / OpenAI-compatible
clouds, or Ollama) drives the SAME execution layer: one `bash` tool that runs a command in Git Bash with the Atticus
helper on PATH, exactly like Claude Code's Bash tool.

Safety is the engine's, not the model's: every command goes through atticus.risky() and the DENY list first; a risky
command waits for the user's Allow card (same ask folder / relay as the PreToolUse gate). A Don't Allow ends the task;
no other model or command is tried. A command is never run twice in one task. Text alone is never reported as an
action: run.ok for an action needs at least one command that ran.
"""
import json
import os
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

MAX_STEPS = 8
TOOL = {'type': 'function', 'function': {
    'name': 'bash',
    'description': 'Run ONE command in Git Bash on the user\'s Windows PC and get its output. The `atticus` helper is on PATH. '
                   'Open anything (web page, search URL, file, app, ms-settings: page): atticus --show "<url | path | app name>"; '
                   'in a browser the user named: atticus --show "chrome <url>" (or edge / firefox). '
                   'Do not use start or cmd to open URLs (Git Bash mangles them).',
    'parameters': {'type': 'object', 'properties': {'command': {'type': 'string', 'description': 'the command line'}}, 'required': ['command']}}}


def git_bash():
    """Claude Code's Bash on Windows is Git Bash; System32\\bash.exe is WSL and must not be used."""
    env = os.environ.get('CLAUDE_CODE_GIT_BASH_PATH')
    if env and os.path.exists(env):
        return env
    git = shutil.which('git')
    if git:
        for rel in (('..', 'bin', 'bash.exe'), ('..', '..', 'bin', 'bash.exe')):
            p = os.path.normpath(os.path.join(os.path.dirname(git), *rel))
            if os.path.exists(p):
                return p
    for p in (r'C:\Program Files\Git\bin\bash.exe', r'C:\Program Files (x86)\Git\bin\bash.exe'):
        if os.path.exists(p):
            return p
    return ''


def denied_by_rule(cmd, deny):
    """The engine's --disallowedTools list ('Bash(rm:*)' ...), applied to every part of a compound command."""
    import re
    heads = [p.strip() for p in re.split(r'[;&|\n]', cmd) if p.strip()]
    for rule in deny:
        prefix = rule[len('Bash('):-len(':*)')] if rule.startswith('Bash(') else ''
        if prefix and any(h == prefix or h.startswith(prefix + ' ') for h in heads):
            return prefix
    return ''


def _post(url, body, key, timeout):
    req = urllib.request.Request(url, data=json.dumps(body).encode('utf-8'), headers={
        'Content-Type': 'application/json', 'User-Agent': 'Oma-AI', **({'Authorization': f'Bearer {key}'} if key else {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode('utf-8'))


def _chat(provider, base_url, key, model, messages, timeout=None):
    """-> (text, [(call_id, command)]) in one shape for OpenAI-compatible clouds and Ollama's native /api/chat."""
    from multi_ai.adapters import cli_agents
    if provider in cli_agents.CLI:
        return _chat_cli(provider, model, messages)
    timeout = timeout or (120 if provider == 'ollama' else 30)   # a local model may need to load first; a busy cloud is skipped sooner
    if provider == 'ollama':
        j = _post(f'{base_url.rstrip("/")}/api/chat', {'model': model, 'messages': messages, 'tools': [TOOL], 'stream': False,
                                                        'think': False, 'keep_alive': '10m', 'options': {'num_predict': 600}}, '', timeout)
        m = j.get('message') or {}
        calls = [(f'c{i}', (c.get('function') or {}).get('arguments', {}).get('command', '')) for i, c in enumerate(m.get('tool_calls') or [])]
        return (m.get('content') or '').strip(), calls, m
    j = _post(f'{base_url.rstrip("/")}/chat/completions', {'model': model, 'messages': messages, 'tools': [TOOL], 'max_tokens': 800}, key, timeout)
    m = (j.get('choices') or [{}])[0].get('message') or {}
    calls = []
    for c in m.get('tool_calls') or []:
        try:
            calls.append((c.get('id') or f'c{len(calls)}', json.loads((c.get('function') or {}).get('arguments') or '{}').get('command', '')))
        except ValueError:
            calls.append((c.get('id') or f'c{len(calls)}', ''))
    return (m.get('content') or '').strip(), calls, m


CLI_STEP = ('\n\nHow to answer (you are only the planner; Oma runs commands, you never do): reply with ONLY a JSON object. '
            'To run one command on the PC: {"command": "<one Git Bash command>", "reply": ""}. '
            'When the task is done, or for a plain question: {"command": "", "reply": "<short answer in the user\'s language>"}. '
            'Never use your own tools, never edit files.')


def _chat_cli(provider, model, messages):
    """An account-login CLI (Codex / Antigravity / DeepSeek Harness) as the planner: the whole conversation goes in one
    prompt, the answer is {"command"} or {"reply"}; the command then runs through _one() and the gate like any model's."""
    from multi_ai.adapters import cli_agents
    lines = []
    for m in messages:
        role, c = m.get('role'), m.get('content') or ''
        if role == 'system':
            lines.insert(0, c + CLI_STEP)
        elif role == 'user':
            lines.append(f'User request: {c}')
        elif role == 'assistant':
            lines.append(f'You answered: {c}')
        elif role == 'tool':
            lines.append(f'Oma ran it. Output:\n{c[-3000:]}')
    text, j = cli_agents.ask(provider, '\n\n'.join(lines), model, schema=cli_agents.STEP_SCHEMA)
    j = j or {}
    cmd, reply = (j.get('command') or '').strip(), (j.get('reply') or '').strip()
    if not cmd and not reply:
        reply = text.strip()
    raw = {'content': json.dumps({'command': cmd} if cmd else {'reply': reply}, ensure_ascii=False), 'tool_calls': None}
    return reply, ([(f'cli{len(messages)}', cmd)] if cmd else []), raw


def _cli_error():
    from multi_ai.adapters.cli_agents import CliError
    return CliError


def run_agent(task, provider, model, base_url, key, system, eng, tracker=None):
    """eng: the atticus module (risky, DENY, ask_user, relay, shim_env, label, pref). -> dict(ok, reply, cmds, steps, denied, error_type, error)."""
    bash = git_bash()
    if not bash:
        return {'ok': False, 'reply': '', 'cmds': [], 'steps': [], 'denied': False, 'error_type': 'not_available', 'error': 'Git Bash not found'}
    ask = tempfile.mkdtemp(prefix='atticus-ask-')
    os.environ['ATTICUS_ASK'] = ask

    class _Live:   # relay() serves the Allow card while this object "runs"
        def __init__(self):
            self.ask, self.done = ask, False

        def poll(self):
            return 0 if self.done else None
    live = _Live()
    import threading
    threading.Thread(target=eng.relay, args=(live,), daemon=True).start()
    messages = [{'role': 'system', 'content': system}, {'role': 'user', 'content': task}]
    cmds, steps, seen, out = [], [], {}, {'ok': False, 'reply': '', 'denied': False, 'error_type': '', 'error': ''}
    try:
        for _ in range(MAX_STEPS):
            try:
                text, calls, raw = _chat(provider, base_url, key, model, messages)
            except _cli_error() as e:
                out.update(error_type=e.kind, error=e.msg[:300])
                break
            except urllib.error.HTTPError as e:
                b = e.read().decode('utf-8', 'ignore')[:300]
                from multi_ai.model_catalog import classify_http
                kind = {'auth': 'auth_error', 'gone': 'model_unavailable', 'busy': 'rate_limited'}.get(classify_http(e.code, b), 'http_error')
                out.update(error_type=kind, error=f'HTTP {e.code}: {b}')
                break
            except Exception as e:
                out.update(error_type='timeout' if 'timed out' in str(e).lower() else 'network_error', error=str(e)[:300])
                break
            if not calls:
                out['reply'] = text
                break
            if provider == 'ollama':
                messages.append({'role': 'assistant', 'content': raw.get('content') or '', 'tool_calls': raw.get('tool_calls')})
            else:
                messages.append({'role': 'assistant', 'content': raw.get('content'), 'tool_calls': raw.get('tool_calls')})
            for cid, cmd in calls:
                result, failed = _one(cmd, cid, eng, bash, seen, cmds, steps, tracker, out)
                messages.append({'role': 'tool', 'tool_call_id': cid, 'content': result} if provider != 'ollama' else
                                {'role': 'tool', 'content': result, 'tool_name': 'bash'})
                if out['denied']:
                    break
            if out['denied']:
                out['reply'] = "Not done: you chose Don't Allow, so nothing was changed."
                break
        else:
            out.update(error_type='step_limit', error=f'stopped after {MAX_STEPS} steps')
    finally:
        live.done = True
        os.environ.pop('ATTICUS_ASK', None)
        shutil.rmtree(ask, True)
    out['ok'] = bool(cmds) and bool(out['reply']) and not out['denied'] and not out['error_type']
    out['cmds'], out['steps'] = cmds, steps
    return out


def _one(cmd, cid, eng, bash, seen, cmds, steps, tracker, out):
    cmd = (cmd or '').strip()
    if not cmd:
        return 'Error: empty command', True
    if cmd in seen:   # never repeat a real-world action inside one task
        return f'Already ran this exact command in this task; its output was:\n{seen[cmd]}', False
    lbl = eng.label('Bash', {'command': cmd})
    steps.append(lbl)
    eng.say('▸', lbl)
    if tracker is not None:
        tracker.step_start(cid, 'Bash', {'command': cmd}, lbl)
    rule = denied_by_rule(cmd, eng.DENY)
    if rule:
        msg = f'Blocked: "{rule}" is never allowed for Oma.'
        if tracker is not None:
            tracker.step_end(cid, False, msg)
        return msg, True
    q = eng.risky(cmd)
    if q and eng.pref('safe', True):
        if eng.ask_user({'q': q, 'cmd': cmd[:800]}, 60) != 'y':
            out['denied'] = True
            if tracker is not None:
                tracker.step_end(cid, False, 'The user said no.')
            return 'The user said no. Do not try another way; say it was not done.', True
    try:
        r = subprocess.run([bash, '-c', cmd], capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=60,
                           env=eng.shim_env(), cwd=tempfile.gettempdir(), creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        res, failed = ((r.stdout or '') + (r.stderr or '')).strip()[-4000:] or f'(exit code {r.returncode}, no output)', r.returncode != 0
    except subprocess.TimeoutExpired:
        res, failed = 'Error: the command timed out after 60 s', True
    cmds.append(cmd)
    seen[cmd] = res[:1000]
    if tracker is not None:
        tracker.step_end(cid, not failed, eng.clean(res))
    return res, failed
