import { APP_LANGUAGES, isAppLanguage, type AppLanguage } from './types';

/** Prefer stored settings, then Accept-Language, then English. */
export function resolveAppLanguage(input: {
  settingsLanguage?: string | null;
  acceptLanguage?: string | null;
}): AppLanguage {
  if (isAppLanguage(input.settingsLanguage)) return input.settingsLanguage;
  const header = input.acceptLanguage?.trim();
  if (!header) return 'en';
  for (const part of header.split(',')) {
    const tag = part.trim().split(';')[0]?.trim().toLowerCase();
    if (!tag) continue;
    if (tag === 'uk' || tag.startsWith('uk-')) return 'uk';
    if (tag === 'en' || tag.startsWith('en-')) return 'en';
  }
  return 'en';
}

export function languageDisplayName(lang: AppLanguage): string {
  return lang === 'uk' ? 'Ukrainian' : 'English';
}

export { APP_LANGUAGES };
