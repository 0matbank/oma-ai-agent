using System;
using System.Threading;
using System.Threading.Tasks;

namespace Atticus;

// AI provider health monitor: atticus.py --health-refresh (no inference: CLI/sign-in, Ollama tags/ps, cloud model lists)
// at startup, every healthInterval seconds (default 300) and when AI settings change. Runs on the thread pool, never on
// the UI thread; one refresh at a time. The Settings page gets the snapshot when it is open.
static class ProviderHealth
{
    static System.Threading.Timer timer;
    static int busy;
    public static string Last = "";
    public static Action<string> Changed;

    public static void Start()
    {
        timer ??= new System.Threading.Timer(_ => Refresh("interval"), null, TimeSpan.FromSeconds(8), Interval());
    }

    static TimeSpan Interval()
    {
        var s = Prefs.D.GetValueOrDefault("healthInterval") is string t && double.TryParse(t, out var n) ? n : Prefs.Num("healthInterval");
        return TimeSpan.FromSeconds(s >= 60 ? Math.Min(s, 3600) : 300);
    }

    public static void Refresh(string why)
    {
        if (Interlocked.Exchange(ref busy, 1) == 1) return;
        Task.Run(() =>
        {
            try
            {
                var t0 = DateTime.Now;
                var j = Py.Run(new[] { "--health-refresh" }, 60);
                if (j.TrimStart().StartsWith("{")) { Last = j.Trim(); Changed?.Invoke(Last); }
                Program.Err($"ProviderHealth: refresh ({why}) {(DateTime.Now - t0).TotalSeconds:0.0}s");
                if (why == "settings") timer?.Change(Interval(), Interval());
            }
            catch (Exception e) { Program.Err("ProviderHealth: " + e.Message); }
            finally { Interlocked.Exchange(ref busy, 0); }
        });
    }

    // after a request: the outcome was recorded by the engine; re-read the snapshot (no checks run)
    public static void Reload()
    {
        Task.Run(() =>
        {
            var j = Py.Run(new[] { "--health-status" }, 20);
            if (j.TrimStart().StartsWith("{")) { Last = j.Trim(); Changed?.Invoke(Last); }
        });
    }
}
