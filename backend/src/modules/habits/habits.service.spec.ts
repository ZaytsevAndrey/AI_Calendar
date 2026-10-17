import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GoneException } from '@nestjs/common';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import { HabitsService } from './habits.service';
import { Habit } from './entities/habit.entity';
import { HabitCheckIn } from './entities/habit-check-in.entity';
import { UserSettings } from '../user-settings/entities/user-settings.entity';
import { HabitStreakTipService } from './habit-streak-tip.service';

describe('HabitsService (MVP soft-disabled)', () => {
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

  const googleCalendarMock = {
    createEvent: jest.fn(),
    updateEvent: jest.fn(),
    deleteEvent: jest.fn(),
  };

  const streakTipsMock = {
    tip: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-08T12:00:00.000Z'));
    userSettingsRepositoryMock.findOne.mockResolvedValue({
      timeZone: 'UTC',
      language: 'en',
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
        { provide: GoogleCalendarService, useValue: googleCalendarMock },
        { provide: HabitStreakTipService, useValue: streakTipsMock },
      ],
    }).compile();

    service = module.get<HabitsService>(HabitsService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('lists an empty habits array without reading or syncing Google', async () => {
    const result = await service.findAll('user-1');

    expect(result.today).toBe('2026-09-08');
    expect(result.editableFrom).toBe('2026-08-26');
    expect(result.editableTo).toBe('2026-09-08');
    expect(result.timeZone).toBe('UTC');
    expect(result.habits).toEqual([]);
    expect(habitsRepositoryMock.find).not.toHaveBeenCalled();
    expect(googleCalendarMock.createEvent).not.toHaveBeenCalled();
  });

  it('uses the settings IANA zone for the civil day on the empty list', async () => {
    jest.setSystemTime(new Date('2026-09-08T22:30:00.000Z'));
    userSettingsRepositoryMock.findOne.mockResolvedValue({
      timeZone: 'Europe/Kyiv',
    });

    const result = await service.findAll('user-1');

    expect(result.today).toBe('2026-09-09');
    expect(result.timeZone).toBe('Europe/Kyiv');
    expect(result.habits).toEqual([]);
  });

  it('rejects create with GoneException', async () => {
    await expect(
      service.create('user-1', { name: 'Exercise', color: '#22c55e' }),
    ).rejects.toBeInstanceOf(GoneException);
    expect(habitsRepositoryMock.save).not.toHaveBeenCalled();
  });

  it('rejects update with GoneException', async () => {
    await expect(
      service.update('user-1', 'habit-1', { name: 'Renamed' }),
    ).rejects.toBeInstanceOf(GoneException);
  });

  it('rejects remove with GoneException', async () => {
    await expect(service.remove('user-1', 'habit-1')).rejects.toBeInstanceOf(
      GoneException,
    );
  });

  it('rejects check-in with GoneException', async () => {
    await expect(
      service.setCheckIn('user-1', 'habit-1', '2026-09-08', true),
    ).rejects.toBeInstanceOf(GoneException);
  });
});
