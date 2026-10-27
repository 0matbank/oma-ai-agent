"""
Multi-AI Architecture: Task Checkpoint & Idempotency Journal (SQLite)
Ensures state persistence and prevents duplicate side-effects during model failover.
"""
import sqlite3
import os
import json
import time
from typing import Optional, Dict, Any, List

HOME = os.path.expanduser('~')
DIR = os.environ.get('OMA_DIR') or os.path.join(os.environ.get('APPDATA') or os.path.join(HOME, '.config'), 'Oma')
os.makedirs(DIR, exist_ok=True)
DB_PATH = os.path.join(DIR, 'journal.sqlite')

class TaskJournal:
    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS tasks (
                    task_id TEXT PRIMARY KEY,
                    prompt TEXT,
                    intent TEXT,
                    status TEXT,
                    current_model TEXT,
                    planned_steps TEXT,
                    completed_steps TEXT,
                    tool_results TEXT,
                    final_reply TEXT,
                    created_at REAL,
                    updated_at REAL
                )
            ''')
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS action_journal (
                    action_id TEXT PRIMARY KEY,
                    task_id TEXT,
                    tool_name TEXT,
                    arguments TEXT,
                    idempotency_key TEXT UNIQUE,
                    status TEXT,
                    result TEXT,
                    timestamp REAL
                )
            ''')
            conn.commit()

    def create_task(self, task_id: str, prompt: str, intent: str = "general") -> None:
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT OR REPLACE INTO tasks 
                (task_id, prompt, intent, status, current_model, planned_steps, completed_steps, tool_results, final_reply, created_at, updated_at)
                VALUES (?, ?, ?, 'pending', '', '[]', '[]', '{}', '', ?, ?)
            ''', (task_id, prompt, intent, time.time(), time.time()))
            conn.commit()

    def record_step(self, task_id: str, tool_name: str, args: Dict[str, Any], result: str, idempotency_key: str) -> bool:
        """
        Records a completed tool execution with an idempotency key.
        Returns False if the action was already executed previously.
        """
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT status, result FROM action_journal WHERE idempotency_key = ?', (idempotency_key,))
            existing = cursor.fetchone()
            if existing and existing[0] == 'completed':
                return False # Already done, do not duplicate

            action_id = f"{task_id}_{time.time()}"
            cursor.execute('''
                INSERT OR REPLACE INTO action_journal
                (action_id, task_id, tool_name, arguments, idempotency_key, status, result, timestamp)
                VALUES (?, ?, ?, ?, ?, 'completed', ?, ?)
            ''', (action_id, task_id, tool_name, json.dumps(args), idempotency_key, result, time.time()))

            # Update task record
            cursor.execute('SELECT completed_steps, tool_results FROM tasks WHERE task_id = ?', (task_id,))
            row = cursor.fetchone()
            if row:
                completed = json.loads(row[0]) if row[0] else []
                results = json.loads(row[1]) if row[1] else {}
                completed.append(f"{tool_name}: {args}")
                results[tool_name] = result
                cursor.execute('''
                    UPDATE tasks SET completed_steps = ?, tool_results = ?, updated_at = ? WHERE task_id = ?
                ''', (json.dumps(completed), json.dumps(results), time.time(), task_id))

            conn.commit()
            return True

    def finish_task(self, task_id: str, reply: str, status: str = "completed"):
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                UPDATE tasks SET status = ?, final_reply = ?, updated_at = ? WHERE task_id = ?
            ''', (status, reply, time.time(), task_id))
            conn.commit()

    def get_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM tasks WHERE task_id = ?', (task_id,))
            row = cursor.fetchone()
            if not row:
                return None
            return {
                'task_id': row[0],
                'prompt': row[1],
                'intent': row[2],
                'status': row[3],
                'current_model': row[4],
                'planned_steps': json.loads(row[5]),
                'completed_steps': json.loads(row[6]),
                'tool_results': json.loads(row[7]),
                'final_reply': row[8],
                'created_at': row[9],
                'updated_at': row[10]
            }

journal = TaskJournal()
