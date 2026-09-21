import {
  addSkippedOccurrenceYmd,
  excludeStartsForSkippedYmds,
  googleRecurringInstanceId,
  isOccurrenceYmdSkipped,
  matchScheduledSlotIndex,
  normalizeSkippedOccurrenceYmds,
} from './skipped-occurrence.util';

describe('skipped-occurrence.util', () => {
  it('normalizes unique YYYY-MM-DD values', () => {
    expect(
      normalizeSkippedOccurrenceYmds(['2026-09-21', 'bad', '2026-09-21', 1]),
    ).toEqual(['2026-09-21']);
  });

  it('adds a skipped civil day without duplicates', () => {
    expect(addSkippedOccurrenceYmd(['2026-09-21'], '2026-09-21')).toEqual([
      '2026-09-21',
    ]);
    expect(addSkippedOccurrenceYmd(null, '2026-09-22')).toEqual(['2026-09-22']);
    expect(isOccurrenceYmdSkipped(['2026-09-22'], '2026-09-22')).toBe(true);
    expect(isOccurrenceYmdSkipped(['2026-09-22'], '2026-09-23')).toBe(false);
  });

  it('matches a slot that contains the occurrence start', () => {
    const rows = [
      {
        scheduledStartTime: '2026-09-21T10:00:00.000Z',
        scheduledEndTime: '2026-09-21T10:30:00.000Z',
      },
      {
        scheduledStartTime: '2026-09-22T10:00:00.000Z',
        scheduledEndTime: '2026-09-22T10:30:00.000Z',
      },
    ];
    expect(
      matchScheduledSlotIndex(rows, new Date('2026-09-22T10:05:00.000Z')),
    ).toBe(1);
    expect(
      matchScheduledSlotIndex(rows, new Date('2026-09-21T10:00:00.000Z')),
    ).toBe(0);
    expect(
      matchScheduledSlotIndex(rows, new Date('2026-09-23T10:00:00.000Z')),
    ).toBe(-1);
  });

  it('builds a Google instance id from the master and UTC start', () => {
    expect(
      googleRecurringInstanceId(
        'series-1',
        new Date('2026-09-21T06:00:00.000Z'),
      ),
    ).toBe('series-1_20260921T060000Z');
  });

  it('builds EXDATE instants for skipped days inside the series window', () => {
    const starts = excludeStartsForSkippedYmds({
      skippedYmds: ['2026-09-23', '2026-09-20'],
      firstStart: new Date('2026-09-21T06:00:00.000Z'),
      lastStart: new Date('2026-09-25T06:00:00.000Z'),
      timeZone: 'UTC',
      placedYmds: ['2026-09-21', '2026-09-22', '2026-09-24', '2026-09-25'],
    });
    expect(starts.map((d) => d.toISOString())).toEqual([
      '2026-09-23T06:00:00.000Z',
    ]);
  });
});
