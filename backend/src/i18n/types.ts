export const APP_LANGUAGES = ['en', 'uk'] as const;

export type AppLanguage = (typeof APP_LANGUAGES)[number];

export function isAppLanguage(value: unknown): value is AppLanguage {
  return value === 'en' || value === 'uk';
}
