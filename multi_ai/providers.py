"""
Multi-AI Architecture: Provider Registry & Credential Manager
Manages Cloud & Local AI Providers, secure Windows Credential Manager storage,
live local model discovery (Ollama / LM Studio), and connection health diagnostics.
"""
import os
import sys
import json
import time
import urllib.request
import urllib.error
from typing import Dict, Any, List, Optional

# Import winctl for Windows Credential Manager support
try:
    import winctl
except ImportError:
    winctl = None

CONFIG_DIR = os.environ.get("ATTICUS_DIR") or os.path.join(
    os.environ.get("APPDATA", ""), "Atticus"
)
CUSTOM_PROVIDERS_FILE = os.path.join(CONFIG_DIR, "custom_providers.json")
SETTINGS_FILE = os.path.join(CONFIG_DIR, "settings.json")


def get_secret(key_name: str) -> str:
    """Reads secret securely from Windows Credential Manager."""
    if winctl and hasattr(winctl, "secret_get"):
        try:
            return winctl.secret_get(key_name)
        except Exception:
            return ""
    return ""


def set_secret(key_name: str, value: str) -> bool:
    """Writes secret securely to Windows Credential Manager."""
    if winctl and hasattr(winctl, "secret_set"):
        try:
            return winctl.secret_set(key_name, value)
        except Exception:
            return False
    return False


def load_custom_providers() -> List[Dict[str, Any]]:
    if not os.path.exists(CUSTOM_PROVIDERS_FILE):
        return []
    try:
        with open(CUSTOM_PROVIDERS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def save_custom_providers(providers: List[Dict[str, Any]]):
    os.makedirs(CONFIG_DIR, exist_ok=True)
    with open(CUSTOM_PROVIDERS_FILE, "w", encoding="utf-8") as f:
        json.dump(providers, f, indent=2)


class ProviderManager:
    """Unified AI Provider & Model Management Engine"""

    BUILTIN_PROVIDERS = [
        {
            "id": "claude_code",
            "name": "Claude Code (Anthropic)",
            "type": "cli_oauth",
            "auth_type": "OAuth / CLI Subscription",
            "local": False,
            "default_models": ["claude-3-5-haiku", "claude-3-7-sonnet", "claude-3-opus"],
            "doc_url": "https://claude.ai",
            "description": "Native Claude plan (Pro / Max) or Anthropic API subscription via Claude Code."
        },
        {
            "id": "ollama",
            "name": "Ollama (Local AI)",
            "type": "local",
            "auth_type": "None (Localhost)",
            "local": True,
            "base_url": "http://localhost:11434",
            "default_models": ["qwen3-vl:8b", "qwen3:8b", "llama3.2:latest"],
            "doc_url": "https://ollama.com",
            "description": "Private, zero-cost, local model execution directly on your GPU/CPU."
        },
        {
            "id": "lm_studio",
            "name": "LM Studio (Local AI)",
            "type": "local",
            "auth_type": "None (Localhost)",
            "local": True,
            "base_url": "http://localhost:1234/v1",
            "default_models": ["local-model"],
            "doc_url": "https://lmstudio.ai",
            "description": "Local inference server with OpenAI-compatible endpoint."
        },
        {
            "id": "openai",
            "name": "OpenAI (GPT-4o / o3-mini)",
            "type": "cloud_api",
            "auth_type": "API Key",
            "local": False,
            "base_url": "https://api.openai.com/v1",
            "default_models": ["gpt-4o", "gpt-4o-mini", "o3-mini", "gpt-4-turbo"],
            "doc_url": "https://platform.openai.com/api-keys",
            "description": "Official OpenAI state-of-the-art vision and reasoning models."
        },
        {
            "id": "gemini",
            "name": "Google Gemini",
            "type": "cloud_api",
            "auth_type": "API Key",
            "local": False,
            "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
            "default_models": ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
            "doc_url": "https://aistudio.google.com/apikey",
            "description": "Google ultra-low latency multimodal AI models."
        },
        {
            "id": "deepseek",
            "name": "DeepSeek",
            "type": "cloud_api",
            "auth_type": "API Key",
            "local": False,
            "base_url": "https://api.deepseek.com/v1",
            "default_models": ["deepseek-chat", "deepseek-reasoner"],
            "doc_url": "https://platform.deepseek.com",
            "description": "DeepSeek-V3 and R1 reasoning intelligence."
        },
        {
            "id": "groq",
            "name": "Groq LPU Accelerator",
            "type": "cloud_api",
            "auth_type": "API Key",
            "local": False,
            "base_url": "https://api.groq.com/openai/v1",
            "default_models": ["llama-3.3-70b-versatile", "mixtral-8x7b-32768"],
            "doc_url": "https://console.groq.com/keys",
            "description": "Ultra-fast inference (500+ tokens/sec) for instant responses."
        }
    ]

    def __init__(self):
        pass

    def discover_local_ollama_models(self) -> List[Dict[str, Any]]:
        """Queries local Ollama runtime on port 11434 for installed models."""
        models = []
        try:
            req = urllib.request.Request("http://localhost:11434/api/tags", headers={"User-Agent": "Oma-AI"})
            with urllib.request.urlopen(req, timeout=2.0) as res:
                if res.status == 200:
                    data = json.loads(res.read().decode("utf-8"))
                    for m in data.get("models", []):
                        name = m.get("name", "")
                        details = m.get("details", {})
                        models.append({
                            "name": name,
                            "parameter_size": details.get("parameter_size", "8B"),
                            "quantization": details.get("quantization_level", "Q4_K_M"),
                            "size_bytes": m.get("size", 0),
                            "vision": "vl" in name.lower() or "vision" in name.lower() or "vision" in m.get("capabilities", []),
                            "tools": True
                        })
        except Exception:
            pass
        return models

    def discover_local_lmstudio_models(self) -> List[Dict[str, Any]]:
        """Queries local LM Studio runtime on port 1234."""
        models = []
        try:
            req = urllib.request.Request("http://localhost:1234/v1/models", headers={"User-Agent": "Oma-AI"})
            with urllib.request.urlopen(req, timeout=1.5) as res:
                if res.status == 200:
                    data = json.loads(res.read().decode("utf-8"))
                    for m in data.get("data", []):
                        models.append({
                            "name": m.get("id", ""),
                            "tools": True,
                            "local": True
                        })
        except Exception:
            pass
        return models

    def get_provider_status(self, p_id: str) -> Dict[str, Any]:
        """Returns the live status, latency, and available models for a provider."""
        # 1. Claude Code
        if p_id == "claude_code":
            import subprocess
            try:
                res = subprocess.run(["claude", "auth", "status"], capture_output=True, text=True, timeout=3)
                if res.returncode == 0:
                    data = json.loads(res.stdout)
                    logged_in = data.get("loggedIn", False)
                    sub = (data.get("subscriptionType") or "Active").title()
                    return {
                        "status": "Connected" if logged_in else "Not Logged In",
                        "ok": logged_in,
                        "badge": "ok" if logged_in else "no",
                        "detail": f"Signed in ({sub})" if logged_in else "Run 'claude login'",
                        "models": ["claude-3-5-haiku", "claude-3-7-sonnet", "claude-3-opus"]
                    }
            except Exception:
                pass
            return {"status": "Offline / CLI missing", "ok": False, "badge": "wait", "detail": "Claude CLI not found", "models": []}

        # 2. Ollama
        if p_id == "ollama":
            ollama_models = self.discover_local_ollama_models()
            if ollama_models:
                return {
                    "status": "Online (Local)",
                    "ok": True,
                    "badge": "ok",
                    "detail": f"{len(ollama_models)} model(s) installed",
                    "models": [m["name"] for m in ollama_models],
                    "model_details": ollama_models
                }
            return {
                "status": "Offline",
                "ok": False,
                "badge": "wait",
                "detail": "Ollama service not running on port 11434",
                "models": []
            }

        # 3. LM Studio
        if p_id == "lm_studio":
            lm_models = self.discover_local_lmstudio_models()
            if lm_models:
                return {
                    "status": "Online (Local)",
                    "ok": True,
                    "badge": "ok",
                    "detail": f"{len(lm_models)} model(s) loaded",
                    "models": [m["name"] for m in lm_models]
                }
            return {
                "status": "Offline",
                "ok": False,
                "badge": "wait",
                "detail": "LM Studio server not running on port 1234",
                "models": []
            }

        # 4. Cloud Providers with Windows Credential Manager
        secret_key = get_secret(f"ai_key_{p_id}")
        has_key = bool(secret_key and len(secret_key.strip()) > 5)

        # Look up provider definition
        p_def = next((p for p in self.BUILTIN_PROVIDERS if p["id"] == p_id), None)
        if not p_def:
            # Custom provider
            customs = load_custom_providers()
            p_def = next((p for p in customs if p["id"] == p_id), None)

        if not p_def:
            return {"status": "Unknown", "ok": False, "badge": "wait", "detail": "", "models": []}

        if not has_key:
            return {
                "status": "Key Missing",
                "ok": False,
                "badge": "no",
                "detail": "No API key in Windows Credential Manager",
                "has_key": False,
                "models": p_def.get("default_models", [])
            }

        return {
            "status": "Configured",
            "ok": True,
            "badge": "ok",
            "detail": f"Key stored in Credential Manager (••••{secret_key[-4:] if len(secret_key) >= 4 else '••'})",
            "has_key": True,
            "models": p_def.get("default_models", [])
        }

    def test_provider_connection(self, p_id: str) -> Dict[str, Any]:
        """Tests live latency and auth for a given provider."""
        t0 = time.time()

        if p_id == "claude_code":
            import subprocess
            try:
                res = subprocess.run(["claude", "auth", "status"], capture_output=True, text=True, timeout=5)
                ms = int((time.time() - t0) * 1000)
                if res.returncode == 0:
                    data = json.loads(res.stdout)
                    if data.get("loggedIn"):
                        return {"ok": True, "status": "Ready", "message": f"Claude CLI connected ({data.get('subscriptionType', 'Paid')})", "latency_ms": ms}
                return {"ok": False, "status": "Not Logged In", "message": "Please log in to Claude in your terminal.", "latency_ms": ms}
            except Exception as e:
                return {"ok": False, "status": "Failed", "message": str(e), "latency_ms": -1}

        if p_id == "ollama":
            models = self.discover_local_ollama_models()
            ms = int((time.time() - t0) * 1000)
            if models:
                names = [m["name"] for m in models]
                return {
                    "ok": True,
                    "status": "Ready",
                    "message": f"Ollama running on localhost:11434. Models: {', '.join(names)}",
                    "latency_ms": ms,
                    "models": names
                }
            return {"ok": False, "status": "Offline", "message": "Ollama service unreachable on http://localhost:11434", "latency_ms": -1}

        if p_id == "lm_studio":
            models = self.discover_local_lmstudio_models()
            ms = int((time.time() - t0) * 1000)
            if models:
                names = [m["name"] for m in models]
                return {"ok": True, "status": "Ready", "message": f"LM Studio running. Models: {', '.join(names)}", "latency_ms": ms, "models": names}
            return {"ok": False, "status": "Offline", "message": "LM Studio unreachable on http://localhost:1234/v1", "latency_ms": -1}

        # Cloud or Custom Provider
        p_def = next((p for p in self.BUILTIN_PROVIDERS if p["id"] == p_id), None)
        if not p_def:
            customs = load_custom_providers()
            p_def = next((p for p in customs if p["id"] == p_id), None)

        if not p_def:
            return {"ok": False, "status": "Unknown", "message": f"Provider '{p_id}' not found", "latency_ms": -1}

        api_key = get_secret(f"ai_key_{p_id}")
        if not api_key:
            return {"ok": False, "status": "No Key", "message": "Please enter an API Key first.", "latency_ms": -1}

        base_url = p_def.get("base_url", "").rstrip("/")
        try:
            req = urllib.request.Request(f"{base_url}/models", headers={"Authorization": f"Bearer {api_key}", "User-Agent": "Oma-AI"})
            with urllib.request.urlopen(req, timeout=8.0) as res:
                ms = int((time.time() - t0) * 1000)
                if res.status == 200:
                    data = json.loads(res.read().decode("utf-8"))
                    avail_models = [m.get("id", "") for m in data.get("data", [])][:10]
                    return {
                        "ok": True,
                        "status": "Ready",
                        "message": f"Successfully authenticated! ({ms}ms)",
                        "latency_ms": ms,
                        "models": avail_models or p_def.get("default_models", [])
                    }
        except urllib.error.HTTPError as e:
            ms = int((time.time() - t0) * 1000)
            body = e.read().decode("utf-8", errors="ignore")
            if e.code == 401 or e.code == 403:
                return {"ok": False, "status": "Auth Error", "message": "Invalid API Key or unauthorized.", "latency_ms": ms}
            # Many providers might not support GET /models but work fine for completions
            return {"ok": True, "status": "Endpoint Reachable", "message": f"Server responded (HTTP {e.code}) in {ms}ms", "latency_ms": ms}
        except Exception as e:
            return {"ok": False, "status": "Failed", "message": str(e), "latency_ms": -1}

    def get_full_overview(self) -> Dict[str, Any]:
        """Returns complete list of providers, local models, and routing configs."""
        # Read user settings
        settings = {}
        if os.path.exists(SETTINGS_FILE):
            try:
                with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                    settings = json.load(f)
            except Exception:
                pass

        ai_mode = settings.get("aiMode", "auto")
        active_model = settings.get("activeModel", "auto")
        ai_fallback = settings.get("aiFallback", True)
        ai_fallback_notify = settings.get("aiFallbackNotify", True)

        # Local models
        local_ollama = self.discover_local_ollama_models()
        local_lm = self.discover_local_lmstudio_models()

        providers = []
        for p in self.BUILTIN_PROVIDERS:
            st = self.get_provider_status(p["id"])
            providers.append({**p, **st})

        for cp in load_custom_providers():
            st = self.get_provider_status(cp["id"])
            providers.append({**cp, **st, "custom": True})

        # Compile list of all available models for select dropdown
        all_models = [
            {"id": "auto", "name": "Auto (Smart Fallback: Claude -> Local Ollama)"},
            {"id": "local_only", "name": "Local AI Only (Privacy Mode)"}
        ]
        for m in local_ollama:
            all_models.append({
                "id": f"ollama/{m['name']}",
                "name": f"Ollama: {m['name']} ({m.get('parameter_size', '8B')}{' Vision' if m.get('vision') else ''})"
            })
        for m in local_lm:
            all_models.append({
                "id": f"lm_studio/{m['name']}",
                "name": f"LM Studio: {m['name']}"
            })
        all_models.extend([
            {"id": "claude/haiku", "name": "Claude 3.5 Haiku (Fastest)"},
            {"id": "claude/sonnet", "name": "Claude 3.7 Sonnet (Advanced)"},
            {"id": "openai/gpt-4o", "name": "OpenAI: GPT-4o"},
            {"id": "openai/gpt-4o-mini", "name": "OpenAI: GPT-4o-mini"},
            {"id": "gemini/gemini-2.0-flash", "name": "Google: Gemini 2.0 Flash"},
            {"id": "deepseek/deepseek-chat", "name": "DeepSeek: DeepSeek-V3"},
            {"id": "deepseek/deepseek-reasoner", "name": "DeepSeek: R1 Reasoner"},
            {"id": "groq/llama-3.3-70b-versatile", "name": "Groq: Llama 3.3 70B (Fast)"}
        ])

        return {
            "ai_mode": ai_mode,
            "active_model": active_model,
            "ai_fallback": ai_fallback,
            "ai_fallback_notify": ai_fallback_notify,
            "providers": providers,
            "local_models": local_ollama,
            "all_models": all_models
        }

    def save_provider_config(self, p_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Saves API key to Windows Credential Manager and custom provider definitions."""
        api_key = data.get("key", "").strip()
        if api_key:
            set_secret(f"ai_key_{p_id}", api_key)

        is_custom = data.get("custom", False) or not any(p["id"] == p_id for p in self.BUILTIN_PROVIDERS)
        if is_custom:
            customs = load_custom_providers()
            # update or append
            existing = next((c for c in customs if c["id"] == p_id), None)
            if existing:
                existing.update({
                    "name": data.get("name", existing.get("name")),
                    "base_url": data.get("url", existing.get("base_url")),
                    "default_models": [data.get("model", "")] if data.get("model") else existing.get("default_models", [])
                })
            else:
                customs.append({
                    "id": p_id,
                    "name": data.get("name", p_id),
                    "type": "custom_openai",
                    "auth_type": "API Key",
                    "local": False,
                    "base_url": data.get("url", ""),
                    "default_models": [data.get("model", "")] if data.get("model") else ["custom-model"],
                    "description": "User custom OpenAI-compatible endpoint."
                })
            save_custom_providers(customs)

        return {"ok": True, "message": "Provider settings saved securely."}

    def remove_custom_provider(self, p_id: str) -> Dict[str, Any]:
        """Removes custom provider definition and clears credential."""
        set_secret(f"ai_key_{p_id}", "")
        customs = [c for c in load_custom_providers() if c["id"] != p_id]
        save_custom_providers(customs)
        return {"ok": True, "message": f"Provider '{p_id}' removed."}


provider_mgr = ProviderManager()
