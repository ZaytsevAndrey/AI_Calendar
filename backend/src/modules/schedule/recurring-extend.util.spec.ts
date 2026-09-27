import {
  RECURRING_EXTEND_MIN_INTERVAL_MS,
  shouldEnqueueRecurringExtend,
} from './recurring-extend.util';

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
