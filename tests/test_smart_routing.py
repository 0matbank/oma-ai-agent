import os as _os, tempfile as _tf
_os.environ['ATTICUS_DIR'] = _os.environ.get('OMA_TEST_DIR') or _os.environ.setdefault('OMA_TEST_DIR', _tf.mkdtemp(prefix='oma-test-'))   # never the user's config
import os
import subprocess
import sys
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import atticus  # noqa: E402
from multi_ai import health_monitor as hm, instant, intent  # noqa: E402
import importlib  # noqa: E402
R = importlib.import_module('multi_ai.router')
from multi_ai.adapters import cli_agents  # noqa: E402


class Instant(unittest.TestCase):
    def test_clear_commands_match_in_three_languages(self):
        for text, want in [('volume barao', 'volume_up'), ('ভলিউম বাড়াও', 'volume_up'), ('volume komao', 'volume_down'),
                           ('volume 40%', 'volume_set'), ('mute koro', 'mute'), ('screenshot nao', 'screenshot'),
                           ('স্ক্রিনশট নাও', 'screenshot'), ('porer gaan', 'media'), ('desktop dekhao', 'desktop')]:
            self.assertEqual((instant.match(text) or ('',))[0], want, text)

    def test_questions_and_multi_step_never_act(self):
        for text in ('volume keno komse?', 'volume barao tarpor youtube kholo', 'screenshot ta kothay save hoy?',
                     'ami next week jabo', 'sound system kinbo', 'gaan play koro', 'brightness ki?'):
            self.assertIsNone(instant.match(text), text)


class Intent(unittest.TestCase):
    def test_routes(self):
        for text, want in [('hey kemon acho', 'chat'), ('photosynthesis ki explain koro', 'chat'), ('amake ekta choto golpo bolo', 'chat'),
                           ('aj dhaka weather kemon?', 'agent'), ('notepad e note lekho', 'agent'), ('youtube a gan bajao', 'agent'),
                           ('mone rakho ami coffee pochondo kori', 'agent'), ('amar code e error ashche fix koro', 'coding'),
                           ('https://example.com ta dekho', 'agent')]:
            self.assertEqual(intent.classify(text), want, text)
        self.assertEqual(intent.classify('hey', has_image=True), 'agent')


class ChatOrder(unittest.TestCase):
    def test_chat_is_cloud_first_and_ollama_last(self):
        r = R.ModelRouter()
        with patch.object(R.ModelRouter, '_cloud', return_value=[('gemini', 'g1')]), \
             patch.object(R.ModelRouter, '_clis', return_value=[('codex_cli', 'auto'), ('antigravity_cli', 'auto')]), \
             patch.object(R.ModelRouter, '_local', return_value=[('ollama', 'qwen3:8b')]):
            c = r.candidates({'aiMode': 'auto', 'model': 'haiku'}, purpose='chat')
            self.assertEqual(c, [('gemini', 'g1'), ('claude_code', 'haiku'), ('codex_cli', 'auto'), ('antigravity_cli', 'auto'), ('ollama', 'qwen3:8b')])
            with patch.object(hm, 'order', side_effect=lambda cands, s=None, t=False: (cands, [])):
                plan = r.plan({'aiMode': 'auto', 'model': 'haiku'}, purpose='chat')[0]
            self.assertEqual(len(plan), R.MAX_ATTEMPTS)
            self.assertEqual(plan[-1], ('ollama', 'qwen3:8b'))   # the cap never drops the local last resort

    def test_fast_chat_leaves_claude_to_the_warm_engine(self):
        with patch('multi_ai.router.router.plan', return_value=([('claude_code', 'haiku')], [], '')), \
             patch('multi_ai.router.router.execute') as ex:
            self.assertIsNone(atticus.fast_chat('hey'))
            ex.assert_not_called()

    def test_agent_hand_off(self):
        with patch('multi_ai.router.router.plan', return_value=([('gemini', 'g1')], [], '')), \
             patch('multi_ai.router.router.execute', return_value={'success': True, 'reply': intent.AGENT_TOKEN}):
            self.assertIsNone(atticus.fast_chat('what is on my screen'))


class CliAgents(unittest.TestCase):
    def test_error_kinds(self):
        self.assertEqual(cli_agents.classify('ACCOUNT_QUOTA: Insufficient Balance'), 'billing_required')
        self.assertEqual(cli_agents.classify('Not logged in. Run codex login'), 'auth_error')
        self.assertEqual(cli_agents.classify("You've hit your usage limit"), 'quota_exhausted')
        self.assertEqual(cli_agents.classify('invalid model selection: model x is not recognized'), 'model_unavailable')

    def test_tier_pick_from_live_list(self):
        with patch.dict(cli_agents._MODELS, {'antigravity_cli': (time.time(), ['claude-opus-4-6-thinking', 'gemini-3.8-flash-high', 'gemini-3.8-flash-low'])}):
            self.assertEqual(cli_agents.pick('antigravity_cli', 'fast'), 'gemini-3.8-flash-low')
            self.assertEqual(cli_agents.pick('antigravity_cli', 'power'), 'gemini-3.8-flash-high')

    def test_retired_model_retries_once_with_a_live_one(self):
        calls = []
        def fake(pid, prompt, model, schema, timeout):
            calls.append(model)
            if len(calls) == 1:
                raise cli_agents.CliError('model_unavailable', 'gone')
            return 'ok', {'reply': 'ok'}
        with patch.object(cli_agents, '_ask', side_effect=fake), patch.object(cli_agents, 'models') as m:
            self.assertEqual(cli_agents.ask('antigravity_cli', 'x', model='old-id')[1], {'reply': 'ok'})
        m.assert_called_once_with('antigravity_cli', refresh=True)
        self.assertEqual(calls, ['old-id', 'auto'])

    def test_timeout_is_classified(self):
        with patch('subprocess.run', side_effect=subprocess.TimeoutExpired('x', 1)):
            with self.assertRaises(cli_agents.CliError) as e:
                cli_agents._run(['x'], timeout=1)
        self.assertEqual(e.exception.kind, 'timeout')

    def test_billing_off_provider_is_never_a_candidate(self):
        with patch.object(cli_agents, 'exe', return_value='C:/x.exe'):
            self.assertNotIn('deepseek_cli', cli_agents.installed())


class SiteAsk(unittest.TestCase):
    def test_only_explicit_requests(self):
        self.assertEqual(atticus.site_ask_request('DeepSeek ke jiggesh koro Bangladesh er capital ki'), ('deepseek', 'Bangladesh er capital ki'))
        self.assertEqual(atticus.site_ask_request('Mars e pani ase? gemini ke jiggesh koro'), ('gemini', 'Mars e pani ase?'))
        for text in ('deepseek kholo', 'deepseek ki free?', 'gemini ke ekta message pathao'):
            self.assertIsNone(atticus.site_ask_request(text), text)

    def test_other_phrasings_and_own_pc(self):
        ask = atticus.site_ask_request
        self.assertEqual(ask('Deepseek use kora bolo ja akhon bangladesh ar stock market ar obostha ki'),
                         ('deepseek', 'akhon bangladesh ar stock market ar obostha ki'))
        self.assertEqual(ask('Gemini diye bolo to Mars e pani ase?'), ('gemini', 'Mars e pani ase?'))
        self.assertEqual(ask('Mars e pani ase? chatgpt diye bolo'), ('chatgpt', 'Mars e pani ase?'))
        self.assertEqual(ask('explain recursion using gemini'), ('gemini', 'explain recursion'))
        self.assertEqual(ask('ডিপসিক দিয়ে বলো যে বাংলাদেশের রাজধানী কী'), ('deepseek', 'বাংলাদেশের রাজধানী কী'))
        for text in ('pc ar status bolo with chatgpt', 'chatgpt use kore amar pc er status bolo'):   # needs Oma's own look first
            self.assertIsNone(ask(text), text)
        self.assertIn('--browser open <url> | read', atticus.SYSTEM)
        self.assertIn('ask deepseek|chatgpt|gemini', atticus.SYSTEM)


class ReplyLanguage(unittest.TestCase):
    def test_bangla_and_banglish_get_bangla_script(self):
        from multi_ai import intent
        for q in ('জাপানের রাজধানী কী?', 'japan er capital ki?', 'amk ekta joke bolo', 'kemon acho', 'browser ta keta diya abar open koro'):
            self.assertEqual(intent.reply_lang(q), 'bn', q)
            self.assertIn('Bangla script', intent.lang_rule(q))
            self.assertIn('Keep in English', intent.lang_rule(q))   # names and tech terms are not force-translated

    def test_english_stays_english(self):
        from multi_ai import intent
        for q in ('What is the capital of Japan?', 'open notepad', 'Explain how a browser works'):
            self.assertEqual(intent.reply_lang(q), 'en', q)
            self.assertEqual(intent.lang_rule(q), 'Reply language: English.')

if __name__ == '__main__':
    unittest.main()
