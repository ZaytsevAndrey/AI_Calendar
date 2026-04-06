import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, FindOptionsWhere } from 'typeorm';
import { ScheduledTask } from './schedule.entity';
import {
  CreateScheduleDto,
  UpdateScheduleDto,
  ScheduleQueryDto,
  GenerateScheduleDto,
} from './dto';
import { TasksService } from '../tasks/tasks.service';
import { UserSettingsService } from '../user-settings/user-settings.service';
import { Task, TaskStatus } from '../tasks/entities/task.entity';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class ScheduleService {
  constructor(
    @InjectRepository(ScheduledTask)
    private scheduledTaskRepository: Repository<ScheduledTask>,
    private tasksService: TasksService,
    private userSettingsService: UserSettingsService,
  ) {}

  async create(
    userId: string,
    createScheduleDto: CreateScheduleDto,
  ): Promise<ScheduledTask> {
    // Перевірка, чи існує завдання
    const task = await this.tasksService.findOne(
      createScheduleDto.taskId,
      userId,
    );
    if (!task) {
      throw new NotFoundException(
        `Task with ID ${createScheduleDto.taskId} not found`,
      );
    }

    // Перевірка чи не перекривається з іншими запланованими завданнями
    const overlappingTasks = await this.scheduledTaskRepository.find({
      where: [
        {
          taskId: createScheduleDto.taskId,
          scheduledStartTime: Between(
            new Date(createScheduleDto.scheduledStartTime),
            new Date(createScheduleDto.scheduledEndTime),
          ),
        },
        {
          taskId: createScheduleDto.taskId,
          scheduledEndTime: Between(
            new Date(createScheduleDto.scheduledStartTime),
            new Date(createScheduleDto.scheduledEndTime),
          ),
        },
      ],
    });

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

    // Фільтрування за датами
    if (query.startDate && query.endDate) {
      where.scheduledStartTime = Between(
        new Date(query.startDate),
        new Date(query.endDate),
      );
    }

    // Додавання зв'язків
    const relations = ['task', 'task.phase'];

    let scheduledTasks = await this.scheduledTaskRepository.find({
      where,
      relations,
    });

    // Фільтрування за фазою (якщо потрібно)
    if (query.phaseId) {
      scheduledTasks = scheduledTasks.filter(
        (task) => task.task?.phaseId === query.phaseId,
      );
    }

    // Фільтрування по користувачу (за task.userId)
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

    // Оновлення даних
    Object.assign(scheduledTask, {
      ...updateScheduleDto,
      scheduledStartTime: updateScheduleDto.scheduledStartTime
        ? new Date(updateScheduleDto.scheduledStartTime)
        : scheduledTask.scheduledStartTime,
      scheduledEndTime: updateScheduleDto.scheduledEndTime
        ? new Date(updateScheduleDto.scheduledEndTime)
        : scheduledTask.scheduledEndTime,
    });

    return this.scheduledTaskRepository.save(scheduledTask);
  }

  async remove(id: string, userId: string): Promise<void> {
    const scheduledTask = await this.findOne(id, userId);
    await this.scheduledTaskRepository.remove(scheduledTask);
  }

  async clearSchedule(
    userId: string,
    startDate: string,
    endDate: string,
  ): Promise<void> {
    // Отримуємо всі завдання в цьому періоді для цього користувача
    const scheduledTasks = await this.findAll(userId, { startDate, endDate });

    // Видаляємо знайдені завдання
    if (scheduledTasks.length > 0) {
      await this.scheduledTaskRepository.remove(scheduledTasks);
    }
  }

  // Метод для автоматичної генерації розкладу
  async generateSchedule(
    userId: string,
    generateDto: GenerateScheduleDto,
  ): Promise<ScheduledTask[]> {
    // Отримання користувацьких налаштувань
    const userSettings = await this.userSettingsService.getSettings(userId);

    // Отримання невиконаних завдань
    const pendingTasks = await this.tasksService.findByStatus(
      userId,
      TaskStatus.TODO,
    );

    // Сортування завдань за пріоритетом
    const sortedTasks = this.sortTasksByPriority(pendingTasks);

    // Генерування унікального ID для цього запуску
    const generationRun = `auto-gen-${new Date().toISOString().split('T')[0]}`;

    // Створення розкладу
    const schedule = await this.createOptimalSchedule(
      sortedTasks,
      new Date(generateDto.startDate),
      new Date(generateDto.endDate),
      userSettings,
      generationRun,
    );

    return schedule;
  }

  // Сортування завдань за пріоритетом та дедлайном
  private sortTasksByPriority(tasks: Task[]): Task[] {
    const priorityWeight = {
      urgent: 4,
      high: 3,
      medium: 2,
      low: 1,
    };

    return [...tasks].sort((a, b) => {
      // Спочатку за пріоритетом
      const priorityDiff =
        priorityWeight[b.priority] - priorityWeight[a.priority];
      if (priorityDiff !== 0) return priorityDiff;

      // Потім за дедлайном (якщо є)
      if (a.deadline && b.deadline) {
        return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
      }

      // Завдання з дедлайном мають пріоритет
      if (a.deadline) return -1;
      if (b.deadline) return 1;

      // За тривалістю
      return a.estimatedTimeInMinutes - b.estimatedTimeInMinutes;
    });
  }

  // Створення оптимального розкладу
  private async createOptimalSchedule(
    tasks: Task[],
    startDate: Date,
    endDate: Date,
    userSettings: any,
    generationRun: string,
  ): Promise<ScheduledTask[]> {
    // Отримуємо вже заплановані завдання в цьому періоді
    const existingSchedule = await this.scheduledTaskRepository.find({
      where: {
        scheduledStartTime: Between(startDate, endDate),
      },
      relations: ['task'],
    });

    // Визначення робочих годин
    const workStartHour = parseInt(userSettings.wakeTime.split(':')[0]);
    const workEndHour = parseInt(userSettings.sleepTime.split(':')[0]);

    // Отримуємо доступні часові слоти
    const availableSlots = this.generateAvailableTimeSlots(
      startDate,
      endDate,
      workStartHour,
      workEndHour,
      existingSchedule,
      userSettings,
    );

    // Розподіляємо завдання по слотах
    const scheduledTasks: ScheduledTask[] = [];

    for (const task of tasks) {
      // Скільки 30-хвилинних блоків потрібно для цього завдання
      const requiredBlocks = Math.ceil(task.estimatedTimeInMinutes / 30);

      // Шукаємо доступні послідовні слоти
      for (let i = 0; i < availableSlots.length - requiredBlocks + 1; i++) {
        const consecutiveSlots = availableSlots.slice(i, i + requiredBlocks);

        // Перевіряємо, чи ці слоти послідовні в той самий день
        if (this.areSlotsConsecutive(consecutiveSlots)) {
          // Створюємо заплановане завдання
          const scheduledTask = this.scheduledTaskRepository.create({
            taskId: task.id,
            scheduledStartTime: consecutiveSlots[0].start,
            scheduledEndTime: consecutiveSlots[consecutiveSlots.length - 1].end,
            isAutoGenerated: true,
            generationRun,
          });

          // Зберігаємо та додаємо в результат
          const savedTask =
            await this.scheduledTaskRepository.save(scheduledTask);
          scheduledTasks.push(savedTask);

          // Видаляємо використані слоти
          availableSlots.splice(i, requiredBlocks);

          break;
        }
      }
    }

    return scheduledTasks;
  }

  // Генерування доступних часових слотів
  private generateAvailableTimeSlots(
    startDate: Date,
    endDate: Date,
    workStartHour: number,
    workEndHour: number,
    existingSchedule: ScheduledTask[],
    userSettings: any,
  ): { start: Date; end: Date }[] {
    const slots: { start: Date; end: Date }[] = [];
    const currentDate = new Date(startDate);

    // Перебираємо всі дні періоду
    while (currentDate <= endDate) {
      const dayOfWeek = currentDate.getDay();

      // Перевіряємо, чи це вихідний і чи дозволена робота на вихідних
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      if (isWeekend && !userSettings.weekendWorkEnabled) {
        // Переходимо до наступного дня
        currentDate.setDate(currentDate.getDate() + 1);
        continue;
      }

      // Генеруємо слоти для цього дня (30-хвилинні блоки)
      for (let hour = workStartHour; hour < workEndHour; hour++) {
        for (let minute = 0; minute < 60; minute += 30) {
          const slotStart = new Date(currentDate);
          slotStart.setHours(hour, minute, 0, 0);

          const slotEnd = new Date(slotStart);
          slotEnd.setMinutes(slotEnd.getMinutes() + 30);

          // Перевіряємо, чи слот не перекривається з існуючими завданнями
          const isOverlapping = existingSchedule.some((task) => {
            return (
              (slotStart >= task.scheduledStartTime &&
                slotStart < task.scheduledEndTime) ||
              (slotEnd > task.scheduledStartTime &&
                slotEnd <= task.scheduledEndTime) ||
              (slotStart <= task.scheduledStartTime &&
                slotEnd >= task.scheduledEndTime)
            );
          });

          if (!isOverlapping) {
            slots.push({ start: slotStart, end: slotEnd });
          }
        }
      }

      // Переходимо до наступного дня
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return slots;
  }

  // Перевірка, чи слоти послідовні
  private areSlotsConsecutive(slots: { start: Date; end: Date }[]): boolean {
    for (let i = 0; i < slots.length - 1; i++) {
      // Перевіряємо, чи кінець поточного слоту = початок наступного
      if (slots[i].end.getTime() !== slots[i + 1].start.getTime()) {
        return false;
      }

      // Перевіряємо, чи всі слоти в один день
      if (slots[i].start.getDate() !== slots[i + 1].start.getDate()) {
        return false;
      }
    }

    return true;
  }
}
