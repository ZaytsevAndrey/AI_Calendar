import { TASK_TARGET_MODULE } from './prompt-modules/task-target';
import {
  buildVoiceParseSharedUserPrompt,
  languageInstruction,
  type VoiceParsePromptContext,
} from './voice-parse.shared.prompt';

const SKIP_SCHEMA = `{
  "intent": "skip",
  "understanding": "complete" | "needs_clarification",
  "clarifyingQuestion": string | null,
  "command": {
    "target": "current" | "named",
    "taskName": string | null
  },
  "task": null,
  "habit": null
}`;

const SKIP_RULES = `Skip drops one occurrence. First match wins.
1. They named another day or a later occurrence ("on Friday", "tomorrow", "next time") → needs_clarification, one question that skip only drops the next open time. Do not pretend to skip that day. start and end do not exist on this intent.
2. They want the whole series gone → needs_clarification, one question that skip is this day only. Delete is the intent that asks this day, this and following, or the whole series. Do not output a delete.
3. Otherwise follow Target and return the task. No dates.

What the app does. Do not encode it yourself.
- The occurrence happening now, or the next open one. There is no date field.
- An unscheduled task is still skip. The app cancels that inbox task. Do not output delete.
- A fixed event cannot be skipped. Still name the task; the app refuses. A move is a separate update.

Do not invent a day, a time, or a confirmation question.

Examples:
- "skip the report" → named, taskName from Open tasks, no dates
- "skip this" → current, taskName null
- "skip the report on Friday" → needs_clarification`;

/** Specialist: skip the next open occurrence. Unscheduled becomes cancel in the resolver. */
export function buildVoiceSkipSystemPrompt(language?: string | null): string {
  return [
    'You skip ONE occurrence of an EXISTING app task. Do not create, delete, or reschedule it.',
    languageInstruction(language),
    'Reply with a single JSON object only. No markdown.',
    SKIP_SCHEMA,
    SKIP_RULES,
    TASK_TARGET_MODULE,
  ].join('\n\n');
}

export function buildVoiceSkipUserPrompt(input: VoiceParsePromptContext): string {
  return `${buildVoiceParseSharedUserPrompt(input, { includePhases: false })}

Return skip JSON (target only). No dates.`;
}
