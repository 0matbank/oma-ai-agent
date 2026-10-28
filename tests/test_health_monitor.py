import os
import shutil
import sys
import tempfile
import time
import types
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from multi_ai import health_monitor as hm, tool_agent  # noqa: E402


class Monitor(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.old = hm.FILE
        hm.FILE = os.path.join(self.d, 'provider_health.json')

    def tearDown(self):
        hm.FILE = self.old
        shutil.rmtree(self.d, True)

    def test_quota_cooldown_persists_and_expires(self):
        hm.record('claude_code', 'haiku', False, 'quota_exhausted', 'session limit', retry_at=time.time() + 3600)
        self.assertEqual(hm.status('claude_code')[0], 'QUOTA_EXHAUSTED')
        self.assertFalse(hm.usable('claude_code', 'haiku'))
        d = hm.load()   # a restart reads the same file
        d['providers']['claude_code']['retry_at'] = time.time() - 1
        d['providers']['claude_code']['models']['haiku']['retry_at'] = time.time() - 1
        hm.save(d)
        self.assertEqual(hm.status('claude_code', 'haiku')[0], 'UNKNOWN')   # reset passed: bounded recheck by the next request
        self.assertTrue(hm.usable('claude_code', 'haiku'))

    def test_circuit_breaker(self):
        for _ in range(3):
            hm.record('gemini', 'm1', False, 'timeout', 'read timed out')
        self.assertEqual(hm.status('gemini', 'm1')[0], 'COOLDOWN')
        hm.record('gemini', 'm1', True, latency=1.2)
        self.assertEqual(hm.status('gemini', 'm1')[0], 'READY')

    def test_order_drops_blocked_and_respects_tools(self):
        hm.record('gemini', 'old', False, 'model_unavailable', 'HTTP 404')
        hm.record('ollama', 'good', True, latency=2)
        d = hm.load()
        d['providers']['ollama']['models']['notools'] = {'state': 'READY', 'caps': {'tools': False}}
        hm.save(d)
        cands, skipped = hm.order([('gemini', 'old'), ('ollama', 'notools'), ('gemini', 'new'), ('ollama', 'good')], need_tools=True)
        self.assertEqual(cands, [('ollama', 'good'), ('gemini', 'new')])
        self.assertEqual({k['model'] for k in skipped}, {'old', 'notools'})


class Agent(unittest.TestCase):
    def eng(self, risky='', answer='y'):
        e = types.SimpleNamespace(DENY=['Bash(rm:*)', 'Bash(shutdown:*)'], risky=lambda c: risky, pref=lambda k, d: d,
                                  ask_user=lambda j, s: answer, relay=lambda p: None, shim_env=lambda: dict(os.environ),
                                  label=lambda n, i: i['command'], say=lambda *a: None, clean=lambda t: t)
        return e

    def script(self, turns):
        it = iter(turns)
        return lambda *a, **k: next(it)

    def test_runs_command_then_answers(self):
        orig = tool_agent._chat
        tool_agent._chat = self.script([('', [('c1', 'echo hi'), ('c2', 'echo hi')], {'content': '', 'tool_calls': []}), ('Done: said hi.', [], {})])
        try:
            r = tool_agent.run_agent('say hi', 'gemini', 'x', 'u', 'k', 'sys', self.eng())
        finally:
            tool_agent._chat = orig
        self.assertTrue(r['ok'])
        self.assertEqual(r['cmds'], ['echo hi'])   # the duplicate was not run again

    def test_denial_stops_without_running(self):
        orig = tool_agent._chat
        tool_agent._chat = self.script([('', [('c1', 'del important.txt')], {'content': '', 'tool_calls': []})])
        try:
            r = tool_agent.run_agent('delete it', 'ollama', 'x', 'u', '', 'sys', self.eng(risky='Delete something?', answer='n'))
        finally:
            tool_agent._chat = orig
        self.assertTrue(r['denied'])
        self.assertFalse(r['ok'])
        self.assertEqual(r['cmds'], [])

    def test_deny_list(self):
        self.assertEqual(tool_agent.denied_by_rule('echo a; rm -rf x', ['Bash(rm:*)']), 'rm')
        self.assertEqual(tool_agent.denied_by_rule('start calc', ['Bash(rm:*)']), '')

    def test_text_alone_is_not_an_action(self):
        orig = tool_agent._chat
        tool_agent._chat = self.script([('I opened Calculator for you.', [], {})])
        try:
            r = tool_agent.run_agent('open calculator', 'gemini', 'x', 'u', 'k', 'sys', self.eng())
        finally:
            tool_agent._chat = orig
        self.assertFalse(r['ok'])


if __name__ == '__main__':
    unittest.main()
