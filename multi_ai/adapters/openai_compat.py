"""
Multi-AI Architecture: OpenAI-Compatible Provider Adapter
Supports OpenAI, DeepSeek, Groq, xAI, OpenRouter, LM Studio, and custom endpoints.
"""
import json
import urllib.request
import urllib.error
from typing import Dict, Any, List, Optional
from multi_ai.models import ModelInfo
from multi_ai.tools import get_openai_tool_definitions, execute_tool_call

class OpenAICompatAdapter:
    def __init__(self, provider_id: str, display_name: str, base_url: str, api_key: str = "", local: bool = False):
        self.provider_id = provider_id
        self.display_name = display_name
        self.base_url = base_url.rstrip('/')
        self.api_key = api_key
        self.local = local

    def is_available(self) -> bool:
        if self.local:
            try:
                req = urllib.request.Request(f"{self.base_url}/models")
                with urllib.request.urlopen(req, timeout=2) as res:
                    return res.status == 200
            except Exception:
                return False
        return bool(self.api_key)

    def discover_models(self) -> List[ModelInfo]:
        models = []
        if not self.is_available():
            return models
        try:
            headers = {}
            if self.api_key:
                headers['Authorization'] = f"Bearer {self.api_key}"
            req = urllib.request.Request(f"{self.base_url}/models", headers=headers)
            with urllib.request.urlopen(req, timeout=4) as res:
                data = json.loads(res.read().decode('utf-8'))
                for m in data.get('data', []):
                    mid = m.get('id', '')
                    models.append(ModelInfo(
                        model_id=mid,
                        provider_id=self.provider_id,
                        display_name=f"{self.display_name}: {mid}",
                        supports_tools=True,
                        local=self.local
                    ))
        except Exception:
            pass
        return models

    def generate(self, model_id: str, prompt: str, system_prompt: str = "") -> Dict[str, Any]:
        """Executes a chat completion call with tool definitions."""
        headers = {'Content-Type': 'application/json'}
        if self.api_key:
            headers['Authorization'] = f"Bearer {self.api_key}"

        messages = []
        if system_prompt:
            messages.append({'role': 'system', 'content': system_prompt})
        messages.append({'role': 'user', 'content': prompt})

        payload = {
            'model': model_id,
            'messages': messages,
            'tools': get_openai_tool_definitions(),
            'tool_choice': 'auto'
        }

        try:
            req = urllib.request.Request(
                f"{self.base_url}/chat/completions",
                data=json.dumps(payload).encode('utf-8'),
                headers=headers,
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=30) as res:
                data = json.loads(res.read().decode('utf-8'))
                choices = data.get('choices', [])
                if not choices:
                    return {'success': False, 'error': 'No choices returned', 'provider': self.provider_id}

                msg = choices[0].get('message', {})
                tool_calls = msg.get('tool_calls', [])

                if tool_calls:
                    # Execute tool call
                    tc = tool_calls[0]
                    fn_name = tc.get('function', {}).get('name', '')
                    fn_args = json.loads(tc.get('function', {}).get('arguments', '{}'))
                    tool_res = execute_tool_call(fn_name, fn_args)
                    return {
                        'success': True,
                        'reply': tool_res,
                        'tool_called': True,
                        'tool_name': fn_name,
                        'model': model_id,
                        'provider': self.provider_id
                    }

                reply = msg.get('content', '').strip()
                return {
                    'success': True,
                    'reply': reply,
                    'model': model_id,
                    'provider': self.provider_id
                }
        except urllib.error.HTTPError as e:
            err_body = e.read().decode('utf-8', errors='ignore')
            err_type = 'rate_limit' if e.code == 429 else ('auth_error' if e.code in (401, 403) else 'http_error')
            return {
                'success': False,
                'error_type': err_type,
                'error': f"HTTP {e.code}: {err_body}",
                'model': model_id,
                'provider': self.provider_id
            }
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'model': model_id,
                'provider': self.provider_id
            }
