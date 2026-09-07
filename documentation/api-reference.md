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

Relevant fields for intelligent scheduling: `wakeTime`, `sleepTime`, `weekendWorkEnabled`, `allowSplitScheduling`, `minSplitMinutes`.

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

`understanding`: `complete` (client creates immediately), `sufficient` (prefill form), `needs_clarification` (one follow-up question). After a clarification reply the API will not ask a second question.

## Tasks — `/tasks`

Task CRUD (JWT). Bodies/responses include `phaseId`, **`phaseIds`** (max 1), **`eventType`** (`fixed` or `admin` on new writes), status, priority, deadline, estimated minutes, `allowSplit`, `isRecurring`, `recurrencePattern`, **`recurrenceWeekDays`**, optional `scheduledStartTime` / `scheduledEndTime`. `phaseIds` must belong to the current user.

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
| DELETE | `/schedule` | Clear app-generated local slots from today through Settings horizon, and leftover events on the app Google calendar in that window. Returns `{ deleted: number }`. |

## Event phases — `/event-phases`

Links Google Calendar events to phases (separate from CRUD `/phases`). See `event-phases.controller.ts`.

## Schedule jobs (intelligent replan queue) — `/schedule-jobs`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/schedule-jobs/replan` | Enqueue full replan (same pipeline as after task changes) |
| GET | `/schedule-jobs/latest/done` | Latest completed job + parsed `result` (diff / warnings / errors) |
| GET | `/schedule-jobs/:id` | Poll job status until `done` or `failed` |

`POST /schedule/generate` enqueues the same pipeline and returns `{ jobId, status, message }` (frontend polls `GET /schedule-jobs/:id`).

Completed jobs expose a parsed `result` with `diff`, `warnings`, and `errors` (see [spec-intelligent-scheduling](spec-intelligent-scheduling.md)). Generate / Clear live on the **Calendar** page. A dismissible **Last generate** notes panel lists warnings/errors; a single toast summarizes the run.

## Tasks (scheduling-related fields)

Create/update body may include:

- `eventType` — `fixed` (pinned, not moved) or `admin` (flexible / recurring). Optional; default `admin`. Legacy values may still exist on old rows.
- `phaseIds` — at most one phase UUID (empty = full wake/sleep window)
- `estimatedTimeInMinutes` — optional; default 30 for non-fixed, or derived from start/end for fixed
- `scheduledStartTime` / `scheduledEndTime` — required when `eventType` is `fixed`. For movable tasks, optional preferred window (end = start + duration). `null` clears them.
- `isRecurring`, `recurrencePattern` — `DAILY` / `WEEKLY` / `BIWEEKLY` / `MONTHLY`
- `recurrenceWeekDays` — `0` = Sunday … `6` = Saturday. Empty / omitted / all seven = no extra weekday filter. Intersected with the phase `weekDays`.
- `allowSplit` — per-task; engine also requires the user setting `allowSplitScheduling`

Non-`fixed` tasks trigger an automatic replan job after create/update/delete/status change.
