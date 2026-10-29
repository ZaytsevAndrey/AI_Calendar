---
paths:
  - "backend/src/modules/voice/**"
---

# Voice: no lexical crutches

Speech meaning (clock, AM/PM, relative time, weekdays, recurring, titles, empty create) is decided by the **LLM** via prompts. TypeScript must not re-parse the transcript with language word lists.

## Allowed in TypeScript (`normalizeVoiceParse`, calendar helpers)

- Clamp / validate structured fields the model already emitted (duration, phase id, weekdays arrays, ISO parseability)
- Stamp the settings zone onto the date and clock digits the model emitted. A trailing Z or a wrong numeric offset does not move those digits.
- Drop a past one-off fixed `scheduledStart` and keep the rest of that civil day. A past flexible preferred with no open placement window moves to the next civil day at the same wall clock from the emitted ISO. A past preferred inside a still-open window is dropped; the window stays. A recurring series clock stays even if that hour today already passed.
- Finish a half day-envelope only when the model already emitted `00:00` or `23:59`. Prompts describe a whole day as Wake to Sleep, not midnight to 23:59.
- Inbox when there is a name but no when
- Require a non-empty `name` (fallback i18n clarify string is OK — not speech parsing)

## Forbidden

- Regex / stem dictionaries for UK/EN/RU (or any language) to infer clock, morning, ordinals, “tomorrow”, weekdays, relative hours, recurring days, or titles from `transcript`
- “Trust the transcript over the model” align/fill/force helpers that re-derive schedule fields from speech
- Growing per-language word lists to green an eval — fix the **prompt** or the **model**, not normalize

```typescript
// ❌ BAD — language-specific override
if (/щоранку|вранці|\bam\b/i.test(transcript)) hour = 7;

// ✅ GOOD — model already emitted ISO; only rezone/clamp
task.scheduledStartTime = rezoneWallClockIso(modelIso, timeZone);
```

## Prompts

- Prompt text is English. One line may set the reply language. Sample utterances in any language are forbidden.
- State the situation (new errand, existing task, part of the waking day, day relative to the anchor). Do not bind a rule to a word or a phrase.
- Dialogue tests and day-plan fixes follow `documentation/voice-agent-dialogue-test-plan.md`.

When an eval fails: strengthen the English prompt with one conceptual rule, or clamp a field the model already emitted. Do not add transcript regex “fixes”.
