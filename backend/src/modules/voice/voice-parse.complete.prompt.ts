import { SERIES_SCOPE_MODULE } from './prompt-modules/series-scope';
import { TASK_TARGET_MODULE } from './prompt-modules/task-target';
import {
  buildVoiceParseSharedUserPrompt,
  languageInstruction,
  type VoiceParsePromptContext,
} from './voice-parse.shared.prompt';

const COMPLETE_SCHEMA = `{
  "intent": "complete",
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

const COMPLETE_RULES = `Who is done — an app task from Open tasks. Follow Target.

What the app does with a task. Do not encode it yourself.
- A one-off task is marked completed. Do not set status, start, or end. Omit seriesScope.
- A repeating task uses seriesScope. occurrence skips today's open occurrence. series ends the series from this day. all marks the whole series done.

Do not invent a task, a time, or a confirmation question. The app asks before it writes.
Clarify only when there is no open task to point at.

Examples:
- "finished the report" and Open tasks has "Report" → named, taskName "Report"
- "done" with no title → current, taskName null`;

/** Specialist: mark an existing app task done. */
export function buildVoiceCompleteSystemPrompt(language?: string | null): string {
  return [
    'You mark an EXISTING app task done. Do not create a task and do not edit its fields.',
    languageInstruction(language),
    'Reply with a single JSON object only. No markdown.',
    COMPLETE_SCHEMA,
    COMPLETE_RULES,
    SERIES_SCOPE_MODULE,
    TASK_TARGET_MODULE,
  ].join('\n\n');
}

export function buildVoiceCompleteUserPrompt(input: VoiceParsePromptContext): string {
  return `${buildVoiceParseSharedUserPrompt(input, { includePhases: false })}

Return complete JSON (target only).`;
}
