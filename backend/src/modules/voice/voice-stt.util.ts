/**
 * Whisper style prompt (same language as the audio). Biases spelling of
 * calendar vocabulary without instructing the model to invent content.
 */
export function buildWhisperPrompt(language?: string | null): string | undefined {
  const lang = (language || '').trim().toLowerCase().slice(0, 2);
  if (lang === 'uk') {
    return [
      'Голосовий календар українською.',
      'Типові фрази: створи задачу, додай задачу, на завтра, на сьогодні, післязавтра,',
      "з'їздити в магазин, на другу дня, о третій, звичка, пропусти, перенеси, зроби зараз.",
      'Якщо чути лише шум або тишу — залиш розпізнаний текст порожнім; не пиши «дякую» чи «дякую за перегляд».',
    ].join(' ');
  }
  if (lang === 'ru') {
    return [
      'Голосовой календарь на русском.',
      'Типичные фразы: создай задачу, добавь задачу, на завтра, на сегодня, послезавтра,',
      'съездить в магазин, в два часа дня, привычка, пропусти, перенеси, сделай сейчас.',
      'Если слышен только шум или тишина — оставь текст пустым; не пиши «спасибо» или «спасибо за просмотр».',
    ].join(' ');
  }
  if (lang === 'en') {
    return [
      'Voice calendar assistant in English.',
      'Common phrases: create a task, add a task, tomorrow, today, day after tomorrow,',
      'go to the store, at 2 pm, habit, skip, move, do now.',
      'If the audio is only noise or silence, leave the transcript empty; do not write "thank you" or "thanks for watching".',
    ].join(' ');
  }
  return undefined;
}

/**
 * Whisper often hallucinates thanks / outro lines on silence or room noise.
 * True when the transcript has no actionable calendar content.
 */
export function isNoiseOrEmptyTranscript(raw: string): boolean {
  const text = raw
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[’']/g, "'");
  if (!text) return true;

  const stripped = text
    .replace(/[.!?,;:…·•\-–—'"«»()[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!stripped) return true;

  // Single filler token / very short non-command.
  if (stripped.length <= 2) return true;

  const noiseExact = new Set([
    'дякую',
    'дякую дуже',
    'дуже дякую',
    'дякую за перегляд',
    'дякую за перегляд!',
    'спасибі',
    'спасибо',
    'спасибо за просмотр',
    'благодарю',
    'thanks',
    'thank you',
    'thank you.',
    'thanks.',
    'thanks for watching',
    'thank you for watching',
    'thanks for listening',
    'thank you for listening',
    'please subscribe',
    'subscribe',
    'music',
    'applause',
    'silence',
    'you',
    'bye',
    'goodbye',
    'до побачення',
    'пока',
    'мм',
    'мгм',
    'угу',
    'ага',
    'hmm',
    'hm',
    'uh',
    'um',
    'uh huh',
    'продолжение следует',
    'субтитры создавал dimatorzok',
    'редактор субтитров',
  ]);
  if (noiseExact.has(stripped)) return true;

  // Outro / watermark patterns (Whisper favorites on empty audio).
  // Do not use JS \b after Cyrillic — \b only matches ASCII word edges.
  if (
    /^(?:thanks|thank you|дякую|спасибо|спасибі)(?:\s+\S+){0,5}$/iu.test(
      stripped,
    )
  ) {
    return true;
  }
  if (
    /thanks for watching|thank you for watching|дякую\s+за\s+перегляд|спасибо\s+за\s+просмотр|продолжение следует|субтитр/i.test(
      stripped,
    )
  ) {
    return true;
  }
  if (/^\[?(music|applause|silence|шум|тиша)\]?$/i.test(stripped)) {
    return true;
  }

  return false;
}

/**
 * Light cleanup of common STT mishits for calendar speech (esp. Ukrainian).
 * Keep conservative — only high-confidence substitutions.
 */
export function cleanupVoiceTranscript(raw: string, language?: string | null): string {
  let text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return text;

  const lang = (language || '').trim().toLowerCase().slice(0, 2);

  // Normalize curly / spacing apostrophes in Ukrainian words.
  text = text.replace(/[’ʻʼ]/g, "'");

  // JS \b does not treat Cyrillic as word chars — use \p{L} edges.
  if (lang === 'uk' || lang === 'ru' || !lang) {
    text = text
      .replace(/(?<!\p{L})завтро(?!\p{L})/giu, 'завтра')
      .replace(/(?<!\p{L})завтраа(?!\p{L})/giu, 'завтра')
      .replace(/(?<!\p{L})сьог[оа]дня(?!\p{L})/giu, 'сьогодні')
      .replace(/(?<!\p{L})після\s*завтр[оа](?!\p{L})/giu, 'післязавтра')
      .replace(/(?<!\p{L})после\s*завтр[оа](?!\p{L})/giu, 'послезавтра')
      .replace(/(?<!\p{L})створі(?!\p{L})/giu, 'створи')
      .replace(/(?<!\p{L})додайті(?!\p{L})/giu, 'додай')
      .replace(/(?<!\p{L})з\s*їздити(?!\p{L})/giu, "з'їздити")
      .replace(/(?<!\p{L})зиздити(?!\p{L})/giu, "з'їздити")
      .replace(/(?<!\p{L})на\s+другу\s+дн[іия](?!\p{L})/giu, 'на другу дня')
      .replace(/(?<!\p{L})у\s+друг[иій]+\s+дн[іия](?!\p{L})/giu, 'о другій дня')
      .replace(/(?<!\p{L})о\s+трет[іийя]+(?!\p{L})/giu, 'о третій');
  }

  if (lang === 'en' || !lang) {
    text = text
      .replace(/\btommorow\b/gi, 'tomorrow')
      .replace(/\btomorroww\b/gi, 'tomorrow')
      .replace(/\btodya\b/gi, 'today');
  }

  return text.replace(/\s+/g, ' ').trim();
}

/**
 * A bare confirmation or refusal, as the whole utterance, in the two product languages.
 * This is a control for an open preview (the spoken Apply / Cancel button, D-10), not an
 * interpretation of speech: it fires only on these exact words with nothing else said, so the
 * no-lexical-crutches rule is respected — anything longer still goes to the model.
 */
const SPOKEN_CONFIRM = new Set(['так', 'да', 'добре', 'гаразд', 'ок', 'окей', 'підтверджую', 'застосуй', 'застосувати', 'yes', 'yeah', 'yep', 'ok', 'okay', 'confirm', 'apply', 'sure']);
const SPOKEN_CANCEL = new Set(['ні', 'нет', 'скасуй', 'скасувати', 'відміна', 'відмінити', 'no', 'nope', 'cancel', 'stop']);

export function spokenControl(raw: string): 'confirm' | 'cancel' | null {
  const words = raw
    .toLocaleLowerCase()
    .replace(/[.!?,;:…·•\-–—'"«»()[\]]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0 || words.length > 2) return null;
  // "так так" or "ні ні" is still one answer; two different words are speech.
  if (new Set(words).size !== 1) return null;
  if (SPOKEN_CONFIRM.has(words[0])) return 'confirm';
  if (SPOKEN_CANCEL.has(words[0])) return 'cancel';
  return null;
}
