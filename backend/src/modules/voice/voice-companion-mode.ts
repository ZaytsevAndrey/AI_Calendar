export const VOICE_COMPANION_MODES = ['assistant', 'fast_create'] as const;

export type VoiceCompanionMode = (typeof VOICE_COMPANION_MODES)[number];

/** Missing or unknown values stay on the dialogue path. */
export function voiceCompanionMode(value: unknown): VoiceCompanionMode {
  return value === 'fast_create' ? 'fast_create' : 'assistant';
}
