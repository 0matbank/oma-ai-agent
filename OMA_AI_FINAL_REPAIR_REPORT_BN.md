# Oma AI — অডিট যাচাই ও মেরামতের চূড়ান্ত রিপোর্ট

**তারিখ:** ২৯ অক্টোবর ২০২৬
**ভিত্তি:** `OMA_AI_COMPLETE_AUDIT_REPORT.md`
**পরিবেশ:** ব্যবহারকারীর নিজের Windows 11 PC
- RAM: 16 GB
- GPU: RTX 5060 Ti 16 GB
- Installed app: `%LOCALAPPDATA%\Programs\Atticus`

**পদ্ধতি:** প্রতিটা দাবি এই ক্রমে পরীক্ষা করা হয়েছে: কোড পড়া → আসল PC-তে চালিয়ে দেখা → ঠিক করা → install করা build-এ আবার পরীক্ষা।
- কোনো PASS শুধু unit test বা মডেলের উত্তর দেখে দেওয়া হয়নি।
- যা যাচাই করা যায়নি, সেটা আলাদা করে **NOT VERIFIED** লেখা আছে।

**কাজ শুরুর আগের backup:**
- Git tag `backup-before-audit-repair-20261029`, commit `ba29786`।
- `settings.json` আর পুরো installed app-এর একটা কপি (scratchpad `audit_backup`)।

---

## সারসংক্ষেপ

| | ফল |
|---|---|
| অডিটের ৮টা bug | **৪টা নিশ্চিত হয়ে ঠিক করা হয়েছে:** ০২, ০৩, ০৭, ০৮ |
| | **২টা আংশিক সত্য, দরকারি অংশ ঠিক করা হয়েছে:** ০৪, ০৬ |
| | **২টা দাবি হুবহু মেলেনি:** ০১, ০৫। তবু নিরাপত্তার ব্যবস্থা আর optimization করা হয়েছে |
| RAM (Oma-এর আসল private memory) | ৫টা কাজ চালানোর পরে, window খোলা অবস্থায়: **৩১৯ MB**। অডিটের "২.০৩ GB" সংখ্যাটা ভুল হিসাব থেকে এসেছে (বিভাগ ৫ দেখুন) |
| বসে থাকা অবস্থায় CPU | ৩.০২% → **১.৫৭%** (১৬ core-এর মোট হিসাবে) |
| Test | ১১৬টা test-এর সব পাস, repo-র বাইরের folder থেকে চালিয়েও |
| Commit | `c45337b` (branch `repair/smart-routing-browser`), push করা হয়েছে |

---

## ১. নিশ্চিত হওয়া সমস্যা ও আসল সমাধান

### Bug ০১ — `winctl.windows()` window দেখে না → **আসল app-এ হুবহু দেখা যায়নি**

**প্রমাণ:**
- সাধারণ Python process থেকে `winctl.windows()` ডাকলে **৪টা window** ফেরত দিয়েছে।
- আসল app-এ "open calculator" পাঠানো হয়েছে:
  - Calculator খুলেছে।
  - অবস্থা **COMPLETED** দেখিয়েছে।
  - Dave-এর যাচাই নোট: "✓ Calculator opened: new window: Calculator - Calculator"।
- বাংলা chip "ক্যালকুলেটর খোলো"-ও ০.১ সেকেন্ডে কাজ করেছে।

**কারণের অনুমান:** অডিটের test process খুব সম্ভবত Windows-এর interactive desktop-এর বাইরে চলছিল। Windows-এ এমন process খালি desktop দেখে।

**তবু যা করা হয়েছে:** `winctl.py`-তে একটা নিরাপত্তা ব্যবস্থা যোগ হয়েছে। Window-এর তালিকা একদম খালি এলে process একবার `Default` desktop-এ যুক্ত হয়ে আবার খোঁজে। এটা `Atticus.exe` নিজের জন্য যা করে (`Program.cs`) তারই মতো।

### Bug ০২ — সঠিক উত্তরকে ভুল করে FAILED দেখানো → **নিশ্চিত, ঠিক করা হয়েছে**

**কারণ রিপোর্টের লেখা থেকে আলাদা:**
- রিপোর্ট বলছে "didn't edit" শব্দের জন্য FAILED হয়েছে। কিন্তু এখনকার pattern-এ "didn't" শব্দটা নেই।
- `log.jsonl`-এর আসল রেকর্ডে pattern আসলে ধরেছে উত্তরের **কোডের ভেতরের** `"cannot divide by zero"`-এর "cannot" শব্দটা।

**সমাধান:**
- `atticus.py`-তে নতুন function `admits_failure()`।
- এটা code block, `inline code` আর উদ্ধৃতির ভেতরের লেখা বাদ দিয়ে তারপর ব্যর্থতার শব্দ খোঁজে।
- মডেলের উত্তর যাচাই করার ৭টা জায়গায় এটা ব্যবহার হচ্ছে। Command-এর output যাচাই আগের মতোই আছে।

**আসল পরীক্ষা:**
- রিপোর্টের মতো একটা ভুলওয়ালা `calculator.py` বানিয়ে Oma-কে সেটা পরীক্ষা করতে বলা হয়েছে।
- উত্তরে `"cannot divide by zero"` ছিল, তবু অবস্থা **COMPLETED** এসেছে (৭.৭ সেকেন্ড)।
- আসল ব্যর্থতা এখনো ধরা পড়ে। test-এ দেখা গেছে "I could not open…" বা "I was unable…" এখনো FAILED হিসেবে ধরা হয়।

### Bug ০৩ — `%TEMP%`-এ `atticus-ask-*` folder জমা → **নিশ্চিত, ঠিক করা হয়েছে**

**প্রমাণ:** **১৫৩টা** folder পাওয়া গেছে, সবচেয়ে পুরনোটা ২৭ অক্টোবরের।

**কারণ:**
- `atticus.py`-তে `atexit` দিয়ে folder মোছার ব্যবস্থা আছে। কিন্তু Stop বোতাম বা process tree kill করলে `atexit` চলে না।
- `multi_ai/tool_agent.py`-তে folder মোছার কোনো ব্যবস্থাই ছিল না।

**সমাধান:**
- `Atticus.exe` চালু হওয়ার সময় ৬ ঘণ্টার পুরনো `atticus-ask-*`, `atticus-retry-*` আর `atticus-player-*` folder মুছে ফেলে। চলমান কাজের folder-এ হাত দেয় না।
- `tool_agent.py` এখন নিজের folder নিজেই মোছে।

**আসল পরীক্ষা:**
- app log-এ লেখা এসেছে `temp sweep: removed 151 old engine folders`।
- ৬ ঘণ্টার কম পুরনো ৮টা folder রেখে দেওয়া হয়েছে।

### Bug ০৪ — Gemini API timeout → **আংশিক সত্য, ঠিক করা হয়েছে**

**প্রমাণ (আসল request, model ধরে ধরে):**

| Model | ফল |
|---|---|
| `gemini-3.8-flash` | ৪৫ সেকেন্ডেও উত্তর নেই (timeout) |
| `gemini-3.7-flash` | ২৯.৪ সেকেন্ডে উত্তর |
| `gemini-3.6-flash` | ৭.৫ সেকেন্ডে উত্তর |

- Key সচল।
- `reasoning_effort` কমিয়েও উন্নতি হয়নি (৪০ সেকেন্ডে timeout)। তাই সমস্যাটা Google-এর server বা এই key-এর quota-র দিকে, endpoint বা region-এ নয়।
- পুরো provider পরীক্ষায় **৫৪.৬ সেকেন্ড** লাগছিল।

**সমাধান:**
- প্রতিটা model-এর পরীক্ষার timeout ২৫ থেকে কমিয়ে **১২ সেকেন্ড** (`model_catalog.probe`)।
- Timeout হওয়া model এখন **১০ মিনিট** বিশ্রাম পায় (আগে ২ মিনিট, `health_monitor`)। তাই প্রতি ২ মিনিট পরপর একটা chat আর ৬০ সেকেন্ড আটকে থাকে না।

**আসল পরীক্ষা:** provider পরীক্ষা এখন **১৪.১ সেকেন্ডে** শেষ হয়, আগে ৫৪.৬ সেকেন্ড লাগত।

**বদলানো হয়নি:** আপনার বাছাই করা model (`gemini/gemini-3.8-flash`) আগের মতোই আছে।
- Settings ইতিমধ্যে এটাকে DEGRADED দেখায়, আর chat নিজে থেকে Claude-এ চলে যায়।
- **পরামর্শ:** Settings থেকে `gemini-3.6-flash` বা Claude বাছাই করুন।

### Bug ০৫ — WebView2 ২৬টা process আর ২.০৩ GB RAM → **সংখ্যাগুলো ভুল, তবু optimization করা হয়েছে**

**প্রমাণ:** process tree মেপে দেখা গেছে (script: `memtree.ps1`):
- PC-তে মোট ২৬টা `msedgewebview2.exe` চলছে, কিন্তু তার মধ্যে **Oma-এর মাত্র ৮টা**।
- বাকি ১৮টা অন্য app-এর:
  - Windows Search (`SearchHost.exe`): ৬টা
  - Google Drive (`GoogleDriveFS.exe`): ৬টা
  - Widgets (`Widgets.exe`): ৬টা
- Oma-এর সব window একটাই WebView2 environment ভাগ করে চলে, তাই আলাদা আলাদা environment জমে থাকার দাবি সত্য নয়।
- "২.০৩ GB" এসেছে তিনটা ভুল থেকে:
  - সব process-এর working set যোগ করা হয়েছে, যাতে shared page একাধিকবার গোনা হয়।
  - অন্য app-এর WebView2-ও গোনা হয়েছে।
  - Voice server-এর সদ্য চালু হওয়ার সময়ের মাপ ধরা হয়েছে।

**বাস্তব optimization (বিভাগ ৫-এ মাপ দেখুন):**
- Backup voice engine (whisper.cpp) আর চালুর সময় load হয় না।
- Voice server load শেষ হলেই একবারের কাজে লাগা memory ফেরত দেয়।
- লুকানো overlay পাতার animation বন্ধ করা হয়েছে।
- Window minimize বা লুকানো থাকলে WebView2-কে কম memory ব্যবহার করতে বলা হয় (`MemoryUsageTargetLevel.Low`)।

### Bug ০৬ — Settings drawer-এর close বোতামের ID অমিল → **দাবি ভুল, আসল ঘাটতি ঠিক করা হয়েছে**

**প্রমাণ:**
- `btn-close-settings` আর `drawer-close` দুটো আলাদা drawer-এর বোতাম, অমিল নয়।
- Settings-এর ✕ বোতাম ঠিকমতো লাগানো আছে।
- `drawer-close` যে `app.js`-এ খোঁজা হয়, সেই file পাতায় load-ই হয় না।

**আসল ঘাটতি:** Esc চাপলে কোনো drawer বন্ধ হতো না।

**সমাধান:**
- Esc চাপলে Settings drawer বা node drawer বন্ধ হয়।
- Settings-এর খোঁজার ঘরে লেখা থাকলে প্রথম Esc শুধু লেখাটা মোছে।
- node drawer-এর ✕ বোতাম লাগানো হয়েছে।

**আসল পরীক্ষা:** Settings খুলে Esc চাপা হয়েছে, drawer বন্ধ হয়েছে। দুটো screenshot নিয়ে মিলিয়ে দেখা হয়েছে।

### Bug ০৭ — ভাষা বাংলা অথচ ইংরেজি-only voice model (`base.en`) → **নিশ্চিত, ঠিক করা হয়েছে**

**প্রমাণ:**
- `settings.json`-এ আছে `"speechLanguage": "bn"` আর `"speechModel": "base.en"`।
- Backup engine (`Speech.cs`) এই অবস্থায় ভাষা জোর করে `en` করে দিত।

**সমাধান:**
- ভাষা ইংরেজি না হলে backup engine disk-এ থাকা বহুভাষিক model নেয়। `small` আগে, কারণ CPU-তে সেটা দ্রুত চলে।
- "বাংলা + English" setting-এ ভাষা নিজে থেকে চেনে (auto)।
- আপনার saved setting বদলানো হয়নি।

**আসল পরীক্ষা:** Windows TTS দিয়ে একটা ইংরেজি WAV বানিয়ে `Atticus.exe --transcribe` চালানো হয়েছে, আলাদা config-এ।

| পথ | ফল |
|---|---|
| GPU server (মূল পথ) | "Open Notepad and write Hello World." — ০.৫০ সেকেন্ড, আগে-পরে একই |
| Backup engine, ভাষা `bn` | `ggml-small.bin` model, ঠিক লেখা, ৫.৪২ সেকেন্ড |
| Backup engine, ভাষা `en` | `ggml-base.en.bin` model, ঠিক লেখা, ০.৬৫ সেকেন্ড |

প্রথম চেষ্টায় একটা ভুল ধরা পড়েছিল, যেটা ঠিক করে তারপর commit করা হয়েছে:
- বড় `large-v3-turbo` model আর জোর করে `bn` ভাষা মিলে ইংরেজি কথা বাংলা অক্ষরে ভুলভাবে লিখত।
- সেটা ২১ সেকেন্ড নিত।

### Bug ০৮ — `test_fast_worker_sigterm…` ব্যর্থ হয় → **নিশ্চিত, ঠিক করা হয়েছে**

**প্রমাণ:** repo-র বাইরের folder (`%TEMP%`) থেকে test চালালে ১টা test ব্যর্থ হয়। Child process `atticus` module খুঁজে পায় না।

**সমাধান:** test-এর child process-কে `PYTHONPATH`-এ repo-র ঠিকানা দেওয়া হয়েছে।

**আসল পরীক্ষা:** `%TEMP%` থেকে চালিয়ে **১১৬/১১৬ OK**।

---

## ২. পরামর্শগুলো: যেগুলো নেওয়া হয়েছে আর যেগুলো বাদ দেওয়া হয়েছে

| পরামর্শ | সিদ্ধান্ত | প্রমাণ বা কারণ |
|---|---|---|
| UX-১: যাচাইয়ের প্রমাণ chat-এ দেখানো | **আগে থেকেই আছে** | চ্যাটে "Verification: ✓ Calculator opened: new window…" দেখায় |
| UX-২: Esc চাপলে drawer বন্ধ | **নেওয়া হয়েছে** | Bug ০৬ দেখুন |
| UX-৩: Agent Town-এ agent-এ click করলে তার কাজ দেখা | **আংশিক আগে থেকেই আছে** | worker-এ click করলে শেষ ৫টা ধাপের popup খোলে। পুরো chat feed agent ধরে ছেঁকে দেখানো এখনো করা হয়নি, চাইলে করা যায় |
| Perf-১: WebView2 process pooling | **বাদ** | Oma আগে থেকেই একটাই environment ব্যবহার করে, আর ২৬টা process-এর সংখ্যাটাই ভুল। এর বদলে লুকানো window-এ কম memory ব্যবহার আর লুকানো overlay-এর animation বন্ধ করা হয়েছে |
| Perf-২: temp folder নিজে থেকে পরিষ্কার | **নেওয়া হয়েছে** | Bug ০৩ দেখুন |
| Perf-৩: Ollama-কে GPU memory ছেড়ে দিতে বলা (`keep_alive`) | **আগে থেকেই আছে** | কোডে `keep_alive: '10m'` আছে। এখন `api/ps` খালি, অর্থাৎ কোনো model load করা নেই |
| Arch-১: regex-এর বদলে LLM দিয়ে যাচাই | **বাদ** | প্রতিটা কাজে আরেকটা model call মানে বাড়তি সময় আর খরচ, তার উপর মডেল নিজের কাজ নিজে নম্বর দেবে। নির্দিষ্ট সমস্যাটা `admits_failure` দিয়েই মিটেছে |
| Arch-২: Gemini timeout হলে অন্য পথে পাঠানো | **আংশিক আগে থেকেই আছে, উন্নত করা হয়েছে** | router নিজে থেকেই Claude আর অন্যান্য provider-এ চলে যায় (Antigravity CLI দিয়ে Gemini-ও আছে)। timeout আর বিশ্রামের সময় ঠিক করা হয়েছে |
| Roadmap P৩: default model বদলে দেওয়া | **করা হয়নি** | এটা আপনার নিজের বাছাই, অনুমতি ছাড়া বদলানো হবে না। ওপরের পরামর্শ দেখুন |

---

## ৩. নতুন পাওয়া সমস্যা ও সমাধান

| সমস্যা | প্রমাণ | সমাধান |
|---|---|---|
| লুকানো overlay পাতা (`ui.html`) কখনো দেখা যায় না, তবু তার orb চলত | `ShowBox()` এখন মূল Oma window খোলে। তবু ওই renderer process-টা minimize অবস্থাতেও ০.৬২% CPU নিচ্ছিল | পাতা load হলেই তাকে জানানো হয় যে সে পর্দায় নেই (`visible=false`) |
| ব্যবহার না হওয়া whisper.cpp model চালুর সময়েই load হতো | `Atticus.exe` reserve করছিল ২১৪ MB | GPU server চললে আর load হয় না। reserve এখন প্রায় ৩০ MB |
| Voice server-এ load-এর পরের ~৬০০ MB memory অনেকক্ষণ আটকে থাকত | সদ্য চালু হওয়ার পরে private memory ৬০২ MB | load শেষে একবার memory ফেরত দেয়। এখন ৩–৫ MB, transcription ০.৫০ সেকেন্ডই থাকে |
| Aurora লাইন বসে থাকা অবস্থাতেও প্রতি সেকেন্ডে ৩০ বার আঁকা হতো | renderer আর GPU process-এর CPU | বসে থাকলে ~২০ বার, কাজের সময় ৩০ বার। ঢেউয়ের গতি একই থাকে |
| node drawer-এর ✕ বোতামের handler ছিল ব্যবহার না হওয়া `app.js`-এ | কোড পড়ে পাওয়া | `oma_ux.js`-এ লাগানো হয়েছে |

---

## ৪. আসল Windows পরীক্ষার ফলাফল (installed build-এ)

| পরীক্ষা | ফল | সময় |
|---|---|---|
| "open calculator" | **PASS:** Calculator খুলেছে, COMPLETED, Dave যাচাই করেছে | ০.০ সেকেন্ড (instant) |
| "ক্যালকুলেটর" chip (বাংলা) | **PASS:** Calculator খুলেছে | ০.১ সেকেন্ড |
| "বাংলাদেশের রাজধানী কোথায়? এক লাইনে বলো।" | **PASS:** উত্তর এসেছে "বাংলাদেশের রাজধানী ঢাকা।" | ৪.০ সেকেন্ড |
| কোডের ভুল খোঁজা (seeded `calculator.py`) | **PASS:** সঠিক সমাধান, COMPLETED, FAILED নয় | ৭.৭ সেকেন্ড |
| "close calculator" (অডিটে BLOCKED ছিল) | **PASS:** Alt+F4, COMPLETED, process সংখ্যা ০ | — |
| file তৈরি, safe mode-এর Allow card (অডিটে BLOCKED ছিল) | **PASS:** Allow card এসেছে, Allow চাপার পর file-এর লেখা হুবহু "Oma audit test 29 Oct", COMPLETED | ৩০.৯ সেকেন্ড |
| কাজ চলার মাঝে halo বৃত্ত | **PASS:** ২/৪ ভাগ জ্বলছিল ("কাজ করছি"), শেষে সবুজ | — |
| Settings খোলা, তারপর Esc | **PASS** | — |
| Voice (TTS দিয়ে বানানো WAV): GPU, backup বাংলা, backup ইংরেজি | **PASS** | ০.৫০ / ৫.৪২ / ০.৬৫ সেকেন্ড |
| Gemini provider পরীক্ষা | **PASS:** ৫৪.৬ সেকেন্ড থেকে নেমে এসেছে | ১৪.১ সেকেন্ড |
| Unit test (`%TEMP%` থেকে) | **১১৬/১১৬ OK** | ৭.৯ সেকেন্ড |

---

## ৫. আগে ও পরের কর্মক্ষমতার মাপ

**কীভাবে মাপা হয়েছে:**
- `Atticus.exe`-এর পুরো process tree (WebView2, Python) আর Ollama মাপা হয়েছে।
- "Private" মানে Task Manager-এর Memory কলাম, অর্থাৎ শুধু ওই process-এর নিজস্ব RAM।
- "Commit" মানে process যতটা memory reserve করে রেখেছে।

| অবস্থা | মোট process | Private RAM | Atticus.exe (private/commit) | WebView2 (private/commit) | Python (private) | Ollama | CPU |
|---|---|---|---|---|---|---|---|
| **আগে**: পুরনো build, কয়েক ঘণ্টা চলার পরে, window খোলা, বসে আছে | ১৪ (WebView2 ৮টা) | **৪৩৮ MB** | ৫৪ / ২১৪ MB | ২৫১ / ৫৯৬ MB | ১১২ MB | ২০ MB | **৩.০২%** |
| **আগে**: পুরনো build, minimize করা | ১৭ | ৩২৩ MB | ৪৩ / ২০৫ | ১৮১ / ৪৫৫ | ৮৩ | ১৬ | ০.৮৪% (এর ০.৬২% লুকানো overlay) |
| তুলনার সূত্র: সদ্য চালু voice server (কোড পুরনোটার মতোই) | — | — | — | — | **৬০২ MB** | — | — |
| **পরে**: নতুন build, ৫টা কাজ চালানোর পরে, window খোলা, বসে আছে | ১৩ (WebView2 ৭টা) | **৩১৯ MB** | ৩০ / ৩৫ MB | ২৬১ / ৪৫৯ MB | **৫ MB** | ২১ MB | **১.৫৭%** |
| **পরে**: নতুন build, minimize করা | ১৪ | ২৯০ MB | ৩৩ / ৩৯ | ২৩০ / ৩৯৬ | ৫ | ২১ | ০.৬৭% (এর ০.৫৪% ভাসমান orb, যেটা পর্দায় দেখা যায়) |

GPU memory: পুরো PC-তে ব্যবহার ৩.১ GB, মোট ১৬.৩ GB-এর মধ্যে। Windows-এ process ধরে ধরে VRAM দেখা যায় না।

**সৎ ব্যাখ্যা:**
- পুরনো build-এর মাপ কয়েক ঘণ্টা চলার পরের। ততক্ষণে Windows নিজেই voice server-এর memory অনেকটা ফেরত নিয়ে নিয়েছিল। নতুন build-এর মাপ সদ্য চালু হওয়ার কাছাকাছি সময়ের।
- স্থায়ী লাভ:
  - Voice server সদ্য চালু অবস্থায় **~৬০০ MB কম** private memory নেয়।
  - `Atticus.exe` **~১৮০ MB কম** reserve করে।
  - বসে থাকা অবস্থায় CPU **প্রায় অর্ধেক**।
  - একটা WebView2 process কম চলে।
- WebView2-এর private memory window খোলা অবস্থায় মাপার মতো কমেনি (২৫১ বনাম ২৬১ MB)। তবে reserve (commit) ৫৯৬ থেকে ৪৫৯ MB হয়েছে।

---

## ৬. যা এখনো বাকি বা যাচাই করা যায়নি

- **NOT VERIFIED — মাইক্রোফোনে আসল বাংলা কথা:**
  - এই PC-তে বাংলা TTS voice নেই, আর মাইক্রোফোনে মানুষের কথা লাগবে।
  - Ctrl+Alt+Space চেপে আপনি নিজে বাংলায় বলে একবার দেখে নিন।
  - Backup engine-এ বাংলা কতটা নির্ভুল লেখে, সেটাও একইভাবে যাচাই বাকি।
- **NOT VERIFIED — minimize অবস্থায় `MemoryUsageTargetLevel.Low`-এর প্রভাব:** মোট private memory ৩১৯ থেকে ২৯০ MB হয়েছে, কিন্তু এর কতটা এই পরিবর্তনের কারণে, সেটা আলাদা করে প্রমাণ করা যায়নি।
- **Google-এর দিকের সমস্যা:** `gemini-3.8-flash` এখনো উত্তর দেয় না। Oma এখন তাড়াতাড়ি হাল ছেড়ে অন্য model-এ যায়, কিন্তু model-টা নিজে ঠিক হয়নি।
- **এই দফায় আবার পরীক্ষা করা হয়নি:** Browser worker, YouTube worker, Telegram, gesture বা camera (এই PC-তে webcam নেই)। এগুলোর কোড এই দফায় বদলানো হয়নি।
- **ছোঁয়া হয়নি:** repo-তে আগে থেকে থাকা অন্যের অসমাপ্ত পরিবর্তন: `tests/test_oma_repair.py`, `tests/test_youtube_worker.py` আর কিছু মুছে ফেলা `.md` file।

---

## ৭. বদলানো file, commit আর installed build যাচাই

**Commit `c45337b`:** "fix: audit repairs with real-PC measurements"

| File | পরিবর্তন |
|---|---|
| `atticus.py` | `admits_failure` |
| `multi_ai/tool_agent.py` | নিজের temp folder মোছা |
| `multi_ai/model_catalog.py` | probe timeout ১২ সেকেন্ড |
| `multi_ai/health_monitor.py` | timeout হওয়া model-এর বিশ্রাম ১০ মিনিট |
| `multi_ai/voice_server.py` | load শেষে memory ফেরত |
| `winctl.py` | `Default` desktop-এ যুক্ত হওয়ার ব্যবস্থা |
| `win/Atticus/Speech.cs` | backup engine দরকার হলে load, বহুভাষিক model |
| `win/Atticus/Program.cs` | temp folder sweep |
| `win/Atticus/Web.cs` | লুকানো window-এ কম memory |
| `win/Atticus/Overlay.cs` | লুকানো overlay-এর animation বন্ধ |
| `ui/mindmap.js` | aurora-এর frame rate |
| `ui/oma_ux.js` | Esc দিয়ে drawer বন্ধ |
| `tests/test_atticus.py` | `PYTHONPATH` |
| `tests/test_audit_fixes.py` (নতুন) | এই মেরামতগুলোর test |

**Installed build যাচাই:**
- **Build:** `build.ps1` দিয়ে build করে install করা হয়েছে।
- **Process:** এখন যে `Atticus.exe` চলছে, সেটা ১১:৩০-এ চালু হয়েছে।
- **File:** installed folder-এর প্রতিটা বদলানো file-এ নতুন কোড আছে কিনা খুঁজে দেখা হয়েছে, সবগুলোতেই পাওয়া গেছে:
  - `admits_failure`
  - `c_void_p(-1)`
  - `timeout=12`
  - `('DEGRADED', 600)`
  - `atexit.register`
  - `_on_user_desktop`
  - frame cap
  - `node-drawer`
  - `Atticus.dll`-এ `FallbackModel`

**মাপার script (scratchpad-এ):**
- `memtree.ps1`: process tree-এর RAM
- `cputree.ps1`: CPU
- `audit_backup\`: কাজ শুরুর আগের backup
