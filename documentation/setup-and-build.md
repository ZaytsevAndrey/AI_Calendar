# Setup and build

## Requirements

- **Node.js** 18+ (repo includes `.nvmrc`: `v18.18.0`)  
- **npm** 9+ (recommended for workspaces)

## Installing dependencies

From the **monorepo root** (installs dependencies for `frontend` and `backend`):

```bash
cd AI_Calendar
npm ci
```

You can also run `npm install` inside `backend/` and `frontend/`, but for CI and reproducibility prefer `npm ci` from the root.

## Ports (default)

| Service | Port | Note |
|---------|------|------|
| Frontend (webpack-dev-server) | **3000** | `frontend/webpack.config.js` |
| Backend (Nest + Fastify) | **3001** | `backend/src/main.ts`: `process.env.PORT ?? 3001` |

## Environment variables

### Backend

Create `backend/.env` from `backend/.env.example`.

| Variable | Purpose |
|----------|---------|
| `JWT_SECRET` | JWT signing secret |
| `JWT_EXPIRES_IN` | Access token lifetime (e.g. `3600s`) |
| `EMAIL_USER`, `EMAIL_PASS` | SMTP for mail (verification / password) |
| `APP_URL` | Backend public URL (local `http://localhost:3001`; on Render set from `RENDER_EXTERNAL_URL`) |
| `FRONTEND_URL` | Where to redirect after Google OAuth (e.g. `http://localhost:3000`) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `GOOGLE_REDIRECT_URI` | Must **exactly** match an **Authorized redirect URI** in Google Cloud Console; local dev is usually `http://localhost:3001/google-calendar/callback` |
| `DATABASE_URL` | If this is a `postgres://` / `postgresql://` URL, TypeORM uses **Postgres** (production / Neon). Otherwise the backend uses **SQLite** (`SQLITE_PATH` or `db.sqlite`) |
| `TYPEORM_SYNC` | Set to `false` to disable `synchronize`. Default is on so an empty Neon database gets a schema on first boot |
| `DATABASE_SSL` | Postgres SSL is on by default (`rejectUnauthorized: false` for Neon). Set `false` only for local Postgres without SSL |
| `GROQ_API_KEY` | Free Groq API key for voice STT + task parse ([console.groq.com/keys](https://console.groq.com/keys)). Voice buttons fail with 503 if unset |
| `GROQ_STT_MODEL` | Optional. Default `whisper-large-v3-turbo` |
| `GROQ_LLM_MODEL` | Optional. Default `openai/gpt-oss-20b` (Llama 3.x on Groq is enterprise-only) |

### Frontend

Create `frontend/.env` from `frontend/.env.example`.

| Variable | Purpose |
|----------|---------|
| `REACT_APP_API_BASE_URL` | API base URL for Axios (`src/api/axios.ts`); code default is `http://localhost:3001` |

## Development run

From the root:

```bash
npm start
```

Starts backend and frontend in parallel (`concurrently`).

Separately:

```bash
npm run start:backend
npm run start:frontend
```

## Production build

From the root:

```bash
npm run build              # both workspaces
npm run build:backend      # Nest only → backend/dist/
npm run build:frontend     # Webpack only → frontend/dist/
```

From a package directory:

```bash
cd backend && npm run build
cd frontend && npm run build
```

## Other commands

```bash
npm run lint    # all workspaces that define the script
npm run test    # all workspaces
npm run clean   # remove node_modules / build / dist (see scripts/clean.js)
```

## Database

The SQLite file is created when the backend runs **without** a Postgres `DATABASE_URL` (path: `SQLITE_PATH` or `db.sqlite`). `*.sqlite` files are in `.gitignore`.

Production uses **Neon Postgres**; see [deploy](deploy.md). Do not expect a SQLite file to survive on Render’s free web service (ephemeral disk).

With `synchronize` enabled (default; disable with `TYPEORM_SYNC=false`), schema changes apply automatically; if you hit odd TypeORM/SQLite metadata errors after pulling, deleting `backend/db.sqlite` and restarting forces a clean schema (dev data loss).

## Phases API and login

`GET /phases` and other `/phases/*` routes require a **valid JWT** (same as `/tasks`). Ensure the frontend sends the Bearer token so the default **Sleep** / **Focus hours** phases can be created for the logged-in user.
