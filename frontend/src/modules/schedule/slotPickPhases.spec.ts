import {
  phaseIdAtFocus,
  phaseWindowsForDay,
} from './slotPickPhases';
import type { PhaseDTO } from '../../api/phases.api';

function phase(
  partial: Partial<PhaseDTO> & Pick<PhaseDTO, 'id' | 'name' | 'startTime' | 'endTime'>,
): PhaseDTO {
  return {
    color: '#4a90e2',
    type: 'time_phase',
    createdAt: '',
    updatedAt: '',
    ...partial,
  };
}

describe('slotPickPhases', () => {
  const ymd = '2026-10-20'; // Tuesday
  const tz = 'UTC';

  it('builds windows and picks the phase under focus', () => {
    const windows = phaseWindowsForDay(
      [
        phase({ id: 'a', name: 'Morning', startTime: '09:00', endTime: '12:00' }),
        phase({ id: 'b', name: 'Afternoon', startTime: '13:00', endTime: '17:00' }),
      ],
      ymd,
      tz,
    );
    expect(windows).toHaveLength(2);
    expect(
      phaseIdAtFocus(windows, Date.parse('2026-10-20T10:30:00.000Z')),
    ).toBe('a');
    expect(
      phaseIdAtFocus(windows, Date.parse('2026-10-20T14:00:00.000Z')),
    ).toBe('b');
    expect(
      phaseIdAtFocus(windows, Date.parse('2026-10-20T12:30:00.000Z')),
    ).toBeNull();
  });

  it('ignores sleep_time phases', () => {
    const windows = phaseWindowsForDay(
      [
        phase({
          id: 'sleep',
          name: 'Sleep',
          startTime: '23:00',
          endTime: '07:00',
          type: 'sleep_time',
        }),
        phase({ id: 'work', name: 'Work', startTime: '09:00', endTime: '17:00' }),
      ],
      ymd,
      tz,
    );
    expect(windows.map((w) => w.id)).toEqual(['work']);
  });
});
