"""
Multi-AI Architecture Package
Provides universal multi-provider routing, live local model discovery,
secure tools, and SQLite task journaling for Oma / Atticus Windows Agent.
"""
from multi_ai.router import router, ModelRouter
from multi_ai.journal import journal, TaskJournal
from multi_ai.tools import TOOL_REGISTRY, execute_tool_call
