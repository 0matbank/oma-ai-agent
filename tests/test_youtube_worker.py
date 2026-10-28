"""Offline tests for Eve, the YouTube worker: no network (yt-dlp and the transcript API are never called here)."""
import os as _os, tempfile as _tf
_os.environ['ATTICUS_DIR'] = _os.environ.get('OMA_TEST_DIR') or _os.environ.setdefault('OMA_TEST_DIR', _tf.mkdtemp(prefix='oma-test-'))   # never the user's config
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import atticus   # sets up integrations.CONFIG
import integrations
from multi_ai.workers.youtube import cli, discover

SRT = """1
00:00:00,000 --> 00:00:04,000
So today we talk about thumbnails and titles for your channel

2
00:00:04,500 --> 00:00:09,000
um

3
00:00:15,000 --> 00:00:21,000
The first thing about thumbnails is contrast at feed size

4
00:01:10,000 --> 00:01:16,000
Now retention: why viewers leave in the first thirty seconds

5
00:02:30,000 --> 00:02:36,000
Finally upload rhythm and consistency every single week

6
00:03:10,000 --> 00:03:16,000
Comments are where your next video ideas come from

7
00:04:00,000 --> 00:04:06,000
Chapters must start at zero and be at least ten seconds

8
00:05:00,000 --> 00:05:06,000
That is the whole checklist, see you next week
"""


class YouTubeWorkerTests(unittest.TestCase):
    def test_video_ids(self):
        for s in ('https://www.youtube.com/watch?v=arj7oStGLkU&t=3', 'https://youtu.be/arj7oStGLkU', 'arj7oStGLkU',
                  'https://www.youtube.com/shorts/arj7oStGLkU'):
            self.assertEqual(discover.video_id(s), 'arj7oStGLkU')
        self.assertEqual(discover.video_id('not a video'), '')

    def test_skill_tools_run_offline(self):
        out = cli.run(['hook', 'You are wasting 3 hours a week on email, here is the 10 minute fix'])
        self.assertIn('VERDICT', out)
        out = cli.run(['title', 'The ULTIMATE guide to AMAZING productivity', '--thumb', 'productivity guide'])
        self.assertIn('duplicate', out)   # thumbnail repeats the title
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, 't.srt')
            open(p, 'w', encoding='utf-8').write(SRT)
            self.assertIn('0:00', cli.run(['chapters', p, '3']))
            self.assertTrue(cli.run(['deadair', p]))

    def test_guides_are_small_and_on_demand(self):
        g = cli.run(['guide', 'package'])
        self.assertIn('ship it, or change it?', g)
        self.assertLess(len(g), 1400)   # about 350 tokens at most, only when asked
        self.assertIn('Guides:', cli.run(['guide', 'nope']))

    def test_errors_are_plain_not_fake_results(self):
        with patch.object(discover, 'search', side_effect=RuntimeError('HTTP Error 429: Too Many Requests')):
            self.assertEqual(cli.run(['search', 'x']), 'Error: search failed: HTTP Error 429: Too Many Requests')
        self.assertTrue(cli.run(['upload', 'x']).startswith('Usage:'))   # no write actions exist

    def test_integration_needs_no_setup_and_is_word_gated(self):
        with tempfile.TemporaryDirectory() as d, patch.object(integrations, 'CONFIG', os.path.join(d, 'integrations.json')):
            self.assertIn('youtube', integrations.configured())
            self.assertIn('Eve', integrations.hints('find the best lofi video on YouTube', 'atticus --int'))
            self.assertEqual(integrations.hints('open notepad', 'atticus --int'), '')   # zero tokens for other requests

    def test_lane(self):
        import multi_ai.taskstate as ts
        self.assertEqual(ts.worker_for('Bash', {'command': 'atticus --int youtube transcript arj7oStGLkU --summary'}), 'eve')


if __name__ == '__main__':
    unittest.main()
