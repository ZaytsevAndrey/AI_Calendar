# Scheduling refactor — progress

Living handoff file for the scheduling-domain refactoring (Scopes A–F of the 29 Oct 2026 brief). Another session must be able to continue from here.

## Objective

Recurrence and scheduling behavior are independent everywhere (fixed/flexible × single/recurring). Finish the open placement-engine items (PE-18, PE-27, PE-30), fix UI and Voice classification, and bring docs and test scenarios in line with the code.

## Branches and baseline

- `fix/placement-engine` — review fixes, last commit `453770f` (baseline for this work).
- `refactor/scheduling-domain` — this refactor, branched from `453770f`.
- Not ours, left uncommitted in the working tree on purpose: `BUGS-AND-IMPROVEMENTS.md`, `backend/.env.example`, `backend/src/modules/day-reminders/day-reminders.module.ts`, `backend/src/modules/voice/azure-stt*.ts`, and the other chat's restructure of `documentation/roadmap.md` (§45–§49). Never stage them.

## Architectural decisions

1. **Keep the two existing columns as the two dimensions.** `tasks.eventType` (`fixed` | `admin`) is scheduling behavior; `tasks.isRecurring` + `recurrencePattern` + `recurrenceWeekDays` is recurrence. They are already separate columns; the coupling was in code and UI, not in the schema. No enum rename (would break stored values, API and Google mapping for no behavior gain).
2. **Occurrence identity** = series task id + civil day (`YYYY-MM-DD` in the settings zone). A series slot row is that occurrence on that day; a detached copy carries `seriesGroupId` + `originalOccurrenceYmd`; a skipped day is in `skippedOccurrenceYmds`. No per-occurrence table.

(more decisions are added per stage below)

## Plan (stages)

| # | Stage | Status | Commit |
|---|-------|--------|--------|
| 0 | Baseline commit, branch, test baseline, progress file | done | 453770f |
| 1 | Domain semantics: frontend `taskTraits`, occurrence-identity backfill migration, UI classification (chips, Now, preview facts, voice cards, task list, filters) | done | 2148694 |
| 2 | PE-30: engine class, undo-of-Generate and dead Google replan code removed; live helpers in `planning-horizon.util.ts` / `scheduling-conflict.types.ts`; `POST/PATCH/DELETE /schedule` removed; e2e seed slots via `test/helpers/slots.ts` | done | 12b68ea |
| 3 | PE-18: `PlacementStepService.writeAndPlace`; atomic `moveSeriesDay`, `moveSeriesTail`, Problematic Move (series day + one-off); retry/idempotency by occurrence identity; fixed series day skippable; failure-injection tests (`series-exception.spec.ts`) | done | 4522ac2 |
| 4 | PE-27: one external-calendar fetch per `seatOpenHoles` pass (cached seats copied per call); drag loads only candidate slots/tasks (`placement-load.spec.ts`) | done | e6a4432 |
| 5 | Voice (structured pipeline): spec EN+UK → goldens → `project-apply.ts` / contract / prompt A. Fixed = promised clock (one-off) or a span event (also recurring); preferred clock carried as flexible; date-less repeat with a clock starts on its first matching day; future-series move scope golden | done | 5b6bf7d |
| 6 | Docs and test scenarios: `placement-engine.md` rewritten to the final code, `overview.md` scheduling section, incremental spec rule 8, test matrix SD-01…SD-26 + coverage notes moved off the deleted engine spec, roadmap §50 closed + archive, README; invariant tests (`scheduling-invariants.spec.ts`, 3 seeds) | done | (stage 6 commit, see git log) |

## Test baseline (before stage 1, commit 453770f)

| Check | Result |
|-------|--------|
| backend `tsc --noEmit` | clean |
| backend `nest build` | ok |
| backend unit `jest --runInBand` | 1269 pass, **77 fail in 13 historical `voice/vnext` suites** (phase42, 43, 47, 471, 4710, 4711, 474, 475, 476, 478, 479, vnext.integrity, vnext). Pre-existing; they assert removed V1 mechanisms (`npm run test:vnext:historical`). |
| backend structured voice `npm run test:vnext:structured` | 224 / 224 (18 suites) |
| backend API e2e `npm run test:e2e` | 132 pass, **5 fail in `voice-agent.e2e-spec.ts` (A-VOI-020…024: planner answers `refuse`)**. Pre-existing. |
| frontend `tsc --noEmit` | clean |
| frontend jest | 298 / 298 (58 suites) |
| frontend `webpack` build | ok (2 size warnings) |

Script used: scratchpad `baseline.sh` (runs all of the above); rerun after each stage and compare.

## Investigation notes (stage 0)

- **Schema:** dimensions are already separate columns. Coupling lives in code and UI.
- **Backend placement:** a fixed task (single or series day) is an `anchor`; a flexible series day is a movable `series` seat (detaches). Window semantics differ by recurrence on purpose (From/Until is the series span, not a placement window).
- **Frontend:** almost every classifier picks one kind with `isRecurring` winning, so a fixed series shows as plain "Recurring"; copies classify inconsistently (`seriesGroupId` vs `isRecurring`). Only the task form and `summarizeStoredTask` show both.
- **Voice (live structured path):** creates go through `vnext/state/project-apply.ts` `projectCreate`; `vnext/adapter/adapter.ts` is not on the live path. `projectCreate` sets `eventType` only for all-day; `spanRole: 'event'` is ignored, so "standup every Monday 10–11" is created flexible. A `preferred` clock becomes `unresolved` and is refused. Previews (`changePreviewCards.ts`) collapse fixed+recurring into "recurring". Series scope: move supports occurrence / from_day / all via `move-event`; update supports `all` only.
- **PE-30:** `IntelligentSchedulingEngine` is only injected for `captureAutoSegmentsSnapshot`, used only by `undoLastGenerate` (no callers outside its spec). `POST/PATCH/DELETE /schedule` have no frontend / Playwright / voice callers; backend e2e seeds slots through them in `schedule.e2e-spec.ts`, `tasks.e2e-spec.ts:369`, `google-iso.e2e-spec.ts:167` (that one also calls the removed `POST /schedule/generate`).

## Stage results

- **Stage 1** — backend unit 1270 pass / same 77 historical fails; e2e 132 / same 5 voice fails; frontend 304/304; builds ok. Intentional test change: task-list Flexible filter now includes flexible series and their copies (behavior and recurrence are independent filters); chip kind for a series is its behavior + repeat marker.
- **Stage 2** — backend unit 1216 pass / same 77 historical fails (−54 = deleted specs of removed code: engine `run` ~40, undo snapshot, warning utils, job-service wipe/undo; live-helper tests moved to `planning-horizon.util.spec.ts` unchanged + one DST case); structured voice 224/224; e2e 132 / same 5; frontend 304/304. A-SCH-001…004/008 replaced by a 404 contract test (raw slot writes removed); A-SCH-005/007 keep the GET checks with a repository-seeded slot. `ScheduleJob.undoSnapshotJson` / `undoConsumedAt` columns are kept (schema sync would drop data).

- **Stage 3** — backend unit 1223 pass / same 77 historical fails; e2e 132 / same 5; structured voice 224/224; frontend 304/304. Two mocked move tests that mirrored the old call order (`skipOccurrence` then `create`) were replaced by real SQLite tests in `series-exception.spec.ts`; ProblematicPlace spec now fakes `writeAndPlace` with snapshot/rollback and asserts the rollback, not the old compensation.
- **Stage 4** — backend unit 1225 pass / same 77 historical fails; e2e 132 / same 5; structured voice 224/224; frontend 304/304.

## Decisions (stages 3–4)

5. **`writeAndPlace` instead of an outbox.** The rows a change writes and the placement are one DB transaction under the user lock; an unwanted plan throws inside the transaction (rollback). External calendars are read before the transaction; Google syncs are collected and sent after commit (`inOneTransaction` already defers them). There is no in-memory callback between a committed write and its placement any more for these three operations. A Google failure after commit leaves the committed state; a retry is idempotent (copy found by `seriesGroupId` + `originalOccurrenceYmd`; tail series found by group + From = split day). No new table or job type was needed.
6. **`moveSeriesDay` behavior change:** onto an anchor it now rolls back completely and reports the conflict on its mutation job (before: the day was already skipped and the copy was left to a background create job). A full day still parks the copy, as before.
7. **Still not durable (documented risk):** `TasksService.update/create` save the task, then `queuePlaceAndSync` places it in a background promise. A crash in between leaves a saved task without a slot until the next edit. Not changed in this refactor; candidate for a reconcile pass in the background tick.
8. **PE-27:** the external-calendar snapshot lives for one `seatOpenHoles` pass or one `writeAndPlace` call only; cached seats are copied per placement because placement clips seat windows in place. Drag lookup: slots matching the event id, the voice `slotId`, or a start within `SLOT_MATCH_MS` (60 s) of the dragged block, plus tasks behind them or with the dragged event id.

## Working rules learned

- Stage files explicitly (`git add <paths>`); never `git add -A` — the tree holds another chat's uncommitted files. (A first stage-2 commit swept them in and was redone with `git reset --soft` before anything was pushed.)
- Bash mangles backticks in inline `node -e` / heredoc strings: put scripts in the scratchpad and run them, or use the Edit tool.

## Decisions (continued)

3. **PE-30 scope** — besides `run`, `ScheduleJobService` lost every member only reachable from it (undo of Generate, warnings → Problematic/Unscheduled, Google replan reconcile, wipe range). Remaining job service: mutation-job lifecycle, `processNextPending` (marks leftovers failed), `deleteSyncedGoogleEventsForTask`.
4. **Found in stage 2 for stage 3:** `TasksService.skipOccurrence` refuses every fixed task, so a day of a fixed series cannot be skipped or dragged alone (`moveSeriesDay` skips first). Fix: refuse only fixed one-offs.

## Decisions (stages 5–6)

9. **Voice semantics** (spec rules 1–3, structured path `vnext/state/project-apply.ts`): clock role `start` = promised (fixed for a one-off; end = start + duration when not given); a span that is the event (`start` + `end`, not `spanRole: window`) = fixed, also for a series; a repeat with only a clock = flexible series with that clock; role `preferred` = flexible preferred start (before: refused). Every create now sets `eventType` explicitly, so the preview card and the written task agree. A preferred clock on a non-create action is refused (`unrepresented_constraint`) instead of being dropped. The legacy parser (`voice-parse.util.ts`, roadmap §49) is unchanged: it still forces fixed → non-recurring; it only runs with `VOICE_TURN_ENGINE=legacy`.
10. **Lost-task invariant** counts a task whose placement returned a conflict sheet as "waiting for the user", not lost (spec: no answer → Problematic).

## Final status

All stages done. Branch `refactor/scheduling-domain`: 2148694 → 12b68ea → 4522ac2 → e6a4432 → 5b6bf7d → stage 6 commit. Nothing pushed; nothing merged into master.

Remaining risks / not done (also in `placement-engine.md` §12):
- Background placement after `TasksService.create/update` is an in-memory promise; a crash in between leaves a saved task without a slot.
- The user lock is per process.
- Slot row ids of a series day are not stable across horizon rewrites (identity = series + day).
- Voice behavior changes need a live-model run (roadmap §39): the prompt got two concept rules; offline goldens pass.
- Pre-existing failures unchanged: 13 historical `voice/vnext` suites (77 tests), 5 `voice-agent.e2e-spec.ts` cases.

## Current work

None — refactor complete. Next session: push the branch and open a PR after review, or continue with the risks above.
