# Voice agent dialogue — test plan and working rules

**Status:** how to run the dialogue eval. Not a product contract. Product behavior is [spec-voice-agent.md](spec-voice-agent.md). Sentences below that disagree with that file are withdrawn.  
**Language:** English  
**Last updated:** 23 October 2026  

Do not add a product rule here. Do not weaken a test so it matches the old three-question interview.

Read this before the first live Groq call. The chat that wrote it will not be in context later.

---

## 1. Locked decisions

| Topic | Decision |
|-------|----------|
| Live planner model | Planner calls try DeepSeek, then Qwen, then Gemini, then Groq `openai/gpt-oss-120b`, skipping a step whose key is unset. Parse stays on Groq `openai/gpt-oss-20b`. `VOICE_LLM_PROVIDER=deepseek` sends every planner and parse call to DeepSeek and throws instead of falling back. Speech-to-text uses Azure when `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` are set, otherwise Groq. |
| Corpus language | Ukrainian only. No English twin of each case. |
| Fail policy | A run without `--minutes` stops on the first behavior mismatch. `--minutes` walks the dialogue corpus once and continues past behavior mismatches; those do not set exit 1. A provider hard limit exits 2 and stops the run. Do not loop the pool. |
| Habits | Hidden. Do not test them, do not add prompt rules about them, and do not route them. |
| LLM chain | Measure call counts first (planner rounds, tool calls, router, specialist). Do not drop the router or the tool round until those numbers are recorded. |
| Surface | Server `POST /voice/turn` only. No microphone, no Companion panel, no mini-calendar widget, no database write. Assert intents and the plan payload. |
| Apply | The user ends a day-plan dialogue by pressing Apply. The agent does not end it. |
| Invention | The agent states only what the user said or a tool returned. It invents no task, gap, clock, duration, or travel time. |

---

## 2. Rules for prompts

- Prompt text is English. The one line that sets the reply language (`Reply to the user in Ukrainian.`) is allowed. Everything else is English.
- Describe the situation: a new errand, an existing open task, a change of time, a day relative to the schedule anchor, a part of the waking day, a repetition. The model recognizes that situation in whatever language the user speaks.
- Do not put sample utterances in the prompt in any language. Do not bind a rule to a word or a phrase (`ввечері`, `in the evening`, `after 3`).
- A part-of-day rule is a concept: the later part of the waking day starts at 18:00. It is not a dictionary entry for one language.
- Segment text that the planner emits stays in the transcript's language and keeps the user's words. The instruction that says so is English. Do not translate the segment.
- User-facing replies stay in the user's language.
- One rule per fix. Replace the sentence that contradicts the failure. Do not append an exception under it.
- Before the first live run, remove the non-English example sentences from `voice-agent.planner.prompt.ts`. In the same edit, drop the line that says planning a day needs no tools: the opening of a day plan must call a read tool (`find_free_gaps`, `get_day_agenda`, or `list_unscheduled`). Rewrite lexical clock examples in that prompt as concepts when that file is touched.

## 3. Rules for TypeScript

`normalizeVoiceParse` and the other calendar helpers only clamp or validate fields the model already emitted. See `.cursor/rules/voice-no-lexical-crutches.mdc`.

- No transcript word lists for clock, morning, weekdays, relative time, recurrence, or titles.
- `sniffCommandIntent` is an existing word list. Do not grow it to green a case. If a failure came from sniff filling an intent, remove that branch. Do not add a stem.

## 4. What the agent may say

A calendar fact (what is on today, where the free gaps are, which tasks are unscheduled) comes from a read tool. Answering that from chat history is a failure.

A fact already in the chat (which task "that one" is, a day the user just named) comes from the chat. Ignoring it and asking again, or guessing a different task, is a failure.

The agent does not invent. Tasks have a `location` string and no travel-duration field. A location is not a number of minutes. The agent mentions extra travel time only when the user stated that extra time. It does not estimate it and does not ask the user to supply a number the user never brought up.

### 4.1 When

The planner splits an utterance into text segments. It does not choose the action. Each segment goes through the router, then the specialist.

- Dates named once, any count, are one one-off each, one segment each. A clock they share is repeated in each segment and does not join the dates. A clock makes a series only when the utterance is already a repeat. A repeat on those days is one series. An existing series does not change the one-offs.
- A weekday named once, with no repeat, is one one-off. A repeating part of the week that names no day is not a special case: the repeat rule decides. Do not force a pair of days and do not force a question.
- The ending schedule day lasts through three hours after sleep. The starting day begins three hours before wake. When three hours after sleep is later, the ending day lasts through that later instant. That choice only picks the date. It does not make a later part of that day past. Morning is the first three hours after wake. A part that has not ended is still ahead, including before wake.
- A clock with no day that is still ahead is today. A spoken hour has two places twelve hours apart. A named morning or night locks that half. Otherwise use the place still ahead of now. If both have passed, that is a question: do not write that start and do not move it to the next day. Twelve after noon is not midnight. A clock on a named day stays on that day.
- A whole day — an event that fills the day, a placement onto a day with no clock, and a deadline that names a day and no clock — runs from Wake to Sleep. Not midnight to 23:59.
- An event with no time is a question when. A task that is not an event, with no time, is created without a time. A place does not decide which.
- One existing task is one update: its fields, where it sits in time, and whether it is done. A time change with no other field seats the task. A time change together with another field is that same update.
- Changing an existing task: the exact title is that task. A merely similar name is a question which task, and the open title is not copied. A new errand is created even when an open task is similar.
- "By" or "until" a day is the deadline. The word "deadline" is not required. A day and no clock is that day's Sleep. "Not before" or "after" a clock is the earliest start.
- A day-plan interview has no question cap. The user ends it by pressing Apply. The server does not propose on its own after a count of questions.

If the model still emits a past one-off start, the normalizer keeps the rest of that civil day until 23:59. The prompt's job is to ask instead of emitting that start.

---

## 5. Ignored questions

There is no clarification counter and no refusal after a fixed number of questions. Ignoring a question means the next utterance does not answer it.

**One unclear piece beside a clear write.** «Додай стендап і перенеси оце.» The standup is held. The question is only about the move. The next utterance that does not name the task skips the move. The standup is still created. It is not asked again.

**The whole utterance has no intent.** «Ну таке, зроби щось.» One question. The next utterance that still names nothing skips that question. It is not a `refuse`.

A day-plan interview is not this queue and has no question cap. The user ends it with Apply.

---

## 6. Day-plan dialogue (target)

The user asked to plan, arrange, or organize a whole day. A list of errands for a day stays multi-intent creates (§6.6 of the spec), not a plan.

While the plan is open, every turn returns the picture of that day:

- Tasks already on the day.
- Tasks the agent understood in this turn. Understanding means the user agreed, or the agent is confident the user asked for that task. The item appears on the draft in the same turn.
- The next utterance may remove or change it.
- Nothing is written until Apply. Fixed tasks and series are never moved.

The agent does not close this dialogue. There is no third question after which the server builds the plan by itself. The conversation continues until the user presses Apply.

Apply is available from the first turn. It sends the current draft to the placement engine and then closes the dialogue, because the user ended it. On the first turn, before any new task, that is the flexible tasks already on the draft. Fixed tasks and series stay where they are.

The first reply depends on the day. Do not lock the exact sentence. The reply must come from a tool and match the shape of the day:

- A free gap and an unscheduled task that fits it: the agent may suggest that task.
- Empty time and nothing that fits: the agent may ask what the user wants to do then.
- The user has stated extra travel time: the agent may say that task needs longer.
- No free gap: the agent says so, invents no clock, and leaves the dialogue open.

A generic «що в тебе на сьогодні?» with no gaps and no tasks from tools is a failure.

The on-screen mini calendar is not part of this cycle. The turn payload is the picture the view would show.

---

## 7. Simple flows

Offline layers first (no Groq): normalizer, resolve, batch, plan draft, engine dry-run, session (noise, confirm, cancel, report, an ignored question).

Then the same flows through `POST /voice/turn` on 120b. Record call counts. Do not change the chain.

| Id | Situation | Expect |
|----|-----------|--------|
| S1 | One new errand, no time | `act`, one create, Unscheduled |
| S2 | A named open task is done | `confirm`, one complete. The router intent is update; a done-only change is applied as complete |
| S3 | What is on today, no write | `answer`, zero intents, a read tool was called |
| S4 | Two new errands in one utterance | `act`, two creates. A shared day is copied into each segment |
| S5 | A new errand and a delete of an existing task | one `confirm` covering both |
| S6 | Plan today | Day dialogue stays open. First reply is tool-grounded (§6). Draft lists tasks already on that day. Apply is available. The agent does not finish the plan. |
| S8 | A list of errands for a day («треба купити… і забрати…») | create segments, not `plan_start` |
| S9 | Empty transcript or noise («дякую») | empty answer, no LLM call |

Neighbor of S4, used when S4 fails: one errand whose name contains «і» («хліб і масло») is a single create.

S1–S5, S8, and S9 can run before the day-plan code matches §6. Habits are not in the corpus. S6 runs after §6 is implemented. The server does not auto-finish the interview after a question count.

## 8. Complex flows

Run only after the simple full pass is green. Offline first, with frozen planner JSON and frozen specialist JSON. Then a few live sessions on the configured planner (Gemini when `GEMINI_API_KEY` is set).

| Id | Situation | Expect |
|----|-----------|--------|
| C1 | A question and a write in one utterance | Tool-grounded answer plus the write intent |
| C2 | One piece clear, one not | Question only about the unclear piece; the clear piece is held. The answer joins both |
| C3 | A pronoun after a task just named | The segment already carries that task name |
| C4 | A later clause changes an earlier one («додай на 18 і перенеси на 19») | One segment with the final time |
| C5 | Day plan across turns | Dialogue stays open. A task understood this turn is on the draft. Apply (the button) does not call the LLM |
| C6 | Voice removes or adds a plan item | New revision. Items that were not touched stay |
| C7 | A question while the plan is open | The plan stays. Apply stays |
| C8 | Spoken yes on a write confirm | `act` with the same intents |
| C9 | Two answers that still do not name the task | That piece is dropped. The rest of the batch remains |
| C10 | A write about another day while a plan is open | A normal intent beside the plan. The following `report` re-seats the plan and does not call the LLM |

---

## 9. Order

1. Layers, simple flows. Zero tokens.
2. Full turn, simple flows, except S6 if §6 is not in the code yet. 120b. Record call counts.
3. Layers, complex flows. Zero tokens.
4. Full dialogue, complex flows. 120b.

Each step starts only when the previous one is green. A write turn is `confirm` (preview cards). Spoken yes is `act`. The old `parseTask` create-eval is removed.

## 10. Groq pacing

Do not sleep a fixed 35 seconds. That gap belonged to the outdated create-eval loop.

Limits are per key and per model. On a free key, Groq's published table for `openai/gpt-oss-120b` and `openai/gpt-oss-20b` is 8 000 tokens per minute, 200 000 tokens per day, 30 requests per minute, 1 000 requests per day. The two models have separate buckets. The exact ceiling is the response header `x-ratelimit-limit-tokens`. Use the header when it is present.

A write turn spends one planner call and two parse calls (router and specialist). DeepSeek, Qwen, and Gemini planner calls are outside the Groq minute window. Parse on Groq is usually the tight bucket: two prompts of about 3 000 tokens fill most of 8 000. The next 20b call on that same key waits until the older tokens leave the one-minute window. If the header shows a much higher ceiling, the wait is zero. `VOICE_LLM_PROVIDER=deepseek` moves parse off Groq as well.

Keep a ledger per key and per model: timestamp and `usage.total_tokens`. Before the next call, if the tokens still inside the minute plus the size of the last similar call exceed the ceiling, sleep until the oldest spend drops out of the window. A single request larger than the minute ceiling is a prompt-size bug. Waiting will not fix it.

A tokens-per-day response retires that key for the rest of the day. Do not sleep the 19 minutes Groq asks for. When every live key is retired, stop for the day. Report how many cases passed, which rule was changed, and which neighbors were not retested.

The product client still caps a user-facing 429 wait at 6 seconds. The long wait exists only in the test runner.

One scenario stays pinned to one key, so the planner call and the parse calls share that key's separate model buckets.

## 11. How to fix a failure

1. From the logs, name the layer: planner JSON, then router, then specialist, then `voice.parse.result`.
2. Change one rule in one place. Replace the sentence that conflicts. Do not stack a new sentence on top.
3. Prompt layer: English, one conceptual rule. No word lists. No sample sentences.
4. Normalizer layer: clamp a field the model already emitted. A new transcript regex is not a fix.
5. Sniff layer: remove the branch that caused the miss. Do not add a word.
6. Retest that case. Then the sentinel: the neighbors in §7 or §8 that share the rule. S4's neighbor is the single create whose name contains «і».
7. Leave the rest of the list alone until the sentinel is green.
8. All keys at the daily ceiling: stop. Do not start another Groq run that day.

## 12. Preconditions before the first live call

- [x] Non-English example sentences removed from the planner prompt.
- [x] Planner prompt no longer says that planning a day needs no tools.
- [x] Lexical clock phrases in that prompt rewritten as concepts.
- [x] Test runner paces from the token ledger in §10, not from a fixed sleep (`npx ts-node --transpile-only src/scripts/eval-voice-dialogue.ts`).
- [ ] S6 and the day-plan rows in §8 run only after the server keeps the dialogue open until Apply and grows the draft each turn.

## 13. Where the code still differs

Recorded so a failing test is not "fixed" by editing the expectation.

- `sniffCommandIntent` still matches Ukrainian, English, and Russian stems when the router returns `needs_clarification`.
- The session still switches from an interview stage to a review stage. The target is one open dialogue and a draft that grows until Apply.

## 14. First live run (18 Oct 2026)

Six keys stayed live. No daily ceiling.

Simple flows S1–S5, S8, and S9 passed on `gpt-oss-120b`. S6 was not run. Complex C1, C2, C4, C8 passed. A habit case was run by mistake and the prompt rule added for it was reverted. Habits stay out of the corpus.

Call counts on a passing turn: one write is 1 planner + 1 router + 1 specialist. Two writes are 5 calls, three writes are 7. A calendar question is 2 planner rounds and no parse. Noise is zero calls. The chain was not cut.

C2’s unclear move came back as an update of the deadline, which this run accepted beside a window or a shift. Not changed.
