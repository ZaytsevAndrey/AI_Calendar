# Roadmap

This reflects the **actual** codebase as of the last update (April 2026). Implementation details: [overview](overview.md) and the repository.

## Current status

**Core product MVP** (user, settings, phases, tasks, Google Calendar, UI) is **done**.

**Intelligent scheduling** (see [spec-intelligent-scheduling](spec-intelligent-scheduling.md)) is **implemented**: job queue, engine with phase windows and anchors, diff, Google sync after replan, frontend summary on Schedule.

## Phases

### Phase 1 — Core (done)

- [x] Auth: JWT, email verification, refresh, protected routes  
- [x] User settings: wake/sleep, weekend, Google Calendar flags, split scheduling settings  
- [x] Tasks CRUD, statuses, priorities, deadlines, `phaseId` / `phaseIds`, `eventType`  
- [x] Phases CRUD (per-user, JWT), overlap validation, default Sleep / Focus hours from settings, phase calendar  
- [x] Google Calendar: OAuth, events, connect/disconnect  

### Phase 2 — Phases & calendar UX (done)

- [x] Phase validation (overlaps, sleep window)  
- [x] Modal forms for phases  
- [x] PhasesCalendar / display with user settings  
- [x] Task form: event types, multi-phase, fixed datetime fields  

### Phase 3 — UI polish (done)

- [x] MUI, responsive layout, toast, loading / error states  
- [x] Calendar page: generate; clear app-generated slots in the Settings planning horizon  

### Phase 4 — Scheduling engine (done — iterative improvements possible)

- [x] Intelligent engine: priority, FIFO tie-break, phase union, wake/sleep, weekends, split, displacement within priority tier  
- [x] `/schedule` API + async generate (job) + clear  
- [x] Schedule jobs: replan, latest done, poll by id  
- [ ] Further heuristics (e.g. deeper multi-task optimization), analytics  

### Phase 5 — Advanced product (planned)

- [ ] Drag & drop on schedule / event calendars  
- [ ] Statistics and dashboard  
- [ ] Integrations (Telegram, Notion, etc.)  
- [ ] Mobile / desktop clients if needed  
- [ ] Optional: auto-sync default Sleep/Focus phase times when only wake/sleep settings change  

### Phase 6 — Testing & optimization (partial)

- [x] Jest tests on the backend (`backend/test/`, module `*.spec.ts`)  
- [ ] Systematic coverage increase and CI  
- [ ] E2E for critical flows  
- [ ] Frontend bundle optimization (currently one large `bundle.js`) and API performance  

## Recommended next steps

1. Drag-and-drop and calendar polish.  
2. Expand tests and wire them into CI.  
3. Update this file when scope changes.
