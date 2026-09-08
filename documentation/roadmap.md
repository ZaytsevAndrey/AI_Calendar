# Roadmap

This reflects the **actual** codebase as of the last update (September 2026). Implementation details: [overview](overview.md) and the repository.

## Current status

**Core product MVP** (user, settings, phases, tasks, Google Calendar, UI) is **done**.

**Intelligent scheduling** (see [spec-intelligent-scheduling](spec-intelligent-scheduling.md)) is **implemented**: job queue, engine with phase windows and anchors, diff, Google sync after replan, frontend summary on Schedule.

## Phases

### Phase 1 — Core (done)

- [x] Auth: JWT, email verification, refresh, protected routes  
- [x] User settings: wake/sleep, weekend, Google Calendar flags, split scheduling settings  
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
- [x] Calendar page: generate; clear app-generated slots in the Settings planning horizon  

### Phase 4 — Scheduling engine (done — iterative improvements possible)

- [x] Intelligent engine: priority, FIFO tie-break, phase window, wake/sleep, weekends, split, weekday filter, displacement within priority tier  
- [x] Durable From/Until window (`earliestStartTime` + `deadline` + `eligibleWeekDays`) in the client IANA zone; day-only 00:00 snaps to wake (Postgres `HH:mm:ss` normalized)  
- [x] `/schedule` API + async generate (job) + clear  
- [x] Schedule jobs: replan, latest done, poll by id  
- [ ] Further heuristics (e.g. deeper multi-task optimization), analytics  

### Phase 5 — Advanced product (planned)

- [x] Voice task creation (PWA mic → Groq Whisper → LLM parse → create / prefill / one clarifying question)  
- [x] Installable PWA (manifest, icons, service worker, Add to Home Screen)  
- [ ] Drag & drop on schedule / event calendars  
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

1. Drag-and-drop and calendar polish.  
2. Expand tests.  
3. Optional: attach a custom subdomain (see [deploy](deploy.md)).  
4. Update this file when scope changes.
