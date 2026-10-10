import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import { PendingGoogleWriteService } from '../google-calendar/pending-google-write.service';
import { Habit } from '../habits/entities/habit.entity';
import { PhasesService } from '../phases/phases.service';
import { ScheduleState, Task, TaskStatus } from '../tasks/entities/task.entity';
import { TasksService } from '../tasks/tasks.service';
import { UserSettingsService } from '../user-settings/user-settings.service';
import { resolveIanaTimeZone } from '../../common/iana-time-zone';
import {
  localDateTimeIso,
  localHm,
  localYmd,
  normalizeClockHm,
  startOfLocalDayIso,
} from '../voice/voice-local-date.util';
import { MoveDisplayedEventDto } from './dto/move-displayed-event.dto';
import { phaseIdAtFocus, phaseWindowsForDay } from './free-slots.util';
import { planDisplayedEventMove } from './move-displayed-event.util';
import { PlacementStepService } from './placement-step.service';
import type { PlacementPlan } from './placement-step.util';
import { ScheduleJobService } from './schedule-job.service';
import { ScheduledTask } from './schedule.entity';

export type MoveDisplayedEventResult = {
  kind: 'fixed' | 'slot' | 'google' | 'series-choice';
  jobId: string | null;
  taskName?: string;
};

@Injectable()
export class DisplayedEventMoveService {
  private readonly logger = new Logger(DisplayedEventMoveService.name);

  constructor(
    @InjectRepository(ScheduledTask)
    private readonly scheduledRepo: Repository<ScheduledTask>,
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(Habit)
    private readonly habitRepo: Repository<Habit>,
    private readonly tasksService: TasksService,
    private readonly googleCalendarService: GoogleCalendarService,
    private readonly pendingGoogleWrites: PendingGoogleWriteService,
    private readonly placementStep: PlacementStepService,
    private readonly userSettingsService: UserSettingsService,
    private readonly phasesService: PhasesService,
    private readonly scheduleJobs: ScheduleJobService,
  ) {}

  async move(
    userId: string,
    dto: MoveDisplayedEventDto,
  ): Promise<MoveDisplayedEventResult> {
    const start = new Date(dto.start);
    const end = new Date(dto.end);
    if (!(end > start)) {
      throw new BadRequestException('Event end must be after start.');
    }

    const ids = [dto.googleEventId, dto.recurringEventId].filter(
      (id): id is string => Boolean(id),
    );
    const habit = await this.habitRepo.findOne({
      where: ids.map((googleEventId) => ({ userId, googleEventId })),
    });
    const tasks = await this.tasksService.findAll(userId);
    const slots = await this.scheduledRepo
      .createQueryBuilder('st')
      .innerJoin('st.task', 'task')
      .where('task.userId = :userId', { userId })
      .getMany();

    const plan = planDisplayedEventMove({
      googleEventId: dto.googleEventId,
      recurringEventId: dto.recurringEventId,
      originalStartIso: dto.originalStart,
      isHabit: !!habit,
      tasks: tasks.map((task) => ({
        id: task.id,
        eventType: task.eventType,
        isRecurring: task.isRecurring,
        googleEventId: task.googleEventId,
      })),
      slots: slots.map((slot) => ({
        id: slot.id,
        taskId: slot.taskId,
        googleEventId: slot.googleEventId,
        scheduledStartTime: new Date(slot.scheduledStartTime).toISOString(),
      })),
    });

    if (plan.kind === 'rejected') {
      throw new BadRequestException('Habit blocks cannot be moved from the calendar.');
    }

    if (plan.kind === 'google') {
      await this.googleCalendarService.patchEventTimes(
        userId,
        dto.googleEventId,
        start.toISOString(),
        end.toISOString(),
        dto.calendarId,
      );
      return { kind: 'google', jobId: null };
    }

    const minutes = Math.max(
      1,
      Math.round((end.getTime() - start.getTime()) / 60_000),
    );
    const phaseIds = await this.phaseIdsForDrop(userId, start);

    if (plan.kind === 'fixed') {
      const saved = await this.tasksService.update(plan.taskId, userId, {
        scheduledStartTime: start.toISOString(),
        scheduledEndTime: end.toISOString(),
        estimatedTimeInMinutes: minutes,
        phaseIds,
      });
      if (!sitsAt(saved.scheduledStartTime, start)) {
        throw new BadRequestException('That time is already taken.');
      }
      return { kind: 'fixed', jobId: saved.jobId ?? null };
    }

    const owner = tasks.find((task) => task.id === plan.taskId);
    if (owner?.isRecurring) {
      const settings = await this.userSettingsService.getSettings(userId);
      const timeZone = resolveIanaTimeZone(
        settings.timeZone || owner.scheduleTimeZone,
      );
      const fromYmd = localYmd(dto.originalStart, timeZone);
      const toYmd = localYmd(start.toISOString(), timeZone);
      if (fromYmd !== toYmd) {
        throw new BadRequestException(
          'Recurring tasks can only be moved within the same day.',
        );
      }
      if (!dto.seriesScope) {
        return { kind: 'series-choice', jobId: null, taskName: owner.name };
      }
      if (dto.seriesScope === 'occurrence') {
        const jobId = await this.moveSeriesDay(
          userId,
          owner,
          dto,
          minutes,
          phaseIds,
        );
        // Client must poll the one-off create job before refetching Google.
        return { kind: 'slot', jobId };
      }
      const job = await this.scheduleJobs.beginMutationJob(userId, {
        op: 'move-series',
        taskId: owner.id,
        seriesScope: dto.seriesScope,
      });
      void this.runSeriesMoveJob(
        job.id,
        userId,
        owner,
        dto,
        start,
        end,
        minutes,
        phaseIds,
        timeZone,
      ).catch((err: unknown) => {
        this.logger.error(
          `Series move job ${job.id} failed`,
          err instanceof Error ? err.stack : undefined,
        );
      });
      return { kind: 'slot', jobId: job.id };
    }

    const job = await this.scheduleJobs.beginMutationJob(userId, {
      op: 'move-slot',
      taskId: plan.taskId,
    });
    void this.runFlexibleMoveJob(
      job.id,
      userId,
      plan.taskId,
      dto,
      start,
      end,
      minutes,
      phaseIds,
    ).catch((err: unknown) => {
      this.logger.error(
        `Move job ${job.id} failed`,
        err instanceof Error ? err.stack : undefined,
      );
    });
    return { kind: 'slot', jobId: job.id };
  }

  private async runSeriesMoveJob(
    jobId: string,
    userId: string,
    owner: Task,
    dto: MoveDisplayedEventDto,
    start: Date,
    end: Date,
    minutes: number,
    phaseIds: string[],
    timeZone: string,
  ): Promise<void> {
    try {
      await this.scheduleJobs.setMutationStage(jobId, 'placing');
      if (dto.seriesScope === 'all') {
        await this.moveSeriesAll(userId, owner, start, end, minutes, phaseIds);
      } else if (await this.isFirstOpenDay(owner.id, dto.originalStart, timeZone)) {
        await this.moveSeriesAll(userId, owner, start, end, minutes, phaseIds);
      } else {
        await this.moveSeriesTail(
          userId,
          owner,
          dto,
          start,
          end,
          minutes,
          phaseIds,
        );
      }
      await this.scheduleJobs.setMutationStage(jobId, 'syncing');
      // Series helpers already awaited syncTask; mark complete.
      await this.scheduleJobs.completeMutationJob(jobId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Series move failed';
      await this.scheduleJobs.failMutationJob(jobId, message);
    }
  }

  private async runFlexibleMoveJob(
    jobId: string,
    userId: string,
    taskId: string,
    dto: MoveDisplayedEventDto,
    start: Date,
    end: Date,
    minutes: number,
    phaseIds: string[],
  ): Promise<void> {
    try {
      await this.scheduleJobs.setMutationStage(jobId, 'placing');
      const task = await this.taskRepo.findOne({
        where: { id: taskId, userId },
        relations: ['phases'],
      });
      if (!task) {
        throw new BadRequestException('Task not found');
      }
      const nextPhases = phaseIds.length
        ? (await this.phasesService.findAllForScheduling(userId)).filter((p) =>
            phaseIds.includes(p.id),
          )
        : [];
      task.phaseId = nextPhases[0]?.id ?? null;
      task.phases = nextPhases;
      await this.taskRepo.save(task);

      const placed = await this.placementStep.place(userId, taskId, {
        preferredStart: start,
        durationMinutes: minutes,
        commit: 'preferred',
      });
      if (!seatedAt(placed, start)) {
        throw new BadRequestException('That time is already taken.');
      }
      await this.scheduleJobs.setMutationStage(jobId, 'syncing');
      const mergedIntoTaskId =
        placed.outcome === 'seated' ? placed.mergedIntoTaskId : undefined;
      if (mergedIntoTaskId) {
        // One-off was deleted and re-merged; do not patch its Google event.
        await this.pendingGoogleWrites.syncTask(userId, mergedIntoTaskId);
      } else {
        try {
          await this.googleCalendarService.patchEventTimes(
            userId,
            dto.googleEventId,
            start.toISOString(),
            end.toISOString(),
            dto.calendarId,
          );
        } catch (err) {
          this.logger.error(
            `Could not update Google event ${dto.googleEventId} after a move`,
            err instanceof Error ? err.stack : undefined,
          );
          await this.pendingGoogleWrites.syncTask(userId, taskId);
        }
      }
      await this.placementStep.seatOpenHoles(userId);
      await this.scheduleJobs.completeMutationJob(jobId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Move failed';
      await this.scheduleJobs.failMutationJob(jobId, message);
    }
  }

  /** Drop one series day and seat an identical one-off at the dropped time. */
  private async moveSeriesDay(
    userId: string,
    series: Task,
    dto: MoveDisplayedEventDto,
    minutes: number,
    phaseIds: string[],
  ): Promise<string | null> {
    await this.tasksService.skipOccurrence(series.id, userId, {
      occurrenceStart: dto.originalStart,
      googleEventId: dto.googleEventId,
      googleEventCalendarId: dto.calendarId,
    });
    const created = await this.tasksService.create(userId, {
      name: series.name,
      description: series.description ?? undefined,
      ...(phaseIds.length
        ? { phaseIds, phaseId: phaseIds[0] }
        : { phaseIds: [] }),
      eventType: series.eventType,
      estimatedTimeInMinutes: minutes,
      isRecurring: false,
      allowSplit: series.allowSplit,
      priority: series.priority,
      scheduledStartTime: dto.start,
      scheduledEndTime: dto.end,
      location: series.location ?? undefined,
      googleColorId: series.googleColorId ?? undefined,
      googleVisibility: series.googleVisibility ?? undefined,
      googleTransparency: series.googleTransparency ?? undefined,
      googleReminders: series.googleReminders ?? undefined,
      parentSeriesId: series.id,
      seriesGroupId: series.seriesGroupId ?? series.id,
      timeZone: series.scheduleTimeZone ?? undefined,
    });
    return created.jobId ?? null;
  }

  /**
   * End the old series before this day and start a new series at the new clock.
   * Days before the drop stay on the old clock.
   */
  private async moveSeriesTail(
    userId: string,
    series: Task,
    dto: MoveDisplayedEventDto,
    start: Date,
    end: Date,
    minutes: number,
    phaseIds: string[],
  ): Promise<void> {
    const settings = await this.userSettingsService.getSettings(userId);
    const timeZone = resolveIanaTimeZone(settings.timeZone || series.scheduleTimeZone);
    const splitYmd = localYmd(new Date(dto.originalStart).toISOString(), timeZone);
    const splitStart = new Date(startOfLocalDayIso(splitYmd, timeZone));
    const previousDeadline = series.deadline ? new Date(series.deadline) : null;
    if (!previousDeadline || previousDeadline.getTime() > splitStart.getTime()) {
      series.deadline = splitStart;
      await this.taskRepo.save(series);
    }

    const rows = await this.scheduledRepo.find({ where: { taskId: series.id } });
    const now = Date.now();
    const tail = rows.filter((row) => {
      if (new Date(row.scheduledEndTime).getTime() <= now) return false;
      const ymd = localYmd(new Date(row.scheduledStartTime).toISOString(), timeZone);
      return ymd >= splitYmd;
    });
    if (tail.length) await this.scheduledRepo.remove(tail);

    const keptDeadline =
      previousDeadline && previousDeadline.getTime() > splitStart.getTime()
        ? previousDeadline
        : null;
    const nextPhases = phaseIds.length
      ? (await this.phasesService.findAllForScheduling(userId)).filter((p) =>
          phaseIds.includes(p.id),
        )
      : [];
    const created = await this.taskRepo.save(
      this.taskRepo.create({
        userId,
        name: series.name,
        description: series.description,
        phaseId: nextPhases[0]?.id ?? null,
        phases: nextPhases,
        eventType: series.eventType,
        estimatedTimeInMinutes: minutes,
        isRecurring: true,
        recurrencePattern: series.recurrencePattern,
        recurrenceWeekDays: series.recurrenceWeekDays,
        allowSplit: series.allowSplit,
        priority: series.priority,
        deadline: keptDeadline,
        scheduledStartTime: start,
        scheduledEndTime: end,
        scheduleTimeZone: timeZone,
        location: series.location,
        googleColorId: series.googleColorId,
        googleVisibility: series.googleVisibility,
        googleTransparency: series.googleTransparency,
        googleReminders: series.googleReminders,
        status: TaskStatus.TODO,
        scheduleState: ScheduleState.NONE,
        isUnscheduled: false,
        seriesGroupId: series.seriesGroupId ?? series.id,
        parentSeriesId: series.id,
      }),
    );
    if (!series.seriesGroupId) {
      series.seriesGroupId = series.id;
      await this.taskRepo.save(series);
    }
    await this.placementStep.place(userId, created.id, {
      preferredStart: start,
      durationMinutes: minutes,
      commit: 'always',
      expandSeries: true,
    });
    // Old series may have no open seats left; sync deletes its Google master.
    // New series must land on Google before the calendar refetch.
    await this.pendingGoogleWrites.syncTask(userId, series.id);
    await this.pendingGoogleWrites.syncTask(userId, created.id);
    await this.placementStep.seatOpenHoles(userId);
  }

  /**
   * Rewrite every still-open day of the series to the new clock (no split).
   * Anchor is the earliest open day so earlier horizon days move too.
   */
  private async moveSeriesAll(
    userId: string,
    series: Task,
    start: Date,
    end: Date,
    minutes: number,
    phaseIds: string[],
  ): Promise<void> {
    const settings = await this.userSettingsService.getSettings(userId);
    const timeZone = resolveIanaTimeZone(settings.timeZone || series.scheduleTimeZone);
    const hm = normalizeClockHm(localHm(start.toISOString(), timeZone));
    const durationMs = Math.max(1, minutes) * 60_000;

    const rows = await this.scheduledRepo.find({ where: { taskId: series.id } });
    const now = Date.now();
    const open = rows
      .filter((row) => new Date(row.scheduledEndTime).getTime() > now)
      .sort(
        (a, b) =>
          new Date(a.scheduledStartTime).getTime() -
          new Date(b.scheduledStartTime).getTime(),
      );
    const anchorYmd = open.length
      ? localYmd(new Date(open[0].scheduledStartTime).toISOString(), timeZone)
      : localYmd(start.toISOString(), timeZone);
    const anchorStart = new Date(localDateTimeIso(anchorYmd, hm, timeZone));
    const anchorEnd = new Date(anchorStart.getTime() + durationMs);

    series.scheduledStartTime = anchorStart;
    series.scheduledEndTime = anchorEnd;
    series.estimatedTimeInMinutes = minutes;
    const nextPhases = phaseIds.length
      ? (await this.phasesService.findAllForScheduling(userId)).filter((p) =>
          phaseIds.includes(p.id),
        )
      : [];
    series.phaseId = nextPhases[0]?.id ?? null;
    series.phases = nextPhases;
    await this.taskRepo.save(series);
    // Do not wipe open seats before place: an empty seat list makes syncTask
    // delete the Google series mid-move. place + expandSeries rewrite days.

    await this.placementStep.place(userId, series.id, {
      preferredStart: anchorStart,
      durationMinutes: minutes,
      commit: 'always',
      expandSeries: true,
    });
    await this.pendingGoogleWrites.syncTask(userId, series.id);
    await this.placementStep.seatOpenHoles(userId);
  }

  private async phaseIdsForDrop(userId: string, start: Date): Promise<string[]> {
    const settings = await this.userSettingsService.getSettings(userId);
    const timeZone = resolveIanaTimeZone(settings.timeZone);
    const ymd = localYmd(start.toISOString(), timeZone);
    const phases = await this.phasesService.findAllForScheduling(userId);
    const windows = phaseWindowsForDay(phases, ymd, timeZone);
    const id = phaseIdAtFocus(windows, start.getTime());
    return id ? [id] : [];
  }

  /** True when the drop day is the earliest still-open day of the series. */
  private async isFirstOpenDay(
    taskId: string,
    originalStartIso: string,
    timeZone: string,
  ): Promise<boolean> {
    const splitYmd = localYmd(originalStartIso, timeZone);
    const rows = await this.scheduledRepo.find({ where: { taskId } });
    const now = Date.now();
    const open = rows
      .filter((row) => new Date(row.scheduledEndTime).getTime() > now)
      .sort(
        (a, b) =>
          new Date(a.scheduledStartTime).getTime() -
          new Date(b.scheduledStartTime).getTime(),
      );
    if (!open.length) return true;
    const firstYmd = localYmd(
      new Date(open[0].scheduledStartTime).toISOString(),
      timeZone,
    );
    return firstYmd === splitYmd;
  }
}

function sitsAt(value: Date | string | null | undefined, start: Date): boolean {
  if (!value) return false;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) && Math.abs(ms - start.getTime()) < 1000;
}

function seatedAt(plan: PlacementPlan, start: Date): boolean {
  return plan.outcome === 'seated' && Math.abs(plan.start - start.getTime()) < 1000;
}
