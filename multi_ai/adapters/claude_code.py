"""
Multi-AI Architecture: Claude Code Adapter
Maintains existing Claude CLI subscription flow (claude -p) with quota detection.
"""
import os
import subprocess
from typing import Dict, Any, List
from multi_ai.models import ModelInfo

INSTALLED_PYTHON = r"C:\Users\USERAS\AppData\Local\Atticus\venv\Scripts\python.exe"
INSTALLED_SCRIPT = r"C:\Users\USERAS\.atticus\atticus.py"

class ClaudeCodeAdapter:
    def __init__(self, python_path: str = INSTALLED_PYTHON, script_path: str = INSTALLED_SCRIPT):
        self.python_path = python_path if os.path.exists(python_path) else "python"
        self.script_path = script_path

    def discover_models(self) -> List[ModelInfo]:
        return [
            ModelInfo(
                model_id="claude-3-5-haiku",
                provider_id="claude_code",
                display_name="Claude 3.5 Haiku (Subscription)",
                supports_tools=True,
                supports_vision=True,
                local=False,
                context_limit=200000
            ),
            ModelInfo(
                model_id="claude-3-7-sonnet",
                provider_id="claude_code",
                display_name="Claude 3.7 Sonnet (Subscription)",
                supports_tools=True,
                supports_vision=True,
                local=False,
                context_limit=200000
            )
        ]

    def is_available(self) -> bool:
        if not os.path.exists(self.script_path):
            return False
        try:
            res = subprocess.run(
                [self.python_path, self.script_path, "--check"],
                capture_output=True,
                text=True,
                timeout=5
            )
            return "ok" in res.stdout.lower()
        except Exception:
            return False

    def generate(self, model_id: str, prompt: str) -> Dict[str, Any]:
        """Runs the query through the installed Atticus Claude Code flow."""
        try:
            res = subprocess.run(
                [self.python_path, self.script_path, prompt],
                capture_output=True,
                text=True,
                encoding='utf-8',
                errors='ignore',
                timeout=30
            )
            out = res.stdout.strip()
            err = res.stderr.strip()
            combined = (out + "\n" + err).strip()

            if "weekly limit" in combined.lower() or "rate limit" in combined.lower():
                return {
                    'success': False,
                    'error_type': 'quota_exhausted',
                    'error': combined,
                    'model': model_id,
                    'provider': 'claude_code'
                }

            if combined:
                return {
                    'success': True,
                    'reply': combined,
                    'model': model_id,
                    'provider': 'claude_code'
                }

            return {
                'success': False,
                'error': 'Empty response from Claude Code worker',
                'model': model_id,
                'provider': 'claude_code'
            }
        except subprocess.TimeoutExpired:
            return {
                'success': False,
                'error_type': 'timeout',
                'error': 'Claude Code process timed out',
                'model': model_id,
                'provider': 'claude_code'
            }
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'model': model_id,
                'provider': 'claude_code'
            }
