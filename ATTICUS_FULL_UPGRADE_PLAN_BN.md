# ATTICUS WINDOWS — UNIVERSAL MULTI-AI PERSONAL ASSISTANT
## Full Upgrade Plan | 2026-10-27 | Bangla

### 0. প্রকৃত লক্ষ্য ও সীমা

Target repository: https://github.com/FindlayHi/atticus-windows

Original product-এর Voice Overlay, Hotkey, Windows UI Automation, Local Quick Commands, Safe Mode, Permission Gate, Memory, Integrations, MCP, Workflow Learning, Audio এবং Existing User Settings **অবিকৃত রাখতে হবে**।

**Target:** Atticus-এ যত নতুন Provider/Model যোগ করা যায়, তা Provider Adapter দিয়ে যোগ করা যাবে। Local ও Cloud Model task-এর capability ও ব্যয় অনুসারে নির্বাচিত হবে। Rate Limit/Quota/Timeout হলে কাজের context বজায় রেখে অন্য eligible ও অনুমোদিত Model-এ Fallback হবে। একেবারে সব AI Service একই API বা একই Login দেয় না; তাই universal plugin architecture চাই, provider-specific adapter লাগতে পারে।

**Deliverable scope:** এই ফাইল architecture spec, ইতিমধ্যে তৈরি zip-এ থাকা Python starter কেবল text-generation router। মূল Windows Application-এ actual merge/build/deploy/test এখনো করা হয়নি।

### 1. Current Code Audit (27 Oct 2026)

- `atticus.py` ~ line 1184 `start_claude()` launches `claude -p` with `stream-json`, Claude-specific tools, Hook/Permissions and MCP settings.
- `atticus.py` ~ line 1243 `run()` parses Claude streaming output, tool calls and result; returns `(reply,cost,steps)` plus `run.ok/run.ran/run.cmds` global state.
- `atticus.py` ~ line 1694 first Claude `run()` and ~ line 1697 error fallback to Sonnet only; this area is the integration seam.
- `atticus.py` ~ line 258 `gate()` is a Claude Code PreToolUse permission hook, not a provider-neutral action policy. Reusing model instructions alone is insecure.
- `ui/settings.html` ~ line 198 Intelligence section contains Haiku, Sonnet, Opus and two escalation toggles; C# WebView2/Settings host messages must be extended for provider/account models.
- Settings source of truth: `%APPDATA%/Atticus/settings.json`; new provider secrets must **not** enter that JSON.
- Repo README notes auto-updater. Custom fork must pin updates and support upstream merges / migration.

### 2. Target Modules

```
atticus.py (existing orchestration entrypoint)
  ├── Intent / Task State / Privacy Classifier
  ├── ModelRouter (routing policies, cooldown, provider health)
  │   ├── Provider Registry and Dynamic Model Catalog
  │   ├── Claude Code Adapter (existing subscription flow)
  │   ├── Anthropic API Adapter
  │   ├── OpenAI Adapter (Responses + tools)
  │   ├── Google Gemini Adapter (native / compatible API)
  │   ├── Generic OpenAI-compatible Adapter (Groq, DeepSeek, xAI, etc.)
  │   ├── OpenRouter / custom endpoint adapter
  │   ├── Ollama Adapter (localhost / API)
  │   └── LM Studio / llama.cpp / vLLM Adapter
  ├── Credential Manager (Windows Credential Locker; OAuth PKCE when supported)
  ├── Shared Agent Loop (plan -> tool request -> policy -> action -> verify -> observation)
  ├── Windows Tool Registry (existing winctl.py and atticus.py CLI helpers)
  ├── Action Policy and Approval Gate (independent of the Model)
  ├── Task Checkpoint / Idempotency Journal (SQLite)
  ├── Rate and Quota Monitor / Cost / Health / Cooldowns
  └── Existing Memory, Learning, Log and Overlay
```

### 3. Provider Registry & Models

Provider fields: `id`, `display_name`, `adapter_type`, `base_url`, `auth_kind`, `credential_ref`, `account_alias`, `enabled`, `allowed_models`, `known_capabilities`, `last_health`, `quota_window`, `cooldown_until`, `manual_priority`, `remote_data_allowed`.

Model fields: `model_id`, `provider_id`, `supports_text`, `supports_vision`, `supports_tool_calls`, `supports_streaming`, `context_limit`, `max_output`, `allowed_tasks`, `tested_tool_accuracy`, `local`, `estimated_cost`, `latency_ewma`, `availability`, `enabled`.

Defaults: `Auto` mode and `Manual` override; `Local only` privacy mode; local-first for simple text, trusted cloud for difficult tool/vision tasks until local capability verified. Model catalog dynamically refreshed when provider supports listing; cache listing, do not auto-activate expensive or unsupported models. Cloud model IDs cannot be assumed fixed forever.

Provider adapters: Claude Code retains old flow; native Anthropic/OpenAI/Gemini with tool schema; OpenAI-compatible for DeepSeek, Groq, xAI Grok, OpenRouter, Mistral, Together, Fireworks and user-provided endpoints (according to their respective compatibility and feature constraints). LM Studio / Ollama / llama.cpp via localhost. Treat other AI providers as future adapters, never hardcode the claim “all models work out of the box.”

### 4. Credentials and Sign-in Design

Settings → Accounts / Providers: each provider shows:

- `Connect with API Key` (secure masked input, Test, Save, Rotate, Remove)
- `Sign in with Browser` only when official provider OAuth/SSO/device flow is supported and permitted. System browser + OAuth Authorization Code with PKCE, secure state/nonce and callback handling; avoid asking for raw passwords.
- `Connect Existing CLI Session` for Claude Code, and possibly official CLIs where supported and allowed.
- `Local Server` host/port, Test Connection, Discover Models.

Never collect/store Google/Gmail password, Claude password or ChatGPT password in Atticus. User logs in directly on the provider's own official page, after which **authorized** tokens are stored securely. Gmail login alone is not a universal AI entitlement. Google OAuth for Google account and Gmail data integration are **different permission scopes**. Adding Gmail account should not automatically grant Atticus mailbox access. Gmail integration must use Gmail API OAuth with least privilege and explicit consent; do not ask for email password.

Use Windows Credential Manager via keyring / secure Windows-native APIs. Store only opaque key references in normal JSON. Never put key into prompt, stdout, Git repo, telemetry, debug logs, screenshot, crash reports or unencrypted backup. Token refresh and revocation per-provider. Warn if Claude Code session picks `ANTHROPIC_API_KEY` unexpectedly because API billing can override subscription use.

### 5. Routing / Auto-Switch Rules

Intents: simple_text, coding, research, reasoning, vision, translation, Windows_action, browser_action, email_action, file_action. Start with rule-based classification + validated capability registry, optional AI planning only when needed.

Scoring: hard filter by enabled, authorization, capabilities, local_only/privacy, tool safety; then prioritize reliability, user preference, latency, estimated cost, local availability, cooldown, task specialization. User manual mode must stay fixed unless explicit fallback preference enabled.

Errors:
- HTTP 429/rate limited and explicit quota exhausted: enter provider/model cooldown honoring Retry-After and account window; try next eligible provider.
- 500/502/503/504, transient network or timeout: exponential backoff with jitter, bounded retries, then next provider. Distinguish uncertain tool outcome.
- 401/403: mark account `Reconnect required`, surface secure login, optional independent available provider fallback for read-only tasks; never auto-guess credentials.
- 400/incompatible request: use another supported adapter/model only if safe, record compatibility issue.
- policy/permission denied: stop, never workaround by switching model.
- context too long: safe summarization/checkpoint or request better model; no silent loss of user requirements.
- all providers exhausted: return actionable error, never claim completion.

Attempt budget (configurable), cooldown per provider/account/model, circuit-breaker, Cost Cap and warning before exceeding paid budget. `Local only` must never silently fall back to cloud. No provider subscription quota bypassing or multiple-account cycling to evade platform limits. Costs/quota policies must be respected.

### 6. Shared Tools and Permission Gate (critical)

Original Claude Code can call Bash/Read/WebSearch/WebFetch and its Hook. Other models produce provider-specific function calls, not automatically executable shell commands.

Create explicit safe ToolRegistry with strict schema e.g. `get_open_windows`, `focus_window`, `move_window`, `screenshot_active`, `search_files`, `read_approved_file`, `type_text`, `click_accessible_button`, `open_url`, `web_search`, `send_message`. Create hand-coded adapters wrapping existing `winctl.py` / Atticus CLI helpers. Do not expose unrestricted raw shell or arbitrary file operations to cloud/local models. Allow advanced OS commands only with explicit context and approval.

Policy must be enforced outside the LLM: argument validation, app/path allowlists and deny lists, user approval for write/delete/send/buy/install, confirmation of exact target/action, rate bounds, timeouts, output size limits, readable audit log, kill switch. Denied actions are final until a new explicit user instruction.

### 7. Task Checkpoint / Resume

Each task has `task_id`, `user_intent`, `approved_scopes`, `privacy_label`, `conversation_context`, `planned_steps`, `completed_steps`, `pending_steps`, `tool_result`, `artifact_refs`, `model_failures`, `timestamp`. SQLite `action_journal` with state `planned`, `approved`, `started`, `verified`, `failed`, `unknown`. Each external side-effect has an idempotency key; verification must query real app/system state. On uncertain state, pause and ask user rather than re-send/re-delete/re-purchase.

On Model switch: provide only necessary current state, concise sanitized log and next action. Never replay completed writes by default. For email, payment, file deletion and account-changing operations require user confirmation after failover if outcome uncertain. Store/checkpoint with privacy controls; do not forward screen/files/credentials to a provider not approved for that data.

### 8. Dashboard UI Changes

Maintain current Atticus visual style and overlay proportions; add in Settings:

A) `AI Providers`: provider row icon, connection status, API Key, browser sign-in where supported, credential reset, Test.
B) `Model Library`: search, model ID, capability tags, local/cloud, priority, enabled, provider filters, Refresh List.
C) `Smart Routing`: Auto/Manual/Local Only, toggles for Auto-Fallback, task rules, spending ceilings, context privacy.
D) `Local AI`: Auto Detect (Ollama 11434, LM Studio 1234), user Custom Server, discovered local model list, Test tool capability, VRAM/RAM warning.
E) `Usage & Health`: daily/monthly usage, vendor-reported quota if API exposes it, 429 cooldown, estimated cost vs provider-reported billed amount, current active provider, recent failovers.
F) `Accounts`: add/reconnect/remove provider, never user-password field. Gmail integration (mail access) separate permission screen from Gemini AI.

Overlay: show model label unobtrusively and switch notice such as `Gemini limited → Local Qwen`, with no duplicate user prompt for safe read-only work. Preserve Existing Hotkeys, Speech, UI colors and Accessibility.

### 9. Hardware & Performance

User PC: Ryzen 7 7700, RTX 5060 Ti 16GB VRAM, 16GB system RAM, Windows 11. Prefer one local heavyweight model loaded at a time, keep a fast smaller model for simple chat if memory permits; queue rather than concurrently loading multiple 14B+ models. Be careful about 16GB system RAM: VRAM does not replace normal RAM. Probe loaded models and actual GPU memory; do not invent benchmark performance. Offline mode should block cloud, not merely prefer local.

### 10. Implementation Phases (do not skip)

Phase 0. Create personal fork and local branch, read LICENSE, inventory source, backup `%APPDATA%\Atticus` and `%USERPROFILE%\.atticus`. Turn off upstream auto-update for custom installation. Confirm existing build and tests.

Phase 1. Build Provider Interface and Config Migration (legacy Claude unchanged, migration backward compatible). Unit tests with mock providers.

Phase 2. Credential Manager and UI (masked key, browser OAuth only for supported official provider flows, no plaintext password). Authentication and revoke tests.

Phase 3. Local AI Discovery / inference provider. Discover Ollama and LM Studio models, detect server and capability, test offline, avoid auto-download.

Phase 4. Cloud APIs and catalogs: OpenAI, Anthropic API, Gemini, DeepSeek, Groq, xAI, OpenRouter, Mistral, Together, Fireworks, Custom OpenAI-compatible. Add only validated endpoints and model availability; verified auth & error classification.

Phase 5. Shared Tools + Per-Tool Permission System. Wrap existing Windows operations, contract tests, prompt-injection defense and allow/deny regression tests. Leave Claude original hooks working.

Phase 6. Task State, Action Journal, safe retry/failover. Integration tests with forced failures at each tool stage; no duplicate side effects.

Phase 7. Model Selection UI and Auto Mode. Task suitability tests; prioritize installed local models; manual override; explain model switches.

Phase 8. Cost/Quota Monitor and Privacy Controls. Cooldown, cost limits, separate per-account state, key sanitization.

Phase 9. Voice Bangla/English/Banglish accuracy via optional multilingual Whisper; regression tests for hotkeys and microphone.

Phase 10. Release: signed/verified Windows build where possible, README and screenshots, safe installer and custom-fork updates, rollback. Complete Windows 11 GUI + multi-monitor end-to-end smoke testing with all connected providers.

### 11. Acceptance Criteria (hard gate)

- Original Atticus voice/text shortcuts, quick actions, memory, web, file tools, and Windows permissions still work.
- Add Model manually using supported endpoint, Key never appears in JSON/log.
- Official browser login for Claude CLI continues; provider OAuth only where an official supported flow is implemented.
- Existing Ollama/LM Studio local models are discovered without a new download.
- Local-only mode makes zero external AI HTTP calls.
- Simulated quota error triggers different eligible provider and preserves task history.
- Tool action after switch never re-sends a verified email or duplicates file write.
- API failure or unsafe action does not get disguised as task success.
- Model without verified vision/tools is not selected for those tasks.
- All CI tests pass, manual desktop tests pass, exact provider/model/version recorded.
- Update system cannot silently replace locally edited production build with upstream main.

### 12. Risks and Design Choices

1. No true universal Gmail/email/password login for every AI product. Some only expose API keys, some browser/device authorization, some have no public API.
2. “Any AI model” means extensible provider architecture; models differ in tool schema, context, billing, safety and quality.
3. ChatGPT subscriptions and OpenAI API usage have separate billing; Claude Code API keys may override logged-in plan and incur API charges.
4. Claude subscription use should remain inside officially supported Claude Code workflows and comply with provider terms; don't circumvent usage limits.
5. Local models can fail tool-calling tests; don't assume all downloaded models can drive Windows actions.
6. Cloud sends data off device; privacy/policy approval needed for screenshots, file content and mailbox operations.

### 13. Useful Docs

- Windows fork: https://github.com/FindlayHi/atticus-windows
- Claude Code auth: https://support.claude.com/en/articles/12304248-manage-api-key-environment-variables-in-claude-code
- OpenAI vs ChatGPT billing: https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform
- Gemini OpenAI-compatible endpoint: https://ai.google.dev/gemini-api/docs/openai/
- Ollama API: https://github.com/ollama/ollama/blob/main/docs/api.md
- LM Studio Server: https://lmstudio.ai/docs/developer/core/server
- Python keyring: https://keyring.readthedocs.io/en/latest/
