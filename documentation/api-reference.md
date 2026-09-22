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

**`remindersEnabled`** (default false) turns on Web Push. See [Reminders](#reminders--reminders).

**`hiddenGoogleCalendarIds`** (string array) hides those Google calendars on the Calendar page. Empty means primary, the app calendar, and calendars selected in Google. The stored app calendar id is dropped if sent. A non-array is 400. This does not change which calendars Generate treats as busy.

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
| POST | `/phases/setup-defaults` | Sleep + hidden Focus when the user has no phases yet |
| POST | `/phases/apply-preset` | Replace all phases with Sleep, hidden Focus, and a lifestyle preset (`working`, `student`, or `open`). Hours are offsets from wake/sleep (blocks under 30 minutes are dropped). 400 if settings are missing, the preset id is unknown, or any phase still has tasks |
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

`understanding`: `complete` (client creates immediately when a name exists; defaults fill the rest), `sufficient` (treated as complete if a name exists), `needs_clarification` (no usable name — one follow-up question). After a clarification reply the API will not ask a second question. The client sends Settings IANA `timeZone`. Calendar-day parsing uses **settings `timeZone`** when set, otherwise the request `timeZone`, otherwise `UTC`.

## Habits — `/habits`

JWT. Civil “today” uses **settings `timeZone`**. Check-ins can be added or removed for today and the previous 13 days. Check-ins are not tasks and are not written to Google Calendar. An optional daily time block is busy time for Generate and is drawn on the in-app calendar. When Google Calendar is connected, that block is also a daily recurring event (`RRULE:FREQ=DAILY`) on the app calendar, starting today in the settings time zone. `GET /habits` creates the series for a block that does not have `googleEventId` yet. A missing or expired Google token keeps the local block and skips the Google write. Check-ins do not create or change the event.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/habits` | List habits plus `today`, `editableFrom`, `editableTo`, `timeZone`. Each habit includes streak, points, `checkedToday`, `checkInDates`, `blockStartTime`, `blockMinutes` (`null` when check-in only), and `googleEventId` when the block is on Google Calendar |
| POST | `/habits` | Create (`name`, optional `color` `#rrggbb`, optional `description`, optional daily block `blockStartTime` `HH:mm` + `blockMinutes` 5–240) |
| PATCH | `/habits/:id` | Update name / color / description / block. Block fields are a pair: both set, or both `null` to clear. One without the other is 400 |
| DELETE | `/habits/:id` | Delete the habit and its check-ins |
| POST | `/habits/:id/check-ins` | Body `{ date: "YYYY-MM-DD" }` — mark done (last 14 days, through today) |
| DELETE | `/habits/:id/check-ins/:date` | Clear that day’s check-in (same window) |

Points: +1 per successful day, plus +1 whenever a consecutive run hits a multiple of 7. Streak counts consecutive days ending today, or yesterday if today is not yet checked. A time block repeats every civil day in the settings zone, including weekends. `blockMinutes` is an integer from 5 to 240. Generate will not place a task on top of that interval. Marking the day done does not remove the block. Changing the clock time or duration replaces the Google series. Clearing the block or deleting the habit deletes that series. The in-app calendar keeps its own chip and hides the matching Google event so the block is not drawn twice.

## Reminders — `/reminders`

Web Push for the signed-in user. Off until Settings turns `remindersEnabled` on and this browser subscribes. The API also checks about once a minute while it is awake.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/reminders/vapid-public-key` | JWT. `{ publicKey }` for `pushManager.subscribe`. 503 when `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` are unset |
| POST | `/reminders/subscriptions` | JWT. Body `{ endpoint, p256dh, auth }`. `endpoint` must be `https`. Reassigns the endpoint if another session saved it |
| DELETE | `/reminders/subscriptions` | JWT. Body `{ endpoint }`. Removes only the current user's row. 204 |
| POST | `/reminders/tick` | No JWT. Header `x-reminder-cron-secret` must match `REMINDER_CRON_SECRET`. 503 if that secret is unset, 401 if it does not match. Sends one reminder when a start is still ahead and at most 30 minutes away. A start that already passed is skipped. Returns `{ users, sent }` |

A timed block (visible Google event, or a local task slot when that event is not in the list) is included once when it starts within the next 30 minutes. All-day events are skipped. Each habit with `blockStartTime` uses that clock the same way if today is not checked in. Habits without a block share one notification in the 30 minutes before `wakeTime` when any of them is still open. A free external cron should call tick about every 30 minutes so Render can sleep between wakes. Push messages are kept for 30 minutes. A 404/410 from the push service deletes that subscription.

## Tasks — `/tasks`

Task CRUD (JWT). Bodies/responses include `phaseId`, **`phaseIds`** (max 1), **`eventType`** (`fixed` or `admin` on new writes), status, priority, deadline, **`earliestStartTime`**, **`eligibleWeekDays`**, estimated minutes, `allowSplit`, `isRecurring`, `recurrencePattern`, **`recurrenceWeekDays`**, optional `scheduledStartTime` / `scheduledEndTime`. `phaseIds` must belong to the current user. **POST/PATCH** also return `jobId` when a silent replan was enqueued (`null` for fixed / completed). **POST `/tasks/:id/skip-occurrence`** skips one still-open slot or recurring instance (`{ occurrenceStart, googleEventId?, googleEventCalendarId? }`); it does not complete the task, does not enqueue replan, and returns `jobId: null`. Recurring skips are stored as civil days so later Generate will not recreate that occurrence. The Calendar client polls `GET /schedule-jobs/:id` then refreshes tasks and Google events.

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
| POST | `/schedule/move-event` | Move or resize one displayed block. Body: `googleEventId`, `originalStart`, `originalEnd`, `start`, `end`, optional `calendarId` and `recurringEventId`. Updates that occurrence and Google. Does not enqueue replan. Returns `{ kind: "fixed" \| "slot" \| "google" }`. A habit block is 400. |
| POST | `/schedule/recommendations` | Suggestions for the next 7 days in settings `timeZone`. Body ignored. Returns `{ summary, suggestions: [{ kind, title, detail, taskId }] }`. `kind` is `overload`, `gap`, `phase_mismatch`, or `deadline_risk`. Does not write tasks, slots, Google, or undo. Empty calendars skip Groq. Groq failures are 503. |
| POST | `/schedule/preview` | Dry-run of Calendar Generate. Returns `{ diff, warnings, errors }` and does not write slots, Google, or undo. |
| POST | `/schedule/generate` | Enqueues Calendar generate (async); returns `{ jobId, status, message }` — poll `GET /schedule-jobs/:id`. Stores an undo snapshot. |
| DELETE | `/schedule` | Clear still-open app-generated local slots through the Settings horizon, and leftover upcoming events on the app Google calendar. Fully ended blocks stay. Drops Generate undo. Returns `{ deleted: number }`. |

## Event phases — `/event-phases`

Links Google Calendar events to phases (separate from CRUD `/phases`). See `event-phases.controller.ts`.

## Schedule jobs (intelligent replan queue) — `/schedule-jobs`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/schedule-jobs/replan` | Enqueue full replan (same pipeline as after task changes; no undo snapshot) |
| GET | `/schedule-jobs/undo` | `{ available, jobId, generatedAt }` for the last Calendar Generate |
| POST | `/schedule-jobs/undo` | Restore still-open slots + Google from that snapshot; finished blocks stay |
| GET | `/schedule-jobs/latest/done` | Latest completed job + parsed `result` (diff / warnings / errors) |
| GET | `/schedule-jobs/:id` | Poll job status until `done` or `failed`. While running, `progressStage` is `preparing` / `computing` / `syncing_google` (optional `progressCurrent` / `progressTotal` during Google sync). |

`POST /schedule/generate` enqueues the same pipeline and returns `{ jobId, status, message }` (frontend polls `GET /schedule-jobs/:id`).

Completed jobs expose a parsed `result` with `diff`, `warnings`, and `errors` (see [spec-intelligent-scheduling](spec-intelligent-scheduling.md)). Generate / Clear live on the **Calendar** page. Generate opens a preview (`POST /schedule/preview`) and applies only after confirmation; the job then shows a stage timeline. **Undo last generate** restores the previous still-open app blocks (and Google). A dismissible **Last generate** notes panel lists warnings/errors; a colored toast (title + detail, green / yellow / red by outcome) summarizes the run. Past **app-generated** events stay after replan/clear/undo and render in gray; other Google calendars keep their colors. Task and calendar edits return immediately; replan continues in the background.

## Tasks (scheduling-related fields)

Create/update body may include:

- `eventType` — `fixed` (pinned, not moved) or `admin` (flexible / recurring). Optional; default `admin`. Legacy values may still exist on old rows.
- `isUnscheduled` — inbox item with no slot. Skips silent replan, Generate, and Google sync until the user schedules it. Cannot be combined with `eventType=fixed`.
- `location`, `googleColorId`, `googleVisibility`, `googleTransparency`, `googleReminders` — stored on the task and written to Google when a timed event is created.
- `phaseIds` — at most one phase UUID (empty = full wake/sleep window)
- `estimatedTimeInMinutes` — optional; default 30 for non-fixed, or derived from start/end for fixed
- `scheduledStartTime` / `scheduledEndTime` — required when `eventType` is `fixed`. For movable tasks, optional preferred clock (end = start + duration). After replan these hold the placed slot. `null` clears them.
- `earliestStartTime` — movable: do not place before this instant (day or clock). Survives replan. `null` clears it. Day-only From is local **00:00** in the **settings** IANA zone (stored as UTC).
- `timeZone` — create/update: optional IANA zone copied onto `scheduleTimeZone` (Google payload). The engine’s day/wake/sleep/phase math uses **settings `timeZone`**, not the host process zone.
- `eligibleWeekDays` — movable non-recurring: only these weekdays inside the From–Until window. Empty / omitted = any day in the window.
- `isRecurring`, `recurrencePattern` — `DAILY` / `WEEKLY` / `BIWEEKLY` / `MONTHLY`
- `recurrenceWeekDays` — `0` = Sunday … `6` = Saturday. Empty / omitted / all seven = no extra weekday filter. Intersected with the phase `weekDays`.
- `allowSplit` — per-task; engine also requires the user setting `allowSplitScheduling`

Non-`fixed` tasks trigger an automatic replan job after create/update/delete/status change, except `isUnscheduled` inbox items (replan runs if a previously scheduled task is moved into the inbox, to free the slot).
