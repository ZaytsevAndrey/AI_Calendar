import { randomUUID } from 'crypto';
import { NotFoundException } from '@nestjs/common';
import { closeTestApp, createTestApp, E2eApp } from './helpers/create-test-app';
import { createTimePhase, seedOnboardedUser } from './helpers/auth';
import { api, jsonBody } from './helpers/http';

describe('Google, event-phases, and isolation API e2e', () => {
  let ctx: E2eApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it('A-GGL-001 / A-GGL-003 / A-GGL-004 / A-GGL-005 events and calendars', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    ctx.google.checkConnection.mockResolvedValueOnce({ connected: true });
    const conn = await api(ctx.app, 'GET', '/google-calendar/check-connection', {
      token,
    });
    expect(jsonBody(conn).connected).toBe(true);

    ctx.google.getCalendars.mockResolvedValueOnce([{ id: 'primary' }]);
    const cals = await api(ctx.app, 'GET', '/google-calendar/calendars', { token });
    expect(cals.statusCode).toBe(200);

    ctx.google.getDisplayEvents.mockResolvedValueOnce({ events: [{ id: 'e1' }] });
    const display = await api(
      ctx.app,
      'GET',
      '/google-calendar/events?timeMin=2026-09-21T00:00:00.000Z&timeMax=2026-09-22T00:00:00.000Z',
      { token },
    );
    expect(display.statusCode).toBe(200);

    ctx.google.getEvents.mockResolvedValueOnce({
      events: [{ id: 'app-1' }],
      totalEvents: 1,
    });
    const single = await api(
      ctx.app,
      'GET',
      '/google-calendar/events?calendarId=app-cal&timeMin=2026-09-21T00:00:00.000Z&timeMax=2026-09-22T00:00:00.000Z',
      { token },
    );
    expect(single.statusCode).toBe(200);
    expect(ctx.google.getEvents).toHaveBeenCalled();
  });

  it('A-GGL-006 / A-GGL-007 get one event', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    ctx.google.getEvent.mockResolvedValueOnce({ id: 'ev-1', summary: 'Meet' });
    const ok = await api(ctx.app, 'GET', '/google-calendar/events/ev-1', { token });
    expect(ok.statusCode).toBe(200);

    ctx.google.getEvent.mockRejectedValueOnce(new NotFoundException('Event not found'));
    const missing = await api(ctx.app, 'GET', '/google-calendar/events/missing', {
      token,
    });
    expect(missing.statusCode).toBe(404);
  });

  it('A-GGL-011 / A-GGL-012 / A-GGL-016 update delete save-token', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const updated = await api(ctx.app, 'PUT', '/google-calendar/events/ev-1', {
      token,
      payload: { summary: 'Updated' },
    });
    expect(updated.statusCode).toBe(200);

    const deleted = await api(ctx.app, 'DELETE', '/google-calendar/events/ev-1', {
      token,
    });
    expect(deleted.statusCode).toBe(200);

    const saved = await api(ctx.app, 'POST', '/google-calendar/save-token', {
      token,
      payload: { code: 'abc' },
    });
    expect(saved.statusCode).toBe(201);
  });

  it('A-GGL-014 / A-GGL-015 public diagnostic routes', async () => {
    const config = await api(ctx.app, 'GET', '/google-calendar/test-config');
    expect(config.statusCode).toBe(200);
    const cfg = jsonBody(config).config as Record<string, unknown>;
    expect(cfg.clientId === 'SET' || cfg.clientId === 'NOT SET').toBe(true);

    const all = await api(ctx.app, 'GET', '/google-calendar/check-all-users');
    expect(all.statusCode).toBe(200);
  });

  it('A-GGL-017 disconnect route does not exist', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const res = await api(ctx.app, 'POST', '/google-calendar/disconnect', { token });
    expect(res.statusCode).toBe(404);
  });

  it('A-EP-001 through A-EP-006 event-phase CRUD', async () => {
    const a = await seedOnboardedUser(ctx.app);
    const b = await seedOnboardedUser(ctx.app);
    const phase = await createTimePhase(ctx.app, a.token, { name: 'EP' });
    const foreign = await createTimePhase(ctx.app, b.token, { name: 'Other' });

    const created = await api(ctx.app, 'POST', '/event-phases', {
      token: a.token,
      payload: { eventId: 'gcal-1', phaseId: phase.id },
    });
    expect([200, 201]).toContain(created.statusCode);
    const linkId = jsonBody(created).id;

    const foreignCreate = await api(ctx.app, 'POST', '/event-phases', {
      token: a.token,
      payload: { eventId: 'gcal-2', phaseId: foreign.id },
    });
    expect(foreignCreate.statusCode).toBeGreaterThanOrEqual(400);

    const byEvent = await api(ctx.app, 'GET', '/event-phases/event/gcal-1', {
      token: a.token,
    });
    expect(byEvent.statusCode).toBe(200);

    const byPhase = await api(ctx.app, 'GET', `/event-phases/phase/${phase.id}`, {
      token: a.token,
    });
    expect(byPhase.statusCode).toBe(200);

    const patched = await api(ctx.app, 'PATCH', `/event-phases/${linkId}`, {
      token: a.token,
      payload: { phaseId: phase.id },
    });
    expect(patched.statusCode).toBe(200);

    expect(
      (await api(ctx.app, 'PATCH', `/event-phases/${randomUUID()}`, {
        token: a.token,
        payload: { phaseId: phase.id },
      })).statusCode,
    ).toBe(404);

    expect(
      (await api(ctx.app, 'DELETE', `/event-phases/${linkId}`, { token: a.token }))
        .statusCode,
    ).toBe(200);
  });

  it('X-ISO-002 / X-ISO-003 / X-ISO-004 / X-ISO-005 / X-ISO-008 isolation', async () => {
    const a = await seedOnboardedUser(ctx.app);
    const b = await seedOnboardedUser(ctx.app);
    const phase = await createTimePhase(ctx.app, b.token, { name: 'B phase' });
    const habit = jsonBody(
      await api(ctx.app, 'POST', '/habits', {
        token: b.token,
        payload: { name: 'B habit' },
      }),
    );
    const task = jsonBody(
      await api(ctx.app, 'POST', '/tasks', {
        token: b.token,
        payload: { name: 'B task', estimatedTimeInMinutes: 30 },
      }),
    );
    await ctx.drainJobs();
    const slot = jsonBody(
      await api(ctx.app, 'POST', '/schedule', {
        token: b.token,
        payload: {
          taskId: task.id,
          scheduledStartTime: '2026-09-23T10:00:00.000Z',
          scheduledEndTime: '2026-09-23T10:30:00.000Z',
        },
      }),
    );
    const job = jsonBody(
      await api(ctx.app, 'POST', '/schedule/generate', {
        token: b.token,
        payload: {},
      }),
    );
    await ctx.drainJobs();

    expect(
      (await api(ctx.app, 'GET', `/phases/${phase.id}`, { token: a.token })).statusCode,
    ).toBe(404);
    expect(
      (await api(ctx.app, 'PATCH', `/habits/${habit.id}`, {
        token: a.token,
        payload: { name: 'hack' },
      })).statusCode,
    ).toBe(404);
    expect(
      (await api(ctx.app, 'GET', `/schedule/${slot.id}`, { token: a.token }))
        .statusCode,
    ).toBe(404);
    expect(
      (await api(ctx.app, 'GET', `/schedule-jobs/${job.jobId}`, { token: a.token }))
        .statusCode,
    ).toBe(404);

    const stealPhase = await api(ctx.app, 'POST', '/tasks', {
      token: a.token,
      payload: {
        name: 'Steal',
        estimatedTimeInMinutes: 30,
        phaseIds: [phase.id],
      },
    });
    expect(stealPhase.statusCode).toBe(400);
  });

  it('X-ISO-006 / X-ISO-007 generate does not leak user B data', async () => {
    const a = await seedOnboardedUser(ctx.app);
    const b = await seedOnboardedUser(ctx.app);
    await api(ctx.app, 'POST', '/tasks', {
      token: b.token,
      payload: { name: 'Only B', estimatedTimeInMinutes: 30 },
    });
    await ctx.drainJobs();
    await api(ctx.app, 'POST', '/schedule/generate', { token: a.token, payload: {} });
    await ctx.drainJobs();

    const aTasks = (await api(ctx.app, 'GET', '/tasks', { token: a.token })).json() as Array<{
      name: string;
    }>;
    expect(aTasks.some((t) => t.name === 'Only B')).toBe(false);
  });
});
