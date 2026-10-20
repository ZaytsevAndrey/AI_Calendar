import { CLOCK_ISO_MODULE } from './prompt-modules/clock-speech';
import { QUESTION_PROPOSAL_MODULE } from './prompt-modules/question-proposal';
import { SERIES_SCOPE_MODULE } from './prompt-modules/series-scope';
import { TASK_TARGET_MODULE } from './prompt-modules/task-target';
import {
  buildVoiceParseSharedUserPrompt,
  languageInstruction,
  type VoiceParsePromptContext,
} from './voice-parse.shared.prompt';

const RESCHEDULE_SCHEMA = `{
  "intent": "reschedule",
  "understanding": "complete" | "needs_clarification",
  "clarifyingQuestion": string | null,
  "command": {
    "target": "current" | "named",
    "taskName": string | null,
    "start": string | null,
    "end": string | null,
    "seriesScope": "occurrence" | "series" | "all" | null
  },
  "task": null,
  "habit": null
}`;

const RESCHEDULE_RULES = `When. First match wins. Times go on command.start and command.end only.
1. "do now" / "schedule it now" → command.start = now ISO, command.end null.
2. A start and an end ("between 14 and 18", "between 2 and 6", "until 4", "until 16:00") → start at the start, end at the end, on the schedule day they named (or schedule today when they named no day and the start is still ahead).
3. A day and no clock ("tomorrow", "on Friday") → command.start at Wake and command.end at Sleep on that schedule day. That pair is the waking span, not midnight.
4. A clock with no day that is already past → needs_clarification, one question when. start and end null. Do not write that start. Do not invent the next day.
5. A clock or "in N hours" and no end → command.start at that instant, command.end null. The app keeps the current duration.
6. A bound on an existing task (by a weekday, until a part of day), when they did not ask to move it and did not call it the deadline, is not a move. needs_clarification. Ask what they want. Do not pick. start and end null.
7. Morning is the first three hours after wake. That is the window: start at wake, end three hours later, on the day they named, or schedule today when they named no day. Do not ask when and do not substitute a guessed clock.
8. No day, no clock, no morning, and not do-now → needs_clarification, one question when. start and end null. Do not invent the next day.

Do not rename the task, change its phase, priority, or duration. Leave task null.
Do not invent a day. Do not ask to confirm.
${QUESTION_PROPOSAL_MODULE}

Examples:
- "move the report to tomorrow" → start at Wake, end at Sleep, schedule tomorrow
- "move it to 15:00" → start 15:00 on schedule today if that clock is still ahead, end null
- "do it now" → start = now ISO, end null
- "move it to between 14 and 18" → start 14:00, end 18:00`;

/** Specialist: move / do-now / day window. The resolver reads command.start and command.end only. */
export function buildVoiceRescheduleSystemPrompt(language?: string | null): string {
  return [
    'You move an EXISTING app task. Do not create a task and do not edit its name, phase, or priority.',
    languageInstruction(language),
    'Reply with a single JSON object only. No markdown.',
    RESCHEDULE_SCHEMA,
    TASK_TARGET_MODULE,
    SERIES_SCOPE_MODULE,
    RESCHEDULE_RULES,
    CLOCK_ISO_MODULE,
  ].join('\n\n');
}

export function buildVoiceRescheduleUserPrompt(
  input: VoiceParsePromptContext,
): string {
  return `${buildVoiceParseSharedUserPrompt(input, { includePhases: false })}

Return reschedule JSON (target + start/end). Leave task null.`;
}
