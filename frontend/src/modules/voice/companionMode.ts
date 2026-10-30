export type CompanionVoiceMode = 'assistant' | 'fast_create';

export const COMPANION_VOICE_MODE_KEY = 'companion-voice-mode';

/**
 * The structured engine accepts `mode` but does not act on it yet (VR-30), so the
 * switch is hidden and every turn runs as the assistant (D-05). The stored choice
 * is kept so that enabling this flag restores it without a contract change.
 */
export const FAST_CREATE_AVAILABLE = false;

export function loadCompanionVoiceMode(): CompanionVoiceMode {
  if (!FAST_CREATE_AVAILABLE) return 'assistant';
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
