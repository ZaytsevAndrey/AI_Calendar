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

export const LOCALES = ['uk', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
/** Ukrainian lives at the root; other locales under their own prefix. */
export const DEFAULT_LOCALE: Locale = 'uk';

/** Path of a page for a locale: localePath('en', '/privacy/') → '/en/privacy/'. */
export function localePath(locale: Locale, page = '/'): string {
    const p = page.startsWith('/') ? page : `/${page}`;
    return locale === DEFAULT_LOCALE ? p : `/${locale}${p}`;
}

export function absoluteUrl(path: string): string {
    return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Public contact for data requests (privacy page). Unset → that line is left out. */
export const CONTACT_EMAIL = (process.env.NEXT_PUBLIC_CONTACT_EMAIL || '').trim();
