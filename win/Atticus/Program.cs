// Atticus for Windows: a tray app. Hold Ctrl+Alt+Space, talk, let go. atticus.py (the brain) does the work through Claude Code.
// Build and install: .\build.ps1 (starts at login from HKCU\...\Run).
using System.Diagnostics;
using System.IO.Pipes;
using System.Text;
using NAudio.Wave;

namespace Atticus;

static class Program
{
    public static Overlay Box;
    public static SettingsWindow Settings;
    public static OnboardingWindow Onboarding;
    public static Tray Tray;
    public static Speech Speech = new();
    static SynchronizationContext ui;

    [STAThread]
    static void Main(string[] args)
    {
        if (args.SequenceEqual(new[] { "--selftest" }))
        {
            Check(Overlay.TranscriptKey(" Open   Notes. ") == Overlay.TranscriptKey("open notes"));
            Check(Overlay.TranscriptKey("calculate 1.5") != Overlay.TranscriptKey("calculate 15"));
            Check(Overlay.TranscriptKey("search a b") != Overlay.TranscriptKey("search ab"));
            Check(Speech.Clean(" [BLANK_AUDIO] Open notepad. ") == "Open notepad." && Speech.Clean("Thank you.") == "");
            Check(Hooks.Label(0x20, 3) == "Ctrl+Alt+Space" && Hooks.Label(0x71, 0) == "F2");
            Console.WriteLine("native selftest ok"); return;
        }
        if (args.Length >= 2 && args[0] == "--text") Environment.Exit(WindowText.Run(args[1], args.Length > 2 ? args[2] : ""));
        if (args.Length == 2 && args[0] == "--say")   // diagnostics: read a Bangla answer aloud through the same voice path
        {
            var end = new ManualResetEventSlim(); var t0 = DateTime.Now;
            BanglaVoice.Say(File.Exists(args[1]) ? File.ReadAllText(args[1]) : args[1], end.Set);
            end.Wait(TimeSpan.FromMinutes(3));
            Console.WriteLine($"spoken in {(DateTime.Now - t0).TotalSeconds:0.00} s");
            return;
        }
        if (args.Length == 2 && args[0] == "--transcribe")   // diagnostics: a 16 kHz mono WAV through the same speech path
        {
            Console.OutputEncoding = new UTF8Encoding(false);   // Bangla transcripts must not print as "?"
            Speech.Load().Wait();
            if (!Speech.Ready) { Console.Error.WriteLine("no speech model: " + Paths.Model + " " + Speech.Error); Environment.Exit(1); }
            using var r = new NAudio.Wave.AudioFileReader(args[1]);
            var all = new List<float>(); var buf = new float[16000]; int n;
            while ((n = ((NAudio.Wave.ISampleProvider)r).Read(buf.AsSpan())) > 0) all.AddRange(buf.Take(n));
            var t0 = DateTime.Now;
            Console.WriteLine(Speech.TranscribeOnce(all.ToArray()).Result + $"  [{(DateTime.Now - t0).TotalSeconds:0.00} s]");
            return;
        }
        try
        {
            var hDesk = Native.OpenDesktop("Default", 0, false, 0x01FF);
            if (hDesk != IntPtr.Zero)
            {
                Native.SetThreadDesktop(hDesk);
            }
        }
        catch { }
        Directory.CreateDirectory(Paths.Config);
        Err("Main started, args: " + string.Join(" ", args));
        using var one = new Mutex(true, @"Local\Atticus", out var first);
        Err("Mutex first: " + first);
        if (!first) { Send("open"); Err("Exiting because not first"); return; }
        Task.Run(SweepTemp);
        ApplicationConfiguration.Initialize();
        Application.SetColorMode(SystemColorMode.Dark);
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += (_, e) => Err("ThreadException: " + e.Exception);
        AppDomain.CurrentDomain.UnhandledException += (_, e) => Err("UnhandledException: " + e.ExceptionObject);
        TaskScheduler.UnobservedTaskException += (_, e) => { Err("UnobservedTaskException: " + e.Exception); e.SetObserved(); };
        var ctx = new ApplicationContext();
        PlayerWindow.Reset();   // a player_on left by a closed or reinstalled app would send "sound komao" to no player
        Application.Idle += Started;
        void Started(object s, EventArgs e)
        {
            Err("Application.Idle Started fired");
            Application.Idle -= Started;
            _ = Launch();
        }
        Err("Calling Application.Run(ctx)");
        Application.Run(ctx);
        Err("Application.Run(ctx) returned!");
        Box?.Hush(); Voice.Shush();
    }

    static void Check(bool ok) { if (!ok) { Console.Error.WriteLine("native selftest failed"); Environment.Exit(1); } }

    static async Task Launch()
    {
        try
        {
            Err("Launch() entered");
            ui = SynchronizationContext.Current;
            Settings = new SettingsWindow();
            Err("SettingsWindow created");
            Onboarding = new OnboardingWindow();
            Err("OnboardingWindow created");
            Tray = new Tray();
            Err("Tray created");
            Box = new Overlay(Speech);
            Err("Overlay created, initializing Box...");
            await Box.Init();
            Err("Box.Init() completed");
            Hooks.Shortcut = pressed => Program.Post(() => Settings?.Shortcut(pressed));
            Hooks.Escape = () => Program.Post(() => Settings?.OnEscape());
            Hooks.EscWanted = () => Settings != null && (Settings.Visible || Settings.VoiceRecording);
            Hooks.Install();
            Err("Hooks installed to SettingsWindow");
            _ = Speech.Load();
            ProviderHealth.Changed = j => Program.Post(() => { if (Settings is { Visible: true } w) w.Js($"st.providerHealth({j})"); });
            ProviderHealth.Start();
            TelegramBridge.Changed = () => Program.Post(() => { if (Settings is { Visible: true } w) w.TelegramPush(); });
            _ = Task.Run(TelegramBridge.Start);
            Listen();
            Err("Listen started");
            Updater.Schedule();
            Err("Updater scheduled");
            Program.Post(() => {
                Err("Opening Settings window...");
                Settings.Open();
                Err("Settings.Open() called");
            });
            if (Environment.GetEnvironmentVariable("ATTICUS_DEMO") is { Length: > 0 } demo) { await Task.Delay(1500); Box.Demo(demo); }
        }
        catch (Exception ex)
        {
            Err("Launch exception: " + ex);
        }
    }

    public static void Post(Action a) => ui?.Post(_ => a(), null);

    // Engine runs that were stopped (Stop button, tree kill) never reach their own cleanup: their temp folders
    // (Allow-card files, retry and player pages) are dropped here once they are 6 hours old, so a running task is never touched.
    static void SweepTemp()
    {
        int n = 0;
        try
        {
            var tmp = new DirectoryInfo(Path.GetTempPath());
            foreach (var pat in new[] { "atticus-ask-*", "atticus-retry-*", "atticus-player-*" })
                foreach (var d in tmp.EnumerateDirectories(pat))
                    if (DateTime.Now - d.LastWriteTime > TimeSpan.FromHours(6)) try { d.Delete(true); n++; } catch { }
        }
        catch { }
        if (n > 0) Err($"temp sweep: removed {n} old engine folders");
    }

    public static void Err(string line)
    {
        try { File.AppendAllText(Path.Combine(Paths.Config, "app.err"), line + "\n"); } catch { }
    }

    // atticus.py and a second copy of Atticus talk to the running app through a named pipe: one line each.
    const string PipeName = "atticus";
    static void Listen() => Task.Run(async () =>
    {
        while (true)
        {
            try
            {
                using var s = new NamedPipeServerStream(PipeName, PipeDirection.In, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous);
                await s.WaitForConnectionAsync();
                using var r = new StreamReader(s, Encoding.UTF8);
                var line = await r.ReadLineAsync() ?? "";
                Post(() => Command(line));
            }
            catch { await Task.Delay(500); }
        }
    });

    static void Command(string line)
    {
        var p = line.Split('\t', 2);
        switch (p[0])
        {
            case "notify": Tray.Notify(p.Length > 1 ? p[1] : ""); break;
            case "open": Settings.Open(); break;
            case "talk": Settings.StartListening(true); break;
            case "tab": Settings.Js($"st.tab('{(p.Length > 1 ? p[1] : "")}')"); break;
            case "eval": if (p.Length > 1) Settings.Js(p[1]); break;
            case "update": Updater.Check(() => Settings.Push()); break;   // check now (support and tests)
        }
    }

    static void Send(string line)
    {
        try { using var c = new NamedPipeClientStream(".", PipeName, PipeDirection.Out); c.Connect(1500); var b = Encoding.UTF8.GetBytes(line + "\n"); c.Write(b); } catch { }
    }
}

// Read answers aloud: English in Windows' voice, Bangla in an online neural voice (BanglaVoice). Esc or the shortcut stops it.
static class Voice
{
    static System.Speech.Synthesis.SpeechSynthesizer synth;
    public static bool Speaking;
    public static void Say(string text, Action done)
    {
        Shush();
        synth ??= new System.Speech.Synthesis.SpeechSynthesizer();
        // An English voice reading a Bangla answer says only its English words ("calculator"): the user heard English for
        // Bangla. A Bangla voice installed in Windows is used if there is one; otherwise the online one.
        // "naturalVoice" (on by default): every answer in an online neural voice, since the user heard Windows' and Edge's
        // voices as machine-like and chose Gemini's (Oct 29). English falls back to Windows' voice when that fails.
        var bangla = System.Text.RegularExpressions.Regex.IsMatch(text, @"[ঀ-৿]");
        if (Prefs.Bool("naturalVoice") || bangla && !synth.GetInstalledVoices().Any(v => v.Enabled && v.VoiceInfo.Culture.Name.StartsWith("bn")))
        {
            if (bangla && Prefs.Str("banglaVoice") == "off") { Program.Post(done); return; }
            Speaking = true;
            BanglaVoice.Say(text, () => Program.Post(() => { if (!Speaking) return; Speaking = false; done(); }),
                            bangla ? null : () => Program.Post(() => { if (Speaking) Sapi(text, done); }));
            return;
        }
        Sapi(text, done);
    }

    static void Sapi(string text, Action done)
    {
        synth.SetOutputToDefaultAudioDevice();
        Speaking = true;
        var prompt = synth.SpeakAsync(text);
        synth.SpeakCompleted += Ended;
        void Ended(object s, System.Speech.Synthesis.SpeakCompletedEventArgs e)
        {
            if (e.Prompt != prompt) return;
            synth.SpeakCompleted -= Ended;
            Program.Post(() => { if (!Speaking) return; Speaking = false; done(); });
        }
    }
    public static bool Shush()
    {
        if (!Speaking) return false;
        Speaking = false;
        try { synth?.SpeakAsyncCancelAll(); } catch { }
        BanglaVoice.Stop();
        return true;
    }
}

// Bangla answers aloud through `atticus.py --tts-server` (Microsoft Edge's neural voice, online; see multi_ai/tts_server.py
// for the measurements). The answer is cut into sentences: the next one is made while the current one plays, so the voice
// starts after the first sentence, not the whole answer. No network or no voice: the answer stays on screen (logged).
static class BanglaVoice
{
    static Process proc;
    static int gen, id;
    static WaveOutEvent output;
    static readonly SemaphoreSlim one = new(1, 1);

    public static void Stop() { gen++; try { output?.Stop(); } catch { } }

    // Gemini's voice first (streamed; about 10 answers a day on the free tier), then Edge's, sentence by sentence.
    // fallback: called instead of done when neither could speak (English then uses Windows' voice).
    public static void Say(string text, Action done, Action fallback = null)
    {
        var me = ++gen;
        var clean = Speakable(text);
        var bangla = System.Text.RegularExpressions.Regex.IsMatch(clean, @"[ঀ-৿]");
        _ = Task.Run(async () =>
        {
            var spoke = false;
            try
            {
                if (clean.Length > 0 && Prefs.Str("voiceEngine") != "edge") spoke = await SayGemini(clean, me);
                if (!spoke && me == gen) spoke = await SayEdge(Sentences(clean), bangla ? "bn-BD-NabanitaNeural" : "en-US-AvaMultilingualNeural", me);
            }
            catch (Exception e) { Program.Err("Voice: " + e.Message); }
            if (!spoke && me == gen && fallback != null) fallback(); else done();
        });
    }

    static async Task<bool> SayEdge(List<string> parts, string voice, int me)
    {
        var t0 = DateTime.Now; var spoke = false;
        Task<string> next = parts.Count > 0 ? Make(parts[0], voice) : Task.FromResult<string>(null);
        for (int i = 0; i < parts.Count && me == gen; i++)
        {
            var file = await next;
            next = i + 1 < parts.Count ? Make(parts[i + 1], voice) : null;   // the server makes it while this one plays
            if (file == null) break;
            if (i == 0) Program.Err($"Voice: Edge voice started after {(DateTime.Now - t0).TotalMilliseconds:0} ms ({parts.Count} part(s))");
            spoke = true;
            try { if (me == gen) Play(file, me); }
            finally { try { File.Delete(file); } catch { } }
        }
        if (next != null) { var left = await next; if (left != null) try { File.Delete(left); } catch { } }
        return spoke;
    }

    // Gemini's voice as it streams in. true = it spoke (or was stopped while speaking); false = use Edge.
    static async Task<bool> SayGemini(string text, int me)
    {
        BufferedWaveProvider buf = null; WaveOutEvent o = null;
        var t0 = DateTime.Now;
        await one.WaitAsync();
        try
        {
            if (!await Ensure()) return false;
            var rid = ++id;
            await proc.StandardInput.WriteLineAsync(System.Text.Json.JsonSerializer.Serialize(new { id = rid, text, engine = "gemini", voice = "Leda" }));
            await proc.StandardInput.FlushAsync();
            while (true)
            {
                var line = await proc.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(30));
                if (line == null) { proc = null; break; }
                var j = System.Text.Json.JsonDocument.Parse(line).RootElement;
                if (j.GetProperty("id").GetInt32() != rid) continue;
                if (j.TryGetProperty("pcm", out var pc))
                {
                    if (buf == null)
                    {
                        buf = new BufferedWaveProvider(new WaveFormat(24000, 16, 1), TimeSpan.FromMinutes(5)) { DiscardOnBufferOverflow = true };
                        o = new WaveOutEvent(); o.Init(buf); output = o; o.Play();
                        Program.Err($"Voice: Gemini voice started after {(DateTime.Now - t0).TotalMilliseconds:0} ms");
                    }
                    var b = Convert.FromBase64String(pc.GetString() ?? "");
                    if (me == gen) buf.AddSamples(b, 0, b.Length);
                    continue;
                }
                if (!j.GetProperty("ok").GetBoolean()) Program.Err("Voice: Gemini voice not used: " + (j.TryGetProperty("error", out var er) ? er.GetString() : "?"));
                break;
            }
        }
        catch (Exception e) { Program.Err("Voice: Gemini voice: " + e.Message); Py.Stop(proc); proc = null; }
        finally { one.Release(); }
        if (buf == null) return false;
        while (buf.BufferedDuration > TimeSpan.Zero && me == gen) await Task.Delay(50);
        try { o.Stop(); } catch { }
        o.Dispose(); if (output == o) output = null;
        return true;
    }

    // What should not be read out: markdown marks, links, the status icons of a reply.
    public static string Speakable(string t)
    {
        t = System.Text.RegularExpressions.Regex.Replace(t, @"https?://\S+|```[\s\S]*?```", " ");
        t = System.Text.RegularExpressions.Regex.Replace(t, @"[*_#`>|~✓✕⚠⏳🎤•]+", " ");
        t = string.Join(" ", t.Split((char[])null, StringSplitOptions.RemoveEmptyEntries));
        return t.Length > 3000 ? t[..3000] : t;
    }

    // The first sentence stays short so the voice starts soon; later ones are joined up to ~250 characters (fewer requests).
    public static List<string> Sentences(string t)
    {
        var raw = System.Text.RegularExpressions.Regex.Split(t, @"(?<=[।!?.;\n])\s+").Where(x => x.Trim().Length > 0).ToList();
        var parts = new List<string>();
        foreach (var r in raw)
        {
            if (parts.Count > 1 && parts[^1].Length + r.Length < 250) parts[^1] += " " + r;
            else parts.Add(r.Trim());
        }
        return parts;
    }

    // A Bangla request was heard: start the server now, while the answer is worked out (Python starts in about 1.5 s).
    public static void Warm() => _ = Task.Run(async () =>
    {
        await one.WaitAsync();
        try { await Ensure(); } catch { } finally { one.Release(); }
    });

    static async Task<bool> Ensure()
    {
        if (proc != null && !proc.HasExited) return true;
        proc = Py.Start(new[] { "--tts-server" }, input: true);
        _ = proc.StandardError.ReadToEndAsync();
        var first = await proc.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(20));
        if (first != null && first.Contains("\"ready\": true")) return true;
        Program.Err("Voice: Bangla voice server did not start: " + first); Py.Stop(proc); proc = null; return false;
    }

    // A reply for a voice note sent from Telegram, as an OGG/Opus voice note: Bangla in the Bangla voice, English in an
    // English one (the user: "Bangla te bolle Bangla, English e bolle English"). null = could not make it.
    public static Task<string> VoiceNote(string text)
    {
        var parts = Sentences(Speakable(text));
        if (parts.Count == 0) return Task.FromResult<string>(null);
        var bn = System.Text.RegularExpressions.Regex.IsMatch(text, @"[ঀ-৿]");
        return Make(parts, bn ? "bn-BD-NabanitaNeural" : "en-US-AvaMultilingualNeural", ".ogg", Prefs.Str("voiceEngine") != "edge");
    }

    static Task<string> Make(string text, string voice) => Make(new List<string> { text }, voice, ".mp3");

    static async Task<string> Make(List<string> parts, string voice, string ext, bool gemini = false)
    {
        if (gemini)   // the voice note in Gemini's voice when it can; else Edge's
        {
            var f = await MakeOne(parts, "Leda", ext, "gemini");
            if (f != null) return f;
        }
        return await MakeOne(parts, voice, ext, null);
    }

    static async Task<string> MakeOne(List<string> parts, string voice, string ext, string engine)
    {
        await one.WaitAsync();
        try
        {
            if (!await Ensure()) return null;
            var me = ++id;
            var file = Path.Combine(Path.GetTempPath(), $"oma-say-{Environment.ProcessId}-{me}{ext}");
            await proc.StandardInput.WriteLineAsync(System.Text.Json.JsonSerializer.Serialize(new { id = me, parts, voice, @out = file, engine }));
            await proc.StandardInput.FlushAsync();
            while (true)
            {
                var line = await proc.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(25 + 15 * parts.Count));
                if (line == null) { proc = null; return null; }
                var j = System.Text.Json.JsonDocument.Parse(line).RootElement;
                if (j.GetProperty("id").GetInt32() != me) continue;
                if (j.GetProperty("ok").GetBoolean()) return file;
                Program.Err($"Voice: {engine ?? "Edge"} voice failed: " + j.GetProperty("error").GetString());
                return null;
            }
        }
        catch (Exception e) { Program.Err("Voice: Bangla voice: " + e.Message); Py.Stop(proc); proc = null; return null; }
        finally { one.Release(); }
    }

    static void Play(string file, int me)
    {
        using var r = new Mp3FileReader(file);
        using var o = new WaveOutEvent();
        output = o;
        o.Init(r); o.Play();
        while (o.PlaybackState == PlaybackState.Playing && me == gen) Thread.Sleep(40);
        o.Stop();
        output = null;
    }
}

// Cues from Windows' own sounds (C:\Windows\Media), at Atticus's volume.
static class Sound
{
    public static string PathOf(string name) => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "Media", name + ".wav");
    public static void Play(string name, double volume)
    {
        var f = PathOf(name);
        if (!File.Exists(f)) return;
        Task.Run(() =>
        {
            try
            {
                using var r = new AudioFileReader(f) { Volume = (float)Math.Clamp(volume, 0, 1) };
                using var o = new WaveOut();
                o.Init(r); o.Play();
                while (o.PlaybackState == PlaybackState.Playing) Thread.Sleep(30);
            }
            catch { }
        });
    }
    public static void Cue(string k) { var n = Prefs.Str(k); if (n != "None" && n != "") Play(n, Prefs.Num("volume") * 2); }   // soundStart / soundDone / soundStop
    public static string[] All() => new[] { "None" }.Concat(Directory.Exists(Path.GetDirectoryName(PathOf("x"))) ?
        Directory.GetFiles(Path.GetDirectoryName(PathOf("x"))!, "*.wav").Select(Path.GetFileNameWithoutExtension).Where(n => !n.StartsWith("Alarm") && !n.StartsWith("Ring")).OrderBy(n => n) : Array.Empty<string>()).ToArray();
}

// The tray icon: quick actions, today's usage.
sealed class Tray
{
    readonly NotifyIcon icon;
    public Tray()
    {
        var ico = Path.Combine(Paths.App, "ui", "AppIcon.ico");
        icon = new NotifyIcon { Icon = File.Exists(ico) ? new Icon(ico) : SystemIcons.Application, Text = "Oma AI", Visible = Prefs.Bool("menuIcon") };
        icon.ContextMenuStrip = new ContextMenuStrip();
        icon.ContextMenuStrip.Opening += (_, _) => Build();
        icon.MouseClick += (_, e) => { if (e.Button == MouseButtons.Left) Program.Settings.Open(); };
        Build();
    }
    public bool Visible { set => icon.Visible = value; }
    public void Notify(string text) { icon.Visible = true; icon.ShowBalloonTip(5000, "Oma AI", text, ToolTipIcon.None); if (!Prefs.Bool("menuIcon")) Task.Delay(8000).ContinueWith(_ => Program.Post(() => icon.Visible = Prefs.Bool("menuIcon"))); }
    void Build()
    {
        var m = icon.ContextMenuStrip; m.Items.Clear();
        var keys = Prefs.Str("hotkeyLabel");
        var hint = Prefs.Str("input") == "type" ? $"Press {keys} to type" : Prefs.Str("talkMode") == "toggle" ? $"Press {keys} to talk · again to send" : $"Hold {keys} and talk";
        m.Items.Add(new ToolStripMenuItem(Prefs.Bool("paused") ? "Oma AI is paused" : hint) { Enabled = false });
        m.Items.Add(new ToolStripSeparator());
        m.Items.Add("Ask Oma AI", null, (_, _) => { Program.Settings.StartListening(true); });
        m.Items.Add(Prefs.Bool("paused") ? "Resume Oma AI" : "Pause Oma AI", null, (_, _) => { Program.Settings.Apply("paused", !Prefs.Bool("paused")); Program.Settings.Push(); });
        m.Items.Add(new ToolStripSeparator());
        m.Items.Add(new ToolStripMenuItem(Today()) { Enabled = false });
        m.Items.Add(new ToolStripSeparator());
        m.Items.Add("Settings…", null, (_, _) => Program.Settings.Open());
        m.Items.Add(new ToolStripSeparator());
        m.Items.Add("Quit Oma AI", null, (_, _) => { icon.Visible = false; Application.Exit(); });
    }
    static string Today()
    {
        var day = DateTime.Now.ToString("yyyy-MM-dd");
        int n = 0; double usd = 0;
        try
        {
            foreach (var l in File.ReadLines(Paths.Log))
            {
                try
                {
                    using var d = System.Text.Json.JsonDocument.Parse(l);
                    if (!(d.RootElement.GetProperty("at").GetString() ?? "").StartsWith(day)) continue;
                    n++; if (d.RootElement.TryGetProperty("usd", out var u)) usd += u.GetDouble();
                }
                catch { }
            }
        }
        catch { }
        return $"Today: {n} ask{(n == 1 ? "" : "s")} · " + (usd < 1 ? $"{usd * 100:0.00}¢" : $"${usd:0.00}");
    }
}
