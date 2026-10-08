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
import { PhasesService } from '../phases/phases.service';
import { TaskEventType } from '../scheduling/event-type.enum';
import {
  clearParkMetadata,
  ScheduleState,
  Task,
  TaskStatus,
} from '../tasks/entities/task.entity';
import { addSkippedOccurrenceYmd } from '../tasks/skipped-occurrence.util';
import { UserSettingsService } from '../user-settings/user-settings.service';
import {
  addDaysToYmd,
  localYmd,
  normalizeClockHm,
} from '../voice/voice-local-date.util';
import {
  eligibleWindowsForDay,
  type FreeSlotsPhaseLike,
  type MsInterval,
} from './free-slots.util';
import { normalizeFixedEventBufferMinutes, planningHorizonRange } from './intelligent-scheduling.engine';
import {
  planPlacement,
  type PlacementMove,
  type PlacementPlan,
  type PlacementSeat,
} from './placement-step.util';
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
  ) {}

  place(
    userId: string,
    taskId: string,
    opts?: { preferredStart?: Date | null },
  ): Promise<PlacementPlan> {
    return withUserLock(userId, () => this.placeUnlocked(userId, taskId, opts));
  }

  private async placeUnlocked(
    userId: string,
    taskId: string,
    opts?: { preferredStart?: Date | null },
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

    const durationMinutes = Math.max(1, task.estimatedTimeInMinutes || 30);
    const claimWindows = windowsFor(linkedPhases(task).length ? linkedPhases(task) : phases);
    const windowExpired = isWindowExpired(task, nowMs);
    const interval = claimInterval(task, durationMinutes, opts?.preferredStart);

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

    if (plan.outcome === 'conflict') return plan;
    await this.persist(task, plan, now, timeZone);
    return plan;
  }

  private async persist(
    task: Task,
    plan: PlacementPlan,
    now: Date,
    timeZone: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const tasks = manager.getRepository(Task);
      const slots = manager.getRepository(ScheduledTask);
      if (plan.outcome === 'unscheduled') {
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
