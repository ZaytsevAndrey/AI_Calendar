import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { closeTestApp, createTestApp, E2eApp } from './helpers/create-test-app';
import { seedOnboardedUser, seedUser } from './helpers/auth';
import { api, jsonBody } from './helpers/http';
import { Task } from '../src/modules/tasks/entities/task.entity';
import { addDaysToYmd } from '../src/modules/voice/voice-local-date.util';

describe('P0 API e2e', () => {
  let ctx: E2eApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  describe('A-INFRA health and JWT', () => {
    it('A-INFRA-001 GET /health returns ok without JWT', async () => {
      const res = await api(ctx.app, 'GET', '/health');
      expect(res.statusCode).toBe(200);
      expect(jsonBody(res).status).toBe('ok');
    });

    it('A-INFRA-002 protected route without Authorization is 401 INVALID_JWT', async () => {
      const res = await api(ctx.app, 'GET', '/tasks');
      expect(res.statusCode).toBe(401);
      expect(jsonBody(res).code).toBe('INVALID_JWT');
    });
  });

  describe('A-SET settings and required', () => {
    it('A-SET-001 GET /user-settings creates default wake/sleep', async () => {
      const { token } = await seedUser(ctx.app);
      const res = await api(ctx.app, 'GET', '/user-settings', { token });
      expect(res.statusCode).toBe(200);
      const body = jsonBody(res);
      expect(body.wakeTime).toBeTruthy();
      expect(body.sleepTime).toBeTruthy();
    });

    it('A-SET-008 requiredFilled is true after wake/sleep/link', async () => {
      const { token } = await seedOnboardedUser(ctx.app);
      const res = await api(ctx.app, 'GET', '/user-settings/required', {
        token,
      });
      expect(res.statusCode).toBe(200);
      const body = jsonBody(res);
      expect(body.requiredFilled).toBe(true);
      expect(body.hasPhases).toBe(true);
    });
  });

  describe('A-PH default phases', () => {
    it('A-PH-001 setup-defaults creates Sleep and hides Focus from list', async () => {
      const { token } = await seedUser(ctx.app);
      await api(ctx.app, 'GET', '/user-settings', { token });
      const created = await api(ctx.app, 'POST', '/phases/setup-defaults', {
        token,
        payload: {},
      });
      expect([200, 201]).toContain(created.statusCode);

      const list = await api(ctx.app, 'GET', '/phases', { token });
      expect(list.statusCode).toBe(200);
      const phases = list.json() as Array<{ name: string; type: string }>;
      expect(phases.some((p) => p.name === 'Sleep' && p.type === 'sleep_time')).toBe(
        true,
      );
      expect(phases.some((p) => p.name === 'Focus hours')).toBe(false);
    });

    it('A-PH-002 setup-defaults a second time is 400', async () => {
      const { token } = await seedOnboardedUser(ctx.app);
      const res = await api(ctx.app, 'POST', '/phases/setup-defaults', {
        token,
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('A-TSK create', () => {
    it('A-TSK-001 flexible create seats without a replan job', async () => {
      const { token } = await seedOnboardedUser(ctx.app);
      const res = await api(ctx.app, 'POST', '/tasks', {
        token,
        payload: { name: 'Write report', estimatedTimeInMinutes: 30 },
      });
      expect(res.statusCode).toBe(201);
      const body = jsonBody(res);
      expect(body.id).toBeTruthy();
      expect(body.jobId).toBeNull();
      expect(body.eventType).toBe('admin');
    });

    it('A-TSK-006 unscheduled create has null jobId', async () => {
      const { token } = await seedOnboardedUser(ctx.app);
      const res = await api(ctx.app, 'POST', '/tasks', {
        token,
        payload: { name: 'Inbox idea', isUnscheduled: true },
      });
      expect(res.statusCode).toBe(201);
      const body = jsonBody(res);
      expect(body.isUnscheduled).toBe(true);
      expect(body.jobId).toBeNull();
    });
  });

  describe('A-SCH placement on create', () => {
    it('A-SCH-009 create seats a flexible task', async () => {
      const { token } = await seedOnboardedUser(ctx.app);
      const created = await api(ctx.app, 'POST', '/tasks', {
        token,
        payload: { name: 'Deep work', estimatedTimeInMinutes: 30 },
      });
      expect(created.statusCode).toBe(201);
      const taskId = String(jsonBody(created).id);

      const schedule = await api(ctx.app, 'GET', '/schedule', { token });
      expect(schedule.statusCode).toBe(200);
      const rows = schedule.json() as Array<{ taskId: string }>;
      expect(rows.some((row) => row.taskId === taskId)).toBe(true);
    });

    it('A-SCH-010 unscheduled task is not seated', async () => {
      const { token } = await seedOnboardedUser(ctx.app);
      const created = await api(ctx.app, 'POST', '/tasks', {
        token,
        payload: { name: 'Later', isUnscheduled: true },
      });
      const taskId = jsonBody(created).id;

      const schedule = await api(ctx.app, 'GET', '/schedule', { token });
      const rows = schedule.json() as Array<{ taskId: string }>;
      expect(rows.some((row) => row.taskId === taskId)).toBe(false);
    });
  });

  describe('A-HAB habits', () => {
    it('A-HAB-002 / A-HAB-011 / A-HAB-013 create, today check-in, reject date outside the window', async () => {
      const { token } = await seedOnboardedUser(ctx.app);
      const created = await api(ctx.app, 'POST', '/habits', {
        token,
        payload: { name: 'Exercise' },
      });
      expect(created.statusCode).toBe(201);
      const habitId = jsonBody(created).id;
      expect(habitId).toBeTruthy();

      const listed = await api(ctx.app, 'GET', '/habits', { token });
      const today = String(jsonBody(listed).today);
      expect(jsonBody(listed).editableTo).toBe(today);
      expect(jsonBody(listed).editableFrom).toBe(addDaysToYmd(today, -13));

      const checkIn = await api(ctx.app, 'POST', `/habits/${habitId}/check-ins`, {
        token,
        payload: { date: today },
      });
      expect(checkIn.statusCode).toBe(201);
      expect(jsonBody(checkIn).checkedToday).toBe(true);

      const rejected = await api(
        ctx.app,
        'POST',
        `/habits/${habitId}/check-ins`,
        { token, payload: { date: addDaysToYmd(today, -14) } },
      );
      expect(rejected.statusCode).toBe(400);
    });
  });

  describe('X-ISO isolation', () => {
    it('X-ISO-001 user A cannot read user B task', async () => {
      const a = await seedOnboardedUser(ctx.app);
      const b = await seedOnboardedUser(ctx.app);
      const created = await api(ctx.app, 'POST', '/tasks', {
        token: b.token,
        payload: { name: 'Secret', estimatedTimeInMinutes: 30 },
      });
      const taskId = jsonBody(created).id;
      await ctx.drainJobs();

      const res = await api(ctx.app, 'GET', `/tasks/${taskId}`, {
        token: a.token,
      });
      expect(res.statusCode).toBe(404);

      const stillThere = ctx.app.get<Repository<Task>>(getRepositoryToken(Task));
      const row = await stillThere.findOne({ where: { id: String(taskId) } });
      expect(row).toBeTruthy();
    });
  });
});
