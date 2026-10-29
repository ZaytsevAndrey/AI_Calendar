import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UserActivityService } from '../users/user-activity.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly activity: UserActivityService,
  ) {
    const secret = configService.get<string>('JWT_SECRET');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: any) {
    // Admin-console tokens are only for /admin. They never act as an app session.
    if (payload?.scope === 'admin') {
      throw new UnauthorizedException('Admin token is not an app session');
    }
    const allowed = await this.activity.touch(payload?.sub, Date.now(), payload?.iat);
    if (!allowed) {
      throw new UnauthorizedException({
        code: 'SESSION_REVOKED',
        message: 'This session is no longer valid. Sign in again.',
      });
    }
    return { userId: payload.sub, username: payload.username };
  }
}
