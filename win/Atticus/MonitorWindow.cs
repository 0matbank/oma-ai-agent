using Microsoft.Web.WebView2.WinForms;

namespace Atticus;

// "OMA MONITOR": a small browser of its own (back, forward, reload, address) for the World Monitor dashboard.
// worldmonitor.app refuses to be framed (X-Frame-Options: SAMEORIGIN), so it gets a real WebView2 window, like Stonic's.
sealed class MonitorWindow : Form
{
    static MonitorWindow open;
    readonly WebView2 web = new() { Dock = DockStyle.Fill };
    readonly TextBox address = new() { Dock = DockStyle.Fill, BorderStyle = BorderStyle.FixedSingle, BackColor = Color.FromArgb(18, 22, 30), ForeColor = Color.Gainsboro, Font = new Font("Consolas", 10f) };

    public static void Show(string url)
    {
        if (open is { IsDisposed: false }) { open.Go(url); open.Activate(); return; }
        open = new MonitorWindow(url);
        open.Show();
    }

    MonitorWindow(string url)
    {
        Text = "Oma Monitor"; BackColor = Color.FromArgb(10, 12, 16); Size = new Size(1400, 860); StartPosition = FormStartPosition.CenterScreen;
        try { Icon = new Icon(Path.Combine(Paths.App, "ui", "AppIcon.ico")); } catch { }
        var bar = new TableLayoutPanel { Dock = DockStyle.Top, Height = 34, ColumnCount = 5, BackColor = Color.FromArgb(14, 17, 23), Padding = new Padding(6, 4, 6, 4) };
        Button B(string t, Action a) { var b = new Button { Text = t, Width = 34, Dock = DockStyle.Fill, FlatStyle = FlatStyle.Flat, ForeColor = Color.Gainsboro }; b.FlatAppearance.BorderSize = 0; b.Click += (_, _) => a(); return b; }
        var title = new Label { Text = "● OMA MONITOR", ForeColor = Color.FromArgb(255, 70, 85), Font = new Font("Consolas", 9f, FontStyle.Bold), AutoSize = true, Anchor = AnchorStyles.Left, Padding = new Padding(0, 6, 8, 0) };
        bar.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize)); bar.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 38));
        bar.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 38)); bar.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 38)); bar.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        bar.Controls.Add(title); bar.Controls.Add(B("‹", () => { if (web.CanGoBack) web.GoBack(); })); bar.Controls.Add(B("›", () => { if (web.CanGoForward) web.GoForward(); }));
        bar.Controls.Add(B("↻", () => web.Reload())); bar.Controls.Add(address);
        address.KeyDown += (_, e) => { if (e.KeyCode == Keys.Enter) { e.SuppressKeyPress = true; Go(address.Text); } };
        Controls.Add(web); Controls.Add(bar);
        Load += async (_, _) =>
        {
            await web.EnsureCoreWebView2Async(await Web.Env);
            web.CoreWebView2.SourceChanged += (_, _) => address.Text = web.Source?.ToString() ?? "";
            web.CoreWebView2.NewWindowRequested += (_, e) => { e.Handled = true; Web.Open(e.Uri); };   // its links open in the user's browser
            Go(url);
        };
    }

    void Go(string url)
    {
        url = (url ?? "").Trim();
        if (url.Length == 0) return;
        if (!url.StartsWith("http://") && !url.StartsWith("https://")) url = "https://" + url;
        try { web.CoreWebView2?.Navigate(url); } catch (Exception e) { Program.Err("Monitor: " + e.Message); }
    }
}
