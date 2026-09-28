/**
 * Client TTS for voice replies. Web Speech Synthesis today; swap the body later for server TTS.
 */

export type SpeakOptions = {
  lang?: string;
};

function speechLang(lang?: string): string {
  const normalized = (lang || 'en').toLowerCase();
  if (normalized.startsWith('uk')) return 'uk-UA';
  if (normalized.startsWith('ru')) return 'ru-RU';
  return 'en-US';
}

function pickVoice(lang: string): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const prefix = lang.slice(0, 2).toLowerCase();
  return (
    voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase()) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(prefix)) ||
    null
  );
}

export const VoiceSpeech = {
  supported(): boolean {
    return typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined';
  },

  stop(): void {
    if (!VoiceSpeech.supported()) return;
    window.speechSynthesis.cancel();
  },

  /**
   * Speaks `text` when synthesis is available. Resolves when utterance ends or after a timeout.
   * Silent no-op when unsupported or empty.
   */
  speak(text: string, options: SpeakOptions = {}): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || !VoiceSpeech.supported()) return Promise.resolve();

    VoiceSpeech.stop();

    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(trimmed);
      const lang = speechLang(options.lang);
      utterance.lang = lang;
      const voice = pickVoice(lang);
      if (voice) utterance.voice = voice;

      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      utterance.onend = finish;
      utterance.onerror = finish;
      // Some browsers never fire end; do not hang the sheet forever.
      window.setTimeout(finish, Math.min(20_000, 2_000 + trimmed.length * 80));

      try {
        window.speechSynthesis.speak(utterance);
      } catch {
        finish();
      }
    });
  },
};
