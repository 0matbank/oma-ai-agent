// Live PC health for the Oma window, measured natively (no Python or PowerShell started every few seconds).
// Whole-system CPU (GetSystemTimes delta between ticks), RAM (GlobalMemoryStatusEx), GPU/VRAM (nvidia-smi, when present),
// and the Oma process tree: Atticus.exe, its WebView2 processes, its Python/Claude children, plus Ollama separately
// (Ollama is a shared local service, not part of Oma). Per-group CPU is each group's processor-time delta.
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Atticus;

static class Health
{
    [DllImport("kernel32.dll")] static extern bool GetSystemTimes(out long idle, out long kernel, out long user);
    [StructLayout(LayoutKind.Sequential)]
    struct MEMSTAT { public uint Length, Load; public ulong TotalPhys, AvailPhys, TotalPage, AvailPage, TotalVirt, AvailVirt, AvailExt; }
    [DllImport("kernel32.dll")] static extern bool GlobalMemoryStatusEx(ref MEMSTAT m);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct PROCESSENTRY32 { public uint dwSize, cntUsage, th32ProcessID; public IntPtr th32DefaultHeapID; public uint th32ModuleID, cntThreads, th32ParentProcessID; public int pcPriClassBase; public uint dwFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile; }
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32FirstW(IntPtr snap, ref PROCESSENTRY32 e);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32NextW(IntPtr snap, ref PROCESSENTRY32 e);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);

    static long pIdle, pKernel, pUser;
    static DateTime pAt;
    static readonly Dictionary<int, TimeSpan> pCpu = new();
    static string cpuName;
    static object gpuCache; static DateTime gpuAt;
    static readonly object gate = new();

    static string CpuName()
    {
        if (cpuName != null) return cpuName;
        try { cpuName = (Microsoft.Win32.Registry.GetValue(@"HKEY_LOCAL_MACHINE\HARDWARE\DESCRIPTION\System\CentralProcessor\0", "ProcessorNameString", "") as string ?? "").Trim(); }
        catch { cpuName = ""; }
        return cpuName;
    }

    static Dictionary<int, (int parent, string exe)> Snapshot()
    {
        var d = new Dictionary<int, (int, string)>();
        var h = CreateToolhelp32Snapshot(0x2, 0);
        if (h == IntPtr.Zero || h == new IntPtr(-1)) return d;
        try
        {
            var e = new PROCESSENTRY32 { dwSize = (uint)Marshal.SizeOf<PROCESSENTRY32>() };
            if (Process32FirstW(h, ref e))
                do { d[(int)e.th32ProcessID] = ((int)e.th32ParentProcessID, e.szExeFile ?? ""); } while (Process32NextW(h, ref e));
        }
        finally { CloseHandle(h); }
        return d;
    }

    static object Gpu()
    {
        if (gpuCache != null && (DateTime.Now - gpuAt).TotalSeconds < 6) return gpuCache;
        object r = new { available = false, name = "", utilization_pct = 0.0, vram_used_gb = 0.0, vram_total_gb = 0.0, vram_pct = 0.0, temperature_c = 0.0, source = "nvidia-smi not found" };
        try
        {
            var si = new ProcessStartInfo("nvidia-smi", "--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,name --format=csv,noheader,nounits")
            { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true };
            using var p = Process.Start(si);
            var o = p!.StandardOutput.ReadToEnd();
            if (p.WaitForExit(2500) && p.ExitCode == 0)
            {
                var f = o.Trim().Split('\n')[0].Split(',').Select(x => x.Trim()).ToArray();
                double D(string x) => double.TryParse(x, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var v) ? v : 0;
                if (f.Length >= 5)
                    r = new { available = true, name = f[4], utilization_pct = D(f[0]), vram_used_gb = Math.Round(D(f[1]) / 1024, 2), vram_total_gb = Math.Round(D(f[2]) / 1024, 2),
                              vram_pct = D(f[2]) > 0 ? Math.Round(D(f[1]) / D(f[2]) * 100, 1) : 0, temperature_c = D(f[3]), source = "nvidia-smi" };
            }
        }
        catch { }
        gpuCache = r; gpuAt = DateTime.Now;
        return r;
    }

    public static string Json()
    {
        lock (gate)
        {
            var now = DateTime.Now;
            double cpuPct = -1;
            if (GetSystemTimes(out var idle, out var kernel, out var user))
            {
                if (pAt != default)
                {
                    var total = (kernel - pKernel) + (user - pUser);
                    if (total > 0) cpuPct = Math.Round(Math.Clamp((total - (idle - pIdle)) * 100.0 / total, 0, 100), 1);
                }
                pIdle = idle; pKernel = kernel; pUser = user;
            }
            var wall = pAt == default ? 0 : (now - pAt).TotalSeconds;
            pAt = now;

            var m = new MEMSTAT { Length = (uint)Marshal.SizeOf<MEMSTAT>() };
            GlobalMemoryStatusEx(ref m);
            double gb(ulong b) => Math.Round(b / 1073741824.0, 2);

            // Oma's own process tree, from this process down; Ollama on its own
            var snap = Snapshot();
            var me = Environment.ProcessId;
            var tree = new HashSet<int> { me };
            bool grew = true;
            while (grew) { grew = false; foreach (var (pid, (parent, _)) in snap) if (!tree.Contains(pid) && tree.Contains(parent) && pid != parent) { tree.Add(pid); grew = true; } }
            var groups = new Dictionary<string, (double mb, int n, double cpu)> { ["app"] = (0, 0, 0), ["webview2"] = (0, 0, 0), ["python"] = (0, 0, 0), ["claude"] = (0, 0, 0), ["other"] = (0, 0, 0), ["ollama"] = (0, 0, 0) };
            var seen = new HashSet<int>();
            foreach (var (pid, (_, exe)) in snap)
            {
                var x = exe.ToLowerInvariant();
                string g = null;
                if (x.StartsWith("ollama")) g = "ollama";
                else if (tree.Contains(pid)) g = pid == me ? "app" : x.Contains("msedgewebview2") ? "webview2" : x.StartsWith("python") ? "python" : x.StartsWith("claude") || x == "node.exe" ? "claude" : "other";
                if (g == null) continue;
                try
                {
                    using var p = Process.GetProcessById(pid);
                    var t = p.TotalProcessorTime;
                    double c = 0;
                    if (wall > 0 && pCpu.TryGetValue(pid, out var last)) c = (t - last).TotalSeconds / wall / Environment.ProcessorCount * 100;
                    pCpu[pid] = t; seen.Add(pid);
                    var cur = groups[g];
                    groups[g] = (cur.mb + p.WorkingSet64 / 1048576.0, cur.n + 1, cur.cpu + Math.Max(0, c));
                }
                catch { }
            }
            foreach (var k in pCpu.Keys.Where(k => !seen.Contains(k)).ToList()) pCpu.Remove(k);
            object G(string k) => new { mb = Math.Round(groups[k].mb, 1), count = groups[k].n, cpu_pct = Math.Round(groups[k].cpu, 1) };
            var omaMb = groups["app"].mb + groups["webview2"].mb + groups["python"].mb + groups["claude"].mb + groups["other"].mb;
            return Web.Json(new
            {
                timestamp = DateTimeOffset.Now.ToUnixTimeMilliseconds() / 1000.0,
                source = "native (Atticus.exe)",
                cpu = new { utilization_pct = cpuPct, cores = Environment.ProcessorCount, model = CpuName(), sample_s = Math.Round(wall, 1) },
                ram = new { total_gb = gb(m.TotalPhys), avail_gb = gb(m.AvailPhys), used_gb = gb(m.TotalPhys - m.AvailPhys), utilization_pct = (double)m.Load },
                gpu = Gpu(),
                process_tree = new
                {
                    atticus_app_mb = Math.Round(groups["app"].mb, 1), webview2_cluster_mb = Math.Round(groups["webview2"].mb, 1), webview2_instances = groups["webview2"].n,
                    python_backend_mb = Math.Round(groups["python"].mb + groups["claude"].mb, 1), python_instances = groups["python"].n + groups["claude"].n,
                    ollama_inference_mb = Math.Round(groups["ollama"].mb, 1), ollama_instances = groups["ollama"].n,
                    total_oma_ecosystem_mb = Math.Round(omaMb, 1), total_oma_ecosystem_gb = Math.Round(omaMb / 1024, 2),
                    groups = new { app = G("app"), webview2 = G("webview2"), python = G("python"), claude = G("claude"), other = G("other"), ollama = G("ollama") },
                    note = "Oma total = Atticus.exe and everything it started (WebView2, Python, Claude Code). Ollama is a separate shared service and is listed on its own."
                }
            });
        }
    }
}
