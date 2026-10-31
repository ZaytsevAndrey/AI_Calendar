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
| `TYPEORM_SYNC` | Postgres: `synchronize` only when set to `true` (throwaway databases). Production uses versioned migrations (see [deploy](deploy.md#database-migrations)). SQLite always synchronizes |
| `TYPEORM_MIGRATIONS` | Postgres: set to `false` to skip running pending migrations on boot (default: run them) |
| `DATABASE_SSL` | Postgres SSL is on by default (`rejectUnauthorized: false` for Neon). Set `false` only for local Postgres without SSL |
| `GROQ_API_KEY` | Free Groq API key for voice STT + task parse ([console.groq.com/keys](https://console.groq.com/keys)). Voice buttons fail with 503 if unset |
| `GROQ_API_KEY_2` … | Optional extra Groq orgs (`_2`, `_3`, … any count). Live API rotates on TPM/TPD when two or more are set; one voice session stays on one key until a hop |
| `VOICE_DAILY_TOKEN_LIMIT` | Optional soft per-user chat-token ceiling per civil day (default `100000`). `0` disables. Exhausted → `VOICE_QUOTA_EXCEEDED` |
| `GROQ_STT_MODEL` | Optional. Default `whisper-large-v3`. Used when Azure Speech is unset |
| `AZURE_SPEECH_KEY` | Optional. With `AZURE_SPEECH_REGION`, speech-to-text and spoken replies use this Speech resource instead of Groq and Piper. Free (F0) |
| `AZURE_SPEECH_REGION` | Optional. Region of that Speech resource, for example `northeurope`. No spaces. New Azure accounts are blocked from `westeurope` |
| `GROQ_LLM_MODEL` | Optional. Default `openai/gpt-oss-20b` when chat stays on Groq |
| `DEEPSEEK_API_KEY` | Optional. First planner in the chain (`DEEPSEEK_PLANNER_MODEL`, default `deepseek-flash`). Parse stays on Groq unless `VOICE_LLM_PROVIDER=deepseek` |
| `QWEN_API_KEY` | Optional. Planner step after DeepSeek (`QWEN_PLANNER_MODEL`, default `qwen3.7-flash`) |
| `GEMINI_API_KEY` | Optional free Gemini key ([aistudio.google.com/apikey](https://aistudio.google.com/apikey)). Planner step after Qwen. Parse stays on Groq. Speech-to-text stays on Groq unless Azure Speech is set |
| `GEMINI_PLANNER_MODEL` | Optional. Default `gemini-3.8-flash` |
| `VOICE_LLM_PROVIDER` | Optional. `deepseek` forces planner and parse onto DeepSeek and does not fall back |
| `LLM_BASE_URL` | Optional. Local Ollama, `http://127.0.0.1:11434`. When set, chat uses `LLM_MODEL`. Groq then stays on speech-to-text unless Azure Speech is set |
| `LLM_MODEL` | Optional. Default `calendar-voice` (Qwen3 14B, 8192 context; see `tools/calendar-voice.Modelfile`) |
| `PIPER_URL` | Optional. Local Piper, `http://127.0.0.1:5510`. Voice replies use it when Azure Speech is unset; if it is down the browser voice is used |

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
npm run lint         # all workspaces that define the script
npm run test         # backend Jest, then frontend Jest
npm run test:e2e:ui  # Playwright against webpack :3100 + API :3101 (install Chromium once: npx playwright install chromium)
npm run voice:eval:dialogue  # live planner dialogue corpus (see voice-agent-dialogue-test-plan.md)
npm run clean        # remove node_modules / build / dist (see scripts/clean.js)
```

`voice:eval:dialogue` runs the planner dialogue corpus ([voice-agent-dialogue-test-plan.md](voice-agent-dialogue-test-plan.md)). A write turn is `confirm` (preview cards). Spoken yes is `act`. The report at `backend/.tmp/voice-dialogue-eval-report.json` adds `traceId` and `steps` for each turn beside the existing pace `calls`. One user turn, whether it arrived over HTTP or through `VoiceService.turn`, has one trace id. Each planner segment adds an orchestrator `segment` step with `outcome`. `VOICE_TRACE_BODY` defaults off. Set it to `1` to log redacted, length-capped transcripts and model text; production also requires `VOICE_TRACE_BODY_PRODUCTION=1`.

Tests run **one after another**. Jest uses `--runInBand` (one process; the next file starts only after the previous file’s tests finish). From the repo root, `npm test` runs the backend suite and then the frontend suite. Backend API e2e (`npm run test:e2e` in `backend`) is also `--runInBand`. Playwright uses a single worker.

Playwright does not use your local `db.sqlite` or ports 3000/3001. The API boots with `E2E_BOOTSTRAP=1` and `E2E_STUB_EXTERNAL=1` (no Google/Groq). First run downloads the Chromium browser. The default window is Desktop Chrome **1280×720**. `U-CAL-017` and `U-CAL-024` use the phone window **390×844**; `U-CAL-017` also checks **320×568**. Week columns are checked at **768×1024**. `U-CAL-023` uses **1024×700**, **1100×800**, and **1279×768**.

## Voice tests and live evaluation

**Structured gate** (`npm run test:vnext:structured --workspace=backend`): the active regression gate for the voice agent, about 256 tests, single process. It takes **11–12 minutes** and needs about 1.5 GB of heap: run it with `NODE_OPTIONS=--max-old-space-size=3000`, never beside a production build. Run it on the OS that installed `node_modules`: the repo's `bcrypt` is a native module, so a Linux shell over a Windows checkout cannot load two of the suites (`invalid ELF header`); CI (`.github/workflows/ci.yml`) is the reference run. The 13 historical suites are separate (`npm run test:vnext:historical`, KI-10) and are not part of the gate.

**Live evaluation** (costs money, needs `DEEPSEEK_API_KEY`; never run it from an automated session without an explicit go-ahead):

```
npx ts-node --transpile-only src/modules/voice/vnext/eval/phase47-generalization-cli.ts --dry-run
npx ts-node --transpile-only src/modules/voice/vnext/eval/phase47-generalization-cli.ts --allow-paid-calls --budget-usd 2 --max-calls 1000 --output <run dir>
npx ts-node --transpile-only src/modules/voice/vnext/eval/phase47-generalization-cli.ts --suite english --allow-paid-calls --budget-usd 2 --max-calls 1000 --output <run dir>
```

`--suite english` runs the native English set (`vnext/eval/english-set.ts`, KI-19); the default is the 100-scenario Ukrainian generalization set. `--category A|B|C` and `--ids a,b` narrow a run; a run resumes from its own `.jsonl` unless `--no-resume`.

**Keep every run.** Earlier results were lost with the deleted `docs/voice-vnext/` folder; only numbers in transcripts survive. Point `--output` at `backend/eval-runs/<date>-<suite>/` and commit the `summary.json` (suite, scorer, prompt hash, model, per-scenario verdicts) with the change it measured. Raw `.jsonl` transcripts hold user-like utterances only (fixtures, no real users) and may be committed too, or archived outside the repo if they grow large. The scorer was corrected on 30 Oct 2026 (a create intent is now scored as `action: create`), so numbers before that date are not comparable with numbers after it.

## Database

The SQLite file is created when the backend runs **without** a Postgres `DATABASE_URL` (path: `SQLITE_PATH` or `db.sqlite`). `*.sqlite` files are in `.gitignore`.

Production uses **Neon Postgres**; see [deploy](deploy.md). Do not expect a SQLite file to survive on Render’s free web service (ephemeral disk).

On SQLite `synchronize` is always on, so schema changes apply automatically (Postgres uses migrations, see [deploy](deploy.md#database-migrations)); if you hit odd TypeORM/SQLite metadata errors after pulling, deleting `backend/db.sqlite` and restarting forces a clean schema (dev data loss).

## Phases API and login

`GET /phases` and other `/phases/*` routes require a **valid JWT** (same as `/tasks`). Ensure the frontend sends the Bearer token so the default **Sleep** / **Focus hours** phases can be created for the logged-in user.
