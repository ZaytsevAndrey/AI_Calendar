# Project overview

## Purpose

**AI Calendar Assistant** is a web app for time planning with **day phases**, **tasks** (priority, deadline, fixed / flexible / recurring settings), personal **sleep/wake** settings, and **Google Calendar** integration. **Intelligent scheduling** places movable tasks into the selected phase window, respects anchors (manual slots, fixed blocks, external Google events), supports splitting and a **job queue** with **diff**. The **Calendar** page runs generation (with a live stage timeline) and can clear still-open app-generated slots; fully ended app events stay and show in gray.

## Monorepo layout

```
AI_Calendar/
├── backend/          # NestJS + TypeORM + SQLite (db.sqlite file)
├── frontend/         # React + Webpack
├── documentation/    # this documentation (single source)
├── scripts/          # clean, etc.
└── package.json      # npm workspaces: frontend, backend
```

## Stack

### Frontend

- React 18, TypeScript  
- Redux Toolkit + **RTK Query** (`@reduxjs/toolkit/query`) for part of the API  
- Axios (`src/api/axios.ts`) with `baseURL` from `REACT_APP_API_BASE_URL` (see [setup-and-build](setup-and-build.md))  
- React Router, React Hook Form, react-toastify (IDE-dark toasts: type colors, title + detail; task CRUD includes name and scheduled time)  
- Build: **Webpack** (`npm run build` in the `frontend` package)  
- Tests: Jest (`frontend/src/**/*.spec.ts`, e.g. toast date copy)

### Backend

- NestJS 10, TypeScript  
- **Fastify** adapter (`@nestjs/platform-fastify`)  
- TypeORM + **SQLite** locally (`db.sqlite`) or **Postgres** when `DATABASE_URL` is a `postgres://` URL  
- JWT (Passport), Google OAuth 2.0, Google Calendar API  
- Swagger UI at `/api`  
- Tests: Jest (`backend/test/`, `*.spec.ts` in modules)

## Features (as implemented)

- Registration / login, refresh, password reset, email verification (see [integrations](integrations.md) and `auth` code)  
- **User settings:** wake/sleep, weekends, Google Calendar flags, `allowSplitScheduling` / `minSplitMinutes`, IANA **`timeZone`** (filled once on first login, editable in Settings; source of truth for the scheduling engine)  
- **Phases:** per-user CRUD (JWT), overlap validation, default **Sleep** + **Focus hours** from wake/sleep when the user has no phases, phase calendar UI  
- **Tasks:** CRUD, statuses, priorities, optional From/Until window (`earliestStartTime` + `deadline` + `scheduleTimeZone`), one optional phase, split / recurring flags, optional `recurrenceWeekDays` / `eligibleWeekDays`; **fixed** blocks require scheduled start/end; movable tasks may set a preferred start. The create form is a single page with **Flexible / Fixed / Recurring** presets. Calendar day-click prefills that local day’s From/Until. Success/error **toasts** show the task name and scheduled time. **Voice:** mic on Tasks/Calendar records audio, Groq Whisper transcribes (uk/en/ru auto), an LLM maps speech to a task. High confidence creates immediately; medium prefills the form; gaps ask one follow-up question.  
- **PWA:** installable (manifest + service worker + icons). Android Chrome shows an install prompt; iOS uses Share → Add to Home Screen.  
- **Google Calendar:** OAuth, events, connect / disconnect; replan and **clear schedule** create/update/delete linked Google events when `googleEventId` is set  
- **Schedule:** scheduled tasks, **POST `/schedule/generate`** (async job + poll + stage timeline), **DELETE `/schedule`** (still-open app-generated slots in the Settings horizon; finished blocks stay); **Calendar** page (`/calendar`) has Generate / Clear  

Implementation notes:

- **`event-phases`** module (`/event-phases/*`) links calendar events to phases; public CRUD is **`/phases`** (authenticated, scoped by user).  
- The TypeORM `Task` entity uses the **event-phases** `Phase` entity for relations (same `phases` table as the `phases` module).

## Scheduling (intelligent engine)

Core logic lives in `backend/src/modules/schedule/intelligent-scheduling.engine.ts` and runs inside **schedule jobs** (`ScheduleJobService` / processor). Summary:

- Movable tasks: TODO, not fixed external, not `eventType` **fixed**; ordered by **priority** then **FIFO** (`createdAt` ascending).  
- **Time zone:** `user_settings.timeZone` (IANA). Wake/sleep, phases, weekdays, and the planning horizon are civil clocks in that zone. Empty/invalid → `UTC`. Changing the setting does not rewrite already stored UTC instants.  
- **Phase window:** one optional phase, intersected with wake/sleep and weekend rules. Recurring days = task `recurrenceWeekDays` ∩ phase `weekDays`.  
- **Anchors:** non-auto-generated scheduled rows, fixed tasks, in-progress auto segments, **fully ended** auto-generated slots (kept across replan/clear), and fixed-external tasks block time.  
- **Replan / Clear:** only still-open auto slots (`end > now`) are removed or rewritten; finished app events stay and show gray on Calendar. Recurring Google series are split (`UNTIL` + new series). Task CRUD enqueues replan and returns without waiting for Google. Generate jobs expose `progressStage` for the Calendar timeline.  
- **Splitting** when the task and user settings allow it (`allowSplit` ∧ `allowSplitScheduling`, `minSplitMinutes`, horizon extensions, intra-priority displacement of splittable peers).  
- Output: persisted `scheduled_tasks` (auto-generated), task-level scheduled range, job **diff** / warnings / errors.  

For HTTP details see [api-reference](api-reference.md) and the full spec [spec-intelligent-scheduling](spec-intelligent-scheduling.md).

## Documentation location

Older paths like `backend/docs/*` and duplicate root-level write-ups were removed in favor of **`documentation/`**. When you add a section, update [this directory’s README](README.md).
