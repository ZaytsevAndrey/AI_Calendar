import type { ReactNode } from 'react';
import RootShell from '@/components/RootShell';
import { buildMetadata, viewport } from '@/lib/seo';

export const metadata = buildMetadata('uk');
export { viewport };

export default function UkrainianRootLayout({ children }: { children: ReactNode }) {
    return <RootShell locale="uk">{children}</RootShell>;
}
