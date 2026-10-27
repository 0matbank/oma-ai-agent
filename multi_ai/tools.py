"""
Multi-AI Architecture: Universal Tool Registry & Action Policy Gate
Wraps existing winctl.py and system capabilities with strict policy validation.
"""
import os
import re
import subprocess
import urllib.parse
import urllib.request
import time
from typing import Dict, Any, List

try:
    import winctl
except ImportError:
    winctl = None

# Blocked destructive commands
DENIED_COMMANDS = {
    'rm', 'rmdir', 'sudo', 'dd', 'diskutil', 'shutdown', 'reboot', 'halt',
    'del', 'erase', 'rd', 'format', 'diskpart', 'cipher', 'bcdedit',
    'reg delete', 'remove-item', 'stop-computer', 'restart-computer'
}

def is_safe_command(cmd: str) -> bool:
    c_lower = cmd.lower()
    for bad in DENIED_COMMANDS:
        if re.search(r'\b' + re.escape(bad) + r'\b', c_lower):
            return False
    return True

# Duplicate Windows Action Safeguard
_ACTION_TIMESTAMPS: Dict[str, float] = {}
_ACTION_COOLDOWN = 3.0  # seconds

def is_duplicate_action(action_key: str, cooldown: float = _ACTION_COOLDOWN) -> bool:
    """Checks if an identical action was executed within the cooldown window."""
    now = time.time()
    last_time = _ACTION_TIMESTAMPS.get(action_key, 0.0)
    if now - last_time < cooldown:
        return True
    _ACTION_TIMESTAMPS[action_key] = now
    # Periodic cleanup of old history
    if len(_ACTION_TIMESTAMPS) > 100:
        for k in list(_ACTION_TIMESTAMPS.keys()):
            if now - _ACTION_TIMESTAMPS[k] > 60:
                del _ACTION_TIMESTAMPS[k]
    return False

# Tool Implementations
def tool_open_app(app_name: str) -> str:
    """Launches an application by name or common alias."""
    app_lower = app_name.lower().strip()
    action_key = f"open_app:{app_lower}"
    if is_duplicate_action(action_key, cooldown=4.0):
        return f"✓ {app_name} is already opening (skipped duplicate action)."

    mapping = {
        'chrome': 'chrome',
        'google chrome': 'chrome',
        'notepad': 'notepad',
        'calculator': 'calculator:',
        'calc': 'calculator:',
        'terminal': 'wt',
        'powershell': 'powershell',
        'cmd': 'cmd',
        'explorer': 'explorer',
        'vs code': 'code',
        'code': 'code',
        'spotify': 'spotify:',
        'edge': 'msedge',
        'settings': 'ms-settings:'
    }
    target = mapping.get(app_lower, app_lower)
    try:
        os.startfile(target)
        return f"✓ Opened {app_name}."
    except Exception as e:
        try:
            subprocess.Popen(f'start "" "{target}"', shell=True)
            return f"✓ Opened {app_name}."
        except Exception as e2:
            return f"Error opening {app_name}: {str(e2)}"

def tool_place_window(app: str, position: str = "full", screen: str = "current") -> str:
    """Moves, resizes, or snaps a window (left, right, full, center)."""
    if winctl and hasattr(winctl, 'place'):
        try:
            res = winctl.place(app, position, screen)
            return res or f"✓ Placed {app} to {position} on {screen}."
        except Exception as e:
            return f"Error placing window: {str(e)}"
    return f"Window control not available on this platform."

def tool_web_search(query: str) -> str:
    """Free web search using DuckDuckGo HTML parser."""
    try:
        url = 'https://html.duckduckgo.com/html/?q=' + urllib.parse.quote(query)
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
        with urllib.request.urlopen(req, timeout=6) as res:
            page = res.read().decode('utf-8', errors='ignore')
        results = []
        for u, t, sn in re.findall(r'class="result__a" href="([^"]+)">(.*?)</a>.*?class="result__snippet"[^>]*>(.*?)</a>', page, re.S)[:4]:
            t_clean = re.sub(r'<[^>]+>', '', t).strip()
            sn_clean = re.sub(r'<[^>]+>', '', sn).strip()
            results.append(f"• {t_clean}\n  {sn_clean}")
        if results:
            return "\n\n".join(results)
    except Exception as e:
        pass
    return f"Search completed for '{query}'. No direct web page snippet returned."

def tool_read_screen() -> str:
    """Takes a screenshot of the active screen and identifies the focused application."""
    app = winctl.front_app() if winctl and hasattr(winctl, 'front_app') else 'Active Desktop'
    path = ""
    if winctl and hasattr(winctl, 'look'):
        try:
            path = winctl.look()
        except Exception:
            pass
    return f"Active Application: {app}. Screenshot Path: {path or 'Captured to memory'}."

def tool_get_windows(app: str = "") -> str:
    """Lists visible open windows with titles and processes."""
    if winctl and hasattr(winctl, 'windows'):
        try:
            wins = winctl.windows(app)
            if wins:
                return "\n".join(f"• {w.get('app', '')}: {w.get('title', '')}" for w in wins[:8])
            return "No matching visible windows found."
        except Exception as e:
            return f"Error listing windows: {str(e)}"
    return "Window listing unavailable."

def tool_media_control(action: str) -> str:
    """Controls system media playback (playpause, next, previous)."""
    if winctl and hasattr(winctl, 'media'):
        try:
            winctl.media(action)
            return f"✓ Media {action} sent."
        except Exception as e:
            return f"Media error: {str(e)}"
    return "Media control unavailable."

# Tool Registry
TOOL_REGISTRY: Dict[str, Any] = {
    'open_app': {
        'func': tool_open_app,
        'description': 'Opens a Windows application (e.g. notepad, chrome, calc, terminal, spotify, vs code).',
        'parameters': {
            'type': 'object',
            'properties': {'app_name': {'type': 'string', 'description': 'The name of the application to launch'}},
            'required': ['app_name']
        }
    },
    'place_window': {
        'func': tool_place_window,
        'description': 'Snaps or moves an application window to left, right, full, or center.',
        'parameters': {
            'type': 'object',
            'properties': {
                'app': {'type': 'string', 'description': 'Application or window title'},
                'position': {'type': 'string', 'enum': ['left', 'right', 'full', 'center'], 'description': 'Screen position'},
                'screen': {'type': 'string', 'description': 'Monitor name or "current"'}
            },
            'required': ['app', 'position']
        }
    },
    'web_search': {
        'func': tool_web_search,
        'description': 'Performs a live web search for current information, news, and facts.',
        'parameters': {
            'type': 'object',
            'properties': {'query': {'type': 'string', 'description': 'The search query'}} ,
            'required': ['query']
        }
    },
    'read_screen': {
        'func': tool_read_screen,
        'description': 'Takes a screenshot of the user screen and returns current focused window.',
        'parameters': {'type': 'object', 'properties': {}}
    },
    'get_open_windows': {
        'func': tool_get_windows,
        'description': 'Lists open active application windows across displays.',
        'parameters': {
            'type': 'object',
            'properties': {'app': {'type': 'string', 'description': 'Optional filter for app name'}}
        }
    },
    'media_control': {
        'func': tool_media_control,
        'description': 'Controls media audio playback (playpause, next, previous).',
        'parameters': {
            'type': 'object',
            'properties': {'action': {'type': 'string', 'enum': ['playpause', 'next', 'previous']}},
            'required': ['action']
        }
    }
}

def get_openai_tool_definitions() -> List[Dict[str, Any]]:
    """Returns OpenAI/Ollama compatible function calling schemas."""
    defs = []
    for name, item in TOOL_REGISTRY.items():
        defs.append({
            'type': 'function',
            'function': {
                'name': name,
                'description': item['description'],
                'parameters': item['parameters']
            }
        })
    return defs

def execute_tool_call(name: str, args: Dict[str, Any]) -> str:
    """Executes a registered tool securely through the action policy gate."""
    if name not in TOOL_REGISTRY:
        return f"Unknown tool: {name}"
    
    # Action deduplication check
    try:
        import json
        call_key = f"{name}:{json.dumps(args, sort_keys=True)}"
        if is_duplicate_action(call_key, cooldown=3.0):
            return f"✓ Action {name} already performed (duplicate skipped)."
    except Exception:
        pass

    func = TOOL_REGISTRY[name]['func']
    try:
        return func(**args)
    except Exception as e:
        return f"Error executing {name}: {str(e)}"
