import {
  buildWhisperPrompt,
  cleanupVoiceTranscript,
  isNoiseOrEmptyTranscript,
} from './voice-stt.util';

describe('buildWhisperPrompt', () => {
  it('returns uk vocabulary bias', () => {
    expect(buildWhisperPrompt('uk')).toMatch(/створи задачу/);
    expect(buildWhisperPrompt('uk')).toMatch(/завтра/);
  });

  it('returns en vocabulary bias', () => {
    expect(buildWhisperPrompt('en')).toMatch(/create a task/);
  });
});

describe('cleanupVoiceTranscript', () => {
  it('fixes common uk day and create mishits', () => {
    expect(cleanupVoiceTranscript('Створи задачу на завтро з їздити в магазин', 'uk')).toBe(
      "Створи задачу на завтра з'їздити в магазин",
    );
  });

  it('normalizes у другий дня to о другій дня', () => {
    expect(cleanupVoiceTranscript('Завтра, у другий дня, в магазин.', 'uk')).toBe(
      'Завтра, о другій дня, в магазин.',
    );
  });

  it('fixes english tomorrow typo', () => {
    expect(cleanupVoiceTranscript('create a task for tommorow', 'en')).toBe(
      'create a task for tomorrow',
    );
  });
});

describe('isNoiseOrEmptyTranscript', () => {
  it('treats thanks hallucinations as noise', () => {
    expect(isNoiseOrEmptyTranscript('Дякую.')).toBe(true);
    expect(isNoiseOrEmptyTranscript('Thank you')).toBe(true);
    expect(isNoiseOrEmptyTranscript('Thanks for watching!')).toBe(true);
    expect(isNoiseOrEmptyTranscript('Дякую за перегляд!')).toBe(true);
    expect(isNoiseOrEmptyTranscript('дякую за перегляд')).toBe(true);
    expect(isNoiseOrEmptyTranscript('')).toBe(true);
  });

  it('keeps real calendar speech', () => {
    expect(
      isNoiseOrEmptyTranscript("Створи задачу на завтра з'їздити в магазин"),
    ).toBe(false);
    expect(isNoiseOrEmptyTranscript('Завтра, о другій дня, в магазин.')).toBe(
      false,
    );
    expect(isNoiseOrEmptyTranscript('так')).toBe(false);
  });
});
