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
import { isValidIanaTimeZone } from '../../common/iana-time-zone';
import { Task, TaskStatus } from './entities/task.entity';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { Phase } from '../phases/entities/phase.entity';
import { UserSettings } from '../user-settings/entities/user-settings.entity';
import { TaskEventType, getEventTypeRules } from '../scheduling/event-type.enum';
import { ScheduleJobService } from '../schedule/schedule-job.service';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import { phaseHexToGoogleColorId } from '../google-calendar/phase-hex-to-google-color-id.util';
import { applyTaskGoogleEventFields } from '../google-calendar/task-google-event-fields.util';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    @InjectRepository(Task)
    private tasksRepository: Repository<Task>,
    @InjectRepository(Phase)
    private phasesRepository: Repository<Phase>,
    @InjectRepository(UserSettings)
    private userSettingsRepository: Repository<UserSettings>,
    @Inject(forwardRef(() => ScheduleJobService))
    private readonly scheduleJobService: ScheduleJobService,
    private readonly googleCalendarService: GoogleCalendarService,
  ) {}

  private canSyncTaskToGoogle(task: Task): boolean {
    return (
      !task.isUnscheduled &&
      task.eventType === TaskEventType.FIXED &&
      !!task.scheduledStartTime &&
      !!task.scheduledEndTime
    );
  }

  private shouldReplanAfterSave(
    previous: { isUnscheduled: boolean } | null,
    saved: Task,
  ): boolean {
    if (saved.isUnscheduled) {
      return !!previous && !previous.isUnscheduled;
    }
    if (saved.eventType === TaskEventType.FIXED) {
      return false;
    }
    return (
      saved.status !== TaskStatus.COMPLETED &&
      saved.status !== TaskStatus.CANCELED
    );
  }

  private applyUnscheduledConstraints(task: Task): void {
    if (!task.isUnscheduled) {
      return;
    }
    if (task.eventType === TaskEventType.FIXED) {
      throw new BadRequestException('Unscheduled tasks cannot be fixed');
    }
    task.eventType = TaskEventType.ADMIN;
    task.isRecurring = false;
    task.recurrencePattern = null;
    task.scheduledStartTime = null;
    task.scheduledEndTime = null;
  }

  private resolveTaskPhaseColorHex(task: Task): string | undefined {
    const p = task.phases?.[0] ?? task.phase;
    return p?.color;
  }

  private buildGoogleEventPayload(task: Task): Record<string, unknown> {
    const fallbackColorId = phaseHexToGoogleColorId(
      this.resolveTaskPhaseColorHex(task),
    );
    const payload: Record<string, unknown> = {
      summary: task.name,
      description: task.description || undefined,
      start: {
        dateTime: task.scheduledStartTime?.toISOString(),
        timeZone: task.scheduleTimeZone || 'UTC',
      },
      end: {
        dateTime: task.scheduledEndTime?.toISOString(),
        timeZone: task.scheduleTimeZone || 'UTC',
      },
    };
    return applyTaskGoogleEventFields(payload, task, fallbackColorId);
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
    const syncOpts = {
      skipSleepWindowCheck: true as const,
      calendarId: task.googleEventCalendarId ?? 'primary',
    };
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
        const appCal = (ev as { appCalendarId?: string }).appCalendarId;
        if (appCal) {
          task.googleEventCalendarId = appCal;
        }
      }
    } catch (e: any) {
      this.logger.warn(
        `Failed to sync task ${task.id} to Google Calendar: ${e?.message ?? e}`,
      );
    }
  }

  private async resolveTaskTimeZone(
    userId: string,
    timeZone?: string,
  ): Promise<string | undefined> {
    const fromDto = timeZone?.trim();
    if (fromDto && isValidIanaTimeZone(fromDto)) {
      return fromDto;
    }
    const settings = await this.userSettingsRepository.findOne({
      where: { userId },
    });
    const fromSettings = settings?.timeZone?.trim();
    if (fromSettings && isValidIanaTimeZone(fromSettings)) {
      return fromSettings;
    }
    return fromDto || undefined;
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

  private async attachReplanJob(
    userId: string,
    task: Task,
    shouldReplan: boolean,
  ): Promise<Task & { jobId: string | null }> {
    let jobId: string | null = null;
    if (shouldReplan) {
      const job = await this.scheduleJobService.enqueueReplan(userId);
      jobId = job.id;
      void this.scheduleJobService.processNextPendingForUser(userId);
    }
    return Object.assign(task, { jobId });
  }

  async create(
    userId: string,
    createTaskDto: CreateTaskDto,
  ): Promise<Task & { jobId: string | null }> {
    const isUnscheduled = !!createTaskDto.isUnscheduled;
    const eventType = isUnscheduled
      ? TaskEventType.ADMIN
      : (createTaskDto.eventType ?? TaskEventType.ADMIN);
    const rules = getEventTypeRules(eventType);

    if (isUnscheduled && createTaskDto.eventType === TaskEventType.FIXED) {
      throw new BadRequestException('Unscheduled tasks cannot be fixed');
    }

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
      earliestStartTime,
      timeZone,
      ...rest
    } = createTaskDto;

    if (phaseIds && phaseIds.length > 1) {
      throw new BadRequestException('Only one phase is supported per task');
    }

    const scheduleTimeZone = await this.resolveTaskTimeZone(userId, timeZone);

    const task = this.tasksRepository.create({
      ...rest,
      userId,
      eventType,
      isUnscheduled,
      estimatedTimeInMinutes,
      deadline: deadline ? new Date(deadline) : undefined,
      earliestStartTime: earliestStartTime
        ? new Date(earliestStartTime)
        : undefined,
      scheduleTimeZone,
      scheduledStartTime: scheduledStartTime
        ? new Date(scheduledStartTime)
        : undefined,
      scheduledEndTime: scheduledEndTime
        ? new Date(scheduledEndTime)
        : undefined,
    });
    this.applyUnscheduledConstraints(task);

    this.logger.log(
      `create task "${createTaskDto.name}": incoming earliest=${earliestStartTime ?? 'null'} deadline=${deadline ?? 'null'} tz=${timeZone ?? 'null'} resolvedTz=${scheduleTimeZone ?? 'null'} scheduledStart=${scheduledStartTime ?? 'null'} → stored earliest=${task.earliestStartTime?.toISOString() ?? 'null'} deadline=${task.deadline?.toISOString() ?? 'null'} scheduleTz=${task.scheduleTimeZone ?? 'null'}`,
    );

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

    const row = await this.findOne(saved.id, userId);
    return this.attachReplanJob(
      userId,
      row,
      this.shouldReplanAfterSave(null, row),
    );
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
  ): Promise<Task & { jobId: string | null }> {
    const task = await this.findOne(id, userId);
    const wasUnscheduled = task.isUnscheduled;

    const dto = updateTaskDto as UpdateTaskDto & {
      phaseIds?: string[];
      scheduledStartTime?: string;
      scheduledEndTime?: string;
      earliestStartTime?: string | null;
      timeZone?: string;
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
      earliestStartTime,
      timeZone,
      scheduledStartTime,
      scheduledEndTime,
      ...rest
    } = dto;
    this.tasksRepository.merge(task, rest);

    if (deadline !== undefined) {
      task.deadline = deadline ? new Date(deadline) : null;
    }
    if (earliestStartTime !== undefined) {
      task.earliestStartTime = earliestStartTime
        ? new Date(earliestStartTime)
        : null;
    }
    if (timeZone !== undefined) {
      task.scheduleTimeZone =
        (await this.resolveTaskTimeZone(userId, timeZone)) ?? null;
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

    this.applyUnscheduledConstraints(task);

    if (task.eventType === TaskEventType.FIXED) {
      if (!task.scheduledStartTime || !task.scheduledEndTime) {
        throw new BadRequestException(
          'FIXED items require scheduledStartTime and scheduledEndTime',
        );
      }
    }

    if (task.isUnscheduled && !wasUnscheduled && task.googleEventId) {
      try {
        await this.scheduleJobService.deleteSyncedGoogleEventsForTask(
          userId,
          task,
        );
      } catch (e: any) {
        this.logger.warn(
          `Failed to delete Google event for unscheduled task ${task.id}: ${e?.message ?? e}`,
        );
      }
      task.googleEventId = null;
      task.googleEventCalendarId = null;
    }

    const saved = await this.tasksRepository.save(task);
    await this.syncTaskWithGoogleCalendar(userId, saved);
    await this.tasksRepository.save(saved);

    const row = await this.findOne(saved.id, userId);
    return this.attachReplanJob(
      userId,
      row,
      this.shouldReplanAfterSave({ isUnscheduled: wasUnscheduled }, row),
    );
  }

  async remove(id: string, userId: string): Promise<void> {
    const task = await this.findOne(id, userId);
    if (task.googleEventId || task.eventType !== TaskEventType.FIXED) {
      try {
        await this.scheduleJobService.deleteSyncedGoogleEventsForTask(userId, task);
      } catch (e: any) {
        this.logger.warn(
          `Failed to delete Google event for removed task ${task.id}: ${e?.message ?? e}`,
        );
      }
    }
    const shouldReplan = !task.isUnscheduled;
    await this.tasksRepository.remove(task);
    if (shouldReplan) {
      await this.scheduleJobService.enqueueReplan(userId);
      void this.scheduleJobService.processNextPendingForUser(userId);
    }
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
    if (this.shouldReplanAfterSave({ isUnscheduled: saved.isUnscheduled }, saved)) {
      await this.scheduleJobService.enqueueReplan(userId);
      void this.scheduleJobService.processNextPendingForUser(userId);
    }
    return saved;
  }
}
