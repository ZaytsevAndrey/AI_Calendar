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
});
