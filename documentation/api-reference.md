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

## Tasks — `/tasks`

Task CRUD (JWT). Bodies/responses include `phaseId`, **`phaseIds`**, **`eventType`**, status, priority, deadline, estimated minutes, `allowSplit`, optional `scheduledStartTime` / `scheduledEndTime` for **fixed** types, etc. `phaseIds` must belong to the current user.

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
| POST | `/schedule/generate` | Enqueues intelligent replan for range; returns `{ jobId, status, message }` — poll `GET /schedule-jobs/:id`, then reload `GET /schedule` |
| DELETE | `/schedule` | Clear schedule in a range (body with dates, same as generate) |

## Event phases — `/event-phases`

Links Google Calendar events to phases (separate from CRUD `/phases`). See `event-phases.controller.ts`.

## Schedule jobs (intelligent replan queue) — `/schedule-jobs`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/schedule-jobs/replan` | Enqueue full replan (same pipeline as after task changes) |
| GET | `/schedule-jobs/latest/done` | Latest completed job + parsed `result` (diff / warnings / errors) |
| POST | `/schedule-jobs/undo-last` | Restore auto-generated `scheduled_tasks` from snapshot before last successful job; if a task has `googleEventId`, Google event start/end are patched to match restored segments |
| GET | `/schedule-jobs/:id` | Poll job status until `done` or `failed` |

`POST /schedule/generate` enqueues the same pipeline and returns `{ jobId, status, message }` (frontend polls `GET /schedule-jobs/:id`).

Completed jobs expose a parsed `result` with `diff`, `warnings`, and `errors` (see [spec-intelligent-scheduling](spec-intelligent-scheduling.md)). The Schedule UI shows the last replan summary and an **Undo last replan** action when `undoSnapshotId` is present on the latest done job.

## Tasks (scheduling-related fields)

Create/update body may include:

- `eventType` — enum (`fixed`, `daily_routine`, `quick_win`, …)
- `phaseIds` — array of phase UUIDs (union of allowed windows)
- `estimatedTimeInMinutes` — optional; defaults by `eventType` if omitted
- `scheduledStartTime` / `scheduledEndTime` — required when `eventType` is `fixed`

Non-`fixed` tasks trigger an automatic replan job after create/update/delete/status change.
