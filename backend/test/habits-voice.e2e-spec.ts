import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { closeTestApp, createTestApp, E2eApp } from './helpers/create-test-app';
import { seedOnboardedUser } from './helpers/auth';
import { api, jsonBody } from './helpers/http';
import { HabitCheckIn } from '../src/modules/habits/entities/habit-check-in.entity';
import { ServiceUnavailableException } from '@nestjs/common';

function addDaysYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

describe('Habits and voice API e2e', () => {
  let ctx: E2eApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it('A-HAB-001 empty list includes civil today', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const res = await api(ctx.app, 'GET', '/habits', { token });
    expect(res.statusCode).toBe(200);
    const body = jsonBody(res);
    expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.habits).toEqual([]);
  });

  it('A-HAB-003 / A-HAB-004 / A-HAB-005 / A-HAB-006 / A-HAB-007 validation', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    expect(
      (await api(ctx.app, 'POST', '/habits', { token, payload: { name: '  ' } }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await api(ctx.app, 'POST', '/habits', {
          token,
          payload: { name: 'x'.repeat(81) },
        })
      ).statusCode,
    ).toBe(400);
    const colored = await api(ctx.app, 'POST', '/habits', {
      token,
      payload: { name: 'Run', color: '#22c55e' },
    });
    expect(colored.statusCode).toBe(201);
    expect(jsonBody(colored).color).toBe('#22c55e');
    expect(
      (
        await api(ctx.app, 'POST', '/habits', {
          token,
          payload: { name: 'Bad', color: 'red' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await api(ctx.app, 'POST', '/habits', {
          token,
          payload: { name: 'Long', description: 'd'.repeat(501) },
        })
      ).statusCode,
    ).toBe(400);
  });

  it('A-HAB-008 / A-HAB-009 / A-HAB-010 update delete 404', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const created = await api(ctx.app, 'POST', '/habits', {
      token,
      payload: { name: 'Water' },
    });
    const id = jsonBody(created).id;
    const patched = await api(ctx.app, 'PATCH', `/habits/${id}`, {
      token,
      payload: { name: 'Water 2', description: '8 cups' },
    });
    expect(patched.statusCode).toBe(200);
    expect(jsonBody(patched).name).toBe('Water 2');

    const missing = '11111111-1111-4111-8111-111111111111';
    expect(
      (await api(ctx.app, 'PATCH', `/habits/${missing}`, { token, payload: { name: 'x' } }))
        .statusCode,
    ).toBe(404);
    expect((await api(ctx.app, 'DELETE', `/habits/${missing}`, { token })).statusCode).toBe(
      404,
    );

    expect((await api(ctx.app, 'DELETE', `/habits/${id}`, { token })).statusCode).toBe(
      200,
    );
    const listed = await api(ctx.app, 'GET', '/habits', { token });
    expect(
      (jsonBody(listed).habits as Array<{ id: string }>).some((h) => h.id === id),
    ).toBe(false);
  });

  it('A-HAB-012 / A-HAB-014 / A-HAB-015 / A-HAB-016 / A-HAB-017 check-in edges', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const created = await api(ctx.app, 'POST', '/habits', {
      token,
      payload: { name: 'Read' },
    });
    const id = jsonBody(created).id;
    const listed = await api(ctx.app, 'GET', '/habits', { token });
    const today = String(jsonBody(listed).today);
    const yesterday = String(jsonBody(listed).yesterday);

    const y = await api(ctx.app, 'POST', `/habits/${id}/check-ins`, {
      token,
      payload: { date: yesterday },
    });
    expect(y.statusCode).toBe(201);
    expect(jsonBody(y).checkedYesterday).toBe(true);

    const t1 = await api(ctx.app, 'POST', `/habits/${id}/check-ins`, {
      token,
      payload: { date: today },
    });
    const t2 = await api(ctx.app, 'POST', `/habits/${id}/check-ins`, {
      token,
      payload: { date: today },
    });
    expect(jsonBody(t1).totalCheckIns).toBe(jsonBody(t2).totalCheckIns);

    expect(
      (
        await api(ctx.app, 'POST', `/habits/${id}/check-ins`, {
          token,
          payload: { date: '2026-13-40' },
        })
      ).statusCode,
    ).toBe(400);

    const unchecked = await api(ctx.app, 'DELETE', `/habits/${id}/check-ins/${today}`, {
      token,
    });
    expect(unchecked.statusCode).toBe(200);
    expect(jsonBody(unchecked).checkedToday).toBe(false);

    expect(
      (
        await api(ctx.app, 'DELETE', `/habits/${id}/check-ins/${addDaysYmd(yesterday, -1)}`, {
          token,
        })
      ).statusCode,
    ).toBe(400);
  });

  it('A-HAB-018 / A-HAB-019 streak and weekly bonus points', async () => {
    const { token, user } = await seedOnboardedUser(ctx.app);
    const created = await api(ctx.app, 'POST', '/habits', {
      token,
      payload: { name: 'Streak' },
    });
    const habitId = String(jsonBody(created).id);
    const today = String(jsonBody(await api(ctx.app, 'GET', '/habits', { token })).today);
    const checkIns = ctx.app.get<Repository<HabitCheckIn>>(
      getRepositoryToken(HabitCheckIn),
    );
    for (let i = 6; i >= 0; i -= 1) {
      await checkIns.save(
        checkIns.create({
          habitId,
          userId: user.id,
          localDate: addDaysYmd(today, -i),
        }),
      );
    }
    const afterHistory = await api(ctx.app, 'GET', '/habits', { token });
    const habit = (jsonBody(afterHistory).habits as Array<Record<string, unknown>>).find(
      (row) => row.id === habitId,
    );
    expect(habit).toBeTruthy();
    expect(Number(habit?.currentStreak)).toBeGreaterThanOrEqual(7);
    expect(Number(habit?.points)).toBeGreaterThanOrEqual(8);
  });

  it('A-HAB-020 today uses settings time zone', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    await api(ctx.app, 'PATCH', '/user-settings', {
      token,
      payload: { timeZone: 'Pacific/Auckland' },
    });
    const res = await api(ctx.app, 'GET', '/habits', { token });
    expect(jsonBody(res).timeZone).toBe('Pacific/Auckland');
    expect(String(jsonBody(res).today)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('A-VOI-001 / A-VOI-002 / A-VOI-003 / A-VOI-004 transcribe', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const ok = await api(ctx.app, 'POST', '/voice/transcribe', {
      token,
      payload: { audioBase64: Buffer.from('fake-audio').toString('base64') },
    });
    expect(ok.statusCode).toBe(201);
    expect(jsonBody(ok).transcript).toBe('buy milk');

    expect(
      (
        await api(ctx.app, 'POST', '/voice/transcribe', {
          token,
          payload: { audioBase64: '' },
        })
      ).statusCode,
    ).toBe(400);

    const huge = Buffer.alloc(8 * 1024 * 1024 + 8, 1).toString('base64');
    expect(
      (
        await api(ctx.app, 'POST', '/voice/transcribe', {
          token,
          payload: { audioBase64: huge },
        })
      ).statusCode,
    ).toBe(400);

    ctx.groq.transcribe.mockRejectedValueOnce(
      new ServiceUnavailableException('Groq STT failed'),
    );
    const failed = await api(ctx.app, 'POST', '/voice/transcribe', {
      token,
      payload: { audioBase64: Buffer.from('x').toString('base64') },
    });
    expect(failed.statusCode).toBe(503);
  });

  it('A-VOI-005 / A-VOI-006 / A-VOI-007 / A-VOI-011 parse understanding', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const complete = await api(ctx.app, 'POST', '/voice/parse-task', {
      token,
      payload: { transcript: 'buy milk', timeZone: 'Europe/Kyiv' },
    });
    expect(complete.statusCode).toBe(201);
    expect(jsonBody(complete).understanding).toBe('complete');
    expect((jsonBody(complete).task as Record<string, unknown>).name).toBe('Buy milk');

    ctx.groq.completeJson.mockResolvedValueOnce(
      JSON.stringify({
        understanding: 'needs_clarification',
        clarifyingQuestion: 'What is the task name?',
        task: null,
      }),
    );
    const clarify = await api(ctx.app, 'POST', '/voice/parse-task', {
      token,
      payload: { transcript: 'umm', timeZone: 'Europe/Kyiv' },
    });
    expect(jsonBody(clarify).understanding).toBe('needs_clarification');

    ctx.groq.completeJson.mockResolvedValueOnce(
      JSON.stringify({
        understanding: 'needs_clarification',
        clarifyingQuestion: 'Still unclear?',
        task: { name: 'Gym' },
      }),
    );
    const after = await api(ctx.app, 'POST', '/voice/parse-task', {
      token,
      payload: {
        transcript: 'gym',
        timeZone: 'Europe/Kyiv',
        previousTranscript: 'umm',
        clarificationAnswer: 'gym',
      },
    });
    expect(jsonBody(after).understanding).not.toBe('needs_clarification');

    expect(
      (
        await api(ctx.app, 'POST', '/voice/parse-task', {
          token,
          payload: { transcript: '  ', timeZone: 'Europe/Kyiv' },
        })
      ).statusCode,
    ).toBe(400);
  });

  it('A-VOI-010 / A-VOI-012 invalid phase ids and non-JSON', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    ctx.groq.completeJson.mockResolvedValueOnce(
      JSON.stringify({
        understanding: 'complete',
        task: {
          name: 'Walk',
          eventType: 'admin',
          estimatedTimeInMinutes: 30,
          phaseIds: ['11111111-1111-4111-8111-111111111111'],
        },
      }),
    );
    const parsed = await api(ctx.app, 'POST', '/voice/parse-task', {
      token,
      payload: { transcript: 'walk', timeZone: 'Europe/Kyiv' },
    });
    const task = jsonBody(parsed).task as Record<string, unknown>;
    expect(task.phaseId == null || task.phaseId === '').toBe(true);

    ctx.groq.completeJson.mockResolvedValueOnce('not-json');
    const bad = await api(ctx.app, 'POST', '/voice/parse-task', {
      token,
      payload: { transcript: 'hello', timeZone: 'Europe/Kyiv' },
    });
    expect(bad.statusCode).toBe(400);
  });
});
