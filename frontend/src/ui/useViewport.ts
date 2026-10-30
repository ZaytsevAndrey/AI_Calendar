import { useEffect, useState } from 'react';

function matches(query: string): boolean {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia(query).matches
        : false;
}

/** Live `matchMedia` result. */
export function useMatchMedia(query: string): boolean {
    const [value, setValue] = useState(() => matches(query));
    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const media = window.matchMedia(query);
        const onChange = () => setValue(media.matches);
        onChange();
        media.addEventListener?.('change', onChange);
        return () => media.removeEventListener?.('change', onChange);
    }, [query]);
    return value;
}

/** Below 768px: sheets instead of popovers, 44px controls. */
export function useIsPhone(): boolean {
    return useMatchMedia('(max-width: 767px)');
}

/**
 * Height of the on-screen keyboard (or any bottom overlay) from `visualViewport`,
 * so a bottom sheet can sit above it. 0 when the browser has no visualViewport.
 */
export function useKeyboardInset(active = true): number {
    const [inset, setInset] = useState(0);
    useEffect(() => {
        const vv = typeof window !== 'undefined' ? window.visualViewport : null;
        if (!active || !vv) {
            setInset(0);
            return;
        }
        const update = () => {
            setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
        };
        update();
        vv.addEventListener('resize', update);
        vv.addEventListener('scroll', update);
        return () => {
            vv.removeEventListener('resize', update);
            vv.removeEventListener('scroll', update);
        };
    }, [active]);
    return inset;
}
