import { phaseColor, phasePaletteHex, phasePaletteId, PHASE_PALETTE } from './phasePalette';

describe('phase palette', () => {
    it('matches the stored hex exactly and maps old colors to the nearest', () => {
        expect(phasePaletteId('#2563EB')).toBe('blue');
        expect(phasePaletteId('#1d4ed8')).toBe('blue');
        expect(phasePaletteId('#0369a1')).toBe('cyan');
        expect(phasePaletteId('#c2410c')).toBe('orange');
        expect(phasePaletteId(undefined)).toBe('slate');
        expect(phasePaletteHex('teal')).toBe('#0D9488');
    });

    it('draws through the theme variable', () => {
        expect(phaseColor('#7C3AED')).toBe('rgb(var(--ph-violet))');
        expect(phaseColor('#7C3AED', 0.2)).toBe('rgb(var(--ph-violet) / 0.2)');
    });

    it('agrees with the backend palette', () => {
        expect(PHASE_PALETTE.map((p) => p.hex)).toEqual([
            '#2563EB', '#7C3AED', '#0D9488', '#16A34A', '#D97706',
            '#EA580C', '#E11D48', '#DB2777', '#0891B2', '#64748B',
        ]);
    });
});
