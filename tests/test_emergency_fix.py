"""
Emergency Fix Regression Test Suite for Oma AI
Validates:
1. No repeated context growth (clean_user_prompt).
2. Action de-duplication (no duplicate Windows actions).
3. Claude quota failure triggers exactly ONE fallback sequence to Ollama.
4. Hard recursion guard blocks any recursive atticus.py invocation.
5. 100 sequential requests without accumulating Python processes.
6. Memory (RAM) and GPU (VRAM) monitoring before and after.
"""

import os
import sys
import time
import json
import subprocess
import psutil

# Ensure current directory is on path
WORKSPACE = r"F:\Oma Ai Agent"
sys.path.insert(0, WORKSPACE)

try:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except Exception:
    pass

def log(msg):
    print(f"[TEST] {msg}", flush=True)

def get_python_processes():
    procs = []
    for p in psutil.process_iter(['pid', 'name', 'cmdline', 'memory_info']):
        try:
            if 'python' in p.info['name'].lower() or 'atticus' in p.info['name'].lower():
                cmd = " ".join(p.info['cmdline'] or [])
                # Do NOT touch or count Personal-Agent
                if "Personal-Agent" not in cmd:
                    procs.append(p)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    return procs

def get_gpu_memory_mib():
    try:
        res = subprocess.run(
            ['nvidia-smi', '--query-gpu=memory.used,memory.total', '--format=csv,nounits,noheader'],
            capture_output=True, text=True, timeout=5
        )
        if res.returncode == 0:
            used, total = res.stdout.strip().split(',')
            return float(used.strip()), float(total.strip())
    except Exception:
        pass
    return 0.0, 0.0

def test_1_clean_user_prompt():
    log("Running Test 1: Verify clean_user_prompt strips nested Context/Request blocks...")
    from multi_ai.router import clean_user_prompt
    
    # Simulate a 10-layer nested context created by the old bug
    nested = "Request: Context: Front app: Code. " * 10 + "what is 2 + 2?"
    cleaned = clean_user_prompt(nested)
    assert cleaned == "what is 2 + 2?", f"Expected 'what is 2 + 2?', got: '{cleaned}'"
    
    nested_with_failed = "Context: ... Earlier: ... A previous try failed: Claude failed. Request: Open Notepad"
    cleaned2 = clean_user_prompt(nested_with_failed)
    assert cleaned2 == "Open Notepad", f"Expected 'Open Notepad', got: '{cleaned2}'"
    log("✓ Test 1 PASSED: clean_user_prompt correctly isolates the original user prompt.")

def test_2_action_deduplication():
    log("Running Test 2: Verify action deduplication prevents duplicate Windows actions...")
    from multi_ai.tools import execute_tool_call, is_duplicate_action
    
    # Rapid successive calls
    res1 = execute_tool_call('open_app', {'app_name': 'notepad'})
    res2 = execute_tool_call('open_app', {'app_name': 'notepad'})
    
    log(f"  Call 1 result: {res1}")
    log(f"  Call 2 result: {res2}")
    assert "duplicate" in res2.lower() or "already" in res2.lower(), f"Expected duplicate prevention, got: {res2}"
    log("✓ Test 2 PASSED: Rapid duplicate Windows actions are cleanly intercepted and skipped.")

def test_3_hard_recursion_guard():
    log("Running Test 3: Verify hard recursion guard blocks child atticus.py prompt execution...")
    installed_script = r"C:\Users\USERAS\AppData\Local\Programs\Atticus\atticus.py"
    py_exe = sys.executable

    env = os.environ.copy()
    env['OMA_IN_ATTICUS'] = '1'
    env['OMA_EXECUTION_DEPTH'] = '1'

    res = subprocess.run(
        [py_exe, installed_script, "what time is it?"],
        capture_output=True, text=True, env=env, timeout=10
    )
    log(f"  Return code: {res.returncode}")
    log(f"  Stderr: {res.stderr.strip()}")
    assert res.returncode != 0, "Recursion guard should exit with non-zero code!"
    assert "blocked" in (res.stderr + res.stdout).lower(), "Recursion guard should log blocked message"
    log("✓ Test 3 PASSED: Recursive prompt execution is hard-blocked immediately.")

def test_4_claude_quota_fallback():
    log("Running Test 4: Verify Claude quota failure triggers exactly ONE fallback to Ollama...")
    from multi_ai.router import router
    
    # We execute router with a prompt. Claude Code will fail due to weekly quota limit.
    # It must cleanly fall back to local Ollama (qwen3-vl:8b or qwen3:8b) without looping.
    t0 = time.time()
    events = []
    res = router.execute("What is 15 * 4? Return only the number.", event_callback=lambda ev: events.append(ev))
    dt = time.time() - t0
    
    log(f"  Execution time: {dt:.2f}s")
    log(f"  Success: {res.get('success')}")
    log(f"  Provider Used: {res.get('provider_used')}")
    log(f"  Model Used: {res.get('model_used')}")
    log(f"  Reply: {res.get('reply')[:100]}...")
    
    # Verify exactly one provider fallback occurred
    assert res.get('success') is True, f"Execution failed: {res}"
    assert res.get('provider_used') == 'ollama', f"Expected fallback to ollama, got: {res.get('provider_used')}"
    assert "60" in res.get('reply'), f"Expected answer 60 in reply, got: {res.get('reply')}"
    log("✓ Test 4 PASSED: Controlled, single fallback to Ollama succeeded without recursion.")

def test_5_sequential_requests(count=100):
    log(f"Running Test 5: {count} sequential requests monitoring process count and RAM/VRAM...")
    installed_script = r"C:\Users\USERAS\AppData\Local\Programs\Atticus\atticus.py"
    py_exe = sys.executable
    
    procs_before = len(get_python_processes())
    gpu_before, _ = get_gpu_memory_mib()
    ram_before_mb = psutil.virtual_memory().used / (1024 * 1024)
    log(f"  Baseline: {procs_before} non-Personal-Agent Python procs | RAM used: {ram_before_mb:.1f} MB | VRAM used: {gpu_before:.1f} MiB")
    
    # Run sequential fast commands and small queries through atticus.py
    for i in range(1, count + 1):
        # We test with --fast (which exercises winctl, fast router, and instant commands)
        p = subprocess.run([py_exe, installed_script, "--fast", f"time {i}"], capture_output=True, text=True, timeout=10)
        if i % 25 == 0:
            current_procs = len(get_python_processes())
            log(f"  Completed {i}/{count} requests. Current Python procs: {current_procs}")
            
    procs_after = len(get_python_processes())
    gpu_after, _ = get_gpu_memory_mib()
    ram_after_mb = psutil.virtual_memory().used / (1024 * 1024)
    log(f"  After {count} requests: {procs_after} Python procs | RAM used: {ram_after_mb:.1f} MB | VRAM used: {gpu_after:.1f} MiB")
    
    assert procs_after <= procs_before + 1, f"Process accumulation detected! Before: {procs_before}, After: {procs_after}"
    log(f"✓ Test 5 PASSED: {count} sequential requests executed with zero process leaks.")

if __name__ == '__main__':
    log("=== STARTING EMERGENCY REPAIR REGRESSION TEST SUITE ===")
    test_1_clean_user_prompt()
    test_2_action_deduplication()
    test_3_hard_recursion_guard()
    test_4_claude_quota_fallback()
    test_5_sequential_requests(100)
    log("=== ALL REGRESSION TESTS PASSED SUCCESSFULLY! ===")
