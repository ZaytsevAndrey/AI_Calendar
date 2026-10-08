import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import { Habit } from '../habits/entities/habit.entity';
import { ScheduleState, Task, TaskStatus } from '../tasks/entities/task.entity';
import { TasksService } from '../tasks/tasks.service';
import { UserSettingsService } from '../user-settings/user-settings.service';
import { resolveIanaTimeZone } from '../../common/iana-time-zone';
import { localYmd, startOfLocalDayIso } from '../voice/voice-local-date.util';
import { MoveDisplayedEventDto } from './dto/move-displayed-event.dto';
import { planDisplayedEventMove } from './move-displayed-event.util';
import { PlacementStepService } from './placement-step.service';
import type { PlacementPlan } from './placement-step.util';
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
    private readonly placementStep: PlacementStepService,
    private readonly userSettingsService: UserSettingsService,
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

    if (plan.kind === 'fixed') {
      const saved = await this.tasksService.update(plan.taskId, userId, {
        scheduledStartTime: start.toISOString(),
        scheduledEndTime: end.toISOString(),
        estimatedTimeInMinutes: minutes,
      });
      if (!sitsAt(saved.scheduledStartTime, start)) {
        throw new BadRequestException('That time is already taken.');
      }
      return { kind: 'fixed', jobId: null };
    }

    const owner = tasks.find((task) => task.id === plan.taskId);
    if (owner?.isRecurring) {
      if (!dto.seriesScope) {
        return { kind: 'series-choice', jobId: null, taskName: owner.name };
      }
      if (dto.seriesScope === 'occurrence') {
        await this.moveSeriesDay(userId, owner, dto, minutes);
      } else {
        await this.moveSeriesTail(userId, owner, dto, start, end, minutes);
      }
      return { kind: 'slot', jobId: null };
    }

    const placed = await this.placementStep.place(userId, plan.taskId, {
      preferredStart: start,
      durationMinutes: minutes,
      commit: 'preferred',
    });
    if (!seatedAt(placed, start)) {
      throw new BadRequestException('That time is already taken.');
    }
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
    }
    await this.placementStep.seatOpenHoles(userId);
    return { kind: 'slot', jobId: null };
  }

  /** Drop one series day and seat an identical one-off at the dropped time. */
  private async moveSeriesDay(
    userId: string,
    series: Task,
    dto: MoveDisplayedEventDto,
    minutes: number,
  ): Promise<void> {
    await this.tasksService.skipOccurrence(series.id, userId, {
      occurrenceStart: dto.originalStart,
      googleEventId: dto.googleEventId,
      googleEventCalendarId: dto.calendarId,
    });
    await this.tasksService.create(userId, {
      name: series.name,
      description: series.description ?? undefined,
      phaseId: series.phaseId ?? undefined,
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
      timeZone: series.scheduleTimeZone ?? undefined,
    });
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
    const created = await this.taskRepo.save(
      this.taskRepo.create({
        userId,
        name: series.name,
        description: series.description,
        phaseId: series.phaseId,
        phases: series.phases,
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
      }),
    );
    await this.placementStep.place(userId, created.id, {
      preferredStart: start,
      durationMinutes: minutes,
      commit: 'preferred',
      expandSeries: true,
    });
    await this.placementStep.seatOpenHoles(userId);
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
