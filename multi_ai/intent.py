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


def chat_system(name='', facts=(), recent=()):
    """The fast chat model's instructions: Oma's voice, the user's language, and an honest hand-off when it cannot answer."""
    who = f"The user's name is {name}. " if name else ''
    known = ('What you know about the user: ' + '; '.join(facts[:8]) + '. ') if facts else ''
    earlier = ''.join(f'\nEarlier — user: {r["q"][:200]} / you: {r["a"][:200]}' for r in recent[-3:])
    return ("You are Oma, the user's personal AI assistant on their Windows PC. " + who + known +
            "Reply in the language and script the user wrote in (Bangla, Banglish or English), warm and short: at most 4 sentences, "
            "plain text, no markdown. Never claim you did anything on the PC. "
            f"If answering needs current information (news, prices, weather, today's events), the user's screen or files, "
            f"or doing something on the PC, reply with exactly {AGENT_TOKEN} and nothing else." + earlier)
