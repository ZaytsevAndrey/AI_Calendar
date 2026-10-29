/** Space-separated RGB channels, so Tailwind opacity modifiers can use `rgb(var(--ide-*) / <alpha>)`. */
export type ThemeId = 'dark' | 'light';

export const THEME_IDS: readonly ThemeId[] = ['dark', 'light'];

export const DEFAULT_THEME: ThemeId = 'dark';

export const THEME_STORAGE_KEY = 'luefy.theme';

export const THEME_COLOR_NAMES = [
    'bg',
    'panel',
    'surface',
    'elevated',
    'border',
    'line',
    'text',
    'muted',
    'dim',
    'link',
    'accent',
    'accentBlue',
    'keyword',
    'error',
    'warn',
    'selection',
    'input',
] as const;

export type ThemeColorName = (typeof THEME_COLOR_NAMES)[number];

export type ThemePalette = Record<ThemeColorName, string>;

export type ThemeChrome = {
    shadow: string;
    shadowMd: string;
};

/**
 * Active palette. `applyTheme` writes this list onto `--ide-*`.
 * `frontend/src/styles/tailwind.css` duplicates the same channels for the first paint.
 */
export const THEME_COLORS: Record<ThemeId, ThemePalette> = {
    dark: {
        bg: '#2B2B2B',
        panel: '#3C3F41',
        surface: '#323232',
        elevated: '#45494A',
        border: '#515151',
        line: '#313335',
        text: '#A9B7C6',
        muted: '#808080',
        dim: '#6A8759',
        link: '#589DF6',
        accent: '#4E9F4E',
        accentBlue: '#287BDE',
        keyword: '#CC7832',
        error: '#BC3F3C',
        warn: '#BBB529',
        selection: '#214283',
        input: '#45494A',
    },
    light: {
        bg: '#F4F5F7',
        panel: '#FFFFFF',
        surface: '#EEF1F4',
        elevated: '#E2E6EB',
        border: '#D0D5DC',
        line: '#E4E7EC',
        text: '#1C2128',
        muted: '#5C6770',
        dim: '#3E6B35',
        link: '#1565C0',
        accent: '#2E7D32',
        accentBlue: '#1565C0',
        keyword: '#A34D00',
        error: '#B42318',
        warn: '#8A6500',
        selection: '#D6E4F7',
        input: '#FFFFFF',
    },
};

export const THEME_CHROME: Record<ThemeId, ThemeChrome> = {
    dark: {
        shadow: '0 1px 3px rgba(0,0,0,0.45)',
        shadowMd: '0 4px 12px rgba(0,0,0,0.5)',
    },
    light: {
        shadow: '0 1px 3px rgba(15,23,42,0.08)',
        shadowMd: '0 4px 12px rgba(15,23,42,0.12)',
    },
};

export function isThemeId(value: unknown): value is ThemeId {
    return value === 'dark' || value === 'light';
}

export function hexToRgbChannels(hex: string): string {
    const normalized = hex.replace('#', '');
    const expanded =
        normalized.length === 3
            ? normalized
                  .split('')
                  .map((channel) => channel + channel)
                  .join('')
            : normalized;
    const red = Number.parseInt(expanded.slice(0, 2), 16);
    const green = Number.parseInt(expanded.slice(2, 4), 16);
    const blue = Number.parseInt(expanded.slice(4, 6), 16);
    return `${red} ${green} ${blue}`;
}
