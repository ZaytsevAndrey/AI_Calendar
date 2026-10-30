import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import uk from './locales/uk.json';

export const APP_LANGUAGES = ['en', 'uk'] as const;
export type AppLanguage = (typeof APP_LANGUAGES)[number];

export function isAppLanguage(value: unknown): value is AppLanguage {
  return value === 'en' || value === 'uk';
}

/** Browser guess before settings load. */
export function detectBrowserLanguage(): AppLanguage {
  if (typeof navigator === 'undefined') return 'en';
  const candidates = [
    ...(navigator.languages ?? []),
    navigator.language,
  ].filter(Boolean);
  for (const tag of candidates) {
    const lower = tag.toLowerCase();
    if (lower === 'uk' || lower.startsWith('uk-')) return 'uk';
    if (lower === 'en' || lower.startsWith('en-')) return 'en';
  }
  return 'en';
}

const STORAGE_KEY = 'app_language';

export function readStoredLanguage(): AppLanguage | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isAppLanguage(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function writeStoredLanguage(lang: AppLanguage): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* ignore */
  }
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    uk: { translation: uk },
  },
  lng: readStoredLanguage() ?? detectBrowserLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

// Screen readers and CSS hyphenation read the page language from <html lang>.
const syncHtmlLang = (lng: string) => {
  if (typeof document !== 'undefined') document.documentElement.lang = lng.split('-')[0];
};
syncHtmlLang(i18n.language || 'uk');
i18n.on('languageChanged', syncHtmlLang);

export default i18n;
