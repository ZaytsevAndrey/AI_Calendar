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

                <section className="problem" aria-labelledby="problem-title">
                    <div className="wrap problem-inner">
                        <div className="problem-head">
                            <h2 id="problem-title">{t.problem.title}</h2>
                            <p className="pull">{t.problem.pull}</p>
                        </div>
                        <div className="prose">
                            {t.problem.paras.map((p) => (
                                <p key={p}>{p}</p>
                            ))}
                        </div>
                    </div>
                </section>

                <section id="how" className="how" aria-labelledby="how-title">
                    <div className="wrap">
                        <h2 id="how-title">{t.how.title}</h2>
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
                        <p className="how-summary">{t.how.summary}</p>
                    </div>
                </section>

                <section className="principles" aria-labelledby="principles-title">
                    <div className="wrap principles-inner">
                        <div>
                            <h2 id="principles-title">{t.principles.title}</h2>
                            <p className="section-lead">{t.principles.lead}</p>
                            <dl className="principle-list">
                                {t.principles.items.map((p) => (
                                    <div key={p.title} className="principle">
                                        <dt>{p.title}</dt>
                                        <dd>{p.body}</dd>
                                    </div>
                                ))}
                            </dl>
                        </div>
                        <figure className="chat" aria-label={t.principles.dialogLabel}>
                            {t.principles.dialog.map((line) => (
                                <p key={line.text} className={`bubble bubble-${line.from}`}>
                                    {line.text}
                                </p>
                            ))}
                        </figure>
                    </div>
                </section>

                <section id="who" className="audience" aria-labelledby="who-title">
                    <div className="wrap">
                        <h2 id="who-title">{t.audience.title}</h2>
                        <div className="audience-grid">
                            {t.audience.groups.map((g) => (
                                <article key={g.title} className="group">
                                    <h3>{g.title}</h3>
                                    <p>{g.body}</p>
                                    {g.bullets ? (
                                        <ul>
                                            {g.bullets.map((b) => (
                                                <li key={b}>{b}</li>
                                            ))}
                                        </ul>
                                    ) : null}
                                </article>
                            ))}
                        </div>
                        <p className="audience-note">{t.audience.note}</p>
                    </div>
                </section>

                <section className="vision" aria-labelledby="vision-title">
                    <div className="wrap vision-inner">
                        <h2 id="vision-title">{t.vision.title}</h2>
                        <div className="prose">
                            <p>{t.vision.body}</p>
                            <ul>
                                {t.vision.bullets.map((b) => (
                                    <li key={b}>{b}</li>
                                ))}
                            </ul>
                            <p>{t.vision.closing}</p>
                        </div>
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
