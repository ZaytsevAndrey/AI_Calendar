import { enGB, uk } from 'date-fns/locale';
import type { Locale } from 'date-fns';
import i18n from 'i18n';

export function appLanguage(): 'en' | 'uk' {
  return i18n.language === 'uk' ? 'uk' : 'en';
}

/** date-fns locale for user-visible weekday/month names. */
export function dateFnsLocale(): Locale {
  return appLanguage() === 'uk' ? uk : enGB;
}

export function dateFnsOptions(): { locale: Locale } {
  return { locale: dateFnsLocale() };
}

/** Intl BCP 47 tag for toLocaleDateString / toLocaleTimeString. */
export function intlLocale(): string {
  return appLanguage() === 'uk' ? 'uk-UA' : 'en-GB';
}
