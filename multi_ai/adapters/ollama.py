"""
Multi-AI Architecture: Ollama local provider adapter (text only).

Root cause of the "Ollama returned an empty response" failures: qwen3 / qwen3-vl are thinking models. Through
/api/generate their reasoning goes to the separate `thinking` field; qwen3-vl ignores think=false and, when it never
closes its reasoning, `response` comes back empty. This adapter uses /api/chat with think=false, prefers a non-vision
model for text (router), and reports an empty answer as error_type 'empty_output' (never as success).
It never performs PC actions: those belong to the Atticus engine and its safety gate.
"""
import json
import time
import urllib.error
import urllib.request
from typing import Any, Dict, List

from multi_ai.models import ModelInfo


class OllamaAdapter:
    def __init__(self, base_url: str = "http://localhost:11434", timeout: float = 120.0):
        self.base_url = base_url.rstrip('/')
        self.timeout = timeout

    def discover_models(self) -> List[ModelInfo]:
        from multi_ai.model_catalog import ollama_models
        return [ModelInfo(model_id=m['name'], provider_id='ollama', display_name=f"Ollama: {m['name']}", supports_tools=m['tools'],
                          supports_vision=m['vision'], local=True, context_limit=32768) for m in ollama_models()]

    def is_available(self) -> bool:
        try:
            with urllib.request.urlopen(f"{self.base_url}/api/tags", timeout=2) as res:
                return res.status == 200
        except Exception:
            return False

    def generate(self, model_id: str, prompt: str, system_prompt: str = "", images: List[str] = None) -> Dict[str, Any]:
        messages = []
        if system_prompt:
            messages.append({'role': 'system', 'content': system_prompt})
        msg = {'role': 'user', 'content': prompt}
        if images:
            msg['images'] = images
        messages.append(msg)
        payload = {'model': model_id, 'messages': messages, 'stream': False, 'think': False, 'keep_alive': '10m'}
        t0 = time.time()
        try:
            req = urllib.request.Request(f"{self.base_url}/api/chat", data=json.dumps(payload).encode('utf-8'),
                                         headers={'Content-Type': 'application/json'}, method='POST')
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                data = json.loads(res.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', 'ignore')[:300]
            kind = 'model_unavailable' if e.code == 404 else 'http_error'
            return {'success': False, 'error_type': kind, 'error': f'HTTP {e.code}: {body}', 'model': model_id, 'provider': 'ollama'}
        except Exception as e:
            kind = 'timeout' if 'timed out' in str(e).lower() else 'network_error'
            return {'success': False, 'error_type': kind, 'error': str(e), 'model': model_id, 'provider': 'ollama'}
        m = data.get('message') or {}
        reply = (m.get('content') or '').strip()
        secs = round(time.time() - t0, 1)
        if not reply:
            thinking = len(m.get('thinking') or '')
            return {'success': False, 'error_type': 'empty_output', 'model': model_id, 'provider': 'ollama',
                    'error': f"empty answer after {secs}s (done_reason={data.get('done_reason')}, reasoning chars={thinking})"}
        return {'success': True, 'reply': reply, 'model': model_id, 'provider': 'ollama', 'secs': secs,
                'eval_count': data.get('eval_count')}
