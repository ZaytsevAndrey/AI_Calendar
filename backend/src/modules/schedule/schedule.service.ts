import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, FindOptionsWhere } from 'typeorm';
import { ScheduledTask } from './schedule.entity';
import { ScheduleQueryDto } from './dto';

/**
 * Read side of placed slots. Slots are written only by the placement engine
 * (`PlacementStepService`, `DisplayedEventMoveService`, `ProblematicPlaceService`);
 * the old raw `POST/PATCH/DELETE /schedule` writes were removed (PE-30).
 */
@Injectable()
export class ScheduleService {
  constructor(
    @InjectRepository(ScheduledTask)
    private scheduledTaskRepository: Repository<ScheduledTask>,
  ) {}

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
}
