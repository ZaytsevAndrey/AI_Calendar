import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { HabitsService } from './habits.service';
import { Habit } from './entities/habit.entity';
import { HabitCheckIn } from './entities/habit-check-in.entity';
import { UserSettings } from '../user-settings/entities/user-settings.entity';

describe('HabitsService', () => {
  let service: HabitsService;

  const habitsRepositoryMock = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((x) => x),
    save: jest.fn((x) => Promise.resolve({ ...x, id: x.id ?? 'habit-1' })),
    remove: jest.fn(),
  };

  const checkInsRepositoryMock = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((x) => x),
    save: jest.fn((x) => Promise.resolve(x)),
    remove: jest.fn(),
    delete: jest.fn(),
  };

  const userSettingsRepositoryMock = {
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-08T12:00:00.000Z'));
    userSettingsRepositoryMock.findOne.mockResolvedValue({
      timeZone: 'UTC',
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HabitsService,
        { provide: getRepositoryToken(Habit), useValue: habitsRepositoryMock },
        {
          provide: getRepositoryToken(HabitCheckIn),
          useValue: checkInsRepositoryMock,
        },
        {
          provide: getRepositoryToken(UserSettings),
          useValue: userSettingsRepositoryMock,
        },
      ],
    }).compile();

    service = module.get<HabitsService>(HabitsService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('lists habits with today/yesterday flags in the settings time zone', async () => {
    habitsRepositoryMock.find.mockResolvedValue([
      {
        id: 'habit-1',
        name: 'Exercise',
        color: '#22c55e',
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    checkInsRepositoryMock.find.mockResolvedValue([
      { habitId: 'habit-1', localDate: '2026-09-08' },
    ]);

    const result = await service.findAll('user-1');

    expect(result.today).toBe('2026-09-08');
    expect(result.yesterday).toBe('2026-09-07');
    expect(result.timeZone).toBe('UTC');
    expect(result.habits[0]).toMatchObject({
      checkedToday: true,
      checkedYesterday: false,
      currentStreak: 1,
      points: 1,
    });
  });

  it('uses the settings IANA zone for the civil day', async () => {
    jest.setSystemTime(new Date('2026-09-08T22:30:00.000Z'));
    userSettingsRepositoryMock.findOne.mockResolvedValue({
      timeZone: 'Europe/Kyiv',
    });
    habitsRepositoryMock.find.mockResolvedValue([]);
    checkInsRepositoryMock.find.mockResolvedValue([]);

    const result = await service.findAll('user-1');

    expect(result.today).toBe('2026-09-09');
    expect(result.yesterday).toBe('2026-09-08');
    expect(result.timeZone).toBe('Europe/Kyiv');
  });

  it('rejects check-ins that are not today or yesterday', async () => {
    habitsRepositoryMock.findOne.mockResolvedValue({
      id: 'habit-1',
      userId: 'user-1',
      name: 'Exercise',
      color: '#22c55e',
      description: null,
    });

    await expect(
      service.setCheckIn('user-1', 'habit-1', '2026-09-01', true),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(checkInsRepositoryMock.save).not.toHaveBeenCalled();
  });

  it('is idempotent when checking in a day that is already done', async () => {
    habitsRepositoryMock.findOne.mockResolvedValue({
      id: 'habit-1',
      userId: 'user-1',
      name: 'Exercise',
      color: '#22c55e',
      description: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    checkInsRepositoryMock.findOne.mockResolvedValue({
      id: 'cin-1',
      habitId: 'habit-1',
      localDate: '2026-09-08',
    });
    checkInsRepositoryMock.find.mockResolvedValue([
      { habitId: 'habit-1', localDate: '2026-09-08' },
    ]);

    await service.setCheckIn('user-1', 'habit-1', '2026-09-08', true);

    expect(checkInsRepositoryMock.save).not.toHaveBeenCalled();
  });

  it('does not leak another user habit', async () => {
    habitsRepositoryMock.findOne.mockResolvedValue(null);
    await expect(service.remove('user-1', 'habit-x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(checkInsRepositoryMock.delete).not.toHaveBeenCalled();
  });

  it('saves a check-in for today', async () => {
    habitsRepositoryMock.findOne.mockResolvedValue({
      id: 'habit-1',
      userId: 'user-1',
      name: 'Exercise',
      color: '#22c55e',
      description: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    checkInsRepositoryMock.findOne.mockResolvedValue(null);
    checkInsRepositoryMock.find.mockResolvedValue([
      { habitId: 'habit-1', localDate: '2026-09-08' },
    ]);

    const result = await service.setCheckIn(
      'user-1',
      'habit-1',
      '2026-09-08',
      true,
    );

    expect(checkInsRepositoryMock.save).toHaveBeenCalled();
    expect(result.checkedToday).toBe(true);
    expect(result.currentStreak).toBe(1);
  });
});
