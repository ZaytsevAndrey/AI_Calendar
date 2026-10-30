import { isPaletteHex, nearestPaletteEntry, PHASE_PALETTE, toPaletteHex } from './phase-palette';

describe('phase palette', () => {
  it('has ten colors with ten different Google colors', () => {
    expect(PHASE_PALETTE).toHaveLength(10);
    expect(new Set(PHASE_PALETTE.map((p) => p.googleColorId)).size).toBe(10);
  });

  it('keeps palette colors and maps others to the nearest one', () => {
    expect(toPaletteHex('#2563EB')).toBe('#2563EB');
    expect(toPaletteHex('#2563eb')).toBe('#2563EB');
    expect(toPaletteHex('#1d4ed8')).toBe('#2563EB');
    expect(toPaletteHex('#7c3aed')).toBe('#7C3AED');
    expect(toPaletteHex('#0369a1')).toBe('#0891B2');
    expect(toPaletteHex('#0f766e')).toBe('#0D9488');
    expect(toPaletteHex('#15803d')).toBe('#16A34A');
    expect(toPaletteHex('#c2410c')).toBe('#EA580C');
    expect(toPaletteHex('#34495e')).toBe('#64748B');
    expect(nearestPaletteEntry('not a color').id).toBe('blue');
  });

  it('tells palette colors apart', () => {
    expect(isPaletteHex('#0d9488')).toBe(true);
    expect(isPaletteHex('#123456')).toBe(false);
  });
});
