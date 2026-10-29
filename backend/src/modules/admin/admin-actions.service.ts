import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { UserActivityService } from '../users/user-activity.service';
import { VoiceDailyUsage } from '../voice/entities/voice-daily-usage.entity';
import { VoiceQuotaService } from '../voice/voice-quota.service';
import { AccountDeletionService } from '../auth/account-deletion.service';
import type { AdminPrincipal } from './admin-auth.service';

/** Owner actions on one account. Every action is logged with the admin id. */
@Injectable()
export class AdminActionsService {
  private readonly logger = new Logger('AdminActions');

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(VoiceDailyUsage) private readonly usage: Repository<VoiceDailyUsage>,
    private readonly activity: UserActivityService,
    private readonly quota: VoiceQuotaService,
    private readonly deletion: AccountDeletionService,
  ) {}

  async setBlocked(admin: AdminPrincipal, userId: string, blocked: boolean) {
    if (admin.userId === userId) throw new BadRequestException('You cannot block yourself');
    await this.requireUser(userId);
    // Blocking also drops the refresh token, so the session cannot be renewed.
    await this.users.update(
      { id: userId },
      blocked
        ? { isBlocked: true, refreshToken: null, sessionsRevokedAt: this.revokeInstant() }
        : { isBlocked: false },
    );
    this.activity.forget(userId);
    this.logger.warn(`${admin.email} ${blocked ? 'blocked' : 'unblocked'} user ${userId}`);
    return { ok: true, isBlocked: blocked };
  }

  /**
   * Sign the user out everywhere: every token issued before now is refused at once
   * (access and refresh JWTs alike), and the stored refresh token is cleared.
   */
  async revokeSessions(admin: AdminPrincipal, userId: string) {
    await this.requireUser(userId);
    await this.users.update({ id: userId }, { refreshToken: null, sessionsRevokedAt: this.revokeInstant() });
    this.activity.forget(userId);
    this.logger.warn(`${admin.email} revoked sessions of user ${userId}`);
    return { ok: true };
  }

  /** Zero today's voice token counter (the user's own civil day). History stays. */
  async resetVoiceQuota(admin: AdminPrincipal, userId: string) {
    await this.requireUser(userId);
    const dayYmd = await this.quota.civilDayYmd(userId);
    await this.usage.update({ userId, dayYmd }, { tokensUsed: 0 });
    this.logger.warn(`${admin.email} reset voice quota of user ${userId} for ${dayYmd}`);
    return { ok: true, dayYmd };
  }

  /** Same path as the user deleting their own account, including Google cleanup. */
  async deleteUser(admin: AdminPrincipal, userId: string, confirmation: string) {
    if (admin.userId === userId) throw new BadRequestException('Delete your own account from the app');
    const user = await this.requireUser(userId);
    if ((confirmation || '').trim().toLowerCase() !== user.email.toLowerCase()) {
      throw new BadRequestException('Type the account email to confirm');
    }
    await this.deletion.deleteAccount(userId, user.email);
    this.activity.forget(userId);
    this.logger.warn(`${admin.email} deleted user ${userId} (${user.email})`);
    return { ok: true };
  }

  /**
   * JWT `iat` has whole seconds. Rounding up to the next second means a token
   * issued in the same second as the revoke is refused too; a fresh sign-in
   * one second later works.
   */
  private revokeInstant(now = Date.now()): Date {
    return new Date(Math.ceil((now + 1) / 1000) * 1000);
  }

  private async requireUser(userId: string): Promise<User> {
    const user = await this.users.findOne({ where: { id: userId }, select: { id: true, email: true } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
