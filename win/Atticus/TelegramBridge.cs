using System.Net.Http;
using System.Text;
using System.Text.Json;

namespace Atticus;

// Chat with Oma from a phone through the user's own Telegram bot (Bot API long polling: nothing listens on this PC).
// The bot token sits in Windows Credential Manager (Atticus/remote_telegram). Only the one chat that sent
// "/pair <code>" (the code shown in Settings) is obeyed; others get one refusal. A request runs exactly like a typed one
// in the Oma window (Agent Town, Dave, the same safety gate); an Allow card also comes to the phone as two buttons.
// Voice notes are transcribed on this PC by the same GPU speech engine as the microphone (nothing goes to another service).
// Safety: private chats only; messages that waited while Oma was off are not run; wrong pairing codes are limited.
static class TelegramBridge
{
    static readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(40) };
    static CancellationTokenSource cts;
    static string token = "";
    static readonly HashSet<long> refused = new();
    static bool lastVoice, lastBangla, waiting;   // the running request: asked by voice note? in Bangla? an Allow waiting on the phone?
    static int wrongCodes;
    const int StaleSecs = 180;   // a request older than this waited in Telegram while Oma was off or offline: never run it late
    public static string State = "off", Bot = "", Code = "", Error = "";
    public static Action Changed;
    public static long Chat => (long)Prefs.Num("telegramChat");

    public static void Start()
    {
        Stop();
        token = Py.Run(new[] { "--secret-get", "remote_telegram" }, 15).Trim();
        if (token.Length < 20) { State = "off"; Changed?.Invoke(); return; }
        cts = new CancellationTokenSource();
        _ = Loop(cts.Token);
    }

    public static void Stop() { cts?.Cancel(); cts = null; State = "off"; Bot = ""; Code = ""; }

    static async Task<JsonElement?> Api(string method, object body = null, CancellationToken ct = default)
    {
        try
        {
            var url = $"https://api.telegram.org/bot{token}/{method}";
            using var r = body == null ? await http.GetAsync(url, ct)
                                       : await http.PostAsync(url, new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"), ct);
            var j = JsonDocument.Parse(await r.Content.ReadAsStringAsync(ct)).RootElement;
            if (j.TryGetProperty("ok", out var ok) && ok.GetBoolean()) return j.GetProperty("result").Clone();
            Error = j.TryGetProperty("description", out var d) ? d.GetString() ?? "" : $"HTTP {(int)r.StatusCode}";
            return null;
        }
        catch (OperationCanceledException) { return null; }
        catch (Exception e) { Error = e.Message; return null; }
    }

    static async Task Loop(CancellationToken ct)
    {
        State = "checking"; Changed?.Invoke();
        var me = await Api("getMe", null, ct);
        while (me == null && !ct.IsCancellationRequested && !Error.Contains("Unauthorized") && !Error.Contains("Not Found"))
        {   // no network yet (just after boot, Wi-Fi drop): keep trying; a wrong token stops here
            State = "error"; Changed?.Invoke(); Program.Err("Telegram: getMe failed, retrying in 30 s: " + Error);
            await Task.Delay(30000, ct).ContinueWith(_ => { });
            me = await Api("getMe", null, ct);
        }
        if (me == null) { State = "error"; Changed?.Invoke(); Program.Err("Telegram: getMe failed: " + Error); return; }
        Bot = me.Value.GetProperty("username").GetString() ?? "";
        if (Chat == 0) Code = Random.Shared.Next(100000, 999999).ToString();
        State = Chat == 0 ? "pairing" : "connected"; Changed?.Invoke();
        Program.Err($"Telegram: @{Bot} {State}");
        _ = Api("setMyCommands", new { commands = new[] { new { command = "status", description = "Oma এখন কী করছে" }, new { command = "stop", description = "চলমান কাজ থামাও" }, new { command = "help", description = "কীভাবে ব্যবহার করবে" } } });
        long offset = 0;
        while (!ct.IsCancellationRequested)
        {
            var ups = await Api($"getUpdates?timeout=25&offset={offset}", null, ct);
            if (ups == null) { if (!ct.IsCancellationRequested) await Task.Delay(5000, ct).ContinueWith(_ => { }); continue; }
            foreach (var u in ups.Value.EnumerateArray())
            {
                offset = u.GetProperty("update_id").GetInt64() + 1;
                try
                {
                    if (u.TryGetProperty("message", out var m)) await OnMessage(m);
                    else if (u.TryGetProperty("callback_query", out var q)) await OnButton(q);
                }
                catch (Exception e) { Program.Err("Telegram: " + e.Message); }
            }
        }
    }

    public static Task Send(long chat, string text, object buttons = null) =>
        Api("sendMessage", buttons == null ? new { chat_id = chat, text = text.Length > 3900 ? text[..3900] + "…" : text }
                                           : new { chat_id = chat, text, reply_markup = new { inline_keyboard = buttons } });

    static async Task OnMessage(JsonElement m)
    {
        var chatEl = m.GetProperty("chat");
        var chat = chatEl.GetProperty("id").GetInt64();
        if (chatEl.TryGetProperty("type", out var ty) && ty.GetString() != "private") return;   // a group: anyone in it could give orders
        var text = m.TryGetProperty("text", out var t) ? (t.GetString() ?? "").Trim() : "";
        var cmd = text.Split(' ', 2)[0].Split('@')[0].ToLowerInvariant();   // "/stop@OmaBot" from the command menu
        if (Chat == 0)
        {
            if (Code != "" && text == "/pair " + Code)
            {
                Prefs.Set("telegramChat", (double)chat); Code = ""; wrongCodes = 0; State = "connected"; Changed?.Invoke();
                Program.Err($"Telegram: paired with chat {chat}");
                await Send(chat, "✓ Paired with Oma on your PC. Send any request as text or a voice note, e.g. \"Chrome e YouTube khule lofi music search koro\".");
            }
            else
            {
                if (cmd == "/pair" && ++wrongCodes >= 5)
                {   // guessing: a fresh code after each 5 wrong tries makes it hopeless
                    wrongCodes = 0; Code = Random.Shared.Next(100000, 999999).ToString(); Changed?.Invoke();
                    Program.Err("Telegram: 5 wrong pairing codes, a new code was made");
                }
                await Send(chat, "Send /pair followed by the 6-digit code shown in Oma → Settings → Integrations.");
            }
            return;
        }
        if (chat != Chat) { if (refused.Add(chat)) await Send(chat, "This Oma is paired with someone else."); return; }
        var age = DateTimeOffset.UtcNow.ToUnixTimeSeconds() - (m.TryGetProperty("date", out var dt) ? dt.GetInt64() : 0);
        if (age > StaleSecs)
        {
            Program.Err($"Telegram: a request {age} s old was not run");
            await Send(chat, $"✕ Not run: this was sent {age / 60} min ago while Oma was off or offline. Send it again if you still want it.");
            return;
        }
        var voice = text == "" && (m.TryGetProperty("voice", out _) || m.TryGetProperty("audio", out _));
        if (cmd is "/start" or "/help" || (text == "" && !voice))
        {
            await Send(chat, "Send a request in Bangla, Banglish or English, as text or a voice note. Oma runs it on your PC and replies here. Risky steps ask you first.\n/status: what Oma is doing\n/stop: stop the running request");
            return;
        }
        if (cmd == "/status") { await Send(chat, Program.Settings?.RemoteStatus() ?? "Oma is starting."); return; }
        if (cmd == "/stop") { Program.Post(() => Program.Settings?.RemoteStop()); await Send(chat, "Stopping the running request (if any)."); return; }
        if (text == "")
        {
            text = await Hear(m);
            if (string.IsNullOrWhiteSpace(text)) { await Send(chat, "✕ Could not make out the voice note. Try again or send text."); return; }
            await Send(chat, "🎤 " + text);
        }
        // Session isolation with the PC microphone (a Live conversation can hear the user talking into the phone)
        var live = Program.Settings?.Live;
        if (live?.On == true)
        {
            live.PhoneSession();
            if (voice && !waiting)
            {
                var sent = DateTimeOffset.FromUnixTimeSeconds(m.GetProperty("date").GetInt64()).LocalDateTime;
                var secs = m.TryGetProperty("voice", out var vv) && vv.TryGetProperty("duration", out var dd) ? dd.GetInt32() : 5;
                var from = sent.AddSeconds(-secs - 2);
                if (live.HeardBetween(from, sent.AddSeconds(2)))
                {
                    var run = await live.ToolSince(from, TimeSpan.FromSeconds(6));   // the PC may still be deciding
                    if (run != null)
                    {
                        Program.Err("Telegram: the PC microphone heard this voice note too and is doing it: not run twice");
                        var done = await Task.WhenAny(run.Result.Task, Task.Delay(TimeSpan.FromMinutes(3)));
                        var res = done == run.Result.Task ? run.Result.Task.Result : (Bangla(text) ? "PC-তে কাজটা এখনো চলছে।" : "It is still running on the PC.");
                        await Reply(chat, (Bangla(text) ? "✓ PC-র mic এটা আগেই শুনেছে, একবারই করা হয়েছে\n" : "✓ The PC microphone heard this too; it was done once\n") + res, voice);
                        return;
                    }
                }
                live.Suppress(TimeSpan.FromSeconds(60));   // Telegram does it: Live must not repeat it
            }
        }
        if (waiting)   // the answer to the Allow question, typed or said
        {
            var yn = YesNo(text);
            Program.Err($"Telegram: answer to the Allow question: {yn}");
            if (yn == "?") { await Send(chat, lastBangla ? "বুঝিনি: অনুমতি দেবেন? \"হ্যাঁ\" বা \"না\" বলুন, অথবা Allow / Don't Allow চাপুন।" : "Not sure: allow it? Say \"yes\" or \"no\", or tap Allow / Don't Allow."); return; }
            waiting = false;
            Program.Post(() => Program.Settings?.RemoteAnswer(yn));
            await Send(chat, yn == "y" ? "Allowed." : "Not allowed. Nothing was changed.");
            return;
        }
        lastVoice = voice; lastBangla = Bangla(text);
        await Send(chat, Bangla(text) ? "⏳ কাজ করছি…" : "⏳ On it…");
        Program.Post(() => Program.Settings?.RemoteAsk(text, reply => _ = Reply(chat, reply, voice)));
    }

    // Bangla in Bangla letters or in Banglish: the replies of the bridge itself follow it
    static bool Bangla(string t) => System.Text.RegularExpressions.Regex.IsMatch(t, @"[ঀ-৿]|\b(koro|kor|kholo|khulo|dao|daw|bondho|chalao|bajao|dekhao|likho|ki|keno|kivabe|ami|amar|amake|tumi|ache|hobe|bolo|shunao|sunao|ta|te|e)\b", System.Text.RegularExpressions.RegexOptions.IgnoreCase);

    // The result: asked by voice note -> answered by voice note (the status line stays text); typed -> text.
    static async Task Reply(long chat, string reply, bool voice)
    {
        waiting = false;
        var nl = reply.IndexOf('\n');
        var body = nl > 0 ? reply[(nl + 1)..] : reply;
        if (voice && !string.IsNullOrWhiteSpace(body))
        {
            var t0 = DateTime.Now;
            var ogg = await BanglaVoice.VoiceNote(body);
            if (ogg != null)
            {
                try
                {
                    using var form = new MultipartFormDataContent { { new StringContent(chat.ToString()), "chat_id" } };
                    if (nl > 0) form.Add(new StringContent(reply[..nl]), "caption");
                    var bytes = await File.ReadAllBytesAsync(ogg);
                    var f = new ByteArrayContent(bytes);
                    f.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("audio/ogg");
                    form.Add(f, "voice", "oma.ogg");
                    using var r = await http.PostAsync($"https://api.telegram.org/bot{token}/sendVoice", form);
                    Program.Err($"Telegram: voice reply {bytes.Length / 1024} KB, made and sent in {(DateTime.Now - t0).TotalMilliseconds:0} ms, HTTP {(int)r.StatusCode}");
                    if (r.IsSuccessStatusCode) return;
                }
                catch (Exception e) { Program.Err("Telegram: voice reply: " + e.Message); }
                finally { try { File.Delete(ogg); } catch { } }
            }
        }
        await Send(chat, reply);   // typed, or the voice could not be made: text
    }

    public static void AskPick(string question, List<string> options)
    {
        if (Chat == 0 || State != "connected" || options.Count == 0) return;
        var rows = options.Take(8).Select((o, i) => new object[] { new { text = o.Length > 60 ? o[..60] : o, callback_data = "p" + i } }).ToList();
        rows.Add(new object[] { new { text = "None of these", callback_data = "p-" } });
        _ = Send(Chat, "❔ " + question, rows.ToArray());
    }

    // A voice note: download it (Telegram keeps it as OGG/Opus) and transcribe it on this PC. "" = not understood.
    static async Task<string> Hear(JsonElement m)
    {
        var v = m.TryGetProperty("voice", out var vo) ? vo : m.GetProperty("audio");
        var secs = v.TryGetProperty("duration", out var du) ? du.GetInt32() : 0;
        if (secs > 120) return "";
        var fast = Program.Speech.Fast;
        if (!fast.Ready) { Program.Err("Telegram: voice note, but the GPU speech engine is not running"); return ""; }
        var f = await Api("getFile", new { file_id = v.GetProperty("file_id").GetString() });
        if (f == null || !f.Value.TryGetProperty("file_path", out var fp)) return "";
        var tmp = Path.Combine(Path.GetTempPath(), $"oma-tg-{Guid.NewGuid():N}.oga");
        try
        {
            var t0 = DateTime.Now;
            await File.WriteAllBytesAsync(tmp, await http.GetByteArrayAsync($"https://api.telegram.org/file/bot{token}/{fp.GetString()}"));
            var text = Speech.Clean(await fast.TranscribeFile(tmp, "") ?? "");
            Program.Err($"Telegram: voice note {secs} s -> {text.Length} chars in {(DateTime.Now - t0).TotalMilliseconds:0} ms");
            return text;
        }
        catch (Exception e) { Program.Err("Telegram: voice note: " + e.Message); return ""; }
        finally { try { File.Delete(tmp); } catch { } }
    }

    static async Task OnButton(JsonElement q)
    {
        var chat = q.GetProperty("message").GetProperty("chat").GetProperty("id").GetInt64();
        var data = q.TryGetProperty("data", out var d) ? d.GetString() : "";
        await Api("answerCallbackQuery", new { callback_query_id = q.GetProperty("id").GetString() });
        if (chat != Chat) return;
        if (data is "p-" || data.Length == 2 && data[0] == 'p' && char.IsDigit(data[1]))   // a "which one?" button: its option index ("" = none)
        {
            Program.Post(() => Program.Settings?.RemoteAnswer(data == "p-" ? "" : data[1..]));
            await Send(chat, "✓");
            return;
        }
        if (data is not ("y" or "n")) return;
        waiting = false;
        Program.Post(() => Program.Settings?.RemoteAnswer(data));
        await Send(chat, data == "y" ? "Allowed." : "Not allowed. Nothing was changed.");
    }

    public static void AskPhone(string question, string cmd)
    {
        if (Chat == 0 || State != "connected") return;
        waiting = true;
        _ = Send(Chat, $"⚠ Oma asks: {question}\n{cmd}", new[] { new object[] { new { text = "Allow", callback_data = "y" }, new { text = "Don't Allow", callback_data = "n" } } });
        if (lastVoice) _ = AskAloud();   // asked by voice note: asked back by voice note too (the user, Oct 29)
    }

    static async Task AskAloud()
    {
        var ogg = await BanglaVoice.VoiceNote(lastBangla ? "এই কাজটা করার আগে আপনার অনুমতি লাগবে। হ্যাঁ বা না বলুন, অথবা নিচের Allow বা Don't Allow চাপুন।"
                                                         : "I need your permission before doing this. Say yes or no, or tap Allow or Don't Allow below.");
        if (ogg == null) return;
        try
        {
            using var form = new MultipartFormDataContent { { new StringContent(Chat.ToString()), "chat_id" } };
            var f = new ByteArrayContent(await File.ReadAllBytesAsync(ogg));
            f.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("audio/ogg");
            form.Add(f, "voice", "oma.ogg");
            using var r = await http.PostAsync($"https://api.telegram.org/bot{token}/sendVoice", form);
        }
        catch (Exception e) { Program.Err("Telegram: voice question: " + e.Message); }
        finally { try { File.Delete(ogg); } catch { } }
    }

    // While an Allow is waiting, any message is its answer: "হ্যাঁ, অনুমতি দিচ্ছি, মুছে দাও" is yes, "না, থাক" is no; one with
    // neither (or both) is asked again. ("হ্যাঁ…" said in a whole sentence went to the engine as a new request, Oct 29.)
    // -> "y", "n" or "?"
    public static string YesNo(string t)
    {
        t = " " + System.Text.RegularExpressions.Regex.Replace(t.ToLowerInvariant(), @"[\p{P}\s]+", " ").Trim() + " ";
        var no = System.Text.RegularExpressions.Regex.IsMatch(t, @" (না|নাহ|নাহ্|no|nope|nah|na|dont|don t|deny|cancel|বাতিল|থাক|থামাও|দরকার নেই|করো না|দিও না|কোরো না) ");
        var yes = System.Text.RegularExpressions.Regex.IsMatch(t, @" (হ্যাঁ|হ্যা|হাঁ|হা|হুম|জি|ঠিক আছে|অনুমতি দি\S*|allow|yes|yeah|yep|ok|okay|haan|haa|ha|ji|thik ache|thik ase|koro|করো|করে দাও|দাও|মুছে দাও|delete) ");
        return yes == no ? "?" : yes ? "y" : "n";
    }
}
