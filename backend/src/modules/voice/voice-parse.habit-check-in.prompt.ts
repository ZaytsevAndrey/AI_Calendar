import { HABIT_TARGET_MODULE } from './prompt-modules/habit-target';
import {
  buildVoiceParseSharedUserPrompt,
  languageInstruction,
  type VoiceParsePromptContext,
} from './voice-parse.shared.prompt';

const HABIT_CHECK_IN_SCHEMA = `{
  "intent": "habit_check_in",
  "understanding": "complete" | "needs_clarification",
  "clarifyingQuestion": string | null,
  "command": {
    "target": "named",
    "taskName": string | null
  },
  "task": null,
  "habit": null
}`;

const HABIT_CHECK_IN_RULES = `Check-in marks the habit done for the civil date in the user message (settings timezone today). There is no date field. Do not output one.

First match wins.
1. They named another day ("вчора", "tomorrow", "за понеділок") → needs_clarification, one question that check-in is today only. Do not pretend to check in that day.
2. They named an Open task and not a habit → needs_clarification, one question which habit. Do not complete the task here.
3. Otherwise follow Target. habit stays null.

Do not invent a habit, a streak, or a confirmation question.

Examples:
- "відміть воду" → taskName "Вода" from Habits
- "звичку зробив" and Habits has one line → taskName null
- "відміть воду за вчора" → needs_clarification`;

/** Specialist: check a habit in for the civil today. The resolver ignores any spoken date. */
export function buildVoiceHabitCheckInSystemPrompt(language?: string | null): string {
  return [
    'You check in an EXISTING habit for today. Do not create a habit or a task.',
    languageInstruction(language),
    'Reply with a single JSON object only. No markdown.',
    HABIT_CHECK_IN_SCHEMA,
    HABIT_CHECK_IN_RULES,
    HABIT_TARGET_MODULE,
  ].join('\n\n');
}

export function buildVoiceHabitCheckInUserPrompt(input: VoiceParsePromptContext): string {
  return `${buildVoiceParseSharedUserPrompt(input, { includePhases: false })}

Return habit_check_in JSON (habit title only). No date.`;
}
