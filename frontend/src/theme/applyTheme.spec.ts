import fs from 'fs';
import path from 'path';
import { applyTheme, readStoredTheme, type ThemeRoot, type ThemeStorage } from './applyTheme';
import {
    hexToRgbChannels,
    THEME_CHROME,
    THEME_COLOR_NAMES,
    THEME_COLORS,
    THEME_IDS,
    THEME_STORAGE_KEY,
} from './themeColors';

function memoryStorage(initial: Record<string, string> = {}): ThemeStorage & { data: Record<string, string> } {
    const data = { ...initial };
    return {
        data,
        getItem(key) {
            return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
        },
        setItem(key, value) {
            data[key] = value;
        },
    };
}

function themeRoot(): ThemeRoot & { props: Map<string, string> } {
    const props = new Map<string, string>();
    return {
        props,
        dataset: {},
        style: {
            colorScheme: '',
            setProperty(name, value) {
                props.set(name, value);
            },
        },
    };
}

describe('theme palettes', () => {
    it('gives light and dark the same color names', () => {
        for (const theme of THEME_IDS) {
            expect(Object.keys(THEME_COLORS[theme]).sort()).toEqual([...THEME_COLOR_NAMES].sort());
        }
    });

    it('turns hex colors into RGB channels', () => {
        expect(hexToRgbChannels('#2B2B2B')).toBe('43 43 43');
        expect(hexToRgbChannels('#fff')).toBe('255 255 255');
    });

    it('keeps the first-paint stylesheet aligned with both palettes', () => {
        const css = fs.readFileSync(path.join(__dirname, '../styles/tailwind.css'), 'utf8');
        for (const theme of THEME_IDS) {
            for (const name of THEME_COLOR_NAMES) {
                expect(css).toContain(hexToRgbChannels(THEME_COLORS[theme][name]));
            }
            expect(css).toContain(THEME_CHROME[theme].shadow);
            expect(css).toContain(THEME_CHROME[theme].shadowMd);
        }
    });
});

describe('applyTheme', () => {
    it('writes the selected palette and replaces it when the theme changes', () => {
        const root = themeRoot();
        const storage = memoryStorage();

        applyTheme('dark', root, storage);

        expect(root.dataset.theme).toBe('dark');
        expect(root.style.colorScheme).toBe('dark');
        expect(root.props.get('--ide-bg')).toBe(hexToRgbChannels(THEME_COLORS.dark.bg));
        expect(root.props.get('--ide-text')).toBe(hexToRgbChannels(THEME_COLORS.dark.text));
        expect(root.props.get('--ide-shadow')).toBe(THEME_CHROME.dark.shadow);
        expect(storage.data[THEME_STORAGE_KEY]).toBe('dark');

        applyTheme('light', root, storage);

        expect(root.dataset.theme).toBe('light');
        expect(root.props.get('--ide-bg')).toBe(hexToRgbChannels(THEME_COLORS.light.bg));
        expect(root.props.get('--ide-text')).toBe(hexToRgbChannels(THEME_COLORS.light.text));
        expect(root.props.get('--ide-panel')).not.toBe(hexToRgbChannels(THEME_COLORS.dark.panel));
        expect(storage.data[THEME_STORAGE_KEY]).toBe('light');
    });

    it('falls back to dark when the stored value is missing or invalid', () => {
        expect(readStoredTheme(memoryStorage())).toBe('dark');
        expect(readStoredTheme(memoryStorage({ [THEME_STORAGE_KEY]: 'blue' }))).toBe('dark');
        expect(readStoredTheme(memoryStorage({ [THEME_STORAGE_KEY]: 'light' }))).toBe('light');
    });

    it('still applies the palette when storage throws', () => {
        const root = themeRoot();
        const storage: ThemeStorage = {
            getItem() {
                throw new Error('blocked');
            },
            setItem() {
                throw new Error('blocked');
            },
        };

        expect(readStoredTheme(storage)).toBe('dark');
        expect(() => applyTheme('light', root, storage)).not.toThrow();
        expect(root.props.get('--ide-bg')).toBe(hexToRgbChannels(THEME_COLORS.light.bg));
    });
});
