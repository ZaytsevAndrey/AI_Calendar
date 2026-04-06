import { Test, TestingModule } from '@nestjs/testing';
import { GoogleCalendarService } from '../src/modules/google-calendar/google-calendar.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../src/modules/users/user.entity';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';

jest.mock('googleapis', () => ({
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
        list: jest
          .fn()
          .mockResolvedValue({ data: { items: ['event1', 'event2'] } }),
        insert: jest.fn().mockResolvedValue({ data: { id: 'eventId' } }),
        update: jest.fn().mockResolvedValue({ data: { id: 'eventId' } }),
        delete: jest.fn().mockResolvedValue({ data: { success: true } }),
      },
    }),
  },
}));

describe('GoogleCalendarService', () => {
  let service: GoogleCalendarService;
  let userRepo: Repository<User>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoogleCalendarService,
        {
          provide: getRepositoryToken(User),
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
      ],
    }).compile();

    service = module.get<GoogleCalendarService>(GoogleCalendarService);
    userRepo = module.get<Repository<User>>(getRepositoryToken(User));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should generate auth url', () => {
    expect(service.getAuthUrl()).toBe('mock-auth-url');
  });

  it('should save token', async () => {
    const userId = '123';
    const code = 'auth-code';
    const updateSpy = jest
      .spyOn(userRepo, 'update')
      .mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

    const result = await service.saveToken(userId, code);

    expect(result).toEqual({ success: true });
    expect(updateSpy).toHaveBeenCalledWith(userId, {
      googleAccessToken: 'token',
      googleRefreshToken: 'refresh',
      googleTokenExpiry: expect.any(Date),
    });
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

    const result = await service.getEvents(userId, timeMin, timeMax);
    expect(result).toEqual(['event1', 'event2']);
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

    const result = await service.createEvent(userId, event);
    expect(result).toEqual({ id: 'eventId' });
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

    const result = await service.updateEvent(userId, eventId, event);
    expect(result).toEqual({ id: 'eventId' });
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

    const result = await service.deleteEvent(userId, eventId);
    expect(result).toEqual({ success: true });
  });
});
