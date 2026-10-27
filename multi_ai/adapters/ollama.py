"""
Multi-AI Architecture: Ollama Local Provider Adapter
Directly integrates with local Ollama runtime on localhost:11434.
"""
import json
import urllib.request
import urllib.error
from typing import Dict, Any, List, Optional
from multi_ai.models import ModelInfo
from multi_ai.tools import get_openai_tool_definitions, execute_tool_call

class OllamaAdapter:
    def __init__(self, base_url: str = "http://localhost:11434"):
        self.base_url = base_url.rstrip('/')

    def discover_models(self) -> List[ModelInfo]:
        """Discovers locally installed models in Ollama."""
        models = []
        try:
            req = urllib.request.Request(f"{self.base_url}/api/tags")
            with urllib.request.urlopen(req, timeout=3) as res:
                data = json.loads(res.read().decode('utf-8'))
                for m in data.get('models', []):
                    name = m.get('name', '')
                    is_vl = 'vl' in name.lower() or 'vision' in name.lower()
                    models.append(ModelInfo(
                        model_id=name,
                        provider_id="ollama",
                        display_name=f"Ollama: {name}",
                        supports_tools=True,
                        supports_vision=is_vl,
                        local=True,
                        context_limit=32768
                    ))
        except Exception:
            pass
        return models

    def is_available(self) -> bool:
        try:
            req = urllib.request.Request(f"{self.base_url}/api/tags")
            with urllib.request.urlopen(req, timeout=2) as res:
                return res.status == 200
        except Exception:
            return False

    def generate(self, model_id: str, prompt: str, system_prompt: str = "") -> Dict[str, Any]:
        """
        Executes a prompt through Ollama with automatic tool assistance if needed.
        """
        # First check if the prompt requires a tool call
        p_lower = prompt.lower()
        tool_executed = False
        tool_output = ""

        if any(w in p_lower for w in ['open', 'launch', 'ক্যালকুলেটর', 'নোটপ্যাড', 'ক্রোম', 'খুলো']):
            if 'calc' in p_lower or 'ক্যালকুলেটর' in p_lower:
                tool_output = execute_tool_call('open_app', {'app_name': 'calculator'})
                tool_executed = True
            elif 'notepad' in p_lower or 'নোটপ্যাড' in p_lower:
                tool_output = execute_tool_call('open_app', {'app_name': 'notepad'})
                tool_executed = True
            elif 'chrome' in p_lower or 'ক্রোম' in p_lower:
                tool_output = execute_tool_call('open_app', {'app_name': 'chrome'})
                tool_executed = True

        if tool_executed:
            return {
                'success': True,
                'reply': tool_output,
                'tool_called': True,
                'model': model_id,
                'provider': 'ollama'
            }

        # Otherwise execute standard Ollama generation
        payload = {
            'model': model_id,
            'prompt': prompt,
            'stream': False
        }
        if system_prompt:
            payload['system'] = system_prompt

        try:
            req = urllib.request.Request(
                f"{self.base_url}/api/generate",
                data=json.dumps(payload).encode('utf-8'),
                headers={'Content-Type': 'application/json'},
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=30) as res:
                data = json.loads(res.read().decode('utf-8'))
                reply = data.get('response', '').strip()
                return {
                    'success': True,
                    'reply': reply,
                    'model': model_id,
                    'provider': 'ollama'
                }
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'model': model_id,
                'provider': 'ollama'
            }
