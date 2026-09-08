# Specification: Intelligent scheduling & unified items

**Status:** implemented in codebase (engine, jobs, diff); see [overview](overview.md) and [api-reference](api-reference.md) for HTTP/UI.  
**Language:** English (implementation reference)  
**Last updated:** September 2026

## 1. Goals

- Treat **event**, **task**, and **todo** as a **single domain entity** (“item”) in the product and scheduling logic.
- On **create/update** of an item, the system **automatically replans** placements within allowed time windows.
- User provides **scheduling settings** (fixed vs movable, duration, optional recurrence and weekdays, optional preferred start), **one phase** (or any time), and **priority**; the engine chooses **where** to place the item.
- Show the user **what moved** (diff). Support **undo** that restores **local DB and Google Calendar**.
- **Google-imported / synced events** are **anchors**: never moved by the scheduler.
- Planning runs in a **job queue**; horizon **30 days** from “planning anchor date” (see §6).

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
| `priority` | Ordered; ties broken by **creation time** (older first) |
| `durationMinutes` | User-set; default 30 for movable tasks |
| `deadline` | Optional not-after bound |
| `earliestStartTime` | Optional not-before bound (survives replan) |
| `scheduleTimeZone` | IANA zone for interpreting day-only From/Until (from the client) |
| `eligibleWeekDays` | Optional weekday filter inside the window (non-recurring) |
| `isRecurring` / `recurrencePattern` | `DAILY` / `WEEKLY` / `BIWEEKLY` / `MONTHLY` |
| `recurrenceWeekDays` | Optional `0–6` (Sun–Sat); intersected with phase `weekDays` |
| `allowSplit` | Effective value = user setting **and** per-task flag; never for `fixed` |
| `minSplitMinutes` | From user settings when splitting allowed (e.g. ≥ 30) |
| `scheduledSegments` | Zero or more `{ start, end }` (or link to `ScheduledTask`-like rows)—source of truth for “where it sits” |
| `googleEventId` | If synced to Google |
| `isFixedExternal` | True for Google-owned fixed events (anchors) |
| `createdAt` | Tie-break within same priority |

**Tie-break (same priority):** order by **`createdAt` ascending** — **older tasks first (FIFO)** within the same priority band (product confirmed).

### 2.2 Phases

Phases remain **named windows** (e.g. morning / work / evening) with weekly `weekDays`. A task has **at most one** phase. Recurring placement uses the intersection of task `recurrenceWeekDays` and phase `weekDays`.

### 2.3 Fixed external events (Google)

- Any calendar event that is **imported from Google** or explicitly marked **fixed** is an **anchor**: occupies time, **cannot be moved or split** by the engine.
- Our **user-created** items that were written to Google are movable **only if** they are not `fixed`; engine updates Google after replan.

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

**Input:** user id, trigger (new/updated item), horizon = **30 days** from reference start (typically **today** at user timezone, configurable per job).

**Output:** new assignment for all **non-fixed** internal items in scope + **diff** list + optional **undo snapshot**.

### 4.1 Ordering

1. Sort **schedulable** items by **priority** (descending urgency).  
2. Within same priority, sort by **`createdAt` ascending** (earlier first).

### 4.2 Slot graph

- Build **busy** intervals: anchors (Google fixed) + `FIXED` user items + any immovable blocks.  
- Build **available** intervals = the task’s phase window (or wake/sleep if none) intersected with **weekend** rules from user settings.  
- Respect **minimum split** when placing segments.

### 4.3 Placement strategy (per item, in order)

Items are processed in **priority order** (highest first). For each item:

1. Try to place the **full** duration in the **nearest** valid slot inside the 30-day horizon (respect phase window, anchors, wake/sleep).  
2. If not enough contiguous time and the item **allows split**: split into chunks ≥ `minSplitMinutes`, still prefer **earliest** completion inside the horizon.  
3. If still no fit: within the **same priority band**, try to **split other already-placed items** that are **splittable/movable** to free space for this item (user-approved “combination”: priority first, then intra-priority splitting).  
4. If still no fit inside the horizon: **schedule beyond the horizon** (earliest feasible slot after day 30) and surface a clear UI flag: “Placed outside your 30-day window—increase priority, free time, or adjust phases/deadline.”

*Note:* A later iteration may add **explicit bumping** of strictly **lower-priority** movable items before step 4; MVP follows the steps above.

### 4.4 Deadline / schedule window

- If `earliestStartTime` is set: hard constraint—do not start any segment before that **instant**. Day-only From (00:00 in the user IANA zone) snaps to wake that local day so `+03:00` midnight is not treated as “this evening” on a UTC host. Wake/sleep from Postgres (`HH:mm:ss`) are normalized to `HH:mm` before that snap (otherwise the ISO is invalid and the task lands “today” on production). A clock From such as 00:01 is left as an instant and is not snapped.
- If `deadline` is set: hard constraint—**all segments must end by deadline**. If impossible: **do not silently fail**—return structured error / UI message: e.g. “Cannot fit before deadline; raise priority, extend deadline, enable split, or remove other work.”
- If `eligibleWeekDays` is set on a non-recurring task: only those weekdays inside the window are eligible.

### 4.5 Phase and preferred start

One optional phase. If a movable task has preferred start/end stored on the task, try that clock time first; if busy, take the earliest remaining slot that day (then later days).

---

## 5. Triggers and UX

- **On create** (and on relevant **update**): enqueue **replan job**; UI shows **loading** then **diff** (what moved: item id, old range → new range).  
- Optional later: manual **“Replan now”** button (same pipeline).

### 5.1 Diff

- List of changes: `{ itemId, title?, before[], after[] }` where before/after are segment lists.  
- FE presents human-readable summary + timestamps in user TZ.

### 5.2 Undo

- **Single-level undo** for MVP: last completed replan operation (optional stack later).  
- Persist **snapshot** before apply: scheduled segments + Google event ids/times for affected **our** items.  
- Undo restores **DB** and **pushes updates to Google** for those items (delete moved instances / restore previous times per integration rules).

---

## 6. Queue and persistence

**Choice:** **SQLite-backed job table** (fits current stack; no Redis required).

- Table e.g. `schedule_jobs`: `id`, `userId`, `payload` (json), `status` (pending/running/done/failed), `createdAt`, `startedAt`, `finishedAt`, `error`, `resultSummary` (json pointer to diff id).  
- **Worker:** Nest provider on interval or `@nestjs/bull` not used; simple **polling** or **cron** every N seconds processing `pending` with row lock / `UPDATE … WHERE status='pending' LIMIT 1` pattern (SQLite limitations acknowledged—single worker or `FOR UPDATE` equivalent via transaction).  
- **Idempotency:** job `correlationId` from client optional to dedupe double-submit.

---

## 7. Google Calendar

- **Inbound:** events from Google → stored as **anchors** (`isFixedExternal=true` or separate table); never moved by scheduler.  
- **Outbound:** our items with sync flag get **create/update/delete** when segments change.  
- **Undo:** reverse last Google writes for items in snapshot (implementation must track mapping segment ↔ event id).

---

## 8. User settings (additions)

| Setting | Purpose |
|---------|--------|
| `allowSplitScheduling` | Global gate for splitting (AND with per-task `allowSplit`) |
| `minSplitMinutes` | e.g. 30; used when splitting |
| `recurringScheduleHorizonDays` | Planning horizon (default 30) |

---

## 9. API sketch (to refine during implementation)

- `POST /items` (or extend `POST /tasks`) — creates item, enqueues job, returns `202` + `jobId` or sync wait with timeout (prefer async + poll `GET /schedule-jobs/:id`).  
- `GET /schedule-jobs/:id` — status + `diff` when done.  
- `DELETE /schedule` — clear app-generated slots in the Settings planning horizon (`recurringScheduleHorizonDays`).  
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
- Timezone handling (store UTC; display user TZ from `user-settings`).  
- Maximum job runtime and retry policy for Google API failures.  
- Recurring Google sync uses one RRULE (with `BYDAY` when weekdays are restricted); local rows stay one segment per occurrence in the horizon.

---

## References

- Current code: `backend/src/modules/schedule/`, `tasks/`, `phases/`, `google-calendar/`.  
- [Roadmap](roadmap.md) — update when this ships.
