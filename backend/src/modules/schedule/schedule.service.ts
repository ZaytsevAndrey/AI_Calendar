import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, FindOptionsWhere } from 'typeorm';
import { ScheduledTask } from './schedule.entity';
import {
  CreateScheduleDto,
  UpdateScheduleDto,
  ScheduleQueryDto,
} from './dto';
import { TasksService } from '../tasks/tasks.service';
import { UserSettingsService } from '../user-settings/user-settings.service';
import { ScheduleJobService } from './schedule-job.service';
import { planningHorizonRange } from './intelligent-scheduling.engine';

@Injectable()
export class ScheduleService {
  constructor(
    @InjectRepository(ScheduledTask)
    private scheduledTaskRepository: Repository<ScheduledTask>,
    private tasksService: TasksService,
    private userSettingsService: UserSettingsService,
    @Inject(forwardRef(() => ScheduleJobService))
    private scheduleJobService: ScheduleJobService,
  ) {}

  private intervalsOverlap(
    aStart: Date,
    aEnd: Date,
    bStart: Date,
    bEnd: Date,
  ): boolean {
    return aStart < bEnd && bStart < aEnd;
  }

  private async findOverlappingSlots(
    taskId: string,
    start: Date,
    end: Date,
    excludeId?: string,
  ): Promise<ScheduledTask[]> {
    const rows = await this.scheduledTaskRepository.find({
      where: { taskId },
    });
    return rows.filter((st) => {
      if (excludeId && st.id === excludeId) return false;
      return this.intervalsOverlap(
        start,
        end,
        st.scheduledStartTime,
        st.scheduledEndTime,
      );
    });
  }

  async create(
    userId: string,
    createScheduleDto: CreateScheduleDto,
  ): Promise<ScheduledTask> {
    // Ensure the task exists
    const task = await this.tasksService.findOne(
      createScheduleDto.taskId,
      userId,
    );
    if (!task) {
      throw new NotFoundException(
        `Task with ID ${createScheduleDto.taskId} not found`,
      );
    }

    const start = new Date(createScheduleDto.scheduledStartTime);
    const end = new Date(createScheduleDto.scheduledEndTime);
    if (!(end > start)) {
      throw new BadRequestException('scheduledEndTime must be after scheduledStartTime');
    }

    const overlappingTasks = await this.findOverlappingSlots(
      createScheduleDto.taskId,
      start,
      end,
    );

    if (overlappingTasks.length > 0) {
      throw new BadRequestException(
        'This task is already scheduled for this time period',
      );
    }

    const scheduledTask = this.scheduledTaskRepository.create({
      ...createScheduleDto,
      scheduledStartTime: new Date(createScheduleDto.scheduledStartTime),
      scheduledEndTime: new Date(createScheduleDto.scheduledEndTime),
    });

    return this.scheduledTaskRepository.save(scheduledTask);
  }

  async findAll(
    userId: string,
    query: ScheduleQueryDto,
  ): Promise<ScheduledTask[]> {
    const where: FindOptionsWhere<ScheduledTask> = {};

    // Filter by date range (date-only endDate includes that UTC day)
    if (query.startDate && query.endDate) {
      const start = new Date(query.startDate);
      const end = /^\d{4}-\d{2}-\d{2}$/.test(query.endDate)
        ? new Date(`${query.endDate}T23:59:59.999Z`)
        : new Date(query.endDate);
      where.scheduledStartTime = Between(start, end);
    }

    // Load relations
    const relations = ['task', 'task.phase'];

    let scheduledTasks = await this.scheduledTaskRepository.find({
      where,
      relations,
    });

    // Optional filter by phase
    if (query.phaseId) {
      scheduledTasks = scheduledTasks.filter(
        (task) => task.task?.phaseId === query.phaseId,
      );
    }

    // Restrict to this user (task.userId)
    scheduledTasks = scheduledTasks.filter(
      (scheduledTask) => scheduledTask.task?.userId === userId,
    );

    return scheduledTasks;
  }

  async findOne(id: string, userId: string): Promise<ScheduledTask> {
    const scheduledTask = await this.scheduledTaskRepository.findOne({
      where: { id },
      relations: ['task', 'task.phase'],
    });

    if (!scheduledTask || scheduledTask.task?.userId !== userId) {
      throw new NotFoundException(`Scheduled task with ID ${id} not found`);
    }

    return scheduledTask;
  }

  async update(
    id: string,
    userId: string,
    updateScheduleDto: UpdateScheduleDto,
  ): Promise<ScheduledTask> {
    const scheduledTask = await this.findOne(id, userId);

    // Apply updates
    Object.assign(scheduledTask, {
      ...updateScheduleDto,
      scheduledStartTime: updateScheduleDto.scheduledStartTime
        ? new Date(updateScheduleDto.scheduledStartTime)
        : scheduledTask.scheduledStartTime,
      scheduledEndTime: updateScheduleDto.scheduledEndTime
        ? new Date(updateScheduleDto.scheduledEndTime)
        : scheduledTask.scheduledEndTime,
    });

    if (!(scheduledTask.scheduledEndTime > scheduledTask.scheduledStartTime)) {
      throw new BadRequestException('scheduledEndTime must be after scheduledStartTime');
    }

    const overlaps = await this.findOverlappingSlots(
      scheduledTask.taskId,
      scheduledTask.scheduledStartTime,
      scheduledTask.scheduledEndTime,
      scheduledTask.id,
    );
    if (overlaps.length > 0) {
      throw new BadRequestException(
        'This task is already scheduled for this time period',
      );
    }

    return this.scheduledTaskRepository.save(scheduledTask);
  }

  async remove(id: string, userId: string): Promise<void> {
    const scheduledTask = await this.findOne(id, userId);
    await this.scheduledTaskRepository.remove(scheduledTask);
  }

  async clearSchedule(userId: string): Promise<{ deleted: number }> {
    const settings = await this.userSettingsService.getSettings(userId);
    const { end } = planningHorizonRange(settings);
    const now = new Date();

    const remaining = await this.scheduledTaskRepository
      .createQueryBuilder('st')
      .innerJoinAndSelect('st.task', 'task')
      .where('task.userId = :userId', { userId })
      .andWhere('st.isAutoGenerated = :ig', { ig: true })
      .andWhere('st.scheduledEndTime <= :now', { now })
      .getMany();

    const scheduledTasks = await this.scheduledTaskRepository
      .createQueryBuilder('st')
      .innerJoinAndSelect('st.task', 'task')
      .where('task.userId = :userId', { userId })
      .andWhere('st.isAutoGenerated = :ig', { ig: true })
      .andWhere('st.scheduledEndTime > :now', { now })
      .andWhere('st.scheduledStartTime < :end', { end })
      .getMany();

    if (scheduledTasks.length > 0) {
      await this.scheduledTaskRepository.remove(scheduledTasks);
    }

    const keepEventIds = new Set<string>();
    const untilByEventId = new Map<string, Date>();
    for (const row of remaining) {
      if (!row.googleEventId) continue;
      keepEventIds.add(row.googleEventId);
      const prev = untilByEventId.get(row.googleEventId);
      if (!prev || row.scheduledStartTime > prev) {
        untilByEventId.set(row.googleEventId, row.scheduledStartTime);
      }
    }

    const googleDeleted = await this.scheduleJobService.wipeAppCalendarEventsInRange(
      userId,
      now,
      end,
      { now, keepEventIds, untilByEventId },
    );

    await this.scheduleJobService.invalidateGenerateUndo(userId);

    return { deleted: googleDeleted || scheduledTasks.length };
  }
}
