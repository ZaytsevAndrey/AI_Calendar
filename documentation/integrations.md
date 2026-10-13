# Integrations: Google OAuth and Calendar

## Purpose

Google sign-in is the only login. One OAuth consent covers the account (`openid`, `email`, `profile`) and Calendar scopes. Tokens are stored on the backend. The callback redirects the browser to the frontend `/auth/google/callback?ticket=…` (or `/login?error=…`). That sign-in marks `googleCalendarLinked`; there is no separate “connect calendar before you can enter” step.

## Google Cloud Console setup

1. Enable **Google Calendar API** for the project.  
2. Configure the **OAuth consent screen**.  
3. Create an **OAuth 2.0 Client ID** (Web application).  
4. Under **Authorized redirect URIs**, add a URI that **exactly** matches `GOOGLE_REDIRECT_URI` in `backend/.env`.

Typical local development value:

```text
http://localhost:3001/google-calendar/callback
```

Typical production values (see [deploy](deploy.md)):

```text
https://<ai-calendar-api>.onrender.com/google-calendar/callback
```

## Backend environment variables

```env
GOOGLE_CLIENT_ID=....apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3001/google-calendar/callback
FRONTEND_URL=http://localhost:3000
```

`FRONTEND_URL` is the base URL for redirects after the callback is processed (success / error).

## Common endpoints (short)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/auth/google` | Google sign-in URL (login or register) |
| GET | `/google-calendar/auth-url` | Same sign-in URL (older alias) |
| GET | `/google-calendar/callback` | Exchange `code`, then redirect to the frontend with a one-time ticket |
| GET | `/google-calendar/check-connection` | Whether connected |
| POST | `/google-calendar/disconnect` | Disconnect |

Full list: Swagger (`/api`).

## Clear schedule and Google

**`DELETE /schedule`** removes **still-open** app-generated local slots through the **Recurring schedule horizon** in Settings (fully ended blocks, including earlier today, stay). Then it deletes leftover **upcoming** events on the **app Google calendar** in that window. Recurring series that still have ended instances are capped with `UNTIL` instead of deleting the master. If Google is disconnected, local rows are still removed.

App recurring tasks sync as one Google RRULE whose **DTSTART** uses the **majority local clock** among open seats (not the chronologically first skewed day). See [spec-intelligent-scheduling.md](spec-intelligent-scheduling.md) and [spec-incremental-placement.md](spec-incremental-placement.md) §7.

## Error `redirect_uri_mismatch`

The URI sent to Google does **not** match any **Authorized redirect URI** in the console.

Check:

1. The console lists the same URI as `GOOGLE_REDIRECT_URI` (scheme, host, port, path).  
2. The backend was restarted after changing `.env`.  
3. No stray slashes or `http` vs `https` mismatch.

Older examples in the wild used port **3000** for the callback; that is misleading when Nest handles OAuth on **3001**. Use `backend/.env.example` and `google-calendar.controller.ts` as the source of truth.

## Groq (voice and suggestions)

Voice task creation and Calendar **Suggestions** use a **free Groq API key** (no credit card). Create one at [console.groq.com/keys](https://console.groq.com/keys) and set `GROQ_API_KEY` in `backend/.env` (and on Render for production).

- Speech-to-text: `whisper-large-v3` by default (override with `GROQ_STT_MODEL`; turbo is faster but weaker on short uk/ru). Language comes from Settings; a Whisper vocabulary prompt + light transcript cleanup help calendar phrases. Do not send audio to the LLM.
- Task parse and schedule suggestions: local Ollama when `LLM_BASE_URL` is set (`calendar-voice`, Qwen3 14B). Otherwise `openai/gpt-oss-20b` with JSON mode. A token-per-minute 429 waits the few seconds Groq asks for and retries the same model, then falls back to `openai/gpt-oss-120b`. Llama 3.x IDs on Groq are enterprise-only and will 503 on a free key. Suggestions are not stored.
- Spoken replies: local Piper when `PIPER_URL` is set (`npm run start:piper`, Ukrainian Тетяна and English Lessac). Otherwise the browser voice. Piper is a separate process; its binary and weights stay in `local/piper` and are not committed.
- Audio and transcripts are not persisted.

Microphone access needs HTTPS (or `localhost`). The frontend is an installable PWA.

## Diagnostics

- Backend logs when clicking “Connect Google Calendar”.  
- Compare `GOOGLE_REDIRECT_URI` with the Google console.  
- Swagger: confirm the server is running and `/google-calendar/*` routes match expectations.
