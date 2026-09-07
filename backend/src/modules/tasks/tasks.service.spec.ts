import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, Logger } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { Task } from './entities/task.entity';
import { Phase } from '../phases/entities/phase.entity';
import { ScheduleJobService } from '../schedule/schedule-job.service';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import { TaskEventType } from '../scheduling/event-type.enum';

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
    merge: jest.fn(),
    remove: jest.fn(),
  };
  const phasesRepository = {
    findBy: jest.fn(),
    findOne: jest.fn(),
  };
  const scheduleJobService = {
    enqueueReplan: jest.fn(),
    processNextPendingForUser: jest.fn(),
    captureFlexibleGoogleSnapshotForTask: jest.fn().mockResolvedValue(null),
    syncFlexibleTaskAfterUserEditIfNeeded: jest.fn().mockResolvedValue(undefined),
    deleteSyncedGoogleEventsForTask: jest.fn().mockResolvedValue(undefined),
  };
  const googleCalendarService = {
    checkConnection: jest.fn().mockResolvedValue({ connected: false }),
    createEvent: jest.fn(),
    updateEvent: jest.fn(),
    deleteEvent: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    lastSaved = null;
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
          provide: ScheduleJobService,
          useValue: scheduleJobService,
        },
        { provide: GoogleCalendarService, useValue: googleCalendarService },
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

  it('enqueues replan for non-fixed tasks', async () => {
    await service.create('user-1', {
      name: 'Task',
      eventType: TaskEventType.ADMIN,
      estimatedTimeInMinutes: 60,
    } as any);

    expect(scheduleJobService.enqueueReplan).toHaveBeenCalledWith('user-1');
    expect(scheduleJobService.processNextPendingForUser).toHaveBeenCalledWith(
      'user-1',
    );
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
      expect(scheduleJobService.enqueueReplan).toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining('earliest=2026-09-11T00:00:00+03:00'),
      );
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining('stored earliest=2026-09-10T21:00:00.000Z'),
      );
      log.mockRestore();
    });

    it('stores a form datetime-local From/Until the same way the client ISO-converts it', async () => {
      const formFrom = '2026-09-08T00:00';
      const formUntil = '2026-09-08T23:59';
      const payload = {
        name: 'Помити машину',
        eventType: TaskEventType.ADMIN,
        estimatedTimeInMinutes: 30,
        earliestStartTime: new Date(formFrom).toISOString(),
        deadline: new Date(formUntil).toISOString(),
        timeZone: 'Asia/Nicosia',
      };

      // eslint-disable-next-line no-console
      console.log('form datetime-local → create payload', {
        formFrom,
        formUntil,
        earliestStartTime: payload.earliestStartTime,
        deadline: payload.deadline,
        hostTzOffsetMinutes: new Date().getTimezoneOffset(),
      });

      await service.create('user-1', payload as any);

      const row = createdRow(tasksRepository);
      expect(row.earliestStartTime).toEqual(new Date(payload.earliestStartTime));
      expect(row.deadline).toEqual(new Date(payload.deadline));
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

    it('saves the window before replan runs', async () => {
      const order: string[] = [];
      tasksRepository.save.mockImplementation(async (entity) => {
        order.push('save');
        lastSaved = { ...entity, id: entity.id ?? 'task-1' };
        return lastSaved;
      });
      scheduleJobService.enqueueReplan.mockImplementation(async () => {
        order.push('replan');
      });

      await service.create('user-1', {
        name: 'Gym',
        eventType: TaskEventType.ADMIN,
        estimatedTimeInMinutes: 30,
        earliestStartTime: '2026-09-11T00:00:00+03:00',
        deadline: '2026-09-11T23:59:00+03:00',
        timeZone: 'Asia/Nicosia',
      } as any);

      expect(order[0]).toBe('save');
      expect(order).toContain('replan');
      expect(order.indexOf('save')).toBeLessThan(order.indexOf('replan'));
    });
  });
});
