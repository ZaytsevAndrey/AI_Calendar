# Voice prompts — next work (handoff)

**Status:** working queue after hybrid Voice Agent (§15–§19) shipped in code.  
**Use:** open a **new chat per item** below. Product contract: [spec-voice-agent.md](spec-voice-agent.md). Architecture plan (Cursor): `voice_prompt_architecture_3d81fe7a`.

## Already shipped (do not redo)

- Orchestrator `/voice/turn` + session + read tools + day-plan + hero UI.
- Parse: **router** (`intent` + `language`) → **per-intent specialist** → normalize / `resolveVoiceCommand`.
- Every intent has a **full** specialist: one system string (schema, first-match rules, fields the resolver reads). Create is assembled from [prompt-modules/](../backend/src/modules/voice/prompt-modules/). The other intents are one file each and share the task-target, habit-target, and clock fragments inside that same call. Spoken today/tomorrow follow sleep (after sleep = civil date, even before wake). `needs_clarification` returns a question only and does not create a task.
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

| Intent | Prompt state | What the prompt is for |
|--------|--------------|---------------------|
| `create` | full (modules + kind tree) | Kind, name, when |
| `update` | full | Changed fields only. A series asks for scope; name, priority, and phase apply to the whole series |
| `reschedule` | full | Move / do now; day window vs clock. A series asks this day, this and following, or the whole series |
| `complete` | full | One-off marks done. A series asks: this day, this and following, or the whole series |
| `skip` | full | Next open occurrence only; unscheduled cancels; another day asks |
| `delete` | full | A series asks this day / this and following / whole series. Confirm stays on the orchestrator |
| `habit_check_in` | full | Civil today only |
| `habit_create` | full | Name; daily block needs time and length |
| `habit_update` | full | Current title in `command.taskName`; changed habit fields only |
| `habit_delete` | full | Habit title; confirm stays orchestrator |
| `habit_uncheck` | full | Clear today's check-in only |
| `needs_clarification` | full | One question; `task` null |

Router: [voice-parse.router.prompt.ts](../backend/src/modules/voice/voice-parse.router.prompt.ts) — keep tiny; create follow-ups must stay `create`, not `update`.

## Open bugs / follow-ups (separate chats)

1. **Golden utterances** — freeze kind/when decision tree with normalize + prompt snapshot tests from real log failures.
2. **Unused i18n** — `voice.whenOrUnscheduled` may be unused after no-when→Unscheduled; remove or keep for rare spoken UX later.

## How to verify in a new chat

```text
Logs: [llm:parse.router] then [llm:parse.<intent>]
Create no-when → task.isUnscheduled, understanding complete
Recurring + WEEKLY Mon–Fri, no clock → complete recurring
Tomorrow+clock after sleep (even before wake) → next civil day; before an overnight sleep → coming morning is “tomorrow”
```

Delete or archive this file into [roadmap-archive.md](roadmap-archive.md) when the queue above is done.
