import { closeTestApp, createTestApp, E2eApp } from './helpers/create-test-app';
import { seedOnboardedUser } from './helpers/auth';
import { api, jsonBody } from './helpers/http';

describe('Day reminders API e2e', () => {
  let ctx: E2eApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  beforeEach(() => {
    ctx.google.createEvent.mockClear();
    ctx.google.updateEvent.mockClear();
    ctx.google.deleteEvent.mockClear();
    ctx.google.getEvent.mockClear();
    let n = 0;
    ctx.google.createEvent.mockImplementation(async (_userId: string, event: Record<string, unknown>) => ({
      id: `g-${++n}`,
      appCalendarId: 'app-cal',
      ...event,
    }));
    ctx.google.getEvent.mockResolvedValue({ status: 'confirmed' });
    ctx.google.updateEvent.mockImplementation(
      async (_userId: string, eventId: string, event: Record<string, unknown>) => ({
        id: eventId,
        ...event,
      }),
    );
    ctx.google.deleteEvent.mockResolvedValue({ success: true });
  });

  it('A-DRM-001 creates a reminder and lists it', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const created = await api(ctx.app, 'POST', '/day-reminders', {
      token,
      payload: { name: 'Unsubscribe', dueYmd: '2026-11-03', notificationTime: '18:00' },
    });
    expect(created.statusCode).toBe(201);
    const body = jsonBody(created);
    expect(body.name).toBe('Unsubscribe');
    expect(body.dueYmd).toBe('2026-11-03');
    expect(body.notificationTime).toBe('18:00');
    expect(body.googleEventId).toEqual(expect.any(String));
    expect(ctx.google.createEvent).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        summary: 'Unsubscribe',
        transparency: 'transparent',
        start: expect.objectContaining({ dateTime: '2026-11-03T18:00:00' }),
        reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] },
      }),
      { skipSleepWindowCheck: true },
    );

    const list = await api(ctx.app, 'GET', '/day-reminders', { token });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual([
      expect.objectContaining({ id: body.id, name: 'Unsubscribe' }),
    ]);
  });

  it('A-DRM-002 rejects a blank name and an impossible day', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const blank = await api(ctx.app, 'POST', '/day-reminders', {
      token,
      payload: { name: '   ', dueYmd: '2026-11-03' },
    });
    expect(blank.statusCode).toBe(400);

    const impossible = await api(ctx.app, 'POST', '/day-reminders', {
      token,
      payload: { name: 'Leap', dueYmd: '2026-02-31' },
    });
    expect(impossible.statusCode).toBe(400);
  });

  it('A-DRM-003 resolving a one-off removes it from the open list', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const created = jsonBody(
      await api(ctx.app, 'POST', '/day-reminders', {
        token,
        payload: { name: 'Once', dueYmd: '2026-11-03' },
      }),
    );
    const resolved = await api(ctx.app, 'POST', `/day-reminders/${created.id}/resolve`, { token });
    expect(resolved.statusCode).toBe(200);
    expect(jsonBody(resolved).status).toBe('completed');

    const list = await api(ctx.app, 'GET', '/day-reminders', { token });
    expect(list.json()).toEqual([]);
    expect(ctx.google.deleteEvent).toHaveBeenCalled();
  });

  it('A-DRM-004 resolving a monthly 31st moves to the last day of February', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const created = jsonBody(
      await api(ctx.app, 'POST', '/day-reminders', {
        token,
        payload: {
          name: 'Rent',
          dueYmd: '2026-01-31',
          recurrencePattern: 'MONTHLY',
        },
      }),
    );
    const resolved = await api(ctx.app, 'POST', `/day-reminders/${created.id}/resolve`, { token });
    expect(resolved.statusCode).toBe(200);
    expect(jsonBody(resolved).dueYmd).toBe('2026-02-28');
    expect(jsonBody(resolved).status).toBe('open');
  });

  it('A-DRM-005 delete removes the reminder', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const created = jsonBody(
      await api(ctx.app, 'POST', '/day-reminders', {
        token,
        payload: { name: 'Drop me', dueYmd: '2026-12-01' },
      }),
    );
    const removed = await api(ctx.app, 'DELETE', `/day-reminders/${created.id}`, { token });
    expect(removed.statusCode).toBe(200);
    expect(jsonBody(removed).deleted).toBe(true);
    const list = await api(ctx.app, 'GET', '/day-reminders', { token });
    expect(list.json()).toEqual([]);
  });

  it('A-DRM-006 another user cannot update the reminder', async () => {
    const owner = await seedOnboardedUser(ctx.app);
    const other = await seedOnboardedUser(ctx.app);
    const created = jsonBody(
      await api(ctx.app, 'POST', '/day-reminders', {
        token: owner.token,
        payload: { name: 'Mine', dueYmd: '2026-12-01' },
      }),
    );
    const patched = await api(ctx.app, 'PATCH', `/day-reminders/${created.id}`, {
      token: other.token,
      payload: { name: 'Theirs', dueYmd: '2026-12-02' },
    });
    expect(patched.statusCode).toBe(404);
  });

  it('A-DRM-007 a missing Google event deletes the reminder and does not recreate it', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const created = jsonBody(
      await api(ctx.app, 'POST', '/day-reminders', {
        token,
        payload: { name: 'Gone', dueYmd: '2026-12-01' },
      }),
    );
    expect(created.googleEventId).toEqual(expect.any(String));
    ctx.google.createEvent.mockClear();
    ctx.google.getEvent.mockRejectedValue(new Error('Failed to fetch event: Not Found'));

    const list = await api(ctx.app, 'GET', '/day-reminders', { token });
    expect(list.json()).toEqual([]);
    expect(ctx.google.createEvent).not.toHaveBeenCalled();
  });

  it('A-DRM-008 the settings default clock is stored', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const saved = await api(ctx.app, 'PATCH', '/user-settings', {
      token,
      payload: { defaultReminderTime: '08:15' },
    });
    expect(saved.statusCode).toBe(200);
    expect(jsonBody(saved).defaultReminderTime).toBe('08:15');
  });
});
