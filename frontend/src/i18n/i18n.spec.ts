import i18n, { detectBrowserLanguage, isAppLanguage } from './index';

describe('frontend i18n', () => {
  it('recognizes app languages', () => {
    expect(isAppLanguage('en')).toBe(true);
    expect(isAppLanguage('uk')).toBe(true);
    expect(isAppLanguage('de')).toBe(false);
  });

  it('falls back to English for unknown browser tags', () => {
    expect(detectBrowserLanguage()).toMatch(/^(en|uk)$/);
  });

  it('returns Ukrainian nav labels', async () => {
    await i18n.changeLanguage('uk');
    expect(i18n.t('nav.calendar')).toBe('Календар');
    expect(i18n.t('settings.language')).toBe('Мова');
  });

  it('returns English nav labels', async () => {
    await i18n.changeLanguage('en');
    expect(i18n.t('nav.calendar')).toBe('Calendar');
  });
});
