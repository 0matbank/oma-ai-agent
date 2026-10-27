// The pages in ui\ were written for macOS's WKWebView: they post to window.webkit.messageHandlers.<name>. A small script
// injected before each page maps that onto WebView2's chrome.webview.postMessage, so the same pages run here unchanged.
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Atticus;

static class Web
{
    const string Shim = "window.webkit = { messageHandlers: new Proxy({}, { get: (_, n) => ({ postMessage: b => chrome.webview.postMessage({ n, b }) }) }) };" +
                        "window.atticusPlatform = 'win';" +
                        "window.addEventListener('error', e => chrome.webview.postMessage({ n: 'jsError', b: { msg: String(e.message || e), file: String(e.filename || ''), line: e.lineno || 0 } }));";
    static Task<CoreWebView2Environment> env;
    static Task<CoreWebView2Environment> Env => env ??= CoreWebView2Environment.CreateAsync(null, Path.Combine(Paths.Local, "WebView2"));

    // A page from ui\ (orbs.js goes in place of its /*ORBS*/ marker); onMessage(handler name, body) on the UI thread.
    public static async Task<WebView2> Load(Control host, string page, Action<string, JsonElement> onMessage, Action onLoaded = null, bool transparent = false, string extra = "")
    {
        var v = new WebView2 { Dock = DockStyle.Fill };
        if (transparent) v.DefaultBackgroundColor = Color.Transparent;
        host.Controls.Add(v);
        await v.EnsureCoreWebView2Async(await Env);
        var s = v.CoreWebView2.Settings;
        s.AreDevToolsEnabled = Environment.GetEnvironmentVariable("ATTICUS_DEVTOOLS") == "1";
        s.AreDefaultContextMenusEnabled = false; s.IsZoomControlEnabled = false; s.IsStatusBarEnabled = false; s.AreBrowserAcceleratorKeysEnabled = false;
        v.CoreWebView2.ProcessFailed += (_, e) => Program.Err("WebView2 ProcessFailed: " + e.ProcessFailedKind);
        v.CoreWebView2.NavigationCompleted += (_, e) => {
            Program.Err($"NavigationCompleted for {page}: Success={e.IsSuccess} ErrorStatus={e.WebErrorStatus} Http={e.HttpStatusCode}");
            if (e.IsSuccess && onLoaded != null) onLoaded();
        };
        await v.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(Shim + extra);
        v.CoreWebView2.WebMessageReceived += (_, e) =>
        {
            try
            {
                using var d = JsonDocument.Parse(e.WebMessageAsJson);
                onMessage(d.RootElement.GetProperty("n").GetString(), d.RootElement.GetProperty("b").Clone());
            }
            catch (Exception ex) { Program.Err("WebMessageReceived parse error: " + ex.Message); }
        };
        v.CoreWebView2.NewWindowRequested += (_, e) => { e.Handled = true; Open(e.Uri); };   // links open in the user's browser
        string html;
        try { html = File.ReadAllText(Paths.Ui(page)); } catch { html = $"missing {page}"; }
        if (html.Contains("/*ORBS*/")) html = html.Replace("/*ORBS*/", File.Exists(Paths.Ui("orbs.js")) ? File.ReadAllText(Paths.Ui("orbs.js")) : "");
        if (html.Contains("/*ORB_JS*/")) html = html.Replace("/*ORB_JS*/", File.Exists(Paths.Ui("orb.js")) ? File.ReadAllText(Paths.Ui("orb.js")) : "");
        if (html.Contains("/*MINDMAP_JS*/")) html = html.Replace("/*MINDMAP_JS*/", File.Exists(Paths.Ui("mindmap.js")) ? File.ReadAllText(Paths.Ui("mindmap.js")) : "");
        if (html.Contains("/*AGENT_TOWN_JS*/")) html = html.Replace("/*AGENT_TOWN_JS*/", File.Exists(Paths.Ui("agent_town.js")) ? File.ReadAllText(Paths.Ui("agent_town.js")) : "");
        v.CoreWebView2.NavigateToString(html);
        return v;
    }

    public static void Js(WebView2 v, string call)
    {
        if (v?.CoreWebView2 == null) return;
        try { _ = v.CoreWebView2.ExecuteScriptAsync(call); } catch { }
    }

    public static string Json(object o) => JsonSerializer.Serialize(o);

    public static void Open(string target)
    {
        try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(target) { UseShellExecute = true }); } catch { }
    }
}

// "Show me where": a soft pulsing ring at a spot on screen for a few seconds. "@ x y" in screen pixels.
sealed class Ring : Form
{
    static Ring now;
    readonly System.Windows.Forms.Timer t = new() { Interval = 30 };
    int tick;
    Ring(int x, int y)
    {
        FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = false; TopMost = true; BackColor = Color.Magenta; TransparencyKey = Color.Magenta;
        StartPosition = FormStartPosition.Manual; Bounds = new Rectangle(x - 40, y - 40, 80, 80);
        DoubleBuffered = true;
        t.Tick += (_, _) => { if (++tick > 200) Close(); Invalidate(); };
        t.Start();
    }
    protected override bool ShowWithoutActivation => true;
    protected override CreateParams CreateParams { get { var c = base.CreateParams; c.ExStyle |= Native.WS_EX_TOOLWINDOW | Native.WS_EX_NOACTIVATE | Native.WS_EX_TRANSPARENT | Native.WS_EX_LAYERED; return c; } }
    protected override void OnPaint(PaintEventArgs e)
    {
        var s = 0.75f + 0.25f * MathF.Abs(MathF.Sin(tick / 10f));
        var r = 32 * s;
        e.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        using var pen = new Pen(Color.FromArgb(10, 132, 255), 4);
        e.Graphics.DrawEllipse(pen, 40 - r, 40 - r, 2 * r, 2 * r);
    }
    protected override void OnFormClosed(FormClosedEventArgs e) { t.Dispose(); if (now == this) now = null; base.OnFormClosed(e); }
    public static void At(string line)
    {
        var p = line.Split(' ').Skip(1).Select(s => int.TryParse(s, out var n) ? n : int.MinValue).ToArray();
        if (p.Length != 2 || p.Contains(int.MinValue)) return;
        now?.Close();
        now = new Ring(p[0], p[1]); now.Show();
    }
}
