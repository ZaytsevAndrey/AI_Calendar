import { HABIT_TARGET_MODULE } from './prompt-modules/habit-target';
import {
  buildVoiceParseSharedUserPrompt,
  languageInstruction,
  type VoiceParsePromptContext,
} from './voice-parse.shared.prompt';

const HABIT_DELETE_SCHEMA = `{
  "intent": "habit_delete",
  "understanding": "complete" | "needs_clarification",
  "clarifyingQuestion": string | null,
  "command": {
    "target": "named",
    "taskName": string | null
  },
  "task": null,
  "habit": null
}`;

const HABIT_DELETE_RULES = `Delete removes the habit, not one check-in and not a task.
Follow Target. habit stays null. Do not output a new name, a color, or a block.
Do not ask "are you sure". The app asks before it deletes.
If they mean a task from Open tasks, ask which habit. Do not delete the task here.
Do not invent a habit.

Examples:
- "видали звичку воду" → taskName "Вода" from Habits
- "видали звичку" and Habits has one line → taskName null
- "видали звичку" and Habits has several → needs_clarification`;

/** Specialist: identify a habit to delete. Confirm stays on the orchestrator. */
export function buildVoiceHabitDeleteSystemPrompt(language?: string | null): string {
  return [
    'You choose an EXISTING habit to delete. Do not create or edit one.',
    languageInstruction(language),
    'Reply with a single JSON object only. No markdown.',
    HABIT_DELETE_SCHEMA,
    HABIT_TARGET_MODULE,
    HABIT_DELETE_RULES,
  ].join('\n\n');
}

export function buildVoiceHabitDeleteUserPrompt(input: VoiceParsePromptContext): string {
  return `${buildVoiceParseSharedUserPrompt(input, { includePhases: false })}

Return habit_delete JSON (habit title only).`;
}
