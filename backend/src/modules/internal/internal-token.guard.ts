import { CanActivate, ExecutionContext, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

/** Minimum length for INTERNAL_API_TOKEN; shorter values keep the routes off. */
export const INTERNAL_TOKEN_MIN_LENGTH = 32;

export function internalTokenConfigured(env: NodeJS.ProcessEnv = process.env): string | null {
  const token = (env.INTERNAL_API_TOKEN || '').trim();
  return token.length >= INTERNAL_TOKEN_MIN_LENGTH ? token : null;
}

export function tokensMatch(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Service-to-service calls from the admin API only.
 * Without INTERNAL_API_TOKEN the /internal routes do not exist (404).
 */
@Injectable()
export class InternalTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = internalTokenConfigured();
    if (!expected) throw new NotFoundException();
    const req = context.switchToHttp().getRequest<{ headers: Record<string, unknown> }>();
    const given = req.headers?.['x-internal-token'];
    if (typeof given !== 'string' || !tokensMatch(given, expected)) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
