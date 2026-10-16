# Voice create — fix flow

Working log for prompt fixes. One cycle = one rule. Do not add a sentence on top of a failed one.

Product contract: [spec-voice-agent.md](spec-voice-agent.md). Queue: [voice-prompt-next.md](voice-prompt-next.md).

## How a cycle runs

1. Name the rule the failure belongs to. Do not patch a single transcript.
2. Change that rule in one place. Replace a contradicting sentence. Do not append an exception.
3. No language word lists in TypeScript. See `.cursor/rules/voice-no-lexical-crutches.mdc`.
4. Re-run the same sentinel on the local model (`calendar-voice`), not a slice of 50.
5. Read the sentinel as a boundary. The target case must go green. Neighbors that were green must stay green. Known other-rule fails must keep the same failure shape.
6. Only then run the logical `--branch` (1 recurring, 2 fixed, 3 flexible preferred, 4 window, 5 day only, 6 unscheduled).

Sentinel for the clock/name rule: `u001,u002,u004,u033,u037,u043,u076,u163`.

```bash
npx ts-node --transpile-only src/scripts/eval-voice-create.ts --local "--only=u001,u002,u004,u033,u037,u043,u076,u163"
```

Quote `--only` in PowerShell, or the comma list splits. Anchors: Europe/Kyiv, now 13:00 local on 2026-10-13.

## Cycle 1 — recurring clock vs “never before now”

**Hypothesis.** u001 dropped 08:00 because that hour is already past and the prompt forbids a start before now.

**Edit.** In `kind-when.ts` Hours, the absolute “never before now” was limited to one-off tasks. A recurring spoken clock stays on schedule today.

**Sentinel (local, ~3.5 min): 4/8.**

| Case | Role | Result |
|------|------|--------|
| u001 щодня розтяжка о 8 ранку | target | fail. `scheduledStart` null. Clock moved into the title («розтяжка о 8 ранку») |
| u002 щодня медитація | no clock | pass. Start stayed null |
| u004 щодня о 22 відкласти телефон | future recurring clock | fail. `scheduledStart` null. Title kept the whole utterance |
| u033 сьогодні о 16:00 | future one-off | pass |
| u037 сьогодні об 11 | past one-off | fail, expected shape. Model emitted 11:00; normalize cleared the past one-off slot |
| u043 завтра о 9 | tomorrow morning | pass |
| u076 приблизно опівдні | soft clock | fail. Model set `earliestStart` at noon, not `scheduledStart` |
| u163 треба купити молоко | no when | pass |

**Decision.** The hypothesis is wrong. u004 is 22:00, still ahead of now, and the clock is still missing. The model can fill `scheduledStart` for a one-off (u033) and does not do it for recurring; the time phrase stays in `name`. Do not run branch 1 on this edit. Do not add another sentence.

## Cycle 2 — time of day into `scheduledStart`, not the title

**Edit.** Removed the cycle-1 Hours sentence. Branch 1 is now one line: a time of day is not part of `name`; set `scheduledStart`/`End` on schedule today; no time of day leaves both null.

**Sentinel (local, ~3.2 min): 4/8.** Same four failures as cycle 1. u001 title is still «розтяжка о 8 ранку» with `scheduledStart` null. u004 title is still the whole utterance, 22:00 null. u002, u033, u043, u163 still pass. u037 is still the normalize strip of a past one-off. u076 still fails `hasScheduledStart`; the model did emit 12:00 this time, and normalize cleared that past soft start.

**Decision.** Rewording the rule did not move the model. `recurring.ts` already says the clock MUST be `scheduledStart`, and that is ignored too. Do not add another prose sentence. Do not run branch 1.

## Same prompt, other model (2026-10-14)

The glued create prompt (`backend/.tmp/create-prompt-glued.txt`, sample phases Focus / Admin / Evening) was run outside `calendar-voice`. All six sentinel utterances came back in the shape the eval checks:

| Utterance | Result |
|-----------|--------|
| щодня розтяжка о 8 ранку | recurring DAILY, name «розтяжка», 08:00. Date is 2026-10-14, not schedule today, because 08:00 is already past 13:00 and the prompt forbids a start before now. Eval checks the hour only, so this passes |
| щодня медитація | recurring DAILY, name «медитація», no clock |
| щодня о 22 відкласти телефон | recurring DAILY, name «відкласти телефон», 22:00 today, phase Evening |
| сьогодні о 16:00 дзвінок з клієнтом | fixed, 16:00 today, phase Admin |
| завтра о 9 ранку виліт | fixed, 09:00 tomorrow, phase Focus |
| треба купити молоко | unscheduled, no schedule fields |

`calendar-voice` left `scheduledStart` null on the two recurring clocks and kept the time in the title. This model did not. Cycle 3 (a JSON example) is not the next step. The prompt is usable; the local 14B model is not following it.

Do not treat the sample phase ids as product behavior. They exist only in that dump.

## Next: change the model, not the prompt

`calendar-voice` is `qwen3:14b` with no extra system prompt (`tools/calendar-voice.Modelfile`). ChatGPT followed this prompt. Proposed order:

1. Same sentinel on Groq `openai/gpt-oss-20b` (already the cloud default in `groq.client.ts`). No download.
2. If 20b drops clocks, `openai/gpt-oss-120b` (already the fallback).
3. Local replacement only if voice must run offline. Same weight class as 14B is unlikely to beat ChatGPT. A larger instruct model needs more VRAM than the current ~9GB Q4.

Groq `openai/gpt-oss-20b` on the four local failures (~1 min): u001, u004, and u076 passed. u001 kept 08:00 on schedule today. u037 still failed: the model itself returned unscheduled with no clock for «сьогодні о 11», which is already past 13:00. That case was the prompt-versus-corpus conflict, not the 14B miss. The create prompt now keeps a spoken clock on the named day even when it is already before now. The normalizer turns that past one-off start into the rest of that civil day and adds `scheduleNotice`. u037 expects that window plus a notice that includes `11:00`.
