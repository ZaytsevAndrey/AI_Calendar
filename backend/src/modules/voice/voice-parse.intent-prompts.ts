import { buildVoiceClarifySystemPrompt, buildVoiceClarifyUserPrompt } from './voice-parse.clarify.prompt';
import {
  buildVoiceCreateSystemPrompt,
  buildVoiceCreateUserPrompt,
} from './voice-parse.create.prompt';
import {
  buildVoiceDeleteSystemPrompt,
  buildVoiceDeleteUserPrompt,
} from './voice-parse.delete.prompt';
import {
  buildVoiceSkipSystemPrompt,
  buildVoiceSkipUserPrompt,
} from './voice-parse.skip.prompt';
import type {
  VoiceParseIntentId,
  VoiceParsePromptContext,
} from './voice-parse.shared.prompt';
import {
  buildVoiceRemindSystemPrompt,
  buildVoiceRemindUserPrompt,
} from './voice-parse.remind.prompt';
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
        system: buildVoiceCreateSystemPrompt(language, ctx.mode),
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
    case 'skip':
      return {
        system: buildVoiceSkipSystemPrompt(language),
        user: buildVoiceSkipUserPrompt(ctx),
      };
    case 'remind':
      return {
        system: buildVoiceRemindSystemPrompt(language),
        user: buildVoiceRemindUserPrompt(ctx),
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
