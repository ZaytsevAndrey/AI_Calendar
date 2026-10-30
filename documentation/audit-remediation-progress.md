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
| AUD-007 | High | fixed | 356cebe | `mutation-jobs.pg.spec` + `pending-google-write.pg.spec` "AUD-007" (two independent connections: a slow live worker was re-run by the other instance; a stale worker overwrote the newer outcome — both failed before) | Lease heartbeat (lease/4) while a job/send runs; every outcome write is fenced on `status = running AND attempts = claimed attempts`. `setMutationStage` no longer sets `running`. Google API requests time out after 30 s (below the 2-min lease). |
| AUD-008 | High | pending | | | |
| AUD-009 | High | fixed | 701ef20 | queue spec "AUD-009: a series master is never pulled back…" | Series are no longer pulled from Google. |
| AUD-010 | Medium | fixed | 701ef20 | queue spec "AUD-010: our own write landing after a newer local change…" | A row put back after an attempt gets `enqueuedAt = now`; inserts are stamped by the app clock. Residual: a genuine Google edit made between a failed attempt and its retry is overwritten (local is authoritative). |
| AUD-011 | Medium | fixed | 7781bff | `pending-google-write.pg.spec` "AUD-011" ×2 (20 concurrent writers on two connections → duplicate rows before; a write racing the worker's delete → lost before) | Partial unique indexes (migration `1761790000000`, dedupes first); insert `ON CONFLICT DO NOTHING` + re-read; an existing row gets an atomic `revision + 1` and is reopened only if no worker holds it. |
| AUD-012 | Medium | pending | | | |
| AUD-013 | Medium | pending | | | |
| AUD-014 | Medium | fixed | d26220c | `dst-clock.spec` AUD-014 (horizon starts at local midnight on a spring-forward day); `placement-edge-cases.spec` "AUD-014: this and following…" (2 tails, Saturday anchor before) | New `civilDayStartIso` (offset at midnight) for scheduling day bounds (move tail, end series, free slots, external all-day, horizon, `civilDayBounds` end = next midnight). `startOfLocalDayIso` unchanged for voice callers. |
| AUD-015 | Medium | fixed | c4b1191 | `placement-edge-cases.spec` AUD-015 (fault injection: copy insert / sibling creation fail) | `parkFailedSeriesDay` and each appended day write through `inOneTransaction`; planning and the external-calendar read stay outside. Residual: `placeUnlocked` still runs persist, expand and re-merge as separate transactions (each atomic). |
| AUD-016 | Medium | fixed | 486c45c | `placement-edge-cases.spec` "AUD-016…" (a Tuesday held twice before) | `expandSeriesDays` treats a day held by any group member as seated. Sibling stays recurring without end (its Google RRULE ends at its last slot). |
| AUD-017 | Medium | fixed | 8d7a0f4 | `placement-edge-cases.spec` "AUD-017…" (day lost before) | Re-merge plans the series day as a dry run first and merges only on an exact seat. |
| AUD-018 | Medium | pending | | | |
| AUD-019 | Medium | pending | | | |
| AUD-020 | Medium | pending | | | |
| AUD-021 | Low | fixed | 8d7a0f4 | `placement-edge-cases.spec` "AUD-021…" (merged into the wrong series before) | Owner = the group series that skips the day (preferring `parentSeriesId`). `parentSeriesId` is still cleared on seat (changing that would change series-delete scope; not needed for identity). |
| AUD-022 | Low | fixed (residual) | 35cd614 | `placement-edge-cases.spec` "AUD-022…" (later days at 03:30 before) | Master clock taken from the first series day DST did not shift. Residual: 1-day horizon; a series created *on* the switch day at 02:30 arrives as 03:30 (ISO instant) — not distinguishable server-side. |
| AUD-023 | Low | fixed | 356cebe | queue spec "AUD-023…" (a newer change was marked failed before) | A final failure is terminal only for the revision that was sent; a newer revision is re-queued with attempts 0. |
| AUD-024 | Low | pending | | | |
| AUD-025 | Low | pending | | | |
| AUD-026 | Low | pending | | | |
| AUD-027 | Low | fixed | d4f2157 | `placement-edge-cases.spec` "AUD-027…" (dry run wrote 2 days before) | All expand calls check `dryRun`; the search-hole recursion keeps dryRun/duration/extraSeats/ignoreTaskIds. |
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

Phases A and B done. Next: Phase C (AUD-007, 008, 011, 018, 020, 023, 026), then D (012, 013, 019, 024, 025), then H-1, H-2, H-3, H-5.
