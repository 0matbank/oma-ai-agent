"""
Instant PC commands that need no AI: volume, mute, media keys, screenshot, brightness, show desktop.
Bangla, Banglish and English, tolerant of common speech-to-text spellings. A request only matches when it is short and
is clearly one of these commands: questions ("volume keno kom?"), complaints and multi-step requests go to the AI.
Every result is read back from Windows before it is reported (volume level, the screenshot file, the brightness value).
"""
import os
import re
import subprocess
import time

UP = r'(?:barao|baraw|barau|bariye dao|bariye daw|barie dao|baran|baro|beshi koro|up|increase|raise|louder|বাড়াও|বাড়ান|বাড়িয়ে দাও|বাড়া)'
DOWN = r'(?:komao|komaw|kamao|komiye dao|komiye daw|komie dao|koman|kom koro|down|decrease|lower|quieter|কমাও|কমান|কমিয়ে দাও|কম করো)'
VOL = r'(?:volume|volum|valume|vol|sound|saund|awaj|awaz|aoyaj|shobdo|ভলিউম|সাউন্ড|আওয়াজ|শব্দ)'
NOT_A_COMMAND = re.compile(r'\b(keno|kno|why|how|kivabe|kemne|ki hoise|ki holo|naki)\b|কেন|কীভাবে|\?|\b(and|then|tarpor|tarpore|ar)\b|এবং|তারপর', re.I)
SHOT = r'(?:screen ?shot|screenshot|screen shot|ss|skrinshot|স্ক্রিনশট|স্ক্রিন শট)'
TAKE = r'(?:nao|naw|nen|nau|lo|take|capture|tolo|tulo|tolen|koro|daw|dao|নাও|নিন|তোলো|নাও তো)?'
# a level to reach ("to 50", "50 porjonto", "৫০-এ", "50 te"), not an amount to change by ("by 3%", "3% barao")
TARGET = re.compile(r'\bto\b|\bporjonto\b|পর্যন্ত|\d+\s*%?\s*-?(?:e|te|এ|তে|ey)\b|\b(?:set|koro|kor|করো|রাখো|rakho)\b', re.I)
BRIGHT = r'(?:brightness|brightnes|brite|alo|আলো|ব্রাইটনেস)'


def _norm(text):
    return ' '.join(re.sub(r'[,.!।]+', ' ', (text or '').lower()).split())


def match(text):
    """-> (action, arg) for a clear instant command, else None. Never guesses on questions or multi-step requests."""
    t = _norm(text)
    if not t or len(t.split()) > 7 or NOT_A_COMMAND.search(t):
        return None
    pct = re.search(r'(\d{1,3})\s*(?:%|percent|persent|parsent|শতাংশ)?', t)
    if re.search(VOL, t):
        if re.search(r'\b(un ?mute|unmute|sound on|awaj on|chalu)\b|আনমিউট|চালু', t):
            return ('unmute', None)
        if re.search(r'\bmute\b|মিউট|\b(bondho|bondo|off)\b|বন্ধ', t):
            return ('mute', None)
        n = max(0, min(100, int(pct.group(1)))) if pct else None
        if n is not None and not TARGET.search(t):   # "increase volume by 3%" set it TO 3% and the song went silent (Oct 29)
            if re.search(UP, t):
                return ('volume_up', n)
            if re.search(DOWN, t):
                return ('volume_down', n)
        if n is not None:
            return ('volume_set', n)
        if re.search(UP, t):
            return ('volume_up', 10)
        if re.search(DOWN, t):
            return ('volume_down', 10)
        return None
    if re.fullmatch(r'(?:mute|mute koro|mute kor|মিউট করো|মিউট)', t):
        return ('mute', None)
    if re.fullmatch(r'(?:unmute|unmute koro|আনমিউট করো|আনমিউট)', t):
        return ('unmute', None)
    if re.fullmatch(SHOT + r'\s*' + TAKE + r'(?:\s*(?:to|please|plz))?', t):
        return ('screenshot', None)
    if re.search(BRIGHT, t):
        n = max(0, min(100, int(pct.group(1)))) if pct else None
        if n is not None and not TARGET.search(t) and (re.search(UP, t) or re.search(DOWN, t)):
            return ('brightness_step', n if re.search(UP, t) else -n)
        if n is not None:
            return ('brightness_set', n)
        if re.search(UP, t):
            return ('brightness_step', +10)
        if re.search(DOWN, t):
            return ('brightness_step', -10)
        return None
    nxt = (r'(?:(?:next|porer|pore?r) ?(?:gan|gaan|song|track)?(?: dao| daw| chalao| koro)?|(?:next|পরের) ?(?:গান)?(?: দাও| চালাও)?'
           r'|(?:change the song|(?:gan|gaan|song|music)(?: ?ta)? (?:change|bodlao|bodlaw|bodla|next)(?: koro| kor| dao| daw)?|গান(?: ?টা)? (?:বদলাও|চেঞ্জ করো|পাল্টাও)))')
    if re.fullmatch(nxt + r'(?: ' + nxt + r')?', t):   # "gan ta change koro, porer gan dao" (Oct 29: went to the AI, 7 s)
        return ('media', 'next')
    if re.fullmatch(r'(?:previous|prev|ager|agher|age ?r) ?(?:gan|gaan|song|track)(?: dao| daw| chalao| koro)?|আগের গান', t):
        return ('media', 'previous')
    if re.fullmatch(r'(?:gan|gaan|music|song|গান) ?(?:pause|thamao|thamaw|resume)(?: koro)?|(?:pause|resume)(?: koro)?|গান থামাও', t):   # "gaan play koro" is a new song: the Oma player
        return ('media', 'playpause')
    if re.fullmatch(r'(?:show desktop|desktop dekhao|desktop dekhaw|sob window minimize koro|all windows minimize|ডেস্কটপ দেখাও)', t):
        return ('desktop', None)
    return None


def _endpoint():
    from pycaw.pycaw import AudioUtilities
    s = AudioUtilities.GetSpeakers()
    ev = getattr(s, 'EndpointVolume', None)
    if ev is None:   # older pycaw
        from ctypes import POINTER, cast
        from comtypes import CLSCTX_ALL
        from pycaw.pycaw import IAudioEndpointVolume
        ev = cast(s.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None), POINTER(IAudioEndpointVolume))
    return ev


def _level(ev):
    return round(ev.GetMasterVolumeLevelScalar() * 100)


def _brightness(set_to=None):
    ps = ('$b=Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop; ' +
          (f'(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{{Timeout=1;Brightness={set_to}}}) | Out-Null; '
           'Start-Sleep -Milliseconds 300; $b=Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness; ' if set_to is not None else '') +
          '$b.CurrentBrightness')
    r = subprocess.run(['powershell', '-NoProfile', '-Command', ps], capture_output=True, text=True, timeout=15,
                       creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    v = (r.stdout or '').strip().splitlines()
    return int(v[-1]) if v and v[-1].isdigit() else None


def run(action, arg, winctl=None):
    """Does it and reads the result back. -> (ok, reply in Bangla, evidence)."""
    if action in ('volume_up', 'volume_down', 'volume_set', 'mute', 'unmute'):
        ev = _endpoint()
        before = _level(ev)
        if action == 'mute':
            ev.SetMute(1, None)
            return (ev.GetMute() == 1), 'সাউন্ড মিউট করেছি।', f'muted (volume {before}%)'
        if action == 'unmute':
            ev.SetMute(0, None)
            return (ev.GetMute() == 0), f'সাউন্ড চালু করেছি ({before}%)।', f'unmuted at {before}%'
        target = arg if action == 'volume_set' else before + arg if action == 'volume_up' else before - arg
        target = max(0, min(100, target))
        if ev.GetMute() and action != 'volume_down':
            ev.SetMute(0, None)
        ev.SetMasterVolumeLevelScalar(target / 100, None)
        after = _level(ev)
        return abs(after - target) <= 1, f'ভলিউম {before}% থেকে {after}% করেছি।', f'volume {before}% -> {after}%'
    if action == 'screenshot':
        import mss
        folder = os.path.join(os.path.expanduser('~'), 'Pictures', 'Screenshots')
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, time.strftime('Oma-%Y%m%d-%H%M%S.png'))
        with mss.mss() as s:
            s.shot(mon=-1, output=path)   # every screen in one picture
        ok = os.path.exists(path) and os.path.getsize(path) > 1000
        return ok, f'স্ক্রিনশট নিয়েছি: {path}', f'{path} ({os.path.getsize(path) // 1024} KB)' if ok else 'no file'
    if action in ('brightness_set', 'brightness_step'):
        try:
            cur = _brightness()
        except Exception:
            cur = None
        if cur is None:
            return False, 'এই monitor-এর brightness Windows থেকে বদলানো যায় না (সাধারণত শুধু laptop-এর screen-এ যায়)। Monitor-এর নিজের বোতাম ব্যবহার করুন।', 'WmiMonitorBrightness not available'
        target = max(0, min(100, arg if action == 'brightness_set' else cur + arg))
        after = _brightness(target)
        return after is not None and abs(after - target) <= 5, f'Brightness {cur}% থেকে {after}% করেছি।', f'brightness {cur} -> {after}'
    if action == 'media':
        winctl.media(arg)
        return True, {'next': 'পরের গানে গেছি।', 'previous': 'আগের গানে গেছি।', 'playpause': 'Play/Pause চেপেছি।'}[arg], f'media key {arg}'
    if action == 'desktop':
        import ctypes
        ctypes.windll.user32.keybd_event(0x5B, 0, 0, 0); ctypes.windll.user32.keybd_event(0x44, 0, 0, 0)
        ctypes.windll.user32.keybd_event(0x44, 0, 2, 0); ctypes.windll.user32.keybd_event(0x5B, 0, 2, 0)
        return True, 'ডেস্কটপ দেখাচ্ছি।', 'Win+D'
    return False, '', 'unknown action'
