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
import {
  clearParkMetadata,
  isProblematicSchedule,
  rememberSingleProblematicDay,
  ScheduleState,
  Task,
  TaskStatus,
} from './entities/task.entity';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { SkipOccurrenceDto } from './dto/skip-occurrence.dto';
import { Phase } from '../phases/entities/phase.entity';
import { UserSettings } from '../user-settings/entities/user-settings.entity';
import { TaskEventType, getEventTypeRules } from '../scheduling/event-type.enum';
import { ScheduleJobService } from '../schedule/schedule-job.service';
import {
  PlacementStepService,
  type PlaceOptions,
} from '../schedule/placement-step.service';
import type { PlacementPlan } from '../schedule/placement-step.util';
import type { SchedulingConflict } from '../schedule/intelligent-scheduling.engine';
import { ScheduledTask } from '../schedule/schedule.entity';
import { hasFullyEnded } from '../schedule/google-segment-sync.util';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import { PendingGoogleWriteService } from '../google-calendar/pending-google-write.service';
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
    @Inject(forwardRef(() => PlacementStepService))
    private readonly placementStep: PlacementStepService,
    private readonly googleCalendarService: GoogleCalendarService,
    private readonly pendingGoogleWrites: PendingGoogleWriteService,
  ) {}

  private canPlace(task: Task): boolean {
    if (task.isUnscheduled || isProblematicSchedule(task)) return false;
    if (task.scheduleState === ScheduleState.RESOLVED) return false;
    if (
      task.status === TaskStatus.COMPLETED ||
      task.status === TaskStatus.CANCELED
    ) {
      return false;
    }
    return true;
  }

  private applyUnscheduledConstraints(task: Task): void {
    if (task.isUnscheduled && isProblematicSchedule(task)) {
      // Unscheduled (intentional inbox) wins when both arrive set.
      clearParkMetadata(task);
    }
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

  private applyProblematicConstraints(task: Task): void {
    if (task.scheduleState === ScheduleState.RESOLVED) {
      if (task.isUnscheduled) {
        task.isUnscheduled = false;
      }
      return;
    }
    if (!isProblematicSchedule(task)) {
      clearParkMetadata(task);
      return;
    }
    if (task.isUnscheduled) {
      task.isUnscheduled = false;
    }
    rememberSingleProblematicDay(task);
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

  private snapshot(task: Task): ScheduleSnapshot {
    return {
      isUnscheduled: !!task.isUnscheduled,
      scheduleState: task.scheduleState ?? ScheduleState.NONE,
      eventType: task.eventType,
      estimatedTimeInMinutes: task.estimatedTimeInMinutes ?? 0,
      scheduledStartTime: isoInstant(task.scheduledStartTime),
      scheduledEndTime: isoInstant(task.scheduledEndTime),
      earliestStartTime: isoInstant(task.earliestStartTime),
      deadline: isoInstant(task.deadline),
      phaseId: task.phaseId ?? null,
      isRecurring: !!task.isRecurring,
      recurrencePattern: task.recurrencePattern ?? null,
      recurrenceWeekDays: JSON.stringify(task.recurrenceWeekDays ?? null),
      eligibleWeekDays: JSON.stringify(task.eligibleWeekDays ?? null),
      allowSplit: !!task.allowSplit,
    };
  }

  private geometryChanged(before: ScheduleSnapshot, after: ScheduleSnapshot): boolean {
    return (Object.keys(before) as (keyof ScheduleSnapshot)[]).some(
      (key) => before[key] !== after[key],
    );
  }

  private placeOptions(
    before: ScheduleSnapshot | null,
    task: Task,
  ): PlaceOptions | null {
    if (!this.canPlace(task)) return null;
    const after = this.snapshot(task);
    if (before && !this.geometryChanged(before, after)) return null;

    const patternChanged =
      !!before &&
      (before.isRecurring !== after.isRecurring ||
        before.recurrencePattern !== after.recurrencePattern ||
        before.recurrenceWeekDays !== after.recurrenceWeekDays);
    const startChanged =
      !!before && before.scheduledStartTime !== after.scheduledStartTime;
    const leftInbox =
      !!before &&
      ((before.isUnscheduled && !after.isUnscheduled) ||
        (before.scheduleState === ScheduleState.PROBLEMATIC &&
          after.scheduleState === ScheduleState.NONE) ||
        (before.scheduleState === ScheduleState.RESOLVED &&
          after.scheduleState === ScheduleState.NONE &&
          !after.scheduledStartTime));

    if (!before || (leftInbox && !startChanged && !task.scheduledStartTime)) {
      return {
        searchHole:
          !task.scheduledStartTime && task.eventType !== TaskEventType.FIXED,
        expandSeries: !!task.isRecurring,
      };
    }
    if (startChanged && task.scheduledStartTime) {
      // FIXED clocks are user-chosen (calendar drag, Problematic Move Place).
      // `preferred` + revert would wipe times when leaving Problematic (before
      // had no seat) or when placement returns a conflict — Place then hung
      // with no slot. Always commit the chosen interval; soft peers still move.
      if (task.eventType === TaskEventType.FIXED) {
        return {
          commit: 'always',
          preferredStart: new Date(task.scheduledStartTime),
          durationMinutes: task.estimatedTimeInMinutes,
          expandSeries: !!task.isRecurring,
        };
      }
      return {
        commit: 'preferred',
        preferredStart: new Date(task.scheduledStartTime),
        durationMinutes: task.estimatedTimeInMinutes,
        expandSeries: !!task.isRecurring,
      };
    }
    const durationChanged =
      before.estimatedTimeInMinutes !== after.estimatedTimeInMinutes;
    const endChanged = before.scheduledEndTime !== after.scheduledEndTime;
    if (durationChanged || endChanged) {
      return { expandSeries: !!task.isRecurring };
    }
    if (task.isRecurring && patternChanged) {
      return { commit: 'keep', expandSeries: true };
    }
    return { commit: 'keep' };
  }

  private async placeSavedTask(
    userId: string,
    before: ScheduleSnapshot,
    task: Task,
  ): Promise<SchedulingConflict | null> {
    const opts = this.placeOptions(before, task);
    if (!opts) return null;
    const plan = await this.placementStep.place(userId, task.id, opts);
    if (opts.commit === 'preferred' && !preferredHonored(plan, opts)) {
      // Keep an explicit FIXED clock when the previous snapshot had no seat
      // (Problematic / Unscheduled → Place). Reverting to null left FIXED
      // without times and the Move sheet looked stuck.
      if (
        !(
          task.eventType === TaskEventType.FIXED &&
          task.scheduledStartTime &&
          !before.scheduledStartTime
        )
      ) {
        task.scheduledStartTime = before.scheduledStartTime
          ? new Date(before.scheduledStartTime)
          : null;
        task.scheduledEndTime = before.scheduledEndTime
          ? new Date(before.scheduledEndTime)
          : null;
        task.estimatedTimeInMinutes = before.estimatedTimeInMinutes;
        await this.tasksRepository.save(task);
      }
      return plan.outcome === 'conflict' ? plan.conflict : null;
    }
    if (freedAHole(before, plan, opts)) {
      await this.placementStep.seatOpenHoles(userId);
    }
    return plan.outcome === 'conflict' ? plan.conflict : null;
  }

  /** Seat a resolved copy as a second layer on its original interval. */
  private async seatResolvedLayer(task: Task): Promise<void> {
    if (!task.scheduledStartTime || !task.scheduledEndTime) return;
    const now = Date.now();
    const rows = await this.scheduledTaskRepository.find({
      where: { taskId: task.id },
    });
    const open = rows.filter(
      (row) => new Date(row.scheduledEndTime).getTime() > now,
    );
    if (open.length) await this.scheduledTaskRepository.remove(open);
    await this.scheduledTaskRepository.save(
      this.scheduledTaskRepository.create({
        taskId: task.id,
        scheduledStartTime: task.scheduledStartTime,
        scheduledEndTime: task.scheduledEndTime,
        isAutoGenerated: true,
      }),
    );
  }

  private withConflicts<T extends Task>(
    task: T,
    conflicts?: SchedulingConflict[],
    jobId: string | null = null,
  ): T & { jobId: string | null; conflicts?: SchedulingConflict[] } {
    const row = Object.assign(task, { jobId });
    if (conflicts?.length) {
      return Object.assign(row, { conflicts });
    }
    return row;
  }

  /**
   * After the HTTP save returns, place + Google sync continue on a polled job
   * so the client can show real progress stages.
   */
  private queuePlaceAndSync(
    userId: string,
    taskId: string,
    jobId: string,
    before: ScheduleSnapshot | null,
  ): void {
    void this.runPlaceAndSyncJob(userId, taskId, jobId, before).catch(
      (err: unknown) => {
        this.logger.error(
          `Mutation job ${jobId} failed for task ${taskId}`,
          err instanceof Error ? err.stack : undefined,
        );
      },
    );
  }

  private async runPlaceAndSyncJob(
    userId: string,
    taskId: string,
    jobId: string,
    before: ScheduleSnapshot | null,
  ): Promise<void> {
    try {
      await this.scheduleJobService.setMutationStage(jobId, 'placing');
      const row = await this.findOne(taskId, userId);
      let conflicts: SchedulingConflict[] | undefined;
      if (before) {
        const conflict = await this.placeSavedTask(userId, before, row);
        if (conflict) conflicts = [conflict];
      } else {
        const opts = this.placeOptions(null, row);
        if (opts) {
          const plan = await this.placementStep.place(userId, row.id, opts);
          if (plan.outcome === 'conflict') conflicts = [plan.conflict];
        }
      }
      await this.scheduleJobService.setMutationStage(jobId, 'syncing');
      await this.pendingGoogleWrites.syncTask(userId, taskId);
      await this.scheduleJobService.completeMutationJob(
        jobId,
        conflicts?.length ? { conflicts } : undefined,
      );
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Task mutation follow-up failed';
      await this.scheduleJobService.failMutationJob(jobId, message);
    }
  }

  private async releaseOpenSlots(taskId: string): Promise<void> {
    const rows = await this.scheduledTaskRepository.find({ where: { taskId } });
    const now = Date.now();
    const open = rows.filter(
      (row) => new Date(row.scheduledEndTime).getTime() > now,
    );
    if (open.length) await this.scheduledTaskRepository.remove(open);
  }

  private async finishSaved(
    userId: string,
    task: Task,
    opts?: { syncGoogle?: boolean; jobId?: string | null },
  ): Promise<Task & { jobId: string | null }> {
    const jobId = opts?.jobId ?? null;
    // Placement already queues sync for seated/problematic/unscheduled — avoid a
    // second concurrent createEvent (duplicate Google series on recurring create).
    if (opts?.syncGoogle !== false) {
      if (jobId) {
        void (async () => {
          try {
            await this.scheduleJobService.setMutationStage(jobId, 'syncing');
            await this.pendingGoogleWrites.syncTask(userId, task.id);
            await this.scheduleJobService.completeMutationJob(jobId);
          } catch (err: unknown) {
            const message =
              err instanceof Error ? err.message : 'Google sync failed';
            await this.scheduleJobService.failMutationJob(jobId, message);
          }
        })();
      } else {
        this.pendingGoogleWrites.syncTaskSoon(userId, task.id);
      }
    } else if (jobId) {
      await this.scheduleJobService.completeMutationJob(jobId);
    }
    return Object.assign(task, { jobId });
  }

  async create(
    userId: string,
    createTaskDto: CreateTaskDto,
  ): Promise<Task & { jobId: string | null; conflicts?: SchedulingConflict[] }> {
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
      scheduleState,
      problematicOriginalStart,
      problematicOriginalEnd,
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
      scheduleState: isUnscheduled
        ? ScheduleState.NONE
        : (scheduleState ?? ScheduleState.NONE),
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
      problematicOriginalStart: problematicOriginalStart
        ? new Date(problematicOriginalStart)
        : undefined,
      problematicOriginalEnd: problematicOriginalEnd
        ? new Date(problematicOriginalEnd)
        : undefined,
    });
    this.applyUnscheduledConstraints(task);
    this.applyProblematicConstraints(task);

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
    const row = await this.findOne(saved.id, userId);
    const job = await this.scheduleJobService.beginMutationJob(userId, {
      taskId: row.id,
      op: 'create',
    });
    const opts = this.placeOptions(null, row);
    if (opts) {
      this.queuePlaceAndSync(userId, row.id, job.id, null);
      return this.withConflicts(row, undefined, job.id);
    }
    const finished = await this.finishSaved(userId, row, {
      syncGoogle: true,
      jobId: job.id,
    });
    return this.withConflicts(finished, undefined, job.id);
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
  ): Promise<Task & { jobId: string | null; conflicts?: SchedulingConflict[] }> {
    const task = await this.findOne(id, userId);
    const before = this.snapshot(task);
    const wasUnscheduled = task.isUnscheduled;
    const wasScheduleState = task.scheduleState;

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
      problematicOriginalStart,
      problematicOriginalEnd,
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
    if (problematicOriginalStart !== undefined) {
      task.problematicOriginalStart = problematicOriginalStart
        ? new Date(problematicOriginalStart)
        : null;
    }
    if (problematicOriginalEnd !== undefined) {
      task.problematicOriginalEnd = problematicOriginalEnd
        ? new Date(problematicOriginalEnd)
        : null;
    }

    this.applyUnscheduledConstraints(task);
    this.applyProblematicConstraints(task);

    if (task.eventType === TaskEventType.FIXED) {
      if (!task.scheduledStartTime || !task.scheduledEndTime) {
        throw new BadRequestException(
          'FIXED items require scheduledStartTime and scheduledEndTime',
        );
      }
    }

    const enteredUnscheduled = task.isUnscheduled && !wasUnscheduled;
    const enteredProblematic =
      isProblematicSchedule(task) &&
      wasScheduleState !== ScheduleState.PROBLEMATIC;
    const enteredResolved =
      task.scheduleState === ScheduleState.RESOLVED &&
      wasScheduleState === ScheduleState.PROBLEMATIC;
    if (enteredResolved) {
      if (
        !task.scheduledStartTime &&
        task.problematicOriginalStart &&
        task.problematicOriginalEnd
      ) {
        task.scheduledStartTime = new Date(task.problematicOriginalStart);
        task.scheduledEndTime = new Date(task.problematicOriginalEnd);
      }
    }
    const saved = await this.tasksRepository.save(task);
    const job = await this.scheduleJobService.beginMutationJob(userId, {
      taskId: saved.id,
      op: 'update',
    });
    if (enteredUnscheduled || enteredProblematic) {
      await this.releaseOpenSlots(saved.id);
      if (enteredProblematic) {
        if (!saved.problematicOriginalStart && before.scheduledStartTime) {
          saved.problematicOriginalStart = new Date(before.scheduledStartTime);
          saved.problematicOriginalEnd = before.scheduledEndTime
            ? new Date(before.scheduledEndTime)
            : null;
        }
        saved.scheduledStartTime = null;
        saved.scheduledEndTime = null;
        await this.tasksRepository.save(saved);
      }
      void (async () => {
        try {
          await this.scheduleJobService.setMutationStage(job.id, 'syncing');
          await this.pendingGoogleWrites.syncTask(userId, saved.id);
          await this.placementStep.seatOpenHoles(
            userId,
            enteredProblematic ? saved.id : undefined,
          );
          await this.scheduleJobService.completeMutationJob(job.id);
        } catch (err: unknown) {
          const message =
            err instanceof Error ? err.message : 'Park sync failed';
          await this.scheduleJobService.failMutationJob(job.id, message);
        }
      })();
      const parked = await this.findOne(saved.id, userId);
      return this.withConflicts(parked, undefined, job.id);
    }

    if (enteredResolved) {
      await this.seatResolvedLayer(saved);
      const row = await this.findOne(saved.id, userId);
      return this.finishSaved(userId, row, { jobId: job.id });
    }

    // Place + Google sync continue on the job so the client can poll stages.
    this.queuePlaceAndSync(userId, saved.id, job.id, before);
    const row = await this.findOne(saved.id, userId);
    return this.withConflicts(row, undefined, job.id);
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
    const freed = !task.isUnscheduled;
    await this.tasksRepository.remove(task);
    if (freed) await this.placementStep.seatOpenHoles(userId);
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

    // Problematic copy: record the series skip, then delete the copy (and its Google event).
    if (isProblematicSchedule(task) && !task.isRecurring) {
      if (task.parentSeriesId) {
        await this.skipOccurrence(task.parentSeriesId, userId, {
          occurrenceStart: dto.occurrenceStart,
          googleEventId: dto.googleEventId,
          googleEventCalendarId: dto.googleEventCalendarId,
        });
      }
      await this.remove(task.id, userId);
      return Object.assign(task, { jobId: null as string | null });
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
    // Rewrite the Google series (new DTSTART + EXDATE) before the client refetches.
    if (task.isRecurring) {
      await this.pendingGoogleWrites.syncTask(userId, saved.id);
    }
    if (openSlot) await this.placementStep.seatOpenHoles(userId);
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
    const now = Date.now();
    const open = remaining
      .filter((row) => new Date(row.scheduledEndTime).getTime() > now)
      .sort(
        (a, b) =>
          new Date(a.scheduledStartTime).getTime() -
          new Date(b.scheduledStartTime).getTime(),
      );
    if (!open.length) {
      // Recurring keeps its clock so horizon expand can still run; Now/Next
      // hides skipped days via skippedOccurrenceYmds on the client.
      if (!task.isRecurring) {
        task.scheduledStartTime = null;
        task.scheduledEndTime = null;
      }
      return;
    }
    // Point display (and series anchor) at the next still-open seat so Now/Next
    // does not keep the skipped day's times after Google already dropped it.
    task.scheduledStartTime = new Date(open[0].scheduledStartTime);
    task.scheduledEndTime = task.isRecurring
      ? new Date(open[0].scheduledEndTime)
      : new Date(open[open.length - 1].scheduledEndTime);
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
      const message = e?.message ?? String(e);
      this.logger.warn(`Failed to delete skipped Google event ${eventId}: ${message}`);
      await this.pendingGoogleWrites.enqueue(userId, 'delete', {
        googleEventId: eventId,
        googleCalendarId: calendarId ?? null,
        error: message,
      });
    }
  }

  async updateStatus(
    id: string,
    userId: string,
    status: TaskStatus,
  ): Promise<Task> {
    const task = await this.findOne(id, userId);
    task.status = status;
    return this.tasksRepository.save(task);
  }
}

type ScheduleSnapshot = {
  isUnscheduled: boolean;
  scheduleState: ScheduleState;
  eventType: TaskEventType;
  estimatedTimeInMinutes: number;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  earliestStartTime: string | null;
  deadline: string | null;
  phaseId: string | null;
  isRecurring: boolean;
  recurrencePattern: string | null;
  recurrenceWeekDays: string;
  eligibleWeekDays: string;
  allowSplit: boolean;
};

function isoInstant(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function preferredHonored(plan: PlacementPlan, opts: PlaceOptions): boolean {
  if (plan.outcome !== 'seated' || !opts.preferredStart) return false;
  return Math.abs(plan.start - new Date(opts.preferredStart).getTime()) < 1000;
}

function freedAHole(
  before: ScheduleSnapshot,
  plan: PlacementPlan,
  opts: PlaceOptions,
): boolean {
  if (opts.commit === 'preferred' && !preferredHonored(plan, opts)) return false;
  if (!before.scheduledStartTime || !before.scheduledEndTime) return false;
  if (plan.outcome === 'problematic' || plan.outcome === 'unscheduled') return true;
  if (plan.outcome !== 'seated') return false;
  const startMoved =
    Math.abs(plan.start - new Date(before.scheduledStartTime).getTime()) >= 1000;
  const endShrunk =
    plan.end + 1000 < new Date(before.scheduledEndTime).getTime();
  return startMoved || endShrunk;
}
