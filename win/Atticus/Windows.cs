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
            Js("st.voiceDone(''); holoOrb?.setState('active');");
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
        Js("st.voiceDone(''); holoOrb?.setState('active');");
    }

    public void OnEscape()
    {
        if (Voice.Shush()) return;
        if (voiceRecording)
        {
            CancelListening();
            return;
        }
        CancelCurrentTask();
    }

    void CancelCurrentTask()
    {
        if (currentProc != null)
        {
            try { currentProc.Kill(true); } catch { }
            currentProc = null;
            Js("st.feedLine('§EVENT§' + JSON.stringify({ stage: 'completed', detail: 'Directive cancelled by user.', pct: 100 }));");
            Js("st.feedDone();");
            Sound.Cue("soundStop");
        }
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
    }
    void Perms(object s, EventArgs e) { if (Visible) Send("st.perms", OnboardingWindow.Perms()); }

    protected override void Loaded() {
        Program.Err("SettingsWindow.Loaded() entered");
        Visible = true;
        BringToFront();
        Push(); Refresh2(); Send("st.perms", OnboardingWindow.Perms()); if (tab != "") { Js($"st.tab('{tab}')"); tab = ""; }
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
        if (k == "menuIcon") Program.Tray.Visible = v is true;
        if (k == "paused" && v is true) Program.Box.Close(false);
        if (k == "safe") Program.Box.js("mode", v is true);
        if (k == "speechModel") _ = Program.Speech.Load();
        if (k == "login") Startup(v is true);
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
                        var j = Py.Run(new[] { "--providers-list" });
                        if (j.TrimStart().StartsWith("{") || j.TrimStart().StartsWith("[")) Program.Post(() => Js($"st.providers({j})"));
                    });
                }
                break;
            case "ask":
                if (S("text") is { } askText)
                    _ = ExecuteDirective(askText, isVoice: false);
                break;
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
            case "openOverlay":
                Program.Post(() => Open());
                break;
            case "quit": Application.Exit(); break;
        }
    }

    public async Task ExecuteDirective(string askText, bool isVoice)
    {
        if (string.IsNullOrWhiteSpace(askText)) return;
        var reqId = Guid.NewGuid().ToString("N")[..8];
        if (!await askLock.WaitAsync(100))
        {
            var busyMsg = "§REPLY§" + JsonSerializer.Serialize(new {
                success = false,
                reply = "Oma AI is currently processing another directive. Please wait a moment.",
                error = "concurrency_busy",
                req_id = reqId
            });
            Program.Post(() => {
                Js($"st.feedLine({Web.Json(busyMsg)})");
                Js("st.feedDone()");
            });
            return;
        }

        Process p = null;
        try
        {
            bool gotReply = false;
            string replyTextToSpeak = null;

            p = Py.Start(new[] { "--oma-ask", askText });
            currentProc = p;
            var errTask = p.StandardError.ReadToEndAsync();
            var lineTask = Task.Run(async () =>
            {
                while (await p.StandardOutput.ReadLineAsync() is { } line)
                {
                    var l = line;
                    if (l.StartsWith("§REPLY§"))
                    {
                        gotReply = true;
                        try
                        {
                            var rep = JsonDocument.Parse(l[7..]).RootElement;
                            if (rep.TryGetProperty("reply", out var rVal))
                                replyTextToSpeak = rVal.GetString();
                        }
                        catch { }
                    }
                    else if (l.StartsWith("— "))
                    {
                        gotReply = true;
                        replyTextToSpeak = l[2..];
                    }
                    Program.Post(() => Js($"st.feedLine({Web.Json(l)})"));
                }
            });

            var completed = await Task.WhenAny(lineTask, Task.Delay(90000));
            if (completed != lineTask)
            {
                try { p.Kill(true); } catch { }
                var timeoutMsg = "§REPLY§" + JsonSerializer.Serialize(new {
                    success = false,
                    reply = "Request timed out after 90 seconds. The process was stopped.",
                    error = "timeout",
                    req_id = reqId
                });
                Program.Post(() => Js($"st.feedLine({Web.Json(timeoutMsg)})"));
            }
            else
            {
                await p.WaitForExitAsync();
                string errOutput = "";
                try { errOutput = await errTask; } catch { }

                if (!gotReply || p.ExitCode != 0)
                {
                    string cleanErr = SanitizeError(errOutput);
                    if (string.IsNullOrWhiteSpace(cleanErr))
                    {
                        cleanErr = p.ExitCode != 0 ? $"Process exited with code {p.ExitCode}" : "No response generated by model.";
                    }
                    var failMsg = "§REPLY§" + JsonSerializer.Serialize(new {
                        success = false,
                        reply = $"Execution failed: {cleanErr}",
                        error = cleanErr,
                        req_id = reqId
                    });
                    Program.Post(() => Js($"st.feedLine({Web.Json(failMsg)})"));
                }
                else
                {
                    Sound.Cue("soundDone");
                    if ((isVoice || Prefs.Bool("speak")) && !string.IsNullOrWhiteSpace(replyTextToSpeak))
                    {
                        Voice.Say(replyTextToSpeak, () => {});
                    }
                }
            }
        }
        catch (Exception ex)
        {
            Program.Err($"Ask exception ({reqId}): {ex.Message}");
            var exMsg = "§REPLY§" + JsonSerializer.Serialize(new {
                success = false,
                reply = $"Internal system error: {ex.Message}",
                error = ex.Message,
                req_id = reqId
            });
            Program.Post(() => Js($"st.feedLine({Web.Json(exMsg)})"));
        }
        finally
        {
            if (currentProc == p) currentProc = null;
            p?.Dispose();
            askLock.Release();
            Program.Post(() => Js("st.feedDone()"));
        }
    }
}

sealed class OnboardingWindow : PageWindow
{
    System.Windows.Forms.Timer timer;
    bool downloading;
    public OnboardingWindow() : base("onboarding.html", "ob", "Welcome to Atticus", 640, 640)
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
