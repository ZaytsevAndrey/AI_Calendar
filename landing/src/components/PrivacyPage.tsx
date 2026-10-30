import { getDictionary } from '@/lib/content';
import { CONTACT_EMAIL, localePath, type Locale } from '@/lib/site';
import { SiteFooter, SiteHeader } from './SiteChrome';

export default function PrivacyPage({ locale }: { locale: Locale }) {
    const t = getDictionary(locale);
    const p = t.privacy;
    const [before, after] = p.contact.split('{email}');
    return (
        <>
            <a className="skip" href="#main">
                {t.nav.skip}
            </a>
            <SiteHeader locale={locale} page="/privacy/" sections={false} />
            <main id="main" className="doc-page">
                <article className="wrap doc">
                    <h1>{p.title}</h1>
                    <p className="doc-updated">{p.updated}</p>
                    {p.sections.map((s) => (
                        <section key={s.title}>
                            <h2>{s.title}</h2>
                            {s.paras.map((para) => (
                                <p key={para}>{para}</p>
                            ))}
                        </section>
                    ))}
                    {CONTACT_EMAIL ? (
                        <p>
                            {before}
                            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
                            {after}
                        </p>
                    ) : null}
                    <p>
                        <a href={localePath(locale)}>{p.back}</a>
                    </p>
                </article>
            </main>
            <SiteFooter locale={locale} page="/privacy/" />
        </>
    );
}
