import sys, os
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, ".")
from multi_ai.tools import is_safe_command

# 1. Test Permission Gate
print("Testing Permission Gate:")
safe = is_safe_command("calc")
unsafe1 = is_safe_command("rm -rf /")
unsafe2 = is_safe_command("format C:")
unsafe3 = is_safe_command("del /f /q C:\\Windows")
print(f"calc safe: {safe} (expected True)")
print(f"rm -rf safe: {unsafe1} (expected False)")
print(f"format safe: {unsafe2} (expected False)")
print(f"del safe: {unsafe3} (expected False)")
assert safe and not unsafe1 and not unsafe2 and not unsafe3, "Permission check failed!"

# 2. Test Memory Loading
import atticus
print("\nTesting Atticus Memory Rules:")
memory_file = atticus.MEMORY
os.makedirs(atticus.DIR, exist_ok=True)
with open(memory_file, 'a', encoding='utf-8') as f:
    f.write("- Test rule: always greet with Respect\n")

rules = atticus.relevant_rules("greet with Respect")
print("Memory recall for 'greet with Respect':", rules.strip()[:100])
assert "Respect" in rules, "Atticus memory failed to retrieve rule!"

print("\nTEST PASSED: Original memory and permissions work correctly.")
