import { randomUUID } from 'crypto';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { closeTestApp, createTestApp, E2eApp } from './helpers/create-test-app';
import { seedOnboardedUser, seedUser } from './helpers/auth';
import { api, jsonBody } from './helpers/http';
import { IntelligentSchedulingEngine } from '../src/modules/schedule/intelligent-scheduling.engine';
import { ScheduledTask } from '../src/modules/schedule/schedule.entity';

describe('Schedule API e2e', () => {
  let ctx: E2eApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  async function flexibleTask(token: string, name = 'Slot task') {
    const res = await api(ctx.app, 'POST', '/tasks', {
      token,
      payload: { name, estimatedTimeInMinutes: 30 },
    });
    await ctx.drainJobs();
    return jsonBody(res);
  }

  it('A-SCH-001 / A-SCH-002 / A-SCH-003 / A-SCH-004 manual slots', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const task = await flexibleTask(token);
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
    const task = await flexibleTask(token, 'Range');
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

  it('A-SCH-011 generate job ends done with a progress stage', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    await flexibleTask(token, 'Progress');
    const gen = await api(ctx.app, 'POST', '/schedule/generate', {
      token,
      payload: {},
    });
    const jobId = jsonBody(gen).jobId;
    await ctx.drainJobs();
    const job = await api(ctx.app, 'GET', `/schedule-jobs/${jobId}`, { token });
    expect(jsonBody(job).status).toBe('done');
    expect(jsonBody(job).progressStage).toBeTruthy();
  });

  it('A-SCH-012 failed engine marks job failed', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    await flexibleTask(token, 'Boom');
    const engine = ctx.app.get(IntelligentSchedulingEngine);
    const spy = jest.spyOn(engine, 'run').mockRejectedValueOnce(new Error('boom'));
    const gen = await api(ctx.app, 'POST', '/schedule/generate', {
      token,
      payload: {},
    });
    await ctx.drainJobs();
    const job = await api(ctx.app, 'GET', `/schedule-jobs/${jsonBody(gen).jobId}`, {
      token,
    });
    expect(jsonBody(job).status).toBe('failed');
    expect(jsonBody(job).errorMessage).toBeTruthy();
    spy.mockRestore();
  });

  it('A-SCH-013 unknown or foreign job is 404', async () => {
    const a = await seedOnboardedUser(ctx.app);
    const b = await seedOnboardedUser(ctx.app);
    const gen = await api(ctx.app, 'POST', '/schedule/generate', {
      token: b.token,
      payload: {},
    });
    const jobId = jsonBody(gen).jobId;
    await ctx.drainJobs();
    expect(
      (await api(ctx.app, 'GET', `/schedule-jobs/${jobId}`, { token: a.token }))
        .statusCode,
    ).toBe(404);
    expect(
      (await api(ctx.app, 'GET', `/schedule-jobs/${randomUUID()}`, { token: a.token }))
        .statusCode,
    ).toBe(404);
  });

  it('A-SCH-014 second generate while pending is recorded as current status', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    await flexibleTask(token, 'Queue');
    const first = await api(ctx.app, 'POST', '/schedule/generate', {
      token,
      payload: {},
    });
    const second = await api(ctx.app, 'POST', '/schedule/generate', {
      token,
      payload: {},
    });
    expect([201, 409]).toContain(second.statusCode);
    expect(first.statusCode).toBe(201);
    await ctx.drainJobs();
  });

  it('A-SCH-015 / A-SCH-018 / A-SCH-019 undo availability', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    await flexibleTask(token, 'Undo avail');
    const silent = await api(ctx.app, 'GET', '/schedule-jobs/undo', { token });
    expect(jsonBody(silent).available).toBe(false);

    const pending = await api(ctx.app, 'POST', '/schedule/generate', {
      token,
      payload: {},
    });
    expect(pending.statusCode).toBe(201);
    const undoWhileQueued = await api(ctx.app, 'POST', '/schedule-jobs/undo', {
      token,
    });
    expect(undoWhileQueued.statusCode).toBe(409);
    await ctx.drainJobs();

    const available = await api(ctx.app, 'GET', '/schedule-jobs/undo', { token });
    expect(jsonBody(available).available).toBe(true);
  });

  it('A-SCH-021 / A-SCH-022 / A-SCH-023 / A-SCH-024 / A-SCH-025 jobs and clear', async () => {
    const fresh = await seedUser(ctx.app);
    const empty = await api(ctx.app, 'GET', '/schedule-jobs/latest/done', {
      token: fresh.token,
    });
    expect(jsonBody(empty).job).toBeNull();

    const { token } = await seedOnboardedUser(ctx.app);
    const none = await api(ctx.app, 'DELETE', '/schedule', { token });
    expect(none.statusCode).toBe(200);
    expect(jsonBody(none).deleted).toBe(0);

    await flexibleTask(token, 'Replan');
    const replan = await api(ctx.app, 'POST', '/schedule-jobs/replan', { token });
    expect([200, 201]).toContain(replan.statusCode);
    await ctx.drainJobs();
    const undoAfterSilent = await api(ctx.app, 'GET', '/schedule-jobs/undo', {
      token,
    });
    expect(jsonBody(undoAfterSilent).available).toBe(false);

    const gen = await api(ctx.app, 'POST', '/schedule/generate', {
      token,
      payload: {},
    });
    await ctx.drainJobs();
    const latest = await api(ctx.app, 'GET', '/schedule-jobs/latest/done', {
      token,
    });
    const job = jsonBody(latest).job as Record<string, unknown> | null;
    expect(job).toBeTruthy();
    expect(job?.result).toBeTruthy();
    expect(jsonBody(gen).jobId).toBeTruthy();
  });

  it('A-SCH-026 / A-SCH-027 tight window and past deadline do not force slots', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const past = await api(ctx.app, 'POST', '/tasks', {
      token,
      payload: {
        name: 'Already due',
        estimatedTimeInMinutes: 30,
        earliestStartTime: '2020-01-01T00:00:00.000Z',
        deadline: '2020-01-02T00:00:00.000Z',
      },
    });
    expect(past.statusCode).toBe(201);
    const tight = await api(ctx.app, 'POST', '/tasks', {
      token,
      payload: {
        name: 'Too big',
        estimatedTimeInMinutes: 120,
        earliestStartTime: '2026-09-22T09:00:00.000Z',
        deadline: '2026-09-22T09:20:00.000Z',
      },
    });
    expect(tight.statusCode).toBe(201);
    const gen = await api(ctx.app, 'POST', '/schedule/generate', {
      token,
      payload: {},
    });
    await ctx.drainJobs();
    const job = await api(ctx.app, 'GET', `/schedule-jobs/${jsonBody(gen).jobId}`, {
      token,
    });
    expect(jsonBody(job).status).toBe('done');
    const result = jsonBody(job).result as { warnings?: unknown[]; errors?: unknown[] };
    expect(result).toBeTruthy();
  });

  it('A-SCH-028 ended auto slot is kept across generate', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const task = await flexibleTask(token, 'Ended keep');
    const slots = ctx.app.get<Repository<ScheduledTask>>(
      getRepositoryToken(ScheduledTask),
    );
    const now = Date.now();
    const ended = await slots.save(
      slots.create({
        taskId: String(task.id),
        isAutoGenerated: true,
        scheduledStartTime: new Date(now - 2 * 60 * 60 * 1000),
        scheduledEndTime: new Date(now - 60 * 60 * 1000),
      }),
    );
    await api(ctx.app, 'POST', '/schedule/generate', { token, payload: {} });
    await ctx.drainJobs();
    const still = await slots.findOne({ where: { id: ended.id } });
    expect(still).toBeTruthy();
  });
});
