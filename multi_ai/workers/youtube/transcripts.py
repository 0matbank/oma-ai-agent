"""A video's transcript: youtube-transcript-api first (captions the creator or YouTube made), cached on disk.
`summary=True` condenses a long transcript with the local Ollama model first, so a long video does not cost the
cloud model thousands of tokens."""
import json
import os

from .discover import video_id

HOME = os.path.expanduser('~')
CACHE = os.path.join(os.environ.get('ATTICUS_DIR') or os.path.join(os.environ.get('APPDATA') or HOME, 'Atticus'), 'youtube', 'cache')


def _cache(vid):
    return os.path.join(CACHE, f'{vid}.json')


def fetch(v, langs=('en', 'bn', 'hi')):
    """-> [{'start': s, 'duration': s, 'text': str}], language. Raises with a plain reason when there are no captions."""
    vid = video_id(v)
    if not vid:
        raise ValueError('not a YouTube video link or id')
    try:
        with open(_cache(vid), encoding='utf-8') as f:
            d = json.load(f)
        return d['cues'], d['lang']
    except (OSError, ValueError, KeyError):
        pass
    from youtube_transcript_api import YouTubeTranscriptApi
    api = YouTubeTranscriptApi()
    tl = api.list(vid)
    try:
        t = tl.find_transcript(list(langs))
    except Exception:
        t = next(iter(tl))   # any language the video has
    fetched = t.fetch()
    cues = [{'start': round(s.start, 2), 'duration': round(s.duration, 2), 'text': s.text} for s in fetched]
    os.makedirs(CACHE, exist_ok=True)
    with open(_cache(vid), 'w', encoding='utf-8') as f:
        json.dump({'cues': cues, 'lang': t.language_code}, f, ensure_ascii=False)
    return cues, t.language_code


def text(cues, max_chars=6000, stamps=True):
    out, n = [], 0
    for c in cues:
        s = int(c['start'])
        line = (f'[{s // 60}:{s % 60:02d}] ' if stamps else '') + ' '.join(c['text'].split())
        n += len(line) + 1
        if n > max_chars:
            out.append(f'... (cut at {max_chars} characters; use --summary for the whole video)')
            break
        out.append(line)
    return '\n'.join(out)


def to_srt(cues, path):
    def ts(x):
        ms = int(round(x * 1000))
        return f'{ms // 3600000:02d}:{ms % 3600000 // 60000:02d}:{ms % 60000 // 1000:02d},{ms % 1000:03d}'
    with open(path, 'w', encoding='utf-8') as f:
        for i, c in enumerate(cues, 1):
            f.write(f"{i}\n{ts(c['start'])} --> {ts(c['start'] + c['duration'])}\n{c['text']}\n\n")
    return path


def summary(cues, lang):
    """Condense locally (Ollama); never invents: on failure it says so instead of returning a made-up summary."""
    from multi_ai.adapters.ollama import OllamaAdapter
    from multi_ai.model_catalog import ollama_pick
    models = ollama_pick()
    if not models:
        return 'Local summary unavailable: Ollama is not running. ' + text(cues, 3000)
    full = text(cues, 60000, stamps=True)
    parts = [full[i:i + 12000] for i in range(0, len(full), 12000)][:5]
    notes = []
    for p in parts:
        r = OllamaAdapter(timeout=180).generate(models[0], 'Summarize this part of a YouTube transcript in 5-8 bullet points. Keep the '
                                                           '[m:ss] timecode of each point. Only what is said; no opinions.\n\n' + p)
        if not r.get('success'):
            return f"Local summary failed ({r.get('error_type')}). First part of the transcript instead:\n" + text(cues, 3000)
        notes.append(r['reply'])
    return f'Summary by local {models[0]} of a {lang} transcript ({len(cues)} captions):\n' + '\n'.join(notes)
