import PrivacyPage from '@/components/PrivacyPage';
import { getDictionary } from '@/lib/content';
import { buildMetadata } from '@/lib/seo';

const t = getDictionary('uk').privacy;
export const metadata = buildMetadata('uk', '/privacy/', { title: `${t.title} | Luefy`, description: t.description });

export default function PrivacyUk() {
    return <PrivacyPage locale="uk" />;
}
