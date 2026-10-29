import { randomBytes } from 'crypto';

/** Owner emails from `ADMIN_EMAILS` (comma, space or semicolon separated), lowercased. */
export function adminEmails(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.ADMIN_EMAILS || '')
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(
  email: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const clean = (email || '').trim().toLowerCase();
  if (!clean) return false;
  return adminEmails(env).includes(clean);
}

/** Public origin of the admin app, without a trailing slash. Empty when not configured. */
export function adminAppUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env.ADMIN_URL || '').trim();
  if (raw) return raw.replace(/\/+$/, '');
  if (env.NODE_ENV !== 'production') return 'http://localhost:3002';
  return '';
}

/**
 * Local sign-in without Google, for development only.
 * Needs `ADMIN_DEV_LOGIN=1` and is always off in production.
 */
export function adminDevLoginEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === 'production') return false;
  const flag = (env.ADMIN_DEV_LOGIN || '').trim().toLowerCase();
  return flag === '1' || flag === 'true';
}

export const ADMIN_TOKEN_TTL = '12h';
export const ADMIN_LOGIN_STATE = 'admin';

type AdminTicket = { userId: string; expiresAt: number };

/**
 * One-time tickets from the Google callback to the admin app.
 * Module-level so the Google callback can issue them without importing the admin module.
 */
const tickets = new Map<string, AdminTicket>();

export function issueAdminTicket(userId: string, now = Date.now()): string {
  for (const [key, row] of tickets) {
    if (row.expiresAt < now) tickets.delete(key);
  }
  const ticket = randomBytes(24).toString('hex');
  tickets.set(ticket, { userId, expiresAt: now + 120_000 });
  return ticket;
}

export function redeemAdminTicket(ticket: string, now = Date.now()): string | null {
  const row = tickets.get(ticket);
  tickets.delete(ticket);
  if (!row || row.expiresAt < now) return null;
  return row.userId;
}
