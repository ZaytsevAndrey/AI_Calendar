import { getDictionary } from '@/lib/content';
import { BRAND, LOCALES, localePath, type Locale } from '@/lib/site';

function otherLocale(locale: Locale): Locale {
    return LOCALES.find((l) => l !== locale) as Locale;
}

/** Header shared by the landing and the privacy page. `sections` = in-page anchors (landing only). */
export function SiteHeader({ locale, page = '/', sections = true }: { locale: Locale; page?: string; sections?: boolean }) {
    const t = getDictionary(locale);
    const other = otherLocale(locale);
    const home = localePath(locale);
    return (
        <header className="top">
            <div className="wrap top-inner">
                <a className="brand" href={home}>
                    <img src="/favicon.svg" alt="" width="28" height="28" />
                    <span>{BRAND}</span>
                </a>
                <div className="top-actions">
                    <a className="lang" href={localePath(other, page)} hrefLang={other} lang={other} title={t.nav.langLabel}>
                        {getDictionary(other).htmlLang.toUpperCase()}
                    </a>
                    <a className="btn btn-ghost" href={sections ? '#signin' : `${home}#signin`}>
                        {t.nav.signIn}
                    </a>
                </div>
            </div>
        </header>
    );
}

export function SiteFooter({ locale, page = '/' }: { locale: Locale; page?: string }) {
    const t = getDictionary(locale);
    const other = otherLocale(locale);
    return (
        <footer className="foot">
            <div className="wrap foot-inner">
                <p>
                    <strong>{BRAND}</strong>. {t.footer.tagline}
                </p>
                <p className="foot-links">
                    <a href={localePath(locale, '/privacy/')}>{t.footer.privacy}</a>
                    <a href={localePath(other, page)} hrefLang={other} lang={other}>
                        {t.nav.otherLangName}
                    </a>
                    <span>© {new Date().getFullYear()} {BRAND}</span>
                </p>
            </div>
        </footer>
    );
}
