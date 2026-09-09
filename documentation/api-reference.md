# API reference

All paths below are relative to the backend base URL (e.g. `http://localhost:3001`). Many endpoints require a **Bearer JWT** (see Swagger).

Request/response shapes: **Swagger** after the server starts — `/api`.

## Auth — `/auth`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/register` | Register |
| POST | `/auth/login` | Login |
| POST | `/auth/refresh` | Refresh tokens |
| POST | `/auth/logout` | Logout |
| POST | `/auth/forgot-password` | Request password reset |
| POST | `/auth/reset-password` | Reset password |

Additional routes may exist in `auth.controller.ts` (email verification, etc.).

## User settings — `/user-settings`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/user-settings` | Current settings |
| PATCH | `/user-settings` | Update settings |

`GET` (and the logic that creates default settings) also triggers **default phase creation** for the user when they have no phases yet (see Phases below).

Relevant fields for intelligent scheduling: `wakeTime`, `sleepTime`, `weekendWorkEnabled`, `allowSplitScheduling`, `minSplitMinutes`, **`timeZone`** (IANA, e.g. `Asia/Nicosia` / `Europe/Kyiv`). Empty `timeZone` is filled **once** from the browser on first login; the user can change it in Settings. Invalid IANA names are rejected. Postgres stores `wakeTime` / `sleepTime` as `time` (`HH:mm:ss`); the engine normalizes them to `HH:mm` and interprets those clocks **in `timeZone`** (fallback `UTC`).

## Phases (day phases) — `/phases`

**Bearer JWT required** for all routes in this controller.

Phases are **per user** (`userId` on each row). When a user has **no phases**, the backend creates two defaults (idempotent):

| Name | `type` | Window |
|------|--------|--------|
| Sleep | `sleep_time` | `sleepTime` → `wakeTime` (overnight, from user settings) |
| Focus hours | `time_phase` | `wakeTime` → `sleepTime` |

Defaults are created on first **`GET /phases`** (using stored settings, or `07:00` / `22:00` if settings row is missing) and again from **`GET /user-settings`** after settings are ensured.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/phases` | All phases for current user |
| POST | `/phases` | Create (overlap rules apply within the user’s phases) |
| GET | `/phases/time-phases` | `time_phase` only |
| GET | `/phases/time-phases/date/:date` | Time phases applicable on that date |
| GET | `/phases/sleep-time` | `sleep_time` only |
| GET | `/phases/:id` | One phase |
| PATCH | `/phases/:id` | Update |
| DELETE | `/phases/:id` | Delete (blocked if tasks are assigned) |

Task `phaseIds` must reference phases owned by the same user.

## Voice — `/voice`

JWT. Free Groq backend (`GROQ_API_KEY`). Audio is **not** stored.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/voice/transcribe` | Body `{ audioBase64, mimeType? }` → `{ transcript, language? }` (Whisper, auto language) |
| POST | `/voice/parse-task` | Body `{ transcript, timeZone, clientNowIso?, previousTranscript?, clarificationAnswer? }` → `{ understanding, clarifyingQuestion, task }` |

`understanding`: `complete` (client creates immediately), `sufficient` (prefill form), `needs_clarification` (one follow-up question). After a clarification reply the API will not ask a second question. Calendar-day parsing uses **settings `timeZone`** when set, otherwise the request `timeZone`, otherwise `UTC`.

## Habits — `/habits`

JWT. Independent of scheduling and Google Calendar. Civil “today” / “yesterday” use **settings `timeZone`**.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/habits` | List habits plus `today`, `yesterday`, `timeZone`. Each habit includes streak, points, today/yesterday flags, and last 7 days |
| POST | `/habits` | Create (`name`, optional `color` `#rrggbb`, optional `description`) |
| PATCH | `/habits/:id` | Update name / color / description |
| DELETE | `/habits/:id` | Delete the habit and its check-ins |
| POST | `/habits/:id/check-ins` | Body `{ date: "YYYY-MM-DD" }` — mark done (today or yesterday only) |
| DELETE | `/habits/:id/check-ins/:date` | Clear that day’s check-in (today or yesterday only) |

Points: +1 per successful day, plus +1 whenever a consecutive run hits a multiple of 7. Streak counts consecutive days ending today, or yesterday if today is not yet checked.

## Tasks — `/tasks`

Task CRUD (JWT). Bodies/responses include `phaseId`, **`phaseIds`** (max 1), **`eventType`** (`fixed` or `admin` on new writes), status, priority, deadline, **`earliestStartTime`**, **`eligibleWeekDays`**, estimated minutes, `allowSplit`, `isRecurring`, `recurrencePattern`, **`recurrenceWeekDays`**, optional `scheduledStartTime` / `scheduledEndTime`. `phaseIds` must belong to the current user.

## Google Calendar — `/google-calendar`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/google-calendar/auth-url` | URL to start OAuth |
| GET | `/google-calendar/callback` | OAuth callback (must match `GOOGLE_REDIRECT_URI`) |
| GET | `/google-calendar/check-connection` | Connection status |
| POST | `/google-calendar/disconnect` | Disconnect |

Other routes (events, lists) are in `google-calendar.controller.ts` and Swagger.

## Schedule — `/schedule`

Protected with JWT (`JwtAuthGuard`).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/schedule` | List scheduled tasks (query: date range, optional `phaseId`) |
| GET | `/schedule/:id` | Single record |
| POST | `/schedule` | Create a scheduled slot |
| PATCH | `/schedule/:id` | Change times |
| DELETE | `/schedule/:id` | Delete |
| POST | `/schedule/generate` | Enqueues intelligent replan for range; returns `{ jobId, status, message }` — poll `GET /schedule-jobs/:id`, then refresh Google events on Calendar |
| DELETE | `/schedule` | Clear still-open app-generated local slots through the Settings horizon, and leftover upcoming events on the app Google calendar. Fully ended blocks stay. Returns `{ deleted: number }`. |

## Event phases — `/event-phases`

Links Google Calendar events to phases (separate from CRUD `/phases`). See `event-phases.controller.ts`.

## Schedule jobs (intelligent replan queue) — `/schedule-jobs`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/schedule-jobs/replan` | Enqueue full replan (same pipeline as after task changes) |
| GET | `/schedule-jobs/latest/done` | Latest completed job + parsed `result` (diff / warnings / errors) |
| GET | `/schedule-jobs/:id` | Poll job status until `done` or `failed`. While running, `progressStage` is `preparing` / `computing` / `syncing_google` (optional `progressCurrent` / `progressTotal` during Google sync). |

`POST /schedule/generate` enqueues the same pipeline and returns `{ jobId, status, message }` (frontend polls `GET /schedule-jobs/:id`).

Completed jobs expose a parsed `result` with `diff`, `warnings`, and `errors` (see [spec-intelligent-scheduling](spec-intelligent-scheduling.md)). Generate / Clear live on the **Calendar** page. Generate shows a stage timeline while the job runs. A dismissible **Last generate** notes panel lists warnings/errors; a colored toast (title + detail, green / yellow / red by outcome) summarizes the run. Past **app-generated** events stay after replan/clear and render in gray; other Google calendars keep their colors. Task and calendar edits return immediately; replan continues in the background.

## Tasks (scheduling-related fields)

Create/update body may include:

- `eventType` — `fixed` (pinned, not moved) or `admin` (flexible / recurring). Optional; default `admin`. Legacy values may still exist on old rows.
- `phaseIds` — at most one phase UUID (empty = full wake/sleep window)
- `estimatedTimeInMinutes` — optional; default 30 for non-fixed, or derived from start/end for fixed
- `scheduledStartTime` / `scheduledEndTime` — required when `eventType` is `fixed`. For movable tasks, optional preferred clock (end = start + duration). After replan these hold the placed slot. `null` clears them.
- `earliestStartTime` — movable: do not place before this instant (day or clock). Survives replan. `null` clears it. Day-only From is local **00:00** in the **settings** IANA zone (stored as UTC).
- `timeZone` — create/update: optional IANA zone copied onto `scheduleTimeZone` (Google payload). The engine’s day/wake/sleep/phase math uses **settings `timeZone`**, not the host process zone.
- `eligibleWeekDays` — movable non-recurring: only these weekdays inside the From–Until window. Empty / omitted = any day in the window.
- `isRecurring`, `recurrencePattern` — `DAILY` / `WEEKLY` / `BIWEEKLY` / `MONTHLY`
- `recurrenceWeekDays` — `0` = Sunday … `6` = Saturday. Empty / omitted / all seven = no extra weekday filter. Intersected with the phase `weekDays`.
- `allowSplit` — per-task; engine also requires the user setting `allowSplitScheduling`

Non-`fixed` tasks trigger an automatic replan job after create/update/delete/status change.
