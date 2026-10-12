# Voice prompts — next work (handoff)

**Status:** working queue after hybrid Voice Agent (§15–§19) shipped in code.  
**Use:** open a **new chat per item** below. Product contract: [spec-voice-agent.md](spec-voice-agent.md). Architecture plan (Cursor): `voice_prompt_architecture_3d81fe7a`.

## Already shipped (do not redo)

- Orchestrator `/voice/turn` + session + read tools + day-plan + hero UI.
- Parse: **router** (`intent` + `language`) → **per-intent specialist** → normalize / `resolveVoiceCommand`.
- Create specialist is **full**, assembled from [prompt-modules/](../backend/src/modules/voice/prompt-modules/) into one system string. Spoken today/tomorrow follow sleep (after sleep = civil date, even before wake). Update and reschedule specialists are **full** ([voice-parse.update.prompt.ts](../backend/src/modules/voice/voice-parse.update.prompt.ts), [voice-parse.reschedule.prompt.ts](../backend/src/modules/voice/voice-parse.reschedule.prompt.ts)). Other intents are **lean stubs** in [voice-parse.intent-prompts.ts](../backend/src/modules/voice/voice-parse.intent-prompts.ts).
- Create when: day window OK; recurring with pattern OK without clock; **no usable when → Unscheduled** (no day/time clarify loop). Clarify only if **name** missing.
- Placement honors `earliestStartTime` via [placement-bounds.util.ts](../backend/src/modules/schedule/placement-bounds.util.ts).
- Logs: `[llm:parse.router]`, `[llm:parse.create]`, … via `voice-llm-log.util.ts`.

## Architecture (locked)

```
STT → Orchestrator (answer | mutate | propose_plan | …)
        mutate → Router LLM → Specialist LLM(intent) → code guards → client intents
```

- **One specialist file/prompt per intent**, not one LLM call per micro-rule inside create.
- Inside create: optional **prompt modules** concatenated into **one** system string (same call). Do not chain when→kind→phase as separate LLM calls.
- Day-plan / Q&A stay on **orchestrator**, not as parse intents.

## Specialists checklist

| Intent | Prompt state | Next chat focus |
|--------|--------------|-----------------|
| `create` | full (modules + kind tree) | Done for this queue |
| `update` | full | Done: target + changed fields only |
| `reschedule` | full | Done: move / do now; day window vs clock |
| `complete` | stub | Target + recurring occurrence |
| `skip` | stub | One occurrence; unscheduled cancel path |
| `delete` | stub | Target; confirm stays orchestrator |
| `habit_*` (5) | stubs | When habit voice flow hurts in logs |
| `needs_clarification` | stub | Keep thin |

Router: [voice-parse.router.prompt.ts](../backend/src/modules/voice/voice-parse.router.prompt.ts) — keep tiny; create follow-ups must stay `create`, not `update`.

## Open bugs / follow-ups (separate chats)

1. **Golden utterances** — freeze kind/when decision tree with normalize + prompt snapshot tests from real log failures.
2. **Fatten stubs in priority order:** `complete` / `skip` / `delete` → habits.
3. **Unused i18n** — `voice.whenOrUnscheduled` may be unused after no-when→Unscheduled; remove or keep for rare spoken UX later.

## How to verify in a new chat

```text
Logs: [llm:parse.router] then [llm:parse.<intent>]
Create no-when → task.isUnscheduled, understanding complete
Recurring + WEEKLY Mon–Fri, no clock → complete recurring
Tomorrow+clock after sleep (even before wake) → next civil day; before an overnight sleep → coming morning is “tomorrow”
```

Delete or archive this file into [roadmap-archive.md](roadmap-archive.md) when the queue above is done.
