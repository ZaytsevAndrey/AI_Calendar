import { buildDoNowPatch } from './unscheduledActions';

describe('buildDoNowPatch', () => {
  it('clears unscheduled and opens a from-now window for the civil day', () => {
    const now = new Date('2026-09-22T10:00:00.000Z');
    const body = buildDoNowPatch('Europe/Kyiv', now);
    expect(body.isUnscheduled).toBe(false);
    expect(body.earliestStartTime).toBe(now.toISOString());
    expect(body.deadline).toContain('2026-09-22');
    expect(body.scheduledStartTime).toBeNull();
    expect(body.scheduledEndTime).toBeNull();
  });
});
