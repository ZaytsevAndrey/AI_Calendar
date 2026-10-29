import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { applyTheme, readStoredTheme } from './applyTheme';
import { isThemeId, THEME_STORAGE_KEY, type ThemeId } from './themeColors';

type ThemeContextValue = {
    theme: ThemeId;
    setTheme: (theme: ThemeId) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [theme, setThemeState] = useState<ThemeId>(() => readStoredTheme());

    const setTheme = useCallback((next: ThemeId) => {
        applyTheme(next);
        setThemeState(next);
    }, []);

    useEffect(() => {
        const onStorage = (event: StorageEvent) => {
            if (event.key !== THEME_STORAGE_KEY || !isThemeId(event.newValue)) return;
            applyTheme(event.newValue);
            setThemeState(event.newValue);
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, []);

    const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
    const value = useContext(ThemeContext);
    if (!value) {
        throw new Error('useTheme must be used within ThemeProvider');
    }
    return value;
}
