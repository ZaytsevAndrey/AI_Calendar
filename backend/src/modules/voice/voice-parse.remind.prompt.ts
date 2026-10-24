import {
  buildVoiceParseSharedUserPrompt,
  languageInstruction,
  type VoiceParsePromptContext,
} from './voice-parse.shared.prompt';

const REMIND_SCHEMA = `{
  "intent": "remind",
  "understanding": "complete" | "needs_clarification",
  "clarifyingQuestion": string | null,
  "action": "create" | "update" | "resolve" | "delete",
  "name": string | null,
  "targetName": string | null,
  "dueYmd": "YYYY-MM-DD" | null,
  "notificationTime": "HH:mm" | null,
  "description": string | null,
  "recurrencePattern": "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY" | null,
  "recurrenceWeekDays": number[] | null,
  "task": null
}`;

const REMIND_RULES = `A day reminder is a named errand on a civil day. It is not a task, not a slot, and not a phase.
Create only when they used a remind word (нагадай, напомни, remind me, постав нагадування, поставь напоминание).
Done, a change, or a delete names an open reminder in Open reminders. targetName is that reminder. name is the new title only when they rename it.
dueYmd is the civil day they named, YYYY-MM-DD, from the calendar lines above. A week with no day inside it: ask which day. Do not pick one.
notificationTime is the reminder clock they spoke. Omit the key when they did not say a clock. Do not invent 09:00.
description only when they added a note. Omit the key otherwise.
recurrencePattern only when they asked to repeat: every day DAILY, weekly or weekdays WEEKLY, every two weeks BIWEEKLY, monthly MONTHLY. Omit the key when they did not mention a repeat. recurrenceWeekDays is 0=Sunday … 6=Saturday, only for WEEKLY.
Ask one question when the name is missing, or when a create has no specific day. Do not ask for a clock or a repeat.
Do not invent a name, a day, or a clock.

Examples:
- "нагадай завтра відписатись" → create, name "відписатись", dueYmd tomorrow
- "remind me on the 3rd to pay rent at 18:00 every month" → create, notificationTime "18:00", recurrencePattern MONTHLY
- "done with unsubscribe" and that name is an open reminder → resolve, targetName from the list
- "delete the Netflix reminder" → delete, targetName from the list`;

/** Specialist: one day reminder. Confirm stays on the orchestrator. */
export function buildVoiceRemindSystemPrompt(language?: string | null): string {
  return [
    'You fill one day reminder. Do not create a task and do not seat it on the calendar.',
    languageInstruction(language),
    'Reply with a single JSON object only. No markdown.',
    REMIND_SCHEMA,
    REMIND_RULES,
  ].join('\n\n');
}

export function buildVoiceRemindUserPrompt(input: VoiceParsePromptContext): string {
  const reminders = input.openReminders?.length
    ? input.openReminders
        .map(
          (row) =>
            `- ${JSON.stringify(row.name)} due=${row.dueYmd}${
              row.notificationTime ? ` time=${row.notificationTime}` : ''
            }${row.recurrencePattern ? ` repeat=${row.recurrencePattern}` : ''}`,
        )
        .join('\n')
    : '(none)';
  return `${buildVoiceParseSharedUserPrompt(input, { includePhases: false })}

Open reminders:
${reminders}

Return remind JSON.`;
}
