import { HttpException, HttpStatus, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { AdminUser } from '../modules/admin-data/entities/admin-user.entity';
import { ADMIN_TOKEN_TTL } from './admin-config';

export type AdminPrincipal = { id: string; login: string };
export type AdminSession = { access_token: string; login: string; expiresIn: string };

/** Failed logins allowed per login+address before a pause. */
export const MAX_FAILURES = 5;
export const LOCK_MS = 15 * 60_000;

type Failures = { count: number; first: number; lockedUntil: number };

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger('AdminAuth');
  private readonly failures = new Map<string, Failures>();
  private dummyHash: Promise<string> | null = null;

  constructor(
    @InjectRepository(AdminUser)
    private readonly admins: Repository<AdminUser>,
    private readonly jwt: JwtService,
  ) {}

  async login(loginRaw: unknown, passwordRaw: unknown, ip: string, now = Date.now()): Promise<AdminSession> {
    const login = String(loginRaw ?? '').trim().toLowerCase().slice(0, 64);
    const password = String(passwordRaw ?? '');
    const key = `${login}|${ip}`;
    this.assertNotLocked(key, now);

    const admin = login ? await this.admins.findOne({ where: { login } }) : null;
    // Compare against a throwaway hash when the login is unknown, so timing does not reveal it.
    const hash = admin?.passwordHash ?? (await this.getDummyHash());
    const ok = password.length > 0 && (await bcrypt.compare(password, hash));

    if (!admin || !ok || !admin.isActive) {
      this.noteFailure(key, now);
      this.logger.warn(`failed admin login for "${login}" from ${ip}`);
      throw new UnauthorizedException('Wrong login or password');
    }
    this.failures.delete(key);
    await this.admins.update({ id: admin.id }, { lastLoginAt: new Date(now) });
    this.logger.log(`admin "${admin.login}" signed in from ${ip}`);
    const access_token = this.jwt.sign({ sub: admin.id, scope: 'admin' }, { expiresIn: ADMIN_TOKEN_TTL });
    return { access_token, login: admin.login, expiresIn: ADMIN_TOKEN_TTL };
  }

  /** Every call re-reads the row, so deactivating an admin cuts access at once. */
  async verify(token: string): Promise<AdminPrincipal> {
    let payload: { sub?: string; scope?: string };
    try {
      payload = this.jwt.verify(token);
    } catch {
      throw new UnauthorizedException('Admin session expired');
    }
    if (payload?.scope !== 'admin' || !payload.sub) throw new UnauthorizedException('Not an admin session');
    const admin = await this.admins.findOne({ where: { id: payload.sub }, select: { id: true, login: true, isActive: true } });
    if (!admin || !admin.isActive) throw new UnauthorizedException('Admin account is disabled');
    return { id: admin.id, login: admin.login };
  }

  private assertNotLocked(key: string, now: number): void {
    const row = this.failures.get(key);
    if (row && row.lockedUntil > now) {
      const minutes = Math.ceil((row.lockedUntil - now) / 60_000);
      throw new HttpException(`Too many attempts. Try again in ${minutes} min.`, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private noteFailure(key: string, now: number): void {
    if (this.failures.size > 5000) this.failures.clear();
    const row = this.failures.get(key);
    if (!row || now - row.first > LOCK_MS) {
      this.failures.set(key, { count: 1, first: now, lockedUntil: 0 });
      return;
    }
    row.count += 1;
    if (row.count >= MAX_FAILURES) row.lockedUntil = now + LOCK_MS;
  }

  private getDummyHash(): Promise<string> {
    if (!this.dummyHash) this.dummyHash = bcrypt.hash(randomBytes(16).toString('hex'), 12);
    return this.dummyHash;
  }
}
