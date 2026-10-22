export type CompanionVoiceMode = 'assistant' | 'fast_create';

export const COMPANION_VOICE_MODE_KEY = 'companion-voice-mode';

export function loadCompanionVoiceMode(): CompanionVoiceMode {
  try {
    return window.localStorage.getItem(COMPANION_VOICE_MODE_KEY) === 'fast_create'
      ? 'fast_create'
      : 'assistant';
  } catch {
    return 'assistant';
  }
}

export function saveCompanionVoiceMode(mode: CompanionVoiceMode): void {
  try {
    window.localStorage.setItem(COMPANION_VOICE_MODE_KEY, mode);
  } catch {
    // Private mode: the switch still works until the panel closes.
  }
}
