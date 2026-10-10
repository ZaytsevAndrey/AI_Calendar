# Specification: Intelligent scheduling & unified items

**Status:** implemented in codebase (engine, jobs, diff); see [overview](overview.md) and [api-reference](api-reference.md) for HTTP/UI.  
**Placement write-set (target):** [spec-incremental-placement.md](spec-incremental-placement.md). Inboxes and option ids: [spec-conflict-rules.md](spec-conflict-rules.md).  
**Language:** English (implementation reference)  
**Last updated:** October 2026

## 1. Goals

- Treat **event**, **task**, and **todo** as a **single domain entity** (“item”) in the product and scheduling logic.
- On **create** or a geometric edit, the system seats that item. The live engine still **replans every open flexible**; the target is [incremental placement](spec-incremental-placement.md) (do not rewrite seated tasks).
- User provides **scheduling settings** (fixed vs movable, duration, optional recurrence and weekdays, optional preferred start), **one phase** (or any time); the engine chooses **where** to place the item using **type + preferred** rules in [spec-conflict-rules.md](spec-conflict-rules.md). Numeric **priority** is soft-deprecated for placement.
- Show the user **what moved** (diff). Support **undo** that restores **local DB and Google Calendar**.
- **Google-imported / synced events** are **anchors**: never moved by the scheduler.
- Planning runs in a **job queue**; horizon from Settings (`recurringScheduleHorizonDays`, default **30**) slides forward via **silent replan**, **drag replan**, and a **background `extend_recurring` tick** (so recurring series stay alive without Generate).

---

## 2. Domain model (conceptual)

### 2.1 Unified item

One persisted entity (evolve current `Task` or merge with calendar event model—implementation detail) with at least:

| Field | Notes |
|--------|--------|
| `id`, `userId` | Standard |
| `title`, `description` | Optional description |
| `eventType` | Storage flag: `fixed` (not moved) or `admin` (movable). New writes use only these two. |
| `phaseIds` | At most one phase; empty = wake/sleep window |
| `priority` | Soft-deprecated for placement; ignored under [conflict rules](spec-conflict-rules.md) |
| `durationMinutes` | User-set; default 30 for movable tasks |
| `deadline` | Optional not-after bound |
| `earliestStartTime` | Optional not-before bound (survives replan) |
| `scheduleTimeZone` | IANA zone stored on the task (from the create payload); used for Google event `timeZone`. Engine day math uses **settings `timeZone`**. |
| `eligibleWeekDays` | Optional weekday filter inside the window (non-recurring) |
| `isRecurring` / `recurrencePattern` | `DAILY` / `WEEKLY` / `BIWEEKLY` / `MONTHLY` |
| `recurrenceWeekDays` | Optional `0–6` (Sun–Sat); intersected with phase `weekDays` |
| `allowSplit` | Effective value = user setting **and** per-task flag; never for `fixed` |
| `isUnscheduled` | Inbox item: not placed by Generate/replan, not synced to Google until scheduled |
| `minSplitMinutes` | From user settings when splitting allowed (e.g. ≥ 30) |
| `scheduledSegments` | Zero or more `{ start, end }` (or link to `ScheduledTask`-like rows)—source of truth for “where it sits” |
| `googleEventId` | If synced to Google |
| `isFixedExternal` | True for Google-owned fixed events (anchors) |
| `createdAt` | When neither item is seated yet in a planning pass, earlier create wins the preferred seat (see conflict rules) |

### 2.2 Phases

Phases remain **named windows** (e.g. morning / work / evening) with weekly `weekDays`. A task has **at most one** phase. Recurring placement uses the intersection of task `recurrenceWeekDays` and phase `weekDays`.

### 2.3 Fixed external events (Google)

- Any calendar event that is **imported from Google** or explicitly marked **fixed** is an **anchor**: occupies time, **cannot be moved or split** by the engine.
- Our **user-created** items that were written to Google are movable **only if** they are not `fixed`; engine updates Google after replan.

### 2.4 User time zone

- Stored on `user_settings.timeZone` (IANA).  
- If empty, the web client PATCHes the browser zone **once** on first login and never overwrites a saved value. Settings UI can change it.  
- The engine interprets wake/sleep, phase clocks, weekdays, and the planning horizon in this zone (fallback `UTC`). Calendar datetime fields in the UI stay in the **browser** zone.  
- Changing the setting does **not** rewrite existing UTC instants or auto-replan.

---

## 3. Scheduling settings (not a type catalog)

Behavior comes from **fields**, not from a catalog of event types. The UI offers three **presets** (Flexible / Fixed / Recurring) that only fill those fields.

| Setting | Movable | Splittable | Notes |
|---------|---------|------------|--------|
| `eventType = fixed` | No | No | Exact start/end required. Anchor. |
| Movable (`admin`) | Yes | If `allowSplit` and user setting | Duration required. Optional preferred start, From/Until window, recurrence. |

**Product rule:** `fixed` never participates in “bump others”; it only consumes slots.

Legacy `eventType` strings (`daily_routine`, `learning`, …) may still exist in the database; the engine treats anything other than `fixed` as movable.

---

## 4. Scheduling algorithm (high level)

**Input:** user id, trigger (new/updated item), horizon = **30 days** from **today at midnight in settings `timeZone`** (fallback `UTC`; length configurable via `recurringScheduleHorizonDays`).

**Output:** new assignment for all **non-fixed** internal items in scope + **diff** list + optional **undo snapshot**.

### 4.1 Ordering and conflict decisions

**Authoritative rules:** [spec-conflict-rules.md](spec-conflict-rules.md).

Summary: place by **type** (fixed / flexible / recurring) + **preferred time**; do not use numeric priority. A claimed interval takes the seat and moves only the overlapped task ([incremental placement](spec-incremental-placement.md)). Ask on fixed-vs-fixed and on preferred exactly on fixed/Google busy. Overflow / no-reply → **Problematic**. Deadline window with no fit → **Unscheduled**.

*Code note:* the live engine may still sort by priority until roadmap §2; do not document priority bump as the product target.

### 4.2 Slot graph

- Build **busy** intervals: anchors (Google fixed) + `FIXED` user items + in-progress auto segments + **fully ended** auto-generated slots kept from earlier plans + optional **habit time blocks**. A habit’s own Google series is not counted again as external busy.
- **`fixedEventBufferMinutes`** (Settings, default **0**): pad each fixed task and each external Google event on **both sides**. Habits, ended flexible slots, and in-progress flexible work are not padded. Generate avoids that gap, then uses it when the task would not fit in the horizon (and, for a recurring occurrence, not on that day). Dragging a block can still land in the gap. The gap is not a calendar event.  
- Build **available** intervals = the task’s phase window (or wake/sleep if none) intersected with **weekend** rules from user settings.  
- Respect **minimum split** when placing segments.

### 4.3 Placement strategy (per item)

For each schedulable item (see conflict-rules for silent vs ask):

1. Try **preferred** clock interval inside the phase ∩ wake/sleep ∩ From/Until; if free, place there. If preferred is taken by a seated flexible, the claimant takes it and only that task moves ([incremental placement](spec-incremental-placement.md)). If preferred lands exactly on fixed/Google → conflict options. The live engine still sends the newcomer to the next free slot.
2. If no preferred: earliest valid slot; always dodge fixed/Google silently.
3. Place **remaining** duration (estimated minutes minus fully ended auto slots for non-recurring tasks). If remaining work is below 5 minutes, skip — do not schedule the same past block again.
4. If not enough contiguous time and the item **allows split**: split into chunks ≥ `minSplitMinutes`.
5. If still no fit: conflict options and/or **Problematic** (not priority displacement of peers). Horizon overflow messaging should not tell the user to “raise priority.”

### 4.4 Deadline / schedule window

- If `earliestStartTime` is set: hard constraint—do not start any segment before that **instant**. Day-only From (00:00 in **settings `timeZone`**) snaps to wake that local day so a `+03:00` midnight is not treated as “this evening” on a UTC host. Wake/sleep from Postgres (`HH:mm:ss`) are normalized to `HH:mm` before that snap. A clock From such as 00:01 is left as an instant and is not snapped.
- If `deadline` is set: hard constraint—**all segments must end by deadline**. If the deadline is **already in the past**, skip the task (no new slot, no error). If the deadline is still ahead and fit is impossible: land in **Unscheduled** (or structured warning)—**not** Problematic solely for deadline miss; suggest extend deadline, enable split, or free time (not “raise priority”).
- If `eligibleWeekDays` is set on a non-recurring task: only those weekdays inside the window are eligible.

### 4.5 Phase and preferred start

One optional phase. Preferred-first behavior and when to ask vs dodge are defined in [spec-conflict-rules.md](spec-conflict-rules.md) §5.

---

## 5. Triggers and UX

**Target write-set:** [spec-incremental-placement.md](spec-incremental-placement.md). Create and geometric edit seat the claimant through `PlacementStepService.place` and do not enqueue a full replan. Generate and `POST /schedule-jobs/replan` still run `engine.run`.

- **Generate / Review and undo-last-generate are not part of the target.** Tasks receive a seat when they are created or when a later claim overlaps them. The live Calendar button still exists until that UI is removed.
- **Clear** is not part of the target either. The live Calendar action remains until that UI is removed.
- Fully ended app-generated slots (`scheduledEndTime <= now`) stay. Past app-calendar events render **gray**; other Google calendars keep their colors.
- The live worker may still rewrite every open flexible slot until the incremental contract is implemented.

### 5.1 Diff

- List of changes: `{ itemId, title?, before[], after[] }` where before/after are segment lists.  
- FE presents human-readable summary + timestamps in user TZ.

### 5.2 Undo

Target: no undo of a calendar-wide generate, because that action is removed. Create, drag, and a displacement are not batch-undone. The live `POST /schedule-jobs/undo` remains only until Generate is removed. Clear has no undo. Fully ended blocks stay.

---

## 6. Queue and persistence

**Choice:** **SQLite-backed job table** (fits current stack; no Redis required).

- Table e.g. `schedule_jobs`: `id`, `userId`, `payload` (json), `status` (pending/running/done/failed), `progressStage` (`preparing` / `computing` / `syncing_google` / `done` / `failed`), `progressCurrent` / `progressTotal` (Google sync), `createdAt`, `startedAt`, `finishedAt`, `error`, `resultSummary` (json pointer to diff id).  
- **Worker:** Nest provider on interval or `@nestjs/bull` not used; simple **polling** or **cron** every N seconds processing `pending` with row lock / `UPDATE … WHERE status='pending' LIMIT 1` pattern (SQLite limitations acknowledged—single worker or `FOR UPDATE` equivalent via transaction).  
- **Idempotency:** job `correlationId` from client optional to dedupe double-submit.

---

## 7. Google Calendar

Target source of truth, failed-write queue, and `scheduleState` (`none` / `problematic` / `resolved`) live in [spec-incremental-placement.md](spec-incremental-placement.md) §12. The bullets below describe the live engine until that ships.

- **Inbound:** events from Google → stored as **anchors** (`isFixedExternal=true` or separate table); never moved by scheduler.  
- **Outbound:** our items with sync flag get **create/update/delete** when **still-open** segments change. Fully ended app events are left in place.  
- **Recurring:** one RRULE master for open occurrences. DTSTART / event `start` follows the **majority local clock** among open seats (`pickMajorityClockSlot`; not chronological first seat), so one skewed day cannot rewrite the whole Google series onto another task’s clock. On replan/clear, if ended instances exist, the old series is **capped** with `UNTIL` (DTSTART unchanged) and a **new** series is created for remaining future slots—two Google writes, not one event per day. User-skipped days are stored on the task and omitted from placement; Google sync adds `EXDATE` for those instants.  
- **Undo:** reverse last Google writes for items in snapshot (implementation must track mapping segment ↔ event id).  
- **Habits:** a daily time block is an open-ended `RRULE:FREQ=DAILY` event on the app calendar when Google is linked. Check-ins are not events. Generate still reserves the interval from the habit row.

---

## 8. User settings (additions)

| Setting | Purpose |
|---------|--------|
| `allowSplitScheduling` | Global gate for splitting (AND with per-task `allowSplit`) |
| `minSplitMinutes` | e.g. 30; used when splitting |
| `recurringScheduleHorizonDays` | Planning horizon (default 30) |
| `fixedEventBufferMinutes` | Minutes kept free before and after each fixed task and external Google event (0–180, default 0). Generate may use the gap when the task would not otherwise fit. |

---

## 9. API sketch (to refine during implementation)

- `POST /items` (or extend `POST /tasks`) — creates item, enqueues job, returns `202` + `jobId` or sync wait with timeout (prefer async + poll `GET /schedule-jobs/:id`).  
- `GET /schedule-jobs/:id` — status + `diff` when done.  
- `DELETE /schedule` — clear still-open app-generated slots in the Settings planning horizon (`recurringScheduleHorizonDays`); fully ended blocks stay.  
- `GET /schedule-jobs/undo` / `POST /schedule-jobs/undo` — last Calendar Generate snapshot.  
- Deprecate or align legacy `POST /schedule/generate` with new pipeline (see §10).

---

## 10. Migration and cleanup

- **Audit** current `ScheduleService` (30-min wake/sleep heuristic, `ScheduledTask` entity) vs this spec.  
- **Replace** with new module (e.g. `scheduling-engine` + `ScheduleJob` entity) rather than parallel v2 long-term.  
- Remove or redirect **legacy** endpoints after FE uses new flow.  
- Data migration: map existing `Task` + `ScheduledTask` into unified model or transitional compatibility layer (implementation plan in PR).

---

## 11. Non-goals (MVP)

- ML-based scheduling.  
- Multi-user shared calendars.  
- Real-time collaborative editing.

---

## 12. Open implementation details (engineer discretion)

- Exact SQL schema and naming.  
- Timezone: store instants in UTC; **scheduling clocks** use `user_settings.timeZone` (IANA, editable). Calendar UI remains in the browser zone.  
- Maximum job runtime and retry policy for Google API failures.  
- Recurring Google sync uses one RRULE (with `BYDAY` when weekdays are restricted); local rows stay one segment per occurrence in the horizon. On replan, fully ended occurrences stay: the existing series is capped with `UNTIL` and a new series is created for still-open slots.

---

## References

- Current code: `backend/src/modules/schedule/`, `tasks/`, `phases/`, `google-calendar/`.  
- [Roadmap](roadmap.md) — update when this ships.
