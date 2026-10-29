/**
 * Production structured voice turn: catalog, interpreter wiring, claims, confirm-time re-reads,
 * Apply outcomes, day plan, and failure handling. Repositories and the model are scripted.
 */
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { runWithVoiceTrace, VoiceTrace } from '../../../../common/voice-trace';
import { TaskStatus, type Task } from '../../../tasks/entities/task.entity';
import type { ScheduledTask } from '../../../schedule/schedule.entity';
import type { DayReminder } from '../../../day-reminders/entities/day-reminder.entity';
import type { VoiceTurnDto } from '../../dto/voice-turn.dto';
import type { DayPlanProposal, PlanDraft, VoiceTurnResponse } from '../../voice-agent.types';
import type { SemanticConstraintV1, SemanticEnvelopeV1, SemanticOperationV1 } from '../contracts/types';
import type { ProviderEvent } from '../../../calendar-providers/calendar-provider.types';
import { StructuredVoiceService } from './structured-voice.service';
import { buildCatalog, taskRecord } from './catalog';

const USER = 'user-1';
const OTHER = 'user-2';
const NOW = '2026-10-18T06:00:00.000Z'; // Sunday 09:00 Kyiv

function task(id: string, name: string, extra: Partial<Task> = {}): Task {
  return {
    id,
    userId: USER,
    name,
    status: TaskStatus.TODO,
    isRecurring: false,
    isUnscheduled: true,
    googleEventId: null,
    googleEventCalendarId: null,
    estimatedTimeInMinutes: 60,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-10T00:00:00.000Z'),
    ...extra,
  } as Task;
}

function slot(id: string, taskId: string, start: string, end: string, extra: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id,
    taskId,
    scheduledStartTime: new Date(start),
    scheduledEndTime: new Date(end),
    googleEventId: `g-${taskId}`,
    googleEventCalendarId: 'primary',
    updatedAt: new Date('2026-10-10T00:00:00.000Z'),
    ...extra,
  } as ScheduledTask;
}

type World = {
  tasks: Task[];
  slots: ScheduledTask[];
  reminders: DayReminder[];
  model: Array<string | Error>;
  prompts: string[];
  propose?: (userId: string, draft: PlanDraft, timeZone: string) => Promise<DayPlanProposal>;
  events?: ProviderEvent[];
};

function build(world: World) {
  const tasksRepository = {
    find: jest.fn(async ({ where }: { where: { userId: string } }) => world.tasks.filter((row) => row.userId === where.userId)),
    findOne: jest.fn(async ({ where }: { where: { id: string; userId: string } }) =>
      world.tasks.find((row) => row.id === where.id && row.userId === where.userId) ?? null),
  };
  const scheduledRepository = {
    find: jest.fn(async ({ where }: { where: { taskId: string } }) => world.slots.filter((row) => row.taskId === where.taskId)),
    createQueryBuilder: () => {
      let owner = '';
      const chain = {
        innerJoin: () => chain,
        where: (_sql: string, params: { userId: string }) => {
          owner = params.userId;
          return chain;
        },
        getMany: async () => world.slots.filter((row) => world.tasks.some((item) => item.id === row.taskId && item.userId === owner)),
      };
      return chain;
    },
  };
  const groq = {
    completeJson: jest.fn(async (_system: string, user: string) => {
      world.prompts.push(user);
      const next = world.model.shift();
      if (next instanceof Error) throw next;
      if (next == null) throw new Error('unscripted model call');
      return next;
    }),
  };
  const service = new StructuredVoiceService(
    groq as never,
    {
      getSettings: jest.fn(async () => ({
        timeZone: 'Europe/Kyiv',
        wakeTime: '08:00:00',
        sleepTime: '23:00:00',
        speechLanguage: 'en',
        language: 'en',
        defaultTaskDurationMinutes: 30,
        defaultReminderTime: '09:00',
      })),
    } as never,
    { execute: jest.fn(async () => ({})) } as never,
    { propose: jest.fn((userId: string, draft: PlanDraft, timeZone: string) => world.propose!(userId, draft, timeZone)) } as never,
    { listVisibleEvents: jest.fn(async () => world.events ?? []) } as never,
    { findAll: jest.fn(async (userId: string) => world.reminders.filter((row) => row.userId === userId && row.status === 'open')) } as never,
    tasksRepository as never,
    scheduledRepository as never,
    { find: jest.fn(async () => []) } as never,
  );
  return { service, groq };
}

function dto(extra: Partial<VoiceTurnDto> = {}): VoiceTurnDto {
  return { sessionId: 'session-0001', timeZone: 'Europe/Kyiv', clientNowIso: NOW, ...extra } as VoiceTurnDto;
}

function envelope(transcript: string, operations: Array<Omit<SemanticOperationV1, 'source' | 'dependsOn' | 'changes' | 'constraints'> & Partial<SemanticOperationV1>>): string {
  const body: SemanticEnvelopeV1 = {
    version: '1',
    kind: 'operations',
    operations: operations.map((row) => ({ changes: {}, constraints: [], dependsOn: [], source: { text: transcript }, ...row })),
  };
  return JSON.stringify(body);
}

const CONFIRM_PENDING = JSON.stringify({ version: '1', kind: 'control', operations: [], control: 'confirm_pending' });

function claimOf(response: VoiceTurnResponse): { executionId: string; previewRevision: number } {
  expect(response.execution?.state).toBe('open');
  return { executionId: response.execution!.executionId, previewRevision: response.execution!.previewRevision };
}

function world(extra: Partial<World> = {}): World {
  return { tasks: [], slots: [], reminders: [], model: [], prompts: [], ...extra };
}

describe('structured /voice/turn integration', () => {
  it('previews a create, confirms it only with the claim, and records the Apply outcome', async () => {
    const w = world({ model: [envelope('add tea', [{ opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'n' }, changes: { title: 'Tea' } }])] });
    const { service } = build(w);
    const preview = await service.turn(USER, dto({ transcript: 'add tea' }));
    expect(preview.outcome).toBe('confirm');
    expect(preview.intents).toHaveLength(1);
    const claim = claimOf(preview);

    w.model.push(CONFIRM_PENDING);
    const bare = await service.turn(USER, dto({ transcript: 'yes' }));
    expect(bare.outcome).toBe('refuse');
    expect(bare.intents).toEqual([]);

    const acted = await service.turn(USER, dto({ actionId: 'confirm', ...claim }));
    expect(acted.outcome).toBe('act');
    expect(acted.intents).toHaveLength(1);
    expect(acted.execution).toEqual({ ...claim, state: 'dispatched' });

    const again = await service.turn(USER, dto({ actionId: 'confirm', ...claim }));
    expect(again.outcome).not.toBe('act');
    expect(again.intents).toEqual([]);

    await service.turn(USER, dto({
      actionId: 'report',
      executionReport: { executionId: claim.executionId, results: [{ summary: 'Tea', status: 'applied' }] },
    }));
  });

  it('confirms by voice when the client sends the claim of the preview it shows', async () => {
    const w = world({ model: [envelope('add tea', [{ opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'n' }, changes: { title: 'Tea' } }]), CONFIRM_PENDING] });
    const { service } = build(w);
    const claim = claimOf(await service.turn(USER, dto({ transcript: 'add tea' })));
    const acted = await service.turn(USER, dto({ transcript: 'yes', ...claim }));
    expect(acted.outcome).toBe('act');
  });

  it('shows the model only this user\'s open records and refuses another user\'s id', async () => {
    const w = world({
      tasks: [task('mine', 'Report'), task('theirs', 'Secret', { userId: OTHER })],
      model: [envelope('delete secret', [{ opId: 'op-1', action: 'delete', target: { kind: 'existing', proposedId: 'theirs' } }])],
    });
    const { service } = build(w);
    const result = await service.turn(USER, dto({ transcript: 'delete secret' }));
    expect(w.prompts[0]).toContain('mine');
    expect(w.prompts[0]).not.toContain('theirs');
    expect(w.prompts[0]).not.toContain('Secret');
    expect(result.outcome).toBe('refuse');
    expect(result.intents).toEqual([]);
  });

  it('names the stored task in a command preview, not the transcript', async () => {
    const report = task('report', 'Quarterly report');
    const w = world({ tasks: [report], model: [envelope('drop that report thing', [{ opId: 'op-1', action: 'delete', target: { kind: 'existing', proposedId: 'report' } }])] });
    const { service } = build(w);
    const preview = await service.turn(USER, dto({ transcript: 'drop that report thing' }));
    expect(preview.intents[0]).toMatchObject({ summary: 'Delete “Quarterly report”', command: { kind: 'delete', taskName: 'Quarterly report' } });
    expect(preview.assistantMessage).not.toContain('drop that report thing');
  });

  it('blocks confirm when the task changed or was deleted after preview', async () => {
    const report = task('report', 'Report');
    const w = world({ tasks: [report], model: [envelope('delete report', [{ opId: 'op-1', action: 'delete', target: { kind: 'existing', proposedId: 'report' } }])] });
    const { service } = build(w);
    const claim = claimOf(await service.turn(USER, dto({ transcript: 'delete report' })));
    report.updatedAt = new Date('2026-10-18T05:00:00.000Z');
    const stale = await service.turn(USER, dto({ actionId: 'confirm', ...claim }));
    expect(stale.outcome).toBe('clarify');
    expect(stale.intents).toEqual([]);

    w.model.push(envelope('delete report', [{ opId: 'op-1', action: 'delete', target: { kind: 'existing', proposedId: 'report' } }]));
    const fresh = claimOf(await service.turn(USER, dto({ transcript: 'delete report' })));
    w.tasks = [];
    const gone = await service.turn(USER, dto({ actionId: 'confirm', ...fresh }));
    expect(gone.outcome).not.toBe('act');
    expect(gone.intents).toEqual([]);
  });

  it('blocks confirm when a slot moved underneath a planned move', async () => {
    const meeting = task('meet', 'Meeting', { isUnscheduled: false });
    const placed = slot('s1', 'meet', '2026-10-19T07:00:00.000Z', '2026-10-19T08:00:00.000Z');
    const transcript = 'move meeting to monday 15:00';
    const w = world({
      tasks: [meeting],
      slots: [placed],
      model: [envelope(transcript, [{
        opId: 'op-1',
        action: 'move',
        target: { kind: 'existing', proposedId: 'meet' },
        constraints: [{ kind: 'date', value: '2026-10-19', precision: 'day' }, { kind: 'clock', value: '15:00', role: 'start' }],
      }])],
    });
    const { service } = build(w);
    const preview = await service.turn(USER, dto({ transcript }));
    expect(preview.outcome).toBe('confirm');
    expect(preview.intents[0]).toMatchObject({ type: 'command', command: { kind: 'move', googleEventId: 'g-meet', originalStart: '2026-10-19T07:00:00.000Z' } });
    const claim = claimOf(preview);
    w.slots = [slot('s1', 'meet', '2026-10-19T09:00:00.000Z', '2026-10-19T10:00:00.000Z', { updatedAt: new Date('2026-10-18T05:00:00.000Z') })];
    const stale = await service.turn(USER, dto({ actionId: 'confirm', ...claim }));
    expect(stale.intents).toEqual([]);
  });

  it('does not resend a write whose Apply outcome was unknown, and allows a definitive failure', async () => {
    const op = envelope('delete report', [{ opId: 'op-1', action: 'delete', target: { kind: 'existing', proposedId: 'report' } }]);
    const w = world({ tasks: [task('report', 'Report')], model: [op] });
    const { service } = build(w);
    const first = claimOf(await service.turn(USER, dto({ transcript: 'delete report' })));
    await service.turn(USER, dto({ actionId: 'confirm', ...first }));
    await service.turn(USER, dto({
      actionId: 'report',
      executionReport: { executionId: first.executionId, results: [{ summary: 'Report', status: 'error' }] },
    }));
    w.model.push(op);
    const second = claimOf(await service.turn(USER, dto({ transcript: 'delete report' })));
    const held = await service.turn(USER, dto({ actionId: 'confirm', ...second }));
    expect(held.outcome).toBe('answer');
    expect(held.intents).toEqual([]);

    const w2 = world({ tasks: [task('report', 'Report')], model: [op] });
    const { service: other } = build(w2);
    const a = claimOf(await other.turn(USER, dto({ transcript: 'delete report' })));
    await other.turn(USER, dto({ actionId: 'confirm', ...a }));
    await other.turn(USER, dto({
      actionId: 'report',
      executionReport: { executionId: a.executionId, results: [{ summary: 'Report', status: 'error', definite: true }] },
    }));
    w2.model.push(op);
    const b = claimOf(await other.turn(USER, dto({ transcript: 'delete report' })));
    expect((await other.turn(USER, dto({ actionId: 'confirm', ...b }))).outcome).toBe('act');
  });

  it('treats a dispatched execution with no report as unknown on the next turn', async () => {
    const op = envelope('delete report', [{ opId: 'op-1', action: 'delete', target: { kind: 'existing', proposedId: 'report' } }]);
    const w = world({ tasks: [task('report', 'Report')], model: [op] });
    const { service } = build(w);
    const first = claimOf(await service.turn(USER, dto({ transcript: 'delete report' })));
    await service.turn(USER, dto({ actionId: 'confirm', ...first }));
    w.model.push(op);
    const second = claimOf(await service.turn(USER, dto({ transcript: 'delete report' })));
    const held = await service.turn(USER, dto({ actionId: 'confirm', ...second }));
    expect(held.outcome).toBe('answer');
    expect(held.intents).toEqual([]);
  });

  it('ignores a report for an execution this session never dispatched', async () => {
    const w = world();
    const { service } = build(w);
    const result = await service.turn(USER, dto({ actionId: 'report', executionReport: { executionId: 'forged', results: [{ summary: 'x', status: 'applied' }] } }));
    expect(result.outcome).toBe('answer');
    expect(result.intents).toEqual([]);
  });

  it('cancels from the UI without a model call, and the cancelled claim cannot confirm', async () => {
    const w = world({ model: [envelope('add tea', [{ opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'n' }, changes: { title: 'Tea' } }])] });
    const { service, groq } = build(w);
    const claim = claimOf(await service.turn(USER, dto({ transcript: 'add tea' })));
    const canceled = await service.turn(USER, dto({ actionId: 'cancel', ...claim }));
    expect(canceled.outcome).toBe('answer');
    expect(canceled.execution).toBeNull();
    const late = await service.turn(USER, dto({ actionId: 'confirm', ...claim }));
    expect(late.outcome).not.toBe('act');
    expect(groq.completeJson).toHaveBeenCalledTimes(1);
  });

  it('replaces the preview when the next utterance restates it', async () => {
    const w = world({
      model: [
        envelope('add tea at 8', [{ opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'n' }, changes: { title: 'Tea' }, constraints: [{ kind: 'date', value: '2026-10-18', precision: 'day' }, { kind: 'clock', value: '10:00', role: 'start' }] }]),
        envelope('no, tea at 11', [{ opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'n' }, changes: { title: 'Tea' }, constraints: [{ kind: 'date', value: '2026-10-18', precision: 'day' }, { kind: 'clock', value: '11:00', role: 'start' }] }]),
      ],
    });
    const { service } = build(w);
    await service.turn(USER, dto({ transcript: 'add tea at 8' }));
    const corrected = await service.turn(USER, dto({ transcript: 'no, tea at 11' }));
    expect(corrected.intents).toHaveLength(1);
    expect(JSON.stringify(corrected.intents)).toContain('2026-10-18T08:00:00.000Z');
  });

  it('previews a reminder with the production remind_create shape', async () => {
    const transcript = 'remind me to call mom tomorrow';
    const w = world({ model: [envelope(transcript, [{ opId: 'op-1', action: 'remind', target: { kind: 'new', localId: 'r' }, changes: { reminder: { op: 'create', name: 'call mom', dueYmd: '2026-10-19' } } }])] });
    const { service } = build(w);
    const result = await service.turn(USER, dto({ transcript }));
    expect(result.intents[0]).toMatchObject({ type: 'command', command: { kind: 'remind_create', name: 'call mom', dueYmd: '2026-10-19', notificationTime: null } });
  });

  it('asks for a series scope on a recurring task and fails closed on an unproven bulk set', async () => {
    const w = world({
      tasks: [task('gym', 'Gym', { isRecurring: true }), task('a', 'Sync'), task('b', 'Sync')],
      model: [
        envelope('delete gym', [{ opId: 'op-1', action: 'delete', target: { kind: 'existing', proposedId: 'gym' } }]),
        envelope('delete all syncs', [{ opId: 'op-1', action: 'delete', target: { kind: 'existing', description: 'Sync' }, scope: 'all' }]),
      ],
    });
    const { service } = build(w);
    const series = await service.turn(USER, dto({ transcript: 'delete gym' }));
    expect(series.outcome).toBe('clarify');
    expect(series.intents).toEqual([]);
    const bulk = await service.turn(USER, dto({ transcript: 'delete all syncs' }));
    expect(bulk.outcome).toBe('clarify');
    expect(bulk.intents).toEqual([]);
  });

  it('plans a day through build_plan and re-reads the planned task at confirm', async () => {
    const write = task('write', 'Write');
    const start = JSON.stringify({ version: '1', kind: 'day_plan', operations: [], dayPlan: { phase: 'start', day: '2026-10-19' } });
    const include = JSON.stringify({ version: '1', kind: 'day_plan', operations: [], dayPlan: { phase: 'edit', edits: [{ op: 'include_task', taskId: 'write' }] } });
    const w = world({
      tasks: [write],
      // The interpreter asks once more when a start has no edits; the model keeps the empty start.
      model: [start, start, include],
      propose: async (_userId, draft) => ({
        day: draft.day,
        stage: 'review',
        revision: draft.revision,
        items: draft.items.map((item) => ({ itemId: item.id, taskId: item.taskId, source: item.source, name: item.name, start: '2026-10-19T08:00:00.000Z', end: '2026-10-19T09:00:00.000Z', durationMinutes: item.durationMinutes })),
        unplaced: [],
        changedItemIds: [],
      }),
    });
    const { service } = build(w);
    const started = await service.turn(USER, dto({ transcript: 'plan my monday' }));
    expect(started.outcome).toBe('clarify');
    expect(started.plan?.items).toEqual([]);
    // Later tasks are offered by id, not seeded into the plan.
    const added = await service.turn(USER, dto({ transcript: 'yes, add write' }));
    expect(w.prompts[w.prompts.length - 1]).toContain('Later tasks, not in the plan: write Write');
    expect(added.assistantMessage).toContain('Write');
    const planned = await service.turn(USER, dto({ actionId: 'build_plan' }));
    expect(planned.outcome).toBe('confirm');
    expect(planned.intents[0]).toMatchObject({ type: 'command', command: { kind: 'window', taskId: 'write' } });
    const claim = claimOf(planned);
    write.updatedAt = new Date('2026-10-18T05:30:00.000Z');
    const stale = await service.turn(USER, dto({ actionId: 'confirm', ...claim }));
    expect(stale.intents).toEqual([]);
  });

  it('rethrows a rate limit and refuses with retry on another provider failure', async () => {
    const limited = new ServiceUnavailableException({ code: 'VOICE_RATE_LIMIT' });
    const w = world({ model: [limited, new Error('socket hang up')] });
    const { service } = build(w);
    await expect(service.turn(USER, dto({ transcript: 'add tea' }))).rejects.toBe(limited);
    const failed = await service.turn(USER, dto({ transcript: 'add tea' }));
    expect(failed.outcome).toBe('refuse');
    expect(failed.actions).toContain('retry');
  });

  it('serializes turns on one session', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const w = world();
    const { service, groq } = build(w);
    groq.completeJson.mockImplementationOnce(async () => {
      order.push('first:start');
      await gate;
      order.push('first:end');
      return envelope('add tea', [{ opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'n' }, changes: { title: 'Tea' } }]);
    });
    groq.completeJson.mockImplementationOnce(async () => {
      order.push('second');
      return envelope('add milk', [{ opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'n' }, changes: { title: 'Milk' } }]);
    });
    const first = service.turn(USER, dto({ transcript: 'add tea' }));
    const second = service.turn(USER, dto({ transcript: 'add milk' }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['first:start', 'first:end', 'second']);
  });

  it('ignores noise without a model call', async () => {
    const w = world();
    const { service, groq } = build(w);
    const result = await service.turn(USER, dto({ transcript: '   ' }));
    expect(result.outcome).toBe('answer');
    expect(groq.completeJson).not.toHaveBeenCalled();
  });
});

function readEnvelope(...reads: Array<Record<string, unknown>>): string {
  return JSON.stringify({
    version: '1',
    kind: 'answer',
    operations: [],
    answer: { text: 'Checking.' },
    requestedReads: reads.map((args, index) => ({ requestId: `r-${index + 1}`, name: 'find_tasks', args })),
  });
}

describe('structured bulk through find_tasks', () => {
  const said = 'delete all tasks for monday';
  const bulkDelete = envelope(said, [{ opId: 'op-1', action: 'delete', target: { kind: 'existing', description: 'tasks for monday' }, scope: 'all' }]);
  const monday = () => ({
    tasks: [task('a', 'Sync', { isUnscheduled: false }), task('b', 'Standup', { isUnscheduled: false }), task('c', 'Gym', { isUnscheduled: false })],
    slots: [
      slot('s1', 'a', '2026-10-19T07:00:00.000Z', '2026-10-19T08:00:00.000Z'),
      slot('s2', 'b', '2026-10-19T09:00:00.000Z', '2026-10-19T10:00:00.000Z'),
      slot('s3', 'c', '2026-10-20T09:00:00.000Z', '2026-10-20T10:00:00.000Z'),
    ],
  });

  it('previews exactly the server search result and confirms it after re-reads', async () => {
    const w = world({ ...monday(), model: [readEnvelope({ day: '2026-10-19' }), bulkDelete] });
    const { service } = build(w);
    const preview = await service.turn(USER, dto({ transcript: said }));
    expect(preview.outcome).toBe('confirm');
    expect(preview.intents.map((intent) => (intent.type === 'command' ? intent.command.taskId : null))).toEqual(['a', 'b']);
    const acted = await service.turn(USER, dto({ actionId: 'confirm', ...claimOf(preview) }));
    expect(acted.outcome).toBe('act');
    expect(acted.intents).toHaveLength(2);
  });

  it('fails closed without a search, with two searches, or when one member cannot be written', async () => {
    const none = world({ ...monday(), model: [bulkDelete] });
    expect((await build(none).service.turn(USER, dto({ transcript: said }))).intents).toEqual([]);

    const two = world({ ...monday(), model: [readEnvelope({ day: '2026-10-19' }, { nameContains: 'sync' }), bulkDelete] });
    const twoResult = await build(two).service.turn(USER, dto({ transcript: said }));
    expect(twoResult.outcome).toBe('clarify');
    expect(twoResult.intents).toEqual([]);

    const series = monday();
    series.tasks[1] = task('b', 'Standup', { isUnscheduled: false, isRecurring: true });
    const recurring = world({ ...series, model: [readEnvelope({ day: '2026-10-19' }), bulkDelete] });
    const recurringResult = await build(recurring).service.turn(USER, dto({ transcript: said }));
    expect(recurringResult.outcome).toBe('clarify');
    expect(recurringResult.intents).toEqual([]);
  });
});

function event(id: string, summary: string, extra: Partial<ProviderEvent> = {}): ProviderEvent {
  return {
    id,
    calendarId: 'primary',
    summary,
    provider: 'google',
    start: { dateTime: '2026-10-19T10:00:00+03:00' },
    end: { dateTime: '2026-10-19T11:00:00+03:00' },
    organizer: { self: true },
    updated: '2026-10-10T00:00:00.000Z',
    status: 'confirmed',
    ...extra,
  };
}

function reads(name: string, args: Record<string, unknown>): string {
  return JSON.stringify({ version: '1', kind: 'answer', operations: [], answer: { text: 'Checking.' }, requestedReads: [{ requestId: 'r-1', name, args }] });
}

describe('structured operations on provider calendar events', () => {
  const said = 'move the dentist to 15:00';
  const moveDentist = envelope(said, [{
    opId: 'op-1',
    action: 'move',
    target: { kind: 'existing', proposedId: 'ext:google:ev-dentist' },
    constraints: [{ kind: 'date', value: '2026-10-19', precision: 'day' }, { kind: 'clock', value: '15:00', role: 'start' }],
  }]);

  it('moves a provider event found through find_events, on its own provider, after a fresh re-read', async () => {
    const w = world({ events: [event('ev-dentist', 'Dentist')], model: [reads('find_events', { day: '2026-10-19' }), moveDentist] });
    const { service } = build(w);
    const preview = await service.turn(USER, dto({ transcript: said }));
    expect(preview.outcome).toBe('confirm');
    expect(preview.intents[0]).toMatchObject({
      type: 'command',
      command: { kind: 'move', googleEventId: 'ev-dentist', provider: 'google', calendarId: 'primary', originalStart: '2026-10-19T07:00:00.000Z', start: '2026-10-19T12:00:00.000Z', end: '2026-10-19T13:00:00.000Z' },
    });
    const acted = await service.turn(USER, dto({ actionId: 'confirm', ...claimOf(preview) }));
    expect(acted.outcome).toBe('act');
  });

  it('blocks the confirm when the provider event changed after preview', async () => {
    const w = world({ events: [event('ev-dentist', 'Dentist')], model: [reads('find_events', { day: '2026-10-19' }), moveDentist] });
    const { service } = build(w);
    const preview = await service.turn(USER, dto({ transcript: said }));
    w.events = [event('ev-dentist', 'Dentist', { updated: '2026-10-18T05:00:00.000Z' })];
    const stale = await service.turn(USER, dto({ actionId: 'confirm', ...claimOf(preview) }));
    expect(stale.outcome).not.toBe('act');
    expect(stale.intents).toEqual([]);
  });

  it('deletes a provider event with its provider identity', async () => {
    const transcript = 'delete the dentist';
    const w = world({
      events: [event('ev-dentist', 'Dentist', { provider: 'microsoft', calendarId: 'cal-ms' })],
      model: [reads('find_events', { day: '2026-10-19' }), envelope(transcript, [{ opId: 'op-1', action: 'delete', target: { kind: 'existing', proposedId: 'ext:microsoft:ev-dentist' } }])],
    });
    const preview = await build(w).service.turn(USER, dto({ transcript }));
    expect(preview.intents[0]).toMatchObject({ type: 'command', command: { kind: 'delete_event', eventId: 'ev-dentist', calendarId: 'cal-ms', provider: 'microsoft' } });
  });

  it('refuses an invitation, an unknown id, and a complete on a provider event', async () => {
    const invite = world({
      events: [event('ev-dentist', 'Dentist', { organizer: { email: 'clinic@example.com' } })],
      model: [reads('find_events', { day: '2026-10-19' }), moveDentist],
    });
    expect((await build(invite).service.turn(USER, dto({ transcript: said }))).intents).toEqual([]);

    const unread = world({ events: [event('ev-dentist', 'Dentist')], model: [moveDentist] });
    expect((await build(unread).service.turn(USER, dto({ transcript: said }))).outcome).toBe('refuse');

    const transcript = 'mark the dentist done';
    const complete = world({
      events: [event('ev-dentist', 'Dentist')],
      model: [reads('find_events', { day: '2026-10-19' }), envelope(transcript, [{ opId: 'op-1', action: 'complete', target: { kind: 'existing', proposedId: 'ext:google:ev-dentist' } }])],
    });
    const result = await build(complete).service.turn(USER, dto({ transcript }));
    expect(result.intents).toEqual([]);
    expect(result.assistantMessage).toBe('That is a calendar event, not a task, so it cannot be marked done. I can move, rename, or delete it.');
  });

  it('renames an organizer-owned provider event and nothing else', async () => {
    const transcript = 'rename the dentist to dentist checkup';
    const w = world({
      events: [event('ev-dentist', 'Dentist')],
      model: [reads('find_events', { day: '2026-10-19' }), envelope(transcript, [{ opId: 'op-1', action: 'update', target: { kind: 'existing', proposedId: 'ext:google:ev-dentist' }, changes: { title: 'Dentist checkup' } }])],
    });
    const preview = await build(w).service.turn(USER, dto({ transcript }));
    expect(preview.intents[0]).toMatchObject({
      summary: 'Rename “Dentist” to “Dentist checkup”',
      command: { kind: 'rename_event', eventId: 'ev-dentist', provider: 'google', title: 'Dentist checkup' },
    });

    const notes = world({
      events: [event('ev-dentist', 'Dentist')],
      model: [reads('find_events', { day: '2026-10-19' }), envelope(transcript, [{ opId: 'op-1', action: 'update', target: { kind: 'existing', proposedId: 'ext:google:ev-dentist' }, changes: { title: 'Dentist checkup', notes: 'bring card' } }])],
    });
    expect((await build(notes).service.turn(USER, dto({ transcript }))).intents).toEqual([]);
  });

  it('previews a cancel of a provider event as its delete', async () => {
    const transcript = 'cancel the dentist';
    const w = world({
      events: [event('ev-dentist', 'Dentist')],
      model: [reads('find_events', { day: '2026-10-19' }), envelope(transcript, [{ opId: 'op-1', action: 'cancel', target: { kind: 'existing', proposedId: 'ext:google:ev-dentist' } }])],
    });
    const preview = await build(w).service.turn(USER, dto({ transcript }));
    expect(preview.intents[0]).toMatchObject({ summary: 'Delete “Dentist”', command: { kind: 'delete_event', eventId: 'ev-dentist' } });
  });

  it('does not offer a Luefy task\'s own calendar event as a second object', async () => {
    const w = world({
      tasks: [task('meet', 'Meeting', { googleEventId: 'ev-meet' })],
      events: [event('ev-meet', 'Meeting')],
      model: [reads('find_events', { day: '2026-10-19' }), envelope('move the meeting', [{ opId: 'op-1', action: 'move', target: { kind: 'existing', proposedId: 'ext:google:ev-meet' } }])],
    });
    const result = await build(w).service.turn(USER, dto({ transcript: 'move the meeting' }));
    expect(result.outcome).toBe('refuse');
    expect(result.intents).toEqual([]);
  });
});

describe('structured recurring tasks and occurrence scope', () => {
  // Gym repeats; it is placed on Monday 19th and Wednesday 21st, 10:00-11:00 Kyiv.
  const series = () => ({
    tasks: [task('gym', 'Gym', { isRecurring: true, isUnscheduled: false, googleEventId: 'master-gym', googleEventCalendarId: 'primary' })],
    slots: [
      slot('s1', 'gym', '2026-10-19T07:00:00.000Z', '2026-10-19T08:00:00.000Z', { googleEventId: null }),
      slot('s2', 'gym', '2026-10-21T07:00:00.000Z', '2026-10-21T08:00:00.000Z', { googleEventId: null }),
    ],
  });
  const op = (transcript: string, extra: Partial<SemanticOperationV1>) =>
    envelope(transcript, [{ opId: 'op-1', action: 'delete', target: { kind: 'existing', proposedId: 'gym' }, ...extra }]);
  const run = async (transcript: string, extra: Partial<SemanticOperationV1>) =>
    build(world({ ...series(), model: [op(transcript, extra)] })).service.turn(USER, dto({ transcript }));

  it('asks when the user did not say which part of the series, and never guesses an occurrence', async () => {
    const unscoped = await run('delete gym', {});
    expect(unscoped.outcome).toBe('clarify');
    expect(unscoped.intents).toEqual([]);
    const undated = await run('skip gym once', { action: 'skip', seriesScope: 'occurrence' });
    expect(undated.outcome).toBe('clarify');
    expect(undated.intents).toEqual([]);
    const noSuchDay = await run('skip gym on tuesday', { action: 'skip', seriesScope: 'occurrence', occurrence: '2026-10-20' });
    expect(noSuchDay.intents).toEqual([]);
  });

  it('maps delete by scope to skip, end of series, or delete of the series', async () => {
    const one = await run('delete gym on wednesday', { seriesScope: 'occurrence', occurrence: '2026-10-21' });
    expect(one.intents[0]).toMatchObject({
      type: 'command',
      command: { kind: 'skip', taskId: 'gym', occurrenceStart: '2026-10-21T07:00:00.000Z', googleEventId: expect.stringMatching(/^master-gym_/), googleEventCalendarId: 'primary' },
    });
    const tail = await run('delete gym from wednesday on', { seriesScope: 'from_day', occurrence: '2026-10-21' });
    expect(tail.intents[0]).toMatchObject({ type: 'command', command: { kind: 'end_series', occurrenceStart: '2026-10-21T07:00:00.000Z' } });
    const all = await run('delete gym completely', { seriesScope: 'all' });
    expect(all.intents[0]).toMatchObject({ type: 'command', command: { kind: 'delete', taskId: 'gym' } });
  });

  it('skips one occurrence', async () => {
    const result = await run('skip gym on monday', { action: 'skip', seriesScope: 'occurrence', occurrence: '2026-10-19' });
    expect(result.outcome).toBe('confirm');
    expect(result.intents[0]).toMatchObject({ type: 'command', command: { kind: 'skip', occurrenceStart: '2026-10-19T07:00:00.000Z' } });
  });

  it('moves an occurrence with the series identity and the stated scope, and re-checks slots at confirm', async () => {
    const transcript = 'move wednesday gym to 15:00';
    const w = world({
      ...series(),
      model: [op(transcript, {
        action: 'move',
        seriesScope: 'occurrence',
        occurrence: '2026-10-21',
        constraints: [{ kind: 'date', value: '2026-10-21', precision: 'day' }, { kind: 'clock', value: '15:00', role: 'start' }],
      })],
    });
    const { service } = build(w);
    const preview = await service.turn(USER, dto({ transcript }));
    expect(preview.intents[0]).toMatchObject({
      type: 'command',
      command: { kind: 'move', recurringEventId: 'master-gym', originalStart: '2026-10-21T07:00:00.000Z', start: '2026-10-21T12:00:00.000Z', seriesScope: 'occurrence' },
    });
    w.slots = [w.slots[0], slot('s2', 'gym', '2026-10-21T09:00:00.000Z', '2026-10-21T10:00:00.000Z', { googleEventId: null })];
    const stale = await service.turn(USER, dto({ actionId: 'confirm', ...claimOf(preview) }));
    expect(stale.intents).toEqual([]);
  });

  it('completes one occurrence by clearing that day, and refuses it from a day on', async () => {
    const complete = await run('done with gym today', { action: 'complete', seriesScope: 'occurrence', occurrence: '2026-10-19' });
    expect(complete.intents[0]).toMatchObject({
      summary: 'Mark done and clear from the calendar “Gym” on 2026-10-19',
      command: { kind: 'skip', taskId: 'gym', occurrenceStart: '2026-10-19T07:00:00.000Z' },
    });
    const tail = await run('done with gym from today', { action: 'complete', seriesScope: 'from_day', occurrence: '2026-10-19' });
    expect(tail.intents).toEqual([]);
  });

  it('refuses a series scope on a one-off task', async () => {
    const transcript = 'delete report once';
    const oneOff = await build(world({ tasks: [task('report', 'Report')], model: [envelope(transcript, [{ opId: 'op-1', action: 'delete', target: { kind: 'existing', proposedId: 'report' }, seriesScope: 'occurrence', occurrence: '2026-10-19' }])] }))
      .service.turn(USER, dto({ transcript }));
    expect(oneOff.outcome).toBe('clarify');
    expect(oneOff.intents).toEqual([]);
  });

  it('creates a recurring task from a structured pattern and asks when only words were given', async () => {
    const transcript = 'gym every monday and wednesday';
    const structured = await build(world({
      model: [envelope(transcript, [{ opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'n' }, changes: { title: 'Gym' }, constraints: [{ kind: 'recurrence', expression: 'every monday and wednesday', pattern: 'WEEKLY', weekDays: [3, 1] }] }])],
    })).service.turn(USER, dto({ transcript }));
    expect(structured.intents[0]).toMatchObject({ type: 'create', task: { name: 'Gym', isRecurring: true, recurrencePattern: 'WEEKLY', recurrenceWeekDays: [1, 3] } });
    const wordsOnly = await build(world({
      model: [envelope(transcript, [{ opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'n' }, changes: { title: 'Gym' }, constraints: [{ kind: 'recurrence', expression: 'every monday and wednesday' }] }])],
    })).service.turn(USER, dto({ transcript }));
    expect(wordsOnly.outcome).toBe('clarify');
    expect(wordsOnly.intents).toEqual([]);
  });
});

describe('structured all-day, bounds, and relative time', () => {
  const create = async (transcript: string, constraints: SemanticConstraintV1[]) =>
    build(world({ model: [envelope(transcript, [{ opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'n' }, changes: { title: 'Report' }, constraints }])] }))
      .service.turn(USER, dto({ transcript }));
  const created = (result: VoiceTurnResponse) => (result.intents[0]?.type === 'create' ? result.intents[0].task : null);
  const tomorrow: SemanticConstraintV1 = { kind: 'date', value: '2026-10-19', precision: 'day' };

  it('sets a deadline without inventing a start or a window', async () => {
    const task = created(await create('report tomorrow by 18:00', [tomorrow, { kind: 'clock', value: '18:00', role: 'deadline' }]));
    expect(task).toMatchObject({ deadline: '2026-10-19T15:00:00.000Z', isUnscheduled: false });
    expect(task).not.toHaveProperty('scheduledStartTime');
    expect(task).not.toHaveProperty('earliestStartTime');
  });

  it('bounds by the user\'s own sleep time and an earliest clock', async () => {
    const task = created(await create('report tomorrow after 10 before I sleep', [tomorrow, { kind: 'clock', value: '10:00', role: 'earliest' }, { kind: 'day_bound', edge: 'sleep', role: 'deadline' }]));
    expect(task).toMatchObject({ earliestStartTime: '2026-10-19T07:00:00.000Z', deadline: '2026-10-19T23:00:00+03:00' });
  });

  it('places an all-day item across the waking day', async () => {
    const task = created(await create('report all day tomorrow', [tomorrow, { kind: 'all_day' }]));
    expect(task).toMatchObject({ scheduledStartTime: '2026-10-19T08:00:00+03:00', scheduledEndTime: '2026-10-19T23:00:00+03:00', estimatedTimeInMinutes: 900, eventType: 'fixed' });
  });

  it('adds a delay from now in hours or days', async () => {
    const hours = created(await create('report in two hours', [{ kind: 'relative_time', anchor: 'now', direction: 'after', amount: 2, unit: 'hour' }]));
    expect(hours).toMatchObject({ scheduledStartTime: '2026-10-18T08:00:00.000Z' });
    const days = created(await create('report in three days', [{ kind: 'relative_time', anchor: 'now', direction: 'after', amount: 3, unit: 'day' }]));
    expect(days).toMatchObject({ earliestStartTime: expect.stringContaining('2026-10-21') });
  });

  it('asks instead of guessing for a wish clock, a delay with a date, or a delay from another task', async () => {
    expect((await create('report around 15', [tomorrow, { kind: 'clock', value: '15:00', role: 'preferred' }])).intents).toEqual([]);
    expect((await create('report tomorrow in two hours', [tomorrow, { kind: 'relative_time', anchor: 'now', direction: 'after', amount: 2, unit: 'hour' }])).intents).toEqual([]);
    expect((await create('report an hour after the meeting', [{ kind: 'relative_time', anchor: 'referenced_task', direction: 'after', amount: 1, unit: 'hour' }])).intents).toEqual([]);
  });

  it('updates a deadline, and refuses a bound on a move', async () => {
    const transcript = 'report due tomorrow at 18';
    const update = await build(world({
      tasks: [task('report', 'Report')],
      model: [envelope(transcript, [{ opId: 'op-1', action: 'update', target: { kind: 'existing', proposedId: 'report' }, constraints: [tomorrow, { kind: 'clock', value: '18:00', role: 'deadline' }] }])],
    })).service.turn(USER, dto({ transcript }));
    expect(update.intents[0]).toMatchObject({ type: 'command', command: { kind: 'update', patch: { deadline: '2026-10-19T15:00:00.000Z' } } });
    expect(update.intents[0]).not.toMatchObject({ command: { patch: { earliestStartTime: expect.anything() } } });

    const move = await build(world({
      tasks: [task('meet', 'Meeting', { isUnscheduled: false })],
      slots: [slot('s1', 'meet', '2026-10-19T07:00:00.000Z', '2026-10-19T08:00:00.000Z')],
      model: [envelope('move meeting before 18', [{ opId: 'op-1', action: 'move', target: { kind: 'existing', proposedId: 'meet' }, constraints: [tomorrow, { kind: 'clock', value: '18:00', role: 'deadline' }] }])],
    })).service.turn(USER, dto({ transcript: 'move meeting before 18' }));
    expect(move.intents).toEqual([]);
  });
});

describe('structured dependent actions in one request', () => {
  const createReport: SemanticOperationV1 = {
    opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'n' }, changes: { title: 'Report' }, constraints: [], dependsOn: [], source: { text: '' },
  };
  const ops = (transcript: string, list: SemanticOperationV1[]) => JSON.stringify({
    version: '1',
    kind: 'operations',
    operations: list.map((row) => ({ ...row, source: { text: transcript } })),
  });

  it('creates a task and a reminder about it as two independent writes', async () => {
    const transcript = 'add report and remind me tomorrow at 9';
    const result = await build(world({
      model: [ops(transcript, [createReport, {
        opId: 'op-2', action: 'remind', target: { kind: 'operation_result', opId: 'op-1' }, dependsOn: ['op-1'],
        changes: { reminder: { op: 'create', dueYmd: '2026-10-19', notificationTime: '09:00' } }, constraints: [], source: { text: '' },
      }])],
    })).service.turn(USER, dto({ transcript }));
    expect(result.outcome).toBe('confirm');
    expect(result.intents).toHaveLength(2);
    expect(result.intents[0]).toMatchObject({ type: 'create', task: { name: 'Report' } });
    expect(result.intents[1]).toMatchObject({ type: 'command', command: { kind: 'remind_create', name: 'Report', dueYmd: '2026-10-19', notificationTime: '09:00' } });
  });

  it('refuses a reminder about a task the same request withdrew', async () => {
    const transcript = 'add report, remind me, no forget the report';
    const result = await build(world({
      model: [ops(transcript, [
        createReport,
        { opId: 'op-2', action: 'remind', target: { kind: 'operation_result', opId: 'op-1' }, dependsOn: ['op-1'], changes: { reminder: { op: 'create', dueYmd: '2026-10-19' } }, constraints: [], source: { text: '' } },
        { opId: 'op-3', action: 'delete', target: { kind: 'operation_result', opId: 'op-1' }, dependsOn: ['op-1'], changes: {}, constraints: [], source: { text: '' } },
      ])],
    })).service.turn(USER, dto({ transcript }));
    expect(result.intents).toEqual([]);
  });

  const meetingWorld = (extra: Partial<World> = {}) => world({
    tasks: [task('meet', 'Meeting', { isUnscheduled: false })],
    slots: [slot('s1', 'meet', '2026-10-19T07:00:00.000Z', '2026-10-19T08:00:00.000Z')],
    ...extra,
  });
  const ordered = (transcript: string, relation: 'before' | 'after') => ops(transcript, [{
    ...createReport,
    constraints: [{ kind: 'ordering', relation, target: { kind: 'existing', proposedId: 'meet' } }],
  }]);

  it('bounds a new task by an existing task, and re-checks that task at confirm', async () => {
    const after = await build(meetingWorld({ model: [ordered('report after the meeting', 'after')] })).service.turn(USER, dto({ transcript: 'report after the meeting' }));
    expect(after.intents[0]).toMatchObject({ type: 'create', task: { earliestStartTime: '2026-10-19T08:00:00.000Z', isUnscheduled: false } });
    const before = await build(meetingWorld({ model: [ordered('report before the meeting', 'before')] })).service.turn(USER, dto({ transcript: 'report before the meeting' }));
    expect(before.intents[0]).toMatchObject({ type: 'create', task: { deadline: '2026-10-19T07:00:00.000Z' } });

    const w = meetingWorld({ model: [ordered('report after the meeting', 'after')] });
    const { service } = build(w);
    const preview = await service.turn(USER, dto({ transcript: 'report after the meeting' }));
    w.slots = [slot('s1', 'meet', '2026-10-19T09:00:00.000Z', '2026-10-19T10:00:00.000Z', { updatedAt: new Date('2026-10-18T05:00:00.000Z') })];
    const stale = await service.turn(USER, dto({ actionId: 'confirm', ...claimOf(preview) }));
    expect(stale.intents).toEqual([]);
  });

  it('asks when the other task has no time, or when it is created in the same request', async () => {
    const unplaced = await build(world({ tasks: [task('meet', 'Meeting')], model: [ordered('report after the meeting', 'after')] }))
      .service.turn(USER, dto({ transcript: 'report after the meeting' }));
    expect(unplaced.outcome).toBe('clarify');
    expect(unplaced.intents).toEqual([]);

    const transcript = 'add call, then report after it';
    const sameRequest = await build(world({
      model: [ops(transcript, [
        { ...createReport, opId: 'op-1', changes: { title: 'Call' } },
        { ...createReport, opId: 'op-2', target: { kind: 'new', localId: 'r' }, dependsOn: ['op-1'], constraints: [{ kind: 'ordering', relation: 'after', target: { kind: 'operation_result', opId: 'op-1' } }] },
      ])],
    })).service.turn(USER, dto({ transcript }));
    expect(sameRequest.intents).toEqual([]);
    expect(sameRequest.assistantMessage).toBe('The other task has no time yet. I will not invent one.');
  });

  it('bounds a task by a timed task created in the same request, and runs it after that create', async () => {
    const transcript = 'call tomorrow at 10 for half an hour, then report after it';
    const call: SemanticOperationV1 = {
      ...createReport,
      changes: { title: 'Call' },
      constraints: [{ kind: 'date', value: '2026-10-19', precision: 'day' }, { kind: 'clock', value: '10:00', role: 'start' }, { kind: 'duration', minutes: 30 }],
    };
    const report: SemanticOperationV1 = {
      ...createReport,
      opId: 'op-2',
      target: { kind: 'new', localId: 'r' },
      constraints: [{ kind: 'ordering', relation: 'after', target: { kind: 'operation_result', opId: 'op-1' } }],
    };
    const result = await build(world({ model: [ops(transcript, [call, report])] })).service.turn(USER, dto({ transcript }));
    expect(result.outcome).toBe('confirm');
    expect(result.intents).toHaveLength(2);
    expect(result.intents[0]).toMatchObject({ type: 'create', task: { name: 'Call', scheduledStartTime: '2026-10-19T07:00:00.000Z' } });
    expect(result.intents[1]).toMatchObject({ type: 'create', task: { name: 'Report', earliestStartTime: '2026-10-19T07:30:00.000Z', isUnscheduled: false } });
  });
});

describe('structured voice step log', () => {
  const flag = process.env.VOICE_TRACE_BODY;
  afterEach(() => {
    if (flag === undefined) delete process.env.VOICE_TRACE_BODY;
    else process.env.VOICE_TRACE_BODY = flag;
    jest.restoreAllMocks();
  });

  async function logged(bodies: boolean): Promise<{ lines: string[]; trace: VoiceTrace }> {
    if (bodies) process.env.VOICE_TRACE_BODY = '1';
    else delete process.env.VOICE_TRACE_BODY;
    const lines: string[] = [];
    jest.spyOn(Logger.prototype, 'log').mockImplementation((message: unknown) => {
      lines.push(String(message));
    });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation((message: unknown) => {
      lines.push(String(message));
    });
    const w = world({ tasks: [task('report', 'Report')], model: [envelope('delete the report', [{ opId: 'op-1', action: 'delete', target: { kind: 'existing', proposedId: 'report' } }])] });
    const { service } = build(w);
    const trace = new VoiceTrace('trace-1');
    const preview = await runWithVoiceTrace(trace, () => service.turn(USER, dto({ transcript: 'delete the report' })));
    await runWithVoiceTrace(trace, () => service.turn(USER, dto({ actionId: 'confirm', ...claimOf(preview) })));
    return { lines: lines.filter((line) => line.startsWith('voice.structured trace-1 ')), trace };
  }

  it('logs every step of a turn with timings', async () => {
    const { lines, trace } = await logged(true);
    const steps = lines.map((line) => line.split(' ')[2]);
    expect(steps).toEqual(expect.arrayContaining([
      'turn.start', 'context.load', 'context.ready', 'interpreter.prompt', 'model.call', 'model.validation',
      'interpreter.result', 'pipeline', 'pipeline.interpret', 'pipeline.preview', 'turn.state', 'turn.result',
      'interpreter.ui_action', 'confirm.reread', 'apply.dispatched',
    ]));
    expect(lines.find((line) => line.includes(' model.call '))).toMatch(/"ms":\d+/);
    expect(lines.find((line) => line.includes(' turn.start '))).toContain('body=delete the report');
    expect(lines.find((line) => line.includes(' model.call '))).toContain('"proposedId":"report"');
    const names = trace.steps.map((step) => step.name);
    expect(names).toEqual(expect.arrayContaining(['db.turn-context', 'confirm.reread']));
    // No enclosing step, so voice.trace does not count a model call or a read twice.
    expect(names).not.toContain('vnext.pipeline');
  });

  it('keeps transcripts and model output out of the log unless bodies are enabled', async () => {
    const { lines } = await logged(false);
    expect(lines.length).toBeGreaterThan(5);
    expect(lines.some((line) => line.includes('body='))).toBe(false);
    expect(lines.join('\n')).not.toContain('delete the report');
  });
});

describe('structured voice catalog', () => {
  it('changes a task revision when a slot moves, is added, or is removed', () => {
    const meeting = task('meet', 'Meeting');
    const base = taskRecord(meeting, [slot('s1', 'meet', '2026-10-19T07:00:00.000Z', '2026-10-19T08:00:00.000Z')]).revision;
    expect(taskRecord(meeting, [slot('s1', 'meet', '2026-10-19T09:00:00.000Z', '2026-10-19T10:00:00.000Z')]).revision).not.toBe(base);
    expect(taskRecord(meeting, []).revision).not.toBe(base);
    expect(taskRecord(meeting, [
      slot('s1', 'meet', '2026-10-19T07:00:00.000Z', '2026-10-19T08:00:00.000Z'),
      slot('s2', 'meet', '2026-10-20T07:00:00.000Z', '2026-10-20T08:00:00.000Z'),
    ]).revision).not.toBe(base);
  });

  it('gives a move identity only to a one-slot non-series task and drops other users\' rows', () => {
    const rows = buildCatalog(USER, [
      task('one', 'One'),
      task('series', 'Series', { isRecurring: true, googleEventId: 'master' }),
      task('foreign', 'Foreign', { userId: OTHER }),
    ], [
      slot('s1', 'one', '2026-10-19T07:00:00.000Z', '2026-10-19T08:00:00.000Z'),
      slot('s2', 'series', '2026-10-19T07:00:00.000Z', '2026-10-19T08:00:00.000Z'),
    ], []);
    expect(rows.map((row) => row.id)).toEqual(['one', 'series']);
    expect(rows[0]).toMatchObject({ googleEventId: 'g-one', calendarId: 'primary' });
    expect(rows[1]).toMatchObject({ googleEventId: null, recurring: true });
  });
});
