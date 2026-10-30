# Known issues

Permanent register of unresolved issues in scheduling, persistence, Google Calendar sync and (recorded only) the voice agent. Update it when an issue is found, changed or closed; close an entry only with code and test evidence (commit + test name).

Last full review: 2026-10-30, branch `stabilize/scheduling`. No Critical issue is known.

**Severity:** Critical — blocks release. High — fix before production rollout. Medium — accepted limitation or scheduled improvement. Low — non-blocking technical debt. External — cannot be verified in the local environment.

**Kind:** *defect* (wrong behavior) or *limitation* (behaves as designed; the design has a known gap).

## Summary

| ID | Title | Severity | Kind | Blocks |
|----|-------|----------|------|--------|
| [KI-01](#ki-01) | Neon migration rehearsal not performed | External | — | deployment |
| [KI-02](#ki-02) | Postgres CI job not yet run on GitHub | External | — | merge |
| [KI-03](#ki-03) | Real Google Calendar API behavior not verified | External | — | deployment |
| [KI-04](#ki-04) | Voice multi-turn quality below target | High | defect | voice rollout only |
| [KI-05](#ki-05) | Google edits are not continuously synchronized | Medium | limitation | neither |
| [KI-06](#ki-06) | A Google edit made within 2 minutes of a local change is overwritten | Medium | limitation | neither |
| [KI-07](#ki-07) | Criteria updates of schedule columns must call `noteGoogleSync` | Medium | limitation | neither |
| [KI-08](#ki-08) | Tasks created before a user connects Google are not back-filled | Medium | limitation | neither |
| [KI-09](#ki-09) | Changed form content after a lost response creates a second task | Medium | limitation | neither |
| [KI-10](#ki-10) | Legacy voice test suites excluded from the gate | Medium | defect (tests) | neither |
| [KI-11](#ki-11) | Historical detached copies with unknown day | Medium | limitation | neither |
| [KI-12](#ki-12) | Habit and day-reminder Google writes are not on the queue | Medium | limitation | neither |
| [KI-13](#ki-13) | SQLite (development) background writes can interleave with requests | Low | defect (dev only) | neither |
| [KI-14](#ki-14) | Two concurrent transactions can create two upsert rows for one task | Low | limitation | neither |
| [KI-15](#ki-15) | Connection state is cached per instance | Low | limitation | neither |
| [KI-16](#ki-16) | Hole refill after a delete runs after the commit | Low | limitation | neither |
| [KI-17](#ki-17) | Unused code kept: `GoogleCalendarService` in `ScheduleJobService`, undo columns | Low | debt | neither |
| [KI-18](#ki-18) | Slot row ids are not stable across a series rewrite | Low | limitation | neither |
| [KI-19](#ki-19) | English voice not evaluated on a live model | External | — | voice rollout only |

---

### KI-01

**Neon migration rehearsal not performed** — External.
- **Subsystem:** database migrations, deployment.
- **Behavior:** the four versioned migrations were verified only on local Postgres 16 (fresh database, upgrade from a database built by `TYPEORM_SYNC` from `master`'s entities with data, rerun, interrupted run). No Neon branch was available (no API key, `neonctl`, or connection string in the development environment).
- **Reproduce:** n/a.
- **Impact:** unknown Neon-specific differences (extensions, version, permissions) could stop the first boot; a failed migration stops the boot and the previous deploy keeps serving.
- **Mitigation:** migrations are additive and idempotent (`IF NOT EXISTS`); `uuid-ossp` is created by the baseline; boot fails closed.
- **Resolution:** run the Neon branch rehearsal in `deploy.md` → Database migrations ("Not verified: Neon", steps 1–5).
- **Source:** `backend/src/database/migrations/`, `backend/src/database/typeorm.config.ts`.
- **Tests:** `src/database/migrations.pg.spec.ts`.
- **Blocks:** deployment.

### KI-02

**Postgres CI job not yet run on GitHub** — External.
- **Subsystem:** CI.
- **Behavior:** `.github/workflows/ci.yml` has a `postgres:16-alpine` service and the step "Backend Postgres tests" (`npm run test:pg`); the same commands pass locally, but the workflow has not run remotely (no push in this work).
- **Impact:** a CI-only difference (service health, ports, timing) would surface only after push.
- **Mitigation:** the YAML parses; `test/require-pg-env.js` makes the step fail instead of skipping.
- **Resolution:** push the branch and check the job.
- **Source:** `.github/workflows/ci.yml`, `backend/package.json` (`test:pg`).
- **Tests:** all `*.pg.spec.ts`.
- **Blocks:** merge.

### KI-03

**Real Google Calendar API behavior not verified** — External.
- **Subsystem:** Google Calendar sync.
- **Behavior:** all Google tests use fakes. Assumed from Google's documentation and not checked against the API: an insert with an existing client-chosen id answers 409; a deleted event keeps its id with status `cancelled`; client ids in base32hex are accepted; per-call OAuth clients refresh correctly; RRULE/EXDATE rendering on DST days matches `localDateTimeIso` (02:30 → 03:30).
- **Impact:** if the 409 assumption is wrong, a retry after a lost insert answer could fail repeatedly (no duplicate is created, the row ends `failed`).
- **Mitigation:** failures are bounded (8 attempts) and visible (`failed`, `lastError`, error log).
- **Resolution:** a manual check with a test Google account: create, lose the answer (kill the process mid-insert), retry; delete and re-create; reconnect after revoking access; a daily 02:30 series in America/New_York across 14 Mar 2027.
- **Source:** `google-calendar/google-calendar.service.ts` (`createEvent` 409 path, `newOAuthClient`), `pending-google-write.service.ts` (`createTaskEvent`).
- **Tests:** `google-calendar.service.spec.ts`, `pending-google-write.queue.spec.ts`, `google-sync-outbox.spec.ts` (fakes).
- **Blocks:** deployment.

### KI-04

**Voice multi-turn quality below target** — High (voice phase; recorded only).
- **Subsystem:** voice agent (structured pipeline).
- **Behavior:** one live run (12 Ukrainian scenarios, `deepseek-flash`, 2026-10-29): 5/12 passed; multi-turn 0/5; 7 unnecessary clarifications, 4 intent errors; 0 unsafe turns, 0 server writes.
- **Impact:** users repeat themselves or are asked for details they gave; no wrong writes observed.
- **Mitigation:** confirm-before-write, structured gate (232 tests).
- **Resolution:** voice phase (roadmap §39–§43).
- **Source:** `backend/src/modules/voice/vnext/`.
- **Tests:** `npm run test:vnext:structured`; live: `vnext/eval/phase47-generalization-cli.ts`.
- **Blocks:** voice rollout only; not this branch.

### KI-05

**Google edits are not continuously synchronized** — Medium, limitation.
- **Subsystem:** Google sync (inbound).
- **Behavior:** the app has no Google push subscription (`events.watch`, channels). Google-side edits are read when the calendar is displayed, and by the queue when a write that waited finds the remote event edited after the last local change (the remote edit wins and is copied onto the task). An event deleted in Google is unlinked on the next write (or the task deleted with "sync Google deletions").
- **Reproduce:** edit an app event in Google; the task row keeps the old time until the next display/write.
- **Impact:** placement can use a stale time for that task until then.
- **Mitigation:** display reads Google; duplicate/out-of-order notifications cannot occur (none are received).
- **Resolution:** a watch channel + incremental `syncToken` reconciliation (new design work).
- **Source:** `google-calendar/pending-google-write.service.ts` (`processUpsert`, `pullGoogleOntoTask`).
- **Tests:** `pending-google-write.service.spec.ts` "drops a pending upsert and pulls Google when the user edited after enqueue".
- **Blocks:** neither.

### KI-06

**A Google edit made within 2 minutes of a local change is overwritten** — Medium, limitation.
- **Subsystem:** Google sync.
- **Behavior:** a queue row sent within the lease (2 min) of its last local change does not read the remote event first (saves a Google call per write); local state wins.
- **Reproduce:** change a task in the app and the same event in Google within 2 minutes.
- **Impact:** the Google edit is lost; the app's version is shown in both.
- **Mitigation:** writes that waited (retries, reconnect) do read and keep a newer Google edit.
- **Resolution:** compare `updated` on every send (one more read per write) or use ETags (`If-Match`).
- **Source:** `pending-google-write.service.ts` (`processUpsert`, `waited`).
- **Tests:** `pending-google-write.service.spec.ts` (pull case).
- **Blocks:** neither.

### KI-07

**Criteria updates of schedule columns must call `noteGoogleSync`** — Medium, limitation.
- **Subsystem:** Google outbox.
- **Behavior:** the outbox subscriber sees entity saves/removes and inserts; a criteria `update`/`delete` (`repo.update({ id }, …)`, query-builder delete) carries no entity id, so its call site must call `noteGoogleSync(manager, taskId)`. The three such sites today do (`placement-step.service.ts` `deleteOpenSlots`, `tasks.service.ts` resolved/revert updates).
- **Reproduce:** a new criteria update of a schedule column without the call → no queue row for that change.
- **Impact:** Google stays stale until the task's next change.
- **Mitigation:** documented here and in `placement-engine.md` §10; the queue's own link updates are deliberately invisible.
- **Resolution:** a lint rule or a repository wrapper for task/slot criteria writes.
- **Source:** `google-calendar/google-sync-outbox.ts`, `google-sync-outbox.subscriber.ts`.
- **Tests:** `google-sync-outbox.spec.ts`.
- **Blocks:** neither.

### KI-08

**Tasks created before a user connects Google are not back-filled** — Medium, limitation (unchanged behavior).
- **Subsystem:** Google sync.
- **Behavior:** queue rows are written only for users with a stored Google grant. Tasks that existed before the first connection reach Google on their next change.
- **Impact:** the calendar in Google is incomplete right after connecting.
- **Resolution:** on first connect, queue an upsert for every open task of the user.
- **Source:** `google-sync-outbox.ts` (`usersWithGoogle`).
- **Tests:** `google-sync-outbox.spec.ts` "users without a Google grant get no queue rows".
- **Blocks:** neither.

### KI-09

**Changed form content after a lost response creates a second task** — Medium, limitation.
- **Subsystem:** idempotent create (SPA).
- **Behavior:** the SPA reuses an Idempotency-Key only for identical content; edited content is a new operation (the server refuses one key with two bodies, 422). If the first request created the task but its response was lost, and the user edits the form and saves again, a second task is created.
- **Impact:** a duplicate the user can see and delete.
- **Resolution:** after a lost response, check `GET /schedule-jobs/:id` or the task list before allowing an edited resubmit.
- **Source:** `frontend/src/utils/requestKey.ts`, `modules/events/hooks/useEventEditor.tsx`.
- **Tests:** `frontend/src/api/customBaseQuery.spec.ts`; backend `task-create-idempotency.spec.ts`.
- **Blocks:** neither.

### KI-10

**Legacy voice test suites excluded from the gate** — Medium (voice; recorded only).
- **Subsystem:** voice tests.
- **Behavior:** 13 historical `vnext` suites (292 tests: 215 pass, 77 fail) target the pre-4.1 contract and are excluded from `npm test`; they run with `npm run test:vnext:historical`. The legacy e2e cases run on the legacy engine.
- **Impact:** behaviors they named are covered by the active gate (see progress F1); porting is outstanding.
- **Resolution:** port to the 4.1 contract (voice phase), then roadmap §49.
- **Source:** `backend/jest.vnext-historical.config.js`, `backend/package.json`.
- **Tests:** `npm run test:vnext:historical`.
- **Blocks:** neither.

### KI-11

**Historical detached copies with unknown day** — Medium, limitation.
- **Subsystem:** series occurrence identity.
- **Behavior:** seated copies made before `tasks.originalOccurrenceYmd` existed have no recorded day (migration backfills only parked copies from `problematicDay`). They never re-merge into their series and are not matched by day.
- **Impact:** such a copy stays a separate event; dragging it onto the series clock does not merge it back.
- **Mitigation:** identity is never guessed (no wrong merge).
- **Resolution:** none planned (data from before the column cannot be recovered reliably).
- **Source:** `migrations/1761760000000-SchedulingQueueAndOccurrenceIdentity.ts`, placement re-merge.
- **Tests:** `scheduling-workflows.spec.ts` C1.
- **Blocks:** neither.

### KI-12

**Habit and day-reminder Google writes are not on the queue** — Medium, limitation.
- **Subsystem:** habits, day reminders (outside scheduling).
- **Behavior:** `habits.service.ts` and `day-reminders.service.ts` call `GoogleCalendarService.createEvent/deleteEvent` directly; a failure is not retried by the queue.
- **Impact:** a habit/reminder event can be missing or orphaned in Google after a Google error.
- **Resolution:** route them through `pending_google_writes` (new operation types).
- **Source:** `habits/habits.service.ts`, `day-reminders/day-reminders.service.ts`.
- **Tests:** their own specs (direct calls).
- **Blocks:** neither.

### KI-13

**SQLite (development) background writes can interleave with requests** — Low, defect (development only).
- **Subsystem:** local development database.
- **Behavior:** SQLite has one connection; a background write (job sweep, queue kick for a Google-linked user) issued while a request transaction is open joins or splits that transaction.
- **Reproduce:** local SQLite with a connected Google account, rapid edits.
- **Impact:** sporadic local errors; production (Postgres pool) is not affected.
- **Mitigation:** outbox rows are written inside the request's own transaction; nothing is queued or kicked for users without Google (e2e).
- **Resolution:** use Postgres locally when testing Google sync.
- **Tests:** e2e (138/138 on SQLite).
- **Blocks:** neither.

### KI-14

**Two concurrent transactions can create two upsert rows for one task** — Low, limitation.
- **Subsystem:** Google queue.
- **Behavior:** `recordGoogleWrite` looks up the task's upsert row, then inserts; two transactions committing at the same moment can both insert (no unique index on upserts).
- **Impact:** the task is sent twice (idempotent: each send reads the current state; creates share `googleInsertEventId`, so no duplicate event).
- **Resolution:** partial unique index `(userId, taskId) WHERE operation = 'upsert'` with an upsert statement.
- **Source:** `google-sync-outbox.ts` (`recordGoogleWrite`).
- **Tests:** `google-sync-outbox.spec.ts` (replays), `pending-google-write.queue.spec.ts` (two instances one event).
- **Blocks:** neither.

### KI-15

**Connection state is cached per instance** — Low, limitation.
- **Subsystem:** Google queue.
- **Behavior:** a working connection is trusted for 30 s, a failed one for 10 min (avoids a token refresh per row per pass for revoked users). A reconnect clears the cache only on the instance that handled it; other instances may wait up to 10 min.
- **Impact:** delayed sends on other instances after a reconnect (the reconnecting instance sends at once).
- **Source:** `pending-google-write.service.ts` (`connected`, `reviveForUser`).
- **Tests:** `google-sync-outbox.spec.ts` (reconnect cases).
- **Blocks:** neither.

### KI-16

**Hole refill after a delete runs after the commit** — Low, limitation.
- **Subsystem:** placement.
- **Behavior:** `TasksService.remove` commits the removal, then calls `seatOpenHoles`; a crash in between leaves parked tasks waiting for the next placement pass.
- **Impact:** a parked task is not auto-seated into the freed time until the next placement for that user.
- **Source:** `tasks/tasks.service.ts` (`remove`).
- **Blocks:** neither.

### KI-17

**Unused code kept** — Low, debt.
- `ScheduleJobService` still injects `GoogleCalendarService` (no use after the outbox; removing changes constructor wiring in tests).
- `ScheduleJob.undoSnapshotJson` / `undoConsumedAt` unused (dropping them deletes data).
- **Source:** `schedule/schedule-job.service.ts`, `schedule/entities/schedule-job.entity.ts`.
- **Blocks:** neither.

### KI-18

**Slot row ids are not stable across a series rewrite** — Low, limitation.
- **Behavior:** rewriting a series horizon deletes and re-creates slot rows; the stable identity of a series day is series + civil day, not `scheduled_tasks.id`.
- **Source:** `schedule/placement-step.service.ts`.
- **Blocks:** neither.

### KI-19

**English voice not evaluated on a live model** — External (voice; recorded only).
- **Behavior:** the only live set is Ukrainian; no English live scenarios exist.
- **Resolution:** add an English live set (voice phase).
- **Blocks:** voice rollout only.

## Closed in this branch (evidence)

| Issue | Fix | Test |
|-------|-----|------|
| Post-placement Google intent written after the commit (crash window) | `3c1900b` outbox in the same transaction | `google-sync-outbox.spec.ts` "a rolled-back transaction…", "a crash right after the commit…"; `placement.pg.spec.ts` outbox case |
| Idempotency-Key freed when its task was deleted | `f7a4f09` `request_idempotency` | `task-create-idempotency.spec.ts` "…deleted is Gone (410)…"; e2e A-TSK-031 |
| Failed Google writes needed manual SQL after reconnect | `3c1900b` `reviveForUser` on reconnect | `google-sync-outbox.spec.ts` "reconnect recovery" |
| Stale full save after a Google call overwrote concurrent edits | `3c1900b` column-only link updates | `google-sync-outbox.spec.ts` "a change made while its row is being sent…" |
| Task delete swallowed Google delete failures (orphan events) | `3c1900b` delete rows in the removal transaction; `0706bfa` dead helper removed | `google-sync-outbox.spec.ts` "deleting a task queues the delete…" |
| Several failed deletes of one task collapsed into one queue row | `3c1900b` delete rows keyed by event id | `google-sync-outbox.spec.ts`, `pending-google-write.queue.spec.ts` partial delete |
| OAuth client shared across users | `85188d4` | `google-calendar.service.spec.ts` |
| Duplicate Google event after a lost insert answer | `0c34220` | `pending-google-write.queue.spec.ts` |
| DST wall clock off by an hour on switch days | `794a8f6` | `dst-clock.spec.ts`, `placement-edge-cases.spec.ts` |
