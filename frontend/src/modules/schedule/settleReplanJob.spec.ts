import {
  mutationStageFromJob,
  recurringMovedNamesFromJobResult,
} from './settleReplanJob';

describe('mutationStageFromJob', () => {
  it('maps job progress and terminal status', () => {
    expect(
      mutationStageFromJob({ status: 'running', progressStage: 'placing' }),
    ).toBe('placing');
    expect(mutationStageFromJob({ status: 'done', progressStage: 'syncing' })).toBe(
      'done',
    );
    expect(mutationStageFromJob({ status: 'failed', progressStage: null })).toBe(
      'error',
    );
  });
});

describe('recurringMovedNamesFromJobResult', () => {
  it('returns names for RECURRING_MOVED warnings', () => {
    expect(
      recurringMovedNamesFromJobResult({
        warnings: [
          { code: 'SCHEDULING_RECURRING_MOVED', taskName: 'Standup' },
          { code: 'OTHER', taskName: 'Skip me' },
          { code: 'SCHEDULING_RECURRING_MOVED', message: 'Weekly review shifted' },
        ],
      }),
    ).toEqual(['Standup', 'Weekly review shifted']);
  });

  it('returns empty for missing result', () => {
    expect(recurringMovedNamesFromJobResult(null)).toEqual([]);
    expect(recurringMovedNamesFromJobResult({})).toEqual([]);
  });
});
