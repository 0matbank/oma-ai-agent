"""
Bangla voice for Oma's spoken answers. Windows has no Bangla voice (only English David/Mark/Zira here), so an English
voice read only the English words of a Bangla answer. This uses Microsoft Edge's online neural voice (edge-tts).

Atticus.exe starts `atticus.py --tts-server` the first time it speaks Bangla and talks JSON lines over stdin/stdout:
  in : {"id": 1, "text": "ক্যালকুলেটর খুলে দিয়েছি।", "voice": "bn-BD-NabanitaNeural", "out": "<mp3 path>"}
       "parts": [...] instead of "text": made one by one into one recording; "out" ending in .ogg: an OGG/Opus voice note (Telegram)
  out: {"id": 1, "ok": true, "ms": 1840, "tries": 2}   or   {"id": 1, "ok": false, "error": "..."}
The text goes to Microsoft's speech service (the user allowed this on Oct 29, 2026); nothing else is sent.

Measured on this PC (Oct 29, 2026):
- Read back by Whisper, Edge's Bangla had the fewest errors (CER 0.14) against Gemini TTS (0.23-0.25; lite model 0.22-0.87).
  Gemini TTS also allows only 3 requests a minute on the free tier, and Gemini Live read-aloud changed 2 of 10 texts.
- One Edge request for a short sentence took 1.3 s to 22 s (the service stalls at times; the network connect is 0.3 s).
  A second request when the first has no result after 1.5 s, a third after 3 s, and taking whichever finishes first:
  median 2.8 s, max 6.1 s over 16 runs, none failed. A request whose audio is already coming is not doubled (a long
  sentence streams for several seconds); one that stops for 3 s in the middle is dropped and another one started.
The process ends itself after 10 idle minutes (about 40 MB); Atticus starts it again when needed.

Gemini's voice ("engine": "gemini"): the user listened to five samples and found only Gemini's (Leda) natural ("baki gola AI
AI mone hoy", Oct 29). Its free tier allows about 10 requests a day per model (gemini-3.8-flash-tts said
GenerateRequestsPerDayPerProjectPerModel-FreeTier 10) and 3 a minute; first audio came after 1.3 s. So one request per
answer, streamed as it comes (no "out": {"id", "pcm"} lines, then {"id", "ok"}); a model that answers 429 is skipped until
the time Google gives; with no model left the answer is {"ok": false, "fallback": true} and Atticus uses Edge.
"""
import asyncio
import base64
import json
import os
import sys
import threading
import time

HEDGE_AFTER = 1.5   # seconds with no audio from any request before one more parallel request (3 at most)
STALL = 3.0         # seconds without a new audio chunk: that request is stuck
DEADLINE = 15.0     # plus 0.05 s a character
IDLE_EXIT = 600


async def _one(text, voice, started):
    import edge_tts
    chunks = edge_tts.Communicate(text, voice).stream().__aiter__()
    data = bytearray()
    while True:
        try:
            ch = await asyncio.wait_for(chunks.__anext__(), STALL)
        except StopAsyncIteration:
            break
        if ch['type'] == 'audio':
            data += ch['data']
            started.set()
    if not data:
        raise RuntimeError('no audio')
    return bytes(data)


async def synth(text, voice):
    """-> (mp3 bytes, requests made). Raises when every try failed or the deadline passed."""
    flag = {}   # task -> set once its audio is coming

    def start():
        e = asyncio.Event()
        t = asyncio.ensure_future(_one(text, voice, e))
        flag[t] = e
        return t
    tasks, t0, err, tries = [start()], time.time(), None, 1
    deadline = DEADLINE + 0.05 * len(text)
    try:
        while time.time() - t0 < deadline:
            done, _ = await asyncio.wait(tasks, timeout=HEDGE_AFTER, return_when=asyncio.FIRST_COMPLETED)
            for t in done:
                if t.exception() is None:
                    return t.result(), tries
                err = t.exception()
            tasks = [t for t in tasks if not t.done()]
            if tries < 3 and not any(flag[t].is_set() for t in tasks):   # nothing is coming from the ones still open
                tasks.append(start())
                tries += 1
            elif not tasks:
                break
        raise RuntimeError(f'no voice after {tries} tries: {err or "timed out"}')
    finally:
        for t in tasks:
            t.cancel()


def to_ogg(mp3, path):
    """MP3 bytes -> an OGG/Opus file: Telegram shows only that as a voice note (an MP3 arrives as a music file)."""
    import io
    import av
    with av.open(io.BytesIO(mp3)) as src, av.open(path, 'w', format='ogg') as dst:
        st = dst.add_stream('libopus', rate=48000)
        st.layout = 'mono'
        rs = av.AudioResampler(format='s16', layout='mono', rate=48000, frame_size=960)   # Opus takes 20 ms frames
        for frame in src.decode(audio=0):
            for r in rs.resample(frame):
                for p in st.encode(r):
                    dst.mux(p)
        for r in rs.resample(None):
            for p in st.encode(r):
                dst.mux(p)
        for p in st.encode(None):
            dst.mux(p)


GEMINI_TTS = ['gemini-3.1-flash-tts-preview', 'gemini-3.8-flash-tts']
_blocked = {}   # model -> time it may be asked again (after a 429)


def gemini_stream(text, voice='Leda', first_timeout=6.0):
    """Yields 24 kHz 16-bit mono PCM pieces. Raises LookupError when no model can answer now (quota, error, too slow)."""
    import base64, urllib.error, urllib.request
    from multi_ai.providers import get_secret
    key = get_secret('ai_key_gemini')
    if not key:
        raise LookupError('no Gemini key')
    why = 'all models are resting (quota)'
    for m in GEMINI_TTS:
        if _blocked.get(m, 0) > time.time():
            continue
        say = ('Say warmly and naturally: ' + text) if '3.1' in m else text   # 3.1 obeys the style prefix (checked by Whisper); 3.8 read it out loud
        body = {'contents': [{'parts': [{'text': say}]}],   # a system instruction gave HTTP 400
                'generationConfig': {'responseModalities': ['AUDIO'], 'speechConfig': {'voiceConfig': {'prebuiltVoiceConfig': {'voiceName': voice}}}}}
        req = urllib.request.Request(f'https://generativelanguage.googleapis.com/v1beta/models/{m}:streamGenerateContent?alt=sse',
                                     json.dumps(body).encode(), {'x-goog-api-key': key, 'Content-Type': 'application/json'})
        try:
            r = urllib.request.urlopen(req, timeout=first_timeout)
        except urllib.error.HTTPError as e:
            why = f'{m}: HTTP {e.code}'
            if e.code == 429:
                try:
                    d = json.loads(e.read())
                    wait = max([int(str(x.get('retryDelay', '0s')).rstrip('s') or 0) for x in d['error'].get('details', []) if 'retryDelay' in x] or [3600])
                except Exception:
                    wait = 3600
                _blocked[m] = time.time() + max(60, wait)
            continue
        except Exception as e:
            why = f'{m}: {str(e)[:80]}'
            continue
        got = False
        with r:
            for line in r:
                line = line.decode('utf-8', 'replace').strip()
                if not line.startswith('data:'):
                    continue
                for c in json.loads(line[5:]).get('candidates', []):
                    for part in c.get('content', {}).get('parts', []):
                        if 'inlineData' in part:
                            got = True
                            yield base64.b64decode(part['inlineData']['data'])
        if got:
            return
        why = f'{m}: no audio'
    raise LookupError(why)


def pcm_to_ogg(pcm, path):
    """24 kHz 16-bit mono PCM -> OGG/Opus (a Telegram voice note)."""
    import av
    import numpy as np
    x = np.frombuffer(pcm, dtype=np.int16)
    with av.open(path, 'w', format='ogg') as dst:
        st = dst.add_stream('libopus', rate=48000)
        st.layout = 'mono'
        rs = av.AudioResampler(format='s16', layout='mono', rate=48000, frame_size=960)
        for i in range(0, len(x), 2400):
            f = av.AudioFrame.from_ndarray(x[i:i + 2400].reshape(1, -1), format='s16', layout='mono')
            f.sample_rate = 24000
            for r in rs.resample(f):
                for pk in st.encode(r):
                    dst.mux(pk)
        for r in rs.resample(None):
            for pk in st.encode(r):
                dst.mux(pk)
        for pk in st.encode(None):
            dst.mux(pk)


def serve():
    out = sys.stdout
    last = [time.time()]

    def watchdog():
        while True:
            time.sleep(30)
            if time.time() - last[0] > IDLE_EXIT:
                os._exit(0)
    threading.Thread(target=watchdog, daemon=True).start()
    out.write(json.dumps({'ready': True}) + '\n'); out.flush()
    for line in sys.stdin:
        last[0] = time.time()
        try:
            j = json.loads(line)
        except ValueError:
            continue
        t0 = time.time()
        if j.get('engine') == 'gemini':
            text = ' '.join(j.get('parts') or [j.get('text', '')])
            try:
                pcm, first = bytearray(), None
                for piece in gemini_stream(text, j.get('voice') or 'Leda'):
                    first = first or round((time.time() - t0) * 1000)
                    if j.get('out'):
                        pcm += piece
                    else:
                        out.write(json.dumps({'id': j.get('id'), 'pcm': base64.b64encode(piece).decode()}) + '\n'); out.flush()
                if j.get('out'):
                    pcm_to_ogg(bytes(pcm), j['out'])
                r = {'ok': True, 'engine': 'gemini', 'first_ms': first, 'ms': round((time.time() - t0) * 1000)}
            except Exception as e:
                r = {'ok': False, 'fallback': True, 'error': str(e)[:300], 'ms': round((time.time() - t0) * 1000)}
            last[0] = time.time()
            out.write(json.dumps({'id': j.get('id'), **r}) + '\n'); out.flush()
            continue
        try:
            data, tries = b'', 0
            for part in j.get('parts') or [j['text']]:   # MP3 frames join end to end
                d, n = asyncio.run(synth(part, j.get('voice') or 'bn-BD-NabanitaNeural'))
                data, tries = data + d, tries + n
            if j['out'].endswith('.ogg'):
                to_ogg(data, j['out'])
            else:
                with open(j['out'], 'wb') as f:
                    f.write(data)
            r = {'ok': True, 'ms': round((time.time() - t0) * 1000), 'tries': tries}
        except Exception as e:
            r = {'ok': False, 'error': str(e)[:300], 'ms': round((time.time() - t0) * 1000)}
        last[0] = time.time()
        out.write(json.dumps({'id': j.get('id'), **r}) + '\n'); out.flush()


if __name__ == '__main__':
    serve()
