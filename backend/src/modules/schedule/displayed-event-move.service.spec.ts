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
    enqueueReplan?: jest.Mock;
  }) {
    const patch = opts.patch ?? jest.fn().mockResolvedValue(undefined);
    const updateTask = opts.updateTask ?? jest.fn().mockResolvedValue({});
    const updateSlot = opts.updateSlot ?? jest.fn().mockResolvedValue({});
    const updateWindow = opts.updateWindow ?? jest.fn().mockResolvedValue(undefined);
    const enqueueReplan =
      opts.enqueueReplan ?? jest.fn().mockResolvedValue({ id: 'job-move-1' });
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
      { enqueueReplan } as never,
    );
    return { move, patch, updateTask, updateSlot, updateWindow, enqueueReplan };
  }

  it('does not change a habit block', async () => {
    const { move, patch, enqueueReplan } = service({ habit: true });
    await expect(move.move(userId, dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(patch).not.toHaveBeenCalled();
    expect(enqueueReplan).not.toHaveBeenCalled();
  });

  it('writes a fixed task and enqueues replan', async () => {
    const { move, patch, updateTask, enqueueReplan } = service({
      tasks: [
        {
          id: 'task-fixed',
          eventType: 'fixed',
          isRecurring: false,
          googleEventId: 'evt-1',
        },
      ],
    });
    await expect(move.move(userId, dto)).resolves.toEqual({
      kind: 'fixed',
      jobId: 'job-move-1',
    });
    expect(updateTask).toHaveBeenCalledWith('task-fixed', userId, {
      scheduledStartTime: '2026-09-22T11:00:00.000Z',
      scheduledEndTime: '2026-09-22T12:00:00.000Z',
      estimatedTimeInMinutes: 60,
    });
    expect(patch).not.toHaveBeenCalled();
    expect(enqueueReplan).toHaveBeenCalledWith(userId);
  });

  it('patches Google before saving a flexible slot and rolls Google back if the slot save fails', async () => {
    const updateSlot = jest.fn().mockRejectedValue(new Error('overlap'));
    const { move, patch, updateWindow, enqueueReplan } = service({
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
    expect(enqueueReplan).not.toHaveBeenCalled();
  });

  it('saves a flexible slot and enqueues replan', async () => {
    const { move, enqueueReplan, updateSlot } = service({
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
    });
    await expect(move.move(userId, dto)).resolves.toEqual({
      kind: 'slot',
      jobId: 'job-move-1',
    });
    expect(updateSlot).toHaveBeenCalled();
    expect(enqueueReplan).toHaveBeenCalledWith(userId);
  });

  it('patches an external Google event without replan', async () => {
    const { move, patch, updateTask, updateSlot, enqueueReplan } = service({
      tasks: [],
    });
    await expect(move.move(userId, dto)).resolves.toEqual({
      kind: 'google',
      jobId: null,
    });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(updateTask).not.toHaveBeenCalled();
    expect(updateSlot).not.toHaveBeenCalled();
    expect(enqueueReplan).not.toHaveBeenCalled();
  });
});
