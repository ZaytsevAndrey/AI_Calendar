# Roadmap

This reflects the **actual** codebase as of the last update (September 2026). Implementation details: [overview](overview.md) and the repository.

## Current status

**Core product MVP** (user, settings, phases, tasks, Google Calendar, UI) is **done**.

**Intelligent scheduling** (see [spec-intelligent-scheduling](spec-intelligent-scheduling.md)) is **implemented**: job queue, engine with phase windows and anchors, diff, Google sync after replan, frontend summary on Schedule. Replan and Clear keep **fully ended** app-generated events; the Calendar page shows those past app events in gray and a generation timeline while the job runs.

## How we prioritize (Sep 2026)

Personal daily driver, not a feature dump. Order:

1. **Trust the capture path** — a wrong task form or voice create poisons Generate.
2. **Daily loop** — know what to do now; recover when Generate is wrong.
3. **Setup & control** — cheaper phase setup, calendar chrome.
4. **Later** — extra AI, integrations, cosmetics, in-app guide.

Two lists used to compete (`roadmap` vs `BUGS-AND-IMPROVEMENTS.md`). This file is the queue. Chat-dump items from that file are filed under Later polish.

## Now — this cycle

- [x] **Audit task create/edit** (Sep 2026). Form create/edit uses Settings IANA for From/Until, preferred start, and fixed slots; payload no longer writes the browser zone. Edit can clear phase (`phaseIds: []`) and deadline (`null`). Calendar day-click prefills that civil day in Settings TZ. Unchecking Fixed restores Allow split. No unused fields found to remove.
- [x] **Voice create vs form** (Sep 2026). Immediate create when a name exists (defaults: 30 min, medium, no phase). Day-only without a clock is allowed. Missing name asks one question; never a second. Client sends Settings IANA `timeZone` on parse.

## Next — daily loop

- [x] **Today / Now** (Sep 2026). Strip on Calendar (home stays `/`): current overlapping block, next start today, unscheduled inbox for today by priority. External Google events appear in Now/Next without Done. One-tap Done completes a non-recurring app task; Skip drops one still-open slot or recurring instance. After create/update the client polls the silent-replan `jobId` and refreshes Now / calendar (no WebSockets).
- [x] **Habit check-ins** (Sep 2026). Last 14 days can be marked or cleared. Habits page is a day grid. Month and week show dots; day view and a day dialog toggle that day. Now strip is today only. Optional daily time block keeps that clock time free in Generate, is drawn on the calendar, and is created in Google Calendar when it is connected (not a task).
- [x] **Unscheduled inbox** (Sep 2026). First-class `isUnscheduled` tasks on the Tasks page: no Google sync, excluded from Generate/replan, Done or Schedule. Optional deadline highlighting. TaskForm expandable Google event options (location, color, visibility, show-as, reminders) persist and apply on later sync. App-generated calendar clicks open TaskForm; native Google events still use EventForm.
- [x] **Undo last generate** (Sep 2026). Calendar **Generate** stores a single snapshot (local auto slots + Google ids). **Undo last generate** restores still-open blocks and Google; fully ended blocks stay. Silent replan after task save is not undoable. Clear still cannot be undone and drops the snapshot. Non-recurring Generate no longer re-places minutes that already finished.
- [x] **Skip this occurrence** (Sep 2026). One still-open slot or recurring instance without completing the task or deleting the series. Recurring skips persist (Generate will not recreate that civil day). One-off skip drops the placement; the next Generate can place remaining work. Snooze is later. UI: Now/Next Skip plus Skip on TaskForm when opened from a calendar instance.
- [x] **Generate preview / overload warning** (Sep 2026). Schedule → Generate opens a dialog first: tasks that would move, engine errors when work cannot fit, and horizon warnings. Apply runs Generate. Cancel writes nothing. Silent replan after a task save stays immediate.

## Then — setup & control

- [x] Phase lifestyle presets (Sep 2026). On first setup and later from Phases: **working person**, **student / learner**, **open day**. Hours are offsets from wake/sleep; blocks shorter than 30 minutes are dropped. Replaces every phase, including Sleep and hidden Focus. Refuses while any phase has tasks. Skip on setup still creates Sleep + Focus only.
- [x] Choose which Google calendars are visible on the Calendar page (Sep 2026). **Calendars** on Calendar hides Google calendars from the grid and Now. Default stays primary + app calendar + calendars selected in Google. The app calendar stays visible. Generate busy time is unchanged (primary + app calendar).
- [x] Drag & drop on the Calendar day and week time grids (Sep 2026). Drag the block to move it, or its top/bottom edge to resize, in 15-minute steps. The new time is saved on that occurrence and in Google. Month stays click-to-open. Habit blocks are not draggable. A flexible slot can be placed again by the next Generate.

## Later

Product extras (ship only if the loop above is trustworthy):

- [x] **AI schedule recommendations** (Sep 2026). Calendar → Schedule → **Suggestions** asks Groq for up to five notes on the next 7 days (overload, gap, phase mismatch, deadline risk). Nothing is saved or applied. An empty calendar skips the model. A Google outage still returns suggestions from local tasks.
- [x] **PWA reminders** (Sep 2026). Settings opt-in (off by default). Web Push once in the half hour before each timed Now/Next block, the same window for a habit with a clock time, and one wake-time note for habits without a block. Already checked habits stay quiet. `POST /reminders/tick` about every 30 minutes wakes the free API and lets it sleep between calls. A start that already passed is not sent. iPhone needs Add to Home Screen.
- [x] **Voice beyond create** (Sep 2026). The same mic completes, skips, or reschedules the current or named task (uk/en/ru). Done on a series skips today's occurrence. An open slot moves like a drag; no slot updates the window and replans. One question, then a refusal. Settings **Ask before voice commands** (off by default) confirms first. Create stays immediate.
- [ ] **Search / filters on tasks** — name, status, phase, fixed vs flexible, overdue.
- [ ] **Soft buffers** between fixed events (travel / reset minutes the engine must not fill).
- [ ] **Daily briefing** — morning summary in-app (later Telegram): today, risks, overdue.
- [ ] **UI language (uk / en)** — voice already understands uk/en/ru; the chrome is English-only.
- [ ] Statistics and dashboard.
- [ ] Integrations (Telegram, Notion, etc.).
- [ ] Mobile / desktop clients if needed.
- [ ] Optional: auto-sync default Sleep/Focus phase times when only wake/sleep settings change.
- [ ] Further scheduling heuristics (e.g. deeper multi-task optimization), analytics.

Polish parked from the chat dump (`BUGS-AND-IMPROVEMENTS.md`):

- [ ] Client-side password validation aligned with the backend.
- [ ] Remove the default “sleeping time” phase; keep wake/sleep as active-hours logic only.
- [ ] Default time range when creating a phase: start at wake (or the next free slot).
- [ ] Sidebar navigation (replace the top nav).

Quality (ongoing, not a product slice):

- [x] **End-to-end tests** — cases and waves: [e2e-test-coverage.md](e2e-test-coverage.md). Waves 0–7 (API E2E + Playwright P0–P2) are in CI. Unit tests stay for engine/voice.
- [ ] Systematic unit/integration coverage increase as flows are touched.
- [ ] Frontend bundle optimization (currently one large `bundle.js`) and API performance.
- [ ] Optional: attach a custom subdomain (see [deploy](deploy.md)).

Last, when the flows above are stable:

- [ ] **In-app product guide** — short tour / help for Calendar, tasks, phases, generate, habits, voice. Only after the flows above are stable; otherwise the guide will go stale.

## Phases (history)

### Phase 1 — Core (done)

- [x] Auth: JWT, email verification, refresh, protected routes
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

### Phase 4 — Scheduling engine (done — iterative improvements possible)

- [x] Intelligent engine: priority, FIFO tie-break, phase window, wake/sleep, weekends, split, weekday filter, displacement within priority tier
- [x] Durable From/Until window (`earliestStartTime` + `deadline` + `eligibleWeekDays`); wake/sleep/phases/horizon in settings IANA `timeZone` (not the Node host clock); day-only 00:00 snaps to wake (Postgres `HH:mm:ss` normalized)
- [x] `/schedule` API + async generate (job) + clear (ended slots kept; only still-open blocks are removed)
- [x] Schedule jobs: replan, latest done, poll by id, staged progress (`preparing` / `computing` / `syncing_google`)
- [x] Keep fully ended app-generated events on regenerate; recurring Google series split (`UNTIL` + new series)

### Phase 5 — Advanced product (partial)

- [x] Voice task creation (PWA mic → Groq Whisper → LLM parse → create / prefill / one clarifying question). The same mic can complete, skip, or reschedule an existing task.
- [x] Installable PWA (manifest, icons, service worker, Add to Home Screen)
- [x] Habit tracker: daily yes/no check-in (e.g. exercise, no smoking), streaks, and simple points

Open Phase 5 items live in **Now / Next / Then / Later** above.

### Phase 6 — Testing & optimization (partial)

- [x] Jest tests on the backend (`backend/test/`, module `*.spec.ts`)
- [x] GitHub Actions CI (tests, production build) on `develop` / `master`
- [x] Free production deploy: Render + Neon ([deploy](deploy.md))

## Recommended next steps

1. Later extras (search/filters, soft buffers, daily briefing, stats, integrations, parked polish).
2. Add Playwright (or similar) **E2E** for voice create, Done vs calendar, Generate/Undo; expand unit tests as you touch flows; optional custom subdomain (see [deploy](deploy.md)).
3. **Last:** in-app product guide, once the app is ready.
4. Update this file when scope changes.
