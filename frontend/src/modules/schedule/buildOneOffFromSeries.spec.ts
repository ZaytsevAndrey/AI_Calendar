import { buildOneOffFromSeries, occurrenceStartIsoForYmd } from './buildOneOffFromSeries';
import type { TaskDTO } from 'api/tasks.api';

const series = {
  id: 's1',
  name: 'Gym',
  description: 'lift',
  phaseId: 'p1',
  estimatedTimeInMinutes: 45,
  isRecurring: true,
  recurrencePattern: 'WEEKLY',
  recurrenceWeekDays: [1, 3],
  allowSplit: true,
  priority: 'medium',
  status: 'todo',
  scheduleTimeZone: 'UTC',
  location: 'Hall',
  createdAt: '',
  updatedAt: '',
} as TaskDTO;

describe('buildOneOffFromSeries', () => {
  it('builds a fixed non-recurring clone for the day', () => {
    const dto = buildOneOffFromSeries(series, '2026-04-21', 'UTC', '09:30');
    expect(dto).toMatchObject({
      name: 'Gym',
      description: 'lift',
      phaseId: 'p1',
      eventType: 'fixed',
      isRecurring: false,
      allowSplit: false,
      isProblematic: false,
      estimatedTimeInMinutes: 45,
      location: 'Hall',
    });
    expect(dto.scheduledStartTime).toContain('2026-04-21');
    expect(dto.scheduledStartTime).toContain('09:30');
    expect(dto.recurrenceWeekDays).toEqual([]);
  });

  it('honors phase override and place day', () => {
    const dto = buildOneOffFromSeries(
      series,
      '2026-04-22',
      'UTC',
      '14:00',
      'phase-other',
    );
    expect(dto.phaseId).toBe('phase-other');
    expect(dto.phaseIds).toEqual(['phase-other']);
    expect(dto.scheduledStartTime).toContain('2026-04-22');
    expect(dto.scheduledStartTime).toContain('14:00');
  });
});

describe('occurrenceStartIsoForYmd', () => {
  it('returns noon on the civil day in the zone', () => {
    expect(occurrenceStartIsoForYmd('2026-04-21', 'UTC')).toBe(
      '2026-04-21T12:00:00+00:00',
    );
  });
});
