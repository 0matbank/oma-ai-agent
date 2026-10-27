"""
Multi-AI Architecture: Claude Code Adapter
Directly integrates with the Claude Code CLI (claude.exe -p) with strict timeout and recursion protection.
Never invokes atticus.py recursively.
"""
import os
import shutil
import subprocess
from typing import Dict, Any, List
from multi_ai.models import ModelInfo

class ClaudeCodeAdapter:
    def __init__(self, claude_path: str = None):
        self.claude_path = claude_path or shutil.which("claude") or os.path.expanduser(r"~/.local/bin/claude.exe")

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
        if not self.claude_path:
            return False
        return os.path.exists(self.claude_path)

    def generate(self, model_id: str, prompt: str) -> Dict[str, Any]:
        """Runs the query directly through the installed Claude CLI (claude.exe -p)."""
        # 1. Hard recursion guard: Never invoke Claude Code if already inside Atticus or in a fallback chain
        if os.environ.get("OMA_IN_ATTICUS") == "1" or os.environ.get("OMA_ROUTER_FALLBACK") == "1":
            return {
                'success': False,
                'error_type': 'recursion_blocked',
                'error': 'Direct Claude Code invocation blocked inside Atticus fallback context',
                'model': model_id,
                'provider': 'claude_code'
            }

        if not self.claude_path or not os.path.exists(self.claude_path):
            return {
                'success': False,
                'error_type': 'not_installed',
                'error': 'Claude CLI (claude.exe) not found on system',
                'model': model_id,
                'provider': 'claude_code'
            }

        try:
            # Run claude -p directly with stdin=subprocess.DEVNULL to avoid stdin blocking
            cmd = [self.claude_path, '-p', prompt, '--output-format', 'text']
            res = subprocess.run(
                cmd,
                stdin=subprocess.DEVNULL,
                capture_output=True,
                text=True,
                encoding='utf-8',
                errors='replace',
                timeout=20
            )
            out = res.stdout.strip()
            err = res.stderr.strip()
            combined = (out + "\n" + err).strip()

            if any(q in combined.lower() for q in ('weekly limit', 'rate limit', 'hit your limit', 'quota exceeded', 'too many requests', 'usage limit')):
                return {
                    'success': False,
                    'error_type': 'quota_exhausted',
                    'error': combined,
                    'model': model_id,
                    'provider': 'claude_code'
                }

            if res.returncode == 0 and out:
                return {
                    'success': True,
                    'reply': out,
                    'model': model_id,
                    'provider': 'claude_code'
                }

            return {
                'success': False,
                'error_type': 'exit_code_' + str(res.returncode),
                'error': combined or f'Claude CLI exited with code {res.returncode}',
                'model': model_id,
                'provider': 'claude_code'
            }
        except subprocess.TimeoutExpired:
            return {
                'success': False,
                'error_type': 'timeout',
                'error': 'Claude CLI timed out after 20s',
                'model': model_id,
                'provider': 'claude_code'
            }
        except Exception as e:
            return {
                'success': False,
                'error_type': 'exception',
                'error': str(e),
                'model': model_id,
                'provider': 'claude_code'
            }
