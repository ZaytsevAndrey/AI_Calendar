import type { ReactNode } from 'react';
import { Onest } from 'next/font/google';
import { getDictionary } from '@/lib/content';
import { APP_PATH, TOKEN_KEY, type Locale } from '@/lib/site';
import '@/app/globals.css';

// Self-hosted at build time (no request to Google from the visitor's browser).
const onest = Onest({
    subsets: ['latin', 'cyrillic'],
    display: 'swap',
    variable: '--font-onest',
});

/**
 * Signed-in visitors who open a home page (/, /en/) go straight to the app; other pages such as
 * /privacy/ stay readable. Runs in <head> before first paint, so they never
 * see the landing flash. Crawlers have no token and get the landing. If the token turns out to be
 * stale, the app's /login route clears it and sends the visitor back here, so this cannot loop.
 */
const HOME_PATHS = /^\/(en\/?)?$/;
const SIGNED_IN_REDIRECT = `try{if(${HOME_PATHS}.test(location.pathname)&&localStorage.getItem(${JSON.stringify(TOKEN_KEY)})){location.replace(${JSON.stringify(APP_PATH)})}}catch(e){}`;

/** Shared <html>/<body> for both locale root layouts, so each page gets the correct `lang`. */
export default function RootShell({ locale, children }: { locale: Locale; children: ReactNode }) {
    const t = getDictionary(locale);
    return (
        <html lang={t.htmlLang} className={onest.variable}>
            <head>
                <script dangerouslySetInnerHTML={{ __html: SIGNED_IN_REDIRECT }} />
            </head>
            <body>{children}</body>
        </html>
    );
}
