"""
Multi-AI Architecture: OpenAI-compatible provider adapter (Gemini's OpenAI endpoint, OpenAI, DeepSeek, Groq, xAI,
OpenRouter, LM Studio, custom). Text only: fallback answers never run PC actions, so they cannot bypass the Atticus
safety gate. Errors are classified (model_unavailable / rate_limited / busy / auth_error / timeout / network_error /
empty_output) and recorded in the live model-health cache.
"""
import json
import urllib.error
import urllib.request
from typing import Any, Dict, List

from multi_ai.models import ModelInfo


class OpenAICompatAdapter:
    def __init__(self, provider_id: str, display_name: str, base_url: str, api_key: str = "", local: bool = False, timeout: float = 60.0):
        self.provider_id = provider_id
        self.display_name = display_name
        self.base_url = base_url.rstrip('/')
        self.api_key = api_key
        self.local = local
        self.timeout = timeout

    def _headers(self):
        h = {'Content-Type': 'application/json', 'User-Agent': 'Oma-AI'}
        if self.api_key:
            h['Authorization'] = f'Bearer {self.api_key}'
        return h

    def is_available(self) -> bool:
        if self.local:
            try:
                with urllib.request.urlopen(urllib.request.Request(f"{self.base_url}/models", headers=self._headers()), timeout=2) as res:
                    return res.status == 200
            except Exception:
                return False
        return bool(self.api_key)

    def discover_models(self) -> List[ModelInfo]:
        if not self.is_available():
            return []
        from multi_ai.model_catalog import list_models
        return [ModelInfo(model_id=m, provider_id=self.provider_id, display_name=f'{self.display_name}: {m}', local=self.local)
                for m in list_models(self.base_url, self.api_key, self.provider_id)]

    def generate(self, model_id: str, prompt: str, system_prompt: str = "") -> Dict[str, Any]:
        from multi_ai.model_catalog import classify_http, record, _msg
        messages = ([{'role': 'system', 'content': system_prompt}] if system_prompt else []) + [{'role': 'user', 'content': prompt}]
        req = urllib.request.Request(f"{self.base_url}/chat/completions", data=json.dumps({'model': model_id, 'messages': messages}).encode('utf-8'),
                                     headers=self._headers(), method='POST')
        base = {'model': model_id, 'provider': self.provider_id}
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                data = json.loads(res.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', 'ignore')
            state = classify_http(e.code, body)
            record(self.provider_id, model_id, state, f'HTTP {e.code}')
            kind = {'gone': 'model_unavailable', 'busy': 'rate_limited' if e.code == 429 else 'busy', 'auth': 'auth_error'}.get(state, 'http_error')
            return {**base, 'success': False, 'error_type': kind, 'error': f'HTTP {e.code}: {_msg(body)}'}   # provider message only, never headers/keys
        except Exception as e:
            kind = 'timeout' if 'timed out' in str(e).lower() else 'network_error'
            record(self.provider_id, model_id, 'busy', kind)
            return {**base, 'success': False, 'error_type': kind, 'error': str(e)[:200]}
        choices = data.get('choices') or []
        reply = ((choices[0].get('message') or {}).get('content') or '').strip() if choices else ''
        if not reply:
            return {**base, 'success': False, 'error_type': 'empty_output', 'error': 'the model returned no text'}
        record(self.provider_id, model_id, 'ok', 'answered')
        return {**base, 'success': True, 'reply': reply}
