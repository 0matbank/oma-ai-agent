using Microsoft.Web.WebView2.WinForms;

namespace Atticus;

// Floating mode (Stonic v3.1.19): while the Oma window is minimized, a small round orb stays above other windows in the
// bottom-right corner, mirrors the orb's state, never takes keyboard focus, hides over full-screen apps; click opens Oma.
sealed class FloatWindow : Form
{
    WebView2 web;
    string state = "idle", theme = "stonic";
    readonly System.Windows.Forms.Timer fullscreen = new() { Interval = 2000 };

    public FloatWindow()
    {
        FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = false; TopMost = true; StartPosition = FormStartPosition.Manual;
        BackColor = Color.FromArgb(5, 7, 11);
        var s = (int)(150 * DeviceDpi / 96.0);
        Size = new Size(s, s);
        var wa = Screen.PrimaryScreen!.WorkingArea;
        Location = new Point(wa.Right - s - 24, wa.Bottom - s - 24);
        using var path = new System.Drawing.Drawing2D.GraphicsPath();
        path.AddEllipse(0, 0, s, s);
        Region = new Region(path);
        fullscreen.Tick += (_, _) => { if (Visible) Opacity = Native.ForegroundIsFullScreen() ? 0 : 1; };
    }

    protected override bool ShowWithoutActivation => true;
    protected override CreateParams CreateParams { get { var p = base.CreateParams; p.ExStyle |= 0x08000000 | 0x80 | 0x8; return p; } }   // NOACTIVATE | TOOLWINDOW | TOPMOST

    public async void Open()
    {
        if (!Visible) Show();
        fullscreen.Start();
        if (web == null)
            web = await Web.Load(this, "float.html", (n, b) => { if (n == "float") Program.Post(() => Program.Settings?.RestoreFromFloat()); }, () => Sync());
        else Sync();
    }

    public void Close2() { fullscreen.Stop(); Hide(); }

    public void SetState(string s, string t) { state = s; if (!string.IsNullOrEmpty(t)) theme = t; if (Visible) Sync(); }

    void Sync() => Web.Js(web, $"holoOrb.setTheme({Web.Json(theme)}); holoOrb.setState({Web.Json(state)});");
}
