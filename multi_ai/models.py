"""
Multi-AI Architecture: Data Models & Types
Defines provider configurations, model capabilities, and task state.
"""
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional
import time

@dataclass
class ModelInfo:
    model_id: str
    provider_id: str
    display_name: str
    supports_tools: bool = True
    supports_vision: bool = False
    local: bool = False
    context_limit: int = 8192
    enabled: bool = True

@dataclass
class ProviderConfig:
    id: str
    display_name: str
    adapter_type: str # 'claude_code', 'ollama', 'lm_studio', 'openai_compat', 'gemini'
    base_url: str = ""
    api_key: str = "" # masked in UI
    enabled: bool = True
    local: bool = False
    priority: int = 10 # lower number = higher priority
    cooldown_until: float = 0.0 # timestamp
    last_error: str = ""

@dataclass
class ToolDefinition:
    name: str
    description: str
    parameters: Dict[str, Any]

@dataclass
class TaskCheckpoint:
    task_id: str
    prompt: str
    intent: str
    status: str # 'pending', 'running', 'completed', 'failed'
    current_model: str = ""
    planned_steps: List[str] = field(default_factory=list)
    completed_steps: List[str] = field(default_factory=list)
    tool_results: Dict[str, Any] = field(default_factory=dict)
    final_reply: str = ""
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
