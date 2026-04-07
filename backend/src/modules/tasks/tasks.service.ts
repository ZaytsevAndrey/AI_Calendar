import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Task, TaskStatus } from './entities/task.entity';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { Phase } from '../event-phases/entities/phase.entity';
import { TaskEventType, getEventTypeRules } from '../scheduling/event-type.enum';
import { ScheduleJobService } from '../schedule/schedule-job.service';

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task)
    private tasksRepository: Repository<Task>,
    @InjectRepository(Phase)
    private phasesRepository: Repository<Phase>,
    @Inject(forwardRef(() => ScheduleJobService))
    private readonly scheduleJobService: ScheduleJobService,
  ) {}

  private async loadPhasesForUser(
    userId: string,
    phaseIds: string[],
  ): Promise<Phase[]> {
    if (!phaseIds.length) return [];
    const phases = await this.phasesRepository.findBy({ id: In(phaseIds) });
    if (phases.length !== phaseIds.length) {
      throw new BadRequestException('One or more phase IDs are invalid');
    }
    for (const p of phases) {
      if (p.userId !== userId) {
        throw new BadRequestException('Phases must belong to your account');
      }
    }
    return phases;
  }

  async create(userId: string, createTaskDto: CreateTaskDto): Promise<Task> {
    const eventType = createTaskDto.eventType ?? TaskEventType.ADMIN;
    const rules = getEventTypeRules(eventType);

    if (eventType === TaskEventType.FIXED) {
      if (!createTaskDto.scheduledStartTime || !createTaskDto.scheduledEndTime) {
        throw new BadRequestException(
          'FIXED items require scheduledStartTime and scheduledEndTime',
        );
      }
    }

    const estimatedTimeInMinutes =
      createTaskDto.estimatedTimeInMinutes ?? rules.defaultDurationMinutes;

    const {
      phaseIds,
      scheduledStartTime,
      scheduledEndTime,
      deadline,
      ...rest
    } = createTaskDto;

    const task = this.tasksRepository.create({
      ...rest,
      userId,
      eventType,
      estimatedTimeInMinutes,
      deadline: deadline ? new Date(deadline) : undefined,
      scheduledStartTime: scheduledStartTime
        ? new Date(scheduledStartTime)
        : undefined,
      scheduledEndTime: scheduledEndTime
        ? new Date(scheduledEndTime)
        : undefined,
    });

    if (phaseIds?.length) {
      const phases = await this.loadPhasesForUser(userId, phaseIds);
      task.phases = phases;
      task.phaseId = phaseIds[0];
    } else if (createTaskDto.phaseId) {
      const phases = await this.loadPhasesForUser(userId, [
        createTaskDto.phaseId,
      ]);
      if (phases.length) {
        task.phases = phases;
        task.phaseId = createTaskDto.phaseId;
      }
    }

    const saved = await this.tasksRepository.save(task);

    if (eventType !== TaskEventType.FIXED) {
      await this.scheduleJobService.enqueueReplan(userId);
    }

    return this.findOne(saved.id, userId);
  }

  async findAll(userId: string): Promise<Task[]> {
    return this.tasksRepository.find({
      where: { userId },
      relations: ['phase', 'phases'],
      order: {
        createdAt: 'DESC',
      },
    });
  }

  async findOne(id: string, userId: string): Promise<Task> {
    const task = await this.tasksRepository.findOne({
      where: { id, userId },
      relations: ['phase', 'phases'],
    });

    if (!task) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    return task;
  }

  async update(
    id: string,
    userId: string,
    updateTaskDto: UpdateTaskDto,
  ): Promise<Task> {
    const task = await this.findOne(id, userId);
    const dto = updateTaskDto as UpdateTaskDto & {
      phaseIds?: string[];
      scheduledStartTime?: string;
      scheduledEndTime?: string;
      eventType?: TaskEventType;
    };

    if (dto.phaseIds !== undefined) {
      if (dto.phaseIds.length === 0) {
        task.phases = [];
        task.phaseId = null;
      } else {
        const phases = await this.loadPhasesForUser(userId, dto.phaseIds);
        task.phases = phases;
        task.phaseId = dto.phaseIds[0];
      }
    }

    const {
      phaseIds: _p,
      deadline,
      scheduledStartTime,
      scheduledEndTime,
      ...rest
    } = dto;
    this.tasksRepository.merge(task, rest);

    if (deadline !== undefined) {
      task.deadline = deadline ? new Date(deadline) : null;
    }
    if (scheduledStartTime !== undefined) {
      task.scheduledStartTime = scheduledStartTime
        ? new Date(scheduledStartTime)
        : null;
    }
    if (scheduledEndTime !== undefined) {
      task.scheduledEndTime = scheduledEndTime
        ? new Date(scheduledEndTime)
        : null;
    }

    if (task.eventType === TaskEventType.FIXED) {
      if (!task.scheduledStartTime || !task.scheduledEndTime) {
        throw new BadRequestException(
          'FIXED items require scheduledStartTime and scheduledEndTime',
        );
      }
    }

    const saved = await this.tasksRepository.save(task);

    if (saved.eventType !== TaskEventType.FIXED && saved.status === TaskStatus.TODO) {
      await this.scheduleJobService.enqueueReplan(userId);
    }

    return this.findOne(saved.id, userId);
  }

  async remove(id: string, userId: string): Promise<void> {
    const task = await this.findOne(id, userId);
    await this.tasksRepository.remove(task);
    await this.scheduleJobService.enqueueReplan(userId);
  }

  async findByStatus(userId: string, status: TaskStatus): Promise<Task[]> {
    return this.tasksRepository.find({
      where: { userId, status },
      relations: ['phase', 'phases'],
      order: {
        createdAt: 'DESC',
      },
    });
  }

  async findByPhase(userId: string, phaseId: string): Promise<Task[]> {
    return this.tasksRepository.find({
      where: { userId, phaseId },
      relations: ['phase', 'phases'],
      order: {
        createdAt: 'DESC',
      },
    });
  }

  async updateStatus(
    id: string,
    userId: string,
    status: TaskStatus,
  ): Promise<Task> {
    const task = await this.findOne(id, userId);
    task.status = status;
    const saved = await this.tasksRepository.save(task);
    if (saved.eventType !== TaskEventType.FIXED) {
      await this.scheduleJobService.enqueueReplan(userId);
    }
    return saved;
  }
}
