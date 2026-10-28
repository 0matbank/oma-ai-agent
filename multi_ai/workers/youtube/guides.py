"""Condensed YouTube craft guides for Eve, the YouTube worker. Written for Oma from the ideas in
github.com/Jakeschincariol/youtube-agent-skill (MIT). Only the one guide the model asks for is printed
(`atticus --int youtube guide <name>`), so none of this sits in the system prompt."""

COMMON = ("Rules for every YouTube draft: write in the creator's voice (run `voice` first; if there is no profile, ask for 3 of "
          "their videos, read their transcripts and save one with `voice-save`). Never invent a number, result or source. "
          "Nothing is published by Oma: hand back a block the user copies, and end with: ship it, or change it?")

GUIDES = {
    'script': "Script. The first 15 s is the job: confirm the click, open a question, prove the payoff exists. Write 5 hooks, score them "
              "with `hook \"<line>\"` (each), show the best 2 with scores. Then: the turn (0:15-0:45, say what the video does and start; "
              "no intro or subscribe pitch), the body (one idea per beat, mark [ON SCREEN: ...] every beat), the payoff (say you are "
              "delivering it), one closing ask. Give a runtime at 150 words/min and name the winning hook's formula.",
    'package': "Title + thumbnail are one unit. Write 10 titles, check each with `title \"<title>\" --thumb \"<words>\"`, show the top 3 "
               "with score and main issue. Rules: <=60 chars (desktop cut), subject inside the first 40 (mobile), thumbnail never repeats "
               "title words, <=3 thumbnail words, a number/name/date beats adjectives, <=2 all-caps words. For the winner add a thumbnail "
               "brief: expression, framing, the 3 words, background contrast at feed size.",
    'seo': "Search matters most for evergreen videos; for subscriber-feed videos spend effort on packaging. Description: first 2 lines say "
           "what the viewer gets in the words they would search; then the link; then chapters; then the long version. Tags: up to 15, "
           "only for spellings, tool names, abbreviations; no unrelated tags. Write the 3 queries the video should win and check the title "
           "and first 2 lines contain those words.",
    'audit': "Audit ends in ONE fix. Look in order: last 10 titles as a set (`channel <url>` then `title` on each; same-shape titles = "
             "format problem); thumbnails at feed size; first 15 s of the 3 latest (`transcript <id>` then `hook`); upload consistency; "
             "retention export if they have one. Hand back: the single biggest fix with this week's action, 3 specific things already "
             "working, and what not to do yet.",
    'plan': "Ask first: real hours this week, and what is half-made. A week = one anchor video (most time, on the day their own analytics "
            "say is best), one cheap video from existing material, 3 Shorts cut from the anchor. Hand back a table: day, format, working "
            "title, the one-sentence promise, what exists already; then the hours it costs and what to drop first.",
    'shorts': "From a transcript (`transcript <id>`), find 20-55 s spans that: open on a complete thought, contain a turn, end on a line. "
              "Show the top 5 with timecodes and first line. For each: a NEW first line (score with `hook`), 2-second on-screen text with "
              "different words, a loop point, and a note on what a vertical crop loses.",
    'chapters': "Chapters render only if: first is 00:00, at least 3, each >= 10 s. Run `chapters <transcript.srt> [target]` for boundaries "
                "(it validates the rules), then rewrite every title as the promise of that section in 3-5 words. A section you cannot "
                "name in 5 words is two sections or filler.",
    'edit': "Edit list from a timestamped transcript: `deadair <file.srt|vtt|json> [floor]` finds DEAD gaps (trimmed from the middle), "
            "FILLER cues and REPEAT retakes with timecodes. It never touches media; the user applies the cuts. A silent demo makes its "
            "cut percentage wrong, so check against the footage.",
    'retention': "Studio > video > Analytics > Engagement > retention chart > download. Run `retention <file.csv> [duration_s] "
                 "[transcript]`. Three problems: HOOK LEAK (loss in first 30 s; <25% is healthy; fix the first 15 s of script), CLIFFS "
                 "(single drops; with a transcript you see what was said), SLIDE (steady bleed = pacing; cut). Name the biggest leak and "
                 "one change. Healthy hook + flat slide = the problem is packaging.",
    'viral': "What works in a niche: `outliers \"<channel url>\" [...]` ranks each video as a multiple of ITS OWN channel's median views "
             "(needs >= 4 videos per channel) and names the title formula. Public listings only, never a logged-in session. The formula is "
             "a judgement about the title, not proof of why it worked; say so. Hand back the top 5 with multiples and the one pattern.",
    'comment': "Triage pasted comments into questions (answer; note repeats as video ideas), corrections (agree plainly if right), praise "
               "(reply to a few, specifically), bait (do not reply). Replies under 30 words, answer in the first sentence, no promised "
               "videos, emoji only if the creator uses them. Say which ONE comment to pin. Oma only drafts; the user posts.",
}


def guide(name):
    g = GUIDES.get((name or '').lower().strip())
    if not g:
        return 'Guides: ' + ', '.join(GUIDES) + '. Run: guide <name>'
    return f'{g}\n{COMMON}'
