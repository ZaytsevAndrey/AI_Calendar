import { Test, TestingModule } from '@nestjs/testing';
import { GoogleCalendarService } from './google-calendar.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { UserSettings } from '../user-settings/entities/user-settings.entity';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { EventPhasesService } from '../event-phases/event-phases.service';
import { PhasesService } from '../phases/phases.service';
import { JwtService } from '@nestjs/jwt';

declare global {
  // eslint-disable-next-line no-var
  var __gcalApiTestMocks: {
    eventsInsert: jest.Mock;
    eventsUpdate: jest.Mock;
    eventsDelete: jest.Mock;
    eventsList: jest.Mock;
    calendarsGet: jest.Mock;
    calendarsInsert: jest.Mock;
  };
}

jest.mock('googleapis', () => {
  const m = {
    eventsInsert: jest.fn(),
    eventsUpdate: jest.fn(),
    eventsDelete: jest.fn(),
    eventsList: jest.fn(),
    calendarsGet: jest.fn(),
    calendarsInsert: jest.fn(),
  };
  globalThis.__gcalApiTestMocks = m;
  return {
    google: {
      auth: {
        OAuth2: jest.fn().mockImplementation(() => ({
          generateAuthUrl: jest.fn().mockReturnValue('mock-auth-url'),
          getToken: jest.fn().mockResolvedValue({
            tokens: {
              access_token: 'token',
              refresh_token: 'refresh',
              expiry_date: Date.now() + 10000,
            },
          }),
          setCredentials: jest.fn(),
          refreshAccessToken: jest.fn().mockResolvedValue({
            credentials: {
              access_token: 'new-token',
              expiry_date: Date.now() + 20000,
            },
          }),
        })),
      },
      calendar: jest.fn().mockReturnValue({
        events: {
          list: m.eventsList,
          insert: m.eventsInsert,
          update: m.eventsUpdate,
          delete: m.eventsDelete,
          get: jest.fn().mockResolvedValue({
            data: {
              start: { dateTime: '2024-01-01T10:00:00Z', timeZone: 'UTC' },
              end: { dateTime: '2024-01-01T11:00:00Z', timeZone: 'UTC' },
            },
          }),
          patch: jest.fn().mockResolvedValue({ data: {} }),
        },
        calendars: {
          get: m.calendarsGet,
          insert: m.calendarsInsert,
          patch: jest.fn().mockResolvedValue({ data: {} }),
        },
      }),
      oauth2: jest.fn().mockReturnValue({
        userinfo: {
          get: jest.fn().mockResolvedValue({
            data: { id: 'google-sub', email: 'user@example.com' },
          }),
        },
      }),
    },
  };
});

const g = () => globalThis.__gcalApiTestMocks;

describe('GoogleCalendarService', () => {
  let service: GoogleCalendarService;
  let userRepo: Repository<User>;
  let userSettingsRepo: Repository<UserSettings>;

  beforeEach(async () => {
    jest.clearAllMocks();
    g().eventsInsert.mockResolvedValue({ data: { id: 'eventId' } });
    g().eventsUpdate.mockResolvedValue({ data: { id: 'eventId' } });
    g().eventsDelete.mockResolvedValue({ data: { success: true } });
    g().eventsList.mockResolvedValue({
      data: { items: ['event1', 'event2'] },
    });
    g().calendarsGet.mockResolvedValue({ data: {} });
    g().calendarsInsert.mockResolvedValue({
      data: { id: 'app-calendar@test.google.com' },
    });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoogleCalendarService,
        {
          provide: getRepositoryToken(User),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(UserSettings),
          useClass: Repository,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key) => {
              if (key === 'GOOGLE_CLIENT_ID') return 'client_id';
              if (key === 'GOOGLE_CLIENT_SECRET') return 'client_secret';
              if (key === 'GOOGLE_REDIRECT_URI') return 'redirect_uri';
              return null;
            }),
          },
        },
        {
          provide: EventPhasesService,
          useValue: {
            create: jest.fn(),
            update: jest.fn(),
            remove: jest.fn(),
            findByEvent: jest.fn().mockResolvedValue(null),
          },
        },
        {
          provide: PhasesService,
          useValue: {
            findOne: jest.fn().mockResolvedValue({ color: '#2980b9' }),
          },
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn().mockReturnValue('jwt-token'),
          },
        },
      ],
    }).compile();

    service = module.get<GoogleCalendarService>(GoogleCalendarService);
    userRepo = module.get<Repository<User>>(getRepositoryToken(User));
    userSettingsRepo = module.get<Repository<UserSettings>>(
      getRepositoryToken(UserSettings),
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should generate auth url', () => {
    expect(service.getAuthUrl()).toBe('mock-auth-url');
    expect(service.getLoginAuthUrl()).toBe('mock-auth-url');
  });

  it('should link Google sign-in to an existing user by email', async () => {
    const existing = { id: 'existing-user', email: 'user@example.com' } as User;
    jest.spyOn(userRepo, 'findOne').mockResolvedValue(null);
    jest.spyOn(userRepo, 'createQueryBuilder').mockReturnValue({
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(existing),
    } as any);
    jest
      .spyOn(userRepo, 'update')
      .mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
    jest.spyOn(userSettingsRepo, 'findOne').mockResolvedValue({
      userId: existing.id,
      googleCalendarLinked: false,
      appGoogleCalendarId: 'app-calendar@test.google.com',
    } as UserSettings);
    jest
      .spyOn(userSettingsRepo, 'update')
      .mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

    const ticket = await service.completeGoogleSignIn('auth-code');
    expect(typeof ticket).toBe('string');
    expect(ticket.length).toBeGreaterThan(8);
    const session = service.redeemLoginTicket(ticket);
    expect(session.access_token).toBe('jwt-token');
    expect(session.refresh_token).toBe('jwt-token');
  });

  it('should save token', async () => {
    const userId = '123';
    const code = 'auth-code';
    const updateSpy = jest
      .spyOn(userRepo, 'update')
      .mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
    jest.spyOn(userSettingsRepo, 'update').mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
    jest.spyOn(userRepo, 'findOne').mockResolvedValue({ id: userId } as User);
    jest.spyOn(userSettingsRepo, 'findOne').mockResolvedValue({
      appGoogleCalendarId: null,
      appGoogleCalendarName: 'AI Calendar Assistant',
    } as UserSettings);

    const result = await service.saveToken(code, userId);

    expect(result).toEqual({ success: true });
    expect(updateSpy).toHaveBeenCalledWith(userId, {
      googleAccessToken: 'token',
      googleRefreshToken: 'refresh',
      googleTokenExpiry: expect.any(Date),
    });
    expect(g().calendarsInsert).toHaveBeenCalled();
  });

  it('should check connection - connected', async () => {
    const userId = '123';
    const user = {
      googleAccessToken: 'valid-token',
      googleRefreshToken: 'refresh-token',
      googleTokenExpiry: new Date(Date.now() + 10000),
    };

    jest.spyOn(userRepo, 'findOne').mockResolvedValue(user as User);

    const result = await service.checkConnection(userId);
    expect(result).toEqual({ connected: true });
  });

  it('should check connection - not connected', async () => {
    const userId = '123';
    jest.spyOn(userRepo, 'findOne').mockResolvedValue(null);

    const result = await service.checkConnection(userId);
    expect(result).toEqual({ connected: false });
  });

  it('should get events', async () => {
    const userId = '123';
    const timeMin = '2024-01-01T00:00:00Z';
    const timeMax = '2024-01-02T00:00:00Z';
    const user = {
      googleAccessToken: 'valid-token',
      googleRefreshToken: 'refresh-token',
      googleTokenExpiry: new Date(Date.now() + 10000),
    };

    jest.spyOn(userRepo, 'findOne').mockResolvedValue(user as User);
    jest.spyOn(userSettingsRepo, 'findOne').mockResolvedValue({
      appGoogleCalendarId: 'app-cal@test.google.com',
    } as UserSettings);

    const result = await service.getEvents(userId, timeMin, timeMax);
    expect(result).toEqual({
      events: ['event1', 'event2'],
      nextPageToken: undefined,
      totalEvents: 2,
    });
  });

  it('should create event', async () => {
    const userId = '123';
    const event = { summary: 'Test Event' };
    const user = {
      googleAccessToken: 'valid-token',
      googleRefreshToken: 'refresh-token',
      googleTokenExpiry: new Date(Date.now() + 10000),
    };

    jest.spyOn(userRepo, 'findOne').mockResolvedValue(user as User);
    jest.spyOn(userSettingsRepo, 'findOne').mockResolvedValue({
      appGoogleCalendarId: null,
      appGoogleCalendarName: 'My App Cal',
    } as UserSettings);
    jest.spyOn(userSettingsRepo, 'update').mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

    const result = await service.createEvent(userId, event);
    expect(result).toMatchObject({
      id: 'eventId',
      appCalendarId: 'app-calendar@test.google.com',
    });
    expect(g().eventsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: 'app-calendar@test.google.com',
      }),
    );
  });

  it('should update event', async () => {
    const userId = '123';
    const eventId = 'event123';
    const event = { summary: 'Updated Event' };
    const user = {
      googleAccessToken: 'valid-token',
      googleRefreshToken: 'refresh-token',
      googleTokenExpiry: new Date(Date.now() + 10000),
    };

    jest.spyOn(userRepo, 'findOne').mockResolvedValue(user as User);
    jest.spyOn(userSettingsRepo, 'findOne').mockResolvedValue({
      appGoogleCalendarId: 'app-cal@test.google.com',
    } as UserSettings);

    const result = await service.updateEvent(userId, eventId, event);
    expect(result).toMatchObject({
      id: 'eventId',
      appCalendarId: 'app-cal@test.google.com',
    });
  });

  it('should delete event', async () => {
    const userId = '123';
    const eventId = 'event123';
    const user = {
      googleAccessToken: 'valid-token',
      googleRefreshToken: 'refresh-token',
      googleTokenExpiry: new Date(Date.now() + 10000),
    };

    jest.spyOn(userRepo, 'findOne').mockResolvedValue(user as User);
    jest.spyOn(userSettingsRepo, 'findOne').mockResolvedValue({
      appGoogleCalendarId: 'app-cal@test.google.com',
    } as UserSettings);

    const result = await service.deleteEvent(userId, eventId);
    expect(result).toEqual({ success: true });
  });
});
