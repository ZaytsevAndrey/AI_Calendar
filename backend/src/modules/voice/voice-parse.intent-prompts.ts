import {
  buildVoiceParseSharedUserPrompt,
  languageInstruction,
  type VoiceParseIntentId,
  type VoiceParsePromptContext,
} from './voice-parse.shared.prompt';
import {
  buildVoiceCreateSystemPrompt,
  buildVoiceCreateUserPrompt,
} from './voice-parse.create.prompt';

export type VoiceIntentPromptPair = {
  system: string;
  user: string;
};

/**
 * Specialist prompts per intent. Create is fully specified; others are lean
 * stubs that still return the JSON resolveVoiceCommand expects. Expand stubs
 * when a family needs richer fields.
 */
export function buildVoiceIntentPrompt(
  intent: VoiceParseIntentId,
  ctx: VoiceParsePromptContext,
): VoiceIntentPromptPair {
  const language = ctx.language;
  switch (intent) {
    case 'create':
      return {
        system: buildVoiceCreateSystemPrompt(language),
        user: buildVoiceCreateUserPrompt(ctx),
      };
    case 'update':
      return stub(intent, language, ctx, UPDATE_RULES);
    case 'delete':
      return stub(intent, language, ctx, DELETE_RULES);
    case 'complete':
      return stub(intent, language, ctx, COMPLETE_RULES);
    case 'skip':
      return stub(intent, language, ctx, SKIP_RULES);
    case 'reschedule':
      return stub(intent, language, ctx, RESCHEDULE_RULES);
    case 'habit_check_in':
      return stub(intent, language, ctx, HABIT_CHECK_IN_RULES);
    case 'habit_create':
      return stub(intent, language, ctx, HABIT_CREATE_RULES);
    case 'habit_update':
      return stub(intent, language, ctx, HABIT_UPDATE_RULES);
    case 'habit_delete':
      return stub(intent, language, ctx, HABIT_DELETE_RULES);
    case 'habit_uncheck':
      return stub(intent, language, ctx, HABIT_UNCHECK_RULES);
    case 'needs_clarification':
      return stub(intent, language, ctx, CLARIFY_RULES);
    default:
      return stub('needs_clarification', language, ctx, CLARIFY_RULES);
  }
}

function stub(
  intent: VoiceParseIntentId,
  language: string | undefined,
  ctx: VoiceParsePromptContext,
  rules: string,
): VoiceIntentPromptPair {
  return {
    system: `You interpret a spoken calendar "${intent}" request.
${languageInstruction(language)}
Reply with a single JSON object only. No markdown.

{
  "intent": "${intent}",
  "understanding": "complete" | "needs_clarification",
  "clarifyingQuestion": string | null,
  "command": {
    "target": "current" | "named",
    "taskName": string | null,
    "newName": string | null,
    "rename": boolean | null,
    "status": "todo" | "in_progress" | "completed" | "canceled" | null,
    "start": string | null,
    "end": string | null
  } | null,
  "habit": {
    "name": string | null,
    "color": string | null,
    "description": string | null,
    "blockStartTime": string | null,
    "blockMinutes": number | null
  } | null,
  "task": { } | null
}

${rules}

Native Google meetings are not app tasks — clarify which app task, in the transcript language.
Dates/times: ISO-8601 with offset from Local calendar. Never invent a new create task here.`,
    user: `${buildVoiceParseSharedUserPrompt(ctx, { includePhases: true })}

Return ${intent} JSON.`,
  };
}

const UPDATE_RULES = `Update rules:
- command.taskName = existing task (from open tasks when possible).
- Put ONLY changed fields into task (name via command.newName/rename, duration, phaseId, priority, status, description, recurrence, schedule fields, Google metadata if asked).
- status "todo" for reopen.`;

const DELETE_RULES = `Delete rules:
- command.taskName identifies the task. Leave task null or minimal.
- If no target → needs_clarification asking which task.`;

const COMPLETE_RULES = `Complete rules:
- Mark an existing task done. command.taskName or target current.
- Repeating tasks still use complete (app skips today's occurrence).`;

const SKIP_RULES = `Skip rules:
- Skip one occurrence. command.taskName or target current.
- Unscheduled skip cancels the task (resolver handles).`;

const RESCHEDULE_RULES = `Reschedule rules:
- Move / do now. command.start = new start ISO with offset; command.end only for an explicit clock range.
- Day with no clock: start 00:00 and end 23:59 of that schedule day.
- "do now" / "зроби зараз": still intent reschedule; start can be now ISO.`;

const HABIT_CHECK_IN_RULES = `Habit check-in:
- command.taskName = habit title from habits list when possible.`;

const HABIT_CREATE_RULES = `Habit create:
- habit.name required (or command.taskName). Optional color (#rrggbb), description, blockStartTime HH:mm + blockMinutes.
- Missing name → needs_clarification.`;

const HABIT_UPDATE_RULES = `Habit update:
- command.taskName = existing habit; changed fields in habit.* (habit.name when renaming).`;

const HABIT_DELETE_RULES = `Habit delete:
- command.taskName = habit to delete.`;

const HABIT_UNCHECK_RULES = `Habit uncheck:
- Clear today's check-in. command.taskName = habit title.`;

const CLARIFY_RULES = `Clarification:
- Ask ONE short clarifyingQuestion in the transcript language.
- Prefer guessing a concrete intent when possible; use this only when truly unclear.`;
