// Speech to text on this PC: the microphone (16 kHz mono) into Whisper (whisper.cpp). Audio never leaves the machine.
// While the user talks, the words so far are re-read about every 0.7 s (live words in the box); on release, one last pass
// over everything is the confirmed transcript.
using NAudio.Wave;
using Whisper.net;

namespace Atticus;

sealed class Speech
{
    WhisperFactory factory;
    readonly SemaphoreSlim busy = new(1, 1);
    WaveIn mic;
    readonly List<float> audio = new();
    float loudest;
    System.Threading.Timer partial;
    int session;
    public string Prompt = "";   // app names and the user's own words: Whisper leans toward them
    public bool Running => mic != null;
    public bool Ready => factory != null || Fast.Ready || File.Exists(FallbackModel());   // the fallback loads on first use
    public readonly FastWhisper Fast = new();   // warm GPU large-v3-turbo; Whisper.net below is the fallback
    public string Error = "";
    string loaded = "";   // the whisper.cpp model file in `factory`

    public static string Url(string model) => $"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{model}.bin";

    // whisper.cpp model for the fallback. An English-only model (*.en) cannot hear Bangla, so a non-English voice language
    // takes a multilingual model already on disk (best first); the saved setting itself is left as the user chose it.
    public static string FallbackModel()
    {
        var lang = Prefs.Str("speechLanguage");
        if (!Prefs.Str("speechModel").EndsWith(".en") || lang is "" or "en") return Paths.Model;
        var dir = Path.GetDirectoryName(Paths.Model)!;
        foreach (var m in new[] { "small", "large-v3-turbo-q5_0", "large-v3-turbo", "base" })   // small first: the CPU fallback must answer in seconds
            if (File.Exists(Path.Combine(dir, $"ggml-{m}.bin"))) return Path.Combine(dir, $"ggml-{m}.bin");
        return Paths.Model;
    }

    readonly object loadLock = new();
    void LoadFallback()
    {
        lock (loadLock)   // startup and a first transcription may both ask
        {
            var want = FallbackModel();
            if (factory != null && loaded == want) return;
            if (!File.Exists(want)) return;
            factory = WhisperFactory.FromPath(want); loaded = want;
            Program.Err("speech fallback: whisper.cpp " + Path.GetFileName(want));
        }
    }

    // The warm GPU server is the speech engine; whisper.cpp stays on disk unless that server is off or fails
    // (it used to load at start next to the server: RAM spent on a model that was never used).
    public Task Load() => Task.Run(() =>
    {
        if (FastWhisper.Wanted) Fast.Start().Wait();
        if (Fast.Ready) { Error = ""; return; }
        try { LoadFallback(); Error = ""; }
        catch (Exception e) { Error = e.Message; }
    });

    public void Reload() { Fast.Stop(); factory = null; _ = Load(); }   // engine or language changed (the old model is let go)

    // Settings / setup: fetch the model once (~150 MB for base.en). progress: 0..1
    public static async Task<bool> Download(Action<double> progress)
    {
        var dest = Paths.Model;
        Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(30) };
            using var r = await http.GetAsync(Url(Prefs.Str("speechModel")), HttpCompletionOption.ResponseHeadersRead);
            r.EnsureSuccessStatusCode();
            long total = r.Content.Headers.ContentLength ?? 0, got = 0;
            var tmp = dest + ".part";
            await using (var src = await r.Content.ReadAsStreamAsync())
            await using (var f = File.Create(tmp))
            {
                var buf = new byte[1 << 16]; int n;
                while ((n = await src.ReadAsync(buf)) > 0) { await f.WriteAsync(buf.AsMemory(0, n)); got += n; if (total > 0) progress(got / (double)total); }
            }
            File.Move(tmp, dest, true);
            return true;
        }
        catch { return false; }
    }

    public static bool MicAllowed()
    {
        try
        {
            using var k = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone");
            using var all = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone");
            using var desktop = k?.OpenSubKey("NonPackaged");
            return !"Deny".Equals(k?.GetValue("Value")) && !"Deny".Equals(all?.GetValue("Value")) && !"Deny".Equals(desktop?.GetValue("Value")) && WaveIn.DeviceCount > 0;
        }
        catch { return WaveIn.DeviceCount > 0; }
    }

    // onLevel: 0..1 loudness, onWords: the words so far. Both arrive on the UI thread.
    public string Start(Action<double> onLevel, Action<string> onWords)
    {
        Cancel();
        if (WaveIn.DeviceCount == 0) return "No microphone is available. Connect one and try again.";
        var ui = SynchronizationContext.Current;
        lock (audio) { audio.Clear(); loudest = 0; }
        var me = ++session;
        mic = new WaveIn { WaveFormat = new WaveFormat(16000, 16, 1), BufferMilliseconds = 50 };
        int n = 0;
        mic.DataAvailable += (_, e) =>
        {
            float sum = 0;
            lock (audio)
            {
                for (int i = 0; i + 1 < e.BytesRecorded; i += 2)
                {
                    var s = BitConverter.ToInt16(e.Buffer, i) / 32768f;
                    audio.Add(s); sum += s * s;
                }
            }
            var rms = MathF.Sqrt(sum / Math.Max(1, e.BytesRecorded / 2));
            loudest = Math.Max(loudest, rms);
            if (++n % 2 == 0) ui?.Post(_ => { if (session == me) onLevel(Math.Min(1, rms * 14)); }, null);
        };
        try { mic.StartRecording(); }
        catch (Exception e) { mic.Dispose(); mic = null; return MicAllowed() ? "Mic error: " + e.Message : "Allow microphone access in Settings → Privacy & security → Microphone (Let desktop apps access your microphone)."; }
        partial = new System.Threading.Timer(async _ =>
        {
            if (session != me || !Ready || !busy.Wait(0)) return;   // one read at a time; a slow one just skips a beat
            try
            {
                float[] a; lock (audio) a = audio.ToArray();
                if (a.Length < 8000 || loudest < 0.01f) return;
                var t = await Transcribe(a, true);
                if (session == me && mic != null) ui?.Post(_ => { if (session == me) onWords(t); }, null);
            }
            catch { }
            finally { busy.Release(); }
        }, null, 700, 700);
        return "";
    }

    // Keys up: the last pass over all of it. null = could not confirm (no model, or it failed).
    public async Task<string> Stop()
    {
        var me = session;
        partial?.Dispose(); partial = null;
        try { mic?.StopRecording(); } catch { }
        mic?.Dispose(); mic = null;
        float[] a; lock (audio) a = audio.ToArray();
        if (!Ready) return null;
        if (a.Length < 4000 || loudest < 0.01f) return "";   // nothing said
        await busy.WaitAsync();
        try { return session == me ? await Transcribe(a) : null; }
        catch { return null; }
        finally { busy.Release(); }
    }

    public void Cancel()
    {
        session++;
        partial?.Dispose(); partial = null;
        try { mic?.StopRecording(); } catch { }
        mic?.Dispose(); mic = null;
    }

    public Task<string> TranscribeOnce(float[] a) => Transcribe(a);

    async Task<string> Transcribe(float[] a, bool partial = false)
    {
        if (Fast.Ready)
        {
            var f = await Fast.Transcribe(a, Prompt, partial);
            if (f != null) return Clean(f);
            if (!Fast.Ready) _ = Fast.Start();   // the server died: restart it in the background, whisper.cpp answers now
        }
        if (factory == null || loaded != FallbackModel())
            try { await Task.Run(LoadFallback); } catch (Exception e) { Error = e.Message; }
        if (factory == null) return "";
        bool enOnly = loaded.EndsWith(".en.bin");
        string lang = Prefs.Str("speechLanguage");
        if (string.IsNullOrEmpty(lang))
            lang = enOnly ? "en" : "auto";
        else if (enOnly && lang != "en")
            lang = "en"; // English-only models cannot transcribe other languages
        else if (lang == "bn")
            lang = "auto";   // "বাংলা + English": the user mixes both, as the GPU server allows (forcing bn turns English into Bangla letters)
            
        var b = factory.CreateBuilder().WithLanguage(lang)
            .WithThreads(Math.Clamp(Environment.ProcessorCount - 1, 2, 8)).WithNoContext().WithSingleSegment();
        if (Prompt.Length > 0) b = b.WithPrompt(Prompt);
        await using var p = b.Build();
        var text = new System.Text.StringBuilder();
        await foreach (var seg in p.ProcessAsync(a)) text.Append(seg.Text);
        return Clean(text.ToString());
    }

    // Whisper marks silence and noise ("[BLANK_AUDIO]", "(music)") and sometimes invents a polite "Thank you." in a quiet room.
    public static string Clean(string t)
    {
        t = System.Text.RegularExpressions.Regex.Replace(t, @"\[[^\]]*\]|\([^)]*\)|\*[^*]*\*", " ");
        t = string.Join(" ", t.Split((char[])null, StringSplitOptions.RemoveEmptyEntries));
        return t is "Thank you." or "Thanks for watching!" or "you" or "." ? "" : t;
    }
}
