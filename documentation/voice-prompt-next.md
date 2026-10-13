# Voice prompts — next work (handoff)

**Status:** working queue for roadmap **§23** (split; logging-first).  
**Use:** open a **new chat per mini-item** below. Product contract: [spec-voice-agent.md](spec-voice-agent.md). Architecture plan (Cursor): `voice_prompt_architecture_3d81fe7a`.

## Already shipped (do not redo)

- Orchestrator `/voice/turn` + session + read tools + day-plan + hero UI.
- Parse: **router** (`intent` + `language`) → **per-intent specialist** → normalize / `resolveVoiceCommand`.
- Every intent has a **full** specialist: one system string (schema, first-match rules, fields the resolver reads). Create is assembled from [prompt-modules/](../backend/src/modules/voice/prompt-modules/). The other intents are one file each and share the task-target, habit-target, and clock fragments inside that same call. Spoken today/tomorrow follow sleep (after sleep = civil date, even before wake). `needs_clarification` returns a question only and does not create a task.
- Create when: day window OK; recurring with pattern OK without clock; **no usable when → Unscheduled** (no day/time clarify loop). Clarify only if **name** missing.
- Placement honors `earliestStartTime` via [placement-bounds.util.ts](../backend/src/modules/schedule/placement-bounds.util.ts).
- Debug raw LLM: `[llm:parse.router]`, `[llm:parse.create]`, … via `voice-llm-log.util.ts` (clipped).
- Structured harvest log: `voice.parse.result` JSON after normalize/resolve ([voice-parse-result-log.util.ts](../backend/src/modules/voice/voice-parse-result-log.util.ts)).
- Create kind/when baseline goldens (no live LLM): [voice-create-kind-when.goldens.ts](../backend/src/modules/voice/voice-create-kind-when.goldens.ts).

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

## Open queue (one chat each)

1. **§23.3 Harvest + router goldens** — misroutes from real `voice.parse.result` lines (needs a few real utterances).
2. **§23.4+ Fix loops** — failing goldens → prompt or normalize fix (create edges, update/reschedule, series, habits).
3. **§23.n Cleanup** — unused `voice.whenOrUnscheduled` i18n; archive this file when empty.

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
Tomorrow+clock after sleep (even before wake) → next civil day; before an overnight sleep → coming morning is “tomorrow”
```

Delete or archive this file into [roadmap-archive.md](roadmap-archive.md) when the queue above is done.
