// The Settings window (ui\settings.html) and the first-run setup window (ui\onboarding.html).
using System.Diagnostics;
using System.Text.Json;
using Microsoft.Web.WebView2.WinForms;

namespace Atticus;

class PageWindow : Form
{
    protected WebView2 web;
    readonly string page, handler;
    protected PageWindow(string page, string handler, string title, int w, int h)
    {
        this.page = page; this.handler = handler;
        Text = title; StartPosition = FormStartPosition.CenterScreen; BackColor = Color.FromArgb(7, 10, 15);
        ClientSize = new Size((int)(w * DeviceDpi / 96.0), (int)(h * DeviceDpi / 96.0));
        MinimumSize = new Size((int)(900 * DeviceDpi / 96.0), (int)(600 * DeviceDpi / 96.0));
        MinimizeBox = true; MaximizeBox = true; FormBorderStyle = FormBorderStyle.Sizable;
        ShowInTaskbar = true;
        var ico = Path.Combine(Paths.App, "ui", "AppIcon.ico");
        if (File.Exists(ico)) Icon = new Icon(ico);
    }
    protected override void OnHandleCreated(EventArgs e) {
        base.OnHandleCreated(e);
        Native.Backdrop(Handle, acrylic: false, round: true, extendFrame: false);
    }
    protected async Task Ensure()
    {
        if (web != null) return;
        Program.Err("Ensure: calling Web.Load for " + page);
        web = await Web.Load(this, page, (n, b) => {
            if (n == "jsError") Program.Err("JS Error: " + b);
            else if (n == handler) OnMessage(b);
        }, Loaded, false);
        Program.Err("Ensure: Web.Load returned");
    }
    protected virtual void Loaded() { }
    protected virtual void OnMessage(JsonElement b) { }
    public void Js(string s) => Web.Js(web, s);
    protected void Send(string call, object v) => Program.Post(() => Js($"{call}({Web.Json(v)})"));
    protected void Raise() {
        Program.Err("Raise called for " + page + ", Handle=" + Handle);
        try
        {
            if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
            Visible = true;
            Show();
            Native.ShowWindow(Handle, 9); // SW_RESTORE
            Native.ShowWindow(Handle, 5); // SW_SHOW
            Native.SetWindowPos(Handle, Native.HWND_TOPMOST, 0, 0, 0, 0, Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_SHOWWINDOW);
            BringToFront();
            Native.keybd_event(0xE8, 0, 0, IntPtr.Zero);
            Native.keybd_event(0xE8, 0, 2, IntPtr.Zero);
            Activate();
            Native.SetForegroundWindow(Handle);
            Native.SetWindowPos(Handle, Native.HWND_NOTOPMOST, 0, 0, 0, 0, Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_SHOWWINDOW);
        }
        catch (Exception ex)
        {
            Program.Err("Raise exception: " + ex);
        }
    }
}

sealed class SettingsWindow : PageWindow
{
    string tab = "";
    System.Windows.Forms.Timer perms;
    bool shortcutDown;
    bool voiceRecording;
    bool toggleTalk;
    string liveText = "";
    System.Windows.Forms.Timer holdTimer;
    DateTime recordingBegan;
    int listenId;
    Process currentProc;

    public bool VoiceRecording => voiceRecording;

    public void Shortcut(bool pressed)
    {
        if (!pressed)
        {
            shortcutDown = false;
            if (voiceRecording && !toggleTalk) StopListening();
            return;
        }
        if (shortcutDown) return;
        shortcutDown = true;
        if (Prefs.Bool("paused")) return;
        if (Voice.Shush()) return;
        if (voiceRecording)
        {
            if (toggleTalk) StopListening();
            else CancelListening();
            return;
        }
        StartListening(false);
    }

    public void StartListening(bool isClick)
    {
        if (Prefs.Bool("paused")) return;
        if (Prefs.Bool("muted")) { if (web == null) Open(); else Raise(); Js("st.mutedNudge?.()"); return; }   // the orb's mic button muted the voice assistant
        Voice.Shush();
        if (web == null) Open();
        else Raise();
        TopMost = true;
        toggleTalk = isClick || Prefs.Str("talkMode") == "toggle";
        liveText = "";
        voiceRecording = true;
        recordingBegan = DateTime.Now;
        Sound.Cue("soundStart");

        Js("st.voiceStart(); holoOrb?.setState('listening');");

        if (!Program.Speech.Ready)
        {
            Js("st.feedLine('§REPLY§' + JSON.stringify({ success: false, reply: 'Speech engine is still loading. Please try again in a moment.', error: 'speech_not_ready' }));");
            CancelListening();
            return;
        }

        Program.Speech.Prompt = Hints();
        var id = ++listenId;
        var err = Program.Speech.Start(
            v => {
                if (listenId == id && voiceRecording)
                    Program.Post(() => Js($"st.voiceLevel({v:0.00}); holoOrb?.setAudioLevel({v:0.00});"));
            },
            w => {
                if (listenId == id && voiceRecording)
                    Program.Post(() => {
                        liveText = w;
                        Js($"st.voiceWords({Web.Json(w)});");
                    });
            }
        );

        if (!string.IsNullOrEmpty(err))
        {
            Js($"st.feedLine('§REPLY§' + JSON.stringify({{ success: false, reply: {Web.Json(err)}, error: 'speech_error' }}));");
            CancelListening();
            return;
        }

        holdTimer?.Dispose();
        holdTimer = new System.Windows.Forms.Timer { Interval = 150 };
        holdTimer.Tick += (_, _) =>
        {
            if (!voiceRecording) { holdTimer?.Stop(); return; }
            var held = (DateTime.Now - recordingBegan).TotalSeconds;
            if (held > 60) { holdTimer?.Stop(); StopListening(); return; }
            if (!toggleTalk && !Hooks.ModsHeld()) { holdTimer?.Stop(); StopListening(); }
        };
        holdTimer.Start();
    }

    public async void StopListening()
    {
        if (!voiceRecording) return;
        voiceRecording = false;
        TopMost = false;
        holdTimer?.Stop();
        holdTimer?.Dispose();
        holdTimer = null;

        Js("st.voiceTranscribing(); holoOrb?.setState('thinking');");

        string transcript = null;
        try
        {
            transcript = await Program.Speech.Stop();
        }
        catch (Exception ex)
        {
            Program.Err("Speech.Stop exception: " + ex.Message);
        }

        if (string.IsNullOrWhiteSpace(transcript))
        {
            transcript = liveText?.Trim() ?? "";
        }

        if (!string.IsNullOrWhiteSpace(transcript))
        {
            Js($"st.voiceDone({Web.Json(transcript)});");
            _ = ExecuteDirective(transcript, isVoice: true);
        }
        else
        {
            Sound.Cue("soundStop");
            Js("st.voiceDone(''); holoOrb?.setState('idle');");
        }
    }

    public void CancelListening()
    {
        voiceRecording = false;
        TopMost = false;
        holdTimer?.Stop();
        holdTimer?.Dispose();
        holdTimer = null;
        listenId++;
        Program.Speech.Cancel();
        Sound.Cue("soundStop");
        Js("st.voiceDone(''); holoOrb?.setState('idle');");
    }

    public void TelegramPush() => Js($"st.telegram({Web.Json(new { state = TelegramBridge.State, bot = TelegramBridge.Bot, code = TelegramBridge.Code, paired = TelegramBridge.Chat != 0, error = TelegramBridge.State == "error" ? TelegramBridge.Error : "" })})");

    FloatWindow floating;
    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        if (WindowState == FormWindowState.Minimized && Prefs.D.GetValueOrDefault("floatOrb") is not false) (floating ??= new FloatWindow()).Open();
        else if (WindowState != FormWindowState.Minimized) floating?.Close2();
    }
    public void RestoreFromFloat() { floating?.Close2(); Raise(); }

    bool gestureOn;   // the cursor follows the hand only while the gesture tab says so; Esc always ends it
    void Gesture(string act, JsonElement b)
    {
        if (act == "on") { gestureOn = true; Program.Err("Gesture: on"); return; }
        if (act == "off") { gestureOn = false; Program.Err("Gesture: off"); return; }
        if (!gestureOn) return;
        var v = SystemInformation.VirtualScreen;
        double N(string k) => b.TryGetProperty(k, out var x) && x.ValueKind == JsonValueKind.Number ? x.GetDouble() : 0;
        switch (act)
        {
            case "move": Native.SetCursorPos(v.Left + (int)(Math.Clamp(N("x"), 0, 1) * (v.Width - 1)), v.Top + (int)(Math.Clamp(N("y"), 0, 1) * (v.Height - 1))); break;
            case "click": Native.mouse_event(0x0002, 0, 0, 0, IntPtr.Zero); Native.mouse_event(0x0004, 0, 0, 0, IntPtr.Zero); break;
            case "right": Native.mouse_event(0x0008, 0, 0, 0, IntPtr.Zero); Native.mouse_event(0x0010, 0, 0, 0, IntPtr.Zero); break;
            case "down": Native.mouse_event(0x0002, 0, 0, 0, IntPtr.Zero); break;
            case "up": Native.mouse_event(0x0004, 0, 0, 0, IntPtr.Zero); break;
            case "scroll": Native.mouse_event(0x0800, 0, 0, (int)Math.Clamp(N("dy"), -600, 600), IntPtr.Zero); break;
        }
    }

    public void OnEscape()
    {
        if (gestureOn) { gestureOn = false; Js("window.omaGesture?.stop()"); return; }
        if (Voice.Shush()) return;
        if (voiceRecording)
        {
            CancelListening();
            return;
        }
        CancelCurrentTask();
    }

    string askFile = "";
    bool cancelled;

    void Answer(string v)   // whole, or the waiting side reads it half-written
    {
        var f = askFile; askFile = "";
        if (f == "" || !Path.GetFileName(Path.GetDirectoryName(f) ?? "").StartsWith("atticus-")) return;   // only an answer file the engine made
        try { File.WriteAllText(f + ".tmp", v); File.Move(f + ".tmp", f, true); } catch (Exception ex) { Program.Err("Answer: " + ex.Message); }
    }

    void CancelCurrentTask()
    {
        if (currentProc == null) return;
        cancelled = true;
        try { currentProc.Kill(true); } catch { }
        askFile = "";
        Sound.Cue("soundStop");
    }

    static string Hints()
    {
        var words = new List<string> { "Oma", "Atticus", "Chrome", "VS Code", "Spotify", "Notepad", "Calculator", "নোটপ্যাড", "ক্যালকুলেটর", "ক্রোম" };
        try
        {
            var me = JsonDocument.Parse(File.ReadAllText(Path.Combine(Paths.Config, "me.json"))).RootElement;
            if (me.TryGetProperty("name", out var n) && n.GetString() is { Length: > 0 } nm) words.Add(nm);
        }
        catch { }
        try { foreach (var p in JsonDocument.Parse(File.ReadAllText(Path.Combine(Paths.Config, "skills.json"))).RootElement.EnumerateObject()) words.Add(p.Name); } catch { }
        return string.Join(", ", words.Distinct().Take(40));
    }

    public SettingsWindow() : base("settings.html", "st", "Oma AI", 1260, 820)
    {
        FormClosing += (_, e) => { if (e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; if (Hooks.Recording) Done(0, 0, null); Hide(); perms?.Stop(); } };
    }

    public async void Open(string t = "")
    {
        tab = t;
        Program.Err("SettingsWindow.Open: calling Raise()");
        Raise();
        Program.Err("SettingsWindow.Open: calling Ensure()");
        await Ensure();
        Program.Err("SettingsWindow.Open: Ensure completed, calling Refresh2()");
        Refresh2(); if (t != "") { Js($"st.tab('{t}')"); tab = ""; }
        perms ??= new System.Windows.Forms.Timer { Interval = 1500 };
        perms.Tick -= Perms; perms.Tick += Perms; perms.Start();
        StartTelemetryTimer();
    }
    void Perms(object s, EventArgs e) { if (Visible) Send("st.perms", OnboardingWindow.Perms()); }

    System.Windows.Forms.Timer telemTimer;
    void StartTelemetryTimer()
    {
        telemTimer ??= new System.Windows.Forms.Timer { Interval = 3500 };
        telemTimer.Tick -= TelemetryTick;
        telemTimer.Tick += TelemetryTick;
        telemTimer.Start();
        Task.Run(TelemetryTickCore);
    }
    void TelemetryTick(object s, EventArgs e)
    {
        if (!Visible || WindowState == FormWindowState.Minimized) return;
        Task.Run(TelemetryTickCore);
    }
    void TelemetryTickCore()
    {
        try {
            var h = Health.Json();   // native: no Python/PowerShell process per tick
            Program.Post(() => { if (Visible && WindowState != FormWindowState.Minimized) Js($"st.pcHealth({h})"); });
        } catch (Exception ex) { Program.Err("Health: " + ex.Message); }
    }

    protected override void Loaded() {
        Program.Err("SettingsWindow.Loaded() entered");
        Visible = true;
        BringToFront();
        Zoom(); Push(); Refresh2(); Send("st.perms", OnboardingWindow.Perms()); if (tab != "") { Js($"st.tab('{tab}')"); tab = ""; }
        StartTelemetryTimer();
        Task.Run(() => {
            try {
                var ts = Py.Run(new[] { "--task-state" });
                if (ts.TrimStart().StartsWith("{")) Program.Post(() => Js($"st.taskState({ts})"));
            } catch { }
        });
        var today = DateTime.Now.ToString("yyyy-MM-dd");
        if (Prefs.D.GetValueOrDefault("brief") is not false && Prefs.Str("briefDate") != today)   // the first open of the day: Stonic-style opening line, no AI
        {
            Prefs.Set("briefDate", today);
            Task.Run(() => { var j = Py.Run(new[] { "--brief" }, 40); if (j.TrimStart().StartsWith("{")) Program.Post(() => Js($"st.brief({j})")); });
        }
        Task.Run(() => {
            try {
                var notes = Py.Run(new[] { "--notes-list" });
                if (notes.TrimStart().StartsWith("[")) Program.Post(() => Js($"st.notesList({notes})"));
            } catch { }
        });
    }

    static readonly SemaphoreSlim askLock = new(1, 1);

    static string SanitizeError(string err)
    {
        if (string.IsNullOrWhiteSpace(err)) return "";
        var lines = err.Split('\n').Select(l => l.Trim()).Where(l => l.Length > 0).TakeLast(5);
        var s = string.Join(" ", lines);
        s = System.Text.RegularExpressions.Regex.Replace(s, @"(sk-[a-zA-Z0-9_\-]{8,}|key-[a-zA-Z0-9_\-]{8,})", "[REDACTED_KEY]");
        return s.Length > 300 ? s[..300] + "..." : s;
    }

    public void Push()   // the settings, and the app icon for the sidebar
    {
        if (web == null) return;
        Program.Err("SettingsWindow.Push() entered");
        var d = new Dictionary<string, object> { ["prefs"] = Prefs.D, ["version"] = Paths.Install("version"), ["update"] = Updater.Status == "" ? (Updater.Pending ? "Update ready. Restarting when you’re not using it…" : "") : Updater.Status, ["sounds"] = Sound.All() };
        var png = Path.Combine(Paths.App, "ui", "AppIcon.png");
        if (File.Exists(png)) d["icon"] = "data:image/png;base64," + Convert.ToBase64String(File.ReadAllBytes(png));
        Js($"st.load({Web.Json(d)})");
        Program.Err("SettingsWindow.Push() completed");
    }

    // usage, saved rules, Claude plan: atticus.py --state (it runs Claude Code, so off the UI thread)
    void Refresh2() => Task.Run(() => { var s = Py.Run(new[] { "--state" }); if (s.StartsWith("{")) Program.Post(() => Js($"st.state({s})")); });

    void Helper(params string[] args) => Task.Run(() => { Py.Run(args); Program.Post(Refresh2); });

    public void Apply(string k, object v)   // one setting changed, from this window or by voice (atticus.py --set)
    {
        Prefs.Set(k, v);
        if (k == "speak" && v is false) Voice.Shush();
        if (k == "muted" && v is true) { Voice.Shush(); if (voiceRecording) CancelListening(); }
        if (k == "menuIcon") Program.Tray.Visible = v is true;
        if (k == "paused" && v is true) Program.Box.Close(false);
        if (k == "safe") Program.Box.js("mode", v is true);
        if (k == "speechModel") _ = Program.Speech.Load();
        if (k is "speechEngine" or "speechLanguage") Program.Speech.Reload();
        if (k == "login") Startup(v is true);
        if (k is "aiMode" or "activeModel" or "aiFallback" or "aiFallbackOrder" or "healthInterval") ProviderHealth.Refresh("settings");
        if (k == "uiScale") Zoom();
    }

    // the page zoom from Settings (uiScale, 80-130 %, default 100)
    void Zoom()
    {
        if (web == null) return;
        var s = Prefs.Num("uiScale");
        if (s <= 0 && double.TryParse(Prefs.Str("uiScale"), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var p)) s = p;
        try { web.ZoomFactor = Math.Clamp(s > 0 ? s : 100, 80, 130) / 100.0; } catch (Exception e) { Program.Err("zoom: " + e.Message); }
    }

    public static void Startup(bool on)
    {
        using var run = Microsoft.Win32.Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run");
        run.DeleteValue("Atticus", false);
        if (on) run.SetValue("Oma AI", $"\"{Environment.ProcessPath}\""); else run.DeleteValue("Oma AI", false);
    }

    void Record()
    {
        if (Hooks.Recording) return;
        Hooks.RecordingMods = m => Program.Post(() => Js($"st.rec({Web.Json(m)})"));
        Hooks.Recorded = (vk, mods, label) => Program.Post(() => Done(vk, mods, label));
        Hooks.Recording = true;
    }

    void Done(int vk, int mods, string label)
    {
        Hooks.Recording = false;
        if (label != null && vk != 0) { Prefs.Set("hotkeyCode", vk); Prefs.Set("hotkeyMods", mods); Prefs.Set("hotkeyLabel", label); }
        Push();
    }

    protected override void OnDeactivate(EventArgs e) { base.OnDeactivate(e); if (Hooks.Recording) Done(0, 0, null); }

    protected override void OnMessage(JsonElement b)
    {
        if (b.ValueKind != JsonValueKind.Object) return;
        string S(string k) => b.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        if (b.TryGetProperty("msg", out var errMsg))
        {
            Program.Err("JS Error: " + errMsg.GetString() + " at " + S("file") + ":" + (b.TryGetProperty("line", out var l) ? l.ToString() : "0"));
            return;
        }
        if (!b.TryGetProperty("do", out var d)) return;
        Program.Err("OnMessage do=" + d.GetString());
        switch (d.GetString())
        {
            case "set":
                if (S("k") is not { } k || !b.TryGetProperty("v", out var v)) return;
                Apply(k, v.ValueKind switch { JsonValueKind.True => true, JsonValueKind.False => false, JsonValueKind.Number => v.GetDouble(), _ => (object)v.GetString() });
                break;
            case "record": Record(); break;
            case "cancelRecord": if (Hooks.Recording) Done(0, 0, null); break;
            case "unlearn": if (S("say") is { } say) Helper("--unlearn", say); break;
            case "checkUpdate": Updater.Check(Push); break;
            case "github": Web.Open("https://github.com/0matbank/oma-ai-agent"); break;
            case "resetHotkey": Prefs.Set("hotkeyCode", 0x20); Prefs.Set("hotkeyMods", 3); Prefs.Set("hotkeyLabel", "Ctrl+Alt+Space"); Push(); break;
            case "preview": if (S("sound") is { } n) Sound.Play(n, Prefs.Num("volume") * 2); break;
            case "setup": Program.Onboarding.Open(); break;
            case "openLog": if (File.Exists(Paths.Log)) Web.Open(Paths.Log); break;
            case "clearRecent": try { File.Delete(Paths.Recent); } catch { } Program.Box.lastDone = DateTime.MinValue; break;
            case "me": if (S("what") is { } w && S("text") is { } t) Helper("--me", w, t); break;
            case "forget": case "remember": if (S("line") is { } line) Helper("--" + d.GetString(), line); break;
            case "grant": if (S("id") is { } id) Program.Onboarding.Grant(id); break;
            case "integrations": Task.Run(() => { var j = Py.Run(new[] { "--int-list" }); if (j.TrimStart().StartsWith("[")) Program.Post(() => Js($"st.integrations({j})")); }); break;
            case "intCustom":
                if (!b.TryGetProperty("values", out var ov)) return;
                var olines = string.Join("\n", ov.EnumerateObject().Select(p => p.Name + "=" + (p.Value.GetString() ?? "").Replace("\n", " ")));
                Task.Run(() =>
                {
                    var r = Py.RunWithInput(new[] { "--int-custom" }, olines + "\n", 30);
                    var j = Py.Run(new[] { "--int-list" });
                    Program.Post(() => { if (j.TrimStart().StartsWith("[")) Js($"st.integrations({j})"); Js($"st.ownResult({Web.Json(r)})"); });
                });
                break;
            case "intFolder": Task.Run(() => Py.Run(new[] { "--int-folder" })); break;
            case "intRemove":
                if (S("name") is { } rn) Task.Run(() => { Py.Run(new[] { "--int", rn, "remove" }); var j = Py.Run(new[] { "--int-list" }); if (j.TrimStart().StartsWith("[")) Program.Post(() => Js($"st.integrations({j})")); });
                break;
            case "intSave":
                if (S("name") is not { } name || !b.TryGetProperty("values", out var vals)) return;
                var lines = string.Join("\n", vals.EnumerateObject().Select(p => p.Name + "=" + (p.Value.GetString() ?? "").Replace("\n", "")));
                Task.Run(() =>
                {
                    var r = Py.RunWithInput(new[] { "--int", name, "setup" }, lines + "\n", 30);
                    var j = Py.Run(new[] { "--int-list" });   // redraw (now "On"), then show what the test said
                    Program.Post(() => { if (j.TrimStart().StartsWith("[")) Js($"st.integrations({j})"); Js($"st.intResult({Web.Json(new[] { name, r })})"); });
                });
                break;
            case "omaBrowser": Task.Run(() => Py.Run(new[] { "--browser", "open", "https://accounts.google.com" })); break;   // sign in to sites once
            case "telegramConnect":
                if (S("token") is { } tok) Task.Run(() => { Py.RunWithInput(new[] { "--secret-set", "remote_telegram" }, tok.Trim() + "\n", 15); Prefs.Set("telegramChat", 0.0); TelegramBridge.Start(); });
                break;
            case "telegramDisconnect":
                TelegramBridge.Stop(); Prefs.Set("telegramChat", 0.0);
                Task.Run(() => Py.RunWithInput(new[] { "--secret-set", "remote_telegram" }, "\n", 15)); TelegramPush();
                break;
            case "telegramStatus": TelegramPush(); break;
            case "orbState": floating?.SetState(S("s") ?? "idle", S("theme") ?? ""); break;
            case "gesture": if (S("act") is { } ga) Gesture(ga, b); break;
            case "providerHealth":
                if (ProviderHealth.Last != "") Js($"st.providerHealth({ProviderHealth.Last})");
                ProviderHealth.Refresh("opened");
                break;
            case "providers":
                Task.Run(() => {
                    var j = Py.Run(new[] { "--providers-list" });
                    if (j.TrimStart().StartsWith("{") || j.TrimStart().StartsWith("["))
                        Program.Post(() => Js($"st.providers({j})"));
                });
                break;
            case "providerTest":
                if (S("id") is { } ptId) {
                    Task.Run(() => {
                        var r = Py.Run(new[] { "--provider-test", ptId });
                        if (!r.TrimStart().StartsWith("{")) r = Web.Json(new { id = ptId, ok = false, status = "ERROR", message = "The test did not answer (timed out or failed)." });
                        Program.Post(() => Js($"st.providerTestResult({r})"));
                    });
                }
                break;
            case "providerSave":
                if (S("id") is { } psId && b.TryGetProperty("values", out var pvals)) {
                    var pLines = string.Join("\n", pvals.EnumerateObject().Select(p => p.Name + "=" + (p.Value.GetString() ?? "").Replace("\n", "")));
                    Task.Run(() => {
                        var r = Py.RunWithInput(new[] { "--provider-save", psId }, pLines + "\n", 30);
                        var j = Py.Run(new[] { "--providers-list" });
                        Program.Post(() => {
                            if (j.TrimStart().StartsWith("{") || j.TrimStart().StartsWith("[")) Js($"st.providers({j})");
                            Js($"st.providerSaveResult({Web.Json(r)})");
                        });
                    });
                }
                break;
            case "providerRemove":
                if (S("id") is { } prId) {
                    Task.Run(() => {
                        Py.Run(new[] { "--provider-remove", prId });
                        ProviderHealth.Refresh("settings");
                        var j = Py.Run(new[] { "--providers-list" });
                        if (j.TrimStart().StartsWith("{") || j.TrimStart().StartsWith("[")) Program.Post(() => Js($"st.providers({j})"));
                    });
                }
                break;
            case "ask":
                var attached = SaveFiles(b);   // files the user dropped in: the engine gets their paths
                if (S("text") != null || attached != "")
                    _ = ExecuteDirective((S("text") ?? "") + attached, isVoice: false, image: SaveImage(S("image")));
                break;
            case "minimize": WindowState = FormWindowState.Minimized; break;   // the floating orb opens by itself (OnResize)
            case "history": Task.Run(() => { var j = Py.Run(new[] { "--history-list" }); Program.Post(() => Js($"st.history({(j.TrimStart().StartsWith("[") ? j : Web.Json(new { error = "Could not read the history." }))})")); }); break;
            case "browserSites": BrowserSites(); break;
            case "browserStatus":   // opens each site in a background tab of Oma's browser; can take a while
                var bids = b.TryGetProperty("ids", out var bi) && bi.ValueKind == JsonValueKind.Array ? bi.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()) : Enumerable.Empty<string>();
                var bargs = new[] { "--browser", "status" }.Concat(bids).ToArray();
                Task.Run(() => { var j = Py.Run(bargs, 90); Program.Post(() => Js($"st.browserStatus({(j.TrimStart().StartsWith("[") ? j : Web.Json(new { error = "The sign-in check did not answer (timed out or failed)." }))})")); });
                break;
            case "browserLogin": if (S("site") is { } bl) BrowserRun(new[] { "--browser", "login", bl }, false); break;
            case "browserAccount": if (S("site") is { } ba) BrowserRun(new[] { "--browser", "account", ba, S("email") ?? "" }, true); break;
            case "browserAddSite": if (S("name") is { } bn && S("url") is { } bu) BrowserRun(new[] { "--browser", "add-site", bn, bu }, true); break;
            case "browserRemoveSite": if (S("site") is { } br) BrowserRun(new[] { "--browser", "remove-site", br }, true); break;
            case "browserClose": BrowserRun(new[] { "--browser", "close" }, false); break;
            case "browserSignOutAll": BrowserRun(new[] { "--browser", "signout-all" }, true, 60); break;
            case "cliLogin": if (S("id") is { } cl) BrowserRun(new[] { "--cli-login", cl }, false); break;   // the CLI's own sign-in window
            case "headlines":
                var refresh = b.TryGetProperty("refresh", out var rf) && rf.ValueKind == JsonValueKind.True;
                Task.Run(() => { var j = Py.Run(refresh ? new[] { "--headlines", "refresh" } : new[] { "--headlines" }, 40); if (j.TrimStart().StartsWith("{")) Program.Post(() => Js($"st.headlines({j})")); });
                break;
            case "memoryList": Task.Run(() => { var j = Py.Run(new[] { "--memory-list" }); if (j.TrimStart().StartsWith("{")) Program.Post(() => Js($"st.memory({j})")); }); break;
            case "skillSave":
                if (b.TryGetProperty("skill", out var sk)) { var sj = sk.GetRawText(); Task.Run(() => { var r = Py.RunWithInput(new[] { "--skill-save" }, sj, 20); Program.Post(() => Js($"st.skillSaved({Web.Json(r)})")); }); }
                break;
            case "skillDelete": if (S("name") is { } skn) Task.Run(() => Py.Run(new[] { "--skill-delete", skn })); break;
            case "openMonitor": MonitorWindow.Show(S("url") ?? "https://www.worldmonitor.app/"); break;
            case "talk":
            case "micToggle":
                Program.Post(() => {
                    if (voiceRecording) StopListening();
                    else StartListening(true);
                });
                break;
            case "voiceCancel":
                Program.Post(CancelListening);
                break;
            case "workersStatus":
                Task.Run(() => {
                    var j = Py.Run(new[] { "--task-state" });
                    if (j.TrimStart().StartsWith("{")) Program.Post(() => Js($"st.taskState({j})"));
                });
                break;
            case "pcHealth":
                Task.Run(() => { var j = Health.Json(); Program.Post(() => Js($"st.pcHealth({j})")); });
                break;
            case "answer":   // the user's answer to the safety gate, the retry card or a "which one?" card
                if (askFile != "" && b.TryGetProperty("v", out var av)) Answer(av.ValueKind == JsonValueKind.String ? av.GetString() ?? "" : av.ToString());
                break;
            case "cancelTask":
                Program.Post(CancelCurrentTask);
                break;
            case "notesList":
                Task.Run(() => {
                    var j = Py.Run(new[] { "--notes-list" });
                    if (j.TrimStart().StartsWith("[")) Program.Post(() => Js($"st.notesList({j})"));
                });
                break;
            case "notesSave":
                if (b.TryGetProperty("note", out var nEl)) {
                    var nJson = nEl.GetRawText();
                    Task.Run(() => {
                        Py.RunWithInput(new[] { "--notes-save" }, nJson + "\n", 15);
                        var j = Py.Run(new[] { "--notes-list" });
                        if (j.TrimStart().StartsWith("[")) Program.Post(() => Js($"st.notesList({j})"));
                    });
                }
                break;
            case "notesDelete":
                if (S("id") is { } ndId) {
                    Task.Run(() => {
                        Py.Run(new[] { "--notes-delete", ndId });
                        var j = Py.Run(new[] { "--notes-list" });
                        if (j.TrimStart().StartsWith("[")) Program.Post(() => Js($"st.notesList({j})"));
                    });
                }
                break;
            case "openOverlay":
                Program.Post(() => Open());
                break;
            case "quit": Application.Exit(); break;
        }
    }

    static string ReplyJson(string status, string reply, string error, string reqId) =>
        "§REPLY§" + JsonSerializer.Serialize(new { success = status == "COMPLETED", status, reply, error, req_id = reqId });

    // One request from the Oma window through the original Atticus pipeline (atticus.py --oma-ask). Every line it prints
    // is a real engine event; the final §REPLY§ carries COMPLETED / PARTIAL / FAILED. Safety-gate questions, "which one?"
    // choices and setting changes are answered here, exactly like the classic overlay.
    // Media Link: the page sends a JPEG data URL; it becomes a temp file the engine attaches to this one request
    static string SaveImage(string dataUrl)
    {
        if (string.IsNullOrEmpty(dataUrl) || !dataUrl.StartsWith("data:image/jpeg;base64,")) return "";
        try
        {
            var dir = Directory.CreateDirectory(Path.Combine(Path.GetTempPath(), "atticus-media")).FullName;
            var f = Path.Combine(dir, Guid.NewGuid().ToString("N")[..10] + ".jpg");
            File.WriteAllBytes(f, Convert.FromBase64String(dataUrl[23..]));
            return f;
        }
        catch { return ""; }
    }

    // Files dropped in the Oma window ("files": [{name, data URL}]): saved to %TEMP%\oma-attach\<unique>\, one line each for the engine
    static string SaveFiles(JsonElement b)
    {
        if (!b.TryGetProperty("files", out var fs) || fs.ValueKind != JsonValueKind.Array) return "";
        var lines = "";
        string dir = null;
        foreach (var f in fs.EnumerateArray().Take(5))
        {
            try
            {
                if (f.ValueKind != JsonValueKind.Object || !f.TryGetProperty("data", out var dv) || dv.ValueKind != JsonValueKind.String) continue;
                var data = dv.GetString() ?? "";
                var comma = data.IndexOf(',');
                if (!data.StartsWith("data:") || comma < 0 || !data[..comma].EndsWith(";base64")) continue;
                if ((data.Length - comma - 1) / 4L * 3 > 20L * 1024 * 1024) { Program.Err("attachment over 20 MB skipped"); continue; }
                var name = f.TryGetProperty("name", out var nv) && nv.ValueKind == JsonValueKind.String ? Path.GetFileName(nv.GetString() ?? "") : "";
                name = string.Concat(name.Select(ch => Path.GetInvalidFileNameChars().Contains(ch) ? '_' : ch)).Trim().TrimEnd('.');
                if (name == "") name = "file";
                if (name.Length > 100) name = name[..60] + name[^40..];
                dir ??= Directory.CreateDirectory(Path.Combine(Path.GetTempPath(), "oma-attach", Guid.NewGuid().ToString("N")[..10])).FullName;
                var path = Path.Combine(dir, name);
                for (var n = 2; File.Exists(path); n++) path = Path.Combine(dir, Path.GetFileNameWithoutExtension(name) + $" ({n})" + Path.GetExtension(name));
                File.WriteAllBytes(path, Convert.FromBase64String(data[(comma + 1)..]));
                lines += $"\n[Attached file: {path}]";
            }
            catch (Exception e) { Program.Err("attachment: " + e.Message); }
        }
        return lines;
    }

    // Settings > Integrations > Oma's browser: sign-in sites and their state (atticus.py --browser ...)
    void BrowserSites() => Task.Run(() => { var j = Py.Run(new[] { "--browser", "sites" }); Program.Post(() => Js($"st.browserSites({(j.TrimStart().StartsWith("[") ? j : Web.Json(new { error = "Could not list the sites." }))})")); });

    // one browser or sign-in action -> st.browserResult({ok, message, action}); refresh: redraw the site list after it
    void BrowserRun(string[] args, bool refresh, int secs = 30) => Task.Run(() =>
    {
        var r = Py.Run(args, secs).Trim();
        var ok = r != "" && !r.StartsWith("Error");
        Program.Post(() => Js($"st.browserResult({Web.Json(new { ok, message = r == "" ? "No answer (timed out or failed)." : r, action = args[0] == "--cli-login" ? "cli-login" : args[1] })})"));
        if (refresh) BrowserSites();
    });

    Action<string> remoteDone;   // a request from the phone (Telegram): its result goes back there too
    public void RemoteAsk(string text, Action<string> done)
    {
        remoteDone = done;
        Js($"st.remoteIn({Web.Json(text)})");
        _ = ExecuteDirective(text, isVoice: false, source: "telegram");
    }
    public void RemoteAnswer(string v) { Answer(v); Js("st.remoteAnswered && st.remoteAnswered()"); }

    public async Task ExecuteDirective(string askText, bool isVoice, string image = "", string source = null)
    {
        if (string.IsNullOrWhiteSpace(askText)) return;
        var reqId = Guid.NewGuid().ToString("N")[..8];
        if (!await askLock.WaitAsync(100))
        {
            var busy = ReplyJson("FAILED", "Oma is still working on the previous request. Wait for it to finish or press TERMINATE.", "busy", reqId);
            if (source == "telegram") { remoteDone?.Invoke("✕ Oma is busy with another request. Try again in a moment."); remoteDone = null; }
            Program.Post(() => Js($"st.feedLine({Web.Json(busy)})"));
            return;
        }
        Process p = null;
        cancelled = false;
        try
        {
            string status = null, replyText = null;
            p = Py.Start(new[] { "--oma-ask", askText }, new() { ["ATTICUS_UI"] = "1", ["ATTICUS_FRONT"] = Hooks.Mine ?? "", ["OMA_SOURCE"] = source ?? (isVoice ? "voice" : "typed"), ["OMA_REQ_ID"] = reqId, ["OMA_IMAGE"] = image ?? "" });
            currentProc = p;
            var errTask = p.StandardError.ReadToEndAsync();
            var lineTask = Task.Run(async () =>
            {
                while (await p.StandardOutput.ReadLineAsync() is { } line)
                {
                    var l = line;
                    if (l.StartsWith("§REPLY§"))
                    {
                        try
                        {
                            var rep = JsonDocument.Parse(l[7..]).RootElement;
                            status = rep.TryGetProperty("status", out var st) ? st.GetString() : null;
                            replyText = rep.TryGetProperty("reply", out var rv) ? rv.GetString() : null;
                            Program.Err($"Ask {reqId} ({(isVoice ? "voice" : "typed")}): task {(rep.TryGetProperty("task_id", out var tid) ? tid.GetString() : "?")} {status} via {(rep.TryGetProperty("provider_used", out var pu) ? pu.GetString() : "?")}/{(rep.TryGetProperty("model_used", out var mu) ? mu.GetString() : "?")}");
                        }
                        catch { }
                    }
                    Program.Post(() => OnEngineLine(l));
                }
            });
            // a task may wait up to 60 s for an Allow and run long tools: 5 minutes, then it is stopped and reported
            var completed = await Task.WhenAny(lineTask, Task.Delay(TimeSpan.FromMinutes(5)));
            if (completed != lineTask)
            {
                try { p.Kill(true); } catch { }
                Program.Post(() => Js($"st.feedLine({Web.Json(ReplyJson("FAILED", "Stopped after 5 minutes without a result.", "timeout", reqId))})"));
                return;
            }
            await p.WaitForExitAsync();
            string errOutput = "";
            try { errOutput = await errTask; } catch { }
            if (cancelled)
                Program.Post(() => Js($"st.feedLine({Web.Json(ReplyJson("CANCELLED", "You stopped this request.", "cancelled by user", reqId))})"));
            else if (status == null)
            {
                var why = SanitizeError(errOutput);
                if (string.IsNullOrWhiteSpace(why)) why = p.ExitCode != 0 ? $"atticus.py exited with code {p.ExitCode}" : "The engine ended without a result.";
                Program.Err($"Ask {reqId} ended without a reply: {why}");
                Program.Post(() => Js($"st.feedLine({Web.Json(ReplyJson("FAILED", "The request ended without a result.", why, reqId))})"));
            }
            if (source == "telegram" && remoteDone != null)
            {
                remoteDone((status == "COMPLETED" ? "✓ " : status == "PARTIAL" ? "⚠ " : "✕ ") + (status ?? "FAILED") + "\n" + (replyText ?? (cancelled ? "Stopped on the PC." : "No result.")));
                remoteDone = null;
            }
            if (cancelled || status == null) { }
            else
            {
                Sound.Cue(status == "COMPLETED" ? "soundDone" : "soundStop");
                if (!string.IsNullOrWhiteSpace(replyText))
                {
                    if (Prefs.Bool("autoCopy")) { var t = replyText; Program.Post(() => { try { Clipboard.SetText(t); } catch { } }); }
                    if ((isVoice || Prefs.Bool("speak")) && !Prefs.Bool("muted")) { var t = replyText; Program.Post(() => { Js("holoOrb?.setState('speaking')"); Voice.Say(t, () => Js("holoOrb?.setState('idle')")); }); }
                }
            }
        }
        catch (Exception ex)
        {
            Program.Err($"Ask exception ({reqId}): {ex.Message}");
            Program.Post(() => Js($"st.feedLine({Web.Json(ReplyJson("FAILED", "Internal error in the Oma app.", ex.Message, reqId))})"));
        }
        finally
        {
            if (currentProc == p) currentProc = null;
            p?.Dispose();
            if (!string.IsNullOrEmpty(image)) try { File.Delete(image); } catch { }
            askFile = "";
            askLock.Release();
            Program.Post(() => Js("st.feedDone()"));
            ProviderHealth.Reload();   // the engine recorded this request's outcome: show it
        }
    }

    // Lines from the engine, on the UI thread.
    void OnEngineLine(string line)
    {
        if (line == "! setup") { Program.Onboarding.Open(); return; }
        if (line.StartsWith("▶ {")) { Js($"st.player({line[2..]})"); return; }   // {ME} --player: the neural player   // Claude not installed, signed out or no plan
        if (line.StartsWith("@ ")) { Ring.At(line); return; }   // experimental "show me where"
        if (line.StartsWith("? "))   // "? <question>\t<command>\t<answer file>[\t<escalate>[\tretry]]"
        {
            var q = line[2..].Split('\t');
            if (q.Length is < 3 or > 5) return;
            askFile = q[2];
            var retry = q.Length == 5 && q[4] == "retry";
            Js($"st.askCard({Web.Json(new { q = q[0], cmd = retry ? "" : q[1], kind = retry ? "retry" : "permission", escalate = q.Length >= 4 && q[3] == "escalate" })})");
            if (remoteDone != null && !retry) TelegramBridge.AskPhone(q[0], q[1]);   // the request came from the phone: ask there too
            if (!Visible || WindowState == FormWindowState.Minimized) Raise();
            return;
        }
        if (line.StartsWith("◇ "))   // "which one?"
        {
            try
            {
                using var d = JsonDocument.Parse(line[2..]);
                askFile = d.RootElement.GetProperty("a").GetString() ?? "";
                Js($"st.pickCard({Web.Json(new { q = d.RootElement.GetProperty("q").GetString(), options = d.RootElement.GetProperty("options") })})");
            }
            catch { }
            return;
        }
        if (line.StartsWith("⚙ "))   // the AI changes one of the settings; never pause, and Safe mode only on
        {
            var q = line.Split(' ');
            if (q.Length != 3 || q[1] == "paused") return;
            var def = Prefs.Defaults.GetValueOrDefault(q[1]);
            if (def is bool && (q[1] != "safe" || q[2] == "true")) Apply(q[1], q[2] == "true");
            else if (def is string) Apply(q[1], q[2]);
            else return;
            Push();
            return;
        }
        Js($"st.feedLine({Web.Json(line)})");
    }
}

sealed class OnboardingWindow : PageWindow
{
    System.Windows.Forms.Timer timer;
    bool downloading;
    public OnboardingWindow() : base("onboarding.html", "ob", "Welcome to Oma AI", 640, 640)
    {
        FormClosing += (_, e) => { if (e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; Hide(); timer?.Stop(); } };
    }

    public async void Open()
    {
        Raise();
        await Ensure();
        int tick = 0;
        timer ??= new System.Windows.Forms.Timer { Interval = 50 };   // keys 20×/s, permissions 1×/s, Claude every 5 s
        timer.Tick += (_, _) =>
        {
            if (!Visible) return;
            Js($"ob.keys({(Native.Down(Native.VK_CONTROL) ? "true" : "false")}, {(Native.Down(Native.VK_MENU) ? "true" : "false")})");
            tick++;
            if (tick % 20 == 1) Push();
            if (tick % 100 == 1) CheckPlan();
        };
        timer.Start();
    }

    void Push()
    {
        Send("ob.set", Perms());
        Js($"ob.mode({(Prefs.Str("talkMode") == "toggle" ? "true" : "false")})");
    }

    public static Dictionary<string, bool> Perms() => new() { ["mic"] = Speech.MicAllowed(), ["speech"] = File.Exists(Paths.Model) };

    // Claude Code installed, signed in, on a paid plan? (atticus.py --check)
    public static JsonElement Plan()
    {
        var s = Py.Run(new[] { "--check" }, 30);
        try { return JsonDocument.Parse(s).RootElement.Clone(); }
        catch { return JsonDocument.Parse("{\"ok\":false,\"need\":\"install\",\"text\":\"Could not run Atticus's helper (Python missing? Run build.ps1 again).\"}").RootElement.Clone(); }
    }

    void CheckPlan() => Task.Run(() => { var c = Plan(); Program.Post(() => Js($"ob.plan({c.GetRawText()})")); });

    // The Claude row's button: install Claude Code, sign in, or upgrade, in a terminal window the user can watch.
    void FixPlan() => Task.Run(() =>
    {
        var need = Plan().TryGetProperty("need", out var n) ? n.GetString() : "";
        if (need == "upgrade") { Web.Open("https://claude.ai/upgrade"); return; }
        var cmd = need == "install" ? "irm https://claude.ai/install.ps1 | iex; & \"$env:USERPROFILE\\.local\\bin\\claude.exe\" auth login" : "& claude auth login";
        Process.Start(new ProcessStartInfo("powershell.exe", $"-NoProfile -ExecutionPolicy Bypass -NoExit -Command \"$env:Path = \\\"$env:USERPROFILE\\.local\\bin;$env:Path\\\"; Write-Host 'Atticus: setting up Claude Code'; {cmd.Replace("\"", "\\\"")}; Write-Host; Write-Host 'Done. You can close this window.'\"") { UseShellExecute = true });
        Program.Post(CheckPlan);
    });

    public void Tried() => Js("ob.tried()");

    public void Grant(string id)
    {
        switch (id)
        {
            case "mic": Web.Open("ms-settings:privacy-microphone"); break;
            case "claude": FixPlan(); break;
            case "speech": GetModel(); break;
        }
    }

    async void GetModel()   // the speech model, once: progress shows in the row
    {
        if (downloading || File.Exists(Paths.Model)) return;
        downloading = true;
        var ok = await Speech.Download(p => Program.Post(() => Js($"ob.progress && ob.progress('speech', {p:0.###})")));
        downloading = false;
        if (ok) await Program.Speech.Load();
        Push();
        Program.Settings.Js("st.perms && st.perms(" + Web.Json(Perms()) + ")");
    }

    protected override void OnMessage(JsonElement b)
    {
        if (b.ValueKind != JsonValueKind.Object) return;
        if (b.TryGetProperty("do", out var d) && d.GetString() == "done") { Prefs.Set("onboarded", true); Hide(); timer?.Stop(); return; }
        if (b.TryGetProperty("id", out var id)) Grant(id.GetString() ?? "");
    }
}
