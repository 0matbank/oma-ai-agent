"""Regressions for the Oct 29 2026 audit repairs (offline: no models, no user settings)."""
import os as _os, tempfile as _tf
_os.environ['ATTICUS_DIR'] = _os.environ.get('OMA_TEST_DIR') or _os.environ.setdefault('OMA_TEST_DIR', _tf.mkdtemp(prefix='oma-test-'))
import inspect
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import atticus


class AnswerAdmitsFailure(unittest.TestCase):
    def test_code_in_a_correct_answer_is_not_a_failure(self):   # T-11CA13: "cannot divide by zero" inside the fix
        reply = ('The bug is in `divide`, which multiplies.\n```python\ndef divide(a, b):\n    if b == 0:\n'
                 '        raise ZeroDivisionError("cannot divide by zero")\n    return a / b\n```\nI didn\'t edit the file.')
        self.assertFalse(atticus.admits_failure(reply))

    def test_quoted_and_inline_code_are_not_the_model_speaking(self):
        self.assertFalse(atticus.admits_failure('The error says "could not connect" when the port is closed; fixed it.'))
        self.assertFalse(atticus.admits_failure('Rename `failed_jobs` to `jobs_failed`. Done.'))

    def test_real_failures_still_count(self):
        for r in ('Sorry, I could not open Calculator.', "I can't find that file.", 'I was unable to reach the site.',
                  'The download failed.', "It didn't work."):
            self.assertTrue(atticus.admits_failure(r), r)


class SlowCloudModels(unittest.TestCase):
    def test_probe_gives_up_quickly(self):
        from multi_ai import model_catalog
        self.assertLessEqual(inspect.signature(model_catalog.probe).parameters['timeout'].default, 15)

    def test_a_timed_out_model_rests_long_enough(self):
        from multi_ai import health_monitor
        self.assertGreaterEqual(health_monitor.ERRORS['timeout'][1], 600)


class TempFolders(unittest.TestCase):
    def test_tool_agent_removes_its_ask_folder(self):
        from multi_ai import tool_agent
        src = inspect.getsource(tool_agent.run_agent)
        self.assertIn("atexit.register(shutil.rmtree, ask, True)", src)


class Desktop(unittest.TestCase):
    def test_windows_are_seen(self):   # this test runs on the user's desktop, where at least this console or Oma is open
        import winctl
        self.assertIsInstance(winctl.windows(), list)


if __name__ == '__main__':
    unittest.main()
