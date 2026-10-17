import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { resolveIanaTimeZone } from '../../common/iana-time-zone';
import { ExternalCalendarBusyService } from '../calendar-providers/external-calendar-busy.service';
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
import { providerEventsToBusyIntervals } from './external-calendar-busy.util';
import {
  buildFreeSlotsPlan,
  FreeSlotsPhaseLike,
  LabeledBusyInterval,
} from './free-slots.util';

export type FreeSlotIntervalDto = {
  start: string;
  end: string;
  label?: string;
  color?: string;
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
    private readonly userSettingsService: UserSettingsService,
    private readonly phasesService: PhasesService,
    private readonly externalBusy: ExternalCalendarBusyService,
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

    // If external busy wiped the day, still offer local free gaps
    // (slots + fixed) so Move remains usable. Keep the external
    // chips on the timeline so those hours stay highlighted.
    if (plan.candidates.length === 0) {
      const highlighted = plan.busySegments;
      const localBusy = await this.collectBusy(
        userId,
        task,
        dayStart,
        dayEnd,
        ymd,
        timeZone,
        { includeExternal: false },
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
      plan = { ...plan, busySegments: highlighted };
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
      busy: plan.busySegments.map((iv) => ({
        start: new Date(iv.start).toISOString(),
        end: new Date(iv.end).toISOString(),
        ...(iv.label ? { label: iv.label } : {}),
        ...(iv.color ? { color: iv.color } : {}),
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
    opts?: { includeExternal?: boolean },
  ): Promise<LabeledBusyInterval[]> {
    const busy: LabeledBusyInterval[] = [];
    const ourGoogleIds = new Set<string>();
    if (task.googleEventId) ourGoogleIds.add(task.googleEventId);

    const slots = await this.scheduledRepo
      .createQueryBuilder('st')
      .innerJoinAndSelect('st.task', 't')
      .leftJoinAndSelect('t.phase', 'phase')
      .where('t.userId = :userId', { userId })
      .andWhere('st.scheduledEndTime > :dayStart', { dayStart })
      .andWhere('st.scheduledStartTime < :dayEnd', { dayEnd })
      .getMany();
    const seatedTaskIds = new Set<string>();
    for (const slot of slots) {
      if (slot.taskId === task.id) continue;
      seatedTaskIds.add(slot.taskId);
      if (slot.googleEventId) ourGoogleIds.add(slot.googleEventId);
      busy.push({
        start: slot.scheduledStartTime.getTime(),
        end: slot.scheduledEndTime.getTime(),
        label: slot.task?.name || undefined,
        color: slot.task?.phase?.color || undefined,
      });
    }

    const fixedPeers = await this.taskRepo.find({
      where: {
        userId,
        eventType: TaskEventType.FIXED,
        status: In([TaskStatus.TODO, TaskStatus.IN_PROGRESS]),
      },
      relations: ['phase'],
    });
    for (const peer of fixedPeers) {
      if (peer.id === task.id) continue;
      // Already drawn from scheduled_tasks — avoid a second anonymous/labeled chip.
      if (seatedTaskIds.has(peer.id)) continue;
      if (peer.googleEventId) ourGoogleIds.add(peer.googleEventId);
      if (!peer.scheduledStartTime || !peer.scheduledEndTime) continue;
      const start = new Date(peer.scheduledStartTime).getTime();
      const end = new Date(peer.scheduledEndTime).getTime();
      if (end <= dayStart.getTime() || start >= dayEnd.getTime()) continue;
      busy.push({
        start,
        end,
        label: peer.name,
        color: peer.phase?.color || undefined,
      });
    }

    if (opts?.includeExternal === false) {
      return busy;
    }

    try {
      busy.push(
        ...(await this.collectExternalBusy(
          userId,
          dayStart,
          dayEnd,
          ourGoogleIds,
          timeZone,
        )),
      );
    } catch {
      /* timeline still useful without external calendars */
    }

    return busy;
  }

  private async collectExternalBusy(
    userId: string,
    rangeStart: Date,
    rangeEnd: Date,
    excludeIds: Set<string>,
    timeZone: string,
  ): Promise<LabeledBusyInterval[]> {
    const events = await this.externalBusy.listVisibleEvents(
      userId,
      rangeStart.toISOString(),
      rangeEnd.toISOString(),
    );
    return providerEventsToBusyIntervals(events, {
      excludeIds,
      timeZone,
      includeAllDay: false,
    });
  }
}
