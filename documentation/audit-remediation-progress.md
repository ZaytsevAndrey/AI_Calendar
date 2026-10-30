# Audit remediation progress

Remediation of the independent scheduling audit (AUD-001…AUD-027, H-1…H-5; report in Ukrainian, delivered 2026-10-30 against HEAD `f689e2d`). Branch `stabilize/scheduling`, local only (nothing pushed, merged or deployed). Statuses: pending / investigating / reproduced / fixed / disproven / blocked.

Evidence rule: a finding is **fixed** only with a regression test that failed before the fix (or, where a failing test was not feasible, the reason is stated) and passes after it.

## Status

| ID | Sev (audit) | Status | Commit | Regression test | Notes |
|----|-------------|--------|--------|-----------------|-------|
| AUD-001 | High | fixed | 187973b | `pending-google-write.queue.spec` "AUD-001: a 429/503/401/403/network…" (5 cases; all failed before — task deleted with "sync Google deletions"); `google-calendar.service.spec` getEvent status mapping | `getEvent`/`updateEvent` throw `GoogleEventMissingError` only for 404/410 and keep the status otherwise; queue and delete paths decide by status (message regexes removed — "User not found" also counted as deleted). Google-deletion removal of slots + task is one transaction. |
| AUD-002 | High | fixed | 884aa06 | `placement-edge-cases.spec` "AUD-002…" flexible + fixed (series-group level, clock moved past the occurrence) | Any row of the day counts as seated; a day whose clock occurrence is over is not appended. |
| AUD-003 | High | fixed (partly disproven) | 78f56e0 | `placement-edge-cases.spec` "AUD-003…" | Past park + deletion of history reproduced and fixed (keep path for a series whose master day is over; never park before today). Disproven part: "new duration not applied to seated days" is the documented keep rule (placement-engine.md §4). |
| AUD-004 | High | fixed | 733d585 | `account-deletion.pg.spec` (real Postgres; failed with `syntax error` before) | Raw SQL replaced by TypeORM deletes in one transaction; `day_reminders` wiped; day-reminder Google events purged. Order kept: Google purge first (fail closed), retry converges. |
| AUD-005 | High | fixed | bf3fad6, 420a04a | queue spec + `pending-google-write.pg.spec` "AUD-005: 120 rows of a disconnected user…" (0 sent before) | A disconnected user's due rows are deferred by the down TTL (attempts untouched) and the pass re-fetches (≤ 3 rounds). bf3fad6 shipped a test that did not compile; fixed in 420a04a. |
| AUD-006 | High | fixed | f915d86 | e2e `A-TSK-032` (two users) | Reproduced: a create carrying Alice's task id returned (overwrote) Alice's task. Fix: `SchedulingValidationPipe` (class-validator only, whitelist) on tasks, phases and schedule controllers; services drop `id/userId/createdAt/updatedAt` from bodies. Phases had the same pattern. Remaining: other modules' controllers are not covered (outside this audit). |
| AUD-007 | High | pending | | | |
| AUD-008 | High | pending | | | |
| AUD-009 | High | fixed | 701ef20 | queue spec "AUD-009: a series master is never pulled back…" | Series are no longer pulled from Google. |
| AUD-010 | Medium | fixed | 701ef20 | queue spec "AUD-010: our own write landing after a newer local change…" | A row put back after an attempt gets `enqueuedAt = now`; inserts are stamped by the app clock. Residual: a genuine Google edit made between a failed attempt and its retry is overwritten (local is authoritative). |
| AUD-011 | Medium | pending | | | |
| AUD-012 | Medium | pending | | | |
| AUD-013 | Medium | pending | | | |
| AUD-014 | Medium | pending | | | |
| AUD-015 | Medium | pending | | | |
| AUD-016 | Medium | pending | | | |
| AUD-017 | Medium | pending | | | |
| AUD-018 | Medium | pending | | | |
| AUD-019 | Medium | pending | | | |
| AUD-020 | Medium | pending | | | |
| AUD-021 | Low | pending | | | |
| AUD-022 | Low | pending | | | |
| AUD-023 | Low | pending | | | |
| AUD-024 | Low | pending | | | |
| AUD-025 | Low | pending | | | |
| AUD-026 | Low | pending | | | |
| AUD-027 | Low | pending | | | |
| H-1 | — | pending | | | |
| H-2 | — | pending | | | |
| H-3 | — | pending | | | |
| H-4 | — | confirmed, fixed | 701ef20, 7d023ca | `pending-google-write.pg.spec` "H-4…" | A DB-default `now()` in `TIMESTAMP` (no tz) reads back shifted by the Node offset (measured −2 h, Node +02:00 / session UTC). `enqueuedAt` is now app-stamped; no other DB-default timestamp is compared in JS. |
| H-5 | — | pending | | | |

## Newly discovered

| ID | Severity | Status | Notes |
|----|----------|--------|-------|
| NEW-01 | High | fixed (f915d86) | No DTO validation anywhere: `class-transformer` is not installed, so Nest's `ValidationPipe` cannot run; bodies were never validated (invalid input → 500). Scheduling controllers now validate; other modules are still unvalidated (outside this audit). |

## Checkpoint

Phase A done (AUD-006, 001, 004, 005). Phase B: AUD-002, 003, 009 done; AUD-010 and H-4 done early. Next: AUD-014, 015, 016, 017, 021, 022, 027; then Phase C. Note: commit cc113dc wrote this file wrongly (rows on line 1); fixed in the next commit.
