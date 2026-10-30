import type { ThemeId } from './themeColors';

/**
 * The ten phase colors (documentation/design/design-system.md §2.4).
 * `hex` is what the API stores; `dark` / `light` are the tones drawn in each theme.
 * Mirrors backend/src/modules/phases/phase-palette.ts.
 */
export const PHASE_PALETTE = [
    { id: 'blue', hex: '#2563EB', dark: '#4C8DFF', light: '#2563EB' },
    { id: 'violet', hex: '#7C3AED', dark: '#A78BFA', light: '#7C3AED' },
    { id: 'teal', hex: '#0D9488', dark: '#2DD4BF', light: '#0D9488' },
    { id: 'green', hex: '#16A34A', dark: '#4ADE80', light: '#16A34A' },
    { id: 'amber', hex: '#D97706', dark: '#FBBF24', light: '#D97706' },
    { id: 'orange', hex: '#EA580C', dark: '#FB923C', light: '#EA580C' },
    { id: 'rose', hex: '#E11D48', dark: '#FB7185', light: '#E11D48' },
    { id: 'pink', hex: '#DB2777', dark: '#F472B6', light: '#DB2777' },
    { id: 'cyan', hex: '#0891B2', dark: '#22D3EE', light: '#0891B2' },
    { id: 'slate', hex: '#64748B', dark: '#94A3B8', light: '#64748B' },
] as const;

export type PhasePaletteId = (typeof PHASE_PALETTE)[number]['id'];

function parseHex(hex: string): [number, number, number] | null {
    const t = hex.trim();
    const m6 = /^#?([0-9a-f]{6})$/i.exec(t);
    if (m6) {
        const n = parseInt(m6[1], 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    const m3 = /^#?([0-9a-f]{3})$/i.exec(t);
    if (m3) {
        const [r, g, b] = m3[1].split('').map((c) => parseInt(c + c, 16));
        return [r, g, b];
    }
    return null;
}

function rgbToLab([r, g, b]: [number, number, number]): [number, number, number] {
    const lin = (c: number) => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const [R, G, B] = [lin(r), lin(g), lin(b)];
    const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
    const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
    const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    const f = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

const cache = new Map<string, PhasePaletteId>();

/** Palette id for any stored color: exact match, otherwise the nearest in Lab. Unknown → slate. */
export function phasePaletteId(hex: string | null | undefined): PhasePaletteId {
    const key = (hex ?? '').trim().toLowerCase();
    const cached = cache.get(key);
    if (cached) return cached;
    const exact = PHASE_PALETTE.find((p) => p.hex.toLowerCase() === key);
    let id: PhasePaletteId = exact?.id ?? 'slate';
    if (!exact) {
        const rgb = parseHex(key);
        if (rgb) {
            const lab = rgbToLab(rgb);
            let best = Infinity;
            for (const entry of PHASE_PALETTE) {
                const o = rgbToLab(parseHex(entry.hex)!);
                const d = (lab[0] - o[0]) ** 2 + (lab[1] - o[1]) ** 2 + (lab[2] - o[2]) ** 2;
                if (d < best) {
                    best = d;
                    id = entry.id;
                }
            }
        }
    }
    cache.set(key, id);
    return id;
}

/** The stored hex for a palette id. */
export function phasePaletteHex(id: PhasePaletteId): string {
    return PHASE_PALETTE.find((p) => p.id === id)!.hex;
}

/** CSS color for a phase in the active theme (reads `--ph-<id>`). */
export function phaseColor(hex: string | null | undefined, alpha?: number): string {
    const id = phasePaletteId(hex);
    return alpha === undefined ? `rgb(var(--ph-${id}))` : `rgb(var(--ph-${id}) / ${alpha})`;
}

/** Fill for a block of this phase: a tint of the phase color over the panel. */
export function phaseTint(hex: string | null | undefined): string {
    return `color-mix(in srgb, ${phaseColor(hex)} var(--phase-tint), rgb(var(--ide-panel)))`;
}

export function phaseTones(theme: ThemeId): Record<PhasePaletteId, string> {
    return Object.fromEntries(PHASE_PALETTE.map((p) => [p.id, p[theme]])) as Record<PhasePaletteId, string>;
}
