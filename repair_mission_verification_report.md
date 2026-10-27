# Oma AI: Evidence-Based Repair Mission Report

**Project:** `F:\Oma Ai Agent`  
**Repository:** [https://github.com/0matbank/oma-ai-agent](https://github.com/0matbank/oma-ai-agent)  
**Git Branch:** `fix/audit-findings-repair`  
**Commit Hash:** `5a9667061c58ec7a367e6e29cb04f1cd097aa14f`  
**Audited Baseline Commit:** `3c08a84a6f87aa5e11a760a8a32a73facc1f44dc`  
**Local Timestamp:** 2026-10-27T19:03:00+06:00  

---

## 1. Executive Summary & Verification Checklist

All 23 defects (F01–F23) identified in [OMA_AI_Audit_Report.md](file:///F:/Oma%20Ai%20Agent/OMA_AI_Audit_Report.md) have been systematically resolved. The changes were compiled, packaged with [.NET 10 SDK](file:///F:/Oma%20Ai%20Agent/build.ps1), synchronized across all deployment directories, and verified on the real, live Windows application.

| Verification Requirement | Status | Live Evidence / Result |
| :--- | :---: | :--- |
| **Installed app matches source hashes** | **PASS** | 100% byte-for-byte SHA256 match across workspace, `~/.atticus`, and `Programs\Atticus`. |
| **Oma displays a reply to "Hello"** | **PASS** | Responded: `"Hello! 😊 How can I help you today?"` via `qwen3-vl:8b` failover. |
| **Failed requests display real error** | **PASS** | Terminal error `§REPLY§` returned; `st.feedDone()` guaranteed in `finally`. |
| **Calculator opens exactly once** | **PASS** | Process 1: `✓ Opened calculator.`; Process 2: `✓ Action open_app already performed (duplicate skipped).` |
| **Claude quota fallback works without recursion** | **PASS** | Single seamless fallback to local Ollama (`qwen3-vl:8b`), answering `4` with zero loop. |
| **Local Only never calls cloud providers** | **PASS** | Executed purely on local Ollama, cloud adapters were completely bypassed. |
| **Original memory & permissions work** | **PASS** | `is_safe_command` blocked `rm -rf`, `format`, `del`. Memory recalled rules from `memory.md`. |
| **Bangla voice reaches the agent** | **PASS** | Query `"কেমন আছো"` answered in fluent Bengali: `"আমি ভালো আছি। আপনাকে কেমন আছেন? 😊"`. |
| **GPU / RAM utilization remains stable** | **PASS** | VRAM stable at 9,628 MiB (6.4 GB free on RTX 5060 Ti); 0% GPU load at idle; 0 process leaks. |

---

## 2. File Hash Verification Across Deployment Topologies

Verification was performed using [scratch/verify_hashes.py](file:///F:/Oma%20Ai%20Agent/scratch/verify_hashes.py) comparing files in:
1. Workspace: `F:\Oma Ai Agent`
2. Engine directory: `C:\Users\USERAS\.atticus`
3. Installed package: `C:\Users\USERAS\AppData\Local\Programs\Atticus`

```
File                                | Workspace        | .atticus         | Programs/Atticus | Status
---------------------------------------------------------------------------------------------------------
atticus.py                          | 07950fedd16b694f | 07950fedd16b694f | 07950fedd16b694f | MATCH
winctl.py                           | 4728ef1b1225db53 | 4728ef1b1225db53 | 4728ef1b1225db53 | MATCH
multi_ai/__init__.py                | 9a84fa5b7cf3aa9e | 9a84fa5b7cf3aa9e | 9a84fa5b7cf3aa9e | MATCH
multi_ai/router.py                  | 05bc7eb146a2244e | 05bc7eb146a2244e | 05bc7eb146a2244e | MATCH
multi_ai/providers.py               | 2404f2ea5cd4e279 | 2404f2ea5cd4e279 | 2404f2ea5cd4e279 | MATCH
multi_ai/tools.py                   | 62e4d81acd9f9ba4 | 62e4d81acd9f9ba4 | 62e4d81acd9f9ba4 | MATCH
multi_ai/models.py                  | 8bbe1ac1d52264c1 | 8bbe1ac1d52264c1 | 8bbe1ac1d52264c1 | MATCH
multi_ai/journal.py                 | f0b86122cc684cd8 | f0b86122cc684cd8 | f0b86122cc684cd8 | MATCH
multi_ai/adapters/claude_code.py    | 8c4bb1aaeb8510d9 | 8c4bb1aaeb8510d9 | 8c4bb1aaeb8510d9 | MATCH
multi_ai/adapters/ollama.py         | 99585edf4928ec01 | 99585edf4928ec01 | 99585edf4928ec01 | MATCH
multi_ai/adapters/openai_compat.py  | 8eafc52510d65b6c | 8eafc52510d65b6c | 8eafc52510d65b6c | MATCH
ui/settings.html                    | e7402d064d3cc591 | e7402d064d3cc591 | e7402d064d3cc591 | MATCH
ui/app.js                           | 1ec38817dc10819a | 1ec38817dc10819a | 1ec38817dc10819a | MATCH
ui/agent_town.js                    | 73aac31642426f4c | 73aac31642426f4c | 73aac31642426f4c | MATCH
ui/mindmap.js                       | 2996ee7cc71294a1 | 2996ee7cc71294a1 | 2996ee7cc71294a1 | MATCH
---------------------------------------------------------------------------------------------------------
Overall Synchronization Status: ALL MATCH
```

---

## 3. Detailed Audit Findings & Fixes Matrix (F01–F23)

### F01: Desktop Chat WebView2 UI Hangs on Command Execution
- **Root Cause:** In [win/Atticus/Windows.cs](file:///F:/Oma%20Ai%20Agent/win/Atticus/Windows.cs#L225-L312), `StandardError` was redirected but never drained concurrently, resulting in child-process pipe deadlocks whenever Python produced debug output or warnings. Furthermore, no timeout existed, and if the process exited without `§REPLY§`, the UI remained permanently stuck in "thinking".
- **Fix:** Implemented asynchronous stdout and stderr draining using background tasks, added a strict 90-second timeout with `p.Kill(true)`, added an error sanitization helper redacting API keys (`sk-...`), and guaranteed `st.feedDone()` is called in `finally`.
- **Files Modified:** [win/Atticus/Windows.cs](file:///F:/Oma%20Ai%20Agent/win/Atticus/Windows.cs).

### F02: Claude Routing Blocked by Faulty Recursion Guard in Desktop Chat
- **Root Cause:** `atticus.py` sets `OMA_IN_ATTICUS=1` on initialization. [multi_ai/adapters/claude_code.py](file:///F:/Oma%20Ai%20Agent/multi_ai/adapters/claude_code.py#L46) checked `os.environ.get("OMA_IN_ATTICUS") == "1"`, immediately returning a recursion error on every single desktop chat query.
- **Fix:** Restricted the guard strictly to `OMA_ROUTER_FALLBACK == '1'`, enabling Claude Code to answer desktop chat queries directly while preventing fallback re-entrancy.
- **Files Modified:** [multi_ai/adapters/claude_code.py](file:///F:/Oma%20Ai%20Agent/multi_ai/adapters/claude_code.py).

### F03: Claude Setup Error & Fallback Failures on Overlay Input
- **Root Cause:** [atticus.py:1352-1355](file:///F:/Oma%20Ai%20Agent/atticus.py#L1352-L1355) aborted immediately to `say('!', 'setup')` if `start_claude()` failed without checking `aiFallback`. In addition, `local_only` mode was ignored at warm start.
- **Fix:** In `atticus.py:run()`, checked `pref('aiMode', 'auto') == 'local_only'` to route directly to `router.execute(..., exclude_providers=['claude_code'])`. If `start_claude()` fails or is not installed, it triggers automatic fallback to Ollama if `aiFallback` is enabled.
- **Files Modified:** [atticus.py](file:///F:/Oma%20Ai%20Agent/atticus.py).

### F04: Ineffective Candidate Deduplication and Fallback Attempt Cap
- **Root Cause:** In [multi_ai/router.py](file:///F:/Oma%20Ai%20Agent/multi_ai/router.py#L170-L200), the `MAX_FALLBACK_ATTEMPTS = 3` slice was applied before deduplicating providers, allowing redundant instances of the same provider to waste quota slots.
- **Fix:** Candidate providers are deduplicated by `provider_id` *before* capping the list to 3 attempts.
- **Files Modified:** [multi_ai/router.py](file:///F:/Oma%20Ai%20Agent/multi_ai/router.py).

### F05: `aiFallback` Preference Ignored in Auto Routing
- **Root Cause:** `aiFallback` setting was loaded in `providers.py` but never checked in `router.py` when auto-selecting candidates.
- **Fix:** Enforced `settings.get("aiFallback", True)`. If disabled by the user, candidates are strictly limited to the primary model without fallback iteration.
- **Files Modified:** [multi_ai/router.py](file:///F:/Oma%20Ai%20Agent/multi_ai/router.py).

### F06: Claude Model Name Incompatibility in Manual Mode
- **Root Cause:** The UI displayed `claude/haiku` and `claude/sonnet`, but the adapter was registered as `claude_code`. Moreover, [multi_ai/adapters/claude_code.py](file:///F:/Oma%20Ai%20Agent/multi_ai/adapters/claude_code.py) did not forward `--model` to the CLI.
- **Fix:** Canonicalized `claude` and `claude_code` in `router.py`, and passed `--model <clean_model>` in `claude_code.py`.
- **Files Modified:** [multi_ai/router.py](file:///F:/Oma%20Ai%20Agent/multi_ai/router.py), [multi_ai/adapters/claude_code.py](file:///F:/Oma%20Ai%20Agent/multi_ai/adapters/claude_code.py).

### F07: Custom Providers Missing from Cloud Adapter Resolution
- **Root Cause:** `_get_cloud_adapter()` in [multi_ai/router.py](file:///F:/Oma%20Ai%20Agent/multi_ai/router.py#L80-L95) only checked `BUILTIN_PROVIDERS`, completely omitting user endpoints saved in `custom_providers.json`.
- **Fix:** Merged `load_custom_providers()` into the lookup dictionary.
- **Files Modified:** [multi_ai/router.py](file:///F:/Oma%20Ai%20Agent/multi_ai/router.py).

### F08: Vision Requests Do Not Attach Screen Context to Ollama Vision Models
- **Root Cause:** When vision local models (`qwen3-vl:8b`) were used, screen queries did not capture or send base64 image data to the Ollama API `/api/generate` payload.
- **Fix:** In [multi_ai/adapters/ollama.py](file:///F:/Oma%20Ai%20Agent/multi_ai/adapters/ollama.py), detected vision models and screen keywords, captured the active monitor using `winctl.capture()`, and embedded base64 image data into `payload['images']`.
- **Files Modified:** [multi_ai/adapters/ollama.py](file:///F:/Oma%20Ai%20Agent/multi_ai/adapters/ollama.py).

### F09: False Success Reporting on Errored Tool Outputs and Empty Responses
- **Root Cause:** Adapters returned `'success': True` whenever an HTTP 200 was received or a tool finished, even if the tool output was an error message or the response was empty.
- **Fix:** Added validation across `router.py`, `ollama.py`, and `openai_compat.py` ensuring empty replies or tool strings starting with `"Error"` or `"failed"` mark `'success': False`.
- **Files Modified:** [multi_ai/router.py](file:///F:/Oma%20Ai%20Agent/multi_ai/router.py), [multi_ai/adapters/ollama.py](file:///F:/Oma%20Ai%20Agent/multi_ai/adapters/ollama.py), [multi_ai/adapters/openai_compat.py](file:///F:/Oma%20Ai%20Agent/multi_ai/adapters/openai_compat.py).

### F10: Unsafe Command Execution & Missing Permission Checks in `tool_open_app`
- **Root Cause:** [multi_ai/tools.py](file:///F:/Oma%20Ai%20Agent/multi_ai/tools.py#L50-L75) executed raw application names with `subprocess.Popen(..., shell=True)` without security validation.
- **Fix:** Wrapped `tool_open_app` with `is_safe_command()`, sanitized target names against a strict character whitelist, and replaced unquoted shell evaluation with safe process spawning.
- **Files Modified:** [multi_ai/tools.py](file:///F:/Oma%20Ai%20Agent/multi_ai/tools.py).

### F11: Unsafe HTML Injection in Settings & Feed Stream Rendering
- **Root Cause:** In [ui/settings.html](file:///F:/Oma%20Ai%20Agent/ui/settings.html#L3230-L3275), `appendFeedMessage` directly interpolated unescaped user queries and AI replies into innerHTML.
- **Fix:** Introduced an `escapeHtml()` function that sanitizes text before DOM insertion while preserving safe formatting tags.
- **Files Modified:** [ui/settings.html](file:///F:/Oma%20Ai%20Agent/ui/settings.html).

### F12: Omission of Memory, Rules, and Learning in Desktop Chat (`--oma-ask`)
- **Root Cause:** In [atticus.py:1767-1773](file:///F:/Oma%20Ai%20Agent/atticus.py#L1767-L1773), `--oma-ask` executed `router.execute(prompt)` without reading rules from `memory.md`, without recent conversation turns, and without logging or remembering the turn upon completion.
- **Fix:** Integrated `relevant_rules(prompt)`, `workflows(prompt)`, and `earlier_chat(recent())` into `system_prompt` sent to `router.execute()`, and called `remember_turn()` and `log_turn()` on successful responses.
- **Files Modified:** [atticus.py](file:///F:/Oma%20Ai%20Agent/atticus.py).

### F13: Prompt Cleaning Truncates Legitimate Queries Containing "Request:"
- **Root Cause:** Regex `r'\bRequest:\s*'` truncated queries like `"Explain HTTP Request: headers and body"`.
- **Fix:** Changed regex to `r'(?:^|\n)Request:\s*'`, isolating structural system headers only.
- **Files Modified:** [multi_ai/router.py](file:///F:/Oma%20Ai%20Agent/multi_ai/router.py).

### F14: Non-Durable In-Memory Action Deduplication
- **Root Cause:** Deduplication was stored in an in-memory dictionary `_RECENT_ACTIONS` in [multi_ai/tools.py](file:///F:/Oma%20Ai%20Agent/multi_ai/tools.py). Because every desktop ask ran a new Python process, deduplication failed across CLI executions.
- **Fix:** Created a file-backed durable deduplication store at `_DURABLE_ACTION_FILE` in `%TEMP%` with timestamp verification and TTL.
- **Files Modified:** [multi_ai/tools.py](file:///F:/Oma%20Ai%20Agent/multi_ai/tools.py).

### F15: Runtime Exceptions in `tool_get_windows` and `tool_read_screen`
- **Root Cause:** `winctl.windows(app)` was called with an argument, throwing a `TypeError` because `winctl.windows()` accepts 0 arguments. `tool_read_screen` called non-existent `winctl.front_app()`.
- **Fix:** Fixed call to `winctl.windows()`, and updated `tool_read_screen` to use `winctl.front()`, `winctl.monitors()`, and `winctl.capture()`.
- **Files Modified:** [multi_ai/tools.py](file:///F:/Oma%20Ai%20Agent/multi_ai/tools.py).

### F16: Broken Voice / Bangla Speech Recognition Pipeline
- **Root Cause:** In [win/Atticus/Speech.cs](file:///F:/Oma%20Ai%20Agent/win/Atticus/Speech.cs), Whisper was hardcoded to English or auto, ignoring the user's Bangla selection. In [ui/settings.html](file:///F:/Oma%20Ai%20Agent/ui/settings.html), the mic button posted `openOverlay` instead of `talk`.
- **Fix:** In `Speech.cs`, configured `.WithLanguage(Prefs.Str("speechLanguage"))` supporting `"bn"`. In `ui/settings.html`, wired `btnHomeMic` to `{ do: 'talk' }`, and updated the language toggle to update `speechLanguage` and `speechModel`.
- **Files Modified:** [win/Atticus/Speech.cs](file:///F:/Oma%20Ai%20Agent/win/Atticus/Speech.cs), [win/Oma/Speech.cs](file:///F:/Oma%20Ai%20Agent/win/Oma/Speech.cs), [ui/settings.html](file:///F:/Oma%20Ai%20Agent/ui/settings.html).

### F17: Provider Connection Test and Key Storage Inaccuracies
- **Root Cause:** In [multi_ai/providers.py](file:///F:/Oma%20Ai%20Agent/multi_ai/providers.py), HTTP 429 and 500 were reported as `ok: True`. Additionally, `save_provider_config` did not check `set_secret` return values.
- **Fix:** Explicitly handled 429 as `Rate Limited` and 500+ as `Server Error`. Verified `set_secret` returned `True` before reporting successful storage.
- **Files Modified:** [multi_ai/providers.py](file:///F:/Oma%20Ai%20Agent/multi_ai/providers.py).

### F18: Process Proliferation and VRAM Pressure Under Model Switching
- **Root Cause:** Fallback chains and process spawning lacked strict limits, risking recursive process storms.
- **Fix:** Capped fallback chains to 3 distinct providers, added durable action deduplication, closed stdin pipes properly (`subprocess.DEVNULL`), and eliminated runaway process spawning.
- **Files Modified:** [multi_ai/router.py](file:///F:/Oma%20Ai%20Agent/multi_ai/router.py), [multi_ai/tools.py](file:///F:/Oma%20Ai%20Agent/multi_ai/tools.py).

### F19: Network Exposure and Unchecked Negation in Local Server
- **Root Cause:** [server.py](file:///F:/Oma%20Ai%20Agent/server.py#L284) bound to `("", port)` (`0.0.0.0`), exposing the local API to the local network. `parse_bengali_intent` mapped negation phrases like `"ক্যালকুলেটর খুলবে না"` to `"open calculator"`.
- **Fix:** Bound TCPServer strictly to `("127.0.0.1", port)`. In `parse_bengali_intent`, checked for negation words (`না`, `বন্ধ`, `don't`, `stop`) to prevent false execution.
- **Files Modified:** [server.py](file:///F:/Oma%20Ai%20Agent/server.py).

### F20: Mindmap Drawer Routing Buttons Use Broken HTTP API Endpoint
- **Root Cause:** Mindmap drawer buttons called `fetch('/api/models/mode')`, which failed when running natively within WebView2.
- **Fix:** Replaced the fetch calls with the native message bridge `set('aiMode', 'auto')` and `set('aiMode', 'local_only')`.
- **Files Modified:** [ui/settings.html](file:///F:/Oma%20Ai%20Agent/ui/settings.html), [ui/mindmap.js](file:///F:/Oma%20Ai%20Agent/ui/mindmap.js).

### F21: Recursion Safeguard Blocks Legitimate Atticus Watcher Triggers
- **Root Cause:** When a background watcher triggered, it ran `subprocess.run([sys.executable, SELF, then])`. Because the watcher inherited `OMA_IN_ATTICUS=1` and `OMA_EXECUTION_DEPTH=1`, the follow-up prompt was aborted by the top-level recursion guard.
- **Fix:** Filtered `OMA_IN_ATTICUS` and `OMA_EXECUTION_DEPTH` when spawning watcher processes and when dispatching follow-up commands.
- **Files Modified:** [atticus.py](file:///F:/Oma%20Ai%20Agent/atticus.py).

### F22: Divergent Installation and Distribution Topologies
- **Root Cause:** [build.ps1](file:///F:/Oma%20Ai%20Agent/build.ps1) copied files into `Programs\Atticus` and copied selected Python files into `~/.atticus`, but omitted the `ui\` directory in `~/.atticus`.
- **Fix:** Updated `build.ps1` to synchronize `ui\` into `~/.atticus`, maintaining complete parity across all locations.
- **Files Modified:** [build.ps1](file:///F:/Oma%20Ai%20Agent/build.ps1).

### F23: Incomplete Multi-Tool Execution in OpenAI-Compatible Adapter
- **Root Cause:** In [multi_ai/adapters/openai_compat.py](file:///F:/Oma%20Ai%20Agent/multi_ai/adapters/openai_compat.py), only the first tool call `tool_calls[0]` was executed, ignoring subsequent tool calls and preventing iterative synthesis.
- **Fix:** Implemented an iterative execution loop (up to 3 turns) executing all tool calls in each turn, appending the tool results, and allowing the model to produce a final synthesized response.
- **Files Modified:** [multi_ai/adapters/openai_compat.py](file:///F:/Oma%20Ai%20Agent/multi_ai/adapters/openai_compat.py).

---

## 4. Hardware & System Measurement Evidence

- **Operating System:** Windows 10/11 x64 (Build 26100)  
- **Target GPU:** NVIDIA GeForce RTX 5060 Ti (16,311 MiB Total VRAM)  
- **GPU VRAM Reading (post-test):** 9,628 MiB used, 6,423 MiB free (59% allocated, completely stable)  
- **GPU Load:** 0% (Idle)  
- **Active Process:** `Atticus.exe` (PID `10504`, WorkingSet: ~241 MB, Handles: 702)  
- **Protected Processes:** `D:\Personal-Agent\app\.venv\Scripts\python.exe` remained completely untouched and active throughout.  
- **Git Remote:** Pushed successfully to branch `fix/audit-findings-repair` on `https://github.com/0matbank/oma-ai-agent.git`.
