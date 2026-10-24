# Roadmap archive

Shipped work, moved out of [roadmap](roadmap.md). The live queue is **§23.4+** voice understanding (live create-eval fix loop) → **§24** personal PC / Piper. Product behavior: [overview](overview.md).

On 11 Oct 2026 the checked live-queue items left [roadmap](roadmap.md): scheduling redesign §1–§8, habits §9–§10, problematic slot pick §11, incremental placement §12, Unscheduled §13, calendar/edit delete §14, Voice Agent §15–§19, and Later polish (UI language, voice habit check-in, problematic sheet). Former open §20–§21 were folded into the Oct rebuild (§22–§24). Behavior notes are the bullets below.

## Status when archived

Personal daily driver. Core MVP, intelligent scheduling, the daily loop, setup controls, and the extras below are in.

Sign-in is **Google only**. Password register, login, reset, and email verification are gone; those routes only redirect.

Quality in CI: API E2E and Playwright waves 0–7 ([e2e-test-coverage](e2e-test-coverage.md)). Each route screen is its own lazy chunk (`splitChunks`); production is no longer one `bundle.js`.

## Shipped (Oct 2026)

- [x] **Select a time to create a task.** On the day and week grids, a mouse or trackpad drag on empty space highlights a 15-minute range in that column and opens a fixed task for that start and end. Escape cancels. A click without a drag still creates a task for the civil day. Touch scrolling does not start a selection.
- [x] **Current time line.** Day and week grids draw a red line on today’s column at the current minute, when that minute is inside the visible personal day. The line updates about every 30 seconds. Week view shows the clock on that line. Day view shows it on the time scale.

- [x] **§33 Calendar layout.** A timed card of at least 30 minutes keeps its own height. On a half-hour card the chips and title are scaled down so both rows fit. Shorter cards are one line with the title and open a slightly taller stack on hover or focus. Each hour band shows its number on the background, blurred under a 30% black veil. The hour grid stays on the fixed personal-day scale. The week event list is removed.

- [x] **§35 Event preview content.** A calendar click opens a grouped sheet: title, time, and chips, then only the fields that have a value (links, place, when, people, task, details) for Google, Outlook, iCloud, and app tasks. http(s) links open in a new tab. Notes render as sanitized HTML when the provider sent HTML, otherwise as plain text with links. Edit, Delete, and Done stay on the sheet.

- [x] **Fast create.** Companion panel switch: Companion (dialogue) or Fast create. Fast create builds a new task from one phrase and asks at most once, only when there is no name or the span cannot be stored both as the event length and as the window. Other writes, questions, and day plans stay on the Companion rules. Preview and Apply stay. Choice is kept in the browser and sent as `mode` on `POST /voice/turn`. See [spec-voice-agent.md](spec-voice-agent.md) §6.8.

- [x] **Companion multi-intent + day-plan dialogue.** The planner splits one utterance into up to 6 text segments (writes + Q&A); each goes through the router and the specialist, and the batch gets one confirm. After Apply the client reports per-intent statuses (`actionId: 'report'`) and the panel shows **Done just now** cards. "Plan my day" keeps the interview open until Apply, with no question cap, seats Unscheduled, new and flexible tasks via an engine dry-run (`previewSequence`), and accepts voice edits that mark changed cards before Apply. Old greedy packer and regex heuristics removed. Current planner chain and when-rules: [spec-voice-agent.md](spec-voice-agent.md) §6.1, §6.4.

- [x] **Companion panel UI.** Renamed Voice → Companion / Помічник. Desktop floating movable/resizable panel over the calendar; phone keeps the bottom sheet. Confirm / day-plan use calendar-style preview cards; footer actions decluttered (Apply + Cancel on confirm). Docs: [features/companion-panel.md](features/companion-panel.md).

- [x] **Habits soft-disabled for MVP.** No nav/route/UI, no schedule busy, no habit push reminders, no voice `habit_*` commands. `GET /habits` returns an empty list (no Google backfill); writes return 410. Module code and DB rows kept; existing Google habit events left as-is.

- [x] **§30 Delete account.** Settings → two-step confirm (calendar cleanup warning, then type `DELETE` or email). `DELETE /auth/account` removes app-created Google events and the dedicated app calendar first (fail closed on Google errors), then wipes local user data and identities. `GET /auth/me` returns the email for the confirm UI.

- [x] **§29 Type in the voice sheet.** Composer under the thread sends text through the same `POST /voice/turn` path as speech (no STT). Mic on/off toggle (default on): when on, auto-listen continues; when off, listening stops and typed turns still work. Send while listening cancels the recording and submits the typed message.

- [x] **§28 Unscheduled strip exit + recurring keep seats.** Calendar **Now / Next / Unscheduled** cards share soft-tint columns, kind icons, shadows, and hover; Unscheduled is a scrollable list with Done / Skip / Do now / Schedule / Edit (Tasks inbox uses **Edit**, not Open). Card click opens the same event preview (inbox via `local-task:`). Preview has **Done** for one-off app tasks. Recurring horizon rewrite no longer deletes open seats before a successful plan; if rewrite seats zero days but open seats remain, the series is kept. Duration-only recurring edits use `commit: keep` + extend.

- [x] **§27 Multi-calendar + type/calendar chips.** Google, Microsoft (OAuth when `MICROSOFT_*` is set), and Apple (Settings CalDAV) share `CalendarProvider`. Placement, the engine, the Problematic slot picker, reminders, suggestions, and voice treat timed events on every visible connected calendar as busy (hidden, cancelled, and free events are not; the app’s own synced copies are not counted twice). Thin `calendar_event_overlays` for fixed/flexible on external events; Unscheduled deletes the external event and creates an inbox task. Automatic placement does not move those external events. Icon type + provider logo on calendar chips; visibility filter uses provider sections. Settings: connect Microsoft/Apple. `user_identities` + link/disconnect API. App-task writes still go to Google; stored `syncTargetCalendars` is not read by the writer yet. Docs: [integrations](integrations.md).

- [x] **§26 Event preview.** A calendar block click opens a read-only preview (title, time, description, location, recurrence) for app tasks and Google-only events. Edit and Delete live on the preview; repeating items use a this-day / following / entire-series menu on both. Chip X and list Delete stay as shortcuts. Opening Edit from the preview hides Delete/Skip on the form.

- [x] **§25 Voice key rotation + daily token cap.** Live API discovers `GROQ_API_KEY` + `GROQ_API_KEY_N` (any count) and rotates on TPM/TPD when two or more are set; one voice session pins one key (STT + turn). Per-user chat-token ceiling per civil day (default 100000, `VOICE_DAILY_TOKEN_LIMIT`); exhausted → `VOICE_QUOTA_EXCEEDED` in the sheet only when hit.

- [x] **First-run wake/sleep, then phases.** After Google sign-in, a user with no phases stays on `/setup/phases` with no app nav. Wake and sleep are saved first. Then they pick a day shape or skip to Sleep + Focus. `googleCalendarLinked` is set by that same sign-in, not by a second connect step.

- [x] **Lifestyle presets tile the awake day.** Working adds Work between Meetings and Life admin. Student Study fills from the end of Classes until Free time. Open was already contiguous. Blocks under 30 minutes are still dropped.

- [x] **§23.3 Live Groq create-eval harness (~50).** Was an opt-in `parseTask` run. **Removed:** it skipped the planner. Live voice tests are the planner dialogue corpus.

- [x] **§23.2 Golden harness + create kind/when baseline.** Table fixtures without live LLM for all six `kind-when` branches (+ event-span fixed example): frozen specialist JSON → `normalizeVoiceParse` + harvest `kind`. Prompt stays aligned with `CREATE_KIND_WHEN_MODULE` examples. Files: `voice-create-kind-when.goldens.ts` / `.spec.ts`.

- [x] **§23.1 Structured voice parse logging.** Each `parseTask` (including `/voice/turn` mutate) logs one unclipped `voice.parse.result` JSON line after normalize/resolve: `parseId`, transcript, router vs final intent, sniff override, language, understanding, inferred kind / command fields, key when ISOs, clarify question. Helper: `voice-parse-result-log.util.ts`. Harvest notes in [voice-prompt-next.md](voice-prompt-next.md). Raw `[llm:parse.*]` lines unchanged for prompt debug.

- [x] **§22 Auto-scheduling trust (crowded scenarios).** Matrix **CD01–CD09** + T14/T15/T16/C01/C02 assert the live `PlacementStepService.place` path (not `engine.run` for writes). Unit: `placement-step.util.spec` + `placement-step.service.spec`. Nest: A-SCH-040–042 (create → job `conflicts` → `leave_problematic` / `move_new` / `place_on_top`; free hole; fixed vs fixed). Playwright JWT `openAs` (no Google OAuth): U-SCH-001–003 real conflict sheet + daily Done. Still **Target** / engine-only: T11 batch pass, T21/T23/T24 notify toasts, T40 overnight on placement path. Handoff was [task-scheduling-test-matrix.md](task-scheduling-test-matrix.md).

- [x] **Voice series scope.** Delete, complete, reschedule, and a field edit of a repeating task ask: this day, this day and following, or the whole series. This day skips that occurrence. This and following ends the series from that day. The whole series deletes, completes, or moves as one task. A name, priority, or phase change applies only to the whole series.

- [x] **Voice specialist prompts.** Every parse intent has a create-style prompt: JSON the resolver reads, a first-match list, and an explicit do-not-invent rule. `complete` / `skip` / `delete`, the five habit intents, and `needs_clarification` are no longer stubs. A clarification returns a question only and does not create a task.

- [x] **Default task duration setting.** Settings `defaultTaskDurationMinutes` (default 30, 5–480) is the length of a new task when none is named. The create form starts there, voice parse sends it as `defaultTaskDurationMinutes`, and `POST /tasks` uses it when the body omits duration. `defaultWorkBlockDuration` stays the focus block.

- [x] **Create kind decision tree.** The create prompt picks kind in a fixed order (recurring, then a concrete clock, a soft clock, a placement window, a day, otherwise Unscheduled). A span that is the event itself sets duration; a span that is when to do the work is a window. One question when the length is missing on a clearly long task, or when those two spans are easy to mix up. Default length is the duration number in the prompt.

- [x] **Voice update + reschedule prompts.** Update specialist sends only changed task fields (`command.newName` for a rename, `phaseId` from the phase list) and does not write a placement. Reschedule only seats the task: a clock is a move, a day with no clock runs from Wake to Sleep, “do now” uses now. Confirm and placement stay on the existing resolver.

- [x] **Create prompt modules + wake-day after sleep.** The create specialist is one LLM call assembled from `prompt-modules/` (schema, kind-when, recurring, phase, name-language). Spoken today/tomorrow follow sleep: after sleep the civil date is today even before wake, so “завтра” at 03:00 is the next civil day. The previous wake-day continues only before an overnight sleep.

- [x] **Voice Agent (hybrid).** `POST /voice/turn` + in-memory session; read tools for grounded Q&A; write intents (create/command) executed on the client through existing APIs; day-plan propose → confirm → sequential window applies; hero sheet (thread, silence end-of-speech, skip speak / dismiss, polished audio visual). Parse is router → per-intent specialist (create full; others stubs); no-when → Unscheduled; placement respects `earliestStartTime`. Next prompt work: [voice-prompt-next.md](voice-prompt-next.md). Contract: [spec-voice-agent.md](spec-voice-agent.md).

- [x] **TaskForm / Problematic / conflict polish.** Preferred-start `<select>` lists only in-phase times (overnight included) and clears when a phase change leaves the time out of range. Unscheduled preset restored on create/edit. Problematic Place on top keeps per-row busy; resolve invents a default slot when none exists. Conflict sheet offers `place_on_top` (second layer on the preferred interval).
- [x] **UX polish backlog (toasts, Problematic, phases, JWT, series UI).** Task mutations use only the staged progress toast. Skip/delete of Problematic park copies clears the inbox (and deleting a series cascades park copies). TaskForm phase picker is clickable chips. Completed/canceled Unscheduled stay off Tasks and Calendar. Axios 401 refresh covers schedule polls/`move-event`. One-off re-merge into a series skips patching the deleted Google event. Series groups show a full task card for the primary member with nested parts below.

- [x] **Calendar cards / Now / voice polish.** Timed cards show title only, thinner resize handles, hover delete; recurring delete asks this day / this+following / entire series (`end-series-from`). Completed tasks stay on the calendar (Google sync keeps the event). Slotted habits toggle check-in on the grid and appear in Now/Next. Voice sheet auto-starts recording (no Start button).

- [x] **Incremental placement: data.** `scheduleState` (`none` | `problematic` | `resolved`) replaces `isProblematic`. A parked copy can store reason, civil day, original interval, and parent series id. `syncGoogleDeletions` defaults off (not applied yet). Failed Google writes have a `pending_google_writes` table; the retry worker is still later. The engine still full-replans.

- [x] **Incremental placement: one step.** `PlacementStepService.place` seats the claimant and only the overlapped days (one-off shifts, series day becomes a non-recurring copy, chain only when everyone fits, `resolved` stays). It does not call `engine.run`. Create and edit still enqueue a full replan.

- [x] **Incremental placement: stop full replan on small edits.** Create and geometric edit call `place`. A new series also writes its other horizon days at that clock. Cosmetic save updates the task and the same Google event. Drag, skip, delete, complete, and cancel do not enqueue `full_replan`. A freed hole seats fitting problematic tasks, oldest first. Generate and `POST /schedule-jobs/replan` still use `engine.run`. Series drag does not yet ask this day versus the whole series.

- [x] **Incremental placement: series drag.** Dragging a series day asks this day or the whole series. This day skips that occurrence and creates a one-off at the new time. The whole series ends the old series before that day and starts a new recurring task at the new clock. Earlier occurrences stay. Google series split is still later.

- [x] **Incremental placement: inboxes and resolved.** Create/preferred against an anchor returns `conflicts[]` for the shared sheet; dismiss / `leave_problematic` parks the claimant. Resolve sets `resolved` and reseats the original interval as a second layer. Skip from Problematic skips the parent series day then deletes the copy. Voice with enough fields creates through normal placement (including cancel during clarification).

- [x] **Incremental placement: Google.** Seated local writes sync to Google; failures go to `pending_google_writes` and retry in the background. A newer Google edit of time/title/description drops the pending row and pulls into the task. No slot means no Google event. The hourly tick appends missing series days via placement and purges past problematic copies. `syncGoogleDeletions` (default off) deletes the local task when a linked Google event is gone.

- [x] **Incremental placement: remove Generate / Clear / Undo.** Calendar Review, preview, Clear, and Undo are gone. `POST /schedule/generate`, preview, clear, undo, and `POST /schedule-jobs/replan` are removed. Leftover jobs fail without calling `engine.run`. Horizon append stays on the hourly placement tick.

- [x] **Unscheduled richer cards.** Tasks inbox cards use icon-only actions and icon meta for phase / earliest / deadline with a clear overdue state. No unscheduled-reason field; duration stays off Unscheduled cards.

- [x] **§13 Unscheduled Schedule + discoverability.** Inbox **Schedule** opens the schedule form (full constraints). Calendar shows an Unscheduled banner that navigates to Tasks.

- [x] **§14 Edit-modal delete.** TaskForm Delete matches calendar scopes when an occurrence is open; without occurrence, one-off or entire-series confirm only. `SeriesDeleteHost` lives with the task editor.

- [x] **Recurring per-day slots + series group.** Expand searches a slot each civil day (preferred, else hole that day). Divergent clocks split into same-`seriesGroupId` series/one-offs (group-by-clock). Detached members re-merge when they land on a sibling series clock; editing name/description/etc. clears membership permanently. Spec: [spec-incremental-placement.md](spec-incremental-placement.md) §7.
- [x] **Series-horizon harden.** Recurring claim does not shift other series masters (flexibles only); shifted peers keep home clock / interior-gap pack; Google RRULE DTSTART uses majority local clock among open seats (not chronological `open[0]`).

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

- [x] **AI schedule recommendations.** ~~Calendar → Schedule → **Suggestions**~~ — later removed with the Schedule menu and `POST /schedule/recommendations`.
- [x] **PWA reminders.** Settings opt-in (off by default). Web Push once in the half hour before each timed Now/Next block, the same window for a habit with a clock time, and one wake-time note for habits without a block. Already checked habits stay quiet. `POST /reminders/tick` about every 30 minutes wakes the free API. A start that already passed is not sent. iPhone needs Add to Home Screen.
- [x] **Voice beyond create.** The same mic completes, skips, or reschedules the current or named task (uk/en/ru). Done on a series skips today's occurrence. An open slot moves like a drag; no slot updates the window and replans. One question, then a refusal. Settings **Ask before voice commands** (off by default) confirms first. Create stays immediate.
- [x] **Search / filters on tasks.** Tasks page only, client-side, and the two sections do not share controls. **Unscheduled:** name search, status, overdue. **Scheduled:** name search, status, phase, schedule type, overdue, and sort. Filters combine. Overdue means a past deadline on a task that is not completed or canceled.
- [x] **Tasks series grouping.** Tasks that share `seriesGroupId` show as one collapsible group with nested Series / One-off / Problematic rows. Recurring filter includes group members. Actions stay per member.
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
