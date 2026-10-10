import {
  buildPreferredStartSlotOptions,
  getPhaseSchedulingTimeBounds,
  isPreferredStartOutsidePhaseWindow,
  mergeSavedPreferredStartIntoOptions,
} from './phaseSchedulingBounds';
import type { PhaseDTO } from '../../../api/phases.api';

function phase(partial: Partial<PhaseDTO> & Pick<PhaseDTO, 'startTime' | 'endTime'>): PhaseDTO {
  return {
    id: 'p1',
    name: 'Focus',
    color: '#000',
    type: 'time_phase',
    ...partial,
  } as PhaseDTO;
}

describe('phaseSchedulingBounds', () => {
  it('builds only in-window slots for a daytime phase', () => {
    const bounds = getPhaseSchedulingTimeBounds(phase({ startTime: '09:00', endTime: '12:00' }));
    const values = buildPreferredStartSlotOptions(bounds).map((o) => o.value);
    expect(values[0]).toBe('');
    expect(values).toContain('09:00');
    expect(values).toContain('12:00');
    expect(values).not.toContain('08:45');
    expect(values).not.toContain('12:15');
  });

  it('keeps overnight window slots and hides the gap', () => {
    const bounds = getPhaseSchedulingTimeBounds(phase({ startTime: '22:00', endTime: '06:00' }));
    expect(bounds?.overnight).toBe(true);
    const values = buildPreferredStartSlotOptions(bounds).map((o) => o.value);
    expect(values).toContain('22:00');
    expect(values).toContain('00:00');
    expect(values).toContain('06:00');
    expect(values).not.toContain('12:00');
    expect(isPreferredStartOutsidePhaseWindow('12:00', bounds)).toBe(true);
    expect(isPreferredStartOutsidePhaseWindow('23:00', bounds)).toBe(false);
  });

  it('does not merge an out-of-phase saved preferred start into options', () => {
    const bounds = getPhaseSchedulingTimeBounds(phase({ startTime: '09:00', endTime: '10:00' }));
    const base = buildPreferredStartSlotOptions(bounds);
    const merged = mergeSavedPreferredStartIntoOptions(base, '07:07', bounds);
    expect(merged.some((o) => o.value === '07:07')).toBe(false);
  });

  it('merges an odd in-phase saved preferred start', () => {
    const bounds = getPhaseSchedulingTimeBounds(phase({ startTime: '09:00', endTime: '10:00' }));
    const base = buildPreferredStartSlotOptions(bounds);
    const merged = mergeSavedPreferredStartIntoOptions(base, '09:07', bounds);
    expect(merged.some((o) => o.value === '09:07')).toBe(true);
  });
});
