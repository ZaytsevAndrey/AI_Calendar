import {
  buildVoiceParseSharedUserPrompt,
  languageInstruction,
  type VoiceParsePromptContext,
} from './voice-parse.shared.prompt';

/** Specialist: move / do-now / day window. Resolver reads command.start and command.end only. */
export function buildVoiceRescheduleSystemPrompt(language?: string | null): string {
  return `You move an EXISTING app task. Do not create a task and do not edit its name, phase, or priority.
${languageInstruction(language)}
Reply with a single JSON object only. No markdown.

{
  "intent": "reschedule",
  "understanding": "complete" | "needs_clarification",
  "clarifyingQuestion": string | null,
  "command": {
    "target": "current" | "named",
    "taskName": string | null,
    "start": string | null,
    "end": string | null
  },
  "task": null,
  "habit": null
}

Target:
- Named task: command.target "named" and command.taskName copied from Open tasks.
- Current / this / it / зараз / цю, with no name: command.target "current", taskName null.
- No task you can point at: understanding needs_clarification, one short question which task. start and end null.

When (ISO-8601 with the numeric offset from Local calendar; copy schedule today/tomorrow, including after sleep):
- Clock or "in N hours": command.start at that instant. command.end only when they named an end ("until 4", "до 16:00"). Otherwise end null — duration stays as it is.
- Day with no clock ("tomorrow", "завтра", "on Friday"): command.start 00:00 and command.end 23:59 on that schedule day. That pair means a day window, not midnight.
- "do now" / "schedule it now" / "зроби зараз" / "заплануй зараз" / "сделай сейчас": command.start = now ISO, command.end null.
- No day and no clock and not do-now: needs_clarification, one question when. Do not invent a day.

Leave task null. Times belong on command.start and command.end only.`;
}

export function buildVoiceRescheduleUserPrompt(
  input: VoiceParsePromptContext,
): string {
  return `${buildVoiceParseSharedUserPrompt(input, { includePhases: false })}

Return reschedule JSON (target + start/end).`;
}
