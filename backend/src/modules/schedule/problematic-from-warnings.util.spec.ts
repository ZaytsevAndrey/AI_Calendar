import { collectProblematicTaskIds } from './problematic-from-warnings.util';
import {
  SchedulingConflict,
  SchedulingWarning,
  SchedulingWarningCode,
} from './intelligent-scheduling.engine';

describe('collectProblematicTaskIds', () => {
  it('parks overflow warnings but not conflict-choice ids', () => {
    const warnings: SchedulingWarning[] = [
      {
        code: SchedulingWarningCode.OCCURRENCE_SKIPPED,
        taskId: 'a',
        message: 'skip',
        meta: { readyForProblematic: true },
      },
      {
        code: SchedulingWarningCode.OUTSIDE_HORIZON,
        taskId: 'b',
        message: 'horizon',
        meta: { readyForProblematic: false },
      },
      {
        code: SchedulingWarningCode.NEEDS_CONFLICT_CHOICE,
        taskId: 'c',
        message: 'ask',
        meta: { readyForProblematic: true },
      },
    ];
    const conflicts: SchedulingConflict[] = [
      {
        taskId: 'd',
        taskName: 'D',
        reason: 'preferred_on_fixed',
        options: ['move_new', 'leave_problematic'],
      },
    ];

    expect([...collectProblematicTaskIds(warnings, conflicts)]).toEqual(['a']);
  });
});
