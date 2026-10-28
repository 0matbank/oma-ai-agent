"""YouTube: Eve, Oma's YouTube worker. Public search, video facts, transcripts, channel outliers, and creator tools
(hook score, title/thumbnail check, chapters, dead air, retention) with short craft guides.
No key or sign-in needed; read-only (Oma drafts, the user publishes). Logic lives in multi_ai/workers/youtube."""

TITLE = 'YouTube (Eve)'
ABOUT = 'Search YouTube, read a video\'s transcript, find what works in a niche, score hooks and titles, make chapters. Read-only.'
EXAMPLE = '@YourChannel'
KEY_HELP = 'No key needed: Eve reads public YouTube data only. Your channel handle is optional, for "audit my channel".'
KEY_PAGE = ''
FIELDS = [('handle', 'Your channel (@handle, optional)', False)]
KEY_OPTIONAL = True
NO_SETUP = True   # works without any key; listed as On unless the user turns it off
WORDS = r'\b(youtube|yt|youtuber|shorts?|subscribers?|thumbnails?|vlog|channel|video titles?|hooks?|retention|chapters)\b|youtu\.?be|ইউটিউব|চ্যানেল|থাম্বনেইল'
HELP = ('Eve, the YouTube worker: {CMD} search "<words>" | meta <url> | transcript <url> [--summary for long videos] | channel <@handle> | '
        'outliers <@handle>... | hook "<line>" | title "<t>" --thumb "<w>" | chapters <url|srt> | deadair <srt> | retention <csv> | '
        'guide <script|package|seo|audit|plan|shorts|chapters|edit|retention|viral|comment> (run the guide before writing). '
        'mine (the user\'s own channel, if saved). Read-only: never upload, post, like or subscribe.')
RISKY = {}


def run(cfg, args):
    from multi_ai.workers.youtube.cli import run as yt
    if args[:1] == ['mine']:
        h = (cfg or {}).get('handle', '').strip()
        return yt(['channel', h] + list(args[1:])) if h else 'No channel saved: Settings > Integrations > YouTube (Eve) > Your channel.'
    return yt(args)
