import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
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

  const googleCalendarMock = {
    createEvent: jest.fn(),
    updateEvent: jest.fn(),
    deleteEvent: jest.fn(),
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
        { provide: GoogleCalendarService, useValue: googleCalendarMock },
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
    expect(result.editableFrom).toBe('2026-08-26');
    expect(result.editableTo).toBe('2026-09-08');
    expect(result.timeZone).toBe('UTC');
    expect(result.habits[0]).toMatchObject({
      checkedToday: true,
      currentStreak: 1,
      points: 1,
      checkInDates: ['2026-09-08'],
    });
  });

  it('creates a missing Google series when listing linked habits', async () => {
    userSettingsRepositoryMock.findOne.mockResolvedValue({
      timeZone: 'UTC',
      googleCalendarLinked: true,
    });
    googleCalendarMock.createEvent.mockResolvedValue({
      id: 'evt-backfill',
      appCalendarId: 'cal-app',
    });
    habitsRepositoryMock.find.mockResolvedValue([
      {
        id: 'habit-1',
        name: 'Exercise',
        color: '#22c55e',
        description: null,
        blockStartTime: '09:00',
        blockMinutes: 30,
        googleEventId: null,
        googleEventCalendarId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    checkInsRepositoryMock.find.mockResolvedValue([]);

    const result = await service.findAll('user-1');

    expect(googleCalendarMock.createEvent).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        summary: 'Exercise',
        recurrence: ['RRULE:FREQ=DAILY'],
        start: { dateTime: '2026-09-08T09:00:00+00:00', timeZone: 'UTC' },
      }),
      { skipSleepWindowCheck: true },
    );
    expect(result.habits[0].googleEventId).toBe('evt-backfill');
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
    expect(result.editableFrom).toBe('2026-08-27');
    expect(result.editableTo).toBe('2026-09-09');
    expect(result.timeZone).toBe('Europe/Kyiv');
  });

  it('rejects check-ins outside the 14-day window', async () => {
    habitsRepositoryMock.findOne.mockResolvedValue({
      id: 'habit-1',
      userId: 'user-1',
      name: 'Exercise',
      color: '#22c55e',
      description: null,
    });

    await expect(
      service.setCheckIn('user-1', 'habit-1', '2026-08-25', true),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.setCheckIn('user-1', 'habit-1', '2026-09-09', true),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(checkInsRepositoryMock.save).not.toHaveBeenCalled();
  });

  it('saves a check-in on the oldest allowed day', async () => {
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
      { habitId: 'habit-1', localDate: '2026-08-26' },
    ]);

    const result = await service.setCheckIn(
      'user-1',
      'habit-1',
      '2026-08-26',
      true,
    );

    expect(checkInsRepositoryMock.save).toHaveBeenCalled();
    expect(result.checkedToday).toBe(false);
    expect(result.checkInDates).toEqual(['2026-08-26']);
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

  it('stores a daily time block when start and duration are both set', async () => {
    habitsRepositoryMock.findOne.mockResolvedValue({
      id: 'habit-1',
      userId: 'user-1',
      name: 'Exercise',
      color: '#22c55e',
      description: null,
      blockStartTime: null,
      blockMinutes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    checkInsRepositoryMock.find.mockResolvedValue([]);

    const result = await service.update('user-1', 'habit-1', {
      blockStartTime: '7:30',
      blockMinutes: 45,
    });

    expect(habitsRepositoryMock.save).toHaveBeenCalledWith(
      expect.objectContaining({ blockStartTime: '07:30', blockMinutes: 45 }),
    );
    expect(result.blockStartTime).toBe('07:30');
    expect(result.blockMinutes).toBe(45);
    expect(googleCalendarMock.createEvent).not.toHaveBeenCalled();
  });

  it('creates a daily Google event when Calendar is linked', async () => {
    userSettingsRepositoryMock.findOne.mockResolvedValue({
      timeZone: 'UTC',
      googleCalendarLinked: true,
    });
    googleCalendarMock.createEvent.mockResolvedValue({
      id: 'evt-habit',
      appCalendarId: 'cal-app',
    });
    habitsRepositoryMock.findOne.mockResolvedValue({
      id: 'habit-1',
      userId: 'user-1',
      name: 'Exercise',
      color: '#22c55e',
      description: null,
      blockStartTime: null,
      blockMinutes: null,
      googleEventId: null,
      googleEventCalendarId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    checkInsRepositoryMock.find.mockResolvedValue([]);

    const result = await service.update('user-1', 'habit-1', {
      blockStartTime: '07:30',
      blockMinutes: 45,
    });

    expect(googleCalendarMock.createEvent).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        summary: 'Exercise',
        description: 'Daily habit time block',
        recurrence: ['RRULE:FREQ=DAILY'],
        transparency: 'opaque',
        start: { dateTime: '2026-09-08T07:30:00+00:00', timeZone: 'UTC' },
        end: { dateTime: '2026-09-08T08:15:00.000Z', timeZone: 'UTC' },
      }),
      { skipSleepWindowCheck: true },
    );
    expect(result.googleEventId).toBe('evt-habit');
    expect(result.blockStartTime).toBe('07:30');
  });

  it('replaces the Google series when the habit is renamed', async () => {
    userSettingsRepositoryMock.findOne.mockResolvedValue({
      timeZone: 'UTC',
      googleCalendarLinked: true,
    });
    googleCalendarMock.createEvent.mockResolvedValue({
      id: 'evt-2',
      appCalendarId: 'cal-app',
    });
    habitsRepositoryMock.findOne.mockResolvedValue({
      id: 'habit-1',
      userId: 'user-1',
      name: 'Exercise',
      color: '#22c55e',
      description: null,
      blockStartTime: '07:30',
      blockMinutes: 45,
      googleEventId: 'evt-1',
      googleEventCalendarId: 'cal-app',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    checkInsRepositoryMock.find.mockResolvedValue([]);

    await service.update('user-1', 'habit-1', { name: 'Walk' });

    expect(googleCalendarMock.deleteEvent).toHaveBeenCalledWith(
      'user-1',
      'evt-1',
      'cal-app',
    );
    expect(googleCalendarMock.createEvent).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ summary: 'Walk', recurrence: ['RRULE:FREQ=DAILY'] }),
      { skipSleepWindowCheck: true },
    );
  });

  it('deletes the Google series when the time block is cleared', async () => {
    userSettingsRepositoryMock.findOne.mockResolvedValue({
      timeZone: 'UTC',
      googleCalendarLinked: true,
    });
    habitsRepositoryMock.findOne.mockResolvedValue({
      id: 'habit-1',
      userId: 'user-1',
      name: 'Exercise',
      color: '#22c55e',
      description: null,
      blockStartTime: '07:30',
      blockMinutes: 45,
      googleEventId: 'evt-1',
      googleEventCalendarId: 'cal-app',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    checkInsRepositoryMock.find.mockResolvedValue([]);

    const result = await service.update('user-1', 'habit-1', {
      blockStartTime: null,
      blockMinutes: null,
    });

    expect(googleCalendarMock.deleteEvent).toHaveBeenCalledWith(
      'user-1',
      'evt-1',
      'cal-app',
    );
    expect(googleCalendarMock.createEvent).not.toHaveBeenCalled();
    expect(result.blockStartTime).toBeNull();
    expect(result.googleEventId).toBeNull();
  });

  it('keeps the local block when Google Calendar is not connected', async () => {
    userSettingsRepositoryMock.findOne.mockResolvedValue({
      timeZone: 'UTC',
      googleCalendarLinked: true,
    });
    googleCalendarMock.createEvent.mockRejectedValue(
      new BadRequestException('Google Calendar is not connected.'),
    );
    habitsRepositoryMock.findOne.mockResolvedValue({
      id: 'habit-1',
      userId: 'user-1',
      name: 'Exercise',
      color: '#22c55e',
      description: null,
      blockStartTime: null,
      blockMinutes: null,
      googleEventId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    checkInsRepositoryMock.find.mockResolvedValue([]);

    const result = await service.update('user-1', 'habit-1', {
      blockStartTime: '07:30',
      blockMinutes: 45,
    });

    expect(result.blockStartTime).toBe('07:30');
    expect(result.blockMinutes).toBe(45);
    expect(result.googleEventId).toBeNull();
  });

  it('creates the Google series when a linked habit is created with a block', async () => {
    userSettingsRepositoryMock.findOne.mockResolvedValue({
      timeZone: 'UTC',
      googleCalendarLinked: true,
    });
    googleCalendarMock.createEvent.mockResolvedValue({
      id: 'evt-created',
      appCalendarId: 'cal-app',
    });
    checkInsRepositoryMock.find.mockResolvedValue([]);

    const result = await service.create('user-1', {
      name: 'Exercise',
      blockStartTime: '07:30',
      blockMinutes: 45,
    });

    expect(googleCalendarMock.createEvent).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        summary: 'Exercise',
        recurrence: ['RRULE:FREQ=DAILY'],
        start: { dateTime: '2026-09-08T07:30:00+00:00', timeZone: 'UTC' },
        end: { dateTime: '2026-09-08T08:15:00.000Z', timeZone: 'UTC' },
      }),
      { skipSleepWindowCheck: true },
    );
    expect(result.googleEventId).toBe('evt-created');
  });

  it('replaces the Google series when the clock time changes', async () => {
    userSettingsRepositoryMock.findOne.mockResolvedValue({
      timeZone: 'UTC',
      googleCalendarLinked: true,
    });
    googleCalendarMock.createEvent.mockResolvedValue({
      id: 'evt-moved',
      appCalendarId: 'cal-app',
    });
    habitsRepositoryMock.findOne.mockResolvedValue({
      id: 'habit-1',
      userId: 'user-1',
      name: 'Exercise',
      color: '#22c55e',
      description: 'Morning',
      blockStartTime: '07:30',
      blockMinutes: 45,
      googleEventId: 'evt-1',
      googleEventCalendarId: 'cal-app',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    checkInsRepositoryMock.find.mockResolvedValue([]);

    await service.update('user-1', 'habit-1', {
      blockStartTime: '08:00',
      blockMinutes: 30,
    });

    expect(googleCalendarMock.deleteEvent).toHaveBeenCalledWith(
      'user-1',
      'evt-1',
      'cal-app',
    );
    expect(googleCalendarMock.createEvent).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        summary: 'Exercise',
        description: 'Morning',
        start: { dateTime: '2026-09-08T08:00:00+00:00', timeZone: 'UTC' },
        end: { dateTime: '2026-09-08T08:30:00.000Z', timeZone: 'UTC' },
      }),
      { skipSleepWindowCheck: true },
    );
  });

  it('does not call Google when a linked block is saved unchanged', async () => {
    userSettingsRepositoryMock.findOne.mockResolvedValue({
      timeZone: 'UTC',
      googleCalendarLinked: true,
    });
    habitsRepositoryMock.findOne.mockResolvedValue({
      id: 'habit-1',
      userId: 'user-1',
      name: 'Exercise',
      color: '#22c55e',
      description: null,
      blockStartTime: '07:30',
      blockMinutes: 45,
      googleEventId: 'evt-1',
      googleEventCalendarId: 'cal-app',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    checkInsRepositoryMock.find.mockResolvedValue([]);

    await service.update('user-1', 'habit-1', { name: 'Exercise' });

    expect(googleCalendarMock.createEvent).not.toHaveBeenCalled();
    expect(googleCalendarMock.deleteEvent).not.toHaveBeenCalled();
  });

  it('deletes the Google series when the habit is deleted', async () => {
    userSettingsRepositoryMock.findOne.mockResolvedValue({
      timeZone: 'UTC',
      googleCalendarLinked: true,
    });
    habitsRepositoryMock.findOne.mockResolvedValue({
      id: 'habit-1',
      userId: 'user-1',
      name: 'Exercise',
      color: '#22c55e',
      description: null,
      blockStartTime: '07:30',
      blockMinutes: 45,
      googleEventId: 'evt-1',
      googleEventCalendarId: 'cal-app',
    });

    await service.remove('user-1', 'habit-1');

    expect(googleCalendarMock.deleteEvent).toHaveBeenCalledWith(
      'user-1',
      'evt-1',
      'cal-app',
    );
    expect(checkInsRepositoryMock.delete).toHaveBeenCalledWith({ habitId: 'habit-1' });
    expect(habitsRepositoryMock.remove).toHaveBeenCalled();
  });

  it('still deletes the habit when Google Calendar is not connected', async () => {
    habitsRepositoryMock.findOne.mockResolvedValue({
      id: 'habit-1',
      userId: 'user-1',
      name: 'Exercise',
      color: '#22c55e',
      description: null,
      googleEventId: 'evt-1',
      googleEventCalendarId: 'cal-app',
    });
    googleCalendarMock.deleteEvent.mockRejectedValue(
      new Error('Google Calendar not connected'),
    );

    await service.remove('user-1', 'habit-1');

    expect(habitsRepositoryMock.remove).toHaveBeenCalled();
  });

  it('does not write to Google when a day is checked in', async () => {
    userSettingsRepositoryMock.findOne.mockResolvedValue({
      timeZone: 'UTC',
      googleCalendarLinked: true,
    });
    habitsRepositoryMock.findOne.mockResolvedValue({
      id: 'habit-1',
      userId: 'user-1',
      name: 'Exercise',
      color: '#22c55e',
      description: null,
      blockStartTime: '07:30',
      blockMinutes: 45,
      googleEventId: 'evt-1',
      googleEventCalendarId: 'cal-app',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    checkInsRepositoryMock.findOne.mockResolvedValue(null);
    checkInsRepositoryMock.find.mockResolvedValue([
      { habitId: 'habit-1', localDate: '2026-09-08' },
    ]);

    await service.setCheckIn('user-1', 'habit-1', '2026-09-08', true);

    expect(googleCalendarMock.createEvent).not.toHaveBeenCalled();
    expect(googleCalendarMock.deleteEvent).not.toHaveBeenCalled();
  });

  it('rejects a time block that has only a duration', async () => {
    habitsRepositoryMock.findOne.mockResolvedValue({
      id: 'habit-1',
      userId: 'user-1',
      name: 'Exercise',
      color: '#22c55e',
      description: null,
      blockStartTime: null,
      blockMinutes: null,
    });

    await expect(
      service.update('user-1', 'habit-1', { blockMinutes: 30 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(habitsRepositoryMock.save).not.toHaveBeenCalled();
  });
});
