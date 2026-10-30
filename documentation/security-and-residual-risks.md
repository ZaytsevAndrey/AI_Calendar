# Security and residual risks

Engineering risk register for Luefy after the scheduling stabilization and the October 2026 audit remediation (branch `stabilize/scheduling`, integrated into `master`). It says what is still open, how bad it is, what was actually reproduced, and what must be verified before a production rollout. Fixed items are listed separately and are **not** currently exploitable.

Last review: 30 October 2026. Sources: [known-issues.md](known-issues.md) (KI-xx), [audit-remediation-progress.md](audit-remediation-progress.md) (AUD-xxx, H-x, NEW-xx), architecture in [placement-engine.md](placement-engine.md), runbook in [operations.md](operations.md), migrations in [deploy.md](deploy.md#database-migrations), voice in [voice-agent-roadmap.md](voice-agent-roadmap.md).

**Kinds**
- **Confirmed vulnerability** — a security weakness seen in code (and, where stated, reproduced).
- **Confirmed limitation** — behaves as implemented; the design has a known gap.
- **Unverified hypothesis** — plausible, not reproduced; needs a check before it is closed or upgraded.
- **External assumption** — depends on Neon, Google or GitHub behavior that was not exercised.

**Severity** follows known-issues: Critical (blocks release) · High (fix before production rollout) · Medium · Low · External.

**Release gate** — must be resolved or explicitly accepted by the owner before real users get the service. A development priority on the Voice Agent MVP does not lift these gates.

---

## 1. Release gates (before any production rollout)

| # | Gate | Why | Evidence today | KI |
|---|------|-----|----------------|----|
| G-1 | Neon migration rehearsal on a branch of the production database | Six migrations ran only on local Postgres 16 | Local rehearsal (master-shaped database, two simultaneous boots) passed | KI-01 |
| G-2 | Postgres CI job green on GitHub | `npm run test:pg` passes locally only | Workflow file exists; not observed remotely | KI-02 |
| G-3 | Manual Google Calendar check with a test account | All Google behavior is tested with fakes (list in §4) | None against the real API | KI-03 |
| G-4 | Ownership and mass-assignment review of the controllers outside scheduling | Validation exists only on tasks / phases / schedule / user settings; two cross-user writes were found in this class (AUD-006, NEW-02) | A grep found no further body spread into a save; not a full review | KI-24 |
| G-5 | Decide on credential storage at rest | OAuth and app refresh tokens are plaintext columns | Confirmed by reading | KI-28 |
| G-6 | Voice Agent rollout gates (only if voice ships) | Live quality below target; Apply has no revision preconditions; session store is per instance | Live run 5/12 (29 Oct) | KI-04, KI-19, roadmap §42 |

G-4 and G-5 are recommendations made in this review; the owner may accept them in writing instead of fixing them. They are not to be silently dropped.

## 2. Open risk register

| ID | Risk | Kind | Severity | Impact | Reproduced? | Mitigation in place | Recommended remediation | Release gate | KI |
|----|------|------|----------|--------|-------------|---------------------|-------------------------|--------------|----|
| R-01 | Request bodies outside scheduling are not validated (`class-transformer` missing, so Nest's `ValidationPipe` never ran) | Confirmed vulnerability (input handling) | Medium | Invalid input surfaces as 500; any module that copies a body into an entity is open to mass assignment | Missing validation confirmed by reading; mass assignment **not** found outside the two fixed cases (grep only) | `SchedulingValidationPipe` on tasks / phases / schedule; identity keys dropped in tasks, phases, user settings | Install `class-transformer` and enable a global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`, or apply the scheduling pipe per controller; add an e2e cross-user test per module | G-4 | KI-24 |
| R-02 | Cross-user isolation of habits, day reminders, reminders, overlays, event phases, calendar providers, Google endpoints not reviewed | Unverified hypothesis | — (Medium if confirmed) | A module that loads by id without `userId`, or trusts an id from the body, would read or write another user's data | Not checked | JWT guard on every controller; services generally filter by `userId` | Review each controller/service pair; add a two-user e2e per module (pattern: `A-TSK-032`, `A-SET-011`) | G-4 | KI-24 |
| R-03 | Credentials at rest in plaintext: `user.googleAccessToken`, `googleRefreshToken`, `user.refreshToken` (app refresh JWT, looked up by equality) | Confirmed vulnerability (defense in depth) | Medium | A database leak (backup, replica, SQL access) yields working Google grants and app sessions | Confirmed by reading `users/user.entity.ts`, `auth/auth.service.ts`; not exploited | Neon encrypts storage at rest; app refresh token rotates on use; disconnect revokes the Google grant (AUD-013) | Encrypt OAuth tokens with an app key (KMS / env secret); store a hash of the app refresh token | G-5 | KI-28 |
| R-04 | `PATCH /tasks/:id/status` accepts any string (`@Body('status')` with an enum type is a primitive to the pipe) | Confirmed vulnerability (input validation) | Low | Arbitrary status values on the caller's own task; placement treats unknown statuses as open | Confirmed by reading; not reproduced | Own task only (`userId` filter) | `@IsEnum(TaskStatus)` DTO for the status body | No | KI-27 |
| R-05 | Account deletion while Google is disconnected leaves the app's events in the user's Google calendar | Confirmed limitation | Low | Data the user expects gone stays in their own Google account; local data is deleted | By reading `account-deletion.service.ts` (`purgeGoogleArtifacts` returns without a grant) | Deletion with a grant removes events and the app calendar first (fail closed) | Tell the user in the delete dialog; or require reconnect before delete | No | KI-29 |
| R-06 | Real Google behavior assumed (409 on reused insert id, `cancelled` for deleted events, merged PUT keeps guests with `conferenceDataVersion: 1`, revoke → consent → refresh token, 30 s timeout) | External assumption | External | A wrong assumption breaks sync for some edits; failures are bounded and visible (`failed`, `lastError`) | Fakes only | Bounded retries; deletion only on 404/410; local data never deleted on other errors (AUD-001) | Manual check list in KI-03 | G-3 | KI-03 |
| R-07 | Google update reads then writes: one extra call per update; a guest added between read and write is lost | Confirmed limitation | Low | Quota; rare lost guest | Reasoned from code | Read immediately before write | `If-Match` with the read ETag, retry on 412 | No | KI-23 |
| R-08 | Google edits are not continuously synchronized; an edit within 2 min of a local change is overwritten; an edit between a failed attempt and its retry can be overwritten | Confirmed limitation | Medium | Local state wins in those windows | Documented behavior | Waited writes read and keep newer Google edits | Watch channels + `syncToken`, or ETags | No | KI-05, KI-06 |
| R-09 | Habit and day-reminder Google writes bypass the queue | Confirmed limitation | Medium | Missing or orphaned events after a Google error | By reading | Day-reminder updates use the merged update (no lost guests) | Route through `pending_google_writes` | No | KI-12 |
| R-10 | Criteria updates and phases-only link changes need an explicit `noteGoogleSync` | Confirmed limitation | Medium | A future call site without it leaves Google stale until the next change | ORM gap reproduced (H-5); no current path affected | Documented; every current path writes `phaseId` or syncs | Repository wrapper or lint rule | No | KI-07 |
| R-11 | Crash between a placement commit and its job's `placed` mark re-places on retry | Confirmed limitation | Low | The task can move if the world changed meanwhile | Reasoned; not reproduced | Placement is idempotent for an unchanged schedule | Record `placed` inside placement's own transaction | No | KI-20 |
| R-12 | One placement commits in several transactions (persist, expand, re-merge) | Confirmed limitation | Low | A crash between them leaves a consistent partial result, completed by the next placement | Each step atomic (tested with fault injection, AUD-015) | — | Single transaction per placement where feasible | No | KI-22 |
| R-13 | Lock wait bounded at 60 s returns a generic 500 | Confirmed limitation | Low | A request behind a stuck holder fails; jobs retry | Tested (`user-lock.pg.spec`) | Failed unlock closes its connection | Map 55P03 to 503 with a retry hint | No | KI-25 |
| R-14 | Hole refill after delete runs after the commit | Confirmed limitation | Low | A parked task waits for the next placement pass after a crash | Reasoned | — | Job row for the refill | No | KI-16 |
| R-15 | Connection state cached per instance (up to 10 min after reconnect on other instances) | Confirmed limitation | Low | Delayed sends on other instances | Reasoned | The reconnecting instance sends at once | Shared cache or broadcast | No | KI-15 |
| R-16 | Duplicate task after a lost response when the user edits the form before resubmitting | Confirmed limitation | Medium | A visible duplicate | Reasoned | Same-content retries reuse the key; 410 rotates it (AUD-024) | Check the job / task list before an edited resubmit | No | KI-09 |
| R-17 | Series edge cases: DST-day creation at a non-existent time (KI-21); seated re-merged copy loses `parentSeriesId` (KI-26); historical copies without a day (KI-11); slot ids not stable (KI-18) | Confirmed limitations | Low–Medium | Wrong clock on one day; a copy not deleted with its series; copies that never re-merge; clients that store slot ids break | KI-21/KI-26 reproduced by reasoning; KI-11 by data | Identity is never guessed | See each KI | No | KI-11, KI-18, KI-21, KI-26 |
| R-18 | SQLite (development) background writes can interleave with requests | Confirmed limitation (dev only) | Low | Sporadic local errors | Observed locally | Production uses Postgres | Use Postgres locally for Google work | No | KI-13 |
| R-19 | Concurrency safety across instances verified only on local Postgres | External assumption | External | Neon pooling (PgBouncer in transaction mode) would break session advisory locks | Local Postgres 16 tests with separate pools | Render runs one instance today | Use a direct (non-pooled) Neon connection string for the backend, or confirm session pooling, before running more than one instance | Part of G-1 | KI-01 |
| R-20 | Voice Agent: live quality below target, legacy suites off the gate, English not evaluated, Apply without revision preconditions, in-memory session store | Confirmed limitations | High (voice) | Wrong or repeated dialogue; a stale preview applied over newer data; multi-instance sessions lost | Live run 5/12 | Confirm-before-write; structured gate 232 tests | [voice-agent-roadmap.md](voice-agent-roadmap.md) | G-6 (voice only) | KI-04, KI-10, KI-19 |
| R-21 | Unused code and columns kept (`GoogleCalendarService` in `ScheduleJobService`, undo columns) | Debt | Low | None functional | — | — | Remove with a migration when convenient | No | KI-17 |

## 3. Data integrity and concurrency — what is guaranteed today

Verified by tests on Postgres 16 with separate connection pools per "instance" (not Neon):
- One user's placements and task edits never interleave (advisory lock + in-process chain; edits under the lock, AUD-008).
- Mutation jobs and Google sends: each claimed by one worker; leases renewed by heartbeat; a worker whose lease was taken over cannot overwrite the newer outcome (AUD-007, AUD-023).
- One Google queue row per task and per event under 20 concurrent writers (AUD-011).
- Migrations run once when several instances boot together (AUD-026).
- Account deletion runs on Postgres and removes every user row in one transaction (AUD-004).

## 4. Google Calendar synchronization assumptions

Not exercised against the real API (KI-03, G-3):
1. An insert with an existing client-chosen id (`googleInsertEventId`, base32hex) answers 409; the existing event is then read and linked.
2. A deleted event reads back with status `cancelled` (or 404/410); the app treats both as deleted and never writes it back (H-2).
3. A PUT of the event as read, with `conferenceDataVersion: 1`, keeps attendees, conference data and attachments (H-3).
4. Revoking the grant on disconnect makes the next sign-in (`prompt: select_account`) show consent and return a refresh token (AUD-013).
5. Per-call OAuth clients refresh tokens correctly; 30 s request timeout is enough for normal calls.
6. RRULE / EXDATE rendering on DST days matches the local series (02:30 → 03:30 on spring-forward).

## 5. Previously fixed vulnerabilities (not currently exploitable)

| ID | Was | Fix | Regression test |
|----|-----|-----|-----------------|
| AUD-006 | Creating a task with another user's task `id` in the body overwrote that task; sync columns could be forged | `f915d86` validation pipe + identity keys dropped | e2e `A-TSK-032` |
| NEW-02 | `PATCH /user-settings` with another user's settings `id` updated that user's settings | `6d9bc94` identity keys dropped before merge | e2e `A-SET-011` |
| NEW-01 | No request validation anywhere (scheduling part) | `f915d86` | e2e `A-TSK-032` (rest open: R-01) |
| AUD-001 | Any Google error (429/5xx/401/403/network) could be read as "deleted in Google" and delete local tasks | `187973b` | `pending-google-write.queue.spec` AUD-001 |
| AUD-004 | Account deletion failed on Postgres (raw SQL), leaving the account | `733d585` | `account-deletion.pg.spec` |
| AUD-012 | Deleting a task after a lost insert answer left the event in Google | `dc648ea` | queue spec AUD-012 |
| AUD-013 | Edits/deletes while disconnected never reached Google; reconnect could lose the refresh token | `b7d296d` | `google-sync-outbox.spec` / `google-calendar.service.spec` AUD-013 |
| AUD-020 | A failed unlock returned a connection holding the user lock to the pool (user blocked on every instance) | `081e1d2` | `user-lock.pg.spec` AUD-020 |
| AUD-025 | Malformed job id → 500 (uuid cast) | `63b0a70` | `mutation-jobs.pg.spec` AUD-025 |
| H-1 | A rolled-back savepoint still queued deletes of live events | `fd3433e` | `google-sync-outbox.spec` H-1 |
| H-3 | Every sync wiped guests and conferencing added in Google; provider partial edits wiped other fields | `ed35fd5` | `google-calendar.service.spec` H-3 |

All audit items with commits and tests: [known-issues.md → Audit findings](known-issues.md#audit-findings-2026-10-30).

## 6. Verification required before production rollout

1. G-1: Neon branch rehearsal (steps in [deploy.md](deploy.md#database-migrations)); confirm the backend uses a non-pooled (session) connection if more than one instance will run.
2. G-2: push and observe the Postgres CI job.
3. G-3: the manual Google list in KI-03 with a test account.
4. G-4: two-user e2e for each controller outside scheduling; then decide on a global validation pipe.
5. G-5: decide on token encryption / refresh-token hashing.
6. Re-run: backend unit + e2e, `npm run test:pg`, voice structured gate, frontend tests, both builds.
7. If the Voice Agent ships: G-6 items from [voice-agent-roadmap.md](voice-agent-roadmap.md).

## 7. Recommended remediation order (after the Voice Agent MVP, see roadmap "Deferred hardening")

1. G-4 / R-01 / R-02 / R-04: global validation and cross-user tests (security).
2. G-5 / R-03: credentials at rest.
3. R-09: habits and day reminders on the Google queue.
4. R-08 / R-07: ETag preconditions and incremental Google sync.
5. R-11 / R-12 / R-14: single-transaction placement steps, refill on a job.
6. R-10 / R-21: repository wrapper for criteria writes; drop unused code.
