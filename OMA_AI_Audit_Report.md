# OMA AI independent audit

Date: 27 October 2026 (Asia/Dhaka)

**Status: source audit and isolated backend checks completed for the findings below. Full installed Windows application audit is BLOCKED / NOT VERIFIED. No application repairs were made.**

## Executive finding

The repository contains substantial UI work and real backend components, but they do not form one consistent execution pipeline. The new desktop chat, original voice overlay, and HTTP dashboard use different paths with different routing, memory, permissions, and error behavior. Several defects were reproduced independently without Windows or live AI services. These are source-level findings, not proof of the exact failure occurring in the installed executable.

The reported symptom, “the desktop app opens but does not respond,” remains **NOT VERIFIED on the user's PC**. A particularly relevant source defect is that the new chat worker does not read stderr, inspect its exit code, enforce a timeout, or guarantee an error response. Routing problems and empty successful model responses can then leave the interface without a useful answer. The installed files and a correlated request log are required to determine which failure actually occurs there.

## Evidence and limits

| Item | Evidence / status |
|---|---|
| OMA source | Git clone, commit `3c08a84a6f87aa5e11a760a8a32a73facc1f44dc` |
| Original Atticus comparison | Git clone, commit `657cc26d9cac48ce6951958fc4b2b519787a0af6` |
| OMA HEAD subject | `fix(engine): emergency repair recursive process loop and nested context in Oma AI` |
| Audit execution environment | Linux x86_64, separate workspace |
| `F:\Oma Ai Agent` | NOT VERIFIED: not mounted or accessible |
| `%LOCALAPPDATA%\Programs\Atticus\Atticus.exe` | NOT VERIFIED: no Windows desktop access |
| Local Ollama, Claude login, cloud accounts | NOT VERIFIED: no access to user's running services or credentials |
| User's RAM, CPU, GPU, VRAM | NOT VERIFIED: no measurements from user's machine |
| Installed app screenshots | NOT VERIFIED: none captured; no mock screenshot substituted |
| Application changes | None; both downloaded source snapshots retained unchanged in Git |
| Test isolation | Temporary ATTICUS_DIR and OMA_DIR; mocked providers and tool side effects; no real credentials read or written |

All source references below refer to the pinned OMA commit unless explicitly marked original. “CONFIRMED SOURCE” means inspected implementation. “REPRODUCED” means an isolated test reproduced the behavior. Neither label means a real Windows UI test passed. Components not explicitly verified remain **NOT VERIFIED**.

## 1. Actual execution paths

### A. New installed desktop chat

`ui/settings.html:3254` sendDirective → `window.webkit.messageHandlers.st.postMessage` → `win/Atticus/Web.cs:11,30` bridge → `Windows.cs:228` ask handler → `Prefs.cs:78` Py.Start → installed `atticus.py --oma-ask` → `atticus.py:1767` router → adapter → stdout `§EVENT§` / `§REPLY§` → `Windows.cs:233` feedLine → `settings.html:3360` render.

This is a real source connection. It does not use `server.py`. It also bypasses the original request preparation that supplies memory, prior turns, screenshots, original tools, and permission hooks.

### B. Original hotkey/voice overlay

Whisper / original input → `Overlay.cs:528` `atticus.py --wait` → stdin containing foreground-app and request → `atticus.py:1800` warm Claude process → original fast command or context-building path → original `run()` → conditional Multi-AI fallback → original stdout line protocol → `Overlay.cs:548` OnLine.

This path still starts Claude first. It is not the same router-first execution used by new chat.

### C. HTTP dashboard

`start.bat` → `server.py` → `ui/index.html` / `app.js` → POST `/api/command` → keyword intent overrides / subprocess helpers / router → JSON response.

The helper script prefers hardcoded `C:\Users\USERAS` locations and falls back to repository files. HTTP dashboard success does not establish installed desktop success.

### D. Additional divergent sources

`win/Oma` and `oma.py` exist, but `build.ps1:43` publishes `win/Atticus`. The alternate project's settings and engine paths differ. Changes in the alternate tree do not automatically enter `Atticus.exe`.

## 2. Prioritized findings

### F01. New desktop chat can swallow backend failure (P1, CONFIRMED SOURCE)

**Lines:** `win/Atticus/Windows.cs:228–240`; `win/Atticus/Prefs.cs:80`; `ui/settings.html:3360–3398`.

The chat handler launches a task, reads only stdout synchronously until EOF, waits for exit, and calls feedDone. stderr is redirected by Py.Start but not drained by this handler. No catch/finally, timeout, exit-code inspection, cancellation, or missing-final-reply error is provided. A Python import/startup failure can produce no visible answer; enough stderr can also block the child. Exceptions before feedDone leave lifecycle cleanup unfinished. The final renderer catches parse/render exceptions silently.

**Repair recommendation:** drain both streams asynchronously; log request-scoped stderr with secret redaction; enforce cancellation/deadline; send exactly one terminal result even on spawn failure, nonzero exit, malformed output, or EOF without a reply. Do not label this as the proven installed root cause until a real request trace identifies it.

### F02. Desktop chat excludes Claude even for a top-level request (P1, REPRODUCED)

**Lines:** `atticus.py:36–44,1767–1773`; `multi_ai/router.py:151–153`.

Every invocation sets OMA_IN_ATTICUS=1 before dispatch. New chat enters the router through that same script, and the router excludes claude_code whenever this marker is set. A top-level --oma-ask is therefore treated like nested fallback. The isolated candidate trace confirmed Claude disappears with this marker.

**Repair:** distinguish request entry from recursive fallback; retain a bounded execution-depth guard without excluding the first legitimate provider.

### F03. Original overlay ignores Local Only as its primary route; missing Claude skips fallback (P1, REPRODUCED in part)

**Lines:** `atticus.py:1800,1857–1862`; `atticus.py:1348–1355`.

The overlay calls start_claude before the prompt is processed and builds the original Claude request. The new aiMode setting is not consulted here. If start_claude returns no process, run() returns a setup message before reaching the Multi-AI fallback block. A mocked missing-Claude test confirmed router.execute was never called.

**Repair:** share provider selection across chat and overlay, while preserving original fast commands, memory, permissions and output adapters. A Local Only setting must prevent cloud startup in every entry path.

### F04. Fallback cap and provider deduplication conflict (P1, REPRODUCED)

**Lines:** `multi_ai/router.py:178–195,212–215`.

Candidate slots are truncated to three before deduplication by provider. With Claude, qwen3-vl:8b and qwen3:8b occupying those slots, only Claude and the first Ollama model execute. The second Ollama model is skipped because its provider was already attempted; LM Studio and cloud entries were already truncated. The isolated test recorded exactly those two calls.

**Repair:** define attempt identity as provider/model where appropriate, deduplicate before applying the attempt budget, and distinguish model-specific failure from provider-wide failure.

### F05. Fallback preference is ignored in Auto mode (P1, REPRODUCED)

**Lines:** `multi_ai/router.py:172–191`.

aiFallback is consulted in the manual branch but not the auto branch. With aiMode=auto and aiFallback=false, the test still called Claude and then Ollama.

**Repair:** enforce the fallback preference centrally for all modes and both desktop entry paths.

### F06. Model/provider selectors contain incompatible identifiers (P1, REPRODUCED)

**Lines:** `multi_ai/providers.py:405–406`; `multi_ai/router.py:165–168,222–227`; `multi_ai/adapters/claude_code.py:66`.

The selector offers claude/haiku and claude/sonnet, but the adapter is registered as claude_code. Manual selection with fallback disabled produced `claude: not configured`. Separately, ClaudeCodeAdapter accepts model_id but omits --model from the executed command, so a model label is not proof of the model actually used.

**Repair:** use a single canonical provider/model registry and pass the selected model to the CLI. Current availability of the hardcoded cloud model names is NOT VERIFIED.

### F07. Custom providers save but cannot be resolved for execution (P1, REPRODUCED)

**Lines:** `multi_ai/providers.py:425–455`; `multi_ai/router.py:80–90`.

The provider manager stores custom definitions, but _get_cloud_adapter searches only BUILTIN_PROVIDERS. With a fixture key and a custom definition present, adapter creation returned None.

**Repair:** resolve built-in and custom definitions through the same validated registry; ensure custom models also appear in executable selections.

### F08. Ollama integration is not a general tool/vision agent (P1, REPRODUCED payload)

**Lines:** `multi_ai/adapters/ollama.py:48–103`.

Three hardcoded app intents run directly; all other requests use /api/generate with model, prompt and stream=false. No image is attached for qwen3-vl. No tool schema, tool-call loop, conversation messages, or original Atticus system prompt is sent. A mocked screen request captured precisely that text-only payload. Merely choosing a vision model does not connect screen understanding.

**Repair:** integrate capability-aware tool and image requests with original policy and verification. Retain simple fast commands separately. Real Qwen inference quality and installed capability support remain NOT VERIFIED.

### F09. Empty answers and tool failures are reported as success (P1, REPRODUCED)

**Lines:** `multi_ai/adapters/ollama.py:65–72,93–102`; `multi_ai/adapters/openai_compat.py:86–111`; `multi_ai/router.py:233–245`; `multi_ai/tools.py:77–84`.

An empty response became success=true with an empty reply. A tool result saying “Error opening calculator” also became success=true. The router marks the journal completed and emits “Verifying” without an actual verification operation. The shell launch fallback reports success after Popen creation, without checking launch outcome.

**Repair:** structured tool results, nonempty reply checks, explicit outcome verification, and accurate failed/cancelled/partial states.

### F10. New tools do not preserve the original permission gate (P0 before enabling broad tools, CONFIRMED SOURCE)

**Lines:** `multi_ai/tools.py:25–30,50–84,218–235`; original gate in `atticus.py:296–310,1297–1299`.

is_safe_command is defined but has no call site. execute_tool_call dispatches directly and does not consult original Safe mode or request approval. open_app accepts arbitrary input, uses os.startfile, and falls back to a shell command containing that input. This is broader than a fixed safe app allowlist. The direct Claude adapter also does not install the original engine's policy hooks.

**Repair:** route model actions through the existing policy boundary, validate typed arguments, avoid shell interpolation, and allowlist ordinary application launch targets. No exploit or destructive command was executed.

### F11. Chat output enters privileged WebView HTML without escaping (P0, CONFIRMED SOURCE)

**Lines:** `ui/settings.html:3220–3250`; `win/Atticus/Web.cs:11,30–35`.

User text, model output, provider labels and event detail are interpolated into insertAdjacentHTML/innerHTML. The same document has the native bridge. Untrusted markup therefore reaches a privileged UI sink. Exploit execution in WebView2 is NOT VERIFIED and was not attempted.

**Repair:** render plain text with textContent, or sanitize a deliberately restricted formatting subset. Keep request data separate from native command authorization.

### F12. New chat omits original memory and history integration (P1, CONFIRMED SOURCE)

**Lines:** `atticus.py:1767–1773` versus `1835–1862`; `multi_ai/router.py:231`; `multi_ai/journal.py:45–61`.

--oma-ask passes the stripped current prompt directly to the router. It does not run original relevant_rules, recent-turn preparation, workflow hints or integration hints, nor the ordinary log_turn/remember_turn path. The journal stores a prompt and final response but does not supply conversational memory to the model. Original Memory settings can therefore exist without affecting new chat.

**Repair:** share structured context assembly and turn persistence across providers while preserving user data and context budgets.

### F13. Context cleanup can remove legitimate user text (P2, REPRODUCED)

**Lines:** `multi_ai/router.py:18–31`.

The cleaner splits on every literal Request: and retains only the final segment. `Explain HTTP Request: headers and body` became `headers and body`. The repository's nested-wrapper sample did clean correctly, so the fix is partly effective but overbroad.

**Repair:** retain original user input as a dedicated field; do not recover it by regex from combined prompts.

### F14. Duplicate protection is process-local, not durable (P1, CONFIRMED SOURCE)

**Lines:** `multi_ai/tools.py:33–47,218–235`; `multi_ai/journal.py:63`; `win/Atticus/Windows.cs:231`.

Each chat request launches a new Python process, resetting the timestamp dictionary. The SQLite record_step method has no caller in the repository. Thus process restarts and cross-provider recovery do not use the advertised durable action journal. Timestamps are recorded before successful execution, which can also suppress a retry of a failed action within one process. Native chat has no shared task lock or busy guard in its ask handler.

**Repair:** request-scoped idempotency keys, durable before/after action states, recovery checks, and concurrency control. Actual duplicate Windows actions remain NOT VERIFIED.

### F15. Windows tool wrappers have concrete API mismatches (P1, REPRODUCED in part)

**Lines:** `multi_ai/tools.py:113–133`; `winctl.py:199`.

The wrapper calls winctl.windows(app), but windows takes no arguments. The isolated signature test returned a TypeError. read_screen looks for front_app and look, neither of which is defined in the supplied winctl module, then returns placeholder wording including “Captured to memory” without an actual capture.

**Repair:** map wrappers to existing engine APIs and return explicit unavailable/error states. Verify screenshot bytes and correct focused-window identity before reporting success.

### F16. Bangla voice toggle is cosmetic in new desktop settings (P1, CONFIRMED SOURCE)

**Lines:** `ui/settings.html:3272–3284`; `win/Atticus/Prefs.cs:42`; `Speech.cs:138`.

The toggle changes a JS variable and label only; it does not update speechModel or recognition configuration. Native speech defaults to base.en, and .en models force English. The microphone button sends openOverlay, which opens the input overlay rather than invoking the separate talk handler. HTTP app.js has a different browser SpeechRecognition path.

**Repair:** connect the language selection to the actual recognition configuration and clearly distinguish opening input from starting recording. Installed model choice, microphone permissions, Bangla accuracy, and speech playback are NOT VERIFIED.

### F17. Provider status can falsely indicate success (P2, REPRODUCED in part)

**Lines:** `multi_ai/providers.py:338–357,425–455`.

A failed secret_set return is ignored; a fixture failure still returned “Provider settings saved securely.” Provider testing considers non-401/403 HTTP failures such as 429 or 500 reachable with ok=true. A successful model listing is not a generation/tool test. No credentials were read or changed during this audit.

**Repair:** report storage failure; separate reachability, authentication, quota and successful inference; never label these as one “Ready” result.

### F18. Visual progress is partly synthetic (P2, CONFIRMED SOURCE)

**Lines:** `ui/settings.html:2266–2294,2772–2778,2969–3001,3128`; `multi_ai/router.py:243–245`.

Agent-town progress increments by timer to a completion label independently of backend completion. Some model/GPU labels are hardcoded. Model listing triggers “GPU acceleration ready” without GPU telemetry. Router verification events are fixed stage announcements. Animated agents are not evidence of independently executing workers.

**Repair:** keep decorative animation but bind operational status and completion to correlated backend events. Label unavailable telemetry honestly. Actual frame rate and resource impact are NOT VERIFIED.

### F19. HTTP dashboard has separate reliability and exposure defects (P1/P0 if used, CONFIRMED SOURCE; intent REPRODUCED)

**Lines:** `server.py:27–33,61–79,91–103,158–195,280–283`; `ui/app.js:313–356`.

The server is a single-threaded TCPServer bound to all interfaces, with permissive CORS and no application authorization on command routes. A long command blocks other HTTP requests. Keyword translation changes “ক্যালকুলেটর খুলবে না” into “open calculator” and “What is Google?” into “open google chrome.” Error paths can still claim research or screen success. The command endpoint always returns ok=true after execute_real_agent_task returns, including its error messages. Network reachability depends on the user's firewall and is NOT VERIFIED.

**Repair:** if this path is retained, restrict it to loopback with validated origin/session access, preserve negation and original intent, use proper result codes, and avoid blocking the server on inference. It must not be used as a substitute for desktop QA.

### F20. Mind-map routing controls use the wrong transport in desktop (P2, CONFIRMED SOURCE)

**Lines:** `ui/settings.html:3009–3018`; `win/Atticus/Web.cs:39–41`; `server.py:158–171`; `multi_ai/router.py:142–143`.

Embedded mind-map buttons use fetch('/api/models/mode'), but the native window is loaded with NavigateToString and has no HTTP API origin. Proper provider settings elsewhere use the native message bridge. On the HTTP path, set_mode changes only in-memory defaults, while saved settings take precedence and can override them on the next request.

**Repair:** use one authoritative settings operation and report persistence errors. Actual button clicks in installed WebView2 remain NOT VERIFIED.

### F21. Recursion protection is partial and can block legitimate background work (P1, CONFIRMED SOURCE; plain-prompt guard REPRODUCED)

**Lines:** `atticus.py:36–44,1099–1116,1594–1600,1767`; `multi_ai/adapters/claude_code.py:44–53`.

The new plain positional-prompt guard really exits with code 1 under inherited depth=1. However, its predicate excludes --oma-ask and --wait. Those flag entry points are not covered by that same top-level guard. Watcher environment cleanup removes older ATTICUS flags but retains OMA depth/marker; a later positional follow-up inherits those and can be blocked as recursion.

The adapter now launches claude directly rather than recursively invoking atticus.py. That is an improvement. Absence of process leaks on Windows is still NOT VERIFIED.

**Repair:** explicit parent task identity and bounded child roles; preserve authorized scheduled follow-up execution while rejecting task recursion.

### F22. Build copying exists, but installed synchronization is unproven (P1, CONFIRMED SOURCE)

**Lines:** `build.ps1:43,54–70`; `win/Atticus/Prefs.cs:26–27`; `win/Atticus/Updater.cs:28–39`; `server.py:27–33`; `install.ps1:4`.

build.ps1 publishes Atticus, copies its Python and multi_ai files, and also copies selected engine files into ~/.atticus when present. install.ps1 uses ~/.Oma as its source checkout. HTTP helpers prefer ~/.atticus; native code prefers the installed script. These can resolve to different copies. The updater now reports a protected custom build instead of fetching/building updates. Stage builds also copy files into ~/.atticus before the installed executable swaps, creating a possible mixed-version interval for that path.

**Repair:** compare installed/source hashes and build metadata first; use one source-of-truth manifest and atomic staged deployment after approval. Do not rebuild over the installation during diagnosis.

### F23. OpenAI-compatible tools stop after one action (P2, CONFIRMED SOURCE)

**Lines:** `multi_ai/adapters/openai_compat.py:86–105`.

Only tool_calls[0] runs. Other requested calls are ignored; the tool result is not sent back to the model for continued planning or a final response. Multi-step completion is therefore incomplete by construction on this path.

**Repair:** bounded tool iterations with permission checks, cancellation, result propagation and verification; preserve all requested steps and report partial completion accurately.

## 3. Working or partly working evidence

These are limited positive findings, not installed-app passes:

- All 27 Python files parsed successfully.
- All 11 executable UI script units checked in the audit passed correct classic/module syntax checks.
- The repository JavaScript test passed: 1 unittest, OK. This is syntax coverage, not DOM, WebView2 or user-interaction coverage.
- The tested positional recursion guard returned the expected nonzero exit and explicit blocked message.
- The existing nested Context/Request sample was cleaned to Open Notepad.
- Router attempts are finite in the tested failure fixture; no infinite loop occurred in that fixture.
- Native WebView2 message names and event/reply prefixes are connected in source. Prefix lengths match the renderer's slice(7).
- Original overlay HTML, winctl.py, integrations and speech implementation are retained; some surrounding behavior changes nevertheless affect them.
- Credential Manager wrappers exist and use Windows APIs. Actual credential storage and connection behavior are NOT VERIFIED.

## 4. Comparison with original Atticus

The snapshots were compared by file content, not by trusting README claims. Original commit is independently pinned; this comparison does not establish the historical fork point.

Changed: atticus.py, build/install scripts, settings.html, project metadata, native window/overlay visibility details, Web bridge logging, Program, Windows, and Updater.

Added: multi_ai package, server.py/start.bat, HTTP dashboard assets, alternate win/Oma project and oma.py, emergency test file and planning documents.

Retained unchanged in this comparison: winctl.py, integrations directory, ui/ui.html, ui/onboarding.html, ui/orbs.js, and several native helpers including Speech.cs and Prefs.cs.

Original README explicitly lists Chrome page reading/clicking and background mini-screen work among unported Mac features. Their absence alone is not proof Gemini broke them. New OMA source still does not provide a general browser DOM/action loop through the new tool registry. Actual browser automation is NOT VERIFIED.

Original reference: https://github.com/FindlayHi/atticus-windows/blob/657cc26d9cac48ce6951958fc4b2b519787a0af6/README.md

## 5. Performance assessment

| Area | Evidence-based assessment |
|---|---|
| GPU/VRAM usage, offload, OOM | NOT VERIFIED. UI hardware labels do not measure execution. Need Ollama process telemetry and GPU samples on the user's PC. |
| RAM leak / CPU saturation | NOT VERIFIED. No Windows memory timeline captured. |
| Ollama load latency | NOT VERIFIED. Adapter is nonstreaming with a 30-second HTTP timeout; cold load or long generation can exceed it. This is a risk, not a measured timeout. |
| Model selection | Source chooses first discovered Ollama model, without measured latency, memory budget or task-specific suitability. |
| Concurrent requests | Native ask starts one worker per send without a task queue/cancel control in that handler. Rapid inputs can overlap inference. Actual contention NOT VERIFIED. |
| Process recursion | Plain prompt guard tested successfully; flag entry points and watcher behavior require broader validation. No claim of 100-request UI stability. |
| HTTP responsiveness | Single-threaded server serializes command handling with status/models/screenshot endpoints. |
| UI rendering | Multiple requestAnimationFrame loops and timers exist; hidden-tab lifecycle and real frame-time cost NOT VERIFIED. |
| UI growth | Chat/event HTML is appended without an observed bound in the new feed handlers. Long-session memory behavior NOT VERIFIED. |
| Error visibility | Missing stderr handling and terminal-result contract increase apparent “hang” risk even when the worker has failed. |

## 6. Independent check results

The raw probe output and reproducible harness are appended. Network and OS actions in adapter tests were replaced with fixtures. Synthetic failure cases demonstrate behavior under stated inputs, not live provider availability.

| Check | Result |
|---|---|
| Python parsing | PASS: 27 files |
| Correct-mode UI JS parsing | PASS: 11 executable script units |
| Repository JS unittest | PASS: 1 test |
| Plain child recursion guard | PASS: exit 1, explicit blocked message |
| Existing nested-prompt example | PASS for that example |
| Legitimate Request: input | DEFECT REPRODUCED: leading user text lost |
| Two Ollama model fallbacks | DEFECT REPRODUCED: second model skipped |
| aiFallback=false in Auto | DEFECT REPRODUCED: fallback still attempted |
| Top-level desktop marker | DEFECT REPRODUCED: Claude excluded |
| claude/haiku selection | DEFECT REPRODUCED: not configured |
| Custom endpoint resolution | DEFECT REPRODUCED: None adapter |
| Credential write failure | DEFECT REPRODUCED: success response |
| Negative Bangla app intent | DEFECT REPRODUCED: converted to open command |
| Empty Ollama result | DEFECT REPRODUCED: success with blank reply |
| Tool failure | DEFECT REPRODUCED: success=true |
| Window list wrapper | DEFECT REPRODUCED: argument mismatch |
| Missing Claude on original run | DEFECT REPRODUCED: no fallback invocation |

The initial generic JS checker was corrected to respect ES module scripts; module-only await/export diagnostics from a CommonJS checker were discarded as test-harness errors. They are not application defects.

The full emergency suite was not executed: it invokes installed Windows paths, real app launch actions and live models. Its 100-request test uses --fast with `time N`, does not assert each response/exit code, and checks broad process counts. It does not prove 100 successful UI or AI requests, even if it passes. GPU collection returns zeros on collection failure. Its fallback test relies on assumed live Claude quota exhaustion instead of forcing and counting one controlled transition. See tests/test_emergency_fix.py:119–150 and 96–116.

## 7. Real installed-app test matrix

| Required real test | Result | Missing evidence |
|---|---|---|
| Open installed Oma AI, inspect UI/navigation/settings | NOT VERIFIED | Windows session and installed assets |
| Text command through new chat | NOT VERIFIED | UI submission, correlated worker log, displayed answer |
| Bangla microphone command | NOT VERIFIED | Real audio, model/language configuration, transcript |
| Open Calculator | NOT VERIFIED | Foreground/window evidence and one action record |
| Browser navigation/control | NOT VERIFIED | Actual browser state before/after |
| Model switching / Local Only | NOT VERIFIED | Selected preference, actual provider request trace |
| Provider connections / quota fallback | NOT VERIFIED | Redacted real auth and inference outcome |
| Memory across turns and restart | NOT VERIFIED | Saved rule/history and demonstrated recall |
| Permissions | NOT VERIFIED | Real Allow/Deny flow and enforced denial |
| Cancel, restart, offline/error recovery | NOT VERIFIED | Process lifecycle and terminal UI result |
| Installed/source identity | NOT VERIFIED | SHA-256 manifest and build metadata |
| GPU/RAM/CPU performance | NOT VERIFIED | Request-correlated time series |
| Long-run process or memory leak | NOT VERIFIED | Repeated real requests with baseline and end state |

No Windows screenshots or real application logs were fabricated. Historical success reports and process dumps were not substituted for current measurements.

## 8. Recommended order after findings are approved

1. **Finish diagnosis on Windows first.** Preserve files/settings, record source and installed hashes, version, resolved Python/script/UI paths, and capture one failing new-chat request and one overlay request. Collect only relevant redacted app.err/stdout/stderr/exit data. Do not export credential values or full environments/command lines containing private prompts.
2. **Restore a dependable reply path.** Add terminal error reporting, stderr draining, bounded worker lifetime, cancellation and request IDs. Prove success and intentional failure both render through the actual WebView.
3. **Unify execution semantics while keeping the interface and engine.** Fix marker scope, model IDs, mode/fallback preferences, custom provider resolution, and overlay/chat divergence. Reuse existing memory and permission machinery.
4. **Close new policy and rendering gaps before expanding tools.** Safe tool arguments, original approval gate, escaped output, loopback-only dashboard if retained.
5. **Complete local model tools, vision and state.** Structured results, bounded tool loop, real verification, durable duplicate prevention and restart recovery.
6. **Connect voice and visuals to actual state.** Correct recognition configuration, real task completion, honest telemetry and visible errors.
7. **Validate with installed-app acceptance tests, then synchronize builds atomically.** Test text, Bangla voice, calculator once, browser, memory, switching, fallback, denial, restart and cancellation; capture hashes again and a bounded performance run.

No repair, installation, rebuild, credential change, unrelated process termination, or UI redesign was performed. Approval of findings is not yet a claim of complete real-world validation. The remaining work requires a Windows-capable session attached to the user's PC.

## 9. Source reference convention

For every relative file/line above, use:

`https://github.com/0matbank/oma-ai-agent/blob/3c08a84a6f87aa5e11a760a8a32a73facc1f44dc/<file>#L<line>`

Key entry points:

- https://github.com/0matbank/oma-ai-agent/blob/3c08a84a6f87aa5e11a760a8a32a73facc1f44dc/win/Atticus/Windows.cs#L228
- https://github.com/0matbank/oma-ai-agent/blob/3c08a84a6f87aa5e11a760a8a32a73facc1f44dc/atticus.py#L1767
- https://github.com/0matbank/oma-ai-agent/blob/3c08a84a6f87aa5e11a760a8a32a73facc1f44dc/multi_ai/router.py#L151
- https://github.com/0matbank/oma-ai-agent/blob/3c08a84a6f87aa5e11a760a8a32a73facc1f44dc/multi_ai/adapters/ollama.py#L48
- https://github.com/0matbank/oma-ai-agent/blob/3c08a84a6f87aa5e11a760a8a32a73facc1f44dc/ui/settings.html#L3220

## Appendix A. Raw isolated probe output

```json
[
  {
    "test": "fallback cap before provider dedup",
    "evidence": {
      "calls": [
        [
          "claude_code",
          "claude-3-5-haiku",
          "test request"
        ],
        [
          "ollama",
          "qwen3-vl:8b",
          "test request"
        ]
      ],
      "result": {
        "success": false,
        "error": "All providers exhausted: claude_code (claude-3-5-haiku): generic; ollama (qwen3-vl:8b): generic",
        "reply": "Unable to complete task. Providers attempted: claude_code (claude-3-5-haiku): generic; ollama (qwen3-vl:8b): generic. Please start Ollama or configure an API key in Settings."
      }
    }
  },
  {
    "test": "auto fallback disabled still tries next provider",
    "evidence": {
      "calls": [
        [
          "claude_code",
          "claude-3-5-haiku",
          "test request"
        ],
        [
          "ollama",
          "qwen3-vl:8b",
          "test request"
        ]
      ],
      "result": {
        "success": false,
        "error": "All providers exhausted: claude_code (claude-3-5-haiku): generic; ollama (qwen3-vl:8b): generic",
        "reply": "Unable to complete task. Providers attempted: claude_code (claude-3-5-haiku): generic; ollama (qwen3-vl:8b): generic. Please start Ollama or configure an API key in Settings."
      }
    }
  },
  {
    "test": "desktop marker excludes Claude",
    "evidence": {
      "calls": [
        [
          "ollama",
          "qwen3-vl:8b",
          "test request"
        ],
        [
          "lm_studio",
          "local",
          "test request"
        ]
      ],
      "result": {
        "success": false,
        "error": "All providers exhausted: ollama (qwen3-vl:8b): generic; lm_studio (local): generic",
        "reply": "Unable to complete task. Providers attempted: ollama (qwen3-vl:8b): generic; lm_studio (local): generic. Please start Ollama or configure an API key in Settings."
      }
    }
  },
  {
    "test": "manual Claude UI id is unresolved",
    "evidence": {
      "calls": [],
      "result": {
        "success": false,
        "error": "All providers exhausted: claude: not configured",
        "reply": "Unable to complete task. Providers attempted: claude: not configured. Please start Ollama or configure an API key in Settings."
      }
    }
  },
  {
    "test": "literal Request token corrupts user text",
    "evidence": {
      "input": "Explain HTTP Request: headers and body",
      "output": "headers and body"
    }
  },
  {
    "test": "repository emergency cleanup assertion",
    "evidence": {
      "input": "Context: ... Earlier: ... A previous try failed: Claude failed. Request: Open Notepad",
      "output": "Open Notepad"
    }
  },
  {
    "test": "custom provider ignored by router",
    "evidence": {
      "adapter_is_none": true
    }
  },
  {
    "test": "failed credential write reported saved",
    "evidence": {
      "ok": true,
      "message": "Provider settings saved securely."
    }
  },
  {
    "test": "HTTP intent discards negation and question",
    "evidence": {
      "ক্যালকুলেটর খুলবে না": "open calculator",
      "What is Google?": "open google chrome",
      "আমার ফাইল মুছবে না": "open explorer"
    }
  },
  {
    "test": "Ollama lacks tools images and accepts empty reply",
    "evidence": {
      "requests": [
        {
          "payload": {
            "model": "qwen3-vl:8b",
            "prompt": "Describe my screen",
            "stream": false
          },
          "timeout": {
            "timeout": 30
          }
        }
      ],
      "result": {
        "success": true,
        "reply": "",
        "model": "qwen3-vl:8b",
        "provider": "ollama"
      }
    }
  },
  {
    "test": "failed tool marked successful",
    "evidence": {
      "success": true,
      "reply": "Error opening calculator: fixture",
      "tool_called": true,
      "model": "qwen3:8b",
      "provider": "ollama"
    }
  },
  {
    "test": "window list signature mismatch",
    "evidence": "Error listing windows: windows_args.<locals>.windows() takes 0 positional arguments but 1 was given"
  },
  {
    "test": "overlay missing Claude skips fallback",
    "evidence": {
      "result": [
        "missing Atticus setup is open to fix it.",
        0,
        []
      ],
      "fallback_called": false
    }
  },
  {
    "test": "JavaScript syntax with correct module mode",
    "evidence": [
      {
        "file": "agent_town.js",
        "script": 0,
        "pass": true,
        "error": ""
      },
      {
        "file": "orbs.js",
        "script": 0,
        "pass": true,
        "error": ""
      },
      {
        "file": "app.js",
        "script": 0,
        "pass": true,
        "error": ""
      },
      {
        "file": "mindmap.js",
        "script": 0,
        "pass": true,
        "error": ""
      },
      {
        "file": "onboarding.html",
        "script": 1,
        "pass": true,
        "error": ""
      },
      {
        "file": "ui.html",
        "script": 1,
        "pass": true,
        "error": ""
      },
      {
        "file": "orb.js",
        "script": 0,
        "pass": true,
        "error": ""
      },
      {
        "file": "settings.html",
        "script": 0,
        "pass": true,
        "error": ""
      },
      {
        "file": "settings.html",
        "script": 1,
        "pass": true,
        "error": ""
      },
      {
        "file": "settings.html",
        "script": 2,
        "pass": true,
        "error": ""
      },
      {
        "file": "settings.html",
        "script": 3,
        "pass": true,
        "error": ""
      }
    ]
  },
  {
    "test": "Python syntax",
    "evidence": {
      "files_checked": 27
    }
  }
]

```

## Appendix B. Real child recursion-guard output

```json
{
  "test": "real child process recursion guard, no model or Windows calls",
  "exit_code": 1,
  "stdout": "Error: Recursive agent execution was blocked.\n",
  "stderr": "[OMA RECURSION GUARD] Blocked recursive prompt execution (depth=1).\n"
}
```

## Appendix C. Reproducible isolated probe harness

This harness expects the pinned source checkout in a sibling `oma-audit` directory. It does not run Windows UI tests.

```python
import os,sys,tempfile,json,importlib,io,ast,pathlib,subprocess,re
from unittest.mock import patch,Mock
ROOT=pathlib.Path(__file__).resolve().parents[1]/'oma-audit'
sys.path.insert(0,str(ROOT))
tmp=tempfile.TemporaryDirectory(); os.environ['ATTICUS_DIR']=tmp.name; os.environ['OMA_DIR']=tmp.name
r=importlib.import_module('multi_ai.router'); p=importlib.import_module('multi_ai.providers'); t=importlib.import_module('multi_ai.tools')
results=[]
def check(name,fn):
 try: results.append({'test':name,'evidence':fn()})
 except Exception as e: results.append({'test':name,'error':str(e)})
def route(settings,env=None):
 path=pathlib.Path(tmp.name)/'settings.json';path.write_text(json.dumps(settings))
 calls=[]
 class A:
  def __init__(self,pid): self.pid=pid
  def is_available(self): return True
  def discover_models(self): return [Mock(model_id='local')]
  def generate(self,mid,prompt): calls.append([self.pid,mid,prompt]);return {'success':False,'error':'fixture failure'}
 obj=r.ModelRouter();obj.adapters={k:A(k) for k in obj.adapters}
 with patch.object(r.provider_mgr,'discover_local_ollama_models',return_value=[{'name':'qwen3-vl:8b'},{'name':'qwen3:8b'}]),patch.object(r,'get_secret',return_value=''),patch.dict(os.environ,env or {'OMA_IN_ATTICUS':'','OMA_ROUTER_FALLBACK':''}):
  res=obj.execute('test request')
 return {'calls':calls,'result':res}
check('fallback cap before provider dedup',lambda:route({'aiMode':'auto'}))
check('auto fallback disabled still tries next provider',lambda:route({'aiMode':'auto','aiFallback':False}))
check('desktop marker excludes Claude',lambda:route({'aiMode':'auto'},{'OMA_IN_ATTICUS':'1'}))
check('manual Claude UI id is unresolved',lambda:route({'aiMode':'manual','activeModel':'claude/haiku','aiFallback':False}))
check('literal Request token corrupts user text',lambda:{'input':'Explain HTTP Request: headers and body','output':r.clean_user_prompt('Explain HTTP Request: headers and body')})
check('repository emergency cleanup assertion',lambda:{'input':'Context: ... Earlier: ... A previous try failed: Claude failed. Request: Open Notepad','output':r.clean_user_prompt('Context: ... Earlier: ... A previous try failed: Claude failed. Request: Open Notepad')})
def custom():
 with patch.object(r,'get_secret',return_value='fixture-not-a-real-key'),patch.object(p,'load_custom_providers',return_value=[{'id':'fixture','base_url':'https://example.invalid/v1'}]):
  return {'adapter_is_none':r.router._get_cloud_adapter('fixture') is None}
check('custom provider ignored by router',custom)
def secret():
 with patch.object(p,'set_secret',return_value=False): return p.provider_mgr.save_provider_config('openai',{'key':'fixture'})
check('failed credential write reported saved',secret)
def wrong_intent():
 s=importlib.import_module('server'); return {q:s.parse_bengali_intent(q) for q in ['ক্যালকুলেটর খুলবে না','What is Google?','আমার ফাইল মুছবে না']}
check('HTTP intent discards negation and question',wrong_intent)
def ollama_payload():
 a=importlib.import_module('multi_ai.adapters.ollama').OllamaAdapter(); seen=[]
 class Response:
  def __enter__(self): return self
  def __exit__(self,*a): pass
  def read(self): return b'{"response":""}'
 def url(req,**kw): seen.append({'payload':json.loads(req.data),'timeout':kw});return Response()
 with patch('urllib.request.urlopen',side_effect=url): result=a.generate('qwen3-vl:8b','Describe my screen')
 return {'requests':seen,'result':result}
check('Ollama lacks tools images and accepts empty reply',ollama_payload)
def tool_error():
 a=importlib.import_module('multi_ai.adapters.ollama').OllamaAdapter()
 with patch('multi_ai.adapters.ollama.execute_tool_call',return_value='Error opening calculator: fixture'): return a.generate('qwen3:8b','open calculator')
check('failed tool marked successful',tool_error)
def windows_args():
 def windows(): return []
 with patch.object(t,'winctl',Mock(windows=windows)): return t.tool_get_windows('Chrome')
check('window list signature mismatch',windows_args)
def no_claude():
 old=sys.argv;sys.argv=['atticus.py'];a=importlib.import_module('atticus');sys.argv=old
 with patch.object(a,'start_claude',return_value=None),patch.object(a,'plan',return_value={'text':'missing'}),patch.object(a,'say'),patch.object(r.router,'execute') as route_mock:
  val=a.run('test');return {'result':val,'fallback_called':route_mock.called}
check('overlay missing Claude skips fallback',no_claude)
def js_checks():
 out=[]
 for file in (ROOT/'ui').glob('*'):
  if file.suffix=='.html': scripts=re.findall(r'<script\b([^>]*)>(.*?)</script>',file.read_text(),re.S)
  elif file.suffix=='.js': scripts=[('type="module"' if file.name=='orbs.js' else '',file.read_text())]
  else: continue
  for i,(attrs,code) in enumerate(scripts):
   if not code.strip() or 'text/plain' in attrs: continue
   args=['node','--check']+(['--input-type=module'] if 'module' in attrs else [])
   q=subprocess.run(args,input=code,text=True,capture_output=True)
   out.append({'file':file.name,'script':i,'pass':q.returncode==0,'error':q.stderr if q.returncode else ''})
 return out
check('JavaScript syntax with correct module mode',js_checks)
check('Python syntax',lambda:{'files_checked':sum(1 for f in ROOT.rglob('*.py') if ast.parse(f.read_text(encoding='utf-8-sig')) is not None)})
print(json.dumps(results,ensure_ascii=False,indent=2))

```
