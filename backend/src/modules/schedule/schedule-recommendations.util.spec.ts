import {
  clockHm,
  formatInTimeZone,
  parseScheduleRecommendations,
} from './schedule-recommendations.util';

describe('schedule recommendation parsing', () => {
  const allowed = new Set(['task-1']);

  it('keeps known kinds and drops invented task ids', () => {
    const parsed = parseScheduleRecommendations(
      JSON.stringify({
        summary: 'Tighten Thursday.',
        suggestions: [
          {
            kind: 'deadline_risk',
            title: 'Report',
            detail: 'The report deadline is tomorrow and it is still unscheduled.',
            taskId: 'task-1',
          },
          {
            kind: 'overload',
            title: 'Invented',
            detail: 'This task does not exist.',
            taskId: 'nope',
          },
          {
            kind: 'gap',
            title: 'Morning',
            detail: 'Tuesday morning is open.',
            taskId: null,
          },
        ],
      }),
      allowed,
    );

    expect(parsed?.summary).toBe('Tighten Thursday.');
    expect(parsed?.suggestions).toEqual([
      {
        kind: 'deadline_risk',
        title: 'Report',
        detail: 'The report deadline is tomorrow and it is still unscheduled.',
        taskId: 'task-1',
      },
      {
        kind: 'gap',
        title: 'Morning',
        detail: 'Tuesday morning is open.',
        taskId: null,
      },
    ]);
  });

  it('returns null when the model reply is not JSON', () => {
    expect(parseScheduleRecommendations('not-json', allowed)).toBeNull();
  });

  it('formats clocks in the settings time zone', () => {
    expect(clockHm('07:00:00')).toBe('07:00');
    expect(formatInTimeZone(new Date('2026-09-22T07:30:00.000Z'), 'UTC')).toBe(
      '2026-09-22 07:30',
    );
  });
});
