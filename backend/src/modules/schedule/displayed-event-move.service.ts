import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import { PendingGoogleWriteService } from '../google-calendar/pending-google-write.service';
import { CalendarProvidersRegistry } from '../calendar-providers/calendar-providers.registry';
import type { CalendarProviderId } from '../calendar-providers/calendar-provider.types';
import { PhasesService } from '../phases/phases.service';
import { TaskEventType } from '../scheduling/event-type.enum';
import { ScheduleState, Task, TaskStatus } from '../tasks/entities/task.entity';
import { TasksService } from '../tasks/tasks.service';
import { UserSettingsService } from '../user-settings/user-settings.service';
import { resolveIanaTimeZone } from '../../common/iana-time-zone';
import {
  localDateTimeIso,
  localHm,
  localYmd,
  normalizeClockHm,
  civilDayStartIso,
} from '../voice/voice-local-date.util';
import { MoveDisplayedEventDto } from './dto/move-displayed-event.dto';
import { phaseIdAtFocus, phaseWindowsForDay } from './free-slots.util';
import {
  planDisplayedEventMove,
  SLOT_MATCH_MS,
  type DisplayedMovePlan,
} from './move-displayed-event.util';
import { PlacementStepService } from './placement-step.service';
import type { PlacementPlan } from './placement-step.util';
import { ScheduleJobService } from './schedule-job.service';
import { ScheduledTask } from './schedule.entity';
import { findOrCreateDayCopy, skipSeriesDay } from './series-exception.util';

export type MoveDisplayedEventResult = {
  kind: 'fixed' | 'slot' | 'google' | 'series-choice';
  jobId: string | null;
  taskName?: string;
};

/** What a durable move job stores (dates as ISO strings). */
type MovePayload = {
  taskId: string;
  dto: MoveDisplayedEventDto;
  start: string;
  end: string;
  minutes: number;
  phaseIds?: string[];
  timeZone?: string;
};

@Injectable()
export class DisplayedEventMoveService implements OnModuleInit {
  private readonly logger = new Logger(DisplayedEventMoveService.name);

  constructor(
    @InjectRepository(ScheduledTask)
    private readonly scheduledRepo: Repository<ScheduledTask>,
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    private readonly tasksService: TasksService,
    private readonly googleCalendarService: GoogleCalendarService,
    private readonly calendarProviders: CalendarProvidersRegistry,
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

    // PE-27: load only what this drop can mean — the slot with its event id,
    // the voice slot, or a slot starting within the match window of the
    // dragged block — and the tasks behind them; not the user's whole history.
    const eventIds = [dto.googleEventId, dto.recurringEventId].filter(
      (id): id is string => !!id,
    );
    const origin = dto.originalStart ? new Date(dto.originalStart).getTime() : NaN;
    const match: string[] = [];
    const params: Record<string, unknown> = {};
    if (dto.googleEventId) {
      match.push('st.googleEventId = :gid');
      params.gid = dto.googleEventId;
    }
    if (dto.slotId) {
      match.push('st.id = :slotId');
      params.slotId = dto.slotId;
    }
    if (Number.isFinite(origin)) {
      match.push('st.scheduledStartTime BETWEEN :from AND :to');
      params.from = new Date(origin - SLOT_MATCH_MS);
      params.to = new Date(origin + SLOT_MATCH_MS);
    }
    const slots = match.length
      ? await this.scheduledRepo
          .createQueryBuilder('st')
          .innerJoin('st.task', 'task')
          .where('task.userId = :userId', { userId })
          .andWhere(`(${match.join(' OR ')})`, params)
          .getMany()
      : [];
    const taskIds = [...new Set(slots.map((slot) => slot.taskId))];
    const taskWhere = [
      ...(taskIds.length ? [{ userId, id: In(taskIds) }] : []),
      ...(eventIds.length ? [{ userId, googleEventId: In(eventIds) }] : []),
    ];
    const tasks = taskWhere.length
      ? await this.taskRepo.find({ where: taskWhere, relations: ['phase', 'phases'] })
      : [];

    // Voice names the app slot: same path as a drag of that block.
    const named = dto.slotId ? slots.find((row) => row.id === dto.slotId) : null;
    if (dto.slotId && !named) {
      throw new BadRequestException('Task slot not found');
    }
    const namedTask = named ? tasks.find((task) => task.id === named.taskId) : null;
    if (named && namedTask) {
      dto.googleEventId =
        named.googleEventId ?? namedTask.googleEventId ?? dto.googleEventId ?? '';
      dto.originalStart = new Date(named.scheduledStartTime).toISOString();
      dto.originalEnd = new Date(named.scheduledEndTime).toISOString();
    }
    const plan: DisplayedMovePlan = named && namedTask
      ? namedTask.eventType === TaskEventType.FIXED && !namedTask.isRecurring
        ? { kind: 'fixed', taskId: namedTask.id }
        : {
            kind: 'slot',
            slotId: named.id,
            taskId: namedTask.id,
            updateTaskWindow: !namedTask.isRecurring,
          }
      : planDisplayedEventMove({
          googleEventId: dto.googleEventId,
          recurringEventId: dto.recurringEventId,
          originalStartIso: dto.originalStart,
          isHabit: false,
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
      await this.patchExternalEventTimes(
        userId,
        dto.provider ?? 'google',
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
        this.logger.warn(
          `[move-rejected] fixed task=${plan.taskId} "${saved.name}" ` +
            `drop=${start.toISOString()}–${end.toISOString()} ` +
            `saved=${saved.scheduledStartTime ? new Date(saved.scheduledStartTime).toISOString() : 'null'}` +
            `–${saved.scheduledEndTime ? new Date(saved.scheduledEndTime).toISOString() : 'null'} ` +
            `state=${saved.scheduleState}`,
        );
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
          fromYmd,
        );
        // Client must poll the one-off create job before refetching Google.
        return { kind: 'slot', jobId };
      }
      // Durable: the job row carries everything the move needs (stabilization A).
      const job = await this.scheduleJobs.beginMutationJob(userId, {
        op: 'move_series',
        taskId: owner.id,
        seriesScope: dto.seriesScope,
        dto,
        start: start.toISOString(),
        end: end.toISOString(),
        minutes,
        phaseIds,
        timeZone,
      });
      void this.scheduleJobs.runNow(job.id);
      return { kind: 'slot', jobId: job.id };
    }

    const job = await this.scheduleJobs.beginMutationJob(userId, {
      op: 'move_slot',
      taskId: plan.taskId,
      dto,
      start: start.toISOString(),
      end: end.toISOString(),
      minutes,
      phaseIds,
    });
    void this.scheduleJobs.runNow(job.id);
    return { kind: 'slot', jobId: job.id };
  }

  /** Move jobs run from their schedule_jobs row; a retry repeats the same drop. */
  onModuleInit(): void {
    this.scheduleJobs.registerHandler('move_slot', async (job) => {
      const p = job.payload as MovePayload;
      await this.runFlexibleMoveJob(
        job.id,
        job.userId,
        String(p.taskId),
        p.dto,
        new Date(p.start),
        new Date(p.end),
        p.minutes,
        p.phaseIds ?? [],
      );
    });
    this.scheduleJobs.registerHandler('move_series', async (job) => {
      const p = job.payload as MovePayload;
      const owner = await this.taskRepo.findOne({
        where: { id: String(p.taskId), userId: job.userId },
        relations: ['phase', 'phases'],
      });
      if (!owner) return { gone: true };
      await this.runSeriesMoveJob(
        job.id,
        job.userId,
        owner,
        p.dto,
        new Date(p.start),
        new Date(p.end),
        p.minutes,
        p.phaseIds ?? [],
        String(p.timeZone),
      );
    });
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
      // A refusal is final; anything else goes back to the queue for a retry.
      if (!(err instanceof HttpException)) throw err;
      await this.scheduleJobs.failMutationJob(jobId, err.message);
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
      const nextPhases = phaseIds.length
        ? (await this.phasesService.findAllForScheduling(userId)).filter((p) =>
            phaseIds.includes(p.id),
          )
        : [];
      // AUD-008: phase writes read and save the task under the placement lock,
      // so a placement in flight cannot overwrite them with a stale copy.
      const setPhases = (phaseId: string | null, phases: typeof nextPhases) =>
        this.placementStep.runExclusive(userId, async () => {
          const fresh = await this.taskRepo.findOne({
            where: { id: taskId, userId },
            relations: ['phases'],
          });
          if (!fresh) return null;
          const previous = { phaseId: fresh.phaseId, phases: fresh.phases ?? [] };
          fresh.phaseId = phaseId;
          fresh.phases = phases;
          await this.taskRepo.save(fresh);
          return { task: fresh, previous };
        });
      const changed = await setPhases(nextPhases[0]?.id ?? null, nextPhases);
      if (!changed) {
        throw new BadRequestException('Task not found');
      }
      const { task, previous } = changed;
      // The task stays on its old slot: give it back its old phase too.
      const restorePhase = async () => {
        await setPhases(previous.phaseId, previous.phases);
      };

      const placed = await this.placementStep.place(userId, taskId, {
        preferredStart: start,
        durationMinutes: minutes,
        commit: 'preferred',
        drag: true,
      });
      if (!seatedAt(placed, start)) {
        if (placed.outcome === 'conflict') {
          await restorePhase();
          await this.scheduleJobs.completeMutationJob(jobId, {
            conflicts: [placed.conflict],
          });
          return;
        }
        if (
          placed.outcome === 'problematic' ||
          placed.outcome === 'unscheduled'
        ) {
          await this.scheduleJobs.setMutationStage(jobId, 'syncing');
          await this.pendingGoogleWrites.syncTask(userId, taskId);
          await this.placementStep.seatOpenHoles(userId);
          await this.scheduleJobs.completeMutationJob(jobId, {
            parked: placed.outcome,
            reason:
              placed.outcome === 'problematic' ? placed.reason : 'window',
          });
          return;
        }
        this.logger.warn(
          `[move-rejected] job=${jobId} task=${taskId} "${task.name}" ` +
            `drop=${start.toISOString()}–${end.toISOString()} ` +
            `plan=${JSON.stringify(summarizeMovePlan(placed))} ` +
            `detail=preferred-miss`,
        );
        await restorePhase();
        throw new BadRequestException('That time is already taken.');
      }
      await this.scheduleJobs.setMutationStage(jobId, 'syncing');
      const mergedIntoTaskId =
        placed.outcome === 'seated' ? placed.mergedIntoTaskId : undefined;
      if (mergedIntoTaskId) {
        // One-off was deleted and re-merged; do not patch its Google event.
        await this.pendingGoogleWrites.syncTask(userId, mergedIntoTaskId);
      } else if (!dto.googleEventId) {
        // A voice move of a slot with no Google event yet: create it via sync.
        await this.pendingGoogleWrites.syncTask(userId, taskId);
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
      // A refusal ("time is taken") is final; anything else is retried by the queue.
      if (!(err instanceof HttpException)) throw err;
      await this.scheduleJobs.failMutationJob(jobId, err.message);
    }
  }

  /** Drop one series day and seat an identical one-off at the dropped time. */
  private async moveSeriesDay(
    userId: string,
    series: Task,
    dto: MoveDisplayedEventDto,
    minutes: number,
    phaseIds: string[],
    occurrenceYmd: string,
  ): Promise<string | null> {
    const settings = await this.userSettingsService.getSettings(userId);
    const timeZone = resolveIanaTimeZone(settings.timeZone || series.scheduleTimeZone);
    const start = new Date(dto.start);
    const end = new Date(dto.end);
    const phases = phaseIds.length
      ? (await this.phasesService.findAllForScheduling(userId)).filter((p) =>
          phaseIds.includes(p.id),
        )
      : [];
    // Finished inside this request (one transaction below), so no handler.
    const job = await this.scheduleJobs.beginMutationJob(
      userId,
      { op: 'move_series_day', taskId: series.id, seriesScope: 'occurrence' },
      { inline: true },
    );
    // PE-18: skip the day, make (or reuse) its copy and seat the copy in one
    // transaction. A conflict rolls everything back; a full day parks the copy.
    const out = await this.placementStep.writeAndPlace(
      userId,
      async (repos) => {
        const fresh = await repos.tasks.findOneOrFail({
          where: { id: series.id, userId },
        });
        if (!fresh.seriesGroupId) fresh.seriesGroupId = fresh.id;
        await skipSeriesDay(repos, fresh, occurrenceYmd, timeZone, new Date());
        const copy = await findOrCreateDayCopy(repos, fresh, occurrenceYmd, {
          start,
          end,
          minutes,
          phases,
        });
        return {
          taskId: copy.id,
          opts: { preferredStart: start, durationMinutes: minutes, drag: true },
        };
      },
      (plan) => plan.outcome !== 'conflict',
    );
    if (!out.committed) {
      await this.scheduleJobs.completeMutationJob(
        job.id,
        out.plan.outcome === 'conflict' ? { conflicts: [out.plan.conflict] } : undefined,
      );
      return job.id;
    }
    await this.scheduleJobs.setMutationStage(job.id, 'syncing');
    await this.pendingGoogleWrites.syncTask(userId, series.id);
    await this.pendingGoogleWrites.syncTask(
      userId,
      out.plan.outcome === 'seated' ? out.plan.mergedIntoTaskId ?? out.taskId : out.taskId,
    );
    await this.placementStep.seatOpenHoles(userId);
    await this.scheduleJobs.completeMutationJob(job.id);
    return job.id;
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
    const splitStart = new Date(civilDayStartIso(splitYmd, timeZone));
    const nextPhases = phaseIds.length
      ? (await this.phasesService.findAllForScheduling(userId)).filter((p) =>
          phaseIds.includes(p.id),
        )
      : [];

    // PE-18: end the old series, drop its tail, create (or reuse) the new
    // series and seat it — one transaction. Google runs after the commit.
    const out = await this.placementStep.writeAndPlace(userId, async ({ tasks, slots }) => {
      const old = await tasks.findOneOrFail({ where: { id: series.id, userId } });
      const groupId = old.seriesGroupId ?? old.id;
      const previousDeadline = old.deadline ? new Date(old.deadline) : null;
      if (!previousDeadline || previousDeadline.getTime() > splitStart.getTime()) {
        old.deadline = splitStart;
      }
      old.seriesGroupId = groupId;
      await tasks.save(old);

      const rows = await slots.find({ where: { taskId: old.id } });
      const now = Date.now();
      const tail = rows.filter((row) => {
        if (new Date(row.scheduledEndTime).getTime() <= now) return false;
        const ymd = localYmd(new Date(row.scheduledStartTime).toISOString(), timeZone);
        return ymd >= splitYmd;
      });
      if (tail.length) await slots.remove(tail);

      // A retry finds the tail it already made: same group, starts on the split day.
      const siblings = await tasks.find({
        where: { userId, seriesGroupId: groupId, isRecurring: true },
      });
      const existing = siblings.find(
        (row) =>
          row.id !== old.id &&
          !!row.earliestStartTime &&
          localYmd(new Date(row.earliestStartTime).toISOString(), timeZone) === splitYmd,
      );
      const keptDeadline =
        previousDeadline && previousDeadline.getTime() > splitStart.getTime()
          ? previousDeadline
          : null;
      const next =
        existing ??
        tasks.create({
          userId,
          name: old.name,
          description: old.description,
          eventType: old.eventType,
          isRecurring: true,
          recurrencePattern: old.recurrencePattern,
          recurrenceWeekDays: old.recurrenceWeekDays,
          allowSplit: old.allowSplit,
          priority: old.priority,
          deadline: keptDeadline,
          // The tail starts on the split day; earlier days stay with the old series.
          earliestStartTime: splitStart,
          scheduleTimeZone: timeZone,
          location: old.location,
          googleColorId: old.googleColorId,
          googleVisibility: old.googleVisibility,
          googleTransparency: old.googleTransparency,
          googleReminders: old.googleReminders,
          status: TaskStatus.TODO,
          scheduleState: ScheduleState.NONE,
          isUnscheduled: false,
          seriesGroupId: groupId,
          parentSeriesId: old.id,
        });
      next.phaseId = nextPhases[0]?.id ?? null;
      next.phases = nextPhases;
      next.estimatedTimeInMinutes = minutes;
      next.scheduledStartTime = start;
      next.scheduledEndTime = end;
      const saved = await tasks.save(next);
      return {
        taskId: saved.id,
        opts: {
          preferredStart: start,
          durationMinutes: minutes,
          commit: 'always',
          expandSeries: true,
        },
      };
    });
    // Old series may have no open seats left; sync deletes its Google master.
    // New series must land on Google before the calendar refetch.
    await this.pendingGoogleWrites.syncTask(userId, series.id);
    await this.pendingGoogleWrites.syncTask(userId, out.taskId);
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

    const nextPhases = phaseIds.length
      ? (await this.phasesService.findAllForScheduling(userId)).filter((p) =>
          phaseIds.includes(p.id),
        )
      : [];
    // AUD-008: re-read and save under the placement lock (no stale overwrite).
    await this.placementStep.runExclusive(userId, async () => {
      const fresh = await this.taskRepo.findOne({
        where: { id: series.id, userId },
        relations: ['phases'],
      });
      if (!fresh) throw new BadRequestException('Task not found');
      fresh.scheduledStartTime = anchorStart;
      fresh.scheduledEndTime = anchorEnd;
      fresh.estimatedTimeInMinutes = minutes;
      fresh.phaseId = nextPhases[0]?.id ?? null;
      fresh.phases = nextPhases;
      await this.taskRepo.save(fresh);
    });
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

  /** Move an external (non-app-task) event on the correct provider API. */
  private async patchExternalEventTimes(
    userId: string,
    providerId: CalendarProviderId,
    eventId: string,
    startIso: string,
    endIso: string,
    calendarId?: string,
  ): Promise<void> {
    if (providerId === 'google') {
      await this.googleCalendarService.patchEventTimes(
        userId,
        eventId,
        startIso,
        endIso,
        calendarId,
      );
      return;
    }
    const provider = this.calendarProviders.get(providerId);
    if (!provider) {
      throw new BadRequestException(
        `Calendar provider "${providerId}" is not available`,
      );
    }
    await provider.updateEvent(
      userId,
      eventId,
      {
        start: { dateTime: startIso },
        end: { dateTime: endIso },
      },
      calendarId,
    );
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

function summarizeMovePlan(plan: PlacementPlan): Record<string, unknown> {
  if (plan.outcome === 'seated') {
    return {
      outcome: 'seated',
      start: new Date(plan.start).toISOString(),
      end: new Date(plan.end).toISOString(),
      moves: plan.moves.length,
    };
  }
  if (plan.outcome === 'problematic') {
    return { outcome: 'problematic', reason: plan.reason };
  }
  if (plan.outcome === 'conflict') {
    return {
      outcome: 'conflict',
      reason: plan.conflict.reason,
      options: plan.conflict.options,
    };
  }
  return { outcome: plan.outcome };
}
