import { en, type MessageKey } from './catalogs/en';
import { uk } from './catalogs/uk';
import type { AppLanguage } from './types';

const catalogs: Record<AppLanguage, Record<MessageKey, string>> = { en, uk };

export type { MessageKey };

/** Simple {{param}} interpolation against the language catalog. */
export function t(
  lang: AppLanguage,
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  const template = catalogs[lang][key] ?? catalogs.en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const value = params[name];
    return value === undefined || value === null ? '' : String(value);
  });
}
