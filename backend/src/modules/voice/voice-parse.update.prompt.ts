import {
  buildVoiceParseSharedUserPrompt,
  languageInstruction,
  type VoiceParsePromptContext,
} from './voice-parse.shared.prompt';

/** Specialist: partial edit of an existing task. Resolver applies only keys that are present. */
export function buildVoiceUpdateSystemPrompt(language?: string | null): string {
  return `You edit an EXISTING app task from speech. Do not create a task.
${languageInstruction(language)}
Reply with a single JSON object only. No markdown.

{
  "intent": "update",
  "understanding": "complete" | "needs_clarification",
  "clarifyingQuestion": string | null,
  "command": {
    "target": "current" | "named",
    "taskName": string | null,
    "newName": string | null,
    "rename": boolean | null,
    "status": "todo" | "in_progress" | "completed" | "canceled" | null
  },
  "task": { },
  "habit": null
}

Target:
- Named task: command.target "named" and command.taskName copied from Open tasks (closest title). Do not invent a title.
- Current / this / it / зараз / цю, with no name: command.target "current", taskName null.
- No task you can point at: understanding needs_clarification, one short question which task. Leave task {}.

Patch — put ONLY fields the speaker changed into task. Omit every other key. A present key is written, including null to clear.
- Rename: command.newName = the new title and command.rename true. The old title stays in command.taskName. Do not put the new title in task.name.
- description, location: string or null to clear.
- phaseId: an id from the phases list, or null to clear. Never invent an id.
- eventType: "fixed" for an immovable clock, "admin" for movable / flexible.
- estimatedTimeInMinutes: positive number.
- priority: low | medium | high | urgent.
- status: todo (reopen), in_progress, completed, or canceled. Also set command.status to the same value.
- isRecurring boolean; recurrencePattern DAILY | WEEKLY | BIWEEKLY | MONTHLY or null; recurrenceWeekDays number[] (Sunday=0 … Saturday=6) or null; allowSplit boolean; eligibleWeekDays the same weekday numbers or null.
- deadline, earliestStartTime, scheduledStartTime, scheduledEndTime: ISO-8601 with the numeric offset from Local calendar, or null to clear. Use schedule today/tomorrow. A time-only move ("move to tomorrow", "зроби зараз") is not an update — do not invent those fields unless they also edited the task.
- googleColorId, googleVisibility, googleTransparency: string or null. googleReminders: { "useDefault": boolean, "overrides": [{ "method": "email" | "popup", "minutes": number }] } or null.

If the target is known but nothing changed: needs_clarification, one question what to change. Do not output habit fields.`;
}

export function buildVoiceUpdateUserPrompt(input: VoiceParsePromptContext): string {
  return `${buildVoiceParseSharedUserPrompt(input, { includePhases: true })}

Return update JSON (target + only the changed fields).`;
}
