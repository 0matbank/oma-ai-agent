"""
Oma notes storage, plus a compatibility shim for the old worker-status call.

The previous keyword "orchestrator" (Alice/Bob/Carol/Dave methods that marked tasks COMPLETED without checking the
model's result, and verified research with a fixed string) was removed. Requests now run through the original Atticus
engine (atticus.py serve()), and worker lanes are derived from its real tool calls in multi_ai/taskstate.py.
"""
import os
import json
import time
import uuid
from typing import Dict, Any, List, Optional

HOME = os.path.expanduser('~')
ATTICUS_DIR = os.environ.get('ATTICUS_DIR') or os.path.join(os.environ.get('APPDATA') or os.path.join(HOME, '.config'), 'Atticus')
NOTES_FILE = os.path.join(ATTICUS_DIR, 'notes.json')


class _Compat:
    def get_all_workers_status(self) -> Dict[str, Any]:
        from multi_ai.taskstate import last_state
        return last_state()


orchestrator = _Compat()


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


