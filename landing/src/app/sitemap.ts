import type { MetadataRoute } from 'next';
import { LOCALES, absoluteUrl, localePath } from '@/lib/site';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
    const languages = Object.fromEntries(LOCALES.map((l) => [l, absoluteUrl(localePath(l))]));
    return LOCALES.map((locale) => ({
        url: absoluteUrl(localePath(locale)),
        lastModified: new Date(),
        changeFrequency: 'weekly',
        priority: locale === 'en' ? 1 : 0.9,
        alternates: { languages },
    }));
}
