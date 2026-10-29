import { BadRequestException } from '@nestjs/common';
import { DisplayedEventMoveService } from './displayed-event-move.service';

async function flushAsyncWork(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

/** UTC instant on a day that is still open relative to the test clock. */
function futureUtc(dayOffset: number, hour: number): string {
  const date = new Date();
  date.setUTCHours(hour, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + dayOffset);
  return date.toISOString();
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
    const providerUpdate = jest.fn().mockResolvedValue(null);
    const syncTask = jest.fn().mockResolvedValue(undefined);
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
    const completeMutationJob = jest.fn().mockResolvedValue(undefined);
    const failMutationJob = opts.failMutationJob ?? jest.fn().mockResolvedValue(undefined);
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
        findAll: jest.fn().mockResolvedValue(opts.tasks ?? []),
        update: updateTask,
        skipOccurrence: opts.skipOccurrence ?? jest.fn().mockResolvedValue({}),
        create:
        opts.createTask ??
        jest.fn().mockResolvedValue({ id: 'copy-1', jobId: 'job-create' }),
      } as never,
      { patchEventTimes: patch } as never,
      {
        get: jest.fn().mockReturnValue({ updateEvent: providerUpdate }),
      } as never,
      { syncTask } as never,
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
        completeMutationJob,
        failMutationJob,
      } as never,
    );
    return {
      move,
      patch,
      providerUpdate,
      syncTask,
      updateTask,
      place,
      seatOpenHoles,
      taskRepo,
      completeMutationJob,
      failMutationJob,
    };
  }

  it('patches Google when the event is not an app task or slot', async () => {
    const { move, patch, place } = service({ tasks: [], slots: [] });
    const result = await move.move(userId, dto);
    expect(result).toEqual({ kind: 'google', jobId: null });
    expect(patch).toHaveBeenCalled();
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
      conflict: { reason: 'preferred_on_fixed', options: ['leave_problematic'] },
    });
    const failMutationJob = jest.fn().mockResolvedValue(undefined);
    const { move, patch, seatOpenHoles, completeMutationJob } = service({
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
    expect(failMutationJob).not.toHaveBeenCalled();
    expect(completeMutationJob).toHaveBeenCalledWith('job-1', {
      conflicts: [{ reason: 'preferred_on_fixed', options: ['leave_problematic'] }],
    });
  });

  it('skips Google patch when a flexible drag re-merges into a series', async () => {
    const place = jest.fn().mockResolvedValue({
      outcome: 'seated',
      start: new Date(dto.start).getTime(),
      end: new Date(dto.end).getTime(),
      moves: [],
      mergedIntoTaskId: 'series-1',
    });
    const { move, patch, syncTask, seatOpenHoles } = service({
      tasks: [
        {
          id: 'copy-1',
          eventType: 'admin',
          isRecurring: false,
          googleEventId: 'evt-1',
          seriesGroupId: 'series-1',
          parentSeriesId: 'series-1',
        },
      ],
      slots: [
        {
          id: 'slot-1',
          taskId: 'copy-1',
          googleEventId: 'evt-1',
          scheduledStartTime: new Date('2026-09-22T09:00:00.000Z'),
        },
      ],
      place,
    });
    await expect(move.move(userId, dto)).resolves.toEqual({
      kind: 'slot',
      jobId: 'job-1',
    });
    await flushAsyncWork();
    expect(patch).not.toHaveBeenCalled();
    expect(syncTask).toHaveBeenCalledWith(userId, 'series-1');
    expect(seatOpenHoles).toHaveBeenCalledWith(userId);
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
      drag: true,
    });
    expect(patch).toHaveBeenCalledWith(
      userId,
      'evt-1',
      '2026-09-22T11:00:00.000Z',
      '2026-09-22T12:00:00.000Z',
      'primary',
      undefined,
    );
    expect(seatOpenHoles).toHaveBeenCalledWith(userId);
  });

  it('parks a drag that cannot sit instead of reporting the time as taken', async () => {
    const place = jest.fn().mockResolvedValue({
      outcome: 'problematic',
      reason: 'phase_full',
    });
    const {
      move,
      completeMutationJob,
      failMutationJob,
      syncTask,
      patch,
      seatOpenHoles,
    } = service({
      tasks: [
        {
          id: 'task-flex',
          name: 'microfrontend',
          eventType: 'admin',
          isRecurring: false,
          googleEventId: 'evt-1',
          phases: [],
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
    await expect(move.move(userId, dto)).resolves.toEqual({
      kind: 'slot',
      jobId: 'job-1',
    });
    await flushAsyncWork();
    expect(failMutationJob).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(syncTask).toHaveBeenCalledWith(userId, 'task-flex');
    expect(seatOpenHoles).toHaveBeenCalledWith(userId);
    expect(completeMutationJob).toHaveBeenCalledWith('job-1', {
      parked: 'problematic',
      reason: 'phase_full',
    });
  });

  it('patches an external Google event without placement', async () => {
    const { move, patch, providerUpdate, updateTask, place } = service({
      tasks: [],
    });
    await expect(move.move(userId, dto)).resolves.toEqual({
      kind: 'google',
      jobId: null,
    });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(providerUpdate).not.toHaveBeenCalled();
    expect(updateTask).not.toHaveBeenCalled();
    expect(place).not.toHaveBeenCalled();
  });

  it('patches an external Microsoft event via Graph, not Google', async () => {
    const { move, patch, providerUpdate, place } = service({ tasks: [] });
    await expect(
      move.move(userId, { ...dto, provider: 'microsoft', calendarId: 'ms-cal' }),
    ).resolves.toEqual({ kind: 'google', jobId: null });
    expect(patch).not.toHaveBeenCalled();
    expect(providerUpdate).toHaveBeenCalledWith(
      userId,
      'evt-1',
      {
        start: { dateTime: '2026-09-22T11:00:00.000Z' },
        end: { dateTime: '2026-09-22T12:00:00.000Z' },
      },
      'ms-cal',
    );
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
      originalStart: futureUtc(4, 9),
      originalEnd: futureUtc(4, 10),
      start: futureUtc(4, 11),
      end: futureUtc(4, 12),
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
          scheduledStartTime: new Date(futureUtc(2, 9)),
          scheduledEndTime: new Date(futureUtc(2, 10)),
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
      originalStart: futureUtc(2, 9),
      originalEnd: futureUtc(2, 10),
      start: futureUtc(2, 11),
      end: futureUtc(2, 12),
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
          scheduledStartTime: new Date(futureUtc(3, 9)),
          scheduledEndTime: new Date(futureUtc(3, 10)),
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
