# Stonic AI থেকে Oma-তে কী নেওয়া যায়

উৎস:
- "Stonic How work-.mp4" (১১ মিনিট): ১৫০টা scene frame দেখা হয়েছে, আর পুরো narration transcribe করা হয়েছে।
- "Stonic ver.mp4" (৩০ সেকেন্ড)।
- stonicai.com এবং তার changelog।

Stonic closed-source, তাই GitHub-এ এর কোড নেই। নিচে যেখানে open-source উৎস আছে, সেটা উল্লেখ করা হয়েছে।

## Video-তে Stonic যেভাবে সাজানো

Stonic-এর সাজানো (v1.0.55) অনেকটা Oma-র মতোই:
- **বামে:** Media Link (webcam বা screen live), Sat-Link Feed (3D globe/2D map), আর Today Headlines।
- **মাঝে উপরে:** MEMORY / SKILLS / VOICES / SETTING node। এদের রঙিন cable গিয়ে particle orb-এ যুক্ত হয়েছে।
- **orb panel-এ:** "THINKING ●" chip, অবস্থার লেখা (CALIBRATING), আর START AI / TERMINATE বোতাম।
- **মাঝে নিচে:** Agent Town, যার তিনটা tab আছে: agents, visual hub, gesture।
- **ডানে:** VOICE / AGENT / NOTES tab, চ্যাট, আর প্রতিটি tool-এর জন্য আলাদা "Module: web_search 7.4s" chip।

## নেওয়ার তালিকা (গুরুত্ব অনুযায়ী)

| # | জিনিস | Stonic-এ কেমন | Oma-তে কীভাবে | অবস্থা |
|---|---|---|---|---|
| 1 | **Particle orb (face)** | Particle-এর গোলক, ভেতরে উজ্জ্বল core, হেলানো orbital ring আর তাতে একটা ঘূর্ণায়মান বিন্দু। অবস্থা অনুযায়ী রঙ বদলায়: ম্লান (standby), সোনালি (CALIBRATING), উজ্জ্বল (active)। | `previews/particle_orb.js`, পুরনো orb-এর একই API (setState/setAudioLevel), তাই সরাসরি বসানো যায়। | Preview তৈরি, অনুমোদনের অপেক্ষায় |
| 2 | **Theme switcher** | Stonic Default (teal), Hacker (green), Cyberpunk (magenta), Danger Red। | orb-এ ৪টা theme আছে। পুরো UI-তে CSS token দিয়ে করা যাবে। | Orb-এ হয়েছে, UI-তে বাকি |
| 3 | **Tool chip চ্যাটে** | প্রতিটি ধাপ "Module: generate_diagram 0.8s ›" আকারে আলাদা লাইনে, সময়সহ। | Oma-র task-state-এ ধাপ, সময় আর worker আগে থেকেই আছে। শুধু চ্যাটে chip দেখানো বাকি। | করা সহজ |
| 4 | **Agent Town-এ speech bubble আর task card** | কাজ পাওয়া agent-এর মাথায় "Hmm, let me think…" bubble, নিচে task card, ঘরে হেঁটে যাওয়া। | Agent Town preview-এ হাঁটা আর টাইপ করা আছে। bubble-এ আসল step label দেখানো যাবে, বানানো লেখা নয়। | পরের ধাপ |
| 5 | **"Visual hub" tab** | Agent Town-এর পাশে diagram বা chart দেখায় ("Elon Musk diagram"), sandbox-এ, internet ছাড়া। | Mermaid বা SVG দিয়ে একটা panel। | ভবিষ্যৎ |
| 6 | **Core Memory পাতা** | সব memory একটা তালিকায়, খোঁজা যায়। | Oma-তে memory আর notes আছে, একটা দেখার পাতা লাগবে। | ভবিষ্যৎ |
| 7 | **Skills dialog** | "New Skill": নাম, বিবরণ, নির্দেশনা। | Oma-র skills.json বা workflows-এর UI। | ভবিষ্যৎ |
| 8 | **World Monitor / globe** | worldmonitor.app embed করা (koala73/worldmonitor, open-source, AGPL-3.0)। | লাইসেন্সের কারণে কোড নয়, শুধু link বা iframe। | ঐচ্ছিক |
| 9 | **Gesture control** | Webcam-এ হাত দিয়ে mouse চালানো ("Iron Man control")। | MediaPipe Hands দিয়ে সম্ভব। Privacy আর CPU খরচ বেশি। | ঐচ্ছিক, শেষে |
| 10 | **Neural player** | YouTube ভিডিও UI-এর ভেতরেই চলে। | Eve worker-এর ফলাফল থেকে ভিডিও embed করা যায়। | ঐচ্ছিক |
| 11 | **নিরাপত্তা** | Changelog অনুযায়ী ঝুঁকির কাজে অনুমতি চায়, Esc চাপলে থামে (কৃত্রিম কী-চাপ গোনে না), disk format ব্লক। | Oma-তে এগুলো আগে থেকেই আছে: Allow card, DENY list, TERMINATE। | মিলে গেছে |
| 12 | **Floating mode আর awareness** | Minimize করলে orb desktop-এ ভাসে, আর নিজে থেকে কথা বলতে পারে। | Overlay আছে। Awareness টোকেন খরচ বাড়াবে, তাই opt-in রাখতে হবে। | ভবিষ্যৎ |

## যা নেওয়া উচিত নয়

- **বানানো status:** "4/7 seat", "CTX bar" এর মতো সংখ্যা Stonic-এ আসল কিনা প্রমাণ নেই। Oma শুধু আসল মাপ দেখাবে।
- **আলাদা cloud credit system:** Oma নিজের key আর Claude plan দিয়েই চলবে।
- **AGPL কোড (worldmonitor) মিশিয়ে ফেলা:** লাইসেন্সের সমস্যা হবে।

## কাজের গতি (video থেকে মাপা)

Video-তে tool chip-এ লেখা সময়:
- web_search: ৭.৪ থেকে ৯.৬ সেকেন্ড
- generate_diagram: ০.৮ সেকেন্ড
- agent_town_assign_task: ১.৫ সেকেন্ড

অর্থাৎ Stonic-এর গতি Oma-র মতোই। পার্থক্য হলো, Stonic সব সময় ধাপ আর সময় চোখের সামনে রাখে, তাই দ্রুত মনে হয়।
