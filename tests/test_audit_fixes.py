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


class TelegramVoiceNote(unittest.TestCase):   # voice notes from the phone were answered with the help text: only text was read
    def test_ogg_opus_decodes_to_16k(self):
        try:
            import av
            import numpy as np
        except ImportError:
            self.skipTest('PyAV is only in the app venv')
        from multi_ai import voice_server
        path = _os.path.join(_tf.mkdtemp(), 'note.oga')
        with av.open(path, 'w', format='ogg') as o:
            st = o.add_stream('libopus', rate=48000)
            st.layout = 'mono'
            tone = (np.sin(np.arange(48000) * 2 * np.pi * 440 / 48000) * 8000).astype(np.int16)   # 1 s
            for i in range(0, len(tone), 960):
                f = av.AudioFrame.from_ndarray(tone[i:i + 960].reshape(1, -1), format='s16', layout='mono')
                f.sample_rate = 48000
                for p in st.encode(f):
                    o.mux(p)
            for p in st.encode(None):
                o.mux(p)
        a = voice_server.decode_file(path)
        self.assertEqual(a.dtype, np.float32)
        self.assertAlmostEqual(len(a) / 16000, 1.0, delta=0.1)
        self.assertGreater(float(abs(a).max()), 0.1)


class TelegramRound(unittest.TestCase):   # found by the user's own Telegram test (Oct 29)
    def test_failed_tool_reply_follows_the_language(self):
        self.assertTrue(atticus.localize('The last tool failed, so I could not verify that the request was completed. Please try again.', 'Notepad বন্ধ করো.').startswith('শেষ ধাপটা'))

    def test_no_retry_card_for_the_phone(self):
        old = {k: _os.environ.get(k) for k in ('ATTICUS_UI', 'OMA_SOURCE')}
        _os.environ.update(ATTICUS_UI='1', OMA_SOURCE='telegram')
        try:
            self.assertEqual(atticus.retry_offer(False), '')   # returns at once instead of waiting 60 s for a card nobody sees
        finally:
            for k, v in old.items():
                _os.environ.pop(k, None) if v is None else _os.environ.__setitem__(k, v)

    def test_cooler_is_a_misheard_open(self):
        self.assertIn('cooler', inspect.getsource(atticus.fast))

class GeminiVoiceQuota(unittest.TestCase):   # Gemini TTS: ~10 a day on the free tier; a resting model must not be asked again
    def test_all_resting_falls_back_at_once(self):
        import time
        from multi_ai import tts_server, providers
        real_key, real_blocked = providers.get_secret, dict(tts_server._blocked)
        providers.get_secret = lambda k: 'k'
        tts_server._blocked.update({m: time.time() + 3600 for m in tts_server.GEMINI_TTS})
        try:
            t0 = time.time()
            with self.assertRaises(LookupError):
                list(tts_server.gemini_stream('ঠিক আছে'))
            self.assertLess(time.time() - t0, 0.5)   # no network call at all
        finally:
            providers.get_secret = real_key
            tts_server._blocked.clear(); tts_server._blocked.update(real_blocked)


class InstantClose(unittest.TestCase):   # "close notepad" went to the AI: 10-26 s and an Allow card (Oct 29)
    def test_close_requests(self):
        for t, app in (('Notepad বন্ধ করো', 'Notepad'), ('notepad bondho koro', 'Notepad'), ('Notepad বন্দ করো করো.', 'Notepad'),
                       ('Close the calculator', 'Calculator'), ('volume bondho koro', None), ('chrome bondho koro', None)):
            m = atticus.CLOSE_RE.fullmatch(t)
            name = ' '.join((m.group(1) or m.group(2)).lower().split()) if m else ''
            self.assertEqual(atticus.CLOSE_APPS.get(name), app, t)
        self.assertEqual(atticus.localize('Closed Notepad.', 'নোটপ্যাড বন্ধ করো'), 'Notepad বন্ধ করে দিয়েছি।')


class LiveVoiceCards(unittest.TestCase):   # the user: "voice e permission chaile voice e dile kaj cholbe" (Oct 29)
    def test_spoken_answers_are_tools_and_guarded(self):
        from multi_ai import live_voice
        names = [f['name'] for f in live_voice.TOOLS[0]['functionDeclarations']]
        self.assertEqual(names, ['run_on_pc', 'answer_permission', 'answer_choice'])
        src = inspect.getsource(live_voice.run)
        self.assertIn('No question is waiting', src)   # Gemini once called answer_permission with no question asked

    def test_time_and_language_rules(self):
        from multi_ai import live_voice
        t = live_voice.system_text()
        self.assertIn("LAST words", t)
        self.assertIn('time, date, weather, news', t)


class CloudHearing(unittest.TestCase):   # Gemini free tier hung 20 s or gave 503 on some requests (Oct 29)
    def test_second_model_answers_when_the_first_hangs(self):
        try:
            import numpy as np
            import av  # noqa: F401
        except ImportError:
            self.skipTest('needs the app venv')
        import time
        from multi_ai import voice_server as vs, providers
        def fake(model, think, data, key):
            if model == vs.CLOUD_MODELS[0][0]:
                time.sleep(4)
                return 'late'
            return 'আজকে কী বার?'
        real, real_key = vs._ask_gemini, providers.get_secret
        vs._ask_gemini, providers.get_secret = fake, lambda k: 'k'
        try:
            t0 = time.time()
            text, why = vs.cloud_text(np.zeros(16000, dtype=np.float32))
        finally:
            vs._ask_gemini, providers.get_secret = real, real_key
        self.assertEqual(text, 'আজকে কী বার?')
        self.assertLess(time.time() - t0, vs.CLOUD_SECOND + 1)

    def test_gives_up_in_time(self):
        try:
            import numpy as np
            import av  # noqa: F401
        except ImportError:
            self.skipTest('needs the app venv')
        import time
        from multi_ai import voice_server as vs, providers
        def hang(model, think, data, key):
            time.sleep(8)
        real, real_key = vs._ask_gemini, providers.get_secret
        vs._ask_gemini, providers.get_secret = hang, lambda k: 'k'
        try:
            t0 = time.time()
            text, why = vs.cloud_text(np.zeros(16000, dtype=np.float32))
        finally:
            vs._ask_gemini, providers.get_secret = real, real_key
        self.assertIsNone(text)
        self.assertLess(time.time() - t0, vs.CLOUD_LIMIT + 0.5)

class BanglaVoiceHedging(unittest.TestCase):   # Edge's Bangla voice stalled up to 22 s on one request (measured Oct 29)
    def test_stuck_request_is_overtaken(self):
        import asyncio
        import time
        from multi_ai import tts_server
        calls = []

        async def fake(text, voice, started):
            calls.append(time.time())
            if len(calls) == 1:
                await asyncio.sleep(30)   # the stalled one
            return b'mp3'
        real = tts_server._one
        tts_server._one = fake
        try:
            t0 = time.time()
            data, tries = asyncio.run(tts_server.synth('ঠিক আছে', 'bn-BD-NabanitaNeural'))
        finally:
            tts_server._one = real
        self.assertEqual((data, tries), (b'mp3', 2))
        self.assertLess(time.time() - t0, 3)

    def test_all_failing_raises(self):
        import asyncio
        from multi_ai import tts_server

        async def broken(text, voice, started):
            raise RuntimeError('offline')
        real = tts_server._one
        tts_server._one = broken
        try:
            with self.assertRaises(RuntimeError):
                asyncio.run(tts_server.synth('ঠিক আছে', 'bn-BD-NabanitaNeural'))
        finally:
            tts_server._one = real


if __name__ == '__main__':
    unittest.main()
