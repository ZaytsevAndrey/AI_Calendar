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

- [x] **Today / Now** (Sep 2026). Strip on Calendar (home stays `/`): current overlapping block, next start today, unscheduled inbox for today by priority. External Google events appear in Now/Next without Done. One-tap Done completes a non-recurring app task; recurring has no Done (skip occurrence is later). Compact habit Today/Yesterday check-ins; no habit CRUD here.
- [x] **Undo last generate** (Sep 2026). Calendar **Generate** stores a single snapshot (local auto slots + Google ids). **Undo last generate** restores still-open blocks and Google; fully ended blocks stay. Silent replan after task save is not undoable. Clear still cannot be undone and drops the snapshot. Non-recurring Generate no longer re-places minutes that already finished.
- [ ] **Skip / snooze this occurrence** — one slot or one recurring instance without deleting the series.
- [ ] **Generate preview / overload warning** — show what will move and if the window cannot fit work *before* applying.

## Then — setup & control

- [ ] Phase lifestyle presets: apply a ready-made day-phase set instead of only default Sleep / Focus hours. First catalog: **working person**, **student / learner**, **unemployed**; more presets later.
- [ ] **Text add (same parser as voice)** — type “gym tomorrow 45 min” without the mic; reuse Groq parse + the same create/prefill/clarify routing.
- [ ] Choose which Google calendars are visible on the Calendar page.
- [ ] Drag & drop on schedule / event calendars.

## Later

Product extras (ship only if the loop above is trustworthy):

- [ ] AI schedule recommendations: LLM analyzes the user's schedule (tasks, phases, calendar load) and suggests concrete improvements (overload, gaps, phase mismatch, deadline risk). Reuse Groq like voice parse; suggestions only — no auto-apply until a later iteration.
- [ ] **PWA reminders** — upcoming block + daily habit check-in (Web Push; no native app required).
- [ ] **Voice beyond create** — complete, skip, or reschedule the current / named task by voice.
- [ ] **Habit time blocks** — optional scheduled slot for a habit (today habits are check-ins only, off the engine).
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

- [ ] **End-to-end tests** for critical flows (Playwright or similar): voice create → Unscheduled / Generate; Done must not create a calendar event; Generate + Undo; login. Unit tests stay for engine/voice; E2E is still missing.
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

- [x] Voice task creation (PWA mic → Groq Whisper → LLM parse → create / prefill / one clarifying question)
- [x] Installable PWA (manifest, icons, service worker, Add to Home Screen)
- [x] Habit tracker: daily yes/no check-in (e.g. exercise, no smoking), streaks, and simple points

Open Phase 5 items live in **Now / Next / Then / Later** above.

### Phase 6 — Testing & optimization (partial)

- [x] Jest tests on the backend (`backend/test/`, module `*.spec.ts`)
- [x] GitHub Actions CI (tests, production build) on `develop` / `master`
- [x] Free production deploy: Render + Neon ([deploy](deploy.md))

## Recommended next steps

1. Skip / snooze this occurrence; then generate preview.
2. Phase lifestyle presets; text add; Google calendar visibility; drag-and-drop.
3. Later extras (AI recommendations, reminders, stats, integrations, parked polish).
4. Add Playwright (or similar) **E2E** for voice create, Done vs calendar, Generate/Undo; expand unit tests as you touch flows; optional custom subdomain (see [deploy](deploy.md)).
5. **Last:** in-app product guide, once the app is ready.
6. Update this file when scope changes.
