import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, Logger } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { Task } from './entities/task.entity';
import { Phase } from '../phases/entities/phase.entity';
import { UserSettings } from '../user-settings/entities/user-settings.entity';
import { ScheduleJobService } from '../schedule/schedule-job.service';
import { PlacementStepService } from '../schedule/placement-step.service';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import { PendingGoogleWriteService } from '../google-calendar/pending-google-write.service';
import { ScheduledTask } from '../schedule/schedule.entity';
import { TaskEventType } from '../scheduling/event-type.enum';
import { TaskStatus } from './entities/task.entity';

function createdRow(repo: { create: jest.Mock }): Record<string, unknown> {
  return repo.create.mock.calls[0][0] as Record<string, unknown>;
}

describe('TasksService', () => {
  let service: TasksService;
  let lastSaved: Record<string, unknown> | null;
  const tasksRepository = {
    create: jest.fn((value) => value),
    save: jest.fn(async (entity) => {
      lastSaved = { ...entity, id: entity.id ?? 'task-1' };
      return lastSaved;
    }),
    find: jest.fn(),
    findOne: jest.fn(async () => lastSaved),
    merge: jest.fn((entity, dto) => Object.assign(entity, dto)),
    remove: jest.fn(),
  };
  const phasesRepository = {
    findBy: jest.fn(),
    findOne: jest.fn(),
  };
  const userSettingsRepository = {
    findOne: jest.fn().mockResolvedValue(null),
  };
  const scheduledTaskRepository = {
    find: jest.fn().mockResolvedValue([]),
    remove: jest.fn(),
    create: jest.fn((value) => value),
    save: jest.fn(async (entity) => entity),
  };
  const scheduleJobService = {
    enqueueReplan: jest.fn().mockResolvedValue({ id: 'job-1' }),
    processNextPendingForUser: jest.fn(),
    deleteSyncedGoogleEventsForTask: jest.fn().mockResolvedValue(undefined),
    beginMutationJob: jest.fn().mockResolvedValue({ id: 'job-mut-1' }),
    setMutationStage: jest.fn().mockResolvedValue(undefined),
    completeMutationJob: jest.fn().mockResolvedValue(undefined),
    failMutationJob: jest.fn().mockResolvedValue(undefined),
  };

  async function flushMutationFollowUp(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  const googleCalendarService = {
    checkConnection: jest.fn().mockResolvedValue({ connected: false }),
    createEvent: jest.fn(),
    updateEvent: jest.fn(),
    deleteEvent: jest.fn(),
  };
  const pendingGoogleWrites = {
    syncTask: jest.fn().mockResolvedValue(undefined),
    syncTaskSoon: jest.fn((userId: string, taskId: string) => {
      void pendingGoogleWrites.syncTask(userId, taskId);
    }),
    discardPendingUpserts: jest.fn().mockResolvedValue(undefined),
    waitForInflight: jest.fn().mockResolvedValue(undefined),
  };
  const placementStep = {
    place: jest.fn().mockImplementation(async (_userId: string, _taskId: string, opts) => {
      const start = opts?.preferredStart ? new Date(opts.preferredStart).getTime() : 0;
      return {
        outcome: 'seated',
        start,
        end: start + 30 * 60_000,
        moves: [],
      };
    }),
    seatOpenHoles: jest.fn().mockResolvedValue(undefined),
    runExclusive: jest.fn(async (_userId: string, run: () => Promise<unknown>) => run()),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    lastSaved = null;
    userSettingsRepository.findOne.mockResolvedValue(null);
    tasksRepository.find.mockResolvedValue([]);
    scheduledTaskRepository.find.mockResolvedValue([]);
    placementStep.place.mockImplementation(async (_userId: string, _taskId: string, opts) => {
      const start = opts?.preferredStart ? new Date(opts.preferredStart).getTime() : 0;
      return {
        outcome: 'seated',
        start,
        end: start + 30 * 60_000,
        moves: [],
      };
    });
    placementStep.seatOpenHoles.mockResolvedValue(undefined);
    pendingGoogleWrites.syncTask.mockImplementation(async () => {
      if (lastSaved) {
        lastSaved.googleEventId = null;
        lastSaved.googleEventCalendarId = null;
      }
    });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        {
          provide: getRepositoryToken(Task),
          useValue: tasksRepository,
        },
        {
          provide: getRepositoryToken(Phase),
          useValue: phasesRepository,
        },
        {
          provide: getRepositoryToken(UserSettings),
          useValue: userSettingsRepository,
        },
        {
          provide: getRepositoryToken(ScheduledTask),
          useValue: scheduledTaskRepository,
        },
        {
          provide: ScheduleJobService,
          useValue: scheduleJobService,
        },
        { provide: GoogleCalendarService, useValue: googleCalendarService },
        { provide: PendingGoogleWriteService, useValue: pendingGoogleWrites },
        { provide: PlacementStepService, useValue: placementStep },
      ],
    }).compile();

    service = module.get<TasksService>(TasksService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('throws when fixed task misses schedule boundaries', async () => {
    await expect(
      service.create('user-1', {
        name: 'Fixed',
        eventType: TaskEventType.FIXED,
      } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws when more than one phase is passed', async () => {
    await expect(
      service.create('user-1', {
        name: 'Task',
        eventType: TaskEventType.ADMIN,
        phaseIds: ['a', 'b'],
      } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('seats a flexible create instead of enqueueing a full replan', async () => {
    const created = await service.create('user-1', {
      name: 'Task',
      eventType: TaskEventType.ADMIN,
      estimatedTimeInMinutes: 60,
    } as any);
    await flushMutationFollowUp();

    expect(placementStep.place).toHaveBeenCalledWith(
      'user-1',
      'task-1',
      expect.objectContaining({ searchHole: true }),
    );
    expect(created.jobId).toBe('job-mut-1');
    expect(scheduleJobService.beginMutationJob).toHaveBeenCalled();
    expect(scheduleJobService.enqueueReplan).not.toHaveBeenCalled();
    expect(scheduleJobService.processNextPendingForUser).not.toHaveBeenCalled();
  });

  it('returns a mutation jobId for flexible create', async () => {
    const created = await service.create('user-1', {
      name: 'Task',
      eventType: TaskEventType.ADMIN,
      estimatedTimeInMinutes: 60,
    } as any);
    expect(created.jobId).toBe('job-mut-1');
  });

  it('returns a mutation jobId for fixed create', async () => {
    const created = await service.create('user-1', {
      name: 'Fixed',
      eventType: TaskEventType.FIXED,
      scheduledStartTime: '2026-04-20T09:00:00.000Z',
      scheduledEndTime: '2026-04-20T10:00:00.000Z',
      estimatedTimeInMinutes: 60,
    } as any);
    expect(created.jobId).toBe('job-mut-1');
  });

  it('does not start a replan job while seating a create', async () => {
    let resolveProcess: (() => void) | undefined;
    const processGate = new Promise<void>((resolve) => {
      resolveProcess = resolve;
    });
    scheduleJobService.processNextPendingForUser.mockImplementation(
      () => processGate,
    );

    await expect(
      service.create('user-1', {
        name: 'Task',
        eventType: TaskEventType.ADMIN,
        estimatedTimeInMinutes: 60,
      } as any),
    ).resolves.toBeDefined();

    resolveProcess?.();
    await processGate;
  });

  it('does not enqueue replan for unscheduled inbox tasks', async () => {
    const created = await service.create('user-1', {
      name: 'Buy milk',
      isUnscheduled: true,
      estimatedTimeInMinutes: 15,
    } as any);

    expect(created.isUnscheduled).toBe(true);
    expect(created.jobId).toBe('job-mut-1');
    expect(scheduleJobService.enqueueReplan).not.toHaveBeenCalled();
    await flushMutationFollowUp();
    expect(pendingGoogleWrites.syncTask).toHaveBeenCalled();
  });

  it('stores problematic state and the single parked day', async () => {
    const created = await service.create('user-1', {
      name: 'Stuck',
      scheduleState: 'problematic',
      problematicReason: 'phase_full',
      problematicOccurrenceYmds: ['2026-10-06'],
      parentSeriesId: '11111111-1111-4111-8111-111111111111',
      estimatedTimeInMinutes: 30,
    } as any);

    expect(created.scheduleState).toBe('problematic');
    expect(created.problematicDay).toBe('2026-10-06');
    expect(created.parentSeriesId).toBe('11111111-1111-4111-8111-111111111111');
    expect(created.jobId).toBe('job-mut-1');
    expect(scheduleJobService.enqueueReplan).not.toHaveBeenCalled();
  });

  it('lets an unscheduled create win over problematic', async () => {
    const created = await service.create('user-1', {
      name: 'Later',
      isUnscheduled: true,
      scheduleState: 'problematic',
      problematicReason: 'phase_full',
      estimatedTimeInMinutes: 15,
    } as any);

    expect(created.isUnscheduled).toBe(true);
    expect(created.scheduleState).toBe('none');
    expect(created.problematicReason).toBeNull();
    expect(created.problematicDay).toBeNull();
  });

  it('keeps recurring out of the Unscheduled inbox when both flags arrive', async () => {
    const created = await service.create('user-1', {
      name: 'Daily stretch',
      isRecurring: true,
      recurrencePattern: 'DAILY',
      isUnscheduled: true,
      estimatedTimeInMinutes: 30,
    } as any);

    expect(created.isRecurring).toBe(true);
    expect(created.isUnscheduled).toBe(false);
  });

  it('returns a conflict sheet payload instead of parking on create', async () => {
    placementStep.place.mockResolvedValue({
      outcome: 'conflict',
      conflict: {
        taskId: 'task-1',
        taskName: 'Deep work',
        reason: 'preferred_on_fixed',
        options: ['move_new', 'leave_problematic'],
        meta: {
          preferredStart: '2026-10-08T09:00:00.000Z',
          preferredEnd: '2026-10-08T10:00:00.000Z',
        },
      },
    });

    const created = await service.create('user-1', {
      name: 'Deep work',
      estimatedTimeInMinutes: 60,
      scheduledStartTime: '2026-10-08T09:00:00.000Z',
      scheduledEndTime: '2026-10-08T10:00:00.000Z',
    } as any);
    expect(created.jobId).toBe('job-mut-1');
    expect(created.scheduleState).toBe('none');
    await flushMutationFollowUp();
    expect(scheduleJobService.completeMutationJob).toHaveBeenCalledWith(
      'job-mut-1',
      {
        conflicts: [
          expect.objectContaining({
            reason: 'preferred_on_fixed',
            taskId: 'task-1',
          }),
        ],
      },
    );
    expect(scheduleJobService.enqueueReplan).not.toHaveBeenCalled();
  });

  it('keeps the series link on resolved and seats the original interval', async () => {
    await service.create('user-1', {
      name: 'Copy',
      scheduleState: 'problematic',
      parentSeriesId: '11111111-1111-4111-8111-111111111111',
      problematicOccurrenceYmds: ['2026-10-06'],
      problematicOriginalStart: '2026-10-06T09:00:00.000Z',
      problematicOriginalEnd: '2026-10-06T10:00:00.000Z',
      estimatedTimeInMinutes: 30,
    } as any);

    const resolved = await service.update('task-1', 'user-1', {
      scheduleState: 'resolved',
    } as any);
    expect(resolved.scheduleState).toBe('resolved');
    expect(resolved.parentSeriesId).toBe('11111111-1111-4111-8111-111111111111');
    expect(resolved.problematicDay).toBe('2026-10-06');
    expect(resolved.scheduledStartTime).toEqual(
      new Date('2026-10-06T09:00:00.000Z'),
    );
    expect(scheduledTaskRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-1',
        scheduledStartTime: new Date('2026-10-06T09:00:00.000Z'),
      }),
    );

    const cleared = await service.update('task-1', 'user-1', {
      scheduleState: 'none',
    } as any);
    expect(cleared.scheduleState).toBe('none');
    expect(cleared.parentSeriesId).toBeNull();
    expect(cleared.problematicDay).toBeNull();
    expect(cleared.problematicReason).toBeNull();
  });

  it('rejects unscheduled + fixed', async () => {
    await expect(
      service.create('user-1', {
        name: 'Invalid',
        isUnscheduled: true,
        eventType: TaskEventType.FIXED,
        scheduledStartTime: '2026-04-20T09:00:00.000Z',
        scheduledEndTime: '2026-04-20T10:00:00.000Z',
      } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('does not enqueue replan for fixed tasks', async () => {
    await service.create('user-1', {
      name: 'Fixed',
      eventType: TaskEventType.FIXED,
      scheduledStartTime: '2026-04-20T09:00:00.000Z',
      scheduledEndTime: '2026-04-20T10:00:00.000Z',
      estimatedTimeInMinutes: 60,
    } as any);

    expect(scheduleJobService.enqueueReplan).not.toHaveBeenCalled();
    expect(scheduleJobService.processNextPendingForUser).not.toHaveBeenCalled();
  });

  describe('create schedule window', () => {
    it('stores voice Friday window and timezone on the row passed to save', async () => {
      const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();

      const created = await service.create('user-1', {
        name: 'Зал',
        eventType: TaskEventType.ADMIN,
        estimatedTimeInMinutes: 30,
        earliestStartTime: '2026-09-11T00:00:00+03:00',
        deadline: '2026-09-11T23:59:00+03:00',
        timeZone: 'Asia/Nicosia',
        scheduledStartTime: null,
        scheduledEndTime: null,
      } as any);

      const row = createdRow(tasksRepository);
      expect((row.earliestStartTime as Date).toISOString()).toBe(
        '2026-09-10T21:00:00.000Z',
      );
      expect((row.deadline as Date).toISOString()).toBe(
        '2026-09-11T20:59:00.000Z',
      );
      expect(row.scheduleTimeZone).toBe('Asia/Nicosia');
      expect(row.scheduledStartTime).toBeUndefined();
      expect(created.earliestStartTime?.toISOString()).toBe(
        '2026-09-10T21:00:00.000Z',
      );
      expect(scheduleJobService.enqueueReplan).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining('earliest=2026-09-11T00:00:00+03:00'),
      );
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining('stored earliest=2026-09-10T21:00:00.000Z'),
      );
      log.mockRestore();
    });

    it('stores a form From/Until encoded in the Settings IANA zone', async () => {
      await service.create('user-1', {
        name: 'Помити машину',
        eventType: TaskEventType.ADMIN,
        estimatedTimeInMinutes: 30,
        earliestStartTime: '2026-09-08T00:00:00+03:00',
        deadline: '2026-09-08T23:59:00+03:00',
        timeZone: 'Asia/Nicosia',
      } as any);

      const row = createdRow(tasksRepository);
      expect((row.earliestStartTime as Date).toISOString()).toBe(
        '2026-09-07T21:00:00.000Z',
      );
      expect((row.deadline as Date).toISOString()).toBe(
        '2026-09-08T20:59:00.000Z',
      );
      expect(row.scheduleTimeZone).toBe('Asia/Nicosia');
    });

    it('keeps eligibleWeekDays on a multi-day window', async () => {
      await service.create('user-1', {
        name: 'Review',
        eventType: TaskEventType.ADMIN,
        estimatedTimeInMinutes: 45,
        earliestStartTime: '2026-09-07T00:00:00+03:00',
        deadline: '2026-09-09T23:59:00+03:00',
        eligibleWeekDays: [1, 3],
        timeZone: 'Asia/Nicosia',
      } as any);

      const row = createdRow(tasksRepository);
      expect(row.eligibleWeekDays).toEqual([1, 3]);
    });

    it('parses a naive datetime-local string in the host timezone (old deadline path)', async () => {
      await service.create('user-1', {
        name: 'Naive until',
        eventType: TaskEventType.ADMIN,
        estimatedTimeInMinutes: 30,
        deadline: '2026-09-08T23:59',
      } as any);

      const row = createdRow(tasksRepository);
      const stored = (row.deadline as Date).toISOString();
      // eslint-disable-next-line no-console
      console.log('naive deadline "2026-09-08T23:59" stored as', stored, {
        hostTzOffsetMinutes: new Date().getTimezoneOffset(),
      });
      expect(stored).toBe(new Date('2026-09-08T23:59').toISOString());
    });

    it('defaults omitted timeZone to the user Settings IANA zone', async () => {
      userSettingsRepository.findOne.mockResolvedValue({
        timeZone: 'Europe/Kyiv',
      });

      await service.create('user-1', {
        name: 'Gym',
        eventType: TaskEventType.ADMIN,
        estimatedTimeInMinutes: 30,
      } as any);

      const row = createdRow(tasksRepository);
      expect(row.scheduleTimeZone).toBe('Europe/Kyiv');
    });

    it('does not invent a From when the client omitted it', async () => {
      await service.create('user-1', {
        name: 'Due Friday only',
        eventType: TaskEventType.ADMIN,
        estimatedTimeInMinutes: 30,
        deadline: '2026-09-11T23:59:00+03:00',
      } as any);

      const row = createdRow(tasksRepository);
      expect(row.earliestStartTime).toBeUndefined();
      expect((row.deadline as Date).toISOString()).toBe(
        '2026-09-11T20:59:00.000Z',
      );
    });

    it('saves the window before placement runs', async () => {
      const order: string[] = [];
      tasksRepository.save.mockImplementation(async (entity) => {
        order.push('save');
        lastSaved = { ...entity, id: entity.id ?? 'task-1' };
        return lastSaved;
      });
      placementStep.place.mockImplementation(async () => {
        order.push('place');
        return { outcome: 'seated', start: 0, end: 1, moves: [] };
      });

      await service.create('user-1', {
        name: 'Gym',
        eventType: TaskEventType.ADMIN,
        estimatedTimeInMinutes: 30,
        earliestStartTime: '2026-09-11T00:00:00+03:00',
        deadline: '2026-09-11T23:59:00+03:00',
        timeZone: 'Asia/Nicosia',
      } as any);
      await flushMutationFollowUp();

      expect(order[0]).toBe('save');
      expect(order).toContain('place');
      expect(order.indexOf('save')).toBeLessThan(order.indexOf('place'));
    });
  });

  describe('unscheduled inbox', () => {
    it('clears any submitted slot and stores Google extras without syncing', async () => {
      googleCalendarService.checkConnection.mockResolvedValue({ connected: true });

      await service.create('user-1', {
        name: 'Buy milk',
        isUnscheduled: true,
        scheduledStartTime: '2026-04-20T09:00:00.000Z',
        scheduledEndTime: '2026-04-20T10:00:00.000Z',
        location: 'Store',
        googleColorId: '4',
        googleVisibility: 'private',
        googleTransparency: 'transparent',
        googleReminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 5 }] },
      } as any);

      const row = createdRow(tasksRepository);
      expect(row.isUnscheduled).toBe(true);
      expect(row.eventType).toBe(TaskEventType.ADMIN);
      expect(row.isRecurring).toBe(false);
      expect(row.scheduledStartTime).toBeNull();
      expect(row.scheduledEndTime).toBeNull();
      expect(row.location).toBe('Store');
      expect(row.googleColorId).toBe('4');
      await flushMutationFollowUp();
      expect(pendingGoogleWrites.syncTask).toHaveBeenCalled();
      expect(scheduleJobService.enqueueReplan).not.toHaveBeenCalled();
    });

    it('does not replan while an inbox task stays unscheduled', async () => {
      lastSaved = {
        id: 'task-1',
        userId: 'user-1',
        name: 'Buy milk',
        isUnscheduled: true,
        eventType: TaskEventType.ADMIN,
        status: TaskStatus.TODO,
      };

      const updated = await service.update('task-1', 'user-1', {
        name: 'Buy oat milk',
        isUnscheduled: true,
      } as any);

      expect(updated.jobId).toBe('job-mut-1');
      expect(scheduleJobService.enqueueReplan).not.toHaveBeenCalled();
    });

    it('places an inbox task when it is scheduled', async () => {
      lastSaved = {
        id: 'task-1',
        userId: 'user-1',
        name: 'Buy milk',
        isUnscheduled: true,
        eventType: TaskEventType.ADMIN,
        status: TaskStatus.TODO,
        scheduleState: 'none',
      };

      const updated = await service.update('task-1', 'user-1', {
        isUnscheduled: false,
        estimatedTimeInMinutes: 30,
      } as any);
      await flushMutationFollowUp();

      expect(updated.isUnscheduled).toBe(false);
      expect(updated.jobId).toBe('job-mut-1');
      expect(placementStep.place).toHaveBeenCalled();
      expect(scheduleJobService.enqueueReplan).not.toHaveBeenCalled();
    });

    it('drops Google events and seats other problematic tasks when a scheduled task moves to the inbox', async () => {
      lastSaved = {
        id: 'task-1',
        userId: 'user-1',
        name: 'Write brief',
        isUnscheduled: false,
        eventType: TaskEventType.ADMIN,
        status: TaskStatus.TODO,
        googleEventId: 'g-1',
        googleEventCalendarId: 'cal-1',
      };

      const updated = await service.update('task-1', 'user-1', {
        isUnscheduled: true,
      } as any);
      await flushMutationFollowUp();

      expect(pendingGoogleWrites.syncTask).toHaveBeenCalledWith('user-1', 'task-1');
      expect(updated.googleEventId).toBeNull();
      expect(updated.googleEventCalendarId).toBeNull();
      expect(updated.isUnscheduled).toBe(true);
      expect(updated.jobId).toBe('job-mut-1');
      expect(scheduleJobService.enqueueReplan).not.toHaveBeenCalled();
      expect(placementStep.seatOpenHoles).toHaveBeenCalledWith('user-1', undefined);
    });

    it('does not replan after deleting or completing an inbox task', async () => {
      lastSaved = {
        id: 'task-1',
        userId: 'user-1',
        name: 'Buy milk',
        isUnscheduled: true,
        eventType: TaskEventType.ADMIN,
        status: TaskStatus.TODO,
      };

      await service.remove('task-1', 'user-1');
      expect(scheduleJobService.enqueueReplan).not.toHaveBeenCalled();

      lastSaved = {
        id: 'task-2',
        userId: 'user-1',
        name: 'Buy milk',
        isUnscheduled: true,
        eventType: TaskEventType.ADMIN,
        status: TaskStatus.TODO,
      };
      await service.updateStatus('task-2', 'user-1', TaskStatus.COMPLETED);
      expect(scheduleJobService.enqueueReplan).not.toHaveBeenCalled();
    });
  });

  describe('placement on edit', () => {
    const seated = {
      id: 'task-1',
      userId: 'user-1',
      name: 'Write brief',
      isUnscheduled: false,
      eventType: TaskEventType.ADMIN,
      status: TaskStatus.TODO,
      scheduleState: 'none',
      estimatedTimeInMinutes: 60,
      scheduledStartTime: new Date('2026-10-08T09:00:00.000Z'),
      scheduledEndTime: new Date('2026-10-08T10:00:00.000Z'),
      googleEventId: 'g-1',
      isRecurring: false,
      allowSplit: false,
    };

    it('updates the same Google event for a cosmetic save and does not place', async () => {
      lastSaved = { ...seated };
      googleCalendarService.checkConnection.mockResolvedValue({ connected: true });

      const updated = await service.update('task-1', 'user-1', {
        name: 'Write the brief',
      } as any);
      await flushMutationFollowUp();

      expect(updated.jobId).toBe('job-mut-1');
      expect(placementStep.place).not.toHaveBeenCalled();
      expect(scheduleJobService.enqueueReplan).not.toHaveBeenCalled();
      expect(pendingGoogleWrites.syncTask).toHaveBeenCalledWith('user-1', 'task-1');
    });

    it('keeps the old slot and returns a conflict when preferred cannot be taken', async () => {
      lastSaved = { ...seated };
      placementStep.place.mockResolvedValue({
        outcome: 'conflict',
        conflict: {
          taskId: 'task-1',
          taskName: 'Write brief',
          reason: 'preferred_on_fixed',
          options: ['move_new', 'leave_problematic'],
        },
      });

      const updated = await service.update('task-1', 'user-1', {
        scheduledStartTime: '2026-10-08T12:00:00.000Z',
        scheduledEndTime: '2026-10-08T13:00:00.000Z',
      } as any);
      expect(updated.jobId).toBe('job-mut-1');
      await flushMutationFollowUp();

      expect(lastSaved?.scheduledStartTime).toEqual(seated.scheduledStartTime);
      expect(lastSaved?.scheduledEndTime).toEqual(seated.scheduledEndTime);
      expect(scheduleJobService.completeMutationJob).toHaveBeenCalledWith(
        'job-mut-1',
        {
          conflicts: [
            expect.objectContaining({ reason: 'preferred_on_fixed' }),
          ],
        },
      );
      expect(scheduleJobService.enqueueReplan).not.toHaveBeenCalled();
      expect(placementStep.seatOpenHoles).not.toHaveBeenCalled();
    });

    it('keeps the chosen FIXED clock when Place leaves Problematic even on conflict', async () => {
      const start = '2026-10-09T10:00:00.000Z';
      const end = '2026-10-09T10:30:00.000Z';
      lastSaved = {
        id: 'task-1',
        userId: 'user-1',
        name: 'Parked work',
        isUnscheduled: false,
        eventType: TaskEventType.ADMIN,
        status: TaskStatus.TODO,
        scheduleState: 'problematic',
        estimatedTimeInMinutes: 30,
        scheduledStartTime: null,
        scheduledEndTime: null,
        isRecurring: false,
        allowSplit: false,
      };
      placementStep.place.mockResolvedValue({
        outcome: 'conflict',
        conflict: {
          taskId: 'task-1',
          taskName: 'Parked work',
          reason: 'preferred_on_fixed',
          options: ['move_new', 'leave_problematic'],
        },
      });

      const updated = await service.update('task-1', 'user-1', {
        eventType: TaskEventType.FIXED,
        scheduledStartTime: start,
        scheduledEndTime: end,
        scheduleState: 'none',
        isUnscheduled: false,
        problematicOccurrenceYmds: null,
        problematicReason: null,
      } as any);
      await flushMutationFollowUp();

      expect(placementStep.place).toHaveBeenCalledWith(
        'user-1',
        'task-1',
        expect.objectContaining({ commit: 'always' }),
      );
      expect(updated.scheduledStartTime).toEqual(new Date(start));
      expect(updated.scheduledEndTime).toEqual(new Date(end));
      expect(updated.eventType).toBe(TaskEventType.FIXED);
      expect(scheduleJobService.completeMutationJob).toHaveBeenCalledWith(
        'job-mut-1',
        {
          conflicts: [
            expect.objectContaining({ reason: 'preferred_on_fixed' }),
          ],
        },
      );
    });

    it('does not replan or fill holes when a task is completed', async () => {
      lastSaved = { ...seated };
      await service.updateStatus('task-1', 'user-1', TaskStatus.COMPLETED);
      expect(scheduleJobService.enqueueReplan).not.toHaveBeenCalled();
      expect(placementStep.place).not.toHaveBeenCalled();
      expect(placementStep.seatOpenHoles).not.toHaveBeenCalled();
    });

    it('seats problematic tasks after a scheduled task is deleted', async () => {
      lastSaved = { ...seated };
      await service.remove('task-1', 'user-1');
      expect(scheduleJobService.enqueueReplan).not.toHaveBeenCalled();
      expect(placementStep.seatOpenHoles).toHaveBeenCalledWith('user-1');
      expect(pendingGoogleWrites.discardPendingUpserts).toHaveBeenCalledWith(
        'user-1',
        'task-1',
      );
      expect(pendingGoogleWrites.waitForInflight).toHaveBeenCalledWith(
        'user-1',
        'task-1',
      );
      expect(
        scheduleJobService.deleteSyncedGoogleEventsForTask,
      ).toHaveBeenCalled();
    });

    it('deletes Problematic park copies when the parent series is removed', async () => {
      const series = {
        id: 'series-1',
        userId: 'user-1',
        name: 'Gym',
        isUnscheduled: false,
        eventType: TaskEventType.ADMIN,
        googleEventId: 'g-series',
      };
      const copy = {
        id: 'copy-1',
        userId: 'user-1',
        name: 'Gym',
        isUnscheduled: false,
        eventType: TaskEventType.ADMIN,
        parentSeriesId: 'series-1',
        scheduleState: 'problematic',
        googleEventId: null,
      };
      tasksRepository.find.mockImplementation(((opts: { where?: { parentSeriesId?: string } }) => {
        if (opts?.where?.parentSeriesId === 'series-1') return Promise.resolve([{ ...copy }]);
        return Promise.resolve([]);
      }) as never);
      tasksRepository.findOne.mockImplementation(((opts: { where?: { id?: string } }) => {
        if (opts?.where?.id === 'copy-1') return Promise.resolve({ ...copy });
        if (opts?.where?.id === 'series-1') return Promise.resolve({ ...series });
        return Promise.resolve(null);
      }) as never);
      tasksRepository.remove.mockResolvedValue(undefined);

      await service.remove('series-1', 'user-1');

      expect(tasksRepository.remove).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'copy-1' }),
      );
      expect(tasksRepository.remove).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'series-1' }),
      );
    });
  });

  describe('skipOccurrence', () => {
    const futureStart = new Date('2026-09-22T10:00:00.000Z');
    const futureEnd = new Date('2026-09-22T10:30:00.000Z');

    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-09-21T08:00:00.000Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('skips the parent series day then deletes a problematic copy', async () => {
      const parent = {
        id: 'series-1',
        userId: 'user-1',
        name: 'Gym',
        isUnscheduled: false,
        isRecurring: true,
        isFixedExternal: false,
        eventType: TaskEventType.ADMIN,
        status: TaskStatus.TODO,
        scheduleState: 'none',
        skippedOccurrenceYmds: null as string[] | null,
        scheduleTimeZone: 'UTC',
      };
      const copy = {
        id: 'copy-1',
        userId: 'user-1',
        name: 'Gym',
        isUnscheduled: false,
        isRecurring: false,
        isFixedExternal: false,
        eventType: TaskEventType.ADMIN,
        status: TaskStatus.TODO,
        scheduleState: 'problematic',
        parentSeriesId: 'series-1',
        problematicDay: '2026-09-22',
        skippedOccurrenceYmds: null,
        scheduleTimeZone: 'UTC',
      };
      tasksRepository.findOne.mockImplementation(((opts: { where?: { id?: string } }) => {
        if (opts?.where?.id === 'copy-1') return Promise.resolve({ ...copy });
        if (opts?.where?.id === 'series-1') return Promise.resolve({ ...parent });
        return Promise.resolve(null);
      }) as never);
      tasksRepository.save.mockImplementation(((entity: {
        id?: string;
        skippedOccurrenceYmds?: string[] | null;
      }) => {
        if (entity.id === 'series-1') {
          parent.skippedOccurrenceYmds = entity.skippedOccurrenceYmds ?? null;
          return Promise.resolve({ ...parent });
        }
        return Promise.resolve(entity);
      }) as never);
      tasksRepository.remove.mockResolvedValue(undefined);
      scheduledTaskRepository.find.mockResolvedValue([]);

      const skipped = await service.skipOccurrence('copy-1', 'user-1', {
        occurrenceStart: '2026-09-22T09:00:00.000Z',
      });

      expect(parent.skippedOccurrenceYmds).toEqual(['2026-09-22']);
      expect(tasksRepository.remove).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'copy-1' }),
      );
      expect(skipped).toMatchObject({ id: 'copy-1', deleted: true, jobId: null });
      tasksRepository.findOne.mockImplementation(async () => lastSaved);
      tasksRepository.save.mockImplementation(async (entity) => {
        lastSaved = { ...entity, id: entity.id ?? 'task-1' };
        return lastSaved;
      });
    });

    it('removes a one-off slot without completing or replanning', async () => {
      lastSaved = {
        id: 'task-1',
        userId: 'user-1',
        name: 'Write brief',
        isUnscheduled: false,
        isRecurring: false,
        isFixedExternal: false,
        eventType: TaskEventType.ADMIN,
        status: TaskStatus.TODO,
        scheduledStartTime: futureStart,
        scheduledEndTime: futureEnd,
        googleEventId: 'g-1',
        googleEventCalendarId: 'cal-1',
        skippedOccurrenceYmds: null,
      };
      const slot = {
        id: 'slot-1',
        taskId: 'task-1',
        scheduledStartTime: futureStart,
        scheduledEndTime: futureEnd,
        googleEventId: 'g-1',
        googleEventCalendarId: 'cal-1',
      };
      let rows = [slot];
      scheduledTaskRepository.find.mockImplementation(async () => rows);
      scheduledTaskRepository.remove.mockImplementation(async (row: { id: string }) => {
        rows = rows.filter((item) => item.id !== row.id);
      });
      googleCalendarService.checkConnection.mockResolvedValue({ connected: true });

      const result = await service.skipOccurrence('task-1', 'user-1', {
        occurrenceStart: futureStart.toISOString(),
        googleEventId: 'g-1',
        googleEventCalendarId: 'cal-1',
      });

      expect(scheduledTaskRepository.remove).toHaveBeenCalled();
      expect(result.scheduledStartTime).toBeNull();
      expect(result.jobId).toBeNull();
      expect(result.status).toBe(TaskStatus.TODO);
      expect(scheduleJobService.enqueueReplan).not.toHaveBeenCalled();
      expect(placementStep.seatOpenHoles).toHaveBeenCalledWith('user-1');
      expect(googleCalendarService.deleteEvent).toHaveBeenCalledWith(
        'user-1',
        'g-1',
        'cal-1',
      );
    });

    it('records a recurring skip so Generate will not recreate that day', async () => {
      lastSaved = {
        id: 'task-1',
        userId: 'user-1',
        name: 'Gym',
        isUnscheduled: false,
        isRecurring: true,
        isFixedExternal: false,
        eventType: TaskEventType.ADMIN,
        status: TaskStatus.TODO,
        googleEventId: 'series-1',
        skippedOccurrenceYmds: null,
        scheduledStartTime: futureStart,
        scheduledEndTime: futureEnd,
      };
      const slot = {
        id: 'slot-1',
        taskId: 'task-1',
        scheduledStartTime: futureStart,
        scheduledEndTime: futureEnd,
        googleEventId: 'series-1',
      };
      const nextStart = new Date('2026-09-23T08:00:00.000Z');
      const nextEnd = new Date('2026-09-23T08:30:00.000Z');
      const nextSlot = {
        id: 'slot-2',
        taskId: 'task-1',
        scheduledStartTime: nextStart,
        scheduledEndTime: nextEnd,
        googleEventId: 'series-1',
      };
      scheduledTaskRepository.find
        .mockResolvedValueOnce([slot, nextSlot])
        .mockResolvedValueOnce([nextSlot]);
      googleCalendarService.checkConnection.mockResolvedValue({ connected: false });

      const result = await service.skipOccurrence('task-1', 'user-1', {
        occurrenceStart: futureStart.toISOString(),
      });

      expect(result.skippedOccurrenceYmds).toEqual(['2026-09-22']);
      expect(result.scheduledStartTime).toEqual(nextStart);
      expect(result.scheduledEndTime).toEqual(nextEnd);
      expect(result.jobId).toBeNull();
      expect(scheduleJobService.enqueueReplan).not.toHaveBeenCalled();
      expect(placementStep.seatOpenHoles).toHaveBeenCalledWith('user-1');
      expect(googleCalendarService.deleteEvent).not.toHaveBeenCalled();
    });

    it('does not delete an already ended local slot but still removes the Google instance', async () => {
      lastSaved = {
        id: 'task-1',
        userId: 'user-1',
        name: 'Write brief',
        isUnscheduled: false,
        isRecurring: false,
        isFixedExternal: false,
        eventType: TaskEventType.ADMIN,
        status: TaskStatus.TODO,
        googleEventId: 'g-old',
      };
      scheduledTaskRepository.find.mockResolvedValue([
        {
          id: 'slot-1',
          taskId: 'task-1',
          scheduledStartTime: new Date('2026-09-21T07:00:00.000Z'),
          scheduledEndTime: new Date('2026-09-21T07:30:00.000Z'),
          googleEventId: 'g-old',
        },
      ]);
      googleCalendarService.checkConnection.mockResolvedValue({ connected: true });

      const result = await service.skipOccurrence('task-1', 'user-1', {
        occurrenceStart: '2026-09-21T07:00:00.000Z',
        googleEventId: 'g-old',
      });

      expect(scheduledTaskRepository.remove).not.toHaveBeenCalled();
      expect(googleCalendarService.deleteEvent).toHaveBeenCalledWith(
        'user-1',
        'g-old',
        undefined,
      );
      expect(result.jobId).toBeNull();
      expect(scheduleJobService.enqueueReplan).not.toHaveBeenCalled();
      expect(placementStep.seatOpenHoles).not.toHaveBeenCalled();
    });
  });
});
