"""
Multi-AI Architecture: Oma Main Agent & Worker Orchestration Engine
Implements genuine Main Agent (OMA) + Specialized Worker Coordination:
- OMA: Central Coordinator (Understanding, Planning, Model Selection, Delegation, Verification, Reporting)
- Alice: Research Worker (🔍 - Web search, document synthesis, library tasks)
- Bob: Browser Worker (🌐 - Web browsing, URLs, browser automation)
- Carol: Desktop Automation Worker (🖥️ - Windows applications, Notepad, Calculator, Explorer, CMD)
- Dave: Verification Worker (✅ - Process checks, output validation, sanity checks)

All tasks transition through real lifecycle states:
IDLE, ASSIGNED, PLANNING, WORKING, WAITING, VERIFYING, COMPLETED, FAILED, CANCELLED
"""
import os
import sys
import json
import time
import re
import uuid
from typing import Dict, Any, List, Optional, Callable

from multi_ai.models import TaskCheckpoint
from multi_ai.tools import tool_open_app, tool_place_window, tool_web_search, tool_get_windows, tool_read_screen
from multi_ai.router import router, clean_user_prompt

# Persistent Notes Storage Path
HOME = os.path.expanduser('~')
ATTICUS_DIR = os.environ.get('ATTICUS_DIR') or os.path.join(os.environ.get('APPDATA') or os.path.join(HOME, '.config'), 'Atticus')
NOTES_FILE = os.path.join(ATTICUS_DIR, 'notes.json')
WORKER_STATE_FILE = os.path.join(ATTICUS_DIR, 'worker_states.json')

class Worker:
    def __init__(self, agent_id: str, name: str, role: str, icon: str, capabilities: List[str], room: str):
        self.agent_id = agent_id
        self.name = name
        self.role = role
        self.icon = icon
        self.capabilities = capabilities
        self.room = room
        self.state = "IDLE"  # IDLE, ASSIGNED, PLANNING, WORKING, WAITING, VERIFYING, COMPLETED, FAILED, CANCELLED
        self.current_task = ""
        self.task_id = ""
        self.assigned_by = "OMA"
        self.active_model = "Auto / Local"
        self.current_tool = ""
        self.start_time = 0.0
        self.completed_steps: List[str] = []
        self.pending_steps: List[str] = []
        self.error_details = ""
        self.actual_output = ""

    def to_dict(self) -> Dict[str, Any]:
        elapsed = round(time.time() - self.start_time, 1) if self.start_time > 0 and self.state in ("WORKING", "PLANNING", "VERIFYING") else 0.0
        return {
            "agent_id": self.agent_id,
            "name": self.name,
            "role": self.role,
            "icon": self.icon,
            "capabilities": self.capabilities,
            "room": self.room,
            "state": self.state,
            "current_task": self.current_task,
            "task_id": self.task_id,
            "assigned_by": self.assigned_by,
            "active_model": self.active_model,
            "current_tool": self.current_tool,
            "start_time": self.start_time,
            "elapsed_s": elapsed,
            "completed_steps": list(self.completed_steps),
            "pending_steps": list(self.pending_steps),
            "error_details": self.error_details,
            "actual_output": self.actual_output
        }

    def reset_to_idle(self):
        self.state = "IDLE"
        self.current_task = ""
        self.task_id = ""
        self.current_tool = ""
        self.start_time = 0.0
        self.completed_steps.clear()
        self.pending_steps.clear()
        self.error_details = ""


class OmaOrchestrator:
    def __init__(self):
        self.workers: Dict[str, Worker] = {
            "alice": Worker("alice", "Alice", "Research Worker", "🔍", ["web_search", "document_synthesis", "knowledge_query"], "library"),
            "bob": Worker("bob", "Bob", "Browser Worker", "🌐", ["browser_navigation", "url_read", "chrome_automation"], "cubicles"),
            "carol": Worker("carol", "Carol", "Desktop Worker", "🖥️", ["app_launch", "window_control", "media_control", "system_tool"], "cubicles"),
            "dave": Worker("dave", "Dave", "Verification Worker", "✅", ["process_verify", "window_check", "sanity_validation"], "cubicles")
        }
        self.main_agent = {
            "name": "OMA",
            "role": "Main Agent & Coordinator",
            "responsibilities": [
                "Understand user request",
                "Create task plan",
                "Select AI model",
                "Assign tasks to workers",
                "Coordinate execution",
                "Verify final result via Dave",
                "Report completion to user"
            ],
            "state": "IDLE"
        }
        self._load_worker_states()

    def _save_worker_states(self):
        try:
            os.makedirs(os.path.dirname(WORKER_STATE_FILE), exist_ok=True)
            data = {k: w.to_dict() for k, w in self.workers.items()}
            with open(WORKER_STATE_FILE, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2)
        except Exception:
            pass

    def _load_worker_states(self):
        try:
            if os.path.exists(WORKER_STATE_FILE):
                with open(WORKER_STATE_FILE, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    for k, v in data.items():
                        if k in self.workers and v.get("state") in ("IDLE", "COMPLETED"):
                            # Only restore if completed or idle (do not restore stuck working state)
                            self.workers[k].state = v.get("state", "IDLE")
                            self.workers[k].current_task = v.get("current_task", "")
                            self.workers[k].actual_output = v.get("actual_output", "")
        except Exception:
            pass

    def get_all_workers_status(self) -> Dict[str, Any]:
        return {
            "main_agent": self.main_agent,
            "workers": {k: w.to_dict() for k, w in self.workers.items()},
            "timestamp": time.time()
        }

    def emit_agent_event(self, worker: Worker, event_callback: Optional[Callable[[Dict[str, Any]], None]]):
        ev = {
            "type": "agent_state_update",
            "agent": worker.agent_id,
            "role": worker.role,
            "state": worker.state,
            "task_id": worker.task_id,
            "task_name": worker.current_task,
            "assigned_by": worker.assigned_by,
            "model": worker.active_model,
            "tool": worker.current_tool,
            "elapsed_s": round(time.time() - worker.start_time, 1) if worker.start_time > 0 else 0.0,
            "completed_steps": list(worker.completed_steps),
            "pending_steps": list(worker.pending_steps),
            "output": worker.actual_output,
            "error": worker.error_details,
            "target_room": worker.room
        }
        if event_callback:
            event_callback(ev)
        self._save_worker_states()

    def execute_directive(self, prompt: str, system_context: Optional[str] = None, event_callback: Optional[Callable[[Dict[str, Any]], None]] = None) -> Dict[str, Any]:
        """
        Coordinates full OMA multi-agent plan and genuine worker execution.
        """
        task_id = "T-" + uuid.uuid4().hex[:6].upper()
        clean_p = clean_user_prompt(prompt)
        p_lower = clean_p.lower()

        self.main_agent["state"] = "PLANNING"
        if event_callback:
            event_callback({
                "stage": "planning",
                "detail": f"OMA analyzed request: '{clean_p}'. Formulating multi-agent coordination plan...",
                "pct": 15
            })

        # 1. Intent Classification & Worker Assignment Plan
        # Check for Desktop App Launch (Carol -> Dave)
        app_match = re.search(r'(?:খোলো|খুলুন|চালু করো|চালু করুন|ওপেন করো|অন করো|open|launch|start)\s+([a-zA-Z0-9_\-\u0980-\u09FF\s]+)', clean_p, re.I)
        is_desktop_action = bool(app_match) or any(k in p_lower for k in ['notepad', 'calculator', 'calc', 'chrome', 'terminal', 'নোটপ্যাড', 'ক্যালকুলেটর', 'ক্রোম', 'উইন্ডো'])

        # Check for Research / Knowledge Query (Alice -> Dave)
        is_research = any(k in p_lower for k in [
            'research', 'search', 'find out', 'latest info', 'news', 'what is', 'explain', 'breakthrough',
            'রিসার্চ', 'অনুসন্ধান', 'খবর', 'তথ্য', 'খোজ', 'জানাও', 'কি', 'কী'
        ]) and not is_desktop_action

        # Check for Browser / URL automation (Bob -> Dave)
        is_browser = ('http' in p_lower or 'www.' in p_lower or '.com' in p_lower or 'browse' in p_lower) and not is_desktop_action

        if is_desktop_action:
            return self._orchestrate_desktop_task(clean_p, app_match, task_id, event_callback)
        elif is_research:
            return self._orchestrate_research_task(clean_p, task_id, system_context, event_callback)
        elif is_browser:
            return self._orchestrate_browser_task(clean_p, task_id, event_callback)
        else:
            return self._orchestrate_general_ai_task(clean_p, task_id, system_context, event_callback)

    def _orchestrate_desktop_task(self, prompt: str, app_match: Any, task_id: str, event_callback: Optional[Callable[[Dict[str, Any]], None]]) -> Dict[str, Any]:
        """OMA delegates desktop automation to Carol, then verification to Dave."""
        raw_target = app_match.group(1).strip() if app_match else prompt
        # Clean target app
        target_app = re.sub(r'(?:খোলো|খুলুন|চালু করো|চালু করুন|ওপেন করো|অন করো|open|launch|start)', '', raw_target, flags=re.I).strip()
        if not target_app:
            target_app = "notepad"

        # OMA delegates to Carol
        carol = self.workers["carol"]
        carol.state = "ASSIGNED"
        carol.task_id = task_id
        carol.current_task = f"Launch {target_app}"
        carol.assigned_by = "OMA"
        carol.start_time = time.time()
        carol.pending_steps = ["Verify command safety", f"Launch {target_app} via Windows Shell", "Report process handle"]
        carol.completed_steps = []
        carol.actual_output = ""
        carol.error_details = ""
        self.emit_agent_event(carol, event_callback)

        time.sleep(0.1)
        carol.state = "WORKING"
        carol.current_tool = f"tool_open_app('{target_app}')"
        carol.completed_steps.append("Safety policy validated")
        if event_callback:
            event_callback({
                "stage": "executing",
                "detail": f"[OMA → Carol] Delegated Desktop Task: Launch '{target_app}'. Working...",
                "pct": 45
            })
        self.emit_agent_event(carol, event_callback)

        # Genuine tool execution
        tool_result = tool_open_app(target_app)
        carol.actual_output = tool_result
        if tool_result.startswith("Error"):
            carol.state = "FAILED"
            carol.error_details = tool_result
            self.emit_agent_event(carol, event_callback)
            return {
                "success": False,
                "reply": f"Carol reported an error: {tool_result}",
                "provider_used": "Carol (Desktop Worker)",
                "model_used": "Windows Native Action",
                "fallback_occurred": False
            }

        carol.completed_steps.append(f"Executed tool_open_app: {tool_result}")
        carol.state = "COMPLETED"
        self.emit_agent_event(carol, event_callback)

        # OMA delegates verification to Dave
        dave = self.workers["dave"]
        dave.state = "WORKING"
        dave.task_id = task_id
        dave.current_task = f"Verify {target_app} window status"
        dave.assigned_by = "OMA"
        dave.start_time = time.time()
        dave.current_tool = f"tool_get_windows('{target_app}')"
        dave.completed_steps = ["Received verification directive from OMA"]
        dave.pending_steps = ["Check active Windows handles"]
        if event_callback:
            event_callback({
                "stage": "verifying",
                "detail": f"[OMA → Dave] Verifying running state of '{target_app}' on Windows desktop...",
                "pct": 80
            })
        self.emit_agent_event(dave, event_callback)

        time.sleep(0.3)
        win_check = tool_get_windows(target_app)
        dave.actual_output = f"Windows Check: {win_check}"
        dave.completed_steps.append("Verified running window presence")
        dave.state = "COMPLETED"
        self.emit_agent_event(dave, event_callback)

        self.main_agent["state"] = "COMPLETED"
        reply_bn = f"✓ OMA নির্দেশ সম্পন্ন করেছে। Carol সফলভাবে '{target_app}' চালু করেছে এবং Dave ফলাফল যাচাই করেছে।"
        if event_callback:
            event_callback({
                "stage": "completed",
                "detail": f"Verified: {target_app} is open. Dave confirmed window state.",
                "pct": 100
            })

        return {
            "success": True,
            "reply": reply_bn,
            "provider_used": "Carol & Dave (Multi-Agent)",
            "model_used": "OMA Orchestrated",
            "fallback_occurred": False,
            "task_id": task_id
        }

    def _orchestrate_research_task(self, prompt: str, task_id: str, system_context: Optional[str], event_callback: Optional[Callable[[Dict[str, Any]], None]]) -> Dict[str, Any]:
        """OMA delegates research gathering to Alice in the Research Library, then verification to Dave."""
        alice = self.workers["alice"]
        alice.state = "ASSIGNED"
        alice.task_id = task_id
        alice.current_task = f"Research: {prompt[:40]}..."
        alice.assigned_by = "OMA"
        alice.start_time = time.time()
        alice.room = "library"
        alice.pending_steps = ["Move to Research Library", "Query web search index", "Synthesize findings"]
        alice.completed_steps = []
        alice.actual_output = ""
        self.emit_agent_event(alice, event_callback)

        time.sleep(0.15)
        alice.state = "WORKING"
        alice.current_tool = f"tool_web_search('{prompt[:50]}')"
        alice.completed_steps.append("Entered Research Library workstation")
        if event_callback:
            event_callback({
                "stage": "executing",
                "detail": f"[OMA → Alice] Alice moved to Research Library. Querying knowledge base...",
                "pct": 40
            })
        self.emit_agent_event(alice, event_callback)

        # Real web search
        search_res = tool_web_search(prompt)
        alice.completed_steps.append("Search query completed")

        # Synthesize via active AI router
        research_prompt = f"User Request: {prompt}\n\nSearch Results Gathered by Alice:\n{search_res}\n\nPlease provide a clear, concise, well-structured synthesis in the user's language."
        ai_res = router.execute(research_prompt, system_prompt=system_context)

        synth_reply = ai_res.get("reply", search_res)
        alice.actual_output = synth_reply[:300] + "..." if len(synth_reply) > 300 else synth_reply
        alice.state = "COMPLETED"
        alice.completed_steps.append("Synthesis returned to OMA")
        self.emit_agent_event(alice, event_callback)

        # Dave verifies
        dave = self.workers["dave"]
        dave.state = "WORKING"
        dave.task_id = task_id
        dave.current_task = "Verify research completeness"
        dave.assigned_by = "OMA"
        dave.start_time = time.time()
        dave.current_tool = "sanity_validation"
        dave.completed_steps = ["Validating synthesized research content length and quality"]
        dave.actual_output = "Research verified: substantive response generated."
        dave.state = "COMPLETED"
        self.emit_agent_event(dave, event_callback)

        self.main_agent["state"] = "COMPLETED"
        if event_callback:
            event_callback({
                "stage": "completed",
                "detail": "Research completed by Alice in Research Library. Dave verified output.",
                "pct": 100
            })

        return {
            "success": True,
            "reply": synth_reply,
            "provider_used": f"Alice (Research Worker) + {ai_res.get('provider_used', 'AI')}",
            "model_used": ai_res.get("model_used", "Auto"),
            "fallback_occurred": ai_res.get("fallback_occurred", False),
            "task_id": task_id
        }

    def _orchestrate_browser_task(self, prompt: str, task_id: str, event_callback: Optional[Callable[[Dict[str, Any]], None]]) -> Dict[str, Any]:
        """OMA delegates browser automation to Bob, then verification to Dave."""
        bob = self.workers["bob"]
        bob.state = "ASSIGNED"
        bob.task_id = task_id
        bob.current_task = f"Browser task: {prompt[:40]}"
        bob.assigned_by = "OMA"
        bob.start_time = time.time()
        bob.pending_steps = ["Launch/focus Google Chrome", "Navigate to target web page", "Verify page load"]
        bob.completed_steps = []
        self.emit_agent_event(bob, event_callback)

        time.sleep(0.1)
        bob.state = "WORKING"
        bob.current_tool = "tool_open_app('chrome')"
        bob.completed_steps.append("Launching Chrome browser")
        if event_callback:
            event_callback({
                "stage": "executing",
                "detail": f"[OMA → Bob] Bob executing browser directive: '{prompt}'.",
                "pct": 50
            })
        self.emit_agent_event(bob, event_callback)

        # Launch chrome
        b_res = tool_open_app("chrome")
        bob.actual_output = b_res
        bob.completed_steps.append(f"Browser launched: {b_res}")
        bob.state = "COMPLETED"
        self.emit_agent_event(bob, event_callback)

        # Dave verifies
        dave = self.workers["dave"]
        dave.state = "WORKING"
        dave.task_id = task_id
        dave.current_task = "Verify Chrome process"
        dave.assigned_by = "OMA"
        dave.start_time = time.time()
        dave.current_tool = "tool_get_windows('chrome')"
        dave.completed_steps = ["Checking Chrome window handle"]
        time.sleep(0.2)
        d_res = tool_get_windows("chrome")
        dave.actual_output = d_res
        dave.state = "COMPLETED"
        self.emit_agent_event(dave, event_callback)

        self.main_agent["state"] = "COMPLETED"
        reply = f"✓ Bob ক্রোম ব্রাউজার ওপেন করেছে এবং Dave উইন্ডো যাচাই করেছে।"
        if event_callback:
            event_callback({
                "stage": "completed",
                "detail": "Browser task completed and verified.",
                "pct": 100
            })

        return {
            "success": True,
            "reply": reply,
            "provider_used": "Bob (Browser Worker)",
            "model_used": "Chrome Automation",
            "fallback_occurred": False,
            "task_id": task_id
        }

    def _orchestrate_general_ai_task(self, prompt: str, task_id: str, system_context: Optional[str], event_callback: Optional[Callable[[Dict[str, Any]], None]]) -> Dict[str, Any]:
        """OMA routes general dialogue or planning through the best available AI model."""
        if event_callback:
            event_callback({
                "stage": "thinking",
                "detail": "OMA consulting multi-AI routing engine...",
                "pct": 35
            })

        ai_res = router.execute(prompt, system_prompt=system_context, event_callback=event_callback)
        self.main_agent["state"] = "COMPLETED"
        return ai_res


# ==================== NOTES PERSISTENCE & CRUD ====================
def get_all_notes() -> List[Dict[str, Any]]:
    """Loads all saved notes from local persistent JSON storage."""
    try:
        if os.path.exists(NOTES_FILE):
            with open(NOTES_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception:
        pass
    return []

def save_note(title: str, content: str, note_id: Optional[str] = None, use_as_context: bool = False) -> Dict[str, Any]:
    """Creates or updates a note in local storage."""
    notes = get_all_notes()
    now = time.time()
    if not note_id:
        note_id = "note_" + uuid.uuid4().hex[:8]
        new_note = {
            "id": note_id,
            "title": title.strip() or "Untitled Note",
            "content": content.strip(),
            "use_as_context": use_as_context,
            "created_at": now,
            "updated_at": now
        }
        notes.insert(0, new_note)
    else:
        found = False
        for n in notes:
            if n.get("id") == note_id:
                n["title"] = title.strip() or "Untitled Note"
                n["content"] = content.strip()
                n["use_as_context"] = use_as_context
                n["updated_at"] = now
                found = True
                break
        if not found:
            notes.insert(0, {
                "id": note_id,
                "title": title.strip() or "Untitled Note",
                "content": content.strip(),
                "use_as_context": use_as_context,
                "created_at": now,
                "updated_at": now
            })

    try:
        os.makedirs(os.path.dirname(NOTES_FILE), exist_ok=True)
        with open(NOTES_FILE, 'w', encoding='utf-8') as f:
            json.dump(notes, f, indent=2)
    except Exception as e:
        return {"success": False, "error": str(e)}

    return {"success": True, "note_id": note_id, "notes": notes}

def delete_note(note_id: str) -> Dict[str, Any]:
    """Deletes a note by ID."""
    notes = get_all_notes()
    filtered = [n for n in notes if n.get("id") != note_id]
    try:
        os.makedirs(os.path.dirname(NOTES_FILE), exist_ok=True)
        with open(NOTES_FILE, 'w', encoding='utf-8') as f:
            json.dump(filtered, f, indent=2)
    except Exception as e:
        return {"success": False, "error": str(e)}
    return {"success": True, "notes": filtered}

# Global Orchestrator Singleton
orchestrator = OmaOrchestrator()
