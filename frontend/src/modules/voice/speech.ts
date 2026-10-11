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

function scoreVoice(voice: SpeechSynthesisVoice, lang: string): number {
  const vLang = voice.lang.toLowerCase();
  const want = lang.toLowerCase();
  const prefix = want.slice(0, 2);
  let score = 0;
  if (vLang === want) score += 100;
  else if (vLang.startsWith(prefix)) score += 60;
  else return -1;
  const name = voice.name.toLowerCase();
  if (/(neural|natural|premium|enhanced|online)/.test(name)) score += 25;
  if (voice.localService) score += 10;
  // Prefer female/clear voices lightly when names are generic — skip gender bias.
  if (/microsoft|google|apple/.test(name)) score += 5;
  return score;
}

function pickVoice(lang: string): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  let best: SpeechSynthesisVoice | null = null;
  let bestScore = -1;
  for (const voice of voices) {
    const score = scoreVoice(voice, lang);
    if (score > bestScore) {
      bestScore = score;
      best = voice;
    }
  }
  return best;
}

function ensureVoices(): Promise<void> {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    return Promise.resolve();
  }
  const existing = window.speechSynthesis.getVoices();
  if (existing.length) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', done);
      resolve();
    };
    window.speechSynthesis.addEventListener('voiceschanged', done);
    // Chrome sometimes populates sync after a tick.
    window.setTimeout(done, 400);
  });
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
  async speak(text: string, options: SpeakOptions = {}): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || !VoiceSpeech.supported()) return;

    VoiceSpeech.stop();
    await ensureVoices();

    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(trimmed);
      const lang = speechLang(options.lang);
      utterance.lang = lang;
      utterance.rate = 0.92;
      utterance.pitch = 1;
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
      window.setTimeout(finish, Math.min(20_000, 2_000 + trimmed.length * 90));

      try {
        window.speechSynthesis.speak(utterance);
      } catch {
        finish();
      }
    });
  },
};
