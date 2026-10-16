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
- create: new task / errand (even without "create"/"add"), e.g. "tomorrow to the shop". Also a repeating errand or stretch ("stretch every day", "meditate every day", "dentist every Tuesday") when they did NOT say habit. A verb can be the errand itself when they are not pointing at an open task: "update my resume tomorrow", "delete extra photos from the phone", "close the ticket by end of day". That is create, not update, delete, or complete.
- update: change fields on an existing open task (rename, priority, deadline of a task in the open list).
- delete: permanently delete an existing open task ("delete the report" when that task is open). Deleting photos, files, or other things is a new errand, not delete.
- complete: mark an existing open task done (done, finished, "close the ticket" when that ticket is in the open list). "close the ticket by end of day" with no open task of that name is a new errand: create, not complete.
- skip: skip one occurrence.
- reschedule: move / do now.
- habit_create: ONLY when they say habit / "create habit" / "new habit". Daily stretch or meditation without that word is create, not habit_create.
- habit_check_in / habit_uncheck / habit_update / habit_delete: other habit management (needs the habit word or an existing habit name).
- needs_clarification: unintelligible or no guessable intent.

Prefer a concrete intent over needs_clarification when possible.
If Previous+Answer continue a create (recurring pattern, when, unscheduled), keep intent create — not update.
language = primary language of the transcript (uk/en/ru).`;
}

export function buildVoiceRouterUserPrompt(
  input: Pick<
    VoiceParsePromptContext,
    | 'transcript'
    | 'previousTranscript'
    | 'clarificationAnswer'
    | 'openTaskNames'
    | 'habitNames'
  >,
): string {
  const clarification = input.clarificationAnswer
    ? `\nPrevious: ${JSON.stringify(input.previousTranscript ?? '')}\nAnswer: ${JSON.stringify(input.clarificationAnswer)}`
    : '';
  return `Open tasks:
${
  input.openTaskNames?.length
    ? input.openTaskNames.map((name) => `- ${JSON.stringify(name)}`).join('\n')
    : '(none)'
}

Habits:
${
  input.habitNames?.length
    ? input.habitNames.map((name) => `- ${JSON.stringify(name)}`).join('\n')
    : '(none)'
}

Transcript: ${JSON.stringify(input.transcript)}${clarification}

Return intent + language JSON.`;
}
