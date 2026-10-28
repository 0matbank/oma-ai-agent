"""Public YouTube data through yt-dlp (no API key, no login, nothing downloaded): search, one video's metadata,
a channel's recent uploads. Output is compact text, one line per item, so it costs few tokens."""
import re

_ID = re.compile(r'(?:v=|youtu\.be/|shorts/|embed/|live/)([A-Za-z0-9_-]{11})')


def video_id(s):
    s = (s or '').strip()
    m = _ID.search(s)
    if m:
        return m.group(1)
    return s if re.fullmatch(r'[A-Za-z0-9_-]{11}', s) else ''


def _ydl(extra=None):
    import yt_dlp   # lazy: only YouTube requests pay for the import
    opts = {'quiet': True, 'no_warnings': True, 'skip_download': True, 'noplaylist': True,
            'js_runtimes': {'node': {}}, 'socket_timeout': 15}
    opts.update(extra or {})
    return yt_dlp.YoutubeDL(opts)


def _n(x):
    if x is None:
        return '?'
    x = float(x)
    for unit, d in (('B', 1e9), ('M', 1e6), ('K', 1e3)):
        if x >= d:
            return f'{x / d:.1f}{unit}'
    return str(int(x))


def _dur(s):
    if s is None or s == '':
        return '?'
    s = int(s)
    return f'{s // 3600}:{s % 3600 // 60:02d}:{s % 60:02d}' if s >= 3600 else f'{s // 60}:{s % 60:02d}'


def search(query, n=8):
    n = max(1, min(int(n), 20))
    with _ydl({'extract_flat': 'in_playlist'}) as y:
        info = y.extract_info(f'ytsearch{n}:{query}', download=False)
    rows = []
    for e in info.get('entries') or []:
        rows.append({'id': e.get('id'), 'title': e.get('title'), 'channel': e.get('channel') or e.get('uploader'),
                     'views': e.get('view_count'), 'duration': e.get('duration'), 'url': f"https://www.youtube.com/watch?v={e.get('id')}"})
    return rows


def meta(v):
    vid = video_id(v)
    if not vid:
        raise ValueError('not a YouTube video link or id')
    with _ydl() as y:
        i = y.extract_info(f'https://www.youtube.com/watch?v={vid}', download=False)
    return {'id': vid, 'title': i.get('title'), 'channel': i.get('channel') or i.get('uploader'), 'channel_url': i.get('channel_url'),
            'views': i.get('view_count'), 'likes': i.get('like_count'), 'comments': i.get('comment_count'), 'duration': i.get('duration'),
            'upload_date': i.get('upload_date'), 'tags': (i.get('tags') or [])[:15], 'description': (i.get('description') or '')[:300],
            'chapters': [(c.get('start_time'), c.get('title')) for c in (i.get('chapters') or [])][:20],
            'subtitles': sorted((i.get('subtitles') or {}).keys())[:12], 'auto_captions': 'en' in (i.get('automatic_captions') or {})}


def channel_videos(url, n=30):
    url = url.strip()
    if url.startswith('@'):
        url = 'https://www.youtube.com/' + url
    if '/videos' not in url and '/shorts' not in url and '/streams' not in url and ('youtube.com/@' in url or '/channel/' in url or '/c/' in url):
        url = url.rstrip('/') + '/videos'
    with _ydl({'extract_flat': 'in_playlist', 'playlistend': max(1, min(int(n), 60)), 'noplaylist': False}) as y:
        info = y.extract_info(url, download=False)
    ch = info.get('channel') or info.get('uploader') or info.get('title')
    return [{'channel': ch, 'title': e.get('title'), 'views': e.get('view_count'), 'duration': e.get('duration'),
             'url': f"https://www.youtube.com/watch?v={e.get('id')}"} for e in info.get('entries') or [] if e.get('id')]


def lines(rows):
    return '\n'.join(f"{r.get('title')} | {r.get('channel') or ''} | {_n(r.get('views'))} views | {_dur(r.get('duration'))} | {r.get('url')}" for r in rows) or 'nothing found'


def meta_text(m):
    out = [f"{m['title']} | {m['channel']} | {_n(m['views'])} views, {_n(m['likes'])} likes, {_n(m['comments'])} comments | "
           f"{_dur(m['duration'])} | uploaded {m['upload_date']}", f"Description: {m['description']}"]
    if m['tags']:
        out.append('Tags: ' + ', '.join(m['tags']))
    if m['chapters']:
        out.append('Chapters: ' + '; '.join(f'{_dur(t)} {c}' for t, c in m['chapters']))
    out.append(f"Captions: {', '.join(m['subtitles']) or 'none'}{' + auto English' if m['auto_captions'] else ''}")
    return '\n'.join(out)
