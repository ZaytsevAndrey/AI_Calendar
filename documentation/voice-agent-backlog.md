# Voice Agent backlog (detailed)

Detailed, dependency-aware backlog behind [voice-agent-roadmap.md](voice-agent-roadmap.md). The roadmap holds the architecture, the compatibility matrix, the phase plan and the next task; this file holds every task with its status, priority, complexity, acceptance criteria and tests. One identifier per task, reused across both files. Dated 30 October 2026 (verification pass, second review session).

**Identifiers.** `VC-xx` — scheduling compatibility findings; `VR-xx` — carried requirements; `VN-xx` — findings of the 30 Oct verification pass; `VB-xx` — executable units split out of a larger item; `D-xx` — decisions that need product or architecture approval. VC / VR numbers are never reissued.

**Status values.** `verified` — implemented and covered by a test read in code; `unverified` — implemented, no test or no live evidence; `partial`; `missing`; `broken`; `obsolete`; `blocked` (names the blocker). **Evidence**: *Verified* (read in code, file:line), *Confirmed* (cited by the compatibility analysis, re-checked for the ✔ items), *Suspected* (needs a test), *Reported* (transcript or deleted report).

**Classification.** `MVP` — needed for the coherent assistant in §1; `Gate` — a rollout gate (G-6) that does not change what the user can do; `Post-MVP`.

---

## 1. MVP definition

The MVP is the Companion as a trustworthy **task controller for one user's own calendar**: it never writes without a preview and an explicit confirm, and every preview it shows is one the Apply step can actually perform. It is not a general assistant.

**Essential workflows (MVP):**

| # | Workflow | Where it stands (30 Oct) | Backlog |
|---|----------|--------------------------|---------|
| W1 | Quick capture: one or several tasks in one utterance, with or without a clock, including Later | Works offline; two same-name creates lose one (VC-14) | VC-14 |
| W2 | Create a routine (series) from one phrase | Broken for preferred clock / window / end / date only (VC-01); no-clock series shows as Later (VC-13) | VC-01, VC-13 |
| W3 | Move or postpone a task, including a Later task and a task without Google | Later cannot be scheduled (VC-02); moves need Google ids (VC-03); cross-day series move fails after confirm (VC-04) | VC-02, VC-03, VC-04 |
| W4 | Edit an existing task naturally (rename, notes, length, priority, done, delete, skip) | Works for one-offs; series scope hidden in preview (VC-06); fixed edge cases (VC-10); skip of a one-off refused (VC-09) | VC-06, VC-09, VC-10 |
| W5 | Reminders: create, resolve, delete, move | Create / resolve / delete work; update wipes fields (VC-05) | VC-05 |
| W6 | Understand the calendar state (what is today, what is free, what is Later) | Works offline; agenda latency ~5 s cold (VR-08.6) | VR-08 |
| W7 | Plan a day through conversation | Works offline; Later only offered (VR-07 done); draft routing prompt-only (VR-06) | VR-06 |
| W8 | Multi-turn: answer a question, correct a pending preview, confirm or cancel by voice | Offline covered; live 0/5 (KI-04); one active clarification only; rename during preview loses the target (VR-38) | VR-13, VR-38, VN-02 |
| W9 | Confirm destructive actions, explain failures, recover after interruption | Confirm-before-write done (VR-01); session lost on restart fails closed (VR-26) | VR-01 done; VR-26 (Gate) |
| W10 | Voice vs text: same pipeline, STT in uk / en | Same `/voice/turn`; STT Azure or Groq Whisper; TTS Azure / Piper / browser | no backlog item (STT language hint is a Later decision in the product roadmap) |

**Live bar for the MVP (proposal, to approve as D-08):** on the F2 Ukrainian set ≥ 10/12, multi-turn ≥ 4/5, 0 unsafe previews, 0 writes without confirm; a first English set of the same shape ≥ 10/12.

**Explicitly post-MVP:** preference memory and "remember that…" (VR-21, VR-22), contacts (VR-37), Companion panel rework (VR-33), before → after diff (VR-29), multi-slot moves (VR-20, deliberately unsupported), habits (soft-disabled), languages beyond uk / en, STT language auto-detection.

---

## 2. Backlog

Columns: **Src** = traceable source; **Pri** P0 / P1 / P2; **Cat** bug / compat / feature / arch / testing / UX / security / docs; **Cx** S / M / L / XL; **Class** MVP / Gate / Post-MVP. Acceptance criteria and required tests are in §3, by ID.

### 2.1 Phase V1 — create and preview correctness (P0)

| ID | Title | Src | Status | Pri | Cat | Cx | Class | Modules | Depends on |
|----|-------|-----|--------|-----|-----|----|-------|---------|------------|
| VC-01 | Recurring create must not take `deadline` / `earliestStartTime` from a one-day window | roadmap C.1; `project-apply.ts:465-490` (re-read 30 Oct) | broken | P0 | compat | M | MVP | `vnext/state/project-apply.ts` (`projectCreate`, `dayWindow`), `vnext/interpreters/prompts.ts`, `prompt-modules/kind-when.ts` (legacy text) | — |
| VC-13 | Recurring create intents carry `isUnscheduled: false` | roadmap C.1; `project-apply.ts:399, 419-426` (re-read) | broken | P1 | compat | S | MVP | `project-apply.ts`, `changePreviewCards.ts` | — |
| VC-14 | Remove the 15 s name-based create dedupe on the client | roadmap C.1; `useVoiceTask.ts:316-330` (re-read) | broken | P0 | bug | S | MVP | `frontend/src/modules/voice/hooks/useVoiceTask.ts` | — |
| VC-06 | Preview names the series scope (whole series / this day and following / this day) | roadmap C.1; `project-apply.ts:579-606`, `changePreviewCards.ts:249-284` | broken | P1 | UX | S | MVP | `project-apply.ts` (`commandSummary`), `vnext/copy.ts`, `changePreviewCards.ts` | — |

### 2.2 Phase V2 — move and schedule paths (P1)

| ID | Title | Src | Status | Pri | Cat | Cx | Class | Modules | Depends on |
|----|-------|-----|--------|-----|-----|----|-------|---------|------------|
| VC-02 | Schedule a Later task by voice (`isUnscheduled: false` in update / date move; client mapper forwards it) | roadmap C.1; `executeVoiceCommand.ts:107-146, 240` (re-read) | broken | P1 | compat | M | MVP | `project-apply.ts` (`updatePatch`, `projectMove`), `executeVoiceCommand.ts` | VC-01 |
| VC-03 | Moves without Google identity (`slotId` / `originalStart` path) | roadmap C.1; `project-apply.ts:706, 804` (re-read) | broken | P1 | compat | M | MVP | `project-apply.ts`, `vnext/production/catalog.ts`, `displayed-event-move.service.ts` (read only) | VC-02 |
| VC-04 | Cross-day series occurrence move refused or asked at preview | roadmap C.1; `displayed-event-move.service.ts:213-219` | broken | P1 | compat | S | MVP | `project-apply.ts` (`projectSeriesCommand`), `prompts.ts` (one rule) | VC-03 |
| VC-09 | Skip a one-off flexible task | roadmap C.1; `project-apply.ts:671-672` | broken | P2 | compat | S | MVP | `project-apply.ts` | — |
| VC-10 | Fixed-task edge cases: date-only update, start without end, `resolveEnd` growth, `description: null` | roadmap C.1; `project-apply.ts:889-891, 950-952`, `executeVoiceCommand.ts:111` | broken (impact Suspected) | P2 | bug | M | MVP | `project-apply.ts`, `executeVoiceCommand.ts` | — |
| VB-01 | Frontend executor tests for update / move / skip / end-series / reminder / create (today: report classification and provider events only) | roadmap matrix last row; `executeVoiceIntents.spec.ts` (5 tests, re-read) | missing | P1 | testing | M | MVP | `frontend/src/modules/voice/*.spec.ts` | VC-02, VC-03 (write the tests first, red) |

### 2.3 Phase V3 — reminders, groups, occurrences, DST (P1 / P2)

| ID | Title | Src | Status | Pri | Cat | Cx | Class | Modules | Depends on |
|----|-------|-----|--------|-----|-----|----|-------|---------|------------|
| VC-05 | Reminder update merges stored fields instead of sending nulls | roadmap C.1; `project-apply.ts:506-549`, `day-reminders.service.ts:64-74` (re-read) | broken | P1 | compat | M | MVP | `project-apply.ts` (`projectRemind`), `catalog.ts` (reminder fields), optionally `day-reminders` partial endpoint | — |
| VC-07 | Series groups and detached copies in the voice catalog; group semantics for rename / end / delete | roadmap C.1; `catalog.ts` has no `seriesGroupId` / `parentSeriesId` / `originalOccurrenceYmd` (re-read) | blocked (D-03) | P1 | arch | L | MVP (minimal: make the group effect visible or refuse) | `catalog.ts`, `project-apply.ts`, `series-group.util.ts` (read) | D-03 |
| VB-02 | Stopgap for VC-07: refuse (`unrepresented`) a series-wide rename / end / delete when the series has parked or detached copies, with a preview line that says why | D-03 option (c) | missing | P1 | compat | S | MVP | `catalog.ts` (group flag only), `project-apply.ts` | D-03 |
| VB-03 | Full group support for VC-07: group key and per-day clocks in the catalog; rename / end / delete act on the agreed scope | D-03 option (a) | missing | P1 | arch | L | Post-MVP | `catalog.ts`, `project-apply.ts`, `series-group.util.ts` | VB-02, D-03 |
| VC-08 | Occurrences from the series rule and parked days, not only placed slots | roadmap C.1; `project-apply.ts:740-747` | broken (fails closed) | P2 | compat | M | Post-MVP | `project-apply.ts` (`pickOccurrence`), `catalog.ts` | VC-07 |
| VC-11 | Voice day bounds use `civilDayStartIso` (AUD-014) instead of the noon-offset helpers | roadmap C.1; `voice-local-date.util.ts:150-156`; callers in `structured-voice.service.ts`, `voice-agent.tools.ts`, `voice-agent.plan-draft.ts`, `voice-agent.day-plan.ts`, `voice-command.resolve.ts`, `voice-parse.util.ts` (re-grepped) | broken on DST days | P2 | bug | S | Post-MVP | the callers above | — |
| VC-16 | `find_tasks`: `scheduled: false` → `isUnscheduled` / `scheduleState`; document that morphology is the model's job | roadmap C.1 | partial | P2 | compat | S | Post-MVP | `vnext/search/find-tasks.ts` | — |

### 2.4 Phase V4 — security and trusted resolution (P1, mostly Gate)

| ID | Title | Src | Status | Pri | Cat | Cx | Class | Modules | Depends on |
|----|-------|-----|--------|-----|-----|----|-------|---------|------------|
| VC-12 | Decide and document trust in the model's `proposedId` (owned, writable, right type; no description cross-check) | roadmap C.1; `structured-state.ts:742-765` (re-read) | blocked (D-02) | P1 | security | S (document) / M (description match) | MVP | `structured-state.ts`, `vnext/eval` adversarial set | D-02 |
| VR-04 | Per-action write rights instead of one `writable` flag | roadmap C.2; `catalog.ts:92,105` | partial | P1 | security | M | Post-MVP (single user owns every task; provider events already carry access) | `catalog.ts`, `project-apply.ts` | — |
| VR-27 | Idempotency for non-create Apply commands; reconcile an unknown outcome | roadmap §42 | partial | P1 | security | M | Gate | `executeVoiceCommand.ts`, task endpoints, `session-registry.ts` ledger | — |
| VR-25 | Revision / ETag preconditions on Apply | roadmap §42 | missing | P1 | security | L | Gate | tasks controller + DTOs, `project-apply.ts`, `executeVoiceCommand.ts` | VR-27 |
| VR-24 | Token / cost / latency per turn (today `inputTokens: 0`; prompt and transcript bodies are already gated by `VOICE_TRACE_BODY`, production additionally by `VOICE_TRACE_BODY_PRODUCTION`) | roadmap §41; `structured-voice.service.ts:314`; `turn-log.ts`; `common/voice-trace.ts:165-173` (re-read 30 Oct — corrects the earlier "logs raw prompts" wording) | partial | P1 | arch | S | MVP (needed to measure V7) | `structured-voice.service.ts` (`modelInterpreter`), `groq.client.ts` usage, `admin-data/voice-turn-log` | — |
| VR-26 | Shared session store, or a documented single-instance constraint | roadmap §42; `session-registry.ts` (in-memory `Map`, re-read) | missing | P1 | arch | S (document) / L (store) | Gate | `vnext/production/session-registry.ts`, `deploy.md` | D-04 |

### 2.5 Phase V5 — multi-turn and draft continuity (P1)

| ID | Title | Src | Status | Pri | Cat | Cx | Class | Modules | Depends on |
|----|-------|-----|--------|-----|-----|----|-------|---------|------------|
| VR-13 | Multi-turn state: more than one active clarification; corrections to pending previews; same-request dependencies | handoff P0; KI-04; F2 run 29 Oct | partial | P1 | feature | L | MVP | `run-structured-turn.ts`, `state/structured-state.ts`, `session/clarification.ts` | V1, V2 |
| VR-38 | Invalid JSON or a refused correction ("rename during preview") must not lose the target | 4.7.7; F2 run | missing | P1 | bug | M | MVP | `run-structured-turn.ts`, `repair/repair.ts` | VR-13 |
| VR-03 | Pending preview as a valid target: re-run g-b-11 (rebind) and g-b-10 (two clocks on one task) as offline fixtures | 4.7 generalization (Reported 65/100) | partial | P1 | testing | S | MVP | `vnext/eval`, structured gate | — |
| VR-06 | Deterministic routing to an open day-plan draft when the model emits no draft edit | 4.7.7 risk | partial | P1 | feature | M | MVP | `day-plan/structured-day-plan.ts`, `run-structured-turn.ts` | — |
| VN-02 | Deterministic short-answer control: a bare "так / yes / ні / no" while a preview or question is open resolves without a model call (today only the model's `confirm_pending` control, `prompts.ts:28-30`) | verification pass; F2 "7 unnecessary clarifications" (Suspected cause, needs measurement) | missing | P1 | feature | S | MVP | `structured-voice.service.ts` (`interpreterFor`), `run-structured-turn.ts` | — (respect `.claude/rules/voice-no-lexical-crutches.md`: a closed list of confirmation words for an open yes/no question is a control, not a lexical crutch — confirm with the owner, D-10) |

### 2.6 Phase V6 — deterministic tests and evaluation harness (P1)

| ID | Title | Src | Status | Pri | Cat | Cx | Class | Modules | Depends on |
|----|-------|-----|--------|-----|-----|----|-------|---------|------------|
| VR-32 | Port or retire the 13 historical vNext suites (292 tests: 215 pass / 77 fail) | KI-10; `jest.vnext-historical.config.js` | missing | P1 | testing | L | Gate | `backend/jest.vnext-*.config.js`, `vnext/phase4*.spec.ts` | — |
| VR-12 | Independent and adversarial offline test set in the gate | 4.7.10 "never executed"; generalization adversarial 13/20 | missing | P1 | testing | M | MVP | `vnext/eval`, structured gate | VC-12 decision |
| VR-11 | Benchmark reproducibility: fix the scorer blind spot for `type: "create"`; keep run summaries (prompt hash, model, temperature) in the repo or an archive | 4.7.x; all run outputs deleted | partial | P1 | testing | M | MVP | `vnext/eval/phase47-generalization*.ts`, `rubric.ts` | — |
| VC-15 | Freeze the legacy engine (no new rules); remove with VR-31 | roadmap C.1 | obsolete path | P2 | arch | S | Post-MVP | `voice-agent.*`, `voice-parse.*` | — |
| VN-03 | Gate reproducibility note: the structured gate and `npm test` need a Node toolchain matching the OS that installed `node_modules` (native `bcrypt`); run on Windows or in CI, document in `setup-and-build.md` | verification pass (gate run from a Linux shell: 84/84 tests in loadable suites, 2 suites failed to load on `bcrypt_lib.node`) | missing | P2 | docs | S | MVP | `documentation/setup-and-build.md` | — |

### 2.7 Phase V7 — live LLM quality (§39)

| ID | Title | Src | Status | Pri | Cat | Cx | Class | Modules | Depends on |
|----|-------|-----|--------|-----|-----|----|-------|---------|------------|
| VR-14 | Live P0 run on a real Google test calendar; replay the 29 Oct dialogues | roadmap §39; last structured turn in `logs/voice-agent.log` is 2026-10-29 05:03 (re-read) | missing | P0 (for MVP sign-off) | testing | L (external: test account) | MVP | `vnext/eval/*-cli.ts`, test calendar | V1–V5 |
| VR-15 – VR-19 | P0 behaviors (bulk, provider events, recurrence scope + skip, time semantics, dependent actions) live-verified | handoff P0 | unverified (offline green) | P0 | testing | — (part of VR-14) | MVP | — | VR-14 |
| VR-08 | 29 Oct dialogue bugs 1–6; bug 6 agenda latency (~5 s cold provider read) | transcript `1e1b2f43` | partial (1–5 offline; 6 unmeasured) | P1 | bug | S (measure) | MVP | `voice-agent.tools.ts`, provider reads | VR-14 |
| VR-09 / KI-19 | English live set of the F2 shape; Ukrainian morphology stays the model's job | 4.7 recommendations; KI-19 | missing | P1 | testing | M | MVP | `vnext/eval` | VR-14 |
| VR-23 | Bounded context: targeted reads instead of every owned record in `buildTurnUser` (`prompts.ts:108-143`, re-read) | roadmap §41 | missing | P1 | arch | L | Post-MVP (measure first with VR-24) | `prompts.ts`, `read-broker.ts`, `find-tasks.ts` | VR-24 |
| VR-35 | Fixed / flexible × series × scope followed on the live model | stabilization C2 | unverified | P1 | testing | — | MVP | — | VR-14 |

### 2.8 Phase V8 — end-to-end product integration (§43, §48, §49)

| ID | Title | Src | Status | Pri | Cat | Cx | Class | Modules | Depends on |
|----|-------|-----|--------|-----|-----|----|-------|---------|------------|
| VR-30 | Fast create on the structured engine, or hide the toggle (today `dto.mode` is only logged, `structured-voice.service.ts:151`; the UI sends it on every turn, `useVoiceTask.ts:541`) | roadmap §43, §48 | broken (silent no-op) | P1 | bug | M (implement) / S (hide) | MVP (hide) | `structured-voice.service.ts`, `interpreters/prompts.ts`, `CompanionPanel.tsx` | D-05 |
| VR-31 | Remove the legacy engine: `VOICE_TURN_ENGINE`, `VoiceAgentOrchestrator` (1267 lines), planner / router / specialist prompts, `normalizeVoiceParse`, `resolveVoiceCommand`, `POST /voice/parse-task` (no UI caller — `frontend/src/api/voice.api.ts:280` is unused), e2e specs that mock `parse-task` (`e2e/helpers/voice.ts:79`, `e2e/tests/p1.voice.spec.ts:305`) | roadmap §49 **[USER]** | missing | P1 | arch | XL | Post-MVP (after V7 live bar) | `backend/src/modules/voice/*` legacy, `e2e/`, `frontend/src/api/voice.api.ts` | V7, D-01 |
| VR-05 | Delete dead vNext code: `pipeline.ts` `operationsTurn` / `dayPlanTurn`, `adapter/`, `session/utterance-policy.ts`, `session/corrections.ts`, `reference/reference-resolver.ts` stemmer (no non-test callers, re-grepped) | roadmap A | obsolete | P2 | arch | S | Post-MVP | `vnext/` | VR-31 (or earlier, independent) |
| VR-33 | Companion panel rework (draft layout, Fast create toggle) **[USER]** | roadmap §48 | missing | P2 | UX | L | Post-MVP | `frontend/src/modules/voice/components/` | VR-30 |
| VR-29 | Polish: shorter clarifications, before → after diff, plan uses §40 preferences | roadmap §43 | missing | P2 | UX | M | Post-MVP | `vnext/copy.ts`, `changePreviewCards.ts` | V5, V9 |
| VR-28 | `npm run lint` verified to run; `WorldName` typecheck error is gone (`phase477-fixtures.ts:3` exports it; `phase47-generalization.ts:8` imports it — roadmap §42 line is stale) | roadmap §42 | partial (lint not run in this pass) | P2 | testing | S | Gate | root `package.json` `lint` | — |
| VN-06 | Documentation consistency: `spec-voice-agent.md` §3 / §11 describe the legacy planner split and legacy read tools as current; `voice-prompt-next.md` names the legacy planner as production; `BUGS-AND-IMPROVEMENTS.md` "Зараз" says §37 / §38 while `roadmap.md` says Voice MVP first; `jest.vnext-structured.config.js` cites the deleted STAGE-4.1-REPORT | verification pass | missing | P2 | docs | S | MVP (one source of truth) | the files named | — |

### 2.9 Phase V9 — personalization (§40, later)

| ID | Title | Src | Status | Pri | Cat | Cx | Class | Modules | Depends on |
|----|-------|-----|--------|-----|-----|----|-------|---------|------------|
| VR-21 | "Remember that…" saves a soft preference after confirm; preferences are never an entity id | handoff P1; 4.7.11 | partial (settings reused; no store) | P2 | feature | L | Post-MVP | new preference store, `prompts.ts`, day plan | V5, V7 |
| VR-22 | Learned preference profile | roadmap "Later" | missing (shape open) | P2 | feature | XL | Post-MVP | — | product decision |
| VR-37 | Contacts ("my manager") | handoff P1 optional | deferred | P2 | feature | M | Post-MVP | — | — |
| VR-20 | Multi-slot non-recurring move **[USER]** | memory | deliberately unsupported | — | — | — | — | — | — |

### 2.10 Done — keep as regression scope, do not reopen

VR-01 (lifecycle, verified in `run-structured-turn.ts`, `phase4712-stage41.spec.ts`), VR-02 (trusted identity on the live path), VR-07 (Later only offered), VR-10 create path (reminder persistence), VR-34 (step logging with timings), VR-36 (Apply surface), VR-15 – VR-19 offline. Compatible by construction (roadmap B "do not re-fix"): event types `fixed` / `admin` only; every voice field declared in `CreateTaskDto` / `UpdateTaskDto` / `SkipOccurrenceDto`; occurrence identity as series + civil day; delete and move scope mapping; recurrence patterns; reminder default clock; create Idempotency-Key; owner / writable / open checks; confirm-time re-read with fingerprints.

### 2.11 Counts (30 Oct 2026)

| Status | Count | IDs |
|--------|-------|-----|
| broken | 14 | VC-01, 02, 03, 04, 05, 06, 09, 10, 11, 13, 14, VR-30, VR-38 (missing-as-broken), VN-02 (missing control) |
| partial | 10 | VC-16, VR-04, VR-06, VR-08, VR-11, VR-13, VR-21, VR-24, VR-27, VR-28 |
| missing | 15 | VR-12, VR-14, VR-22, VR-23, VR-25, VR-26, VR-29, VR-31, VR-32, VR-33, VB-01, VB-02, VB-03, VN-03, VN-06 |
| unverified (offline only) | 3 | VR-15–19 (as one), VR-35, VR-03 |
| blocked by a decision | 2 | VC-07 (D-03), VC-12 (D-02) |
| obsolete / dead code | 2 | VC-15, VR-05 |
| deferred / deliberately unsupported | 2 | VR-37, VR-20 |
| done | 8 | VR-01, 02, 07, 10 (create), 34, 36, 15–19 offline, 09 (stemmer obsolete) |

| Priority | Open items |
|----------|------------|
| P0 | VC-01, VC-14, VR-14 (+ VR-15–19 live) |
| P1 | VC-02, 03, 04, 05, 06, 07, 12, 13, VR-03, 04, 06, 08, 09, 11, 12, 13, 24, 25, 26, 27, 30, 31, 32, 38, VB-01, VB-02, VB-03, VN-02 |
| P2 | VC-08, 09, 10, 11, 15, 16, VR-05, 21, 22, 23 (P1 in roadmap §41, moved after VR-24), 28, 29, 33, 37, VN-03, VN-06 |

---

## 3. Acceptance criteria and required tests, by ID

Each entry: **Done when** / **Tests**. Offline tests are the structured gate (`npm run test:vnext:structured`), backend unit (`npx jest`), backend e2e (`npm run test:e2e`), frontend (`npx jest --config jest.config.cjs`). Offline green is never evidence of live quality; live items say so.

- **VC-01** — Done when no recurring create intent carries a `deadline` or `earliestStartTime` derived from a day window; a preferred clock on a series becomes `scheduledStartTime` on the first series day with `eventType: 'admin'`; a daily window, an end-only or interval clock on a series is refused with `unrepresented` unless start + end make a fixed clock; a date only with recurrence sets `earliestStartTime` to the civil-day start and no `deadline`. *Tests:* `structured-voice.service.spec.ts` recurrence × {preferred, end, interval, date only, `spanRole: 'window'`, earliest / deadline}; each must fail before the fix.
- **VC-13** — Done when a recurring create without a clock projects `isUnscheduled: false` and the card does not show Later. *Tests:* projection test; `changePreviewCards.spec.ts`.
- **VC-14** — Done when two creates with one name and different clocks in one request reach `POST /tasks` twice and a retried identical create yields one task (Idempotency-Key). *Tests:* new `useVoiceTask` or executor test (two `onCreate` calls); backend create-idempotency test already exists.
- **VC-06** — Done when every summary and card for a series-scoped delete / move / done / skip names the scope in uk and en. *Tests:* `command-summary.spec.ts` per scope; `changePreviewCards.spec.ts`.
- **VC-02** — Done when a Later target moved to a day or clock gets `isUnscheduled: false` in the patch, the client forwards it, and the stored task is scheduled after Apply. *Tests:* projection test; frontend executor test (VB-01); one backend e2e on `PATCH /tasks/:id` with `isUnscheduled: false` + clock.
- **VC-03** — Done when a one-off and a series occurrence without Google ids move through `move-event` with `slotId` (or `originalStart`). *Tests:* projection tests for no-Google one-off and series; `displayed-event-move.service.spec.ts` slot path (read, add if missing).
- **VC-04** — Done when a series occurrence aimed at another day is refused or asked before confirm and never previewed as a move. *Tests:* projection test; prompt rule covered by a fixture.
- **VC-09** — Done when skip of a one-slot flexible task projects to `skip-occurrence` with that slot's start. *Tests:* projection test.
- **VC-10** — Done when a fixed task date-only update either asks for a clock or keeps the stored clock; date + start derives the end from the stored length; `resolveEnd` never grows a task; `description: null` reaches the server. *Tests:* unit per case; executor test for `description: null`.
- **VB-01** — Done when `executeVoiceIntents.spec.ts` (or sibling specs) cover update, move (`move-event` with event id and with `slotId`), skip, end-series, reminder create / update / resolve / delete and create, including the stop-on-first-error rule. *Tests:* this item is the tests.
- **VC-05** — Done when "move reminder to Friday" keeps repeat, notes and clock. *Tests:* `remind_update` projection tests (none exist today); catalog carries reminder fields.
- **VC-07** — Done when the catalog knows group key and per-day clocks and the behavior for rename / end / delete matches D-03; same-name siblings are distinguishable in the prompt. *Tests:* group fixtures (rename, end from a day, delete).
- **VC-08** — Done when a parked or beyond-horizon day can be skipped and the preview names the day. *Tests:* parked-day skip; beyond-horizon skip.
- **VC-11** — Done when every voice day-bound read uses `civilDayStartIso(day)` … `civilDayStartIso(day + 1)`. *Tests:* DST-day read (America/New_York, 14 Mar 2027) for `find_events`, confirm re-read, agenda tools, plan deadlines.
- **VC-16** — Done when `scheduled: false` means Later (`isUnscheduled`) and parked tasks are reported as parked. *Tests:* `find-tasks.spec.ts`.
- **VC-12** — Done when D-02 is recorded in the roadmap and, if chosen, a description match is enforced; the adversarial set (VR-12) contains wrong-target cases. *Tests:* adversarial fixtures; a wrong owned id with a non-matching description is refused or asked, per D-02.
- **VR-04** — Done when rename / move / delete / done each check their own right (owner, organizer, open) rather than one `writable`. *Tests:* projection tests per action on a read-only provider event and on a done task.
- **VR-27** — Done when every Apply command is safe to resend (key or natural idempotency documented per endpoint) and an unknown outcome is reconciled by a re-read before any resend. *Tests:* executor retry tests; backend e2e replay for skip / end-series / move.
- **VR-25** — Done when a task endpoint rejects an Apply built on a stale revision (`If-Match` or revision field) and the client reports it as a definite failure. *Tests:* backend e2e stale revision 412; executor test.
- **VR-24** — Done when `TurnLog` and `voice_turn_logs` carry real prompt / completion tokens, model, latency per call, with no bodies unless `VOICE_TRACE_BODY` (and `VOICE_TRACE_BODY_PRODUCTION` in production). *Tests:* unit on the usage plumbing; `voice-trace.spec.ts` gating already exists.
- **VR-26** — Done when either a shared store exists or `deploy.md` states the single-instance constraint and the restart behavior (fails closed, preview must be repeated). *Tests:* none for the doc path; store path: two-process test.
- **VR-13** — Done when the F2 multi-turn scenarios pass as scripted fixtures with the fixture model; more than one open clarification can be held and answered in any order. *Tests:* scripted multi-turn fixtures (B and C bands) in the gate.
- **VR-38** — Done when a malformed or refused correction during a preview keeps the pending target and answers with a clarification, never `invalid_model_output` that drops it. *Tests:* fixture with an invalid repair result.
- **VR-03** — Done when g-b-11 and g-b-10 are offline fixtures that pass. *Tests:* the fixtures.
- **VR-06** — Done when, with a draft open, an utterance that names a draft item but returns no draft edit is routed to the draft deterministically (by id), not dropped. *Tests:* `phase4712-dayplan.spec.ts` case.
- **VN-02** — Done when a bare confirmation or negation while a preview / question is open resolves without a model call and is logged as `interpreter.ui_action`-like control; anything longer still goes to the model. *Tests:* unit on `interpreterFor`; fixture: "так" after preview → `act`; "так, але о 18" → model. Needs D-10.
- **VR-32** — Done when each of the 13 historical suites is green on the 4.1 contract or deleted with a note in the config; KI-10 closed. *Tests:* `npm run test:vnext:historical` empty or green.
- **VR-12** — Done when an independent adversarial set (wrong target, injection in titles, impossible clocks, bulk over truncated results) runs in the gate. *Tests:* the set.
- **VR-11** — Done when the scorer counts `type: "create"` and each live run stores a summary (prompt hash, model, temperature, per-scenario result) under version control or a named archive. *Tests:* scorer unit test; a committed run summary.
- **VC-15** — Done when the legacy engine has a "frozen" note in `voice-prompt-next.md` and no new rule lands there. *Tests:* none.
- **VN-03** — Done when `setup-and-build.md` says how to run the structured gate (Windows toolchain or CI; `--max-old-space-size` note). *Tests:* none.
- **VR-14** — Done when the P0 flows and the 29 Oct dialogues run on the live model against a real Google test calendar with results stored per VR-11; the agreed live bar (D-08) is met or the gaps are filed. *Tests:* live run (not offline); KI-03 manual Google checks share the account.
- **VR-08** — Done when the cold agenda read is measured after the parallel-read change and the number is in the roadmap. *Tests:* measurement, not a test.
- **VR-09 / KI-19** — Done when an English set of the F2 shape exists and is run live with stored results. *Tests:* live run.
- **VR-23** — Done when the prompt carries only the records a targeted read returned, measured tokens per turn drop and the live bar holds. *Tests:* token measurement (VR-24) before and after; live run.
- **VR-30** — Done when either the structured engine honors `mode: 'fast_create'` (fewer questions, preview and Apply kept, per spec §8) or the toggle is hidden and `mode` removed from the DTO. *Tests:* fixture with `mode` on a create that would otherwise ask; frontend test on the toggle.
- **VR-31** — Done when `VOICE_TURN_ENGINE` is gone, `POST /voice/parse-task` is removed, the e2e voice specs script `/voice/turn` only, the legacy files are deleted and docs updated. *Tests:* backend e2e and Playwright voice specs green on the structured engine.
- **VR-05** — Done when the files named have no callers and are deleted. *Tests:* build green.
- **VR-28** — Done when `npm run lint` finishes at root with exit 0 and the roadmap §42 line is corrected. *Tests:* lint in CI.
- **VN-06** — Done when `spec-voice-agent.md` marks §3 / §11 legacy-only or rewrites them for the structured engine, `voice-prompt-next.md` is marked legacy-frozen, `BUGS-AND-IMPROVEMENTS.md` points at the roadmap priority, and the jest config comment names a surviving document. *Tests:* none.
- **VR-21 / VR-22 / VR-37 / VR-29 / VR-33** — acceptance written when the item is scheduled; shapes are open.

---

## 4. Decisions requiring approval

| ID | Decision | Options | Tradeoffs | Recommendation | Consequence |
|----|----------|---------|-----------|----------------|-------------|
| D-01 | Legacy engine: remove now or after the live bar | (a) remove now; (b) keep as rollback until V7 passes, remove in V8; (c) keep indefinitely | (a) frees ~3k lines and the e2e mocks but removes the only rollback before live proof; (b) carries a frozen dual path for weeks; (c) two sources of behavior forever | **(b)**, with VC-15 freeze now | V8 holds VR-31; e2e voice specs must be rewritten to script `/voice/turn` before removal |
| D-02 | Trust in the model's `proposedId` (VC-12) | (a) rely on owned-id check + preview + explicit confirm, document it; (b) require a description ↔ stored title match; (c) ask whenever the description does not contain the stored title | (b) and (c) fight Ukrainian morphology and false negatives; (a) leaves a wrong-but-owned target visible only in the preview text | **(a)** plus VR-12 adversarial coverage and the preview always naming the stored title (already the rule) | VC-12 closes as documentation + tests, S |
| D-03 | Series group semantics for voice (VC-07) | (a) a series-wide rename / end / delete acts on the whole group (parked copies included) and the preview says so; (b) acts on the master row only, preview warns about detached copies; (c) voice refuses when a group has detached copies | (a) is what the UI does today, needs group data in the catalog (L); (b) is cheap but leaves orphan copies; (c) is safe and cheap but frustrating | **(a)** as the target, **(c)** as the MVP stopgap | VC-07 split: VB-02 stopgap refusal (S, MVP) then VB-03 full group support (L) |
| D-04 | Multi-turn session persistence | (a) in-memory per process, documented single instance (Render runs one); (b) Redis / Postgres-backed session store; (c) client-held session state signed by the server | (a) zero work, sessions die on deploy; (b) infra cost and a new failure mode; (c) larger request bodies, replay concerns | **(a)** for the MVP, written into `deploy.md`; (b) before any second instance | VR-26 becomes a doc task now and an L task later |
| D-05 | Fast create on the structured engine (VR-30) | (a) implement `mode` as a prompt policy (fewer questions, preview kept); (b) hide the toggle until (a); (c) drop Fast create | (a) adds a second prompt mode to evaluate live; (b) honest UI, no behavior change; (c) removes a shipped feature | **(b)** now (S), **(a)** in V8 after the live bar | A hidden toggle is listed in the panel rework VR-33 |
| D-06 | Several independent writes from one utterance | (a) keep: one preview with every write, one confirm, stop on first error; (b) one confirm per write; (c) cap the batch | (b) is tedious by voice; (c) already implicit (bulk needs a `find_tasks` receipt) | **(a)**, keep, with the report step after Apply | No change; VC-14 fix is required for (a) to be truthful |
| D-07 | Conversation history passed to the model | (a) last 6 turns + pending operations + referents (today); (b) full session; (c) summary of older turns | (b) raises tokens and injection surface; (c) adds a model call | **(a)**, measure with VR-24 before changing | VR-23 bounded context stays post-MVP |
| D-08 | Production model and the live bar | (a) one named model (today `deepseek-flash` measured) with the fallback chain DeepSeek → Qwen → Gemini → Groq; (b) Groq only; (c) a larger model | reproducibility needs one model per eval run; the chain hides which model produced a result | **(a)**, record model per run (VR-11); live bar ≥ 10/12, multi-turn ≥ 4/5, 0 unsafe | V7 acceptance |
| D-09 | Voice and typed chat share one pipeline | (a) same `/voice/turn` (today); (b) a text-specific path | (b) doubles the surface | **(a)** | None |
| D-10 | Which operations need explicit confirmation; deterministic yes / no | (a) every write previews and confirms (today), a bare yes / no while a question or preview is open is a deterministic control (VN-02); (b) model-only confirmation (today) | (a) is a small closed list of control words, not a lexical crutch for interpretation; (b) costs one model call and misreads | **(a)** | VN-02 scheduled in V5 |
| D-11 | Series and occurrence representation in the agent | (a) series + civil day (`occurrenceStart`), occurrences from placed slots (today); (b) occurrences from the series rule + parked days (VC-08) | (a) fails closed on parked days; (b) is the domain truth | **(b)** after VC-07 | VC-08 post-MVP |

---

## 5. Critical path and parallel work

```
V1 (VC-01, VC-13, VC-14, VC-06)
 └─ V2 (VC-02 → VC-03 → VC-04; VC-09, VC-10; VB-01 tests)
     └─ V3 core (VC-05; VB-02 stopgap for VC-07 after D-03)
         └─ V5 (VR-13, VR-38, VR-03, VR-06, VN-02 after D-10)
             └─ V7 live (VR-14, VR-15–19, VR-35, VR-08, VR-09 English)  ← MVP sign-off
                 └─ V8 (VR-30 D-05, VR-31 D-01, VR-05, VN-06)
In parallel from V2 on:  V4 (VC-12 D-02, VR-24, VR-26 doc, VR-27, VR-25)  and  V6 (VR-11, VR-12, VR-32, VN-03)
Post-MVP:                VC-08, VC-11, VC-16, VR-04, VR-23, VR-29, VR-33, V9
```

**Must stay sequential:** V1 before V2 (moves build on the create projection); VC-02 before VC-03 (Later moves become patches first); D-03 before VC-07; V1–V5 before the live run (measure after fixing, not before); V7 before VR-31.

**Overall complexity.** MVP (V1 + V2 + V3 core + V5 + V7 + VR-30 hide + VN-06): about 9 M, 4 S, 3 L — roughly **L–XL** as one program; the live run depends on a Google test account (external). Full plan including V4 gates, V6 porting and V8 removal: **XL**.
