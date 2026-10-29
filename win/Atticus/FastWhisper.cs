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

    public static bool Wanted => Prefs.Str("speechEngine") == "faster-whisper";   // opt-in until measured better on this PC

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
    public Task<string> Transcribe(float[] a, string prompt, bool partial) => Ask(a, null, prompt, partial);

    // A whole recording in a compressed format (a Telegram voice note, .oga): the server decodes it. null = failed.
    public Task<string> TranscribeFile(string path, string prompt) => Ask(null, path, prompt, false);

    async Task<string> Ask(float[] a, string audioFile, string prompt, bool partial)
    {
        if (!Ready || proc == null || proc.HasExited) { Ready = false; return null; }
        await one.WaitAsync();
        var me = ++id;
        var file = audioFile ?? Path.Combine(Path.GetTempPath(), $"oma-voice-{Environment.ProcessId}-{me}.f32");
        try
        {
            if (audioFile == null)
            {
                var bytes = new byte[a.Length * 4];
                Buffer.BlockCopy(a, 0, bytes, 0, bytes.Length);
                await File.WriteAllBytesAsync(file, bytes);
            }
            var cloud = !partial && Prefs.Bool("voiceCloudStt");   // Bangla words from Gemini (the user's choice: the audio goes to Google)
            await proc.StandardInput.WriteLineAsync(audioFile == null ? JsonSerializer.Serialize(new { id = me, pcm = file, prompt, partial, cloud })
                                                                      : JsonSerializer.Serialize(new { id = me, file, prompt, partial, cloud }));
            await proc.StandardInput.FlushAsync();
            while (true)
            {
                var line = await proc.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(30));
                if (line == null) { Ready = false; return null; }
                var j = JsonDocument.Parse(line).RootElement;
                if (j.TryGetProperty("id", out var rid) && rid.ValueKind == JsonValueKind.Number && rid.GetInt32() != me) continue;
                if (j.TryGetProperty("error", out var err)) { Program.Err("FastWhisper: " + err.GetString()); return null; }
                if (!partial) Program.Err($"FastWhisper: {j.GetProperty("lang").GetString()} p={j.GetProperty("lang_prob")} {j.GetProperty("ms")} ms"
                    + (j.TryGetProperty("cloud_ms", out var cm) ? $", Gemini {(j.TryGetProperty("engine", out _) ? "used" : "not used (" + (j.TryGetProperty("cloud_error", out var ce) ? ce.GetString() : "?") + ")")} {cm} ms" : ""));
                var text = j.GetProperty("text").GetString() ?? "";
                if (!partial && Prefs.D.GetValueOrDefault("voiceKeepAudio") is true)   // diagnostics the user turns on: their own recordings, kept locally
                {
                    var dir = Path.Combine(Paths.Local, "voice-samples"); Directory.CreateDirectory(dir);
                    try { File.Copy(file, Path.Combine(dir, $"{DateTime.Now:HHmmss}-{me}.f32"), true); } catch { }
                    Program.Err("FastWhisper text: " + text);
                }
                return text;
            }
        }
        catch (Exception e) { Program.Err("FastWhisper: " + e.Message); Stop(); return null; }   // a stuck read cannot be reused: restart
        finally { if (audioFile == null) try { File.Delete(file); } catch { } one.Release(); }
    }
}
