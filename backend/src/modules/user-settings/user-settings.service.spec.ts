import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserSettingsService } from './user-settings.service';
import { UserSettings } from './entities/user-settings.entity';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';

describe('UserSettingsService', () => {
  let service: UserSettingsService;
  const repo = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    merge: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserSettingsService,
        {
          provide: getRepositoryToken(UserSettings),
          useValue: repo,
        },
        {
          provide: GoogleCalendarService,
          useValue: {
            getOrCreateAppManagedCalendarId: jest.fn(),
            updateAppCalendarSummaryIfLinked: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<UserSettingsService>(UserSettingsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('does not invent a timeZone when loading existing settings', async () => {
    const existing = {
      userId: 'user-1',
      wakeTime: '07:00',
      sleepTime: '22:00',
      timeZone: null,
      minSplitMinutes: 30,
      maxSplitMinutes: 30,
      appGoogleCalendarName: 'AI Calendar Assistant',
    };
    repo.findOne.mockResolvedValue(existing);
    repo.save.mockResolvedValue(existing);

    const settings = await service.getSettings('user-1');
    expect(settings.timeZone).toBeNull();
  });

  it('persists an IANA timeZone on update', async () => {
    const existing = {
      userId: 'user-1',
      wakeTime: '07:00',
      sleepTime: '22:00',
      timeZone: null,
      minSplitMinutes: 30,
      maxSplitMinutes: 30,
      appGoogleCalendarName: 'AI Calendar Assistant',
    };
    repo.findOne.mockResolvedValue(existing);
    repo.save.mockImplementation(async (entity) => entity);
    repo.merge.mockImplementation((entity, dto) => Object.assign(entity, dto));

    const saved = await service.updateSettings('user-1', {
      timeZone: 'Asia/Nicosia',
    });
    expect(saved.timeZone).toBe('Asia/Nicosia');
    expect(repo.save).toHaveBeenCalled();
  });

  it('persists the fixed-event buffer', async () => {
    const existing = {
      userId: 'user-1',
      wakeTime: '07:00',
      sleepTime: '22:00',
      timeZone: null,
      minSplitMinutes: 30,
      maxSplitMinutes: 30,
      appGoogleCalendarName: 'AI Calendar Assistant',
      fixedEventBufferMinutes: 0,
    };
    repo.findOne.mockResolvedValue(existing);
    repo.save.mockImplementation(async (entity) => entity);
    repo.merge.mockImplementation((entity, dto) => Object.assign(entity, dto));

    const saved = await service.updateSettings('user-1', {
      fixedEventBufferMinutes: 15,
    });
    expect(saved.fixedEventBufferMinutes).toBe(15);
  });

  it('stores hidden calendar ids and drops the app calendar', async () => {
    const existing = {
      userId: 'user-1',
      wakeTime: '07:00',
      sleepTime: '22:00',
      minSplitMinutes: 30,
      maxSplitMinutes: 30,
      appGoogleCalendarName: 'AI Calendar Assistant',
      appGoogleCalendarId: 'app@group.calendar.google.com',
    };
    repo.findOne.mockResolvedValue(existing);
    repo.save.mockImplementation(async (entity) => entity);
    repo.merge.mockImplementation((entity, dto) => Object.assign(entity, dto));

    const saved = await service.updateSettings('user-1', {
      hiddenGoogleCalendarIds: [
        ' holidays@group.v.calendar.google.com ',
        'app@group.calendar.google.com',
      ],
    });
    expect(saved.hiddenGoogleCalendarIds).toEqual([
      'holidays@group.v.calendar.google.com',
    ]);
  });

  it('rejects a non-array hidden calendar list', async () => {
    repo.findOne.mockResolvedValue({
      userId: 'user-1',
      wakeTime: '07:00',
      sleepTime: '22:00',
      minSplitMinutes: 30,
      maxSplitMinutes: 30,
      appGoogleCalendarName: 'AI Calendar Assistant',
    });

    await expect(
      service.updateSettings('user-1', {
        hiddenGoogleCalendarIds: 'primary' as unknown as string[],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
