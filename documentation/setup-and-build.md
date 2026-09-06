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
| `APP_URL` | Backend base URL when needed |
| `FRONTEND_URL` | Where to redirect after Google OAuth (e.g. `http://localhost:3000`) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `GOOGLE_REDIRECT_URI` | Must **exactly** match an **Authorized redirect URI** in Google Cloud Console; local dev is usually `http://localhost:3001/google-calendar/callback` |
| `DATABASE_URL` | TypeORM currently uses `database: 'db.sqlite'` in `app.module.ts`; the `.env` value may be reserved for future use — follow the actual `app.module` |

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

The SQLite file is created when the backend runs (path set in `app.module.ts`). `*.sqlite` files are in `.gitignore`.

With `synchronize: true`, schema changes apply automatically; if you hit odd TypeORM/SQLite metadata errors after pulling, deleting `backend/db.sqlite` and restarting forces a clean schema (dev data loss).

## Phases API and login

`GET /phases` and other `/phases/*` routes require a **valid JWT** (same as `/tasks`). Ensure the frontend sends the Bearer token so the default **Sleep** / **Focus hours** phases can be created for the logged-in user.
