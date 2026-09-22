import { describeScheduleMove, previewMessages } from './generatePreview';
import { ScheduleJobResultPayload } from '../../api/schedule.api';

describe('describeScheduleMove', () => {
  const slot = {
    start: '2026-04-20T09:00:00.000Z',
    end: '2026-04-20T10:00:00.000Z',
  };

  it('describes a new placement', () => {
    expect(
      describeScheduleMove({
        taskId: '1',
        taskName: 'Write',
        before: [],
        after: [slot],
      }),
    ).toMatch(/^Will place /);
  });

  it('describes removal of open blocks', () => {
    expect(
      describeScheduleMove({
        taskId: '1',
        taskName: 'Write',
        before: [slot],
        after: [],
      }),
    ).toBe('Will remove open blocks');
  });

  it('describes a move between block counts', () => {
    expect(
      describeScheduleMove({
        taskId: '1',
        taskName: 'Write',
        before: [slot],
        after: [slot, { start: '2026-04-21T09:00:00.000Z', end: '2026-04-21T10:00:00.000Z' }],
      }),
    ).toMatch(/^1 block → 2 blocks, first /);
  });
});

describe('previewMessages', () => {
  it('keeps engine errors and warnings and drops duplicates', () => {
    const result: ScheduleJobResultPayload = {
      diff: [],
      errors: [
        { taskId: 'a', message: 'Cannot fit "A" in the available window.' },
        { taskId: 'a2', message: 'Cannot fit "A" in the available window.' },
      ],
      warnings: [
        {
          code: 'SCHEDULING_HORIZON_EXCEEDED',
          message: 'Task "B" was placed outside the 30-day window.',
        },
      ],
    };
    expect(previewMessages(result)).toEqual({
      errors: ['Cannot fit "A" in the available window.'],
      warnings: ['Task "B" was placed outside the 30-day window.'],
    });
  });
});
