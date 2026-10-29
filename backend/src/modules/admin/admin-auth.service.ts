import { ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import {
  ADMIN_TOKEN_TTL,
  adminDevLoginEnabled,
  isAdminEmail,
  redeemAdminTicket,
} from './admin-config';

export type AdminPrincipal = { userId: string; email: string };
export type AdminSession = { access_token: string; email: string; expiresIn: string };

@Injectable()
export class AdminAuthService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly jwt: JwtService,
  ) {}

  /** Exchange the one-time ticket from the Google callback for an admin token. */
  async redeemTicket(ticket: string): Promise<AdminSession> {
    const userId = redeemAdminTicket(String(ticket || ''));
    if (!userId) throw new UnauthorizedException('Sign-in expired. Try again.');
    const principal = await this.loadAdmin(userId);
    return this.issue(principal);
  }

  /** Development shortcut: sign in by email when ADMIN_DEV_LOGIN=1 outside production. */
  async devLogin(email: string): Promise<AdminSession> {
    if (!adminDevLoginEnabled()) throw new NotFoundException();
    const clean = String(email || '').trim().toLowerCase();
    if (!isAdminEmail(clean)) throw new ForbiddenException('Not an admin email');
    const user = await this.usersRepo
      .createQueryBuilder('user')
      .where('LOWER(user.email) = LOWER(:email)', { email: clean })
      .getOne();
    if (!user) throw new NotFoundException('No account with this email');
    return this.issue(await this.loadAdmin(user.id));
  }

  /** Verify an admin bearer token and re-check the account on every call. */
  async verify(token: string): Promise<AdminPrincipal> {
    let payload: { sub?: string; scope?: string };
    try {
      payload = this.jwt.verify(token);
    } catch {
      throw new UnauthorizedException('Admin session expired');
    }
    if (payload?.scope !== 'admin' || !payload.sub) {
      throw new UnauthorizedException('Not an admin session');
    }
    return this.loadAdmin(payload.sub);
  }

  private async loadAdmin(userId: string): Promise<AdminPrincipal> {
    const user = await this.usersRepo.findOne({
      where: { id: userId },
      select: { id: true, email: true, isBlocked: true },
    });
    // ADMIN_EMAILS is read each time, so removing an email revokes access at once.
    if (!user || user.isBlocked || !isAdminEmail(user.email)) {
      throw new ForbiddenException('Not an admin');
    }
    return { userId: user.id, email: user.email };
  }

  private issue(principal: AdminPrincipal): AdminSession {
    const access_token = this.jwt.sign(
      { sub: principal.userId, scope: 'admin' },
      { expiresIn: ADMIN_TOKEN_TTL },
    );
    return { access_token, email: principal.email, expiresIn: ADMIN_TOKEN_TTL };
  }
}
