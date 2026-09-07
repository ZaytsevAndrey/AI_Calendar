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
| GET | `/google-calendar/auth-url` | Get Google sign-in URL |
| GET | `/google-calendar/callback` | Exchange `code` for tokens |
| GET | `/google-calendar/check-connection` | Whether connected |
| POST | `/google-calendar/disconnect` | Disconnect |

Full list: Swagger (`/api`).

## Clear schedule and Google

**`DELETE /schedule`** removes **app-generated** local slots from today through the **Recurring schedule horizon** in Settings, then deletes leftover events on the **app Google calendar** in that same window (even if local rows were already gone). If Google is disconnected, local rows are still removed.

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
