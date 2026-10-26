import { buildUnscheduledIconMeta } from './unscheduledCardMeta';

describe('buildUnscheduledIconMeta', () => {
  it('includes phase and earliest start, and skips a due date', () => {
    expect(
      buildUnscheduledIconMeta({
        phaseName: 'Deep work',
        phaseColor: '#112233',
        earliestFormatted: '1 Jan 2026, 09:00',
        fromLabel: (time) => `From ${time}`,
      }),
    ).toEqual([
      { id: 'phase', label: 'Deep work', tone: 'phase', color: '#112233' },
      { id: 'earliest', label: 'From 1 Jan 2026, 09:00', tone: 'none' },
    ]);
  });

  it('skips blank phase and missing earliest', () => {
    expect(
      buildUnscheduledIconMeta({
        phaseName: '  ',
        earliestFormatted: null,
        fromLabel: (time) => `From ${time}`,
      }),
    ).toEqual([]);
  });
});
