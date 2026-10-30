import {
    DEFAULT_THEME_PREFERENCE,
    hexToRgbChannels,
    isThemePreference,
    THEME_CHROME,
    THEME_COLOR_NAMES,
    THEME_COLORS,
    THEME_STORAGE_KEY,
    type ThemeId,
    type ThemePreference,
} from './themeColors';
import { phaseTones } from './phasePalette';

export type ThemeRoot = {
    dataset: { theme?: string };
    style: {
        colorScheme: string;
        setProperty(name: string, value: string): void;
    };
};

export type ThemeStorage = {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
};

function browserRoot(): ThemeRoot | undefined {
    if (typeof document === 'undefined') return undefined;
    return document.documentElement;
}

function browserStorage(): ThemeStorage | undefined {
    if (typeof localStorage === 'undefined') return undefined;
    return localStorage;
}

/** The stored choice; `system` when nothing (or nothing valid) is stored. */
export function readStoredPreference(storage?: ThemeStorage): ThemePreference {
    const store = storage ?? browserStorage();
    if (!store) return DEFAULT_THEME_PREFERENCE;
    try {
        const raw = store.getItem(THEME_STORAGE_KEY);
        return isThemePreference(raw) ? raw : DEFAULT_THEME_PREFERENCE;
    } catch {
        return DEFAULT_THEME_PREFERENCE;
    }
}

export function storePreference(preference: ThemePreference, storage?: ThemeStorage): void {
    const store = storage ?? browserStorage();
    if (!store) return;
    try {
        store.setItem(THEME_STORAGE_KEY, preference);
    } catch {
        // A blocked write still leaves the palette on the document.
    }
}

/** The device theme; dark when the browser cannot tell. */
export function systemTheme(): ThemeId {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'dark';
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function resolveTheme(preference: ThemePreference, system: ThemeId = systemTheme()): ThemeId {
    return preference === 'system' ? system : preference;
}

/** Paint the palette for a resolved theme. */
export function applyTheme(theme: ThemeId, root?: ThemeRoot): void {
    const target = root ?? browserRoot();
    const colors = THEME_COLORS[theme];
    const chrome = THEME_CHROME[theme];

    if (target) {
        target.dataset.theme = theme;
        target.style.colorScheme = theme;
        for (const name of THEME_COLOR_NAMES) {
            target.style.setProperty(`--ide-${name}`, hexToRgbChannels(colors[name]));
        }
        for (const [id, hex] of Object.entries(phaseTones(theme))) {
            target.style.setProperty(`--ph-${id}`, hexToRgbChannels(hex));
        }
        target.style.setProperty('--phase-tint', theme === 'dark' ? '18%' : '12%');
        target.style.setProperty('--ide-shadow', chrome.shadow);
        target.style.setProperty('--ide-shadow-md', chrome.shadowMd);
    }

    if (!root && typeof document !== 'undefined') {
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', colors.bg);
    }
}

export function applyStoredTheme(): ThemeId {
    const theme = resolveTheme(readStoredPreference());
    applyTheme(theme);
    return theme;
}
