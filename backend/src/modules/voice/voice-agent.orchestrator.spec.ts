import { TaskEventType } from '../scheduling/event-type.enum';
import { ScheduleState, type Task, TaskStatus } from '../tasks/entities/task.entity';
import type { GroqClient } from './groq.client';
import type { VoiceDayPlanner } from './voice-agent.day-plan';
import { VoiceAgentOrchestrator, type VoiceParseFallback } from './voice-agent.orchestrator';
import type { VoiceAgentTools } from './voice-agent.tools';
import type { DayPlanProposal, PlanDraft } from './voice-agent.types';
import type { VoiceParseResult } from './voice-parse.types';
import { VoiceSessionStore } from './voice-session.store';

const USER = 'u1';
const SESSION = 's1';
const NOW = '2026-10-18T06:00:00.000Z';

function task(id: string, patch: Partial<Task> = {}): Task {
  return {
    id,
    name: id,
    status: TaskStatus.TODO,
    eventType: TaskEventType.ADMIN,
    isUnscheduled: true,
    isRecurring: false,
    isFixedExternal: false,
    scheduleState: ScheduleState.NONE,
    estimatedTimeInMinutes: 30,
    deadline: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    ...patch,
  } as Task;
}

function create(name: string): VoiceParseResult {
  return {
    understanding: 'complete',
    clarifyingQuestion: null,
    task: { name, estimatedTimeInMinutes: 30 } as VoiceParseResult['task'],
    command: null,
  };
}

function command(kind: string, taskName: string): VoiceParseResult {
  return {
    understanding: 'complete',
    clarifyingQuestion: null,
    task: null,
    command: { kind, taskId: `id-${taskName}`, taskName, summary: `${kind} ${taskName}` } as never,
  };
}

/** Seats every draft item back to back from 10:00Z. */
function fakePropose(_userId: string, draft: PlanDraft): Promise<DayPlanProposal> {
  return Promise.resolve({
    day: draft.day,
    stage: draft.stage,
    revision: draft.revision + 1,
    items: draft.items.map((item, index) => {
      const start = new Date(Date.parse('2026-10-18T10:00:00.000Z') + index * 3_600_000);
      return {
        itemId: item.id,
        taskId: item.taskId,
        source: item.source,
        name: item.name,
        start: start.toISOString(),
        end: new Date(start.getTime() + item.durationMinutes * 60_000).toISOString(),
        durationMinutes: item.durationMinutes,
      };
    }),
    unplaced: [],
    changedItemIds: [],
  });
}

function build(tasks: Task[] = []) {
  const completeJson = jest.fn<Promise<string>, [string, string, { role?: string }?]>();
  const groq = { completeJson } as unknown as GroqClient;
  const settings = {
    getSettings: jest.fn(async () => ({
      timeZone: 'Europe/Kyiv',
      language: 'en',
      speechLanguage: 'en',
      confirmVoiceCommands: false,
      wakeTime: '08:00',
      sleepTime: '23:00',
      defaultTaskDurationMinutes: 30,
    })),
  };
  const tools = { execute: jest.fn(async () => ({ ok: true })) } as unknown as VoiceAgentTools;
  const sessions = new VoiceSessionStore();
  const propose = jest.fn(fakePropose);
  const dayPlanner = { propose } as unknown as VoiceDayPlanner;
  const phases = { find: jest.fn(async () => []) };
  const tasksRepo = { find: jest.fn(async () => tasks) };
  const qb = {
    innerJoin: () => qb,
    where: () => qb,
    getMany: async () => [],
  };
  const scheduled = { createQueryBuilder: () => qb };
  const orchestrator = new VoiceAgentOrchestrator(
    groq,
    settings as never,
    tools,
    sessions,
    dayPlanner,
    phases as never,
    tasksRepo as never,
    scheduled as never,
  );
  const parse = jest.fn<Promise<VoiceParseResult>, Parameters<VoiceParseFallback>>();
  const turn = (input: { transcript?: string; actionId?: string; executionReport?: unknown }) =>
    orchestrator.turn(
      USER,
      {
        sessionId: SESSION,
        timeZone: 'Europe/Kyiv',
        clientNowIso: NOW,
        ...input,
      } as never,
      parse,
    );
  const planner = (decision: Record<string, unknown>) =>
    completeJson.mockResolvedValueOnce(JSON.stringify(decision));
  const session = () => sessions.get(USER, SESSION)!;
  return { turn, planner, parse, propose, completeJson, session, tools };
}

describe('VoiceAgentOrchestrator — multi-intent', () => {
  it('runs every write segment and speaks one combined line', async () => {
    const h = build();
    h.planner({ type: 'steps', answer: '', segments: ['buy milk', 'report is done'] });
    h.parse.mockResolvedValueOnce(create('Milk')).mockResolvedValueOnce(command('complete', 'Report'));

    const res = await h.turn({ transcript: 'buy milk and the report is done' });

    expect(h.completeJson.mock.calls[0][2]).toEqual({ role: 'planner', label: 'planner.r0' });
    expect(h.parse.mock.calls.map((call) => call[0].transcript)).toEqual(['buy milk', 'report is done']);
    expect(res.outcome).toBe('act');
    expect(res.intents.map((intent) => intent.type)).toEqual(['create', 'command']);
    expect(res.segments.map((row) => row.status)).toEqual(['ready', 'ready']);
    expect(res.assistantMessage).toContain('complete Report');
  });

  it('answers a question and writes in the same turn', async () => {
    const h = build();
    h.planner({ type: 'steps', answer: 'You are free at 15:00', segments: ['buy milk'] });
    h.parse.mockResolvedValueOnce(create('Milk'));

    const res = await h.turn({ transcript: 'when am I free and buy milk' });

    expect(res.outcome).toBe('act');
    expect(res.assistantMessage.startsWith('You are free at 15:00.')).toBe(true);
  });

  it('holds a batch with a delete for one combined confirm', async () => {
    const h = build();
    h.planner({ type: 'steps', answer: '', segments: ['buy milk', 'delete draft'] });
    h.parse.mockResolvedValueOnce(create('Milk')).mockResolvedValueOnce(command('delete', 'Draft'));

    const res = await h.turn({ transcript: 'buy milk and delete the draft' });
    expect(res.outcome).toBe('confirm');
    expect(res.actions).toEqual(['confirm', 'cancel']);
    expect(h.session().pendingKind).toBe('writes');

    const applied = await h.turn({ actionId: 'confirm' });
    expect(applied.outcome).toBe('act');
    expect(applied.intents).toHaveLength(2);
    expect(h.session().pendingIntents).toBeNull();
  });

  it('asks about one unclear segment and keeps the resolved ones', async () => {
    const h = build();
    h.planner({ type: 'steps', answer: '', segments: ['buy milk', 'move it'] });
    h.parse.mockResolvedValueOnce(create('Milk')).mockResolvedValueOnce({
      understanding: 'needs_clarification',
      clarifyingQuestion: 'Which task should I move?',
      task: null,
      command: null,
    });

    const asked = await h.turn({ transcript: 'buy milk and move it' });
    expect(asked.outcome).toBe('clarify');
    expect(asked.assistantMessage).toBe('Which task should I move?');
    expect(asked.intents).toEqual([]);
    expect(h.session().pendingBatch?.intents).toHaveLength(1);

    h.planner({ type: 'answer_pending' });
    h.parse.mockResolvedValueOnce(command('shift', 'Report'));
    const done = await h.turn({ transcript: 'the report' });

    expect(h.parse.mock.calls[2][0]).toMatchObject({
      previousTranscript: 'move it',
      clarificationAnswer: 'the report',
    });
    expect(done.outcome).toBe('act');
    expect(done.intents).toHaveLength(2);
    expect(h.session().pendingBatch).toBeNull();
  });

  it('keeps resolved writes when the clarify answer comes back as new steps', async () => {
    const h = build();
    h.planner({ type: 'steps', answer: '', segments: ['buy milk', 'move it'] });
    h.parse.mockResolvedValueOnce(create('Milk')).mockResolvedValueOnce({
      understanding: 'needs_clarification',
      clarifyingQuestion: 'Which task should I move?',
      task: null,
      command: null,
    });
    await h.turn({ transcript: 'buy milk and move it' });

    h.planner({ type: 'steps', answer: '', segments: ['move the report to tomorrow'] });
    h.parse.mockResolvedValueOnce(command('shift', 'Report'));
    const done = await h.turn({ transcript: 'the report, tomorrow' });

    expect(done.outcome).toBe('act');
    expect(done.intents.map((intent) => intent.type)).toEqual(['create', 'command']);
    expect(done.segments?.map((row) => row.status)).toEqual(['ready', 'ready']);
    expect(h.session().pendingBatch).toBeNull();
  });

  it('falls back to one parse when the planner fails', async () => {
    const h = build();
    h.completeJson.mockRejectedValueOnce(new Error('bad json'));
    h.parse.mockResolvedValueOnce(create('Milk'));

    const res = await h.turn({ transcript: 'buy milk' });
    expect(res.outcome).toBe('act');
    expect(res.legacyParse?.task?.name).toBe('Milk');
  });

  it('runs read tools before deciding', async () => {
    const h = build();
    h.planner({ type: 'tools', calls: [{ name: 'get_now_next', args: {} }] });
    h.planner({ type: 'final', outcome: 'answer', assistantMessage: 'Next is Gym.' });

    const res = await h.turn({ transcript: 'what is next' });
    expect(h.tools.execute).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ outcome: 'answer', assistantMessage: 'Next is Gym.' });
  });

  it('ignores noise without calling the LLM', async () => {
    const h = build();
    const res = await h.turn({ transcript: '   ' });
    expect(res.outcome).toBe('answer');
    expect(h.completeJson).not.toHaveBeenCalled();
  });
});

describe('VoiceAgentOrchestrator — day plan', () => {
  const tasks = [task('taxes', { name: 'Taxes' }), task('email', { name: 'Email' })];

  it('interviews, builds, edits by voice and applies', async () => {
    const h = build(tasks);
    h.planner({
      type: 'plan_start',
      day: '2026-10-18',
      interview: true,
      question: 'Anything fixed today?',
      edits: [],
    });
    const asked = await h.turn({ transcript: 'plan my day' });
    expect(asked.outcome).toBe('clarify');
    expect(asked.actions).toEqual(['build_plan', 'cancel']);
    expect(asked.plan?.stage).toBe('interview');
    expect(h.propose).not.toHaveBeenCalled();

    const built = await h.turn({ actionId: 'build_plan' });
    expect(built.outcome).toBe('confirm');
    expect(built.plan?.items.map((item) => item.itemId)).toEqual(['taxes', 'email']);
    expect(built.intents).toEqual([]);
    expect(h.session().pendingKind).toBe('plan');

    h.planner({
      type: 'plan_edits',
      answer: '',
      edits: [
        { op: 'remove_item', itemId: 'email' },
        { op: 'add_task', name: 'Gym', durationMinutes: 60 },
      ],
    });
    const edited = await h.turn({ transcript: 'drop email and add an hour of gym' });
    expect(edited.outcome).toBe('clarify');
    expect(edited.actions).toEqual(['build_plan', 'cancel']);
    expect(edited.plan?.items.map((item) => item.name)).toEqual(['Taxes', 'Gym']);
    expect(h.propose).toHaveBeenCalledTimes(1);

    const builtAfter = await h.turn({ actionId: 'build_plan' });
    expect(builtAfter.outcome).toBe('confirm');
    expect(builtAfter.plan?.items.map((item) => item.name)).toEqual(['Taxes', 'Gym']);
    expect(h.propose).toHaveBeenCalledTimes(2);

    const applied = await h.turn({ actionId: 'confirm' });
    expect(applied.outcome).toBe('act');
    expect(applied.intents.map((intent) => intent.type)).toEqual(['command', 'create']);
    expect(h.session().planDraft).toBeNull();
  });

  it('answers a question while the plan stays on screen', async () => {
    const h = build(tasks);
    h.planner({ type: 'plan_start', day: '2026-10-18', interview: false, question: '', edits: [] });
    await h.turn({ transcript: 'plan my day' });

    h.planner({ type: 'final', outcome: 'answer', assistantMessage: 'Taxes take about 30 minutes.' });
    const res = await h.turn({ transcript: 'how long are taxes' });
    expect(res.outcome).toBe('clarify');
    expect(res.actions).toContain('build_plan');
    expect(res.plan?.items).toHaveLength(2);
    expect(h.session().planDraft?.stage).toBe('interview');
  });

  it('switches to the interview when nothing can be planned', async () => {
    const h = build([]);
    h.planner({ type: 'plan_start', day: '2026-10-18', interview: false, question: '', edits: [] });
    const res = await h.turn({ transcript: 'plan my day' });
    expect(res.outcome).toBe('clarify');
    expect(res.plan?.stage).toBe('interview');
    expect(res.actions).toContain('build_plan');
  });

  it('cancel drops the plan', async () => {
    const h = build(tasks);
    h.planner({ type: 'plan_start', day: '2026-10-18', interview: false, question: '', edits: [] });
    await h.turn({ transcript: 'plan my day' });

    const res = await h.turn({ actionId: 'cancel' });
    expect(res.outcome).toBe('answer');
    expect(res.plan).toBeNull();
    expect(h.session().planDraft).toBeNull();
    expect(h.session().pendingIntents).toBeNull();
  });

  it('a write confirm during review cancels back to the plan', async () => {
    const h = build(tasks);
    h.planner({ type: 'plan_start', day: '2026-10-18', interview: false, question: '', edits: [] });
    await h.turn({ transcript: 'plan my day' });

    h.planner({ type: 'steps', answer: '', segments: ['delete draft'] });
    h.parse.mockResolvedValueOnce(command('delete', 'Draft'));
    const asked = await h.turn({ transcript: 'also delete the draft' });
    expect(asked.outcome).toBe('confirm');
    expect(h.session().pendingKind).toBe('writes');

    const back = await h.turn({ actionId: 'cancel' });
    expect(back.outcome).toBe('clarify');
    expect(back.actions).toContain('build_plan');
    expect(back.plan?.items).toHaveLength(2);
    expect(h.session().planDraft?.stage).toBe('interview');
  });

  it('report logs what ran and re-seats an open plan', async () => {
    const h = build(tasks);
    h.planner({ type: 'plan_start', day: '2026-10-18', interview: false, question: '', edits: [] });
    await h.turn({ transcript: 'plan my day' });
    h.planner({ type: 'steps', answer: '', segments: ['buy milk'] });
    h.parse.mockResolvedValueOnce(create('Milk'));
    const act = await h.turn({ transcript: 'buy milk' });
    expect(act.outcome).toBe('act');
    expect(h.session().pendingIntents).toBeNull();

    const res = await h.turn({
      actionId: 'report',
      executionReport: { results: [{ summary: 'Created Milk', status: 'applied' }] },
    });
    expect(res.outcome).toBe('clarify');
    expect(res.actions).toContain('build_plan');
    expect(res.plan?.items).toHaveLength(2);
    expect(h.session().turns.some((turn) => turn.role === 'system' && turn.text.includes('Created Milk'))).toBe(true);
  });

  it('report without a plan is silent', async () => {
    const h = build();
    const res = await h.turn({
      actionId: 'report',
      executionReport: { results: [{ summary: 'Done', status: 'error' }] },
    });
    expect(res).toMatchObject({ outcome: 'answer', assistantMessage: '' });
    expect(h.completeJson).not.toHaveBeenCalled();
  });
});
