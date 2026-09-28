import { parkDayHintsFromJobResult, ymdsFromParkMeta } from './parkDayHints';

describe('ymdsFromParkMeta', () => {
  it('reads skipped dateKeys and occurrenceYmd', () => {
    expect(
      ymdsFromParkMeta({
        occurrenceYmd: '2026-04-21',
        skipped: [
          { dateKey: '2026-04-22', reason: 'no_slot' },
          { dateKey: '2026-04-20', reason: 'already_passed' },
        ],
      }),
    ).toEqual(['2026-04-21', '2026-04-22']);
  });
});

describe('parkDayHintsFromJobResult', () => {
  it('merges warning and conflict days per task', () => {
    const hints = parkDayHintsFromJobResult({
      warnings: [
        {
          taskId: 't1',
          code: 'OCCURRENCE_SKIPPED',
          meta: {
            skipped: [{ dateKey: '2026-04-21', reason: 'no_slot' }],
            reason: 'no_slot',
          },
        },
      ],
      conflicts: [
        {
          taskId: 't1',
          reason: 'preferred_on_fixed',
          meta: { occurrenceYmd: '2026-04-22' },
        },
      ],
    });
    expect(hints.t1).toEqual({
      occurrenceYmds: ['2026-04-21', '2026-04-22'],
      reason: 'no_slot',
    });
  });
});
