# Voice live-evaluation runs

One folder per run: `<YYYY-MM-DD>-<suite>[-<note>]/phase47-generalization/` with the runner's
`turns.jsonl` (one line per scenario: every turn with the production prompt, model outputs, reads,
intents, claim, verdict, error class, tokens, USD, latency), `summary.json` and `failures.json`.
Commit the summary and failures with the change they measured; `turns.jsonl` is kept too (it holds
no credentials: the runner never logs keys, and the worlds are synthetic fixtures, not a user's calendar).

## Runner (V7, 31 Oct 2026)

`backend/src/modules/voice/vnext/eval/phase47-generalization-cli.ts` drives the real
`StructuredVoiceService.turn()` (the class behind `POST /voice/turn`) through
`eval/live-service-harness.ts`: production prompt, production `GroqClient` routing
(`VOICE_LLM_PROVIDER=deepseek` → DeepSeek), validation, projection, claims, dialogue. The client
simulator sends the claim of the preview it shows on every turn, as the panel does, and reports a
dispatched execution as applied. **Nothing is written anywhere**: the client-side Scheduling calls are
not executed, so a run verifies interpretation, targets, previews, confirmation and dispatch —
"preview-only" — not the Scheduling writes themselves (those are covered by the executor unit tests).

```
cd backend
npx ts-node --transpile-only src/modules/voice/vnext/eval/phase47-generalization-cli.ts --dry-run [--suite english]
npx ts-node --transpile-only src/modules/voice/vnext/eval/phase47-generalization-cli.ts --allow-paid-calls --budget-usd 2 \
  --output backend/eval-runs/2026-10-31-uk-baseline/phase47-generalization [--suite english] [--ids g-d-01,g-d-02] [--category D] [--no-resume] [--env <path to .env>]
```

Runs resume: a scenario already complete in `turns.jsonl` under the same prompt hash is skipped unless
`--no-resume`. Cost is the deepseek-flash list price with input priced as uncached.

## Comparability

- Runs before 30 Oct 2026 scored create intents as failures (scorer bug, WP-H1).
- Runs before 31 Oct 2026 used the pipeline directly with a minimal user message (not the production
  prompt) and never sent a confirmation claim, so every spoken-yes turn failed by construction. They
  are not comparable with runs made by the current runner. The last such result (29 Oct 2026,
  5/12 Ukrainian, multi-turn 0/5) exists only as numbers in documentation/known-issues.md KI-04.
- Dataset changes are listed at the top of `eval/phase47-generalization.ts` and `eval/english-set.ts`
  (31 Oct 2026: g-a-47 and g-b-12 follow the spoken-control decision; category D added to both sets).
- Scorer changes (31 Oct 2026, `phase477-score.ts`): the newer command kinds are recognised
  (`edit_occurrence`, `end_series`, reminder and provider-event commands) with their semantic aliases
  (`edit_occurrence` + status completed = complete, otherwise update); the new time of a move / shift /
  occurrence edit (`start`, `end`, `occurrenceStart`) counts as a selected clock; `reminderId` is a
  target id. None of these relax an expectation; before them a move or a reminder update could not pass
  an `includes` clock or a `taskId` at all.

## Runs (31 Oct 2026, V7)

All full runs unless named `-retest*` (subset reruns of failed scenarios, not suite results).

| Directory | Tree | Result |
|---|---|---|
| `uk-baseline`, `en-baseline` | `ccbe6ee` (frozen baseline) | UA 75/115, EN 21/32, 11 unsafe turns |
| `uk-fix1` … `uk-fix4`, `en-fix1` … `en-fix4` | rounds 1–4 | see `*-fixN-report.json` |
| `hard-baseline` | `58b6bd4` (first run of the hard set) | 19/30 |
| `hard-fix1`, `uk-fix5`, `en-fix5` | `1ba455d` | hard 29/30; UA 108/115; EN 29/32; 3 unsafe |
| `hard-fix2`, `uk-fix6`, `en-fix6` | `f18e764` | hard 29/30; UA 107/115; EN 30/32; 1 unsafe |
| **`uk-final`, `en-final`, `hard-final`** | **`41cb443`** | **UA 110/115, EN 30/32, hard 29/30, 0 unsafe** |

Reports: `2026-10-31-<name>-report.json` (`eval/v7-report.ts`). Details and root causes:
documentation/voice-agent-handoff.md §0c.
