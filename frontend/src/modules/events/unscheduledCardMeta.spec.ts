import { buildUnscheduledIconMeta } from './unscheduledCardMeta';

describe('buildUnscheduledIconMeta', () => {
  const labels = {
    fromLabel: (time: string) => `From ${time}`,
    dueLabel: (when: string) => `Due ${when}`,
    overduePrefix: 'Overdue · ',
    dueSoonPrefix: 'Due soon · ',
    approachingPrefix: 'Approaching · ',
  };

  it('includes phase, earliest, and deadline when present', () => {
    expect(
      buildUnscheduledIconMeta({
        phaseName: 'Deep work',
        phaseColor: '#112233',
        earliestFormatted: '1 Jan 2026, 09:00',
        deadlineFormatted: '2 Jan 2026, 18:00',
        tone: 'none',
        ...labels,
      }),
    ).toEqual([
      { id: 'phase', label: 'Deep work', tone: 'phase', color: '#112233' },
      { id: 'earliest', label: 'From 1 Jan 2026, 09:00', tone: 'none' },
      { id: 'deadline', label: 'Due 2 Jan 2026, 18:00', tone: 'none' },
    ]);
  });

  it('marks overdue deadlines and skips empty fields', () => {
    expect(
      buildUnscheduledIconMeta({
        phaseName: '  ',
        earliestFormatted: null,
        deadlineFormatted: '1 Jan 2026, 08:00',
        tone: 'overdue',
        ...labels,
      }),
    ).toEqual([
      {
        id: 'deadline',
        label: 'Overdue · Due 1 Jan 2026, 08:00',
        tone: 'overdue',
      },
    ]);
  });
});
