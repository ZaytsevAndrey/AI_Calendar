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

const COMPLETE_RULES = `Who is done. First match wins.
1. The title is in Habits and not in Open tasks → command.target "named", command.taskName that habit title. The app checks the habit in for today. Do not invent a task. Do not output a date.
2. Otherwise it is an app task. Follow Target.

What the app does with a task. Do not encode it yourself.
- A one-off task is marked completed. Do not set status, start, or end. Omit seriesScope.
- A repeating task uses seriesScope. occurrence skips today's open occurrence. series ends the series from this day. all marks the whole series done.
- If both an Open task and a Habit share the title, the task wins.

Do not invent a task, a time, or a confirmation question. The app asks before it writes.
Clarify only when branch 2 has no task to point at.

Examples:
- "finished the report" and Open tasks has "Report" → named, taskName "Report"
- "done" with no title → current, taskName null
- "did the water habit" and only Habits has "Water" → named, taskName "Water"`;

/** Specialist: mark a task done, or check in a habit when no task matches. */
export function buildVoiceCompleteSystemPrompt(language?: string | null): string {
  return [
    'You mark an EXISTING app task done. Do not create a task and do not edit its fields.',
    languageInstruction(language),
    'Reply with a single JSON object only. No markdown.',
    COMPLETE_SCHEMA,
    COMPLETE_RULES,
    SERIES_SCOPE_MODULE,
    TASK_TARGET_MODULE,
    'If Who is done already matched a habit, keep that habit title. Do not ask which task.',
  ].join('\n\n');
}

export function buildVoiceCompleteUserPrompt(input: VoiceParsePromptContext): string {
  return `${buildVoiceParseSharedUserPrompt(input, { includePhases: false })}

Return complete JSON (target only).`;
}
