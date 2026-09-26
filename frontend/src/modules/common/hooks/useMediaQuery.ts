import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
    const [matches, setMatches] = useState(() =>
        typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
    );

    useEffect(() => {
        const media = window.matchMedia(query);
        const onChange = () => setMatches(media.matches);
        onChange();
        media.addEventListener('change', onChange);
        return () => media.removeEventListener('change', onChange);
    }, [query]);

    return matches;
}

/** Tailwind `max-md`: viewports below 768px. */
export function usePhoneLayout(): boolean {
    return useMediaQuery('(max-width: 767px)');
}

export function useCoarsePointer(): boolean {
    return useMediaQuery('(pointer: coarse)');
}
