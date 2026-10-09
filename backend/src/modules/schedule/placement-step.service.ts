import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { resolveIanaTimeZone } from '../../common/iana-time-zone';
import { habitBlockIntervals } from '../habits/habit-blocks.util';
import { Habit } from '../habits/entities/habit.entity';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import { PendingGoogleWriteService } from '../google-calendar/pending-google-write.service';
import { PhasesService } from '../phases/phases.service';
import { TaskEventType } from '../scheduling/event-type.enum';
import {
  clearParkMetadata,
  isProblematicSchedule,
  ScheduleState,
  Task,
  TaskStatus,
} from '../tasks/entities/task.entity';
import {
  addSkippedOccurrenceYmd,
  removeSkippedOccurrenceYmd,
} from '../tasks/skipped-occurrence.util';
import { UserSettingsService } from '../user-settings/user-settings.service';
import {
  addDaysToYmd,
  localDateTimeIso,
  localHm,
  localYmd,
  normalizeClockHm,
  startOfLocalDayIso,
} from '../voice/voice-local-date.util';
import {
  eligibleWindowsForDay,
  type FreeSlotsPhaseLike,
  type MsInterval,
} from './free-slots.util';
import { normalizeFixedEventBufferMinutes, planningHorizonRange } from './intelligent-scheduling.engine';
import {
  planPlacement,
  seriesOccurrenceYmds,
  type PlacementMove,
  type PlacementPlan,
  type PlacementSeat,
} from './placement-step.util';
import {
  groupYmdsByClockHm,
  pickPrimaryClockHm,
  weekDaysFromYmds,
} from './series-group.util';

export type PlaceOptions = {
  preferredStart?: Date | null;
  /** Claim length when a drag resized the block. */
  durationMinutes?: number;
  /**
   * `preferred` writes only when the claimant sits on `preferredStart`.
   * `keep` writes nothing when the current interval still fits its windows.
   */
  commit?: 'always' | 'preferred' | 'keep';
  /** Ignore the stored clock and take the nearest hole. */
  searchHole?: boolean;
  /** After the first day, write the rest of a series inside the horizon. */
  expandSeries?: boolean;
  /** This call is a later day of a series already being expanded. */
  seriesDay?: boolean;
  /** Restrict hole search / windows to this civil day (YYYY-MM-DD). */
  windowYmd?: string;
};
import { ScheduledTask } from './schedule.entity';

const locks = new Map<string, Promise<unknown>>();

function withUserLock<T>(userId: string, run: () => Promise<T>): Promise<T> {
  const previous = locks.get(userId) ?? Promise.resolve();
  const next = previous.then(run, run);
  locks.set(
    userId,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

/**
 * Seats one claimant and only the days that must move.
 * Does not call `engine.run`.
 */
@Injectable()
export class PlacementStepService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(ScheduledTask)
    private readonly scheduledRepo: Repository<ScheduledTask>,
    @InjectRepository(Habit)
    private readonly habitRepo: Repository<Habit>,
    private readonly userSettingsService: UserSettingsService,
    private readonly phasesService: PhasesService,
    private readonly googleCalendarService: GoogleCalendarService,
    private readonly pendingGoogleWrites: PendingGoogleWriteService,
  ) {}

  place(
    userId: string,
    taskId: string,
    opts?: PlaceOptions,
  ): Promise<PlacementPlan> {
    return withUserLock(userId, () => this.placeUnlocked(userId, taskId, opts));
  }

  /**
   * Serialize SQLite writes with placement for one user (single connection).
   * Task create/update saves must not interleave with `place` transactions.
   */
  runExclusive<T>(userId: string, run: () => Promise<T>): Promise<T> {
    return withUserLock(userId, run);
  }

  /**
   * Seat every problematic task that fits a free hole, oldest first.
   * Does not move tasks that are already seated. `resolved` is left alone.
   */
  seatOpenHoles(userId: string, exceptTaskId?: string): Promise<void> {
    return withUserLock(userId, () =>
      this.seatOpenHolesUnlocked(userId, exceptTaskId),
    );
  }

  /** Append missing horizon days for every active recurring task of this user. */
  appendMissingSeriesDays(userId: string): Promise<void> {
    return withUserLock(userId, () => this.appendMissingSeriesDaysUnlocked(userId));
  }

  /**
   * Drop past problematic copies and trim past days from parked series masters.
   * Settings TZ defines "today".
   */
  async purgePastProblematicCopies(limit = 50): Promise<number> {
    const parked = await this.taskRepo.find({
      where: { scheduleState: ScheduleState.PROBLEMATIC },
      take: limit * 4,
      order: { createdAt: 'ASC' },
    });
    let changed = 0;
    const byUser = new Map<string, Task[]>();
    for (const task of parked) {
      const list = byUser.get(task.userId) ?? [];
      list.push(task);
      byUser.set(task.userId, list);
    }
    for (const [userId, tasks] of byUser) {
      if (changed >= limit) break;
      const settings = await this.userSettingsService.getSettings(userId);
      const timeZone = resolveIanaTimeZone(settings.timeZone);
      const today = localYmd(new Date().toISOString(), timeZone);
      for (const task of tasks) {
        if (changed >= limit) break;
        const day = task.problematicDay;
        const ymds = (task.problematicOccurrenceYmds ?? []).filter(
          (ymd) => typeof ymd === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ymd),
        );
        const futureYmds = ymds.filter((ymd) => ymd >= today);
        const dayPast = !!day && day < today;

        // One-off / detached copy whose day is past — delete the row.
        if (!task.isRecurring && dayPast) {
          await this.pendingGoogleWrites.syncTask(userId, task.id);
          await this.taskRepo.remove(task);
          changed += 1;
          continue;
        }

        // Series (or multi-day) park: drop past occurrence days.
        if (ymds.length && futureYmds.length < ymds.length) {
          if (futureYmds.length === 0 && (!day || dayPast)) {
            clearParkMetadata(task);
            await this.taskRepo.save(task);
            changed += 1;
            continue;
          }
          task.problematicOccurrenceYmds = futureYmds;
          if (dayPast) {
            task.problematicDay = futureYmds[0] ?? null;
          }
          await this.taskRepo.save(task);
          changed += 1;
          continue;
        }

        // Legacy single-day park with only problematicDay in the past.
        if (dayPast && !ymds.length) {
          if (task.isRecurring) {
            clearParkMetadata(task);
            await this.taskRepo.save(task);
          } else {
            await this.pendingGoogleWrites.syncTask(userId, task.id);
            await this.taskRepo.remove(task);
          }
          changed += 1;
        }
      }
    }
    return changed;
  }

  private async seatOpenHolesUnlocked(
    userId: string,
    exceptTaskId?: string,
  ): Promise<void> {
    const parked = await this.taskRepo.find({
      where: {
        userId,
        scheduleState: ScheduleState.PROBLEMATIC,
        isUnscheduled: false,
        status: In([TaskStatus.TODO, TaskStatus.IN_PROGRESS]),
      },
      order: { createdAt: 'ASC' },
    });
    for (const task of parked) {
      if (task.id === exceptTaskId) continue;
      await this.placeUnlocked(userId, task.id, { searchHole: true });
    }
  }

  private async placeUnlocked(
    userId: string,
    taskId: string,
    opts?: PlaceOptions,
  ): Promise<PlacementPlan> {
    const task = await this.taskRepo.findOne({
      where: { id: taskId, userId },
      relations: ['phase', 'phases'],
    });
    if (!task) throw new NotFoundException('Task not found');
    if (
      task.scheduleState === ScheduleState.RESOLVED &&
      task.scheduledStartTime &&
      task.scheduledEndTime
    ) {
      return {
        outcome: 'seated',
        start: new Date(task.scheduledStartTime).getTime(),
        end: new Date(task.scheduledEndTime).getTime(),
        moves: [],
      };
    }

    const settings = await this.userSettingsService.getSettings(userId);
    const timeZone = resolveIanaTimeZone(settings.timeZone);
    const now = new Date();
    const nowMs = now.getTime();
    const horizon = planningHorizonRange(settings, now);
    const phases = await this.phasesService.findAllForScheduling(userId);
    const wake = normalizeClockHm(settings.wakeTime);
    const sleep = normalizeClockHm(settings.sleepTime);
    const weekendOk = settings.weekendWorkEnabled !== false;
    const windowsFor = (linked: FreeSlotsPhaseLike[]) =>
      horizonWindows(
        linked,
        timeZone,
        wake,
        sleep,
        weekendOk,
        horizon.horizonDays,
        now,
      );

    const slots = await this.scheduledRepo
      .createQueryBuilder('st')
      .innerJoinAndSelect('st.task', 't')
      .leftJoinAndSelect('t.phase', 'phase')
      .leftJoinAndSelect('t.phases', 'phases')
      .where('t.userId = :userId', { userId })
      .andWhere('st.scheduledEndTime > :now', { now })
      .getMany();

    const seats: PlacementSeat[] = [];
    const seenFixed = new Set<string>();
    for (const slot of slots) {
      if (slot.taskId === task.id) continue;
      const owner = slot.task;
      if (!owner || owner.isUnscheduled) continue;
      if (owner.scheduleState === ScheduleState.PROBLEMATIC) continue;
      const start = new Date(slot.scheduledStartTime).getTime();
      const end = new Date(slot.scheduledEndTime).getTime();
      if (end <= nowMs) continue;
      const linked = linkedPhases(owner);
      const windows = windowsFor(linked.length ? linked : phases);
      if (owner.scheduleState === ScheduleState.RESOLVED) {
        seats.push(seatFrom(slot, owner, 'resolved', start, end, windows, nowMs, timeZone));
        continue;
      }
      if (
        owner.eventType === TaskEventType.FIXED ||
        owner.isFixedExternal
      ) {
        seenFixed.add(owner.id);
        seats.push(
          seatFrom(slot, owner, 'anchor', start, end, windows, nowMs, timeZone, true),
        );
        continue;
      }
      if (owner.status === TaskStatus.IN_PROGRESS && start < nowMs) {
        seats.push({
          id: `elapsed:${slot.id}`,
          taskId: owner.id,
          taskName: owner.name,
          role: 'elapsed',
          start,
          end: nowMs,
          windows,
          notBefore: nowMs,
        });
        if (end > nowMs) {
          seats.push(
            seatFrom(slot, owner, owner.isRecurring ? 'series' : 'flexible', nowMs, end, windows, nowMs, timeZone),
          );
        }
        continue;
      }
      seats.push(
        seatFrom(
          slot,
          owner,
          owner.isRecurring ? 'series' : 'flexible',
          start,
          end,
          windows,
          nowMs,
          timeZone,
        ),
      );
    }

    const fixedPeers = await this.taskRepo.find({
      where: {
        userId,
        eventType: TaskEventType.FIXED,
        status: In([TaskStatus.TODO, TaskStatus.IN_PROGRESS]),
      },
    });
    for (const peer of fixedPeers) {
      if (peer.id === task.id || seenFixed.has(peer.id)) continue;
      if (!peer.scheduledStartTime || !peer.scheduledEndTime) continue;
      const start = new Date(peer.scheduledStartTime).getTime();
      const end = new Date(peer.scheduledEndTime).getTime();
      if (end <= nowMs) continue;
      seats.push({
        id: `fixed:${peer.id}`,
        taskId: peer.id,
        taskName: peer.name,
        role: 'anchor',
        start,
        end,
        windows: [],
        notBefore: nowMs,
        buffered: true,
      });
    }

    const startYmd = localYmd(now.toISOString(), timeZone);
    const endYmd = addDaysToYmd(startYmd, horizon.horizonDays);
    const habits = await this.habitRepo.find({ where: { userId } });
    habitBlockIntervals(habits, startYmd, endYmd, timeZone).forEach((interval, index) => {
      seats.push({
        id: `habit:${index}`,
        taskId: `habit:${index}`,
        taskName: 'Habit',
        role: 'anchor',
        start: interval.start,
        end: interval.end,
        windows: [],
        notBefore: nowMs,
      });
    });

    const google = await this.googleAnchors(
      userId,
      settings.googleCalendarLinked,
      now,
      horizon.end,
      slots,
    );
    seats.push(...google);

    const durationMinutes = Math.max(
      1,
      opts?.durationMinutes ?? task.estimatedTimeInMinutes ?? 30,
    );
    let claimWindows = windowsFor(
      linkedPhases(task).length ? linkedPhases(task) : phases,
    );
    if (opts?.windowYmd) {
      claimWindows = windowsOnCivilDay(claimWindows, opts.windowYmd, timeZone);
    }
    const windowExpired = isWindowExpired(task, nowMs);
    let interval = opts?.searchHole
      ? null
      : claimInterval(task, durationMinutes, opts?.preferredStart);

    if (opts?.commit === 'keep' && !windowExpired && interval) {
      const fits =
        task.eventType === TaskEventType.FIXED ||
        claimWindows.some(
          (window) =>
            interval!.start >= window.start && interval!.end <= window.end,
        );
      if (fits) {
        if (opts.expandSeries && task.isRecurring) {
          await this.expandSeriesDays(userId, task.id);
        }
        return {
          outcome: 'seated',
          start: interval.start,
          end: interval.end,
          moves: [],
        };
      }
      interval = null;
    }

    if (interval && interval.end <= nowMs) {
      if (opts?.expandSeries && !opts.seriesDay && task.isRecurring) {
        await this.expandSeriesDays(userId, task.id);
      }
      return {
        outcome: 'seated',
        start: interval.start,
        end: interval.end,
        moves: [],
      };
    }

    const plan = planPlacement({
      claim: {
        taskId: task.id,
        taskName: task.name,
        recurring: task.isRecurring,
        durationMinutes,
        notBefore: nowMs,
        windows: claimWindows,
        interval,
        windowExpired,
        mustFitWindow: task.eventType !== TaskEventType.FIXED,
      },
      seats,
      bufferMinutes: normalizeFixedEventBufferMinutes(
        settings.fixedEventBufferMinutes,
      ),
    });

    if (!shouldWritePlan(plan, opts)) {
      if (this.shouldExpandSeries(task, opts)) {
        await this.expandSeriesDays(userId, task.id);
      }
      return plan;
    }
    if (
      plan.outcome === 'problematic' &&
      opts?.searchHole &&
      task.scheduleState === ScheduleState.PROBLEMATIC &&
      !task.scheduledStartTime
    ) {
      return plan;
    }
    // A single series day must never park or wipe the whole master.
    if (
      opts?.seriesDay &&
      (plan.outcome === 'problematic' || plan.outcome === 'unscheduled')
    ) {
      return plan;
    }
    await this.persist(task, plan, now, timeZone, opts?.durationMinutes);
    // Horizon days must exist before the HTTP response — otherwise recurring
    // create looks like a one-off. Google I/O stays non-blocking.
    if (plan.outcome === 'seated' && this.shouldExpandSeries(task, opts)) {
      await this.expandSeriesDays(userId, task.id);
    }
    if (
      !opts?.seriesDay &&
      plan.outcome === 'seated' &&
      (await this.tryReMergeSeriesMember(userId, taskId))
    ) {
      return plan;
    }
    if (
      !opts?.seriesDay &&
      (plan.outcome === 'seated' ||
        plan.outcome === 'problematic' ||
        plan.outcome === 'unscheduled')
    ) {
      this.pendingGoogleWrites.syncTaskSoon(userId, taskId);
      if (plan.outcome === 'seated') {
        for (const move of plan.moves) {
          this.pendingGoogleWrites.syncTaskSoon(userId, move.taskId);
        }
      }
    }
    return plan;
  }

  private async appendMissingSeriesDaysUnlocked(userId: string): Promise<void> {
    const series = await this.taskRepo.find({
      where: {
        userId,
        isRecurring: true,
        isUnscheduled: false,
        status: TaskStatus.TODO,
      },
    });
    for (const task of series) {
      if (isProblematicSchedule(task) || !task.scheduledStartTime) continue;
      if (task.scheduleState === ScheduleState.RESOLVED) continue;
      await this.expandSeriesDays(userId, task.id);
      this.pendingGoogleWrites.syncTaskSoon(userId, task.id);
    }
  }

  private shouldExpandSeries(task: Task, opts?: PlaceOptions): boolean {
    return !!opts?.expandSeries && !opts.seriesDay && task.isRecurring && !!task.scheduledStartTime;
  }

  private async expandSeriesDays(userId: string, taskId: string): Promise<void> {
    const task = await this.taskRepo.findOne({
      where: { id: taskId, userId },
      relations: ['phase', 'phases'],
    });
    if (!task?.isRecurring || !task.scheduledStartTime) return;
    if (!task.seriesGroupId) {
      task.seriesGroupId = task.id;
      await this.taskRepo.save(task);
    }
    const settings = await this.userSettingsService.getSettings(userId);
    const timeZone = resolveIanaTimeZone(settings.timeZone);
    const horizon = planningHorizonRange(settings, new Date());
    const preferredHm = normalizeClockHm(
      localHm(new Date(task.scheduledStartTime).toISOString(), timeZone),
    );
    const openRows = await this.scheduledRepo.find({ where: { taskId } });
    const now = Date.now();
    const openFuture = openRows.filter(
      (row) => new Date(row.scheduledEndTime).getTime() > now,
    );
    const anchorYmd = openFuture.length
      ? localYmd(
          new Date(
            openFuture.sort(
              (a, b) =>
                new Date(a.scheduledStartTime).getTime() -
                new Date(b.scheduledStartTime).getTime(),
            )[0].scheduledStartTime,
          ).toISOString(),
          timeZone,
        )
      : localYmd(new Date(task.scheduledStartTime).toISOString(), timeZone);
    const horizonEndYmd = localYmd(horizon.end.toISOString(), timeZone);
    const durationMs = Math.max(1, task.estimatedTimeInMinutes || 30) * 60_000;
    const untilMs = task.deadline
      ? new Date(task.deadline).getTime()
      : Number.POSITIVE_INFINITY;
    const ymds = seriesOccurrenceYmds({
      anchorYmd,
      horizonEndYmd,
      pattern: task.recurrencePattern,
      weekDays: task.recurrenceWeekDays,
      skippedYmds: task.skippedOccurrenceYmds,
    }).filter((ymd) => {
      const startMs = new Date(localDateTimeIso(ymd, preferredHm, timeZone)).getTime();
      return startMs + durationMs <= untilMs;
    });
    const wanted = new Set([anchorYmd, ...ymds]);
    for (const row of openRows) {
      if (new Date(row.scheduledEndTime).getTime() <= now) continue;
      const ymd = localYmd(
        new Date(row.scheduledStartTime).toISOString(),
        timeZone,
      );
      if (!wanted.has(ymd)) await this.scheduledRepo.remove(row);
    }
    for (const ymd of ymds) {
      const preferredStart = new Date(
        localDateTimeIso(ymd, preferredHm, timeZone),
      );
      const preferredPlan = await this.placeUnlocked(userId, taskId, {
        preferredStart,
        commit: 'preferred',
        seriesDay: true,
      });
      if (
        preferredPlan.outcome === 'seated' &&
        Math.abs(preferredPlan.start - preferredStart.getTime()) < 1000
      ) {
        continue;
      }
      await this.placeUnlocked(userId, taskId, {
        searchHole: true,
        seriesDay: true,
        windowYmd: ymd,
      });
    }
    await this.reconcileSeriesClockGroups(userId, taskId, timeZone);
  }

  /**
   * After per-day seating, split divergent clocks into sibling tasks in the
   * same series group (largest clock group stays on the original task).
   */
  private async reconcileSeriesClockGroups(
    userId: string,
    taskId: string,
    timeZone: string,
  ): Promise<void> {
    const task = await this.taskRepo.findOne({
      where: { id: taskId, userId },
      relations: ['phase', 'phases'],
    });
    if (!task?.isRecurring) return;
    const groupId = task.seriesGroupId ?? task.id;
    if (!task.seriesGroupId) {
      task.seriesGroupId = groupId;
      await this.taskRepo.save(task);
    }
    const now = new Date();
    const rows = await this.scheduledRepo.find({ where: { taskId } });
    const open = rows.filter(
      (row) => new Date(row.scheduledEndTime).getTime() > now.getTime(),
    );
    if (open.length < 2) return;

    const slotMeta = open.map((row) => ({
      row,
      ymd: localYmd(new Date(row.scheduledStartTime).toISOString(), timeZone),
      hm: normalizeClockHm(
        localHm(new Date(row.scheduledStartTime).toISOString(), timeZone),
      ),
    }));
    const byHm = groupYmdsByClockHm(
      slotMeta.map(({ ymd, hm }) => ({ ymd, hm })),
    );
    if (byHm.size <= 1) return;

    const preferredHm = task.scheduledStartTime
      ? normalizeClockHm(
          localHm(new Date(task.scheduledStartTime).toISOString(), timeZone),
        )
      : null;
    const primaryHm = pickPrimaryClockHm(byHm, preferredHm);
    const durationMs =
      Math.max(1, task.estimatedTimeInMinutes || 30) * 60_000;
    const primaryAnchor = slotMeta.find((s) => s.hm === primaryHm);
    if (primaryAnchor) {
      const start = new Date(
        localDateTimeIso(primaryAnchor.ymd, primaryHm, timeZone),
      );
      task.scheduledStartTime = start;
      task.scheduledEndTime = new Date(start.getTime() + durationMs);
    }

    const affectedIds = new Set<string>([task.id]);
    for (const [hm, ymds] of byHm) {
      if (hm === primaryHm) continue;
      for (const ymd of ymds) {
        task.skippedOccurrenceYmds = addSkippedOccurrenceYmd(
          task.skippedOccurrenceYmds,
          ymd,
        );
      }
      const hmRows = slotMeta.filter((s) => s.hm === hm).map((s) => s.row);
      const sibling = await this.createSeriesClockSibling(
        task,
        groupId,
        hm,
        ymds,
        hmRows,
        timeZone,
        durationMs,
      );
      affectedIds.add(sibling.id);
    }
    await this.taskRepo.save(task);
    for (const id of affectedIds) {
      this.pendingGoogleWrites.syncTaskSoon(userId, id);
    }
  }

  private async createSeriesClockSibling(
    series: Task,
    groupId: string,
    hm: string,
    ymds: string[],
    rows: ScheduledTask[],
    timeZone: string,
    durationMs: number,
  ): Promise<Task> {
    const firstYmd = [...ymds].sort()[0];
    const start = new Date(localDateTimeIso(firstYmd, hm, timeZone));
    const end = new Date(start.getTime() + durationMs);
    const multi = ymds.length >= 2;
    const sibling = this.taskRepo.create({
      name: series.name,
      description: series.description,
      userId: series.userId,
      phaseId: series.phaseId,
      eventType: series.eventType,
      estimatedTimeInMinutes: series.estimatedTimeInMinutes,
      isRecurring: multi,
      recurrencePattern: multi ? series.recurrencePattern : null,
      recurrenceWeekDays: multi ? weekDaysFromYmds(ymds) : null,
      allowSplit: series.allowSplit,
      priority: series.priority,
      deadline: series.deadline,
      scheduleTimeZone: series.scheduleTimeZone,
      status: TaskStatus.TODO,
      scheduledStartTime: start,
      scheduledEndTime: end,
      location: series.location,
      googleColorId: series.googleColorId,
      googleVisibility: series.googleVisibility,
      googleTransparency: series.googleTransparency,
      googleReminders: series.googleReminders,
      scheduleState: ScheduleState.NONE,
      parentSeriesId: series.id,
      seriesGroupId: groupId,
      isUnscheduled: false,
    });
    if (series.phases?.length) sibling.phases = series.phases;
    const saved = await this.taskRepo.save(sibling);
    for (const row of rows) {
      row.taskId = saved.id;
      await this.scheduledRepo.save(row);
    }
    return saved;
  }

  /**
   * If a detached group member lands on a sibling series clock, absorb it
   * back into that series (one recurring event again).
   */
  private async tryReMergeSeriesMember(
    userId: string,
    taskId: string,
  ): Promise<boolean> {
    const task = await this.taskRepo.findOne({ where: { id: taskId, userId } });
    if (!task?.seriesGroupId || task.isRecurring) return false;
    if (!task.scheduledStartTime || !task.scheduledEndTime) return false;
    if (isProblematicSchedule(task)) return false;

    const settings = await this.userSettingsService.getSettings(userId);
    const timeZone = resolveIanaTimeZone(
      settings.timeZone || task.scheduleTimeZone,
    );
    const hm = normalizeClockHm(
      localHm(new Date(task.scheduledStartTime).toISOString(), timeZone),
    );
    const ymd = localYmd(
      new Date(task.scheduledStartTime).toISOString(),
      timeZone,
    );

    const siblings = await this.taskRepo.find({
      where: {
        userId,
        seriesGroupId: task.seriesGroupId,
        isRecurring: true,
        status: TaskStatus.TODO,
      },
    });
    const match = siblings.find((series) => {
      if (series.id === task.id || !series.scheduledStartTime) return false;
      const seriesHm = normalizeClockHm(
        localHm(new Date(series.scheduledStartTime).toISOString(), timeZone),
      );
      return seriesHm === hm;
    });
    if (!match) return false;

    match.skippedOccurrenceYmds = removeSkippedOccurrenceYmd(
      match.skippedOccurrenceYmds,
      ymd,
    );
    await this.taskRepo.save(match);

    const memberSlots = await this.scheduledRepo.find({
      where: { taskId: task.id },
    });
    if (memberSlots.length) await this.scheduledRepo.remove(memberSlots);
    await this.pendingGoogleWrites.syncTask(userId, task.id);
    await this.taskRepo.remove(task);

    await this.placeUnlocked(userId, match.id, {
      preferredStart: new Date(localDateTimeIso(ymd, hm, timeZone)),
      commit: 'preferred',
      seriesDay: true,
    });
    this.pendingGoogleWrites.syncTaskSoon(userId, match.id);
    return true;
  }

  private async persist(
    task: Task,
    plan: PlacementPlan,
    now: Date,
    timeZone: string,
    durationMinutes?: number,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const tasks = manager.getRepository(Task);
      const slots = manager.getRepository(ScheduledTask);
      if (plan.outcome === 'unscheduled') {
        if (task.isRecurring) {
          // Spec: recurring cannot land in Unscheduled — park as Problematic instead.
          task.scheduleState = ScheduleState.PROBLEMATIC;
          task.problematicReason = 'no_slot';
          task.isUnscheduled = false;
          task.scheduledStartTime = null;
          task.scheduledEndTime = null;
          await tasks.save(task);
          await this.deleteOpenSlots(slots, task.id, now);
          return;
        }
        clearParkMetadata(task);
        task.isUnscheduled = true;
        task.scheduledStartTime = null;
        task.scheduledEndTime = null;
        await tasks.save(task);
        await this.deleteOpenSlots(slots, task.id, now);
        return;
      }
      if (plan.outcome === 'problematic') {
        task.scheduleState = ScheduleState.PROBLEMATIC;
        task.problematicReason = plan.reason;
        task.isUnscheduled = false;
        task.scheduledStartTime = null;
        task.scheduledEndTime = null;
        await tasks.save(task);
        await this.deleteOpenSlots(slots, task.id, now);
        return;
      }
      if (plan.outcome !== 'seated') return;

      clearParkMetadata(task);
      task.isUnscheduled = false;
      if (durationMinutes && !task.isRecurring) {
        task.estimatedTimeInMinutes = durationMinutes;
      }
      if (!task.isRecurring || !task.scheduledStartTime) {
        task.scheduledStartTime = new Date(plan.start);
        task.scheduledEndTime = new Date(plan.end);
      }
      await tasks.save(task);
      if (task.isRecurring) {
        const ymd = localYmd(new Date(plan.start).toISOString(), timeZone);
        const existing = await slots.find({ where: { taskId: task.id } });
        for (const row of existing) {
          const rowYmd = localYmd(
            new Date(row.scheduledStartTime).toISOString(),
            timeZone,
          );
          if (rowYmd === ymd && new Date(row.scheduledEndTime) > now) {
            await slots.remove(row);
          }
        }
      } else {
        await this.deleteOpenSlots(slots, task.id, now);
      }
      await slots.save(
        slots.create({
          taskId: task.id,
          scheduledStartTime: new Date(plan.start),
          scheduledEndTime: new Date(plan.end),
          isAutoGenerated: true,
        }),
      );

      for (const move of plan.moves) {
        await this.applyMove(task.userId, tasks, slots, move, now);
      }
    });
  }

  private async applyMove(
    userId: string,
    tasks: Repository<Task>,
    slots: Repository<ScheduledTask>,
    move: PlacementMove,
    now: Date,
  ): Promise<void> {
    if (move.kind === 'shift') {
      const row = await slots.findOne({ where: { id: move.seatId } });
      if (!row) return;
      const started = new Date(row.scheduledStartTime).getTime();
      if (started < now.getTime()) {
        row.scheduledEndTime = now;
        await slots.save(row);
        await slots.save(
          slots.create({
            taskId: move.taskId,
            scheduledStartTime: new Date(move.start),
            scheduledEndTime: new Date(move.end),
            isAutoGenerated: true,
          }),
        );
        return;
      }
      row.scheduledStartTime = new Date(move.start);
      row.scheduledEndTime = new Date(move.end);
      await slots.save(row);
      const owner = await tasks.findOne({ where: { id: move.taskId, userId } });
      if (owner && !owner.isRecurring) {
        owner.scheduledStartTime = new Date(move.start);
        owner.scheduledEndTime = new Date(move.end);
        await tasks.save(owner);
      }
      return;
    }

    if (move.kind === 'park') {
      const owner = await tasks.findOne({ where: { id: move.taskId, userId } });
      if (!owner) return;
      // Never wipe an entire recurring series when a single seat cannot reseat.
      if (owner.isRecurring) {
        const settings = await this.userSettingsService.getSettings(userId);
        const timeZone = resolveIanaTimeZone(settings.timeZone || owner.scheduleTimeZone);
        const row = await slots.findOne({ where: { id: move.seatId } });
        const startMs = row
          ? new Date(row.scheduledStartTime).getTime()
          : NaN;
        const endMs = row ? new Date(row.scheduledEndTime).getTime() : NaN;
        const occurrenceYmd = Number.isFinite(startMs)
          ? localYmd(new Date(startMs).toISOString(), timeZone)
          : localYmd(now.toISOString(), timeZone);
        await this.applyMove(
          userId,
          tasks,
          slots,
          {
            kind: 'detach',
            seatId: move.seatId,
            taskId: move.taskId,
            occurrenceYmd,
            start: null,
            end: null,
            originalStart: Number.isFinite(startMs) ? startMs : now.getTime(),
            originalEnd: Number.isFinite(endMs) ? endMs : now.getTime(),
            reason: move.reason,
          },
          now,
        );
        return;
      }
      owner.scheduleState = ScheduleState.PROBLEMATIC;
      owner.problematicReason = move.reason;
      owner.isUnscheduled = false;
      owner.scheduledStartTime = null;
      owner.scheduledEndTime = null;
      await tasks.save(owner);
      await this.deleteOpenSlots(slots, owner.id, now);
      return;
    }

    const series = await tasks.findOne({
      where: { id: move.taskId, userId },
      relations: ['phase', 'phases'],
    });
    if (!series) return;
    if (!move.occurrenceYmd) return;
    series.skippedOccurrenceYmds = addSkippedOccurrenceYmd(
      series.skippedOccurrenceYmds,
      move.occurrenceYmd,
    );
    await tasks.save(series);
    const row = await slots.findOne({ where: { id: move.seatId } });
    if (row) await slots.remove(row);

    const copy = tasks.create({
      name: series.name,
      description: series.description,
      userId: series.userId,
      phaseId: series.phaseId,
      eventType: TaskEventType.ADMIN,
      estimatedTimeInMinutes: series.estimatedTimeInMinutes,
      isRecurring: false,
      recurrencePattern: null,
      recurrenceWeekDays: null,
      allowSplit: series.allowSplit,
      priority: series.priority,
      scheduleTimeZone: series.scheduleTimeZone,
      status: TaskStatus.TODO,
      scheduledStartTime: move.start == null ? null : new Date(move.start),
      scheduledEndTime: move.end == null ? null : new Date(move.end),
      location: series.location,
      googleColorId: series.googleColorId,
      googleVisibility: series.googleVisibility,
      googleTransparency: series.googleTransparency,
      googleReminders: series.googleReminders,
      scheduleState:
        move.start == null ? ScheduleState.PROBLEMATIC : ScheduleState.NONE,
      problematicReason: move.reason,
      problematicDay: move.occurrenceYmd,
      problematicOccurrenceYmds: [move.occurrenceYmd],
      problematicOriginalStart: new Date(move.originalStart),
      problematicOriginalEnd: new Date(move.originalEnd),
      parentSeriesId: series.id,
      seriesGroupId: series.seriesGroupId ?? series.id,
      isUnscheduled: false,
    });
    if (series.phases?.length) copy.phases = series.phases;
    const saved = await tasks.save(copy);
    if (move.start != null && move.end != null) {
      await slots.save(
        slots.create({
          taskId: saved.id,
          scheduledStartTime: new Date(move.start),
          scheduledEndTime: new Date(move.end),
          isAutoGenerated: true,
        }),
      );
    }
  }

  private async deleteOpenSlots(
    slots: Repository<ScheduledTask>,
    taskId: string,
    now: Date,
  ): Promise<void> {
    await slots
      .createQueryBuilder()
      .delete()
      .from(ScheduledTask)
      .where('taskId = :taskId', { taskId })
      .andWhere('scheduledEndTime > :now', { now })
      .execute();
  }

  private async googleAnchors(
    userId: string,
    linked: boolean,
    rangeStart: Date,
    rangeEnd: Date,
    slots: ScheduledTask[],
  ): Promise<PlacementSeat[]> {
    if (!linked) return [];
    const exclude = new Set<string>();
    for (const slot of slots) {
      if (slot.googleEventId) exclude.add(slot.googleEventId);
      if (slot.task?.googleEventId) exclude.add(slot.task.googleEventId);
    }
    try {
      const seats: PlacementSeat[] = [];
      const calendarIds = ['primary'];
      const appCalId =
        await this.googleCalendarService.getStoredAppCalendarId(userId);
      if (appCalId) calendarIds.push(appCalId);
      let index = 0;
      for (const calendarId of calendarIds) {
        const page = await this.googleCalendarService.getEvents(
          userId,
          rangeStart.toISOString(),
          rangeEnd.toISOString(),
          2500,
          undefined,
          calendarId,
        );
        for (const ev of page.events) {
          if (ev.status === 'cancelled' || ev.transparency === 'transparent') {
            continue;
          }
          if (ev.id && exclude.has(ev.id)) continue;
          if (ev.recurringEventId && exclude.has(ev.recurringEventId)) continue;
          if (!ev.start?.dateTime || !ev.end?.dateTime) continue;
          const start = new Date(ev.start.dateTime).getTime();
          const end = new Date(ev.end.dateTime).getTime();
          if (end <= start) continue;
          seats.push({
            id: `google:${index++}`,
            taskId: `google:${ev.id ?? index}`,
            taskName: ev.summary || 'Google',
            role: 'anchor',
            start,
            end,
            windows: [],
            notBefore: rangeStart.getTime(),
            buffered: true,
          });
        }
      }
      return seats;
    } catch {
      return [];
    }
  }
}

function linkedPhases(task: Task): FreeSlotsPhaseLike[] {
  const linked = [...(task.phases ?? []), ...(task.phase ? [task.phase] : [])];
  const seen = new Set<string>();
  const out: FreeSlotsPhaseLike[] = [];
  for (const phase of linked) {
    if (!phase?.id || seen.has(phase.id)) continue;
    seen.add(phase.id);
    out.push(phase);
  }
  return out;
}

function horizonWindows(
  phases: FreeSlotsPhaseLike[],
  timeZone: string,
  wake: string,
  sleep: string,
  weekendOk: boolean,
  horizonDays: number,
  now: Date,
): MsInterval[] {
  const startYmd = localYmd(now.toISOString(), timeZone);
  const windows: MsInterval[] = [];
  for (let day = 0; day < horizonDays; day++) {
    windows.push(
      ...eligibleWindowsForDay(
        addDaysToYmd(startYmd, day),
        phases.filter((phase) => phase.type !== 'sleep_time'),
        wake,
        sleep,
        timeZone,
        weekendOk,
      ),
    );
  }
  return windows.filter((window) => window.end > now.getTime());
}

function seatFrom(
  slot: ScheduledTask,
  owner: Task,
  role: PlacementSeat['role'],
  start: number,
  end: number,
  windows: MsInterval[],
  nowMs: number,
  timeZone: string,
  buffered = false,
): PlacementSeat {
  return {
    id: slot.id,
    taskId: owner.id,
    taskName: owner.name,
    role,
    start,
    end,
    occurrenceYmd: owner.isRecurring
      ? localYmd(new Date(start).toISOString(), timeZone)
      : undefined,
    windows,
    notBefore: nowMs,
    buffered,
  };
}

function shouldWritePlan(plan: PlacementPlan, opts?: PlaceOptions): boolean {
  if (plan.outcome === 'conflict') return false;
  if (opts?.commit !== 'preferred') return true;
  if (plan.outcome !== 'seated' || !opts.preferredStart) return false;
  return Math.abs(plan.start - opts.preferredStart.getTime()) < 1000;
}

/** Keep only phase windows that overlap the given civil day. */
function windowsOnCivilDay(
  windows: MsInterval[],
  ymd: string,
  timeZone: string,
): MsInterval[] {
  const dayStart = new Date(startOfLocalDayIso(ymd, timeZone)).getTime();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;
  const out: MsInterval[] = [];
  for (const window of windows) {
    const start = Math.max(window.start, dayStart);
    const end = Math.min(window.end, dayEnd);
    if (end > start) out.push({ start, end });
  }
  return out;
}

function claimInterval(
  task: Task,
  durationMinutes: number,
  preferredStart?: Date | null,
): MsInterval | null {
  const durationMs = durationMinutes * 60_000;
  if (task.eventType === TaskEventType.FIXED) {
    if (!task.scheduledStartTime || !task.scheduledEndTime) return null;
    return {
      start: new Date(task.scheduledStartTime).getTime(),
      end: new Date(task.scheduledEndTime).getTime(),
    };
  }
  const start = preferredStart
    ? preferredStart.getTime()
    : task.scheduledStartTime
      ? new Date(task.scheduledStartTime).getTime()
      : null;
  if (start == null || !Number.isFinite(start)) return null;
  return { start, end: start + durationMs };
}

function isWindowExpired(task: Task, nowMs: number): boolean {
  if (task.eventType === TaskEventType.FIXED || task.isRecurring) return false;
  if (!task.deadline) return false;
  return new Date(task.deadline).getTime() <= nowMs;
}
