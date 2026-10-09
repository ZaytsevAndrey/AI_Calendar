import { BadRequestException } from '@nestjs/common';
import { DisplayedEventMoveService } from './displayed-event-move.service';

async function flushAsyncWork(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

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
    phases?: Record<string, unknown>[];
    patch?: jest.Mock;
    updateTask?: jest.Mock;
    place?: jest.Mock;
    seatOpenHoles?: jest.Mock;
    skipOccurrence?: jest.Mock;
    createTask?: jest.Mock;
    saveTask?: jest.Mock;
    findSlots?: jest.Mock;
    removeSlots?: jest.Mock;
    failMutationJob?: jest.Mock;
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
    const tasks = opts.tasks ?? [];
    const taskRepo = {
      save: opts.saveTask ?? jest.fn(async (row) => ({ id: 'series-new', ...row })),
      create: jest.fn((row) => row),
      find: opts.findSlots ?? jest.fn().mockResolvedValue([]),
      findOne: jest.fn(async ({ where }: { where?: { id?: string } }) => {
        const id = where?.id;
        return tasks.find((row) => row.id === id) ?? null;
      }),
    };
    const move = new DisplayedEventMoveService(
      {
        createQueryBuilder: () => ({
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue(slots),
        }),
        find: opts.findSlots ?? jest.fn().mockResolvedValue([]),
        remove: opts.removeSlots ?? jest.fn().mockResolvedValue(undefined),
      } as never,
      taskRepo as never,
      {
        findOne: jest.fn().mockResolvedValue(opts.habit ? { id: 'habit' } : null),
      } as never,
      {
        findAll: jest.fn().mockResolvedValue(opts.tasks ?? []),
        update: updateTask,
        skipOccurrence: opts.skipOccurrence ?? jest.fn().mockResolvedValue({}),
        create:
        opts.createTask ??
        jest.fn().mockResolvedValue({ id: 'copy-1', jobId: 'job-create' }),
      } as never,
      { patchEventTimes: patch } as never,
      { syncTask: jest.fn().mockResolvedValue(undefined) } as never,
      { place, seatOpenHoles } as never,
      {
        getSettings: jest.fn().mockResolvedValue({ timeZone: 'UTC' }),
      } as never,
      {
        findAllForScheduling: jest
          .fn()
          .mockResolvedValue(opts.phases ?? []),
      } as never,
      {
        beginMutationJob: jest.fn().mockResolvedValue({ id: 'job-1' }),
        setMutationStage: jest.fn().mockResolvedValue(undefined),
        completeMutationJob: jest.fn().mockResolvedValue(undefined),
        failMutationJob:
          opts.failMutationJob ?? jest.fn().mockResolvedValue(undefined),
      } as never,
    );
    return { move, patch, updateTask, place, seatOpenHoles, taskRepo };
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
      phaseIds: [],
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
    const failMutationJob = jest.fn().mockResolvedValue(undefined);
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
      failMutationJob,
    });

    await expect(move.move(userId, dto)).resolves.toEqual({
      kind: 'slot',
      jobId: 'job-1',
    });
    await flushAsyncWork();
    expect(patch).not.toHaveBeenCalled();
    expect(seatOpenHoles).not.toHaveBeenCalled();
    expect(failMutationJob).toHaveBeenCalled();
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
      jobId: 'job-1',
    });
    await flushAsyncWork();
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

  const seriesDto = dto;
  const seriesTask = {
    id: 'series-1',
    name: 'Gym',
    eventType: 'admin',
    isRecurring: true,
    googleEventId: 'evt-1',
    estimatedTimeInMinutes: 60,
    recurrencePattern: 'DAILY',
    phaseId: null,
    allowSplit: false,
    priority: 'medium',
  };

  it('asks before moving a series day', async () => {
    const { move, place, patch } = service({
      tasks: [seriesTask],
      slots: [
        {
          id: 'slot-1',
          taskId: 'series-1',
          googleEventId: 'evt-1',
          scheduledStartTime: new Date('2026-09-22T09:00:00.000Z'),
        },
      ],
    });
    await expect(move.move(userId, seriesDto)).resolves.toEqual({
      kind: 'series-choice',
      jobId: null,
      taskName: 'Gym',
    });
    expect(place).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it('detaches one series day into a one-off', async () => {
    const skipOccurrence = jest.fn().mockResolvedValue({});
    const createTask = jest
      .fn()
      .mockResolvedValue({ id: 'copy-1', jobId: 'job-create' });
    const { move, place } = service({
      tasks: [seriesTask],
      slots: [
        {
          id: 'slot-1',
          taskId: 'series-1',
          googleEventId: 'evt-1',
          scheduledStartTime: new Date('2026-09-22T09:00:00.000Z'),
        },
      ],
      skipOccurrence,
      createTask,
    });
    await expect(
      move.move(userId, { ...seriesDto, seriesScope: 'occurrence' }),
    ).resolves.toEqual({ kind: 'slot', jobId: 'job-create' });
    expect(skipOccurrence).toHaveBeenCalledWith('series-1', userId, {
      occurrenceStart: seriesDto.originalStart,
      googleEventId: 'evt-1',
      googleEventCalendarId: 'primary',
    });
    expect(createTask).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({
        name: 'Gym',
        isRecurring: false,
        parentSeriesId: 'series-1',
        scheduledStartTime: seriesDto.start,
      }),
    );
    expect(place).not.toHaveBeenCalled();
  });

  it('rejects a recurring drag that crosses a local day', async () => {
    const { move, place } = service({
      tasks: [seriesTask],
      findSlots: jest.fn().mockResolvedValue([
        {
          id: 'slot-1',
          taskId: 'series-1',
          scheduledStartTime: new Date('2026-10-20T09:00:00.000Z'),
          scheduledEndTime: new Date('2026-10-20T10:00:00.000Z'),
        },
      ]),
    });
    await expect(
      move.move(userId, {
        ...seriesDto,
        originalStart: '2026-10-20T09:00:00.000Z',
        originalEnd: '2026-10-20T10:00:00.000Z',
        start: '2026-10-21T11:00:00.000Z',
        end: '2026-10-21T12:00:00.000Z',
        seriesScope: 'all',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(place).not.toHaveBeenCalled();
  });

  it('ends the old series before the dropped day and starts a new series', async () => {
    const future = {
      ...dto,
      originalStart: '2026-10-20T09:00:00.000Z',
      originalEnd: '2026-10-20T10:00:00.000Z',
      start: '2026-10-20T11:00:00.000Z',
      end: '2026-10-20T12:00:00.000Z',
    };
    const evening = {
      id: 'phase-eve',
      type: 'time_phase',
      startTime: '11:00',
      endTime: '17:00',
      weekDays: null,
    };
    const saveTask = jest.fn(async (row) => ({ id: row.id ?? 'series-new', ...row }));
    const removeSlots = jest.fn().mockResolvedValue(undefined);
    const { move, place, seatOpenHoles } = service({
      tasks: [seriesTask],
      phases: [evening],
      slots: [
        {
          id: 'slot-1',
          taskId: 'series-1',
          googleEventId: 'evt-1',
          scheduledStartTime: new Date(future.originalStart),
        },
      ],
      saveTask,
      removeSlots,
      findSlots: jest.fn().mockResolvedValue([
        {
          id: 'slot-prev',
          taskId: 'series-1',
          scheduledStartTime: new Date('2026-10-18T09:00:00.000Z'),
          scheduledEndTime: new Date('2026-10-18T10:00:00.000Z'),
        },
        {
          id: 'slot-1',
          taskId: 'series-1',
          scheduledStartTime: new Date(future.originalStart),
          scheduledEndTime: new Date(future.originalEnd),
        },
      ]),
    });
    await expect(
      move.move(userId, { ...future, seriesScope: 'series' }),
    ).resolves.toEqual({ kind: 'slot', jobId: 'job-1' });
    await flushAsyncWork();
    expect(saveTask).toHaveBeenCalled();
    expect(removeSlots).toHaveBeenCalled();
    expect(place).toHaveBeenCalledWith(
      userId,
      'series-new',
      expect.objectContaining({
        commit: 'always',
        expandSeries: true,
        durationMinutes: 60,
      }),
    );
    expect(seatOpenHoles).toHaveBeenCalledWith(userId);
    const createdRow = saveTask.mock.calls
      .map((c) => c[0])
      .find((row) => row?.name === 'Gym' && row?.scheduledStartTime);
    expect(createdRow?.phaseId).toBe('phase-eve');
  });

  it('treats series scope on the first open day as all', async () => {
    const future = {
      ...dto,
      originalStart: '2026-10-20T09:00:00.000Z',
      originalEnd: '2026-10-20T10:00:00.000Z',
      start: '2026-10-20T11:00:00.000Z',
      end: '2026-10-20T12:00:00.000Z',
    };
    const saveTask = jest.fn(async (row) => ({ id: row.id ?? 'series-1', ...row }));
    const removeSlots = jest.fn().mockResolvedValue(undefined);
    const { move, place } = service({
      tasks: [{ ...seriesTask, id: 'series-1' }],
      saveTask,
      removeSlots,
      findSlots: jest.fn().mockResolvedValue([
        {
          id: 'slot-1',
          taskId: 'series-1',
          scheduledStartTime: new Date(future.originalStart),
          scheduledEndTime: new Date(future.originalEnd),
        },
        {
          id: 'slot-2',
          taskId: 'series-1',
          scheduledStartTime: new Date('2026-10-21T09:00:00.000Z'),
          scheduledEndTime: new Date('2026-10-21T10:00:00.000Z'),
        },
      ]),
    });
    await expect(
      move.move(userId, { ...future, seriesScope: 'series' }),
    ).resolves.toEqual({ kind: 'slot', jobId: 'job-1' });
    await flushAsyncWork();
    expect(place).toHaveBeenCalledWith(
      userId,
      'series-1',
      expect.objectContaining({
        commit: 'always',
        expandSeries: true,
      }),
    );
    expect(place).not.toHaveBeenCalledWith(
      userId,
      'series-new',
      expect.anything(),
    );
  });

  it('rewrites every open day when seriesScope is all', async () => {
    const dayA = {
      originalStart: '2026-10-19T09:00:00.000Z',
      originalEnd: '2026-10-19T10:00:00.000Z',
      start: '2026-10-19T11:00:00.000Z',
      end: '2026-10-19T12:00:00.000Z',
    };
    const saveTask = jest.fn(async (row) => ({ id: row.id ?? 'series-1', ...row }));
    const removeSlots = jest.fn().mockResolvedValue(undefined);
    const { move, place, seatOpenHoles } = service({
      tasks: [seriesTask],
      saveTask,
      removeSlots,
      findSlots: jest.fn().mockResolvedValue([
        {
          id: 'slot-prev',
          taskId: 'series-1',
          scheduledStartTime: new Date('2026-10-18T09:00:00.000Z'),
          scheduledEndTime: new Date('2026-10-18T10:00:00.000Z'),
        },
        {
          id: 'slot-1',
          taskId: 'series-1',
          scheduledStartTime: new Date(dayA.originalStart),
          scheduledEndTime: new Date(dayA.originalEnd),
        },
      ]),
    });
    await expect(
      move.move(userId, { ...seriesDto, ...dayA, seriesScope: 'all' }),
    ).resolves.toEqual({ kind: 'slot', jobId: 'job-1' });
    await flushAsyncWork();
    // Seats stay until place/expand rewrites them — wiping first deletes Google.
    expect(removeSlots).not.toHaveBeenCalled();
    expect(place).toHaveBeenCalledWith(
      userId,
      'series-1',
      expect.objectContaining({
        commit: 'always',
        expandSeries: true,
        durationMinutes: 60,
      }),
    );
    expect(seatOpenHoles).toHaveBeenCalledWith(userId);
  });

  it('sets phaseIds from the drop time on a fixed move', async () => {
    const morning = {
      id: 'phase-am',
      type: 'time_phase',
      startTime: '08:00',
      endTime: '12:00',
      weekDays: null,
    };
    const { move, updateTask } = service({
      tasks: [
        {
          id: 'task-fixed',
          eventType: 'fixed',
          isRecurring: false,
          googleEventId: 'evt-1',
        },
      ],
      phases: [morning],
    });
    await move.move(userId, {
      ...dto,
      originalStart: '2026-10-20T09:00:00.000Z',
      originalEnd: '2026-10-20T10:00:00.000Z',
      start: '2026-10-20T10:00:00.000Z',
      end: '2026-10-20T11:00:00.000Z',
    });
    expect(updateTask).toHaveBeenCalledWith(
      'task-fixed',
      userId,
      expect.objectContaining({ phaseIds: ['phase-am'] }),
    );
  });
});
