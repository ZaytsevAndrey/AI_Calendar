import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { closeTestApp, createTestApp, E2eApp } from './helpers/create-test-app';
import { createTimePhase, seedOnboardedUser, seedUser } from './helpers/auth';
import { api, jsonBody } from './helpers/http';
import { UserSettings } from '../src/modules/user-settings/entities/user-settings.entity';

describe('Settings and phases API e2e', () => {
  let ctx: E2eApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it('A-SET-002 second GET returns the same settings row', async () => {
    const { token } = await seedUser(ctx.app);
    const first = await api(ctx.app, 'GET', '/user-settings', { token });
    const second = await api(ctx.app, 'GET', '/user-settings', { token });
    expect(jsonBody(first).id).toBe(jsonBody(second).id);
  });

  it('A-SET-003 / A-SET-005 PATCH persists wake/sleep/timezone/split/horizon', async () => {
    const { token } = await seedUser(ctx.app);
    await api(ctx.app, 'GET', '/user-settings', { token });
    const res = await api(ctx.app, 'PATCH', '/user-settings', {
      token,
      payload: {
        wakeTime: '08:00',
        sleepTime: '23:00',
        timeZone: 'Europe/Kyiv',
        minSplitMinutes: 20,
        maxSplitMinutes: 40,
        recurringScheduleHorizonDays: 10,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = jsonBody(res);
    expect(body.wakeTime).toMatch(/^08:00/);
    expect(body.sleepTime).toMatch(/^23:00/);
    expect(body.timeZone).toBe('Europe/Kyiv');
    expect(body.minSplitMinutes).toBe(20);
    expect(body.recurringScheduleHorizonDays).toBe(10);
  });

  it('A-SET-004 minSplitMinutes above max bumps max', async () => {
    const { token } = await seedUser(ctx.app);
    await api(ctx.app, 'GET', '/user-settings', { token });
    const res = await api(ctx.app, 'PATCH', '/user-settings', {
      token,
      payload: { minSplitMinutes: 90, maxSplitMinutes: 30 },
    });
    expect(res.statusCode).toBe(200);
    expect(jsonBody(res).maxSplitMinutes).toBe(90);
  });

  it('A-SET-006 invalid IANA is recorded as current HTTP behavior', async () => {
    const { token } = await seedUser(ctx.app);
    await api(ctx.app, 'GET', '/user-settings', { token });
    const res = await api(ctx.app, 'PATCH', '/user-settings', {
      token,
      payload: { timeZone: 'Not/AZone' },
    });
    expect([200, 400]).toContain(res.statusCode);
  });

  it('A-SET-007 empty timeZone is not auto-filled on GET', async () => {
    const { token, user } = await seedUser(ctx.app);
    await api(ctx.app, 'GET', '/user-settings', { token });
    const repo = ctx.app.get<Repository<UserSettings>>(
      getRepositoryToken(UserSettings),
    );
    await repo.update({ userId: user.id }, { timeZone: null });
    const afterGet = await api(ctx.app, 'GET', '/user-settings', { token });
    await api(ctx.app, 'PATCH', '/user-settings', {
      token,
      payload: { wakeTime: '07:30' },
    });
    const afterPatch = await api(ctx.app, 'GET', '/user-settings', { token });
    expect(jsonBody(afterGet).timeZone == null).toBe(true);
    expect(jsonBody(afterPatch).timeZone == null).toBe(true);
  });

  it('A-SET-009 / A-SET-010 requiredFilled false without Google or phases', async () => {
    const { token } = await seedUser(ctx.app);
    await api(ctx.app, 'GET', '/user-settings', { token });
    const res = await api(ctx.app, 'GET', '/user-settings/required', { token });
    expect(res.statusCode).toBe(200);
    expect(jsonBody(res).requiredFilled).toBe(false);
    expect(jsonBody(res).hasPhases).toBe(false);
  });

  it('A-SET-011 / A-SET-013 engine-only fields persist', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const res = await api(ctx.app, 'PATCH', '/user-settings', {
      token,
      payload: {
        weekendWorkEnabled: true,
        allowSplitScheduling: false,
        defaultWorkBlockDuration: 40,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(jsonBody(res).weekendWorkEnabled).toBe(true);
    expect(jsonBody(res).allowSplitScheduling).toBe(false);
    expect(jsonBody(res).defaultWorkBlockDuration).toBe(40);

    const required = await api(ctx.app, 'GET', '/user-settings/required', {
      token,
    });
    expect(jsonBody(required).hasPhases).toBe(true);
  });

  it('A-SET-012 calendar rename failure still saves settings', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    ctx.google.updateAppCalendarSummaryIfLinked.mockRejectedValueOnce(
      new Error('rename failed'),
    );
    const res = await api(ctx.app, 'PATCH', '/user-settings', {
      token,
      payload: { appGoogleCalendarName: 'My planner' },
    });
    expect(res.statusCode).toBe(200);
    expect(jsonBody(res).appGoogleCalendarName).toBe('My planner');
  });

  it('A-PH-003 setup-defaults without settings is 400', async () => {
    const { token } = await seedUser(ctx.app);
    const res = await api(ctx.app, 'POST', '/phases/setup-defaults', {
      token,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('A-PH-005 / A-PH-006 time-phase vs sleep filters', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    await createTimePhase(ctx.app, token);
    const time = await api(ctx.app, 'GET', '/phases/time-phases', { token });
    const sleep = await api(ctx.app, 'GET', '/phases/sleep-time', { token });
    const timeRows = time.json() as Array<{ type: string }>;
    const sleepRows = sleep.json() as Array<{ type: string }>;
    expect(timeRows.every((p) => p.type === 'time_phase')).toBe(true);
    expect(timeRows.length).toBeGreaterThan(0);
    expect(sleepRows.every((p) => p.type === 'sleep_time')).toBe(true);
    expect(sleepRows.length).toBeGreaterThan(0);
  });

  it('A-PH-007 / A-PH-008 weekday date filter', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    await createTimePhase(ctx.app, token, { weekDays: [1, 2, 3, 4, 5] });
    const saturday = await api(
      ctx.app,
      'GET',
      '/phases/time-phases/date/2026-09-26',
      { token },
    );
    const monday = await api(
      ctx.app,
      'GET',
      '/phases/time-phases/date/2026-09-21',
      { token },
    );
    const satRows = saturday.json() as Array<{ weekDays?: number[] | null }>;
    const monRows = monday.json() as Array<{ name: string }>;
    expect(satRows.every((p) => (p.weekDays || []).includes(6) || !p.weekDays?.length)).toBe(
      true,
    );
    expect(monRows.some((p) => p.name === 'Deep work')).toBe(true);
  });

  it('A-PH-009 / A-PH-010 overnight create is stored', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const res = await createTimePhase(ctx.app, token, {
      name: 'Night',
      startTime: '22:00',
      endTime: '06:00',
    });
    expect(res.startTime).toBe('22:00');
    expect(res.endTime).toBe('06:00');
  });

  it('A-PH-011 overlapping phases are allowed', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    await createTimePhase(ctx.app, token, {
      name: 'A',
      startTime: '09:00',
      endTime: '12:00',
    });
    const overlap = await api(ctx.app, 'POST', '/phases', {
      token,
      payload: {
        name: 'B',
        color: '#e74c3c',
        startTime: '10:00',
        endTime: '14:00',
        type: 'time_phase',
      },
    });
    expect([200, 201]).toContain(overlap.statusCode);
  });

  it('A-PH-012 / A-PH-017 empty and duplicate weekDays', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const created = await createTimePhase(ctx.app, token, {
      weekDays: [1, 1, 3],
    });
    expect((created.weekDays as number[]).join(',')).toBe('1,3');
    const patched = await api(ctx.app, 'PATCH', `/phases/${created.id}`, {
      token,
      payload: { weekDays: [] },
    });
    expect(patched.statusCode).toBe(200);
    expect(jsonBody(patched).weekDays == null).toBe(true);
  });

  it('A-PH-013 / A-PH-014 GET PATCH DELETE own vs unknown', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const phase = await createTimePhase(ctx.app, token, { name: 'Solo' });
    const got = await api(ctx.app, 'GET', `/phases/${phase.id}`, { token });
    expect(got.statusCode).toBe(200);
    const patched = await api(ctx.app, 'PATCH', `/phases/${phase.id}`, {
      token,
      payload: { name: 'Solo 2' },
    });
    expect(patched.statusCode).toBe(200);
    expect(jsonBody(patched).name).toBe('Solo 2');
    const missing = '11111111-1111-4111-8111-111111111111';
    expect((await api(ctx.app, 'GET', `/phases/${missing}`, { token })).statusCode).toBe(
      404,
    );
    expect(
      (await api(ctx.app, 'DELETE', `/phases/${missing}`, { token })).statusCode,
    ).toBe(404);
  });

  it('A-PH-015 / A-PH-016 delete blocked by tasks then allowed when empty', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const phase = await createTimePhase(ctx.app, token, { name: 'Busy' });
    await api(ctx.app, 'POST', '/tasks', {
      token,
      payload: {
        name: 'Linked',
        estimatedTimeInMinutes: 30,
        phaseIds: [phase.id],
      },
    });
    await ctx.drainJobs();
    const blocked = await api(ctx.app, 'DELETE', `/phases/${phase.id}`, {
      token,
    });
    expect(blocked.statusCode).toBe(409);

    const empty = await createTimePhase(ctx.app, token, { name: 'Empty' });
    const removed = await api(ctx.app, 'DELETE', `/phases/${empty.id}`, {
      token,
    });
    expect(removed.statusCode).toBe(200);
  });

  it('A-PH-018 apply-preset creates lifestyle blocks and hides Focus', async () => {
    const { token } = await seedUser(ctx.app);
    await api(ctx.app, 'GET', '/user-settings', { token });
    await api(ctx.app, 'PATCH', '/user-settings', {
      token,
      payload: { wakeTime: '08:00', sleepTime: '23:00' },
    });
    const created = await api(ctx.app, 'POST', '/phases/apply-preset', {
      token,
      payload: { presetId: 'working', weekDays: [1, 2, 3, 4, 5] },
    });
    expect([200, 201]).toContain(created.statusCode);
    const phases = created.json() as Array<{
      name: string;
      type: string;
      startTime: string;
      endTime: string;
      weekDays: number[] | null;
    }>;
    expect(phases.some((phase) => phase.name === 'Focus hours')).toBe(false);
    const deep = phases.find((phase) => phase.name === 'Deep work');
    const admin = phases.find((phase) => phase.name === 'Life admin');
    expect(deep).toMatchObject({
      type: 'time_phase',
      startTime: expect.stringMatching(/^08:00/),
      endTime: expect.stringMatching(/^11:00/),
    });
    expect(deep?.weekDays).toEqual([1, 2, 3, 4, 5]);
    expect(admin).toMatchObject({
      startTime: expect.stringMatching(/^21:00/),
      endTime: expect.stringMatching(/^23:00/),
    });
    expect(phases.some((phase) => phase.name === 'Sleep' && phase.type === 'sleep_time')).toBe(
      true,
    );
  });

  it('A-PH-019 apply-preset replaces existing phases and refuses when a phase has tasks', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    await api(ctx.app, 'PATCH', '/user-settings', {
      token,
      payload: { wakeTime: '08:00', sleepTime: '23:00' },
    });
    const replaced = await api(ctx.app, 'POST', '/phases/apply-preset', {
      token,
      payload: { presetId: 'student', weekDays: [1, 2, 3, 4, 5] },
    });
    expect([200, 201]).toContain(replaced.statusCode);
    const phases = replaced.json() as Array<{ id: string; name: string }>;
    expect(phases.some((phase) => phase.name === 'Classes')).toBe(true);
    expect(phases.some((phase) => phase.name === 'Deep work')).toBe(false);

    const classes = phases.find((phase) => phase.name === 'Classes');
    await api(ctx.app, 'POST', '/tasks', {
      token,
      payload: {
        name: 'Lecture notes',
        estimatedTimeInMinutes: 30,
        phaseIds: [classes?.id],
      },
    });
    await ctx.drainJobs();

    const blocked = await api(ctx.app, 'POST', '/phases/apply-preset', {
      token,
      payload: { presetId: 'open', weekDays: [1, 2, 3, 4, 5] },
    });
    expect(blocked.statusCode).toBe(400);
    const still = await api(ctx.app, 'GET', '/phases', { token });
    const names = (still.json() as Array<{ name: string }>).map((phase) => phase.name);
    expect(names).toContain('Classes');
    expect(names).not.toContain('Morning focus');
  });

  it('A-PH-020 apply-preset without settings or an unknown id is 400', async () => {
    const { token } = await seedUser(ctx.app);
    const missingSettings = await api(ctx.app, 'POST', '/phases/apply-preset', {
      token,
      payload: { presetId: 'working' },
    });
    expect(missingSettings.statusCode).toBe(400);

    await api(ctx.app, 'GET', '/user-settings', { token });
    const unknown = await api(ctx.app, 'POST', '/phases/apply-preset', {
      token,
      payload: { presetId: 'nope' },
    });
    expect(unknown.statusCode).toBe(400);
  });
});
