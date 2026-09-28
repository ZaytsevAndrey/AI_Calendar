import { randomUUID } from 'crypto';
import { closeTestApp, createTestApp, E2eApp } from './helpers/create-test-app';
import { seedOnboardedUser } from './helpers/auth';
import { api, jsonBody } from './helpers/http';

type FreeSlotsBody = {
  ymd: string;
  timeZone: string;
  durationMinutes: number;
  dayStart: string;
  dayEnd: string;
  phase: { id: string; name: string; color: string } | null;
  busy: { start: string; end: string }[];
  free: { start: string; end: string }[];
  candidates: string[];
};

describe('Schedule free-slots API e2e (A-SCH-033+)', () => {
  let ctx: E2eApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  async function parkedTask(
    token: string,
    opts?: { minutes?: number; ymd?: string; name?: string },
  ) {
    const ymd = opts?.ymd ?? '2026-10-05';
    const res = await api(ctx.app, 'POST', '/tasks', {
      token,
      payload: {
        name: opts?.name ?? 'Parked for slots',
        estimatedTimeInMinutes: opts?.minutes ?? 30,
        isProblematic: true,
        problematicReason: 'phase_full',
        problematicOccurrenceYmds: [ymd],
      },
    });
    expect(res.statusCode).toBe(201);
    await ctx.drainJobs();
    return jsonBody(res) as { id: string; estimatedTimeInMinutes: number };
  }

  async function freeSlots(
    token: string,
    taskId: string,
    ymd: string,
    phaseId?: string,
  ) {
    const qs = new URLSearchParams({ taskId, ymd });
    if (phaseId) qs.set('phaseId', phaseId);
    return api(ctx.app, 'GET', `/schedule/free-slots?${qs.toString()}`, {
      token,
    });
  }

  it('A-SCH-033a rejects unauthenticated calls', async () => {
    const res = await api(
      ctx.app,
      'GET',
      `/schedule/free-slots?taskId=${randomUUID()}&ymd=2026-10-05`,
    );
    expect(res.statusCode).toBe(401);
  });

  it('A-SCH-033b rejects missing taskId', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const res = await api(ctx.app, 'GET', '/schedule/free-slots?ymd=2026-10-05', {
      token,
    });
    expect(res.statusCode).toBe(400);
  });

  it('A-SCH-033c rejects invalid ymd', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const task = await parkedTask(token);
    const res = await freeSlots(token, task.id, 'not-a-day');
    expect(res.statusCode).toBe(400);
  });

  it('A-SCH-033d returns 404 for unknown task', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const res = await freeSlots(token, randomUUID(), '2026-10-05');
    expect(res.statusCode).toBe(404);
  });

  it('A-SCH-033e returns 404 for another users task', async () => {
    const a = await seedOnboardedUser(ctx.app);
    const b = await seedOnboardedUser(ctx.app);
    const task = await parkedTask(a.token, { name: 'Owner A' });
    const res = await freeSlots(b.token, task.id, '2026-10-05');
    expect(res.statusCode).toBe(404);
  });

  it('A-SCH-033f returns candidates for a parked flexible task', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const task = await parkedTask(token);
    const res = await freeSlots(token, task.id, '2026-10-05');
    expect(res.statusCode).toBe(200);
    const body = jsonBody(res) as unknown as FreeSlotsBody;
    expect(body.ymd).toBe('2026-10-05');
    expect(body.durationMinutes).toBe(30);
    expect(body.candidates.length).toBeGreaterThan(0);
    expect(body.free.length).toBeGreaterThan(0);
    expect(body.dayStart).toBeTruthy();
    expect(body.dayEnd).toBeTruthy();
  });

  it('A-SCH-033g echoes task durationMinutes', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const task = await parkedTask(token, { minutes: 45 });
    const res = await freeSlots(token, task.id, '2026-10-05');
    expect(res.statusCode).toBe(200);
    expect((jsonBody(res) as unknown as FreeSlotsBody).durationMinutes).toBe(45);
  });

  it('A-SCH-033h candidates sit on a 15-minute grid', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const task = await parkedTask(token);
    const res = await freeSlots(token, task.id, '2026-10-05');
    const body = jsonBody(res) as unknown as FreeSlotsBody;
    expect(body.candidates.length).toBeGreaterThanOrEqual(2);
    const a = Date.parse(body.candidates[0]);
    const b = Date.parse(body.candidates[1]);
    expect(b - a).toBe(15 * 60_000);
  });

  it('A-SCH-033i candidates fall inside dayStart..dayEnd', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const task = await parkedTask(token);
    const res = await freeSlots(token, task.id, '2026-10-05');
    const body = jsonBody(res) as unknown as FreeSlotsBody;
    const dayStart = Date.parse(body.dayStart);
    const dayEnd = Date.parse(body.dayEnd);
    const durationMs = body.durationMinutes * 60_000;
    for (const iso of body.candidates) {
      const start = Date.parse(iso);
      expect(start).toBeGreaterThanOrEqual(dayStart);
      expect(start + durationMs).toBeLessThanOrEqual(dayEnd);
    }
  });

  it('A-SCH-033j returns ISO candidate strings', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const task = await parkedTask(token);
    const res = await freeSlots(token, task.id, '2026-10-05');
    const body = jsonBody(res) as unknown as FreeSlotsBody;
    for (const iso of body.candidates.slice(0, 5)) {
      expect(Number.isNaN(Date.parse(iso))).toBe(false);
      expect(iso).toMatch(/T/);
    }
  });

  it('A-SCH-033k phaseId selects a schedulable phase', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const task = await parkedTask(token);
    const phases = await api(ctx.app, 'GET', '/phases', { token });
    expect(phases.statusCode).toBe(200);
    const timePhase = (phases.json() as Array<{ id: string; type: string }>).find(
      (p) => p.type === 'time_phase',
    );
    // Defaults may only expose sleep; create a time phase if needed
    let phaseId = timePhase?.id;
    if (!phaseId) {
      const created = await api(ctx.app, 'POST', '/phases', {
        token,
        payload: {
          name: 'Deep work',
          color: '#336699',
          startTime: '09:00',
          endTime: '12:00',
          type: 'time_phase',
        },
      });
      expect(created.statusCode).toBe(201);
      phaseId = (jsonBody(created) as { id: string }).id;
    }
    const res = await freeSlots(token, task.id, '2026-10-05', phaseId);
    expect(res.statusCode).toBe(200);
    const body = jsonBody(res) as unknown as FreeSlotsBody;
    expect(body.phase?.id).toBe(phaseId);
    expect(body.candidates.length).toBeGreaterThan(0);
  });

  it('A-SCH-033l rejects sleep_time phaseId', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const task = await parkedTask(token);
    const phases = await api(ctx.app, 'GET', '/phases', { token });
    const sleep = (phases.json() as Array<{ id: string; type: string }>).find(
      (p) => p.type === 'sleep_time',
    );
    expect(sleep?.id).toBeTruthy();
    const res = await freeSlots(token, task.id, '2026-10-05', sleep!.id);
    expect(res.statusCode).toBe(400);
  });

  it('A-SCH-033m rejects unknown phaseId', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const task = await parkedTask(token);
    const res = await freeSlots(token, task.id, '2026-10-05', randomUUID());
    expect(res.statusCode).toBe(400);
  });

  it('A-SCH-033n fixed peer busy reduces free room', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const task = await parkedTask(token, { minutes: 30, ymd: '2026-10-07' });
    const open = await freeSlots(token, task.id, '2026-10-07');
    const openCount = (jsonBody(open) as unknown as FreeSlotsBody).candidates
      .length;

    await api(ctx.app, 'POST', '/tasks', {
      token,
      payload: {
        name: 'Fixed blocker',
        eventType: 'fixed',
        estimatedTimeInMinutes: 8 * 60,
        scheduledStartTime: '2026-10-07T04:00:00.000Z',
        scheduledEndTime: '2026-10-07T18:00:00.000Z',
      },
    });
    await ctx.drainJobs();

    const blocked = await freeSlots(token, task.id, '2026-10-07');
    expect(blocked.statusCode).toBe(200);
    const blockedCount = (jsonBody(blocked) as unknown as FreeSlotsBody)
      .candidates.length;
    expect(blockedCount).toBeLessThan(openCount);
  });

  it('A-SCH-033o huge duration yields empty candidates', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const task = await parkedTask(token, { minutes: 20 * 60 });
    const res = await freeSlots(token, task.id, '2026-10-05');
    expect(res.statusCode).toBe(200);
    expect((jsonBody(res) as unknown as FreeSlotsBody).candidates).toEqual([]);
  });

  it('A-SCH-033p does not require isProblematic to list slots', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const created = await api(ctx.app, 'POST', '/tasks', {
      token,
      payload: { name: 'Normal flex', estimatedTimeInMinutes: 30 },
    });
    expect(created.statusCode).toBe(201);
    await ctx.drainJobs();
    const task = jsonBody(created) as { id: string };
    const res = await freeSlots(token, task.id, '2026-10-08');
    expect(res.statusCode).toBe(200);
    expect(
      (jsonBody(res) as unknown as FreeSlotsBody).candidates.length,
    ).toBeGreaterThan(0);
  });

  it('A-SCH-033q returns timeZone from user settings', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const task = await parkedTask(token);
    const res = await freeSlots(token, task.id, '2026-10-05');
    expect(res.statusCode).toBe(200);
    expect((jsonBody(res) as unknown as FreeSlotsBody).timeZone).toBe(
      'Europe/Kyiv',
    );
  });

  it('A-SCH-033r without phaseId spans all schedulable phases, not only the task link', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const morning = await api(ctx.app, 'POST', '/phases', {
      token,
      payload: {
        name: 'Morning only',
        color: '#11aa55',
        startTime: '09:00',
        endTime: '12:00',
        type: 'time_phase',
      },
    });
    expect(morning.statusCode).toBe(201);
    const morningId = (jsonBody(morning) as { id: string }).id;
    const evening = await api(ctx.app, 'POST', '/phases', {
      token,
      payload: {
        name: 'Evening only',
        color: '#aa5511',
        startTime: '18:00',
        endTime: '21:00',
        type: 'time_phase',
      },
    });
    expect(evening.statusCode).toBe(201);

    const created = await api(ctx.app, 'POST', '/tasks', {
      token,
      payload: {
        name: 'Linked to morning',
        estimatedTimeInMinutes: 30,
        phaseId: morningId,
        isProblematic: true,
        problematicReason: 'phase_full',
        problematicOccurrenceYmds: ['2026-10-22'],
      },
    });
    expect(created.statusCode).toBe(201);
    await ctx.drainJobs();
    const task = jsonBody(created) as { id: string };

    const all = await freeSlots(token, task.id, '2026-10-22');
    expect(all.statusCode).toBe(200);
    const allBody = jsonBody(all) as unknown as FreeSlotsBody;
    expect(allBody.candidates.length).toBeGreaterThan(0);
    const hours = allBody.candidates.map((iso) =>
      new Date(iso).toISOString().slice(11, 13),
    );
    // Must include both morning and evening windows (Kyiv = UTC+3 in Oct → 09:00 local = 06:00Z).
    const hasMorning = allBody.candidates.some((iso) => {
      const t = Date.parse(iso);
      return t >= Date.parse('2026-10-22T06:00:00.000Z') && t < Date.parse('2026-10-22T09:00:00.000Z');
    });
    const hasEvening = allBody.candidates.some((iso) => {
      const t = Date.parse(iso);
      return t >= Date.parse('2026-10-22T15:00:00.000Z') && t < Date.parse('2026-10-22T18:00:00.000Z');
    });
    expect(hasMorning).toBe(true);
    expect(hasEvening).toBe(true);
    expect(hours.length).toBeGreaterThan(0);

    const filtered = await freeSlots(token, task.id, '2026-10-22', morningId);
    expect(filtered.statusCode).toBe(200);
    const filteredBody = jsonBody(filtered) as unknown as FreeSlotsBody;
    expect(
      filteredBody.candidates.every((iso) => {
        const t = Date.parse(iso);
        return t >= Date.parse('2026-10-22T06:00:00.000Z') && t < Date.parse('2026-10-22T09:00:00.000Z');
      }),
    ).toBe(true);
    expect(filteredBody.candidates.length).toBeLessThan(allBody.candidates.length);
  });
});
