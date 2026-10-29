using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Atticus;

// The Oma player as a window of its own: the user drags it anywhere on the PC (any screen) by its title bar and resizes it
// from its edges ("PC-r je kono jaygay jeno newa jay, shudhu Oma-r interface-er moddhe keno"; Oct 29). It stays on top;
// its place and size are kept. The engine's "▶ {json}" lines come here: {id,title} plays, {stop}, {size: bigger | smaller |
// full | normal | left | right | top | bottom | center}, {volume: {op: up|down|set, n}} (the video's own volume).
// While it shows, %APPDATA%\Atticus\player_on tells the engine that "sound komao" means this video, not the PC.
sealed class PlayerWindow : Form
{
    static PlayerWindow open;
    readonly WebView2 web = new() { Dock = DockStyle.Fill };
    static string PlayerOn => Path.Combine(Paths.Config, "player_on");

    public static void Handle(JsonElement it)
    {
        try
        {
            if (it.TryGetProperty("stop", out var st) && st.ValueKind == JsonValueKind.True) { open?.Close(); return; }
            if (it.TryGetProperty("volume", out var vol)) { open?.Script($"window.postMessage({{omaVolume: {vol.GetRawText()}}}, '*')"); return; }
            if (it.TryGetProperty("size", out var sz)) { open?.Place(sz.GetString() ?? ""); return; }
            var id = it.TryGetProperty("id", out var i) ? i.GetString() ?? "" : "";
            if (!System.Text.RegularExpressions.Regex.IsMatch(id, @"^[\w-]{11}$")) return;
            var title = it.TryGetProperty("title", out var t) ? t.GetString() ?? "" : "";
            if (open is not { IsDisposed: false }) { open = new PlayerWindow(); open.Show(); }
            open.Play(id, title);
        }
        catch (Exception e) { Program.Err("Player: " + e.Message); }
    }

    PlayerWindow()
    {
        Text = "Oma Player"; BackColor = Color.Black; FormBorderStyle = FormBorderStyle.SizableToolWindow; TopMost = true;
        ShowInTaskbar = true; MinimumSize = new Size(260, 170); StartPosition = FormStartPosition.Manual;
        try { Icon = new Icon(Path.Combine(Paths.App, "ui", "AppIcon.ico")); } catch { }
        Bounds = Saved() ?? DefaultBounds();
        Controls.Add(web);
        LocationChanged += (_, _) => Save();
        ResizeEnd += (_, _) => Save();
        FormClosed += (_, _) => { try { File.Delete(PlayerOn); } catch { } open = null; };
    }

    async void Play(string id, string title)
    {
        Text = "Oma Player — " + (title.Length > 80 ? title[..80] + "…" : title);
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        try { File.WriteAllText(PlayerOn, DateTime.Now.ToString("s")); } catch { }
        try
        {
            if (web.CoreWebView2 == null)
            {
                await web.EnsureCoreWebView2Async(await Web.Env);
                // https://oma.ui/player.html: YouTube's embed needs a real origin (about:blank is refused)
                web.CoreWebView2.SetVirtualHostNameToFolderMapping("oma.ui", Path.GetDirectoryName(Paths.Ui("player.html"))!, CoreWebView2HostResourceAccessKind.Allow);
                web.CoreWebView2.NewWindowRequested += (_, e) => { e.Handled = true; Web.Open(e.Uri); };
            }
            web.CoreWebView2.Navigate("https://oma.ui/player.html?v=" + id);
        }
        catch (Exception e) { Program.Err("Player: " + e.Message); }
    }

    void Script(string js) { try { _ = web.CoreWebView2?.ExecuteScriptAsync(js); } catch { } }

    // Spoken places and sizes, on the screen the player is on
    void Place(string how)
    {
        var wa = Screen.FromControl(this).WorkingArea;
        if (how == "full") { WindowState = FormWindowState.Maximized; return; }
        if (WindowState == FormWindowState.Maximized) WindowState = FormWindowState.Normal;
        int[] widths = { 480, 720, 960 };
        var w = Width;
        if (how is "bigger" or "smaller" or "normal")
        {
            var i = Array.FindLastIndex(widths, x => x <= Width + 10); if (i < 0) i = 0;
            w = how == "normal" ? widths[0] : widths[Math.Clamp(how == "bigger" ? i + 1 : i - 1, 0, widths.Length - 1)];
            Size = new Size(Math.Min(w, wa.Width), Math.Min(w * 9 / 16 + 34, wa.Height));
        }
        int x = Left, y = Top;
        if (how == "left") x = wa.Left + 12;
        if (how == "right") x = wa.Right - Width - 12;
        if (how == "top") y = wa.Top + 12;
        if (how == "bottom") y = wa.Bottom - Height - 12;
        if (how == "center") { x = wa.Left + (wa.Width - Width) / 2; y = wa.Top + (wa.Height - Height) / 2; }
        Location = new Point(Math.Clamp(x, wa.Left, wa.Right - Width), Math.Clamp(y, wa.Top, wa.Bottom - Height));
        Save();
    }

    static Rectangle DefaultBounds()
    {
        var wa = (Program.Settings is { IsDisposed: false } s ? Screen.FromControl(s) : Screen.PrimaryScreen)!.WorkingArea;
        return new Rectangle(wa.Right - 480 - 16, wa.Bottom - 304 - 16, 480, 304);   // the bottom right of the screen Oma is on
    }

    static Rectangle? Saved()
    {
        var p = Prefs.Str("playerBounds").Split(',');
        if (p.Length != 4 || !p.All(v => int.TryParse(v, out _))) return null;
        var r = new Rectangle(int.Parse(p[0]), int.Parse(p[1]), int.Parse(p[2]), int.Parse(p[3]));
        return Screen.AllScreens.Any(s => s.WorkingArea.IntersectsWith(r)) ? r : null;   // not on a screen that was unplugged
    }

    void Save() { if (WindowState == FormWindowState.Normal) Prefs.Set("playerBounds", $"{Left},{Top},{Width},{Height}"); }
}
