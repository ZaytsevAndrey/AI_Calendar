import { jobPollDeadline } from './schedule.api';

describe('jobPollDeadline', () => {
  const deadline = Date.parse('2026-11-05T08:02:00.000Z');

  it('waits past a scheduled retry that lands after the deadline', () => {
    expect(
      jobPollDeadline(deadline, { status: 'pending', nextRunAt: '2026-11-05T08:04:00.000Z' }),
    ).toBe(Date.parse('2026-11-05T08:04:30.000Z'));
  });

  it('keeps the deadline when there is no retry or it is earlier', () => {
    expect(jobPollDeadline(deadline, { status: 'running', nextRunAt: '2026-11-05T08:04:00.000Z' })).toBe(
      deadline,
    );
    expect(jobPollDeadline(deadline, { status: 'pending', nextRunAt: null })).toBe(deadline);
    expect(jobPollDeadline(deadline, { status: 'pending', nextRunAt: '2026-11-05T08:00:00.000Z' })).toBe(
      deadline,
    );
  });
});
