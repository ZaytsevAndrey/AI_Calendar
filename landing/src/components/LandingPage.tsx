import { getDictionary } from '@/lib/content';
import { buildJsonLd } from '@/lib/seo';
import { BRAND, LOCALES, localePath, type Locale } from '@/lib/site';
import DayStrip from './DayStrip';
import SignInPanel from './SignInPanel';

export default function LandingPage({ locale }: { locale: Locale }) {
    const t = getDictionary(locale);
    const other = LOCALES.find((l) => l !== locale) as Locale;
    const jsonLd = buildJsonLd(locale);

    return (
        <>
            <script
                type="application/ld+json"
                // JSON-LD must be raw JSON; escape "<" so content can never close the tag.
                dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
            />
            <a className="skip" href="#main">
                {t.nav.skip}
            </a>

            <header className="top">
                <div className="wrap top-inner">
                    <a className="brand" href={localePath(locale)} aria-label={BRAND}>
                        <img src="/favicon.svg" alt="" width="28" height="28" />
                        <span>{BRAND}</span>
                    </a>
                    <nav className="top-nav" aria-label={BRAND}>
                        <a href="#how">{t.nav.how}</a>
                        <a href="#features">{t.nav.features}</a>
                        <a href="#faq">{t.nav.faq}</a>
                    </nav>
                    <div className="top-actions">
                        <a
                            className="lang"
                            href={localePath(other)}
                            hrefLang={other}
                            lang={other}
                            title={t.nav.langLabel}
                        >
                            {t.nav.otherLangName}
                        </a>
                        <a className="btn btn-ghost" href="#signin">
                            {t.nav.signIn}
                        </a>
                    </div>
                </div>
            </header>

            <main id="main">
                <section className="hero" aria-labelledby="hero-title">
                    <div className="wrap hero-inner">
                        <div className="hero-copy">
                            <h1 id="hero-title">{t.hero.title}</h1>
                            <p className="lead">{t.hero.lead}</p>
                            <div id="signin" className="signin-anchor">
                                <SignInPanel labels={t.signIn} />
                            </div>
                            <p className="fine">{t.hero.note}</p>
                        </div>
                        <DayStrip strip={t.strip} />
                    </div>
                </section>

                <section id="how" className="how" aria-labelledby="how-title">
                    <div className="wrap">
                        <h2 id="how-title">{t.how.title}</h2>
                        <p className="section-intro">{t.how.intro}</p>
                        <ol className="steps">
                            {t.how.steps.map((s, i) => (
                                <li key={s.title} className="step">
                                    <span className="step-n" aria-hidden="true">
                                        {i + 1}
                                    </span>
                                    <h3>{s.title}</h3>
                                    <p>{s.body}</p>
                                </li>
                            ))}
                        </ol>
                    </div>
                </section>

                <section id="features" className="features" aria-labelledby="features-title">
                    <div className="wrap features-inner">
                        <h2 id="features-title">{t.features.title}</h2>
                        <dl className="feature-list">
                            {t.features.items.map((f) => (
                                <div key={f.title} className="feature">
                                    <dt>{f.title}</dt>
                                    <dd>{f.body}</dd>
                                </div>
                            ))}
                        </dl>
                    </div>
                </section>

                <section id="faq" className="faq" aria-labelledby="faq-title">
                    <div className="wrap faq-inner">
                        <h2 id="faq-title">{t.faq.title}</h2>
                        <div className="faq-list">
                            {t.faq.items.map((item, i) => (
                                <details key={item.q} open={i === 0}>
                                    <summary>
                                        <h3>{item.q}</h3>
                                    </summary>
                                    <p>{item.a}</p>
                                </details>
                            ))}
                        </div>
                    </div>
                </section>

                <section className="final" aria-labelledby="final-title">
                    <div className="wrap final-inner">
                        <h2 id="final-title">{t.final.title}</h2>
                        <p>{t.final.body}</p>
                        <SignInPanel labels={t.signIn} tone="dark" />
                    </div>
                </section>
            </main>

            <footer className="foot">
                <div className="wrap foot-inner">
                    <p>
                        <strong>{BRAND}</strong>. {t.footer.tagline}
                    </p>
                    <p>
                        <a href={localePath(other)} hrefLang={other} lang={other}>
                            {t.nav.otherLangName}
                        </a>
                        <span aria-hidden="true"> / </span>
                        <span>© {new Date().getFullYear()} {BRAND}</span>
                    </p>
                </div>
            </footer>
        </>
    );
}
