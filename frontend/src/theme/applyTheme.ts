import {
    DEFAULT_THEME,
    hexToRgbChannels,
    isThemeId,
    THEME_CHROME,
    THEME_COLOR_NAMES,
    THEME_COLORS,
    THEME_STORAGE_KEY,
    type ThemeId,
} from './themeColors';

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

export function readStoredTheme(storage?: ThemeStorage): ThemeId {
    const store = storage ?? browserStorage();
    if (!store) return DEFAULT_THEME;
    try {
        const raw = store.getItem(THEME_STORAGE_KEY);
        return isThemeId(raw) ? raw : DEFAULT_THEME;
    } catch {
        return DEFAULT_THEME;
    }
}

/** Replace the active color list and remember the choice in this browser. */
export function applyTheme(theme: ThemeId, root?: ThemeRoot, storage?: ThemeStorage): void {
    const target = root ?? browserRoot();
    const colors = THEME_COLORS[theme];
    const chrome = THEME_CHROME[theme];

    if (target) {
        target.dataset.theme = theme;
        target.style.colorScheme = theme;
        for (const name of THEME_COLOR_NAMES) {
            target.style.setProperty(`--ide-${name}`, hexToRgbChannels(colors[name]));
        }
        target.style.setProperty('--ide-shadow', chrome.shadow);
        target.style.setProperty('--ide-shadow-md', chrome.shadowMd);
    }

    const store = storage ?? browserStorage();
    if (store) {
        try {
            store.setItem(THEME_STORAGE_KEY, theme);
        } catch {
            // A blocked write still leaves the palette on the document.
        }
    }

    if (!root && typeof document !== 'undefined') {
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', colors.bg);
    }
}

export function applyStoredTheme(): ThemeId {
    const theme = readStoredTheme();
    applyTheme(theme);
    return theme;
}
