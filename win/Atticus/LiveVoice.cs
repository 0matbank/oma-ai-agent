// Real-time voice conversation through Gemini Live (Settings → "Real-time voice"): `atticus.py --live-voice` holds the
// session (see multi_ai/live_voice.py for the protocol and measurements). The shortcut or START begins it; once more ends it.
// The microphone streams in 100 ms pieces; Gemini's voice (24 kHz) plays as it arrives. While Oma speaks the microphone
// sends silence instead, so the speakers' sound is not heard back as the user (no echo cancellation here).
// PC work goes through Oma's own engine (SettingsWindow.RemoteAsk with source "live"): safety gate, Agent Town and log as usual.
using System.Diagnostics;
using System.Text.Json;
using NAudio.Wave;

namespace Atticus;

sealed class LiveVoice
{
    Process proc;
    WaveInEvent mic;
    WaveOutEvent speaker;
    BufferedWaveProvider played;
    DateTime quietAfter = DateTime.MinValue;   // Oma's voice still in the room until then
    readonly SettingsWindow w;
    public bool On => proc != null;

    public LiveVoice(SettingsWindow w) { this.w = w; }

    public void Start()
    {
        if (On) return;
        Program.Err("Live: starting");
        w.Js("holoOrb?.setState('thinking'); st.liveNote && st.liveNote('Connecting to Gemini Live…')");
        // "liveNatural": Gemini's native-audio model, more natural but slower (first sound 2.2-3.7 s against under 1 s; Oct 29)
        var model = Prefs.Bool("liveNatural") ? "gemini-2.5-flash-native-audio-latest" : "";
        try { proc = Py.Start(new[] { "--live-voice" }, new() { ["OMA_LIVE_MODEL"] = model }, input: true); }
        catch (Exception e) { Program.Err("Live: " + e.Message); proc = null; return; }
        var p = proc;
        _ = p.StandardError.ReadToEndAsync();
        _ = Task.Run(async () =>
        {
            try
            {
                while (await p.StandardOutput.ReadLineAsync() is { } line)
                    if (line.StartsWith("{")) { var l = line; Program.Post(() => OnLine(p, l)); }
            }
            catch { }
            Program.Post(() => { if (proc == p) Stop("the voice process ended"); });
        });
    }

    void OnLine(Process p, string line)
    {
        if (p != proc) return;
        JsonElement j;
        try { j = JsonDocument.Parse(line).RootElement.Clone(); } catch { return; }
        if (j.TryGetProperty("pcm", out var pcm))
        {
            var b = Convert.FromBase64String(pcm.GetString() ?? "");
            played?.AddSamples(b, 0, b.Length);
            quietAfter = DateTime.Now + (played?.BufferedDuration ?? TimeSpan.Zero) + TimeSpan.FromMilliseconds(350);
            w.Js("holoOrb?.setState('speaking')");
            return;
        }
        if (j.TryGetProperty("ready", out _)) { OpenAudio(); w.Js("holoOrb?.setState('listening'); st.liveNote && st.liveNote('Live voice is on: just talk. Press the shortcut or START again to end.')"); Program.Err("Live: ready " + line); return; }
        if (j.TryGetProperty("error", out var e)) { Program.Err("Live: " + e.GetString()); w.Js($"st.liveNote && st.liveNote({Web.Json("✕ " + e.GetString())})"); Stop("error"); return; }
        if (j.TryGetProperty("heard", out var h)) { w.Js($"st.liveHeard && st.liveHeard({Web.Json(h.GetString())})"); return; }
        if (j.TryGetProperty("said", out var s)) { w.Js($"st.liveSaid && st.liveSaid({Web.Json(s.GetString())})"); return; }
        if (j.TryGetProperty("interrupted", out _)) { played?.ClearBuffer(); quietAfter = DateTime.Now; return; }
        if (j.TryGetProperty("turn", out _)) { return; }
        if (j.TryGetProperty("answer", out var an)) { Program.Err("Live: spoken answer to a card"); w.RemoteAnswer(an.GetString() ?? ""); return; }
        if (j.TryGetProperty("tool", out var t))
        {
            var id = t.GetProperty("id").GetString() ?? "";
            var req = t.GetProperty("request").GetString() ?? "";
            Program.Err($"Live: run_on_pc ({req.Length} chars)");
            w.Js("holoOrb?.setState('thinking')");
            w.RemoteAsk(req, reply => Send(new { tool = new { id, result = reply } }), "live");
            return;
        }
        if (j.TryGetProperty("closed", out var c)) { Program.Err("Live: closed: " + c.GetString()); Stop(c.GetString()); }
    }

    void OpenAudio()
    {
        played = new BufferedWaveProvider(new WaveFormat(24000, 16, 1), TimeSpan.FromMinutes(3)) { DiscardOnBufferOverflow = true };   // Gemini sends a long story faster than it plays
        speaker = new WaveOutEvent();
        speaker.Init(new Steady(played));
        speaker.Play();
        mic = new WaveInEvent { WaveFormat = new WaveFormat(16000, 16, 1), BufferMilliseconds = 100 };
        mic.DataAvailable += (_, e) =>
        {
            var quiet = DateTime.Now < quietAfter;
            var b = new byte[e.BytesRecorded];
            if (!quiet) Buffer.BlockCopy(e.Buffer, 0, b, 0, e.BytesRecorded);   // silence while Oma speaks: no echo
            else Program.Post(() => { if (DateTime.Now >= quietAfter) w.Js("holoOrb?.setState('listening')"); });
            if (!quiet)
            {
                double sum = 0;
                for (int i = 0; i + 1 < b.Length; i += 2) { var v = BitConverter.ToInt16(b, i) / 32768.0; sum += v * v; }
                var level = Math.Min(1, Math.Sqrt(sum / Math.Max(1, b.Length / 2)) * 14);
                Program.Post(() => w.Js($"holoOrb?.setAudioLevel({level:0.00})"));
            }
            Send(new { a = Convert.ToBase64String(b) });
        };
        try { mic.StartRecording(); }
        catch (Exception ex) { Program.Err("Live: mic: " + ex.Message); w.Js($"st.liveNote && st.liveNote({Web.Json("✕ Microphone: " + ex.Message)})"); Stop("no microphone"); }
    }

    readonly object sendLock = new();
    void Send(object o)
    {
        var p = proc;
        if (p == null) return;
        try { lock (sendLock) { p.StandardInput.WriteLine(JsonSerializer.Serialize(o)); p.StandardInput.Flush(); } } catch { }
    }

    // Gemini's audio comes over the network in bursts; played as it lands, a late piece left gaps that made the voice
    // sound broken and machine-like at times (the user, Oct 29). After any gap, wait until 300 ms are ready, then play on.
    sealed class Steady(BufferedWaveProvider src) : IWaveProvider
    {
        bool flowing;
        public WaveFormat WaveFormat => src.WaveFormat;
        public int Read(Span<byte> buffer)
        {
            if (!flowing && src.BufferedDuration < TimeSpan.FromMilliseconds(300)) { buffer.Clear(); return buffer.Length; }
            flowing = true;
            var n = src.Read(buffer);
            if (src.BufferedBytes == 0) flowing = false;
            return n;
        }
    }

    // An Allow card or a "which one?" card for a request this conversation made: Gemini asks it aloud too.
    public void Ask(string question, string command) => Send(new { ask = new { question, command } });
    public void Pick(string question, List<string> options) => Send(new { pick = new { question, options } });

    // Oma is talking: stop that now (the shortcut while it speaks).
    public bool Hush()
    {
        if (!On || DateTime.Now >= quietAfter) return false;
        played?.ClearBuffer(); quietAfter = DateTime.Now;
        return true;
    }

    public void Stop(string why = "ended")
    {
        var p = proc;
        if (p == null) return;
        proc = null;
        try { mic?.StopRecording(); } catch { }
        mic?.Dispose(); mic = null;
        try { speaker?.Stop(); } catch { }
        speaker?.Dispose(); speaker = null; played = null;
        try { p.StandardInput.WriteLine("{\"end\": true}"); p.StandardInput.Flush(); } catch { }
        _ = Task.Run(async () => { await Task.Delay(1500); Py.Stop(p); p.Dispose(); });
        Program.Err("Live: stopped (" + why + ")");
        w.Js($"holoOrb?.setState('idle'); st.liveNote && st.liveNote({Web.Json("Live voice ended (" + why + ").")})");
    }
}
