"""
What kind of request is this? Decides the route BEFORE any model starts:
  chat    a conversation, question, translation or summary from what the user typed: a fast conversational cloud model,
          no coding CLI; the model may hand it back ([[AGENT]]) when it turns out to need the PC or live information
  coding  writing, fixing or explaining code and repositories: Claude Code -> Codex -> Antigravity (powerful model)
  agent   anything that acts on the PC, the screen, files, the web or needs current information: the Atticus engine
Conservative on purpose: when in doubt it is `agent`, which is the original Atticus path.
"""
import re

PC = re.compile(
    r'\b(open|launch|start|close|quit|click|type|press|play|pause|search|google|find|move|snap|send|delete|download|upload|install|'
    r'navigate|browse|write|save|record|screen|window|file|folder|app|setting|settings|tab|page|website|site|link|url|email|mail|'
    r'message|remind|reminder|note|alarm|timer|youtube|spotify|chrome|browser|edge|notepad|desktop|pc|computer|laptop|drive|'
    r'copy|paste|print|run|show|watch|look|see)\b|'
    r'খোল|খুল|চালু|বন্ধ|সার্চ|খুঁজ|খোঁজ|চালাও|টাইপ|ক্লিক|পাঠাও|ডাউনলোড|লেখো|সেভ|স্ক্রিন|ফাইল|ফোল্ডার|ইউটিউব|মনে করিয়ে|'
    r'\b(kholo|kolo|khulo|chalu|bondho|khojo|khujo|dekhao|pathao|lekho|chalao|bajao|thamao)\b', re.I)
LIVE = re.compile(
    r'\b(news|khobor|weather|abohawa|temperature|price|dam|rate|today|aj|ajke|ajker|tonight|tomorrow|kal|latest|current|currently|'
    r'now|ekhon|recent|score|result|stock|bitcoin|crypto|dollar|gold|update|2025|2026|2027|election|match)\b|'
    r'খবর|আবহাওয়া|দাম|আজ|এখন|সর্বশেষ|কাল|রেট', re.I)
CODING = re.compile(
    r'\b(code|coding|bug|debug|error|exception|traceback|stack ?trace|function|method|class|script|python|javascript|typescript|'
    r'node|react|java|kotlin|rust|golang|c\+\+|c#|html|css|sql|json|yaml|api|repo|repository|git|github|commit|compile|build|'
    r'refactor|unit test|regex|program|programming|algorithm|variable|loop|array)\b|কোড|প্রোগ্রাম|বাগ', re.I)
MEMORY = re.compile(r'\b(remember|forget|mone rakho|mone rekho|bhule jao|my name|amar nam|ami ke)\b|মনে রাখ|ভুলে যাও|আমার নাম', re.I)
URL = re.compile(r'https?://|www\.|\.(com|org|net|io|bd)\b', re.I)
AGENT_TOKEN = '[[AGENT]]'


def classify(text, has_image=False):
    t = ' '.join((text or '').split())
    if not t or has_image or URL.search(t) or MEMORY.search(t):
        return 'agent'
    if CODING.search(t):
        return 'coding'
    if len(t.split()) > 60 or PC.search(t) or LIVE.search(t):
        return 'agent'
    return 'chat'


BN_SCRIPT = re.compile(r'[ঀ-৿]')
BANGLISH = re.compile(
    r'\b(ami|amar|amake|amk|tumi|tomar|tomake|tmk|apni|apnar|ki|kii|keno|kno|kemon|kmn|koro|kore|korbo|korte|korsi|korchi|kor|'
    r'dao|daw|diba|dibo|bolo|bolen|bolte|bolba|ache|asa|ase|achhe|nai|naii|nei|hobe|hoba|hoy|hoise|hoisa|hossa|hocche|kothay|'
    r'kothai|kobe|keta|kivabe|kibhabe|ekta|akta|eta|aeita|aita|oita|sob|shob|ektu|akto|valo|bhalo|kharap|thik|kintu|tahole|'
    r'taila|jodi|jokhon|tokhon|tokon|niye|niya|diye|diya|theke|thaka|gula|gulo|shathe|sathe|bujhi|bujhlam|janao|jano|jani|'
    r'er|ke|ta|bangla|vai|bhai|apu|accha|acha|haan|hya|na|naki|abar|aber|ekhane|okhane|shuru|ses|shesh|uttor|'
    r'kholo|kolo|khulo|khulun|bondho|bondo|chalao|chalaw|chalan|bajao|bajaw|thamao|thamaw|barao|baraw|komao|komaw|kamao|'   # command verbs:
    r'naw|nao|dekhao|dekhaw|khojo|khujo|khuje|likho|lekho|pathao|pathaw|shono|shunao|sunao|koren|korun|e|te)\b', re.I)   # "notepad kholo"


def reply_lang(text):
    """'bn' when the user wrote Bangla script or Banglish (Bangla in English letters), else 'en'."""
    t = text or ''
    if BN_SCRIPT.search(t):
        return 'bn'
    words = re.findall(r'[a-z]+', t.lower())
    hits = len(BANGLISH.findall(t))
    # "player full screen koro": English words, a Banglish verb at the end -> Bangla (it got an English reply, Oct 29)
    ends = re.search(r'\b(koro|kor|koren|dao|daw|den|nao|naw|chalao|rakho|bolo|dekhao|sorao|kholo|bondho koro)\s*[.!?]*$', t.lower())
    return 'bn' if hits >= 2 or (hits and len(words) <= 3) or (hits and ends) else 'en'


def lang_rule(text):
    """One explicit line for this request, so every model answers in the right script."""
    if reply_lang(text) == 'bn':
        return ('Reply language: the user wrote Bangla/Banglish, so write your sentences in Bangla script (বাংলা অক্ষরে), '
                'never in Banglish. Keep in English, exactly as written: names of apps, sites, products, AI models, buttons '
                'and menus as they appear on screen, technical terms with no common Bangla word (e.g. browser, login, file, '
                'settings), code, commands, file paths, URLs, error messages and units. Do not force-translate or transliterate '
                'these; a natural professional Bangla sentence with English terms beats a wrong translation.')
    return 'Reply language: English.'


def chat_system(name='', facts=(), recent=(), task=''):
    """The fast chat model's instructions: Oma's voice, the user's language, and an honest hand-off when it cannot answer."""
    who = f"The user's name is {name}. " if name else ''
    known = ('What you know about the user: ' + '; '.join(facts[:8]) + '. ') if facts else ''
    earlier = ''.join(f'\nEarlier — user: {r["q"][:200]} / you: {r["a"][:200]}' for r in recent[-3:])
    return ("You are Oma, the user's personal AI assistant on their Windows PC. " + who + known +
            lang_rule(task) + " Warm and short: at most 4 sentences, "
            "plain text, no markdown. Never claim you did anything on the PC. "
            f"If answering needs current information (news, prices, weather, today's events), the user's screen or files, "
            f"or doing something on the PC, reply with exactly {AGENT_TOKEN} and nothing else." + earlier)
