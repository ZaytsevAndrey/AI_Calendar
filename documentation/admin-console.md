# Admin console

Owner-only tool, kept apart from the client app:

| Part | Where | Port (local) | Render service |
|------|-------|--------------|----------------|
| Admin web app | `admin/` | 3002 | `ai-calendar-admin` (static) |
| Admin API | `backend/src/admin-main.ts`, `backend/src/admin-app/` | 3005 | `ai-calendar-admin-api` |
| Client API | `backend/src/main.ts` (the app's API) | 3001 | `ai-calendar-api` |

The admin API is its own process with its own signing key (`ADMIN_JWT_SECRET`) and a CORS rule that admits only `ADMIN_URL`. The client API has no `/admin` routes and does not know about admin accounts. The two share only the database.

## Admin accounts

Accounts live in `admin_users` (login, bcrypt hash, active flag). They are not app users: no Google, no link to `user`. There is no sign-up and no UI to manage them; rows are added by hand.

1. Make a bcrypt hash (cost 12) of the password:

   ```bash
   cd backend
   npm run admin:hash -- 'the password'
   ```

   (The password ends up in shell history; clear it, or run `node` and call `require('bcrypt').hash('…', 12)` interactively.)

2. Insert the row. Logins are stored lowercase.

   **Postgres (Neon):**

   ```sql
   INSERT INTO admin_users (id, login, "passwordHash", "isActive", "createdAt")
   VALUES (gen_random_uuid(), 'andrii', '$2b$12$…hash…', true, now());
   ```

   **SQLite (local `backend/db.sqlite`):**

   ```sql
   INSERT INTO admin_users (id, login, passwordHash, isActive, createdAt)
   VALUES (lower(hex(randomblob(16))), 'andrii', '$2b$12$…hash…', 1, datetime('now'));
   ```

- Disable: `UPDATE admin_users SET "isActive" = false WHERE login = 'andrii';` (works at once, also for open sessions).
- Change password: update `passwordHash` with a new hash.
- Five wrong passwords for one login from one address pause that pair for 15 minutes. Admin tokens last 12 hours.

The table is created by the client API (`TYPEORM_SYNC`), like every other table. The admin API never changes the schema.

## How the two APIs talk

The admin API reads and writes the shared database directly for everything it can. A few things must run in the client process, so the client exposes `/internal/*`, guarded by the header `x-internal-token` = `INTERNAL_API_TOKEN` (at least 32 characters, same value in both services; without it the routes return 404):

- `GET /internal/status`: uptime, memory, commit, `VOICE_DAILY_TOKEN_LIMIT`, and which integrations have keys (booleans and model names, never values).
- `POST /internal/users/:id/refresh-access`: drops the client's 30 s block/revoke cache so an admin action applies at once.
- `POST /internal/users/:id/delete`: account delete through the normal path (Google cleanup first). Body `{ confirmation: email }`.

If the client cannot be reached, the System page says so; block, unblock and revoke still apply within 30 s; delete is refused.

## Pages

| Page | Admin API | Notes |
|------|-----------|-------|
| Overview | `GET /admin/overview`, `GET /admin/health` | Status sentence, users, voice, tasks, background work, 30-day bars |
| Users | `GET /admin/users?search&sort&page` | Email or exact id; sort new / active / email |
| User | `GET /admin/users/:id` | Profile, identities, tasks, voice tokens 30 d, recent voice requests, schedule runs, Google write queue |
| Voice | `GET /admin/voice/summary?days` | Tokens, requests, errors, p50/p95, per model, per route, error codes, top users |
| Voice log | `GET /admin/voice/turns`, `GET /admin/voice/turns/:id` | Each `/voice` request with its steps |
| System | `GET /admin/health`, `/admin/ops/schedule-jobs`, `/admin/ops/google-writes` | Client API status and integrations, database, queues |
| API errors | `GET /admin/errors?minStatus` | Client API errors, 14 days |

### Actions on a user

Each is logged by the admin API with the admin login (`AdminActions` logger).

- **Block / unblock.** Sets `users.isBlocked` and `users.sessionsRevokedAt`; clears the refresh token. The client refuses that user's requests, refresh, and Google or Microsoft sign-in.
- **Sign out everywhere.** Sets `users.sessionsRevokedAt`: every JWT issued before it, access and 7-day refresh alike, is refused.
- **Reset today's voice quota.** Zeroes `voice_daily_usage` for the user's civil day (their settings time zone).
- **Delete account.** Through the client's `/internal` route. Requires typing the account email.

## Data the client API writes for the console

- `users.isBlocked`, `users.sessionsRevokedAt`, `users.lastActiveAt` (written at most every 5 min per user).
- `voice_turn_logs`: one row per `/voice` request: timings, model ids, tokens, codes, step names. **No transcript, model text or calendar payloads**; a step `reason` that is not code-like is stored as `free_text_omitted`. Kept 30 days.
- `api_error_logs`: method, path without query, status, code, short message, user id. No bodies, headers or tokens. 401 and 404 are not stored. Kept 14 days.

Both are deleted with the account.

## Run locally

`backend/.env` (both APIs read it locally; in production they have separate env):

```bash
ADMIN_JWT_SECRET=<48+ random chars, not equal to JWT_SECRET>
INTERNAL_API_TOKEN=<32+ random chars>
ADMIN_URL=http://localhost:3002
CLIENT_API_URL=http://localhost:3001
ADMIN_API_PORT=3005
```

```bash
npm run start:backend      # client API :3001, creates the tables
npm run start:admin-api    # admin API :3005
npm run start:admin        # admin web app :3002
```

Then add an admin row (above) and sign in at http://localhost:3002.

## Deploy

`render.yaml` defines `ai-calendar-admin-api` (Node) and `ai-calendar-admin` (static, `noindex`, `X-Frame-Options: DENY`). `ADMIN_JWT_SECRET` and the client's `INTERNAL_API_TOKEN` are generated; the admin API copies `DATABASE_URL` and `INTERNAL_API_TOKEN` from `ai-calendar-api`. After the first deploy, insert an admin row in Neon.
