import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { closeTestApp, createTestApp, E2eApp } from './helpers/create-test-app';
import { seedOnboardedUser } from './helpers/auth';
import { api, jsonBody } from './helpers/http';
import { PushSubscription } from '../src/modules/reminders/entities/push-subscription.entity';

describe('Reminders API e2e', () => {
  let ctx: E2eApp;

  beforeAll(async () => {
    process.env.VAPID_PUBLIC_KEY = '';
    process.env.VAPID_PRIVATE_KEY = '';
    process.env.REMINDER_CRON_SECRET = 'e2e-reminder-secret';
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it('A-REM-001 vapid key is unavailable until the server is configured', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const res = await api(ctx.app, 'GET', '/reminders/vapid-public-key', { token });
    expect(res.statusCode).toBe(503);
  });

  it('A-REM-002 tick requires the cron secret and does not send without VAPID', async () => {
    const open = await ctx.app.inject({ method: 'POST', url: '/reminders/tick' });
    expect(open.statusCode).toBe(401);

    const wrong = await ctx.app.inject({
      method: 'POST',
      url: '/reminders/tick',
      headers: { 'x-reminder-cron-secret': 'nope' },
    });
    expect(wrong.statusCode).toBe(401);

    const ok = await ctx.app.inject({
      method: 'POST',
      url: '/reminders/tick',
      headers: { 'x-reminder-cron-secret': 'e2e-reminder-secret' },
    });
    expect(ok.statusCode).toBe(200);
    expect(jsonBody(ok)).toEqual({ users: 0, sent: 0 });
  });

  it('A-REM-003 reminders can be turned on', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const saved = await api(ctx.app, 'PATCH', '/user-settings', {
      token,
      payload: { remindersEnabled: true },
    });
    expect(saved.statusCode).toBe(200);
    expect(jsonBody(saved).remindersEnabled).toBe(true);
  });

  it('A-REM-004 stores a subscription for this user only', async () => {
    const owner = await seedOnboardedUser(ctx.app);
    const other = await seedOnboardedUser(ctx.app);
    const endpoint = 'https://push.example.test/owner';
    const created = await api(ctx.app, 'POST', '/reminders/subscriptions', {
      token: owner.token,
      payload: { endpoint, p256dh: 'key', auth: 'auth' },
    });
    expect(created.statusCode).toBe(201);

    const rejected = await api(ctx.app, 'POST', '/reminders/subscriptions', {
      token: owner.token,
      payload: { endpoint: 'http://push.example.test/owner', p256dh: 'key', auth: 'auth' },
    });
    expect(rejected.statusCode).toBe(400);

    const removedByOther = await api(ctx.app, 'DELETE', '/reminders/subscriptions', {
      token: other.token,
      payload: { endpoint },
    });
    expect(removedByOther.statusCode).toBe(204);

    const repo = ctx.app.get<Repository<PushSubscription>>(
      getRepositoryToken(PushSubscription),
    );
    const row = await repo.findOne({ where: { endpoint } });
    expect(row?.userId).toBe(owner.user.id);

    const removed = await api(ctx.app, 'DELETE', '/reminders/subscriptions', {
      token: owner.token,
      payload: { endpoint },
    });
    expect(removed.statusCode).toBe(204);
    expect(await repo.findOne({ where: { endpoint } })).toBeNull();
  });
});
