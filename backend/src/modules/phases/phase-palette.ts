/**
 * The ten phase colors (documentation/design/design-system.md §2.4).
 * `hex` is the stored value (the light-theme tone); the UI derives the dark tone.
 * `googleColorId` is the closest Google Calendar event color for events of that phase.
 */
export const PHASE_PALETTE = [
  { id: 'blue', hex: '#2563EB', googleColorId: '9' },
  { id: 'violet', hex: '#7C3AED', googleColorId: '3' },
  { id: 'teal', hex: '#0D9488', googleColorId: '2' },
  { id: 'green', hex: '#16A34A', googleColorId: '10' },
  { id: 'amber', hex: '#D97706', googleColorId: '5' },
  { id: 'orange', hex: '#EA580C', googleColorId: '6' },
  { id: 'rose', hex: '#E11D48', googleColorId: '11' },
  { id: 'pink', hex: '#DB2777', googleColorId: '4' },
  { id: 'cyan', hex: '#0891B2', googleColorId: '7' },
  { id: 'slate', hex: '#64748B', googleColorId: '8' },
] as const;

export type PhasePaletteEntry = (typeof PHASE_PALETTE)[number];

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

/** sRGB (0–255) → CIE Lab (D65). */
export function rgbToLab([r, g, b]: [number, number, number]): [number, number, number] {
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

/** The palette entry for a stored hex: exact match first, otherwise the nearest color in Lab. */
export function nearestPaletteEntry(hex: string | null | undefined): PhasePaletteEntry {
  const rgb = parseHex(hex ?? '');
  if (!rgb) return PHASE_PALETTE[0];
  const exact = PHASE_PALETTE.find((p) => p.hex.toLowerCase() === `#${(hex ?? '').replace('#', '').toLowerCase()}`);
  if (exact) return exact;
  const lab = rgbToLab(rgb);
  let best: PhasePaletteEntry = PHASE_PALETTE[0];
  let bestDistance = Infinity;
  for (const entry of PHASE_PALETTE) {
    const other = rgbToLab(parseHex(entry.hex)!);
    const d = (lab[0] - other[0]) ** 2 + (lab[1] - other[1]) ** 2 + (lab[2] - other[2]) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = entry;
    }
  }
  return best;
}

/** The stored color for any input hex: always one of the ten palette colors. */
export function toPaletteHex(hex: string | null | undefined): string {
  return nearestPaletteEntry(hex).hex;
}

export function isPaletteHex(hex: string | null | undefined): boolean {
  return PHASE_PALETTE.some((p) => p.hex.toLowerCase() === (hex ?? '').toLowerCase());
}
