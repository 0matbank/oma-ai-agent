"""
Warm speech-to-text for Oma: faster-whisper (CTranslate2) large-v3-turbo on the GPU, kept loaded while Atticus.exe runs.

Atticus.exe starts `atticus.py --voice-server` once and talks JSON lines over stdin/stdout:
  in : {"id": 1, "pcm": "<file of float32 16 kHz mono samples>", "prompt": "app names...", "partial": false}
       or {"id": 2, "file": "<any audio file PyAV reads, e.g. a Telegram .oga voice note>"}
       "cloud": true -> a Bangla or mixed request's final words come from Gemini (cloud_text); out also has "local", "engine"
  out: {"id": 1, "text": "...", "lang": "bn", "lang_prob": 0.93, "ms": 412}
The first line out is {"ready": true, "device": "cuda", "compute": "float16", "load_ms": ..., "vram_mb": ...} or {"ready": false, "error": ...}.

Language: Whisper's free detection often calls Bangla speech Hindi or Urdu (Devanagari / Arabic output). Detection is
limited to the languages the user speaks (speechLanguages, default "bn,en"): the probabilities of close relatives are
added to Bangla (as, hi, ur), then the best allowed language is used for decoding. Banglish (Bangla with English words)
decodes as Bangla; clear English stays English.
VAD: Silero (built into faster-whisper) trims silence, so silence never becomes invented text.
VRAM: int8_float16 uses about 1.2 GB (float16 2.3 GB, same speed and accuracy here). Ollama keeps its own models;
nothing here unloads them.
"""
import json
import os
import re
import subprocess
import sys
import time

HOME = os.path.expanduser('~')
MODELS = os.path.join(os.environ.get('LOCALAPPDATA', HOME), 'Atticus', 'models', 'faster-whisper')
RELATIVES = {'bn': ('as', 'hi', 'ur', 'ne', 'or')}
VOCAB = 'ক্যালকুলেটর খোলো, নোটপ্যাড খোলো, ক্রোম খোলো, ইউটিউবে খোঁজো, বন্ধ করো. Open Chrome, YouTube, WhatsApp, Notepad.'   # one mixed prompt: measured better than per-language prompts (mean CER 0.389 vs 0.465)


def _cuda_dlls():
    """pip's nvidia-cublas-cu12 / nvidia-cudnn-cu12 put their DLLs in site-packages/nvidia/*/bin: CTranslate2 needs them on the DLL path."""
    try:
        import nvidia
        for base in getattr(nvidia, '__path__', []):
            for sub in os.listdir(base):
                b = os.path.join(base, sub, 'bin')
                if os.path.isdir(b):
                    os.add_dll_directory(b)
                    os.environ['PATH'] = b + os.pathsep + os.environ.get('PATH', '')
    except Exception:
        pass


def vram_free_mb():
    try:
        out = subprocess.run(['nvidia-smi', '--query-gpu=memory.free', '--format=csv,noheader,nounits'], capture_output=True, text=True,
                             timeout=5, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)).stdout
        return int(out.split()[0])
    except Exception:
        return None


def load(name='large-v3-turbo', device='auto'):
    _cuda_dlls()
    from faster_whisper import WhisperModel
    import ctranslate2
    t0 = time.time()
    cuda = device != 'cpu' and ctranslate2.get_cuda_device_count() > 0
    free = vram_free_mb() if cuda else None
    compute = (os.environ.get('OMA_FW_COMPUTE') or 'int8_float16') if cuda else 'int8'   # measured: same speed and accuracy as float16, half the VRAM (1.2 vs 2.3 GB)
    os.makedirs(MODELS, exist_ok=True)
    local = os.path.join(MODELS, name)   # a complete local copy (model.bin + json files) needs no network at all
    if os.path.exists(os.path.join(local, 'model.bin')):
        name = local
    model = WhisperModel(name,device='cuda' if cuda else 'cpu', compute_type=compute, download_root=MODELS,
                         cpu_threads=max(2, (os.cpu_count() or 4) - 2))
    import numpy as np
    list(model.transcribe(np.zeros(16000, dtype=np.float32), language='en', beam_size=1)[0])   # warm the kernels once
    info = {'ready': True, 'model': name, 'device': 'cuda' if cuda else 'cpu', 'compute': compute, 'load_ms': round((time.time() - t0) * 1000)}
    after = vram_free_mb() if cuda else None
    if free is not None and after is not None:
        info['vram_mb'] = free - after
    return model, info


def pick_language(model, audio, allowed):
    """-> (lang, prob, top3) among the allowed languages; relatives of Bangla count as Bangla."""
    pick_language.raw = {}
    if len(allowed) == 1:
        return allowed[0], 1.0, []
    _, _, probs = model.detect_language(audio)
    p = pick_language.raw = dict(probs)
    score = {lang: p.get(lang, 0) + sum(p.get(r, 0) for r in RELATIVES.get(lang, ())) for lang in allowed}
    best = max(score, key=score.get)
    total = sum(score.values()) or 1
    return best, round(score[best] / total, 3), sorted(probs, key=lambda x: -x[1])[:3]


EN_SURE = 0.9   # measured: clear English commands score 0.93-0.995; one- or two-word Bangla commands can score 0.7 English


def _decode(model, audio, lang, prompt, partial):
    segs, _ = model.transcribe(audio, language=lang, beam_size=1 if partial else 5, vad_filter=not partial,
                               vad_parameters={'min_silence_duration_ms': 300}, condition_on_previous_text=False,
                               without_timestamps=True, initial_prompt=(prompt + ' ' + VOCAB).strip()[-600:] or None,
                               temperature=0.0 if partial else (0.0, 0.2, 0.4))
    segs = list(segs)
    score = sum(s.avg_logprob for s in segs) / len(segs) if segs else -9
    return ' '.join(s.text.strip() for s in segs).strip(), score


def bangla_script(text):
    """Whisper writes some Bangla words in Devanagari ("एবার", "आসকে"; once a whole line, "आज के की बार"). Bangla never
    needs it, and the two blocks share one layout (U+0900 + 0x80 = U+0980), so each letter moves to its Bangla twin."""
    return ''.join(chr(ord(c) + 0x80) if 0x0900 <= ord(c) <= 0x097F and ord(c) not in (0x0964, 0x0965) else c for c in text)


# Two models with their own free-tier quotas; gemini-3.6-flash was the most exact (4.4% character errors, 2.1 s) but allows
# only 20 requests a day on the free tier and the chat needs them. (model, sends thinkingConfig)
CLOUD_MODELS = [(m, True) for m in (os.environ.get('OMA_CLOUD_STT_MODEL') or '').split(',') if m] or [('gemini-3.1-flash-lite', True), ('gemini-3.5-flash-lite', False)]
CLOUD_PROMPT = ('Transcribe this speech exactly as spoken. The speaker is from Bangladesh and speaks Bangla, Banglish or English. '
                'Write Bangla words in Bangla script, English words (app names like Notepad, Chrome, Google, YouTube) in English. '
                'Output only the transcript.')
CLOUD_SECOND = 2.5   # s without an answer before the second model is asked too
CLOUD_LIMIT = 5.0    # s in all; then Whisper's words are used (at worst 5 s more than local alone)
_pool = None


def _ogg(audio):
    """16 kHz float32 -> OGG/Opus bytes: 5-15 KB for a command instead of 80-200 KB of WAV."""
    import io
    import av
    import numpy as np
    b = io.BytesIO()
    with av.open(b, 'w', format='ogg') as o:
        st = o.add_stream('libopus', rate=16000)
        st.layout = 'mono'
        st.bit_rate = 24000
        x = (np.clip(audio, -1, 1) * 32767).astype(np.int16)
        x = np.pad(x, (0, -len(x) % 320))
        for i in range(0, len(x), 320):   # 20 ms frames
            f = av.AudioFrame.from_ndarray(x[i:i + 320].reshape(1, -1), format='s16', layout='mono')
            f.sample_rate = 16000
            for pk in st.encode(f):
                o.mux(pk)
        for pk in st.encode(None):
            o.mux(pk)
    return b.getvalue()


def _ask_gemini(model, think, data, key):
    import base64, urllib.request
    cfg = {'temperature': 0, **({'thinkingConfig': {'thinkingBudget': 0}} if think else {})}
    body = {'contents': [{'parts': [{'text': CLOUD_PROMPT}, {'inlineData': {'mimeType': 'audio/ogg', 'data': base64.b64encode(data).decode()}}]}],
            'generationConfig': cfg}
    req = urllib.request.Request(f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
                                 json.dumps(body).encode(), {'x-goog-api-key': key, 'Content-Type': 'application/json'})
    j = json.loads(urllib.request.urlopen(req, timeout=CLOUD_LIMIT).read())
    return ''.join(p.get('text', '') for p in j['candidates'][0]['content']['parts']).strip()


def cloud_text(audio):
    """The final words of a Bangla or mixed request from Gemini (the user turned on "voiceCloudStt"; the audio goes to Google).
    -> (text or None, why not). Measured Oct 29, 2026 on the user's own 11 clips: Gemini wrote them with 4-9% character
    errors against 17.9% for local large-v3-turbo, which turned 2 of them into loops ("কোলে কোলে কোলে…"); no decoding
    setting fixed that locally. The free-tier lite models took 2-6 s, and some requests hung 20 s or got 503: so a second
    model is asked after 2.5 s, and after 5 s in all Whisper's words are used."""
    from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
    try:
        from multi_ai.providers import get_secret
        key = get_secret('ai_key_gemini')
        if not key:
            return None, 'no Gemini key'
        data = _ogg(audio)
    except Exception as e:
        return None, str(e)[:120]
    t0, why = time.time(), ''
    ex = ThreadPoolExecutor(len(CLOUD_MODELS))
    try:
        jobs, asked = [ex.submit(_ask_gemini, *CLOUD_MODELS[0], data, key)], 1
        while time.time() - t0 < CLOUD_LIMIT:
            left = CLOUD_LIMIT - (time.time() - t0)
            done = wait(jobs, timeout=min(left, CLOUD_SECOND) if asked < len(CLOUD_MODELS) else left, return_when=FIRST_COMPLETED)[0] if jobs else set()
            for f in done:
                jobs.remove(f)
                try:
                    text = f.result()
                    if text:
                        return text, ''
                    why = 'empty answer'
                except Exception as e:
                    why = str(e)[:120]
            if asked < len(CLOUD_MODELS):   # slow or failed: ask the next model too
                jobs.append(ex.submit(_ask_gemini, *CLOUD_MODELS[asked], data, key))
                asked += 1
            elif not jobs:
                break
        return None, why or 'timed out'
    finally:
        ex.shutdown(wait=False, cancel_futures=True)


def transcribe(model, audio, allowed, prompt='', partial=False, cloud=False):
    fut = None
    if cloud and not partial and len(audio) > 8000 and not english_sure(model, audio, allowed):
        global _pool
        if _pool is None:
            from concurrent.futures import ThreadPoolExecutor
            _pool = ThreadPoolExecutor(1)
        t0 = time.time()
        fut = _pool.submit(cloud_text, audio)   # runs while Whisper decodes too
    r = _transcribe(model, audio, allowed, prompt, partial)
    if r.get('lang') == 'bn':
        r['text'] = bangla_script(r['text'])   # measured on the user's own voice: 3 of 8 Bangla clips had Devanagari letters
    if fut is not None:
        try:
            g, why = fut.result(timeout=CLOUD_LIMIT + 1)
        except Exception as e:
            g, why = None, str(e)[:120] or 'timed out'
        if g:
            r.update(local=r['text'], text=g, engine='gemini', lang='bn' if re.search('[\u0980-\u09ff]', g) else r.get('lang'))
        else:
            r['cloud_error'] = why
        r['cloud_ms'] = round((time.time() - t0) * 1000)
    return r


def english_sure(model, audio, allowed):
    """Clear English stays with Whisper (it was exact on every English clip, in 0.3 s)."""
    if 'en' not in allowed:
        return False
    if len(allowed) == 1:
        return True
    _, _, probs = model.detect_language(audio)
    return dict(probs).get('en', 0) >= EN_SURE


def _transcribe(model, audio, allowed, prompt='', partial=False):
    """Clear English -> English; clearly Bangla (or Hindi/Urdu, which Whisper confuses it with) -> Bangla;
    otherwise (short commands like "Notepad kholo") both are decoded and the more confident one wins."""
    t0 = time.time()
    lang, prob, top = pick_language(model, audio, allowed)
    if set(allowed) == {'bn', 'en'} and top:
        en = pick_language.raw.get('en', 0)   # Whisper's own English probability, not a share of {bn, en}
        if en >= EN_SURE:
            lang = 'en'
        elif en <= 0.3 or partial:
            lang = 'bn'
        else:
            (tb, sb), (te, se) = _decode(model, audio, 'bn', prompt, partial), _decode(model, audio, 'en', prompt, partial)
            lang, text = ('bn', tb) if sb >= se else ('en', te)
            return {'text': text, 'lang': lang, 'lang_prob': round(max(sb, se), 3), 'both': True,
                    'top': [[l, round(v, 3)] for l, v in top], 'ms': round((time.time() - t0) * 1000)}
    text, _ = _decode(model, audio, lang, prompt, partial)
    return {'text': text, 'lang': lang, 'lang_prob': prob, 'top': [[l, round(v, 3)] for l, v in top], 'ms': round((time.time() - t0) * 1000)}


def decode_file(path, limit_s=180):
    """A compressed recording (a Telegram voice note is OGG/Opus) -> float32 16 kHz mono. PyAV comes with faster-whisper;
    faster_whisper.decode_audio itself fails with the installed PyAV 19 (it passes the removed `metadata_errors`)."""
    import av
    import numpy as np
    out = []
    with av.open(path) as c:
        rs = av.AudioResampler(format='flt', layout='mono', rate=16000)
        for frame in c.decode(audio=0):
            for r in rs.resample(frame):
                out.append(r.to_ndarray().ravel())
            if frame.time and frame.time > limit_s:
                break
        for r in rs.resample(None):
            out.append(r.to_ndarray().ravel())
    return np.concatenate(out).astype(np.float32) if out else np.zeros(0, dtype=np.float32)


def serve():
    import numpy as np
    out = sys.stdout
    langs = [x.strip() for x in (os.environ.get('OMA_SPEECH_LANGS') or 'bn,en').split(',') if x.strip()]
    try:
        model, info = load(os.environ.get('OMA_FW_MODEL') or 'large-v3-turbo', os.environ.get('OMA_FW_DEVICE') or 'auto')
    except Exception as e:
        out.write(json.dumps({'ready': False, 'error': str(e)[:400]}) + '\n'); out.flush()
        return
    out.write(json.dumps({**info, 'langs': langs}) + '\n'); out.flush()
    if os.name == 'nt':   # loading leaves ~0.5 GB of one-time pages (file reads, CUDA init); hand them back now, not hours later
        try:
            import ctypes
            ctypes.windll.psapi.EmptyWorkingSet.argtypes = [ctypes.c_void_p]   # a 64-bit handle: the default int would cut -1 to 0xFFFFFFFF
            ctypes.windll.psapi.EmptyWorkingSet(ctypes.c_void_p(-1))   # -1 = this process
        except Exception:
            pass
    for line in sys.stdin:
        try:
            j = json.loads(line)
        except ValueError:
            continue
        try:
            if j.get('file'):
                audio = decode_file(j['file'])
            else:
                audio = np.fromfile(j['pcm'], dtype=np.float32)
            allowed = j.get('langs') or langs
            r = transcribe(model, audio, allowed, j.get('prompt', ''), bool(j.get('partial')), bool(j.get('cloud')))
        except Exception as e:
            r = {'text': '', 'error': str(e)[:300]}
        out.write(json.dumps({'id': j.get('id'), **r}, ensure_ascii=False) + '\n'); out.flush()


if __name__ == '__main__':
    serve()
