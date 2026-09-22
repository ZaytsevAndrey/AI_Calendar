import { BadRequestException } from '@nestjs/common';
import { DisplayedEventMoveService } from './displayed-event-move.service';

describe('DisplayedEventMoveService', () => {
  const userId = 'user-1';
  const dto = {
    googleEventId: 'evt-1',
    calendarId: 'primary',
    originalStart: '2026-09-22T09:00:00.000Z',
    originalEnd: '2026-09-22T10:00:00.000Z',
    start: '2026-09-22T11:00:00.000Z',
    end: '2026-09-22T12:00:00.000Z',
  };

  function service(opts: {
    habit?: boolean;
    tasks?: Record<string, unknown>[];
    slots?: Record<string, unknown>[];
    patch?: jest.Mock;
    updateTask?: jest.Mock;
    updateSlot?: jest.Mock;
    updateWindow?: jest.Mock;
  }) {
    const patch =
      opts.patch ?? jest.fn().mockResolvedValue(undefined);
    const updateTask = opts.updateTask ?? jest.fn().mockResolvedValue({});
    const updateSlot = opts.updateSlot ?? jest.fn().mockResolvedValue({});
    const updateWindow = opts.updateWindow ?? jest.fn().mockResolvedValue(undefined);
    const slots = opts.slots ?? [];
    const move = new DisplayedEventMoveService(
      {
        createQueryBuilder: () => ({
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue(slots),
        }),
      } as never,
      { update: updateWindow } as never,
      {
        findOne: jest.fn().mockResolvedValue(opts.habit ? { id: 'habit' } : null),
      } as never,
      {
        findAll: jest.fn().mockResolvedValue(opts.tasks ?? []),
        update: updateTask,
      } as never,
      { update: updateSlot } as never,
      { patchEventTimes: patch } as never,
    );
    return { move, patch, updateTask, updateSlot, updateWindow };
  }

  it('does not change a habit block', async () => {
    const { move, patch } = service({ habit: true });
    await expect(move.move(userId, dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(patch).not.toHaveBeenCalled();
  });

  it('writes a fixed task through task update and does not patch Google itself', async () => {
    const { move, patch, updateTask } = service({
      tasks: [
        {
          id: 'task-fixed',
          eventType: 'fixed',
          isRecurring: false,
          googleEventId: 'evt-1',
        },
      ],
    });
    await expect(move.move(userId, dto)).resolves.toEqual({ kind: 'fixed' });
    expect(updateTask).toHaveBeenCalledWith('task-fixed', userId, {
      scheduledStartTime: '2026-09-22T11:00:00.000Z',
      scheduledEndTime: '2026-09-22T12:00:00.000Z',
      estimatedTimeInMinutes: 60,
    });
    expect(patch).not.toHaveBeenCalled();
  });

  it('patches Google before saving a flexible slot and rolls Google back if the slot save fails', async () => {
    const updateSlot = jest.fn().mockRejectedValue(new Error('overlap'));
    const { move, patch, updateWindow } = service({
      tasks: [
        {
          id: 'task-flex',
          eventType: 'admin',
          isRecurring: false,
          googleEventId: 'evt-1',
        },
      ],
      slots: [
        {
          id: 'slot-1',
          taskId: 'task-flex',
          googleEventId: 'evt-1',
          scheduledStartTime: new Date('2026-09-22T09:00:00.000Z'),
        },
      ],
      updateSlot,
    });

    await expect(move.move(userId, dto)).rejects.toThrow('overlap');
    expect(patch).toHaveBeenNthCalledWith(
      1,
      userId,
      'evt-1',
      '2026-09-22T11:00:00.000Z',
      '2026-09-22T12:00:00.000Z',
      'primary',
    );
    expect(patch).toHaveBeenNthCalledWith(
      2,
      userId,
      'evt-1',
      '2026-09-22T09:00:00.000Z',
      '2026-09-22T10:00:00.000Z',
      'primary',
    );
    expect(updateWindow).not.toHaveBeenCalled();
  });

  it('patches an external Google event and leaves tasks alone', async () => {
    const { move, patch, updateTask, updateSlot } = service({ tasks: [] });
    await expect(move.move(userId, dto)).resolves.toEqual({ kind: 'google' });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(updateTask).not.toHaveBeenCalled();
    expect(updateSlot).not.toHaveBeenCalled();
  });
});
