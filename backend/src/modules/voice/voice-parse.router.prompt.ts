import {
  VOICE_PARSE_INTENTS,
  type VoiceParsePromptContext,
} from './voice-parse.shared.prompt';

/**
 * Day reminder contract for a later voice specialist. Not sent to the model.
 * A day reminder is not a scheduled task: no phase, no duration, no slot.
 * It is a named errand on a civil day. Fields: name, due day (YYYY-MM-DD),
 * optional notification clock (HH:mm; empty uses settings defaultReminderTime),
 * optional description, optional repeat (DAILY, WEEKLY, BIWEEKLY, MONTHLY).
 * Weekly uses the weekday of that day (or an explicit weekday set). Monthly
 * uses that day of the month; day 31 falls on the last day of a shorter month.
 * It stays open until resolved and grows more overdue each civil day.
 * Resolve closes one occurrence; a repeat then moves to the next day.
 * Delete removes it. A Google deletion of its notification event removes it too.
 * Do not route this through task create until that specialist adds an intent.
 */

/** Step 1: classify intent + language only. No task body. */
export function buildVoiceRouterSystemPrompt(): string {
  return `You classify a spoken calendar utterance (Ukrainian, English, or Russian).
Reply with a single JSON object only. No markdown.

{
  "intent": ${VOICE_PARSE_INTENTS.map((id) => `"${id}"`).join(' | ')},
  "language": "uk" | "en" | "ru"
}

Intent guide:
An utterance that states an errand is create. Update, delete, and skip are only for a task they are already pointing at. A similar open title is not pointing.
- create: new task / errand (even without "create"/"add"), e.g. "tomorrow to the shop". Also a repeating errand or stretch ("stretch every day", "meditate every day", "dentist every Tuesday"). A verb can be the errand itself when they are not pointing at an open task: "update my resume tomorrow", "delete extra photos from the phone", "close the ticket by end of day", "from now until 18 close all the reviews". That is create, not update or delete. A new errand stays create even when an open task is close in meaning. That closeness is not pointing at the open task.
- update: every change to one existing open task. That includes a rename, a priority, a note, a length, a deadline, a placement (a clock, a part of the day, another day, do it now), and a report that the task is done. Time and another field on that same task are one update, not two intents. A length with no day and no clock is still update. If the name is not in the open list, close / finish / done is a new errand (create).
- delete: permanently delete an existing open task. That stays delete even when a create verb is also present; do not turn the delete into the name of a new task. Deleting photos, files, or other things that are not an open task is a new errand, not delete.
- skip: skip one occurrence.
- needs_clarification: unintelligible or no guessable intent.

Prefer a concrete intent over needs_clarification when possible.
If Previous+Answer are given, the Answer only fills in what Previous was missing: classify the request in Previous. "delete that one" + "milk" is delete; "move that thing" + "the report, tomorrow" is update. If Previous+Answer continue a create (recurring pattern, when, unscheduled), keep intent create — not update.
language = primary language of the transcript (uk/en/ru).`;
}

export function buildVoiceRouterUserPrompt(
  input: Pick<
    VoiceParsePromptContext,
    | 'transcript'
    | 'previousTranscript'
    | 'clarificationAnswer'
    | 'openTaskNames'
  >,
): string {
  const clarification = input.clarificationAnswer
    ? `\nPrevious: ${JSON.stringify(input.previousTranscript ?? '')}\nAnswer: ${JSON.stringify(input.clarificationAnswer)}`
    : '';
  return `Open tasks (a title here is a target only when the utterance is about that existing task; a newly stated errand is create even when a title is close in meaning):
${
  input.openTaskNames?.length
    ? input.openTaskNames.map((name) => `- ${JSON.stringify(name)}`).join('\n')
    : '(none)'
}

Transcript: ${JSON.stringify(input.transcript)}${clarification}

Return intent + language JSON.`;
}
