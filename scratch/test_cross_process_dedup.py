import sys, subprocess
sys.stdout.reconfigure(encoding='utf-8')

py = r"C:\Users\USERAS\AppData\Local\Atticus\venv\Scripts\python.exe"
code = "import sys; sys.stdout.reconfigure(encoding='utf-8'); from multi_ai.tools import execute_tool_call; print(execute_tool_call('open_app', {'app_name': 'calculator'}))"

p1 = subprocess.run([py, "-c", code], capture_output=True, text=True, encoding="utf-8")
p2 = subprocess.run([py, "-c", code], capture_output=True, text=True, encoding="utf-8")

print("Process 1:", p1.stdout.strip())
print("Process 2:", p2.stdout.strip())
