import { planDisplayedEventMove, MoveSlotRef, MoveTaskRef } from './move-displayed-event.util';

const flexible: MoveTaskRef = {
  id: 'task-flex',
  eventType: 'admin',
  isRecurring: false,
  googleEventId: 'evt-flex',
};

const fixed: MoveTaskRef = {
  id: 'task-fixed',
  eventType: 'fixed',
  isRecurring: false,
  googleEventId: 'evt-fixed',
};

const recurring: MoveTaskRef = {
  id: 'task-rec',
  eventType: 'admin',
  isRecurring: true,
  googleEventId: 'master-1',
};

function slot(partial: Partial<MoveSlotRef> & Pick<MoveSlotRef, 'id' | 'taskId'>): MoveSlotRef {
  return {
    googleEventId: null,
    scheduledStartTime: '2026-09-22T09:00:00.000Z',
    ...partial,
  };
}

describe('planDisplayedEventMove', () => {
  it('rejects a habit block', () => {
    expect(
      planDisplayedEventMove({
        googleEventId: 'habit-evt',
        originalStartIso: '2026-09-22T09:00:00.000Z',
        isHabit: true,
        tasks: [],
        slots: [],
      }).kind,
    ).toBe('rejected');
  });

  it('updates a non-recurring fixed task instead of a generated slot', () => {
    expect(
      planDisplayedEventMove({
        googleEventId: 'evt-fixed',
        originalStartIso: '2026-09-22T09:00:00.000Z',
        isHabit: false,
        tasks: [fixed],
        slots: [slot({ id: 'slot-1', taskId: fixed.id, googleEventId: 'evt-fixed' })],
      }),
    ).toEqual({ kind: 'fixed', taskId: 'task-fixed' });
  });

  it('matches a one-off slot by its Google event id and keeps the task window in sync', () => {
    expect(
      planDisplayedEventMove({
        googleEventId: 'evt-flex',
        originalStartIso: '2026-09-22T09:00:00.000Z',
        isHabit: false,
        tasks: [flexible],
        slots: [slot({ id: 'slot-flex', taskId: flexible.id, googleEventId: 'evt-flex' })],
      }),
    ).toEqual({
      kind: 'slot',
      slotId: 'slot-flex',
      taskId: 'task-flex',
      updateTaskWindow: true,
    });
  });

  it('matches one recurring occurrence by the original start and does not move the series window', () => {
    const plan = planDisplayedEventMove({
      googleEventId: 'master-1_20260923T090000Z',
      recurringEventId: 'master-1',
      originalStartIso: '2026-09-23T09:00:00.000Z',
      isHabit: false,
      tasks: [recurring],
      slots: [
        slot({
          id: 'tue',
          taskId: recurring.id,
          googleEventId: 'master-1',
          scheduledStartTime: '2026-09-22T09:00:00.000Z',
        }),
        slot({
          id: 'wed',
          taskId: recurring.id,
          googleEventId: 'master-1',
          scheduledStartTime: '2026-09-23T09:00:00.000Z',
        }),
      ],
    });
    expect(plan).toEqual({
      kind: 'slot',
      slotId: 'wed',
      taskId: 'task-rec',
      updateTaskWindow: false,
    });
  });

  it('patches Google only when the event is not an app task', () => {
    expect(
      planDisplayedEventMove({
        googleEventId: 'external-1',
        originalStartIso: '2026-09-22T09:00:00.000Z',
        isHabit: false,
        tasks: [flexible],
        slots: [],
      }),
    ).toEqual({ kind: 'google' });
  });
});
