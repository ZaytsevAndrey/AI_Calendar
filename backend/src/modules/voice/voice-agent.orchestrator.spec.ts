import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { runWithVoiceTrace, traceStep, VoiceTrace, annotateLatestStep } from '../../common/voice-trace';
import { TaskEventType } from '../scheduling/event-type.enum';
import { ScheduleState, type Task, TaskStatus } from '../tasks/entities/task.entity';
import { commandDraftFromRaw, resolveVoiceCommand, sniffCommandIntent } from './voice-command.resolve';
import type { VoiceCommandSlot, VoiceCommandTask } from './voice-command.types';
import type { GroqClient } from './groq.client';
import type { VoiceDayPlanner } from './voice-agent.day-plan';
import { VoiceAgentOrchestrator, type VoiceParseFallback } from './voice-agent.orchestrator';
import { VoiceAgentTools } from './voice-agent.tools';
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
    { findAll: jest.fn(async () => []) } as never,
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

function loggedJson(spy: jest.SpyInstance, event: string): Array<Record<string, unknown>> {
  return spy.mock.calls
    .map((call) => String(call[0] ?? ''))
    .filter((line) => line.startsWith(`[${event}] `))
    .map((line) => JSON.parse(line.slice(event.length + 3)) as Record<string, unknown>);
}

function faultLogs(): () => Array<Record<string, unknown>> {
  const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  warn.mockClear();
  return () => loggedJson(warn, 'planner.fault');
}

function decisionLogs(): () => Array<Record<string, unknown>> {
  const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  log.mockClear();
  return () => loggedJson(log, 'planner.decision');
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('VoiceAgentOrchestrator — multi-intent', () => {
  it('previews every write and applies them together', async () => {
    const h = build();
    h.planner({ type: 'steps', answer: '', segments: ['buy milk', 'report is done'] });
    h.parse.mockResolvedValueOnce(create('Milk')).mockResolvedValueOnce(command('complete', 'Report'));

    const res = await h.turn({ transcript: 'buy milk and the report is done' });

    expect(h.completeJson.mock.calls[0][2]).toEqual({ role: 'planner', label: 'planner.r0' });
    expect(h.parse.mock.calls.map((call) => call[0].transcript)).toEqual(['buy milk', 'report is done']);
    expect(res.outcome).toBe('confirm');
    expect(res.actions).toEqual(['confirm', 'cancel']);
    expect(res.intents.map((intent) => intent.type)).toEqual(['create', 'command']);
    expect(res.segments.map((row) => row.status)).toEqual(['ready', 'ready']);
    expect(res.assistantMessage).toContain('complete Report');
    expect(h.session().pendingKind).toBe('writes');

    const applied = await h.turn({ actionId: 'confirm' });
    expect(applied.outcome).toBe('act');
    expect(applied.intents).toHaveLength(2);
    expect(h.session().pendingIntents).toBeNull();
  });

  it('answers a question and writes in the same turn', async () => {
    const h = build();
    h.planner({ type: 'steps', answer: 'You are free at 15:00', segments: ['buy milk'] });
    h.parse.mockResolvedValueOnce(create('Milk'));

    const res = await h.turn({ transcript: 'when am I free and buy milk' });

    expect(res.outcome).toBe('confirm');
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
    expect(done.outcome).toBe('confirm');
    expect(done.outcome).not.toBe('act');
    expect(done.intents).toHaveLength(2);
    expect(h.session().pendingBatch).toBeNull();
    expect(h.session().pendingKind).toBe('writes');

    const applied = await h.turn({ actionId: 'confirm' });
    expect(applied.outcome).toBe('act');
    expect(applied.intents).toHaveLength(2);
  });

  it('does not run a new command while a question is open', async () => {
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
    const done = await h.turn({ transcript: 'the report, tomorrow' });

    expect(done.outcome).toBe('clarify');
    expect(done.assistantMessage).toBe('Which task should I move?');
    expect(done.intents).toEqual([]);
    expect(h.session().pendingBatch?.intents).toHaveLength(1);
    expect(h.session().pendingBatch?.unresolved).toEqual([
      { segment: 'move it', question: 'Which task should I move?' },
    ]);
    expect(h.parse).toHaveBeenCalledTimes(2);
  });

  it('repeats the open question when the next utterance is empty steps', async () => {
    const h = build();
    h.planner({ type: 'steps', answer: '', segments: ['buy milk', 'move it'] });
    h.parse.mockResolvedValueOnce(create('Milk')).mockResolvedValueOnce({
      understanding: 'needs_clarification',
      clarifyingQuestion: 'Which task should I move?',
      task: null,
      command: null,
    });
    await h.turn({ transcript: 'buy milk and move it' });

    h.planner({ type: 'steps', answer: '', segments: [] });
    const done = await h.turn({ transcript: 'never mind which' });

    expect(done.outcome).toBe('clarify');
    expect(done.assistantMessage).toBe('Which task should I move?');
    expect(done.intents).toEqual([]);
    expect(h.session().pendingBatch?.intents).toHaveLength(1);
    expect(h.session().pendingKind).toBeNull();
  });

  it('rejects other decisions while a question is open and keeps the ready intent', async () => {
    const h = build();
    h.planner({ type: 'steps', answer: '', segments: ['buy milk', 'move it'] });
    h.parse.mockResolvedValueOnce(create('Milk')).mockResolvedValueOnce({
      understanding: 'needs_clarification',
      clarifyingQuestion: 'Which task should I move?',
      task: null,
      command: null,
    });
    await h.turn({ transcript: 'buy milk and move it' });
    const ready = h.session().pendingBatch?.intents.map((intent) => intent.summary);
    h.session().planDraft = {
      day: '2026-10-18',
      stage: 'interview',
      interviewAsked: 1,
      items: [{
        id: 'new:1',
        taskId: null,
        source: 'new',
        name: 'Gym',
        durationMinutes: 30,
        preferredHm: null,
        earliestHm: null,
        deadlineHm: null,
      }],
      revision: 1,
      nextNewId: 2,
      lastProposal: null,
    };

    for (const decision of [
      { type: 'final', outcome: 'clarify', assistantMessage: 'Other' },
      { type: 'steps', answer: '', segments: ['buy bread'] },
      { type: 'plan_start', day: '2026-10-19', interview: true, question: 'What first?', edits: [] },
      { type: 'plan_edits', answer: 'Added gym', edits: [{ op: 'add_task', name: 'Gym' }] },
      { type: 'plan_question', question: 'Morning?', edits: [] },
    ]) {
      h.planner(decision);
      const res = await h.turn({ transcript: 'do something else' });
      expect(res.outcome).not.toBe('act');
      expect(res.outcome).toBe('clarify');
      expect(res.intents).toEqual([]);
      expect(res.assistantMessage).toBe('Which task should I move?');
      expect(h.session().pendingBatch?.intents.map((intent) => intent.summary)).toEqual(ready);
      expect(h.session().pendingBatch?.unresolved[0].question).toBe('Which task should I move?');
      expect(h.session().planDraft?.items.map((item) => item.name)).toEqual(['Gym']);
      expect(h.session().planDraft?.day).toBe('2026-10-18');
    }
    expect(h.propose).not.toHaveBeenCalled();
    expect(h.parse).toHaveBeenCalledTimes(2);
  });

  it('does not confirm writes or the day draft while a question is open', async () => {
    const h = build();
    h.planner({ type: 'steps', answer: '', segments: ['buy milk', 'move it'] });
    h.parse.mockResolvedValueOnce(create('Milk')).mockResolvedValueOnce({
      understanding: 'needs_clarification',
      clarifyingQuestion: 'Which task should I move?',
      task: null,
      command: null,
    });
    await h.turn({ transcript: 'buy milk and move it' });
    h.completeJson.mockClear();
    h.session().planDraft = {
      day: '2026-10-18',
      stage: 'interview',
      interviewAsked: 1,
      items: [],
      revision: 1,
      nextNewId: 1,
      lastProposal: null,
    };

    const res = await h.turn({ actionId: 'confirm' });
    expect(res.outcome).toBe('clarify');
    expect(res.intents).toEqual([]);
    expect(res.assistantMessage).toBe('Which task should I move?');
    expect(h.session().pendingBatch?.intents).toHaveLength(1);
    expect(h.session().planDraft?.stage).toBe('interview');
    expect(h.propose).not.toHaveBeenCalled();
    expect(h.completeJson).not.toHaveBeenCalled();
  });

  it('cancels the open batch and leaves the day draft', async () => {
    const h = build();
    h.planner({ type: 'steps', answer: '', segments: ['buy milk', 'move it'] });
    h.parse.mockResolvedValueOnce(create('Milk')).mockResolvedValueOnce({
      understanding: 'needs_clarification',
      clarifyingQuestion: 'Which task should I move?',
      task: null,
      command: null,
    });
    await h.turn({ transcript: 'buy milk and move it' });
    h.completeJson.mockClear();
    const summary = h.session().pendingBatch?.intents[0].summary ?? '';
    h.session().planDraft = {
      day: '2026-10-18',
      stage: 'interview',
      interviewAsked: 1,
      items: [],
      revision: 1,
      nextNewId: 1,
      lastProposal: null,
    };

    const res = await h.turn({ actionId: 'cancel' });
    expect(res.outcome).toBe('answer');
    expect(res.intents).toEqual([]);
    expect(res.assistantMessage).toContain('Cancelled');
    expect(res.assistantMessage).toContain('Will not create');
    expect(res.assistantMessage).toContain('Milk');
    expect(res.assistantMessage).not.toContain(summary);
    expect(summary).toContain('Created task');
    expect(h.session().pendingBatch).toBeNull();
    expect(h.session().planDraft?.day).toBe('2026-10-18');
    expect(h.completeJson).not.toHaveBeenCalled();
  });

  it('keeps a specialist question when the answer asks again or asks something else', async () => {
    const h = build();
    h.planner({ type: 'steps', answer: '', segments: ['buy milk', 'move it'] });
    h.parse.mockResolvedValueOnce(create('Milk')).mockResolvedValueOnce({
      understanding: 'needs_clarification',
      clarifyingQuestion: 'Which task should I move?',
      task: null,
      command: null,
    });
    await h.turn({ transcript: 'buy milk and move it' });

    h.planner({ type: 'answer_pending' });
    h.parse.mockResolvedValueOnce({
      understanding: 'needs_clarification',
      clarifyingQuestion: 'Which task should I move?',
      task: null,
      command: null,
    });
    const repeated = await h.turn({ transcript: 'not sure yet' });
    expect(repeated.outcome).toBe('clarify');
    expect(repeated.intents).toEqual([]);
    expect(h.session().pendingBatch?.unresolved[0].question).toBe('Which task should I move?');
    expect(h.session().pendingBatch?.intents).toHaveLength(1);

    h.planner({ type: 'answer_pending' });
    h.parse.mockResolvedValueOnce({
      understanding: 'needs_clarification',
      clarifyingQuestion: 'Which day?',
      task: null,
      command: null,
    });
    const next = await h.turn({ transcript: 'the report one' });
    expect(next.outcome).toBe('clarify');
    expect(next.assistantMessage).toBe('Which day?');
    expect(next.intents).toEqual([]);
    expect(h.session().pendingBatch?.unresolved[0]).toEqual({
      segment: 'move it',
      question: 'Which day?',
    });
    expect(h.session().pendingBatch?.intents).toHaveLength(1);
    expect(h.session().pendingKind).toBeNull();
  });

  it('repeats the open question for client actions, noise, and a planner failure', async () => {
    const h = build();
    h.planner({ type: 'steps', answer: '', segments: ['buy milk', 'move it'] });
    h.parse.mockResolvedValueOnce(create('Milk')).mockResolvedValueOnce({
      understanding: 'needs_clarification',
      clarifyingQuestion: 'Which task should I move?',
      task: null,
      command: null,
    });
    await h.turn({ transcript: 'buy milk and move it' });
    h.session().planDraft = {
      day: '2026-10-18',
      stage: 'interview',
      interviewAsked: 1,
      items: [],
      revision: 1,
      nextNewId: 1,
      lastProposal: null,
    };

    const buildPlan = await h.turn({ actionId: 'build_plan' });
    expect(buildPlan.outcome).toBe('clarify');
    expect(buildPlan.assistantMessage).toBe('Which task should I move?');
    expect(h.propose).not.toHaveBeenCalled();

    const reported = await h.turn({
      actionId: 'report',
      executionReport: { results: [{ summary: 'Done', status: 'ok' }] },
    });
    expect(reported.outcome).toBe('clarify');
    expect(reported.assistantMessage).toBe('Which task should I move?');
    expect(h.session().planDraft?.stage).toBe('interview');

    const noise = await h.turn({ transcript: 'Thank you' });
    expect(noise.outcome).toBe('clarify');
    expect(noise.assistantMessage).toBe('Which task should I move?');

    h.completeJson.mockRejectedValueOnce(new Error('bad json'));
    const failed = await h.turn({ transcript: 'buy bread instead' });
    expect(failed.outcome).toBe('clarify');
    expect(failed.intents).toEqual([]);
    expect(failed.assistantMessage).toBe('Which task should I move?');
    expect(h.session().pendingBatch?.intents).toHaveLength(1);
    expect(h.session().pendingBatch?.unresolved[0].question).toBe('Which task should I move?');
    expect(h.session().planDraft?.stage).toBe('interview');
  });

  it('refuses when the planner call fails', async () => {
    const h = build();
    const faults = faultLogs();
    h.completeJson.mockRejectedValueOnce(new Error('bad json'));
    h.parse.mockResolvedValueOnce(create('Milk'));

    const res = await h.turn({ transcript: 'what is on tomorrow' });
    expect(res).toMatchObject({
      outcome: 'refuse',
      assistantMessage: 'I could not help with that.',
      actions: ['retry'],
    });
    expect(res.intents).toHaveLength(0);
    expect(h.parse).not.toHaveBeenCalled();
    expect(faults()).toEqual([
      expect.objectContaining({ code: 'planner_execution_error', message: 'bad json' }),
    ]);
  });

  it('refuses an unknown planner type without speaking its message', async () => {
    const h = build();
    const faults = faultLogs();
    h.planner({ type: 'step', assistantMessage: 'Tomorrow you have the dentist.' });

    const res = await h.turn({ transcript: 'what is on tomorrow' });
    expect(res.assistantMessage).toBe('I could not help with that.');
    expect(res.outcome).toBe('refuse');
    expect(h.parse).not.toHaveBeenCalled();
    expect(faults()).toEqual([
      expect.objectContaining({ code: 'invalid_decision', typeName: 'step' }),
    ]);
  });

  it('refuses a tool decision that has no calls', async () => {
    const h = build();
    const faults = faultLogs();
    h.planner({ type: 'tools', calls: [] });

    const res = await h.turn({ transcript: 'what is on tomorrow' });
    expect(res.outcome).toBe('refuse');
    expect(h.parse).not.toHaveBeenCalled();
    expect(h.tools.execute).not.toHaveBeenCalled();
    expect(faults()).toEqual([
      expect.objectContaining({ code: 'tool_limit_exceeded', reason: 'empty_calls', round: 0 }),
    ]);
  });

  it('refuses when tools are still requested on the last round', async () => {
    const h = build();
    const faults = faultLogs();
    h.planner({ type: 'tools', calls: [{ name: 'get_day_agenda', args: { day: 'tomorrow' } }] });
    h.planner({ type: 'tools', calls: [{ name: 'get_day_agenda', args: { day: 'tomorrow' } }] });
    h.planner({ type: 'tools', calls: [{ name: 'list_unscheduled', args: {} }] });

    const res = await h.turn({ transcript: 'what is on tomorrow' });
    expect(res.outcome).toBe('refuse');
    expect(h.parse).not.toHaveBeenCalled();
    expect(h.tools.execute).toHaveBeenCalledTimes(2);
    expect(faults()).toEqual([
      expect.objectContaining({ code: 'tool_limit_exceeded', reason: 'max_rounds', round: 2 }),
    ]);
  });

  it('rethrows a voice rate limit', async () => {
    const h = build();
    h.completeJson.mockRejectedValueOnce(
      new ServiceUnavailableException({ code: 'VOICE_RATE_LIMIT', message: 'busy' }),
    );
    await expect(h.turn({ transcript: 'buy milk' })).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(h.parse).not.toHaveBeenCalled();
  });

  it('runs read tools before deciding', async () => {
    const h = build();
    const decisions = decisionLogs();
    h.planner({ type: 'tools', calls: [{ name: 'get_now_next', args: {} }] });
    h.planner({ type: 'final', outcome: 'answer', assistantMessage: 'Next is Gym.' });

    const res = await h.turn({ transcript: 'what is next' });
    expect(h.tools.execute).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ outcome: 'answer', assistantMessage: 'Next is Gym.' });
    expect(decisions()).toEqual([
      expect.objectContaining({ type: 'tools', round: 0, calls: 1, tools: 'get_now_next' }),
      expect.objectContaining({ type: 'final', round: 1, outcome: 'answer' }),
    ]);
  });

  it('ignores noise without calling the LLM', async () => {
    const h = build();
    const res = await h.turn({ transcript: '   ' });
    expect(res.outcome).toBe('answer');
    expect(h.completeJson).not.toHaveBeenCalled();
  });

  it('asks to split when the planner returns more segments than one turn can apply', async () => {
    const h = build();
    const faults = faultLogs();
    const segments = Array.from({ length: 7 }, (_, i) => `errand ${i}`);
    h.planner({ type: 'steps', answer: '', segments });
    h.parse.mockResolvedValueOnce(create('Milk'));

    const res = await h.turn({ transcript: 'seven errands' });
    expect(res.outcome).toBe('clarify');
    expect(res.assistantMessage).toBe(
      'That has more parts than I can apply at once. Please say them in smaller groups.',
    );
    expect(res.intents).toEqual([]);
    expect(res.legacyParse).toBeNull();
    expect(h.parse).not.toHaveBeenCalled();
    expect(faults()).toEqual([
      expect.objectContaining({ code: 'segment_limit_exceeded', count: 7, limit: 6 }),
    ]);
  });

  it('answers a question with no writes without a task parse', async () => {
    const h = build();
    h.planner({ type: 'steps', answer: 'You are free at 15:00', segments: [] });

    const res = await h.turn({ transcript: 'when am I free' });
    expect(res.outcome).toBe('answer');
    expect(res.assistantMessage).toContain('You are free at 15:00');
    expect(h.parse).not.toHaveBeenCalled();
  });

  it('refuses empty steps instead of parsing the utterance as a task', async () => {
    const h = build();
    const faults = faultLogs();
    h.planner({ type: 'steps', answer: '', segments: [] });
    h.parse.mockResolvedValueOnce(create('Milk'));

    const res = await h.turn({ transcript: 'what is on tomorrow' });
    expect(res).toMatchObject({
      outcome: 'refuse',
      assistantMessage: 'I could not help with that.',
      intents: [],
      legacyParse: null,
    });
    expect(h.parse).not.toHaveBeenCalled();
    expect(faults()).toEqual([
      expect.objectContaining({ code: 'invalid_decision', typeName: 'steps', reason: 'empty' }),
    ]);
  });

  it('repeats the only open question when empty steps arrive', async () => {
    const h = build();
    h.planner({ type: 'steps', answer: '', segments: ['move it'] });
    h.parse.mockResolvedValueOnce({
      understanding: 'needs_clarification',
      clarifyingQuestion: 'Which task should I move?',
      task: null,
      command: null,
    });
    await h.turn({ transcript: 'move it' });

    h.planner({ type: 'steps', answer: '', segments: [] });
    const done = await h.turn({ transcript: 'never mind' });
    expect(done.outcome).toBe('clarify');
    expect(done.assistantMessage).toBe('Which task should I move?');
    expect(done.intents).toEqual([]);
    expect(h.session().pendingBatch?.unresolved).toHaveLength(1);
    expect(h.parse).toHaveBeenCalledTimes(1);
  });

  it('refuses a plan edit when no day plan is open', async () => {
    const h = build();
    const faults = faultLogs();
    h.planner({ type: 'plan_edits', answer: 'Added gym', edits: [{ op: 'add_task', name: 'Gym' }] });
    h.parse.mockResolvedValueOnce(create('Gym'));

    const res = await h.turn({ transcript: 'add gym to the plan' });
    expect(res.outcome).toBe('refuse');
    expect(res.intents).toEqual([]);
    expect(h.parse).not.toHaveBeenCalled();
    expect(faults()).toEqual([
      expect.objectContaining({
        code: 'invalid_decision',
        typeName: 'plan_edits',
        reason: 'no_open_plan',
      }),
    ]);
  });

  it('refuses answer_pending when no question is open', async () => {
    const h = build();
    const faults = faultLogs();
    h.planner({ type: 'answer_pending' });
    h.parse.mockResolvedValueOnce(create('Milk'));

    const res = await h.turn({ transcript: 'what is on tomorrow' });
    expect(res.outcome).toBe('refuse');
    expect(h.parse).not.toHaveBeenCalled();
    expect(faults()).toEqual([
      expect.objectContaining({
        code: 'invalid_decision',
        typeName: 'answer_pending',
        reason: 'no_pending_batch',
      }),
    ]);
  });

  it('refuses an unknown tool name before running any call', async () => {
    const h = build();
    const faults = faultLogs();
    h.planner({
      type: 'tools',
      calls: [
        { name: 'get_day_agenda', args: { day: '2026-10-19' } },
        { name: 'drop_database', args: {} },
      ],
    });

    const res = await h.turn({ transcript: 'what is on tomorrow' });
    expect(res.outcome).toBe('refuse');
    expect(h.parse).not.toHaveBeenCalled();
    expect(h.tools.execute).not.toHaveBeenCalled();
    expect(faults()).toEqual([
      expect.objectContaining({ code: 'invalid_decision', typeName: 'tools', reason: 'unknown_tool' }),
    ]);
  });

  it('refuses a tool round that asks for more calls than it can run', async () => {
    const h = build();
    const faults = faultLogs();
    h.planner({
      type: 'tools',
      calls: Array.from({ length: 7 }, () => ({ name: 'list_unscheduled', args: {} })),
    });

    const res = await h.turn({ transcript: 'what is open' });
    expect(res.outcome).toBe('refuse');
    expect(h.tools.execute).not.toHaveBeenCalled();
    expect(h.parse).not.toHaveBeenCalled();
    expect(faults()).toEqual([
      expect.objectContaining({ code: 'tool_limit_exceeded', reason: 'too_many_calls', round: 0 }),
    ]);
  });

  it('refuses a final outcome the contract does not allow', async () => {
    const h = build();
    const faults = faultLogs();
    h.planner({ type: 'final', outcome: 'done', assistantMessage: 'Tomorrow you have the dentist.' });

    const res = await h.turn({ transcript: 'what is on tomorrow' });
    expect(res.assistantMessage).toBe('I could not help with that.');
    expect(res.outcome).toBe('refuse');
    expect(h.parse).not.toHaveBeenCalled();
    expect(faults()).toEqual([
      expect.objectContaining({ code: 'invalid_decision', typeName: 'final', reason: 'outcome' }),
    ]);
  });

  it('records invalid JSON separately from an unknown decision', async () => {
    const h = build();
    const faults = faultLogs();
    h.completeJson.mockResolvedValueOnce('no json here');

    const res = await h.turn({ transcript: 'what is on tomorrow' });
    expect(res.outcome).toBe('refuse');
    expect(h.parse).not.toHaveBeenCalled();
    expect(faults()).toEqual([expect.objectContaining({ code: 'invalid_json' })]);
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

  it('keeps an open day plan when the reply has too many segments', async () => {
    const h = build(tasks);
    h.planner({
      type: 'plan_start',
      day: '2026-10-18',
      interview: true,
      question: 'Anything fixed?',
      edits: [],
    });
    await h.turn({ transcript: 'plan my day' });

    h.planner({
      type: 'steps',
      answer: '',
      segments: Array.from({ length: 7 }, (_, i) => `errand ${i}`),
    });
    const res = await h.turn({ transcript: 'and also these errands' });
    expect(res.outcome).toBe('clarify');
    expect(res.plan?.stage).toBe('interview');
    expect(res.actions).toEqual(['build_plan', 'cancel']);
    expect(res.intents).toEqual([]);
    expect(h.parse).not.toHaveBeenCalled();
    expect(h.session().planDraft?.stage).toBe('interview');
  });

  it('keeps an open day plan on screen when the planner reply is invalid', async () => {
    const h = build(tasks);
    h.planner({
      type: 'plan_start',
      day: '2026-10-18',
      interview: true,
      question: 'Anything fixed?',
      edits: [],
    });
    await h.turn({ transcript: 'plan my day' });

    h.planner({ type: 'step', assistantMessage: 'The day is free.' });
    const res = await h.turn({ transcript: 'what about lunch' });
    expect(res.outcome).toBe('refuse');
    expect(res.assistantMessage).toBe('I could not help with that.');
    expect(res.plan?.stage).toBe('interview');
    expect(res.actions).toEqual(['build_plan', 'cancel']);
    expect(h.session().planDraft?.stage).toBe('interview');
    expect(h.parse).not.toHaveBeenCalled();
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
    const preview = await h.turn({ transcript: 'buy milk' });
    expect(preview.outcome).toBe('confirm');
    const act = await h.turn({ actionId: 'confirm' });
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

  const leftOut = (count: number) =>
    `I left out ${count} change(s) because the time or length was not usable.`;

  it('applies valid edits, keeps the old clock, and says the rejected ones were left out', async () => {
    const h = build(tasks);
    h.planner({
      type: 'plan_start',
      day: '2026-10-18',
      interview: true,
      question: 'Anything fixed?',
      edits: [{ op: 'set_preferred_start', itemId: 'taxes', hm: '09:00' }],
    });
    const asked = await h.turn({ transcript: 'plan my day' });
    expect(asked.assistantMessage).toBe('Anything fixed?');

    h.planner({
      type: 'plan_edits',
      answer: '',
      edits: [
        { op: 'remove_item', itemId: 'email' },
        { op: 'set_preferred_start', itemId: 'taxes', hm: '25:00' },
        { op: 'add_task', name: 'Gym', preferredHm: '18:00' },
        { op: 'add_task', name: 'Bad', preferredHm: '25:00' },
        { op: 'set_duration', itemId: 'taxes', minutes: 2 },
      ],
    });
    const edited = await h.turn({ transcript: 'drop email and fix the times' });
    expect(edited.outcome).toBe('clarify');
    expect(edited.assistantMessage).toBe(leftOut(3));
    expect(edited.plan?.items.map((item) => item.name)).toEqual(['Taxes', 'Gym']);
    expect(
      h.session().turns.some((turn) => turn.role === 'assistant' && turn.text === leftOut(3)),
    ).toBe(true);
    expect(h.session().planDraft?.items.find((item) => item.id === 'taxes')).toMatchObject({
      preferredHm: '09:00',
      durationMinutes: 30,
    });
    expect(h.session().planDraft?.items.find((item) => item.name === 'Gym')).toMatchObject({
      preferredHm: '18:00',
      durationMinutes: 30,
    });
  });

  it('appends the skipped-edit sentence to the plan question', async () => {
    const h = build(tasks);
    h.planner({ type: 'plan_start', day: '2026-10-18', interview: false, question: '', edits: [] });
    await h.turn({ transcript: 'plan my day' });
    h.planner({
      type: 'plan_question',
      question: 'Keep taxes?',
      edits: [
        { op: 'remove_item', itemId: 'email' },
        { op: 'set_preferred_start', itemId: 'taxes', hm: '25:00' },
      ],
    });
    const res = await h.turn({ transcript: 'what about taxes' });
    expect(res.assistantMessage).toBe(`Keep taxes? ${leftOut(1)}`);
    expect(res.plan?.items.map((item) => item.name)).toEqual(['Taxes']);
    expect(h.session().planDraft?.items.find((item) => item.id === 'taxes')?.preferredHm).toBeNull();
    expect(
      h.session().turns.some((turn) => turn.role === 'assistant' && turn.text === res.assistantMessage),
    ).toBe(true);
  });

  it('says a skipped edit was left out when no plan is open', async () => {
    const h = build();
    h.planner({
      type: 'plan_question',
      question: 'Which day?',
      edits: [{ op: 'add_task', name: 'Gym', preferredHm: '25:00' }],
    });
    const res = await h.turn({ transcript: 'add gym at 25' });
    expect(res.outcome).toBe('clarify');
    expect(res.assistantMessage).toBe(`Which day? ${leftOut(1)}`);
    expect(res.plan).toBeNull();
    expect(h.session().planDraft).toBeNull();
  });

  it('opens today for a blank plan day and skips a new task with a bad clock', async () => {
    const h = build(tasks);
    h.planner({
      type: 'plan_start',
      day: '',
      interview: true,
      question: 'Anything fixed?',
      edits: [
        { op: 'add_task', name: 'Call', preferredHm: '10:00' },
        { op: 'add_task', name: 'Gym', preferredHm: '25:00', durationMinutes: 60 },
      ],
    });
    const res = await h.turn({ transcript: 'plan my day' });
    expect(res.plan?.day).toBe('2026-10-18');
    expect(res.assistantMessage).toBe(`Anything fixed? ${leftOut(1)}`);
    expect(res.plan?.items.map((item) => item.name)).toEqual(['Taxes', 'Email', 'Call']);
    expect(h.session().planDraft?.items.some((item) => item.name === 'Gym')).toBe(false);
  });

  it('does not open today when the plan day is not a real date', async () => {
    const h = build(tasks);
    const faults = faultLogs();
    h.planner({
      type: 'plan_start',
      day: '2026-02-31',
      interview: false,
      question: 'Anything fixed?',
      edits: [{ op: 'add_task', name: 'Gym', preferredHm: '18:00' }],
    });
    const res = await h.turn({ transcript: 'plan february 31' });
    expect(res.outcome).toBe('clarify');
    expect(res.assistantMessage).toBe('That is not a real calendar day, so I did not open a plan.');
    expect(res.plan).toBeNull();
    expect(h.session().planDraft).toBeNull();
    expect(h.propose).not.toHaveBeenCalled();
    expect(faults()).toEqual([
      expect.objectContaining({
        code: 'invalid_decision',
        typeName: 'plan_start',
        reason: 'invalid_day',
      }),
    ]);
  });

  it('keeps the open plan when a later plan day is not a real date', async () => {
    const h = build(tasks);
    h.planner({
      type: 'plan_start',
      day: '2026-10-18',
      interview: true,
      question: 'Anything fixed?',
      edits: [{ op: 'set_preferred_start', itemId: 'taxes', hm: '09:00' }],
    });
    await h.turn({ transcript: 'plan my day' });
    h.planner({
      type: 'plan_start',
      day: 'tomorrow',
      interview: false,
      question: '',
      edits: [{ op: 'remove_item', itemId: 'taxes' }],
    });
    const res = await h.turn({ transcript: 'plan tomorrow' });
    expect(res.assistantMessage).toBe('That is not a real calendar day, so I did not open a plan.');
    expect(res.plan?.day).toBe('2026-10-18');
    expect(res.actions).toEqual(['build_plan', 'cancel']);
    expect(h.session().planDraft?.day).toBe('2026-10-18');
    expect(h.session().planDraft?.items.map((item) => item.id)).toEqual(['taxes', 'email']);
    expect(h.session().planDraft?.items.find((item) => item.id === 'taxes')?.preferredHm).toBe('09:00');
  });

  it('counts each kind of rejected edit and still applies the valid ones', async () => {
    const h = build(tasks);
    h.planner({ type: 'plan_start', day: '2026-10-18', interview: false, question: '', edits: [] });
    await h.turn({ transcript: 'plan my day' });
    h.planner({
      type: 'plan_edits',
      answer: 'Updated',
      edits: [
        { op: 'set_preferred_start', itemId: 'taxes', hm: '09:00' },
        ...Array.from({ length: 14 }, (_, index) => ({
          op: 'add_task',
          name: `n${index}`,
          durationMinutes: 30,
        })),
        { op: 'add_task', name: 'Overflow', durationMinutes: 30 },
        { op: 'remove_item', itemId: 'email' },
        { op: 'bogus' },
        { op: 'add_task' },
        { op: 'set_preferred_start', itemId: 'taxes', hm: '25:00' },
        { op: 'set_preferred_start', itemId: 'taxes', hm: null },
      ],
    });
    const res = await h.turn({ transcript: 'update the plan' });
    expect(res.assistantMessage).toBe(
      `Updated. ${leftOut(1)} I left out 2 change(s) I could not apply. The plan already has 16 tasks, so I left out 1.`,
    );
    expect(res.plan?.items.map((item) => item.name)).toEqual([
      'Taxes',
      ...Array.from({ length: 14 }, (_, index) => `n${index}`),
    ]);
    expect(h.session().planDraft?.items.find((item) => item.id === 'taxes')?.preferredHm).toBeNull();
    expect(
      h.session().turns.some((turn) => turn.role === 'assistant' && turn.text === res.assistantMessage),
    ).toBe(true);
  });

  it('passes invalid_day to the planner without turning it into a schedule', async () => {
    const h = build();
    const real = new VoiceAgentTools({
      listVisibleEvents: jest.fn(async () => {
        throw new Error('calendar should not be read');
      }),
    } as never);
    (h.tools.execute as jest.Mock).mockImplementation((call, toolCtx) => real.execute(call, toolCtx));
    let prompt = '';
    h.completeJson
      .mockResolvedValueOnce(
        JSON.stringify({
          type: 'tools',
          calls: [
            { name: 'get_day_agenda', args: { day: '2026-02-31' } },
            { name: 'find_free_gaps', args: { day: 'tomorrow' } },
            { name: 'list_unscheduled', args: {} },
          ],
        }),
      )
      .mockImplementationOnce(async (_system: string, user: string) => {
        prompt = user;
        return JSON.stringify({
          type: 'final',
          outcome: 'answer',
          assistantMessage: 'Which day do you mean?',
        });
      });

    const trace = new VoiceTrace('invalid-day');
    const res = await runWithVoiceTrace(trace, () =>
      h.turn({ transcript: 'what is on february 31 and what is unscheduled' }),
    );
    const marker = 'Tool results:\n';
    const results = prompt.slice(prompt.indexOf(marker) + marker.length);
    const json = results.slice(0, results.indexOf('\n\nReturn the next JSON decision.'));
    expect(JSON.parse(json)).toEqual([
      { name: 'get_day_agenda', result: { error: 'invalid_day' } },
      { name: 'find_free_gaps', result: { error: 'invalid_day' } },
      { name: 'list_unscheduled', result: { count: 0, items: [] } },
    ]);
    expect(h.completeJson).toHaveBeenCalledTimes(2);
    expect(res.outcome).toBe('answer');
    expect(res.assistantMessage).toBe('Which day do you mean?');
    expect(trace.steps.find((step) => step.name === 'tool.get_day_agenda')).toMatchObject({
      ok: true,
      valid: false,
      errorCode: 'invalid_day',
      component: 'tool',
    });
    expect(trace.steps.find((step) => step.name === 'tool.find_free_gaps')).toMatchObject({
      ok: true,
      valid: false,
      errorCode: 'invalid_day',
    });
    const listed = trace.steps.find((step) => step.name === 'tool.list_unscheduled');
    expect(listed).toMatchObject({ ok: true, component: 'tool' });
    expect(listed?.valid).toBeUndefined();
    expect(listed?.errorCode).toBeUndefined();
    expect(JSON.stringify(trace.steps)).not.toContain('items');
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

describe('VoiceAgentOrchestrator — trace', () => {
  it('marks a returned planner reply invalid without treating the call as a transport failure', async () => {
    const h = build();
    const trace = new VoiceTrace('bad-decision');
    h.completeJson.mockImplementationOnce(() =>
      traceStep(
        'llm',
        'planner.r0',
        'groq:test',
        async () => '{"type":"nope"}',
        undefined,
        { component: 'planner' },
      ),
    );

    const res = await runWithVoiceTrace(trace, () => h.turn({ transcript: 'what is on tomorrow' }));

    expect(res.outcome).toBe('refuse');
    expect(res.assistantMessage).toBe('I could not help with that.');
    expect(trace.steps.find((step) => step.name === 'planner.r0')).toMatchObject({
      ok: true,
      valid: false,
      errorCode: 'invalid_decision',
      decision: 'nope',
      component: 'planner',
    });
    expect(trace.steps.every((step) => !Object.prototype.hasOwnProperty.call(step, 'traceId'))).toBe(
      true,
    );
  });

  it('keeps segment indexes when a middle segment is dropped', async () => {
    const h = build();
    h.planner({
      type: 'steps',
      answer: '',
      segments: ['buy milk', 'the mystery one', 'report is done'],
    });
    h.parse
      .mockResolvedValueOnce(create('Milk'))
      .mockRejectedValueOnce(new Error('drop'))
      .mockResolvedValueOnce(command('complete', 'Report'));

    await h.turn({ transcript: 'buy milk, something unclear, and the report is done' });

    expect(h.parse.mock.calls.map((call) => call[0].segment)).toEqual([0, 1, 2]);
    expect(h.parse.mock.calls.map((call) => call[0].transcript)).toEqual([
      'buy milk',
      'the mystery one',
      'report is done',
    ]);
  });

  it('logs skip counts and not the task text', async () => {
    const h = build();
    const decisions = decisionLogs();
    const trace = new VoiceTrace('skips');
    h.completeJson.mockImplementationOnce(() =>
      traceStep(
        'llm',
        'planner.r0',
        'groq:test',
        async () =>
          JSON.stringify({
            type: 'plan_start',
            day: '2026-10-18',
            interview: false,
            question: '',
            edits: [
              { op: 'bogus' },
              ...Array.from({ length: 16 }, (_, index) => ({
                op: 'add_task',
                name: `Secret ${index}`,
                durationMinutes: 30,
              })),
              { op: 'add_task', name: 'Overflow secret', durationMinutes: 30 },
            ],
          }),
        undefined,
        { component: 'planner' },
      ),
    );

    await runWithVoiceTrace(trace, () => h.turn({ transcript: 'plan my day' }));

    const logged = JSON.stringify(decisions());
    expect(logged).toContain('invalid_edit.unknown_op:1');
    expect(logged).toContain('plan_full:1');
    expect(logged).not.toContain('Secret');
    expect(logged).not.toContain('Overflow');
    expect(trace.steps.find((step) => step.name === 'planner.r0')?.reason).toContain(
      'invalid_edit.unknown_op:1',
    );
    expect(trace.steps.find((step) => step.name === 'planner.r0')?.reason).toContain(
      'apply:plan_full:1',
    );
    expect(JSON.stringify(trace.steps)).not.toContain('Secret');
  });

  it('gives each direct turn its own trace id', async () => {
    const h = build();
    const decisions = decisionLogs();
    h.planner({ type: 'final', outcome: 'answer', assistantMessage: 'One' });
    await h.turn({ transcript: 'one' });
    h.planner({ type: 'final', outcome: 'answer', assistantMessage: 'Two' });
    await h.turn({ transcript: 'two' });
    const rows = decisions();
    expect(typeof rows[0].traceId).toBe('string');
    expect(typeof rows[1].traceId).toBe('string');
    expect(rows[0].traceId).not.toBe(rows[1].traceId);
  });

  it('does not mix overlapping direct turns', async () => {
    const left = build();
    const right = build();
    const leftTrace = new VoiceTrace('left-turn');
    const rightTrace = new VoiceTrace('right-turn');
    left.completeJson.mockImplementation(() =>
      traceStep(
        'llm',
        'planner.r0',
        'groq:left',
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return JSON.stringify({ type: 'final', outcome: 'answer', assistantMessage: 'A' });
        },
        undefined,
        { component: 'planner' },
      ),
    );
    right.completeJson.mockImplementation(() =>
      traceStep(
        'llm',
        'planner.r0',
        'groq:right',
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return JSON.stringify({ type: 'final', outcome: 'answer', assistantMessage: 'B' });
        },
        undefined,
        { component: 'planner' },
      ),
    );

    await Promise.all([
      runWithVoiceTrace(leftTrace, () => left.turn({ transcript: 'left' })),
      runWithVoiceTrace(rightTrace, () => right.turn({ transcript: 'right' })),
    ]);

    expect(leftTrace.steps.filter((step) => step.name === 'planner.r0')).toEqual([
      expect.objectContaining({ via: 'groq:left', decision: 'final', valid: true }),
    ]);
    expect(rightTrace.steps.filter((step) => step.name === 'planner.r0')).toEqual([
      expect.objectContaining({ via: 'groq:right', decision: 'final', valid: true }),
    ]);
    expect(leftTrace.steps.filter((step) => step.name === 'db.turn-context')).toHaveLength(1);
    expect(rightTrace.steps.filter((step) => step.name === 'db.turn-context')).toHaveLength(1);
  });

  it('records accepted for every segment of a successful turn', async () => {
    const h = build();
    const trace = new VoiceTrace('accepted-turn');
    h.completeJson.mockImplementation(async () => {
      await traceStep('llm', 'planner.r0', 'groq:test', async () => '{}', undefined, {
        component: 'planner',
      });
      return JSON.stringify({
        type: 'steps',
        answer: '',
        segments: ['buy milk', 'call home', 'report is done'],
      });
    });
    h.parse.mockImplementation(async (ctx) => {
      await traceStep('llm', 'router', 'groq:test', async () => '{}', undefined, {
        component: 'router',
        segment: ctx.segment,
      });
      await traceStep('llm', 'specialist.create', 'groq:test', async () => '{}', undefined, {
        component: 'specialist',
        segment: ctx.segment,
      });
      return ctx.segment === 2 ? command('complete', 'Report') : create('Task');
    });

    const res = await runWithVoiceTrace(trace, () => h.turn({ transcript: 'three parts' }));

    expect(res.outcome).toBe('confirm');
    expect(h.parse).toHaveBeenCalledTimes(3);
    expect(h.completeJson).toHaveBeenCalledTimes(1);
    expect(trace.steps.filter((step) => step.name === 'segment')).toEqual([
      expect.objectContaining({
        component: 'orchestrator',
        segment: 0,
        outcome: 'accepted',
        ok: true,
      }),
      expect.objectContaining({
        component: 'orchestrator',
        segment: 1,
        outcome: 'accepted',
        ok: true,
      }),
      expect.objectContaining({
        component: 'orchestrator',
        segment: 2,
        outcome: 'accepted',
        ok: true,
      }),
    ]);
    expect(trace.steps.some((step) => step.valid === false)).toBe(false);
    expect(JSON.stringify(trace.steps)).not.toContain('buy milk');
  });

  it('records clarify without treating it as an invalid model reply', async () => {
    const h = build();
    const trace = new VoiceTrace('clarify-turn');
    h.completeJson.mockImplementation(async () => {
      await traceStep('llm', 'planner.r0', 'groq:test', async () => '{}', undefined, {
        component: 'planner',
      });
      return JSON.stringify({
        type: 'steps',
        answer: '',
        segments: ['buy milk', 'move it', 'report is done'],
      });
    });
    h.parse.mockImplementation(async (ctx) => {
      await traceStep('llm', 'router', 'groq:test', async () => '{}', undefined, {
        component: 'router',
        segment: ctx.segment,
      });
      await traceStep('llm', 'specialist.command', 'groq:test', async () => '{}', undefined, {
        component: 'specialist',
        segment: ctx.segment,
      });
      if (ctx.segment === 1) {
        return {
          understanding: 'needs_clarification',
          clarifyingQuestion: 'Which task should I move?',
          task: null,
          command: null,
        };
      }
      return ctx.segment === 0 ? create('Milk') : command('complete', 'Report');
    });

    const res = await runWithVoiceTrace(trace, () => h.turn({ transcript: 'three parts' }));

    expect(res.outcome).toBe('clarify');
    expect(res.assistantMessage).toBe('Which task should I move?');
    expect(h.parse).toHaveBeenCalledTimes(3);
    const middle = trace.steps.filter((step) => step.segment === 1);
    expect(middle).toEqual([
      expect.objectContaining({ component: 'router', ok: true }),
      expect.objectContaining({ component: 'specialist', ok: true }),
      expect.objectContaining({
        component: 'orchestrator',
        name: 'segment',
        outcome: 'clarify',
        reason: 'needs_clarification',
        ok: true,
      }),
    ]);
    expect(middle.some((step) => step.valid === false || step.errorCode)).toBe(false);
    expect(trace.steps.filter((step) => step.name === 'segment').map((step) => step.outcome)).toEqual([
      'accepted',
      'clarify',
      'accepted',
    ]);
    expect(JSON.stringify(trace.steps)).not.toContain('Which task');
  });

  it('records refused after a valid router and specialist call', async () => {
    const h = build();
    const trace = new VoiceTrace('refused-turn');
    h.completeJson.mockImplementation(async () => {
      await traceStep('llm', 'planner.r0', 'groq:test', async () => '{}', undefined, {
        component: 'planner',
      });
      return JSON.stringify({
        type: 'steps',
        answer: '',
        segments: ['buy milk', 'hack the bank', 'report is done'],
      });
    });
    h.parse.mockImplementation(async (ctx) => {
      await traceStep('llm', 'router', 'groq:test', async () => '{}', undefined, {
        component: 'router',
        segment: ctx.segment,
      });
      await traceStep('llm', 'specialist.command', 'groq:test', async () => '{}', undefined, {
        component: 'specialist',
        segment: ctx.segment,
      });
      if (ctx.segment === 1) {
        return {
          understanding: 'complete',
          clarifyingQuestion: null,
          task: null,
          command: { kind: 'refuse', message: 'Cannot do that' },
        };
      }
      return ctx.segment === 0 ? create('Milk') : command('complete', 'Report');
    });

    const res = await runWithVoiceTrace(trace, () => h.turn({ transcript: 'three parts' }));

    expect(res.outcome).toBe('confirm');
    expect(res.assistantMessage).toContain('Cannot do that');
    expect(h.parse).toHaveBeenCalledTimes(3);
    const middle = trace.steps.filter((step) => step.segment === 1);
    expect(middle).toEqual([
      expect.objectContaining({ component: 'router', name: 'router', ok: true }),
      expect.objectContaining({ component: 'specialist', name: 'specialist.command', ok: true }),
      expect.objectContaining({
        component: 'orchestrator',
        name: 'segment',
        outcome: 'refused',
        reason: 'command_refuse',
        ok: true,
      }),
    ]);
    expect(middle.some((step) => step.valid === false || step.errorCode === 'invalid_json')).toBe(false);
    expect(JSON.stringify(trace.steps)).not.toContain('Cannot do that');
    expect(JSON.stringify(trace.steps)).not.toContain('hack the bank');
  });

  it('records dropped with a localizing code and without the exception text', async () => {
    const h = build();
    const trace = new VoiceTrace('dropped-turn');
    h.completeJson.mockImplementation(async () => {
      await traceStep('llm', 'planner.r0', 'groq:test', async () => '{}', undefined, {
        component: 'planner',
      });
      return JSON.stringify({
        type: 'steps',
        answer: '',
        segments: ['buy milk', 'private errand', 'report is done'],
      });
    });
    h.parse.mockImplementation(async (ctx) => {
      if (ctx.segment === 1) {
        await traceStep('llm', 'router', 'groq:test', async () => '{}', undefined, {
          component: 'router',
          segment: ctx.segment,
        });
        annotateLatestStep(
          (step) => step.component === 'router' && step.segment === 1,
          { valid: false, errorCode: 'invalid_json' },
        );
        throw new Error('Patient Andrii said SECRET_PHRASE');
      }
      await traceStep('llm', 'router', 'groq:test', async () => '{}', undefined, {
        component: 'router',
        segment: ctx.segment,
      });
      await traceStep('llm', 'specialist.create', 'groq:test', async () => '{}', undefined, {
        component: 'specialist',
        segment: ctx.segment,
      });
      return ctx.segment === 0 ? create('Milk') : command('complete', 'Report');
    });

    const res = await runWithVoiceTrace(trace, () => h.turn({ transcript: 'three parts' }));

    expect(res.outcome).toBe('confirm');
    expect(h.parse).toHaveBeenCalledTimes(3);
    expect(trace.steps.filter((step) => step.name === 'segment').map((step) => step.outcome)).toEqual([
      'accepted',
      'dropped',
      'accepted',
    ]);
    expect(trace.steps.find((step) => step.name === 'segment' && step.segment === 1)).toEqual(
      expect.objectContaining({
        component: 'orchestrator',
        outcome: 'dropped',
        valid: false,
        errorCode: 'invalid_json',
        reason: 'router',
        ok: true,
      }),
    );
    const encoded = JSON.stringify(trace.steps);
    expect(encoded).not.toContain('SECRET_PHRASE');
    expect(encoded).not.toContain('Andrii');
    expect(encoded).not.toContain('private errand');
  });

  it('records parse_error when a segment throws outside a marked model step', async () => {
    const h = build();
    const trace = new VoiceTrace('bare-drop');
    h.planner({
      type: 'steps',
      answer: '',
      segments: ['buy milk'],
    });
    h.parse.mockImplementation(async () => {
      throw new Error('calendar row for a private name');
    });

    const res = await runWithVoiceTrace(trace, () => h.turn({ transcript: 'buy milk' }));

    expect(res.outcome).toBe('refuse');
    expect(trace.steps.filter((step) => step.name === 'segment')).toEqual([
      expect.objectContaining({
        component: 'orchestrator',
        segment: 0,
        outcome: 'dropped',
        valid: false,
        errorCode: 'parse_error',
        ok: true,
      }),
    ]);
    expect(JSON.stringify(trace.steps)).not.toContain('private name');
  });
});

describe('VoiceAgentOrchestrator — bare pronoun clarification', () => {
  const report: VoiceCommandTask = {
    id: 'zvit',
    name: 'Звіт',
    status: 'todo',
    isRecurring: false,
    isUnscheduled: false,
    isFixedExternal: false,
    eventType: 'admin',
    googleEventId: null,
    googleEventCalendarId: null,
    scheduledStartTime: null,
    scheduledEndTime: null,
  };
  const meeting: VoiceCommandTask = {
    ...report,
    id: 'narada',
    name: 'Нарада',
  };
  const slots: VoiceCommandSlot[] = [
    {
      id: 's-zvit',
      taskId: 'zvit',
      startIso: '2026-10-18T06:00:00.000Z',
      endIso: '2026-10-18T07:00:00.000Z',
      googleEventId: 'evt-zvit',
      googleEventCalendarId: 'cal',
      synthetic: false,
    },
  ];

  async function throughResolver(ctx: {
    transcript: string;
    previousTranscript?: string;
    clarificationAnswer?: string;
  }): Promise<VoiceParseResult> {
    const speech = ctx.clarificationAnswer
      ? `${ctx.previousTranscript || ''} ${ctx.clarificationAnswer}`.trim()
      : ctx.transcript;
    if (/^(?:додай|створи)(?![\p{L}\p{N}])/iu.test(speech)) {
      const name = /хліб/iu.test(speech) ? 'Хліб' : 'Бюджет';
      return create(name);
    }
    const sniffed = sniffCommandIntent(speech);
    const intent = sniffed === 'delete' ? 'delete' : 'reschedule';
    const raw = {
      understanding: 'complete',
      intent,
      command: {
        target: 'current',
        taskName: 'Звіт',
        start: /20:00/.test(ctx.clarificationAnswer ?? '')
          ? '2026-10-18T20:00:00+03:00'
          : '2026-10-18T15:00:00+03:00',
      },
    };
    const resolved = resolveVoiceCommand({
      draft: commandDraftFromRaw(raw, intent),
      transcript: speech,
      timeZone: 'Europe/Kyiv',
      nowIso: NOW,
      alreadyClarified: Boolean(ctx.clarificationAnswer),
      tasks: [report, meeting],
      slots,
      language: 'uk',
    });
    if (resolved.type === 'clarify') {
      return {
        understanding: 'needs_clarification',
        clarifyingQuestion: resolved.question,
        task: null,
        command: null,
      };
    }
    return {
      understanding: 'complete',
      clarifyingQuestion: null,
      task: null,
      command: resolved.command,
    };
  }

  it('keeps the move, asks which task, then moves Нарада after the answer', async () => {
    const h = build();
    h.parse.mockImplementation(throughResolver);
    h.planner({ type: 'steps', answer: '', segments: ['Перенеси це на вечір'] });

    const asked = await h.turn({ transcript: 'Перенеси це на вечір' });

    expect(asked.outcome).toBe('clarify');
    expect(asked.intents).toEqual([]);
    expect(h.session().pendingIntents).toBeNull();
    expect(h.session().pendingBatch?.unresolved).toEqual([
      { segment: 'Перенеси це на вечір', question: 'Яку задачу?' },
    ]);
    expect(JSON.stringify(asked)).not.toContain('Звіт');

    h.planner({ type: 'answer_pending' });
    const answered = await h.turn({ transcript: 'Нараду' });

    expect(h.parse.mock.calls[1][0]).toMatchObject({
      previousTranscript: 'Перенеси це на вечір',
      clarificationAnswer: 'Нараду',
    });
    expect(answered.outcome).toBe('confirm');
    expect(answered.outcome).not.toBe('act');
    expect(answered.intents).toHaveLength(1);
    expect(answered.intents[0]).toMatchObject({
      type: 'command',
      command: { taskId: 'narada', taskName: 'Нарада' },
    });
    expect(JSON.stringify(answered.intents)).not.toContain('Звіт');
    expect(h.session().pendingKind).toBe('writes');
    expect(h.tools.execute).not.toHaveBeenCalled();

    const applied = await h.turn({ actionId: 'confirm' });
    expect(applied.outcome).toBe('act');
    expect(applied.intents[0]).toMatchObject({
      type: 'command',
      command: { taskId: 'narada', taskName: 'Нарада' },
    });
    expect(h.tools.execute).not.toHaveBeenCalled();
  });

  it('keeps an independent create beside an update, and a create beside a different delete', async () => {
    const h = build();
    h.parse.mockImplementation(throughResolver);
    h.planner({ type: 'steps', answer: '', segments: ['Додай хліб', 'Перенеси нараду на п\'ятницю'] });
    const moved = await h.turn({ transcript: 'Додай хліб і перенеси нараду на п\'ятницю' });
    expect(moved.outcome).toBe('confirm');
    expect(moved.intents.map((intent) => intent.type === 'create' ? intent.task.name : intent.command.taskName)).toEqual([
      'Хліб',
      'Нарада',
    ]);

    const other = build();
    other.parse.mockImplementation(throughResolver);
    other.planner({ type: 'steps', answer: '', segments: ['Створи бюджет', 'Видали нараду'] });
    const removed = await other.turn({ transcript: 'Створи бюджет і видали нараду' });
    expect(removed.outcome).toBe('confirm');
    expect(removed.intents.map((intent) => intent.type === 'create' ? intent.task.name : intent.command.taskName)).toEqual([
      'Бюджет',
      'Нарада',
    ]);
    expect(removed.intents[1]).toMatchObject({ type: 'command', command: { kind: 'delete', taskName: 'Нарада' } });
  });

  it('continues the move when the answer names the task in a phrase or with a new clock', async () => {
    const h = build();
    h.parse.mockImplementation(throughResolver);
    h.planner({ type: 'steps', answer: '', segments: ['Перенеси це на вечір'] });
    await h.turn({ transcript: 'Перенеси це на вечір' });

    h.planner({ type: 'answer_pending' });
    const phrased = await h.turn({ transcript: 'Я мав на увазі нараду' });
    expect(phrased.outcome).toBe('confirm');
    expect(phrased.intents[0]).toMatchObject({
      type: 'command',
      command: { taskId: 'narada', taskName: 'Нарада' },
    });
    expect(JSON.stringify(phrased.intents)).not.toContain('Звіт');
    expect(h.tools.execute).not.toHaveBeenCalled();

    const timed = build();
    timed.parse.mockImplementation(throughResolver);
    timed.planner({ type: 'steps', answer: '', segments: ['Перенеси це на вечір'] });
    await timed.turn({ transcript: 'Перенеси це на вечір' });
    timed.planner({ type: 'answer_pending' });
    const later = await timed.turn({ transcript: 'Нараду на 20:00' });
    expect(later.outcome).toBe('confirm');
    expect(later.intents[0]).toMatchObject({
      type: 'command',
      command: {
        taskId: 'narada',
        taskName: 'Нарада',
        earliestStartTime: '2026-10-18T20:00:00+03:00',
      },
    });
    expect(timed.tools.execute).not.toHaveBeenCalled();
    const applied = await timed.turn({ actionId: 'confirm' });
    expect(applied.outcome).toBe('act');
    expect(applied.intents[0]).toMatchObject({
      type: 'command',
      command: { taskId: 'narada', earliestStartTime: '2026-10-18T20:00:00+03:00' },
    });
    expect(timed.tools.execute).not.toHaveBeenCalled();
  });

  it('does not write a task when the answer settles no target or names two tasks', async () => {
    const unanswered = build();
    unanswered.parse.mockImplementation(throughResolver);
    unanswered.planner({ type: 'steps', answer: '', segments: ['Перенеси це на вечір'] });
    await unanswered.turn({ transcript: 'Перенеси це на вечір' });
    unanswered.planner({ type: 'answer_pending' });
    const blank = await unanswered.turn({ transcript: 'не знаю' });
    expect(blank.outcome).not.toBe('confirm');
    expect(blank.outcome).not.toBe('act');
    expect(blank.intents).toEqual([]);
    expect(JSON.stringify(blank)).not.toContain('Звіт');
    expect(unanswered.tools.execute).not.toHaveBeenCalled();

    const both = build();
    both.parse.mockImplementation(throughResolver);
    both.planner({ type: 'steps', answer: '', segments: ['Перенеси це на вечір'] });
    await both.turn({ transcript: 'Перенеси це на вечір' });
    both.planner({ type: 'answer_pending' });
    const two = await both.turn({ transcript: 'Нараду чи звіт' });
    expect(two.outcome).not.toBe('confirm');
    expect(two.outcome).not.toBe('act');
    expect(two.intents).toEqual([]);
    expect(JSON.stringify(two)).not.toMatch(/narada|zvit/);
    expect(both.tools.execute).not.toHaveBeenCalled();
  });
});
