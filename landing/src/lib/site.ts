/** Normalize a base URL from env (Render hostnames may omit the scheme). No trailing slash. */
function toAbsoluteUrl(value: string | undefined, fallback: string): string {
    const raw = (value || '').trim().replace(/\/+$/, '');
    if (!raw) return fallback.replace(/\/+$/, '');
    return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

const isProd = process.env.NODE_ENV === 'production';

/** Public origin of this landing: canonical URLs, sitemap, Open Graph. */
export const SITE_URL = toAbsoluteUrl(
    process.env.NEXT_PUBLIC_SITE_URL || process.env.RENDER_EXTERNAL_URL,
    'http://localhost:3002',
);

/**
 * Where the React app starts. Landing and app share one origin (see scripts/assemble-site.mjs),
 * so this is a path, and both read the same localStorage.
 */
export const APP_PATH = '/calendar';

/** localStorage key the React app writes after sign-in (frontend GoogleCallbackPage). */
export const TOKEN_KEY = 'access_token';

/** NestJS API. */
export const API_BASE_URL = toAbsoluteUrl(
    process.env.NEXT_PUBLIC_API_BASE_URL,
    isProd ? 'https://ai-calendar-api-fxsw.onrender.com' : 'http://localhost:3001',
);

export const BRAND = 'Luefy';

export const LOCALES = ['en', 'uk'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/** Path of the home page for a locale. English lives at the root. */
export function localePath(locale: Locale): string {
    return locale === DEFAULT_LOCALE ? '/' : `/${locale}/`;
}

export function absoluteUrl(path: string): string {
    return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}
