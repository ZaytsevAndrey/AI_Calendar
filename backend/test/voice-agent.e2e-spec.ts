import { randomUUID } from 'crypto';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { Task } from '../src/modules/tasks/entities/task.entity';
import type { VoiceTurnResponse } from '../src/modules/voice/voice-agent.types';
import { closeTestApp, createTestApp, E2eApp } from './helpers/create-test-app';
import { seedOnboardedUser } from './helpers/auth';
import { mockVoiceParseTurn } from './helpers/groq.stub';
import { api, jsonBody } from './helpers/http';

const TZ = 'Europe/Kyiv';

function ymdInDays(days: number): string {
  const date = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(date);
}

const createMilk = {
  intent: 'create',
  understanding: 'complete',
  clarifyingQuestion: null,
  task: { name: 'Buy milk', kind: 'unscheduled', eventType: 'admin', estimatedTimeInMinutes: 30 },
};

function namedCommand(intent: string, taskName: string) {
  return {
    intent,
    understanding: 'complete',
    command: { target: 'named', taskName, start: null, end: null },
    task: null,
  };
}

describe('Voice agent /voice/turn e2e', () => {
  let ctx: E2eApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  function queuePlanner(decision: Record<string, unknown>): void {
    ctx.groq.completeJson.mockResolvedValueOnce(JSON.stringify(decision));
  }

  async function user(): Promise<string> {
    const { token } = await seedOnboardedUser(ctx.app);
    await api(ctx.app, 'PATCH', '/user-settings', {
      token,
      payload: { timeZone: TZ, language: 'en', speechLanguage: 'en', confirmVoiceCommands: false },
    });
    return token;
  }

  async function task(token: string, name: string, extra: Record<string, unknown> = {}) {
    const res = await api(ctx.app, 'POST', '/tasks', {
      token,
      payload: { name, eventType: 'admin', estimatedTimeInMinutes: 30, ...extra },
    });
    expect(res.statusCode).toBe(201);
    await ctx.drainJobs();
    return jsonBody(res).id as string;
  }

  async function turn(
    token: string,
    sessionId: string,
    payload: Record<string, unknown>,
  ): Promise<VoiceTurnResponse> {
    const res = await api(ctx.app, 'POST', '/voice/turn', {
      token,
      payload: { sessionId, timeZone: TZ, ...payload },
    });
    expect(res.statusCode).toBe(201);
    return jsonBody(res) as unknown as VoiceTurnResponse;
  }

  it('A-VOI-020 one utterance with two writes returns both intents', async () => {
    const token = await user();
    const reportId = await task(token, 'Report');
    queuePlanner({ type: 'steps', answer: '', segments: ['buy milk', 'report is done'] });
    mockVoiceParseTurn(ctx.groq, createMilk);
    mockVoiceParseTurn(ctx.groq, namedCommand('complete', 'Report'), {
      intent: 'complete',
      language: 'en',
    });

    const sessionId = randomUUID();
    const body = await turn(token, sessionId, { transcript: 'buy milk and the report is done' });
    expect(body.outcome).toBe('confirm');
    expect(body.actions).toEqual(['confirm', 'cancel']);
    expect(body.intents).toHaveLength(2);
    expect(body.intents[0]).toMatchObject({ type: 'create', task: { name: 'Buy milk' } });
    expect(body.intents[1]).toMatchObject({
      type: 'command',
      command: { kind: 'complete', taskId: reportId },
    });
    expect(body.segments.map((row) => row.status)).toEqual(['ready', 'ready']);
    expect(body.plan).toBeNull();

    const applied = await turn(token, sessionId, { actionId: 'confirm' });
    expect(applied.outcome).toBe('act');
    expect(applied.intents).toHaveLength(2);
  });

  it('A-VOI-021 a batch with a delete is confirmed once, then reported', async () => {
    const token = await user();
    const draftId = await task(token, 'Draft');
    const sessionId = randomUUID();
    queuePlanner({ type: 'steps', answer: '', segments: ['buy milk', 'delete the draft'] });
    mockVoiceParseTurn(ctx.groq, createMilk);
    mockVoiceParseTurn(ctx.groq, namedCommand('delete', 'Draft'), {
      intent: 'delete',
      language: 'en',
    });

    const asked = await turn(token, sessionId, { transcript: 'buy milk and delete the draft' });
    expect(asked.outcome).toBe('confirm');
    expect(asked.actions).toEqual(['confirm', 'cancel']);
    expect(asked.intents).toHaveLength(2);

    const applied = await turn(token, sessionId, { actionId: 'confirm' });
    expect(applied.outcome).toBe('act');
    expect(applied.intents[1]).toMatchObject({ command: { kind: 'delete', taskId: draftId } });

    const reported = await turn(token, sessionId, {
      actionId: 'report',
      executionReport: {
        results: applied.intents.map((intent) => ({ summary: intent.summary, status: 'applied' })),
      },
    });
    expect(reported).toMatchObject({ outcome: 'answer', assistantMessage: '' });
  });

  it('A-VOI-022 day plan: propose with the engine, edit by voice, apply without writing early', async () => {
    const token = await user();
    const taxesId = await task(token, 'Taxes', { isUnscheduled: true });
    const emailId = await task(token, 'Email', { isUnscheduled: true });
    const day = ymdInDays(2);
    const sessionId = randomUUID();

    queuePlanner({ type: 'plan_start', day, interview: false, question: '', edits: [] });
    const opened = await turn(token, sessionId, { transcript: 'plan my day' });
    expect(opened.outcome).toBe('clarify');
    expect(opened.actions).toEqual(['build_plan', 'cancel']);
    expect(opened.plan).toMatchObject({ day, stage: 'interview' });
    expect(opened.plan!.items.map((item) => item.name).sort()).toEqual(['Email', 'Taxes']);

    const proposed = await turn(token, sessionId, { actionId: 'build_plan' });
    expect(proposed.outcome).toBe('confirm');
    expect(proposed.actions).toEqual(['confirm', 'cancel']);
    expect(proposed.intents).toEqual([]);
    expect(proposed.plan).toMatchObject({ day, stage: 'review' });
    const items = proposed.plan!.items;
    expect(items.map((item) => item.name).sort()).toEqual(['Email', 'Taxes']);
    expect(Date.parse(items[0].end)).toBeLessThanOrEqual(Date.parse(items[1].start));

    queuePlanner({ type: 'plan_edits', answer: '', edits: [{ op: 'remove_item', itemId: emailId }] });
    const edited = await turn(token, sessionId, { transcript: 'drop email' });
    expect(edited.outcome).toBe('clarify');
    expect(edited.plan!.items.map((item) => item.taskId)).toEqual([taxesId]);

    const reseated = await turn(token, sessionId, { actionId: 'build_plan' });
    expect(reseated.outcome).toBe('confirm');
    expect(reseated.plan!.items.map((item) => item.taskId)).toEqual([taxesId]);

    const tasks = ctx.app.get<Repository<Task>>(getRepositoryToken(Task));
    expect((await tasks.findOneByOrFail({ id: taxesId })).isUnscheduled).toBe(true);

    const applied = await turn(token, sessionId, { actionId: 'confirm' });
    expect(applied.outcome).toBe('act');
    expect(applied.intents).toHaveLength(1);
    expect(applied.intents[0]).toMatchObject({
      type: 'command',
      command: { kind: 'window', taskId: taxesId, clearUnscheduled: true },
    });

    const after = await turn(token, sessionId, {
      actionId: 'report',
      executionReport: { results: [{ summary: applied.intents[0].summary, status: 'applied' }] },
    });
    expect(after.plan).toBeNull();
  });

  it('A-VOI-023 interview, build_plan, cancel drops the draft', async () => {
    const token = await user();
    await task(token, 'Taxes', { isUnscheduled: true });
    const day = ymdInDays(2);
    const sessionId = randomUUID();

    queuePlanner({
      type: 'plan_start',
      day,
      interview: true,
      question: 'Anything fixed that day?',
      edits: [],
    });
    const asked = await turn(token, sessionId, { transcript: 'help me plan' });
    expect(asked.outcome).toBe('clarify');
    expect(asked.actions).toEqual(['build_plan', 'cancel']);
    expect(asked.plan).toMatchObject({ day, stage: 'interview' });
    expect(asked.plan!.items.map((item) => item.name)).toEqual(['Taxes']);

    const built = await turn(token, sessionId, { actionId: 'build_plan' });
    expect(built.outcome).toBe('confirm');
    expect(built.plan!.items).toHaveLength(1);

    const cancelled = await turn(token, sessionId, { actionId: 'cancel' });
    expect(cancelled.outcome).toBe('answer');
    expect(cancelled.plan).toBeNull();

    const again = await turn(token, sessionId, { actionId: 'confirm' });
    expect(again.plan).toBeNull();
    expect(again.intents).toEqual([]);
  });

  it('A-VOI-024 planner failure falls back to a single parse', async () => {
    const token = await user();
    ctx.groq.completeJson.mockResolvedValueOnce('not json at all');
    mockVoiceParseTurn(ctx.groq, createMilk);

    const body = await turn(token, randomUUID(), { transcript: 'buy milk' });
    expect(body.outcome).toBe('confirm');
    expect(body.intents).toHaveLength(1);
    expect(body.legacyParse?.task?.name).toBe('Buy milk');
  });
});
