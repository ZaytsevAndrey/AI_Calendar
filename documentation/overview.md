# Project overview

## Purpose

**AI Calendar Assistant** is a web app for time planning with **day phases**, **tasks** (priority, deadline, fixed / flexible / recurring settings), personal **sleep/wake** settings, and **Google Calendar** integration. **Intelligent scheduling** places movable tasks into the selected phase window, respects anchors (manual slots, fixed blocks, external Google events), supports splitting and a **job queue** with **diff**. The **Calendar** page runs generation (with a live stage timeline), can **undo the last Generate**, can ask for **Suggestions** (Groq notes for the next 7 days; nothing is applied), and can clear still-open app-generated slots; fully ended app events stay and show in gray. On a narrow screen the page scrolls and a week grid scrolls sideways; a wide window keeps the calendar inside the screen.

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
- **User settings:** wake/sleep, weekends, Google Calendar flags, `allowSplitScheduling` / `minSplitMinutes`, **`fixedEventBufferMinutes`** (minutes Generate keeps free before and after each fixed task and external Google event; 0 is off; the gap is used only when the task would not fit otherwise), IANA **`timeZone`** (filled once on first login, editable in Settings; source of truth for the scheduling engine), **`hiddenGoogleCalendarIds`** (which Google calendars the Calendar page hides)  
- **Phases:** per-user CRUD (JWT), overlap validation, default **Sleep** + **Focus hours** from wake/sleep when the user has no phases, phase calendar UI  
- **Tasks:** CRUD, statuses, priorities, optional From/Until window (`earliestStartTime` + `deadline` + `scheduleTimeZone`), one optional phase, split / recurring flags, optional `recurrenceWeekDays` / `eligibleWeekDays`; **fixed** blocks require scheduled start/end; movable tasks may set a preferred start. **Unscheduled** (`isUnscheduled`) is a separate inbox on the Tasks page: no slot, no Generate/replan, no Google sync until the user schedules it; optional deadline is highlighted when it is close. Each section filters on its own: Unscheduled by name, status, and overdue; Scheduled by name, status, phase, fixed / flexible / recurring, and overdue (plus sort). A filter in one section does not change the other. Overdue is a past deadline on a task that is not completed or canceled. The create/edit form is a single **TaskForm** with **Flexible / Fixed / Recurring / Unscheduled** presets and expandable Google event options (location, color, visibility, show-as, reminders) stored on the task and applied when a Google event is created. Native Google events that are not linked to a task still use **EventForm**. Calendar day-click prefills that civil day’s From/Until in Settings IANA `timeZone`. Clicking an app-generated calendar event opens TaskForm for the linked task. Success/error **toasts** show the task name and scheduled time. **Voice:** mic on Tasks/Calendar records audio, Groq Whisper transcribes (uk/en/ru auto), an LLM maps speech to a task using Settings IANA `timeZone`. Immediate create when a name exists (defaults fill the rest); only an unintelligible / missing name asks one follow-up question. The same recording can complete, skip, or move the current or a named task. Done on a repeating task skips today's occurrence. An open slot moves like a drag; no open slot updates From/Until and replans. Settings **Ask before voice commands** is off by default.  
- **Habits:** per-user yes/no daily check-ins (`/habits`). Check-in is allowed for **today and the previous 13 days** in settings IANA `timeZone` (14 days total). Older check-ins stay visible. Current streak, +1 point per successful day, and +1 bonus every 7 consecutive days. An optional daily **time block** (`blockStartTime` + `blockMinutes`) is kept free by Generate and drawn on the calendar. It is not a task. When Google Calendar is connected, the same block is a daily event there, including blocks saved before the calendar was linked. Calendar month and week show habit dots; the day view and a day dialog toggle that civil day. The Now strip checks in today only.  
- **PWA:** installable (manifest + service worker + icons). Android Chrome shows an install prompt; iOS uses Share → Add to Home Screen. **Reminders** (Settings, off by default) are Web Push: one notice in the half hour before a timed block, the same window for a habit that has a clock time, and one shared notice before wake for habits without a block. Checked habits are skipped. All-day events are skipped. On iPhone, add the app to the Home Screen first. A start that has already passed is not sent when the free API wakes up.  
- **Google Calendar:** OAuth, events, connect / disconnect; replan and **clear schedule** create/update/delete linked Google events when `googleEventId` is set. **Calendars** on the Calendar page hides calendars from the grid and the Now strip. Default stays primary + the app calendar + calendars selected in Google. The app calendar stays visible. Generate busy time is unchanged (primary + app calendar). Day and week time grids show the **personal day**: from wake until sleep, including the hours after midnight when sleep is after midnight (those hours sit at the bottom of that day, not as a strip at the top of the next civil morning). Sleep is omitted. Hours that no schedulable phase covers are omitted too; with no phases the whole wake-to-sleep window stays. Drag a timed event to move it or drag its edges to resize it (15-minute steps). The new time is written to that occurrence and to Google. Habit blocks stay put. The next Generate may place a flexible slot again. Month chips follow the same personal day. Month view stays click-to-open.  
- **Schedule:** scheduled tasks, **POST `/schedule/generate`** (async job + poll + stage timeline), **POST `/schedule-jobs/undo`**, **DELETE `/schedule`** (still-open app-generated slots in the Settings horizon; finished blocks stay); **Calendar** page (`/calendar`) has Generate / Suggestions / Undo last generate / Clear. **Suggestions** (`POST /schedule/recommendations`) asks Groq for up to five notes on the next 7 days and does not change the schedule. The page also has a **Now / Next / Unscheduled** strip (today in Settings IANA `timeZone`) with one-tap Done on non-recurring app tasks, **Skip** on a still-open app slot or recurring instance, and a today-only habit check-in row. The strip Unscheduled is today’s **transitional** inbox for flexible tasks waiting on a slot. The Tasks page has a separate **Unscheduled** section for inbox items (`isUnscheduled`) that stay off the calendar until Done or Schedule. Done sets `completed` and must not create a calendar block; Skip removes only that occurrence/slot and leaves the task `todo`. Recurring Skip is remembered so Generate will not put that day back; a one-off Skip can be placed again on the next Generate. A silent replan after create will not place a task that is already completed.  

Implementation notes:

- **`event-phases`** module (`/event-phases/*`) links calendar events to phases; public CRUD is **`/phases`** (authenticated, scoped by user).  
- The TypeORM `Task` entity uses the **event-phases** `Phase` entity for relations (same `phases` table as the `phases` module).

## Scheduling (intelligent engine)

Core logic lives in `backend/src/modules/schedule/intelligent-scheduling.engine.ts` and runs inside **schedule jobs** (`ScheduleJobService` / processor). Summary:

- Movable tasks: TODO, not `isUnscheduled`, not fixed external, not `eventType` **fixed**; ordered by **priority** then **FIFO** (`createdAt` ascending). Non-recurring remaining work = estimated minutes minus fully ended auto slots; if nothing remains, Generate does not place the task again. A From/Until or deadline that is already over is skipped (no error), not forced into a new day.  
- **Time zone:** `user_settings.timeZone` (IANA). Wake/sleep, phases, weekdays, and the planning horizon are civil clocks in that zone. Empty/invalid → `UTC`. Changing the setting does not rewrite already stored UTC instants.  
- **Phase window:** one optional phase, intersected with wake/sleep and weekend rules. Recurring days = task `recurrenceWeekDays` ∩ phase `weekDays`.  
- **Anchors:** non-auto-generated scheduled rows, fixed tasks, in-progress auto segments, **fully ended** auto-generated slots (kept across replan/clear), and fixed-external tasks block time. **`fixedEventBufferMinutes`** also keeps that many minutes free on both sides of fixed tasks and external Google events. Habits and ended flexible slots are not padded. Generate uses the gap only when the task would not fit otherwise.  
- **Replan / Clear / Undo:** only still-open auto slots (`end > now`) are removed or rewritten; finished app events stay and show gray on Calendar. Recurring Google series are split (`UNTIL` + new series). Task create/update enqueues silent replan, returns `jobId` immediately, and the Calendar client polls that job then refreshes Now / events. Calendar **Generate** can be undone once (local + Google); Clear cannot. Generate jobs expose `progressStage` for the Calendar timeline.  
- **Splitting** when the task and user settings allow it (`allowSplit` ∧ `allowSplitScheduling`, `minSplitMinutes`, horizon extensions, intra-priority displacement of splittable peers).  
- Output: persisted `scheduled_tasks` (auto-generated), task-level scheduled range, job **diff** / warnings / errors.  

For HTTP details see [api-reference](api-reference.md) and the full spec [spec-intelligent-scheduling](spec-intelligent-scheduling.md).

## Documentation location

Older paths like `backend/docs/*` and duplicate root-level write-ups were removed in favor of **`documentation/`**. When you add a section, update [this directory’s README](README.md).
