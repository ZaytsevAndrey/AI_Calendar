import { closeTestApp, createTestApp, E2eApp } from './helpers/create-test-app';
import { seedOnboardedUser } from './helpers/auth';
import { mockVoiceParseTurn } from './helpers/groq.stub';
import { api, jsonBody } from './helpers/http';
import { ServiceUnavailableException } from '@nestjs/common';

describe('Habits and voice API e2e', () => {
  let ctx: E2eApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it('A-HAB-001 empty list includes civil today (MVP soft-disabled)', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const res = await api(ctx.app, 'GET', '/habits', { token });
    expect(res.statusCode).toBe(200);
    const body = jsonBody(res);
    expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.habits).toEqual([]);
  });

  it('A-HAB-002 mutations return 410 while soft-disabled', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    expect(
      (await api(ctx.app, 'POST', '/habits', { token, payload: { name: 'Exercise' } }))
        .statusCode,
    ).toBe(410);
    expect(
      (
        await api(ctx.app, 'PATCH', '/habits/00000000-0000-4000-8000-000000000001', {
          token,
          payload: { name: 'x' },
        })
      ).statusCode,
    ).toBe(410);
    expect(
      (
        await api(ctx.app, 'DELETE', '/habits/00000000-0000-4000-8000-000000000001', {
          token,
        })
      ).statusCode,
    ).toBe(410);
  });

  it('A-HAB-020 today uses settings time zone on empty list', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    await api(ctx.app, 'PATCH', '/user-settings', {
      token,
      payload: { timeZone: 'Pacific/Auckland' },
    });
    const res = await api(ctx.app, 'GET', '/habits', { token });
    expect(jsonBody(res).timeZone).toBe('Pacific/Auckland');
    expect(String(jsonBody(res).today)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(jsonBody(res).habits).toEqual([]);
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
      payload: { transcript: 'buy milk tomorrow', timeZone: 'Europe/Kyiv' },
    });
    expect(complete.statusCode).toBe(201);
    expect(jsonBody(complete).understanding).toBe('complete');
    expect((jsonBody(complete).task as Record<string, unknown>).name).toBe('Buy milk');

    mockVoiceParseTurn(
      ctx.groq,
      {
        understanding: 'needs_clarification',
        clarifyingQuestion: 'What is the task name?',
        task: { name: '', kind: 'flexible' },
      },
      { intent: 'create', language: 'en' },
    );
    // Create boilerplate with no title → still clarify name (not Unscheduled).
    const clarify = await api(ctx.app, 'POST', '/voice/parse-task', {
      token,
      payload: { transcript: 'create a task', timeZone: 'Europe/Kyiv' },
    });
    expect(jsonBody(clarify).understanding).toBe('needs_clarification');

    mockVoiceParseTurn(
      ctx.groq,
      {
        understanding: 'complete',
        clarifyingQuestion: null,
        task: {
          name: 'Gym',
          kind: 'flexible',
          earliestStartTime: '2026-09-08T00:00:00+03:00',
          deadline: '2026-09-08T23:59:00+03:00',
        },
      },
      { intent: 'create', language: 'en' },
    );
    const after = await api(ctx.app, 'POST', '/voice/parse-task', {
      token,
      payload: {
        transcript: 'gym',
        timeZone: 'Europe/Kyiv',
        previousTranscript: 'create a task',
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
    mockVoiceParseTurn(ctx.groq, {
      understanding: 'complete',
      task: {
        name: 'Walk',
        kind: 'flexible',
        eventType: 'admin',
        estimatedTimeInMinutes: 30,
        phaseId: '11111111-1111-4111-8111-111111111111',
        earliestStartTime: '2026-09-08T00:00:00+03:00',
        deadline: '2026-09-08T23:59:00+03:00',
      },
    });
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

  it('A-VOI-013 complete command resolves a named task and does not create one', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const created = await api(ctx.app, 'POST', '/tasks', {
      token,
      payload: {
        name: 'Report',
        eventType: 'admin',
        estimatedTimeInMinutes: 30,
      },
    });
    expect(created.statusCode).toBe(201);
    const id = jsonBody(created).id;
    mockVoiceParseTurn(
      ctx.groq,
      {
        intent: 'complete',
        understanding: 'complete',
        command: { target: 'named', taskName: 'Report', start: null, end: null },
        task: null,
      },
      { intent: 'complete', language: 'en' },
    );
    const parsed = await api(ctx.app, 'POST', '/voice/parse-task', {
      token,
      payload: { transcript: 'done with the report', timeZone: 'Europe/Kyiv' },
    });
    expect(parsed.statusCode).toBe(201);
    const body = jsonBody(parsed);
    expect(body.task).toBeNull();
    expect(body.command).toMatchObject({ kind: 'complete', taskId: id, taskName: 'Report' });
  });

  it('A-VOI-014 habit check-in resolves a named habit', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const created = await api(ctx.app, 'POST', '/habits', {
      token,
      payload: { name: 'Stretch' },
    });
    expect(created.statusCode).toBe(201);
    const id = String(jsonBody(created).id);
    const today = String(jsonBody(await api(ctx.app, 'GET', '/habits', { token })).today);
    mockVoiceParseTurn(
      ctx.groq,
      {
        intent: 'habit_check_in',
        understanding: 'complete',
        command: { target: 'named', taskName: 'Stretch', start: null, end: null },
        task: null,
      },
      { intent: 'habit_check_in', language: 'en' },
    );
    const parsed = await api(ctx.app, 'POST', '/voice/parse-task', {
      token,
      payload: { transcript: 'check in Stretch', timeZone: 'Europe/Kyiv' },
    });
    expect(parsed.statusCode).toBe(201);
    const body = jsonBody(parsed);
    expect(body.task).toBeNull();
    expect(body.command).toMatchObject({
      kind: 'habit_check_in',
      habitId: id,
      habitName: 'Stretch',
      date: today,
    });
  });

  it('A-VOI-015 update command resolves a named task patch', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const created = await api(ctx.app, 'POST', '/tasks', {
      token,
      payload: {
        name: 'Report',
        eventType: 'admin',
        estimatedTimeInMinutes: 30,
      },
    });
    expect(created.statusCode).toBe(201);
    const id = jsonBody(created).id;
    mockVoiceParseTurn(
      ctx.groq,
      {
        intent: 'update',
        understanding: 'complete',
        command: { target: 'named', taskName: 'Report', start: null, end: null },
        task: { estimatedTimeInMinutes: 45 },
      },
      { intent: 'update', language: 'en' },
    );
    const parsed = await api(ctx.app, 'POST', '/voice/parse-task', {
      token,
      payload: { transcript: 'change report to 45 minutes', timeZone: 'Europe/Kyiv' },
    });
    expect(parsed.statusCode).toBe(201);
    const body = jsonBody(parsed);
    expect(body.task).toBeNull();
    expect(body.command).toMatchObject({
      kind: 'update',
      taskId: id,
      patch: { estimatedTimeInMinutes: 45 },
    });
  });

  it('A-VOI-016 delete command resolves a named task', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const created = await api(ctx.app, 'POST', '/tasks', {
      token,
      payload: {
        name: 'Temp',
        eventType: 'admin',
        estimatedTimeInMinutes: 30,
      },
    });
    expect(created.statusCode).toBe(201);
    const id = jsonBody(created).id;
    mockVoiceParseTurn(
      ctx.groq,
      {
        intent: 'delete',
        understanding: 'complete',
        command: { target: 'named', taskName: 'Temp', start: null, end: null },
        task: null,
      },
      { intent: 'delete', language: 'en' },
    );
    const parsed = await api(ctx.app, 'POST', '/voice/parse-task', {
      token,
      payload: { transcript: 'delete Temp', timeZone: 'Europe/Kyiv' },
    });
    expect(parsed.statusCode).toBe(201);
    expect(jsonBody(parsed).command).toMatchObject({ kind: 'delete', taskId: id });
  });

  it('A-VOI-025 specialist asks which task: question kept, no "current" fallback', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    mockVoiceParseTurn(
      ctx.groq,
      {
        intent: 'reschedule',
        understanding: 'needs_clarification',
        clarifyingQuestion: 'Which task do you mean?',
        command: { target: 'current', taskName: null, start: null, end: null },
        task: null,
      },
      { intent: 'reschedule', language: 'en' },
    );
    const parsed = await api(ctx.app, 'POST', '/voice/parse-task', {
      token,
      payload: { transcript: 'move that thing', timeZone: 'Europe/Kyiv' },
    });
    expect(parsed.statusCode).toBe(201);
    expect(jsonBody(parsed)).toMatchObject({
      understanding: 'needs_clarification',
      clarifyingQuestion: 'Which task do you mean?',
      command: null,
    });
  });

  it('A-VOI-017 habit create and uncheck resolve', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    mockVoiceParseTurn(
      ctx.groq,
      {
        intent: 'habit_create',
        understanding: 'complete',
        command: { target: 'named', taskName: 'Meditation', start: null, end: null },
        habit: { name: 'Meditation', color: '#22c55e' },
        task: null,
      },
      { intent: 'habit_create', language: 'en' },
    );
    const created = await api(ctx.app, 'POST', '/voice/parse-task', {
      token,
      payload: { transcript: 'create habit Meditation', timeZone: 'Europe/Kyiv' },
    });
    expect(created.statusCode).toBe(201);
    expect(jsonBody(created).command).toMatchObject({
      kind: 'habit_create',
      fields: { name: 'Meditation', color: '#22c55e' },
    });

    const habit = await api(ctx.app, 'POST', '/habits', {
      token,
      payload: { name: 'Stretch' },
    });
    expect(habit.statusCode).toBe(201);
    const habitId = String(jsonBody(habit).id);
    const today = String(jsonBody(await api(ctx.app, 'GET', '/habits', { token })).today);
    mockVoiceParseTurn(
      ctx.groq,
      {
        intent: 'habit_uncheck',
        understanding: 'complete',
        command: { target: 'named', taskName: 'Stretch', start: null, end: null },
        task: null,
      },
      { intent: 'habit_uncheck', language: 'en' },
    );
    const unchecked = await api(ctx.app, 'POST', '/voice/parse-task', {
      token,
      payload: { transcript: 'uncheck Stretch', timeZone: 'Europe/Kyiv' },
    });
    expect(unchecked.statusCode).toBe(201);
    expect(jsonBody(unchecked).command).toMatchObject({
      kind: 'habit_uncheck',
      habitId,
      date: today,
    });
  });
});
