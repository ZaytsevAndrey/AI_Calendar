import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import { Habit } from '../habits/entities/habit.entity';
import { Task } from '../tasks/entities/task.entity';
import { TasksService } from '../tasks/tasks.service';
import { MoveDisplayedEventDto } from './dto/move-displayed-event.dto';
import { planDisplayedEventMove } from './move-displayed-event.util';
import { PlacementStepService } from './placement-step.service';
import type { PlacementPlan } from './placement-step.util';
import { ScheduledTask } from './schedule.entity';

export type MoveDisplayedEventResult = {
  kind: 'fixed' | 'slot' | 'google';
  jobId: string | null;
};

@Injectable()
export class DisplayedEventMoveService {
  private readonly logger = new Logger(DisplayedEventMoveService.name);

  constructor(
    @InjectRepository(ScheduledTask)
    private readonly scheduledRepo: Repository<ScheduledTask>,
    @InjectRepository(Habit)
    private readonly habitRepo: Repository<Habit>,
    private readonly tasksService: TasksService,
    private readonly googleCalendarService: GoogleCalendarService,
    private readonly placementStep: PlacementStepService,
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
}

function sitsAt(value: Date | string | null | undefined, start: Date): boolean {
  if (!value) return false;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) && Math.abs(ms - start.getTime()) < 1000;
}

function seatedAt(plan: PlacementPlan, start: Date): boolean {
  return plan.outcome === 'seated' && Math.abs(plan.start - start.getTime()) < 1000;
}
