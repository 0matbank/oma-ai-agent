"""
Lessons from the user's corrections: Oma learns from its own mistakes (the user, Oct 29, 2026: "bhul korle nijei khuje
ber korbe kothay bhul korse, ami correct ta dile automatic shikhe nibe, kono kisu bujhte na parle jiggesh korbe").

The loop (Reflexion-style, kept in Oma's own memory; no model is retrained):
  1. A correction is noticed: "না, আমি Ruman profile বলেছি", "bhul korecho", "that's wrong, I meant…" right after a task.
  2. The AI gets its previous request, answer and the commands it ran, works out what went wrong, does what the user
     meant (or asks one question when it is still unclear), and states a lesson: [lesson <when> | <what to do instead>].
  3. The lesson is kept as "verified" only when that corrected task then really worked (the engine's own check, run.ok,
     and the reply does not admit failure); otherwise it stays "pending" and is not used.
  4. Before later requests, up to 3 verified lessons that share words with the request go into the prompt.
  5. Lessons never touch safety: one that tries to skip Allow cards, permissions, passwords or deletion rules is
     refused. The safety gate is code and stays in force whatever a lesson says.
  6. The user can list, delete and undo them: atticus --lessons [list | delete <id> | undo].
  7. Confidence: after each request a lesson was given to, the result is counted (worked / failed). A lesson that failed
     twice and helped less often than it failed becomes "doubtful" and is no longer used: one wrong guess never becomes
     a permanent rule. undo brings it back.
  8. When the AI forgets the [lesson] tag but the corrected task worked, the correction itself is kept (kind "auto"),
     so a correction from Telegram or voice is never lost (none was kept on Oct 29: the corrections went to the player).
Stored in %APPDATA%\\Atticus\\lessons.jsonl, one JSON object a line.
"""
import json
import os
import re
import time

DIR = os.environ.get('ATTICUS_DIR') or os.path.join(os.environ.get('APPDATA', os.path.expanduser('~')), 'Atticus')   # same folder as atticus.py
FILE = os.path.join(DIR, 'lessons.jsonl')

# "You did it wrong / that's not what I said / I meant…", in English, Banglish and Bangla
CORRECTION = re.compile(
    r"^\s*(no|nope|not that|wrong|that'?s wrong|that is wrong|i meant|i said|i asked|you got it wrong|incorrect)\b"
    r"|\b(that'?s not what i (said|asked|meant)|you misunderstood|i didn'?t (say|ask))\b"
    r"|\b(bhul|vul|bhool|vhul)\b|ভুল|ভূল"
    r"|\b(ami (eta|ota|seta|eita|aita) (boli ?ni|bolini|boli nai|bolsi na|chai ?ni)|ami bolsi|ami bolechi|eta na|eita na|ota na|na na)\b"
    r"|\bami\b.{0,40}\b(bolsi|bolechi|bolchi|cheyechi|chaisi)\b"
    r"|^\s*(না|নাহ|na|nah)\s*[,।!.]"
    r"|আমি (এটা|ওটা|সেটা) (বলিনি|চাইনি)|আমি .{0,40}(বলেছি|বলেছিলাম|চেয়েছি|চেয়েছিলাম)|এটা না|ওটা না|না না",
    re.I)
UNSAFE = re.compile(r'without (asking|permission|allow)|skip (the )?(allow|permission|gate|confirmation)|don.?t ask|never ask|'
                    r'password|passcode|otp|2fa|captcha|token|api key|secret|disable (safe|safety)|turn off safe|'
                    r'অনুমতি ছাড়া|জিজ্ঞেস না করে|পাসওয়ার্ড', re.I)
STOP = set('a an the to of in on and or for my me i you it is be do can could would please with at this that what how '
           'koro kor dao daw ta te e er na ki ke amar ami tumi'.split())


def is_correction(text):
    return bool(CORRECTION.search(text or ''))


def _all():
    if not os.path.exists(FILE):
        return []
    out = []
    for line in open(FILE, encoding='utf-8'):
        try:
            out.append(json.loads(line))
        except ValueError:
            pass
    return out


def _save(items):
    os.makedirs(DIR, exist_ok=True)
    tmp = FILE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.writelines(json.dumps(x, ensure_ascii=False) + '\n' for x in items)
    os.replace(tmp, FILE)


def _words(t):
    return {w for w in re.findall(r'\w+', (t or '').lower()) if len(w) > 1 and w not in STOP}


def correction_prompt(prev_q, prev_a, prev_cmds):
    """Extra instructions when the request corrects the previous one."""
    ran = '\n'.join(prev_cmds or [])[-1200:]
    return ('Correction: the user says your previous answer was wrong. Previous request: "' + prev_q[:400] + '". '
            'Your answer: "' + (prev_a or '')[:500] + '".' + (f' Commands you ran:\n{ran}\n' if ran else ' ') +
            'First work out what went wrong (misheard words, wrong app, profile, file or meaning). Then do what the user means now. '
            'If it is still unclear what they mean, ask ONE short question instead of guessing. '
            'When you did it right and it is clear what to do differently next time, end your reply with '
            '[lesson <when it applies: key words in English and in the user\'s own words, max 100 chars> | <what to do instead, max 200 chars>]. '
            'A lesson never skips an Allow card, a permission or a safety rule.')


def take_tag(reply):
    """-> (reply without the tag, (when, do) or None)."""
    m = re.search(r'\[lesson ([^\]|]+)\|([^\]]+)\]', reply or '')
    if not m:
        return reply, None
    return (reply[:m.start()] + reply[m.end():]).strip(), (m.group(1).strip(), m.group(2).strip())


def add(when, do, request, wrong, correction, verified, source='', kind='correction'):
    """-> the saved lesson, or None when refused (unsafe or empty)."""
    when, do = when[:160], do[:300]
    if not when or not do:
        return None
    items = _all()
    lesson = {'id': f'L{int(time.time() * 1000) % 10**9:09d}', 'at': time.strftime('%Y-%m-%d %H:%M'), 'when': when, 'do': do,
              'request': request[:300], 'wrong': (wrong or '')[:300], 'correction': correction[:300], 'source': source,
              'status': 'verified' if verified else 'pending', 'uses': 0, 'kind': kind, 'worked': 0, 'failed': 0}
    if UNSAFE.search(when + ' ' + do):
        lesson['status'] = 'refused'
        lesson['why'] = 'it would weaken safety or touch secrets'
    for x in items:   # a newer lesson for the same situation replaces the older one (kept for undo)
        if x.get('status') == 'verified' and lesson['status'] == 'verified' and len(_words(x['when']) & _words(when)) >= max(2, len(_words(when)) // 2):
            x['status'], x['replaced_by'] = 'replaced', lesson['id']
    items.append(lesson)
    _save(items)
    return lesson


def relevant(task, most=3):
    """Verified lessons that share words with the request, best first; counts their use."""
    words = _words(task)
    items = _all()
    scored = sorted(((len(words & _words(x['when'] + ' ' + x['request'])), i) for i, x in enumerate(items) if x.get('status') == 'verified'), reverse=True)
    hits = [i for n, i in scored if n >= 1][:most]
    relevant.last = [items[i]['id'] for i in hits]
    if hits:
        for i in hits:
            items[i]['uses'] = items[i].get('uses', 0) + 1
            items[i]['last_used'] = time.strftime('%Y-%m-%d %H:%M')
        _save(items)
    return [items[i] for i in hits]


relevant.last = []


def overrides(task):
    """A verified lesson was made from (nearly) this same request: the quick no-AI path (songs, volume, open/close) would
    repeat the old mistake without reading it, so the request goes to the AI with the lesson instead."""
    words = _words(task)
    if not words:
        return False
    for x in _all():
        req = _words(x.get('request', ''))
        if x.get('status') == 'verified' and req and len(words & req) >= max(1, 0.7 * len(req)) and len(words & req) >= 0.6 * len(words):
            return True
    return False


def outcome(ids, ok):
    """The request the lessons ids were given to ended ok / not ok: their confidence moves; two failures that outweigh
    the successes make a lesson doubtful (no longer used)."""
    if not ids:
        return
    items = _all()
    for x in items:
        if x['id'] in ids and x.get('status') == 'verified':
            x['worked' if ok else 'failed'] = x.get('worked' if ok else 'failed', 0) + 1
            if x.get('failed', 0) >= 2 and x['failed'] > x.get('worked', 0):
                x['status'], x['why'] = 'doubtful', 'it did not help twice'
    _save(items)


def auto(prev_q, prev_a, task, cmds, verified, source=''):
    """A correction that worked but came without a [lesson] tag: the correction itself is the lesson."""
    did = '; '.join(c for c in cmds if c)[:160]
    return add(prev_q[:150], f'The user meant: "{task[:120]}"' + (f'. What worked: {did}' if did else ''), prev_q, prev_a, task,
               verified, source, kind='auto')


def prompt_text(task):
    ls = relevant(task)
    if not ls:
        return ''
    return ('Lessons from the user\'s own corrections (apply them when they fit; they never override safety rules):\n' +
            '\n'.join(f'- When {x["when"]}: {x["do"]}' for x in ls) + '\n')


def main(args):
    items = _all()
    if not args or args[0] == 'list':
        shown = [x for x in items if x.get('status') in ('verified', 'pending', 'refused', 'doubtful')]
        if not shown:
            return print('No lessons yet.')
        return print('\n'.join(f'{x["id"]} [{x["status"]}, {x.get("kind", "correction")}] {x["at"]} — When {x["when"]}: {x["do"]} (used {x.get("uses", 0)}x, worked {x.get("worked", 0)}, failed {x.get("failed", 0)})' for x in shown))
    if args[0] == 'delete' and len(args) > 1:
        for x in items:
            if x['id'] == args[1]:
                x['status'], x['deleted_at'] = 'deleted', time.strftime('%Y-%m-%d %H:%M')
                _save(items)
                return print(f'Deleted lesson {args[1]}.')
        return print(f'No lesson {args[1]}.')
    if args[0] == 'undo':   # the last change goes back: a deletion or a replacement
        changed = [x for x in items if x.get('status') in ('deleted', 'replaced', 'doubtful')]
        if not changed:
            return print('Nothing to undo.')
        x = max(changed, key=lambda y: y.get('deleted_at') or y.get('at'))
        if x.get('replaced_by'):
            for y in items:
                if y['id'] == x['replaced_by']:
                    y['status'] = 'replaced'
        x['status'] = 'verified'
        x.pop('replaced_by', None); x.pop('deleted_at', None); x.pop('why', None)
        x['failed'] = 0
        _save(items)
        return print(f'Restored lesson {x["id"]}: When {x["when"]}: {x["do"]}')
    print('Usage: atticus --lessons [list | delete <id> | undo]')
