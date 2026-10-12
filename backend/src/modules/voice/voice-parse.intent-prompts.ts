import { buildVoiceClarifySystemPrompt, buildVoiceClarifyUserPrompt } from './voice-parse.clarify.prompt';
import {
  buildVoiceCompleteSystemPrompt,
  buildVoiceCompleteUserPrompt,
} from './voice-parse.complete.prompt';
import {
  buildVoiceCreateSystemPrompt,
  buildVoiceCreateUserPrompt,
} from './voice-parse.create.prompt';
import {
  buildVoiceDeleteSystemPrompt,
  buildVoiceDeleteUserPrompt,
} from './voice-parse.delete.prompt';
import {
  buildVoiceHabitCheckInSystemPrompt,
  buildVoiceHabitCheckInUserPrompt,
} from './voice-parse.habit-check-in.prompt';
import {
  buildVoiceHabitCreateSystemPrompt,
  buildVoiceHabitCreateUserPrompt,
} from './voice-parse.habit-create.prompt';
import {
  buildVoiceHabitDeleteSystemPrompt,
  buildVoiceHabitDeleteUserPrompt,
} from './voice-parse.habit-delete.prompt';
import {
  buildVoiceHabitUncheckSystemPrompt,
  buildVoiceHabitUncheckUserPrompt,
} from './voice-parse.habit-uncheck.prompt';
import {
  buildVoiceHabitUpdateSystemPrompt,
  buildVoiceHabitUpdateUserPrompt,
} from './voice-parse.habit-update.prompt';
import {
  buildVoiceRescheduleSystemPrompt,
  buildVoiceRescheduleUserPrompt,
} from './voice-parse.reschedule.prompt';
import {
  buildVoiceSkipSystemPrompt,
  buildVoiceSkipUserPrompt,
} from './voice-parse.skip.prompt';
import type {
  VoiceParseIntentId,
  VoiceParsePromptContext,
} from './voice-parse.shared.prompt';
import {
  buildVoiceUpdateSystemPrompt,
  buildVoiceUpdateUserPrompt,
} from './voice-parse.update.prompt';

export type VoiceIntentPromptPair = {
  system: string;
  user: string;
};

/**
 * One specialist prompt per intent. Each system string is a single LLM call:
 * schema, a first-match decision list, and the fields the resolver actually reads.
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
      return {
        system: buildVoiceUpdateSystemPrompt(language),
        user: buildVoiceUpdateUserPrompt(ctx),
      };
    case 'delete':
      return {
        system: buildVoiceDeleteSystemPrompt(language),
        user: buildVoiceDeleteUserPrompt(ctx),
      };
    case 'complete':
      return {
        system: buildVoiceCompleteSystemPrompt(language),
        user: buildVoiceCompleteUserPrompt(ctx),
      };
    case 'skip':
      return {
        system: buildVoiceSkipSystemPrompt(language),
        user: buildVoiceSkipUserPrompt(ctx),
      };
    case 'reschedule':
      return {
        system: buildVoiceRescheduleSystemPrompt(language),
        user: buildVoiceRescheduleUserPrompt(ctx),
      };
    case 'habit_check_in':
      return {
        system: buildVoiceHabitCheckInSystemPrompt(language),
        user: buildVoiceHabitCheckInUserPrompt(ctx),
      };
    case 'habit_create':
      return {
        system: buildVoiceHabitCreateSystemPrompt(language),
        user: buildVoiceHabitCreateUserPrompt(ctx),
      };
    case 'habit_update':
      return {
        system: buildVoiceHabitUpdateSystemPrompt(language),
        user: buildVoiceHabitUpdateUserPrompt(ctx),
      };
    case 'habit_delete':
      return {
        system: buildVoiceHabitDeleteSystemPrompt(language),
        user: buildVoiceHabitDeleteUserPrompt(ctx),
      };
    case 'habit_uncheck':
      return {
        system: buildVoiceHabitUncheckSystemPrompt(language),
        user: buildVoiceHabitUncheckUserPrompt(ctx),
      };
    case 'needs_clarification':
      return {
        system: buildVoiceClarifySystemPrompt(language),
        user: buildVoiceClarifyUserPrompt(ctx),
      };
    default:
      return {
        system: buildVoiceClarifySystemPrompt(language),
        user: buildVoiceClarifyUserPrompt(ctx),
      };
  }
}
