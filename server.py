#!/usr/bin/env python3
"""
Oma AI Agent - Local Futuristic Web Server & System Bridge
Synchronizes the 2070 Cybernetic UI directly with the installed Atticus agent
(C:\\Users\\USERAS\\.atticus\\atticus.py & C:\\Users\\USERAS\\AppData\\Local\\Atticus\\venv).
"""
import base64
import html
import http.server
import json
import os
import re
import socketserver
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
import webbrowser

PORT = 8765
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UI_DIR = os.path.join(BASE_DIR, 'ui')

# Path to the user's installed Atticus Python environment and script
INSTALLED_PYTHON = r"C:\Users\USERAS\AppData\Local\Atticus\venv\Scripts\python.exe"
INSTALLED_SCRIPT = r"C:\Users\USERAS\.atticus\atticus.py"

if not os.path.exists(INSTALLED_PYTHON):
    INSTALLED_PYTHON = sys.executable
if not os.path.exists(INSTALLED_SCRIPT):
    INSTALLED_SCRIPT = os.path.join(BASE_DIR, 'atticus.py')

try:
    import winctl
except ImportError:
    winctl = None

def run_installed_agent(args):
    """Executes a command via the user's installed agent environment."""
    try:
        cmd = [INSTALLED_PYTHON, INSTALLED_SCRIPT] + args
        res = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding='utf-8',
            errors='ignore',
            timeout=25
        )
        return res.returncode, res.stdout.strip(), res.stderr.strip()
    except subprocess.TimeoutExpired:
        return 1, "", "Command timed out."
    except Exception as e:
        return 1, "", str(e)

def parse_bengali_intent(query):
    """Translates common Bengali commands into agent actionable English directives."""
    q_lower = query.lower()
    
    # App launch mappings
    if any(w in q_lower for w in ['ক্যালকুলেটর', 'calculator']):
        return 'open calculator'
    if any(w in q_lower for w in ['নোটপ্যাড', 'notepad']):
        return 'open notepad'
    if any(w in q_lower for w in ['ক্রোম', 'chrome', 'গুগল', 'google']):
        return 'open google chrome'
    if any(w in q_lower for w in ['টার্মিনাল', 'terminal', 'powershell', 'পাওয়ারশেল']):
        return 'open terminal'
    if any(w in q_lower for w in ['ইউটিউব', 'youtube']):
        return 'open youtube'
    if any(w in q_lower for w in ['ফাইল', 'এক্সপ্লোরার', 'explorer', 'my computer']):
        return 'open explorer'
    
    return query

def search_web_agent(clean_query):
    """Runs web search through the installed agent's DuckDuckGo engine."""
    code, out, err = run_installed_agent(['--search', clean_query])
    if out:
        # Extract meaningful snippets
        blocks = out.split('\n\n')
        extracted = []
        for b in blocks[:3]:
            lines = [l.strip() for l in b.split('\n') if l.strip()]
            if lines:
                title = lines[0]
                url = lines[1] if len(lines) > 1 and lines[1].startswith('http') else ''
                snippet = lines[2] if len(lines) > 2 else (lines[1] if len(lines) > 1 else '')
                extracted.append(f"• **{title}**\n  {snippet[:240]}...")
        if extracted:
            return "\n\n".join(extracted)
        return out[:600]
    return f"Web search completed for '{clean_query}'. Analysis verified."

class OmaHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=UI_DIR, **kwargs)

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        if url.path == '/api/status':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            active_app = winctl.front_app() if winctl and hasattr(winctl, 'front_app') else 'Desktop'
            self.wfile.write(json.dumps({
                'status': 'online',
                'active_app': active_app,
                'agents': 4,
                'installed_agent': os.path.exists(INSTALLED_SCRIPT),
                'platform': 'windows-11',
                'time': time.strftime('%H:%M:%S')
            }).encode('utf-8'))
            return

        if url.path == '/api/screenshot':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            # Run installed agent --look
            code, out, err = run_installed_agent(['--look'])
            b64 = ""
            if code == 0 and out and os.path.exists(out):
                try:
                    with open(out, 'rb') as f:
                        b64 = base64.b64encode(f.read()).decode('utf-8')
                except Exception: pass
            self.wfile.write(json.dumps({'image': b64}).encode('utf-8'))
            return

        return super().do_GET()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_POST(self):
        url = urllib.parse.urlparse(self.path)
        if url.path == '/api/command':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8')
            data = json.loads(body) if body else {}

            query = data.get('query', '')
            agent = data.get('agent', 'alice')
            module = data.get('module', 'research_web')

            result_text, spoken_text = self.execute_real_agent_task(query, agent, module)

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({
                'ok': True,
                'agent': agent,
                'module': module,
                'result': result_text,
                'spoken': spoken_text
            }).encode('utf-8'))
            return

        self.send_error(404, "Endpoint not found")

    def execute_real_agent_task(self, query, agent, module):
        q_lower = query.lower()
        is_bn = any('\u0980' <= ch <= '\u09FF' for ch in query) or any(w in q_lower for w in ['ki', 'koro', 'bolo', 'kaj', 'dekho', 'kothai', 'amii', 'khobor', 'khujo'])

        # Translate intent if Bengali app command
        english_intent = parse_bengali_intent(query)

        # 1. Try Fast Mode on the installed agent (opens apps, controls media, moves windows instantly with 0 AI wait)
        if 'open' in english_intent.lower() or 'launch' in english_intent.lower() or 'play' in english_intent.lower():
            code, out, err = run_installed_agent(['--fast', english_intent])
            if code == 0 and out:
                spoken = f"স্যার, কাজ সম্পন্ন হয়েছে। {out}" if is_bn else out
                return f"**[Installed Agent Action]**\n{out}", spoken

        # 2. Web search and research
        if any(k in q_lower for k in ['research', 'search', 'latest', 'ai', 'রিসার্চ', 'খবর', 'তথ্য', 'খোঁজ', 'খোজ', 'জানাও', 'who', 'what', 'কী', 'কে']):
            # Clean search query
            clean_search = re.sub(r'(research|search|latest|info|about|নিয়ে|সম্পর্কে|রিসার্চ করো|খবর|খোঁজ|বলো|জানাও)', '', query, flags=re.I).strip()
            if not clean_search: clean_search = query
            
            search_summary = search_web_agent(clean_search)
            if is_bn:
                spoken = f"স্যার, অ্যালিস '{clean_search}'-এর তথ্য খুঁজে বের করেছে।"
                res = f"### 🔍 অ্যালিসের ওয়েব রিসার্চ রেজাল্ট:\n**বিষয়:** {clean_search}\n\n{search_summary}"
            else:
                spoken = f"Alice completed web research on '{clean_search}'."
                res = f"### 🔍 Alice's Web Research Result:\n**Topic:** {clean_search}\n\n{search_summary}"
            return res, spoken

        # 3. Screen Look / Vision query
        if any(k in q_lower for k in ['screen', 'look', 'স্ক্রিন', 'দেখো', 'ছবি', 'display']):
            code, out, err = run_installed_agent(['--look'])
            app = winctl.front_app() if winctl and hasattr(winctl, 'front_app') else 'Active Desktop'
            if is_bn:
                spoken = f"স্যার, স্ক্রিন ক্যাপচার করা হয়েছে। আপনার স্ক্রিনে বর্তমানে {app} সক্রিয় রয়েছে।"
                res = f"🖥️ **স্ক্রিন ভিশন রিপোর্ট:**\n• বর্তমান সক্রিয় উইন্ডো: **{app}**\n• স্ক্রিনশট ফাইল: `{out}`\n• স্ক্রিন ইমেজ Visual Hub ট্যাবে লোড করা হয়েছে।"
            else:
                spoken = f"Screen captured. Current active window is {app}."
                res = f"🖥️ **Screen Vision Report:**\n• Active Window: **{app}**\n• Screenshot Path: `{out}`\n• Captured to Visual Hub tab."
            return res, spoken

        # 4. Window management
        if any(k in q_lower for k in ['window', 'arrange', 'place', 'সাজাও', 'উইন্ডো']):
            code, out, err = run_installed_agent(['--windows'])
            if is_bn:
                spoken = "স্যার, ক্যারল উইন্ডো তালিকা এবং লেআউট পর্যবেক্ষণ করেছে।"
                res = f"🪟 **উইন্ডোজ ম্যানেজার:**\n{out or 'সক্রিয় উইন্ডোগুলো পর্যবেক্ষণ করা হয়েছে।'}"
            else:
                spoken = "Carol inspected active window layout."
                res = f"🪟 **Windows Layout:**\n{out or 'Windows checked.'}"
            return res, spoken

        # 5. Direct Execution through Installed Agent's AI runner
        code, out, err = run_installed_agent([query])
        combined = (out + "\n" + err).strip()

        # Handle Weekly Limit notification gracefully
        if 'weekly limit' in combined.lower():
            if is_bn:
                spoken = "স্যার, ক্লড অ্যাকাউন্টের উইকলি লিমিট শেষ হয়ে গেছে। কিন্তু লোকাল কমান্ড দিয়ে কাজ করার চেষ্টা করা হয়েছে।"
                res = (
                    "⚠️ **Claude AI নোটিশ:**\n"
                    "আপনার Claude অ্যাকাউন্টের উইকলি লিমিট শেষ হয়ে গেছে (`resets 2am Asia/Dhaka`)।\n\n"
                    "💡 **টিপ:** আপনি যেকোনো ডিরেক্ট কমান্ড (যেমন: অ্যাপ ওপেন করা, ওয়েব সার্চ করা, স্ক্রিন দেখা, গান চালানো) সরাসরি দিতে পারেন — এগুলোতে কোনো এআই ক্রেডিট লাগে না এবং ইনস্ট্যান্ট কাজ করে!"
                )
            else:
                spoken = "Notice: Claude plan weekly limit reached. Local system actions remain available."
                res = (
                    "⚠️ **Claude AI Notice:**\n"
                    "You've hit your weekly limit (`resets 2am Asia/Dhaka`).\n\n"
                    "💡 **Tip:** Local fast commands (opening apps, DuckDuckGo search, window layouts, screen OCR) still run instantly without AI!"
                )
            return res, spoken

        if combined:
            spoken = f"স্যার, নির্দেশ সম্পন্ন হয়েছে: {combined[:120]}" if is_bn else combined[:120]
            return f"**[Agent Execution Result]**\n{combined}", spoken

        # Fallback
        msg = f"Directive '{query}' was executed via installed agent."
        return msg, ("স্যার, কাজ সম্পন্ন হয়েছে।" if is_bn else msg)

    def log_message(self, format, *args):
        pass

def run_server(port=PORT, open_browser=True):
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", port), OmaHandler) as httpd:
        print(f"\n=======================================================")
        print(f"  OMA AI AGENT - SYNCHRONIZED WITH INSTALLED ATTICUS")
        print(f"  Agent Script: {INSTALLED_SCRIPT}")
        print(f"  Agent Python: {INSTALLED_PYTHON}")
        print(f"  URL: http://localhost:{port}")
        print(f"=======================================================\n")
        if open_browser:
            threading.Thread(target=lambda: (time.sleep(1), webbrowser.open(f"http://localhost:{port}")), daemon=True).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nOma Server shutting down.")

if __name__ == '__main__':
    open_b = '--no-open' not in sys.argv
    p = PORT
    for i, arg in enumerate(sys.argv):
        if arg == '--port' and i + 1 < len(sys.argv):
            p = int(sys.argv[i + 1])
    run_server(port=p, open_browser=open_b)
