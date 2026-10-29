import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';

/** How often one user's `lastActiveAt` is written. */
export const ACTIVITY_WRITE_EVERY_MS = 5 * 60_000;
/** How long a blocked / not-blocked answer is trusted before the row is read again. */
export const BLOCK_CACHE_MS = 30_000;

type CacheRow = { blocked: boolean; revokedAtSec: number | null; checkedAt: number };

/**
 * Per-request access check for an authenticated user.
 * Reads `isBlocked` at most every 30 s per user and writes `lastActiveAt`
 * at most every 5 min, so a busy client does not turn every call into a write.
 */
@Injectable()
export class UserActivityService {
  private readonly logger = new Logger(UserActivityService.name);
  private readonly blockCache = new Map<string, CacheRow>();
  private readonly lastWrite = new Map<string, number>();

  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
  ) {}

  /**
   * True when the user may use the API. Also records activity.
   * `issuedAtSec` is the token's `iat`; tokens older than a "sign out everywhere" are refused.
   */
  async touch(userId: string, now = Date.now(), issuedAtSec?: number): Promise<boolean> {
    if (!userId) return false;
    const row = await this.access(userId, now);
    if (row.blocked) return false;
    if (row.revokedAtSec !== null && typeof issuedAtSec === 'number' && issuedAtSec < row.revokedAtSec) {
      return false;
    }
    const last = this.lastWrite.get(userId) ?? 0;
    if (now - last >= ACTIVITY_WRITE_EVERY_MS) {
      if (this.lastWrite.size > 10_000) this.lastWrite.clear();
      this.lastWrite.set(userId, now);
      try {
        await this.usersRepo.update({ id: userId }, { lastActiveAt: new Date(now) });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`lastActiveAt write failed: ${msg}`);
      }
    }
    return true;
  }

  async isBlocked(userId: string, now = Date.now()): Promise<boolean> {
    return (await this.access(userId, now)).blocked;
  }

  private async access(userId: string, now: number): Promise<CacheRow> {
    const cached = this.blockCache.get(userId);
    if (cached && now - cached.checkedAt < BLOCK_CACHE_MS) return cached;
    const row = await this.usersRepo.findOne({
      where: { id: userId },
      select: { id: true, isBlocked: true, sessionsRevokedAt: true },
    });
    // Only an explicit block stops the call. A missing row keeps the old behaviour:
    // the route decides (for example /auth/me answers 404 after account delete).
    const revoked = row?.sessionsRevokedAt ? new Date(row.sessionsRevokedAt).getTime() : NaN;
    const entry: CacheRow = {
      blocked: row?.isBlocked === true,
      revokedAtSec: Number.isFinite(revoked) ? Math.floor(revoked / 1000) : null,
      checkedAt: now,
    };
    if (this.blockCache.size > 10_000) this.blockCache.clear();
    this.blockCache.set(userId, entry);
    return entry;
  }

  /** Called after the admin changes the flag so the change applies at once. */
  forget(userId: string): void {
    this.blockCache.delete(userId);
  }
}
