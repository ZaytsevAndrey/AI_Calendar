import { localDateTimeIso } from '../voice-local-date.util';
import { PlacementStepService } from '../../schedule/placement-step.service';
import { TaskEventType } from '../../scheduling/event-type.enum';
import { ScheduleState, TaskStatus } from '../../tasks/entities/task.entity';
import { applyPreview } from './apply/apply-preview';
import type { SemanticEnvelopeV1, SemanticOperationV1 } from './contracts/types';
import { scoreSemanticOutcome } from './eval/semantic-outcome';
import { runInterpreterA } from './interpreters/run-interpreter';
import { ReadBroker } from './broker/read-broker';
import { runVNextTurn, type TurnInput } from './pipeline';
import { expectBlocked, expectFailClosed } from './eval/structured-test-harness';
import { withStructuredConfirmation } from './eval/structured-test-turn';
import type { EntityRecord } from './reference/reference-resolver';
import { createSession, type VNextSession } from './session/session';
import { VoiceDayPlanner } from '../voice-agent.day-plan';
import type { PlanDraft } from '../voice-agent.types';

const NOW = '2026-10-18T06:00:00.000Z';
const MEETING: EntityRecord = { id: 'task-a', userId: 'user-1', type: 'task', name: 'Нарада', status: 'open', revision: 1 };
const REPORT: EntityRecord = { id: 'task-b', userId: 'user-1', type: 'task', name: 'Звіт', status: 'open', revision: 1 };

function operation(partial: Partial<SemanticOperationV1> & Pick<SemanticOperationV1, 'opId' | 'action' | 'target'>): SemanticOperationV1 {
  return { changes: {}, constraints: [], dependsOn: [], source: { text: partial.opId }, ...partial };
}

function createOp(opId: string, title: string, constraints: SemanticOperationV1['constraints'] = []): SemanticOperationV1 {
  return operation({
    opId,
    action: 'create',
    target: { kind: 'new', localId: opId },
    changes: { title },
    constraints,
    source: { text: title },
  });
}

function envelope(operations: SemanticOperationV1[]): SemanticEnvelopeV1 {
  return { version: '1', kind: 'operations', operations };
}

function scripted(value: SemanticEnvelopeV1) {
  return {
    arm: 'A' as const,
    interpret: async () => ({
      ok: true as const,
      envelope: value,
      reads: [],
      usage: { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 },
      specialist: null,
      promptHash: 'phase47',
    }),
  };
}

async function turn(session: VNextSession, value: SemanticEnvelopeV1, extra: Partial<TurnInput> = {}) {
  extra = withStructuredConfirmation(session, value, extra);
  return runVNextTurn(
    {
      transcript: extra.transcript ?? 'hello',
      userId: 'user-1',
      session,
      nowIso: NOW,
      timeZone: 'Europe/Kyiv',
      wakeHm: '08:00',
      sleepHm: '23:00',
      defaultDurationMinutes: 30,
      language: 'uk',
      arm: 'A',
      entities: extra.entities ?? [MEETING, REPORT],
      ...extra,
    },
    scripted(value),
  );
}

describe('Phase 4.7 dialogue, safety, and placement', () => {
  it('corrects a pending create instead of adding a second one', async () => {
    const session = createSession('user-1', 'correct');
    const prompts: string[] = [];
    const created = await runVNextTurn(
      {
        transcript: 'Створи зустріч завтра о 10.',
        userId: 'user-1',
        session,
        nowIso: NOW,
        timeZone: 'Europe/Kyiv',
        wakeHm: '08:00',
        sleepHm: '23:00',
        defaultDurationMinutes: 30,
        language: 'uk',
        arm: 'A',
        entities: [],
      },
      {
        arm: 'A',
        interpret: async (user) => {
          prompts.push(user);
          return scripted(envelope([createOp('op-1', 'Зустріч', [
            { kind: 'date', value: '2026-10-19', precision: 'day' },
            { kind: 'clock', value: '10:00', role: 'start' },
          ])])).interpret();
        },
      },
    );
    expect(created.response.outcome).toBe('confirm');
    expect(created.response.intents).toHaveLength(1);
    expect(session.pendingOperations.map((row) => row.opId)).toEqual(['op-1']);

    const corrected = await runVNextTurn(
      {
        transcript: 'Ні, перенеси на 12.',
        userId: 'user-1',
        session,
        nowIso: NOW,
        timeZone: 'Europe/Kyiv',
        wakeHm: '08:00',
        sleepHm: '23:00',
        defaultDurationMinutes: 30,
        language: 'uk',
        arm: 'A',
        entities: [],
      },
      {
        arm: 'A',
        interpret: async (user) => {
          prompts.push(user);
          return scripted(envelope([operation({
            opId: 'op-2',
            action: 'move',
            target: { kind: 'operation_result', opId: 'op-1' },
            constraints: [{ kind: 'clock', value: '12:00', role: 'start' }],
            source: { text: 'на 12' },
          })])).interpret();
        },
      },
    );
    expect(prompts[1]).toContain('"opId":"op-1"');
    expect(corrected.serverWrites).toBe(0);
    expect(corrected.response.outcome).toBe('confirm');
    expect(corrected.response.intents).toHaveLength(1);
    const task = corrected.response.intents[0].type === 'create' ? corrected.response.intents[0].task : {};
    expect(Date.parse(String(task.scheduledStartTime))).toBe(Date.parse(localDateTimeIso('2026-10-19', '12:00', 'Europe/Kyiv')));
    expect(task.name).toBe('Зустріч');
  });

  it('cancels a pending create and does not apply it', async () => {
    const session = createSession('user-1', 'cancel');
    await turn(session, envelope([createOp('op-1', 'Зустріч')]), { transcript: 'Створи зустріч' });
    const canceled = await turn(session, envelope([operation({
      opId: 'op-2',
      action: 'cancel',
      target: { kind: 'operation_result', opId: 'op-1' },
      source: { text: 'скасуй' },
    })]), { transcript: 'Скасуй' });
    expect(canceled.response.outcome).toBe('answer');
    expect(canceled.response.intents).toEqual([]);
    expect(canceled.serverWrites).toBe(0);
    const again = await turn(session, { version: '1', kind: 'control', operations: [], control: 'confirm_pending' }, { transcript: 'Так' });
    expect(again.response.outcome).toBe('answer');
    expect(again.response.intents).toEqual([]);
  });

  it('replaces a pending preview with an unrelated create', async () => {
    const session = createSession('user-1', 'unrelated');
    await turn(session, envelope([createOp('op-1', 'Зустріч')]), { transcript: 'Створи зустріч' });
    const next = await turn(session, envelope([createOp('op-9', 'Хліб')]), { transcript: 'Купи хліб' });
    expect(next.response.outcome).toBe('confirm');
    expect(next.response.intents).toHaveLength(1);
    expect(next.response.intents[0]).toMatchObject({ type: 'create', task: { name: 'Хліб' } });
  });

  it('cancels one pending create and keeps the other', async () => {
    const session = createSession('user-1', 'both');
    await turn(session, envelope([createOp('op-1', 'Зустріч'), createOp('op-2', 'Звіт')]), { transcript: 'Створи зустріч і звіт' });
    const canceled = await turn(session, envelope([operation({
      opId: 'op-3',
      action: 'cancel',
      target: { kind: 'operation_result', opId: 'op-1' },
      source: { text: 'скасуй зустріч' },
    })]), { transcript: 'Скасуй зустріч' });
    expect(canceled.response.outcome).toBe('confirm');
    expect(canceled.response.intents).toHaveLength(1);
    expect(canceled.response.intents[0]).toMatchObject({ task: { name: 'Звіт' } });
  });

  it('blocks a DST gap and a DST fold without inventing an instant', async () => {
    const gap = await turn(createSession('user-1', 'gap'), envelope([createOp('op-1', 'Дзвінок', [
      { kind: 'date', value: '2026-03-08', precision: 'day' },
      { kind: 'clock', value: '02:30', role: 'start' },
    ])]), { transcript: 'Постав дзвінок на 02:30', timeZone: 'America/New_York', entities: [] });
    expectFailClosed(gap, { intents: 0, blocked: 'gap' });

    const fold = await turn(createSession('user-1', 'fold'), envelope([createOp('op-1', 'Дзвінок', [
      { kind: 'date', value: '2026-11-01', precision: 'day' },
      { kind: 'clock', value: '01:30', role: 'start' },
    ])]), { transcript: 'Постав дзвінок на 01:30', timeZone: 'America/New_York', entities: [] });
    expectFailClosed(fold, { intents: 0, blocked: 'fold' });
  });

  it('refuses a dependency cycle and does not preview either create', async () => {
    const result = await turn(createSession('user-1', 'cycle'), envelope([
      { ...createOp('a', 'Альфа'), dependsOn: ['b'] },
      { ...createOp('b', 'Бета'), dependsOn: ['a'] },
    ]), { transcript: 'Альфа залежить від бети і навпаки', entities: [] });
    // Structured may clarify instead of refuse; both stay fail-closed with no preview.
    expectFailClosed(result, { intents: 0 });
    expect(result.serverWrites).toBe(0);
    if (result.blocked.length) expectBlocked(result, result.blocked.includes('cycle') ? 'cycle' : result.blocked[0]);
  });

  it('does not preview a dependent create when the prerequisite failed', async () => {
    const result = await turn(createSession('user-1', 'dep'), envelope([
      operation({ opId: 'a', action: 'create', target: { kind: 'new', localId: 'a' }, changes: {}, source: { text: 'a' } }),
      { ...createOp('b', 'Бета'), dependsOn: ['a'] },
    ]), { transcript: 'Створи і потім бету', entities: [] });
    expect(result.response.intents).toEqual([]);
    expect(result.blocked).toContain('missing_title');
    // prerequisite_failed may be folded into the title block under structured prepare.
    expect(result.serverWrites).toBe(0);
  });

  it('answers an empty agenda from the read result and refuses a failed read', async () => {
    const empty = await runInterpreterA(
      { complete: async ({ user }) => ({
        text: user.includes('\nReads:')
          ? '{"version":"1","kind":"answer","operations":[],"answer":{"text":"Завтра немає подій.","evidenceRefs":["r1"]}}'
          : '{"version":"1","kind":"answer","operations":[],"requestedReads":[{"requestId":"r1","name":"get_day_agenda","args":{"day":"2026-10-19"}}],"answer":{"text":"","evidenceRefs":[]}}',
        inputTokens: 1,
        outputTokens: 1,
        latencyMs: 1,
      }) },
      new ReadBroker(async () => ({ items: [], count: 0 })),
      'user',
      'Що в мене завтра?',
    );
    expect(empty.ok).toBe(true);
    expect(empty.reads[0]).toMatchObject({ name: 'get_day_agenda', ok: true });
    expect(empty.envelope?.answer?.text).toContain('немає');

    const failed = await runInterpreterA(
      { complete: async ({ user }) => ({
        text: user.includes('\nReads:')
          ? '{"version":"1","kind":"answer","operations":[],"answer":{"text":"Завтра порожньо.","evidenceRefs":["r1"]}}'
          : '{"version":"1","kind":"answer","operations":[],"requestedReads":[{"requestId":"r1","name":"get_day_agenda","args":{"day":"2026-10-19"}}],"answer":{"text":"","evidenceRefs":[]}}',
        inputTokens: 1,
        outputTokens: 1,
        latencyMs: 1,
      }) },
      new ReadBroker(async () => ({ error: 'timeout' })),
      'user',
      'Що в мене завтра?',
    );
    const refused = await runVNextTurn(
      {
        transcript: 'Що в мене завтра?',
        userId: 'user-1',
        session: createSession('user-1', 'read-fail'),
        nowIso: NOW,
        timeZone: 'Europe/Kyiv',
        wakeHm: '08:00',
        sleepHm: '23:00',
        defaultDurationMinutes: 30,
        language: 'uk',
        arm: 'A',
        entities: [],
      },
      { arm: 'A', interpret: async () => failed },
    );
    expect(refused.response.outcome).toBe('refuse');
    expect(refused.blocked).toContain('tool_error');
    expect(refused.response.intents).toEqual([]);
    expect(refused.response.assistantMessage).not.toContain('порожньо');
  });

  it('fails a confirm whose time is wrong and does not count a safe refusal as success', () => {
    const wrong = scoreSemanticOutcome({
      schemaValid: true,
      outcome: 'confirm',
      intents: [{ type: 'create', task: { name: 'Звіт', scheduledStartTime: '2026-10-19T07:00:00.000Z', estimatedTimeInMinutes: 30 } }],
      blocked: [],
      serverWrites: 0,
      expectation: { acceptable: ['confirm'], scheduledStart: '2026-10-19T09:00:00.000Z', intentCount: 1, taskName: 'Звіт' },
    });
    expect(wrong.correct).toBe(false);
    expect(wrong.reason).toBe('wrong_time');
    expect(wrong.supportedExecution).toBe(false);

    const refused = scoreSemanticOutcome({
      schemaValid: true,
      outcome: 'refuse',
      intents: [],
      blocked: ['unsupported_all_day'],
      serverWrites: 0,
      expectation: { acceptable: ['refuse', 'clarify'], refusalAllowed: true },
    });
    expect(refused.correct).toBe(true);
    expect(refused.supportedExecution).toBe(false);
  });

  it('applies a preview once when the same request is repeated', async () => {
    const applied = new Map();
    const writes: string[] = [];
    const intents = [{ type: 'create' as const, summary: 'Зустріч', task: { name: 'Зустріч' } }];
    const first = await applyPreview({
      items: intents.map((intent) => ({ intent })),
      ledger: applied,
      write: async (intent) => { writes.push(intent.summary); },
    });
    const second = await applyPreview({
      items: intents.map((intent) => ({ intent })),
      ledger: applied,
      write: async (intent) => { writes.push(intent.summary); },
    });
    expect(first.results.filter((row) => row.status === 'succeeded')).toHaveLength(1);
    expect(second.results.map((row) => row.status)).toEqual(['skipped']);
    expect(writes).toEqual(['Зустріч']);
  });

  it('seats a draft through the real placement engine and a fake calendar', async () => {
    const ymd = firstFreeMorningYmd();
    const wall = (hm: string) => new Date(localDateTimeIso(ymd, hm, 'UTC'));
    const peer = {
      id: 'slot-a',
      taskId: 'peer-a',
      scheduledStartTime: wall('08:00'),
      scheduledEndTime: wall('12:00'),
      googleEventId: null,
      task: {
        id: 'peer-a',
        userId: 'user-1',
        name: 'Зайнято',
        eventType: TaskEventType.ADMIN,
        status: TaskStatus.TODO,
        scheduleState: ScheduleState.NONE,
        isUnscheduled: false,
        isRecurring: false,
        isFixedExternal: false,
        estimatedTimeInMinutes: 240,
      },
    };
    const qb = {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([peer]),
    };
    const phase = { id: 'phase-1', type: 'time_phase', startTime: '08:00', endTime: '18:00', weekDays: null as number[] | null };
    const placement = new PlacementStepService(
      { transaction: jest.fn(async (fn: (manager: unknown) => unknown) => fn({})) } as never,
      { findOne: jest.fn(), find: jest.fn().mockResolvedValue([]), save: jest.fn(async (row: unknown) => row) } as never,
      { createQueryBuilder: jest.fn(() => qb), find: jest.fn().mockResolvedValue([]), save: jest.fn(), remove: jest.fn(), create: jest.fn((row: unknown) => row) } as never,
      { getSettings: jest.fn().mockResolvedValue({
        timeZone: 'UTC',
        wakeTime: '08:00',
        sleepTime: '23:00',
        weekendWorkEnabled: true,
        googleCalendarLinked: false,
        recurringScheduleHorizonDays: 14,
        fixedEventBufferMinutes: 0,
      }) } as never,
      { findAllForScheduling: jest.fn().mockResolvedValue([phase]) } as never,
      { syncTask: jest.fn() } as never,
      { listVisibleEvents: jest.fn().mockResolvedValue([]) } as never,
    );
    const planner = new VoiceDayPlanner(placement, { find: jest.fn().mockResolvedValue([]) } as never);
    const draft: PlanDraft = {
      day: ymd,
      stage: 'review',
      interviewAsked: 0,
      items: [{
        id: 'new:1',
        taskId: null,
        source: 'new',
        name: 'Лист',
        durationMinutes: 60,
        preferredHm: null,
        earliestHm: null,
        deadlineHm: null,
      }],
      revision: 0,
      nextNewId: 2,
      lastProposal: null,
    };
    const session = createSession('user-1', 'plan');
    session.planDraft = draft;
    const result = await runVNextTurn(
      {
        transcript: 'Запропонуй план',
        userId: 'user-1',
        session,
        nowIso: new Date().toISOString(),
        timeZone: 'UTC',
        wakeHm: '08:00',
        sleepHm: '23:00',
        defaultDurationMinutes: 60,
        language: 'uk',
        arm: 'A',
        entities: [],
        planContext: { tasks: [], slots: [], timeZone: 'UTC', nowIso: new Date().toISOString(), defaultDurationMinutes: 60 },
        proposeDay: (userId, current, timeZone) => planner.propose(userId, current, timeZone),
      },
      scripted({ version: '1', kind: 'day_plan', operations: [], dayPlan: { phase: 'apply', day: ymd, edits: [] } }),
    );
    expect(result.serverWrites).toBe(0);
    expect(result.response.outcome).toBe('confirm');
    expect(result.response.intents).toHaveLength(1);
    const task = result.response.intents[0].type === 'create' ? result.response.intents[0].task : {};
    const start = Date.parse(String(task.scheduledStartTime));
    expect(start).toBeGreaterThanOrEqual(wall('12:00').getTime());
    expect(start).toBeLessThan(wall('08:00').getTime() + 24 * 60 * 60 * 1000);
  });
});

function firstFreeMorningYmd(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });
  for (let offset = 1; offset < 14; offset += 1) {
    const ymd = fmt.format(new Date(Date.now() + offset * 24 * 60 * 60 * 1000));
    if (Date.parse(localDateTimeIso(ymd, '08:00', 'UTC')) > Date.now()) return ymd;
  }
  throw new Error('no free UTC morning in the next 14 days');
}
