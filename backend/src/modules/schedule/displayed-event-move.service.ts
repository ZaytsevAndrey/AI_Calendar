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
import { ScheduleJobService } from './schedule-job.service';
import { ScheduleService } from './schedule.service';
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
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(Habit)
    private readonly habitRepo: Repository<Habit>,
    private readonly tasksService: TasksService,
    private readonly scheduleService: ScheduleService,
    private readonly googleCalendarService: GoogleCalendarService,
    private readonly scheduleJobService: ScheduleJobService,
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

    if (plan.kind === 'fixed') {
      const minutes = Math.max(
        1,
        Math.round((end.getTime() - start.getTime()) / 60_000),
      );
      await this.tasksService.update(plan.taskId, userId, {
        scheduledStartTime: start.toISOString(),
        scheduledEndTime: end.toISOString(),
        estimatedTimeInMinutes: minutes,
      });
      return this.withReplan(userId, 'fixed');
    }

    await this.googleCalendarService.patchEventTimes(
      userId,
      dto.googleEventId,
      start.toISOString(),
      end.toISOString(),
      dto.calendarId,
    );

    if (plan.kind === 'google') {
      // External Google block only — nothing for the engine to reshuffle.
      return { kind: 'google', jobId: null };
    }

    let slotSaved = false;
    try {
      await this.scheduleService.update(plan.slotId, userId, {
        scheduledStartTime: start.toISOString(),
        scheduledEndTime: end.toISOString(),
      });
      slotSaved = true;
      if (plan.updateTaskWindow) {
        await this.taskRepo.update(plan.taskId, {
          scheduledStartTime: start,
          scheduledEndTime: end,
        });
      }
    } catch (err) {
      if (slotSaved) {
        try {
          await this.scheduleService.update(plan.slotId, userId, {
            scheduledStartTime: new Date(dto.originalStart).toISOString(),
            scheduledEndTime: new Date(dto.originalEnd).toISOString(),
          });
        } catch (revertSlotErr) {
          this.logger.error(
            `Could not restore slot ${plan.slotId} after a failed move`,
            revertSlotErr instanceof Error ? revertSlotErr.stack : undefined,
          );
        }
      }
      try {
        await this.googleCalendarService.patchEventTimes(
          userId,
          dto.googleEventId,
          new Date(dto.originalStart).toISOString(),
          new Date(dto.originalEnd).toISOString(),
          dto.calendarId,
        );
      } catch (revertErr) {
        this.logger.error(
          `Could not restore Google event ${dto.googleEventId} after a failed move`,
          revertErr instanceof Error ? revertErr.stack : undefined,
        );
      }
      throw err;
    }

    return this.withReplan(userId, 'slot');
  }

  private async withReplan(
    userId: string,
    kind: 'fixed' | 'slot',
  ): Promise<MoveDisplayedEventResult> {
    const job = await this.scheduleJobService.enqueueReplan(userId);
    return { kind, jobId: job.id };
  }
}
