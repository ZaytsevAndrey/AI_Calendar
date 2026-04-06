import { Test, TestingModule } from '@nestjs/testing';
import { TasksService } from '../src/modules/tasks/tasks.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Task } from '../src/modules/tasks/entities/task.entity';
import { Repository } from 'typeorm';

describe('TasksService', () => {
  let service: TasksService;
  let tasksRepository: Repository<Task>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        {
          provide: getRepositoryToken(Task),
          useClass: Repository,
        },
      ],
    }).compile();

    service = module.get<TasksService>(TasksService);
    tasksRepository = module.get<Repository<Task>>(getRepositoryToken(Task));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create a task', async () => {
    const createTaskDto = {
      title: 'Test Task',
      description: 'Test Description',
      dueDate: new Date(),
      priority: 'high',
      status: 'pending',
      categoryId: '1',
      userId: '1',
    };

    const savedTask = {
      id: '1',
      ...createTaskDto,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    jest.spyOn(tasksRepository, 'save').mockResolvedValue(savedTask as Task);

    const result = await service.create(createTaskDto);
    expect(result).toEqual(savedTask);
    expect(tasksRepository.save).toHaveBeenCalledWith(createTaskDto);
  });

  it('should find all tasks for user', async () => {
    const userId = '1';
    const tasks = [
      {
        id: '1',
        title: 'Task 1',
        description: 'Description 1',
        dueDate: new Date(),
        priority: 'high',
        status: 'pending',
        categoryId: '1',
        userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: '2',
        title: 'Task 2',
        description: 'Description 2',
        dueDate: new Date(),
        priority: 'medium',
        status: 'completed',
        categoryId: '2',
        userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    jest.spyOn(tasksRepository, 'find').mockResolvedValue(tasks as Task[]);

    const result = await service.findAll(userId);
    expect(result).toEqual(tasks);
    expect(tasksRepository.find).toHaveBeenCalledWith({ where: { userId } });
  });

  it('should find one task', async () => {
    const id = '1';
    const task = {
      id,
      title: 'Test Task',
      description: 'Test Description',
      dueDate: new Date(),
      priority: 'high',
      status: 'pending',
      categoryId: '1',
      userId: '1',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    jest.spyOn(tasksRepository, 'findOne').mockResolvedValue(task as Task);

    const result = await service.findOne(id);
    expect(result).toEqual(task);
    expect(tasksRepository.findOne).toHaveBeenCalledWith({ where: { id } });
  });

  it('should update a task', async () => {
    const id = '1';
    const updateTaskDto = {
      title: 'Updated Task',
      description: 'Updated Description',
      priority: 'low',
      status: 'completed',
    };

    jest
      .spyOn(tasksRepository, 'update')
      .mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

    await service.update(id, updateTaskDto);
    expect(tasksRepository.update).toHaveBeenCalledWith(id, updateTaskDto);
  });

  it('should remove a task', async () => {
    const id = '1';
    jest
      .spyOn(tasksRepository, 'delete')
      .mockResolvedValue({ affected: 1, raw: [] });

    await service.remove(id);
    expect(tasksRepository.delete).toHaveBeenCalledWith(id);
  });
});
