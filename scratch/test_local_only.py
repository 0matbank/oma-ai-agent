import sys
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, ".")
from multi_ai.router import router

print("Testing Local Only Mode...")
router.set_mode("local_only")
res = router.execute("What is the capital of France?")
print("Success:", res.get("success"))
print("Provider used:", res.get("provider_used"))
print("Model used:", res.get("model_used"))
print("Fallback occurred:", res.get("fallback_occurred"))
print("Reply snippet:", str(res.get("reply"))[:150])
assert res.get("provider_used") == "ollama", "Local Only mode must use ollama!"
print("TEST PASSED: Cloud providers were never invoked.")
