import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from '../src/modules/auth/auth.controller';
import { AuthService } from '../src/modules/auth/auth.service';
import { RegisterDto } from '../src/modules/auth/dto/register.dto';
import { LoginDto } from '../src/modules/auth/dto/login.dto';
import { ResetPasswordDto } from '../src/modules/auth/dto/reset-password.dto';
import { ForgotPasswordDto } from '../src/modules/auth/dto/forgot-password.dto';

jest.mock('../src/modules/auth/auth.service');

describe('AuthController', () => {
  let controller: AuthController;
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            registerUser: jest.fn(),
            validateUser: jest.fn(),
            generateNewTokens: jest.fn(),
            resetUserPassword: jest.fn(),
            sendPasswordResetInstructions: jest.fn(),
            logout: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should register a user', async () => {
    const registerDto: RegisterDto = {
      username: 'testuser',
      email: 'test@example.com',
      password: 'password',
      confirmPassword: 'password',
    };
    await controller.register(registerDto);
    expect(service.registerUser).toHaveBeenCalledWith(registerDto);
  });

  it('should login a user', async () => {
    const loginDto: LoginDto = { username: 'testuser', password: 'password' };
    await controller.login(loginDto);
    expect(service.validateUser).toHaveBeenCalledWith(loginDto);
  });

  it('should refresh tokens', async () => {
    const refreshToken = 'some-refresh-token';
    await controller.refreshToken(refreshToken);
    expect(service.generateNewTokens).toHaveBeenCalledWith(refreshToken);
  });

  it('should reset password', async () => {
    const resetPasswordDto: ResetPasswordDto = {
      token: 'reset-token',
      newPassword: 'newpassword',
    };
    await controller.resetPassword(resetPasswordDto);
    expect(service.resetUserPassword).toHaveBeenCalledWith(resetPasswordDto);
  });

  it('should send password reset instructions', async () => {
    const forgotPasswordDto: ForgotPasswordDto = { email: 'test@example.com' };
    await controller.forgotPassword(forgotPasswordDto);
    expect(service.sendPasswordResetInstructions).toHaveBeenCalledWith(
      forgotPasswordDto,
    );
  });

  it('should logout a user', async () => {
    const req = { user: { id: 1 } };
    await controller.logout(req);
    expect(service.logout).toHaveBeenCalledWith(1);
  });
});
