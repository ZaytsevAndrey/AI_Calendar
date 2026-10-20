import {
  lastContinuingSeriesIds,
  RECURRING_EXTEND_MIN_INTERVAL_MS,
  shouldEnqueueRecurringExtend,
} from './recurring-extend.util';

describe('lastContinuingSeriesIds', () => {
  it('extends only the segment whose last seat is latest', () => {
    const ids = lastContinuingSeriesIds(
      [
        {
          id: 'old',
          seriesGroupId: 'group',
          scheduledStartTime: '2026-10-01T09:00:00.000Z',
          scheduledEndTime: '2026-10-01T09:30:00.000Z',
        },
        {
          id: 'tail',
          seriesGroupId: 'group',
          scheduledStartTime: '2026-10-10T11:00:00.000Z',
          scheduledEndTime: '2026-10-10T11:30:00.000Z',
        },
        {
          id: 'other',
          seriesGroupId: null,
          scheduledStartTime: '2026-10-02T08:00:00.000Z',
          scheduledEndTime: '2026-10-02T08:30:00.000Z',
        },
      ],
      new Map([
        ['old', Date.parse('2026-10-09T09:30:00.000Z')],
        ['tail', Date.parse('2026-11-01T11:30:00.000Z')],
        ['other', Date.parse('2026-10-20T08:30:00.000Z')],
      ]),
    );
    expect([...ids].sort()).toEqual(['other', 'tail']);
  });
});

describe('shouldEnqueueRecurringExtend', () => {
  const now = new Date('2026-09-27T12:00:00.000Z');

  it('skips users without active recurring work', () => {
    expect(
      shouldEnqueueRecurringExtend({
        hasActiveRecurring: false,
        hasPendingOrRunningJob: false,
        lastExtendAt: null,
        now,
      }),
    ).toBe(false);
  });

  it('skips when a job is already queued or running', () => {
    expect(
      shouldEnqueueRecurringExtend({
        hasActiveRecurring: true,
        hasPendingOrRunningJob: true,
        lastExtendAt: null,
        now,
      }),
    ).toBe(false);
  });

  it('enqueues when never extended', () => {
    expect(
      shouldEnqueueRecurringExtend({
        hasActiveRecurring: true,
        hasPendingOrRunningJob: false,
        lastExtendAt: null,
        now,
      }),
    ).toBe(true);
  });

  it('respects the cooldown window', () => {
    expect(
      shouldEnqueueRecurringExtend({
        hasActiveRecurring: true,
        hasPendingOrRunningJob: false,
        lastExtendAt: new Date(now.getTime() - RECURRING_EXTEND_MIN_INTERVAL_MS + 60_000),
        now,
      }),
    ).toBe(false);
    expect(
      shouldEnqueueRecurringExtend({
        hasActiveRecurring: true,
        hasPendingOrRunningJob: false,
        lastExtendAt: new Date(now.getTime() - RECURRING_EXTEND_MIN_INTERVAL_MS),
        now,
      }),
    ).toBe(true);
  });
});
