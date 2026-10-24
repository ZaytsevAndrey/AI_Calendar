import {
  VOICE_PARSE_INTENTS,
  type VoiceParsePromptContext,
} from './voice-parse.shared.prompt';

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
- create: new task / errand (even without "create"/"add"), e.g. "tomorrow to the shop". Also a repeating errand or stretch ("stretch every day", "meditate every day", "dentist every Tuesday"). A verb can be the errand itself when they are not pointing at an open task: "update my resume tomorrow", "delete extra photos from the phone", "close the ticket by end of day", "from now until 18 close all the reviews". That is create, not update or delete. A new errand stays create even when an open task is close in meaning. That closeness is not pointing at the open task. A bill or an unsubscribe without a remind word is still create.
- remind: a day reminder, not a task and not a slot. They said нагадай, напомни, remind me, постав нагадування, or поставь напоминание. Also done, a change, or a delete that names an open reminder. A clock in that phrase is the reminder time, not a calendar slot. Without a remind word, and without naming an open reminder, keep create, update, delete, or skip.
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
    | 'openReminders'
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

Open reminders (done, change, or delete of one of these is remind, not a task):
${
  input.openReminders?.length
    ? input.openReminders.map((row) => `- ${JSON.stringify(row.name)}`).join('\n')
    : '(none)'
}

Transcript: ${JSON.stringify(input.transcript)}${clarification}

Return intent + language JSON.`;
}
