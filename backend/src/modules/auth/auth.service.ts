import { Injectable, Logger } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, UpdateResult } from 'typeorm';
import { randomBytes } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { Req } from '@nestjs/common';

import { User } from '../users/user.entity';
import { RegisterDto } from './dto/register.dto';
import { ApiError } from '../common/types/errors';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { EmailService } from '../common/services/email.service';
import { hashPassword } from './utils/hashPassword';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly emailService: EmailService,
    private readonly jwtService: JwtService,
  ) {}

  async registerUser(dto: RegisterDto): Promise<void> {
    const { email, password, confirmPassword } = dto;

    if (password !== confirmPassword) {
      throw new ApiError('PASSWORDS_DO_NOT_MATCH', {
        confirmPassword: 'Passwords do not match',
      });
    }

    const existing = await this.usersRepo.findOneBy({ email });
    if (existing) {
      throw new ApiError('EMAIL_ALREADY_EXISTS', {
        email: 'This email is already in use',
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = this.usersRepo.create({
      email,
      password: passwordHash,
      isEmailVerified: false,
    });

    await this.usersRepo.save(user);

    await this.emailService.sendEmail(
      email,
      'Welcome!',
      'Thank you for registering!',
    );
  }

  async validateUser(
    dto: LoginDto,
  ): Promise<{ access_token: string; refresh_token: string }> {
    const { username, password } = dto;
    const user = await this.usersRepo.findOneBy({ email: username });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw new ApiError('INVALID_CREDENTIALS', {
        username: 'Incorrect email or password',
      });
    }

    const tokens = this.createTokenPair(user.id.toString());
    await this.setRefreshToken(user.id.toString(), tokens.refresh_token);
    return tokens;
  }

  async generateNewTokens(
    refreshToken: string,
  ): Promise<{ access_token: string; refresh_token: string }> {
    const user = await this.getUserIfRefreshTokenMatches(refreshToken);

    if (!user) {
      throw new ApiError('INVALID_REFRESH_TOKEN', {
        refreshToken: 'Invalid refresh token',
      });
    }

    const tokens = this.createTokenPair(user.id.toString());
    await this.setRefreshToken(user.id.toString(), tokens.refresh_token);
    return tokens;
  }

  async resetUserPassword(dto: ResetPasswordDto): Promise<void> {
    const { token, newPassword } = dto;
    this.logger.log(`Resetting password with token: ${token}`);

    const user = await this.getUserByResetToken(token);

    if (!user) {
      this.logger.error(`Invalid reset token: ${token}`);
      throw new ApiError('INVALID_RESET_TOKEN', {
        token: 'Invalid reset token',
      });
    }

    this.logger.log(`Found user with email: ${user.email} for reset token`);

    // Log the new password with emphasis for better visibility
    this.logger.log('==================================================');
    this.logger.log(`NEW PASSWORD FOR USER ${user.email}: ${newPassword}`);
    this.logger.log('==================================================');

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    this.logger.log(`Password hashed successfully`);

    await this.updatePassword(user.id.toString(), hashedPassword);
    this.logger.log(`Password updated for user ID: ${user.id}`);

    user.resetToken = null;
    await this.usersRepo.save(user);
    this.logger.log(`Reset token cleared for user ID: ${user.id}`);

    this.emailService.sendEmail(
      user.email,
      'Password Reset',
      'Your password has been reset successfully.',
    );
    this.logger.log(`Password reset confirmation email sent to: ${user.email}`);
  }

  async generateAndSendCode(email: string): Promise<void> {
    this.logger.log(`Generating verification code for email: ${email}`);
    const user = await this.usersRepo.findOneBy({ email });

    if (!user) {
      this.logger.error(`Email not found: ${email}`);
      throw new ApiError('EMAIL_NOT_FOUND', {
        email: 'Email not found',
      });
    }

    const code = this.generateVerificationCode();
    this.logger.log(`Verification code generated for ${email}: ${code}`);

    await this.sendVerificationEmail(user.email, code);
    this.logger.log(`Verification email sent to: ${email}`);
  }

  async sendPasswordResetInstructions(dto: ForgotPasswordDto): Promise<void> {
    const { email } = dto;
    this.logger.log(`Processing forgot password request for: ${email}`);

    const user = await this.usersRepo.findOneBy({ email });

    if (!user) {
      this.logger.error(`Email not found for password reset: ${email}`);
      throw new ApiError('EMAIL_NOT_FOUND', {
        email: 'Email not found',
      });
    }

    this.logger.log(
      `User found for password reset: ${user.email} (ID: ${user.id})`,
    );

    const resetToken = this.generateResetToken();
    this.logger.log(`Generated reset token: ${resetToken}`);

    user.resetToken = resetToken;
    await this.usersRepo.save(user);
    this.logger.log(`Reset token saved for user: ${user.email}`);

    await this.sendPasswordResetEmail(user.email, resetToken);
    this.logger.log(`Password reset instructions sent to: ${email}`);
  }

  createTokenPair(userId: string): {
    access_token: string;
    refresh_token: string;
  } {
    const payload = { sub: userId };
    const access_token = this.jwtService.sign(payload, { expiresIn: '15m' });
    const refresh_token = this.jwtService.sign(payload, { expiresIn: '7d' });
    return { access_token, refresh_token };
  }

  private async setRefreshToken(userId: string, token: string): Promise<void> {
    await this.usersRepo.update({ id: userId }, { refreshToken: token });
  }

  private async getUserIfRefreshTokenMatches(
    token: string,
  ): Promise<User | null> {
    const user = await this.usersRepo.findOne({
      where: { refreshToken: token },
    });
    return user;
  }

  private async getUserByResetToken(token: string): Promise<User | null> {
    return this.usersRepo.findOne({ where: { resetToken: token } });
  }

  private generateVerificationCode(): string {
    // Generate a 6-digit verification code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    this.logger.log(`Generated verification code: ${code}`);
    return code;
  }

  private async sendVerificationEmail(
    email: string,
    code: string,
  ): Promise<void> {
    this.logger.log(
      `Sending verification email to: ${email} with code: ${code}`,
    );
    const subject = 'Your Verification Code';
    const text = `Your verification code is: ${code}. It will expire in 10 minutes.`;

    await this.emailService.sendEmail(email, subject, text);
    this.logger.log(`Verification email sent successfully to: ${email}`);
  }

  private generateResetToken(): string {
    return randomBytes(32).toString('hex');
  }

  private async sendPasswordResetEmail(
    email: string,
    token: string,
  ): Promise<void> {
    const resetLink = `${process.env.APP_URL}/reset-password?token=${token}`;
    this.logger.log(`Reset link generated: ${resetLink}`);

    const subject = 'Password Reset Instructions';
    const text = `To reset your password, please click the following link: ${resetLink}`;

    await this.emailService.sendEmail(email, subject, text);
    this.logger.log(`Password reset email sent to: ${email}`);
  }

  async updatePassword(
    userId: string,
    newPassword: string,
  ): Promise<UpdateResult> {
    return this.usersRepo.update({ id: userId }, { password: newPassword });
  }

  async logout(userId: string): Promise<void> {
    this.logger.log(`Logging out user with ID: ${userId}`);
    await this.usersRepo.update({ id: userId }, { refreshToken: null });
    this.logger.log(`User with ID: ${userId} logged out successfully`);
  }

  async findUserByEmail(email: string): Promise<User | null> {
    return this.usersRepo.findOneBy({ email });
  }

  async createUser(dto: { email: string; password: string }): Promise<User> {
    const { email, password } = dto;
    const passwordHash = await bcrypt.hash(password, 10);

    const user = this.usersRepo.create({
      email,
      password: passwordHash,
      isEmailVerified: false,
    });

    return this.usersRepo.save(user);
  }

  async register(email: string, password: string): Promise<User> {
    const existingUser = await this.usersRepo.findOne({ where: { email } });

    if (existingUser) {
      throw new ApiError('USER_ALREADY_EXISTS', {
        email: 'A user with this email already exists',
      });
    }

    const hashedPassword = await hashPassword(password);

    const user = this.usersRepo.create({
      email,
      password: hashedPassword,
    });

    return this.usersRepo.save(user);
  }
}
