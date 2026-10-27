import os
import hashlib

paths = {
    'workspace': r'F:\Oma Ai Agent',
    'dot_atticus': r'C:\Users\USERAS\.atticus',
    'installed_prog': os.path.expandvars(r'%LOCALAPPDATA%\Programs\Atticus')
}

files_to_check = [
    'atticus.py',
    'winctl.py',
    'multi_ai/__init__.py',
    'multi_ai/router.py',
    'multi_ai/providers.py',
    'multi_ai/tools.py',
    'multi_ai/models.py',
    'multi_ai/journal.py',
    'multi_ai/adapters/claude_code.py',
    'multi_ai/adapters/ollama.py',
    'multi_ai/adapters/openai_compat.py',
    'ui/settings.html',
    'ui/app.js',
    'ui/agent_town.js',
    'ui/mindmap.js'
]

def hash_file(p):
    if not os.path.exists(p): return 'MISSING'
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        h.update(f.read())
    return h.hexdigest()

print(f"{'File':<35} | {'Workspace':<16} | {'.atticus':<16} | {'Programs/Atticus':<16} | Status")
print('-' * 105)
all_match = True
for f in files_to_check:
    h_ws = hash_file(os.path.join(paths['workspace'], f))
    h_dot = hash_file(os.path.join(paths['dot_atticus'], f))
    h_prog = hash_file(os.path.join(paths['installed_prog'], f))
    m = 'MATCH' if (h_ws == h_dot == h_prog and h_ws != 'MISSING') else 'MISMATCH'
    if m == 'MISMATCH':
        all_match = False
    print(f"{f:<35} | {h_ws[:16]:<16} | {h_dot[:16]:<16} | {h_prog[:16]:<16} | {m}")

print('-' * 105)
print(f"Overall Synchronization Status: {'ALL MATCH' if all_match else 'MISMATCH DETECTED'}")
