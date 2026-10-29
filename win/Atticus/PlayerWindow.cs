using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Atticus;

// The Oma player as a window of its own: the user drags it anywhere on the PC (any screen) by its title bar and resizes it
// from its edges ("PC-r je kono jaygay jeno newa jay, shudhu Oma-r interface-er moddhe keno"; Oct 29). It stays on top;
// its place and size are kept. It shows YouTube's own watch page, so every YouTube button works: full screen fills the
// screen, next / suggestions / search change the song by hand ("full screen hoy na, manually gan change kora jay na", Oct 29).
// The engine's "▶ {json}" lines come here: {id,title} plays, {stop}, {next}, {pause}, {size: bigger | smaller | full |
// normal | left | right | top | bottom | center}, {volume: {op: up|down|set, n}} (the video's own volume, not the PC's).
// While it shows, %APPDATA%\Atticus\player_on holds the song's title: "sound komao" means this video, and the engine knows
// what plays. A normal window (not a tool window) so Oma's own window tools find "Oma Player" too.
sealed class PlayerWindow : Form
{
    static PlayerWindow open;
    readonly WebView2 web = new() { Dock = DockStyle.Fill };
    static string PlayerOn => Path.Combine(Paths.Config, "player_on");
    Rectangle before;   // the window before YouTube's full screen
    bool full;

    public static void Reset() { try { File.Delete(PlayerOn); } catch { } }

    public static void Handle(JsonElement it)
    {
        try
        {
            bool On(string k) => it.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.True;
            if (On("stop")) { open?.Close(); return; }
            if (On("next")) { open?.Next(); return; }
            if (On("pause")) { open?.Pause(); return; }
            if (it.TryGetProperty("volume", out var vol))
            {
                open?.Volume(vol.TryGetProperty("op", out var op) ? op.GetString() ?? "set" : "set", vol.TryGetProperty("n", out var n) && n.TryGetInt32(out var k) ? k : 10);
                return;
            }
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
        Text = "Oma Player"; BackColor = Color.Black; FormBorderStyle = FormBorderStyle.Sizable; TopMost = true;
        ShowInTaskbar = true; MinimumSize = new Size(320, 240); StartPosition = FormStartPosition.Manual;
        try { Icon = new Icon(Path.Combine(Paths.App, "ui", "AppIcon.ico")); } catch { }
        Bounds = Saved() ?? DefaultBounds();
        Controls.Add(web);
        LocationChanged += (_, _) => Save();
        ResizeEnd += (_, _) => Save();
        FormClosed += (_, _) => { try { File.Delete(PlayerOn); } catch { } open = null; };
    }

    async void Play(string id, string title)
    {
        Titled(title);
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        try
        {
            if (web.CoreWebView2 == null)
            {
                await web.EnsureCoreWebView2Async(await Web.Env);
                var core = web.CoreWebView2;
                core.NewWindowRequested += (_, e) => { e.Handled = true; Web.Open(e.Uri); };
                core.ContainsFullScreenElementChanged += (_, _) => FullScreen(core.ContainsFullScreenElement);
                core.DocumentTitleChanged += (_, _) =>
                {
                    var s = System.Text.RegularExpressions.Regex.Replace(core.DocumentTitle ?? "", @"^\(\d+\)\s*|\s*-\s*YouTube$", "");
                    if (s.Length > 0 && s != "YouTube") Titled(s);   // a song picked by hand shows (and is known) too
                };
            }
            web.CoreWebView2.Navigate("https://www.youtube.com/watch?v=" + id);
        }
        catch (Exception e) { Program.Err("Player: " + e.Message); }
    }

    void Titled(string title)
    {
        Text = "Oma Player — " + (title.Length > 80 ? title[..80] + "…" : title);
        try { File.WriteAllText(PlayerOn, title); } catch { }
    }

    // YouTube's own player on the page (#movie_player); null until the page has it
    async Task<string> Js(string body)
    {
        try { return web.CoreWebView2 == null ? "" : await web.CoreWebView2.ExecuteScriptAsync("(() => { const p = document.getElementById('movie_player'); if (!p || !p.setVolume) return null; " + body + " })()"); }
        catch { return ""; }
    }

    // A new song is still loading when "gan chalao, sound 50 rakho" sends its volume: try for up to 10 s
    async void Volume(string op, int n)
    {
        var body = $"const v = Math.max(0, Math.min(100, '{op}' === 'set' ? {n} : p.getVolume() + ('{op}' === 'up' ? {n} : -{n}))); p.unMute(); p.setVolume(v); return v;";
        for (var i = 0; i < 40; i++)
        {
            var r = await Js(body);
            if (r is not ("" or "null")) { Program.Err($"Player: volume {op} {n} -> {r}"); return; }
            await Task.Delay(250);
        }
        Program.Err("Player: volume not set (no YouTube player on the page)");
    }

    async void Next()
    {
        var r = await Js("const b = document.querySelector('.ytp-next-button'); if (b && b.offsetParent) b.click(); else p.nextVideo(); return 1;");
        Program.Err("Player: next -> " + r);
    }

    async void Pause() => await Js("if (p.getPlayerState() === 1) p.pauseVideo(); else p.playVideo(); return 1;");

    // YouTube's full screen (its button, "f", or "full screen koro") covers the whole screen the player is on
    void FullScreen(bool on)
    {
        if (on == full) return;
        if (on)
        {
            before = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            full = true; WindowState = FormWindowState.Normal; FormBorderStyle = FormBorderStyle.None;
            Bounds = Screen.FromControl(this).Bounds;
        }
        else
        {
            FormBorderStyle = FormBorderStyle.Sizable; Bounds = before; full = false;
        }
    }

    // A real key press into the page (DevTools input counts as the user's own, which full screen needs)
    async Task Key(string key)
    {
        try
        {
            foreach (var type in new[] { "keyDown", "keyUp" })
                await web.CoreWebView2.CallDevToolsProtocolMethodAsync("Input.dispatchKeyEvent", JsonSerializer.Serialize(new
                {
                    type, key, code = "Key" + key.ToUpperInvariant(), windowsVirtualKeyCode = (int)char.ToUpperInvariant(key[0]), text = type == "keyDown" ? key : ""
                }));
        }
        catch (Exception e) { Program.Err("Player: key " + e.Message); }
    }

    // Spoken places and sizes, on the screen the player is on
    async void Place(string how)
    {
        if (how == "full") { if (!full && web.CoreWebView2 != null) { Activate(); await Key("f"); } return; }
        if (full) { _ = web.CoreWebView2?.ExecuteScriptAsync("document.exitFullscreen()"); await Task.Delay(300); }
        var wa = Screen.FromControl(this).WorkingArea;
        if (WindowState == FormWindowState.Maximized) WindowState = FormWindowState.Normal;
        int[] widths = { 640, 860, 1100 };
        if (how is "bigger" or "smaller" or "normal")
        {
            var i = Array.FindLastIndex(widths, x => x <= Width + 10); if (i < 0) i = 0;
            var w = how == "normal" ? widths[0] : widths[Math.Clamp(how == "bigger" ? i + 1 : i - 1, 0, widths.Length - 1)];
            Size = new Size(Math.Min(w, wa.Width), Math.Min(w * 9 / 16 + 140, wa.Height));   // the video plus YouTube's bar and buttons
        }
        int x = Left, y = Top;
        if (how == "left") x = wa.Left + 12;
        if (how == "right") x = wa.Right - Width - 12;
        if (how == "top") y = wa.Top + 12;
        if (how == "bottom") y = wa.Bottom - Height - 12;
        if (how == "center") { x = wa.Left + (wa.Width - Width) / 2; y = wa.Top + (wa.Height - Height) / 2; }
        Location = new Point(Math.Clamp(x, wa.Left, Math.Max(wa.Left, wa.Right - Width)), Math.Clamp(y, wa.Top, Math.Max(wa.Top, wa.Bottom - Height)));
        Save();
    }

    static Rectangle DefaultBounds()
    {
        var wa = (Program.Settings is { IsDisposed: false } s ? Screen.FromControl(s) : Screen.PrimaryScreen)!.WorkingArea;
        return new Rectangle(wa.Right - 640 - 16, wa.Bottom - 500 - 16, 640, 500);   // the bottom right of the screen Oma is on
    }

    static Rectangle? Saved()
    {
        var p = Prefs.Str("playerBounds2").Split(',');
        if (p.Length != 4 || !p.All(v => int.TryParse(v, out _))) return null;
        var r = new Rectangle(int.Parse(p[0]), int.Parse(p[1]), int.Parse(p[2]), int.Parse(p[3]));
        return Screen.AllScreens.Any(s => s.WorkingArea.IntersectsWith(r)) ? r : null;   // not on a screen that was unplugged
    }

    void Save() { if (!full && WindowState == FormWindowState.Normal) Prefs.Set("playerBounds2", $"{Left},{Top},{Width},{Height}"); }
}
