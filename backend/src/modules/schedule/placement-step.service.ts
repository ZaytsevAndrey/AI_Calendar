import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, LessThan, Not, IsNull, Repository } from 'typeorm';
import { resolveIanaTimeZone } from '../../common/iana-time-zone';
import { ExternalCalendarBusyService } from '../calendar-providers/external-calendar-busy.service';
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
  dayWakeSleepMs,
  eligibleWindowsForDay,
  type FreeSlotsPhaseLike,
  type MsInterval,
} from './free-slots.util';
import { normalizeFixedEventBufferMinutes, planningHorizonRange } from './planning-horizon.util';
import { lastContinuingSeriesIds } from './recurring-extend.util';
import { placementNotBefore } from './placement-bounds.util';
import {
  planPlacement,
  seriesHorizonYmds,
  type PlacementMove,
  type PlacementPlan,
  type PlacementSeat,
} from './placement-step.util';
import {
  groupYmdsByClockHm,
  pickPrimaryClockHm,
  seriesDayClockHm,
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
  /** Auto-seat and inbox Schedule / Do now: a free gap only, never pack seated tasks. */
  rawHole?: boolean;
  /**
   * With `keep`: the current slot also has to be free of seated tasks (a task
   * back from done / canceled). A miss searches a new hole.
   */
  revalidate?: boolean;
  /** After the first day, write the rest of a series inside the horizon. */
  expandSeries?: boolean;
  /** This call is a later day of a series already being expanded. */
  seriesDay?: boolean;
  /**
   * When set with `seriesDay`, a failed plan does not create a Problematic
   * one-off yet (caller will try a hole next, then park if that fails too).
   */
  deferSeriesDayPark?: boolean;
  /** Restrict hole search / windows to this civil day (YYYY-MM-DD). */
  windowYmd?: string;
  /**
   * Calendar drag. The old From/Until does not clip the drop day away.
   * A free in-phase drop is seated and the window moves onto that day.
   * A drop that still cannot sit is parked (Problematic / Unscheduled)
   * instead of being discarded.
   */
  drag?: boolean;
  /** Compute a plan only — no slot / park / expand writes. */
  dryRun?: boolean;
  /**
   * Preloaded external-calendar anchor seats for a multi-day dry-run.
   * Without this, each series day refetches the whole horizon.
   */
  cachedExternalSeats?: PlacementSeat[];
  /** Dry-run only: plan this unsaved task instead of loading `taskId`. */
  draftTask?: Task;
  /** Dry-run only: extra busy anchors (items a caller already proposed). */
  extraSeats?: PlacementSeat[];
  /** Dry-run only: free the current slots of these tasks (they are being re-seated). */
  ignoreTaskIds?: string[];
};

export type PlacementPreviewInput = {
  /** Unsaved task to seat; its `id` may be a draft id. */
  task: Task;
  /** Civil day (YYYY-MM-DD) the seat must stay on. */
  windowYmd: string;
  preferredStart?: Date | null;
  extraSeats?: PlacementSeat[];
  ignoreTaskIds?: string[];
};
import { providerEventsToBusyIntervals } from './external-calendar-busy.util';
import { ScheduledTask } from './schedule.entity';
import { noteGoogleSync } from '../google-calendar/google-sync-outbox';
import { withUserLock } from './user-lock';

/** Thrown inside `writeAndPlace` to roll the transaction back on an unwanted plan. */
class RejectedPlacement extends Error {
  constructor(
    readonly plan: PlacementPlan,
    readonly taskId: string,
  ) {
    super('placement rejected');
  }
}


function summarizeMoves(moves: PlacementMove[]): string {
  if (!moves.length) return 'none';
  return moves
    .map((move) => {
      if (move.kind === 'shift') {
        return `shift:${move.taskId.slice(0, 8)}→${new Date(move.start).toISOString()}`;
      }
      if (move.kind === 'detach') {
        return `detach:${move.taskId.slice(0, 8)}@${move.occurrenceYmd}`;
      }
      return `park:${move.taskId.slice(0, 8)}:${move.reason}`;
    })
    .join('; ');
}

function summarizePlan(
  plan: PlacementPlan,
  timeZone: string,
): Record<string, unknown> {
  if (plan.outcome === 'seated') {
    return {
      outcome: 'seated',
      hm: normalizeClockHm(
        localHm(new Date(plan.start).toISOString(), timeZone),
      ),
      start: new Date(plan.start).toISOString(),
      end: new Date(plan.end).toISOString(),
      lane: plan.lane ?? null,
      moves: summarizeMoves(plan.moves),
      moveCount: plan.moves.length,
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

function peersOnCivilDay(
  seats: PlacementSeat[],
  ymd: string,
  timeZone: string,
): string {
  const rows = seats
    .filter((seat) => {
      if (seat.taskId.startsWith('habit:')) return false;
      const onActual =
        localYmd(new Date(seat.start).toISOString(), timeZone) === ymd;
      const onHome =
        seat.homeStart != null &&
        localYmd(new Date(seat.homeStart).toISOString(), timeZone) === ymd;
      return onActual || onHome;
    })
    .map((seat) => {
      const hm = normalizeClockHm(
        localHm(new Date(seat.start).toISOString(), timeZone),
      );
      const endHm = normalizeClockHm(
        localHm(new Date(seat.end).toISOString(), timeZone),
      );
      let home = '';
      if (seat.homeStart != null && seat.homeEnd != null) {
        const h0 = normalizeClockHm(
          localHm(new Date(seat.homeStart).toISOString(), timeZone),
        );
        const h1 = normalizeClockHm(
          localHm(new Date(seat.homeEnd).toISOString(), timeZone),
        );
        if (h0 !== hm) home = ` home=${h0}-${h1}`;
      }
      const name = seat.taskId.startsWith('google:')
        ? `G:${seat.taskName.slice(0, 20)}`
        : seat.taskName.slice(0, 24);
      return `${seat.role}:${name}@${hm}-${endHm}${home}`;
    });
  return rows.length ? rows.join(' | ') : '(none)';
}

/**
 * Seats one claimant and only the days that must move.
 * Does not call `engine.run`.
 */
@Injectable()
export class PlacementStepService {
  private readonly logger = new Logger(PlacementStepService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(ScheduledTask)
    private readonly scheduledRepo: Repository<ScheduledTask>,
    private readonly userSettingsService: UserSettingsService,
    private readonly phasesService: PhasesService,
    private readonly pendingGoogleWrites: PendingGoogleWriteService,
    private readonly externalBusy: ExternalCalendarBusyService,
  ) {}

  place(
    userId: string,
    taskId: string,
    opts?: PlaceOptions,
  ): Promise<PlacementPlan> {
    return withUserLock(userId, () => this.placeUnlocked(userId, taskId, opts));
  }

  /**
   * Plan one unsaved task on a civil day without writing anything.
   * A preferred start that would shift other tasks falls back to the nearest
   * free hole, so a preview never relies on displacing a peer.
   */
  previewPlacement(
    userId: string,
    input: PlacementPreviewInput,
  ): Promise<PlacementPlan> {
    return withUserLock(userId, () => this.previewUnlocked(userId, input));
  }

  /**
   * Preview several unsaved tasks on one civil day in order. Each seated entry
   * blocks the next ones; external calendars are fetched once.
   */
  previewSequence(
    userId: string,
    input: {
      windowYmd: string;
      entries: Array<{ task: Task; preferredStart: Date | null }>;
      ignoreTaskIds?: string[];
    },
  ): Promise<PlacementPlan[]> {
    return withUserLock(userId, async () => {
      const settings = await this.userSettingsService.getSettings(userId);
      const now = new Date();
      const horizon = planningHorizonRange(settings, now);
      const slots = await this.scheduledRepo
        .createQueryBuilder('st')
        .innerJoinAndSelect('st.task', 't')
        .where('t.userId = :userId', { userId })
        .andWhere('st.scheduledEndTime > :now', { now })
        .getMany();
      const cachedExternalSeats = await this.externalAnchors(
        userId,
        now,
        horizon.end,
        slots,
      );
      const extraSeats: PlacementSeat[] = [];
      const plans: PlacementPlan[] = [];
      for (const entry of input.entries) {
        const plan = await this.previewUnlocked(userId, {
          task: entry.task,
          windowYmd: input.windowYmd,
          preferredStart: entry.preferredStart,
          extraSeats,
          ignoreTaskIds: input.ignoreTaskIds,
          cachedExternalSeats,
        });
        plans.push(plan);
        if (plan.outcome === 'seated') {
          extraSeats.push({
            id: `preview:${entry.task.id}`,
            taskId: `preview:${entry.task.id}`,
            taskName: entry.task.name,
            role: 'anchor',
            start: plan.start,
            end: plan.end,
            windows: [],
            notBefore: now.getTime(),
          });
        }
      }
      return plans;
    });
  }

  private async previewUnlocked(
    userId: string,
    input: PlacementPreviewInput & { cachedExternalSeats?: PlacementSeat[] },
  ): Promise<PlacementPlan> {
    const base: PlaceOptions = {
      dryRun: true,
      draftTask: input.task,
      windowYmd: input.windowYmd,
      extraSeats: input.extraSeats ? [...input.extraSeats] : undefined,
      ignoreTaskIds: input.ignoreTaskIds,
      cachedExternalSeats: input.cachedExternalSeats,
    };
    if (input.preferredStart) {
      const preferred = await this.placeUnlocked(userId, input.task.id, {
        ...base,
        preferredStart: input.preferredStart,
      });
      if (preferred.outcome === 'seated' && preferred.moves.length === 0) {
        return preferred;
      }
    }
    return this.placeUnlocked(userId, input.task.id, {
      ...base,
      searchHole: true,
      preferredStart: input.preferredStart ?? null,
    });
  }

  /**
   * Serialize SQLite writes with placement for one user (single connection).
   * Task create/update saves must not interleave with `place` transactions.
   */
  runExclusive<T>(userId: string, run: () => Promise<T>): Promise<T> {
    return withUserLock(userId, run);
  }

  /**
   * PE-18: a multi-row change and the placement it leads to, as one unit.
   * Under the user lock and in one transaction: `write` makes its rows (a day
   * copy, a skip, a truncated series, …) on the transaction repositories and
   * names the task to place; that task is placed in the same transaction.
   * When `accept(plan)` is false everything rolls back, so callers need no
   * compensation. External calendars are read before the transaction and
   * Google syncs run only after the commit.
   */
  async writeAndPlace(
    userId: string,
    write: (repos: {
      tasks: Repository<Task>;
      slots: Repository<ScheduledTask>;
    }) => Promise<{ taskId: string; opts: PlaceOptions }>,
    accept: (plan: PlacementPlan) => boolean = () => true,
  ): Promise<{ plan: PlacementPlan; taskId: string; committed: boolean }> {
    return withUserLock(userId, async () => {
      const settings = await this.userSettingsService.getSettings(userId);
      const now = new Date();
      const horizon = planningHorizonRange(settings, now);
      const slots = await this.scheduledRepo
        .createQueryBuilder('st')
        .innerJoinAndSelect('st.task', 't')
        .where('t.userId = :userId', { userId })
        .andWhere('st.scheduledEndTime > :now', { now })
        .getMany();
      const cachedExternalSeats = await this.externalAnchors(
        userId,
        now,
        horizon.end,
        slots,
      );
      try {
        return await this.inOneTransaction(async (tx) => {
          const { taskId, opts } = await write({
            tasks: tx.taskRepo,
            slots: tx.scheduledRepo,
          });
          const plan = await tx.placeUnlocked(userId, taskId, {
            ...opts,
            cachedExternalSeats: opts.cachedExternalSeats ?? cachedExternalSeats,
          });
          if (!accept(plan)) throw new RejectedPlacement(plan, taskId);
          return { plan, taskId, committed: true };
        });
      } catch (err) {
        if (err instanceof RejectedPlacement) {
          return { plan: err.plan, taskId: err.taskId, committed: false };
        }
        throw err;
      }
    });
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
    // Only rows that can be past somewhere: a parked day before tomorrow (UTC,
    // so every zone's today is covered) or a multi-day park. Future parks would
    // otherwise fill the batch and past copies would never be reached.
    const tomorrowUtc = addDaysToYmd(new Date().toISOString().slice(0, 10), 1);
    const parked = await this.taskRepo.find({
      where: [
        {
          scheduleState: ScheduleState.PROBLEMATIC,
          problematicDay: LessThan(tomorrowUtc),
        },
        {
          scheduleState: ScheduleState.PROBLEMATIC,
          problematicOccurrenceYmds: Not(IsNull()),
        },
      ],
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
    if (!parked.length) return;
    const settings = await this.userSettingsService.getSettings(userId);
    const today = localYmd(
      new Date().toISOString(),
      resolveIanaTimeZone(settings.timeZone),
    );
    const candidates = parked
      .filter((task) => task.id !== exceptTaskId)
      .map((task) => ({ task, opts: autoSeatOptions(task, today) }))
      .filter((row): row is { task: Task; opts: PlaceOptions } => !!row.opts);
    if (!candidates.length) return;
    // PE-27: one external-calendar read for the whole pass. Seating parked
    // tasks never changes external events, so the snapshot stays valid here;
    // it is not kept beyond this pass.
    const now = new Date();
    const horizon = planningHorizonRange(settings, now);
    const openSlots = await this.scheduledRepo
      .createQueryBuilder('st')
      .innerJoinAndSelect('st.task', 't')
      .where('t.userId = :userId', { userId })
      .andWhere('st.scheduledEndTime > :now', { now })
      .getMany();
    const cachedExternalSeats = await this.externalAnchors(
      userId,
      now,
      horizon.end,
      openSlots,
    );
    for (const { task, opts } of candidates) {
      await this.placeUnlocked(userId, task.id, { ...opts, cachedExternalSeats });
    }
  }

  private async placeUnlocked(
    userId: string,
    taskId: string,
    opts?: PlaceOptions,
  ): Promise<PlacementPlan> {
    const task =
      opts?.dryRun && opts.draftTask
        ? opts.draftTask
        : await this.taskRepo.findOne({
            where: { id: taskId, userId },
            relations: ['phase', 'phases'],
          });
    if (!task) throw new NotFoundException('Task not found');
    const ignoredTaskIds = new Set(opts?.dryRun ? (opts.ignoreTaskIds ?? []) : []);
    if (
      task.scheduleState === ScheduleState.RESOLVED &&
      task.scheduledStartTime &&
      task.scheduledEndTime
    ) {
      // A resolved layer is not re-packed. A requested clock still wins, and
      // that reschedule clears the flag without shifting anyone else.
      let start = new Date(task.scheduledStartTime).getTime();
      let end = new Date(task.scheduledEndTime).getTime();
      if (opts?.preferredStart && Number.isFinite(opts.preferredStart.getTime())) {
        start = opts.preferredStart.getTime();
        const minutes = Math.max(
          1,
          opts.durationMinutes ??
            Math.round((end - new Date(task.scheduledStartTime).getTime()) / 60_000),
        );
        end = start + minutes * 60_000;
      }
      if (!opts?.dryRun) {
        const moved =
          Math.abs(start - new Date(task.scheduledStartTime).getTime()) >= 1000 ||
          Math.abs(end - new Date(task.scheduledEndTime).getTime()) >= 1000;
        if (moved) {
          task.scheduledStartTime = new Date(start);
          task.scheduledEndTime = new Date(end);
          if (opts?.durationMinutes) {
            task.estimatedTimeInMinutes = opts.durationMinutes;
          }
          task.scheduleState = ScheduleState.NONE;
          clearParkMetadata(task);
          await this.taskRepo.save(task);
          this.logger.log(
            `Resolved "${task.name}" moved to ${new Date(start).toISOString()}–${new Date(end).toISOString()}; clearing resolved`,
          );
        }
        await this.mirrorResolvedSeat(task);
      }
      return { outcome: 'seated', start, end, moves: [] };
    }

    // Recurring create/update: plan every horizon day first, then write
    // series groups by identical clock (no seat-then-expand from day 1).
    if (
      opts?.expandSeries &&
      !opts.seriesDay &&
      !opts.dryRun &&
      task.isRecurring &&
      opts.commit !== 'keep'
    ) {
      return this.seatRecurringHorizonUnlocked(userId, taskId, opts);
    }

    const settings = await this.userSettingsService.getSettings(userId);
    const timeZone = resolveIanaTimeZone(settings.timeZone);
    const now = new Date();
    const nowMs = now.getTime();
    const horizon = planningHorizonRange(settings, now);
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

    const peerWindows = (owner: Task, windows: MsInterval[]): MsInterval[] => {
      if (owner.isRecurring || owner.eventType === TaskEventType.FIXED) return windows;
      const from = placementNotBefore(owner, now, timeZone, settings.wakeTime).getTime();
      const until = owner.deadline ? new Date(owner.deadline).getTime() : Number.POSITIVE_INFINITY;
      return clipWindowsToSpan(windows, from, Number.isFinite(until) ? until : Number.POSITIVE_INFINITY);
    };
    const seats: PlacementSeat[] = [];
    const seenFixed = new Set<string>();
    for (const slot of slots) {
      if (slot.taskId === task.id || ignoredTaskIds.has(slot.taskId)) continue;
      const owner = slot.task;
      if (!owner || owner.isUnscheduled) continue;
      if (owner.scheduleState === ScheduleState.PROBLEMATIC) continue;
      // Done and canceled tasks free their time: never a seat, never moved.
      if (
        owner.status === TaskStatus.COMPLETED ||
        owner.status === TaskStatus.CANCELED
      ) {
        continue;
      }
      const start = new Date(slot.scheduledStartTime).getTime();
      const end = new Date(slot.scheduledEndTime).getTime();
      if (end <= nowMs) continue;
      // A peer searches by the same rules as a claimant: its own phases (or
      // wake/sleep), not before its From, not after its deadline.
      const windows = peerWindows(owner, windowsFor(linkedPhases(owner)));
      if (owner.scheduleState === ScheduleState.RESOLVED) {
        seenFixed.add(owner.id);
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
          const role = owner.isRecurring ? 'series' : 'flexible';
          const seatWindows =
            role === 'series'
              ? windowsOnCivilDay(
                  windows,
                  localYmd(new Date(start).toISOString(), timeZone),
                  timeZone,
                )
              : windows;
          seats.push(
            seatFrom(slot, owner, role, nowMs, end, seatWindows, nowMs, timeZone),
          );
        }
        continue;
      }
      {
        const role = owner.isRecurring ? 'series' : 'flexible';
        const seatWindows =
          role === 'series'
            ? windowsOnCivilDay(
                windows,
                localYmd(new Date(start).toISOString(), timeZone),
                timeZone,
              )
            : windows;
        seats.push(
          seatFrom(slot, owner, role, start, end, seatWindows, nowMs, timeZone),
        );
      }
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
        role: peer.scheduleState === ScheduleState.RESOLVED ? 'resolved' : 'anchor',
        start,
        end,
        windows: [],
        notBefore: nowMs,
        buffered: true,
      });
    }

    const external =
      opts?.cachedExternalSeats ??
      (await this.externalAnchors(userId, now, horizon.end, slots));
    // Copies: seat windows are clipped per call; a shared cache must stay clean.
    seats.push(...external.map((seat) => ({ ...seat })));
    if (opts?.dryRun && opts.extraSeats?.length) {
      seats.push(...opts.extraSeats.map((seat) => ({ ...seat })));
    }

    await this.attachSeriesHomeClocks(userId, seats, slots, timeZone);

    const durationMinutes = Math.max(
      1,
      opts?.durationMinutes ?? task.estimatedTimeInMinutes ?? 30,
    );
    // Wake/sleep is the day. The task is searched on its own start→end inside
    // that day. A linked phase keeps only the phase slices of that interval.
    let claimWindows = windowsFor(linkedPhases(task));
    const windowExpired = isWindowExpired(task, nowMs);
    let interval = opts?.searchHole
      ? null
      : claimInterval(task, durationMinutes, opts?.preferredStart);
    const dayYmd =
      opts?.windowYmd ??
      (interval
        ? localYmd(new Date(interval.start).toISOString(), timeZone)
        : opts?.preferredStart
          ? localYmd(opts.preferredStart.toISOString(), timeZone)
          : null);
    if (dayYmd) {
      claimWindows = windowsOnCivilDay(claimWindows, dayYmd, timeZone);
      // Same-day displace only: do not "find a hole" on another civil day.
      // Peers already seated that day must keep a move window even if their
      // phase filter clipped to empty — otherwise preferred never shifts them.
      const dayBounds = dayWakeSleepMs(dayYmd, wake, sleep, timeZone);
      for (const seat of seats) {
        const clipped = windowsOnCivilDay(seat.windows, dayYmd, timeZone);
        seat.windows =
          clipped.length > 0
            ? clipped
            : interval && overlapsMs(seat, interval)
              ? [dayBounds]
              : clipped;
      }
    }

    // A series whose master clock day is already over (created on an earlier
    // day): its seated days stay as they are and only missing days are
    // appended. Checking that past day's window would park history (AUD-003).
    if (opts?.commit === 'keep' && task.isRecurring && interval && interval.end <= nowMs) {
      if (opts.expandSeries && !opts.dryRun) await this.expandSeriesDays(userId, task.id);
      return { outcome: 'seated', start: interval.start, end: interval.end, moves: [] };
    }

    if (opts?.commit === 'keep' && !windowExpired && interval) {
      const free =
        !opts.revalidate ||
        !seats.some(
          (seat) => seat.role !== 'resolved' && overlapsMs(seat, interval!),
        );
      const fits =
        task.eventType === TaskEventType.FIXED ||
        (free &&
          claimWindows.some(
            (window) =>
              interval!.start >= window.start && interval!.end <= window.end,
          ));
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

    // A series day never takes a clock that has already started today;
    // the day plan falls back to a hole after now.
    if (interval && opts?.seriesDay && interval.start < nowMs) {
      return { outcome: 'problematic', reason: 'no_slot' };
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

    if (opts?.dryRun && opts.seriesDay && dayYmd) {
      const windowSummary = claimWindows
        .map((w) => {
          const a = normalizeClockHm(
            localHm(new Date(w.start).toISOString(), timeZone),
          );
          const b = normalizeClockHm(
            localHm(new Date(w.end).toISOString(), timeZone),
          );
          return `${a}-${b}`;
        })
        .join(',');
      this.logger.log(
        `[series-horizon] landscape ymd=${dayYmd} task=${task.id.slice(0, 8)} ` +
          `searchHole=${!!opts.searchHole} ` +
          `preferred=${opts.preferredStart ? localHm(opts.preferredStart.toISOString(), timeZone) : 'none'} ` +
          `interval=${interval ? `${localHm(new Date(interval.start).toISOString(), timeZone)}-${localHm(new Date(interval.end).toISOString(), timeZone)}` : 'none'} ` +
          `windows=[${windowSummary || 'none'}] ` +
          `peers=[${peersOnCivilDay(seats, dayYmd, timeZone)}]`,
      );
    }

    const claimNotBefore = placementNotBefore(
      task,
      now,
      timeZone,
      settings.wakeTime,
    ).getTime();
    let span = flexibleSearchSpan(
      task,
      claimNotBefore,
      opts?.preferredStart ?? null,
      timeZone,
      wake,
      sleep,
    );
    // A drag is a chosen interval. The stored From/Until must not erase the
    // drop day's phase windows before we know whether that interval fits.
    if (opts?.drag && interval && span) {
      span = {
        start: Math.min(span.start, interval.start),
        end: Number.isFinite(span.end) ? Math.max(span.end, interval.end) : span.end,
      };
    }
    if (span) {
      claimWindows = clipWindowsToSpan(claimWindows, span.start, span.end);
    }

    const plan = planPlacement({
      claim: {
        taskId: task.id,
        taskName: task.name,
        recurring: task.isRecurring,
        durationMinutes,
        notBefore: span?.start ?? claimNotBefore,
        windows: claimWindows,
        interval,
        preferNearMs:
          opts?.searchHole && opts?.preferredStart
            ? opts.preferredStart.getTime()
            : null,
        windowExpired: opts?.drag ? false : windowExpired,
        mustFitWindow: task.eventType !== TaskEventType.FIXED,
        allowResolvedOverlap: opts?.commit === 'preferred',
        allowPack: !opts?.rawHole,
      },
      seats,
      bufferMinutes: normalizeFixedEventBufferMinutes(
        settings.fixedEventBufferMinutes,
      ),
    });
    this.logPreferredMiss({
      task,
      opts,
      timeZone,
      durationMinutes,
      windowExpired,
      interval,
      span,
      claimWindows,
      seats,
      plan,
    });

    if (opts?.dryRun && opts.seriesDay && dayYmd) {
      this.logger.log(
        `[series-horizon] planPlacement ymd=${dayYmd} ` +
          `${JSON.stringify(summarizePlan(plan, timeZone))}`,
      );
    }

    // Preferred failed for a series create/update: try a same-day hole before
    // parking that day (and still expand the rest of the horizon below).
    if (
      !opts?.seriesDay &&
      task.isRecurring &&
      task.eventType !== TaskEventType.FIXED &&
      opts?.expandSeries &&
      plan.outcome === 'problematic' &&
      !opts.searchHole &&
      interval
    ) {
      return this.placeUnlocked(userId, taskId, {
        searchHole: true,
        expandSeries: true,
        windowYmd: dayYmd ?? undefined,
        preferredStart:
          opts.preferredStart ??
          (task.scheduledStartTime ? new Date(task.scheduledStartTime) : null),
      });
    }

    // A preferred clock is a wish, not a reason to park. One-off flexible:
    // if that exact interval misses the window, take the nearest free hole
    // before Problematic. Fixed overlap stays a conflict (asked above).
    // Form edits with commit "preferred" keep the old slot instead.
    if (
      !opts?.seriesDay &&
      !task.isRecurring &&
      task.eventType !== TaskEventType.FIXED &&
      opts?.commit !== 'preferred' &&
      opts?.commit !== 'keep' &&
      plan.outcome === 'problematic' &&
      !opts?.searchHole &&
      interval
    ) {
      return this.placeUnlocked(userId, taskId, {
        ...opts,
        searchHole: true,
        durationMinutes,
        preferredStart:
          opts?.preferredStart ??
          (task.scheduledStartTime
            ? new Date(task.scheduledStartTime)
            : new Date(interval.start)),
      });
    }

    if (opts?.dryRun) return plan;

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
    // A single series day must never wipe the whole master; park that day only.
    if (
      opts?.seriesDay &&
      (plan.outcome === 'problematic' || plan.outcome === 'unscheduled')
    ) {
      const parkYmd = opts.windowYmd ?? dayYmd;
      if (
        plan.outcome === 'problematic' &&
        parkYmd &&
        !opts.deferSeriesDayPark
      ) {
        await this.parkFailedSeriesDay(
          userId,
          task,
          parkYmd,
          plan.reason,
          timeZone,
          opts.preferredStart ?? null,
          durationMinutes,
        );
      }
      return plan;
    }
    // First day of a series create/update failed: park that civil day only,
    // keep a clock for expand, then seat every later horizon day on its own.
    if (
      !opts?.seriesDay &&
      task.isRecurring &&
      opts?.expandSeries &&
      (plan.outcome === 'problematic' || plan.outcome === 'unscheduled')
    ) {
      return this.parkFirstDayAndExpandSeries(
        userId,
        task,
        plan,
        {
          dayYmd: opts.windowYmd ?? dayYmd,
          preferredStart:
            opts.preferredStart ??
            (task.scheduledStartTime ? new Date(task.scheduledStartTime) : null),
          durationMinutes,
          timeZone,
          wake,
          now,
          nowMs,
        },
      );
    }
    if (
      opts?.drag &&
      plan.outcome === 'seated' &&
      opts.preferredStart &&
      Math.abs(plan.start - opts.preferredStart.getTime()) < 1000
    ) {
      followWindowToDrop(task, plan.start, plan.end, timeZone);
    }
    await this.persist(task, plan, now, timeZone, opts?.durationMinutes);
    // Horizon days must exist before the HTTP response — otherwise recurring
    // create looks like a one-off. Google I/O stays non-blocking.
    if (plan.outcome === 'seated' && this.shouldExpandSeries(task, opts)) {
      await this.expandSeriesDays(userId, task.id);
    }
    if (!opts?.seriesDay && plan.outcome === 'seated') {
      const mergedIntoTaskId = await this.tryReMergeSeriesMember(userId, taskId);
      if (mergedIntoTaskId) {
        return { ...plan, mergedIntoTaskId };
      }
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
    const eligible = series.filter(
      (task) =>
        !isProblematicSchedule(task) &&
        !!task.scheduledStartTime &&
        task.scheduleState !== ScheduleState.RESOLVED,
    );
    if (!eligible.length) return;
    const slotEnds = await this.scheduledRepo
      .createQueryBuilder('st')
      .select('st.taskId', 'taskId')
      .addSelect('MAX(st.scheduledEndTime)', 'lastEnd')
      .where('st.taskId IN (:...ids)', { ids: eligible.map((task) => task.id) })
      .groupBy('st.taskId')
      .getRawMany<{ taskId: string; lastEnd: string | Date }>();
    const lastEndByTaskId = new Map<string, number>();
    for (const row of slotEnds) {
      const ms = new Date(row.lastEnd).getTime();
      if (Number.isFinite(ms)) lastEndByTaskId.set(row.taskId, ms);
    }
    const continuing = lastContinuingSeriesIds(
      eligible.map((task) => ({
        id: task.id,
        seriesGroupId: task.seriesGroupId,
        scheduledStartTime: task.scheduledStartTime,
        scheduledEndTime: task.scheduledEndTime,
      })),
      lastEndByTaskId,
    );
    for (const task of eligible) {
      if (!continuing.has(task.id)) continue;
      await this.expandSeriesDays(userId, task.id);
      this.pendingGoogleWrites.syncTaskSoon(userId, task.id);
    }
  }

  private shouldExpandSeries(task: Task, opts?: PlaceOptions): boolean {
    return !!opts?.expandSeries && !opts.seriesDay && task.isRecurring && !!task.scheduledStartTime;
  }

  /**
   * Create/update preferred (or hole) failed for the first series day. Spec:
   * park that civil day only, then every later horizon day searches alone.
   */
  private async parkFirstDayAndExpandSeries(
    userId: string,
    task: Task,
    plan: PlacementPlan,
    ctx: {
      dayYmd: string | null;
      preferredStart: Date | null;
      durationMinutes: number;
      timeZone: string;
      wake: string;
      now: Date;
      nowMs: number;
    },
  ): Promise<PlacementPlan> {
    const todayYmd = localYmd(ctx.now.toISOString(), ctx.timeZone);
    // Never park a day that is already in the past (AUD-003).
    const parkYmd = ctx.dayYmd && ctx.dayYmd >= todayYmd ? ctx.dayYmd : todayYmd;
    const reason =
      plan.outcome === 'problematic' ? plan.reason : 'no_slot';
    await this.parkFailedSeriesDay(
      userId,
      task,
      parkYmd,
      reason,
      ctx.timeZone,
      ctx.preferredStart,
      ctx.durationMinutes,
    );

    const fresh = await this.taskRepo.findOne({
      where: { id: task.id, userId },
      relations: ['phase', 'phases'],
    });
    if (!fresh?.isRecurring) {
      return { outcome: 'problematic', reason };
    }

    // Keep a clock so expand can try the same HH:mm on later days.
    const clock =
      ctx.preferredStart ??
      new Date(localDateTimeIso(parkYmd, ctx.wake, ctx.timeZone));
    fresh.scheduledStartTime = clock;
    fresh.scheduledEndTime = new Date(
      clock.getTime() + ctx.durationMinutes * 60_000,
    );
    fresh.scheduleState = ScheduleState.NONE;
    fresh.isUnscheduled = false;
    clearParkMetadata(fresh);
    if (!fresh.seriesGroupId) fresh.seriesGroupId = fresh.id;
    await this.taskRepo.save(fresh);

    await this.expandSeriesDays(userId, fresh.id);

    const openRows = await this.scheduledRepo.find({
      where: { taskId: fresh.id },
    });
    const future = openRows
      .filter((row) => new Date(row.scheduledEndTime).getTime() > ctx.nowMs)
      .sort(
        (a, b) =>
          new Date(a.scheduledStartTime).getTime() -
          new Date(b.scheduledStartTime).getTime(),
      );
    if (future.length) {
      const seated = await this.taskRepo.findOne({
        where: { id: fresh.id, userId },
      });
      if (seated) {
        seated.scheduledStartTime = new Date(future[0].scheduledStartTime);
        seated.scheduledEndTime = new Date(future[0].scheduledEndTime);
        seated.scheduleState = ScheduleState.NONE;
        seated.isUnscheduled = false;
        clearParkMetadata(seated);
        await this.taskRepo.save(seated);
      }
      this.pendingGoogleWrites.syncTaskSoon(userId, fresh.id);
      return {
        outcome: 'seated',
        start: new Date(future[0].scheduledStartTime).getTime(),
        end: new Date(future[0].scheduledEndTime).getTime(),
        moves: [],
      };
    }

    await this.persist(
      fresh,
      { outcome: 'problematic', reason },
      ctx.now,
      ctx.timeZone,
      ctx.durationMinutes,
    );
    this.pendingGoogleWrites.syncTaskSoon(userId, fresh.id);
    return { outcome: 'problematic', reason };
  }

  /**
   * One series civil day could not be seated. Keep other days; expose a
   * Problematic one-off copy so the inbox can Move / Skip / Resolve that day.
   */
  private async parkFailedSeriesDay(
    userId: string,
    series: Task,
    ymd: string,
    reason: string,
    timeZone: string,
    preferredStart: Date | null,
    durationMinutes: number,
  ): Promise<void> {
    const fresh = await this.taskRepo.findOne({
      where: { id: series.id, userId },
      relations: ['phase', 'phases'],
    });
    if (!fresh?.isRecurring) return;
    fresh.skippedOccurrenceYmds = addSkippedOccurrenceYmd(
      fresh.skippedOccurrenceYmds,
      ymd,
    );
    if (!fresh.seriesGroupId) fresh.seriesGroupId = fresh.id;
    await this.taskRepo.save(fresh);

    const openRows = await this.scheduledRepo.find({ where: { taskId: fresh.id } });
    for (const row of openRows) {
      const rowYmd = localYmd(
        new Date(row.scheduledStartTime).toISOString(),
        timeZone,
      );
      if (rowYmd === ymd) await this.scheduledRepo.remove(row);
    }

    const durationMs = Math.max(1, durationMinutes) * 60_000;
    const originalStart = preferredStart
      ? preferredStart
      : new Date(localDateTimeIso(ymd, '09:00', timeZone));
    const originalEnd = new Date(originalStart.getTime() + durationMs);
    const copy = this.taskRepo.create({
      name: fresh.name,
      description: fresh.description,
      userId: fresh.userId,
      phaseId: fresh.phaseId,
      // A fixed series day stays fixed: its copy keeps the clock (PE-24).
      eventType: fresh.eventType,
      estimatedTimeInMinutes: fresh.estimatedTimeInMinutes,
      isRecurring: false,
      recurrencePattern: null,
      recurrenceWeekDays: null,
      allowSplit: fresh.allowSplit,
      priority: fresh.priority,
      scheduleTimeZone: fresh.scheduleTimeZone,
      status: TaskStatus.TODO,
      scheduledStartTime: null,
      scheduledEndTime: null,
      location: fresh.location,
      googleColorId: fresh.googleColorId,
      googleVisibility: fresh.googleVisibility,
      googleTransparency: fresh.googleTransparency,
      googleReminders: fresh.googleReminders,
      scheduleState: ScheduleState.PROBLEMATIC,
      problematicReason: reason,
      problematicDay: ymd,
      problematicOccurrenceYmds: [ymd],
      problematicOriginalStart: originalStart,
      problematicOriginalEnd: originalEnd,
      parentSeriesId: fresh.id,
      seriesGroupId: fresh.seriesGroupId ?? fresh.id,
      originalOccurrenceYmd: ymd,
      isUnscheduled: false,
    });
    if (fresh.phases?.length) copy.phases = fresh.phases;
    await this.taskRepo.save(copy);
  }

  /**
   * Run `write` as one transaction. Inside, `tx` is this service with its
   * repositories (and nested `dataSource.transaction`) bound to that
   * transaction; Google syncs are held until the commit.
   */
  private async inOneTransaction<T>(write: (tx: this) => Promise<T>): Promise<T> {
    const deferred = new Map<string, string>();
    const hold = (userId: string, taskId: string) => {
      deferred.set(taskId, userId);
    };
    const result = await this.dataSource.transaction(async (manager) => {
      const tx = Object.create(this, {
        dataSource: {
          value: {
            transaction: <R>(fn: (m: typeof manager) => Promise<R>) => fn(manager),
          },
        },
        taskRepo: { value: manager.getRepository(Task) },
        scheduledRepo: { value: manager.getRepository(ScheduledTask) },
        pendingGoogleWrites: {
          value: {
            syncTask: async (userId: string, taskId: string) => hold(userId, taskId),
            syncTaskSoon: hold,
          },
        },
      }) as this;
      return write(tx);
    });
    for (const [taskId, userId] of deferred) {
      this.pendingGoogleWrites.syncTaskSoon(userId, taskId);
    }
    return result;
  }

  /**
   * Plan every horizon day independently (dry-run), then commit peer moves and
   * group seated days by identical HH:mm into series / siblings / parks.
   */
  private async seatRecurringHorizonUnlocked(
    userId: string,
    taskId: string,
    opts?: PlaceOptions,
  ): Promise<PlacementPlan> {
    const task = await this.taskRepo.findOne({
      where: { id: taskId, userId },
      relations: ['phase', 'phases'],
    });
    if (!task?.isRecurring) throw new NotFoundException('Task not found');

    const settings = await this.userSettingsService.getSettings(userId);
    const timeZone = resolveIanaTimeZone(settings.timeZone);
    const now = new Date();
    const nowMs = now.getTime();
    const horizon = planningHorizonRange(settings, now);
    const durationMinutes = Math.max(
      1,
      fixedSlotMinutes(task) ?? opts?.durationMinutes ?? task.estimatedTimeInMinutes ?? 30,
    );
    const durationMs = durationMinutes * 60_000;
    const exactClock = task.eventType === TaskEventType.FIXED;
    const preferredHmHint = opts?.preferredStart
      ? normalizeClockHm(
          localHm(opts.preferredStart.toISOString(), timeZone),
        )
      : task.scheduledStartTime
        ? normalizeClockHm(
            localHm(new Date(task.scheduledStartTime).toISOString(), timeZone),
          )
        : null;

    // Days count from the series start (DTSTART); today or a later From day
    // only drops what is before it.
    const anchorYmd = seriesAnchorYmd(task, timeZone);
    const fromYmd = seriesStartYmd(task, now, timeZone);
    const horizonEndYmd = localYmd(horizon.end.toISOString(), timeZone);
    const untilMs = task.deadline
      ? new Date(task.deadline).getTime()
      : Number.POSITIVE_INFINITY;
    const taskWindows = horizonWindows(
      linkedPhases(task),
      timeZone,
      normalizeClockHm(settings.wakeTime),
      normalizeClockHm(settings.sleepTime),
      settings.weekendWorkEnabled !== false,
      horizon.horizonDays,
      now,
    );
    const ymds = seriesHorizonYmds({
      anchorYmd,
      fromYmd,
      horizonEndYmd,
      pattern: task.recurrencePattern,
      weekDays: task.recurrenceWeekDays,
      skippedYmds: task.skippedOccurrenceYmds,
    }).filter((ymd) => {
      if (preferredHmHint) {
        const startMs = new Date(
          localDateTimeIso(ymd, preferredHmHint, timeZone),
        ).getTime();
        return startMs + durationMs > nowMs && startMs + durationMs <= untilMs;
      }
      // No clock yet: the day counts while its own window (phase ∩ wake/sleep)
      // still has room after now; the day plan finds the hole.
      return windowsOnCivilDay(taskWindows, ymd, timeZone).some(
        (window) =>
          window.end - Math.max(window.start, nowMs) >= durationMs &&
          window.start + durationMs <= untilMs,
      );
    });

    type DayPlan = {
      ymd: string;
      plan: PlacementPlan;
      hm: string | null;
    };
    const hmOf = (plan: PlacementPlan, clock?: string | null): string | null =>
      plan.outcome === 'seated'
        ? seriesDayClockHm(plan.start, timeZone, clock ?? preferredHmHint)
        : null;

    // One external-calendar fetch for the whole horizon — not once per civil
    // day. A caller inside a transaction passes it in (no network in the tx).
    const cachedExternalSeats =
      opts?.cachedExternalSeats ??
      (await this.externalAnchors(
        userId,
        now,
        horizon.end,
        await this.scheduledRepo
          .createQueryBuilder('st')
          .innerJoinAndSelect('st.task', 't')
          .where('t.userId = :userId', { userId })
          .andWhere('st.scheduledEndTime > :now', { now })
          .getMany(),
      ));
    this.logger.log(
      `[series-horizon] start task=${task.id.slice(0, 8)} name="${task.name}" ` +
        `tz=${timeZone} duration=${durationMinutes}m preferredHint=${preferredHmHint ?? 'none'} ` +
        `anchor=${anchorYmd} horizonEnd=${horizonEndYmd} days=${ymds.length} ` +
        `externalAnchors=${cachedExternalSeats.length} ymds=[${ymds.join(',')}]`,
    );

    const dayPlans: DayPlan[] = [];
    for (const ymd of ymds) {
      const plan = await this.planOneSeriesDayDry(
        userId,
        taskId,
        ymd,
        preferredHmHint,
        timeZone,
        'pass1',
        cachedExternalSeats,
        durationMinutes,
        exactClock,
      );
      const hm = hmOf(plan);
      dayPlans.push({ ymd, plan, hm });
      this.logger.log(
        `[series-horizon] pass1 ymd=${ymd} ${JSON.stringify(summarizePlan(plan, timeZone))}`,
      );
    }

    // Choose the dominant clock from busy days (empty horizon days at phase
    // start must not win the vote), then re-plan minority / failed days toward
    // it so we keep one series when a same-day shift can match (live 1/2/3+4).
    const seatedForPick = dayPlans.filter(
      (d): d is DayPlan & { hm: string } =>
        d.plan.outcome === 'seated' && !!d.hm,
    );
    const busyForPick = seatedForPick.filter(
      (d) => d.plan.outcome === 'seated' && d.plan.lane !== 'open',
    );
    // Prefer clocks found as raw holes (no peer moves). Packed squeeze times
    // must not outvote a clean hole and yank that day into a denser stack.
    const holeForPick = busyForPick.filter(
      (d) => d.plan.outcome === 'seated' && d.plan.moves.length === 0,
    );
    const votePool =
      holeForPick.length > 0
        ? holeForPick
        : busyForPick.length > 0
          ? busyForPick
          : seatedForPick;
    const voteByHm = groupYmdsByClockHm(
      votePool.map((d) => ({ ymd: d.ymd, hm: d.hm })),
    );
    let primaryHm =
      votePool.length > 0
        ? pickPrimaryClockHm(voteByHm, preferredHmHint)
        : preferredHmHint;
    const voteSummary = [...voteByHm.entries()]
      .map(([hm, days]) => `${hm}x${days.length}[${days.join(',')}]`)
      .join(' ');
    this.logger.log(
      `[series-horizon] primaryPick primary=${primaryHm ?? 'none'} ` +
        `pool=${holeForPick.length > 0 ? 'hole' : busyForPick.length > 0 ? 'busy' : 'all'} ` +
        `seated=${seatedForPick.length} busy=${busyForPick.length} hole=${holeForPick.length} ` +
        `votes={${voteSummary}}`,
    );

    if (primaryHm) {
      let unifySkip = 0;
      for (let i = 0; i < dayPlans.length; i += 1) {
        const day = dayPlans[i];
        if (day.hm === primaryHm) {
          unifySkip += 1;
          continue;
        }
        const beforeHm = day.hm;
        const retry = await this.planOneSeriesDayDry(
          userId,
          taskId,
          day.ymd,
          primaryHm,
          timeZone,
          'unify',
          cachedExternalSeats,
          durationMinutes,
          exactClock,
        );
        const retryHm = hmOf(retry, primaryHm);
        if (retryHm === primaryHm) {
          dayPlans[i] = { ymd: day.ymd, plan: retry, hm: primaryHm };
          this.logger.log(
            `[series-horizon] unify ok ymd=${day.ymd} ${beforeHm ?? 'fail'}→${primaryHm} ` +
              `${JSON.stringify(summarizePlan(retry, timeZone))}`,
          );
        } else {
          this.logger.log(
            `[series-horizon] unify fail ymd=${day.ymd} keep=${beforeHm ?? 'fail'} ` +
              `wanted=${primaryHm} got=${retryHm ?? 'fail'} ` +
              `${JSON.stringify(summarizePlan(retry, timeZone))}`,
          );
        }
      }
      if (unifySkip) {
        this.logger.log(
          `[series-horizon] unify skip already=${primaryHm} days=${unifySkip}`,
        );
      }
    }

    // Everything below writes. One transaction (PE-18): a failure part-way
    // leaves no peers shifted, no half-written series, no day skipped without
    // its copy. Google syncs run after the commit.
    return this.inOneTransaction(async (tx) => {
      // Peer moves from final day plans (still against the pre-write landscape).
      for (const { ymd, plan } of dayPlans) {
        if (plan.outcome !== 'seated' || !plan.moves.length) continue;
        tx.logger.log(
          `[series-horizon] applyMoves ymd=${ymd} ${summarizeMoves(plan.moves)}`,
        );
        await tx.dataSource.transaction(async (manager) => {
          const tasks = manager.getRepository(Task);
          const slots = manager.getRepository(ScheduledTask);
          for (const move of plan.moves) {
            await tx.applyMove(userId, tasks, slots, move, now);
          }
        });
      }

      if (!task.seriesGroupId) {
        task.seriesGroupId = task.id;
        await tx.taskRepo.save(task);
      }
      const groupId = task.seriesGroupId;

      const seated = dayPlans.filter(
        (d): d is DayPlan & { hm: string } =>
          d.plan.outcome === 'seated' && !!d.hm,
      );
      if (!seated.length) {
        // Spec wave 4 §28–§29: never wipe open seats before a successful rewrite.
        // If this series already has future seats, keep them — do not clear the
        // master clock / Google series. Dry-run often fails against own seats.
        const existingOpen = await tx.scheduledRepo
          .createQueryBuilder('st')
          .where('st.taskId = :taskId', { taskId: task.id })
          .andWhere('st.scheduledEndTime > :now', { now })
          .getCount();
        if (existingOpen > 0 && task.scheduledStartTime && task.scheduledEndTime) {
          tx.logger.warn(
            `[series-horizon] keep existing seats task=${task.id.slice(0, 8)} ` +
              `open=${existingOpen} (horizon rewrite seated 0 days)`,
          );
          tx.pendingGoogleWrites.syncTaskSoon(userId, task.id);
          return {
            outcome: 'seated',
            start: new Date(task.scheduledStartTime).getTime(),
            end: new Date(task.scheduledEndTime).getTime(),
            moves: [],
          };
        }
        let reason = 'no_slot';
        for (const day of dayPlans) {
          if (day.plan.outcome === 'problematic') reason = day.plan.reason;
          await tx.parkFailedSeriesDay(
            userId,
            task,
            day.ymd,
            day.plan.outcome === 'problematic' ? day.plan.reason : 'no_slot',
            timeZone,
            preferredHmHint
              ? new Date(localDateTimeIso(day.ymd, preferredHmHint, timeZone))
              : null,
            durationMinutes,
          );
        }
        // Each failed day already has its own Problematic copy; parking the
        // master too would show the same event N+1 times in the inbox.
        if (!dayPlans.length) {
          await tx.persist(
            task,
            { outcome: 'problematic', reason },
            now,
            timeZone,
            durationMinutes,
          );
        }
        tx.pendingGoogleWrites.syncTaskSoon(userId, task.id);
        return { outcome: 'problematic', reason };
      }

      // Only clear open seats once we know the rewrite has days to write.
      await tx.deleteOpenSlots(tx.scheduledRepo, task.id, now);

      const byHm = groupYmdsByClockHm(
        seated.map((d) => ({ ymd: d.ymd, hm: d.hm })),
      );
      primaryHm = pickPrimaryClockHm(byHm, preferredHmHint ?? primaryHm);
      const planByYmd = new Map(dayPlans.map((d) => [d.ymd, d]));
      const finalGroups = [...byHm.entries()]
        .map(([hm, days]) => `${hm}→[${days.join(',')}]`)
        .join(' ');
      const failedYmds = dayPlans
        .filter((d) => d.plan.outcome !== 'seated')
        .map((d) => d.ymd);
      tx.logger.log(
        `[series-horizon] finalGroups primary=${primaryHm} groups={${finalGroups}} ` +
          `failed=[${failedYmds.join(',') || 'none'}] ` +
          `dayClock=[${dayPlans.map((d) => `${d.ymd}:${d.hm ?? d.plan.outcome}`).join(' ')}]`,
      );

      const primaryYmds = byHm.get(primaryHm) ?? [];
      for (const ymd of primaryYmds) {
        const day = planByYmd.get(ymd)!;
        if (day.plan.outcome !== 'seated') continue;
        await tx.scheduledRepo.save(
          tx.scheduledRepo.create({
            taskId: task.id,
            scheduledStartTime: new Date(day.plan.start),
            scheduledEndTime: new Date(day.plan.end),
            isAutoGenerated: true,
          }),
        );
      }

      const firstPrimary = planByYmd.get(primaryYmds[0])!;
      const fresh = await tx.taskRepo.findOne({
        where: { id: task.id, userId },
        relations: ['phase', 'phases'],
      });
      if (fresh && firstPrimary.plan.outcome === 'seated') {
        fresh.scheduledStartTime = new Date(firstPrimary.plan.start);
        fresh.scheduledEndTime = new Date(firstPrimary.plan.end);
        fresh.estimatedTimeInMinutes = durationMinutes;
        fresh.scheduleState = ScheduleState.NONE;
        fresh.isUnscheduled = false;
        fresh.seriesGroupId = groupId;
        clearParkMetadata(fresh);
        // Days that could not seat are skipped on the master.
        for (const day of dayPlans) {
          if (day.plan.outcome === 'seated') continue;
          fresh.skippedOccurrenceYmds = addSkippedOccurrenceYmd(
            fresh.skippedOccurrenceYmds,
            day.ymd,
          );
        }
        // Non-primary clocks leave the master via sibling split below.
        for (const [hm, ymdsForHm] of byHm) {
          if (hm === primaryHm) continue;
          for (const ymd of ymdsForHm) {
            fresh.skippedOccurrenceYmds = addSkippedOccurrenceYmd(
              fresh.skippedOccurrenceYmds,
              ymd,
            );
          }
        }
        await tx.taskRepo.save(fresh);
      }

      const affectedIds = new Set<string>([task.id]);
      for (const [hm, ymdsForHm] of byHm) {
        if (hm === primaryHm) continue;
        const rows: ScheduledTask[] = [];
        for (const ymd of ymdsForHm) {
          const day = planByYmd.get(ymd)!;
          if (day.plan.outcome !== 'seated') continue;
          const row = tx.scheduledRepo.create({
            taskId: task.id,
            scheduledStartTime: new Date(day.plan.start),
            scheduledEndTime: new Date(day.plan.end),
            isAutoGenerated: true,
          });
          const saved = await tx.scheduledRepo.save(row);
          rows.push(saved);
        }
        if (!rows.length) continue;
        const sibling = await tx.createSeriesClockSibling(
          (await tx.taskRepo.findOne({
            where: { id: task.id, userId },
            relations: ['phase', 'phases'],
          }))!,
          groupId,
          hm,
          ymdsForHm,
          rows,
          timeZone,
          durationMs,
        );
        affectedIds.add(sibling.id);
      }

      for (const day of dayPlans) {
        if (day.plan.outcome === 'seated') continue;
        const reason =
          day.plan.outcome === 'problematic' ? day.plan.reason : 'no_slot';
        await tx.parkFailedSeriesDay(
          userId,
          task,
          day.ymd,
          reason,
          timeZone,
          preferredHmHint
            ? new Date(localDateTimeIso(day.ymd, preferredHmHint, timeZone))
            : null,
          durationMinutes,
        );
      }

      for (const id of affectedIds) {
        tx.pendingGoogleWrites.syncTaskSoon(userId, id);
      }
      for (const { plan } of dayPlans) {
        if (plan.outcome !== 'seated') continue;
        for (const move of plan.moves) {
          tx.pendingGoogleWrites.syncTaskSoon(userId, move.taskId);
        }
      }

      if (firstPrimary.plan.outcome !== 'seated') {
        return { outcome: 'problematic', reason: 'no_slot' };
      }
      return {
        outcome: 'seated',
        start: firstPrimary.plan.start,
        end: firstPrimary.plan.end,
        moves: [],
      };
    });
  }

  private async planOneSeriesDayDry(
    userId: string,
    taskId: string,
    ymd: string,
    preferredHm: string | null,
    timeZone: string,
    phase: 'pass1' | 'unify' = 'pass1',
    cachedExternalSeats?: PlacementSeat[],
    durationMinutes?: number,
    exactClock = false,
  ): Promise<PlacementPlan> {
    const googleOpts =
      cachedExternalSeats != null ? { cachedExternalSeats } : {};
    const durationOpts =
      durationMinutes != null ? { durationMinutes } : {};
    if (preferredHm) {
      const preferredStart = new Date(
        localDateTimeIso(ymd, preferredHm, timeZone),
      );
      const preferredPlan = await this.placeUnlocked(userId, taskId, {
        preferredStart,
        commit: 'preferred',
        seriesDay: true,
        deferSeriesDayPark: true,
        windowYmd: ymd,
        dryRun: true,
        ...googleOpts,
        ...durationOpts,
      });
      if (
        preferredPlan.outcome === 'seated' &&
        Math.abs(preferredPlan.start - preferredStart.getTime()) < 1000
      ) {
        this.logger.log(
          `[series-horizon] ${phase} path=preferred_exact ymd=${ymd} want=${preferredHm}`,
        );
        return preferredPlan;
      }
      if (exactClock) {
        // Fixed series: that day keeps its clock or parks; no nearby hole.
        this.logger.log(
          `[series-horizon] ${phase} path=fixed_miss ymd=${ymd} want=${preferredHm}`,
        );
        return preferredPlan.outcome === 'seated'
          ? { outcome: 'problematic', reason: 'preferred_on_fixed' }
          : preferredPlan;
      }
      this.logger.log(
        `[series-horizon] ${phase} path=preferred_miss→hole ymd=${ymd} want=${preferredHm} ` +
          `preferredResult=${JSON.stringify(summarizePlan(preferredPlan, timeZone))}`,
      );
      return this.placeUnlocked(userId, taskId, {
        searchHole: true,
        seriesDay: true,
        windowYmd: ymd,
        preferredStart,
        dryRun: true,
        deferSeriesDayPark: true,
        ...googleOpts,
        ...durationOpts,
      });
    }
    this.logger.log(
      `[series-horizon] ${phase} path=hole_only ymd=${ymd} want=none`,
    );
    return this.placeUnlocked(userId, taskId, {
      searchHole: true,
      seriesDay: true,
      windowYmd: ymd,
      dryRun: true,
      deferSeriesDayPark: true,
      ...googleOpts,
      ...durationOpts,
    });
  }

  /** Append missing horizon days for an already-seated series (background tick). */
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
    // A day with any row of this task — finished ones included — is seated:
    // today's ended occurrence must not be planned again (AUD-002).
    const seatedYmds = new Set(
      openRows.map((row) =>
        localYmd(new Date(row.scheduledStartTime).toISOString(), timeZone),
      ),
    );
    // Count days from the series start (DTSTART); today only drops the past.
    const anchorYmd = seriesAnchorYmd(task, timeZone);
    const horizonEndYmd = localYmd(horizon.end.toISOString(), timeZone);
    const durationMs =
      Math.max(1, fixedSlotMinutes(task) ?? (task.estimatedTimeInMinutes || 30)) * 60_000;
    const durationMinutes = durationMs / 60_000;
    const exactClock = task.eventType === TaskEventType.FIXED;
    const startYmd = seriesStartYmd(task, new Date(), timeZone);
    const untilMs = task.deadline
      ? new Date(task.deadline).getTime()
      : Number.POSITIVE_INFINITY;
    const ymds = seriesHorizonYmds({
      anchorYmd,
      fromYmd: startYmd,
      horizonEndYmd,
      pattern: task.recurrencePattern,
      weekDays: task.recurrenceWeekDays,
      skippedYmds: task.skippedOccurrenceYmds,
    }).filter((ymd) => {
      if (seatedYmds.has(ymd) || ymd < startYmd) return false;
      const startMs = new Date(
        localDateTimeIso(ymd, preferredHm, timeZone),
      ).getTime();
      // That day's occurrence is already over: nothing to append.
      if (startMs + durationMs <= now) return false;
      return startMs + durationMs <= untilMs;
    });

    const nowDate = new Date();
    const slotsForGoogle = await this.scheduledRepo
      .createQueryBuilder('st')
      .innerJoinAndSelect('st.task', 't')
      .where('t.userId = :userId', { userId })
      .andWhere('st.scheduledEndTime > :now', { now: nowDate })
      .getMany();
    const cachedExternalSeats = await this.externalAnchors(
      userId,
      nowDate,
      horizon.end,
      slotsForGoogle,
    );
    this.logger.log(
      `[series-horizon] expand start task=${task.id.slice(0, 8)} name="${task.name}" ` +
        `preferred=${preferredHm} missing=${ymds.length} ` +
        `externalAnchors=${cachedExternalSeats.length} ymds=[${ymds.join(',')}]`,
    );

    for (const ymd of ymds) {
      const plan = await this.planOneSeriesDayDry(
        userId,
        taskId,
        ymd,
        preferredHm,
        timeZone,
        'pass1',
        cachedExternalSeats,
        durationMinutes,
        exactClock,
      );
      this.logger.log(
        `[series-horizon] expand day ymd=${ymd} ${JSON.stringify(summarizePlan(plan, timeZone))}`,
      );
      if (plan.outcome === 'seated') {
        await this.dataSource.transaction(async (manager) => {
          const tasks = manager.getRepository(Task);
          const slots = manager.getRepository(ScheduledTask);
          for (const move of plan.moves) {
            await this.applyMove(userId, tasks, slots, move, nowDate);
          }
        });
        const hm = seriesDayClockHm(plan.start, timeZone, preferredHm);
        if (hm === preferredHm) {
          await this.scheduledRepo.save(
            this.scheduledRepo.create({
              taskId: task.id,
              scheduledStartTime: new Date(plan.start),
              scheduledEndTime: new Date(plan.end),
              isAutoGenerated: true,
            }),
          );
        } else {
          const row = await this.scheduledRepo.save(
            this.scheduledRepo.create({
              taskId: task.id,
              scheduledStartTime: new Date(plan.start),
              scheduledEndTime: new Date(plan.end),
              isAutoGenerated: true,
            }),
          );
          const fresh = await this.taskRepo.findOne({
            where: { id: task.id, userId },
            relations: ['phase', 'phases'],
          });
          if (fresh) {
            fresh.skippedOccurrenceYmds = addSkippedOccurrenceYmd(
              fresh.skippedOccurrenceYmds,
              ymd,
            );
            await this.taskRepo.save(fresh);
            await this.createSeriesClockSibling(
              fresh,
              fresh.seriesGroupId ?? fresh.id,
              hm,
              [ymd],
              [row],
              timeZone,
              durationMs,
            );
          }
        }
        continue;
      }
      await this.parkFailedSeriesDay(
        userId,
        task,
        ymd,
        plan.outcome === 'problematic' ? plan.reason : 'no_slot',
        timeZone,
        new Date(localDateTimeIso(ymd, preferredHm, timeZone)),
        durationMinutes,
      );
    }
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

    const preferredHm = task.scheduledStartTime
      ? normalizeClockHm(
          localHm(new Date(task.scheduledStartTime).toISOString(), timeZone),
        )
      : null;
    const slotMeta = open.map((row) => ({
      row,
      ymd: localYmd(new Date(row.scheduledStartTime).toISOString(), timeZone),
      hm: seriesDayClockHm(new Date(row.scheduledStartTime).getTime(), timeZone, preferredHm),
    }));
    const byHm = groupYmdsByClockHm(
      slotMeta.map(({ ymd, hm }) => ({ ymd, hm })),
    );
    if (byHm.size <= 1) return;

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
      originalOccurrenceYmd: multi ? null : firstYmd,
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
  /** @returns series task id absorbed into, or null when no re-merge. */
  private async tryReMergeSeriesMember(
    userId: string,
    taskId: string,
  ): Promise<string | null> {
    const task = await this.taskRepo.findOne({ where: { id: taskId, userId } });
    if (!task?.seriesGroupId || task.isRecurring) return null;
    if (!task.scheduledStartTime || !task.scheduledEndTime) return null;
    if (isProblematicSchedule(task)) return null;

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
    // Only the day this copy stands for may rejoin; a copy moved to another
    // day would replace that day's own occurrence.
    if (task.originalOccurrenceYmd !== ymd) return null;

    const siblings = await this.taskRepo.find({
      where: {
        userId,
        seriesGroupId: task.seriesGroupId,
        isRecurring: true,
        status: TaskStatus.TODO,
      },
    });
    const clockMatch = (series: Task): boolean => {
      if (series.id === task.id || !series.scheduledStartTime) return false;
      const seriesHm = normalizeClockHm(
        localHm(new Date(series.scheduledStartTime).toISOString(), timeZone),
      );
      return seriesHm === hm;
    };
    // Prefer the parent series this one-off was detached from.
    const match =
      (task.parentSeriesId
        ? siblings.find((series) => series.id === task.parentSeriesId && clockMatch(series))
        : undefined) ?? siblings.find(clockMatch);
    if (!match) return null;
    // A resize keeps the clock and changes the length. Absorbing it would
    // throw away that length and restore the series duration.
    if (
      !durationsMatch(
        task.scheduledStartTime,
        task.scheduledEndTime,
        seriesBlockMinutes(match),
      )
    ) {
      return null;
    }

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
    return match.id;
  }

  /**
   * Detached one-offs / group members keep `parentSeriesId` / `seriesGroupId`.
   * Attach the master series home clock on that civil day so hole search still
   * sees the vacated series slot as owned (actual∪home).
   */
  private async attachSeriesHomeClocks(
    userId: string,
    seats: PlacementSeat[],
    slots: ScheduledTask[],
    timeZone: string,
  ): Promise<void> {
    const ownerById = new Map<string, Task>();
    for (const slot of slots) {
      if (slot.task) ownerById.set(slot.task.id, slot.task);
    }
    const parentIds = new Set<string>();
    const groupIds = new Set<string>();
    for (const owner of ownerById.values()) {
      if (owner.isRecurring) continue;
      if (owner.parentSeriesId) parentIds.add(owner.parentSeriesId);
      if (owner.seriesGroupId) groupIds.add(owner.seriesGroupId);
    }
    if (!parentIds.size && !groupIds.size) return;

    const homeByTaskId = new Map<string, { hm: string; durationMs: number }>();
    if (parentIds.size) {
      const parents = await this.taskRepo.find({
        where: { userId, id: In([...parentIds]) },
      });
      for (const parent of parents) {
        if (!parent.scheduledStartTime) continue;
        const hm = normalizeClockHm(
          localHm(new Date(parent.scheduledStartTime).toISOString(), timeZone),
        );
        const durationMs =
          parent.scheduledEndTime && parent.scheduledStartTime
            ? Math.max(
                60_000,
                new Date(parent.scheduledEndTime).getTime() -
                  new Date(parent.scheduledStartTime).getTime(),
              )
            : Math.max(1, parent.estimatedTimeInMinutes || 30) * 60_000;
        homeByTaskId.set(parent.id, { hm, durationMs });
      }
    }
    if (groupIds.size) {
      const groupSeries = await this.taskRepo.find({
        where: {
          userId,
          seriesGroupId: In([...groupIds]),
          isRecurring: true,
          status: In([TaskStatus.TODO, TaskStatus.IN_PROGRESS]),
        },
      });
      const primaryByGroup = new Map<string, Task>();
      for (const series of groupSeries) {
        if (!series.seriesGroupId || !series.scheduledStartTime) continue;
        const prev = primaryByGroup.get(series.seriesGroupId);
        if (!prev) {
          primaryByGroup.set(series.seriesGroupId, series);
          continue;
        }
        // Prefer the series that is not a clock-split child of another.
        if (!series.parentSeriesId && prev.parentSeriesId) {
          primaryByGroup.set(series.seriesGroupId, series);
        }
      }
      for (const [groupId, series] of primaryByGroup) {
        if (!series.scheduledStartTime) continue;
        const hm = normalizeClockHm(
          localHm(new Date(series.scheduledStartTime).toISOString(), timeZone),
        );
        const durationMs =
          series.scheduledEndTime && series.scheduledStartTime
            ? Math.max(
                60_000,
                new Date(series.scheduledEndTime).getTime() -
                  new Date(series.scheduledStartTime).getTime(),
              )
            : Math.max(1, series.estimatedTimeInMinutes || 30) * 60_000;
        // Index by group for members that only have seriesGroupId.
        homeByTaskId.set(`group:${groupId}`, { hm, durationMs });
        if (!homeByTaskId.has(series.id)) {
          homeByTaskId.set(series.id, { hm, durationMs });
        }
      }
    }

    for (const seat of seats) {
      const owner = ownerById.get(seat.taskId);
      if (!owner || owner.isRecurring) continue;
      const home =
        (owner.parentSeriesId
          ? homeByTaskId.get(owner.parentSeriesId)
          : null) ??
        (owner.seriesGroupId
          ? homeByTaskId.get(`group:${owner.seriesGroupId}`)
          : null);
      if (!home) continue;
      const ymd = localYmd(new Date(seat.start).toISOString(), timeZone);
      const homeStart = new Date(
        localDateTimeIso(ymd, home.hm, timeZone),
      ).getTime();
      const durationMs = Math.max(60_000, seat.end - seat.start, home.durationMs);
      // Only attach when home differs from the current seat (actually shifted).
      if (Math.abs(homeStart - seat.start) < 1000) continue;
      seat.homeStart = homeStart;
      seat.homeEnd = homeStart + durationMs;
    }
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
      // One-offs mirror the slot. A series master keeps its clock: one shifted
      // day must not move every later day (displaced series days detach).
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
      eventType: series.eventType,
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
      originalOccurrenceYmd: move.occurrenceYmd,
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

  /**
   * A preferred commit that missed the drop is reported to the user as
   * "That time is already taken." Log the real plan reason before that
   * collapse: phase window, deadline span, or an actual overlap.
   */
  private logPreferredMiss(input: {
    task: Task;
    opts?: PlaceOptions;
    timeZone: string;
    durationMinutes: number;
    windowExpired: boolean;
    interval: MsInterval | null;
    span: { start: number; end: number } | null;
    claimWindows: MsInterval[];
    seats: PlacementSeat[];
    plan: PlacementPlan;
  }): void {
    const wanted = input.opts?.preferredStart?.getTime();
    if (
      input.opts?.commit !== 'preferred' ||
      wanted == null ||
      !Number.isFinite(wanted)
    ) {
      return;
    }
    if (
      input.plan.outcome === 'seated' &&
      Math.abs(input.plan.start - wanted) < 1000
    ) {
      return;
    }
    const { task, timeZone, durationMinutes, span, claimWindows, seats, plan } =
      input;
    const hm = (ms: number) => {
      if (!Number.isFinite(ms)) return 'open';
      const iso = new Date(ms).toISOString();
      return `${localYmd(iso, timeZone)} ${normalizeClockHm(localHm(iso, timeZone))}`;
    };
    const range = (start: number, end: number) => `${hm(start)}–${hm(end)}`;
    const dropEnd = wanted + durationMinutes * 60_000;
    const fits =
      !!input.interval &&
      claimWindows.some(
        (window) =>
          input.interval!.start >= window.start &&
          input.interval!.end <= window.end,
      );
    const overlaps = seats
      .filter(
        (seat) =>
          seat.taskId !== task.id && seat.start < dropEnd && wanted < seat.end,
      )
      .map((seat) => `${seat.role}:${seat.taskName}@${range(seat.start, seat.end)}`)
      .join(' | ');
    const windows = claimWindows.map((window) => range(window.start, window.end)).join(' | ');
    const phases = linkedPhases(task)
      .map(
        (phase) =>
          `${phase.name ?? phase.id ?? '?'} ${phase.startTime}-${phase.endTime}`,
      )
      .join(', ');
    this.logger.warn(
      `[preferred-miss] task=${task.id} "${task.name}" type=${task.eventType} ` +
        `state=${task.scheduleState} drop=${range(wanted, dropEnd)} ` +
        `utc=${new Date(wanted).toISOString()} duration=${durationMinutes}m ` +
        `earliest=${task.earliestStartTime ? new Date(task.earliestStartTime).toISOString() : 'none'} ` +
        `deadline=${task.deadline ? new Date(task.deadline).toISOString() : 'none'} ` +
        `span=${span ? range(span.start, span.end) : 'none'} ` +
        `windowExpired=${input.windowExpired} phases=[${phases || 'none'}] ` +
        `windows=[${windows || 'none'}] ` +
        `interval=${input.interval ? range(input.interval.start, input.interval.end) : 'none'} ` +
        `fitsWindow=${fits} overlaps=[${overlaps || 'none'}] ` +
        `plan=${JSON.stringify(summarizePlan(plan, timeZone))} ` +
        `persisted=${
          input.opts?.drag &&
          (plan.outcome === 'problematic' || plan.outcome === 'unscheduled')
            ? 'yes'
            : 'no'
        }`,
    );
  }

  /** Point the resolved layer's open slot at the task clock without clearing Resolved. */
  private async mirrorResolvedSeat(task: Task): Promise<void> {
    if (!task.scheduledStartTime || !task.scheduledEndTime) return;
    const start = new Date(task.scheduledStartTime);
    const end = new Date(task.scheduledEndTime);
    const now = Date.now();
    const rows = await this.scheduledRepo.find({ where: { taskId: task.id } });
    const open = rows.filter(
      (row) => new Date(row.scheduledEndTime).getTime() > now,
    );
    const matches = (row: ScheduledTask) =>
      Math.abs(new Date(row.scheduledStartTime).getTime() - start.getTime()) <
        1000 &&
      Math.abs(new Date(row.scheduledEndTime).getTime() - end.getTime()) < 1000;
    if (open.length === 1 && matches(open[0])) return;
    const previous =
      open.length === 1
        ? `${new Date(open[0].scheduledStartTime).toISOString()}–${new Date(open[0].scheduledEndTime).toISOString()}`
        : `${open.length} open slots`;
    this.logger.log(
      `Resolved "${task.name}" calendar slot ${previous} -> ${start.toISOString()}–${end.toISOString()}`,
    );
    if (open.length === 1) {
      open[0].scheduledStartTime = start;
      open[0].scheduledEndTime = end;
      await this.scheduledRepo.save(open[0]);
      return;
    }
    if (open.length) await this.scheduledRepo.remove(open);
    await this.scheduledRepo.save(
      this.scheduledRepo.create({
        taskId: task.id,
        scheduledStartTime: start,
        scheduledEndTime: end,
        isAutoGenerated: true,
      }),
    );
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
    // A criteria delete is invisible to the outbox subscriber.
    await noteGoogleSync(slots.manager, taskId);
  }

  /** Timed events on every visible connected calendar. All-day events are not anchors. */
  private async externalAnchors(
    userId: string,
    rangeStart: Date,
    rangeEnd: Date,
    slots: ScheduledTask[],
  ): Promise<PlacementSeat[]> {
    const exclude = new Set<string>();
    for (const slot of slots) {
      if (slot.googleEventId) exclude.add(slot.googleEventId);
      if (slot.task?.googleEventId) exclude.add(slot.task.googleEventId);
    }
    try {
      const events = await this.externalBusy.listVisibleEvents(
        userId,
        rangeStart.toISOString(),
        rangeEnd.toISOString(),
      );
      const busy = providerEventsToBusyIntervals(events, {
        excludeIds: exclude,
        timeZone: 'UTC',
        includeAllDay: false,
      });
      return busy.map((interval, index) => ({
        id: `external:${index}`,
        taskId: `external:${index}`,
        taskName: interval.label || 'Calendar',
        role: 'anchor' as const,
        start: interval.start,
        end: interval.end,
        windows: [],
        notBefore: rangeStart.getTime(),
        buffered: true,
      }));
    } catch {
      return [];
    }
  }
}

/**
 * One-off flexible search bounds inside the wake/sleep day.
 * Start is From, or the preferred clock when From is empty.
 * End is Until, or sleep on the start's civil day when the task named a start.
 * No start and no end leaves the horizon untouched.
 */
function flexibleSearchSpan(
  task: Task,
  notBefore: number,
  preferredStart: Date | null,
  timeZone: string,
  wake: string,
  sleep: string,
): { start: number; end: number } | null {
  if (task.isRecurring || task.eventType === TaskEventType.FIXED) return null;
  const preferred =
    preferredStart ??
    (task.scheduledStartTime ? new Date(task.scheduledStartTime) : null);
  const namedStart =
    !task.earliestStartTime && preferred && Number.isFinite(preferred.getTime())
      ? preferred.getTime()
      : null;
  const start = namedStart != null ? Math.max(notBefore, namedStart) : notBefore;
  let end: number | null = null;
  if (task.deadline) {
    const until = new Date(task.deadline).getTime();
    if (Number.isFinite(until)) end = until;
  }
  if (end == null && (task.earliestStartTime || namedStart != null)) {
    const anchor = task.earliestStartTime
      ? new Date(task.earliestStartTime)
      : new Date(namedStart!);
    if (Number.isFinite(anchor.getTime())) {
      end = dayWakeSleepMs(
        localYmd(anchor.toISOString(), timeZone),
        wake,
        sleep,
        timeZone,
      ).end;
    }
  }
  if (end == null && namedStart == null && !task.earliestStartTime) return null;
  return { start, end: end ?? Number.POSITIVE_INFINITY };
}

function clipWindowsToSpan(
  windows: MsInterval[],
  start: number,
  end: number,
): MsInterval[] {
  return windows
    .map((window) => ({
      start: Math.max(window.start, start),
      end: Math.min(window.end, end),
    }))
    .filter((window) => window.end > window.start && window.end > start);
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

/** Park reasons the user chose or must answer; a free hole does not seat them. */
const ASKED_PARK_REASONS = new Set(['conflict', 'preferred_on_fixed']);

/**
 * How a freed hole may seat one Problematic task, or null to leave it parked.
 * A parked day stays that day, nearest its old clock. Series masters and
 * conflict parks wait for the user.
 */
export function autoSeatOptions(
  task: Pick<
    Task,
    | 'isRecurring'
    | 'eventType'
    | 'problematicReason'
    | 'problematicDay'
    | 'problematicOriginalStart'
  >,
  todayYmd: string,
): PlaceOptions | null {
  if (task.isRecurring) return null;
  if (task.problematicReason && ASKED_PARK_REASONS.has(task.problematicReason)) {
    return null;
  }
  const day =
    typeof task.problematicDay === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(task.problematicDay)
      ? task.problematicDay
      : null;
  const original = task.problematicOriginalStart
    ? new Date(task.problematicOriginalStart)
    : null;
  if (task.eventType === TaskEventType.FIXED) {
    // A fixed copy only takes its own clock back, never another hole.
    if (!day || day < todayYmd || !original || !Number.isFinite(original.getTime())) {
      return null;
    }
    return { preferredStart: original, commit: 'preferred', windowYmd: day };
  }
  if (!day) return { searchHole: true, rawHole: true };
  if (day < todayYmd) return null;
  return {
    searchHole: true,
    rawHole: true,
    windowYmd: day,
    preferredStart:
      original && Number.isFinite(original.getTime()) ? original : null,
  };
}

function shouldWritePlan(plan: PlacementPlan, opts?: PlaceOptions): boolean {
  if (plan.outcome === 'conflict') return false;
  if (opts?.commit !== 'preferred') return true;
  if (
    opts.drag &&
    (plan.outcome === 'problematic' || plan.outcome === 'unscheduled')
  ) {
    return true;
  }
  if (plan.outcome !== 'seated' || !opts.preferredStart) return false;
  return Math.abs(plan.start - opts.preferredStart.getTime()) < 1000;
}

/**
 * A drag that landed outside From/Until keeps the same local clocks and
 * moves them onto the drop day. Clocks that still miss the interval expand
 * to cover it, so the next placement does not pull the slot back.
 */
export function followWindowToDrop(
  task: Task,
  start: number,
  end: number,
  timeZone: string,
): void {
  if (task.isRecurring || task.eventType === TaskEventType.FIXED) return;
  const earliestMs = task.earliestStartTime
    ? new Date(task.earliestStartTime).getTime()
    : null;
  const deadlineMs = task.deadline ? new Date(task.deadline).getTime() : null;
  if (earliestMs == null && deadlineMs == null) return;
  const coversStart = earliestMs == null || start >= earliestMs;
  const coversEnd = deadlineMs == null || end <= deadlineMs;
  if (coversStart && coversEnd) return;

  const dropYmd = localYmd(new Date(start).toISOString(), timeZone);
  const anchorMs = earliestMs ?? deadlineMs!;
  const shift = ymdDayOffset(
    localYmd(new Date(anchorMs).toISOString(), timeZone),
    dropYmd,
  );
  const shiftInstant = (ms: number): Date => {
    const ymd = addDaysToYmd(localYmd(new Date(ms).toISOString(), timeZone), shift);
    const hm = normalizeClockHm(localHm(new Date(ms).toISOString(), timeZone));
    return new Date(localDateTimeIso(ymd, hm, timeZone));
  };
  if (earliestMs != null) task.earliestStartTime = shiftInstant(earliestMs);
  if (deadlineMs != null) task.deadline = shiftInstant(deadlineMs);
  if (task.earliestStartTime && start < new Date(task.earliestStartTime).getTime()) {
    task.earliestStartTime = new Date(start);
  }
  if (task.deadline && end > new Date(task.deadline).getTime()) {
    task.deadline = new Date(end);
  }
}

function ymdDayOffset(fromYmd: string, toYmd: string): number {
  const [fromYear, fromMonth, fromDay] = fromYmd.split('-').map(Number);
  const [toYear, toMonth, toDay] = toYmd.split('-').map(Number);
  const from = Date.UTC(fromYear, fromMonth - 1, fromDay);
  const to = Date.UTC(toYear, toMonth - 1, toDay);
  return Math.round((to - from) / 86_400_000);
}

/** Keep only phase windows that overlap the given civil day. */
function windowsOnCivilDay(
  windows: MsInterval[],
  ymd: string,
  timeZone: string,
): MsInterval[] {
  const { start: dayStart, end: dayEnd } = civilDayBounds(ymd, timeZone);
  const out: MsInterval[] = [];
  for (const window of windows) {
    const start = Math.max(window.start, dayStart);
    const end = Math.min(window.end, dayEnd);
    if (end > start) out.push({ start, end });
  }
  return out;
}

function civilDayBounds(ymd: string, timeZone: string): MsInterval {
  const start = new Date(startOfLocalDayIso(ymd, timeZone)).getTime();
  return { start, end: start + 24 * 60 * 60 * 1000 };
}

function overlapsMs(a: MsInterval, b: MsInterval): boolean {
  return a.start < b.end && b.start < a.end;
}

/** A fixed task's length is its slot, not the estimate field. */
function fixedSlotMinutes(task: Task): number | null {
  if (task.eventType !== TaskEventType.FIXED) return null;
  if (!task.scheduledStartTime || !task.scheduledEndTime) return null;
  const minutes = Math.round(
    (new Date(task.scheduledEndTime).getTime() - new Date(task.scheduledStartTime).getTime()) /
      60_000,
  );
  return minutes > 0 ? minutes : null;
}

/** First civil day a series may use: today, or its From day when that is later. */
/** Series start day (DTSTART): the From day, else the master clock day. */
export function seriesAnchorYmd(
  task: Pick<Task, 'earliestStartTime' | 'scheduledStartTime'>,
  timeZone: string,
  now = new Date(),
): string {
  const source = task.earliestStartTime ?? task.scheduledStartTime ?? now;
  return localYmd(new Date(source).toISOString(), timeZone);
}

export function seriesStartYmd(
  task: Pick<Task, 'earliestStartTime'>,
  now: Date,
  timeZone: string,
): string {
  const today = localYmd(now.toISOString(), timeZone);
  if (!task.earliestStartTime) return today;
  const from = localYmd(new Date(task.earliestStartTime).toISOString(), timeZone);
  return from > today ? from : today;
}

function claimInterval(
  task: Task,
  durationMinutes: number,
  preferredStart?: Date | null,
): MsInterval | null {
  const durationMs = durationMinutes * 60_000;
  if (task.eventType === TaskEventType.FIXED) {
    if (!task.scheduledStartTime || !task.scheduledEndTime) {
      // A parked fixed copy has no times: its clock is the chosen / original start.
      if (!preferredStart || !Number.isFinite(preferredStart.getTime())) return null;
      return { start: preferredStart.getTime(), end: preferredStart.getTime() + durationMs };
    }
    const start = new Date(task.scheduledStartTime).getTime();
    const end = new Date(task.scheduledEndTime).getTime();
    // A fixed series day is the same clock on another civil day.
    if (task.isRecurring && preferredStart && Number.isFinite(preferredStart.getTime())) {
      const dayStart = preferredStart.getTime();
      return { start: dayStart, end: dayStart + (end - start) };
    }
    return { start, end };
  }
  const start = preferredStart
    ? preferredStart.getTime()
    : task.scheduledStartTime
      ? new Date(task.scheduledStartTime).getTime()
      : null;
  if (start == null || !Number.isFinite(start)) return null;
  return { start, end: start + durationMs };
}

/** True when a detached block is still the series length, so it can rejoin. */
export function durationsMatch(
  start: Date | string,
  end: Date | string,
  seriesMinutes: number,
): boolean {
  const minutes = Math.round(
    (new Date(end).getTime() - new Date(start).getTime()) / 60_000,
  );
  if (!Number.isFinite(minutes) || minutes < 1) return false;
  return Math.abs(minutes - Math.max(1, Math.round(seriesMinutes))) < 1;
}

export function seriesBlockMinutes(series: {
  scheduledStartTime?: Date | string | null;
  scheduledEndTime?: Date | string | null;
  estimatedTimeInMinutes?: number | null;
}): number {
  if (series.scheduledStartTime && series.scheduledEndTime) {
    const minutes = Math.round(
      (new Date(series.scheduledEndTime).getTime() -
        new Date(series.scheduledStartTime).getTime()) /
        60_000,
    );
    if (minutes >= 1) return minutes;
  }
  return Math.max(1, series.estimatedTimeInMinutes || 30);
}

function isWindowExpired(task: Task, nowMs: number): boolean {
  if (task.eventType === TaskEventType.FIXED || task.isRecurring) return false;
  if (!task.deadline) return false;
  return new Date(task.deadline).getTime() <= nowMs;
}
