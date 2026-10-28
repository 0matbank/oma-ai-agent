// Warm GPU speech-to-text: one `atticus.py --voice-server` process (faster-whisper large-v3-turbo, CTranslate2/CUDA)
// started with the app and kept loaded. Audio goes over a temp file of float32 samples; replies are JSON lines.
// If it cannot start (no CUDA, missing packages, model not downloaded) Speech falls back to Whisper.net (whisper.cpp).
using System.Diagnostics;
using System.Text.Json;

namespace Atticus;

sealed class FastWhisper
{
    Process proc;
    readonly SemaphoreSlim one = new(1, 1);
    int id;
    public bool Ready { get; private set; }
    public string Info = "", Error = "";

    public static bool Wanted => Prefs.Str("speechEngine") is "" or "faster-whisper";

    static string Langs()
    {
        var l = Prefs.Str("speechLanguage");
        return l is "en" ? "en" : l is "bn" or "" or "auto" ? "bn,en" : l;
    }

    public Task Start() => Task.Run(async () =>
    {
        if (Ready || !Wanted) return;
        try
        {
            proc = Py.Start(new[] { "--voice-server" }, new() { ["OMA_SPEECH_LANGS"] = Langs() }, input: true);
            _ = proc.StandardError.ReadToEndAsync();
            var first = await proc.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromMinutes(10));   // first run downloads the model
            var j = JsonDocument.Parse(first ?? "{}").RootElement;
            Ready = j.TryGetProperty("ready", out var r) && r.GetBoolean();
            Info = first ?? "";
            Error = Ready ? "" : (j.TryGetProperty("error", out var e) ? e.GetString() : "voice server did not start");
            Program.Err("FastWhisper: " + Info);
            if (!Ready) Stop();
        }
        catch (Exception e) { Error = e.Message; Ready = false; Program.Err("FastWhisper start: " + e.Message); Stop(); }
    });

    public void Stop()
    {
        Ready = false;
        Py.Stop(proc);
        proc = null;
    }

    // null = failed (caller falls back)
    public async Task<string> Transcribe(float[] a, string prompt, bool partial)
    {
        if (!Ready || proc == null || proc.HasExited) { Ready = false; return null; }
        await one.WaitAsync();
        var file = Path.Combine(Path.GetTempPath(), $"oma-voice-{Environment.ProcessId}-{++id}.f32");
        try
        {
            var bytes = new byte[a.Length * 4];
            Buffer.BlockCopy(a, 0, bytes, 0, bytes.Length);
            await File.WriteAllBytesAsync(file, bytes);
            var me = id;
            await proc.StandardInput.WriteLineAsync(JsonSerializer.Serialize(new { id = me, pcm = file, prompt, partial }));
            await proc.StandardInput.FlushAsync();
            while (true)
            {
                var line = await proc.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(30));
                if (line == null) { Ready = false; return null; }
                var j = JsonDocument.Parse(line).RootElement;
                if (j.TryGetProperty("id", out var rid) && rid.ValueKind == JsonValueKind.Number && rid.GetInt32() != me) continue;
                if (j.TryGetProperty("error", out var err)) { Program.Err("FastWhisper: " + err.GetString()); return null; }
                if (!partial) Program.Err($"FastWhisper: {j.GetProperty("lang").GetString()} p={j.GetProperty("lang_prob")} {j.GetProperty("ms")} ms");
                return j.GetProperty("text").GetString() ?? "";
            }
        }
        catch (Exception e) { Program.Err("FastWhisper: " + e.Message); Stop(); return null; }   // a stuck read cannot be reused: restart
        finally { try { File.Delete(file); } catch { } one.Release(); }
    }
}
