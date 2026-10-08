import { randomUUID } from 'crypto';
import { closeTestApp, createTestApp, E2eApp } from './helpers/create-test-app';
import { seedOnboardedUser } from './helpers/auth';
import { api, jsonBody } from './helpers/http';

describe('Schedule API e2e', () => {
  let ctx: E2eApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  async function unscheduledFlexible(token: string, name = 'Slot task') {
    const res = await api(ctx.app, 'POST', '/tasks', {
      token,
      payload: { name, estimatedTimeInMinutes: 30, isUnscheduled: true },
    });
    return jsonBody(res);
  }

  it('A-SCH-001 / A-SCH-002 / A-SCH-003 / A-SCH-004 manual slots', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const task = await unscheduledFlexible(token);
    const start = '2026-09-22T10:00:00.000Z';
    const end = '2026-09-22T10:30:00.000Z';
    const created = await api(ctx.app, 'POST', '/schedule', {
      token,
      payload: { taskId: task.id, scheduledStartTime: start, scheduledEndTime: end },
    });
    expect(created.statusCode).toBe(201);

    const badOrder = await api(ctx.app, 'POST', '/schedule', {
      token,
      payload: {
        taskId: task.id,
        scheduledStartTime: end,
        scheduledEndTime: start,
      },
    });
    expect(badOrder.statusCode).toBe(400);

    const overlap = await api(ctx.app, 'POST', '/schedule', {
      token,
      payload: {
        taskId: task.id,
        scheduledStartTime: '2026-09-22T10:15:00.000Z',
        scheduledEndTime: '2026-09-22T10:45:00.000Z',
      },
    });
    expect(overlap.statusCode).toBe(400);

    const missing = await api(ctx.app, 'POST', '/schedule', {
      token,
      payload: {
        taskId: randomUUID(),
        scheduledStartTime: '2026-09-22T12:00:00.000Z',
        scheduledEndTime: '2026-09-22T12:30:00.000Z',
      },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('A-SCH-005 / A-SCH-007 / A-SCH-008 list patch delete slot', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const task = await unscheduledFlexible(token, 'Range');
    const created = await api(ctx.app, 'POST', '/schedule', {
      token,
      payload: {
        taskId: task.id,
        scheduledStartTime: '2026-09-22T13:00:00.000Z',
        scheduledEndTime: '2026-09-22T13:30:00.000Z',
      },
    });
    const slotId = jsonBody(created).id;

    const ranged = await api(
      ctx.app,
      'GET',
      '/schedule?startDate=2026-09-22&endDate=2026-09-22',
      { token },
    );
    expect(ranged.statusCode).toBe(200);
    expect(
      (ranged.json() as Array<{ id: string }>).some((row) => row.id === slotId),
    ).toBe(true);

    const one = await api(ctx.app, 'GET', `/schedule/${slotId}`, { token });
    expect(one.statusCode).toBe(200);

    const badPatch = await api(ctx.app, 'PATCH', `/schedule/${slotId}`, {
      token,
      payload: {
        scheduledStartTime: '2026-09-22T14:00:00.000Z',
        scheduledEndTime: '2026-09-22T13:00:00.000Z',
      },
    });
    expect(badPatch.statusCode).toBe(400);

    const okPatch = await api(ctx.app, 'PATCH', `/schedule/${slotId}`, {
      token,
      payload: {
        scheduledStartTime: '2026-09-22T14:00:00.000Z',
        scheduledEndTime: '2026-09-22T14:30:00.000Z',
      },
    });
    expect(okPatch.statusCode).toBe(200);

    expect(
      (await api(ctx.app, 'DELETE', `/schedule/${slotId}`, { token })).statusCode,
    ).toBe(200);
  });

  it('A-SCH-009 create seats a flexible task; generate/preview are gone', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const created = await api(ctx.app, 'POST', '/tasks', {
      token,
      payload: { name: 'Seat me', estimatedTimeInMinutes: 30 },
    });
    expect(created.statusCode).toBe(201);
    const taskId = String(jsonBody(created).id);

    const seated = await api(ctx.app, 'GET', '/schedule', { token });
    expect(seated.statusCode).toBe(200);
    const seatedRows = seated.json() as Array<{ taskId: string }>;
    expect(seatedRows.some((row) => row.taskId === taskId)).toBe(true);

    expect(
      (await api(ctx.app, 'POST', '/schedule/generate', { token, payload: {} }))
        .statusCode,
    ).toBe(404);
    expect(
      (await api(ctx.app, 'POST', '/schedule/preview', { token, payload: {} }))
        .statusCode,
    ).toBe(404);
  });

  it('A-SCH-032 recommendations suggest without writing', async () => {
    const anon = await api(ctx.app, 'POST', '/schedule/recommendations', {
      payload: {},
    });
    expect(anon.statusCode).toBe(401);

    const emptyUser = await seedOnboardedUser(ctx.app);
    ctx.groq.completeJson.mockClear();
    const empty = await api(ctx.app, 'POST', '/schedule/recommendations', {
      token: emptyUser.token,
      payload: {},
    });
    expect(empty.statusCode).toBe(200);
    expect(jsonBody(empty).suggestions).toEqual([]);
    expect(ctx.groq.completeJson).not.toHaveBeenCalled();

    const { token } = await seedOnboardedUser(ctx.app);
    const created = await api(ctx.app, 'POST', '/tasks', {
      token,
      payload: { name: 'Suggest me', estimatedTimeInMinutes: 30 },
    });
    const taskId = String(jsonBody(created).id);
    const seated = await api(ctx.app, 'GET', '/schedule', { token });
    expect((seated.json() as unknown[]).length).toBeGreaterThan(0);
    ctx.groq.completeJson.mockResolvedValueOnce(
      JSON.stringify({
        summary: 'Schedule Suggest me.',
        suggestions: [
          {
            kind: 'deadline_risk',
            title: 'Soon',
            detail: 'Suggest me has no slot.',
            taskId,
          },
          {
            kind: 'overload',
            title: 'Fake',
            detail: 'Unknown task.',
            taskId: 'not-real',
          },
        ],
      }),
    );
    const res = await api(ctx.app, 'POST', '/schedule/recommendations', {
      token,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = jsonBody(res) as {
      summary: string;
      suggestions: Array<{ taskId: string | null; kind: string }>;
    };
    expect(body.summary).toBe('Schedule Suggest me.');
    expect(body.suggestions).toEqual([
      {
        kind: 'deadline_risk',
        title: 'Soon',
        detail: 'Suggest me has no slot.',
        taskId,
      },
    ]);

    const schedule = await api(ctx.app, 'GET', '/schedule', { token });
    expect(schedule.json()).toEqual(seated.json());
  });
});
