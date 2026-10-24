import { closeTestApp, createTestApp, E2eApp } from './helpers/create-test-app';
import { seedOnboardedUser } from './helpers/auth';
import { mockVoiceParseTurn } from './helpers/groq.stub';
import { api, jsonBody } from './helpers/http';

describe('Voice day reminders e2e', () => {
  let ctx: E2eApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it('A-DRM-009 an explicit remind phrase stays a reminder when the router says create', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    mockVoiceParseTurn(
      ctx.groq,
      {
        action: 'create',
        understanding: 'complete',
        name: 'Unsubscribe',
        dueYmd: '2026-11-03',
        notificationTime: '18:00',
        task: null,
      },
      { intent: 'create', language: 'en' },
    );
    const parsed = await api(ctx.app, 'POST', '/voice/parse-task', {
      token,
      payload: { transcript: 'remind me to unsubscribe on 3 November at 18:00', timeZone: 'Europe/Kyiv' },
    });
    expect(parsed.statusCode).toBe(201);
    expect(jsonBody(parsed).command).toMatchObject({
      kind: 'remind_create',
      name: 'Unsubscribe',
      dueYmd: '2026-11-03',
      notificationTime: '18:00',
    });
    expect(jsonBody(parsed).task).toBeNull();
  });

  it('A-DRM-010 done on an open reminder resolves that reminder', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const created = await api(ctx.app, 'POST', '/day-reminders', {
      token,
      payload: { name: 'Unsubscribe', dueYmd: '2026-11-03' },
    });
    expect(created.statusCode).toBe(201);
    mockVoiceParseTurn(
      ctx.groq,
      {
        action: 'resolve',
        understanding: 'complete',
        targetName: 'Unsubscribe',
        task: null,
      },
      { intent: 'update', language: 'en' },
    );
    const parsed = await api(ctx.app, 'POST', '/voice/parse-task', {
      token,
      payload: { transcript: 'done with Unsubscribe', timeZone: 'Europe/Kyiv' },
    });
    expect(parsed.statusCode).toBe(201);
    expect(jsonBody(parsed).command).toMatchObject({
      kind: 'remind_resolve',
      name: 'Unsubscribe',
    });
  });
});
