# Feature docs backfill

Starting notes used for the documentation catch-up (archived). Not a spec. Feature files now live under [features/](features/README.md). Keep this file as the seed notes that were checked against code when those files were written.

Do not copy this file into a feature doc. Do not decide open product items that already live elsewhere: habits’ future shape, STT auto vs settings, hide-app-calendar, and the unfinished phone daily path (§32).

## Event preview

Slug: `event-preview`. Mentioned in archive §26 and one clause in overview.

Docs say a calendar block click opens a read-only preview (title, time, description, location, recurrence) for app tasks and Google-only events. Edit and Delete sit on the preview. Repeating items ask this day / following / entire series on both. Chip X and list Delete stay shortcuts. Opening Edit from the preview hides Delete/Skip on the form.

Ask if the code does not show it: which event kinds get a preview (Microsoft, Apple, habits, Unscheduled), and what the preview omits.

## Multi-calendar busy time and chips

Slug: `multi-calendar`. Archive §27. `integrations.md` is only how to connect.

Docs say Google, Microsoft, and Apple share `CalendarProvider`. Placement, the engine, the Problematic slot picker, reminders, suggestions, and voice treat timed events on every visible connected calendar as busy. Hidden, cancelled, and free events are not. The app’s own synced copies are not counted twice. `calendar_event_overlays` stores fixed/flexible only after the user changes type on an external event. Unscheduled deletes that external event and creates an inbox task. Automatic placement does not move external events. Chips show a type icon plus a provider logo and calendar name. Visibility filter uses provider sections. App-task writes still go to Google only.

Ask if the code does not show it: what “visible” means for a calendar that was never toggled, and what Unscheduled does when the external delete fails.

## Personal day

Slug: `personal-day`. Archive, Setup.

Docs say day and week grids run from wake until sleep. When sleep is after midnight, those hours sit at the bottom of that day. Sleep is omitted. Hours no schedulable phase covers are omitted; with no phases the whole wake-to-sleep window stays. Month chips use the same boundary.

Ask if the code does not show it: overnight wake, or sleep equal to wake.

## Drag and resize

Slug: `calendar-drag`. Archive, Setup.

Docs say drag moves a timed block and edge drag resizes it in 15-minute steps, on the day and week grids, and the new time is saved on that occurrence and in Google. Month stays click-to-open. Habit blocks are not draggable. A flexible slot can be placed again later.

Ask if the code does not show it: series drag (this day vs whole series) belongs in the placement spec — this doc should only say what the grid does and link there. Also what cannot be dragged (external, fixed, completed).

## Hide calendars

Slug: `calendar-visibility`. Archive, Setup. Do not decide the Later item “Hide app calendar”.

Docs say **Calendars** hides calendars from the grid and from Now. Default is primary + the app calendar + calendars selected in Google, plus every connected Microsoft and Apple calendar. The app calendar stays visible. Hidden calendars are left out of placement busy time.

Ask if the code does not show it: whether a hidden calendar still syncs, still reminds, and still feeds suggestions and voice.

## Now / Next

Slug: `now-next`. Archive, Daily loop.

Docs say the Calendar strip shows the current overlapping block, the next start today, and today’s transitional Unscheduled inbox, in settings timezone. External events appear without Done. One-tap Done completes a non-recurring app task. Skip drops one still-open slot or recurring instance. Slotted habits compete with tasks by start time and check in from the strip. Habits without a slot are a today-only row. Done keeps the seated block. Skip leaves the task `todo`.

Ask if the code does not show it: what “current” means when several blocks overlap, and whether completed blocks stay in Now.

## Suggestions

Slug: `schedule-suggestions`. Archive, Extras. API: `POST /schedule/recommendations`.

Docs say Calendar asks Groq for up to five notes on the next 7 days. Nothing is saved or applied. An empty calendar skips the model. A Google outage still returns notes from local tasks.

Ask if the code does not show it: what “empty” means when only habits or external events exist, and which language the notes use.

## Default task duration

Slug: `default-task-duration`. Archive.

Docs say Settings `defaultTaskDurationMinutes` (default 30, range 5–480) is the length of a new task when none is named. The create form starts there. Voice parse sends it. `POST /tasks` uses it when the body omits duration. `defaultWorkBlockDuration` stays the focus block.

Ask if the code does not show it: which creates ignore it (fixed with explicit start/end, recurring, Unscheduled, habits).

## Task search and filters

Slug: `task-filters`. Archive, Extras.

Docs say Tasks only, client-side, and the two sections do not share controls. Unscheduled: name, status, overdue. Scheduled: name, status, phase, fixed / flexible / recurring, overdue, and sort. Overdue is a past deadline on a task that is not completed or canceled. Completed or canceled Unscheduled rows stay out of the inbox.

Ask if the code does not show it: whether search matches description, and whether a series group hides when only a nested row matches.

## Series grouping on Tasks

Slug: `task-series-group`. Archive. Placement of `seriesGroupId` stays in [spec-incremental-placement.md](spec-incremental-placement.md). This doc is the Tasks page only.

Docs say tasks that share `seriesGroupId` render as one group. The primary member uses a full task card; its Delete removes every member immediately, with no confirm. Nested One-off / Problematic / sibling rows expand underneath and still confirm their own delete. The Recurring filter includes any task with `seriesGroupId`.

Ask if the code does not show it: which member is primary, and what Delete does to Google events for the nested rows.

## Buffer around fixed events

Slug: `fixed-event-buffer`. Archive, Extras. Test matrix B01 is a case list, not this doc.

Docs say Settings `fixedEventBufferMinutes` (0–180, default 0) keeps that many minutes free before and after each fixed task and each external event on a visible connected calendar. The gap is used only when the task would not fit otherwise. Habits and ended flexible slots are not padded. Dragging a block can still land inside the gap.

Ask if the code does not show it: buffers around all-day events, and whether two fixed events share one gap or stack two.

## Voice series scope

Slug: `voice-series-scope`. Archive. The agent contract stays in [spec-voice-agent.md](spec-voice-agent.md).

Docs say delete, complete, reschedule, and a field edit of a repeating task ask: this day, this day and following, or the whole series. This day skips that occurrence. This and following ends the series from that day. The whole series deletes, completes, or moves as one task. A name, priority, or phase change applies only to the whole series.

Ask if the code does not show it: whether the question is spoken, tapped, or both, and what happens if the user names the scope in the same utterance.

## Voice token cap and key rotation

Slug: `voice-quota`. Archive §25. Key env vars are also in `integrations.md` and `setup-and-build.md`.

Docs say the live API discovers `GROQ_API_KEY` plus `GROQ_API_KEY_N` and rotates on TPM/TPD when two or more are set. One voice session pins one key for STT and the turn. Each user has a chat-token ceiling per civil day (default 100000, `VOICE_DAILY_TOKEN_LIMIT`). Exhausted becomes `VOICE_QUOTA_EXCEEDED` in the sheet only when hit.

Ask if the code does not show it: which calls count toward the ceiling (transcribe, turn, suggestions, habit tips), and which timezone cuts the civil day.

## Habits

Slug: `habits`. Overview paragraph, API `/habits`, e2e case list. Do not decide the Later item about what habits should become. Describe what exists.

Docs say yes/no check-ins for any civil day through today in settings timezone; future days stay locked. The Habits page shows a rolling 14-day grid. Current streak, +1 point per successful day, +1 bonus every 7 consecutive days. Achievements: `first_check_in`, streak 3/7/30/100, `clean_week`, with `unlockedAt` and a one-time toast via `newlyUnlocked`. On streak unlock, a short Groq tip (settings language, template if Groq is down) is stored and shown under the streak. Optional `blockStartTime` + `blockMinutes` is kept free by placement, drawn on the calendar, and written to Google when connected. It is not a task. Month and week show dots. Timed blocks toggle check-in. Voice can create, update, delete, check in, and uncheck by name for today.

Ask if the code does not show it: what breaks a streak, what `clean_week` means, and whether unchecking removes points, the tip, and the achievement.

## First run and day presets

Slug: `first-run-phases`. Archive. Phase CRUD itself is older core behavior; this doc is the first-run gate and the presets.

Docs say a user with no phases stays on `/setup/phases` with no app nav. Wake and sleep are saved first. Then they pick a day shape or skip to Sleep + Focus. `googleCalendarLinked` is set by that same sign-in. Presets tile wake-to-sleep. Working adds Work between Meetings and Life admin. Student Study fills from the end of Classes until Free time. Open is already contiguous. Blocks under 30 minutes are dropped. Applying a preset replaces every phase and refuses while any phase has tasks.

Ask if the code does not show it: the exact preset block list and offsets, and whether a later apply from the Phases page uses the same rules as first run.

## UI language and speech language

Slug: `language`. Archive. Do not decide the Later item “STT language: auto vs settings”.

Docs say `language` (`en` | `uk`) drives chrome, calendar and habit date labels, toast when-lines, push, and schedule suggestions. `speechLanguage` (`en` | `uk`) is independent and drives voice STT, TTS, and spoken replies. Today `speechLanguage` is a hint to Whisper on `/voice/transcribe`.

Ask if the code does not show it: which surfaces stay in the source language (task titles, phase names, Groq tips), and what a missing setting falls back to.

## Phone layout

Slug: `phone-layout`. Archive, Phone shell. §32 still owns the unfinished daily path. This doc describes the shell that exists and names what §32 has not finished. Do not mark that path done.

Docs say below 768px the shell is a bottom tab bar, the calendar opens on day, week is a day strip, month is day dots, events open as a sheet, and task cards are compact. Create and voice stay one tap above the tabs. Suggestions sits behind the schedule menu. From 768px the desktop chrome is unchanged.

Ask if the code does not show it: which desktop actions are missing on the phone, besides the §32 list (see today, create or speak, mark done, check in a habit).

## PWA reminders

Slug: `reminders`. Archive, Extras. API `/reminders`.

Docs say reminders are off by default. Web Push sends one notice in the half hour before a timed block, the same window for a habit that has a clock time, and one shared notice before wake for habits without a block. Checked habits are skipped. All-day events are skipped. A start that has already passed is not sent when the free API wakes up. iPhone needs Add to Home Screen first. `POST /reminders/tick` runs about every 30 minutes.

Ask if the code does not show it: one notice per block or one bundled notice, and whether a snoozed or skipped occurrence still notifies.
