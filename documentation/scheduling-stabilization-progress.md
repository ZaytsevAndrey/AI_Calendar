# Scheduling stabilization — progress

Handoff file for the stabilization program (29 Oct 2026 brief, parts A–J). Read this first; the refactor before it is in [scheduling-refactor-progress.md](scheduling-refactor-progress.md), the engine in [placement-engine.md](placement-engine.md).

## Branch and baseline

- Branch `stabilize/scheduling` from `refactor/scheduling-domain` HEAD `42f91d6` (verified: all checks below run on that commit).
- Not ours, uncommitted, never stage: `BUGS-AND-IMPROVEMENTS.md`, `backend/.env.example`, `backend/src/modules/day-reminders/day-reminders.module.ts`, `backend/src/modules/voice/azure-stt*.ts`, the other chat's restructure inside `documentation/roadmap.md`. Stage files by explicit path only.
- Verification script: scratchpad `baseline.sh` (backend tsc + build + unit + e2e, frontend tsc + jest + build) plus `npm run test:vnext:structured`.

| Check | Baseline (42f91d6) |
|-------|--------------------|
| backend tsc / build | clean / ok |
| backend unit | 1236 pass, 77 fail (13 historical `voice/vnext` suites) |
| backend structured voice | 232 / 232 |
| backend API e2e | 132 pass, 5 fail (`voice-agent.e2e-spec.ts` A-VOI-020…024, planner answers `refuse`) |
| frontend tsc / jest / build | clean / 304 / ok |

Runtime assumptions found: production runs one Render instance, Neon Postgres, `TYPEORM_SYNC=true` (schema by synchronize). Local dev and all tests use SQLite. Docker Desktop is installed but its daemon is not running (needed only to verify Postgres migrations). `backend/.env` has `VOICE_LLM_PROVIDER=deepseek` and LLM keys (live voice eval is possible; cost noted per run).

## Active paths

- Placement: `PlacementStepService` (`place`, `writeAndPlace`, `seatOpenHoles`, horizon, append), callers `TasksService`, `DisplayedEventMoveService`, `ProblematicPlaceService`, `RecurringExtendProcessor`.
- Mutation progress: `schedule_jobs` rows (`ScheduleJobService.beginMutationJob` / `setMutationStage` / `complete` / `fail`), polled by the frontend (`waitForScheduleJob` keeps polling while `pending` or `running`, throws on `failed`).
- Voice: structured pipeline `POST /voice/turn` (`StructuredVoiceService`, `vnext/state/project-apply.ts`); legacy planner only with `VOICE_TURN_ENGINE=legacy` (roadmap §49).
- Google: `PendingGoogleWriteService` with its own durable retry table `pending_google_writes` and processor.

## Findings (stage 0)

- **A — fire-and-forget placement:** `TasksService.create` / `update` save the task, then create a mutation job in a separate statement and run placement in an unawaited promise (`queuePlaceAndSync`, the park follow-up, `finishSaved`). `DisplayedEventMoveService.runFlexibleMoveJob` / `runSeriesMoveJob` are the same. A restart between save and placement leaves a saved task without a slot and a job stuck in `running` forever. `ScheduleJobProcessor` only fails leftover legacy `pending` rows.
- **B — locks:** `withUserLock` is an in-process promise chain; no cross-instance coordination.

## Plan (stages)

| # | Stage | Status | Commit |
|---|-------|--------|--------|
| 0 | Baseline, branch, findings, this file | done | — |
| 1 | A: durable mutation jobs (atomic with the state change, lease + claim, bounded retry with backoff, terminal failures, recovery sweep, idempotent handlers) | done | ead5ac6 |
| 2 | B: cross-instance user lock (Postgres advisory lock), transaction audit fixes | done | (stage B commit) |
| 3 | F1: root causes of the 5 voice e2e failures and the 13 historical suites | todo | |
| 4 | G: versioned migrations instead of `TYPEORM_SYNC=true` | todo | |
| 5 | C/D/E: historical identity tests, recurrence/temporal/placement edge tests, Google failure handling | todo | |
| 6 | F2 live voice eval, H frontend states, I/J docs and operations | todo | |

## Stage A — durable placement (done)

Design: the existing `schedule_jobs` table is the queue (no new infrastructure). New columns `attempts`, `nextRunAt`, `leaseUntil` + index `(status, nextRunAt)`. Status values stay `pending | running | done | failed` so the frontend poller needs no change (a retry is `pending` with a later `nextRunAt` and `progressStage: retrying`).

- **Atomic intent:** `TasksService.create/update` write the task (and, for a park, drop its open slots) and the job row in one transaction (`beginMutationJob(..., { manager })`). Moves create the job before any change; the job holds the whole drop (dto, ISO times, minutes, phases).
- **Execution:** `runNow(jobId)` (fast path in the request process) and `processDue()` (sweep every 2 s in `ScheduleJobProcessor`) both go through `claim`: one conditional UPDATE to `running` with a 2-minute lease and `attempts + 1`, so two workers never run the same attempt.
- **Handlers** (`registerHandler(op)`): `create`, `update`, `park`, `sync` (TasksService), `move_slot`, `move_series` (DisplayedEventMoveService). All idempotent; a deleted task finishes the job with `{ gone: true }`.
- **Outcomes:** done (result: conflicts / parked / gone), failed with message. A 4xx (`HttpException` < 500) is final; anything else retries with backoff 15 s · 2^(n−1), max 10 min, at most 5 attempts, then `failed`. A job whose lease expired (process died) is taken over by the sweep.
- **Inline jobs** (`{ inline: true }`, e.g. one series day moved inside its request with `writeAndPlace`) never run from the queue; if the request died they are marked failed ("Interrupted…").
- Tests: `mutation-jobs.spec.ts` (crash after commit, lease takeover, retry/backoff, bounded retries, 4xx final, no double run, deleted task, atomic task+job, interrupted inline). Spec fakes updated: `tasks.service.spec.ts`, `displayed-event-move.service.spec.ts` (payload JSON round trip like a stored row); the SQLite kit now uses the real `ScheduleJobService`.
- Results: backend unit 1245 pass / same 77 historical fails; structured voice 232/232; e2e 132 / same 5; frontend 304/304; builds ok.
- Not covered here: Google sync has its own durable table already; `seatResolvedLayer` (Place on top) still writes its slot in the request after the commit.

## Stage B — concurrency (done)

- `schedule/user-lock.ts`: `withUserLock` keeps the per-process promise chain and, on Postgres, also takes a session `pg_advisory_lock(hashtext('luefy:user:<id>'))` (`UserLockService`, registered in `ScheduleModule`). The lock connection comes from a dedicated pool of 4 so lock holders never wait for the pool their own work needs (no pool deadlock). One lock type, never nested → no lock-order deadlock. A dead process drops its connection and Postgres releases the lock. SQLite keeps the chain only (single process).
- Every placement write (`place`, `writeAndPlace`, `seatOpenHoles`, append, previews) and every job handler go through it, so API placement, the job sweep and the background append are serialized per user across instances. Job claiming is already cross-instance safe (conditional UPDATE).
- Transaction fix: `TasksService.skipOccurrence` removed the slot, called Google, then saved the skip — a crash in between lost the skip and the append re-created the day. Now slot drop + skip commit together and Google runs after the commit.
- Real Postgres 16 (Docker, `postgres:16-alpine` on port 55432) tests: `user-lock.pg.spec.ts` (same user serialized across two pools, other users not blocked, crashed holder releases, throw releases) and `mutation-jobs.pg.spec.ts` (4 jobs × 4 concurrent sweeps on two services → each runs once; lease takeover). Run: `PG_TEST_URL=postgres://postgres:test@localhost:55432/luefy DATABASE_URL=$PG_TEST_URL npx jest ".pg.spec"`. Without the env they are skipped (6 skipped in the default run).
- Results: backend unit 1245 pass + 6 skipped / same 77 historical fails; Postgres 6/6; structured voice 232/232; e2e 132 / same 5; frontend 304/304; builds ok.
- Not done: idempotency keys for repeated HTTP requests (creates are not deduplicated); Google sync keeps its per-task in-process lock (the Google write itself is idempotent per task: it reloads and upserts).

## Current work

Stage F1 (voice failures). Root cause of the 5 e2e failures found: `voice-agent.e2e-spec.ts` scripts the legacy orchestrator but `/voice/turn` defaults to the structured pipeline; the unit spec of that path sets `VOICE_TURN_ENGINE=legacy`, the e2e did not. CI (`.github/workflows/ci.yml`) runs `npm test` (includes the 13 historical suites → red) and never runs `test:vnext:structured`.
