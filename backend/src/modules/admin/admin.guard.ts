import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AdminAuthService, AdminPrincipal } from './admin-auth.service';

export type AdminRequest = { headers: Record<string, unknown>; admin?: AdminPrincipal };

/** Admin routes take only an admin-scoped token, never an app session token. */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly auth: AdminAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AdminRequest>();
    const header = req.headers?.authorization;
    const raw = typeof header === 'string' ? header : '';
    const [kind, token] = raw.split(' ');
    if (kind?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException('Missing admin token');
    }
    req.admin = await this.auth.verify(token);
    return true;
  }
}
