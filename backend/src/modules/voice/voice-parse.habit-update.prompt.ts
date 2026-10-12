import { BARE_HOUR_RULE } from './prompt-modules/clock-speech';
import { HABIT_COLOR_RULE } from './prompt-modules/habit-color';
import { HABIT_TARGET_MODULE } from './prompt-modules/habit-target';
import {
  buildVoiceParseSharedUserPrompt,
  languageInstruction,
  type VoiceParsePromptContext,
} from './voice-parse.shared.prompt';

const HABIT_UPDATE_SCHEMA = `{
  "intent": "habit_update",
  "understanding": "complete" | "needs_clarification",
  "clarifyingQuestion": string | null,
  "command": {
    "target": "named",
    "taskName": string | null
  },
  "task": null,
  "habit": { }
}`;

const HABIT_UPDATE_RULES = `Patch — put ONLY fields they changed into habit. Omit every other key. A present key is saved, and null clears it. Do not invent a field.

Rename: command.taskName stays the current title copied from Habits, even when there is only one habit. habit.name is the new title and must differ. Never put the new title in command.taskName. If this is not a rename, omit habit.name.

Other fields, only when spoken:
- ${HABIT_COLOR_RULE}
- description: the new text, or null when they said to clear it.
- Daily block. blockStartTime is HH:mm, not ISO. ${BARE_HOUR_RULE}
  Time only → blockStartTime, omit blockMinutes.
  Length only → blockMinutes (5–240), omit blockStartTime. Outside 5–240, ask. Do not clamp.
  Both spoken → set both.
  They removed the daily block → blockStartTime null and blockMinutes null.
  One of the pair is missing and they are trying to add a block the habit does not have yet → one question for the missing half. Do not invent 09:00 or 30.

The target is known and nothing changed → needs_clarification, one question what to change. Leave habit {}.
Do not create a habit. Do not check it in. Do not ask to confirm.

Examples:
- "перейменуй звичку біг на пробіжку" → taskName "Біг" from Habits, habit.name "Пробіжка"
- "зміни колір води на зелений" → taskName "Вода", habit.color "#22c55e", no name key
- "прибери час у розтяжки" → taskName "Розтяжка", blockStartTime null, blockMinutes null`;

/** Specialist: partial edit of an existing habit. taskName is the current title. */
export function buildVoiceHabitUpdateSystemPrompt(language?: string | null): string {
  return [
    'You edit an EXISTING habit. Do not create a habit or a task.',
    languageInstruction(language),
    'Reply with a single JSON object only. No markdown.',
    HABIT_UPDATE_SCHEMA,
    HABIT_TARGET_MODULE,
    HABIT_UPDATE_RULES,
  ].join('\n\n');
}

export function buildVoiceHabitUpdateUserPrompt(input: VoiceParsePromptContext): string {
  return `${buildVoiceParseSharedUserPrompt(input, { includePhases: false })}

Return habit_update JSON (current title + only the changed fields).`;
}
