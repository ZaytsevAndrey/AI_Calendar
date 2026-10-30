import { getDictionary } from '@/lib/content';
import { buildJsonLd } from '@/lib/seo';
import type { Locale } from '@/lib/site';
import CaptureDemo from './CaptureDemo';
import SignInPanel from './SignInPanel';
import { SiteFooter, SiteHeader } from './SiteChrome';
import WaitlistForm from './WaitlistForm';

export default function LandingPage({ locale }: { locale: Locale }) {
    const t = getDictionary(locale);
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
            <SiteHeader locale={locale} />

            <main id="main">
                <section className="hero" aria-labelledby="hero-title">
                    <div className="wrap hero-inner">
                        <div className="hero-copy">
                            <p className="badge">
                                <span className="badge-dot" aria-hidden="true" />
                                {t.hero.badge}
                            </p>
                            <h1 id="hero-title">{t.hero.title}</h1>
                            <p className="lead">{t.hero.lead}</p>
                            <WaitlistForm labels={t.waitlist} locale={locale} source="hero" />
                        </div>
                        <CaptureDemo demo={t.demo} />
                    </div>
                </section>

                <section className="how" aria-labelledby="how-title">
                    <div className="wrap">
                        <h2 id="how-title" className="sr-only">
                            {t.steps.title}
                        </h2>
                        <ol className="steps">
                            {t.steps.items.map((s, i) => (
                                <li key={s.title} className="step">
                                    <span className="step-n" aria-hidden="true">
                                        {i + 1}
                                    </span>
                                    <h3>{s.title}</h3>
                                    <p>{s.body}</p>
                                </li>
                            ))}
                        </ol>
                        <p className="why">{t.calendarsLine}</p>
                    </div>
                </section>

                <section className="final" aria-labelledby="final-title">
                    <div className="wrap final-inner">
                        <h2 id="final-title">{t.final.title}</h2>
                        <p>{t.final.body}</p>
                        <WaitlistForm labels={t.waitlist} locale={locale} source="final" tone="dark" />
                    </div>
                </section>

                <section id="signin" className="signin-band" aria-labelledby="signin-title">
                    <div className="wrap signin-band-inner">
                        <h2 id="signin-title">{t.signIn.title}</h2>
                        <SignInPanel labels={t.signIn} quiet />
                    </div>
                </section>
            </main>

            <SiteFooter locale={locale} />
        </>
    );
}
