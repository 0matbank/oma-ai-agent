"""
Multi-AI Architecture: Claude Code adapter (connection test and text-only use).

Real requests that act on the PC go through atticus.py's own Claude Code engine (tools, memory, safety gate). This
adapter only answers text and tests the connection. Model IDs are the CLI's aliases (haiku / sonnet / opus): the CLI
resolves them to the current model (a dated ID such as claude-3-5-haiku was retired and fails). The resolved ID the
CLI reports is recorded in the model-health cache. Never invokes atticus.py.
"""
import json
import os
import shutil
import subprocess
from typing import Any, Dict, List

from multi_ai.models import ModelInfo


def _alias(model_id: str) -> str:
    m = (model_id or '').split('/')[-1].lower()
    for a in ('opus', 'sonnet', 'haiku'):
        if a in m:
            return a
    return m or 'haiku'


class ClaudeCodeAdapter:
    def __init__(self, claude_path: str = None, timeout: float = 90.0):
        self.claude_path = claude_path or shutil.which("claude") or os.path.expanduser(r"~/.local/bin/claude.exe")
        self.timeout = timeout

    def discover_models(self) -> List[ModelInfo]:
        from multi_ai.model_catalog import CLAUDE_ALIASES, claude_resolved
        return [ModelInfo(model_id=a, provider_id='claude_code', display_name=f"Claude {a.title()}" + (f" ({claude_resolved(a)})" if claude_resolved(a) else ''),
                          supports_tools=True, supports_vision=True, context_limit=200000) for a in CLAUDE_ALIASES]

    def is_available(self) -> bool:
        return bool(self.claude_path) and os.path.exists(self.claude_path)

    def generate(self, model_id: str, prompt: str, system_prompt: str = "") -> Dict[str, Any]:
        from multi_ai.model_catalog import record
        alias = _alias(model_id)
        base = {'model': alias, 'provider': 'claude_code'}
        if os.environ.get("OMA_ROUTER_FALLBACK") == "1":
            return {**base, 'success': False, 'error_type': 'recursion_blocked', 'error': 'Claude Code is not called from inside a fallback'}
        if not self.is_available():
            return {**base, 'success': False, 'error_type': 'not_installed', 'error': 'Claude CLI (claude.exe) not found'}
        cmd = [self.claude_path, '-p', prompt, '--model', alias, '--output-format', 'json', '--no-session-persistence', '--tools', '']
        if system_prompt:
            cmd += ['--append-system-prompt', system_prompt[:4000]]
        try:
            res = subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=self.timeout)
        except subprocess.TimeoutExpired:
            return {**base, 'success': False, 'error_type': 'timeout', 'error': f'Claude CLI timed out after {self.timeout:.0f}s'}
        except Exception as e:
            return {**base, 'success': False, 'error_type': 'exception', 'error': str(e)}
        try:
            j = json.loads(res.stdout)
        except ValueError:
            j = {}
        text = (j.get('result') or res.stdout or res.stderr or '').strip()
        resolved = next(iter(j.get('modelUsage') or {}), '')
        if res.returncode == 0 and j and not j.get('is_error') and text:
            record('claude_code', alias, 'ok', 'answered', resolved)
            return {**base, 'success': True, 'reply': text, 'resolved_model': resolved}
        low = text.lower()
        kind = ('quota_exhausted' if any(w in low for w in ('weekly limit', 'hit your limit', 'usage limit', 'quota')) else
                'rate_limited' if 'rate limit' in low or 'overloaded' in low else
                'model_unavailable' if 'selected model' in low or 'may not exist' in low else
                'auth_error' if 'login' in low or 'auth' in low else f'exit_code_{res.returncode}')
        record('claude_code', alias, {'model_unavailable': 'gone', 'auth_error': 'auth'}.get(kind, 'busy'), kind, resolved)
        return {**base, 'success': False, 'error_type': kind, 'error': text[:300] or f'Claude CLI exited with code {res.returncode}'}
