# Integrations: Google OAuth and Calendar

## Purpose

Connect a Google account to read/manage events via the Google Calendar API. Tokens are stored on the backend; after successful OAuth the user is redirected to the frontend (usually settings with query `googleCalendar=success|error`).

## Google Cloud Console setup

1. Enable **Google Calendar API** for the project.  
2. Configure the **OAuth consent screen**.  
3. Create an **OAuth 2.0 Client ID** (Web application).  
4. Under **Authorized redirect URIs**, add a URI that **exactly** matches `GOOGLE_REDIRECT_URI` in `backend/.env`.

Typical local development value:

```text
http://localhost:3001/google-calendar/callback
```

The backend listens on port **3001** by default; the callback is handled by the **server**, not the frontend dev server.

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
| GET | `/google-calendar/auth-url` | Get Google sign-in URL |
| GET | `/google-calendar/callback` | Exchange `code` for tokens |
| GET | `/google-calendar/check-connection` | Whether connected |
| POST | `/google-calendar/disconnect` | Disconnect |

Full list: Swagger (`/api`).

## Schedule undo and Google

After **`POST /schedule-jobs/undo-last`**, the backend restores auto-generated `scheduled_tasks` from the last snapshot. For each affected task that has **`googleEventId`**, it calls the Calendar API to **patch only start/end** on that event (summary and other fields unchanged). If Google is disconnected or the call fails, undo still applies in the database; failures are logged and do not roll back the DB restore.

## Error `redirect_uri_mismatch`

The URI sent to Google does **not** match any **Authorized redirect URI** in the console.

Check:

1. The console lists the same URI as `GOOGLE_REDIRECT_URI` (scheme, host, port, path).  
2. The backend was restarted after changing `.env`.  
3. No stray slashes or `http` vs `https` mismatch.

Older examples in the wild used port **3000** for the callback; that is misleading when Nest handles OAuth on **3001**. Use `backend/.env.example` and `google-calendar.controller.ts` as the source of truth.

## Diagnostics

- Backend logs when clicking “Connect Google Calendar”.  
- Compare `GOOGLE_REDIRECT_URI` with the Google console.  
- Swagger: confirm the server is running and `/google-calendar/*` routes match expectations.
