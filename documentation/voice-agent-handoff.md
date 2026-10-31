# Voice Agent — implementation handoff (V3–V9)

**Written:** 30 October 2026, by the preparation pass, against `voice/v1-create-contract` @ `6a5a479` (V1 shipped) and `feat/scheduling-ui-alignment` @ `892b166` (concurrent, **not merged**).
**For:** the implementation model that picks up V3–V9. Read this first; it is meant to replace a second discovery pass.
**Companions:** [voice-agent-roadmap.md](voice-agent-roadmap.md) (architecture, compatibility matrix, phases), [voice-agent-backlog.md](voice-agent-backlog.md) (every task with acceptance criteria), [spec-voice-agent.md](spec-voice-agent.md) (product contract), [placement-engine.md](placement-engine.md) (scheduling domain).

This document carries only what this pass **verified in code** plus what it corrects. Where it disagrees with the roadmap or the backlog, this document is right and the other file is stale; each such case is marked **[corrects]**.

---

## 0. Stage 2 result (31 Oct 2026)

Done on `voice/v1-create-contract`, one commit per package, every change behind a test that was red first: **WP-H1** `ba3e651`, **WP-J1** `b41622d`, **WP-C** `0d28435`, **WP-D** `15ed818`, **WP-F** `cbfd3e9`, **WP-A** `fee2f92`, **WP-G** `645caf2`, docs (WP-E′ + WP-J4) `373725b`, **WP-H2** `ead7392`, English set `2f8f73c`, **WP-H4** `5e8da6d`. Structured gate **256/256** (242 before), frontend voice + i18n 33/33, both typechecks clean. Not merged into `master`; nothing pushed.

**WP-G found three live-path defects the packages did not predict** (each reproduced before the fix): a preview published after a model clarification could not be applied at all, by tap or voice (`blocksConfirmation` outlived the question); a correction of the open preview was refused because the mapper accepted `operation_result` only inside one utterance while the prompt told the model to use it across turns and never listed the pending operations; an unreadable reply dropped the preview cards. All three are candidates for the F2 multi-turn 0/5 — re-measure in V7.

**Still open from this list:** WP-B (blocked: `feat/scheduling-ui-alignment` @ `892b166` is finished but not merged), WP-H3 (historical suites — not started, L), WP-E″ (VR-04 / VR-25 / VR-27 gates; VR-25 is outside the voice boundary), WP-I (live; also needs the F2 set, which cannot be rebuilt without the 29 Oct transcript), WP-J2 / J3 (after V7), V2 (separate stage; `project-apply.ts` moves/Later paths untouched here), VR-13's remaining part (several simultaneous open questions still collapse to one — the queue in `session/dialogue.ts` is still never advanced; left untouched for lack of a scenario). Stage 3 review focus: §9 below plus the WP-G commit.

## 0a. Stage 3 review result (31 Oct 2026)

Reviewed by probing, not by reading the Stage 2 notes: every WP-G path got a test that tried to break it. Two silent losses found and fixed in `3607852`: (1) an envelope of corrections addressing pending operations by id used the *replace* boundary, so correcting or cancelling one of two pending creates dropped the other from the preview; such an envelope now *extends* the preview; (2) a dateless create carrying notes, a place or a priority was routed into the day-plan draft, which cannot hold those fields — it stays an ordinary task. Confirmed safe: a correction supersedes the earlier claim (the old claim applies nothing, by tap or by voice); a correction aimed at an unknown or non-create pending id previews nothing; the spoken yes / no never bypasses the claim check; the preview-after-question block is gone. Gate after the fixes: 267/267.

**Known, left as is:** several simultaneous open questions still collapse to one (`session/dialogue.ts` queue is never advanced); (resolved 31 Oct: the spoken-control list is now exactly `так`, `ні`, `yes`, `no`; fillers go to the model); on a VR-38 re-presentation during a plan review the response carries the intents but not the `plan` view, so the client shows cards instead of the plan until the next turn.

**Scheduling branch (`feat/scheduling-ui-alignment` @ `892b166`, finished, unmerged).** Additive for everything voice calls: no change to `CreateTaskDto` / `UpdateTaskDto` / skip / end-series / status; `displayed-event-move.service.ts` only gains `editSeriesFollowing`; the new `PATCH /tasks/:id/occurrence` and `completedAt` are new capabilities, not changed ones. A three-way merge with this branch has **no textual conflicts**; the only overlap is two `## G.` headings in `voice-agent-roadmap.md` (renumber one) and additive i18n keys.

**Integration order (recommended):**
1. Merge `feat/scheduling-ui-alignment` into `master` (owner; run its own gate first). 2. Rebase `voice/v1-create-contract` onto that `master`, renumber the duplicate `## G.`, run the voice gate + frontend tests + `npm run build`. 3. **V2** (VC-02 → VC-03 → VC-04, VC-09, VC-10, VB-01) *on the merged tree*, because VC-03 / VC-04 must be designed against `move-event`'s `slotId` path and the occurrence endpoint as they now are. 4. **WP-B** after V2 (both land in `project-apply.ts` move / series paths and in `executeVoiceCommand.ts`). 5. V7 live run with the corrected scorer, the generalization set and `--suite english`; only then V8 / legacy removal (D-01).

## 1. Boundaries

- Implement from the backlog; do not redesign the structured pipeline. The working rules in the roadmap still hold: small diffs, focused tests, never edit a historical test to raise a pass count, terse commits, one per slice, no lexical crutches (`.claude/rules/voice-no-lexical-crutches.md`).
- **Do not touch** `backend/src/modules/schedule/**`, `backend/src/modules/tasks/**` or the task form — another agent owns them on `feat/scheduling-ui-alignment`. Voice adapts to those contracts; it does not change them.
- V2 (moves and Later scheduling) is **not in the repository**. Anything that depends on it is marked blocked; start with what is not.
- No live model runs without an explicit go-ahead; they cost money and the scorer is wrong until WP-H1 lands (§6).

---

## 2. Verified baseline (what exists, what does not)

| Branch | Head | State |
|---|---|---|
| `master` | `ad4724e` | Scheduling stabilization + design system merged. No V1. |
| `voice/v1-create-contract` | `6a5a479` | **V1 done**: VC-01, VC-13, VC-14, VC-06 + the discovery docs. Not merged into `master`. |
| `feat/scheduling-ui-alignment` | `892b166` | Concurrent domain + UI work, 9 commits, 60 files. **Not merged.** Adds the occurrence API in §3.3. |
| V2 (`VC-02/03/04/09/10`) | — | **No branch, no commits.** Treat as not started. |

Everything the roadmap lists as done for V1 was re-run in that session: structured gate 242/242, frontend voice 26/26, both typechecks clean. The frontend production bundle and the backend e2e suite were **not** run (tooling time limit) — run them once before any merge.

---

## 3. Verified architecture facts

### 3.1 The live path, file by file

`POST /voice/turn` → `VoiceService.turn` (`voice.service.ts:117`) → `StructuredVoiceService.turn` (`vnext/production/structured-voice.service.ts:137`) → `runVNextTurn` (`vnext/pipeline.ts:819`, a one-line delegate) → **`vnext/run-structured-turn.ts`** — that file is the turn. Context from `loadContext` (`:520`) and `buildCatalog` (`production/catalog.ts:110`); interpretation in `interpreters/{prompts,run-interpreter}.ts` through `broker/read-broker.ts`; validation in `contracts/validate.ts`; mapping in `contracts/envelope-to-proposal.ts`; authorization in `state/structured-state.ts` (`resolveTarget:742`); projection to client intents in **`state/project-apply.ts`** (the file most work lands in); day plan in `day-plan/structured-day-plan.ts`. The server never writes: the client applies through `frontend/src/modules/voice/{executeVoiceIntents,executeVoiceCommand}.ts`.

### 3.2 What is actually dead **[corrects]**

The roadmap's dead-code list (§A, VR-05) is wrong in both directions. An import-closure walk from the two application entry points (`structured-voice.service.ts` and `voice-agent.orchestrator.ts`) over 51 non-spec `vnext/` files gives:

**Reachable from the production route — do not delete:** `pipeline.ts` (its `runVNextTurn` *is* the live entry; `TurnInput` / `PipelineResult` / `TraceEvent` / `InterpretOutput` are imported in 11 modules), all of `adapter/` (`scope.ts` alone has 15 non-spec importers, among them `run-structured-turn.ts`, `project-apply.ts`, `validate.ts`, `read-broker.ts`), `reference/reference-resolver.ts` (19 importers, including `production/catalog.ts`), `session/corrections.ts` (imported by `session/clarification.ts`).

**Unreachable from either engine (7 files):** `session/utterance-policy.ts` (the only one the roadmap named), `apply/frontend-contract.ts`, `cli.ts`, `errors.ts`, `llm/live-complete.ts`, `llm/pricing.ts`, `state/structured-session-store.ts`. Of these, only `utterance-policy.ts` and `apply/frontend-contract.ts` are purely spec-referenced; `llm/live-complete.ts` and `llm/pricing.ts` are the **live-evaluation harness** and must survive until V7 is done; `errors.ts` and `state/structured-session-store.ts` are referenced by specs that may themselves be retired in WP-H3.

**Dead at function level, inside a live file:** `operationsTurn` and `dayPlanTurn` in `pipeline.ts` — zero non-spec callers outside that file.

### 3.3 The concurrent scheduling work changes what voice can do

On `feat/scheduling-ui-alignment` (**not merged**; do not assume any of it):

- **`PATCH /tasks/:id/occurrence`** (`tasks.controller.ts:129`, `occurrence-edit.service.ts`, `dto/edit-occurrence.dto.ts`). Body: `occurrenceStart` (ISO, required), `scope: 'occurrence' | 'following'` (default `occurrence`), and any of `name`, `description`, `phaseIds`, `start` (must stay on the occurrence day), `durationMinutes` (1–1440), `status: 'todo' | 'completed'` (scope `occurrence` only), `googleEventId`, `googleEventCalendarId`. 400 when the task is not a series, there is no occurrence that day, or the change is unsupported.
- **`completedAt`** on `tasks` (migration `1761820000000-TaskCompletedAt`), stamped by `stampCompletion`. A detached day carries its own value, so one day's completion is never inferred from the series.
- **Series-group membership no longer breaks on key presence**, only on a real change to a structural field; content fields (name, notes, look) keep lineage, and `contentDiffersFromSeries` stops re-merge from swallowing an edited day. This was the root cause behind VC-07's "a series-wide rename detaches a sibling".
- Lineage (`parentSeriesId`, `seriesGroupId`, `originalOccurrenceYmd`) is no longer cleared as park metadata (was KI-26).
- They left their own integration notes as a section **`## G. Integration requirements from the scheduling UI alignment`** inside `documentation/voice-agent-roadmap.md`.

**Merge conflict, known and cheap:** V1 added a different `## G.` (MVP definition, decisions, critical path) to the same file at the same place. On merge, keep both and renumber — their section becomes `## H.`, or fold it into §C.4. Nothing else in the two branches touches the same lines.

### 3.4 Day-plan modules are shared, not legacy **[corrects]**

`vnext/day-plan/structured-day-plan.ts` imports `voice-agent.plan-draft.ts` and (through `VoiceDayPlanner`) `voice-agent.day-plan.ts`. Both live outside `vnext/` and look legacy by their path. **They are on the production path.** V8's legacy removal must keep them (or move them under `vnext/`), and VC-11's day-bound fix has to cover them.

---

## 4. Approved decisions (owner, 30 Oct 2026)

Binding; do not re-open in implementation. Options and consequences stay in the backlog §4.

| ID | What it means for the code |
|---|---|
| D-01 | The legacy engine stays as a frozen rollback until the structured engine passes MVP acceptance. Do not add rules to it; do not delete it before V7 passes. |
| D-02 | Trusted entity resolution stays as it is (owned, writable, right type), with preview and an explicit confirm. **Confirmation does not replace entity validation** — never relax `resolveTarget` because a confirm follows. |
| D-03 | An unsupported or ambiguous series-group operation is **refused** for the MVP. Never silently approximate its scope. |
| D-04 | In-memory sessions are fine for the local MVP; they are not production-ready. Document the single-instance constraint, do not build a store now. |
| D-05 | Hide the non-functional Fast create toggle. |
| D-06 | Several writes under one confirmation, each operation and its result shown. |
| D-07 | Keep the current conversation context (last 6 turns + pending operations + referents) until tokens and latency are measured. |
| D-08 | DeepSeek stays an evaluation candidate. MVP bar: UA ≥ 10/12, multi-turn ≥ 4/5, EN ≥ 10/12, zero unsafe or unconfirmed writes. |
| D-09 | Voice and text share the structured pipeline. |
| D-10 | Confirmation and rejection are handled deterministically inside the active preview state. |
| D-11 | Series, individual occurrences and detached occurrences are distinguished explicitly. |

---

## 5. Work packages

Each package is one slice: one branch, one commit, its own tests. **Ready** means nothing blocks a start today. File paths are relative to the repository root.

### WP-A — Reminder updates keep their stored fields (VC-05) — **ready**, M

**Problem.** `projectRemind` (`backend/src/modules/voice/vnext/state/project-apply.ts:506-549`) builds a `remind_update` command from the utterance alone: `description`, `recurrencePattern` and `notificationTime` go out as `null` when the user did not restate them, and a date is required. `DayRemindersService.update` (`backend/src/modules/day-reminders/day-reminders.service.ts:64`) assigns `fieldsFromDto(dto)` wholesale, and `WriteDayReminderDto` requires `name` and `dueYmd`. So "move the rent reminder to Friday" silently wipes its repeat, its notes and its clock.

**Expected.** Only what the user changed changes. Everything else keeps its stored value.

**Where.** The reminder catalog record is the hole: `reminderRecord` (`vnext/production/catalog.ts:96`) exposes `id`, `name`, `status`, `revision`, `calendarId`, `writable` — the other fields are folded into the fingerprint and unreadable. Extend `EntityRecord` (`vnext/reference/reference-resolver.ts:3`) with the stored reminder fields (`dueYmd`, `notificationTime`, `recurrencePattern`, `recurrenceWeekDays`, `description`) and merge them in `projectRemind`. **Prefer this over changing the day-reminders API** — that module is outside the voice boundary (§1).

**Edge cases.** A reminder the user resolves and re-opens; a recurring reminder whose clock is the settings default (keep it absent, not materialised); a rename that must not touch the date; `remind_delete` / `remind_resolve` must stay field-free.

**Acceptance.** "Move the rent reminder to Friday" keeps repeat, notes and clock; a clock-only change keeps the date; nothing is sent as `null` unless the user cleared it.
**Tests.** `remind_update` projection cases — none exist today, this package creates the first.

### WP-B — Occurrence-level writes and series groups (VC-07, VC-08, D-11) — **blocked**, L

**Blocked by:** the merge of `feat/scheduling-ui-alignment` (§3.3). Do not start before it lands; the API it needs does not exist on `master`.

**Problem.** Voice cannot address one day of a series except by skipping it, and the catalog carries no group identity: `pickOccurrence` (`project-apply.ts:740`) reads only placed slots, so a parked day, a day past the horizon or a detached copy answers `occurrence_not_found`; `buildCatalog` carries no `seriesGroupId` / `parentSeriesId` / `originalOccurrenceYmd`, so same-name siblings are indistinguishable.

**Expected after the merge.** "Rename today's standup", "move today's standup to 15:00", "done with today's gym", "from today, standup at 9" map to `PATCH /tasks/:id/occurrence` with the right `scope`, instead of being refused or applied to the whole series. Per D-03, what still cannot be expressed is refused with a preview line that says why — never approximated.

**Where.** `production/catalog.ts` (occurrences from the series rule plus parked days; lineage fields), `state/project-apply.ts` (`pickOccurrence`, `projectSeriesCommand`, a new occurrence-edit projection), `frontend/src/modules/voice/executeVoiceCommand.ts` (a new command kind calling the occurrence endpoint), `changePreviewCards.ts` (a per-day card: the scheduling agent notes this is still to be designed).

**Edge cases.** An occurrence on a DST day (pair with WP-C); a day that is already a detached copy; `scope: following` has no `status` field; a series whose group holds parked copies (D-03 refusal); Google ids for the changed day.

**Acceptance.** A per-day rename / move / completion reaches the occurrence endpoint with the stated scope and a preview that names the day and the scope; a group operation the domain cannot express is refused before confirm.
**Tests.** Group fixtures (rename one day, end from a day, delete with parked copies), parked-day and beyond-horizon skip, a per-day completion card.

### WP-C — Civil-day bounds on the voice reads (VC-11) — **ready**, S

**Problem.** Voice day bounds use the noon-offset helpers `startOfLocalDayIso` / `endOfLocalDayIso` (`backend/src/modules/voice/voice-local-date.util.ts:150-156`); the domain settled on `civilDayStartIso` (AUD-014). On a DST day the two disagree and an event can fall outside the read window.

**Scope on the production path — four call sites, not six [corrects]:** `vnext/production/structured-voice.service.ts:466` and `:498` (the `find_events` tool and the day read), plus the two shared day-plan modules of §3.4: `voice-agent.plan-draft.ts:491` and `voice-agent.day-plan.ts:132`. The remaining hits (`voice-agent.tools.ts`, `voice-command.resolve.ts`, `voice-parse.util.ts`) are legacy-only and are frozen under D-01 — leave them.

**Acceptance.** `civilDayStartIso(day)` … `civilDayStartIso(day + 1)` on those four sites; a DST-day event is found.
**Tests.** America/New_York, 14 Mar 2027: `find_events`, the day read, a plan deadline.

### WP-D — `find_tasks` filter semantics (VC-16) — **ready**, S

**Problem.** `scheduled: false` means "has no slot" (`vnext/search/find-tasks.ts:91`), so a parked (problematic) task is reported as Later. `nameContains` is a raw case-folded substring with no morphology — that part is correct and stays the model's job; document it rather than "fixing" it (the no-lexical-crutches rule).

**Acceptance.** The filter distinguishes Later (`isUnscheduled`) from parked; a parked task is not offered as Later. **Tests.** `find-tasks.spec.ts`.

### WP-E — Trust, rights and Apply preconditions (VC-12, VR-04, VR-25, VR-26, VR-27) — **partly ready**, L

VC-12 and VR-26 are **documentation tasks** under D-02 and D-04: record in the roadmap that the trust boundary is owned-id + preview + explicit confirm (and that confirm never substitutes for validation), and record the single-instance session constraint in `deploy.md`. Both are ready and small.

VR-04 (per-action rights instead of one `writable` flag), VR-27 (idempotency or documented natural idempotency for non-create Apply commands) and VR-25 (revision preconditions on Apply) are rollout gates (G-6), not MVP behaviour. VR-25 needs an endpoint change in `tasks` — **outside the voice boundary** (§1); coordinate before starting, or defer past the scheduling merge.

### WP-F — Token, cost and latency per turn (VR-24) — **ready**, S, do before V7

**Narrower than the backlog says [corrects].** Tokens are already measured and already persisted: `GroqClient.recordTokens` (`groq.client.ts:287`) feeds the daily quota, `noteStepTokens` attaches them to the voice trace step, and `voice_turn_logs.tokens` sums those steps (`admin-data/voice-turn-log.service.ts:44`). Body logging is already gated by `VOICE_TRACE_BODY` (+ `VOICE_TRACE_BODY_PRODUCTION` in production, `common/voice-trace.ts:165`) — the backlog's privacy wording was wrong and is already corrected in the roadmap.

**What is missing:** `modelInterpreter` in `structured-voice.service.ts:314` returns `inputTokens: 0, outputTokens: 0`, so the pipeline sees nothing; there is no cost figure; and only Groq exposes a prompt/completion split (`groq.client.ts:98`) — DeepSeek, Qwen and Gemini parsers return a total only.

**Acceptance.** A turn reports real totals, a per-call model name and latency, and a cost estimate where the provider gives a split; no bodies unless the flags are on. **Tests.** Unit on the usage plumbing; the existing `voice-trace.spec.ts` gating stays green.

### WP-G — Multi-turn continuity (VR-13, VR-38, VR-03, VR-06, VN-02) — **ready**, L

**The key finding: the queue already exists, it is simply never advanced.** `session/dialogue.ts` has an ordered `clarifications` array with `ask` (appends, dedupes by `id` + `missing`) and `resolveActive` (drops the head, exposes the next). But `run-structured-turn.ts` imports only `ask` and `clearDialogue`, calls `ask` at **exactly one site** (`:624`) with a hard-coded `id: 'clarification'` — so a second question is deduped away — and **never calls `resolveActive`**, so the queue never advances. This is wiring, not new architecture.

**Also in scope.** VR-38: a malformed or refused correction during a preview must keep its pending target instead of dropping it to `invalid_model_output` (`repair/repair.ts`, `run-structured-turn.ts`). VR-06: with a draft open, an utterance naming a draft item but returning no draft edit should route to the draft by item id rather than being dropped. VR-03: re-run `g-b-11` (rebind) and `g-b-10` (two clocks on one task) as offline fixtures. VN-02 under D-10: a bare yes/no while a preview or question is open resolves as a control without a model call — extend `interpreterFor` (`structured-voice.service.ts:279`), which today maps only UI `actionId`s and noise. A closed list of confirmation words for an open yes/no question is a control, not a lexical crutch; it must not grow into interpretation.

**Acceptance.** Two open questions can be answered in either order; a correction during a preview keeps its target; a bare "так" after a preview acts without a model call while "так, але о 18" still goes to the model.
**Tests.** Scripted multi-turn fixtures in the structured gate.

### WP-H — Evaluation harness (VR-11, VR-12, VR-32, VN-03) — **H1 ready and urgent**, M

**H1 — the scorer cannot pass a create (verified, new).** `phase477-score.ts` collects the action of an intent from `row.kind` only (`:76`). A create intent is `{ type: 'create', summary, task }` and has **no `kind` anywhere**, so `expect.action && !view.actions.includes('create')` (`:116`) fails every time. Eight of the 100 generalization scenarios expect `action: 'create'` and therefore **cannot pass regardless of behaviour**. The reported 65/100 is depressed by up to eight points, and D-08's bar is being measured with this ruler. One-line fix (map `type: 'create'` as well), then re-score. **Do this before any live run.**

**H2 — an independent adversarial set (VR-12):** wrong target, injection in titles, impossible clocks, bulk over a truncated `find_tasks` result. Offline, in the gate.

**H3 — the 13 historical suites (VR-32, KI-10):** `jest.vnext-historical.config.js`; they fail at setup because they describe targets by text instead of a catalog id and expect retired error codes. Port or retire each with a note; do not edit them to pass.

**H4 — reproducibility (VR-11, VN-03):** keep each run's summary (prompt hash, model, temperature, per-scenario result) under version control or a named archive — every earlier run output was lost. Document in `setup-and-build.md` how to run the gate: on Windows or in CI (the repo's `node_modules` carry a native `bcrypt`), with `NODE_OPTIONS=--max-old-space-size=3000`; the full gate takes about 11–12 minutes single-process.

### WP-I — Live quality (VR-14, VR-08, VR-09, VR-15–19, VR-35) — **blocked**, L

Blocked by WP-A…WP-H and by an owner decision (§7, Q1): **the F2 set the bar refers to does not exist in the repository.** No file holds those 12 Ukrainian scenarios; only the result survives (KI-04). What survived is the generalization harness: 100 scenarios (A 51 / B 30 / C 20, many multi-turn) in `vnext/eval/phase47-generalization.ts` with a resumable CLI (`phase47-generalization-cli.ts`, `--allow-paid-calls`, `--budget-usd`, `--max-calls`, `--output`, `DEEPSEEK_API_KEY`). Also needs a Google test account (shared with KI-03), and an English set (KI-19), which does not exist either.

### WP-J — Product integration (VR-30, VR-31, VR-05, VN-06) — **J1 ready**, rest after V7

**J1 — hide the Fast create toggle (VR-30, D-05 approved) — ready, S.** `dto.mode` is accepted and logged but never acted on (`structured-voice.service.ts:151`), while the panel sends it on every turn (`useVoiceTask.ts:541`) and renders the switch (`components/VoiceTaskSheet.tsx:22-45`, `companionMode.ts`). Today the UI promises behaviour the engine does not have. Hide the switch; keep `mode` in the DTO so the later implementation needs no contract change.

**J2 — remove the legacy engine (VR-31) — after V7 (D-01).** Blockers to plan for: `POST /voice/parse-task` has **no UI caller** (`frontend/src/api/voice.api.ts:280` is unused) but is mocked by the Playwright specs (`e2e/helpers/voice.ts:79`, `e2e/tests/p1.voice.spec.ts:305`), which must be rewritten to script `/voice/turn` first; and the day-plan modules of §3.4 must survive.

**J3 — delete what is genuinely dead (VR-05) — small, but read §3.2 first.** Only `session/utterance-policy.ts` and `apply/frontend-contract.ts` are safe to remove once their specs go; `errors.ts` and `state/structured-session-store.ts` follow their specs; `llm/live-complete.ts` and `llm/pricing.ts` must stay until V7 is finished; `cli.ts` is a developer entry point — ask before removing. `operationsTurn` / `dayPlanTurn` inside `pipeline.ts` can go at function level.

**J4 — documentation consistency (VN-06) — ready, S.** `spec-voice-agent.md` §3 and §11 describe the legacy planner split and legacy read tools as current; `voice-prompt-next.md` calls `buildPlannerSystemPrompt` production; `BUGS-AND-IMPROVEMENTS.md` "Зараз" lists §37/§38 while `roadmap.md` puts the Voice MVP first; `jest.vnext-structured.config.js` cites the deleted STAGE-4.1-REPORT.

### WP-K — Personalization (V9: VR-21, VR-22, VR-37) — post-MVP

Do not start. Shapes are open and will change after V7.

---

## 6. Order and parallelism

```
Ready now, independent of V2 and of each other:
  WP-H1  scorer fix            (S, urgent — everything measured later depends on it)
  WP-J1  hide Fast create      (S, closes a false UI promise)
  WP-C   civil-day bounds      (S)
  WP-D   find_tasks filters    (S)
  WP-F   token / cost metrics  (S, needed before V7)
  WP-A   reminder updates      (M)
  WP-G   multi-turn            (L — the largest ready package)
  WP-E'  VC-12 + VR-26 docs    (S)
  WP-J4  documentation         (S)
  WP-H2/H3/H4 harness          (M)

Blocked:
  WP-B   occurrence writes  ← merge of feat/scheduling-ui-alignment
  WP-E'' VR-04 / VR-25 / VR-27 ← gate work; VR-25 needs the tasks endpoints (coordinate)
  WP-I   live quality       ← WP-A…WP-H + owner decision Q1 + a Google test account
  WP-J2  legacy removal     ← V7 result (D-01)
  WP-K   personalization    ← post-MVP
```

**Suggested sequence for one implementer:** WP-H1 → WP-J1 → WP-C + WP-D (one commit each, both tiny) → WP-F → WP-A → WP-G → WP-H2/H3/H4 → then WP-B when the scheduling branch lands, and WP-I last.

**Safe to run in parallel** (different files): WP-G (`run-structured-turn.ts`, `session/*`) against WP-A (`project-apply.ts` `projectRemind`, `catalog.ts`) against WP-H (`eval/*`).
**Do not run in parallel:** anything touching `state/project-apply.ts` — WP-A, WP-B and V2 all land there, in different functions but one file.
**High-risk, review separately:** WP-B (new domain contract + new client command kind), WP-G's VN-02 (a control path that bypasses the model — it must not grow into interpretation), any prompt edit (it moves live behaviour and is only measurable in V7).

---

## 7. Open questions for the owner

**Q1 — the live bar has no scenario set (blocks WP-I).** D-08 names "UA ≥ 10/12, multi-turn ≥ 4/5", but the 12-scenario F2 set is not in the repository and cannot be recovered. Options: **(a)** re-define the bar on the surviving 100-scenario generalization suite (re-scored after WP-H1), with a named subset as the multi-turn measure; **(b)** rebuild a 12-scenario F2-equivalent from the 29 Oct transcript and keep the numbers comparable; **(c)** both — (a) as the gate, (b) as a smoke set. Consequence: (a) is cheaper and already automated; (b) preserves comparability with the only live result on record.

**Q2 — how far does D-03 bend after the scheduling merge (affects WP-B's size).** Once `PATCH /tasks/:id/occurrence` is on `master`, several operations that D-03 would refuse become genuinely supported. Options: **(a)** keep refusing everything the voice catalog cannot prove, and widen only after the occurrence API is covered by voice tests; **(b)** adopt the occurrence API in WP-B and keep refusals only for parked/detached days. (b) is more useful and is what the scheduling agent assumed in their notes; (a) is safer if V2 and the merge land close together.

**Q3 — English set (KI-19), who writes it.** The MVP bar includes EN ≥ 10/12 and no English scenarios exist. Options: translate a subset of the Ukrainian suite (fast, but tests translation rather than English phrasing), or author a native set (slower, better signal).

**Q4 — V2 ownership.** V2 has no branch. If it is being done elsewhere, WP-B and anything else touching `project-apply.ts` needs a merge order; if not, V2 should be scheduled before WP-B.

None of these block the ten ready packages.

---

## 8. Test strategy

Per phase: structured gate green, backend unit + e2e green, frontend tests green, no historical test edited.

| Command | Where | Time |
|---|---|---|
| `npm run test:vnext:structured --workspace=backend` | the gate, 242 tests | ~11–12 min |
| `npx jest --config jest.config.cjs` | frontend | voice suites ~1 min |
| `npm run test:e2e --workspace=backend` | API e2e | run alone |
| `npm run build` | both builds | run alone, after tests |

Environment notes that cost this pass time: the repo's `node_modules` carry a **Windows** native `bcrypt`, so a run from a non-Windows shell needs a `moduleNameMapper` stub outside the repository; `--runInBand` needs `NODE_OPTIONS=--max-old-space-size=3000`; never run the full suite beside a production build (`.claude/skills/new-feature-workflow/testing.md`).

Write the failing test first — every V1 fix was confirmed red before it was made green, and that is the standard here. A live run is not a test: offline green says nothing about model quality (§WP-I).

---

## 9. Regression traps

1. **`project-apply.ts` is the hot file.** WP-A, WP-B, V2 and parts of V1 all live there. Rebase often; prefer adding a function over widening one.
2. **The series guard added in V1** (`projectCreate`, the `recurrence` block) runs *before* the date branch. Anything new that touches creates must stay behind it, or a series will take a day window again.
3. **Scope text is now part of the preview contract.** `commandSummary` appends the scope for a repeating Luefy task; a new command kind that forgets `seriesScope` shows a series write as a one-off (VC-06 regression).
4. **The client stops at the first failed intent** and reports the rest as skipped; a new command kind must keep that contract (`executeVoiceIntents.ts`).
5. **A create waits up to 12 s** for a placement conflict (`waitForScheduleConflict`); a frontend test that creates must emit `notifyScheduleJobSettled()` or it will hang to the Jest timeout.
6. **Do not "fix" morphology in TypeScript.** Matching is the model's job; the rule file is enforced by review, not by a lint.
