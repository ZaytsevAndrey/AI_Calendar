import { JwtService } from '@nestjs/jwt';
import { closeTestApp, createTestApp, E2eApp } from './helpers/create-test-app';
import { seedRefreshSession, seedUser } from './helpers/auth';
import { api, jsonBody } from './helpers/http';

describe('Auth and infra API e2e', () => {
  let ctx: E2eApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it('A-INFRA-003 garbage Bearer is 401 INVALID_JWT', async () => {
    const res = await api(ctx.app, 'GET', '/tasks', { token: 'not-a-jwt' });
    expect(res.statusCode).toBe(401);
    expect(jsonBody(res).code).toBe('INVALID_JWT');
  });

  it('A-AUTH-001 / A-AUTH-002 Google auth URLs come from the stub', async () => {
    const auth = await api(ctx.app, 'GET', '/auth/google');
    expect(auth.statusCode).toBe(200);
    expect(String(jsonBody(auth).url)).toContain('accounts.google.com');

    const calendar = await api(ctx.app, 'GET', '/google-calendar/auth-url');
    expect(calendar.statusCode).toBe(200);
    expect(String(jsonBody(calendar).url)).toContain('accounts.google.com');
  });

  it('A-AUTH-003 callback error redirects to login', async () => {
    const res = await api(
      ctx.app,
      'GET',
      '/google-calendar/callback?error=access_denied',
    );
    expect(res.statusCode).toBe(302);
    expect(String(res.headers.location)).toContain(
      '/login?error=access_denied',
    );
  });

  it('A-AUTH-004 callback without code redirects no_code', async () => {
    const res = await api(ctx.app, 'GET', '/google-calendar/callback');
    expect(res.statusCode).toBe(302);
    expect(String(res.headers.location)).toContain('/login?error=no_code');
  });

  it('A-AUTH-005 failed sign-in redirects with encoded error', async () => {
    ctx.google.completeGoogleSignIn.mockRejectedValueOnce(
      new Error('sign_in_failed'),
    );
    const res = await api(
      ctx.app,
      'GET',
      '/google-calendar/callback?code=bad',
    );
    expect(res.statusCode).toBe(302);
    expect(String(res.headers.location)).toContain(
      `/login?error=${encodeURIComponent('sign_in_failed')}`,
    );
  });

  it('A-AUTH-006 redeeming a valid ticket returns tokens', async () => {
    const ticket = ctx.google.issueTestTicket();
    const res = await api(ctx.app, 'POST', '/auth/google/session', {
      payload: { ticket },
    });
    expect(res.statusCode).toBe(200);
    const body = jsonBody(res);
    expect(body.access_token).toBeTruthy();
    expect(body.refresh_token).toBeTruthy();
  });

  it('A-AUTH-007 missing ticket is 401', async () => {
    const res = await api(ctx.app, 'POST', '/auth/google/session', {
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('A-AUTH-008 ticket can be redeemed only once', async () => {
    const ticket = ctx.google.issueTestTicket();
    const first = await api(ctx.app, 'POST', '/auth/google/session', {
      payload: { ticket },
    });
    expect(first.statusCode).toBe(200);
    const second = await api(ctx.app, 'POST', '/auth/google/session', {
      payload: { ticket },
    });
    expect(second.statusCode).toBe(401);
  });

  it('A-AUTH-009 expired ticket fails', async () => {
    const ticket = ctx.google.issueTestTicket(-1000);
    const res = await api(ctx.app, 'POST', '/auth/google/session', {
      payload: { ticket },
    });
    expect(res.statusCode).toBe(401);
  });

  it('A-AUTH-010 / A-AUTH-011 refresh rotates and rejects unknown tokens', async () => {
    const unknown = await api(ctx.app, 'POST', '/auth/refresh', {
      payload: { refresh_token: 'nope' },
    });
    expect(unknown.statusCode).toBe(401);
    expect(jsonBody(unknown).code).toBe('INVALID_REFRESH_TOKEN');

    const { user } = await seedUser(ctx.app);
    const tokens = await seedRefreshSession(ctx.app, user);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const ok = await api(ctx.app, 'POST', '/auth/refresh', {
      payload: { refresh_token: tokens.refresh_token },
    });
    expect(ok.statusCode).toBe(200);
    const next = jsonBody(ok);
    expect(next.access_token).toBeTruthy();
    expect(next.refresh_token).toBeTruthy();
    expect(next.refresh_token).not.toBe(tokens.refresh_token);

    const old = await api(ctx.app, 'POST', '/auth/refresh', {
      payload: { refresh_token: tokens.refresh_token },
    });
    expect(old.statusCode).toBe(401);
    expect(jsonBody(old).code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('A-AUTH-012 / A-AUTH-013 logout clears refresh', async () => {
    const { user, token } = await seedUser(ctx.app);
    const tokens = await seedRefreshSession(ctx.app, user);
    const out = await api(ctx.app, 'POST', '/auth/logout', { token });
    expect(out.statusCode).toBe(200);

    const refresh = await api(ctx.app, 'POST', '/auth/refresh', {
      payload: { refresh_token: tokens.refresh_token },
    });
    expect(refresh.statusCode).toBe(401);
  });

  it('A-AUTH-014 logout without Authorization is 500 today', async () => {
    const res = await api(ctx.app, 'POST', '/auth/logout');
    expect(res.statusCode).toBe(500);
  });

  it('A-AUTH-015 expired access JWT is 401; refresh still works', async () => {
    const { user } = await seedUser(ctx.app);
    const tokens = await seedRefreshSession(ctx.app, user);
    const jwt = ctx.app.get(JwtService);
    const expired = jwt.sign({ sub: user.id }, { expiresIn: '1ms' });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const protectedRes = await api(ctx.app, 'GET', '/tasks', {
      token: expired,
    });
    expect(protectedRes.statusCode).toBe(401);

    const refresh = await api(ctx.app, 'POST', '/auth/refresh', {
      payload: { refresh_token: tokens.refresh_token },
    });
    expect(refresh.statusCode).toBe(200);
  });
});
