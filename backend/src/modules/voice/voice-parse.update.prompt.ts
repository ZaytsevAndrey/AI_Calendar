import { CLOCK_ISO_MODULE } from './prompt-modules/clock-speech';
import { QUESTION_PROPOSAL_MODULE } from './prompt-modules/question-proposal';
import { SERIES_SCOPE_MODULE } from './prompt-modules/series-scope';
import { TASK_FIELDS_MODULE } from './prompt-modules/task-fields';
import { TASK_TARGET_MODULE } from './prompt-modules/task-target';
import {
  buildVoiceParseSharedUserPrompt,
  languageInstruction,
  type VoiceParsePromptContext,
} from './voice-parse.shared.prompt';

const UPDATE_SCHEMA = `{
  "intent": "update",
  "understanding": "complete" | "needs_clarification",
  "clarifyingQuestion": string | null,
  "command": {
    "target": "current" | "named",
    "taskName": string | null,
    "newName": string | null,
    "rename": boolean | null,
    "status": "todo" | "in_progress" | "completed" | "canceled" | null,
    "seriesScope": "occurrence" | "series" | "all" | null
  },
  "task": { }
}`;

const UPDATE_RULES = `One existing task. Every change they named in this utterance goes in this one object: fields, where it sits in time, and whether it is done. Do not split a clock from another change.

The target is known and nothing changed → needs_clarification, one question what to change. Leave task {}.

${TASK_FIELDS_MODULE}

When:
- Do now → scheduledStartTime is the now clock from the user message. scheduledEndTime null.
- A start and an end → those two clocks, on the named day or on schedule today when the start is still ahead.
- A day and no clock → earliestStartTime at Wake and deadline at Sleep that day.
- A clock with no day that is already past → needs_clarification, one question when. Leave the schedule keys out.
- Morning is wake plus three hours: earliestStartTime at wake, deadline three hours later, on the named day or schedule today.
- No day, no clock, no bound, and not do-now, and they asked to place the task → needs_clarification, one question when.

${QUESTION_PROPOSAL_MODULE}

Examples:
- "rename milk to bread" → taskName from Open tasks, newName "Bread", rename true, task {}
- "report by tomorrow" → task.deadline at Sleep on schedule tomorrow
- "make it urgent and move it to 15:00" → priority urgent and scheduledStartTime 15:00, one object
- "finished the report" → command.status "completed"`;

/** Specialist: one existing task. Time, fields, and done are the same edit. */
export function buildVoiceUpdateSystemPrompt(language?: string | null): string {
  return [
    'You edit one EXISTING app task from speech. Do not create a task.',
    languageInstruction(language),
    'Reply with a single JSON object only. No markdown.',
    UPDATE_SCHEMA,
    TASK_TARGET_MODULE,
    SERIES_SCOPE_MODULE,
    UPDATE_RULES,
    CLOCK_ISO_MODULE,
  ].join('\n\n');
}

export function buildVoiceUpdateUserPrompt(input: VoiceParsePromptContext): string {
  return `${buildVoiceParseSharedUserPrompt(input, { includePhases: true })}

Return update JSON (target + only the changed fields, including time and done).`;
}
