import { CLOCK_ISO_MODULE } from './prompt-modules/clock-speech';
import { QUESTION_PROPOSAL_MODULE } from './prompt-modules/question-proposal';
import { SERIES_SCOPE_MODULE } from './prompt-modules/series-scope';
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
  "task": { },
  "habit": null
}`;

const UPDATE_RULES = `Patch — put ONLY fields the speaker changed into task. Omit every other key. A present key is saved, and null clears it. Do not invent a field they did not mention.

Not this intent. First match wins before any patch.
1. The only request is a move ("move it to tomorrow", "move to 3", "do it now") → needs_clarification, one question what to change. Do not copy that into deadline or scheduledStartTime.
2. They only said done, skip, or delete → needs_clarification, one question what to change. Do not set status from those words.
3. The target is known and nothing changed → needs_clarification, one question what to change. Leave task {}.

Fields, only when they named that change:
- Rename: command.newName is the new title and command.rename true. The old title stays in command.taskName. Do not put the new title in task.name.
- description, location: the words they added, or null when they said to clear it.
- phaseId: an id from the phases list, or null to clear. Never invent an id. Do not change the phase just because a time falls inside one.
- estimatedTimeInMinutes: a positive number only after they said the length is how long the task takes. A window is not a length. ${QUESTION_PROPOSAL_MODULE}
- priority: low | medium | high | urgent, only when they said it (urgent → urgent, "no rush" / low priority → low). Do not default medium.
- status: set command.status only. todo reopens, in_progress, completed, canceled. Omit task.status.
- Repeat, only when they changed the repeat: isRecurring, recurrencePattern DAILY | WEEKLY | BIWEEKLY | MONTHLY or null, recurrenceWeekDays (Sunday=0 … Saturday=6) or null. every day → DAILY and days null. A repeat on named weekdays → WEEKLY on those days. Turning a repeat off → isRecurring false, recurrencePattern null, recurrenceWeekDays null.
- eligibleWeekDays only when they limit which days a flexible task may land, not when they set a repeat. allowSplit only when they said it can or cannot be split.
- A bound on an existing task (by a weekday, until a part of day) is not a deadline and not a move until they say which. understanding needs_clarification. One question what they want. Do not pick. Do not set deadline, earliest, or a window. They called it the deadline → set deadline as below.
- A placement (a clock, a part of the day, another day) is not a field. Do not set scheduledStartTime, scheduledEndTime, or earliestStartTime to move the task. They said the task has no time, or the time should be gone → set scheduledStartTime, scheduledEndTime, earliestStartTime, and deadline to null. That is the change. Do not ask what they meant.
- deadline: ISO on task, never on command.start. Only when they called it the deadline. A day and no clock → that field at Sleep. Do not fill the other schedule keys.
- eventType "fixed" only together with both scheduledStartTime and scheduledEndTime. eventType "admin" when they said it is movable. Otherwise omit eventType.
- googleColorId, googleVisibility, googleTransparency, googleReminders only when they named that Google field. Do not invent Google metadata.

A name, priority, phase, or description change is the whole series: seriesScope "all". One day of those fields does not exist.
Do not output habit fields.

Examples:
- "rename milk to bread" → taskName from Open tasks, newName "Bread", rename true, task {}
- "report deadline tomorrow" → task.deadline at Sleep on schedule tomorrow, no other task keys
- "make it urgent" → target current, task.priority "urgent"`;

/** Specialist: partial edit of an existing task. The resolver writes only keys that are present. */
export function buildVoiceUpdateSystemPrompt(language?: string | null): string {
  return [
    'You edit an EXISTING app task from speech. Do not create a task.',
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

Return update JSON (target + only the changed fields).`;
}
