import React from 'react';
import type { CalendarProviderId } from '../schedulingKind';

type Props = {
  provider: CalendarProviderId;
  className?: string;
  title?: string;
};

/** Compact brand marks for calendar chips (not Lucide — need recognizable logos). */
export function ProviderLogo({ provider, className = 'h-3 w-3', title }: Props) {
  if (provider === 'microsoft') {
    return (
      <span title={title} className="inline-flex">
        <svg className={className} viewBox="0 0 16 16" aria-hidden>
          <rect x="1" y="1" width="6.5" height="6.5" fill="#F25022" />
          <rect x="8.5" y="1" width="6.5" height="6.5" fill="#7FBA00" />
          <rect x="1" y="8.5" width="6.5" height="6.5" fill="#00A4EF" />
          <rect x="8.5" y="8.5" width="6.5" height="6.5" fill="#FFB900" />
        </svg>
      </span>
    );
  }
  if (provider === 'apple') {
    return (
      <span title={title} className="inline-flex">
        <svg className={className} viewBox="0 0 16 16" aria-hidden>
          <path
            fill="currentColor"
            d="M12.6 8.4c0-1.7 1.4-2.5 1.4-2.5s-1.1-1.6-2.9-1.6c-1.7 0-2.4.8-3.1.8-.7 0-1.6-.8-3-.8-2.3 0-4.5 1.9-4.5 5.5 0 2.2.8 4.5 1.9 6 .8 1.1 1.7 2.2 3 2.2 1.1 0 1.5-.7 3-.7s1.8.7 3 .7c1.3 0 2.1-1.1 2.9-2.2.5-.7.9-1.5 1.1-1.8-.1 0-2.1-.8-2.1-3.6zM10.7 2.8c.6-.7 1-1.7.9-2.8-1 .1-2.1.7-2.7 1.5-.6.7-1.1 1.7-.9 2.7 1.1.1 2.1-.6 2.7-1.4z"
          />
        </svg>
      </span>
    );
  }
  // Google "G"
  return (
    <span title={title} className="inline-flex">
      <svg className={className} viewBox="0 0 16 16" aria-hidden>
        <path
          fill="#4285F4"
          d="M15.2 8.2c0-.5-.05-1-.14-1.5H8v2.8h4.1c-.18 1-.72 1.85-1.53 2.42v2h2.47c1.45-1.33 2.16-3.3 2.16-5.72z"
        />
        <path
          fill="#34A853"
          d="M8 15.5c2.07 0 3.81-.68 5.08-1.85l-2.47-2c-.69.46-1.56.73-2.61.73-2 0-3.7-1.35-4.3-3.17H1.14v2.07A7.5 7.5 0 0 0 8 15.5z"
        />
        <path
          fill="#FBBC05"
          d="M3.7 9.21A4.5 4.5 0 0 1 3.46 8c0-.42.08-.83.24-1.21V4.72H1.14A7.5 7.5 0 0 0 .5 8c0 1.21.29 2.35.64 3.28l2.56-2.07z"
        />
        <path
          fill="#EA4335"
          d="M8 3.62c1.13 0 2.14.39 2.94 1.15l2.2-2.2A7.46 7.46 0 0 0 8 .5 7.5 7.5 0 0 0 1.14 4.72l2.56 2.07C4.3 4.97 6 3.62 8 3.62z"
        />
      </svg>
    </span>
  );
}

export function providerLabel(provider: CalendarProviderId): string {
  if (provider === 'microsoft') return 'Microsoft';
  if (provider === 'apple') return 'Apple';
  return 'Google';
}
