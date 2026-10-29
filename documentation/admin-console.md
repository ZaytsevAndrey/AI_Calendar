# Admin console

Owner-only web app in `admin/`, separate from the product frontend. It talks to the same API under `/admin/*`.

## Access

- `ADMIN_EMAILS` on the API lists the owner emails (comma separated). Nobody else can sign in. It is read on every request, so removing an email revokes access at once.
- Sign-in is Google, and Google must report the email as verified. An account already linked to a different Google id is refused even if the email matches.
- Sign-in flow: The admin app calls `GET /auth/google?target=admin`; the Google callback sees `state=admin` and redirects to `ADMIN_URL/auth/callback?ticket=…` instead of the product frontend. That path asks only for `openid email profile`, never creates a user, never stores Google tokens and never touches the app refresh token, so the owner's product session is unchanged.
- The ticket is exchanged at `POST /admin/auth/session` for an admin token (`scope: admin`, 12 h). Admin tokens work only on `/admin/*`; the app JWT strategy rejects them. App tokens are rejected on `/admin/*`.
- Local without Google: `ADMIN_DEV_LOGIN=1` (ignored when `NODE_ENV=production`) enables `POST /admin/auth/dev { email }` and a form on the login page.
- CORS allows `ADMIN_URL` (default `http://localhost:3002` outside production).

No Google Cloud change is needed: the redirect URI is still the backend callback.

## Pages

| Page | Source | Notes |
|------|--------|-------|
| Overview | `GET /admin/overview`, `GET /admin/health` | Status sentence, users, voice, tasks, background work, 30-day bars |
| Users | `GET /admin/users?search&sort&page` | Email or id search; sort new / active / email |
| User | `GET /admin/users/:id` | Profile, identities, tasks, voice tokens 30 d, recent voice requests, schedule runs, Google write queue |
| Voice | `GET /admin/voice/summary?days` | Tokens, requests, errors, p50/p95, per model, per route, error codes, top users |
| Voice log | `GET /admin/voice/turns`, `GET /admin/voice/turns/:id` | Each `/voice` request with its steps (timings, model, tokens, codes) |
| System | `GET /admin/health`, `/admin/ops/schedule-jobs`, `/admin/ops/google-writes` | DB latency, uptime, memory, commit, queues, which integrations have keys |
| API errors | `GET /admin/errors?minStatus` | Latest 500 API errors since the process started (in memory) |

### Actions on a user

All are logged with the admin email (`AdminActions` logger).

- **Block / unblock.** `users.isBlocked`. A blocked user's API calls get 401 within 30 s (cache), refresh is refused, Google sign-in is refused. Blocking also refuses every token issued before it (`users.sessionsRevokedAt`). You cannot block yourself.
- **Sign out everywhere.** Sets `users.sessionsRevokedAt`: every JWT issued before it (access and 7-day refresh tokens alike) is refused at once, and the stored refresh token is cleared.
- **Reset today's voice quota.** Sets `voice_daily_usage.tokensUsed = 0` for the user's civil day. History stays.
- **Delete account.** Same path as self-delete (Google cleanup first). Requires typing the account email. Not for your own account.

## Data the console adds

- `users.isBlocked` (default false), `users.sessionsRevokedAt`, and `users.lastActiveAt` (written at most every 5 min per user from the JWT strategy). Created by `TYPEORM_SYNC`.
- `voice_turn_logs`: one row per finished `/voice` request, written from the same hook as the `voice.trace` log line. Stores timings, model ids, token counts, error codes and step names. **No transcript, model text or calendar payloads.** A step `reason` that is not code-like (a raw error message could echo user text) is stored as `free_text_omitted`. Rows older than 30 days are pruned. Deleted with the account.
- API errors are an in-memory ring buffer (method, path without query, status, code, message). Nothing is persisted; a restart clears it. Bodies and headers are never kept.

Integration status only reports whether keys are set, never their values.

## Run locally

```bash
# backend/.env
ADMIN_EMAILS=you@example.com
ADMIN_DEV_LOGIN=1            # optional, local only

npm run start:backend
npm run start:admin          # http://localhost:3002
```

`admin/` uses React, Tailwind (built by the CLI into `admin.css`) and a small built-in router, so it needs no packages beyond what the root already installs.

## Deploy

`render.yaml` has a third static site, `ai-calendar-admin` (`admin/dist`, `noindex`, `X-Frame-Options: DENY`). The API gets `ADMIN_URL` from it and `ADMIN_EMAILS` from the dashboard (`sync: false`). Set `ADMIN_EMAILS` before the first deploy, or nobody can sign in.
