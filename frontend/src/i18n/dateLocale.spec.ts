import i18n from 'i18n';
import { appLanguage, dateFnsLocale, intlLocale } from './dateLocale';
import { uk } from 'date-fns/locale';

describe('dateLocale', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('maps uk language to Ukrainian date locales', async () => {
    await i18n.changeLanguage('uk');
    expect(appLanguage()).toBe('uk');
    expect(dateFnsLocale()).toBe(uk);
    expect(intlLocale()).toBe('uk-UA');
  });

  it('defaults to English locales', async () => {
    await i18n.changeLanguage('en');
    expect(appLanguage()).toBe('en');
    expect(intlLocale()).toBe('en-GB');
  });
});
