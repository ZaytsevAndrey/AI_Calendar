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
An utterance that states an errand is create. Update, delete, complete, and reschedule are only for a task they are already pointing at. A similar open title is not pointing.
- create: new task / errand (even without "create"/"add"), e.g. "tomorrow to the shop". Also a repeating errand or stretch ("stretch every day", "meditate every day", "dentist every Tuesday"). A verb can be the errand itself when they are not pointing at an open task: "update my resume tomorrow", "delete extra photos from the phone", "close the ticket by end of day", "from now until 18 close all the reviews". That is create, not update, delete, or complete. A new errand stays create even when an open task is close in meaning. That closeness is not pointing at the open task.
- update: change fields on an existing open task (rename, priority, deadline, note, length). A placement of that task (a clock, a part of the day, another day) is reschedule, not update, even when the field change is in another segment. A length on an open task, with no day and no clock, is update, not reschedule.
- delete: permanently delete an existing open task. That stays delete even when a create verb is also present; do not turn the delete into the name of a new task. Deleting photos, files, or other things that are not an open task is a new errand, not delete.
- complete: only a report that an open task is already finished, or an explicit request to mark it done. An imperative to do that task, together with a time or the present moment, is reschedule, never complete. If the name is not in the open list, close / finish / done is a new errand (create), including a batch of work with a time span ("from now until 18 close all the reviews", "close the ticket by end of day").
- skip: skip one occurrence.
- reschedule: move or place a task they are pointing at, at a clock, in a part of the day, or on another day, including an order to do that task at the present moment. Pointing means they refer to that existing task. A newly stated errand is create, even when a clock or a day is attached and even when an open title is close in meaning. Do not pick an open task by similarity. A task just named in this dialogue, and missing from the open list, is still the one they are pointing at.
- needs_clarification: unintelligible or no guessable intent.

Prefer a concrete intent over needs_clarification when possible.
If Previous+Answer are given, the Answer only fills in what Previous was missing: classify the request in Previous. "delete that one" + "milk" is delete; "move that thing" + "the report, tomorrow" is reschedule. If Previous+Answer continue a create (recurring pattern, when, unscheduled), keep intent create — not update.
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
