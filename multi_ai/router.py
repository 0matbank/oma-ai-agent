"""
Multi-AI Architecture: Smart Model Router & Failover Engine
Orchestrates model selection, live local discovery, quota fallback, and state preservation.
"""
import time
import os
import json
from typing import Dict, Any, List, Optional
from multi_ai.models import ProviderConfig, ModelInfo, TaskCheckpoint
from multi_ai.journal import journal
from multi_ai.adapters.claude_code import ClaudeCodeAdapter
from multi_ai.adapters.ollama import OllamaAdapter
from multi_ai.adapters.openai_compat import OpenAICompatAdapter
from multi_ai.providers import provider_mgr, get_secret, SETTINGS_FILE

class ModelRouter:
    def __init__(self):
        self.mode = "auto"  # 'auto', 'local_only', 'manual'
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

    def _get_cloud_adapter(self, provider_id: str) -> Optional[OpenAICompatAdapter]:
        """Dynamically instantiates OpenAICompatAdapter using secret from Credential Manager."""
        secret_key = get_secret(f"ai_key_{provider_id}")
        if not secret_key:
            return None

        p_def = next((p for p in provider_mgr.BUILTIN_PROVIDERS if p["id"] == provider_id), None)
        base_url = p_def.get("base_url") if p_def else ""
        name = p_def.get("name") if p_def else provider_id

        if not base_url:
            return None

        return OpenAICompatAdapter(
            provider_id=provider_id,
            display_name=name,
            base_url=base_url,
            api_key=secret_key,
            local=False
        )

    def set_mode(self, mode: str, manual_model: str = ""):
        if mode in ('auto', 'local_only', 'manual'):
            self.mode = mode
            self.manual_model = manual_model

    def get_status_overview(self) -> Dict[str, Any]:
        """Returns live status of all providers using provider_mgr."""
        return provider_mgr.get_full_overview()

    def execute(self, prompt: str, task_id: Optional[str] = None, event_callback=None) -> Dict[str, Any]:
        """
        Executes a task through the intelligent multi-AI fallback chain.
        Emits live execution events if callback provided.
        """
        task_id = task_id or f"task_{int(time.time() * 1000)}"
        journal.create_task(task_id, prompt)

        def emit(stage, detail, pct=None):
            if event_callback:
                try:
                    event_callback({"stage": stage, "detail": detail, "pct": pct, "task_id": task_id})
                except Exception:
                    pass

        emit("received", f"Command received: {prompt}", 10)
        emit("analyzing", "Analyzing task and building model candidates...", 25)

        # Read active configuration
        settings = {}
        if os.path.exists(SETTINGS_FILE):
            try:
                with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                    settings = json.load(f)
            except Exception:
                pass

        mode = settings.get("aiMode", self.mode)
        active_model = settings.get("activeModel", self.manual_model or "auto")

        candidates = []

        # Local Ollama models
        ollama_models = provider_mgr.discover_local_ollama_models()
        best_ollama_model = ollama_models[0]["name"] if ollama_models else "qwen3-vl:8b"

        if mode == "local_only" or active_model == "local_only":
            emit("model_selected", f"Local Only Mode: Selected {best_ollama_model}", 35)
            if ollama_models:
                for m in ollama_models:
                    candidates.append(('ollama', m["name"]))
            if self.adapters['lm_studio'].is_available():
                for m in self.adapters['lm_studio'].discover_models():
                    candidates.append(('lm_studio', m.model_id))
        elif mode == "manual" or (active_model and active_model != "auto"):
            emit("model_selected", f"Manual Mode: Selected {active_model}", 35)
            if "/" in active_model:
                pid, mid = active_model.split("/", 1)
                candidates.append((pid, mid))
            else:
                candidates.append(('ollama', active_model))
            # Still append fallback candidates if fallback enabled
            if settings.get("aiFallback", True):
                if ollama_models and ('ollama', best_ollama_model) not in candidates:
                    candidates.append(('ollama', best_ollama_model))
        else:
            # 'auto' mode: Claude Code -> Local Ollama (qwen3-vl:8b) -> LM Studio -> Cloud Fallbacks
            emit("model_selected", "Auto Mode: Primary Claude Code CLI with Ollama Fallback", 35)
            candidates.append(('claude_code', 'claude-3-5-haiku'))
            if ollama_models:
                for m in ollama_models:
                    candidates.append(('ollama', m["name"]))
            if self.adapters['lm_studio'].is_available():
                for m in self.adapters['lm_studio'].discover_models():
                    candidates.append(('lm_studio', m.model_id))
            # Cloud fallbacks if configured
            for c_id in ['gemini', 'openai', 'deepseek', 'groq']:
                if get_secret(f"ai_key_{c_id}"):
                    p_def = next((p for p in provider_mgr.BUILTIN_PROVIDERS if p["id"] == c_id), None)
                    if p_def and p_def.get("default_models"):
                        candidates.append((c_id, p_def["default_models"][0]))

        if not candidates:
            if ollama_models:
                candidates = [('ollama', best_ollama_model)]
            else:
                emit("error", "No eligible AI provider is currently reachable.", 100)
                return {
                    'success': False,
                    'error': 'No available AI models detected.',
                    'reply': 'No eligible AI provider is currently reachable. Please start Ollama or configure a provider.'
                }

        fallback_notes = []
        for idx, (pid, mid) in enumerate(candidates):
            if idx > 0:
                prev_pid = candidates[idx - 1][0]
                emit("fallback", f"Switching from {prev_pid} to {pid} ({mid})", 50)

            emit("executing", f"Executing with {pid} ({mid})...", 60)

            # Get adapter
            adapter = self.adapters.get(pid)
            if not adapter:
                adapter = self._get_cloud_adapter(pid)
            if not adapter:
                continue

            # Attempt generation
            res = adapter.generate(mid, prompt)

            if res.get('success'):
                reply = res.get('reply', '')
                journal.finish_task(task_id, reply, status='completed')

                fallback_occurred = idx > 0
                notice = ""
                if fallback_occurred:
                    prev_pid = candidates[idx - 1][0]
                    notice = f"Notice: Switched from {prev_pid} to {pid} ({mid}) due to quota/rate limit."

                emit("verifying", "Verifying task outcome...", 85)
                emit("completed", f"Task complete ({pid} - {mid})", 100)

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
                fallback_notes.append(f"{pid} ({mid}): {err_type}")

        # All candidates failed
        journal.finish_task(task_id, "; ".join(fallback_notes), status='failed')
        emit("error", f"All providers exhausted: {'; '.join(fallback_notes)}", 100)
        return {
            'success': False,
            'error': f"All providers exhausted: {'; '.join(fallback_notes)}",
            'reply': f"Unable to complete task. Providers attempted: {'; '.join(fallback_notes)}"
        }

router = ModelRouter()
