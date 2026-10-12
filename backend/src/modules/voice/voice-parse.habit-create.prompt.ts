import { BARE_HOUR_RULE } from './prompt-modules/clock-speech';
import { HABIT_COLOR_RULE } from './prompt-modules/habit-color';
import {
  buildVoiceParseSharedUserPrompt,
  languageInstruction,
  type VoiceParsePromptContext,
} from './voice-parse.shared.prompt';

const HABIT_CREATE_SCHEMA = `{
  "intent": "habit_create",
  "understanding": "complete" | "needs_clarification",
  "clarifyingQuestion": string | null,
  "command": null,
  "task": null,
  "habit": {
    "name": string,
    "color": string | null,
    "description": string | null,
    "blockStartTime": string | null,
    "blockMinutes": number | null
  }
}`;

const HABIT_CREATE_RULES = `Name: one habit. Short title in the transcript language. Do not translate.
Drop "створи звичку", "нова звичка", "new habit", "додай звичку". Do not keep the raw sentence and do not add facts they did not say.
Missing name → needs_clarification, one question what to call it. Do not invent "Habit" or copy a task title.

${HABIT_COLOR_RULE}
description: a detail that is not already in the title, or omit.

Daily block. First match wins. blockStartTime is HH:mm (24-hour), not an ISO timestamp. ${BARE_HOUR_RULE}
1. They named a daily time and a length ("щодня о 7 ранку на 20 хвилин") → both blockStartTime and blockMinutes. blockMinutes is an integer from 5 to 240. Outside that range, ask. Do not clamp.
2. A daily time and no length → needs_clarification, one question how long. Do not invent 30.
3. A length and no time → needs_clarification, one question what time. Do not invent 09:00.
4. No daily block → omit both keys. A habit may be check-in only.

Do not create a task. Do not invent a block, a color, or a description.

Examples:
- "створи звичку пити воду" → name "Пити воду", no color, no block
- "звичка розтяжка щодня о 7 ранку на 20 хвилин" → name "Розтяжка", blockStartTime "07:00", blockMinutes 20
- "зроби звичку біг о сьомій" → needs_clarification, how long`;

/** Specialist: create one habit. Name is required; a daily block needs both time and length. */
export function buildVoiceHabitCreateSystemPrompt(language?: string | null): string {
  return [
    'You create ONE new habit. Do not create a task and do not edit an existing habit.',
    languageInstruction(language),
    'Reply with a single JSON object only. No markdown.',
    HABIT_CREATE_SCHEMA,
    HABIT_CREATE_RULES,
  ].join('\n\n');
}

export function buildVoiceHabitCreateUserPrompt(input: VoiceParsePromptContext): string {
  return `${buildVoiceParseSharedUserPrompt(input, { includePhases: false })}

Return habit_create JSON (name, and a block only when they named one).`;
}
