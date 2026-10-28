"""Eve, the YouTube worker: `atticus --int youtube <subcommand> ...` (the Atticus engine runs it, so every call is a
real, tracked tool step in the Oma window and passes through the safety gate).

Read-only by design. Oma never uploads, posts comments, likes, subscribes or changes a channel: it drafts and the
user publishes. Output is capped so a single call stays cheap in tokens."""
import contextlib
import io
import json
import os
import shlex
import sys
import tempfile

from . import discover, transcripts
from .guides import guide

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.join(HERE, 'skilltools')
VOICE = os.path.join(os.path.dirname(transcripts.CACHE), 'voice.md')
MAX_OUT = 4000

USAGE = ('search "<words>" [n] | meta <url|id> | transcript <url|id> [--summary] [--srt] | channel <@handle|url> [n] | '
         'outliers <@handle|url> [more channels...] | hook "<line>" [...] | title "<title>" [--thumb "<words>"] | '
         'chapters <file.srt|url> [target] | deadair <file> [floor] | retention <file.csv> [duration_s] [transcript] | '
         'guide <script|package|seo|audit|plan|shorts|chapters|edit|retention|viral|comment> | voice | voice-save "<profile>"')


def _tool(name, argv):
    """Run one vendored skill tool's own main() and return what it printed."""
    if TOOLS not in sys.path:
        sys.path.insert(0, TOOLS)
    import importlib
    mod = importlib.import_module(name)
    buf = io.StringIO()
    old = sys.argv
    sys.argv = [name + '.py'] + list(argv)
    try:
        with contextlib.redirect_stdout(buf):
            mod.main()
    except SystemExit:
        pass
    finally:
        sys.argv = old
    return buf.getvalue().strip()


def _srt_for(src):
    """A local transcript file, or a YouTube video's captions written to a temp .srt."""
    if os.path.exists(src):
        return src
    cues, _ = transcripts.fetch(src)
    path = os.path.join(tempfile.gettempdir(), f'oma-yt-{discover.video_id(src)}.srt')
    return transcripts.to_srt(cues, path)


def _cap(s):
    s = s or ''
    return s if len(s) <= MAX_OUT else s[:MAX_OUT] + f'\n... ({len(s) - MAX_OUT} more characters cut)'


def run(args):
    a = list(args)
    what = (a[0] if a else '').lower()
    rest = a[1:]
    try:
        if what == 'search' and rest:
            n = int(rest[1]) if len(rest) > 1 and rest[1].isdigit() else 8
            return _cap(discover.lines(discover.search(rest[0], n)))
        if what == 'meta' and rest:
            return _cap(discover.meta_text(discover.meta(rest[0])))
        if what == 'transcript' and rest:
            cues, lang = transcripts.fetch(rest[0])
            if '--srt' in rest:
                return _srt_for(rest[0])
            if '--summary' in rest:
                return _cap(transcripts.summary(cues, lang))
            return _cap(f'Transcript ({lang}, {len(cues)} captions):\n' + transcripts.text(cues))
        if what == 'channel' and rest:
            n = int(rest[1]) if len(rest) > 1 and rest[1].isdigit() else 30
            return _cap(discover.lines(discover.channel_videos(rest[0], n)))
        if what == 'outliers' and rest:
            rows = []
            for ch in rest:
                if not ch.startswith('--'):
                    rows += discover.channel_videos(ch, 30)
            path = os.path.join(tempfile.gettempdir(), 'oma-yt-collected.json')
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(rows, f, ensure_ascii=False)
            return _cap(f'{len(rows)} public videos collected.\n' + _tool('swipe', [path]))
        if what == 'hook' and rest:
            out = []
            for line in rest:
                out.append(_tool('hookscore', ['--hook', line]))
            return _cap('\n'.join(out))
        if what == 'title' and rest:
            argv = ['--title', rest[0]] + (['--thumb', rest[rest.index('--thumb') + 1]] if '--thumb' in rest and rest.index('--thumb') + 1 < len(rest) else [])
            return _cap(_tool('title', argv))
        if what == 'chapters' and rest:
            argv = [_srt_for(rest[0])] + (['--target', rest[1]] if len(rest) > 1 and rest[1].isdigit() else [])
            return _cap(_tool('chapters', argv))
        if what == 'deadair' and rest:
            argv = [_srt_for(rest[0])] + (['--floor', rest[1]] if len(rest) > 1 else [])
            return _cap(_tool('deadair', argv))
        if what == 'retention' and rest:
            argv = [rest[0]]
            if len(rest) > 1 and rest[1].isdigit():
                argv += ['--duration', rest[1]]
            if len(rest) > 2:
                argv += ['--transcript', _srt_for(rest[2])]
            return _cap(_tool('retention', argv))
        if what == 'guide':
            return guide(rest[0] if rest else '')
        if what == 'voice':
            try:
                return open(VOICE, encoding='utf-8').read()[:2000]
            except OSError:
                return 'No voice profile yet. Ask the user for 3 of their videos, read their transcripts, then save one with voice-save.'
        if what == 'voice-save' and rest:
            os.makedirs(os.path.dirname(VOICE), exist_ok=True)
            with open(VOICE, 'w', encoding='utf-8') as f:
                f.write(' '.join(rest)[:4000])
            return 'Voice profile saved.'
    except Exception as e:   # a plain reason, never a fake result
        msg = str(e).splitlines()[0][:300] if str(e) else type(e).__name__
        return f'Error: {what} failed: {msg}'
    return 'Usage: ' + USAGE


if __name__ == '__main__':
    print(run(sys.argv[1:]))
