import type { ReactNode } from 'react';
import RootShell from '@/components/RootShell';
import { buildMetadata, viewport } from '@/lib/seo';

export const metadata = buildMetadata('uk');
export { viewport };

/** Root layout for Ukrainian, the default locale: "/" and "/privacy/". */
export default function UkrainianRootLayout({ children }: { children: ReactNode }) {
    return <RootShell locale="uk">{children}</RootShell>;
}
