import PrivacyPage from '@/components/PrivacyPage';
import { getDictionary } from '@/lib/content';
import { buildMetadata } from '@/lib/seo';

const t = getDictionary('en').privacy;
export const metadata = buildMetadata('en', '/privacy/', { title: `${t.title} | Luefy`, description: t.description });

export default function PrivacyEn() {
    return <PrivacyPage locale="en" />;
}
