import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { applyTheme, readStoredPreference, resolveTheme, storePreference, systemTheme } from './applyTheme';
import { isThemePreference, THEME_STORAGE_KEY, type ThemeId, type ThemePreference } from './themeColors';

type ThemeContextValue = {
    /** The theme on screen. */
    theme: ThemeId;
    /** What the person picked: system, light or dark. */
    preference: ThemePreference;
    setPreference: (preference: ThemePreference) => void;
    /** Pick an explicit theme (the header toggle). */
    setTheme: (theme: ThemeId) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [preference, setPreferenceState] = useState<ThemePreference>(() => readStoredPreference());
    const [system, setSystem] = useState<ThemeId>(() => systemTheme());
    const theme = resolveTheme(preference, system);

    useEffect(() => {
        applyTheme(theme);
    }, [theme]);

    const setPreference = useCallback((next: ThemePreference) => {
        storePreference(next);
        setPreferenceState(next);
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const query = window.matchMedia('(prefers-color-scheme: light)');
        const onChange = () => setSystem(query.matches ? 'light' : 'dark');
        query.addEventListener?.('change', onChange);
        return () => query.removeEventListener?.('change', onChange);
    }, []);

    useEffect(() => {
        const onStorage = (event: StorageEvent) => {
            if (event.key !== THEME_STORAGE_KEY || !isThemePreference(event.newValue)) return;
            setPreferenceState(event.newValue);
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, []);

    const value = useMemo(
        () => ({ theme, preference, setPreference, setTheme: setPreference }),
        [theme, preference, setPreference],
    );

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
    const value = useContext(ThemeContext);
    if (!value) {
        throw new Error('useTheme must be used within ThemeProvider');
    }
    return value;
}
