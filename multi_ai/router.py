"""
Multi-AI Architecture: Smart Model Router & Failover Engine
Orchestrates model selection, live local discovery, quota fallback, and state preservation.
"""
import time
from typing import Dict, Any, List, Optional
from multi_ai.models import ProviderConfig, ModelInfo, TaskCheckpoint
from multi_ai.journal import journal
from multi_ai.adapters.claude_code import ClaudeCodeAdapter
from multi_ai.adapters.ollama import OllamaAdapter
from multi_ai.adapters.openai_compat import OpenAICompatAdapter

class ModelRouter:
    def __init__(self):
        self.mode = "auto" # 'auto', 'local_only', 'manual'
        self.manual_model = ""
        self.adapters: Dict[str, Any] = {}
        self.providers: Dict[str, ProviderConfig] = {}
        self._init_providers()

    def _init_providers(self):
        # 1. Claude Code CLI Adapter
        self.adapters['claude_code'] = ClaudeCodeAdapter()
        self.providers['claude_code'] = ProviderConfig(
            id='claude_code',
            display_name='Claude Code (CLI Subscription)',
            adapter_type='claude_code',
            priority=1,
            local=False
        )

        # 2. Ollama Local Runtime Adapter
        self.adapters['ollama'] = OllamaAdapter("http://localhost:11434")
        self.providers['ollama'] = ProviderConfig(
            id='ollama',
            display_name='Ollama (Localhost 11434)',
            adapter_type='ollama',
            base_url='http://localhost:11434',
            priority=2,
            local=True
        )

        # 3. LM Studio Local Adapter
        self.adapters['lm_studio'] = OpenAICompatAdapter(
            provider_id='lm_studio',
            display_name='LM Studio (Localhost 1234)',
            base_url='http://localhost:1234/v1',
            local=True
        )
        self.providers['lm_studio'] = ProviderConfig(
            id='lm_studio',
            display_name='LM Studio (Localhost 1234)',
            adapter_type='lm_studio',
            base_url='http://localhost:1234/v1',
            priority=3,
            local=True
        )

    def set_mode(self, mode: str, manual_model: str = ""):
        if mode in ('auto', 'local_only', 'manual'):
            self.mode = mode
            self.manual_model = manual_model

    def get_status_overview(self) -> Dict[str, Any]:
        """Returns live status of all providers and discovered models."""
        overview = {
            'mode': self.mode,
            'manual_model': self.manual_model,
            'providers': []
        }
        for pid, p in self.providers.items():
            adapter = self.adapters.get(pid)
            avail = adapter.is_available() if adapter else False
            models = adapter.discover_models() if (adapter and avail) else []
            overview['providers'].append({
                'id': pid,
                'name': p.display_name,
                'available': avail,
                'local': p.local,
                'models': [m.model_id for m in models]
            })
        return overview

    def execute(self, prompt: str, task_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Executes a task through the intelligent multi-AI fallback chain.
        """
        task_id = task_id or f"task_{int(time.time() * 1000)}"
        journal.create_task(task_id, prompt)

        # Build candidate models based on mode
        candidates = []

        if self.mode == "local_only":
            # Only local providers: Ollama, LM Studio
            if self.adapters['ollama'].is_available():
                for m in self.adapters['ollama'].discover_models():
                    candidates.append(('ollama', m.model_id))
            if self.adapters['lm_studio'].is_available():
                for m in self.adapters['lm_studio'].discover_models():
                    candidates.append(('lm_studio', m.model_id))
        elif self.mode == "manual" and self.manual_model:
            # User specified model
            for pid, adapter in self.adapters.items():
                for m in adapter.discover_models():
                    if m.model_id == self.manual_model:
                        candidates.append((pid, m.model_id))
                        break
        else:
            # 'auto' mode: Claude Code -> Local Ollama -> Local LM Studio
            candidates.append(('claude_code', 'claude-3-5-haiku'))
            if self.adapters['ollama'].is_available():
                for m in self.adapters['ollama'].discover_models():
                    candidates.append(('ollama', m.model_id))
            if self.adapters['lm_studio'].is_available():
                for m in self.adapters['lm_studio'].discover_models():
                    candidates.append(('lm_studio', m.model_id))

        if not candidates:
            # Fallback to local Ollama if running
            if self.adapters['ollama'].is_available():
                candidates = [('ollama', 'qwen3-vl:8b')]
            else:
                return {
                    'success': False,
                    'error': 'No available AI models detected.',
                    'reply': 'No eligible AI provider is currently reachable.'
                }

        fallback_notes = []
        for idx, (pid, mid) in enumerate(candidates):
            adapter = self.adapters.get(pid)
            if not adapter:
                continue

            # Attempt generation with candidate
            res = adapter.generate(mid, prompt)

            if res.get('success'):
                reply = res.get('reply', '')
                journal.finish_task(task_id, reply, status='completed')

                fallback_occurred = idx > 0
                notice = ""
                if fallback_occurred:
                    prev_pid = candidates[idx - 1][0]
                    notice = f"Notice: Switched from {prev_pid} to {pid} ({mid}) due to limit/availability."

                return {
                    'success': True,
                    'reply': reply,
                    'model_used': mid,
                    'provider_used': pid,
                    'fallback_occurred': fallback_occurred,
                    'fallback_notice': notice
                }
            else:
                err = res.get('error', 'Execution failed')
                err_type = res.get('error_type', 'generic')
                fallback_notes.append(f"{pid} ({mid}) failed: {err_type}")

        # All failed
        journal.finish_task(task_id, "; ".join(fallback_notes), status='failed')
        return {
            'success': False,
            'error': f"All providers exhausted: {'; '.join(fallback_notes)}",
            'reply': f"Unable to complete task. All available AI providers failed: {'; '.join(fallback_notes)}"
        }

router = ModelRouter()
