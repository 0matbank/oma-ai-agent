"""Offline regressions for the October 2026 runtime repair: honest task states, worker lanes from real tool calls,
bounded text-only fallback, live model handling. No real model, network or desktop calls."""
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import atticus
import multi_ai.taskstate as ts
R = sys.modules['multi_ai.router']   # multi_ai/__init__ rebinds the name `router` to the instance
from multi_ai.adapters.ollama import OllamaAdapter


class Lines(list):
    def __call__(self, line):
        self.append(json.loads(line[7:]))


def tracker():
    out = Lines()
    return ts.TaskTracker('test', out=out), out


class WorkerLaneTests(unittest.TestCase):
    def test_lanes_follow_the_real_tool(self):
        self.assertEqual(ts.worker_for('WebSearch', {'query': 'x'}), 'alice')
        self.assertEqual(ts.worker_for('Bash', {'command': 'atticus --search "x"'}), 'alice')
        self.assertEqual(ts.worker_for('Bash', {'command': 'atticus --show "https://youtube.com"'}), 'bob')
        self.assertEqual(ts.worker_for('Bash', {'command': 'start "" "https://google.com/search?q=x"'}), 'bob')
        self.assertEqual(ts.worker_for('Bash', {'command': 'atticus --show "Notepad"'}), 'carol')
        self.assertEqual(ts.worker_for('Bash', {'command': 'atticus --int youtube search "lofi"'}), 'eve')
        self.assertEqual(ts.worker_for('Read', {'file_path': 'C:/x/atticus-screen-1.jpg'}), 'carol')


class TrackerTests(unittest.TestCase):
    def setUp(self):
        d = tempfile.TemporaryDirectory()
        self.addCleanup(d.cleanup)
        p = patch.object(ts, 'STATE_FILE', os.path.join(d.name, 'task_state.json'))
        p.start()
        self.addCleanup(p.stop)

    def test_worker_works_only_between_real_start_and_result(self):
        t, out = tracker()
        t.start()
        self.assertEqual(out[-1]['workers']['alice']['state'], 'IDLE')
        t.step_start('tu1', 'WebSearch', {'query': 'x'}, 'Searching the web: x')
        self.assertEqual(out[-1]['workers']['alice']['state'], 'WORKING')
        t.step_end('tu1', False, 'HTTP 503')
        self.assertEqual(out[-1]['workers']['alice']['state'], 'FAILED')
        self.assertEqual(out[-1]['step']['status'], 'FAILED')

    def test_no_percentages_anywhere(self):
        t, out = tracker()
        t.start(); t.set_stage('planning', 'x'); t.finish('FAILED', '', 'boom')
        self.assertFalse(any('pct' in e for e in out))

    def test_verification_verdicts(self):
        t, _ = tracker()
        self.assertEqual(t.verify([]), 'ok')
        self.assertEqual(t.verify([('a', lambda: (True, 'seen'))]), 'ok')
        self.assertEqual(t.verify([('a', lambda: (None, 'not seen'))]), 'unverified')
        self.assertEqual(t.verify([('a', lambda: (True, 'ok')), ('b', lambda: (False, 'contradicts'))]), 'contradicted')
        self.assertEqual(t.verify([('crash', lambda: 1 / 0)]), 'unverified')   # a crashing check proves nothing

    def test_a_task_that_died_is_never_shown_as_working(self):
        t, _ = tracker()
        t.start(); t.step_start('tu1', 'Bash', {'command': 'atticus --show "Notepad"'}, 'Opening Notepad')
        snap = ts.last_state()
        self.assertEqual(snap['task']['status'], 'FAILED')
        self.assertEqual(snap['workers']['carol']['state'], 'FAILED')

    def test_permission_wait_and_resume(self):
        t, out = tracker()
        t.start(); t.step_start('tu1', 'Bash', {'command': 'rm x'}, 'Working on it')
        t.waiting('Delete something?')
        self.assertEqual((out[-1]['status'], out[-1]['workers']['carol']['state']), ('WAITING', 'WAITING'))
        t.resumed()
        self.assertEqual((out[-1]['status'], out[-1]['workers']['carol']['state']), ('RUNNING', 'WORKING'))


class RunFallbackTests(unittest.TestCase):
    def setUp(self):
        p = patch.object(atticus, 'pref', side_effect=lambda k, d: d)
        p.start()
        self.addCleanup(p.stop)

    def proc(self, rows, rc=0, err=''):
        p = Mock()
        p.stdin = io.StringIO(); p.stdout = [json.dumps(r) + '\n' for r in rows]
        p.ask = ''; p.returncode = rc; p.errors = io.StringIO(err); p.model = 'haiku'
        return p

    def test_retired_model_before_any_action_falls_back_as_text_only(self):
        rows = [{'type': 'result', 'is_error': True, 'result': "There's an issue with the selected model (claude-3-5-haiku). It may not exist"}]
        def fb(task, why):
            atticus.run.ok = True; atticus.run.text_only = True
            return 'Dhaka.', 0, ['text']
        with patch.object(atticus, 'text_only', side_effect=fb) as f:
            reply, _, _ = atticus.run('q', self.proc(rows))
        self.assertEqual(f.call_args.args[1], 'model_unavailable')
        self.assertEqual(reply, 'Dhaka.')
        self.assertTrue(atticus.run.text_only)

    def test_no_fallback_after_an_action_already_ran(self):
        rows = [{'type': 'assistant', 'message': {'content': [{'type': 'tool_use', 'id': 't1', 'name': 'Bash', 'input': {'command': 'atticus --show "Notepad"'}}]}},
                {'type': 'user', 'message': {'content': [{'type': 'tool_result', 'tool_use_id': 't1', 'content': 'opened'}]}}]   # then the stream died
        with patch.object(atticus, 'text_only') as f:
            reply, _, _ = atticus.run('q', self.proc(rows, rc=1, err='crash'))
        f.assert_not_called()   # a half-done action is never "completed" by another model
        self.assertFalse(atticus.run.ok)

    def test_a_dont_allow_is_final_and_said_plainly(self):
        rows = [{'type': 'assistant', 'message': {'content': [{'type': 'tool_use', 'id': 't1', 'name': 'Bash', 'input': {'command': 'atticus --trash ~/Desktop/x.txt'}}]}},
                {'type': 'user', 'message': {'content': [{'type': 'tool_result', 'tool_use_id': 't1', 'is_error': True,
                                                          'content': 'PreToolUse:Bash hook error: The user said no. Do not try another way; say it was not done.'}]}},
                {'type': 'result', 'result': 'I could not delete it.'}]
        with patch.object(atticus, 'text_only') as f:
            reply, _, _ = atticus.run('q', self.proc(rows))
        f.assert_not_called()
        self.assertTrue(atticus.run.denied)
        self.assertFalse(atticus.run.ok)
        self.assertIn("Don't Allow", reply)

    def test_error_kinds(self):
        self.assertEqual(atticus.claude_error_type("You've hit your limit · resets 5pm"), 'quota_exhausted')
        self.assertEqual(atticus.claude_error_type('API Error: 429 rate limit'), 'rate_limited')
        self.assertEqual(atticus.claude_error_type('There\'s an issue with the selected model (x). It may not exist'), 'model_unavailable')
        self.assertEqual(atticus.claude_error_type('Not logged in · Please run /login'), 'auth_error')
        self.assertEqual(atticus.claude_error_type('', 3), 'exit_code_3')

    def test_text_only_answer_to_an_action_is_partial(self):
        self.assertTrue(atticus.ACTION_WORDS.search('Open YouTube in Chrome'))
        self.assertTrue(atticus.ACTION_WORDS.search('ক্যালকুলেটর খোলো'))
        self.assertTrue(atticus.ACTION_WORDS.search('chrome kholo'))
        self.assertFalse(atticus.ACTION_WORDS.search('Bangladesh er rajdhani ki?'))


class SettingsReadTests(unittest.TestCase):
    def test_bom_does_not_drop_settings(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, 'settings.json')
            open(p, 'w', encoding='utf-8-sig').write('{"model": "sonnet", "aiMode": "local"}')   # what PowerShell 5.1 writes
            with patch.object(atticus, 'PREFS', p):
                self.assertEqual(atticus.pref('model', 'haiku'), 'sonnet')


class RouterTests(unittest.TestCase):
    def test_modes_and_order(self):
        r = R.ModelRouter()
        with patch('multi_ai.model_catalog.ollama_pick', return_value=['qwen3:8b', 'qwen3-vl:8b']), \
             patch.object(R.ModelRouter, '_cloud', return_value=[('gemini', 'g-new'), ('gemini', 'g-old')]), \
             patch.object(r.adapters['lm_studio'], 'is_available', return_value=False):
            self.assertEqual(r.candidates({'aiMode': 'local'}), [('ollama', 'qwen3:8b'), ('ollama', 'qwen3-vl:8b')])
            self.assertEqual(r.candidates({'aiMode': 'local_only'}), r.candidates({'aiMode': 'local'}))   # the UI saves "local"
            self.assertEqual(r.candidates({'aiMode': 'cloud'})[0], ('gemini', 'g-new'))
            self.assertEqual(r.candidates({'aiMode': 'auto', 'aiFallbackOrder': 'gemini,ollama'})[0], ('gemini', 'g-new'))
            self.assertEqual(r.candidates({'aiMode': 'manual', 'activeModel': 'ollama/qwen3:8b', 'aiFallback': False}), [('ollama', 'qwen3:8b')])
            self.assertLessEqual(len(r.candidates({'aiMode': 'auto'})), R.MAX_ATTEMPTS)

    def test_no_retired_ids_in_code(self):
        root = Path(__file__).resolve().parents[1] / 'multi_ai'
        code = '\n'.join(p.read_text(encoding='utf-8') for p in root.rglob('*.py'))
        for bad in ("'claude-3-5-haiku'", '"claude-3-5-haiku"', '"gemini-2.0-flash"', "'gemini-2.0-flash'", '"claude-3-7-sonnet"'):
            self.assertNotIn(bad, code)


class OllamaTests(unittest.TestCase):
    def test_empty_answer_is_an_error_not_a_success(self):
        body = json.dumps({'message': {'role': 'assistant', 'content': '', 'thinking': 'x' * 900}, 'done_reason': 'stop'}).encode()
        resp = Mock(); resp.read.return_value = body
        resp.__enter__ = Mock(return_value=resp); resp.__exit__ = Mock(return_value=False)
        with patch('urllib.request.urlopen', return_value=resp) as u:
            r = OllamaAdapter().generate('qwen3-vl:8b', 'hi')
        self.assertFalse(r['success'])
        self.assertEqual(r['error_type'], 'empty_output')
        sent = json.loads(u.call_args.args[0].data)
        self.assertIs(sent['think'], False)   # reasoning off for text answers
        self.assertTrue(u.call_args.args[0].full_url.endswith('/api/chat'))


class BanglishTests(unittest.TestCase):
    def test_open_verbs(self):
        with patch.object(atticus, 'show', side_effect=lambda a: 'opened ' + a) as sh, patch.object(atticus, 'pref', side_effect=lambda k, d: d):
            for text, app in [('Chrome, browser, kolo.', 'chrome'), ('ক্যালকুলেটর খোলো', 'calc'), ('notepad kholo', 'notepad')]:
                self.assertTrue(atticus.fast(text))
                self.assertEqual(sh.call_args.args[0], app)
            sh.reset_mock()
            self.assertIsNone(atticus.fast('Chrome kholo and search youtube for lofi'))   # two steps: the AI does it
            sh.assert_not_called()

    def test_english_model_mishearing_of_kholo(self):
        """base.en transcribed real Bangla audio "ক্যালকুলেটর খোলো" as "calculator color." (Atticus.exe --transcribe)."""
        with patch.object(atticus, 'show', side_effect=lambda a: 'opened ' + a) as sh, patch.object(atticus, 'pref', side_effect=lambda k, d: d), \
             patch.object(atticus, 'skills', return_value={}):
            self.assertTrue(atticus.fast('calculator color.'))
            self.assertEqual(sh.call_args.args[0], 'calc')
            sh.reset_mock()
            for t in ('change chrome color', 'what color is the sky'):
                self.assertIsNone(atticus.fast(t))
            sh.assert_not_called()


if __name__ == '__main__':
    unittest.main()
