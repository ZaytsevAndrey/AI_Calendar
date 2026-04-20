import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { Task } from './entities/task.entity';
import { Phase } from '../event-phases/entities/phase.entity';
import { ScheduleJobService } from '../schedule/schedule-job.service';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import { TaskEventType } from '../scheduling/event-type.enum';

describe('TasksService', () => {
  let service: TasksService;
  const tasksRepository = {
    create: jest.fn((value) => value),
    save: jest.fn(async (entity) => ({ ...entity, id: entity.id ?? 'task-1' })),
    find: jest.fn(),
    findOne: jest.fn(async ({ where: { id, userId } }) => ({
      id,
      userId,
      name: 'Task',
      eventType: TaskEventType.ADMIN,
    })),
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
  };
  const googleCalendarService = {
    checkConnection: jest.fn().mockResolvedValue({ connected: false }),
    createEvent: jest.fn(),
    updateEvent: jest.fn(),
    deleteEvent: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
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
    tasksRepository.findOne.mockResolvedValue({
      id: 'task-1',
      userId: 'user-1',
      name: 'Task',
      eventType: TaskEventType.ADMIN,
    });

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
    tasksRepository.findOne.mockResolvedValue({
      id: 'task-1',
      userId: 'user-1',
      name: 'Fixed',
      eventType: TaskEventType.FIXED,
    });

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
});
