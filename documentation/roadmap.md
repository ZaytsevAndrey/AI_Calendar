# Roadmap

This reflects the **actual** codebase as of the last update (September 2026). Implementation details: [overview](overview.md) and the repository.

## Current status

**Core product MVP** (user, settings, phases, tasks, Google Calendar, UI) is **done**.

**Intelligent scheduling** (see [spec-intelligent-scheduling](spec-intelligent-scheduling.md)) is **implemented**: job queue, engine with phase windows and anchors, diff, Google sync after replan, frontend summary on Schedule. Replan and Clear keep **fully ended** app-generated events; the Calendar page shows those past app events in gray and a generation timeline while the job runs.

## Phases

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
- [ ] Further heuristics (e.g. deeper multi-task optimization), analytics  

### Phase 5 — Advanced product (planned)

- [x] Voice task creation (PWA mic → Groq Whisper → LLM parse → create / prefill / one clarifying question)  
- [x] Installable PWA (manifest, icons, service worker, Add to Home Screen)  
- [ ] Drag & drop on schedule / event calendars  
- [x] Habit tracker: daily yes/no check-in (e.g. exercise, no smoking), streaks, and simple points  
- [ ] Phase lifestyle presets: apply a ready-made day-phase set instead of only default Sleep / Focus hours. First catalog: **working person**, **student / learner**, **unemployed**; more presets later  
- [ ] Choose which Google calendars are visible on the Calendar page  
- [ ] Statistics and dashboard  
- [ ] Integrations (Telegram, Notion, etc.)  
- [ ] Mobile / desktop clients if needed  
- [ ] Optional: auto-sync default Sleep/Focus phase times when only wake/sleep settings change  

### Phase 6 — Testing & optimization (partial)

- [x] Jest tests on the backend (`backend/test/`, module `*.spec.ts`)  
- [x] GitHub Actions CI (tests, production build) on `develop` / `master`  
- [x] Free production deploy: Render + Neon ([deploy](deploy.md))  
- [ ] Systematic coverage increase  
- [ ] E2E for critical flows  
- [ ] Frontend bundle optimization (currently one large `bundle.js`) and API performance  

## Recommended next steps

1. Phase lifestyle presets (working person, student / learner, unemployed; catalog can grow).  
2. Calendar visibility: pick which Google calendars to show.  
3. Drag-and-drop and calendar polish.  
4. Expand tests.  
5. Optional: attach a custom subdomain (see [deploy](deploy.md)).  
6. Update this file when scope changes.
