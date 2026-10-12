# Task Scheduling Test Matrix (Given/When/Then)

Live write path is `PlacementStepService.place` → `planPlacement` (create / geometric edit / drag / horizon append). Generate, Clear, Undo, and preview APIs are removed; `engine.run` must not be used to assert live slot writes.  
Conflict-rule cases: [spec-conflict-rules.md](spec-conflict-rules.md). Incremental write-set: [spec-incremental-placement.md](spec-incremental-placement.md).  
Format is aimed at direct transfer into unit/integration tests.

**Markers**

- **Covered** — green on the **placement** path (`placement-step.util.spec.ts`, `placement-step.service.spec.ts`, and/or Nest/Playwright e2e that call `place`).
- **Covered (engine only)** — still proven on `IntelligentSchedulingEngine.run` but not yet on the live write path; do not treat as CI proof of seating.
- **Target** — product does not claim this yet, or UI/notify glue is unfinished.

Crowded-day user families (**CD\***) are the §22 priority: free hole, pack/shift, immovable walls, no capacity, deadline → Unscheduled, fixed vs fixed, conflict apply/dismiss, series under load.

## Conventions

- Times in **T\*** examples: UTC unless noted.
- **W\*** (From/Until): client TZ (`Asia/Nicosia`), host UTC as on Render.
- Slot step: 15 minutes.
- Default phase: `09:00-17:00` unless noted.
- **Placement algorithm (what these cases assert):** type + preferred-first; **priority ignored**; preferred/claim on seated flexible may shift peers per incremental placement; silent dodge of fixed/Google/habit unless preferred lands exactly on that busy interval; ask / Problematic / Unscheduled per conflict-rules spec.
- Warnings asserted by `code`, not message text.

Recommended codes (use real backend enums if names differ):

- `SCHEDULING_DEADLINE_EXCEEDED`
- `SCHEDULING_HORIZON_EXCEEDED`
- `SCHEDULING_NO_VALID_SLOT`
- `SCHEDULING_OCCURRENCE_SKIPPED`
- `NEEDS_CONFLICT_CHOICE` (product; when conflict options are required)
- Problematic / Unscheduled flags as implemented in §3

---

## T01 — Validation: required fields

**Given**

- Payload without `name`.

**When**

- Create task endpoint.

**Then**

- 4xx validation error.
- Task row not created.

`eventType` and `priority` are optional (defaults: `admin`, `medium`). Priority must not affect placement once §2 ships.

## T02 — Validation: only one phase

**Given**

- Payload with more than one `phaseId`.

**When**

- Create task.

**Then**

- 4xx validation error.

## T03 — Validation: estimatedTime for non-fixed

**Given**

- Non-fixed task without `estimatedTimeInMinutes` in the **form**.

**When**

- Submit create form.

**Then**

- Client validation blocks submit.
- API without the field defaults to 30 minutes (not 4xx).

## T04 — Validation: estimatedTime <= 0

**Given**

- Non-fixed task with `estimatedTimeInMinutes = 0` or negative.

**When**

- Create task.

**Then**

- 4xx validation error.

## T05 — Validation: fixed start/end

**Given**

- Fixed task without `scheduledStartTime`/`scheduledEndTime` or `end <= start`.

**When**

- Create task.

**Then**

- 4xx validation error.

---

## Crowded-day families (CD) — §22 priority

These describe a busy phase day. Prefer Nest e2e + Playwright for the HTTP/UI loop; util/service for planner outcomes.

### CD01 — Free hole (**Covered**)

**Given** seated flexibles leave a contiguous hole ≥ claim duration.  
**When** create flexible with no preferred (or preferred on the hole).  
**Then** silent seat in that hole; peers unchanged; no conflict UI.

### CD02 — Pack / shift flexibles (**Covered**)

**Given** fragmented flexibles with enough free minutes after left-pack.  
**When** create / place without preferred (or preferred on a peer).  
**Then** peers shift within the phase; claim seated; anchors untouched.

### CD03 — Preferred on seated flexible (**Covered**)

**Given** flexible `A` seated on `09:00–10:00`.  
**When** new flexible claims that interval.  
**Then** claim takes the interval (or next hole per planner); `A` shifts or parks per incremental rules; no conflict sheet (conflict is for anchors only).

### CD04 — Immovable wall (fixed / Google / habit) (**Covered**)

**Given** fixed, stub Google busy, or habit block on `09:00–10:00`.  
**When** flexible preferred exactly on that interval.  
**Then** `conflict` with `place_on_top`, `move_new`, `leave_problematic` (+ `skip_occurrence` if recurring); wall never moves. See **T14**, **C01**, **C02**.

### CD05 — No capacity → Problematic (**Covered**)

**Given** phase full (0 free minutes, or only immovable fragments).  
**When** create flexible / recurring day that cannot fit.  
**Then** `scheduleState=problematic` (or park copy for a series day); not Unscheduled; not silent drop. See **T22**, A-SCH-035.

### CD06 — Deadline / From–Until miss → Unscheduled (**Covered**)

**Given** flexible window expired or no fit before deadline.  
**When** place.  
**Then** `unscheduled` outcome / inbox; not Problematic solely for that miss. Recurring uses Problematic instead (`deadline_no_fit`).

### CD07 — Fixed vs fixed (**Covered**)

**Given** fixed `F1` seated.  
**When** create or drag fixed `F2` overlapping `F1`.  
**Then** always `conflict` (never silent overlap); dismiss → Problematic. See **T15**.

### CD08 — Conflict apply / dismiss (**Covered**)

**Given** job result includes `conflicts[]` after create/place.  
**When** user picks `leave_problematic` / dismiss, `move_new`, or `place_on_top`.  
**Then** PATCH applies; dismiss parks Problematic; sheet options are structured ids. See **C01**, **C02**.

### CD09 — Series under load (**Covered** Nest A-SCH-033–039)

**Given** multi-day landscape (holes, swiss cheese, fixed mosaic, solid fill).  
**When** recurring create without preferred.  
**Then** per-day seat or park; horizon append does not rewrite past days; other series masters are not stolen into gaps.

---

## T10 — Seated flexible; new flexible finds next free (**Covered**)

**Given**

- Phase window: `2026-04-21 09:00-12:00`.
- Seated flexible `A`: `09:00-10:00`.
- New flexible `B`: `estimated=60`, preferred `09:00`.

**When**

- `PlacementStepService.place` for `B`.

**Then**

- Claimant / peer outcome per `planPlacement` (preferred claim may shift `A`; no-preferred nearest-hole leaves `A` and seats `B` at `10:00–11:00`).
- No overlap after writes.
- No conflict UI (peers are movable).

## T11 — Two new flexibles, same preferred, same create pass (**Covered (engine only)**)

**Given**

- Phase: `09:00-12:00`.
- Flexible `A` and `B`, both 60 min, preferred `09:00`.
- `A` has earlier `createdAt`.

**When**

- Both are placed in one planning pass (neither seated yet).

**Then**

- `A`: `09:00-10:00`.
- `B`: `10:00-11:00`.
- Priority values on either task do not change this order.

Live product seats one create at a time via `place`; sequential creates cover the same order.

## T12 — Fixed anchor is never moved (**Covered**)

**Given**

- Fixed task `F`: `09:30-10:30`.
- Recurring or flexible `X`, preferred `09:30`, duration 60 (any priority).

**When**

- `place` for `X`.

**Then**

- `F` stays `09:30-10:30`.
- If `X` preferred is exactly on `F` → see **T14** (ask).
- If `X` has no preferred (or preferred elsewhere) → `X` silently dodges to the next valid slot (e.g. `10:30-11:30`).

## T13 — Flexible without preferred silently dodges fixed (**Covered**)

**Given**

- Fixed `F`: `09:00-10:00`.
- Flexible `X`: duration 60, **no** preferred, phase `09:00-12:00`.

**When**

- `place` for `X`.

**Then**

- `F` unchanged.
- `X` at `10:00-11:00` (or earliest free).
- No conflict UI.

## T14 — Flexible preferred exactly on fixed → ask (**Covered**)

**Given**

- Fixed `F`: `09:00-10:00`.
- Flexible `X`: duration 60, preferred `09:00`.

**When**

- Create / place `X`.

**Then**

- Structured conflict with option ids including at least `place_on_top`, `move_new`, `leave_problematic` (and `move_other` only if the other side is movable — here fixed is not).
- `X` is not silently placed on `09:00-10:00`.
- Dismiss / no-reply → `X` marked **Problematic**, not Unscheduled.

## T15 — Fixed vs fixed → always ask (**Covered**)

**Given**

- Fixed `F1`: `15:00-16:00`.
- User creates or drags fixed `F2`: `15:30-16:30`.

**When**

- Conflict detected via `place`.

**Then**

- Conflict options (never silent overlap).
- No-reply / dismiss → Problematic for the unresolved fixed create/move.

## T16 — Deadline with no fit → Unscheduled, not Problematic (**Covered**)

**Given**

- Flexible task with deadline such that no valid slot fits before deadline (or expired From–Until window).

**When**

- `place` / create path for that window.

**Then**

- Task remains or lands in **Unscheduled**.
- Not flagged Problematic solely for deadline miss.
- Existing overdue highlighting still applies near deadline.

---

## T20 — Two recurring, same preferred, enough capacity (**Covered (engine only)**; Nest A-SCH covers sequential create)

**Given**

- Recurring `R1`, `R2`: DAILY, duration 60, preferred `09:00`.
- `R1` created earlier.
- Horizon: 3 valid days, phase `09:00-12:00`.

**When**

- Occurrence planning.

**Then**

- Each day: `R1` → `09:00-10:00`, `R2` → `10:00-11:00`.
- All 6 occurrences created.
- Priority fields ignored.

## T21 — Three recurring, enough capacity (**Target**)

**Given**

- `R1`, `R2`, `R3`: DAILY, duration 60, preferred `09:00`.
- Phase `09:00-12:00`, horizon 2 days.
- Creation order `R1`, then `R2`, then `R3`.

**When**

- Planning.

**Then**

- Each day: `09:00`, `10:00`, `11:00` respectively.
- No overlap.

## T22 — Three recurring, not enough capacity → Problematic overflow (**Covered** util + Nest A-SCH-035)

**Given**

- `R1`, `R2`, `R3`: DAILY, duration 60, preferred `09:00`.
- Phase `09:00-11:00` (2 hours/day), horizon 2 days.

**When**

- Planning.

**Then**

- Two occurrences per day for the first two series by seat / create order.
- Third series occurrences that cannot fit → **Problematic** (not silent skip-only without inbox).
- Optional warning code `SCHEDULING_OCCURRENCE_SKIPPED` / no-slot may still be emitted.

## T23 — Recurring silently dodges fixed; notify if moved from preferred (**Target**)

**Given**

- Fixed `F`: `09:00-10:00` on each day under test.
- Recurring `R`: DAILY, preferred `09:00`, duration 60.
- Phase `09:00-12:00`, horizon 2 days.

**When**

- Planning (preferred exactly on fixed → **T14**-style ask for that occurrence; if product treats recurring dodge without claiming preferred as silent — use no-preferred variant):

**Variant A — preferred exactly on fixed:** ask per occurrence or batch; no-reply → Problematic.

**Variant B — no preferred:** `R` at `10:00-11:00` each day; if an existing recurring seat is shifted to make room, user gets an in-app **notify** toast.

**Then**

- `F` never moves.

## T24 — Recurring moved within phase → notify (**Target**)

**Given**

- Recurring `R` seated at `09:00-10:00`.
- New placement (drag or create) forces `R` to `10:00-11:00` within the same phase.

**When**

- Replan / conflict apply with `move_other`.

**Then**

- `R` at new slot.
- In-app notification that the routine moved.
- Not Unscheduled.

---

## T30 — DAILY trimmed by phase weekDays

**Given**

- Recurring `R`: DAILY, duration 60, preferred `09:00`.
- Phase limited to `Mon-Fri`.
- Horizon: 7 days (Mon–Sun).

**When**

- Occurrence planning.

**Then**

- Occurrences only Mon–Fri (count = 5).
- No Sat/Sun occurrences.

## T30b — DAILY trimmed by task recurrenceWeekDays ∩ phase

**Given**

- Recurring `R`: DAILY, `recurrenceWeekDays=[1,3]` (Mon, Wed), duration 60.
- Phase `Mon-Fri`.
- Horizon: 7 days.

**When**

- Planning.

**Then**

- Occurrences only Mon and Wed (count = 2).

## T31 — No window today → next valid day

**Given**

- Recurring `R`: duration 60.
- Today’s phase window fully busy.
- Next day has a free slot.

**When**

- Planning.

**Then**

- No occurrence today.
- Occurrence on the next valid day in a concrete slot.

## T32 — Deadline exceeded (**Target** alignment)

**Given**

- Flexible/Recurring that cannot fit before deadline.

**When**

- Planning.

**Then**

- Not forced past the deadline.
- Warning `SCHEDULING_DEADLINE_EXCEEDED` and/or Unscheduled per **T16** (not Problematic-only for pure deadline miss).

## T33 — Horizon exceeded with occurrence correctness

**Given**

- Recurring DAILY for 10 days.
- Planning horizon: 5 days.

**When**

- Planning.

**Then**

- Occurrences only for the first 5 valid days.
- Warning `SCHEDULING_HORIZON_EXCEEDED` or `SCHEDULING_OCCURRENCE_SKIPPED`.
- Exact created count asserted.
- (Background `extend_recurring` slides the Settings horizon so series stay alive without Review/Generate; horizon length itself is unchanged.)

---

## T40 — Overnight phase exact slotting (**Target**)

**Given**

- Phase: `22:00-06:00`.
- Recurring `R1`, `R2`: duration 120, preferred `22:00`.
- `R1` created earlier.

**When**

- Planning for 1 overnight window.

**Then**

- `R1` → `22:00-00:00`.
- `R2` → `00:00-02:00`.
- Both valid inside the overnight window.
- Priority ignored.

## T41 — Weekend rule overridden by phase

**Given**

- Global `weekendWork=true`.
- Phase `weekDays=Mon-Fri`.
- Recurring DAILY.

**When**

- Planning a week with weekends.

**Then**

- Occurrences only Mon–Fri regardless of `weekendWork`.

---

## T50 — Pipeline integration after create (non-fixed)

**Given**

- Non-fixed task created.

**When**

- Create endpoint succeeds.

**Then**

- Replan job enqueued for the user.
- HTTP response does **not** wait for replan / Google sync.
- Covered by `tasks.service.spec.ts` (`returns from create without waiting for replan to finish`).

## T51 — Google disconnected: sync skipped safely

**Given**

- User has no Google Calendar linked.

**When**

- Create/update triggers sync pipeline.

**Then**

- Sync skipped.
- Create/update succeeds.
- Warning logged if supported.

## T52 — completed/canceled does not auto-delete event

**Given**

- Task with an already synced Google event.

**When**

- Status → `completed` or `canceled`.

**Then**

- Google event is not deleted automatically.

## T53 — ~~Replan keeps fully ended auto slots~~ (**Removed**)

Generate / full replan write path removed. Ended-slot keep semantics no longer apply via Generate.

## T54 — ~~Clear keeps finished blocks~~ (**Removed**)

`DELETE /schedule` Clear API removed.

## T55 — Calendar grays only our finished app events

**Given**

- Mix of app calendar (ended + future) and primary/other calendars (ended).

**When**

- Calendar day/week/month render.

**Then**

- Gray fill only if `isAppGenerated` and `end <= now`.
- External calendars keep Google `colorId`.
- Covered by `frontend/src/modules/calendar/hooks/eventAppearance.spec.ts`.

## T56 — ~~Undo last Generate~~ (**Removed**)

`POST /schedule-jobs/undo` and Generate undo snapshots removed.

---

## W01 — From/Until: day-only 00:00 in settings TZ (UTC host)

**Given**

- Host TZ = UTC; Settings `timeZone` = `Asia/Nicosia` (`+03:00`).
- `wakeTime` from Postgres = `09:00:00`.
- Now = `2026-09-07T18:47:00.000Z`.
- Flexible: `earliestStartTime = 2026-09-08T00:00:00+03:00`, `deadline = 2026-09-08T23:59:00+03:00`.

**When**

- Replan / create pipeline.

**Then**

- No segment starts on `2026-09-07` UTC.
- Placement on local 8 Sep.
- Covered by `intelligent-scheduling.engine.spec.ts`.

## W02 — From 00:01 is an instant (not snapped)

**Given**

- Same TZ as W01.
- `earliestStartTime` local `00:01`, not `00:00`.

**When**

- Replan.

**Then**

- Not treated as day-only; instant is the not-before bound.
- Still on the intended local day.

## W03 — Create persists the window before replan

**Given**

- Client sends `earliestStartTime`, `deadline`, `timeZone`, optional `eligibleWeekDays`.

**When**

- `POST /tasks`.

**Then**

- Row saved with those fields (`scheduleTimeZone` = `timeZone`) **before** replan runs.
- Covered by `tasks.service.spec.ts`.

## W04 — Wake/phase clocks use settings timeZone, not the host clock

**Given**

- Host UTC; Settings `Asia/Nicosia`; wake/phase `09:00`–`12:00`.
- Now = `2026-04-20T00:00:00.000Z`.
- Flexible 60 minutes, no From/Until.

**When**

- Replan.

**Then**

- First slot `2026-04-20T06:00:00.000Z`–`07:00:00.000Z` (09:00–10:00 Nicosia).
- Covered by `intelligent-scheduling.engine.spec.ts`.

## B01 — Buffer around fixed events

**Given**

- Settings `fixedEventBufferMinutes` = 15.
- Fixed (or external Google) `10:00`–`10:30`.
- Flexible 60 minutes, phase `09:00`–`12:00`.

**When**

- Generate.

**Then**

- Flexible at `10:45`–`11:45` (gap both sides).
- Beside a habit block `10:00`–`10:30`, same 60 minutes can stay `09:00`–`10:00` (habits not padded).
- Gap usable when only way to finish before same-day deadline.
- `0` leaves placement unchanged. Drag not rejected for buffer alone.
- Covered by `intelligent-scheduling.engine.spec.ts`.

---

## C01 — No-reply on conflict → Problematic (**Covered**)

**Given**

- Conflict options shown (e.g. T14 / T15 / CD04).

**When**

- User dismisses sheet / closes modal (applies `leave_problematic`) / Voice does not pick an option.

**Then**

- Unresolved work is **Problematic**.
- Not deleted; not Unscheduled.

## C02 — Conflict option ids are structured (**Covered**)

**Given**

- `planPlacement` / mutation job returns a conflict payload.

**When**

- UI or Voice presents choices.

**Then**

- Options use ids: `place_on_top`, `move_other`, `move_new`, `skip_occurrence`, `leave_problematic` (subset allowed; fixed blockers omit `move_other`).
- Groq/copy only phrases labels; apply uses existing APIs.

---

## Minimal smoke set for CI (fast)

- `CD01`–`CD08`, `T05`, `T12`, `T14`, `T15`, `T16`, `T22`, `T50`, `T55`, `W01`, `W03`, `C01`, `C02`.
