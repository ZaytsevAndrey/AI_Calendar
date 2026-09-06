import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';

import { User } from '../users/user.entity';
import { ApiError } from '../common/types/errors';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly jwtService: JwtService,
  ) {}

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

  createTokenPair(userId: string): {
    access_token: string;
    refresh_token: string;
  } {
    const payload = { sub: userId };
    const access_token = this.jwtService.sign(payload, { expiresIn: '15m' });
    const refresh_token = this.jwtService.sign(payload, { expiresIn: '7d' });
    return { access_token, refresh_token };
  }

  async logout(userId: string): Promise<void> {
    this.logger.log(`Logging out user with ID: ${userId}`);
    await this.usersRepo.update({ id: userId }, { refreshToken: null });
    this.logger.log(`User with ID: ${userId} logged out successfully`);
  }

  private async setRefreshToken(userId: string, token: string): Promise<void> {
    await this.usersRepo.update({ id: userId }, { refreshToken: token });
  }

  private async getUserIfRefreshTokenMatches(
    token: string,
  ): Promise<User | null> {
    return this.usersRepo.findOne({
      where: { refreshToken: token },
    });
  }
}
