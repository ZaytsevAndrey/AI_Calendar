import type { MetadataRoute } from 'next';
import { DEFAULT_LOCALE, LOCALES, absoluteUrl, localePath } from '@/lib/site';

export const dynamic = 'force-static';

const PAGES: { page: string; priority: number; changeFrequency: 'weekly' | 'yearly' }[] = [
    { page: '/', priority: 1, changeFrequency: 'weekly' },
    { page: '/privacy/', priority: 0.3, changeFrequency: 'yearly' },
];

export default function sitemap(): MetadataRoute.Sitemap {
    return PAGES.flatMap(({ page, priority, changeFrequency }) => {
        const languages = Object.fromEntries(LOCALES.map((l) => [l, absoluteUrl(localePath(l, page))]));
        return LOCALES.map((locale) => ({
            url: absoluteUrl(localePath(locale, page)),
            lastModified: new Date(),
            changeFrequency,
            priority: locale === DEFAULT_LOCALE ? priority : Math.round(priority * 90) / 100,
            alternates: { languages },
        }));
    });
}
