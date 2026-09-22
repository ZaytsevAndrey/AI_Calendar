import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { sendNotification, setVapidDetails } from 'web-push';
import { HabitCheckIn } from '../habits/entities/habit-check-in.entity';
import { Habit } from '../habits/entities/habit.entity';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import { Task } from '../tasks/entities/task.entity';
import { UserSettings } from '../user-settings/entities/user-settings.entity';
import { PushSubscription } from './entities/push-subscription.entity';
import { ReminderDelivery } from './entities/reminder-delivery.entity';
import { RemindersService } from './reminders.service';

jest.mock('web-push', () => ({
  sendNotification: jest.fn().mockResolvedValue({}),
  setVapidDetails: jest.fn(),
}));

const START = Date.parse('2026-09-22T10:00:00.000Z');
const NOW = new Date(START - 20 * 60_000);

function settings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    userId: 'user-1',
    remindersEnabled: true,
    timeZone: 'UTC',
    wakeTime: '07:00',
    googleCalendarLinked: false,
    ...overrides,
  } as UserSettings;
}

describe('RemindersService', () => {
  const env: Record<string, string> = {
    VAPID_PUBLIC_KEY: 'public-key',
    VAPID_PRIVATE_KEY: 'private-key',
    VAPID_SUBJECT: 'mailto:reminders@example.com',
    REMINDER_CRON_SECRET: 'tick-secret',
  };

  const subscriptions = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((row) => row),
    delete: jest.fn(),
  };
  const deliveries = {
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn((row) => row),
    delete: jest.fn(),
  };
  const settingsRepo = { find: jest.fn() };
  const tasks = { find: jest.fn() };
  const habits = { find: jest.fn() };
  const checkIns = { find: jest.fn() };
  const google = { getDisplayEvents: jest.fn() };

  let service: RemindersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    subscriptions.find.mockResolvedValue([
      { id: 'sub-1', userId: 'user-1', endpoint: 'https://push.example/1', p256dh: 'p', auth: 'a' },
    ]);
    deliveries.find.mockResolvedValue([]);
    deliveries.save.mockImplementation(async (row) => ({ id: 'delivery-1', ...row }));
    settingsRepo.find.mockResolvedValue([settings()]);
    tasks.find.mockResolvedValue([
      {
        id: 'task-1',
        name: 'Write',
        status: 'todo',
        scheduledStartTime: new Date(START),
        scheduledEndTime: new Date(START + 30 * 60_000),
      },
    ]);
    habits.find.mockResolvedValue([]);
    checkIns.find.mockResolvedValue([]);
    google.getDisplayEvents.mockResolvedValue({ events: [] });

    const moduleRef = await Test.createTestingModule({
      providers: [
        RemindersService,
        { provide: ConfigService, useValue: { get: (key: string) => env[key] } },
        { provide: getRepositoryToken(PushSubscription), useValue: subscriptions },
        { provide: getRepositoryToken(ReminderDelivery), useValue: deliveries },
        { provide: getRepositoryToken(UserSettings), useValue: settingsRepo },
        { provide: getRepositoryToken(Task), useValue: tasks },
        { provide: getRepositoryToken(Habit), useValue: habits },
        { provide: getRepositoryToken(HabitCheckIn), useValue: checkIns },
        { provide: GoogleCalendarService, useValue: google },
      ],
    }).compile();

    service = moduleRef.get(RemindersService);
  });

  it('sends one push for a block that is due and records it', async () => {
    const result = await service.dispatchDue(NOW);
    expect(result).toEqual({ users: 1, sent: 1 });
    expect(setVapidDetails).toHaveBeenCalled();
    expect(sendNotification).toHaveBeenCalledWith(
      { endpoint: 'https://push.example/1', keys: { p256dh: 'p', auth: 'a' } },
      expect.stringContaining('Write'),
      { TTL: 30 * 60, urgency: 'high' },
    );
  });

  it('does not send a block that already started or is more than 30 minutes away', async () => {
    expect((await service.dispatchDue(new Date(START + 1_000))).sent).toBe(0);
    expect((await service.dispatchDue(new Date(START - 31 * 60_000))).sent).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('drops an expired subscription and does not keep the delivery', async () => {
    (sendNotification as jest.Mock).mockRejectedValueOnce({ statusCode: 410 });
    const result = await service.dispatchDue(NOW);
    expect(result.sent).toBe(0);
    expect(subscriptions.delete).toHaveBeenCalledWith({ id: 'sub-1' });
    expect(deliveries.delete).toHaveBeenCalledWith({ id: 'delivery-1' });
  });

  it('does not send again when the delivery row already exists', async () => {
    deliveries.save.mockRejectedValueOnce({ code: '23505', message: 'UNIQUE constraint failed' });
    const result = await service.dispatchDue(NOW);
    expect(result.sent).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('still sends a habit reminder when Google events cannot be loaded', async () => {
    settingsRepo.find.mockResolvedValue([
      settings({ googleCalendarLinked: true, wakeTime: '07:00:00' }),
    ]);
    tasks.find.mockResolvedValue([]);
    habits.find.mockResolvedValue([
      { id: 'habit-1', name: 'Exercise', blockStartTime: '10:00' },
    ]);
    checkIns.find.mockResolvedValue([]);
    google.getDisplayEvents.mockRejectedValue(new Error('token expired'));

    const result = await service.dispatchDue(new Date(START - 15 * 60_000));
    expect(result.sent).toBe(1);
    expect(sendNotification).toHaveBeenCalledWith(
      expect.any(Object),
      expect.stringContaining('Exercise'),
      expect.any(Object),
    );
  });

  it('rejects the cron tick until a secret is configured', async () => {
    env.REMINDER_CRON_SECRET = '';
    try {
      await expect(service.tickFromCron('tick-secret')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    } finally {
      env.REMINDER_CRON_SECRET = 'tick-secret';
    }
  });

  it('rejects a cron tick with the wrong secret', async () => {
    await expect(service.tickFromCron('nope')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('rejects a subscription that is not an https endpoint', async () => {
    await expect(
      service.saveSubscription('user-1', {
        endpoint: 'http://push.example/1',
        p256dh: 'p',
        auth: 'a',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('moves an existing endpoint onto the current user', async () => {
    subscriptions.findOne.mockResolvedValue({
      id: 'sub-1',
      userId: 'other',
      endpoint: 'https://push.example/1',
      p256dh: 'old',
      auth: 'old',
    });
    subscriptions.save.mockImplementation(async (row) => row);
    await service.saveSubscription('user-1', {
      endpoint: 'https://push.example/1',
      p256dh: 'next',
      auth: 'next',
    });
    expect(subscriptions.save).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', p256dh: 'next', auth: 'next' }),
    );
  });

  it('reports Web Push as unavailable when VAPID keys are missing', () => {
    env.VAPID_PUBLIC_KEY = '';
    try {
      expect(() => service.getVapidPublicKey()).toThrow(ServiceUnavailableException);
    } finally {
      env.VAPID_PUBLIC_KEY = 'public-key';
    }
  });
});
