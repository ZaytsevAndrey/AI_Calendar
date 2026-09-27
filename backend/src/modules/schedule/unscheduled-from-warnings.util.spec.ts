import { collectUnscheduledTaskIds } from './unscheduled-from-warnings.util';
import { SchedulingWarningCode } from './intelligent-scheduling.engine';

describe('collectUnscheduledTaskIds', () => {
  it('collects deadline-no-fit warnings only', () => {
    const ids = collectUnscheduledTaskIds([
      {
        code: SchedulingWarningCode.OCCURRENCE_SKIPPED,
        taskId: 'a',
        message: 'deadline',
        meta: { readyForUnscheduled: true, readyForProblematic: false },
      },
      {
        code: SchedulingWarningCode.OCCURRENCE_SKIPPED,
        taskId: 'b',
        message: 'overflow',
        meta: { readyForUnscheduled: false, readyForProblematic: true },
      },
      {
        code: SchedulingWarningCode.NEEDS_CONFLICT_CHOICE,
        taskId: 'c',
        message: 'conflict',
        meta: { readyForUnscheduled: true },
      },
    ]);
    expect([...ids]).toEqual(['a']);
  });
});
