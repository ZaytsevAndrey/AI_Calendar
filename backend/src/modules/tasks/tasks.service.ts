import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Task, TaskStatus } from './entities/task.entity';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { Phase } from '../event-phases/entities/phase.entity';
import { TaskEventType, getEventTypeRules } from '../scheduling/event-type.enum';
import {
  FlexibleGoogleSyncSnapshot,
  ScheduleJobService,
} from '../schedule/schedule-job.service';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    @InjectRepository(Task)
    private tasksRepository: Repository<Task>,
    @InjectRepository(Phase)
    private phasesRepository: Repository<Phase>,
    @Inject(forwardRef(() => ScheduleJobService))
    private readonly scheduleJobService: ScheduleJobService,
    private readonly googleCalendarService: GoogleCalendarService,
  ) {}

  private canSyncTaskToGoogle(task: Task): boolean {
    return (
      task.eventType === TaskEventType.FIXED &&
      !!task.scheduledStartTime &&
      !!task.scheduledEndTime
    );
  }

  private buildGoogleEventPayload(task: Task): Record<string, unknown> {
    return {
      summary: task.name,
      description: task.description || undefined,
      start: {
        dateTime: task.scheduledStartTime?.toISOString(),
        timeZone: 'UTC',
      },
      end: {
        dateTime: task.scheduledEndTime?.toISOString(),
        timeZone: 'UTC',
      },
    };
  }

  private async syncTaskWithGoogleCalendar(
    userId: string,
    task: Task,
  ): Promise<void> {
    if (!this.canSyncTaskToGoogle(task)) {
      // Non-FIXED tasks use googleEventId from replan sync; do not delete here.
      return;
    }

    const conn = await this.googleCalendarService.checkConnection(userId);
    if (!conn.connected) {
      this.logger.warn(
        `Google Calendar not connected for user ${userId}; skipped sync for FIXED task ${task.id}.`,
      );
      return;
    }

    const payload = this.buildGoogleEventPayload(task);
    const syncOpts = { skipSleepWindowCheck: true } as const;
    try {
      if (task.googleEventId) {
        await this.googleCalendarService.updateEvent(
          userId,
          task.googleEventId,
          payload,
          syncOpts,
        );
      } else {
        const ev = await this.googleCalendarService.createEvent(
          userId,
          payload,
          syncOpts,
        );
        if (typeof ev?.id === 'string') {
          task.googleEventId = ev.id;
        }
      }
    } catch (e: any) {
      this.logger.warn(
        `Failed to sync task ${task.id} to Google Calendar: ${e?.message ?? e}`,
      );
    }
  }

  private async loadPhasesForUser(
    userId: string,
    phaseIds: string[],
  ): Promise<Phase[]> {
    if (!phaseIds.length) return [];
    const phases = await this.phasesRepository.findBy({ id: In(phaseIds) });
    if (phases.length !== phaseIds.length) {
      throw new BadRequestException('One or more phase IDs are invalid');
    }
    for (const p of phases) {
      if (p.userId !== userId) {
        throw new BadRequestException('Phases must belong to your account');
      }
    }
    return phases;
  }

  async create(userId: string, createTaskDto: CreateTaskDto): Promise<Task> {
    const eventType = createTaskDto.eventType ?? TaskEventType.ADMIN;
    const rules = getEventTypeRules(eventType);

    if (eventType === TaskEventType.FIXED) {
      if (!createTaskDto.scheduledStartTime || !createTaskDto.scheduledEndTime) {
        throw new BadRequestException(
          'FIXED items require scheduledStartTime and scheduledEndTime',
        );
      }
    }

    const estimatedTimeInMinutes =
      createTaskDto.estimatedTimeInMinutes ?? rules.defaultDurationMinutes;

    const {
      phaseIds,
      scheduledStartTime,
      scheduledEndTime,
      deadline,
      ...rest
    } = createTaskDto;

    if (phaseIds && phaseIds.length > 1) {
      throw new BadRequestException('Only one phase is supported per task');
    }

    const task = this.tasksRepository.create({
      ...rest,
      userId,
      eventType,
      estimatedTimeInMinutes,
      deadline: deadline ? new Date(deadline) : undefined,
      scheduledStartTime: scheduledStartTime
        ? new Date(scheduledStartTime)
        : undefined,
      scheduledEndTime: scheduledEndTime
        ? new Date(scheduledEndTime)
        : undefined,
    });

    if (phaseIds?.length) {
      const phases = await this.loadPhasesForUser(userId, phaseIds);
      task.phases = phases;
      task.phaseId = phaseIds[0];
    } else if (createTaskDto.phaseId) {
      const phases = await this.loadPhasesForUser(userId, [
        createTaskDto.phaseId,
      ]);
      if (phases.length) {
        task.phases = phases;
        task.phaseId = createTaskDto.phaseId;
      }
    }

    const saved = await this.tasksRepository.save(task);
    await this.syncTaskWithGoogleCalendar(userId, saved);
    await this.tasksRepository.save(saved);

    if (eventType !== TaskEventType.FIXED) {
      await this.scheduleJobService.enqueueReplan(userId);
      await this.scheduleJobService.processNextPendingForUser(userId);
    }

    return this.findOne(saved.id, userId);
  }

  async findAll(userId: string): Promise<Task[]> {
    return this.tasksRepository.find({
      where: { userId },
      relations: ['phase', 'phases'],
      order: {
        createdAt: 'DESC',
      },
    });
  }

  async findOne(id: string, userId: string): Promise<Task> {
    const task = await this.tasksRepository.findOne({
      where: { id, userId },
      relations: ['phase', 'phases'],
    });

    if (!task) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    return task;
  }

  async update(
    id: string,
    userId: string,
    updateTaskDto: UpdateTaskDto,
  ): Promise<Task> {
    const task = await this.findOne(id, userId);
    let flexibleGoogleSnapshotBefore: FlexibleGoogleSyncSnapshot | null = null;
    if (task.eventType !== TaskEventType.FIXED) {
      flexibleGoogleSnapshotBefore =
        await this.scheduleJobService.captureFlexibleGoogleSnapshotForTask(
          userId,
          task.id,
        );
    }

    const dto = updateTaskDto as UpdateTaskDto & {
      phaseIds?: string[];
      scheduledStartTime?: string;
      scheduledEndTime?: string;
      eventType?: TaskEventType;
    };

    if (dto.phaseIds !== undefined) {
      if (dto.phaseIds.length > 1) {
        throw new BadRequestException('Only one phase is supported per task');
      }
      if (dto.phaseIds.length === 0) {
        task.phases = [];
        task.phaseId = null;
      } else {
        const phases = await this.loadPhasesForUser(userId, dto.phaseIds);
        task.phases = phases;
        task.phaseId = dto.phaseIds[0];
      }
    }

    const {
      phaseIds: _p,
      deadline,
      scheduledStartTime,
      scheduledEndTime,
      ...rest
    } = dto;
    this.tasksRepository.merge(task, rest);

    if (deadline !== undefined) {
      task.deadline = deadline ? new Date(deadline) : null;
    }
    if (scheduledStartTime !== undefined) {
      task.scheduledStartTime = scheduledStartTime
        ? new Date(scheduledStartTime)
        : null;
    }
    if (scheduledEndTime !== undefined) {
      task.scheduledEndTime = scheduledEndTime
        ? new Date(scheduledEndTime)
        : null;
    }

    if (task.eventType === TaskEventType.FIXED) {
      if (!task.scheduledStartTime || !task.scheduledEndTime) {
        throw new BadRequestException(
          'FIXED items require scheduledStartTime and scheduledEndTime',
        );
      }
    }

    const saved = await this.tasksRepository.save(task);
    await this.syncTaskWithGoogleCalendar(userId, saved);
    await this.tasksRepository.save(saved);

    const shouldReplanNonFixed =
      saved.eventType !== TaskEventType.FIXED &&
      (saved.status === TaskStatus.TODO ||
        saved.status === TaskStatus.IN_PROGRESS);

    if (shouldReplanNonFixed) {
      await this.scheduleJobService.enqueueReplan(userId);
      await this.scheduleJobService.processNextPendingForUser(userId);
    }

    if (flexibleGoogleSnapshotBefore) {
      await this.scheduleJobService.syncFlexibleTaskAfterUserEditIfNeeded(
        userId,
        saved.id,
        flexibleGoogleSnapshotBefore,
      );
    }

    return this.findOne(saved.id, userId);
  }

  async remove(id: string, userId: string): Promise<void> {
    const task = await this.findOne(id, userId);
    if (task.googleEventId) {
      try {
        await this.googleCalendarService.deleteEvent(userId, task.googleEventId);
      } catch (e: any) {
        this.logger.warn(
          `Failed to delete Google event for removed task ${task.id}: ${e?.message ?? e}`,
        );
      }
    }
    await this.tasksRepository.remove(task);
    await this.scheduleJobService.enqueueReplan(userId);
    await this.scheduleJobService.processNextPendingForUser(userId);
  }

  async findByStatus(userId: string, status: TaskStatus): Promise<Task[]> {
    return this.tasksRepository.find({
      where: { userId, status },
      relations: ['phase', 'phases'],
      order: {
        createdAt: 'DESC',
      },
    });
  }

  async findByPhase(userId: string, phaseId: string): Promise<Task[]> {
    return this.tasksRepository.find({
      where: { userId, phaseId },
      relations: ['phase', 'phases'],
      order: {
        createdAt: 'DESC',
      },
    });
  }

  async updateStatus(
    id: string,
    userId: string,
    status: TaskStatus,
  ): Promise<Task> {
    const task = await this.findOne(id, userId);
    task.status = status;
    const saved = await this.tasksRepository.save(task);
    if (
      saved.eventType !== TaskEventType.FIXED &&
      saved.status === TaskStatus.TODO
    ) {
      await this.scheduleJobService.enqueueReplan(userId);
      await this.scheduleJobService.processNextPendingForUser(userId);
    }
    return saved;
  }
}
