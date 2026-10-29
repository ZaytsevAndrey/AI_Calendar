import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../modules/users/user.entity';
import { UserSettings } from '../modules/user-settings/entities/user-settings.entity';
import { VoiceDailyUsage } from '../modules/voice/entities/voice-daily-usage.entity';
import { localYmd } from '../modules/voice/voice-local-date.util';
import { resolveIanaTimeZone } from '../common/iana-time-zone';
import { ClientApiService } from './client-api.service';
import type { AdminPrincipal } from './admin-auth.service';

/** Owner actions on one app account. Each is logged with the admin login. */
@Injectable()
export class AdminActionsService {
  private readonly logger = new Logger('AdminActions');

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(UserSettings) private readonly settings: Repository<UserSettings>,
    @InjectRepository(VoiceDailyUsage) private readonly usage: Repository<VoiceDailyUsage>,
    private readonly client: ClientApiService,
  ) {}

  /**
   * Blocking also refuses every token issued before it (sessionsRevokedAt) and drops
   * the refresh token. The client API applies it at once when /internal is reachable,
   * otherwise within its 30 s cache.
   */
  async setBlocked(admin: AdminPrincipal, userId: string, blocked: boolean) {
    await this.requireUser(userId);
    await this.users.update(
      { id: userId },
      blocked ? { isBlocked: true, refreshToken: null, sessionsRevokedAt: revokeInstant() } : { isBlocked: false },
    );
    const immediate = await this.client.refreshAccess(userId);
    this.logger.warn(`${admin.login} ${blocked ? 'blocked' : 'unblocked'} user ${userId}`);
    return { ok: true, isBlocked: blocked, immediate };
  }

  /** Every JWT issued before now (access and refresh alike) is refused; the stored refresh token is cleared. */
  async revokeSessions(admin: AdminPrincipal, userId: string) {
    await this.requireUser(userId);
    await this.users.update({ id: userId }, { refreshToken: null, sessionsRevokedAt: revokeInstant() });
    const immediate = await this.client.refreshAccess(userId);
    this.logger.warn(`${admin.login} revoked sessions of user ${userId}`);
    return { ok: true, immediate };
  }

  /** Zero today's voice token counter in the user's own zone. History stays. */
  async resetVoiceQuota(admin: AdminPrincipal, userId: string, now = Date.now()) {
    await this.requireUser(userId);
    const settings = await this.settings.findOne({ where: { userId }, select: { id: true, timeZone: true } });
    const dayYmd = localYmd(new Date(now).toISOString(), resolveIanaTimeZone(settings?.timeZone || 'UTC'));
    await this.usage.update({ userId, dayYmd }, { tokensUsed: 0 });
    this.logger.warn(`${admin.login} reset voice quota of user ${userId} for ${dayYmd}`);
    return { ok: true, dayYmd };
  }

  /** Runs in the client API (it owns the Google cleanup). Needs the typed email. */
  async deleteUser(admin: AdminPrincipal, userId: string, confirmation: string) {
    const user = await this.requireUser(userId);
    if ((confirmation || '').trim().toLowerCase() !== user.email.toLowerCase()) {
      throw new BadRequestException('Type the account email to confirm');
    }
    await this.client.deleteUser(userId, user.email);
    this.logger.warn(`${admin.login} deleted user ${userId} (${user.email})`);
    return { ok: true };
  }

  private async requireUser(userId: string): Promise<User> {
    const user = await this.users.findOne({ where: { id: userId }, select: { id: true, email: true } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}

/**
 * JWT `iat` is in whole seconds. Rounding up to the next second also refuses a
 * token issued in the same second; a sign-in a second later works.
 */
export function revokeInstant(now = Date.now()): Date {
  return new Date(Math.ceil((now + 1) / 1000) * 1000);
}
