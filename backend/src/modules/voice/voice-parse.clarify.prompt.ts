import { QUESTION_PROPOSAL_MODULE } from './prompt-modules/question-proposal';
import {
  buildVoiceParseSharedUserPrompt,
  languageInstruction,
  type VoiceParsePromptContext,
} from './voice-parse.shared.prompt';

const CLARIFY_SCHEMA = `{
  "intent": "needs_clarification",
  "understanding": "needs_clarification",
  "clarifyingQuestion": string,
  "task": null,
  "command": null,
  "habit": null
}`;

const CLARIFY_RULES = `Ask one short question. First match wins.
1. One action is clear and one fact is missing (which task, what to change, when) → ask for that fact.
2. Otherwise ask what they want to do.

Do not invent a name, a time, or a task. task stays null. The server creates a task if you supply a name, so leave the name out.
Do not answer the question yourself. Do not list more than one question.
${QUESTION_PROPOSAL_MODULE}`;

/** Specialist: one clarifying question. Must not produce a task the create normalizer would save. */
export function buildVoiceClarifySystemPrompt(language?: string | null): string {
  return [
    'You do not understand the utterance well enough to act. Ask one question. Do not perform the action.',
    languageInstruction(language),
    'Reply with a single JSON object only. No markdown.',
    CLARIFY_SCHEMA,
    CLARIFY_RULES,
  ].join('\n\n');
}

export function buildVoiceClarifyUserPrompt(input: VoiceParsePromptContext): string {
  return `${buildVoiceParseSharedUserPrompt(input, { includePhases: false })}

Return needs_clarification JSON. task null.`;
}
