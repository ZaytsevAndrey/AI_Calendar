# Specification: Intelligent scheduling & unified items

**Status:** implemented in codebase (engine, jobs, diff/undo, task types); see [overview](overview.md) and [api-reference](api-reference.md) for HTTP/UI.  
**Language:** English (implementation reference)  
**Last updated:** April 2026

## 1. Goals

- Treat **event**, **task**, and **todo** as a **single domain entity** (“item”) in the product and scheduling logic.
- On **create/update** of an item, the system **automatically replans** placements within allowed time windows.
- User provides **event type**, **one or more phases**, and **priority**; the engine chooses **where** to place the item.
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
| `eventType` | Enum (see §3) |
| `phaseIds` | **Many-to-many** with phases; scheduling searches **union** of allowed windows |
| `priority` | Ordered; ties broken by **creation time** (older first or newer first—pick **older first** so backlog is fair; document if product prefers otherwise) |
| `durationMinutes` | Default from type + user defaults; user can override on create |
| `deadline` | Optional |
| `allowSplit` | Effective value = user setting **and** type allows split |
| `minSplitMinutes` | From user settings when splitting allowed (e.g. ≥ 30) |
| `scheduledSegments` | Zero or more `{ start, end }` (or link to `ScheduledTask`-like rows)—source of truth for “where it sits” |
| `googleEventId` | If synced to Google |
| `isFixedExternal` | True for Google-owned fixed events (anchors) |
| `createdAt` | Tie-break within same priority |

**Tie-break (same priority):** order by **`createdAt` ascending** — **older tasks first (FIFO)** within the same priority band (product confirmed).

### 2.2 Phases

Phases remain **named windows** (e.g. morning / work / evening) with weekly recurrence rules as today. An item with multiple phases: scheduler may assign the item to **any** phase whose window fits; choose the **nearest feasible start time** across all allowed phases inside the horizon.

### 2.3 Fixed external events (Google)

- Any calendar event that is **imported from Google** or explicitly marked **fixed** is an **anchor**: occupies time, **cannot be moved or split** by the engine.
- Our **user-created** items that were written to Google are movable **only if** their `eventType` allows move; engine updates Google after replan.

---

## 3. Event types (enum) and rules

All types are **enum** in code; behavior is **data-driven** from a static config map so rules stay in one place.

| Type | Code | Movable by engine | Splittable | Default duration | Notes |
|------|------|-------------------|------------|------------------|--------|
| Fixed appointment | `FIXED` | No | No | User required (meeting length) | Meetings, doctor, calls with fixed time. |
| Daily routine | `DAILY_ROUTINE` | Yes | Yes* | 30 min | Habits/chores every day; may repeat pattern—implementation can use recurrence fields later. |
| Quick / someday | `QUICK_WIN` | Yes | No | 15 min | Call parents, short call, one-off small errand. |
| Deep / complex | `DEEP_WORK` | Yes | Yes* | 120 min | Multi-segment over days; respects `minSplitMinutes`. |
| Errand / out of home | `ERRAND` | Yes | No | 45 min | Shopping, post office; usually placed in “personal” phases. |
| Admin / shallow work | `ADMIN` | Yes | Yes* | 30 min | Email, tickets, paperwork. |
| Focus block | `FOCUS_BLOCK` | Yes | Yes* | 90 min | Concentrated work; prefer fewer splits. |
| Learning | `LEARNING` | Yes | Yes* | 60 min | Courses, reading blocks. |

\*Splittable only if **user** allows splitting globally and `minSplitMinutes` is set.

**Product rule:** `FIXED` never participates in “bump others”; it only consumes slots.

---

## 4. Scheduling algorithm (high level)

**Input:** user id, trigger (new/updated item), horizon = **30 days** from reference start (typically **today** at user timezone, configurable per job).

**Output:** new assignment for all **non-fixed** internal items in scope + **diff** list + optional **undo snapshot**.

### 4.1 Ordering

1. Sort **schedulable** items by **priority** (descending urgency).  
2. Within same priority, sort by **`createdAt` ascending** (earlier first).

### 4.2 Slot graph

- Build **busy** intervals: anchors (Google fixed) + `FIXED` user items + any immovable blocks.  
- Build **available** intervals = intersection of **phase windows** (union across selected `phaseIds` per item) with **wake/sleep** and **weekend** rules from user settings.  
- Respect **minimum split** when placing segments.

### 4.3 Placement strategy (per item, in order)

Items are processed in **priority order** (highest first). For each item:

1. Try to place the **full** duration in the **nearest** valid slot inside the 30-day horizon (respect phase union, anchors, wake/sleep).  
2. If not enough contiguous time and this type **allows split**: split into chunks ≥ `minSplitMinutes`, still prefer **earliest** completion inside the horizon.  
3. If still no fit: within the **same priority band**, try to **split other already-placed items** that are **splittable/movable** to free space for this item (user-approved “combination”: priority first, then intra-priority splitting).  
4. If still no fit inside the horizon: **schedule beyond the horizon** (earliest feasible slot after day 30) and surface a clear UI flag: “Placed outside your 30-day window—increase priority, free time, or adjust phases/deadline.”

*Note:* A later iteration may add **explicit bumping** of strictly **lower-priority** movable items before step 4; MVP follows the steps above.

### 4.4 Deadline

- If `deadline` is set: hard constraint—**all segments must end by deadline**. If impossible: **do not silently fail**—return structured error / UI message: e.g. “Cannot fit before deadline; raise priority, extend deadline, enable split, or remove other work.”

### 4.5 Multi-phase choice

If multiple `phaseIds`: consider **union** of windows; pick the **earliest start** among feasible placements across phases.

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
| `allowSplitDefault` | Default for new items (can override per item) |
| `minSplitMinutes` | e.g. 30; used when splitting |
| `defaultDurationByType` | Optional overrides map; else use §3 defaults |
| `planningHorizonDays` | Default 30 (keep configurable for tests) |

---

## 9. API sketch (to refine during implementation)

- `POST /items` (or extend `POST /tasks`) — creates item, enqueues job, returns `202` + `jobId` or sync wait with timeout (prefer async + poll `GET /schedule-jobs/:id`).  
- `GET /schedule-jobs/:id` — status + `diff` when done.  
- `POST /schedule-jobs/:id/undo` — restores snapshot (valid for last completed job per user).  
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
- Whether **DAILY_ROUTINE** creates multiple segment rows per day or one recurring rule—start simple (one segment per day in horizon) and iterate.

---

## References

- Current code: `backend/src/modules/schedule/`, `tasks/`, `phases/`, `google-calendar/`.  
- [Roadmap](roadmap.md) — update when this ships.
