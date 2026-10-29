# API reference

All paths below are relative to the backend base URL (e.g. `http://localhost:3001`). Many endpoints require a **Bearer JWT** (see Swagger).

Request/response shapes: **Swagger** after the server starts — `/api`.

## Auth — `/auth`

Primary sign-in is Google. Microsoft appears on login when `MICROSOFT_*` is set. Apple is **not** a sign-in provider — iCloud Calendar is linked from Settings via CalDAV ([integrations](integrations.md)). There is no email/password register, login, or reset.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/auth/google` | Start Google sign-in (login or register). The same consent includes Calendar scopes. |
| POST | `/auth/google/session` | Exchange the one-time `ticket` for JWT `{ access_token, refresh_token }` |
| GET | `/auth/microsoft` | Microsoft authorize URL (new session) |
| GET | `/auth/microsoft/link` | Microsoft authorize URL to link while logged in (JWT) |
| GET | `/auth/microsoft/callback` | Microsoft OAuth callback |
| POST | `/auth/microsoft/session` | Exchange Microsoft one-time ticket for JWT |
| POST | `/auth/apple/caldav` | Link iCloud Calendar (`appleId` + `appSpecificPassword`, JWT) |
| GET | `/auth/providers/status` | Provider availability (`google` / `microsoft` OAuth; `apple` always true for CalDAV) |
| GET | `/auth/identities` | Linked identities for the current user (JWT) |
| POST | `/auth/identities/:provider/disconnect` | Disconnect a linked identity (`confirm: true`) |
| POST | `/auth/refresh` | Refresh tokens |
| POST | `/auth/logout` | Logout |
| GET | `/auth/me` | Signed-in email (for delete-account confirm) |
| DELETE | `/auth/account` | Body `{ confirmation }` = `DELETE` or email; Google app events/calendar first, then wipe user |

The Google redirect (`GET /google-calendar/callback`) sends the browser to the frontend `/auth/google/callback?ticket=…`. That sign-in writes wake `07:00`, sleep `22:00`, and `googleCalendarLinked: true`. It does not create phases.

## Calendar overlays — `/calendar-overlays`

Thin scheduling-mode rows for external events (not full task copies). Created lazily when the user changes type.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/calendar-overlays` | List overlays for the user |
| PUT | `/calendar-overlays/:provider/:eventId` | Set `schedulingMode` `fixed` \| `flexible` |
| POST | `/calendar-overlays/:provider/:eventId/unschedule` | Delete external event + create Unscheduled task |
| DELETE | `/calendar-overlays/:provider/:eventId` | Drop overlay only |

## Calendar providers — `/calendar-providers`

Unified list across connected providers (Google; Microsoft when OAuth linked; Apple when CalDAV linked).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/calendar-providers/calendars` | `{ providers, sections, calendars }` |
| GET | `/calendar-providers/events` | Display events for `timeMin` / `timeMax`. Each event may include attendees, organizer, `htmlLink`, reminders, and `preview` (join links, phones, attachments, categories, HTML body) when the provider sent them |

## User settings — `/user-settings`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/user-settings` | Current settings |
| PATCH | `/user-settings` | Update settings |

`GET` creates a settings row when the user has none. It does **not** create phases.

Relevant fields for intelligent scheduling: `wakeTime`, `sleepTime`, `weekendWorkEnabled`, `allowSplitScheduling`, `minSplitMinutes`, **`defaultTaskDurationMinutes`** (default 30; new tasks and voice use it when duration is omitted), **`timeZone`** (IANA, e.g. `Asia/Nicosia` / `Europe/Kyiv`). Empty `timeZone` is filled **once** from the browser on first login; the user can change it in Settings. Invalid IANA names are rejected. Postgres stores `wakeTime` / `sleepTime` as `time` (`HH:mm:ss`); the engine normalizes them to `HH:mm` and interprets those clocks **in `timeZone`** (fallback `UTC`).

**`language`** (`en` | `uk`, default `en`) is the UI and notification language. Empty/`null` is seeded once from the browser (`uk*` → `uk`, else `en`). Push titles, schedule-suggestion language, and localized API error messages follow this setting. The frontend also sends `Accept-Language` matching the active locale.

**`speechLanguage`** (`en` | `uk`, default `en`) is the spoken language for voice STT, TTS, and agent reply copy. Independent of UI `language`. Empty/`null` is seeded once from the current UI `language` for existing users.

**`confirmVoiceCommands`** is ignored. Every voice write returns `confirm` with preview intents and waits for Apply or spoken yes; a single task uses the same card as a batch. **`speakVoiceReplies`** (default true) has the client speak clarifying questions, confirm summaries, and success/refuse results via Web Speech.

**`remindersEnabled`** (default false) turns on Web Push. See [Reminders](#reminders--reminders). That flag does not create day reminders.

**`defaultReminderTime`** (default `09:00`, `HH:mm`) is the notification clock for a day reminder that leaves its own time empty. Changing it rewrites the Google popup only for open reminders that still follow this default. A reminder with its own time is left as stored.

**`syncGoogleDeletions`** (default false): when off, a missing linked external event during retry only clears local provider ids. When on, that missing event deletes the local task. Failed Google writes sit in `pending_google_writes` and retry in the background; a newer Google edit of time/title/description drops the pending row and pulls into the task. **`DELETE /tasks/:id`** discards pending upserts for that task, waits for any in-flight Google sync, deletes linked Google events, then removes the row — so a racing sync cannot recreate the event after delete.

**`appCalendarProvider`**: `google` | `microsoft` | `apple` — connected account that hosts the named app calendar for new writes. **`appGoogleCalendarName`**: title of that calendar. Legacy **`syncTargetCalendars`** is unused by the writer.

**`dismissWarnFlexibleMove`**, **`dismissWarnUnscheduleExternal`**, **`dismissWarnExternalWriteBack`**: user opted out of the matching confirmation dialogs.

**`hiddenGoogleCalendarIds`** (string array) hides those calendars on the Calendar page. Google ids are stored plain; Microsoft and Apple use `provider:id`. Empty means the visible Google set (primary, the app calendar, and calendars selected in Google) plus every connected Microsoft and Apple calendar. The stored app calendar id is dropped if sent. A non-array is 400. A hidden calendar is also left out of placement, the Problematic slot picker, reminders, suggestions, and voice busy time.

**`fixedEventBufferMinutes`** (integer, default 0, max 180) is the gap placement keeps before and after each fixed task and each external event on a visible connected calendar (Google, Microsoft, Apple). 0 turns it off. Generate may place work in that gap when the task would not fit otherwise. Habits are not padded. Dragging a block is not blocked by the gap.

## Phases (day phases) — `/phases`

**Bearer JWT required** for all routes in this controller.

Phases are **per user** (`userId` on each row). Nothing creates them on `GET /phases` or `GET /user-settings`. The first-run screen calls one of the two writes below. Skip (`setup-defaults`) creates:

| Name | `type` | Window |
|------|--------|--------|
| Sleep | `sleep_time` | `sleepTime` → `wakeTime` (overnight, from user settings) |
| Focus hours | `main_phase` | `wakeTime` → `sleepTime` (hidden on the phase list) |

Routes:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/phases` | All phases for current user |
| POST | `/phases` | Create (overlap rules apply within the user’s phases) |
| POST | `/phases/setup-defaults` | Sleep + hidden Focus when the user has no phases yet |
| POST | `/phases/apply-preset` | Replace all phases with Sleep, hidden Focus, and a lifestyle preset (`working`, `student`, or `open`). Morning blocks are fixed lengths from wake; the evening block is a fixed length before sleep; a fill block closes the gap between them. Blocks under 30 minutes are dropped. 400 if settings are missing, the preset id is unknown, or any phase still has tasks |
| GET | `/phases/time-phases` | `time_phase` only |
| GET | `/phases/time-phases/date/:date` | Time phases applicable on that date |
| GET | `/phases/sleep-time` | `sleep_time` only |
| GET | `/phases/:id` | One phase |
| PATCH | `/phases/:id` | Update |
| DELETE | `/phases/:id` | Delete (blocked if tasks are assigned) |

Task `phaseIds` must reference phases owned by the same user.

## Voice — `/voice`

JWT. STT uses Azure Speech when `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` are set, otherwise Groq (`GROQ_API_KEY`). The voice planner tries DeepSeek, then Qwen, then Gemini, then Groq. `VOICE_LLM_PROVIDER=deepseek` also sends parse to DeepSeek. Otherwise task parse uses local Ollama when `LLM_BASE_URL` is set, otherwise Groq. Optional `GROQ_API_KEY_2`… rotate on provider rate limits. Soft daily chat-token cap (`VOICE_DAILY_TOKEN_LIMIT`, default 100000) returns `VOICE_QUOTA_EXCEEDED` when exhausted. Spoken replies use Azure Speech when `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` are set, otherwise Piper when `PIPER_URL` is up (`POST /voice/speak`), otherwise the browser voice. Audio is **not** stored. Each parse logs one structured `voice.parse.result` line (see [voice-prompt-next.md](voice-prompt-next.md)).

| Method | Path | Description |
|--------|------|-------------|
| POST | `/voice/transcribe` | Body `{ audioBase64, mimeType?, language?, sessionId? }` → `{ transcript, language? }`. Azure Speech when configured (raw text, no Whisper cleanup); otherwise Whisper. `sessionId` keeps Groq STT on the same key as the following turn |
| POST | `/voice/turn` | Voice Agent turn. Body `{ transcript?, sessionId, timeZone, clientNowIso?, actionId?, executionReport?, mode? }` → `{ sessionId, outcome, assistantMessage, intents, actions, plan, segments, clarifyCount, legacyParse }`. `mode`: `assistant` (default) or `fast_create` |
| POST | `/voice/speak` | Body `{ text, language? }` → WAV (`audio/wav`). Azure Speech when configured; otherwise local Piper when `PIPER_URL` is set; 503 if that synthesizer is down |
| DELETE | `/voice/session/:sessionId` | Discard in-memory agent session (widget close) |
| POST | `/voice/parse-task` | Tests, and each write segment the planner already split out. A planner fault does not call this. Neither does a plan edit with no open draft, an answer with no open question, empty steps, or a segment list past the limit. Body `{ transcript, timeZone, clientNowIso?, previousTranscript?, clarificationAnswer?, mode? }` → `{ understanding, clarifyingQuestion, task, command }`. `mode: fast_create` tightens the create specialist only |

**`/voice/turn`:** the new UI always uses this path. Read tools ground `answer` / `clarify` / `refuse`. Mutations return `act` or `confirm` with `intents[]` (`create` | `command` shapes for the client executor). One utterance may yield several intents (planner `steps` → one parse per segment); `segments[]` carries `{ summary, status: ready | clarify | refused | dropped }`. `actionId`: `confirm` \| `cancel` \| `build_plan` \| `report`. After executing intents the client sends `actionId: 'report'` with `executionReport: { results: [{ summary, status: applied | skipped | conflict | error }] }` (no LLM call). Day plan: `plan` is `{ day, stage: interview | review, revision, items[{ itemId, taskId, source: unscheduled | new | flexible, name, start, end, durationMinutes }], unplaced[{ itemId, name, reason: no_room | deadline_passed | conflict }], changedItemIds[] }`; interview turns are `clarify` with `actions: ['build_plan', 'cancel']`; review turns are `confirm` with empty `intents` (Apply intents are held in the session and returned with the `act` after `confirm`). A planner fault is `refuse` with an empty `legacyParse`: a reply that is not JSON (`invalid_json`), an unknown or ill-formed decision (`invalid_decision`), a tool request the planner cannot run (`tool_limit_exceeded`), or any other planner exception (`planner_execution_error`). More than six segments is `clarify` with `segment_limit_exceeded` and no intents. Rate limit and timeout still return those errors. Accepted decisions are logged as `planner.decision`; faults as `planner.fault`. Session is in-memory; new `sessionId` per widget open; clear on DELETE / close. An open clarification batch stays until the user answers it or cancels it. There is no two-question cap. A second reply that still does not supply the missing fact is a refusal, and that batch is cleared. See [spec-voice-agent.md](spec-voice-agent.md).

`understanding` (parse-task / legacyParse): `complete` (a name is enough to preview a card; Apply writes it; defaults fill the rest), `sufficient` (treated as complete if a name exists), `needs_clarification` (no usable name — one follow-up question). When the router intent is `needs_clarification`, `task` and `command` stay null even if the transcript contains a name. After a clarification reply the API will not ask a second question. The client sends Settings IANA `timeZone`. Calendar-day parsing uses **settings `timeZone`** when set, otherwise the request `timeZone`, otherwise `UTC`.

`command` is `null` for create. Otherwise it is a resolved action (`complete`, `skip`, `end_series`, `move`, `shift`, `window`, `update`, `delete` (habit_* intents are soft-disabled and clarify)) or `{ kind: "refuse", message }`. The client writes through the existing task, skip, move, APIs. A bare pronoun is not the task happening now. Explicit selection of the current task is that task. The word for the present moment is a time. A named match is among incomplete tasks . Done on a recurring task asks this day, this day and following, or the whole series. This day skips today's occurrence. This and following ends the series from that day. The whole series is marked completed. Delete and reschedule of a recurring task ask the same three ways. A field edit (name, priority, phase) applies to the whole series only. An open slot is moved like a calendar drag; a task with no open slot gets a new From/Until window and a silent replan. One clarifying question, then a refusal. Every write shows a preview card until Apply or spoken yes. See [spec-voice-agent.md](spec-voice-agent.md).

## Habits — `/habits`

**MVP soft-disabled.** `GET /habits` returns an empty `habits: []` (civil today / editable window / timeZone still present; no Google backfill). Writes and check-ins return **410 Gone**. Module and DB rows remain for a later re-enable. Historical behavior below is inactive.

JWT. Civil “today” uses **settings `timeZone`**. Check-ins can be added or removed for any day through today (future dates are rejected). `editableFrom` / `editableTo` on the list describe the Habits page 14-day grid columns, not an edit lock. Check-ins are not tasks and are not written to Google Calendar. An optional daily time block is busy time for Generate and is drawn on the in-app calendar. When Google Calendar is connected, that block is also a daily recurring event (`RRULE:FREQ=DAILY`) on the app calendar, starting today in the settings time zone. `GET /habits` creates the series for a block that does not have `googleEventId` yet. A missing or expired Google token keeps the local block and skips the Google write. Check-ins do not create or change the event. Each habit stores an `achievements` map (`id → unlockedAt` ISO). Catalog: `first_check_in`, `streak_3` / `7` / `30` / `100` (longest consecutive run), `clean_week` (any full Mon–Sun week). Check-in responses include `newlyUnlocked` (ids unlocked in that request) for a one-time toast; list/create/update return `newlyUnlocked: []`. Listing silently backfills unlocks without toasting. When a streak achievement unlocks on check-in, Groq writes a short `streakTip` from the habit name/description (settings `language`); if Groq is down, a template tip is used. The tip is stored as `lastStreakTip` and returned as `streakTip` on later GETs.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/habits` | List habits plus `today`, `editableFrom`, `editableTo`, `timeZone`. Each habit includes streak, points, `checkedToday`, `checkInDates`, `achievements`, `newlyUnlocked` (empty), `streakTip`, `blockStartTime`, `blockMinutes` (`null` when check-in only), and `googleEventId` when the block is on Google Calendar |
| POST | `/habits` | Create (`name`, optional `color` `#rrggbb`, optional `description`, optional daily block `blockStartTime` `HH:mm` + `blockMinutes` 5–240) |
| PATCH | `/habits/:id` | Update name / color / description / block. Block fields are a pair: both set, or both `null` to clear. One without the other is 400 |
| DELETE | `/habits/:id` | Delete the habit and its check-ins |
| POST | `/habits/:id/check-ins` | Body `{ date: "YYYY-MM-DD" }` — mark done (any day through today); may return `newlyUnlocked` and `streakTip` |
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

A timed block (visible Google event, or a local task slot when that event is not in the list) is included once when it starts within the next 30 minutes. All-day events are skipped. Habit reminders are off while habits are soft-disabled. A free external cron should call tick about every 30 minutes so Render can sleep between wakes. Push messages are kept for 30 minutes. A 404/410 from the push service deletes that subscription.

## Day reminders — `/day-reminders`

A day reminder is a named errand on a civil day (`YYYY-MM-DD` in the user’s settings timezone). It is not a task: it is not placed, it does not occupy the hour grid or the all-day strip, and `syncGoogleDeletions` does not apply. JWT on every route. There is no global `ValidationPipe`; the service rejects a blank name, a date that is not a real civil day, a clock that is not `HH:mm`, and a repeat other than `DAILY`, `WEEKLY`, `BIWEEKLY`, or `MONTHLY`. Voice writes these through the same routes after Apply: an explicit remind phrase creates one; done, change, and delete target an open reminder. `list_reminders` is a read tool on `POST /voice/turn`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/day-reminders` | Open reminders, earliest due day first. A missing or cancelled Google event deletes that row and is not recreated. |
| POST | `/day-reminders` | Create. Body: `name`, `dueYmd`, optional `description`, `notificationTime` (`null` uses `defaultReminderTime`), `recurrencePattern`, `recurrenceWeekDays` (`0` = Sunday … `6` = Saturday, weekly only). |
| PATCH | `/day-reminders/:id` | Replace those fields on an open reminder. Another user’s id is 404. |
| POST | `/day-reminders/:id/resolve` | 200. A one-off becomes `completed` and its Google event is deleted. A repeat stays `open` and moves to the next day (monthly day 31 lands on the last day of a shorter month). |
| DELETE | `/day-reminders/:id` | Deletes the row and its Google event. Response `{ deleted: true }`. |

When Google is connected, the current open occurrence is one short transparent event: start is the notification clock, end is 15 minutes later (the end may be the next day), popup reminder minutes `0`, summary is the reminder name. Sleep-window checks are skipped. The event is hidden on our calendar by its stored id. No Google connection keeps the local row and skips the event. The next occurrence gets a Google event only after resolve. Deleting that one Google event deletes the local reminder, including a series.

## Tasks — `/tasks`

Task CRUD (JWT). Bodies/responses include `phaseId`, **`phaseIds`** (max 1), **`eventType`** (`fixed` or `admin` on new writes), status, priority, deadline, **`earliestStartTime`**, **`eligibleWeekDays`**, estimated minutes, `allowSplit`, `isRecurring`, `recurrencePattern`, **`recurrenceWeekDays`**, optional `scheduledStartTime` / `scheduledEndTime`. `phaseIds` must belong to the current user. **POST/PATCH** return a `jobId` for a mutation progress job (`progressStage`: `saving` → `placing` → `syncing` → `done`). Placement and Google sync continue after the HTTP response; the client polls `GET /schedule-jobs/:id`. **POST `/tasks/:id/skip-occurrence`** skips one still-open slot or recurring instance (`{ occurrenceStart, googleEventId?, googleEventCalendarId? }`); it does not complete the task and returns `jobId: null`. Skip on a non-recurring Problematic copy records the parent series skip (when `parentSeriesId` is set), deletes the copy, and returns `{ id, deleted: true, jobId: null }` so clients drop it from cache. **DELETE `/tasks/:id`** also removes park copies whose `parentSeriesId` is that task. Recurring skips are stored as civil days so later Generate will not recreate that occurrence. **POST `/tasks/:id/end-series-from`** ends a recurring series from that civil day onward (sets `deadline`, drops open seats from that day, syncs Google); earlier days stay. Completed tasks keep a Google event when they still have a seated interval (canceled still drops it). The SPA axios client refreshes on any 401 (including schedule job polls / move-event that bypass `apiCall`) via single-flight `POST /auth/refresh`, then retries once.

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
| GET | `/schedule/free-slots` | Query: `taskId`, `ymd` (YYYY-MM-DD), optional `phaseId`. Free gaps + 15‑minute candidate starts for Problematic Move on that civil day (chosen phase or task phases ∩ wake/sleep minus busy). Returns `{ ymd, timeZone, durationMinutes, dayStart, dayEnd, phase, busy, free, candidates }`. `busy` is per-source segments (not merged) with optional `label` / `color` for the Move timeline (tasks, habits, Google). Free/candidates still use merged busy. 404 if task missing; 400 if `phaseId` is sleep / unknown. |
| GET | `/schedule/:id` | Single record |
| POST | `/schedule` | Create a scheduled slot |
| PATCH | `/schedule/:id` | Change times |
| DELETE | `/schedule/:id` | Delete |
| POST | `/schedule/move-event` | Move or resize one displayed block. Body: `googleEventId`, `originalStart`, `originalEnd`, `start`, `end`, optional `calendarId`, `recurringEventId`, and `seriesScope` (`occurrence`, `series`, or `all`). A recurring app task with no `seriesScope` returns `{ kind: "series-choice", jobId: null, taskName }` and writes nothing. Recurring moves that change the local calendar day are 400. `occurrence` skips that day, creates a one-off, and returns that create’s `jobId` so the client can poll until Google sync finishes. `series` / `all` enqueue a mutation job (`jobId`) and continue place/sync in the background (`progressStage` on `GET /schedule-jobs/:id`). Flexible slot moves also return `jobId`. Fixed moves reuse the task PATCH job. External Google-only moves return `{ kind: "google", jobId: null }`. Habit block is 400. App-task moves retarget `phaseId`/`phases` from the drop start (cleared when outside every schedulable phase). |
| POST | `/schedule/conflict-option-phrases` | Body: one `SchedulingConflict` (`taskId`, `taskName`, `reason`, `options`, optional `meta`). Returns `{ options: [{ id, title, detail }] }`. Groq only phrases ids; templates if Groq is down. Applying uses task PATCH / skip-occurrence. |

Generate, Clear, Undo, Suggestions (`POST /schedule/recommendations`), preview, and `POST /schedule-jobs/replan` are removed. Slots are written by the placement step on create/edit/drag/horizon append.

## Event phases — `/event-phases`

Links Google Calendar events to phases (separate from CRUD `/phases`). See `event-phases.controller.ts`.

## Schedule jobs — `/schedule-jobs`

Legacy read-only status for old jobs. Nothing new is enqueued.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/schedule-jobs/latest/done` | Latest completed job + parsed `result` when present |
| GET | `/schedule-jobs/:id` | Job status (leftover queue rows fail without writing slots) |

Create and geometric edit seat through the placement step after the HTTP response (poll `jobId`). Conflicts may arrive on the job `result` when placement finishes.

## Tasks (scheduling-related fields)

Create/update body may include:

- `eventType` — `fixed` (pinned, not moved) or `admin` (flexible / recurring). Optional; default `admin`. Legacy values may still exist on old rows.
- `isUnscheduled` — inbox item with no slot. Skips silent replan, Generate, and Google sync until the user schedules it. Cannot be combined with `eventType=fixed`.
- `scheduleState` — `none` | `problematic` | `resolved`. Distinct from task status and from `isUnscheduled`. `problematic` fell out of schedule (overflow / unanswered conflict) and is parked until Place on top / Skip / the user edits. `resolved` keeps park metadata (including `parentSeriesId`) and seats a second-layer slot: restores `problematicOriginalStart`/`End` when present, otherwise invents a default interval (civil day + phase start or 09:00). New claims look for another hole. Rescheduling a resolved task (start, end, or duration) clears `resolved` and park metadata, keeps the chosen interval, and does not shift other tasks on that save. A rename leaves `resolved` in place. Mutually exclusive with `isUnscheduled` (an unscheduled create clears a problematic park; `resolved` clears `isUnscheduled`).
- `problematicReason`, `problematicOccurrenceYmds`, `problematicDay` (`YYYY-MM-DD`), `problematicOriginalStart`, `problematicOriginalEnd`, `parentSeriesId` — metadata on a problematic or resolved copy. `parentSeriesId` is cleared when `scheduleState` returns to `none`. A single `problematicOccurrenceYmds` entry is copied into `problematicDay` when that day is empty.
- `seriesGroupId` — logical recurring family (primary series, clock-split siblings, detached one-offs). Survives park clear. Cleared when the user edits non-time / non-phase fields (name, description, location, priority, recurrence, deadline, Google appearance, etc.).
- `seriesSpanStart` / `seriesSpanEnd` — first and last **open** occurrence start times (derived from `scheduled_tasks` on GET). Used by the Tasks tab to show a series from→to range.
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

Non-`fixed` create and geometric edit enqueue a mutation job (`jobId`) whose `progressStage` is `saving` → `placing` → `syncing` → `done`. Recurring create/expand seats each horizon day separately; divergent clocks split into tasks sharing `seriesGroupId`. A detached one-off that lands on a sibling series clock re-merges into that series. An anchor conflict is returned on the job result; the client opens the shared sheet (`place_on_top`, `move_new`, `skip_occurrence`, `leave_problematic`, …). Dismiss / `leave_problematic` sets `problematic`. `place_on_top` / Place on top (`scheduleState: resolved`) seats the preferred or invents a default second-layer slot. Skip on a non-recurring problematic copy with `parentSeriesId` skips that day on the parent series, then deletes the copy (`{ deleted: true }`). Deleting a series also removes park copies that point at it via `parentSeriesId`. Seated writes sync to Google; failures enqueue `pending_google_writes`. No slot means no Google event. Cosmetic edits do not move the slot. A freed hole seats problematic tasks that fit, oldest first. `engine.run` does not write slots.
