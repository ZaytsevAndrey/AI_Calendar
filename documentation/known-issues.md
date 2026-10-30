# Known issues

Permanent register of unresolved issues in scheduling, persistence, Google Calendar sync and (recorded only) the voice agent. Update it when an issue is found, changed or closed; close an entry only with code and test evidence (commit + test name).

Last full review: 2026-10-30, branch `stabilize/scheduling`, after the audit remediation (AUD-001…AUD-027, H-1…H-5; per-item evidence in [audit-remediation-progress.md](audit-remediation-progress.md)). No Critical issue is known. Risk view with release gates, security kinds and remediation order: [security-and-residual-risks.md](security-and-residual-risks.md).

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
| [KI-09](#ki-09) | Changed form content after a lost response creates a second task | Medium | limitation | neither |
| [KI-10](#ki-10) | Legacy voice test suites excluded from the gate | Medium | defect (tests) | neither |
| [KI-11](#ki-11) | Historical detached copies with unknown day | Medium | limitation | neither |
| [KI-12](#ki-12) | Habit and day-reminder Google writes are not on the queue | Medium | limitation | neither |
| [KI-13](#ki-13) | SQLite (development) background writes can interleave with requests | Low | defect (dev only) | neither |
| [KI-15](#ki-15) | Connection state is cached per instance | Low | limitation | neither |
| [KI-16](#ki-16) | Hole refill after a delete runs after the commit | Low | limitation | neither |
| [KI-17](#ki-17) | Unused code kept: `GoogleCalendarService` in `ScheduleJobService`, undo columns | Low | debt | neither |
| [KI-18](#ki-18) | Slot row ids are not stable across a series rewrite | Low | limitation | neither |
| [KI-19](#ki-19) | English voice not evaluated on a live model | External | — | voice rollout only |
| [KI-20](#ki-20) | A crash between placement and its job's `placed` mark re-places on retry | Low | limitation | neither |
| [KI-21](#ki-21) | A series created on a DST switch day at a non-existent time keeps the shifted clock | Low | limitation | neither |
| [KI-22](#ki-22) | One placement still commits in several transactions | Low | limitation | neither |
| [KI-23](#ki-23) | Google update reads then writes (extra call; small race) | Low | limitation | neither |
| [KI-24](#ki-24) | Request bodies outside scheduling and settings are not validated | Medium | defect | neither |
| [KI-25](#ki-25) | A request waiting behind a stuck user lock fails after 60 s | Low | limitation | neither |
| [KI-26](#ki-26) | ~~A seated re-merged day loses `parentSeriesId`~~ — fixed (lineage survives seating) | — | closed | neither |
| [KI-27](#ki-27) | `PATCH /tasks/:id/status` accepts any status string | Low | defect | neither |
| [KI-28](#ki-28) | OAuth and app refresh tokens stored in plaintext | Medium | defect (security) | release gate G-5 (recommended) |
| [KI-29](#ki-29) | Account deletion without a Google grant leaves the app events in Google | Low | limitation | neither |

---

### KI-01

**Neon migration rehearsal not performed** — External.
- **Subsystem:** database migrations, deployment.
- **Behavior:** the six versioned migrations (fifth: `1761790000000-GoogleWriteQueueUniqueness`, AUD-011; sixth: `1761800000000-AdminConsoleSchema`, added at the merge with the admin console) were verified only on local Postgres 16 (fresh database, upgrade from a database built by `TYPEORM_SYNC` from `master`'s entities with data, rerun, interrupted run). No Neon branch was available (no API key, `neonctl`, or connection string in the development environment).
- **Reproduce:** n/a.
- **Impact:** unknown Neon-specific differences (extensions, version, permissions) could stop the first boot; a failed migration stops the boot and the previous deploy keeps serving.
- **Mitigation:** migrations are additive and idempotent (`IF NOT EXISTS`); `uuid-ossp` is created by the baseline; boot fails closed. Since AUD-026 (`19fe86b`) boots run migrations under the advisory lock `luefy:migrations` (one instance at a time); the fifth migration deletes duplicate queue rows (keeps the newest) before creating its unique indexes.
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
- **Behavior:** all Google tests use fakes. Assumed from Google's documentation and not checked against the API: an insert with an existing client-chosen id answers 409; a deleted event keeps its id with status `cancelled`; client ids in base32hex are accepted; per-call OAuth clients refresh correctly; RRULE/EXDATE rendering on DST days matches `localDateTimeIso` (02:30 → 03:30). Added by the audit remediation: a deleted event reads back as `cancelled` (H-2: update and read now treat it as deleted); a PUT of the event as read, with `conferenceDataVersion: 1`, keeps guests and conferencing (H-3); revoking the grant on disconnect makes the next sign-in (`prompt: select_account`) ask for consent and return a refresh token (AUD-013); the 30 s request timeout (AUD-007) is long enough for normal calls.
- **Impact:** if the 409 assumption is wrong, a retry after a lost insert answer could fail repeatedly (no duplicate is created, the row ends `failed`).
- **Mitigation:** failures are bounded (8 attempts) and visible (`failed`, `lastError`, error log).
- **Resolution:** a manual check with a test Google account: create, lose the answer (kill the process mid-insert), retry; delete and re-create; reconnect after revoking access; disconnect in the app, sign in again, confirm a refresh token is stored; add a guest and a Meet link in Google, edit the task, confirm both stay; delete an event in Google, edit the task; a daily 02:30 series in America/New_York across 14 Mar 2027.
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
- **Mitigation:** writes that waited (retries, reconnect) do read and keep a newer Google edit. Related residual of AUD-010: a Google edit made between a failed attempt and its retry is overwritten when the retry is sent within the lease of its re-queue (`enqueuedAt` is reset on each re-queue).
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
- **Mitigation:** documented here and in `placement-engine.md` §10; the queue's own link updates are deliberately invisible. Same rule for a change of only the `phases` link (H-5, `5dab408`): TypeORM writes junction rows without a task event; every current path also writes `phaseId` or syncs explicitly.
- **Resolution:** a lint rule or a repository wrapper for task/slot criteria writes.
- **Source:** `google-calendar/google-sync-outbox.ts`, `google-sync-outbox.subscriber.ts`.
- **Tests:** `google-sync-outbox.spec.ts`.
- **Blocks:** neither.

### KI-08

**Closed 2026-10-30** (`b7d296d`, AUD-013). Original: *Tasks created before a user connects Google are not back-filled* — Medium, limitation. A connect with no grant stored before (first connect, or reconnect after a disconnect) now queues an upsert for every open/future, recurring or event-holding task (`reconcileUser`). Test: `google-sync-outbox.spec.ts` "AUD-013 … an edit made while disconnected is sent" (same path). Original text kept below.

~~**Tasks created before a user connects Google are not back-filled** — Medium, limitation (unchanged behavior).~~
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
- **Related (AUD-024, `1f9a338`, fixed):** a key whose task was deleted (410) is now replaced, so the next Save creates; `createFromPayload` now sends a key; a replay finds its create job after any number of edits.
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
- **Impact:** a habit/reminder event can be missing or orphaned in Google after a Google error. (Day-reminder updates now go through the merged `updateEvent` of H-3, so they no longer drop guests added in Google.)
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

**Closed 2026-10-30** (`7781bff`, AUD-011). Original severity Low. Partial unique indexes (one upsert row per task, one delete row per event) and atomic revision updates; Postgres test with 20 concurrent writers on two connections. Original text kept below.

~~**Two concurrent transactions can create two upsert rows for one task** — Low, limitation.~~
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

### KI-20

**A crash between placement and its job's `placed` mark re-places on retry** — Low, limitation (AUD-018 part 2).
- **Behavior:** a create/update job places the task (placement commits in its own transactions), then records `placed: true` on the job. A crash in between makes the retry place again with the same options.
- **Impact:** with an unchanged schedule the same seat results (placement is idempotent); if other tasks changed meanwhile the task can move.
- **Why not superseded like drags:** skipping a create's placement because a newer job exists could leave a new task unseated.
- **Source:** `tasks/tasks.service.ts` (`placeAndSync`).
- **Blocks:** neither.

### KI-21

**A series created on a DST switch day at a non-existent time keeps the shifted clock** — Low, limitation (AUD-022 residual).
- **Behavior:** the client sends an instant; 02:30 on a spring-forward day arrives as 03:30 and cannot be told apart from a real 03:30. Series created on other days keep 02:30 (fixed in `35cd614`).
- **Source:** `schedule/placement-step.service.ts` (master clock).
- **Blocks:** neither.

### KI-22

**One placement still commits in several transactions** — Low, limitation (AUD-015 residual).
- **Behavior:** `placeUnlocked` persists the seat, expands series days and re-merges as separate transactions; each is atomic (parking a day and appending a day are one transaction each since `c4b1191`). A crash between them leaves a consistent but partial result that the next placement completes.
- **Source:** `schedule/placement-step.service.ts`.
- **Blocks:** neither.

### KI-23

**Google update reads then writes** — Low, limitation (H-3 fix).
- **Behavior:** `updateEvent` reads the event and PUTs it with the app-owned fields replaced. One extra `events.get` per update (quota); a guest added in Google between the read and the write is lost (no ETag precondition).
- **Resolution:** `If-Match` with the read ETag, retry on 412.
- **Source:** `google-calendar/google-calendar.service.ts` (`updateEvent`, `APP_OWNED_EVENT_FIELDS`).
- **Blocks:** neither.

### KI-24

**Request bodies outside scheduling and settings are not validated** — Medium, defect (NEW-01 residual).
- **Behavior:** `class-transformer` is not installed, so Nest's `ValidationPipe` never ran anywhere. Tasks, phases and schedule controllers now use `SchedulingValidationPipe` (`f915d86`); other modules (habits, day reminders, reminders, overlays, Google endpoints) still accept unvalidated bodies — invalid input can surface as 500. A grep found no other body spread into a save/merge besides user settings (fixed, NEW-02 `6d9bc94`); this was not a full audit of those modules.
- **Resolution:** install `class-transformer` and enable a global `ValidationPipe({ whitelist: true })`, or apply the scheduling pipe per controller.
- **Blocks:** neither.

### KI-25

**A request waiting behind a stuck user lock fails after 60 s** — Low, limitation (AUD-020).
- **Behavior:** the advisory lock wait is bounded by `lock_timeout` (`USER_LOCK_TIMEOUT_MS` = 60 s). The request then fails with a generic error (500); a job retries with backoff.
- **Source:** `schedule/user-lock.ts`.
- **Blocks:** neither.

### KI-26

**A seated re-merged day loses `parentSeriesId`** — closed.
- **Was:** a seated copy cleared `parentSeriesId` with the park metadata, so a copy forgot its series after seating.
- **Now:** lineage (`parentSeriesId`, `seriesGroupId`, `originalOccurrenceYmd`) is not park metadata and survives seating (`clearedParkColumns`). `DELETE /tasks/:id` keeps its previous scope on purpose: only parked (Problematic) copies go with the series; seated and completed day copies stay as tasks of their own.
- **Source:** `tasks/entities/task.entity.ts`, `tasks/tasks.service.ts`.

### KI-27

**`PATCH /tasks/:id/status` accepts any status string** — Low, defect (found 2026-10-30, by reading; not reproduced).
- **Behavior:** the controller reads `@Body('status') status: TaskStatus`; a TypeScript enum is a primitive to `SchedulingValidationPipe`, so the value is not validated and is saved as sent.
- **Impact:** an arbitrary status on the caller's own task (scoped by `userId`); placement treats unknown statuses as open.
- **Resolution:** a DTO with `@IsEnum(TaskStatus)`.
- **Source:** `tasks/tasks.controller.ts` (`updateStatus`), `common/scheduling-validation.pipe.ts`.
- **Blocks:** neither.

### KI-28

**OAuth and app refresh tokens stored in plaintext** — Medium, defect (security; found 2026-10-30, by reading).
- **Behavior:** `user.googleAccessToken`, `user.googleRefreshToken` and `user.refreshToken` (the app refresh JWT, matched by equality in `auth.service.ts`) are plain `text` columns.
- **Impact:** a database leak yields working Google grants and app sessions.
- **Mitigation:** storage encryption at the provider (Neon); the app refresh token rotates on use; disconnect revokes the Google grant.
- **Resolution:** encrypt OAuth tokens with an application key; store only a hash of the app refresh token.
- **Source:** `users/user.entity.ts`, `auth/auth.service.ts`.
- **Blocks:** release gate G-5 in [security-and-residual-risks.md](security-and-residual-risks.md) (recommended; the owner may accept it explicitly).

### KI-29

**Account deletion without a Google grant leaves the app events in Google** — Low, limitation (by reading).
- **Behavior:** `AccountDeletionService.purgeGoogleArtifacts` returns when the user has no stored grant (disconnected); local data is deleted, events and the app calendar stay in the user's Google account.
- **Resolution:** say so in the delete dialog, or ask to reconnect first.
- **Source:** `auth/account-deletion.service.ts`.
- **Blocks:** neither.

## Audit findings (2026-10-30)

Original severities from the audit; full evidence in [audit-remediation-progress.md](audit-remediation-progress.md).

| ID | Original | Status | Commit | Regression test |
|----|----------|--------|--------|-----------------|
| AUD-001 | High | fixed | 187973b | `pending-google-write.queue.spec` AUD-001 ×5; `google-calendar.service.spec` getEvent mapping |
| AUD-002 | High | fixed | 884aa06 | `placement-edge-cases.spec` AUD-002 |
| AUD-003 | High | fixed (duration part disproven: documented keep rule) | 78f56e0 | `placement-edge-cases.spec` AUD-003 |
| AUD-004 | High | fixed | 733d585 | `account-deletion.pg.spec` |
| AUD-005 | High | fixed | bf3fad6, 420a04a | `pending-google-write.pg.spec` AUD-005 |
| AUD-006 | High | fixed | f915d86 | e2e A-TSK-032 |
| AUD-007 | High | fixed | 356cebe | `mutation-jobs.pg.spec`, `pending-google-write.pg.spec` AUD-007 |
| AUD-008 | High | fixed | 4d8f7b8 | `placement-edge-cases.spec` AUD-008 ×4 |
| AUD-009 | High | fixed | 701ef20 | queue spec AUD-009 |
| AUD-010 | Medium | fixed (residual → KI-06) | 701ef20 | queue spec AUD-010 |
| AUD-011 | Medium | fixed (closes KI-14) | 7781bff | `pending-google-write.pg.spec` AUD-011 ×2 |
| AUD-012 | Medium | fixed | dc648ea | queue spec AUD-012 ×2 |
| AUD-013 | Medium | fixed in code (closes KI-08; Google side → KI-03) | b7d296d | `google-sync-outbox.spec` AUD-013 ×2; `google-calendar.service.spec` AUD-013 ×3 |
| AUD-014 | Medium | fixed | d26220c | `dst-clock.spec`, `placement-edge-cases.spec` AUD-014 |
| AUD-015 | Medium | fixed (residual → KI-22) | c4b1191 | `placement-edge-cases.spec` AUD-015 |
| AUD-016 | Medium | fixed | 486c45c | `placement-edge-cases.spec` AUD-016 |
| AUD-017 | Medium | fixed | 8d7a0f4 | `placement-edge-cases.spec` AUD-017 |
| AUD-018 | Medium | fixed part 1 (part 2 → KI-20) | a8645b3 | `placement-edge-cases.spec` AUD-018 |
| AUD-019 | Medium | fixed | 022f5c3 | `frontend/src/api/eventTasksApi.spec.ts`, `schedule.api.spec` |
| AUD-020 | Medium | fixed (limit → KI-25) | 081e1d2 | `user-lock.pg.spec` AUD-020 ×2 |
| AUD-021 | Low | fixed (residual → KI-26) | 8d7a0f4 | `placement-edge-cases.spec` AUD-021 |
| AUD-022 | Low | fixed (residual → KI-21) | 35cd614 | `placement-edge-cases.spec` AUD-022 |
| AUD-023 | Low | fixed | 356cebe | queue spec AUD-023 |
| AUD-024 | Low | fixed (KI-09 stays open) | 1f9a338 | `task-create-idempotency.spec` AUD-024; `frontend/src/utils/requestKey.spec.ts` |
| AUD-025 | Low | fixed | 63b0a70 | `mutation-jobs.pg.spec`, `mutation-jobs.spec` AUD-025 |
| AUD-026 | Low | confirmed, fixed | 19fe86b | `migrations.pg.spec` AUD-026 |
| AUD-027 | Low | fixed | d4f2157 | `placement-edge-cases.spec` AUD-027 |
| H-1 | hypothesis | confirmed, fixed | fd3433e | `google-sync-outbox.spec` H-1 |
| H-2 | hypothesis | fixed in code (Google side → KI-03) | ed35fd5 | `google-calendar.service.spec` H-2 ×2 |
| H-3 | hypothesis (likely Medium) | confirmed in code, fixed (limits → KI-23) | ed35fd5 | `google-calendar.service.spec` H-3 + partial edit |
| H-4 | hypothesis | confirmed, fixed | 701ef20, 7d023ca | `pending-google-write.pg.spec` H-4 |
| H-5 | hypothesis | ORM gap confirmed; no app path affected (rule → KI-07) | 5dab408 | `google-sync-outbox.spec` H-5 (guard) |
| NEW-01 | High (found) | fixed for scheduling (rest → KI-24) | f915d86 | e2e A-TSK-032 |
| NEW-02 | High (found) | fixed | 6d9bc94 | e2e A-SET-011 |

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
