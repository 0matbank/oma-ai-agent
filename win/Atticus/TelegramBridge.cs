using System.Net.Http;
using System.Text;
using System.Text.Json;

namespace Atticus;

// Chat with Oma from a phone through the user's own Telegram bot (Bot API long polling: nothing listens on this PC).
// The bot token sits in Windows Credential Manager (Atticus/remote_telegram). Only the one chat that sent
// "/pair <code>" (the code shown in Settings) is obeyed; others get one refusal. A request runs exactly like a typed one
// in the Oma window (Agent Town, Dave, the same safety gate); an Allow card also comes to the phone as two buttons.
static class TelegramBridge
{
    static readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(40) };
    static CancellationTokenSource cts;
    static string token = "";
    static readonly HashSet<long> refused = new();
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
        if (me == null) { State = "error"; Changed?.Invoke(); Program.Err("Telegram: getMe failed: " + Error); return; }
        Bot = me.Value.GetProperty("username").GetString() ?? "";
        if (Chat == 0) Code = Random.Shared.Next(100000, 999999).ToString();
        State = Chat == 0 ? "pairing" : "connected"; Changed?.Invoke();
        Program.Err($"Telegram: @{Bot} {State}");
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
        var chat = m.GetProperty("chat").GetProperty("id").GetInt64();
        var text = m.TryGetProperty("text", out var t) ? (t.GetString() ?? "").Trim() : "";
        if (Chat == 0)
        {
            if (Code != "" && text == "/pair " + Code)
            {
                Prefs.Set("telegramChat", (double)chat); Code = ""; State = "connected"; Changed?.Invoke();
                await Send(chat, "✓ Paired with Oma on your PC. Send any request, e.g. \"Chrome e YouTube khule lofi music search koro\".");
            }
            else await Send(chat, "Send /pair followed by the 6-digit code shown in Oma → Settings → Integrations.");
            return;
        }
        if (chat != Chat) { if (refused.Add(chat)) await Send(chat, "This Oma is paired with someone else."); return; }
        if (text is "" or "/start" or "/help") { await Send(chat, "Send a request in Bangla, Banglish or English. Oma runs it on your PC and replies here. Risky steps ask you first."); return; }
        await Send(chat, "⏳ On it…");
        Program.Post(() => Program.Settings?.RemoteAsk(text, reply => _ = Send(chat, reply)));
    }

    static async Task OnButton(JsonElement q)
    {
        var chat = q.GetProperty("message").GetProperty("chat").GetProperty("id").GetInt64();
        var data = q.TryGetProperty("data", out var d) ? d.GetString() : "";
        await Api("answerCallbackQuery", new { callback_query_id = q.GetProperty("id").GetString() });
        if (chat != Chat || data is not ("y" or "n")) return;
        Program.Post(() => Program.Settings?.RemoteAnswer(data));
        await Send(chat, data == "y" ? "Allowed." : "Not allowed. Nothing was changed.");
    }

    public static void AskPhone(string question, string cmd)
    {
        if (Chat == 0 || State != "connected") return;
        _ = Send(Chat, $"⚠ Oma asks: {question}\n{cmd}", new[] { new object[] { new { text = "Allow", callback_data = "y" }, new { text = "Don't Allow", callback_data = "n" } } });
    }
}
