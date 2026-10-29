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


class PlayerSize(unittest.TestCase):   # the user's "player ta halka akto boro koro" (Oct 29) found no window: the player is a panel
    def test_size_words(self):
        cases = {'player ta halka akto boro koro': 'bigger', 'প্লেয়ারটা বড় করো': 'bigger', 'video choto koro': 'smaller',
                 'player full screen koro': 'full', 'player ager moto koro': 'normal', 'big video play koro': None, 'boro kore bolo': None}
        for t, want in cases.items():
            self.assertEqual(atticus.player_size_request(t), want, t)

    def test_player_bondho_stops(self):   # "player" holds "play": it used to look like a new song
        self.assertEqual(atticus.media_request('player bondho koro'), '<stop>')
        self.assertEqual(atticus.media_request('gan play koro'), 'bangla song')


class ReplyInRequestLanguage(unittest.TestCase):   # the user asked in Bangla and got "Opened calculator." (Oct 29)
    def test_bangla_and_banglish_get_bangla(self):
        self.assertEqual(atticus.localize('Opened calculator.', 'calculator খুলো.'), 'calculator খুলে দিয়েছি।')
        self.assertEqual(atticus.localize('Opened Notepad.', 'notepad kholo'), 'Notepad খুলে দিয়েছি।')

    def test_english_gets_english(self):
        self.assertEqual(atticus.localize('Opened calculator.', 'open calculator'), 'Opened calculator.')
        self.assertEqual(atticus.localize('সাউন্ড মিউট করেছি।', 'mute the sound'), 'Muted the sound.')
        self.assertEqual(atticus.localize('ভলিউম 30% থেকে 50% করেছি।', 'set the volume to 50'), 'Set the volume from 30% to 50%.')

    def test_english_sentences_stay_english(self):
        from multi_ai import intent
        for t in ('open notepad', 'What is the capital of Japan?', 'send an e-mail to john', 'close the window'):
            self.assertEqual(intent.reply_lang(t), 'en', t)


class ExpiredAllowCard(unittest.TestCase):   # an Allow card nobody answered was reported as "you chose Don't Allow" (Oct 29)
    def test_gate_tells_expiry_from_no(self):
        src = inspect.getsource(atticus.gate)
        self.assertIn('Nobody answered the Allow card', src)
        self.assertIn('answer is not None', src)

    def test_messages_follow_the_request_language(self):
        self.assertTrue(atticus.localize('Not done: nobody pressed Allow within 60 seconds, so nothing was changed.', 'নোটপ্যাড বন্ধ করো').startswith('করা হয়নি'))
        self.assertTrue(atticus.localize("Not done: you chose Don't Allow, so nothing was changed.", 'close notepad').startswith('Not done'))


if __name__ == '__main__':
    unittest.main()
