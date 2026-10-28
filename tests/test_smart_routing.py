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


class BrowserSignIn(unittest.TestCase):
    def setUp(self):
        import tempfile
        from multi_ai import browser_worker as bw
        self.bw, self.dir = bw, tempfile.mkdtemp(prefix='oma-bw-')
        self.p = [patch.object(bw, k, os.path.join(self.dir, f)) for k, f in
                  (('SITES_FILE', 'sites.json'), ('STATUS_FILE', 'status.json'), ('ACCOUNTS', 'accounts.json'))]
        for p in self.p:
            p.start()

    def tearDown(self):
        for p in self.p:
            p.stop()

    def test_decide_from_what_the_page_shows(self):
        d = self.bw.decide
        self.assertEqual(d('gemini', {'url': 'https://www.google.com/sorry/index?continue=x'})[0], 'blocked')
        self.assertEqual(d('deepseek', {'url': 'https://chat.deepseek.com/sign_in'})[0], 'signed_out')
        self.assertEqual(d('gmail', {'url': 'https://accounts.google.com/v3/signin/identifier?x'})[0], 'signed_out')
        self.assertEqual(d('gmail', {'url': 'https://workspace.google.com/intl/en/gmail/'})[0], 'signed_out')
        self.assertEqual(d('gmail', {'url': 'https://mail.google.com/mail/u/0/#inbox'})[0], 'signed_in')
        self.assertEqual(d('chatgpt', {'url': 'https://chatgpt.com/', 'app': True, 'button': True})[0], 'signed_out')   # guest chat box
        self.assertEqual(d('chatgpt', {'url': 'https://chatgpt.com/', 'app': True})[0], 'signed_in')
        self.assertEqual(d('whatsapp', {'url': 'https://web.whatsapp.com/', 'out': True}), ('signed_out', 'WhatsApp shows the QR code to scan'))
        self.assertEqual(d('whatsapp', {'url': 'https://web.whatsapp.com/', 'app': True})[0], 'signed_in')
        self.assertEqual(d('facebook', {'url': 'https://www.facebook.com/', 'pass': True})[0], 'signed_out')
        self.assertEqual(d('facebook', {'url': 'https://www.facebook.com/', 'captcha': True})[0], 'blocked')
        self.assertEqual(d('whatsapp', {'url': 'https://web.whatsapp.com/'})[0], 'unknown')
        self.assertEqual(d('my-bank', {'url': 'https://bank.example/', 'ready': 'complete'})[0], 'unknown')

    def test_sites_accounts_and_own_sites(self):
        bw = self.bw
        self.assertEqual([s['id'] for s in bw.sites()], ['chatgpt', 'gemini', 'deepseek', 'gmail', 'whatsapp', 'facebook'])
        self.assertTrue(bw.set_account('gemini', 'not-an-email').startswith('Error'))
        self.assertTrue(bw.set_account('chatgpt', 'a@b.com').startswith('Error'))
        bw.set_account('gemini', 'pro.user@gmail.com')
        self.assertEqual(bw.signin_url('gemini'), 'https://gemini.google.com/app?authuser=pro.user@gmail.com')
        self.assertTrue(bw.signin_url('gemini', login=True).startswith('https://accounts.google.com/AccountChooser?continue=https%3A%2F%2Fgemini'))
        bw.set_account('gemini', '')
        self.assertEqual(bw.site_account('gemini'), '')
        self.assertTrue(bw.add_site('My Bank', 'http://bank.example').startswith('Error'))   # https only
        self.assertTrue(bw.add_site('Chat', 'https://chatgpt.com/x').startswith('Error'))     # a built-in's site
        self.assertEqual(bw.add_site('My Bank', 'https://bank.example/'), 'added My Bank')
        self.assertTrue(bw.add_site('my bank', 'https://other.example/').startswith('Error'))
        row = bw.sites()[-1]
        self.assertEqual((row['id'], row['custom'], row['state']), ('my-bank', True, ''))
        self.assertTrue(bw.remove_site('gmail').startswith('Error'))
        self.assertEqual(bw.remove_site('my-bank'), 'removed my-bank')
        self.assertEqual(bw.status(['nope']), [{'id': 'nope', 'state': 'unknown', 'detail': 'no such site'}])   # no browser needed

    def test_signout_all_deletes_only_omas_profile(self):
        bw, local = self.bw, os.path.join(self.dir, 'local')
        prof = os.path.join(local, 'Atticus', 'browser-profile')
        os.makedirs(os.path.join(prof, 'Default'))
        open(os.path.join(prof, 'Default', 'x'), 'w').close()
        open(bw.STATUS_FILE, 'w').write('{}')
        with patch.dict(os.environ, {'LOCALAPPDATA': local}), patch.object(bw, 'PROFILE', prof), \
             patch.object(bw, 'running', return_value=False), patch.object(bw, 'close_browser') as cb:
            self.assertIn('signed out', bw.signout_all())
            cb.assert_not_called()
        self.assertFalse(os.path.exists(prof))
        self.assertTrue(os.path.isdir(os.path.join(local, 'Atticus')))
        self.assertFalse(os.path.exists(bw.STATUS_FILE))
        other = os.path.join(self.dir, 'Chrome', 'User Data')   # never anything but Oma's own profile
        os.makedirs(other)
        for bad in (other, os.path.join(self.dir, 'browser-profile')):
            with patch.dict(os.environ, {'LOCALAPPDATA': local}), patch.object(bw, 'PROFILE', bad), patch.object(bw, 'running', return_value=False):
                self.assertTrue(bw.signout_all().startswith('Error'))
        self.assertTrue(os.path.isdir(other))

    def test_risky_asks_for_account_sites_and_signout(self):
        self.assertTrue(atticus.risky('atticus --browser signout-all'))
        for c in ('atticus --browser account gemini a@b.com', 'atticus --browser add-site "X" https://x.example', 'atticus --browser remove-site x'):
            self.assertTrue(atticus.risky(c), c)
        for c in ('atticus --browser sites', 'atticus --browser status', 'atticus --browser login gemini'):
            self.assertEqual(atticus.risky(c), '', c)


class HistoryAndCliLogin(unittest.TestCase):
    def test_history_list_newest_first(self):
        rows = [{'at': '2026-10-01 10:00:00', 'task': 'open notepad', 'reply': 'Opened Notepad.', 'secs': 0.5},
                {'at': '2026-10-02 10:00:00', 'task': 'x', 'reply': 'Error: no such app', 'secs': 1},
                {'at': '2026-10-03 10:00:00', 'reply': 'no task'},
                {'at': '2026-10-04 10:00:00', 'task': 'long', 'reply': 'y' * 900, 'secs': 'bad'}]
        h = atticus.history_list(rows)
        self.assertEqual([r['task'] for r in h], ['long', 'x', 'open notepad'])
        self.assertEqual((len(h[0]['reply']), h[0]['secs'], h[0]['ok']), (600, 0, True))
        self.assertFalse(h[1]['ok'])
        self.assertEqual(len(atticus.history_list(rows, 1)), 1)

    def test_cli_login_lines(self):
        self.assertEqual(atticus.cli_login_line('codex_cli', r'C:\npm\codex.CMD'), r'cmd.exe /k "title Oma sign-in & C:\npm\codex.CMD login"')
        self.assertEqual(atticus.cli_login_line('deepseek_cli', r'C:\My Tools\dsh.CMD'), r'cmd.exe /k "title Oma sign-in & "C:\My Tools\dsh.CMD" web"')
        self.assertTrue(atticus.cli_login_line('antigravity_cli', r'C:\agy\agy.EXE').endswith(r'& C:\agy\agy.EXE"'))
        self.assertTrue(atticus.cli_login('nope').startswith('Error'))
        with patch('multi_ai.adapters.cli_agents.exe', return_value=''):
            self.assertIn('not installed', atticus.cli_login('codex_cli'))


if __name__ == '__main__':
    unittest.main()
