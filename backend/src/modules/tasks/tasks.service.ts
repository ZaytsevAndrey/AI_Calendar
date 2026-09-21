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
import { isValidIanaTimeZone, resolveIanaTimeZone } from '../../common/iana-time-zone';
import { Task, TaskStatus } from './entities/task.entity';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { SkipOccurrenceDto } from './dto/skip-occurrence.dto';
import { Phase } from '../phases/entities/phase.entity';
import { UserSettings } from '../user-settings/entities/user-settings.entity';
import { TaskEventType, getEventTypeRules } from '../scheduling/event-type.enum';
import { ScheduleJobService } from '../schedule/schedule-job.service';
import { ScheduledTask } from '../schedule/schedule.entity';
import { hasFullyEnded } from '../schedule/google-segment-sync.util';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import { phaseHexToGoogleColorId } from '../google-calendar/phase-hex-to-google-color-id.util';
import { applyTaskGoogleEventFields } from '../google-calendar/task-google-event-fields.util';
import { localYmd } from '../voice/voice-local-date.util';
import {
  addSkippedOccurrenceYmd,
  googleRecurringInstanceId,
  matchScheduledSlotIndex,
} from './skipped-occurrence.util';

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
    @InjectRepository(ScheduledTask)
    private scheduledTaskRepository: Repository<ScheduledTask>,
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

  async skipOccurrence(
    id: string,
    userId: string,
    dto: SkipOccurrenceDto,
  ): Promise<Task & { jobId: string | null }> {
    const task = await this.findOne(id, userId);
    if (task.isUnscheduled) {
      throw new BadRequestException('Unscheduled tasks have no occurrence to skip');
    }
    if (task.isFixedExternal || task.eventType === TaskEventType.FIXED) {
      throw new BadRequestException('Fixed events cannot be skipped');
    }
    if (task.status === TaskStatus.COMPLETED || task.status === TaskStatus.CANCELED) {
      throw new BadRequestException('Completed or canceled tasks cannot be skipped');
    }

    const occurrenceStart = new Date(dto.occurrenceStart);
    if (Number.isNaN(occurrenceStart.getTime())) {
      throw new BadRequestException('occurrenceStart must be a valid ISO date');
    }

    const settings = await this.userSettingsRepository.findOne({
      where: { userId },
    });
    const timeZone = resolveIanaTimeZone(
      settings?.timeZone || task.scheduleTimeZone,
    );
    const nowMs = Date.now();
    const occurrenceYmd = localYmd(occurrenceStart.toISOString(), timeZone);
    const rows = await this.scheduledTaskRepository.find({
      where: { taskId: task.id },
    });
    const slot = this.pickSkipSlot(
      rows,
      occurrenceStart,
      occurrenceYmd,
      timeZone,
      nowMs,
    );
    const openSlot =
      slot && hasFullyEnded(slot.scheduledEndTime, nowMs) ? null : slot;
    if (!openSlot && !task.isRecurring && !dto.googleEventId) {
      throw new BadRequestException('No matching scheduled slot to skip');
    }

    if (task.isRecurring) {
      task.skippedOccurrenceYmds = addSkippedOccurrenceYmd(
        task.skippedOccurrenceYmds,
        occurrenceYmd,
      );
    }

    if (openSlot) {
      await this.scheduledTaskRepository.remove(openSlot);
    }

    const remaining = (await this.scheduledTaskRepository.find({
      where: { taskId: task.id },
    })).sort(
      (a, b) =>
        new Date(a.scheduledStartTime).getTime() -
        new Date(b.scheduledStartTime).getTime(),
    );
    this.refreshTaskScheduleAfterSkip(task, remaining);

    const googleEventId = this.googleEventIdToSkip(
      task,
      dto.googleEventId,
      openSlot ?? slot,
      occurrenceStart,
    );
    if (googleEventId) {
      await this.deleteSkippedGoogleEvent(
        userId,
        googleEventId,
        dto.googleEventCalendarId ||
          slot?.googleEventCalendarId ||
          task.googleEventCalendarId,
      );
      if (!task.isRecurring && googleEventId === task.googleEventId) {
        const leftover = remaining.find((row) => row.googleEventId);
        task.googleEventId = leftover?.googleEventId ?? null;
        task.googleEventCalendarId =
          leftover?.googleEventCalendarId ?? null;
      }
    }

    const saved = await this.tasksRepository.save(task);
    const row = await this.findOne(saved.id, userId);
    return Object.assign(row, { jobId: null });
  }

  private pickSkipSlot(
    rows: ScheduledTask[],
    occurrenceStart: Date,
    occurrenceYmd: string,
    timeZone: string,
    nowMs: number,
  ): ScheduledTask | null {
    const byStart = matchScheduledSlotIndex(rows, occurrenceStart);
    if (byStart >= 0) return rows[byStart];
    const sameDay = rows.filter(
      (row) =>
        localYmd(new Date(row.scheduledStartTime).toISOString(), timeZone) ===
        occurrenceYmd,
    );
    if (!sameDay.length) return null;
    const open = sameDay.filter(
      (row) => !hasFullyEnded(row.scheduledEndTime, nowMs),
    );
    return (open[0] ?? sameDay[0]) ?? null;
  }

  private refreshTaskScheduleAfterSkip(
    task: Task,
    remaining: ScheduledTask[],
  ): void {
    if (task.isRecurring) return;
    if (!remaining.length) {
      task.scheduledStartTime = null;
      task.scheduledEndTime = null;
      return;
    }
    task.scheduledStartTime = new Date(remaining[0].scheduledStartTime);
    task.scheduledEndTime = new Date(
      remaining[remaining.length - 1].scheduledEndTime,
    );
  }

  private googleEventIdToSkip(
    task: Task,
    requestedId: string | undefined,
    slot: ScheduledTask | null,
    occurrenceStart: Date,
  ): string | null {
    const master = task.googleEventId;
    if (task.isRecurring) {
      if (requestedId && requestedId !== master) return requestedId;
      const start = slot
        ? new Date(slot.scheduledStartTime)
        : occurrenceStart;
      if (master && !Number.isNaN(start.getTime())) {
        return googleRecurringInstanceId(master, start);
      }
      return null;
    }
    return requestedId || slot?.googleEventId || master || null;
  }

  private async deleteSkippedGoogleEvent(
    userId: string,
    eventId: string,
    calendarId?: string | null,
  ): Promise<void> {
    try {
      const conn = await this.googleCalendarService.checkConnection(userId);
      if (!conn.connected) return;
      await this.googleCalendarService.deleteEvent(
        userId,
        eventId,
        calendarId ?? undefined,
      );
    } catch (e: any) {
      this.logger.warn(
        `Failed to delete skipped Google event ${eventId}: ${e?.message ?? e}`,
      );
    }
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
