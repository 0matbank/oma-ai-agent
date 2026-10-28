"""
Multi-AI Architecture: model router for TEXT answers when the Atticus engine (Claude Code) cannot run.

Bounded, honest fallback:
- candidates come from live discovery (Ollama tags, each cloud's own model list + health cache), never from retired
  hardcoded IDs;
- every attempt is reported (tracker.model_attempt) with a classified error: model_unavailable, rate_limited, busy,
  quota_exhausted, auth_error, timeout, network_error, empty_output, not_configured;
- at most MAX_ATTEMPTS attempts per request, no recursion (claude_code is excluded inside a fallback);
- modes: auto | local (alias local_only) | cloud (cloud preferred) | manual (activeModel "provider/model");
  aiFallbackOrder (comma list of provider ids) overrides the default order;
- no PC actions are taken here, so a permission denial can never be bypassed by switching providers.
"""
import json
import os
import re
import time
from typing import Any, Dict, List, Optional

from multi_ai.adapters.claude_code import ClaudeCodeAdapter
from multi_ai.adapters.ollama import OllamaAdapter
from multi_ai.adapters.openai_compat import OpenAICompatAdapter
from multi_ai.journal import journal
from multi_ai.providers import SETTINGS_FILE, get_secret, provider_mgr

MAX_ATTEMPTS = 4
CLOUD_IDS = ('gemini', 'openai', 'deepseek', 'groq')


def clean_user_prompt(text: str) -> str:
    """Strips any nested Context: ... Request: ... or failure wrappers to isolate the raw user request."""
    if not text:
        return ""
    text = re.split(r'\n(?:A )?[Pp]revious (?:try )?failed:', text)[0]
    parts = re.split(r'(?:^|\n)Request:\s*', text)
    if len(parts) > 1:
        text = parts[-1].strip()
    while True:
        stripped = re.sub(r'^(?:Context|Earlier|Memory|Integrations|Saved workflow|About the user|Front app)[^:\n]*:\s*.*?(?:\n|\.\s+|$)', '', text, flags=re.S | re.I).strip()
        if stripped == text:
            break
        text = stripped
    return text.strip()


def normalize_mode(mode: str) -> str:
    m = (mode or 'auto').lower()
    return {'local_only': 'local', 'local': 'local', 'cloud': 'cloud', 'cloud_preferred': 'cloud', 'manual': 'manual'}.get(m, 'auto')


def _settings() -> Dict[str, Any]:
    try:
        with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


class ModelRouter:
    def __init__(self):
        self.adapters: Dict[str, Any] = {
            'claude_code': ClaudeCodeAdapter(),
            'ollama': OllamaAdapter('http://localhost:11434'),
            'lm_studio': OpenAICompatAdapter('lm_studio', 'LM Studio', 'http://localhost:1234/v1', local=True),
        }

    def _cloud_adapter(self, provider_id: str) -> Optional[OpenAICompatAdapter]:
        key = get_secret(f"ai_key_{provider_id}")
        if not key:
            return None
        p_def = provider_mgr.definition(provider_id)
        if not p_def or not p_def.get('base_url'):
            return None
        return OpenAICompatAdapter(provider_id, p_def.get('name', provider_id), p_def['base_url'], api_key=key)

    # ---- candidates ----
    def _local(self, excluded, vision=False):
        from multi_ai.model_catalog import ollama_pick
        out = []
        if 'ollama' not in excluded:
            out += [('ollama', m) for m in ollama_pick(vision=vision)[:2]]
        if 'lm_studio' not in excluded and self.adapters['lm_studio'].is_available():
            out += [('lm_studio', m.model_id) for m in self.adapters['lm_studio'].discover_models()[:1]]
        return out

    def _cloud(self, excluded, only=None):
        from multi_ai.model_catalog import cloud_candidates
        out = []
        for pid in (only or list(CLOUD_IDS) + [c['id'] for c in provider_mgr.customs()]):
            if pid in excluded or not get_secret(f'ai_key_{pid}'):
                continue
            d = provider_mgr.definition(pid) or {}
            mids, listed = cloud_candidates(pid, d.get('base_url', ''), get_secret(f'ai_key_{pid}'), d.get('preferred_models', ()), limit=2)
            if not listed and d.get('custom'):   # a custom endpoint without /models: its configured model
                mids = d.get('default_models', [])[:1]
            out += [(pid, m) for m in mids]
        return out

    def candidates(self, settings=None, exclude=(), vision=False) -> List[tuple]:
        s = settings if settings is not None else _settings()
        excluded = set(exclude)
        if os.environ.get("OMA_ROUTER_FALLBACK") == "1":
            excluded.add('claude_code')
        mode = normalize_mode(s.get('aiMode', 'auto'))
        fallback = s.get('aiFallback', True)
        if mode == 'manual':
            active = str(s.get('activeModel') or '')
            first = []
            if '/' in active:
                pid, mid = active.split('/', 1)
                pid = 'claude_code' if pid == 'claude' else pid
                if pid not in excluded:
                    first = [(pid, mid)]
            rest = self._local(excluded, vision) + self._cloud(excluded) if fallback else []
            cands = first + rest
        elif mode == 'local':
            cands = self._local(excluded, vision)
        elif mode == 'cloud':
            cands = self._cloud(excluded) + (self._local(excluded, vision) if fallback else [])
        else:
            cands = self._local(excluded, vision) + (self._cloud(excluded) if fallback else [])
        order = [p.strip() for p in str(s.get('aiFallbackOrder') or '').split(',') if p.strip()]
        if order and mode != 'manual':
            rank = {p: i for i, p in enumerate(order)}
            cands = sorted(cands, key=lambda c: rank.get(c[0], len(order)))   # stable: keeps each provider's own best-first order
        return list(dict.fromkeys(cands))[:MAX_ATTEMPTS]

    def get_status_overview(self) -> Dict[str, Any]:
        return provider_mgr.get_full_overview()

    def execute(self, prompt: str, task_id: Optional[str] = None, event_callback=None, exclude_providers: Optional[List[str]] = None,
                system_prompt: str = "", tracker=None) -> Dict[str, Any]:
        clean_prompt = clean_user_prompt(prompt)
        task_id = task_id or (tracker.id if tracker is not None else f"task_{int(time.time() * 1000)}")
        journal.create_task(task_id, clean_prompt)

        def emit(stage, detail):
            if event_callback:
                try:
                    event_callback({'stage': stage, 'detail': detail, 'task_id': task_id})
                except Exception:
                    pass

        cands = self.candidates(exclude=exclude_providers or ())
        if not cands:
            msg = "No AI model is reachable for a fallback answer: Ollama is not running and no cloud provider with a working key is configured."
            if tracker is not None:
                tracker.model_attempt('none', 'none', False, 'not_configured', msg)
            emit('error', msg)
            journal.finish_task(task_id, msg, status='failed')
            return {'success': False, 'error': msg, 'reply': msg, 'attempts': []}
        attempts = []
        for pid, mid in cands:
            adapter = self.adapters.get(pid) or self._cloud_adapter(pid)
            emit('executing', f'Trying {pid} ({mid})')
            if not adapter:
                res = {'success': False, 'error_type': 'not_configured', 'error': f'{pid} is not configured'}
            else:
                try:
                    res = adapter.generate(mid, clean_prompt, system_prompt=system_prompt)
                except Exception as e:
                    res = {'success': False, 'error_type': 'exception', 'error': str(e)}
            ok = bool(res.get('success') and (res.get('reply') or '').strip())
            attempts.append({'provider': pid, 'model': mid, 'ok': ok, 'error_type': res.get('error_type', ''), 'error': (res.get('error') or '')[:300]})
            if tracker is not None:
                tracker.model_attempt(pid, mid, ok, res.get('error_type', ''), res.get('error', ''), res.get('resolved_model', ''))
            if ok:
                reply = res['reply'].strip()
                journal.finish_task(task_id, reply, status='completed')
                return {'success': True, 'reply': reply, 'model_used': mid, 'provider_used': pid,
                        'fallback_occurred': len(attempts) > 1, 'attempts': attempts}
            emit('fallback', f"{pid} ({mid}) failed: {res.get('error_type') or 'error'}")
        detail = '; '.join(f"{a['provider']} ({a['model']}): {a['error_type'] or 'error'} {a['error'][:120]}" for a in attempts)
        journal.finish_task(task_id, detail, status='failed')
        emit('error', 'All fallback models failed')
        return {'success': False, 'error': f'All models failed: {detail}', 'reply': f'Every available model failed: {detail}', 'attempts': attempts}


router = ModelRouter()
