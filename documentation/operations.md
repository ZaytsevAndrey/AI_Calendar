# Operations: scheduling queue, locks, Google sync

For whoever runs the backend (Render + Neon today). How the background work runs, what failure looks like, and what to do about it. Deployment and migrations are in [deploy.md](deploy.md#database-migrations).

## What runs in the background

Everything runs inside the one backend process. There is no separate worker to start.

| Loop | Interval | Table | What it does |
|------|----------|-------|--------------|
| `ScheduleJobProcessor` | 2 s | `schedule_jobs` | Claims due mutation jobs (task create / update / park / sync, flexible and series moves) and runs them. |
| `PendingGoogleWriteProcessor` | 60 s | `pending_google_writes` | Retries Google Calendar writes that failed, 20 rows per tick. |
| `RecurringExtendProcessor` | 1 h (each user at most every 20 h) | `tasks`, `scheduled_tasks` | Adds recurring days as the horizon moves forward; purges past parked copies. Logs `Appended missing series days for <n> user(s)`. |

A request that changes the schedule saves the task **and** its job row in one transaction, then starts the job immediately in the same process (`runNow`). If the process dies, the 2 s sweep picks the job up, on this instance or another.

## Mutation jobs (`schedule_jobs`)

Lifecycle: `pending` → `running` (claimed with a 2 min lease, `attempts + 1`) → `done` or `failed`.

- **Retry:** any error that is not a 4xx is retried with backoff 15 s, 30 s, 60 s, 120 s (cap 10 min), at most 5 attempts. While waiting the row is `pending`, `progressStage = 'retrying'`, `nextRunAt` set, `errorMessage` = last error.
- **Final failure:** after 5 attempts, or immediately on a 4xx (a refused request), `status = 'failed'`, `progressStage = 'error'`.
- **Crash:** a `running` row whose `leaseUntil` passed is claimed again by the sweep. A placement that already committed is not redone on retry (`payloadJson.placed = true`); only the Google sync step runs again.
- **Inline jobs** (`payloadJson.inline = true`) belong to their HTTP request. If that request died they are marked failed with "Interrupted before it finished", not re-run.

Log lines:

```
WARN  Mutation job <id> attempt <n> failed (<message>); retry in <ms> ms
ERROR Mutation job <id> failed after <n> attempts: <message>
ERROR Schedule job processor error: <error>
```

Inspect (Postgres):

```sql
-- Stuck or waiting work
SELECT id, "userId", status, "progressStage", attempts, "nextRunAt", "leaseUntil", "errorMessage", "updatedAt"
FROM schedule_jobs WHERE status IN ('pending', 'running') ORDER BY "updatedAt";

-- Recent final failures
SELECT id, "userId", "payloadJson", "errorMessage", "updatedAt"
FROM schedule_jobs WHERE status = 'failed' ORDER BY "updatedAt" DESC LIMIT 50;
```

**Recovery.** A failed job never changed anything it did not commit: the task row is saved, and a placement either fully committed or not at all. Usually the user retries from the UI (edit or drag again). To re-run one job after fixing the cause:

```sql
UPDATE schedule_jobs
SET status = 'pending', attempts = 0, "nextRunAt" = NULL, "leaseUntil" = NULL, "errorMessage" = NULL
WHERE id = '<job id>' AND status = 'failed';
```

The handlers are idempotent (they reload the task; a deleted task finishes with `{ gone: true }`). Do not reset inline jobs (`"payloadJson" LIKE '%"inline":true%'`): they will just fail again.

## Per-user lock

All placement for one user is serialized: in process by a promise chain, and across instances by a Postgres session advisory lock `pg_advisory_lock(hashtext('luefy:user:<userId>'))` on a separate pool of 4 connections. Startup logs `Postgres advisory user lock on (pool 4)`. A crashed process drops its connection and Postgres releases the lock.

See who holds or waits:

```sql
SELECT l.pid, l.granted, a.state, a.query_start, a.application_name
FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
WHERE l.locktype = 'advisory';
```

A lock held for minutes means a placement is hung (for example a slow database). Ending that backend releases it: `SELECT pg_terminate_backend(<pid>);`. The job then retries.

Limits: only 4 users can be placing at the same moment per instance; others wait for a lock connection. On SQLite (local) there is only the in-process chain.

## Google Calendar sync

Google follows the local schedule through one queue table, `pending_google_writes`, used as a **transactional outbox**. No Google call ever happens inside a database transaction, and a Google error never undoes the local schedule.

**How a change reaches Google**

1. A transaction changes tasks or slots (placement, displacement of neighbours, edit, skip, detach, series rewrite, delete). The `GoogleSyncOutboxSubscriber` notes every affected task; just before that transaction commits it writes, **in the same transaction**, one `upsert` row per changed task and one `delete` row per event of a removed task. Commit and intent are atomic: a rollback drops both, a crash after the commit leaves the rows. Rows are written only for users with a stored Google grant.
2. Right after the commit the rows are sent at once (claim → send) in the background. If the process dies first, `PendingGoogleWriteProcessor` (every 60 s, any instance) sends them once their 2-minute grace has passed.
3. A send reads the task's **current** state, so a replayed or late row never writes an old version. A task deleted meanwhile has its event removed instead.

Row lifecycle (a sent row is deleted):

| Status | Meaning |
|--------|---------|
| `pending` | Waiting; due when `nextRunAt` is empty or past (a send right after the commit does not wait). |
| `running` | Claimed by one instance (compare-and-set on the row) until `leaseUntil` (2 min). A row whose lease passed was held by a dead process and is taken over. |
| `failed` | Terminal after 8 attempts (backoff 1, 2, 4 … min, capped at 60 min; about 2 h in all). Kept with `lastError`; revived automatically on reconnect (below). |

- **One row per task (upsert) / per event (delete).** A later change to the same task refreshes the row (`revision` + 1, `enqueuedAt` = time of that change); a failed row gets a fresh set of attempts.
- **Changes during a send:** a worker deletes the row only for the revision it claimed; otherwise the row goes back to `pending` and the sender sends it again at once (up to 5 rounds), then the sweep.
- **Fairness:** each sweep sends at most 20 rows and at most 5 per user, users interleaved, fewest attempts first.
- **No duplicate events:** before a Google insert, the task gets `googleInsertEventId` (stored first, shared by every retry and instance), sent as the event id. An insert whose answer was lost but which succeeded is answered 409 on retry, and that event is taken. A `cancelled` (deleted before linking) id is dropped and replaced.
- **No stale overwrites:** after a Google call only the link columns (`googleEventId`, `googleEventCalendarId`, `googleInsertEventId`, slot links) are written; a pulled Google edit writes only the pulled columns.
- **Deletes never remove live data:** a delete row is skipped if any task or slot uses that event again.
- **Not connected / revoked:** rows wait as `pending` without spending attempts and without Google calls (the connection check is cached: 30 s when working, 10 min when down, per instance).
- **Reconnect recovery (automatic):** when the user connects Google again (Settings → connect, or Google sign-in), that user's `pending` rows become due at once and `failed` rows get a fresh set of attempts, then they are sent. Upserts send the current task state; deletes keep their intent and still skip events in use. A grant that keeps failing ends `failed` again after 8 attempts, with its error.

```sql
-- Waiting and failed writes
SELECT id, "userId", operation, status, attempts, "nextRunAt", "lastError", "enqueuedAt"
FROM pending_google_writes ORDER BY status, attempts DESC, "enqueuedAt" LIMIT 50;

-- Manual: send a failed row again (normally done by reconnect recovery)
UPDATE pending_google_writes
SET status = 'pending', attempts = 0, "nextRunAt" = NULL, "leaseUntil" = NULL
WHERE id = '<row id>' AND status = 'failed';
```

Deleting a `failed` row is also safe: the local task is unaffected; the next change of that task queues it again.

**What the app does not do (by design, today):** it does not subscribe to Google push notifications (no `events.watch` / channels, no webhook endpoint), so duplicate or out-of-order notifications cannot occur. Google-side edits are read when the calendar is displayed and when a write that waited longer than 2 minutes finds the remote event edited after the last local change (the remote edit wins and is copied onto the task). An event deleted in Google is unlinked from its task on the next write (the task and its slot stay); with the "sync Google deletions" setting on, the task is deleted instead. See [known-issues.md](known-issues.md) KI-05, KI-06, KI-08.

Google Calendar API limits that shape this:

- Client-chosen event ids must be base32hex (`0-9 a-v`), 5–1024 characters, unique per calendar; a deleted event keeps its id (status `cancelled`), so an id is never reused after a deletion.
- An insert with an existing id answers 409; that is how a lost insert answer is recognized.
- Rate limits (403 `rateLimitExceeded` / 429) and 5xx are ordinary failures here: retried with backoff, then `failed`.
- A recurring series is one Google event with RRULE; skipped days are `EXDATE`s, detached days are separate events. The DST rule matches Google's: a series clock that does not exist on a switch day is shown an hour later that day (see placement-engine.md §7.1).

These behaviors are verified against a fake Google in tests, not against the real API ([known-issues.md](known-issues.md) KI-03).

## Duplicate requests (Idempotency-Key)

`POST /tasks` with `Idempotency-Key` records the operation in `request_idempotency` (user, operation, key, SHA-256 of the body, created task id), in the same transaction as the task. A replay with the same body returns the first task; another body is 422; a deleted task is 410 and is not re-created. Records are kept 30 days and purged lazily per user on the next keyed create; account deletion removes them.

```sql
SELECT key, operation, "resourceId", "createdAt" FROM request_idempotency WHERE "userId" = '<user id>' ORDER BY "createdAt" DESC LIMIT 20;
```

## Logs worth alerting on

| Line | Meaning |
|------|---------|
| `Mutation job … failed after 5 attempts` | A schedule change could not finish. Check `errorMessage`. |
| `Schedule job processor error` | The sweep itself failed (usually the database). |
| `Pending Google write tick error` | The Google retry loop failed (usually the database). |
| `Google outbox send failed` / `Reviving Google writes for … failed` | The send right after a commit or a reconnect revival failed; the sweep retries. |
| `Pending Google … failed after 8 attempts` | A Google write gave up. Check `lastError`; revive or delete the row. |
| `Recurring extend tick error` | Recurring days were not appended this hour. |
| `Pending Google … attempt n failed` | One Google write failed and will retry. Normal in small numbers. |
| TypeORM migration errors at boot | The deploy stopped before serving. See [deploy.md](deploy.md#database-migrations). |
