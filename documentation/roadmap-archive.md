# Roadmap archive

Shipped work, moved out of [roadmap](roadmap.md) in September 2026. The live queue is only what is still open. Product behavior: [overview](overview.md).

## Status when archived

Personal daily driver. Core MVP, intelligent scheduling, the daily loop, setup controls, and the extras below are in.

Sign-in is **Google only**. Password register, login, reset, and email verification are gone; those routes only redirect.

Quality in CI: API E2E and Playwright waves 0–7 ([e2e-test-coverage](e2e-test-coverage.md)). Each route screen is its own lazy chunk (`splitChunks`); production is no longer one `bundle.js`.

## Shipped (Oct 2026)

- [x] **Calendar cards / Now / voice polish.** Timed cards show title only, thinner resize handles, hover delete; recurring delete asks this day / this+following / entire series (`end-series-from`). Completed tasks stay on the calendar (Google sync keeps the event). Slotted habits toggle check-in on the grid and appear in Now/Next. Voice sheet auto-starts recording (no Start button).

- [x] **Incremental placement: data.** `scheduleState` (`none` | `problematic` | `resolved`) replaces `isProblematic`. A parked copy can store reason, civil day, original interval, and parent series id. `syncGoogleDeletions` defaults off (not applied yet). Failed Google writes have a `pending_google_writes` table; the retry worker is still later. The engine still full-replans.

- [x] **Incremental placement: one step.** `PlacementStepService.place` seats the claimant and only the overlapped days (one-off shifts, series day becomes a non-recurring copy, chain only when everyone fits, `resolved` stays). It does not call `engine.run`. Create and edit still enqueue a full replan.

- [x] **Incremental placement: stop full replan on small edits.** Create and geometric edit call `place`. A new series also writes its other horizon days at that clock. Cosmetic save updates the task and the same Google event. Drag, skip, delete, complete, and cancel do not enqueue `full_replan`. A freed hole seats fitting problematic tasks, oldest first. Generate and `POST /schedule-jobs/replan` still use `engine.run`. Series drag does not yet ask this day versus the whole series.

- [x] **Incremental placement: series drag.** Dragging a series day asks this day or the whole series. This day skips that occurrence and creates a one-off at the new time. The whole series ends the old series before that day and starts a new recurring task at the new clock. Earlier occurrences stay. Google series split is still later.

- [x] **Incremental placement: inboxes and resolved.** Create/preferred against an anchor returns `conflicts[]` for the shared sheet; dismiss / `leave_problematic` parks the claimant. Resolve sets `resolved` and reseats the original interval as a second layer. Skip from Problematic skips the parent series day then deletes the copy. Voice with enough fields creates through normal placement (including cancel during clarification).

- [x] **Incremental placement: Google.** Seated local writes sync to Google; failures go to `pending_google_writes` and retry in the background. A newer Google edit of time/title/description drops the pending row and pulls into the task. No slot means no Google event. The hourly tick appends missing series days via placement and purges past problematic copies. `syncGoogleDeletions` (default off) deletes the local task when a linked Google event is gone.

- [x] **Incremental placement: remove Generate / Clear / Undo.** Calendar Review, preview, Clear, and Undo are gone. `POST /schedule/generate`, preview, clear, undo, and `POST /schedule-jobs/replan` are removed. Leftover jobs fail without calling `engine.run`. Horizon append stays on the hourly placement tick.

- [x] **Unscheduled richer cards.** Tasks inbox cards use icon-only actions and icon meta for phase / earliest / deadline with a clear overdue state. No unscheduled-reason field; duration stays off Unscheduled cards. Schedule pick and Calendar chip are still open.

- [x] **Recurring per-day slots + series group.** Expand searches a slot each civil day (preferred, else hole that day). Divergent clocks split into same-`seriesGroupId` series/one-offs (group-by-clock). Detached members re-merge when they land on a sibling series clock; editing name/description/etc. clears membership permanently. Spec: [spec-incremental-placement.md](spec-incremental-placement.md) §7.

## Shipped (Sep 2026)

### Scheduling redesign (engine)

- [x] **Voice Commander.** Full task/habit CRUD by voice (update/delete/reopen; habit create/update/delete/uncheck), Web Speech Speak replies + `speakVoiceReplies`, mic equalizer while Listening, always-confirm delete/cancel/habit_delete. Contract: [spec-voice-commander.md](spec-voice-commander.md).

- [x] **Problematic Move: visual free-slot pick.** `GET /schedule/free-slots` returns phase gaps + 15‑min candidates; Move sheet is a snap-scrolling day timeline (ghost block) for recurring one-offs and non-recurring place-in-place. Replaces the bare time input.

- [x] **Problematic sheet polish.** Info cards (name, phase, duration, overflow day + reason); one-word Skip / Move / Edit / Resolve; Move used a compact place-at-time sheet until §11 visual pick.

- [x] **Voice habit check-in.** Parse intent `habit_check_in` (check in / відмітив звичку); match habit by name for today in settings TZ; “done” that only matches a habit also checks in. Client applies via existing `POST /habits/:id/check-ins`.

- [x] **UI language (uk / en).** Settings `language` drives chrome and user-visible dates (calendar week strip, habit day labels, toast when-lines, event times); voice was already multilingual.

- [x] **Habits: AI streak tips.** On streak 3/7/30/100 unlock, Groq one-liner from habit name/description (settings language; light safety); template fallback if Groq is down; tip stored and shown under streak + in check-in toast.

- [x] **Habits: achievements.** Per-habit catalog (`first_check_in`, streak 3/7/30/100, `clean_week`) with persisted `unlockedAt`, one-time toast via `newlyUnlocked`, badges on Habits; points/streaks unchanged.

- [x] **Recurring extend; shrink Generate.** Hourly background tick enqueues `extend_recurring` (same placement as silent replan) for users with active recurring tasks on a ~20h cooldown, so series stay alive without Generate. Calendar “Review schedule” is cleanup/preview copy; Apply still runs a full rewrite when you ask.

- [x] **Unscheduled actions.** Inbox cards: Done / Skip (cancel) / Do now (from-now window + replan) / Open. Generate/replan parks deadline-no-fit via `readyForUnscheduled` (not Problematic). Voice skip on unscheduled → cancel; do now already aligned.

- [x] **Drag → day / phase replan.** `POST /schedule/move-event` enqueues silent replan for app fixed/slot moves (`jobId`); client polls and opens the shared conflict sheet. Recurring instance drag (and engine `RECURRING_MOVED`) show a toast. External Google-only moves stay write-only. Full replan for now (engine keeps seated flexibles); tighter day/phase scoping can follow.

- [x] **Voice on the same decision layer.** Create/window after voice waits for replan `conflicts[]` and opens the shared sheet (`needs_conflict_choice`); spoken option ids or tap apply via existing APIs. Unscheduled: done works; skip still refuses; **do now** → from-now window + `clearUnscheduled`. Unit + P1 e2e (`U-VOI-007`).

- [x] **Shared conflict options sheet.** Job `conflicts[]` opens one Modal (create replan + Generate); Groq phrases option ids via `POST /schedule/conflict-option-phrases` with i18n fallback; apply uses PATCH / skip. Dismiss → Problematic. Drag still reuses `openConflictChoice` (§6).

- [x] **Problematic inbox.** Distinct `isProblematic` flag (not `isUnscheduled`). Generate/replan parks capacity overflow; Calendar banner + sheet (Open / Move / Skip / Resolve). Conflict choice no longer auto-parks until dismiss / leave_problematic (§4).

- [x] **Engine: type + preferred, no priority.** `IntelligentSchedulingEngine` places by createdAt FIFO + preferred-first; priority ignored. Seated flexible keeps its slot; preferred on fixed/Google returns `NEEDS_CONFLICT_CHOICE` + option ids; recurring off-preferred emits `RECURRING_MOVED`; capacity overflow warnings carry `readyForProblematic` (inbox lands in §3).

### Scheduling redesign (docs)

- [x] **Conflict rules spec + test matrix.** Product contract in [spec-conflict-rules.md](spec-conflict-rules.md): type + preferred (no priority bump), seated flexible stays, ask on fixed-vs-fixed and preferred-on-fixed, Unscheduled ≠ Problematic, no-reply → Problematic. [task-scheduling-test-matrix.md](task-scheduling-test-matrix.md) rewritten for those rules; intelligent-scheduling placement sections defer to the conflict spec.

### Phone shell

- [x] **Adaptive phone layout.** Below 768px: bottom tab bar, day-first calendar, week as a day strip, month as day dots, events as a sheet, compact task cards with pills, and one-tap Create / Voice / Generate above the tabs. From 768px the desktop chrome is unchanged.

### Capture

- [x] **Audit task create/edit.** Form create/edit uses Settings IANA for From/Until, preferred start, and fixed slots; payload no longer writes the browser zone. Edit can clear phase (`phaseIds: []`) and deadline (`null`). Calendar day-click prefills that civil day in Settings TZ. Unchecking Fixed restores Allow split.
- [x] **Voice create vs form.** Immediate create when a name exists (defaults: 30 min, medium, no phase). Day-only without a clock is allowed. Missing name asks one question; never a second. Client sends Settings IANA `timeZone` on parse.

### Daily loop

- [x] **Today / Now.** Strip on Calendar (home stays `/`): current overlapping block, next start today, unscheduled inbox for today by priority. External Google events appear in Now/Next without Done. One-tap Done completes a non-recurring app task; Skip drops one still-open slot or recurring instance. After create/update the client polls the silent-replan `jobId` and refreshes Now / calendar (no WebSockets).
- [x] **Habit check-ins.** Last 14 days can be marked or cleared. Habits page is a day grid. Month and week show dots; day view and a day dialog toggle that day. Now strip is today only. Optional daily time block keeps that clock time free in Generate, is drawn on the calendar, and is created in Google Calendar when it is connected (not a task).
- [x] **Unscheduled inbox.** First-class `isUnscheduled` tasks on the Tasks page: no Google sync, excluded from Generate/replan, Done or Schedule. Optional deadline highlighting. TaskForm expandable Google event options persist and apply on later sync. App-generated calendar clicks open TaskForm; native Google events still use EventForm.
- [x] **Undo last generate.** Calendar **Generate** stores a single snapshot (local auto slots + Google ids). **Undo last generate** restores still-open blocks and Google; fully ended blocks stay. Silent replan after task save is not undoable. Clear still cannot be undone and drops the snapshot. Non-recurring Generate no longer re-places minutes that already finished.
- [x] **Skip this occurrence.** One still-open slot or recurring instance without completing the task or deleting the series. Recurring skips persist (Generate will not recreate that civil day). One-off skip drops the placement; the next Generate can place remaining work. Snooze is not built. UI: Now/Next Skip plus Skip on TaskForm when opened from a calendar instance.
- [x] **Generate preview / overload warning.** Schedule → Generate opens a dialog first: tasks that would move, engine errors when work cannot fit, and horizon warnings. Apply runs Generate. Cancel writes nothing. Silent replan after a task save stays immediate.

### Setup

- [x] Phase lifestyle presets. On first setup and later from Phases: **working person**, **student / learner**, **open day**. Hours are offsets from wake/sleep; blocks shorter than 30 minutes are dropped. Replaces every phase, including Sleep and hidden Focus. Refuses while any phase has tasks. Skip on setup still creates Sleep + Focus only.
- [x] Choose which Google calendars are visible on the Calendar page. **Calendars** hides Google calendars from the grid and Now. Default stays primary + app calendar + calendars selected in Google. The app calendar stays visible. Generate busy time is unchanged (primary + app calendar).
- [x] Drag & drop on the Calendar day and week time grids. Drag the block to move it, or its top/bottom edge to resize, in 15-minute steps. The new time is saved on that occurrence and in Google. Month stays click-to-open. Habit blocks are not draggable. A flexible slot can be placed again by the next Generate.
- [x] **Personal day on the calendar.** Day and week grids run from wake until sleep. If sleep is 02:00, 00:00–02:00 is the end of that day, not a phase fragment at the top of the next morning. Sleep hours are hidden. Hours outside every schedulable phase are hidden; with no phases the full waking window stays. Month chips use the same day boundary.

### Extras

- [x] **AI schedule recommendations.** Calendar → Schedule → **Suggestions** asks Groq for up to five notes on the next 7 days. Nothing is saved or applied. An empty calendar skips the model. A Google outage still returns suggestions from local tasks.
- [x] **PWA reminders.** Settings opt-in (off by default). Web Push once in the half hour before each timed Now/Next block, the same window for a habit with a clock time, and one wake-time note for habits without a block. Already checked habits stay quiet. `POST /reminders/tick` about every 30 minutes wakes the free API. A start that already passed is not sent. iPhone needs Add to Home Screen.
- [x] **Voice beyond create.** The same mic completes, skips, or reschedules the current or named task (uk/en/ru). Done on a series skips today's occurrence. An open slot moves like a drag; no slot updates the window and replans. One question, then a refusal. Settings **Ask before voice commands** (off by default) confirms first. Create stays immediate.
- [x] **Search / filters on tasks.** Tasks page only, client-side, and the two sections do not share controls. **Unscheduled:** name search, status, overdue. **Scheduled:** name search, status, phase, schedule type, overdue, and sort. Filters combine. Overdue means a past deadline on a task that is not completed or canceled.
- [x] **Soft buffers.** Settings **Buffer around fixed events** (0–180 minutes, default 0). Generate keeps that gap before and after each fixed task and external Google event. Habits and ended flexible slots are not padded. The gap is used only when the task would not fit otherwise. Dragging a block can still land in it.

### Quality

- [x] **End-to-end tests.** Waves 0–7 (API E2E + Playwright P0–P2) are in CI. Unit tests stay for engine/voice.
- [x] **Frontend code splitting.** Route screens and heavy widgets are separate chunks.

## Phases (history)

### Phase 1 — Core (done)

- [x] Auth: JWT, refresh, protected routes. Email verification and password login existed here and were later removed; sign-in is Google.
- [x] User settings: wake/sleep, weekend, Google Calendar flags, split scheduling settings, IANA `timeZone` (first login fill, Settings editor)
- [x] Tasks CRUD, statuses, priorities, deadlines, one phase, fixed vs movable, recurrence + weekdays
- [x] Phases CRUD (per-user, JWT), overlap validation, default Sleep / Focus hours from settings, phase calendar
- [x] Google Calendar: OAuth, events, connect/disconnect

### Phase 2 — Phases & calendar UX (done)

- [x] Phase validation (overlaps, sleep window)
- [x] Modal forms for phases
- [x] PhasesCalendar / display with user settings
- [x] Task form: single-page, Flexible / Fixed / Recurring presets, weekday chips, preferred start

### Phase 3 — UI polish (done)

- [x] MUI, responsive layout, toast, loading / error states
- [x] Calendar page: generate with a live stage timeline; clear upcoming app-generated slots (finished ones stay, shown gray)

### Phase 4 — Scheduling engine (done)

- [x] Intelligent engine: priority, FIFO tie-break, phase window, wake/sleep, weekends, split, weekday filter, displacement within priority tier
- [x] Durable From/Until window (`earliestStartTime` + `deadline` + `eligibleWeekDays`); wake/sleep/phases/horizon in settings IANA `timeZone` (not the Node host clock); day-only 00:00 snaps to wake (Postgres `HH:mm:ss` normalized)
- [x] `/schedule` API + async generate (job) + clear (ended slots kept; only still-open blocks are removed)
- [x] Schedule jobs: replan, latest done, poll by id, staged progress (`preparing` / `computing` / `syncing_google`)
- [x] Keep fully ended app-generated events on regenerate; recurring Google series split (`UNTIL` + new series)

### Phase 5 — Advanced product (done)

- [x] Voice task creation and the same mic for complete / skip / reschedule
- [x] Installable PWA and Web Push reminders
- [x] Habit tracker: daily yes/no check-in, streaks, points, optional time block

### Phase 6 — Testing & optimization (done for what shipped)

- [x] Jest tests on the backend (`backend/test/`, module `*.spec.ts`)
- [x] GitHub Actions CI (tests, production build, E2E) on `develop` / `master`
- [x] Free production deploy: Render + Neon ([deploy](deploy.md))
- [x] Frontend route chunks
