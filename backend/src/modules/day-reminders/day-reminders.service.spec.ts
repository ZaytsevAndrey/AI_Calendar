import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull } from 'typeorm';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import { UserSettings } from '../user-settings/entities/user-settings.entity';
import { DayRemindersService } from './day-reminders.service';
import { DayReminder } from './entities/day-reminder.entity';

describe('DayRemindersService', () => {
  let service: DayRemindersService;
  const reminders = {
    create: jest.fn((row) => row),
    save: jest.fn(async (row) => ({ id: row.id ?? 'r1', ...row })),
    find: jest.fn(),
    findOne: jest.fn(),
    remove: jest.fn(),
  };
  const settings = {
    findOne: jest.fn().mockResolvedValue({
      timeZone: 'UTC',
      defaultReminderTime: '09:00',
    }),
  };
  const google = {
    createEvent: jest.fn().mockResolvedValue({ id: 'g-1', appCalendarId: 'app-cal' }),
    updateEvent: jest.fn().mockResolvedValue({ id: 'g-1' }),
    deleteEvent: jest.fn().mockResolvedValue({ success: true }),
    getEvent: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    settings.findOne.mockResolvedValue({
      timeZone: 'UTC',
      defaultReminderTime: '09:00',
    });
    google.createEvent.mockResolvedValue({ id: 'g-1', appCalendarId: 'app-cal' });
    const moduleRef = await Test.createTestingModule({
      providers: [
        DayRemindersService,
        { provide: getRepositoryToken(DayReminder), useValue: reminders },
        { provide: getRepositoryToken(UserSettings), useValue: settings },
        { provide: GoogleCalendarService, useValue: google },
      ],
    }).compile();
    service = moduleRef.get(DayRemindersService);
  });

  it('creates a free popup at the settings clock when no time is set', async () => {
    const saved = await service.create('user-1', {
      name: 'Cancel Netflix',
      dueYmd: '2026-11-03',
    });

    expect(saved.googleEventId).toBe('g-1');
    expect(google.createEvent).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        summary: 'Cancel Netflix',
        transparency: 'transparent',
        start: { dateTime: '2026-11-03T09:00:00', timeZone: 'UTC' },
        end: { dateTime: '2026-11-03T09:15:00', timeZone: 'UTC' },
        reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] },
      }),
      { skipSleepWindowCheck: true },
    );
  });

  it('uses the reminder clock instead of the settings default', async () => {
    await service.create('user-1', {
      name: 'Pay rent',
      dueYmd: '2026-11-01',
      notificationTime: '18:30',
    });

    expect(google.createEvent).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        start: { dateTime: '2026-11-01T18:30:00', timeZone: 'UTC' },
      }),
      { skipSleepWindowCheck: true },
    );
  });

  it('keeps the reminder when Google cannot create the event', async () => {
    google.createEvent.mockRejectedValue(new Error('Google Calendar is not connected.'));
    const saved = await service.create('user-1', {
      name: 'Local only',
      dueYmd: '2026-11-03',
    });
    expect(saved.name).toBe('Local only');
    expect(saved.googleEventId).toBeNull();
  });

  it('rejects an impossible day and an unknown repeat', async () => {
    await expect(
      service.create('user-1', { name: 'Nope', dueYmd: '2026-02-31' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create('user-1', {
        name: 'Nope',
        dueYmd: '2026-11-03',
        recurrencePattern: 'YEARLY' as 'MONTHLY',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('completes a one-off and deletes its Google event', async () => {
    reminders.findOne.mockResolvedValue({
      id: 'r1',
      userId: 'user-1',
      status: 'open',
      name: 'Once',
      dueYmd: '2026-11-03',
      notificationTime: null,
      recurrencePattern: null,
      googleEventId: 'g-1',
      googleEventCalendarId: 'app-cal',
    });

    const done = await service.resolve('user-1', 'r1');
    expect(done.status).toBe('completed');
    expect(done.googleEventId).toBeNull();
    expect(google.deleteEvent).toHaveBeenCalledWith('user-1', 'g-1', 'app-cal');
  });

  it('moves a monthly 31st to the last day of the next shorter month', async () => {
    reminders.findOne.mockResolvedValue({
      id: 'r1',
      userId: 'user-1',
      status: 'open',
      name: 'Rent',
      dueYmd: '2026-01-31',
      notificationTime: '09:00',
      recurrencePattern: 'MONTHLY',
      recurrenceMonthDay: 31,
      recurrenceWeekDays: null,
      googleEventId: 'g-1',
      googleEventCalendarId: 'app-cal',
      description: null,
    });

    const next = await service.resolve('user-1', 'r1');
    expect(next.dueYmd).toBe('2026-02-28');
    expect(google.updateEvent).toHaveBeenCalledWith(
      'user-1',
      'g-1',
      expect.objectContaining({
        start: { dateTime: '2026-02-28T09:00:00', timeZone: 'UTC' },
      }),
      { skipSleepWindowCheck: true, calendarId: 'app-cal' },
    );
  });

  it('deletes the reminder when Google says the event is gone', async () => {
    const row = {
      id: 'r1',
      googleEventId: 'g-1',
      googleEventCalendarId: 'app-cal',
      dueYmd: '2026-11-03',
    };
    reminders.find.mockResolvedValue([row]);
    google.getEvent.mockRejectedValue(new Error('Failed to fetch event: Not Found'));

    await expect(service.findAll('user-1')).resolves.toEqual([]);
    expect(reminders.remove).toHaveBeenCalledWith(row);
    expect(google.createEvent).not.toHaveBeenCalled();
  });

  it('deletes the reminder when the Google event is cancelled', async () => {
    const row = { id: 'r1', googleEventId: 'g-1', dueYmd: '2026-11-03' };
    reminders.find.mockResolvedValue([row]);
    google.getEvent.mockResolvedValue({ status: 'cancelled' });

    await expect(service.findAll('user-1')).resolves.toEqual([]);
    expect(reminders.remove).toHaveBeenCalledWith(row);
  });

  it('keeps the reminder when Google fails for another reason', async () => {
    const row = { id: 'r1', googleEventId: 'g-1', dueYmd: '2026-11-03' };
    reminders.find.mockResolvedValue([row]);
    google.getEvent.mockRejectedValue(new Error('Google Calendar not connected'));

    await expect(service.findAll('user-1')).resolves.toEqual([row]);
    expect(reminders.remove).not.toHaveBeenCalled();
  });

  it('retargets only reminders that follow the settings clock', async () => {
    reminders.find.mockResolvedValue([
      {
        id: 'open-default',
        status: 'open',
        name: 'Default',
        dueYmd: '2026-11-03',
        notificationTime: null,
        description: null,
        googleEventId: 'g-1',
        googleEventCalendarId: 'app-cal',
      },
    ]);

    await service.retargetDefaultTime('user-1', '08:15');
    expect(reminders.find).toHaveBeenCalledWith({
      where: { userId: 'user-1', status: 'open', notificationTime: IsNull() },
    });
    expect(google.updateEvent).toHaveBeenCalledWith(
      'user-1',
      'g-1',
      expect.objectContaining({
        start: { dateTime: '2026-11-03T08:15:00', timeZone: 'UTC' },
      }),
      { skipSleepWindowCheck: true, calendarId: 'app-cal' },
    );
  });
});
