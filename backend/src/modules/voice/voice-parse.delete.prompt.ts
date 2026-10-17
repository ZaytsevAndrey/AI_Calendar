import { SERIES_SCOPE_MODULE } from './prompt-modules/series-scope';
import { TASK_TARGET_MODULE } from './prompt-modules/task-target';
import {
  buildVoiceParseSharedUserPrompt,
  languageInstruction,
  type VoiceParsePromptContext,
} from './voice-parse.shared.prompt';

const DELETE_SCHEMA = `{
  "intent": "delete",
  "understanding": "complete" | "needs_clarification",
  "clarifyingQuestion": string | null,
  "command": {
    "target": "current" | "named",
    "taskName": string | null,
    "seriesScope": "occurrence" | "series" | "all" | null
  },
  "task": null,
  "habit": null
}`;

const DELETE_RULES = `Delete removes a task. Follow Target. No dates, no patch, no new name.
Do not ask "are you sure". The app asks before it deletes.
Do not invent a task or a replacement.

Examples:
- "delete the report" and the line is not recurring → named, taskName from Open tasks, omit seriesScope
- "delete this" → current, taskName null
- "delete gym" and the line says recurring, with no day or series → omit seriesScope and ask
- "delete the whole gym series" → seriesScope "all"`;

/** Specialist: identify a task to delete. Confirm stays on the orchestrator. */
export function buildVoiceDeleteSystemPrompt(language?: string | null): string {
  return [
    'You choose an EXISTING app task to delete. Do not create a task and do not edit fields.',
    languageInstruction(language),
    'Reply with a single JSON object only. No markdown.',
    DELETE_SCHEMA,
    DELETE_RULES,
    SERIES_SCOPE_MODULE,
    TASK_TARGET_MODULE,
  ].join('\n\n');
}

export function buildVoiceDeleteUserPrompt(input: VoiceParsePromptContext): string {
  return `${buildVoiceParseSharedUserPrompt(input, { includePhases: false })}

Return delete JSON (target only).`;
}
