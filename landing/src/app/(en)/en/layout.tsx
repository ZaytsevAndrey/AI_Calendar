import type { ReactNode } from 'react';
import RootShell from '@/components/RootShell';
import { buildMetadata, viewport } from '@/lib/seo';

export const metadata = buildMetadata('en');
export { viewport };

/** Root layout for English: "/en/" and "/en/privacy/". */
export default function EnglishRootLayout({ children }: { children: ReactNode }) {
    return <RootShell locale="en">{children}</RootShell>;
}
