import { applyConflictOption } from './applyConflictOption';
import type { SchedulingConflictDTO } from './conflictChoiceBus';

describe('applyConflictOption', () => {
  const conflict: SchedulingConflictDTO = {
    taskId: 't1',
    taskName: 'Deep work',
    reason: 'preferred_on_fixed',
    options: ['move_new', 'skip_occurrence', 'leave_problematic'],
    meta: { preferredStart: '2026-04-20T09:00:00.000Z' },
  };

  it('leave_problematic parks the task', async () => {
    const updateTask = jest.fn().mockResolvedValue({});
    const skipOccurrence = jest.fn();
    await applyConflictOption(conflict, 'leave_problematic', {
      updateTask,
      skipOccurrence,
      timeZone: 'UTC',
    });
    expect(updateTask).toHaveBeenCalledWith('t1', {
      scheduleState: 'problematic',
      problematicReason: 'preferred_on_fixed',
      problematicOccurrenceYmds: ['2026-04-20'],
      problematicOriginalStart: '2026-04-20T09:00:00.000Z',
    });
    expect(skipOccurrence).not.toHaveBeenCalled();
  });

  it('move_new clears preferred and unparks', async () => {
    const updateTask = jest.fn().mockResolvedValue({});
    await applyConflictOption(conflict, 'move_new', {
      updateTask,
      skipOccurrence: jest.fn(),
      timeZone: 'UTC',
    });
    expect(updateTask).toHaveBeenCalledWith('t1', {
      scheduleState: 'none',
      scheduledStartTime: null,
      scheduledEndTime: null,
    });
  });

  it('skip_occurrence skips then unparks', async () => {
    const updateTask = jest.fn().mockResolvedValue({});
    const skipOccurrence = jest.fn().mockResolvedValue({});
    await applyConflictOption(conflict, 'skip_occurrence', {
      updateTask,
      skipOccurrence,
      timeZone: 'UTC',
    });
    expect(skipOccurrence).toHaveBeenCalledWith('t1', {
      occurrenceStart: '2026-04-20T09:00:00.000Z',
    });
    expect(updateTask).toHaveBeenCalledWith('t1', { scheduleState: 'none' });
  });

  it('place_on_top seats as resolved on the preferred slot', async () => {
    const updateTask = jest.fn().mockResolvedValue({});
    const withEnd: SchedulingConflictDTO = {
      ...conflict,
      meta: {
        preferredStart: '2026-04-20T09:00:00.000Z',
        preferredEnd: '2026-04-20T10:00:00.000Z',
      },
    };
    await applyConflictOption(withEnd, 'place_on_top', {
      updateTask,
      skipOccurrence: jest.fn(),
      timeZone: 'UTC',
    });
    expect(updateTask).toHaveBeenCalledWith('t1', {
      scheduleState: 'resolved',
      problematicReason: 'preferred_on_fixed',
      problematicOccurrenceYmds: ['2026-04-20'],
      problematicOriginalStart: '2026-04-20T09:00:00.000Z',
      problematicOriginalEnd: '2026-04-20T10:00:00.000Z',
      scheduledStartTime: '2026-04-20T09:00:00.000Z',
      scheduledEndTime: '2026-04-20T10:00:00.000Z',
    });
  });

  it('skips a bare day at local noon in the settings zone', async () => {
    const skipOccurrence = jest.fn().mockResolvedValue({});
    await applyConflictOption(
      { ...conflict, meta: { occurrenceYmd: '2026-04-20' } },
      'skip_occurrence',
      { updateTask: jest.fn(), skipOccurrence, timeZone: 'Pacific/Kiritimati' },
    );
    expect(skipOccurrence).toHaveBeenCalledWith('t1', {
      occurrenceStart: '2026-04-20T12:00:00+14:00',
    });
  });
});
