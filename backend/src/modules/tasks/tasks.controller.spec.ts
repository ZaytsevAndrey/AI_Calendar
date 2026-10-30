import { Test, TestingModule } from '@nestjs/testing';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { OccurrenceEditService } from '../schedule/occurrence-edit.service';

describe('TasksController', () => {
  let controller: TasksController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TasksController],
      providers: [
        {
          provide: TasksService,
          useValue: {
            create: jest.fn(),
            findAll: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
            remove: jest.fn(),
            updateStatus: jest.fn(),
          },
        },
        { provide: OccurrenceEditService, useValue: { edit: jest.fn() } },
      ],
    }).compile();

    controller = module.get<TasksController>(TasksController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create Idempotency-Key', () => {
    const req = { user: { userId: 'u1' } };
    const body = { name: 'Task' } as never;
    const service = () => (controller as unknown as { tasksService: { create: jest.Mock } }).tasksService;

    it('passes a trimmed key to the service, or null without one', () => {
      controller.create(req, body, '  form-1  ');
      controller.create(req, body);
      expect(service().create).toHaveBeenNthCalledWith(1, 'u1', body, { requestKey: 'form-1' });
      expect(service().create).toHaveBeenNthCalledWith(2, 'u1', body, { requestKey: null });
    });

    it('rejects a malformed key before creating anything', () => {
      expect(() => controller.create(req, body, 'has space')).toThrow('Idempotency-Key');
      expect(() => controller.create(req, body, 'x'.repeat(65))).toThrow('Idempotency-Key');
      expect(service().create).not.toHaveBeenCalled();
    });
  });
});
