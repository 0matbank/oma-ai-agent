"""
Real-time voice conversation with Oma through Gemini Live (the user's choice, Oct 29, 2026: "shudhu alada STT/TTS noy,
ekta sottikarer real-time voice assistant chai"). The microphone streams to Google and Gemini answers in its own voice;
anything that needs the PC goes back to Oma's own engine (run_on_pc), with its usual safety gate, Agent Town and log.

Atticus.exe starts `atticus.py --live-voice` for one conversation and talks JSON lines over stdin/stdout:
  in : {"a": "<base64 16 kHz 16-bit mono PCM, ~100 ms>"}   {"tool": {"id": "...", "result": "..."}}   {"end": true}
       {"ask": {"question": "...", "command": "..."}}   (Oma's Allow card)   {"pick": {"question": "...", "options": [...]}}
  out: {"ready": true} | {"error": "..."} | {"pcm": "<base64 24 kHz 16-bit mono PCM>"} | {"heard": "..."} | {"said": "..."}
       {"tool": {"id": "...", "request": "..."}} | {"answer": "y" | "n" | "<option index>" | ""} | {"interrupted": true}
       {"turn": true} | {"closed": "why"}
An Allow card or a "which one?" card during a run_on_pc is asked aloud too (the user: "permission voice and text 2tai
chaiba, voice e permission dile kaj cholbe"): the pending run_on_pc is answered with the question, Gemini asks it, and the
user's spoken answer comes back through answer_permission / answer_choice. The card on screen still works; the request's
result then arrives as a message, since its tool call was already answered.

Measured Oct 29, 2026 (gemini-3.1-flash-live-preview, the user's own 11 clips sent at microphone pace):
- end of speech -> first audio 0-1.0 s; every PC command became a correct run_on_pc request, in Bangla;
- without the clock it said a wrong time, and it answered an English question in Bangla after Bangla turns: the system
  text below gives it the time and the language rule, and time/date go through run_on_pc;
- 1 of 11 short clips got no answer at all.
"""
import asyncio
import base64
import json
import os
import re
import sys
import time

MODEL = os.environ.get('OMA_LIVE_MODEL') or 'gemini-3.1-flash-live-preview'
VOICE = os.environ.get('OMA_LIVE_VOICE') or 'Leda'   # the user picked this voice from five samples (Oct 29)
URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key='
BANGLISH = r'\b(ami|tumi|koro|kor|kore|dao|daw|ki|kemon|acho|bolo|chalao|kholo|bondho|gan|ekta|akta|amar|tomar|na|hobe|ache|nai|valo|bhalo)\b'   # Bangla in Latin letters
IDLE_END = 120  # s with nobody speaking: the conversation ends (Live time counts against the free quota)

TOOLS = [{'functionDeclarations': [{
    'name': 'run_on_pc',
    'description': ("Do something on the user's Windows PC, or look up live facts, and return what really happened: open or close apps "
                    "and windows, type, files, web search, YouTube and music, volume, brightness, settings, reminders, and the current "
                    "time, date, weather or news."),
    'parameters': {'type': 'OBJECT', 'properties': {'request': {'type': 'STRING', 'description': "The user's request, in their own words and language"}},
                   'required': ['request']}},
    {'name': 'answer_permission', 'description': "The user's spoken answer to a permission question that run_on_pc returned.",
     'parameters': {'type': 'OBJECT', 'properties': {'allow': {'type': 'BOOLEAN', 'description': 'true only when the user clearly said yes / allow'}}, 'required': ['allow']}},
    {'name': 'answer_choice', 'description': "The user's spoken choice for a 'which one?' question that run_on_pc returned.",
     'parameters': {'type': 'OBJECT', 'properties': {'option': {'type': 'INTEGER', 'description': 'The chosen option number (1 = first); 0 = none of them'}}, 'required': ['option']}}]}]


def system_text():
    now = time.strftime('%A %d %B %Y, %H:%M')
    return ("You are Oma, a warm, friendly voice assistant on the user's Windows PC in Bangladesh. "
            "Always answer in the language of the user's LAST words: Bangla (or Banglish) -> natural spoken Bangladeshi Bangla; English -> English. "
            "Speak briefly and naturally, like a friend. "
            "Greetings, chat, stories, jokes and general knowledge: answer yourself. Only actions on the PC or the web, and live "
            "facts (time, date, weather, news) -> call run_on_pc and wait for it. "
            "Then say what run_on_pc returned, briefly and truthfully: never say something was done unless it says so. "
            "When run_on_pc says permission or a choice is needed, ask the user that question aloud in their language, wait for "
            "their answer, then call answer_permission or answer_choice. Never answer it for them. "
            f"When this conversation started it was {now} on the user's PC.")


async def run():
    from multi_ai.providers import get_secret
    import websockets
    out = sys.stdout

    def emit(**k):
        out.write(json.dumps(k, ensure_ascii=False) + '\n')
        out.flush()
    key = get_secret('ai_key_gemini')
    if not key:
        return emit(error='No Gemini API key: add one in Settings → AI Providers.')
    try:
        ws = await websockets.connect(URL + key, max_size=None, open_timeout=15)
    except Exception as e:
        return emit(error='Could not reach Gemini Live: ' + str(e)[:200].replace(key, '…'))
    await ws.send(json.dumps({'setup': {
        'model': 'models/' + MODEL,
        'generationConfig': {'responseModalities': ['AUDIO'], 'speechConfig': {'voiceConfig': {'prebuiltVoiceConfig': {'voiceName': VOICE}}}},
        'systemInstruction': {'parts': [{'text': system_text()}]}, 'tools': TOOLS,
        'inputAudioTranscription': {}, 'outputAudioTranscription': {}}}))
    try:
        first = json.loads(await asyncio.wait_for(ws.recv(), 15))
    except Exception as e:
        return emit(error='Gemini Live did not start: ' + str(e)[:200])
    if 'setupComplete' not in first:
        return emit(error='Gemini Live refused the session: ' + json.dumps(first)[:300])
    emit(ready=True, model=MODEL, voice=VOICE)
    last_voice = [time.time()]
    pending = {}    # run_on_pc call id -> request, until answered
    early = set()   # run_on_pc calls answered early with a question: their result comes as a message
    spoke = ['']    # the language of the user's latest words: run_on_pc's result (English text) is to be said in it
    asking = [False]   # a card's question is out loud now: only then is a spoken answer passed on (Gemini once called answer_permission unasked)
    loop = asyncio.get_running_loop()
    lines = asyncio.Queue()

    def reader():   # stdin is blocking: a daemon thread hands lines to the loop (an executor thread would hold asyncio.run open)
        for line in sys.stdin:
            loop.call_soon_threadsafe(lines.put_nowait, line)
        loop.call_soon_threadsafe(lines.put_nowait, None)
    import threading
    threading.Thread(target=reader, daemon=True).start()

    async def upstream():
        while True:
            line = await lines.get()
            if line is None:
                return 'the app closed it'
            try:
                j = json.loads(line)
            except ValueError:
                continue
            if j.get('end'):
                return 'ended'
            if 'a' in j:
                await ws.send(json.dumps({'realtimeInput': {'audio': {'data': j['a'], 'mimeType': 'audio/pcm;rate=16000'}}}))
            elif 'tool' in j:
                t = j['tool']
                if t['id'] in early:   # the call was answered with a question already: tell the result as a message
                    early.discard(t['id'])
                    await ws.send(json.dumps({'clientContent': {'turns': [{'role': 'user', 'parts': [{'text':
                        f"[Result of the earlier PC request \"{pending.pop(t['id'], '')}\"] {t.get('result', '')}\nTell me briefly, in {spoke[0] or 'my language'}."}]}],
                        'turnComplete': True}}))
                else:
                    pending.pop(t['id'], None)
                    # "ami boli banglay, reply dey English-e" (Oct 29): the result is English text, so say which language to speak
                    say = {'say_it_in': 'Bangla', 'note': 'The user spoke Bangla: tell them this result in natural spoken Bangla, not in English.'} if spoke[0] == 'Bangla' else {}
                    await ws.send(json.dumps({'toolResponse': {'functionResponses': [{'id': t['id'], 'name': 'run_on_pc', 'response': {'result': t.get('result', ''), **say}}]}}))
                last_voice[0] = time.time()
            elif 'ask' in j or 'pick' in j:
                open_ids = [i for i in pending if i not in early]
                if not open_ids:
                    continue
                if 'ask' in j:
                    q = (f"PERMISSION NEEDED before doing this: {j['ask'].get('question', '')} ({j['ask'].get('command', '')[:200]}). "
                         "It is also on the screen. Ask the user aloud whether to allow it, then call answer_permission.")
                else:
                    opts = '; '.join(f'{n}) {o}' for n, o in enumerate(j['pick'].get('options', []), 1))
                    q = (f"CHOICE NEEDED: {j['pick'].get('question', '')} Options: {opts}. It is also on the screen. "
                         "Ask the user aloud which one, then call answer_choice.")
                early.add(open_ids[-1])
                asking[0] = True
                await ws.send(json.dumps({'toolResponse': {'functionResponses': [{'id': open_ids[-1], 'name': 'run_on_pc', 'response': {'result': q}}]}}))
                last_voice[0] = time.time()

    async def downstream():
        heard = said = ''
        async for raw in ws:
            m = json.loads(raw)
            if 'goAway' in m:
                return 'Gemini ended the session (time limit)'
            if 'toolCall' in m:
                for fc in m['toolCall'].get('functionCalls', []):
                    args, fid = fc.get('args') or {}, fc.get('id', '')
                    if fc.get('name') in ('answer_permission', 'answer_choice'):
                        if not asking[0]:
                            await ws.send(json.dumps({'toolResponse': {'functionResponses': [{'id': fid, 'name': fc['name'], 'response': {'result': 'No question is waiting: nothing was passed on.'}}]}}))
                            continue
                        asking[0] = False
                        if fc['name'] == 'answer_permission':
                            emit(answer='y' if args.get('allow') else 'n')
                        else:
                            n = int(args.get('option') or 0)
                            emit(answer=str(n - 1) if n > 0 else '')
                        await ws.send(json.dumps({'toolResponse': {'functionResponses': [{'id': fid, 'name': fc['name'], 'response': {'result': 'Passed on. The result will come as a message; say a few words meanwhile.'}}]}}))
                        continue
                    pending[fid] = args.get('request', '')
                    emit(tool={'id': fid, 'request': args.get('request', '')})
                continue
            sc = m.get('serverContent', {})
            if sc.get('inputTranscription', {}).get('text'):
                heard += sc['inputTranscription']['text']
                if re.search('[ऀ-৿]', heard):   # Bangla (or Bangla written in Devanagari letters)
                    spoke[0] = 'Bangla'
                elif re.search(BANGLISH, heard, re.I):
                    spoke[0] = 'Bangla'
                elif len(re.findall('[A-Za-z]', heard)) > 8:
                    spoke[0] = 'English'
                last_voice[0] = time.time()
            if sc.get('outputTranscription', {}).get('text'):
                said += sc['outputTranscription']['text']
            for p in sc.get('modelTurn', {}).get('parts', []):
                if 'inlineData' in p:
                    emit(pcm=p['inlineData']['data'])
            if sc.get('interrupted'):
                emit(interrupted=True)
            if sc.get('turnComplete') or sc.get('interrupted'):
                if heard.strip():   # Gemini writes spoken Bangla in Devanagari at times ("आज के की बार"): Bangla letters on screen
                    from multi_ai.voice_server import bangla_script
                    emit(heard=bangla_script(heard.strip()))
                if said.strip():
                    emit(said=said.strip())
                heard = said = ''
                emit(turn=True)
        return 'the connection closed'

    async def idle():
        while time.time() - last_voice[0] < IDLE_END:
            await asyncio.sleep(5)
        return f'nobody spoke for {IDLE_END // 60} minutes'

    tasks = [asyncio.ensure_future(c) for c in (upstream(), downstream(), idle())]
    done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    why = 'ended'
    for t in done:
        try:
            why = t.result() or why
        except Exception as e:
            why = 'error: ' + str(e)[:200]
    for t in pending:
        t.cancel()
    try:
        await ws.close()
    except Exception:
        pass
    emit(closed=why)


def serve():
    try:
        asyncio.run(run())
    finally:
        os._exit(0)   # the stdin reader thread would keep the process alive
