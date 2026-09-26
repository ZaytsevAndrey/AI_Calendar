import { resolveAppLanguage } from './resolve-language';
import { t } from './t';

describe('i18n t()', () => {
  it('interpolates English push titles', () => {
    expect(t('en', 'push.startingIn', { minutes: 20 })).toBe('Starting in 20 min');
    expect(t('en', 'push.habitIn', { minutes: 5 })).toBe('Habit in 5 min');
    expect(t('en', 'push.habits')).toBe('Habits');
  });

  it('interpolates Ukrainian push titles', () => {
    expect(t('uk', 'push.startingIn', { minutes: 20 })).toBe(
      'Починається за 20 хв',
    );
    expect(t('uk', 'push.habitIn', { minutes: 5 })).toBe('Звичка за 5 хв');
    expect(t('uk', 'push.habits')).toBe('Звички');
  });
});

describe('resolveAppLanguage', () => {
  it('prefers settings over Accept-Language', () => {
    expect(
      resolveAppLanguage({
        settingsLanguage: 'uk',
        acceptLanguage: 'en-US,en;q=0.9',
      }),
    ).toBe('uk');
  });

  it('uses Accept-Language when settings are missing', () => {
    expect(
      resolveAppLanguage({
        settingsLanguage: null,
        acceptLanguage: 'uk-UA,uk;q=0.9,en;q=0.8',
      }),
    ).toBe('uk');
  });

  it('defaults to English', () => {
    expect(resolveAppLanguage({})).toBe('en');
  });
});
