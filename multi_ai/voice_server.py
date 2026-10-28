"""
Warm speech-to-text for Oma: faster-whisper (CTranslate2) large-v3-turbo on the GPU, kept loaded while Atticus.exe runs.

Atticus.exe starts `atticus.py --voice-server` once and talks JSON lines over stdin/stdout:
  in : {"id": 1, "pcm": "<file of float32 16 kHz mono samples>", "prompt": "app names...", "partial": false}
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


def transcribe(model, audio, allowed, prompt='', partial=False):
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
    for line in sys.stdin:
        try:
            j = json.loads(line)
        except ValueError:
            continue
        try:
            audio = np.fromfile(j['pcm'], dtype=np.float32)
            allowed = j.get('langs') or langs
            r = transcribe(model, audio, allowed, j.get('prompt', ''), bool(j.get('partial')))
        except Exception as e:
            r = {'text': '', 'error': str(e)[:300]}
        out.write(json.dumps({'id': j.get('id'), **r}, ensure_ascii=False) + '\n'); out.flush()


if __name__ == '__main__':
    serve()
