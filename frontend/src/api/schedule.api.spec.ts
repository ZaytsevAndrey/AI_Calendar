import { jobPollDeadline } from './schedule.api';

describe('jobPollDeadline', () => {
  const deadline = Date.parse('2026-11-05T08:02:00.000Z');

  it('waits past a scheduled retry that lands after the deadline', () => {
    expect(
      jobPollDeadline(deadline, { status: 'pending', nextRunAt: '2026-11-05T08:04:00.000Z' }),
    ).toBe(Date.parse('2026-11-05T08:04:30.000Z'));
  });

  it('keeps the deadline when there is no retry or it is earlier', () => {
    // Well before the deadline a running job does not move it (pinned clock).
    expect(jobPollDeadline(deadline, { status: 'running', nextRunAt: '2026-11-05T08:04:00.000Z' }, deadline - 60_000)).toBe(
      deadline,
    );
    expect(jobPollDeadline(deadline, { status: 'pending', nextRunAt: null })).toBe(deadline);
    expect(jobPollDeadline(deadline, { status: 'pending', nextRunAt: '2026-11-05T08:00:00.000Z' })).toBe(
      deadline,
    );
  });
});

describe('jobPollDeadline while the job runs (AUD-019)', () => {
  const deadline = Date.parse('2026-11-05T08:02:00.000Z');

  it('keeps polling a running job past the deadline', () => {
    const now = Date.parse('2026-11-05T08:02:10.000Z');
    expect(jobPollDeadline(deadline, { status: 'running', nextRunAt: null }, now)).toBe(now + 30_000);
  });

  it('stops at the hard cap', () => {
    const now = Date.parse('2026-11-05T08:09:50.000Z');
    const hard = Date.parse('2026-11-05T08:10:00.000Z');
    expect(jobPollDeadline(deadline, { status: 'running', nextRunAt: null }, now, hard)).toBe(hard);
    expect(
      jobPollDeadline(deadline, { status: 'pending', nextRunAt: '2026-11-05T08:30:00.000Z' }, now, hard),
    ).toBe(hard);
  });
});
