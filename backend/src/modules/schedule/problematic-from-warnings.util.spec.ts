import {
  collectParkDayHints,
  collectProblematicParks,
  collectProblematicTaskIds,
} from './problematic-from-warnings.util';
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

describe('collectProblematicParks', () => {
  it('extracts overflow skip days and reason for recurring', () => {
    const warnings: SchedulingWarning[] = [
      {
        code: SchedulingWarningCode.OCCURRENCE_SKIPPED,
        taskId: 'r1',
        message: 'skip',
        meta: {
          readyForProblematic: true,
          skipped: [
            { date: 'Apr 21', dateKey: '2026-04-21', reason: 'no_slot' },
            {
              date: 'Apr 22',
              dateKey: '2026-04-22',
              reason: 'preferred_unavailable',
            },
            { date: 'Apr 20', dateKey: '2026-04-20', reason: 'already_passed' },
          ],
        },
      },
    ];

    const parks = collectProblematicParks(warnings);
    expect(parks.get('r1')).toEqual({
      occurrenceYmds: ['2026-04-21', '2026-04-22'],
      reason: 'no_slot',
    });
  });

  it('uses phase_full reason and fallback ymd for one-off overflow', () => {
    const warnings: SchedulingWarning[] = [
      {
        code: SchedulingWarningCode.OCCURRENCE_SKIPPED,
        taskId: 'o1',
        message: 'full',
        meta: {
          readyForProblematic: true,
          reason: 'phase_full',
        },
      },
    ];

    const parks = collectProblematicParks(warnings, [], '2026-09-27');
    expect(parks.get('o1')).toEqual({
      occurrenceYmds: ['2026-09-27'],
      reason: 'phase_full',
    });
  });

  it('reads occurrenceYmd from meta when present', () => {
    const warnings: SchedulingWarning[] = [
      {
        code: SchedulingWarningCode.OCCURRENCE_SKIPPED,
        taskId: 'o2',
        message: 'day',
        meta: {
          readyForProblematic: true,
          occurrenceYmd: '2026-05-01',
          reason: 'conflict',
        },
      },
    ];

    expect(collectProblematicParks(warnings).get('o2')).toEqual({
      occurrenceYmds: ['2026-05-01'],
      reason: 'conflict',
    });
  });
});

describe('collectParkDayHints', () => {
  it('includes conflict-choice occurrence days without auto-parking', () => {
    const warnings: SchedulingWarning[] = [
      {
        code: SchedulingWarningCode.NEEDS_CONFLICT_CHOICE,
        taskId: 'c1',
        message: 'ask',
        meta: {
          readyForProblematic: true,
          occurrenceYmd: '2026-04-22',
          reason: 'preferred_on_fixed',
        },
      },
    ];
    const conflicts: SchedulingConflict[] = [
      {
        taskId: 'c1',
        taskName: 'C',
        reason: 'preferred_on_fixed',
        options: ['move_new', 'leave_problematic'],
        meta: {
          occurrenceYmd: '2026-04-22',
          skipped: [
            {
              date: 'Apr 22',
              dateKey: '2026-04-22',
              reason: 'preferred_unavailable',
            },
            {
              date: 'Apr 23',
              dateKey: '2026-04-23',
              reason: 'preferred_unavailable',
            },
          ],
        },
      },
    ];

    expect([...collectProblematicTaskIds(warnings, conflicts)]).toEqual([]);
    expect(collectParkDayHints(warnings, conflicts).get('c1')).toEqual({
      occurrenceYmds: ['2026-04-22', '2026-04-23'],
      reason: 'preferred_on_fixed',
    });
  });
});
