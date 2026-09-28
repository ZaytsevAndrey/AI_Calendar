import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { resolveIanaTimeZone } from '../../common/iana-time-zone';
import { habitBlockIntervals } from '../habits/habit-blocks.util';
import { Habit } from '../habits/entities/habit.entity';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import { PhasesService } from '../phases/phases.service';
import { TaskEventType } from '../scheduling/event-type.enum';
import { Task, TaskStatus } from '../tasks/entities/task.entity';
import { UserSettingsService } from '../user-settings/user-settings.service';
import {
  addDaysToYmd,
  normalizeClockHm,
  startOfLocalDayIso,
} from '../voice/voice-local-date.util';
import { ScheduledTask } from './schedule.entity';
import {
  buildFreeSlotsPlan,
  FreeSlotsPhaseLike,
  MsInterval,
} from './free-slots.util';

export type FreeSlotIntervalDto = {
  start: string;
  end: string;
  label?: string;
};

export type FreeSlotsResponse = {
  ymd: string;
  timeZone: string;
  durationMinutes: number;
  dayStart: string;
  dayEnd: string;
  phase: { id: string; name: string; color: string } | null;
  busy: FreeSlotIntervalDto[];
  free: FreeSlotIntervalDto[];
  candidates: string[];
};

@Injectable()
export class FreeSlotsService {
  constructor(
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

  async forTaskDay(
    userId: string,
    taskId: string,
    ymd: string,
    phaseId?: string | null,
  ): Promise<FreeSlotsResponse> {
    if (!taskId?.trim()) {
      throw new BadRequestException('taskId is required');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
      throw new BadRequestException('ymd must be YYYY-MM-DD');
    }

    const task = await this.taskRepo.findOne({
      where: { id: taskId, userId },
      relations: ['phase', 'phases'],
    });
    if (!task) throw new NotFoundException('Task not found');

    const settings = await this.userSettingsService.getSettings(userId);
    const timeZone = resolveIanaTimeZone(settings.timeZone);
    const allPhases = await this.phasesService.findAllForScheduling(userId);
    const taskPhases = this.resolvePhases(task, allPhases, phaseId);
    const durationMinutes = Math.max(1, task.estimatedTimeInMinutes || 30);

    const dayStart = new Date(startOfLocalDayIso(ymd, timeZone));
    const dayEnd = new Date(startOfLocalDayIso(addDaysToYmd(ymd, 1), timeZone));

    const busy = await this.collectBusy(
      userId,
      task,
      dayStart,
      dayEnd,
      ymd,
      timeZone,
    );

    let plan = buildFreeSlotsPlan({
      ymd,
      wake: normalizeClockHm(settings.wakeTime),
      sleep: normalizeClockHm(settings.sleepTime),
      timeZone,
      phases: taskPhases,
      busy,
      durationMinutes,
      weekendOk: settings.weekendWorkEnabled !== false,
    });

    // If Google/external busy wiped the day, still offer local free gaps
    // (slots + habits + fixed) so Move remains usable.
    if (plan.candidates.length === 0) {
      const localBusy = await this.collectBusy(
        userId,
        task,
        dayStart,
        dayEnd,
        ymd,
        timeZone,
        { includeGoogle: false },
      );
      plan = buildFreeSlotsPlan({
        ymd,
        wake: normalizeClockHm(settings.wakeTime),
        sleep: normalizeClockHm(settings.sleepTime),
        timeZone,
        phases: taskPhases,
        busy: localBusy,
        durationMinutes,
        weekendOk: settings.weekendWorkEnabled !== false,
      });
    }

    const primaryPhase = plan.usedWakeSleepFallback
      ? null
      : (taskPhases[0] ?? null);

    return {
      ymd,
      timeZone,
      durationMinutes,
      dayStart: new Date(plan.day.start).toISOString(),
      dayEnd: new Date(plan.day.end).toISOString(),
      phase: primaryPhase?.id
        ? {
            id: primaryPhase.id,
            name: primaryPhase.name ?? 'Phase',
            color: primaryPhase.color ?? '#808080',
          }
        : null,
      busy: plan.busyInDay.map((iv) => ({
        start: new Date(iv.start).toISOString(),
        end: new Date(iv.end).toISOString(),
      })),
      free: plan.free.map((iv) => ({
        start: new Date(iv.start).toISOString(),
        end: new Date(iv.end).toISOString(),
      })),
      candidates: plan.candidates.map((ms) => new Date(ms).toISOString()),
    };
  }

  private resolvePhases(
    task: Task,
    allPhases: FreeSlotsPhaseLike[],
    phaseId?: string | null,
  ): FreeSlotsPhaseLike[] {
    if (phaseId?.trim()) {
      const chosen = allPhases.find((p) => p.id === phaseId);
      if (!chosen || chosen.type === 'sleep_time') {
        throw new BadRequestException('phaseId is not a schedulable phase');
      }
      return [chosen];
    }
    // No phaseId → full day across every schedulable phase. The Move picker
    // scrolls all phase bands; tying free/candidates to the task's linked
    // phase alone left Place disabled almost everywhere.
    const schedulable = allPhases.filter((p) => p.type !== 'sleep_time');
    if (schedulable.length) return schedulable;
    return this.resolveTaskPhases(task, allPhases);
  }

  private resolveTaskPhases(
    task: Task,
    allPhases: FreeSlotsPhaseLike[],
  ): FreeSlotsPhaseLike[] {
    const linked = [
      ...(task.phases ?? []),
      ...(task.phase ? [task.phase] : []),
    ].filter(Boolean);
    if (linked.length) {
      const seen = new Set<string>();
      const out: FreeSlotsPhaseLike[] = [];
      for (const p of linked) {
        if (!p?.id || seen.has(p.id)) continue;
        seen.add(p.id);
        out.push(p);
      }
      return out;
    }
    // No phase → any non-sleep phase (same idea as engine eligible window).
    return allPhases.filter((p) => p.type !== 'sleep_time');
  }

  private async collectBusy(
    userId: string,
    task: Task,
    dayStart: Date,
    dayEnd: Date,
    ymd: string,
    timeZone: string,
    opts?: { includeGoogle?: boolean },
  ): Promise<MsInterval[]> {
    const busy: MsInterval[] = [];
    const ourGoogleIds = new Set<string>();
    if (task.googleEventId) ourGoogleIds.add(task.googleEventId);

    const habits = await this.habitRepo.find({
      where: { userId },
      select: ['blockStartTime', 'blockMinutes', 'googleEventId'],
    });
    for (const h of habits) {
      if (h.googleEventId) ourGoogleIds.add(h.googleEventId);
    }
    busy.push(
      ...habitBlockIntervals(habits, ymd, addDaysToYmd(ymd, 1), timeZone),
    );

    const slots = await this.scheduledRepo
      .createQueryBuilder('st')
      .innerJoinAndSelect('st.task', 't')
      .where('t.userId = :userId', { userId })
      .andWhere('st.scheduledEndTime > :dayStart', { dayStart })
      .andWhere('st.scheduledStartTime < :dayEnd', { dayEnd })
      .getMany();
    for (const slot of slots) {
      if (slot.taskId === task.id) continue;
      if (slot.googleEventId) ourGoogleIds.add(slot.googleEventId);
      busy.push({
        start: slot.scheduledStartTime.getTime(),
        end: slot.scheduledEndTime.getTime(),
      });
    }

    const fixedPeers = await this.taskRepo.find({
      where: {
        userId,
        eventType: TaskEventType.FIXED,
        status: In([TaskStatus.TODO, TaskStatus.IN_PROGRESS]),
      },
    });
    for (const peer of fixedPeers) {
      if (peer.id === task.id) continue;
      if (peer.googleEventId) ourGoogleIds.add(peer.googleEventId);
      if (!peer.scheduledStartTime || !peer.scheduledEndTime) continue;
      const start = new Date(peer.scheduledStartTime).getTime();
      const end = new Date(peer.scheduledEndTime).getTime();
      if (end <= dayStart.getTime() || start >= dayEnd.getTime()) continue;
      busy.push({ start, end });
    }

    if (opts?.includeGoogle === false) {
      return busy;
    }

    try {
      const settings = await this.userSettingsService.getSettings(userId);
      if (settings.googleCalendarLinked) {
        busy.push(
          ...(await this.collectGoogleBusy(
            userId,
            dayStart,
            dayEnd,
            ourGoogleIds,
            timeZone,
          )),
        );
      }
    } catch {
      /* timeline still useful without Google */
    }

    return busy;
  }

  private async collectGoogleBusy(
    userId: string,
    rangeStart: Date,
    rangeEnd: Date,
    excludeIds: Set<string>,
    timeZone: string,
  ): Promise<MsInterval[]> {
    const busy: MsInterval[] = [];
    const calendarIds = ['primary'];
    const appCalId =
      await this.googleCalendarService.getStoredAppCalendarId(userId);
    if (appCalId) calendarIds.push(appCalId);

    for (const calId of calendarIds) {
      let pageToken: string | undefined;
      do {
        const page = await this.googleCalendarService.getEvents(
          userId,
          rangeStart.toISOString(),
          rangeEnd.toISOString(),
          2500,
          pageToken,
          calId,
        );
        for (const ev of page.events) {
          if (ev.status === 'cancelled') continue;
          if (ev.id && excludeIds.has(ev.id)) continue;
          if (ev.recurringEventId && excludeIds.has(ev.recurringEventId)) {
            continue;
          }
          const iv = this.googleEventToInterval(ev, timeZone);
          if (iv) busy.push(iv);
        }
        pageToken = page.nextPageToken ?? undefined;
      } while (pageToken);
    }
    return busy;
  }

  private googleEventToInterval(
    ev: {
      transparency?: string | null;
      start?: { dateTime?: string | null; date?: string | null };
      end?: { dateTime?: string | null; date?: string | null };
    },
    timeZone: string,
  ): MsInterval | null {
    // Free / "show as available" and all-day markers should not wipe timed Move slots.
    if (ev.transparency === 'transparent') return null;
    if (ev.start?.dateTime && ev.end?.dateTime) {
      const start = new Date(ev.start.dateTime).getTime();
      const end = new Date(ev.end.dateTime).getTime();
      if (end > start) return { start, end };
      return null;
    }
    // All-day Google events: ignore for this picker (timed placement only).
    void timeZone;
    return null;
  }
}
