# Task Scheduling Test Matrix (Given/When/Then)

Live write path is `PlacementStepService.place` → `planPlacement` (create / geometric edit / drag / horizon append). Generate, Clear, Undo, and preview APIs are removed; `engine.run` must not be used to assert live slot writes.  
Conflict-rule cases: [spec-conflict-rules.md](spec-conflict-rules.md). Incremental write-set: [spec-incremental-placement.md](spec-incremental-placement.md).  
Format is aimed at direct transfer into unit/integration tests.

**Markers**

- **Covered** — green on the **placement** path (`placement-step.util.spec.ts`, `placement-step.service.spec.ts`, and/or Nest/Playwright e2e that call `place`).
- **Not covered on the live path** — was proven only on the removed `IntelligentSchedulingEngine.run` (PE-30); needs a placement-step test.
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

## T11 — Two new flexibles, same preferred, same create pass (**Not covered on the live path** — its only proof was the removed engine; see PE-30)

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

## T20 — Two recurring, same preferred, enough capacity (**Partly covered**: Nest A-SCH covers sequential create; the same-pass proof was the removed engine)

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
- Covered by `placement-bounds.util.spec.ts` ("raises the floor to earliestStartTime for flexible day windows": day-only 00:00 snaps to wake in the settings zone). The engine spec that covered it before was removed with the dead engine (PE-30).

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
- Partly covered: `planning-horizon.util.spec.ts` (horizon starts at midnight in the settings zone, also across DST). Placement in a non-UTC zone has no dedicated live test yet (the engine spec that covered it was removed, PE-30).

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
- Covered by `placement-step.util.spec.ts` ("avoids a fixed buffer and uses it only when nothing else fits").

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

## PE — Placement engine review regressions (**Covered**)

From [placement-engine-review.md](placement-engine-review.md). Tests: `placement-engine-regressions.spec.ts` (pure `planPlacement` and SQLite with the real `PlacementStepService` / `TasksService`, kit in `backend/test/helpers/placement-sqlite.kit.ts`); PE-20 / PE-21 in `displayed-event-move.service.spec.ts`; PE-09 / PE-25 RRULE in `google-recurrence.util.spec.ts`.

| ID | Given | When | Then |
|----|-------|------|------|
| PE-01 | Daily series at 10:00, open days seated | Clock edited to 11:00 with an earlier form date | Master and every open day on 11:00; skipped days kept |
| PE-02 | Daily series, days 5–9 Nov at 10:00 | Drag 8 Nov to 15:00, "this and following" | One slot per day; old series keeps 5–7 Nov |
| PE-03 | Resolved layer 10:00–11:00 | Fixed claim 10:00–11:00 | Fixed seats on 10:00 on top; nobody moves |
| PE-04 | Another series day 10:00 | Fixed series day claims 10:00 | Keeps 10:00 (that day is displaced) or conflict; never another hole |
| PE-05 | Weekly Monday series; 9 Nov detached into a copy | Copy dragged to Wednesday 10:00 | Copy stays on Wednesday; series not changed; 9 Nov still skipped |
| PE-06 | Fixed A 10:00, fixed B 14:00 | B edited onto 10:00 (conflict) | B's task clock equals its slot (14:00) |
| PE-07 | Daily series 10:00 | A fixed claim displaces one day | That day becomes a copy; new horizon days stay at 10:00 |
| PE-08 | Mon/Fri every 2 weeks from Fri 30 Oct | Horizon days | 30 Oct, 9, 13, 23, 27 Nov (weeks from Monday) |
| PE-09 | Monthly from 31 Jan | Horizon days / Google RRULE | 31 Jan, 28 Feb, 31 Mar, 30 Apr, 31 May; `BYMONTHDAY=28,29,30,31;BYSETPOS=-1` |
| PE-10 | Weekly series from Monday 2 Nov | Clock edited on Thursday | Days stay on Mondays |
| PE-11 | No free hour, flexibles packable | Auto-seat / Schedule / Do now (`rawHole`) | Problematic; seated tasks not packed |
| PE-12 | Canceled task on 10:00 | Fixed claim 10:00 | Claim seats; canceled slot and state untouched |
| PE-13 | Peer From 10:00, holes at 09:00 and 13:00 | Peer displaced | Peer to 13:00, never before its From |
| PE-15 | Unphased peer; the only phase is full | Peer displaced | Peer searches wake/sleep (11:00), not the phase union |
| PE-17 | 14:00, new daily series without a clock | Create | Today gets a hole after now (clock sibling if needed); nothing in the past |
| PE-18 | Series rewrite shifts a peer, then fails | Write throws part-way | Peer and old series rows unchanged; no Google sync |
| PE-19 | No free day in the horizon | New series | One Problematic copy per day; master not parked |
| PE-20 | Flexible drag with a new phase | Drop is a conflict | Old slot and old phase kept |
| PE-21 | Voice `shift` of a slot | Apply | Goes through `move-event` with `slotId` (drag path) |
| PE-23 | Flexible at 15:00 in 09–17 | Claim takes 15:00 | Flexible to 14:00 (nearest), not 09:00 |
| PE-25 | Weekly at 00:30 Kyiv (Sunday in UTC) | Google RRULE | `BYDAY=MO` |
| PE-26 | Done task's hour taken meanwhile; canceled task's hour free | Back to `todo` | First moves to a free hole; second keeps its slot |
| PE-29 | Many future parks, one past copy | Purge with a small batch | Past copy removed |

## SD — Scheduling domain scenarios (scheduling refactor, Oct 2026)

Behavior (`eventType`: fixed / flexible) and recurrence (single / series) are independent. Invariants checked by `scheduling-invariants.spec.ts` after every step of a seeded random sequence (3 seeds): **I1** no open one-off is lost (it is seated, in an inbox, or waiting on a conflict answer); **I2** at most one slot per task per civil day; **I3** a fixed task's slots sit on its own clock; **I4** flexible slots stay inside wake/sleep; **I5** no flexible slot overlaps a fixed slot (unless resolved); **I6** a day copy's day is skipped on its series.

| ID | Initial state | Action | Expected | Invariants | Test |
|----|---------------|--------|----------|------------|------|
| SD-01 | Empty day | Create fixed single 10:00–10:45 | Slot 10:00–10:45 | I3 | invariants; `placement-step.service.spec.ts` CD04/CD07 |
| SD-02 | Empty days | Create fixed series daily 10:00–10:30 | One slot per day at 10:00 | I2, I3 | invariants; `placement-step.service.spec.ts` FX01 |
| SD-03 | Fixed series at 10:00 | Create flexible series daily, clock 10:00 | Flexible days move off the anchor, fixed stays | I3, I5 | invariants (seeded step 2) |
| SD-04 | Flexible at 15:00 | Fixed claim 15:00 | Fixed seats, flexible to the nearest hole | I3, I5 | regressions PE-23 |
| SD-05 | Series day on an anchor clock | Drag one day onto a fixed event | Everything rolled back, conflict reported | I2, I6 | `series-exception.spec.ts` |
| SD-06 | Daily series 5–7 Nov | Drag 6 Nov to 15:00, this day only | Skip + copy (fixed stays fixed) + seat, atomic; retry adds nothing | I2, I6 | `series-exception.spec.ts`, regressions PE-24 |
| SD-07 | Daily series | Drag "this and following" | Old series ends before the split; new series from the split; retry reuses it | I2 | `series-exception.spec.ts`, regressions PE-02 |
| SD-08 | Parked series day | Problematic Move to a free slot / a taken slot | Copy + skip + seat / nothing changes | I6 | `series-exception.spec.ts`, `problematic-place.service.spec.ts` |
| SD-09 | Detached copy | Moved back to its own day and clock | Re-merges, day un-skipped; on another day stays a copy | I2, I6 | regressions PE-05 |
| SD-10 | Fixed series | Skip one day | Day skipped, slot removed; a fixed one-off refuses skip | I2 | `series-exception.spec.ts` |
| SD-11 | Monthly from the 31st / biweekly / weekly edited midweek | Horizon days | Days count from the series start | I2 | regressions PE-08…PE-10 |
| SD-12 | Series near the horizon edge | Background append | Only missing days, on the series clock | I2 | regressions PE-07, PE-16 |
| SD-13 | No free day | New series | One Problematic copy per day, master not parked | I1 | regressions PE-19 |
| SD-14 | Window already over | Create flexible with a past Until | Unscheduled | I1 | `placement-step.service.spec.ts` CD06 |
| SD-15 | Resolved layer | Fixed claim on top | Both stay | I3 | regressions PE-03 |
| SD-16 | Series rewrite | Crash part-way | No peer moved, old rows intact, no Google sync | — | regressions PE-18 |
| SD-17 | Committed series exception | Google fails after commit | DB keeps the commit; retry idempotent | I2, I6 | `series-exception.spec.ts` |
| SD-18 | Auto-seat with 3 parked tasks | One pass | One external-calendar read | I1 | `placement-load.spec.ts` |
| SD-19 | Many old slots | Drag one block | Only candidates loaded | — | `placement-load.spec.ts` |
| SD-20 | Kyiv, last Sunday of October | Horizon range | Midnights on both sides of the DST switch | — | `planning-horizon.util.spec.ts` |
| SD-21 | Voice: "standup every Monday 10 to 11" | Preview | `fixed`, weekly, first Monday | — | `structured-voice.service.spec.ts` |
| SD-22 | Voice: "find an hour for exercise every Monday" | Preview | flexible series, no clock | — | `structured-voice.service.spec.ts` |
| SD-23 | Voice: "at 18, move it if needed" | Preview | flexible, preferred 18:00 | — | `structured-voice.service.spec.ts` |
| SD-24 | Voice: one day / all future days of a series | Preview | move with scope occurrence / series | — | `structured-voice.service.spec.ts` |
| SD-25 | Fixed series in the UI | Chip, preview facts, voice card, task list, filters | Fixed + repeats everywhere; in Fixed and Recurring filters | — | `schedulingTraits.spec.ts`, `schedulingKind.spec.ts`, `eventPreviewFacts.spec.ts`, `changePreviewCards.spec.ts`, `taskListFilters.spec.ts` |
| SD-26 | Old parked copies | Startup migration | `originalOccurrenceYmd` from `problematicDay`, twice = same | — | `migrate-schedule-state.spec.ts` |

**Known gaps (not covered by an automated test):** concurrent requests across processes (the lock is per process); a crash between a task save and its background placement (`TasksService.create/update`); voice preview vs execution on a live model; frontend drag-and-drop interaction (only the drag helpers are unit-tested); Google partial sync recovery beyond the pending-write retry already covered in `google-calendar` specs.

---

## Minimal smoke set for CI (fast)

- `CD01`–`CD08`, `T05`, `T12`, `T14`, `T15`, `T16`, `T22`, `T50`, `T55`, `W01`, `W03`, `C01`, `C02`.
