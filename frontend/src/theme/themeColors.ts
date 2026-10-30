/** Space-separated RGB channels, so Tailwind opacity modifiers can use `rgb(var(--ide-*) / <alpha>)`. */
export type ThemeId = 'dark' | 'light';
/** What the person picked. `system` follows the device. */
export type ThemePreference = ThemeId | 'system';

export const THEME_IDS: readonly ThemeId[] = ['dark', 'light'];

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';

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
    'subtle',
    'overlay',
    'successTint',
    'warnTint',
    'errorTint',
    'errorFill',
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
        bg: '#0E121A',
        panel: '#151A24',
        surface: '#1A2030',
        elevated: '#232A3A',
        border: '#2C3446',
        line: '#202736',
        text: '#E7EBF3',
        muted: '#9AA5B8',
        dim: '#3DCB8A',
        link: '#4C8DFF',
        accent: '#3DCB8A',
        accentBlue: '#2F6BF0',
        keyword: '#F5B544',
        error: '#FF6B66',
        warn: '#F5B544',
        selection: '#18264A',
        input: '#0F141D',
        subtle: '#6E7A90',
        overlay: '#232A3A',
        successTint: '#16302A',
        warnTint: '#33291A',
        errorTint: '#3A1D22',
        errorFill: '#C93338',
    },
    light: {
        bg: '#F6F7FA',
        panel: '#FFFFFF',
        surface: '#F0F2F6',
        elevated: '#E6EAF0',
        border: '#DCE1EA',
        line: '#E8EBF0',
        text: '#121826',
        muted: '#566173',
        dim: '#18794E',
        link: '#2458D3',
        accent: '#18794E',
        accentBlue: '#2458D3',
        keyword: '#A35A00',
        error: '#C62D29',
        warn: '#A35A00',
        selection: '#E7EDFB',
        input: '#FFFFFF',
        subtle: '#6B7588',
        overlay: '#FFFFFF',
        successTint: '#E6F2EC',
        warnTint: '#F8EEDF',
        errorTint: '#FBE7E6',
        errorFill: '#C62D29',
    },
};

export const THEME_CHROME: Record<ThemeId, ThemeChrome> = {
    dark: {
        shadow: '0 1px 2px rgba(0,0,0,0.35)',
        shadowMd: '0 8px 24px rgba(0,0,0,0.45)',
    },
    light: {
        shadow: '0 1px 2px rgba(16,24,40,0.06)',
        shadowMd: '0 8px 24px rgba(16,24,40,0.12)',
    },
};

export function isThemeId(value: unknown): value is ThemeId {
    return value === 'dark' || value === 'light';
}

export function isThemePreference(value: unknown): value is ThemePreference {
    return value === 'system' || isThemeId(value);
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
