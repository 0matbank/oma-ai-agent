import os as _os, tempfile as _tf
_os.environ['ATTICUS_DIR'] = _os.environ.get('OMA_TEST_DIR') or _os.environ.setdefault('OMA_TEST_DIR', _tf.mkdtemp(prefix='oma-test-'))   # never the user's config
import json
import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import atticus  # noqa: E402
from multi_ai import world  # noqa: E402
from multi_ai.taskstate import worker_for  # noqa: E402

RSS = b"""<?xml version="1.0"?><rss><channel>
<item><title>Missile strike hits Kharkiv overnight</title><link>https://x/1</link><description>Ukraine says</description></item>
<item><title>Plus size fashion week opens</title><link>https://x/2</link><description>models</description></item>
</channel></rss>"""


class World(unittest.TestCase):
    def test_places_and_alerts(self):
        a, b = world.parse('T', RSS)
        self.assertEqual(a['place'], 'kharkiv')
        self.assertTrue(a['alert'])
        self.assertIsNone(b['lat'])   # 'plus' is not 'us'
        self.assertEqual(world.place('UK election')[0], 'uk')
        self.assertEqual(world.place("Ukraine's Kherson region")[0], 'ukrain')


class Skills(unittest.TestCase):
    def test_only_matching_skills_ride_along(self):
        sk = [{'name': 'Taka rate report', 'description': 'dollar rate and gold rate in Bangladesh', 'instructions': 'x'}]
        with patch.object(atticus, 'user_skills', return_value=sk):
            self.assertEqual(len(atticus.skills_for('aj dollar rate ar gold rate koto?')), 1)
            self.assertEqual(atticus.skills_for('open notepad'), [])


class Player(unittest.TestCase):
    def test_label_and_worker(self):
        c = 'atticus --player "lofi music"'
        self.assertEqual(atticus.label('Bash', {'command': c}), 'Playing in the Oma player: lofi music')
        self.assertEqual(worker_for('Bash', {'command': c}), 'eve')

    def test_player_hands_off_through_the_ask_folder(self):
        d = _tf.mkdtemp(prefix='atticus-ask-')
        with patch.dict(os.environ, {'ATTICUS_ASK': d}):
            open(os.path.join(d, 'a'), 'w').write('ok')   # the relay's answer
            out = atticus.player('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
        self.assertIn('Oma player', out)
        self.assertEqual(json.load(open(os.path.join(d, 'q')))['player']['id'], 'dQw4w9WgXcQ')


class Diagram(unittest.TestCase):
    def test_words(self):
        self.assertTrue(atticus.DIAGRAM_WORDS.search('Elon Musk er company gular ekta diagram banao'))
        self.assertFalse(atticus.DIAGRAM_WORDS.search('open notepad'))


if __name__ == '__main__':
    unittest.main()
