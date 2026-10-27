import sys
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, ".")
from multi_ai.router import router

print("Testing Claude Code quota fallback...")
router.set_mode("manual", "claude-3-5-haiku")
res = router.execute("What is 2+2?")
print("Success:", res.get("success"))
print("Provider used:", res.get("provider_used"))
print("Model used:", res.get("model_used"))
print("Fallback occurred:", res.get("fallback_occurred"))
print("Fallback notice:", res.get("fallback_notice"))
print("Reply snippet:", str(res.get("reply"))[:150])
