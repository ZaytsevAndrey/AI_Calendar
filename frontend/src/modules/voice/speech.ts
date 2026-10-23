/**
 * Client TTS for voice replies. The API speaks with Azure when that key
 * is set, otherwise local Piper. The browser voice is the last fallback.
 */
import { VoiceApi } from 'api/voice.api';

export type SpeakOptions = {
  lang?: string;
};

let activeAudio: HTMLAudioElement | null = null;
let activeUrl: string | null = null;

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

function stopPlayback(): void {
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.src = '';
    activeAudio = null;
  }
  if (activeUrl) {
    URL.revokeObjectURL(activeUrl);
    activeUrl = null;
  }
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

function playWav(blob: Blob): Promise<void> {
  stopPlayback();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  activeAudio = audio;
  activeUrl = url;
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (activeUrl === url) {
        URL.revokeObjectURL(url);
        activeUrl = null;
        activeAudio = null;
      }
      resolve();
    };
    audio.onended = finish;
    audio.onerror = finish;
    window.setTimeout(finish, Math.min(60_000, 2_000 + blob.size / 8));
    audio.play().catch(finish);
  });
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
    window.setTimeout(done, 400);
  });
}

function speakWithBrowser(text: string, lang: string): Promise<void> {
  if (typeof window === 'undefined' || !window.speechSynthesis) return Promise.resolve();
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
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
    window.setTimeout(finish, Math.min(20_000, 2_000 + text.length * 90));
    try {
      window.speechSynthesis.speak(utterance);
    } catch {
      finish();
    }
  });
}

export const VoiceSpeech = {
  supported(): boolean {
    return typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined';
  },

  stop(): void {
    stopPlayback();
  },

  /**
   * Speaks `text`. Prefers WAV from the API.
   * Falls back to the browser voice when the API cannot synthesize.
   */
  async speak(text: string, options: SpeakOptions = {}): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || typeof window === 'undefined') return;

    VoiceSpeech.stop();
    const wav = await VoiceApi.speak(trimmed, options.lang);
    if (wav) {
      await playWav(wav);
      return;
    }

    await ensureVoices();
    await speakWithBrowser(trimmed, speechLang(options.lang));
  },
};
