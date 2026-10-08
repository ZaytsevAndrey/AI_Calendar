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
    place?: jest.Mock;
    seatOpenHoles?: jest.Mock;
  }) {
    const patch = opts.patch ?? jest.fn().mockResolvedValue(undefined);
    const updateTask =
      opts.updateTask ??
      jest.fn().mockImplementation(async (_id: string, _userId: string, body) => ({
        scheduledStartTime: body.scheduledStartTime,
        scheduledEndTime: body.scheduledEndTime,
      }));
    const place =
      opts.place ??
      jest.fn().mockImplementation(async (_userId: string, _taskId: string, body) => ({
        outcome: 'seated',
        start: new Date(body.preferredStart).getTime(),
        end:
          new Date(body.preferredStart).getTime() +
          body.durationMinutes * 60_000,
        moves: [],
      }));
    const seatOpenHoles = opts.seatOpenHoles ?? jest.fn().mockResolvedValue(undefined);
    const slots = opts.slots ?? [];
    const move = new DisplayedEventMoveService(
      {
        createQueryBuilder: () => ({
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue(slots),
        }),
      } as never,
      {
        findOne: jest.fn().mockResolvedValue(opts.habit ? { id: 'habit' } : null),
      } as never,
      {
        findAll: jest.fn().mockResolvedValue(opts.tasks ?? []),
        update: updateTask,
      } as never,
      { patchEventTimes: patch } as never,
      { place, seatOpenHoles } as never,
    );
    return { move, patch, updateTask, place, seatOpenHoles };
  }

  it('does not change a habit block', async () => {
    const { move, patch, place } = service({ habit: true });
    await expect(move.move(userId, dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(patch).not.toHaveBeenCalled();
    expect(place).not.toHaveBeenCalled();
  });

  it('writes a fixed task without a full replan', async () => {
    const { move, patch, updateTask, place } = service({
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
      jobId: null,
    });
    expect(updateTask).toHaveBeenCalledWith('task-fixed', userId, {
      scheduledStartTime: '2026-09-22T11:00:00.000Z',
      scheduledEndTime: '2026-09-22T12:00:00.000Z',
      estimatedTimeInMinutes: 60,
    });
    expect(patch).not.toHaveBeenCalled();
    expect(place).not.toHaveBeenCalled();
  });

  it('rejects a fixed drag that the placement step did not keep', async () => {
    const updateTask = jest.fn().mockResolvedValue({
      scheduledStartTime: '2026-09-22T09:00:00.000Z',
    });
    const { move, patch } = service({
      tasks: [
        {
          id: 'task-fixed',
          eventType: 'fixed',
          isRecurring: false,
          googleEventId: 'evt-1',
        },
      ],
      updateTask,
    });
    await expect(move.move(userId, dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(patch).not.toHaveBeenCalled();
  });

  it('does not patch Google when a flexible drag cannot take the time', async () => {
    const place = jest.fn().mockResolvedValue({
      outcome: 'conflict',
      conflict: { reason: 'preferred_on_fixed' },
    });
    const { move, patch, seatOpenHoles } = service({
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
      place,
    });

    await expect(move.move(userId, dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(patch).not.toHaveBeenCalled();
    expect(seatOpenHoles).not.toHaveBeenCalled();
  });

  it('seats a flexible drag through the placement step and does not replan', async () => {
    const { move, place, patch, seatOpenHoles } = service({
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
      jobId: null,
    });
    expect(place).toHaveBeenCalledWith(userId, 'task-flex', {
      preferredStart: new Date('2026-09-22T11:00:00.000Z'),
      durationMinutes: 60,
      commit: 'preferred',
    });
    expect(patch).toHaveBeenCalledWith(
      userId,
      'evt-1',
      '2026-09-22T11:00:00.000Z',
      '2026-09-22T12:00:00.000Z',
      'primary',
    );
    expect(seatOpenHoles).toHaveBeenCalledWith(userId);
  });

  it('patches an external Google event without placement', async () => {
    const { move, patch, updateTask, place } = service({
      tasks: [],
    });
    await expect(move.move(userId, dto)).resolves.toEqual({
      kind: 'google',
      jobId: null,
    });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(updateTask).not.toHaveBeenCalled();
    expect(place).not.toHaveBeenCalled();
  });
});
