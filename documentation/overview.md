# Project overview

## Purpose

**AI Calendar Assistant** is a web app for time planning with **day phases**, **tasks** (priority, deadline, event types), personal **sleep/wake** settings, and **Google Calendar** integration. **Intelligent scheduling** places movable tasks into allowed phase windows (union of `phaseIds`), respects anchors (manual slots, fixed blocks, external Google events), supports splitting and a **job queue** with **diff** and **undo**. The **Schedule** page runs generation, shows the last replan summary, and can undo the last successful replan.

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
- Material UI, React Router, React Hook Form, react-toastify  
- Build: **Webpack** (`npm run build` in the `frontend` package)

### Backend

- NestJS 10, TypeScript  
- **Fastify** adapter (`@nestjs/platform-fastify`)  
- TypeORM + **SQLite** (`db.sqlite` relative to the backend process)  
- JWT (Passport), Google OAuth 2.0, Google Calendar API  
- Swagger UI at `/api`  
- Tests: Jest (`backend/test/`, `*.spec.ts` in modules)

## Features (as implemented)

- Registration / login, refresh, password reset, email verification (see [integrations](integrations.md) and `auth` code)  
- **User settings:** wake/sleep, weekends, Google Calendar flags, `allowSplitScheduling` / `minSplitMinutes` for the intelligent engine  
- **Phases:** per-user CRUD (JWT), overlap validation, default **Sleep** + **Focus hours** from wake/sleep when the user has no phases, phase calendar UI  
- **Tasks:** CRUD, statuses, priorities, deadlines, `phaseId` / `phaseIds`, `eventType`, optional split flag; **fixed** blocks require scheduled start/end  
- **Google Calendar:** OAuth, events, connect / disconnect; **undo last replan** patches linked Google events when `googleEventId` is set  
- **Schedule:** scheduled tasks, manual time updates, **POST `/schedule/generate`** (async job + poll), clear by range; frontend `/schedule` with last replan diff and undo  

Implementation notes:

- **`event-phases`** module (`/event-phases/*`) links calendar events to phases; public CRUD is **`/phases`** (authenticated, scoped by user).  
- The TypeORM `Task` entity uses the **event-phases** `Phase` entity for relations (same `phases` table as the `phases` module).

## Scheduling (intelligent engine)

Core logic lives in `backend/src/modules/schedule/intelligent-scheduling.engine.ts` and runs inside **schedule jobs** (`ScheduleJobService` / processor). Summary:

- Movable tasks: TODO, not fixed external, not `eventType` **fixed**; ordered by **priority** then **FIFO** (`createdAt` ascending).  
- **Phase union:** eligible intervals from selected phases intersected with wake/sleep and weekend rules.  
- **Anchors:** non-auto-generated scheduled rows, fixed tasks, and fixed-external tasks block time.  
- **Splitting** when event type and user/task settings allow it (`minSplitMinutes`, horizon extensions, intra-priority displacement of splittable peers).  
- Output: persisted `scheduled_tasks` (auto-generated), task-level scheduled range, job **diff** / warnings / errors.  

For HTTP details see [api-reference](api-reference.md) and the full spec [spec-intelligent-scheduling](spec-intelligent-scheduling.md).

## Documentation location

Older paths like `backend/docs/*` and duplicate root-level write-ups were removed in favor of **`documentation/`**. When you add a section, update [this directory’s README](README.md).
