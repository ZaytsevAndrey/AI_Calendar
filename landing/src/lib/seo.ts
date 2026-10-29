import type { Metadata, Viewport } from 'next';
import { getDictionary } from './content';
import { BRAND, LOCALES, SITE_URL, absoluteUrl, localePath, type Locale } from './site';

const OG_IMAGE: Record<Locale, string> = { en: '/og-en.png', uk: '/og-uk.png' };

export const viewport: Viewport = {
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
    themeColor: [
        { media: '(prefers-color-scheme: light)', color: '#f5f7fc' },
        { media: '(prefers-color-scheme: dark)', color: '#10173a' },
    ],
};

export function buildMetadata(locale: Locale): Metadata {
    const t = getDictionary(locale);
    const path = localePath(locale);
    const languages: Record<string, string> = Object.fromEntries(
        LOCALES.map((l) => [l, localePath(l)]),
    );
    languages['x-default'] = localePath('en');

    return {
        metadataBase: new URL(SITE_URL),
        title: t.meta.title,
        description: t.meta.description,
        keywords: t.meta.keywords,
        applicationName: BRAND,
        authors: [{ name: BRAND }],
        creator: BRAND,
        alternates: { canonical: path, languages },
        openGraph: {
            type: 'website',
            siteName: BRAND,
            url: path,
            title: t.meta.title,
            description: t.meta.description,
            locale: t.ogLocale,
            alternateLocale: LOCALES.filter((l) => l !== locale).map((l) => getDictionary(l).ogLocale),
            images: [{ url: OG_IMAGE[locale], width: 1200, height: 630, alt: t.meta.ogAlt }],
        },
        twitter: {
            card: 'summary_large_image',
            title: t.meta.title,
            description: t.meta.description,
            images: [OG_IMAGE[locale]],
        },
        robots: {
            index: true,
            follow: true,
            googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
        },
        icons: {
            icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
            apple: '/apple-touch-icon.png',
        },
        manifest: '/manifest.webmanifest',
        formatDetection: { telephone: false },
        verification: {
            google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || undefined,
        },
    };
}

/** schema.org graph: Organization + WebSite + WebApplication + FAQPage. */
export function buildJsonLd(locale: Locale) {
    const t = getDictionary(locale);
    const pageUrl = absoluteUrl(localePath(locale));
    const orgId = `${SITE_URL}/#organization`;
    const siteId = `${SITE_URL}/#website`;

    return {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'Organization',
                '@id': orgId,
                name: BRAND,
                url: SITE_URL,
                logo: absoluteUrl('/icon-512.png'),
            },
            {
                '@type': 'WebSite',
                '@id': siteId,
                url: SITE_URL,
                name: BRAND,
                publisher: { '@id': orgId },
                inLanguage: LOCALES,
            },
            {
                '@type': 'WebApplication',
                '@id': `${pageUrl}#app`,
                name: BRAND,
                url: pageUrl,
                description: t.meta.description,
                applicationCategory: 'ProductivityApplication',
                operatingSystem: 'Web, Android, iOS',
                browserRequirements: 'Requires JavaScript and a modern browser',
                inLanguage: t.htmlLang,
                image: absoluteUrl(OG_IMAGE[locale]),
                featureList: t.features.items.map((f) => f.title),
                publisher: { '@id': orgId },
            },
            {
                '@type': 'FAQPage',
                '@id': `${pageUrl}#faq`,
                url: pageUrl,
                inLanguage: t.htmlLang,
                mainEntity: t.faq.items.map((item) => ({
                    '@type': 'Question',
                    name: item.q,
                    acceptedAnswer: { '@type': 'Answer', text: item.a },
                })),
            },
        ],
    };
}
