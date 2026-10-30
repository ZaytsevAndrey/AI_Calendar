# Voice prompts — next work (handoff)

**Status:** **frozen (legacy engine only, D-01 / VC-15, 30 Oct 2026).** `buildPlannerSystemPrompt` runs only with `VOICE_TURN_ENGINE=legacy`; production is the structured engine ([voice-agent-roadmap.md](voice-agent-roadmap.md)). No new rule lands here; the queue below is history until §49 removes the legacy engine.  
**Fix log:** [voice-fix-flow.md](voice-fix-flow.md).  
**Use:** open a **new chat per mini-item** below. Product contract: [spec-voice-agent.md](spec-voice-agent.md). This file is a work queue. It does not add rules. Edits follow [voice-fix-flow.md](voice-fix-flow.md).

## Already shipped (do not redo)

- Orchestrator `/voice/turn` + session + read tools + day-plan + hero UI.
- Each write segment: **router** (`intent` + `language`) → **per-intent specialist** → normalize / `resolveVoiceCommand`. The planner call that emits the segment is `buildPlannerSystemPrompt`. Experimental Planner C2 is not that call.
- Every intent has a **full** specialist: one system string (schema, first-match rules, fields the resolver reads). Create is assembled from [prompt-modules/](../backend/src/modules/voice/prompt-modules/). The other intents are one file each and share the task-target, task-fields, and clock fragments inside that same call. The ending schedule day lasts through three hours after sleep; the starting day begins three hours before wake. That choice only picks the date. `needs_clarification` returns a question only and does not create a task.
- Create when: a day with no clock is Wake to Sleep. Dates named once are one-offs; a shared clock does not join them. A clock makes a series only when the utterance is already a repeat. An event with no time is a question when. A task that is not an event, with no time, is Unscheduled. A place does not decide. A clock with no day that is already past is a question.
- Placement honors `earliestStartTime` via [placement-bounds.util.ts](../backend/src/modules/schedule/placement-bounds.util.ts).
- Debug raw LLM: `[llm:parse.router]`, `[llm:parse.create]`, … via `voice-llm-log.util.ts` (clipped).
- Structured harvest log: `voice.parse.result` JSON after normalize/resolve ([voice-parse-result-log.util.ts](../backend/src/modules/voice/voice-parse-result-log.util.ts)).
- Create kind/when baseline goldens (no live LLM): [voice-create-kind-when.goldens.ts](../backend/src/modules/voice/voice-create-kind-when.goldens.ts).
- Live voice tests are the planner dialogue corpus in [voice-agent-dialogue-test-plan.md](voice-agent-dialogue-test-plan.md) (`npm run voice:eval:dialogue`). A write turn is `confirm`.

## Architecture (production)

The live planner is `buildPlannerSystemPrompt` in [voice-agent.planner.prompt.ts](../backend/src/modules/voice/voice-agent.planner.prompt.ts). The orchestrator calls it on `/voice/turn`. Experimental prompts C, C2, and C3 are not this function and are not wired in.

```
STT → Orchestrator
        Planner (one call: tools, steps, plan, pending, or final)
        each write segment → Router (intent + language)
                          → Specialist (that intent only)
                          → normalizer / resolveVoiceCommand
                          → preview intents on the client
```

- **Planner** decides the next step and the segment text. It does not choose `create` / `update` / `delete` / `skip`, and it does not write the calendar.
- **Router** chooses the intent. `reschedule` and `complete` are not router intents; a model that still says them is sent to the update specialist.
- **Specialist** fills only that intent's fields. It sees the segment, not the original utterance and not the sibling segments.
- **Normalizer** (`normalizeVoiceParse`, `resolveVoiceCommand`) applies defaults and guards. A named task with no day and no clock becomes Unscheduled. An empty update asks what to change; the same empty answer after that question is a refusal and the batch is cleared.
- **Orchestrator** stores a clarification batch only when a segment parse returns `needs_clarification`. A planner `final` or `clarify` does not open that batch. While a question is open, any decision other than `answer_pending` or `cancel_pending` repeats the question and does not apply the new command.

Dependent operations are a planner instruction in the live prompt, judged on the one segment the specialist receives. A later day, clock, or length replaces only that parameter. A delete that unambiguously targets the create this utterance is making leaves no operation. A bare pronoun is not the task happening now. The specialist prompt and `groundReference` ask which task when the segment itself has no settled antecedent. Several candidates are not a choice.

Day-plan edits stay on the orchestrator. Clocks on those edits are `HH:MM` only (`preferredHm`, `earliestHm`, `deadlineHm`). A named part of the day, such as evening, has no field and is not converted into a clock.

## Measured prompts (not production)

These runs did not change the live prompt. Lexical PASS is not semantic proof. Seven scenarios stay disputed and are not a quality score and were not tuned: `existing-length`, `ctx-unsettled-pointer`, `time-window`, `time-event-span`, `rem-daily`, `clar-event-no-clock`, `crud-nothing-to-change`.

Planner C2 is a separate prompt in gitignored `backend/.tmp/planner-c2.prompt.ts`. Same JSON, tools, pending, and day-plan contract as Planner C, plus four concepts: operation lifecycle, entity identity and final state, information preservation, and grounded temporal reasoning. It is longer than C (13651 characters, sha256 `6a43727a2d4f77f62a7d87d185275ae4dc647a0e0358a2dbd24012f1cfb20c88`). On the 27-scenario subset, DeepSeek `deepseek-flash` (temperature 0.1, 4096 tokens, thinking off) used 32 calls and 107173 `total_tokens`. Against Planner C on those ids: 3 FAIL→PASS (`crud-delete-named`, `ctx-bare-pronoun`, `tool-agenda-tomorrow`), 12 PASS→PASS, 12 FAIL→FAIL, 0 PASS→FAIL. Raw: `backend/benchmark/planner-bc/c2-only-subset-run.json`.

The live prompt still differs from C2. A settled reference in production is replaced in the segment by that entity. C2 keeps the user's own reference and does not insert a title they did not select. C2 also tells the planner not to fill the specialist's fields, to speak tool instants in the user timezone, and to put every stated plan-edit parameter in the edit fields. None of that wording was copied into production.

Planner C3 was three sentence replacements on C2 (14163 characters, sha256 `649c5bac65e6c03f322f0ffd47c5c6946932df948ab7eb496ce94a2b978bd28e`). Same 27 ids, same DeepSeek settings, 32 calls, 110125 `total_tokens`. Against C2: 13 PASS→PASS, 0 FAIL→PASS, 12 FAIL→FAIL, 2 PASS→FAIL (`ctx-bare-pronoun` lost the segment and asked what to move; `dep-create-cancel` stayed an empty final but the answer still named the cancelled errand). Folding «його» into the antecedent segment did not improve. C3 is rejected. Do not adopt it and do not start C4 from it. Raw: `backend/benchmark/planner-bc/c3-only-subset-run.json`.

Gemini `gemini-3.8-flash` on the C2 prompt, budget 20, retries 0, client abort 25s: 16 calls, 0 tokens, no verdicts. 7 responses were HTTP 503 `UNAVAILABLE` (high demand). 9 were the client's abort before any HTTP status. A later single call with no client wait limit returned HTTP 503 in 1.3s, again with no planner text. That is model capacity, not an exhausted token quota. No cross-model comparison exists. Raw: `backend/benchmark/planner-c2-gemini/gemini-c2-run.json` and `gemini-c2-diagnose-wait.json`.

An entity-resolution harness under `backend/benchmark/entity-resolution/` scores a `references` field beside segments. The production parser drops unknown JSON keys, so that field is not a live contract. The harness was not run against a model.

## Specialists checklist

| Intent | Prompt state | What the prompt is for |
|--------|--------------|---------------------|
| `create` | full (modules + kind tree) | Kind, name, when |
| `update` | full | One existing task: fields, time, and done. Shared catalog is `prompt-modules/task-fields.ts`. A deadline needs no special word. A time-only change seats the task. Done-only on a one-off is kind `complete`. A series still asks for scope |
| `skip` | full | Next open occurrence only; unscheduled cancels; another day asks |
| `delete` | full | A series asks this day / this and following / whole series. Confirm stays on the orchestrator |
| `needs_clarification` | full | One question; `task` null |

`reschedule` and `complete` are not router intents. A model that still says them is sent to the update specialist. Companion does not create or edit habits.

Router: [voice-parse.router.prompt.ts](../backend/src/modules/voice/voice-parse.router.prompt.ts) — keep tiny; create follow-ups must stay `create`, not `update`.

## Open queue (one chat each)

1. **Dialogue corpus** — `npm run voice:eval:dialogue`. Writes expect `confirm` (preview). Spoken yes expects `act`.
2. **§23.5 Harvest + router goldens** — misroutes from eval/logs.
3. **§23.6+ Fix loops** — rows where the prompt, the spec, and the corpus already agree and the model missed.
4. **§23.n Cleanup** — unused `voice.whenOrUnscheduled` i18n; archive this file when empty.
5. **Known limits, not a new prompt.** The specialist sees only its segment, so a pronoun whose antecedent sat in another segment cannot be resolved there. A second reply that still misses the asked fact is a refusal and clears the batch. Plan edits cannot store a named part of the day. These are open. Do not grow the planner prompt to paper over them, and do not treat C2 or C3 as the live prompt.
6. **Benchmark harness, technical debt.** Scenario fixtures that typecheck stay with the voice tests: `backend/benchmark/evaluation.ts`, `stem-match.ts`, and `voice-regression` `scenarios.ts`, `score.ts`, `world.ts`, `legacy.ts`. Runners and raw results stay on disk and are not in the production commit. `planner-bc/runner.ts` does not typecheck (`C2` is missing from a prompt-record type). `fold-experiment/score.ts` does not typecheck (`parsed.operations` is `unknown`). The runners also import gitignored `backend/.tmp` prompts, so a clean checkout cannot compile them. C2, C3, entity-resolution, and the Gemini run remain local records. Gemini returned no planner text. None of that is production behavior.

### Adding a create kind/when golden

1. Copy `voice.parse.result` (or invent a specialist JSON that matches the decision tree).
2. Append a case to [voice-create-kind-when.goldens.ts](../backend/src/modules/voice/voice-create-kind-when.goldens.ts): `transcript`, frozen `llm`, `expect` (including harvest `kind`).
3. Run `npx jest --runInBand src/modules/voice/voice-create-kind-when.goldens.spec.ts` in `backend/`.

## How to harvest a golden from logs

After each `parseTask` (including `/voice/turn` mutate), the backend logs one line:

```text
voice.parse.result {"parseId":"…","transcript":"…","timeZone":"Europe/Kyiv","nowIso":"…","routerIntent":"create","sniffed":null,"intent":"create","specialistIntent":"create","language":"uk","understanding":"complete","clarifyingQuestion":null,"kind":"flexible","taskName":"…","scheduledStartTime":null,"scheduledEndTime":null,"earliestStartTime":"…","deadline":"…",…}
```

1. Reproduce the bad utterance (or copy a line from local/Render logs).
2. Decide the **expected** `intent` / `kind` / when fields (or clarify).
3. Add a CI fixture: same `transcript` + anchors (`timeZone`, `nowIso`, wake/sleep) → expected result. Prefer normalize/router table tests; do not call live Groq in CI.
4. Keep the raw `[llm:parse.*]` lines for prompt debugging; the **result** line is the harvest source of truth for what the client got.

## How to verify in a new chat

```text
Logs: [llm:parse.router] then [llm:parse.<intent>] then voice.parse.result {…}
Create no-when → task.isUnscheduled, understanding complete
Recurring + WEEKLY Mon–Fri, no clock → complete recurring
Schedule day: through three hours after sleep, and from three hours before wake. A clock with no day that is already past is a question, not the next day. A morning that has not ended is still ahead, including before wake.
```

Delete or archive this file into [roadmap-archive.md](roadmap-archive.md) when the queue above is done.
