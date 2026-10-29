# Voice token cap and key rotation

Status: shipped

## Purpose

Voice runs on Groq's free tier. Two pieces keep it usable: a per-user daily chat-token ceiling so one account cannot drain the shared quota, and rotation across several Groq keys so a rate-limited key does not stop the whole app.

## User-facing behavior

- A user can talk to the app until their voice chat tokens for the civil day reach the ceiling (default **100,000**). After that, voice calls fail with HTTP 429 and the voice sheet shows the API message: "Daily voice limit reached. Try again tomorrow." (Ukrainian text for a Ukrainian UI.) There is no special quota screen, counter, or warning before the limit.
- The day is the user's **Settings time zone** civil day. Usage resets at local midnight in that zone, not at UTC midnight.
- Voice sessions keep working across short Groq rate limits: the server waits briefly or switches to another key, and the user only sees a "voice is busy, try again" message if every attempt fails.
- Other AI features keep working when voice is exhausted: schedule suggestions, habit streak tips, and conflict-option phrases do not draw from this ceiling.
- Setting `VOICE_DAILY_TOKEN_LIMIT=0` turns the ceiling off for the whole deployment.

## Logic

**Where the ceiling is checked.** `VoiceQuotaService.assertUnderLimit(userId)` runs first in:

- `POST /voice/turn`
- `POST /voice/transcribe`
- `POST /voice/parse-task` (including the parse that `turn` calls internally)

`POST /voice/speak` (local Piper text-to-speech) is not checked.

Steps:

1. Read the limit: `VOICE_DAILY_TOKEN_LIMIT`; empty → 100,000; a non-number or negative value → 100,000; otherwise the floored value. A limit of 0 or less returns without checking.
2. Find the user's civil day in `settings.timeZone` (`resolveIanaTimeZone`, UTC if unset).
3. Read `voice_daily_usage` for `(userId, dayYmd)`. If `tokensUsed >= limit`, throw 429 with code `VOICE_QUOTA_EXCEEDED`. The exception filter localizes the message from the request language.

**What counts.** Only Groq **chat** completions inside a pinned request context add tokens. `GroqClient.chatCompletion` adds `usage.total_tokens` to the context, and after the call finishes `VoiceService` adds the context total to the user's row (`addTokens`: insert or increment). Whisper speech-to-text adds nothing, but `transcribe` still checks the ceiling first and refuses once the day is exhausted.

**Key pinning and rotation.**

- Keys are discovered as `GROQ_API_KEY`, then `GROQ_API_KEY_2`, `_3`, … until the first gap (up to 64).
- Rotation is on when two or more usable keys exist, or when `GROQ_ROTATE_KEYS` is `1`/`true`. With one key the client uses `GROQ_API_KEY` only.
- A voice session (`sessionId`) pins one key on first use and keeps it for transcribe and turn. A parse without a session pins the next key for that single call.
- Tokens-per-minute 429: wait on the same key (the wait is capped at 6 seconds), then hop to the next key and retry. Tokens-per-day 429 whose retry-after is longer than that cap: retire the pinned key for the process lifetime and retry once on the next live key. With rotation on, only the default chat model is used; without it, a 429 can fall back to `gpt-oss-120b`.
- Retired key names live in memory and reset when the process restarts.

What is written: `voice_daily_usage` (`userId`, `dayYmd`, `tokensUsed`), unique per user and day.

## Edge cases

- **Check before, count after.** A call that starts under the limit can push usage past it; the next call is the first to be refused.
- **Failed calls are not counted.** If the Groq call throws, the pinned context total is discarded and nothing is added.
- **Local LLM.** When `LLM_BASE_URL` is set, parse runs on the local model, which records no tokens, so only Groq-based work counts.
- **Concurrent calls** read and write the usage row without a lock, so parallel turns can undercount slightly.
- **Time zone change.** Changing Settings time zone changes which civil day is counted; yesterday's row is simply not read.
- **No Groq key.** Voice fails with a service-unavailable message before any usage is recorded.
- **Quota refused before validation.** An empty audio body still returns 429 first when the day is already exhausted.
- **Habit streak tips** use `GroqClient` outside a pin context, so they never add tokens.

## Data / settings / API

- Env: `VOICE_DAILY_TOKEN_LIMIT` (default 100000, `0` disables), `GROQ_API_KEY`, `GROQ_API_KEY_N`, `GROQ_ROTATE_KEYS`, `GROQ_SKIP_FIRST_KEY`, `GROQ_SKIP_KEY_NAMES`.
- Table `voice_daily_usage`: `userId`, `dayYmd` (`YYYY-MM-DD`), `tokensUsed`.
- Errors: 429 `VOICE_QUOTA_EXCEEDED`; 503 `VOICE_RATE_LIMIT` (Groq rate limit after retries, with `daily` and `retryAfterMs`); 503 `VOICE_LLM_TIMEOUT`.
- Code: `voice-quota.service.ts`, `groq.client.ts`, `voice.service.ts`, `all-exceptions.filter.ts`.

## Out of scope

- A paid plan that replaces the free ceiling (roadmap Payments).
- Putting suggestions, habit tips, or conflict phrases under the same ceiling.
- Eval-harness rotation flags ([voice-prompt-next.md](../voice-prompt-next.md)).
- Per-key usage reporting.

## Known gaps

- No usage meter or low-quota warning; users find out when a call is refused.
- Tokens from a failed call and from the local LLM are not counted; Whisper is never counted.
- The usage row is updated without locking, so concurrent turns can undercount.
- Retired keys are forgotten on restart, so an exhausted key is tried again.
- The limit is one global number per deployment; there is no per-user override.
- Suggestions, habit tips, and conflict phrases are uncapped and can still exhaust the Groq organization quota that voice shares.

## Related

- [integrations.md](../integrations.md)
- [setup-and-build.md](../setup-and-build.md)
- [spec-voice-agent.md](../spec-voice-agent.md)
- [language.md](language.md)
