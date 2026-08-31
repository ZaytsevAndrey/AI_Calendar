import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from '../src/modules/auth/auth.controller';
import { AuthService } from '../src/modules/auth/auth.service';
import { JwtService } from '@nestjs/jwt';
import { GoogleCalendarService } from '../src/modules/google-calendar/google-calendar.service';

describe('AuthController', () => {
  let controller: AuthController;
  let service: AuthService;
  let googleCalendarService: GoogleCalendarService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            generateNewTokens: jest.fn(),
            logout: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: {
            verify: jest.fn().mockReturnValue({ sub: 'user-1' }),
          },
        },
        {
          provide: GoogleCalendarService,
          useValue: {
            getLoginAuthUrl: jest.fn().mockReturnValue('https://google/auth'),
            redeemLoginTicket: jest.fn().mockReturnValue({
              access_token: 'a',
              refresh_token: 'r',
            }),
          },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    service = module.get<AuthService>(AuthService);
    googleCalendarService = module.get<GoogleCalendarService>(
      GoogleCalendarService,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return Google sign-in URL', () => {
    expect(controller.getGoogleAuthUrl()).toEqual({
      url: 'https://google/auth',
    });
    expect(googleCalendarService.getLoginAuthUrl).toHaveBeenCalled();
  });

  it('should redeem a Google sign-in ticket', () => {
    expect(controller.redeemGoogleSession('ticket-1')).toEqual({
      access_token: 'a',
      refresh_token: 'r',
    });
    expect(googleCalendarService.redeemLoginTicket).toHaveBeenCalledWith(
      'ticket-1',
    );
  });

  it('should refresh tokens', async () => {
    const refreshToken = 'some-refresh-token';
    await controller.refreshToken(refreshToken);
    expect(service.generateNewTokens).toHaveBeenCalledWith(refreshToken);
  });

  it('should logout a user', async () => {
    const req = { headers: { authorization: 'Bearer tok' } };
    await controller.logout(req);
    expect(service.logout).toHaveBeenCalledWith('user-1');
  });
});
