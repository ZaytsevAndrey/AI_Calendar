/**
 * Voice parse prompts — split into router + per-intent specialists.
 * Prefer importing from the dedicated modules; these re-exports keep older call sites working.
 */
export {
  buildVoiceRouterSystemPrompt,
  buildVoiceRouterUserPrompt,
} from './voice-parse.router.prompt';
export {
  buildVoiceCreateSystemPrompt,
  buildVoiceCreateUserPrompt,
} from './voice-parse.create.prompt';
export { buildVoiceIntentPrompt } from './voice-parse.intent-prompts';
export {
  buildVoiceParseSharedUserPrompt,
  VOICE_PARSE_INTENTS,
  type VoiceParseIntentId,
  type VoiceParsePromptContext,
} from './voice-parse.shared.prompt';

/** @deprecated Use router + buildVoiceIntentPrompt. Kept for tests that still import the old names. */
export {
  buildVoiceCreateSystemPrompt as buildVoiceParseSystemPrompt,
  buildVoiceCreateUserPrompt as buildVoiceParseUserPrompt,
} from './voice-parse.create.prompt';
