# Voice fix flow

**Status:** process for keeping the voice agent in sync. Not a product rule.  
**Language:** English  
**Last updated:** 23 October 2026

Product behavior lives only in [spec-voice-agent.md](spec-voice-agent.md). This file is the edit order. It does not add rules.

| Source | What it is |
|--------|------------|
| Prompts | What the planner and the specialists are told now. `backend/src/modules/voice/voice-agent.planner.prompt.ts`, `voice-parse.*.prompt.ts`, `prompt-modules/`. |
| Spec | Product contract. [spec-voice-agent.md](spec-voice-agent.md). |
| Tests | What the dialogue matcher checks. `backend/src/modules/voice/dialogue-corpus`. A write is `confirm`. Spoken yes is `act`. The matcher checks `outcome`, intent kind, and a piece of the name. It does not check the spoken wording. |

[voice-agent-dialogue-test-plan.md](voice-agent-dialogue-test-plan.md) does not override the spec. Product sentences in that file are withdrawn.

## Sequence

1. **List the disagreement. No edits.** One row per rule where the prompt, the spec, the test plan, and the corpus do not say the same thing. Quote the sentence and name the file. Do not add a situation. Do not explain a failure with a reason the matcher does not check.
2. **You pick the winner.** Prompt, spec, test plan, or one sentence you write. A row you do not pick is left as it is.
3. **One product text.** The chosen sentence goes into the spec. The test plan stops overriding the spec: its sentence moves into the spec or is deleted.
4. **Tests follow the spec.** An expectation stays only when it is that sentence. Anything else is rewritten or removed. The matcher still checks the turn fields, not the reply text.
5. **Prompt follows the same sentence.** Replace the one prompt sentence that contradicts it. Then rerun that scenario and the neighbor that shares the rule.
6. **A later fix is the same chain.** Spec sentence, then prompt, then test. One of the three alone is not a fix.

Do not copy the current prompts into the spec as a batch. A prompt rule the spec does not contain is a row in the list, not a silent edit.

## Task queue

One task at a time. Each task edits the spec only when the rule itself changes, then the one prompt block, then the corpus rows that are instances of that block.

1. **Spec.** One contract, [spec-voice-agent.md](spec-voice-agent.md). Done.
2. **Create prompt.** `prompt-modules/kind-when.ts` Questions list and `prompt-modules/question-proposal.ts` say this rule once. Remove list items that restate a phrase.
3. **Fast create.** `prompt-modules/fast-create.ts` stays the override. It must not grow a phrase list.
4. **Planner.** `voice-agent.planner.prompt.ts` uses the same ask / propose / do-not-pick rule. No second list.
5. **Other specialists.** Update includes time and done. Delete and skip stay separate. Done.
6. **Corpus.** Expectations that contradicted the update and the ignore rule are rewritten. Done for those rows. A time-only update still expects a seat (`window`, `shift`, or `update`). A done-only update still expects `complete`.
7. **Model misses.** Rows where the prompt, the spec, and the corpus already agree. One cluster, then its neighbor.

## Already the same — not a choice

These failed the run because the model did not follow a sentence the sources already share. They are fixed later, in the step-5 chain, and the expectation is not edited to match the model.

- Morning still ahead, including before wake (`create.morning-still-ahead`).
- A repeat that names no day is not a question (`create.biweekly`).
- A length on an open task, with no day and no clock, is an update (`update.duration`). The router prompt says this.
- Turning a repeat off is an update field (`update.series-stop-repeating`). The update prompt says this.
- The exact title is that task (`update.make-daily`, `update.allow-split`).
- A past clock is a question. Do not move it to the next day (`reschedule.past-clock`).
- One ignored question is skipped. The clear piece remains (`dialogue.ignored-question-keeps-the-clear-piece`).
- An ignored question with nothing to write is not a `refuse` (`dialogue.ignored-question-is-not-a-refuse`).
- Delete does not invent a task (`delete.unknown`). The delete prompt says this.
- An unscheduled skip cancels that inbox task and is not a delete (`dialogue.skip-today-and-create`). The skip prompt says this. The spec has no sentence for it; when the spec is the only product text, this sentence is copied in. The kind stays `cancel`.
- A span that can be either the event length or the placement window is a question (`create.ambiguous-span`, `fast-create.ambiguous-span-still-asks`). Spec F1 and the create prompt say this. The test plan does not. The spec sentence stays.
