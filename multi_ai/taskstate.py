"""
Authoritative task state for one Oma request.

Every visible status in the Oma window (chat, live feed, holographic face, OMA coordinator, Agent Town workers)
is driven by the events this module prints. Nothing here invents progress:
- a worker becomes WORKING only when the real Atticus engine starts a tool call that belongs to that worker's lane;
- a step is done/failed only when the engine reports that tool call's real result;
- the task is COMPLETED only when the engine finished without error AND verification found no contradicting evidence.
  Otherwise it is PARTIAL (finished, but not verifiable or text-only) or FAILED / CANCELLED.

The workers are lanes of the ONE shared Atticus engine (Claude Code with Atticus's tools), not independent AI agents.
Each event line is: "§EVENT§" + JSON.  The final line is "§REPLY§" + JSON (printed by atticus.py).
"""
import json
import os
import re
import tempfile
import threading
import time
import uuid

HOME = os.path.expanduser('~')
DIR = os.environ.get('ATTICUS_DIR') or os.path.join(os.environ.get('APPDATA') or os.path.join(HOME, '.config'), 'Atticus')
STATE_FILE = os.path.join(DIR, 'task_state.json')

# Worker lanes. 'shared_engine' is stated in every snapshot so the UI can label them honestly.
WORKERS = {
    'alice': {'name': 'Alice', 'role': 'Research Worker', 'room': 'library', 'icon': '🔍',
              'capabilities': ['web search', 'web page reading', 'history lookup']},
    'bob': {'name': 'Bob', 'role': 'Browser Worker', 'room': 'browser', 'icon': '🌐',
            'capabilities': ['open websites', 'browser keys and navigation']},
    'carol': {'name': 'Carol', 'role': 'Desktop Worker', 'room': 'desktop', 'icon': '🖥️',
              'capabilities': ['open apps', 'windows', 'keys and typing', 'screen reading', 'files', 'integrations']},
    'dave': {'name': 'Dave', 'role': 'Verification Worker', 'room': 'qa', 'icon': '✅',
             'capabilities': ['window checks', 'tool result checks', 'source checks']},
    'eve': {'name': 'Eve', 'role': 'YouTube Worker', 'room': 'studio', 'icon': '▶️',
            'capabilities': ['YouTube search', 'video metadata', 'transcripts', 'title/hook/chapter checks', 'channel outliers']},
}

TERMINAL = ('COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED')

# Helper commands the engine runs (see atticus.py). Kept as plain prefixes so this module has no atticus import.
_ME = 'atticus'
_RESEARCH = tuple(f'{_ME} --{c}' for c in ('search', 'read', 'history'))
_YOUTUBE = (f'{_ME} --int youtube', f'{_ME} --yt')
_URL = re.compile(r'https?://', re.I)
_BROWSERS = re.compile(r'\b(chrome|msedge|edge|firefox|opera|brave)\b', re.I)


def worker_for(tool_name, inp):
    """Which worker lane a real tool call belongs to."""
    inp = inp or {}
    if tool_name in ('WebSearch', 'WebFetch'):
        return 'alice'
    if tool_name == 'Read':
        return 'carol'   # reading a screenshot or a file on this PC
    if tool_name.startswith('mcp__'):
        return 'carol'
    c = re.sub(r'^cd \S+\s*(;|&&)\s*', '', ' '.join(str(inp.get('command', '')).split()))
    if c.startswith(_YOUTUBE):
        return 'eve'
    if c.startswith(_RESEARCH):
        return 'alice'
    if c.startswith(f'{_ME} --show') and _URL.search(c):
        return 'bob'
    if _URL.search(c) and re.search(r'^(start|open)\b|start-process|\bexplorer(\.exe)?\s|' + _BROWSERS.pattern, c, re.I):
        return 'bob'   # anything that opens a web address in a browser, however it is started
    if c.startswith(f'{_ME} --keys') and _BROWSERS.search(c):
        return 'bob'
    return 'carol'


def _now():
    return round(time.time(), 3)


class TaskTracker:
    def __init__(self, text, source='typed', out=None):
        self.id = 'T-' + uuid.uuid4().hex[:6].upper()
        self.text = text
        self.source = source
        self.seq = 0
        self.started = _now()
        self.status = 'RECEIVED'
        self.stage = 'received'
        self.model = None          # {'provider','model','resolved'}
        self.models_tried = []      # [{'provider','model','ok','error_type','error'}]
        self.steps = []             # [{'id','worker','tool','label','status','started','ended','error','output'}]
        self.evidence = []
        self.reply = ''
        self.error = ''
        self.text_only = False
        self.workers = {k: {'state': 'IDLE', 'task_id': '', 'step': '', 'tool': '', 'started': 0, 'done': 0, 'failed': 0,
                            'output': '', 'error': ''} for k in WORKERS}
        self._lock = threading.Lock()
        self._out = out if out is not None else (lambda line: print(line, flush=True))
        self._by_tool_id = {}

    # ---- output ----
    def _emit(self, kind, **data):
        with self._lock:
            self.seq += 1
            ev = {'v': 1, 'task_id': self.id, 'seq': self.seq, 'ts': _now(), 'kind': kind, 'status': self.status,
                  'stage': self.stage, 'active_model': self.model, 'text_only': self.text_only,
                  'workers': {k: {'state': w['state'], 'step': w['step'][:80], 'done': w['done'], 'failed': w['failed']} for k, w in self.workers.items()},
                  **data}
            try:
                self._out('§EVENT§' + json.dumps(ev, ensure_ascii=False))
            except Exception:
                pass
            self._persist()

    def snapshot(self):
        return {
            'task_id': self.id, 'text': self.text, 'source': self.source, 'status': self.status, 'stage': self.stage,
            'started': self.started, 'elapsed_s': round(time.time() - self.started, 1), 'model': self.model,
            'models_tried': self.models_tried, 'steps': self.steps[-40:], 'evidence': self.evidence, 'error': self.error,
            'reply': self.reply[:1200], 'text_only': self.text_only,
            'workers': {k: {**WORKERS[k], **v} for k, v in self.workers.items()},
            'shared_engine': True,
        }

    def _persist(self):
        try:
            os.makedirs(DIR, exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=DIR, prefix='task_state.', suffix='.tmp')
            with os.fdopen(fd, 'w', encoding='utf-8') as f:
                json.dump({'current': self.snapshot(), 'saved': _now()}, f, ensure_ascii=False)
            os.replace(tmp, STATE_FILE)
        except Exception:
            pass

    # ---- lifecycle ----
    def start(self):
        self._emit('task', detail=self.text, source=self.source)

    def set_stage(self, stage, detail=''):
        self.stage = stage
        if self.status == 'RECEIVED':
            self.status = 'RUNNING'
        self._emit('stage', detail=detail)

    def note(self, text):
        """The engine's own words between tool calls (Claude's visible notes)."""
        if text:
            self._emit('note', detail=text[:400])

    def model_attempt(self, provider, model, ok, error_type='', error='', resolved=''):
        rec = {'provider': provider, 'model': model, 'ok': bool(ok), 'error_type': error_type, 'error': (error or '')[:300]}
        if resolved:
            rec['resolved'] = resolved
        prev = self.model
        self.models_tried.append(rec)
        if ok:
            self.model = {'provider': provider, 'model': model, 'resolved': resolved or model}
        self._emit('model', detail=f"{provider} · {resolved or model}" + ('' if ok else f" failed: {error_type or 'error'}"),
                   attempt=rec, active=self.model, fallback_from=(prev or {}).get('resolved') if ok and prev else None)

    def model_active(self, provider, model, resolved=''):
        self.model = {'provider': provider, 'model': model, 'resolved': resolved or model}
        self._emit('model', detail=f'{provider} · {resolved or model}', active=self.model)

    def step_start(self, tool_id, tool_name, inp, label):
        w = worker_for(tool_name, inp)
        step = {'id': tool_id or f's{len(self.steps) + 1}', 'worker': w, 'tool': tool_name, 'label': label,
                'status': 'RUNNING', 'started': _now(), 'ended': 0, 'error': '', 'output': ''}
        self.steps.append(step)
        self._by_tool_id[step['id']] = step
        ws = self.workers[w]
        if ws['state'] in ('IDLE', 'COMPLETED', 'FAILED'):
            ws['started'] = _now()
        ws.update(state='WORKING', task_id=self.id, step=label, tool=tool_name, error='')
        self.status = 'RUNNING'
        self.stage = 'executing'
        self._emit('step', detail=label, worker=w, step=step)
        return step

    def step_end(self, tool_id, ok, output=''):
        step = self._by_tool_id.get(tool_id)
        if not step:
            return
        step.update(status='DONE' if ok else 'FAILED', ended=_now(), output=str(output or '')[:300])
        if not ok:
            step['error'] = step['output']
        ws = self.workers[step['worker']]
        if ok:
            ws['done'] += 1
            ws['output'] = step['output']
        else:
            ws['failed'] += 1
            ws['error'] = step['output']
        still = any(s['worker'] == step['worker'] and s['status'] == 'RUNNING' for s in self.steps)
        if not still:
            ws['state'] = 'COMPLETED' if ws['failed'] == 0 else 'FAILED'
        self._emit('step', detail=step['label'], worker=step['worker'], step=step)

    def waiting(self, question):
        """The safety gate is waiting for the user's Allow / Don't Allow (or a choice)."""
        self.status = 'WAITING'
        self.stage = 'permission'
        for s in self.steps:
            if s['status'] == 'RUNNING':
                self.workers[s['worker']]['state'] = 'WAITING'
        self._emit('permission', detail=question)

    def resumed(self):
        if self.status == 'WAITING':
            self.status = 'RUNNING'
            self.stage = 'executing'
            for s in self.steps:
                if s['status'] == 'RUNNING':
                    self.workers[s['worker']]['state'] = 'WORKING'
            self._emit('stage', detail='Permission answered')

    # ---- verification (Dave) ----
    def verify(self, checks):
        """checks: list of (description, callable -> (ok: bool|None, evidence: str)). None = could not check.
        Returns 'ok' | 'unverified' | 'contradicted'."""
        if not checks:
            return 'ok'
        d = self.workers['dave']
        d.update(state='VERIFYING', task_id=self.id, step='Verifying the result', tool='verification', started=_now())
        self.stage = 'verifying'
        self._emit('worker', detail='Verifying the result', worker='dave')
        verdict = 'ok'
        for desc, fn in checks:
            try:
                ok, ev = fn()
            except Exception as e:   # a check that crashes proves nothing
                ok, ev = None, f'check error: {e}'
            self.evidence.append({'check': desc, 'ok': ok, 'evidence': str(ev)[:300]})
            self._emit('evidence', detail=f"{desc}: {ev}", worker='dave', ok=ok)
            if ok is False:
                verdict = 'contradicted'
            elif ok is None and verdict == 'ok':
                verdict = 'unverified'
        d['state'] = 'COMPLETED' if verdict == 'ok' else 'FAILED' if verdict == 'contradicted' else 'COMPLETED'
        d['output'] = verdict
        if verdict == 'ok':
            d['done'] += 1
        elif verdict == 'contradicted':
            d['failed'] += 1
        return verdict

    def finish(self, status, reply='', error=''):
        assert status in TERMINAL
        self.status = status
        self.stage = status.lower()
        self.reply = reply or ''
        self.error = error or ''
        for k, ws in self.workers.items():
            if ws['state'] in ('WORKING', 'WAITING', 'ASSIGNED', 'VERIFYING'):
                ws['state'] = 'CANCELLED' if status == 'CANCELLED' else 'FAILED' if status == 'FAILED' else 'COMPLETED'
        self._emit('result', detail=(error or reply or '')[:400], elapsed_s=round(time.time() - self.started, 1))


def last_state():
    """The most recent task snapshot (for the window when it opens). Workers of a task that never finished
    (the process died) are reported as interrupted, never as working."""
    try:
        with open(STATE_FILE, encoding='utf-8') as f:
            cur = json.load(f).get('current') or {}
    except Exception:
        cur = {}
    if cur and cur.get('status') not in TERMINAL:
        cur['status'] = 'FAILED'
        cur['error'] = cur.get('error') or 'Interrupted: the task process ended without a result.'
        for w in (cur.get('workers') or {}).values():
            if w.get('state') not in ('IDLE', 'COMPLETED', 'FAILED', 'CANCELLED'):
                w['state'] = 'FAILED'
    workers = cur.get('workers') or {k: {**v, 'state': 'IDLE'} for k, v in WORKERS.items()}
    return {'task': cur or None, 'workers': workers, 'shared_engine': True}
