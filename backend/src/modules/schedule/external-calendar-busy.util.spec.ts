import { providerEventsToBusyIntervals } from './external-calendar-busy.util';

describe('providerEventsToBusyIntervals', () => {
  const timed = (
    id: string,
    start: string,
    end: string,
    extra: Record<string, unknown> = {},
  ) => ({
    id,
    summary: id,
    start: { dateTime: start },
    end: { dateTime: end },
    ...extra,
  });

  it('treats timed events from any provider as busy', () => {
    const busy = providerEventsToBusyIntervals(
      [
        timed('g', '2026-10-17T09:00:00.000Z', '2026-10-17T10:00:00.000Z'),
        timed('m', '2026-10-17T11:00:00.000Z', '2026-10-17T12:00:00.000Z', {
          summary: 'Outlook',
        }),
        timed('a', '2026-10-17T13:00:00.000Z', '2026-10-17T14:00:00.000Z', {
          summary: 'iCloud',
        }),
      ],
      { timeZone: 'UTC' },
    );
    expect(busy.map((iv) => iv.label)).toEqual(['g', 'Outlook', 'iCloud']);
    expect(busy[1]).toMatchObject({
      start: Date.parse('2026-10-17T11:00:00.000Z'),
      end: Date.parse('2026-10-17T12:00:00.000Z'),
    });
  });

  it('skips cancelled, free, and the app’s own synced events', () => {
    const busy = providerEventsToBusyIntervals(
      [
        timed('gone', '2026-10-17T09:00:00.000Z', '2026-10-17T10:00:00.000Z', {
          status: 'cancelled',
        }),
        timed('free', '2026-10-17T10:00:00.000Z', '2026-10-17T11:00:00.000Z', {
          transparency: 'transparent',
        }),
        timed('ours', '2026-10-17T11:00:00.000Z', '2026-10-17T12:00:00.000Z', {
          recurringEventId: 'series-1',
        }),
        timed('keep', '2026-10-17T12:00:00.000Z', '2026-10-17T13:00:00.000Z'),
      ],
      { timeZone: 'UTC', excludeIds: new Set(['series-1']) },
    );
    expect(busy.map((iv) => iv.label)).toEqual(['keep']);
  });

  it('includes all-day events only when asked', () => {
    const allDay = {
      id: 'day',
      summary: 'Offsite',
      start: { date: '2026-10-17' },
      end: { date: '2026-10-18' },
    };
    expect(
      providerEventsToBusyIntervals([allDay], { timeZone: 'UTC' }),
    ).toEqual([]);
    const busy = providerEventsToBusyIntervals([allDay], {
      timeZone: 'UTC',
      includeAllDay: true,
    });
    expect(busy).toHaveLength(1);
    expect(busy[0].end).toBeGreaterThan(busy[0].start);
    expect(busy[0].label).toBe('Offsite');
  });
});
