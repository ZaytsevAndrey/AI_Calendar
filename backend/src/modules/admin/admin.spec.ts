import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  adminAppUrl,
  adminDevLoginEnabled,
  adminEmails,
  isAdminEmail,
  issueAdminTicket,
  redeemAdminTicket,
} from './admin-config';
import { AdminAuthService } from './admin-auth.service';
import { AdminActionsService } from './admin-actions.service';
import { summarizeVoiceTurn } from './voice-turn-log.service';
import { integrationStatus } from './admin-health.service';
import { lastUtcDays, percentile } from './admin-time';
import {
  clearAdminErrors,
  countAdminErrors,
  listAdminErrors,
  recordAdminError,
} from '../../common/admin-error-log';
import { UserActivityService, ACTIVITY_WRITE_EVERY_MS } from '../users/user-activity.service';

const OWNER = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.com', isBlocked: false };
const OTHER = { id: '22222222-2222-4222-8222-222222222222', email: 'user@example.com', isBlocked: false };

function usersRepo(rows: Array<typeof OWNER>) {
  return {
    findOne: jest.fn(async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null),
    update: jest.fn(async () => ({ affected: 1 })),
    createQueryBuilder: jest.fn(() => {
      let email = '';
      const qb = {
        where: (_sql: string, params: { email: string }) => {
          email = params.email;
          return qb;
        },
        getOne: async () => rows.find((r) => r.email.toLowerCase() === email.toLowerCase()) ?? null,
      };
      return qb;
    }),
  };
}

describe('admin config', () => {
  it('parses ADMIN_EMAILS with mixed separators and case', () => {
    const env = { ADMIN_EMAILS: ' Owner@Example.com, two@x.io;three@x.io ' } as NodeJS.ProcessEnv;
    expect(adminEmails(env)).toEqual(['owner@example.com', 'two@x.io', 'three@x.io']);
    expect(isAdminEmail('OWNER@example.com', env)).toBe(true);
    expect(isAdminEmail('nobody@example.com', env)).toBe(false);
    expect(isAdminEmail('', env)).toBe(false);
  });

  it('nobody is admin when ADMIN_EMAILS is empty', () => {
    expect(isAdminEmail('owner@example.com', {} as NodeJS.ProcessEnv)).toBe(false);
  });

  it('admin url defaults to localhost only outside production', () => {
    expect(adminAppUrl({} as NodeJS.ProcessEnv)).toBe('http://localhost:3002');
    expect(adminAppUrl({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe('');
    expect(adminAppUrl({ ADMIN_URL: 'https://admin.example.com/' } as NodeJS.ProcessEnv)).toBe(
      'https://admin.example.com',
    );
  });

  it('dev login is never on in production', () => {
    expect(adminDevLoginEnabled({ ADMIN_DEV_LOGIN: '1' } as NodeJS.ProcessEnv)).toBe(true);
    expect(adminDevLoginEnabled({ ADMIN_DEV_LOGIN: '1', NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(false);
    expect(adminDevLoginEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });

  it('tickets are one-time and expire', () => {
    const t = issueAdminTicket('u1', 1000);
    expect(redeemAdminTicket(t, 2000)).toBe('u1');
    expect(redeemAdminTicket(t, 2000)).toBeNull();
    const late = issueAdminTicket('u2', 1000);
    expect(redeemAdminTicket(late, 1000 + 121_000)).toBeNull();
  });
});

describe('AdminAuthService', () => {
  const jwt = new JwtService({ secret: 'test-secret' });
  const prev = { ...process.env };
  beforeEach(() => {
    process.env.ADMIN_EMAILS = OWNER.email;
    delete process.env.NODE_ENV;
  });
  afterAll(() => {
    process.env = prev;
  });

  it('redeems a ticket into an admin-scoped token that verifies', async () => {
    const svc = new AdminAuthService(usersRepo([OWNER, OTHER]) as never, jwt);
    const session = await svc.redeemTicket(issueAdminTicket(OWNER.id));
    expect(jwt.verify(session.access_token)).toMatchObject({ sub: OWNER.id, scope: 'admin' });
    await expect(svc.verify(session.access_token)).resolves.toEqual({ userId: OWNER.id, email: OWNER.email });
  });

  it('refuses an app session token', async () => {
    const svc = new AdminAuthService(usersRepo([OWNER]) as never, jwt);
    const appToken = jwt.sign({ sub: OWNER.id });
    await expect(svc.verify(appToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('revokes access when the email leaves ADMIN_EMAILS', async () => {
    const svc = new AdminAuthService(usersRepo([OWNER]) as never, jwt);
    const session = await svc.redeemTicket(issueAdminTicket(OWNER.id));
    process.env.ADMIN_EMAILS = 'someone-else@example.com';
    await expect(svc.verify(session.access_token)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a ticket for a non-admin user', async () => {
    const svc = new AdminAuthService(usersRepo([OWNER, OTHER]) as never, jwt);
    await expect(svc.redeemTicket(issueAdminTicket(OTHER.id))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('dev login needs the flag', async () => {
    const svc = new AdminAuthService(usersRepo([OWNER]) as never, jwt);
    await expect(svc.devLogin(OWNER.email)).rejects.toBeInstanceOf(NotFoundException);
    process.env.ADMIN_DEV_LOGIN = '1';
    await expect(svc.devLogin('Owner@Example.com')).resolves.toMatchObject({ email: OWNER.email });
    await expect(svc.devLogin(OTHER.email)).rejects.toBeInstanceOf(ForbiddenException);
    delete process.env.ADMIN_DEV_LOGIN;
  });
});

describe('AdminActionsService', () => {
  const admin = { userId: OWNER.id, email: OWNER.email };
  const make = () => {
    const users = usersRepo([OWNER, OTHER]);
    const usage = { update: jest.fn(async () => ({ affected: 1 })) };
    const activity = { forget: jest.fn() };
    const quota = { civilDayYmd: jest.fn(async () => '2026-10-29') };
    const deletion = { deleteAccount: jest.fn(async () => undefined) };
    const svc = new AdminActionsService(
      users as never,
      usage as never,
      activity as never,
      quota as never,
      deletion as never,
    );
    return { svc, users, usage, activity, deletion };
  };

  it('blocks another user, drops the refresh token and clears the cache', async () => {
    const { svc, users, activity } = make();
    await svc.setBlocked(admin, OTHER.id, true);
    expect(users.update).toHaveBeenCalledWith(
      { id: OTHER.id },
      expect.objectContaining({ isBlocked: true, refreshToken: null, sessionsRevokedAt: expect.any(Date) }),
    );
    expect(activity.forget).toHaveBeenCalledWith(OTHER.id);
  });

  it('will not block or delete the admin themself', async () => {
    const { svc } = make();
    await expect(svc.setBlocked(admin, OWNER.id, true)).rejects.toThrow('yourself');
    await expect(svc.deleteUser(admin, OWNER.id, OWNER.email)).rejects.toThrow();
  });

  it('delete needs the exact email as confirmation', async () => {
    const { svc, deletion } = make();
    await expect(svc.deleteUser(admin, OTHER.id, 'wrong@example.com')).rejects.toThrow('confirm');
    await svc.deleteUser(admin, OTHER.id, ' USER@example.com ');
    expect(deletion.deleteAccount).toHaveBeenCalledWith(OTHER.id, OTHER.email);
  });

  it('sign out everywhere stamps a revoke time on the next whole second', async () => {
    const { svc, users, activity } = make();
    const before = Date.now();
    await svc.revokeSessions(admin, OTHER.id);
    const [, patch] = users.update.mock.calls[0] as unknown as [unknown, { refreshToken: null; sessionsRevokedAt: Date }];
    expect(patch.refreshToken).toBeNull();
    expect(patch.sessionsRevokedAt.getTime() % 1000).toBe(0);
    expect(patch.sessionsRevokedAt.getTime()).toBeGreaterThan(before);
    expect(activity.forget).toHaveBeenCalledWith(OTHER.id);
  });

  it('resets only today in the user zone', async () => {
    const { svc, usage } = make();
    await expect(svc.resetVoiceQuota(admin, OTHER.id)).resolves.toEqual({ ok: true, dayYmd: '2026-10-29' });
    expect(usage.update).toHaveBeenCalledWith({ userId: OTHER.id, dayYmd: '2026-10-29' }, { tokensUsed: 0 });
  });
});

describe('UserActivityService', () => {
  it('writes lastActiveAt at most every few minutes and stops blocked users', async () => {
    const row = { ...OTHER };
    const repo = {
      findOne: jest.fn(async () => row),
      update: jest.fn(async () => ({ affected: 1 })),
    };
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
    const repo = {
      findOne: jest.fn(async () => ({ ...OTHER, sessionsRevokedAt: revokedAt })),
      update: jest.fn(async () => ({ affected: 1 })),
    };
    const svc = new UserActivityService(repo as never);
    const revokedSec = revokedAt.getTime() / 1000;
    await expect(svc.touch(OTHER.id, Date.now(), revokedSec - 3600)).resolves.toBe(false);
    await expect(svc.touch(OTHER.id, Date.now(), revokedSec)).resolves.toBe(true);
    await expect(svc.touch(OTHER.id, Date.now(), revokedSec + 5)).resolves.toBe(true);
  });

  it('leaves a deleted account to the route, as before', async () => {
    const svc = new UserActivityService({ findOne: async () => null, update: jest.fn() } as never);
    await expect(svc.touch(OTHER.id)).resolves.toBe(true);
  });
});

describe('voice turn summary', () => {
  it('counts model calls, tokens and the first failure code without bodies', () => {
    const row = summarizeVoiceTurn({
      traceId: 't1',
      userId: OTHER.id,
      method: 'POST',
      url: '/voice/agent?x=1',
      statusCode: 200,
      totalMs: 1234.4,
      steps: [
        { kind: 'llm', name: 'planner', via: 'groq/llama', ms: 800, ok: true, tokens: 900 },
        { kind: 'llm', name: 'planner', via: 'gemini', ms: 200, ok: true, tokens: 100, valid: false, errorCode: 'bad_json' },
        { kind: 'other', name: 'tool.create', via: '', ms: 30, ok: true },
      ],
    });
    expect(row).toMatchObject({
      userId: OTHER.id,
      path: '/voice/agent',
      totalMs: 1234,
      llmCalls: 2,
      llmMs: 1000,
      tokens: 1000,
      failedSteps: 1,
      errorCode: 'bad_json',
    });
  });

  it('keeps code-like reasons and drops free text that could echo a user', () => {
    const row = summarizeVoiceTurn({
      traceId: 't3',
      userId: null,
      method: 'POST',
      url: '/voice/turn',
      statusCode: 200,
      totalMs: 10,
      steps: [
        { kind: 'llm', name: 'planner', via: 'groq', ms: 5, ok: false, reason: 'timeout,rate_limit' },
        { kind: 'other', name: 'planner.fault', via: '', ms: 0, ok: false, reason: 'Cannot plan "Call mom about the surgery" now' },
      ],
    });
    const steps = JSON.parse(row.stepsJson);
    expect(steps[0].reason).toBe('timeout,rate_limit');
    expect(steps[1].reason).toBe('free_text_omitted');
    expect(row.stepsJson).not.toContain('mom');
  });

  it('drops a non-uuid user id and falls back to the HTTP status', () => {
    const row = summarizeVoiceTurn({
      traceId: 't2',
      userId: 'nope',
      method: 'POST',
      url: '/voice/transcribe',
      statusCode: 429,
      totalMs: 5,
      steps: [],
    });
    expect(row.userId).toBeNull();
    expect(row.errorCode).toBe('http_429');
  });
});

describe('admin error log', () => {
  beforeEach(() => clearAdminErrors());

  it('keeps newest first, filters by status and strips the query', () => {
    recordAdminError({ method: 'GET', url: '/tasks?token=abc', status: 404, message: 'nope' });
    recordAdminError({ method: 'POST', url: '/voice/agent', status: 500, message: new Array(3).fill('x') });
    const all = listAdminErrors({ minStatus: 0 });
    expect(all.items.map((e) => e.status)).toEqual([500, 404]);
    expect(all.items[1].path).toBe('/tasks');
    expect(listAdminErrors({ minStatus: 500 }).items).toHaveLength(1);
    expect(countAdminErrors(60_000)).toEqual({ server: 1, client: 1 });
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
    expect(percentile([5, 1, 3, 2, 4], 95)).toBe(5);
    expect(percentile([], 50)).toBe(0);
  });
});
