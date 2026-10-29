import { HttpException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { adminJwtSecret, adminAppOrigin, clientApiUrl, parseTokenLimit } from './admin-config';
import { AdminAuthService, MAX_FAILURES, LOCK_MS } from './admin-auth.service';
import { AdminActionsService, revokeInstant } from './admin-actions.service';
import { summarizeVoiceTurn } from '../modules/admin-data/voice-turn-log.service';
import { integrationStatus } from '../modules/internal/integration-status';
import { tokensMatch, internalTokenConfigured } from '../modules/internal/internal-token.guard';
import { reportApiError, setApiErrorSink, toApiErrorEntry } from '../common/api-error-sink';
import { lastUtcDays, percentile } from './admin-time';
import { UserActivityService, ACTIVITY_WRITE_EVERY_MS } from '../modules/users/user-activity.service';

jest.mock('bcrypt', () => ({
  hash: jest.fn(async (s: string) => `h:${s}`),
  compare: jest.fn(async (plain: string, hash: string) => hash === `h:${plain}`),
}));

const ADMIN = { id: 'aaaaaaaa-1111-4111-8111-111111111111', login: 'owner', passwordHash: 'h:correct horse', isActive: true };
const OTHER = { id: '22222222-2222-4222-8222-222222222222', email: 'user@example.com', isBlocked: false };
const SECRET = 'x'.repeat(40);

function adminsRepo(rows: Array<typeof ADMIN>) {
  return {
    findOne: jest.fn(async ({ where }: { where: { id?: string; login?: string } }) =>
      rows.find((r) => (where.id ? r.id === where.id : r.login === where.login)) ?? null,
    ),
    update: jest.fn(async () => ({ affected: 1 })),
  };
}

describe('admin config', () => {
  it('requires a long admin secret that differs from the client one', () => {
    expect(() => adminJwtSecret({} as NodeJS.ProcessEnv)).toThrow('ADMIN_JWT_SECRET');
    expect(() => adminJwtSecret({ ADMIN_JWT_SECRET: 'short' } as NodeJS.ProcessEnv)).toThrow();
    expect(() => adminJwtSecret({ ADMIN_JWT_SECRET: SECRET, JWT_SECRET: SECRET } as NodeJS.ProcessEnv)).toThrow('must not equal');
    expect(adminJwtSecret({ ADMIN_JWT_SECRET: SECRET, JWT_SECRET: 'other' } as NodeJS.ProcessEnv)).toBe(SECRET);
  });

  it('defaults to localhost only outside production', () => {
    expect(adminAppOrigin({} as NodeJS.ProcessEnv)).toBe('http://localhost:3002');
    expect(adminAppOrigin({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe('');
    expect(clientApiUrl({ CLIENT_API_URL: 'https://api.example.com/' } as NodeJS.ProcessEnv)).toBe('https://api.example.com');
    expect(clientApiUrl({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe('');
  });

  it('reads the voice limit like the client does', () => {
    expect(parseTokenLimit(null)).toBe(100_000);
    expect(parseTokenLimit('0')).toBe(0);
    expect(parseTokenLimit('-5')).toBe(100_000);
    expect(parseTokenLimit('25000')).toBe(25_000);
  });
});

describe('AdminAuthService', () => {
  const jwt = new JwtService({ secret: SECRET });

  it('signs in with login and password and returns an admin-scoped token', async () => {
    const repo = adminsRepo([ADMIN]);
    const svc = new AdminAuthService(repo as never, jwt);
    const session = await svc.login(' Owner ', 'correct horse', '1.1.1.1');
    expect(session.login).toBe('owner');
    expect(jwt.verify(session.access_token)).toMatchObject({ sub: ADMIN.id, scope: 'admin' });
    expect(repo.update).toHaveBeenCalledWith({ id: ADMIN.id }, { lastLoginAt: expect.any(Date) });
    await expect(svc.verify(session.access_token)).resolves.toEqual({ id: ADMIN.id, login: 'owner' });
  });

  it('gives the same answer for a wrong password and an unknown login', async () => {
    const svc = new AdminAuthService(adminsRepo([ADMIN]) as never, jwt);
    await expect(svc.login('owner', 'nope', 'ip')).rejects.toThrow('Wrong login or password');
    await expect(svc.login('ghost', 'nope', 'ip')).rejects.toThrow('Wrong login or password');
    expect(bcrypt.compare).toHaveBeenCalled();
  });

  it('refuses a disabled admin, at login and on an existing token', async () => {
    const row = { ...ADMIN };
    const svc = new AdminAuthService(adminsRepo([row]) as never, jwt);
    const session = await svc.login('owner', 'correct horse', 'ip');
    row.isActive = false;
    await expect(svc.verify(session.access_token)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(svc.login('owner', 'correct horse', 'ip')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses tokens that are not admin-scoped or signed with another key', async () => {
    const svc = new AdminAuthService(adminsRepo([ADMIN]) as never, jwt);
    await expect(svc.verify(jwt.sign({ sub: ADMIN.id }))).rejects.toBeInstanceOf(UnauthorizedException);
    const clientToken = new JwtService({ secret: 'client-secret' }).sign({ sub: ADMIN.id, scope: 'admin' });
    await expect(svc.verify(clientToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it(`pauses a login+address after ${MAX_FAILURES} failures, even for the right password`, async () => {
    const svc = new AdminAuthService(adminsRepo([ADMIN]) as never, jwt);
    const t0 = 1_000_000;
    for (let i = 0; i < MAX_FAILURES; i += 1) {
      await expect(svc.login('owner', 'bad', 'ip', t0 + i)).rejects.toBeInstanceOf(UnauthorizedException);
    }
    await expect(svc.login('owner', 'correct horse', 'ip', t0 + 10)).rejects.toBeInstanceOf(HttpException);
    await expect(svc.login('owner', 'correct horse', 'other-ip', t0 + 10)).resolves.toMatchObject({ login: 'owner' });
    await expect(svc.login('owner', 'correct horse', 'ip', t0 + LOCK_MS + 20)).resolves.toMatchObject({ login: 'owner' });
  });
});

describe('AdminActionsService', () => {
  const admin = { id: ADMIN.id, login: 'owner' };
  const make = () => {
    const users = {
      findOne: jest.fn(async ({ where }: { where: { id: string } }) => (where.id === OTHER.id ? OTHER : null)),
      update: jest.fn(async () => ({ affected: 1 })),
    };
    const settings = { findOne: jest.fn(async () => ({ id: 's', timeZone: 'Asia/Nicosia' })) };
    const usage = { update: jest.fn(async () => ({ affected: 1 })) };
    const client = { refreshAccess: jest.fn(async () => true), deleteUser: jest.fn(async () => ({ ok: true })) };
    const svc = new AdminActionsService(users as never, settings as never, usage as never, client as never);
    return { svc, users, usage, client };
  };

  it('blocks: flag, revoke time, no refresh token, and tells the client', async () => {
    const { svc, users, client } = make();
    await expect(svc.setBlocked(admin, OTHER.id, true)).resolves.toMatchObject({ ok: true, immediate: true });
    expect(users.update).toHaveBeenCalledWith(
      { id: OTHER.id },
      { isBlocked: true, refreshToken: null, sessionsRevokedAt: expect.any(Date) },
    );
    expect(client.refreshAccess).toHaveBeenCalledWith(OTHER.id);
  });

  it('resets today in the user zone, not UTC', async () => {
    const { svc, usage } = make();
    // 23:30 UTC on the 28th is already the 29th in Nicosia (UTC+2).
    const res = await svc.resetVoiceQuota(admin, OTHER.id, Date.parse('2026-10-28T23:30:00Z'));
    expect(res.dayYmd).toBe('2026-10-29');
    expect(usage.update).toHaveBeenCalledWith({ userId: OTHER.id, dayYmd: '2026-10-29' }, { tokensUsed: 0 });
  });

  it('delete needs the typed email and runs in the client API', async () => {
    const { svc, client } = make();
    await expect(svc.deleteUser(admin, OTHER.id, 'wrong@example.com')).rejects.toThrow('confirm');
    await svc.deleteUser(admin, OTHER.id, ' USER@example.com ');
    expect(client.deleteUser).toHaveBeenCalledWith(OTHER.id, OTHER.email);
  });

  it('revoke time lands on the next whole second', () => {
    const t = revokeInstant(Date.parse('2026-10-29T12:00:00.300Z'));
    expect(t.toISOString()).toBe('2026-10-29T12:00:01.000Z');
  });
});

describe('internal token', () => {
  it('is off unless long enough, and compares exactly', () => {
    expect(internalTokenConfigured({ INTERNAL_API_TOKEN: 'short' } as NodeJS.ProcessEnv)).toBeNull();
    expect(internalTokenConfigured({ INTERNAL_API_TOKEN: SECRET } as NodeJS.ProcessEnv)).toBe(SECRET);
    expect(tokensMatch(SECRET, SECRET)).toBe(true);
    expect(tokensMatch(SECRET.slice(1), SECRET)).toBe(false);
    expect(tokensMatch(`${SECRET.slice(1)}y`, SECRET)).toBe(false);
  });
});

describe('api error sink', () => {
  afterEach(() => setApiErrorSink(null));

  it('strips the query, keeps a uuid user id only, and skips 401/404', async () => {
    const seen: unknown[] = [];
    setApiErrorSink((e) => {
      seen.push(e);
    });
    reportApiError({ method: 'GET', url: '/tasks?token=abc', status: 401, message: 'x' });
    reportApiError({ method: 'GET', url: '/nope', status: 404, message: 'x' });
    reportApiError({ method: 'POST', url: '/voice/turn?x=1', status: 500, message: ['a', 'b'], userId: OTHER.id });
    await new Promise((r) => setImmediate(r));
    expect(seen).toEqual([
      { method: 'POST', path: '/voice/turn', status: 500, code: null, message: 'a; b', userId: OTHER.id },
    ]);
    expect(toApiErrorEntry({ status: 500, message: 'x', userId: 'not-a-uuid' }).userId).toBeNull();
  });

  it('a throwing sink never breaks the response path', () => {
    setApiErrorSink(() => {
      throw new Error('db down');
    });
    expect(() => reportApiError({ status: 500, message: 'x' })).not.toThrow();
  });
});

describe('UserActivityService', () => {
  it('writes lastActiveAt at most every few minutes and stops blocked users', async () => {
    const row = { ...OTHER };
    const repo = { findOne: jest.fn(async () => row), update: jest.fn(async () => ({ affected: 1 })) };
    const svc = new UserActivityService(repo as never);
    const t0 = 1_000_000;
    await expect(svc.touch(OTHER.id, t0)).resolves.toBe(true);
    await svc.touch(OTHER.id, t0 + 1000);
    expect(repo.update).toHaveBeenCalledTimes(1);
    await svc.touch(OTHER.id, t0 + ACTIVITY_WRITE_EVERY_MS + 1);
    expect(repo.update).toHaveBeenCalledTimes(2);
    row.isBlocked = true;
    svc.forget(OTHER.id);
    await expect(svc.touch(OTHER.id, t0 + ACTIVITY_WRITE_EVERY_MS + 2)).resolves.toBe(false);
  });

  it('refuses tokens issued before a sign-out-everywhere, accepts newer ones', async () => {
    const revokedAt = new Date('2026-10-29T12:00:00.000Z');
    const repo = { findOne: jest.fn(async () => ({ ...OTHER, sessionsRevokedAt: revokedAt })), update: jest.fn() };
    const svc = new UserActivityService(repo as never);
    const sec = revokedAt.getTime() / 1000;
    await expect(svc.touch(OTHER.id, Date.now(), sec - 3600)).resolves.toBe(false);
    await expect(svc.touch(OTHER.id, Date.now(), sec)).resolves.toBe(true);
  });

  it('leaves a deleted account to the route, as before', async () => {
    const svc = new UserActivityService({ findOne: async () => null, update: jest.fn() } as never);
    await expect(svc.touch(OTHER.id)).resolves.toBe(true);
  });
});

describe('voice turn summary', () => {
  it('counts model calls and tokens and keeps no free text', () => {
    const row = summarizeVoiceTurn({
      traceId: 't1',
      userId: OTHER.id,
      method: 'POST',
      url: '/voice/agent?x=1',
      statusCode: 200,
      totalMs: 1234.4,
      steps: [
        { kind: 'llm', name: 'planner', via: 'groq/llama', ms: 800, ok: true, tokens: 900, reason: 'timeout,rate_limit' },
        { kind: 'llm', name: 'planner', via: 'gemini', ms: 200, ok: true, tokens: 100, valid: false, errorCode: 'bad_json' },
        { kind: 'other', name: 'planner.fault', via: '', ms: 0, ok: false, reason: 'Cannot plan "Call mom" now' },
      ],
    });
    expect(row).toMatchObject({ path: '/voice/agent', totalMs: 1234, llmCalls: 2, llmMs: 1000, tokens: 1000, failedSteps: 2, errorCode: 'bad_json' });
    const steps = JSON.parse(row.stepsJson);
    expect(steps[0].reason).toBe('timeout,rate_limit');
    expect(steps[2].reason).toBe('free_text_omitted');
    expect(row.stepsJson).not.toContain('mom');
  });
});

describe('integration status', () => {
  it('reports only whether keys are set, never their values', () => {
    const list = integrationStatus({ GROQ_API_KEY: 'secret-key', GOOGLE_CLIENT_ID: 'id' } as NodeJS.ProcessEnv);
    expect(list.find((i) => i.key === 'groq')?.configured).toBe(true);
    expect(list.find((i) => i.key === 'google')?.configured).toBe(false);
    expect(JSON.stringify(list)).not.toContain('secret-key');
  });
});

describe('admin time helpers', () => {
  it('lists UTC days oldest first and computes percentiles', () => {
    expect(lastUtcDays(3, Date.parse('2026-10-29T12:00:00Z'))).toEqual(['2026-10-27', '2026-10-28', '2026-10-29']);
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([], 50)).toBe(0);
  });
});
