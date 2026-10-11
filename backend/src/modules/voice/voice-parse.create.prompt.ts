import {
  buildVoiceParseSharedUserPrompt,
  languageInstruction,
  type VoiceParsePromptContext,
} from './voice-parse.shared.prompt';

/** Step 2 (create): only the fields that matter for a new task. */
export function buildVoiceCreateSystemPrompt(language?: string | null): string {
  return `You extract a NEW calendar task from speech.
${languageInstruction(language)}
Reply with a single JSON object only. No markdown.

{
  "intent": "create",
  "understanding": "complete" | "needs_clarification",
  "clarifyingQuestion": string | null,
  "task": {
    "name": string,
    "kind": "fixed" | "flexible" | "unscheduled" | "recurring",
    "estimatedTimeInMinutes": number,
    "deadline": string | null,
    "earliestStartTime": string | null,
    "scheduledStartTime": string | null,
    "scheduledEndTime": string | null,
    "isRecurring": boolean,
    "recurrencePattern": "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY" | null,
    "recurrenceWeekDays": number[] | null,
    "phaseId": string | null,
    "priority": "low" | "medium" | "high" | "urgent",
    "description": string | null,
    "isUnscheduled": boolean
  }
}

Kind (pick one):
- fixed: immovable exact appointment with a clock (dentist at 3pm) → set scheduledStartTime + scheduledEndTime (end = start + duration).
- flexible: movable work; may have a preferred clock (scheduledStart/End) or only a day window.
- unscheduled: inbox / no calendar slot → isUnscheduled true; clear schedule fields.
- recurring: repeats → isRecurring true + recurrencePattern (and recurrenceWeekDays for WEEKLY). Clock optional.

When rules (use Local calendar dates; ISO-8601 with numeric offset):
- Day + clock / relative "in N hours": set scheduledStart (and End). Prefer kind fixed for appointments; flexible for soft preferences.
- Day, no clock: kind flexible; earliestStartTime = 00:00 that day; deadline = 23:59 that day; scheduledStart/End null.
- Recurring with a clear pattern (щодня/daily, weekly, Mon–Fri, …): kind recurring + pattern (+ weekDays). Do NOT ask for a calendar day/time. Optional preferred clock or phaseId if spoken ("midday" → pick a mid-day phase or leave schedule null).
- No usable day/clock/window and not a clear recurring pattern: kind unscheduled, isUnscheduled true, understanding complete. Do NOT ask which day/time.
- Clock with no day: if still future on schedule today, use schedule today; else unscheduled (do not invent a day).
- Never put scheduledStart before now ISO. "tomorrow"/"завтра" = schedule tomorrow, never schedule today.
- Name: short title in the original language. Duration default 30. Priority default medium. phaseId only from the phases list or null.
- Clarify ONLY when the task name is missing/unclear — not for missing when.

Do not invent Google metadata. Do not output command/habit objects.`;
}

export function buildVoiceCreateUserPrompt(
  input: VoiceParsePromptContext,
): string {
  return `${buildVoiceParseSharedUserPrompt(input, { includePhases: true })}

Return create JSON (kind + name + when).`;
}
