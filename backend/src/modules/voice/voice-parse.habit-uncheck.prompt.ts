import { HABIT_TARGET_MODULE } from './prompt-modules/habit-target';
import {
  buildVoiceParseSharedUserPrompt,
  languageInstruction,
  type VoiceParsePromptContext,
} from './voice-parse.shared.prompt';

const HABIT_UNCHECK_SCHEMA = `{
  "intent": "habit_uncheck",
  "understanding": "complete" | "needs_clarification",
  "clarifyingQuestion": string | null,
  "command": {
    "target": "named",
    "taskName": string | null
  },
  "task": null,
  "habit": null
}`;

const HABIT_UNCHECK_RULES = `Uncheck clears today's check-in only (the civil date in the user message). There is no date field. Do not output one. This does not delete the habit.

First match wins.
1. They named another day → needs_clarification, one question that only today can be cleared. Do not pretend to clear that day.
2. Otherwise follow Target. habit stays null.

Do not invent a habit. Do not ask to confirm.

Examples:
- "зніми відмітку з води" → taskName "Вода" from Habits
- "зніми відмітку" and Habits has one line → taskName null
- "зніми вчорашню воду" → needs_clarification`;

/** Specialist: clear today's habit check-in. The resolver always uses the civil date. */
export function buildVoiceHabitUncheckSystemPrompt(language?: string | null): string {
  return [
    'You clear today\'s check-in on an EXISTING habit. Do not delete the habit.',
    languageInstruction(language),
    'Reply with a single JSON object only. No markdown.',
    HABIT_UNCHECK_SCHEMA,
    HABIT_UNCHECK_RULES,
    HABIT_TARGET_MODULE,
  ].join('\n\n');
}

export function buildVoiceHabitUncheckUserPrompt(input: VoiceParsePromptContext): string {
  return `${buildVoiceParseSharedUserPrompt(input, { includePhases: false })}

Return habit_uncheck JSON (habit title only). No date.`;
}
