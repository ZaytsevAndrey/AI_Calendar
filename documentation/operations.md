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

Google is written after the local change commits, never inside a database transaction. A Google error does not undo the local schedule: the write is stored in `pending_google_writes` and retried every minute (fewest-attempt rows first, so rows that keep failing do not block the others). The Google write reloads the task and upserts, so repeating it is safe.

```sql
SELECT "userId", operation, attempts, "lastError", "enqueuedAt"
FROM pending_google_writes ORDER BY attempts DESC, "enqueuedAt" LIMIT 50;
```

Known limits:

- No attempt cap or backoff on this table: a row that can never succeed (revoked access, a deleted calendar) is retried every minute forever. Remove it by hand once you know the cause; the local task is unaffected.
- Not safe with more than one instance (no claim/lease). Before scaling out, give it a lease like `schedule_jobs`.
- An expired or revoked Google token shows up as an auth error in `lastError` (Google's text, typically `invalid_grant`). Upserts stop being queued while the user is disconnected; deletes are still queued. The user must reconnect Google in Settings.

## Logs worth alerting on

| Line | Meaning |
|------|---------|
| `Mutation job … failed after 5 attempts` | A schedule change could not finish. Check `errorMessage`. |
| `Schedule job processor error` | The sweep itself failed (usually the database). |
| `Pending Google write tick error` | The Google retry loop failed (usually the database). |
| `Recurring extend tick error` | Recurring days were not appended this hour. |
| `Google sync failed for task …` | One Google write failed and was queued. Normal in small numbers. |
| TypeORM migration errors at boot | The deploy stopped before serving. See [deploy.md](deploy.md#database-migrations). |
