# Integrations: OAuth and calendars

## Purpose

The app is the scheduling source of truth. Users **sign in** with **Google** (or **Microsoft** when configured). **Apple is not a sign-in provider** — iCloud Calendar is linked only from Settings via CalDAV. One account can link several calendar providers. Connected calendars appear in the Calendar visibility filter (provider sections → calendars). Settings stores `syncTargetCalendars` (default unset, or sync nowhere). App-task create/update/delete still writes Google only; that stored list is not read by the writer yet.

Inbound events that the user has not touched stay on the provider. Placement, the scheduling engine, the Problematic slot picker, reminders, schedule suggestions, and voice now/agenda/gaps treat timed events on every **visible** connected calendar as busy (hidden calendars are skipped; cancelled and “show as free” events are not). A thin **calendar event overlay** stores scheduling mode (`fixed` | `flexible`) only after the user changes type. Moving a flexible event writes time back to the provider (with a dismissible warning). Automatic placement does not move those external events; it schedules around them. Unscheduled removes the external event and creates a local Unscheduled task.

`syncExternalDeletions` (legacy name `syncGoogleDeletions`, default off): when a linked external event is gone during sync retry, clear local ids only; when on, also delete the local task / overlay.

Google and Microsoft (when `MICROSOFT_*` is set) use OAuth. Apple iCloud uses per-user CalDAV credentials (no server Apple Developer app).

---

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

### Backend environment variables (Google)

```env
GOOGLE_CLIENT_ID=....apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3001/google-calendar/callback
FRONTEND_URL=http://localhost:3000
```

`FRONTEND_URL` is the base URL for redirects after the callback is processed (success / error).

### Common Google endpoints (short)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/auth/google` | Google sign-in URL (login or register) |
| GET | `/google-calendar/auth-url` | Same sign-in URL (older alias) |
| GET | `/google-calendar/callback` | Exchange `code`, then redirect to the frontend with a one-time ticket |
| GET | `/google-calendar/check-connection` | Whether connected |
| POST | `/google-calendar/disconnect` | Disconnect |

Full list: Swagger (`/api`).

### Clear schedule and Google

**`DELETE /schedule`** removes **still-open** app-generated local slots through the **Recurring schedule horizon** in Settings (fully ended blocks, including earlier today, stay). Then it deletes leftover **upcoming** events on the **app Google calendar** in that window. Recurring series that still have ended instances are capped with `UNTIL` instead of deleting the master. If Google is disconnected, local rows are still removed.

App recurring tasks sync as one Google RRULE whose **DTSTART** uses the **majority local clock** among open seats (not the chronologically first skewed day). See [spec-intelligent-scheduling.md](spec-intelligent-scheduling.md) and [spec-incremental-placement.md](spec-incremental-placement.md) §7.

### Error `redirect_uri_mismatch`

The URI sent to Google does **not** match any **Authorized redirect URI** in the console.

Check:

1. The console lists the same URI as `GOOGLE_REDIRECT_URI` (scheme, host, port, path).  
2. The backend was restarted after changing `.env`.  
3. No stray slashes or `http` vs `https` mismatch.

Older examples in the wild used port **3000** for the callback; that is misleading when Nest handles OAuth on **3001**. Use `backend/.env.example` and `google-calendar.controller.ts` as the source of truth.

---

## Microsoft Azure AD / Outlook

Used for sign-in and Microsoft Graph calendars. After env vars are set and the backend is restarted, **Continue with Microsoft** on `/login` and **Connect Microsoft** in Settings work end-to-end (token exchange + calendar list/events on the grid).

1. Open [Azure Portal](https://portal.azure.com) → **Microsoft Entra ID** → **App registrations** → **New registration**.
2. Name the app; supported account types: **Accounts in any organizational directory and personal Microsoft accounts**.
3. Redirect URI (Web): must match `MICROSOFT_REDIRECT_URI` exactly, e.g. `http://localhost:3001/auth/microsoft/callback`.
4. **Certificates & secrets** → new client secret; copy value once.
5. **API permissions** → Microsoft Graph delegated: `openid`, `profile`, `email`, `offline_access`, `Calendars.ReadWrite`, `User.Read`. Grant admin consent if the tenant requires it.
6. Note **Application (client) ID** and **Directory (tenant) ID** (use `common` for multi-tenant + personal).

### Backend environment variables (Microsoft)

```env
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_REDIRECT_URI=http://localhost:3001/auth/microsoft/callback
# Optional; default common
MICROSOFT_TENANT=common
```

---

## Apple iCloud Calendar (CalDAV)

Apple is **Settings-only** (not on the login screen). The user pastes an Apple ID email and an **app-specific password**. The backend verifies CalDAV against `https://caldav.icloud.com`, then stores credentials in `user_identities` (`provider: apple`; app password in `accessToken`, never returned to the client).

### User steps (also shown in Settings)

1. Open [appleid.apple.com](https://appleid.apple.com) and sign in.
2. **Sign-In and Security** → **App-Specific Passwords**.
3. Generate a password (e.g. “AI Calendar”). Two-factor authentication must be on.
4. In the app: Settings → Calendar accounts → Connect Apple Calendar → paste Apple ID + that password (not the Apple account password).

No `APPLE_*` server environment variables are required.

API: `POST /auth/apple/caldav` with `{ appleId, appSpecificPassword }` (JWT). Disconnect: `POST /auth/identities/apple/disconnect` with `{ confirm: true }`.

---

## Groq (voice)

Voice task creation uses a **free Groq API key** (no credit card). Create one at [console.groq.com/keys](https://console.groq.com/keys) and set `GROQ_API_KEY` in `backend/.env` (and on Render for production). Optional extras: `GROQ_API_KEY_2`, `GROQ_API_KEY_3`, … (any count). When two or more are set, the live API rotates on a tokens-per-minute or tokens-per-day 429; one voice session pins one key until that hop.

- Speech-to-text: `whisper-large-v3` by default (override with `GROQ_STT_MODEL`; turbo is faster but weaker on short uk/ru). Language comes from Settings; a Whisper vocabulary prompt + light transcript cleanup help calendar phrases. Do not send audio to the LLM. STT uses the same pinned key as chat for that session.
- Task parse: local Ollama when `LLM_BASE_URL` is set (`calendar-voice`, Qwen3 14B). Otherwise `openai/gpt-oss-20b` with JSON mode. A token-per-minute 429 waits the few seconds Groq asks for and retries the same key, then hops to the next configured key when extras exist. With a single key only, chat may fall back to `openai/gpt-oss-120b`. Llama 3.x IDs on Groq are enterprise-only and will 503 on a free key. A chat call that does not answer within 25 seconds fails as `VOICE_LLM_TIMEOUT` and does not start a second parse.
- Companion planner (`/voice/turn`: splitting multi-intent utterances, day-plan dialogue): `openai/gpt-oss-120b` by default (override with `GROQ_PLANNER_MODEL`). A 429 on the planner model falls back to the parse model (`GROQ_LLM_MODEL`, default `openai/gpt-oss-20b`). Each segment is still parsed by the 20b specialist. Planner tokens count toward the same daily ceiling.
- Per-user free ceiling: chat `usage.total_tokens` per civil day (settings IANA zone), default 100000 via `VOICE_DAILY_TOKEN_LIMIT`. When exhausted, voice returns `VOICE_QUOTA_EXCEEDED` and the sheet blocks further turns until the next day.
- Spoken replies: local Piper when `PIPER_URL` is set (`npm run start:piper`, Ukrainian Тетяна and English Lessac). Otherwise the browser voice. Piper is a separate process; its binary and weights stay in `local/piper` and are not committed.
- Audio and transcripts are not persisted.

Microphone access needs HTTPS (or `localhost`). The frontend is an installable PWA.

## Diagnostics

- Backend logs when clicking “Connect Google Calendar”.  
- Compare `GOOGLE_REDIRECT_URI` with the Google console.  
- Swagger: confirm the server is running and `/google-calendar/*` routes match expectations.
- For Microsoft: confirm redirect URIs and env vars before enabling the login button in production.
- For Apple: confirm CalDAV connect from Settings with an app-specific password (no Apple Developer OAuth).
