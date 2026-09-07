import type { Phase } from '../phases/entities/phase.entity';
import type { UserSettings } from '../user-settings/entities/user-settings.entity';
import { buildLocalCalendarContext } from './voice-local-date.util';

export function buildVoiceParseSystemPrompt(): string {
  return `You extract a calendar task from a spoken transcript (Ukrainian, English, or Russian).
Reply with a single JSON object only. No markdown.

JSON shape:
{
  "understanding": "complete" | "sufficient" | "needs_clarification",
  "clarifyingQuestion": string | null,
  "task": {
    "name": string,
    "description": string | null,
    "eventType": "fixed" | "admin",
    "estimatedTimeInMinutes": number,
    "isRecurring": boolean,
    "recurrencePattern": "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY" | null,
    "recurrenceWeekDays": number[] | null,
    "allowSplit": boolean,
    "priority": "low" | "medium" | "high" | "urgent",
    "deadline": string | null,
    "earliestStartTime": string | null,
    "eligibleWeekDays": number[] | null,
    "scheduledStartTime": string | null,
    "scheduledEndTime": string | null,
    "phaseId": string | null
  }
}

understanding:
- complete: name is clear AND every CRITICAL field for the inferred mode is present. The app will create the task immediately.
- sufficient: name is clear, nothing critical is missing, but some fields are guessed/defaulted or mildly ambiguous. The user will review a prefilled form.
- needs_clarification: a CRITICAL gap or contradiction. Ask ONE short question in the SAME language as the transcript. Put it in clarifyingQuestion.

CRITICAL (must clarify if missing):
- Task name / what to do (unintelligible speech, empty intent)
- Fixed/appointment-like event with no start time (doctor, meeting, call at a specific time)
- Recurring intent with no usable pattern (they said "repeat" but not how)
- Contradictory time (e.g. "flexible whenever" AND "exactly 15:00")

NOT critical (use defaults, prefer sufficient over asking):
- Duration missing → 30
- Priority missing → medium
- Phase missing → null (any time in wake/sleep)
- Deadline missing ONLY if they named no calendar day → null
- Split missing → true for non-fixed, false for fixed

Task rules:
- eventType "fixed" = immovable exact slot. Requires scheduledStartTime AND scheduledEndTime (ISO-8601 with offset). Use only when they gave a clock time (15:00, о третій, at 3pm).
- eventType "admin" = flexible/movable. Optional preferred clock via scheduledStartTime/End (end = start + duration) ONLY when they named a clock time they prefer, not a calendar day.
- Day or range without a clock time ("tomorrow", "завтра", "в п'ятницю", "on Monday", "з п'ятниці по неділю", "Friday to Sunday"): this is allowed. Set eventType "admin", earliestStartTime to 00:00 of the first local day, deadline to 23:59 of the last local day. Leave scheduledStartTime and scheduledEndTime null. Do not ask for a time. Do not place it before that window.
- Several specific weekdays ("в понеділок і середу", "Monday and Thursday"): earliestStartTime = 00:00 of the first named day, deadline = 23:59 of the last, eligibleWeekDays = those weekdays (0=Sunday … 6=Saturday).
- Clock range ("з 14:00 до 18:00", "from 2pm to 6pm") on a named day or today: earliestStartTime = start clock, deadline = end clock.
- One phase only. phaseId MUST be one of the provided phase ids, or null. Match by meaning (work, gym, evening). Never invent ids.
- Recurrence: isRecurring true only if they asked to repeat. Pattern DAILY/WEEKLY/BIWEEKLY/MONTHLY. recurrenceWeekDays: 0=Sunday … 6=Saturday. Default Mon–Fri for "every weekday" / "щодня по буднях". Empty/null = no extra weekday filter.
- allowSplit false when fixed; true otherwise unless they forbid splitting.
- Dates/times: use the Local calendar dates below. Output ISO-8601 with numeric offset (e.g. 2026-09-08T23:59:00+03:00).
- Name: short task title, original language, not a full sentence dump.
- Keep description only if extra detail is useful.

If this turn is a clarification reply, combine previous transcript + answer. Do not ask a second clarifying question; pick complete or sufficient.`;
}

export function buildVoiceParseUserPrompt(input: {
  transcript: string;
  timeZone: string;
  nowIso: string;
  phases: Phase[];
  settings: Pick<UserSettings, 'wakeTime' | 'sleepTime' | 'weekendWorkEnabled'>;
  previousTranscript?: string;
  clarificationAnswer?: string;
}): string {
  const phaseLines = input.phases.length
    ? input.phases
        .map((phase) => {
          const days =
            phase.weekDays && phase.weekDays.length
              ? `days=${phase.weekDays.join(',')}`
              : 'days=all';
          return `- id=${phase.id} name=${JSON.stringify(phase.name)} window=${phase.startTime}-${phase.endTime} type=${phase.type} ${days}`;
        })
        .join('\n')
    : '(none)';

  const clarification = input.clarificationAnswer
    ? `\nPrevious utterance: ${JSON.stringify(input.previousTranscript ?? '')}\nClarification answer: ${JSON.stringify(input.clarificationAnswer)}`
    : '';

  return `Now (ISO): ${input.nowIso}
${buildLocalCalendarContext(input.nowIso, input.timeZone)}
Wake: ${input.settings.wakeTime}  Sleep: ${input.settings.sleepTime}
Weekend work: ${input.settings.weekendWorkEnabled ? 'yes' : 'no'}

Phases:
${phaseLines}

Transcript: ${JSON.stringify(input.transcript)}${clarification}`;
}
