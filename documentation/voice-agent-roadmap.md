# Voice Agent roadmap

Authoritative Voice Agent backlog after the scheduling stabilization (30 October 2026). It replaces the lost `docs/voice-vnext/LUEFY-VOICE-AGENT-ROADMAP.md` (phases 4.7.6–5.0; never in git, deleted 29 Oct) and details roadmap items §39–§43 and §48–§49 of the [product roadmap](roadmap.md). Product contract: [spec-voice-agent.md](spec-voice-agent.md). Scheduling contract the agent must follow: [placement-engine.md](placement-engine.md) (§7.6, §13). Open risks: [security-and-residual-risks.md](security-and-residual-risks.md) (R-20, G-6), [known-issues.md](known-issues.md) KI-04, KI-10, KI-19.

**Status (31 Oct 2026):** V1 (VC-01, VC-13, VC-14, VC-06) and the Stage 2 packages WP-H1, WP-J1, WP-C, WP-D, WP-F, WP-A, WP-G of the [handoff](voice-agent-handoff.md) are implemented and tested on `voice/v1-create-contract` — structured gate 256/256. Not merged into `master`. V2 (moves) is a separate stage; WP-B waits for the Scheduling merge.

**Implementing V3–V9?** Start from [voice-agent-handoff.md](voice-agent-handoff.md) — the verified baseline, the work packages, what is ready versus blocked, and the corrections this file still carries (dead code in §A, the VC-11 call sites, the VR-24 privacy wording).

**Detailed backlog:** [voice-agent-backlog.md](voice-agent-backlog.md) — every task with status, priority, complexity, acceptance criteria, required tests, MVP classification, the decisions D-01…D-11 and the critical path. This file keeps the architecture, the compatibility matrix, the phase plan and the next task. Both files share identifiers (VC, VR, VN, VB, D); a task is edited in the backlog and only summarized here.

**Evidence levels used below.** *Verified* — read in code during this review (file:line given). *Confirmed* — both sides of a conflict cited in code by the compatibility analysis; the four marked ✔ were re-checked by hand. *Suspected* — inferred, needs a test. *Reported* — stated in a transcript or deleted report, not re-measured.

**Verification pass (30 Oct 2026, second session).** Re-read in code and still true: VC-01 (`project-apply.ts:465-490`, `dayWindow` `:363-369`), VC-02 (`executeVoiceCommand.ts:107-146`; only the legacy `window` command forwards `isUnscheduled`, `:240`), VC-03 (`project-apply.ts:706, 804`), VC-05 (`project-apply.ts:506-549` sends `description: null`, `recurrencePattern: null`; `day-reminders.service.ts:64-74` replaces), VC-07 (no group fields in `production/catalog.ts`), VC-11 (noon-offset helpers still called from six voice files), VC-12 (`structured-state.ts:742-765`), VC-13 (`project-apply.ts:399, 419-426`), VC-14 (`useVoiceTask.ts:316-330`), VR-23 (`prompts.ts:108-143` lists every owned record, history is the last 6 turns), VR-26 (`session-registry.ts` in-memory `Map`), VR-30 (`dto.mode` only logged, `structured-voice.service.ts:151`, while the panel sends it on every turn, `useVoiceTask.ts:541`), dead code (no non-test caller of `alignEnvelope`, `routeOpenDraft`, `operationsTurn`, `dayPlanTurn`). No voice source file changed since the roadmap commit `4b7e4e4` (the design merges touched only `VoiceTaskSheet` layout). **Corrected:** VR-24 — prompt, transcript and model-output bodies are already gated by `VOICE_TRACE_BODY` (and `VOICE_TRACE_BODY_PRODUCTION` in production, `common/voice-trace.ts:165-173`; `turn-log.ts` writes `transcriptChars` only), so the earlier "logs raw prompts" wording was wrong; the dev log on this machine has bodies because the flag is on locally; the open part of VR-24 is token / cost metrics (`inputTokens: 0`). VR-28 — `WorldName` is exported and imported (`phase477-fixtures.ts:3`, `phase47-generalization.ts:8`); the §42 error line is stale. **Latest live evidence:** the last structured turn in `backend/logs/voice-agent.log` is 2026-10-29 05:03 (11 structured turns in total); the F2 run of 29 Oct (5/12, multi-turn 0/5) is still the latest live result. **Gate run from a Linux shell against the Windows `node_modules`:** 84/84 tests in the suites that could load (`contracts`, `state`, `search`, `phase4712*`); `read-broker.spec.ts` and `phase4712-stage41.spec.ts` could not load the native `bcrypt` binary — an environment limit, not a failure (VN-03). The 232/232 figure stands from the 30 Oct Windows run and CI (`.github/workflows/ci.yml:58`). New findings: VN-02, VN-03, VN-06 in §C.4; MVP definition and open decisions in §G.

**Working rules (user decisions, kept):** finish the structured pipeline, do not redesign it; small diffs with focused tests; never edit historical tests to raise pass counts; run the structured gate (`npm run test:vnext:structured`) at each checkpoint; terse commits, one per slice; no lexical crutches (`.claude/rules/voice-no-lexical-crutches.md`).

---

## A. Current architecture (verified)

**Engines.** `POST /voice/turn` → `VoiceService.turn` (`backend/src/modules/voice/voice.service.ts:117-141`) runs the **structured engine** (`vnext/production/structured-voice.service.ts`, `StructuredVoiceService`) unless `VOICE_TURN_ENGINE=legacy`. The **legacy engine** (`VoiceAgentOrchestrator`, `buildPlannerSystemPrompt`, router/specialist prompts, `normalizeVoiceParse`, `resolveVoiceCommand`) is the rollback, and still serves `POST /voice/parse-task` and Fast create (`dto.mode` is only honored there). "vNext" today means the structured engine on the production route; the older vNext V1 pipeline is dead code (below).

**One structured turn:**
1. **Context** — `loadContext` (`structured-voice.service.ts:520-571`): settings, phases, every task and slot of the user, reminders; `buildCatalog` (`production/catalog.ts:74-120`) makes owned entity records. A one-slot non-recurring task carries `googleEventId` / `scheduledStart`; a series carries `occurrences` (placed slots) and `seriesEventId`.
2. **Interpretation (server, LLM)** — `runInterpreterA` with `INTERPRETER_A_SYSTEM` (`interpreters/prompts.ts:3-67`) and `buildTurnUser` (`:83-143`); up to 4 read rounds through `ReadBroker` (`find_tasks` — trusted set search with a truncation flag; `find_events` — provider events). Output: `SemanticEnvelopeV1`, validated by `contracts/validate.ts` (unknown keys, recurrence, `seriesScope`, occurrence YMD), one repair attempt.
3. **Mapping** — `runStructuredTurn` (`run-structured-turn.ts:132`) → `envelopeToProposalGroup` (same-utterance edits fold into their create; an existing target becomes `{ entity: id }`).
4. **Trusted resolution and authorization (server)** — `handleGroup` (`:195-337`): bulk expansion only from a `find_tasks` receipt; catalog membership; `resolveTarget` (`state/structured-state.ts:742-765`: id in the user's catalog, writable, same type); `projectApply` (`state/project-apply.ts`): open / writable / series-scope eligibility, projection to client `VoiceWriteIntent`s.
5. **Preview** — server returns `outcome: 'confirm'` with intents and an execution claim (`executionId`, `previewRevision`); the client renders cards (`frontend/src/modules/voice/changePreviewCards.ts`).
6. **Confirmation (server)** — tap or spoken yes → `handleConfirm` (`:339-538`) re-reads every target by id and owner, compares fingerprints, returns `outcome: 'act'`. The server writes nothing.
7. **Apply (client)** — `useVoiceTask` → `executeVoiceIntents` → `executeVoiceCommand` (`frontend/src/modules/voice/`): create → `POST /tasks` with `Idempotency-Key` (via `createFromPayload`); complete / cancel → `PATCH /tasks/:id/status`; delete → `DELETE /tasks/:id`; skip → `POST /tasks/:id/skip-occurrence`; end series → `POST /tasks/:id/end-series-from`; update / window → `PATCH /tasks/:id`; move → `POST /schedule/move-event` (Google ids); shift → move-event with `slotId` (day plan); reminders → `/day-reminders`; provider rename / delete → provider endpoints. Stops at the first error, then reports outcomes (`actionId: 'report'`).
8. **Day plan** — `handleStructuredDayPlan` (`day-plan/structured-day-plan.ts`) → `VoiceDayPlanner.propose` → `planToIntents`; fingerprinted preview; Later tasks are only offered, never seeded.

**Trust boundary (decided, D-02, 30 Oct 2026 — closes VC-12 as documentation).** The server acts only on a target it resolved itself: `resolveTarget` (`state/structured-state.ts`) accepts the model's `proposedId` only when it is an id from this user's catalog, writable, and of the proposed entity type; everything else is `unauthorized_entity` and nothing is previewed. There is no description-to-title cross-check (Ukrainian morphology makes it unreliable); the guards are the owned-id check, the preview that always shows the **stored** title, and the explicit confirm with the claim of the preview the client shows. **Confirmation does not replace entity validation**: a wrong-but-owned target is caught by the user at the preview, never by a looser resolver. The adversarial set (VR-12) is the regression net for this boundary.

**Dead code, not production behavior — corrected 30 Oct 2026 (see [voice-agent-handoff.md](voice-agent-handoff.md) §3.2 for the import-closure result).** Dead at *function* level inside a live file: `pipeline.ts` `operationsTurn` / `dayPlanTurn` (`runVNextTurn` in the same file is the live entry). Dead *files*: `session/utterance-policy.ts` (`alignEnvelope`, `routeOpenDraft`), `apply/frontend-contract.ts`, `state/structured-session-store.ts`, `errors.ts`, `cli.ts`; `llm/live-complete.ts` and `llm/pricing.ts` are the live-evaluation harness and stay (pricing is now also used by the production turn log). **Live, do not delete:** `adapter/` (`scope.ts` is imported by `run-structured-turn.ts`, `project-apply.ts`, `validate.ts`), `reference/reference-resolver.ts`, `session/corrections.ts`. `alignEnvelope` rewrote intents (a bare "так" into `confirm_pending`) but nothing calls it; the spoken yes / no is now a deterministic control in `StructuredVoiceService.interpreterFor` (D-10).

---

## B. Compatibility matrix (structured engine × scheduling domain)

| Operation | Prompt | Schema / validator | Resolver / projection | Scheduling call | Preview / confirm | Existing tests | Gap |
|-----------|--------|--------------------|-----------------------|-----------------|-------------------|----------------|-----|
| Create one-off fixed | ok (`prompts.ts:52-53`) | ok | ok (`fixed`, end derived) | `POST /tasks` | ok | `structured-voice.service.spec.ts:765` | — |
| Create one-off flexible / preferred clock | ok | ok | ok | `POST /tasks` | ok | `:756` | — |
| Create Later | ok (`:39`) | ok | ok | `POST /tasks` | ok | stage41, phase472/473 | — |
| Create series, start / start+end | ok | ok | ok | `POST /tasks` | ok | `:727-754` | — |
| Create series, preferred / window / end only / date only | steered to `preferred` (`:53-54`) | ok | **VC-01**: `deadline` = first day | series ends after day 1 | misleading | none | fixed (V1) |
| Create series, no clock | ok | ok | `isUnscheduled: true` (**VC-13**) | server coerces to series | shows as Later | `:741` | fixed (V1) |
| Update one-off | ok | ok | ok; fixed edge cases (**VC-10**); Later broken (**VC-02**) | `PATCH /tasks/:id` | ok | `:843` | Later, fixed |
| Update whole series | ok | ok | fields only | `PATCH`; name etc. breaks group (**VC-07**) | scope not shown (**VC-06**) | partial | group |
| Update one occurrence / from a day | asks | ok | refused (fails closed) | — | — | — | by design for now |
| Delete task / whole series | ok | ok | `DELETE` | ok | "whole series" not shown (**VC-06**) | `:620` | fixed (V1) |
| Delete one day | ok | ok | skip with `occurrenceStart` | `skip-occurrence` | ok | `:620` | parked days (**VC-08**) |
| Delete this and following | ok | ok | `end_series` | `end-series-from` | ok | `:626` | siblings (**VC-07**) |
| Move one-off, Google-synced | ok | ok | `move` with event id | `move-event` | ok | stage3b, phase4712 | — |
| Move one-off, local only / Later | ok | ok | **VC-03 / VC-02** | — | refused / no effect | none | **P1** |
| Move occurrence / following / all | ok | ok | needs Google ids (**VC-03**); cross-day (**VC-04**) | `move-event` + `seriesScope` | scope hidden | `:638`, `:660` | no-Google, cross-day |
| Move provider event | ok | ok | `move` with provider, re-read | `move-event` | ok | `:501` | — |
| Skip | ok | ok | series day only; one-off refused (**VC-09**) | `skip-occurrence` | ok | `:632` | one-off, parked |
| Reminder create / resolve / delete | ok | ok | ok; no clock = default time | `/day-reminders` | ok | `:318` | — |
| Reminder update | ok | ok | **VC-05** full replace | `PATCH /day-reminders/:id` | ok | none | **P1** |
| Day planning | ok | ok | one-off flexible only; `shift` by `slotId` | `move-event` / `PATCH` / `POST` | plan cards | `phase4712-dayplan.spec.ts` | DST (**VC-11**) |
| Batch / bulk | ok (`:25`) | ok | `find_tasks` receipt only; series need scope | per row | per-row cards | `phase4712-bulk.spec.ts`, `find-tasks.spec.ts` | filter semantics (**VC-16**) |
| Mark done | ok | ok | one-off → status; occurrence → skip; series → status | `PATCH status` / skip | ok | `:679` | — |
| Frontend executor | — | — | — | — | — | `executeVoiceIntents.spec.ts` (provider events only) | update, move, skip, end, reminder (VC-14 dedupe fixed in V1) |

**Compatible, do not re-fix:** only `fixed` / `admin` event types are emitted (no deprecated values, no `isProblematic`); every field voice sends is declared in `CreateTaskDto` / `UpdateTaskDto` / `SkipOccurrenceDto`, so the validation pipe strips nothing; occurrence identity is series + civil day sent as `occurrenceStart` (slot ids are never stored as occurrence ids); delete scope mapping occurrence → skip, from_day → end-series-from, all → DELETE; move scope from_day → `series`; patterns DAILY / WEEKLY / BIWEEKLY / MONTHLY exist in the engine; a null reminder clock falls back to the settings default; creates carry an Idempotency-Key; owner / writable / open checks, confirm-time re-read and fingerprints are in place.

---

## C. Consolidated unfinished work

### C.1 Scheduling compatibility findings (new, 30 Oct 2026)

| ID | Finding | Level | Priority | Required change | Required tests |
|----|---------|-------|----------|-----------------|----------------|
| VC-01 | A recurring create with a preferred clock, a window, an end, an interval or a date only gets `deadline` (and `earliestStartTime`) from a one-day window (`project-apply.ts:469-486`, `dayWindow` `:363-369`). On a series, `deadline` is the series end (`placement-step.service.ts:1425-1427`, `tasks.service.ts` `recordSeriesEnd`), so "every day around 18:00" makes a one-day series | **Fixed 30 Oct 2026 (V1)** | P0 | Never derive `deadline` / `earliestStartTime` from a day window for a recurring create; carry a preferred clock as the series clock; refuse (`unrepresented`) what a series cannot hold (a daily window). Fix the legacy line calling deadline the end of a "recurring placement window" (`prompt-modules/kind-when.ts:7`) | Recurrence × {preferred, end, interval, date only, `spanRole: 'window'`, earliest/deadline} in `structured-voice.service.spec.ts`: no `deadline` on the intent, or a refusal |
| VC-13 | A recurring create with no clock is projected `isUnscheduled: true` (`project-apply.ts:399, 419-426`); the card shows it as Later; the server makes it a series | **Fixed 30 Oct 2026 (V1)** | P1 | Emit `isUnscheduled: false` for recurring creates | projection + card test |
| VC-14 | Client create dedupe key `name|earliestStartTime|deadline` for 15 s (`frontend/src/modules/voice/hooks/useVoiceTask.ts:316-330`): two fixed creates with one name in one request ("call mom at 10 and at 15") send one POST and report both applied | **Fixed 30 Oct 2026 (V1)** | P0 | Remove the dedupe (the Idempotency-Key covers retries) or key on the whole payload | frontend test: two creates with one name and different clocks → two calls; a retried identical create → one task (key) |
| VC-06 | Preview text hides the series scope: delete of a whole series reads "Delete “Gym”" (it also deletes parked copies); move/done of `series` / `all` look like one-offs (`commandSummary` `project-apply.ts:579-606`; cards `changePreviewCards.ts:249-284`) | **Fixed 30 Oct 2026 (V1)** | P1 | Name the scope in the summary and on the card (whole series / this day and following / every open day / this day) | summary assertions per scope; card test |
| VC-02 | Later tasks cannot be scheduled by voice: no `isUnscheduled: false` in update / date move (`project-apply.ts:689-701, 852-904`); the frontend update mapper does not forward it (`executeVoiceCommand.ts:107-146`, only legacy `window` at `:240`); the server wipes the clock while `isUnscheduled` stays true (`tasks.service.ts` `applyUnscheduledConstraints`). The preview claims a move | Confirmed ✔ | P1 | Projection adds `isUnscheduled: false` for a Later target; mapper forwards it; a clock move of a slotless task becomes a patch | projection test + frontend executor test |
| VC-03 | Voice moves require Google identity: one-off needs `target.googleEventId` (`project-apply.ts:706`), series needs occurrence and series event ids (`:804`). Tasks without Google (user not connected) cannot be moved; the DTO's `slotId` path exists (`displayed-event-move.service.ts:126-145, 207-248`) | Confirmed ✔ | P1 | Emit `slotId` (or `originalStart`) and drop the Google-id prerequisite | no-Google one-off and series move tests |
| VC-04 | A series occurrence moved to another day is previewed, then the server rejects it ("Recurring tasks can only be moved within the same day", `displayed-event-move.service.ts:213-219`) | Confirmed | P1 | Refuse or ask at preview when the target day ≠ occurrence day; prompt rule | projection test |
| VC-05 | Reminder update sends nulls for description, recurrence, clock and requires a date (`project-apply.ts:506-549`); the server replaces the whole reminder (`day-reminders.service.ts:64-74`): "move reminder to Friday" wipes its repeat, notes and clock | Confirmed | P1 | Stored reminder fields in the catalog and merged in projection (or a partial endpoint) | `remind_update` tests (none exist) |
| VC-07 | Voice does not know series groups or detached copies (no `seriesGroupId` / `parentSeriesId` / `originalOccurrenceYmd` / `skippedOccurrenceYmds` in the structured path); series rows carry no clock, so same-name siblings are indistinguishable; a series-wide rename detaches one sibling (`series-group.util.ts`), end/delete act on one row | Confirmed (voice side); intended group semantics Suspected | P1 (needs a product decision) | Group key and per-day clocks in the catalog; decide group semantics for update / end / delete | group fixtures: rename, end from a day, delete |
| VC-08 | Occurrences come only from placed slots (`pickOccurrence` `project-apply.ts:740-747`): parked days, days past the horizon, detached days give `occurrence_not_found` (fails closed) | Confirmed | P2 | Derive occurrences from the series rule and parked days | parked-day skip, beyond-horizon skip |
| VC-09 | Skip of a one-off flexible task refused (`project-apply.ts:671-672`, stale comment); the domain allows it | Confirmed | P2 | Project skip for a one-slot task | projection test |
| VC-10 | Fixed edge cases: date-only update emits a window a fixed task ignores (`:889-891`); date+start without end keeps the old end; `resolveEnd` grows short tasks (`:950-952`); notes cannot be cleared (`executeVoiceCommand.ts:111`) | Confirmed in code; impact Suspected | P2 | Fixed: require both clocks or derive end from the stored length; forward `description: null` | unit tests per case |
| VC-11 | Day bounds use the noon-offset helpers `startOfLocalDayIso` / `endOfLocalDayIso` (`voice-local-date.util.ts:150-156`) in `find_events`, the confirm re-read, agenda tools and plan deadlines; the domain uses `civilDayStartIso` (AUD-014) | Confirmed | P2 | Switch these callers to `civilDayStartIso(day)` … `civilDayStartIso(day + 1)` | DST-day tests (America/New_York 14 Mar 2027) |
| VC-12 | Production trusts the model's `proposedId` when it is an owned, writable id of the right type (`structured-state.ts:742-755`); no description cross-check although the prompt says "do not trust a guessed id". Mitigation: the preview shows the stored title; confirm is explicit | Confirmed | P1 (decision) | Decide: rely on preview + confirm (document it) or require a description match | adversarial wrong-target set (V6) |
| VC-15 | Legacy engine semantics: regex `sniffSeriesScope` overrides the model; delete occurrence uses the next open slot, not the named day; skip refuses fixed series days the domain allows | Confirmed | P2 (rollback only) | Freeze the legacy engine; remove it in V8 | — |
| VC-16 | `find_tasks`: `scheduled: false` means "no slot" (parked tasks count as Later); `nameContains` is a raw substring (no Ukrainian morphology) | Confirmed | P2 | Use `isUnscheduled` / `scheduleState`; document that morphology is the model's job | find-tasks tests |

### C.2 Carried requirements (recovered from transcripts, memory and docs)

Sources: transcripts `1e1b2f43`, `400b5cbf`, `2c8a4c6e`, `ab1768c0`, current session; memory notes `voice-mvp-roadmap`, `voice-product-decisions`, `voice-working-agreement`; roadmap §39–§49; known-issues. **[USER]** = a user decision.

| ID | Requirement | Source | Status | Evidence / note |
|----|-------------|--------|--------|-----------------|
| VR-01 | Lifecycle: interpret → authorized resolve → preview → explicit confirm → Apply → outcome; never write silently; fail closed | ChatGPT handoff 29 Oct (`400b5cbf`); memory | Done | `run-structured-turn.ts`; `phase4712-stage41.spec.ts` |
| VR-02 | Trusted entity identity (catalog / pending ids only) | Stage 4.1 prompt (`1e1b2f43`); 4.7.6 note "resolved an owned id with no description" | Done on the live path; see VC-12 | `resolveTarget`, `contracts/proposal-validate.ts` |
| VR-03 | A pending preview is a valid target (g-b-11 rebind, g-b-10 two clocks on one task) | 4.7 generalization recommendations (`2c8a4c6e`) | Partial — contract has `pending` targets; g-b-11 / g-b-10 not re-run live | Reported 65/100 generalization run |
| VR-04 | Operation-specific ownership / status / write rights | review focus; Stage 4.1 §3 | Partial — one `writable` flag; catalog tasks hard-coded writable (`production/catalog.ts:92,105`) | owner / open / organizer checks exist |
| VR-05 | `alignEnvelope` rewriting | review focus | Dead code; delete in V8 | `session/utterance-policy.ts:37` |
| VR-06 | Active day-plan draft routing when the model emits no draft edit | 4.7.7 risk | Partial — prompt-only routing, no deterministic fallback; ids on plan items, duplicate adds dropped | `phase4712-dayplan.spec.ts` |
| VR-07 | **[USER]** Later tasks never enter a plan automatically; only offered | memory `voice-product-decisions` | Done | test "does not seed Later tasks" |
| VR-08 | 29 Oct dialogue bugs 1–6 | `1e1b2f43` backlog | 1–5 done offline; 6 (agenda latency) partial | not verified live |
| VR-09 | Ukrainian morphology / multilingual matching | 4.7 recommendations; KI-19 | Old stemmer obsolete (model picks ids); English live evaluation outstanding | VC-16 |
| VR-10 | Reminder persistence and default reminder time | 4.7.6 report (name only) | Done for create; update broken (VC-05) | `structured-voice.service.ts:550` |
| VR-11 | Benchmark metadata and reproducibility | 4.7.x | Partial — CLI records prompt hash, model, temperature, resumes; all run outputs deleted; scorer blind spot for `type: "create"` unfixed | `eval/phase47-generalization-cli.ts` |
| VR-12 | Independent and adversarial test sets | 4.7.10 ("never executed"); generalization adversarial 13/20 | Outstanding | — |
| VR-13 | Multi-turn state: corrections, clarification, same-request dependencies | handoff P0; KI-04 | Partial — offline covered; live multi-turn 0/5; one active clarification only | F2 run 29 Oct |
| VR-14 | §39: P0 flows on a live model and a real Google calendar | roadmap §39; memory | Outstanding | no `/voice/turn` in the log after 29 Oct 05:05 |
| VR-15 – VR-19 | P0: bulk selection, provider events (**[USER]** done on a provider event is refused; rename of an organizer event allowed), recurrence scope + skip, time semantics, dependent actions | handoff P0; memory | Done offline; not live-verified; ordering after a new create without a clock asks (by design) | `phase4712-*.spec.ts`, `find-tasks.spec.ts` |
| VR-20 | **[USER]** Multi-slot non-recurring move | memory | Deliberately unsupported | engine does not split |
| VR-21 | §40 preference profile: reuse settings; "remember that…" only after confirm; preferences are soft, never an entity id | handoff P1; 4.7.11 "memory must not become a trusted entity id" | Partial — settings reused; no remember operation or store | — |
| VR-22 | Learned preference profile | roadmap "Later — decide before building" | Outstanding, shape open | — |
| VR-23 | §41 bounded context (targeted reads instead of every record in the prompt) | handoff; roadmap §41 | Outstanding | `buildTurnUser` lists every row (`prompts.ts:108`); ~4k tokens/turn reported |
| VR-24 | Token / cost / latency per turn without raw content | roadmap §41 | Partial — bodies (prompt, transcript, model output) are gated by `VOICE_TRACE_BODY` / `VOICE_TRACE_BODY_PRODUCTION` (`common/voice-trace.ts:165-173`, verified 30 Oct); token and cost counts are missing | `structured-voice.service.ts:314` returns `inputTokens: 0`; quota still counts via `groq.client.ts` `recordTokens` |
| VR-25 | §42 revision / ETag preconditions on Apply | roadmap §42 | Outstanding — revalidation at confirm only | — |
| VR-26 | §42 shared session store or a documented single instance | roadmap §42 | Outstanding — process-local `Map` (`production/session-registry.ts`) | Render runs one instance |
| VR-27 | §42 idempotent Apply / unknown-outcome reconciliation | roadmap §42 | Partial — server blocks resend of an unknown outcome; client commands other than create send no key | — |
| VR-28 | §42 runnable lint; WorldName typecheck error | roadmap §42 | Lint not run in either review; `WorldName` verified present (`phase477-fixtures.ts:3`, imported by `phase47-generalization.ts:8`) — the §42 line is stale | `400b5cbf` |
| VR-30 | Fast create on the structured engine | roadmap §43, §48 | Defect: `dto.mode` ignored by the structured engine; the panel toggle is a silent no-op in production (see also D-05) | `structured-voice.service.ts:151`; `useVoiceTask.ts:541` |
| VR-29 | §43 polish: short clarifications, before → after diff, plan uses §40 preferences, fast create under an explicit confirm policy | roadmap §43 | Outstanding | — |
| VR-31 | **[USER]** §49 remove the legacy engine (full switch) | roadmap §49 (`ab1768c0`) | Outstanding — after §39 | blockers: rollback switch, legacy e2e specs |
| VR-32 | Port historical vNext suites (13 suites, 215 pass / 77 fail) | KI-10 | Outstanding | `jest.vnext-historical.config.js` |
| VR-33 | **[USER]** §48 Companion panel rework (draft layout, Fast create toggle) | roadmap §48 (`ab1768c0`) | Outstanding | — |
| VR-34 | **[USER]** Full voice logging with steps and timings | `1e1b2f43` | Done (`voice.trace`, `TurnLog`) — conflicts with VR-24 privacy | — |
| VR-35 | Voice follows fixed/flexible × series and occurrence/future scope | stabilization C2 | Done (`5b6bf7d`); not re-measured live | VC-01 is the remaining hole |
| VR-36 | Provider exactly-once Apply / Apply surface (old 4.10/4.11) | 4.7.11 | Apply surface and production route done; exactly-once = VR-25/27 | — |
| VR-37 | Contacts ("my manager") | handoff P1 optional | Deferred | — |
| VR-38 | Invalid JSON / refused corrections ("rename during preview" → `invalid_model_output`, target lost) | 4.7.7; F2 run | Outstanding | — |

### C.3 Live results on record (reported, not re-run here)

| Run | Result |
|-----|--------|
| 4.7.7 … 4.7.11 (27–28 Oct; reports deleted) | single-turn 63/89 → 88/89; conversations 18/38 → 38/38; unsafe 1 → 0; independent holdout 29/30, 15/15 |
| 4.7 generalization stress (28 Oct) | 65/100 scenarios (natural 36/50, complex 16/30, adversarial 13/20), 5 unsafe previews (g-b-11 rebind) |
| F2 live run (29 Oct, `deepseek-flash`, 12 Ukrainian scenarios) | 5/12; multi-turn 0/5; 7 unnecessary clarifications, 4 intent errors; 0 unsafe, 0 writes; p50 1.0 s |
| Offline structured gate | 178 → 232/232 (30 Oct, Windows run and CI); 84/84 in the suites loadable from a Linux shell (second session, see the verification note) |

Offline results are never evidence of live model quality. Live runs after 29 Oct: none (`logs/voice-agent.log`).

### C.4 Findings of the verification pass (new, 30 Oct 2026, second session)

| ID | Finding | Level | Priority | Required change | Required tests |
|----|---------|-------|----------|-----------------|----------------|
| VN-02 | A spoken confirmation or refusal is model-interpreted only: the prompt asks for a `confirm_pending` / `cancel_pending` control (`interpreters/prompts.ts:28-30`); `interpreterFor` (`structured-voice.service.ts:279-286`) maps only UI `actionId`s and noise deterministically. A misread "так" costs a model call and can re-ask — a plausible contributor to the F2 "7 unnecessary clarifications" | Verified in code; effect Suspected | P1 | With a preview or question open, a bare yes / no in uk / en resolves as a control without a model call; anything longer still goes to the model. Needs D-10 (a closed list of control words is not a lexical crutch for interpretation; confirm with the owner against `.claude/rules/voice-no-lexical-crutches.md`) | unit on `interpreterFor`; fixtures "так" → `act`, "так, але о 18" → model |
| VN-03 | The structured gate and `npm test` are not runnable from a shell whose OS differs from the one that installed `node_modules` (native `bcrypt`), and `--runInBand` needs about 1.5 GB of heap | Verified (this session) | P2 | Document in `setup-and-build.md`: run on Windows or in CI; `NODE_OPTIONS=--max-old-space-size=3000` | — |
| VN-06 | Documentation disagrees on what is production: `spec-voice-agent.md` §3 / §11 describe the legacy planner split and legacy read tools (`get_now_next`, `match_task`, …) as the turn; `voice-prompt-next.md` calls `buildPlannerSystemPrompt` production; `BUGS-AND-IMPROVEMENTS.md` "Зараз" lists §37 / §38 while `roadmap.md` puts the Voice MVP first; `jest.vnext-structured.config.js` cites the deleted STAGE-4.1-REPORT | Verified | P2 | Mark §3 / §11 legacy-only or rewrite for the structured engine; mark `voice-prompt-next.md` frozen; align the BUGS file; fix the config comment | — |
| — | `POST /voice/parse-task` has no UI caller (`frontend/src/api/voice.api.ts:280` `parseTask` is unused); only the legacy engine and the Playwright voice specs (`e2e/helpers/voice.ts:79`, `e2e/tests/p1.voice.spec.ts:305`) use it | Verified | — | Folded into VR-31 (removal) and listed as a VR-31 blocker | — |

---

## D. Implementation phases

Order: contract correctness → security and trusted resolution → multi-turn → deterministic tests → live quality → product integration → personalization. Every phase ends with: structured gate green, backend unit + e2e green, frontend tests green, no historical test edited.

### V1 — Create and preview correctness against the scheduling contract (P0) — **done, 30 Oct 2026**
- **Scope:** VC-01, VC-13, VC-14, VC-06. All four fixed with tests; see §C.1 and the V1 result note below.
- **Files:** `backend/src/modules/voice/vnext/state/project-apply.ts` (`projectCreate`, `dayWindow` use, `commandSummary`), `vnext/interpreters/prompts.ts` (series clock rule), `backend/src/modules/voice/prompt-modules/kind-when.ts` (one stale line, legacy), `frontend/src/modules/voice/hooks/useVoiceTask.ts` (dedupe), `frontend/src/modules/voice/changePreviewCards.ts`.
- **Depends on:** nothing.
- **Tests:** see §F.
- **Done when:** no recurring create intent carries a day-window `deadline` / `earliestStartTime`; a recurring create with no clock is not shown as Later; two creates with one name in one request both reach `POST /tasks`; every series-scoped preview names its scope. **All met.**
- **Result:** structured gate 242/242 (232 before, 10 new); frontend voice suites 26/26; i18n and api suites 15/15; backend `tsc --noEmit` clean on `src/` and `nest build` green; frontend `tsc --noEmit` clean. The frontend production bundle (`npm run build`) was not run in that session (tooling time limit) and is left to CI. Live behavior is unchanged in this phase: no live model run (V7).
- **Risk taken:** one prompt rule changed (a softened clock on a repeat is the series clock; a repeat emits no window or bound). Re-measure in V7.

### V2 — Move and schedule paths (P1) — **next**
- **Scope:** VC-02 (schedule a Later task), VC-03 (`slotId` moves without Google), VC-04 (cross-day series move refused at preview), VC-09 (skip a one-off), VC-10 (fixed edge cases).
- **Files:** `project-apply.ts` (`projectMove`, `projectSeriesCommand`, `updatePatch`, `resolveEnd`), `production/catalog.ts` (slot ids for moves), `frontend/src/modules/voice/executeVoiceCommand.ts` (forward `isUnscheduled`, `description: null`).
- **Depends on:** V1.
- **Tests:** projection tests for each finding; first frontend executor tests for update / move / skip.
- **Done when:** a Later task and a no-Google task can be moved by voice with a truthful preview; a cross-day series move is refused before confirm.
- **Risk:** move-event `slotId` path for series (verify with `displayed-event-move.service.spec.ts`).

### V3 — Reminders, series groups, occurrences, DST (P1/P2)
- **Scope:** VC-05 (reminder update merges stored fields), VC-07 split by D-03 into VB-02 (MVP stopgap: refuse a series-wide write when the series has parked or detached copies, and say why) and VB-03 (full group support, post-MVP), VC-08 (parked / beyond-horizon occurrences, post-MVP), VC-11 (`civilDayStartIso` in voice day bounds, post-MVP), VC-16 (`find_tasks` filters, post-MVP). MVP core of this phase: VC-05 + VB-02.
- **Files:** `project-apply.ts` (`projectRemind`, `pickOccurrence`), `production/catalog.ts` (reminder fields, group key, per-day clocks), `structured-voice.service.ts:466, 498`, `voice-agent.tools.ts:131-164`, `voice-agent.plan-draft.ts:491`, `search/find-tasks.ts`.
- **Depends on:** V2; VC-07 decision.
- **Tests:** `remind_update` cases; group fixtures; DST-day reads (America/New_York, 14 Mar 2027); parked-day skip.
- **Done when:** a reminder move keeps its repeat, notes and clock; group behavior matches the agreed decision; DST-day events are found.

### V4 — Security and trusted resolution (P1)
- **Scope:** VC-12 decision (document reliance on preview + confirm, or add a description match); VR-04 per-action rights (rename / move / delete) instead of one `writable` flag; VR-27 Idempotency-Key or equivalent for non-create Apply commands; VR-25 revision preconditions on Apply (`If-Match` or a revision field checked by the task endpoints); VR-24 token / cost / latency per call in `TurnLog` and `voice_turn_logs` (body gating already exists — keep it); VR-26 decide: shared session store or a documented single-instance constraint (D-04). Classification: VC-12 and VR-24 are MVP; VR-25, VR-26, VR-27 are rollout gates (G-6); VR-04 is post-MVP. This phase runs in parallel with V2–V5.
- **Files:** `structured-state.ts`, `project-apply.ts`, `production/catalog.ts`, `production/session-registry.ts`, voice logging (`TurnLog`, `voice.trace`), tasks controller (revision check, if chosen).
- **Depends on:** V1–V2.
- **Tests:** adversarial wrong-target cases; stale-revision Apply refused; token counts present in the turn log; `voice-trace.spec.ts` body gating stays green.
- **Done when:** G-6 items in [security-and-residual-risks.md](security-and-residual-risks.md) that belong to voice are closed or explicitly accepted.

### V5 — Multi-turn and draft continuity (P1)
- **Scope:** VR-13 (more than one active clarification; corrections to pending previews), VR-38 (rename during preview keeps its target), VR-03 (re-run g-b-11 / g-b-10 offline as fixtures), VR-06 (deterministic routing to an open day-plan draft when the model returns no draft edit), VN-02 (deterministic bare yes / no while a preview or question is open; after D-10).
- **Files:** `run-structured-turn.ts`, `state/structured-state.ts`, `day-plan/structured-day-plan.ts`, `production/structured-voice.service.ts` (`interpreterFor`).
- **Tests:** scripted multi-turn fixtures for each F2 failure (B and C bands).
- **Done when:** the F2 multi-turn scenarios pass with the fixture model.

### V6 — Deterministic tests and evaluation harness (P1)
- **Scope:** frontend executor coverage for every intent kind (VB-01; written red during V2, completed here); port or retire the 13 historical suites (VR-32, KI-10); an independent adversarial set (VR-12); fix the scorer blind spot for `type: "create"`; keep run outputs (summary JSON committed or archived) so results are reproducible (VR-11); document how the gate runs (VN-03). Runs in parallel with V3–V5.
- **Files:** `frontend/src/modules/voice/*.spec.ts`, `backend/jest.vnext-historical.config.js`, `vnext/eval/`, `documentation/setup-and-build.md`.
- **Done when:** historical suites are either green on the 4.1 contract or deleted with a note; the adversarial set runs offline in the gate.

### V7 — Live LLM quality (§39)
- **Scope:** VR-14 live P0 run with a real Google test calendar (also part of KI-03), including VR-15–19 and VR-35; replay the 29 Oct dialogues and measure the cold agenda read (VR-08.6); reduce unnecessary clarifications (F2: 7); English live set (VR-09 / KI-19). VR-23 bounded context moves after this phase: measure tokens with VR-24 first, then shrink the prompt (post-MVP unless the measurement forces it).
- **Depends on:** V1–V5 and VR-24 (fixes first, then measure); a Google test account (external). This is the MVP sign-off.
- **Done when:** an agreed live bar (proposal: ≥ 10/12 F2 scenarios, 0 unsafe, multi-turn ≥ 4/5) on Ukrainian and a first English set; results stored with prompt hash and model.

### V8 — End-to-end product integration (§43, §48, §49)
- **Scope:** VR-30 Fast create honored by the structured engine, after D-05 (until then the toggle is hidden — an S task that can land in any earlier phase); VR-31 remove the legacy engine, `POST /voice/parse-task` (no UI caller) and the dead vNext code (VR-05: `pipeline.ts` V1 body, `adapter/`, `utterance-policy.ts`, `corrections.ts`, reference stemmer), legacy e2e specs (`e2e/helpers/voice.ts`, `p1.voice.spec.ts`) rewritten to script `/voice/turn`; VR-33 Companion panel rework; VR-29 polish; VN-06 documentation alignment (can start earlier, S); VR-28 lint.
- **Depends on:** V7 live confirmation (§49 rule, D-01).
- **Done when:** `VOICE_TURN_ENGINE` is gone; docs updated (spec-voice-agent §3 / §11, voice-prompt-next, voice-fix-flow, dialogue test plan, voice rule, BUGS file, jest config comment).

### V9 — Personalization (§40, later)
- **Scope:** VR-21 confirmed "remember that…" preferences as soft constraints (never ids); day plan uses them; VR-22 learned profile only after its shape is agreed; VR-37 contacts.
- **Depends on:** V5, V7.

---

## E. Acceptance criteria summary

| Phase | Observable success | Definition of done |
|-------|--------------------|--------------------|
| V1 | Series creates keep their series; previews name scope; no lost creates | **Done 30 Oct 2026** — gate 242/242, frontend voice 26/26 |
| V2 | Later / no-Google / fixed moves work or are refused before confirm | Projection + executor tests; no preview that Apply contradicts |
| V3 | Reminder edits keep fields; DST days read correctly; group decision implemented | Tests per finding |
| V4 | Wrong-target and stale Apply refused; no transcripts in logs | Voice part of G-6 closed or accepted |
| V5 | F2 multi-turn fixtures pass | Scripted fixtures in the gate |
| V6 | Historical suites resolved; adversarial set offline | KI-10 closed |
| V7 | Live bar met; results reproducible | KI-04 closed or re-scoped; KI-19 started |
| V8 | One engine | §49 done; docs updated |
| V9 | Preferences used, never as ids | — |

---

## F. V1 as shipped, and the next execution task — V2 (do not start without the go-ahead)

### V1 — shipped 30 October 2026

**Goal met:** the structured engine no longer creates a broken series, no longer hides a series-wide effect, and no longer drops a create.

| ID | Change | Where |
|----|--------|-------|
| VC-01 | A recurring create is checked before any day window is applied: a daily window (`interval`, `spanRole: 'window'`), an `earliest` / `deadline` bound, an end clock without a start, or an ordering bound on a repeat is refused with `unrepresented_constraint`. A `preferred` clock becomes the series clock (`scheduledStartTime`, `eventType: 'admin'`) with no window; a date with no clock sets `earliestStartTime` to the civil-day start (the series anchor) and no `deadline`; a repeat with its own start and end stays a fixed series | `vnext/state/project-apply.ts` (`projectCreate`) |
| VC-13 | A recurring create carries `isUnscheduled: false`: a series is never the Later inbox | `project-apply.ts` |
| VC-06 | `commandSummary` appends the scope of a write on a repeating Luefy task — uk / en: whole series, this day and following, this day only, and every open day for a series-wide move. Series-wide `delete` / `complete` / `cancel` / `update` now carry `seriesScope: 'all'`, so the card shows the scope chip; a one-off and a provider instance are unchanged | `project-apply.ts` (`commandSummary`, `scopeSuffix`, `projectSeriesCommand`), `voice-command.types.ts`, `frontend/src/api/voice.api.ts`, `changePreviewCards.ts`, `components/ChangePreviewCards.tsx`, `i18n/locales/{en,uk}.json` |
| VC-14 | The 15 s name-based create dedupe is gone: every create reaches `POST /tasks`. Retries stay covered by the Idempotency-Key in `createFromPayload` | `frontend/src/modules/voice/hooks/useVoiceTask.ts` |
| prompts | One rule: on a repeat a softened clock is the series clock (role `start`, not `preferred`), and a repeat emits no daily window, bound, or end-without-start — ask for the usual clock instead. Legacy wording fixed: `deadline` on a series is the series end, never a daily window | `vnext/interpreters/prompts.ts`, `prompt-modules/kind-when.ts` (legacy text only) |

**Tests added (each failed before its fix):** `structured-voice.service.spec.ts` — six cases under "a series never carries a day window (VC-01, VC-13)" plus "names the series scope in every preview summary and carries it on the command"; `state/command-summary.spec.ts` — three scope cases (uk + en, one-off and provider instance unchanged); `frontend/changePreviewCards.spec.ts` — a recurring create with no clock is a flexible series, and the scope reaches the card; `frontend/executeVoiceIntents.spec.ts` — two creates with one name and different clocks both reach `onCreate`.

**Verification run:** structured gate 242/242 (232 before, 10 new); frontend voice suites 26/26; frontend i18n and api suites 15/15; backend `tsc --noEmit` clean on `src/` (the pre-existing `benchmark/` errors reference gitignored `.tmp` prompts and are outside the build); `nest build` green; frontend `tsc --noEmit` clean. Not run: the frontend production bundle and the backend e2e suite — left to CI. No live model run; V1 changes nothing that was measured live.

**Two expectation updates, not weakened tests:** "completes one occurrence …" now expects the scope suffix (the behavior VC-06 adds), and the Ukrainian verb for a series-wide done is the stored `Позначити виконаною`.

### V2 — next

- **Scope:** VC-02 (schedule a Later task), VC-03 (`slotId` moves without Google), VC-04 (cross-day series move refused at preview), VC-09 (skip a one-off), VC-10 (fixed edge cases), VB-01 (frontend executor coverage, written red first).
- **Files:** `project-apply.ts` (`projectMove`, `projectSeriesCommand`, `updatePatch`, `resolveEnd`), `production/catalog.ts` (slot ids for moves), `frontend/src/modules/voice/executeVoiceCommand.ts` (forward `isUnscheduled`, `description: null`).
- **Order inside the phase:** VC-02 before VC-03 (a Later move becomes a patch first), then VC-04, then VC-09 and VC-10.
- **Done when:** a Later task and a task without Google can be moved by voice with a preview Apply can honor; a cross-day series move is refused before confirm.
- **Out of scope for V2:** reminders and group semantics (V3), the legacy engine (V8), anything live (V7).

**Verification for every phase:** `npm run test:vnext:structured`, backend `npx jest`, `npm run test:e2e`, frontend `npx jest --config jest.config.cjs`, both builds. No historical test edited to pass.

---

## G. MVP definition, open decisions, critical path

Full text in [voice-agent-backlog.md](voice-agent-backlog.md) §1, §4, §5. Summary:

**MVP** = the Companion as a trustworthy task controller for one user's own calendar: quick capture (W1), routines (W2), move / postpone including Later and no-Google tasks (W3), natural edits with visible series scope (W4), reminders (W5), calendar state (W6), day plan (W7), multi-turn answer / correct / confirm (W8), confirm destructive actions and explain failures (W9), same pipeline for voice and text (W10). Not MVP: preference memory, contacts, panel rework, before → after diff, multi-slot moves, habits, more languages. Proposed live bar (D-08): F2 Ukrainian ≥ 10/12, multi-turn ≥ 4/5, 0 unsafe, 0 unconfirmed writes; a first English set ≥ 10/12.

**Decisions — all approved by the owner on 30 October 2026** (options and tradeoffs in the backlog §4; the column below is now the decision, not a proposal):

| ID | Decision | Needed by | Decision taken |
|----|----------|-----------|----------------|
| D-01 | Legacy engine: remove now or after the live bar | V8 | keep as rollback, freeze now (VC-15), remove in V8 |
| D-02 | Trust in the model's `proposedId` (VC-12) | V4 | rely on owned-id check + preview + explicit confirm; document; adversarial set |
| D-03 | Series group semantics for voice (VC-07) | V3 | whole-group semantics as target; refusal stopgap (VB-02) for the MVP |
| D-04 | Session persistence | V4 | in-memory, single instance documented; shared store before a second instance |
| D-05 | Fast create on the structured engine (VR-30) | any time | hide the toggle now; implement as a prompt policy in V8 |
| D-06 | Several writes from one utterance | — | keep: one preview, one confirm, stop on first error |
| D-07 | History passed to the model | V7 | keep last 6 turns + pending operations; measure before changing |
| D-08 | Production model and live bar | V7 | one named model per run with the fallback chain recorded; bar above |
| D-09 | Voice and typed chat share one pipeline | — | yes, keep |
| D-10 | Deterministic bare yes / no as a control (VN-02) | V5 | yes; a closed list of control words is not a lexical crutch |
| D-11 | Series / occurrence representation | V3 | series + civil day stays; occurrences from the rule and parked days after VC-07 |

**Critical path:** V1 → V2 → V3 core (VC-05, VB-02) → V5 → V7 live (MVP sign-off) → V8. V4 and V6 run in parallel from V2 on. Must stay sequential: V1 before V2; VC-02 before VC-03; D-03 before VC-07; all fixes before the live run; V7 before VR-31.

**Overall complexity:** MVP about L–XL as one program (roughly 9 M, 4 S, 3 L tasks plus one external dependency — a Google test account); the full plan with gates, suite porting and legacy removal is XL.

---

## Missing historical context

- `docs/voice-vnext/` (about 132 reports and raw runs, including PHASE-4.7.6 SECURITY / MATCHING / REMINDER-PERSISTENCE / RELIABILITY / REMAINING-GAPS, PHASE-4.7.11-REMAINING-GAPS, PHASE-4.7-CLOSURE-REPORT, STAGE-4.1-REPORT) was deleted on 29 Oct and never committed. Only file names and the roadmap text (transcript `ab1768c0`) survive; their findings could not be read. `jest.vnext-structured.config.js` still cites the deleted STAGE-4.1-REPORT.
- ChatGPT conversations that produced the architecture are not accessible beyond what was pasted into transcripts.
- No surviving source calls `alignEnvelope` unsafe; it is dead code either way.
- Stale statements found: roadmap §39 "on branch voice-mvp-p0" (merged since); roadmap §42 WorldName error (verified fixed, 30 Oct); `voice-prompt-next.md` names the legacy planner as production; `spec-voice-agent.md` §3 / §11 describe the legacy split (VN-06); `BUGS-AND-IMPROVEMENTS.md` "Зараз" disagrees with the roadmap priority (VN-06).
- Deleted run outputs: no phase 4.7.x or F2 result file survives in the repository; `backend/.tmp/` holds only legacy-planner probes and dialogue reports from 17–27 Oct (not the structured engine). The F2 numbers rest on the transcript and KI-04.
