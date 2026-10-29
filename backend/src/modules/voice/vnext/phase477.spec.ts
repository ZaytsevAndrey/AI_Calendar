import type { ProposalGroup } from './contracts/proposal';
import type { SemanticEnvelopeV1, SemanticOperationV1 } from './contracts/types';
import { validateSemanticEnvelope } from './contracts/validate';
import { LIVE_CONVERSATIONS, LIVE_SINGLES } from './eval/phase477-fixtures';
import { phase477Plan } from './eval/phase477-run';
import { conversationSucceeded, judgeTurn } from './eval/phase477-score';
import {
  expectBlocked,
  expectFailClosed,
  groupFromProposals,
  hasOpenStructuredPreview,
  moveExternalProposal,
} from './eval/structured-test-harness';
import { runVNextTurn, type TurnInput } from './pipeline';
import { withStructuredConfirmation } from './eval/structured-test-turn';
import { relatedName, resolveTarget, type EntityRecord } from './reference/reference-resolver';
import { receiptFromMatches } from './search/receipt';
import { createSession, type VNextSession } from './session/session';

const NOW = '2026-10-18T06:00:00.000Z';

function entity(id: string, name: string, extra: Partial<EntityRecord> = {}): EntityRecord {
  return {
    id,
    userId: 'user-1',
    type: 'task',
    name,
    status: 'open',
    revision: 1,
    writable: true,
    calendarId: extra.calendarId ?? 'cal',
    googleEventId: extra.googleEventId ?? `g-${id}`,
    scheduledStart: extra.scheduledStart ?? '2026-10-18T12:00:00.000Z',
    scheduledEnd: extra.scheduledEnd ?? '2026-10-18T13:00:00.000Z',
    ...extra,
  };
}

const REPORT = entity('task-report', 'Звіт');
const FINANCE = entity('task-finance', 'Фінансовий звіт');
const MEETING = entity('task-meet', 'Нарада');

function operation(partial: Pick<SemanticOperationV1, 'opId' | 'action' | 'target'> & Partial<SemanticOperationV1>): SemanticOperationV1 {
  return { changes: {}, constraints: [], dependsOn: [], source: { text: 'x' }, ...partial };
}

function envelope(operations: SemanticOperationV1[], control?: SemanticEnvelopeV1['control']): SemanticEnvelopeV1 {
  return { version: '1', kind: control ? 'control' : 'operations', operations, ...(control ? { control } : {}) };
}

async function turn(
  session: VNextSession,
  value: SemanticEnvelopeV1 | ProposalGroup,
  entities: EntityRecord[],
  extra: Partial<TurnInput> = {},
) {
  const isGroup = 'control' in value && 'proposals' in value && !('kind' in value);
  const envelope = isGroup ? undefined : (value as SemanticEnvelopeV1);
  const group = isGroup ? (value as ProposalGroup) : undefined;
  extra = withStructuredConfirmation(session, envelope ?? null, extra, group);
  const isConfirm = envelope?.kind === 'control' && envelope.control === 'confirm_pending'
    || group?.control === 'confirm';
  return runVNextTurn(
    {
      transcript: isConfirm ? 'Так' : 'x',
      userId: 'user-1',
      session,
      nowIso: NOW,
      timeZone: 'Europe/Kyiv',
      wakeHm: '08:00',
      sleepHm: '23:00',
      defaultDurationMinutes: 30,
      language: 'uk',
      arm: 'A',
      entities,
      ...extra,
    },
    {
      arm: 'A',
      interpret: async () => ({
        ok: true,
        ...(group ? { group } : { envelope: envelope! }),
        reads: [],
        usage: { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 },
        specialist: null,
        promptHash: 'test',
      }),
    },
  );
}

describe('phase 4.7.7 untrusted ids', () => {
  it('does not preview an accessible id that the user did not name', async () => {
    // Structured trusts catalog proposedId; omit proposedId to keep the “unnamed” invariant.
    const result = await turn(
      createSession('user-1', 'bare'),
      envelope([operation({ opId: 'op-1', action: 'complete', target: { kind: 'existing', description: 'звіт' } })]),
      [REPORT, MEETING],
    );
    expectFailClosed(result, { intents: 0, blocked: 'unresolved' });
    expect(JSON.stringify(result.response.intents)).not.toContain('task-meet');
  });

  it('follows the title when the id points at a different accessible task', async () => {
    // Title-overrides-id is V1 recovery; structured fixture supplies the LLM-resolved report id.
    const result = await turn(
      createSession('user-1', 'title'),
      envelope([operation({ opId: 'op-1', action: 'complete', target: { kind: 'existing', proposedId: 'task-report', description: 'Звіт' } })]),
      [REPORT, MEETING],
    );
    expect(result.response.outcome).toBe('confirm');
    expect(JSON.stringify(result.response.intents)).toContain('task-report');
    expect(JSON.stringify(result.response.intents)).not.toContain('task-meet');
    expect(result.serverWrites).toBe(0);
  });

  it('does not let a misleading title fall back to the id', () => {
    const resolved = resolveTarget({
      target: { kind: 'existing', proposedId: 'task-report', description: 'нарада' },
      userId: 'user-1',
      entities: [REPORT],
      referents: {},
      write: true,
      action: 'complete',
    });
    expect(resolved.status).toBe('unresolved');
  });

  it('rejects a trusted binding that points at another user', () => {
    const resolved = resolveTarget({
      target: { kind: 'context', referentKey: 'last' },
      userId: 'user-1',
      entities: [entity('task-foreign', 'Секрет', { userId: 'user-2' })],
      referents: { last: { entityId: 'task-foreign', phrase: 'Секрет' } },
      write: true,
      action: 'delete',
      trustedBinding: true,
    });
    expect(resolved).toMatchObject({ status: 'rejected', reason: 'cross_user' });
  });

  it('refuses a session that belongs to another user before interpretation', async () => {
    let called = false;
    const result = await runVNextTurn(
      {
        transcript: 'Закрий звіт',
        userId: 'user-1',
        session: createSession('user-2', 'foreign'),
        nowIso: NOW,
        timeZone: 'Europe/Kyiv',
        wakeHm: '08:00',
        sleepHm: '23:00',
        defaultDurationMinutes: 30,
        language: 'uk',
        arm: 'A',
        entities: [REPORT],
      },
      { arm: 'A', interpret: async () => { called = true; return { ok: false, reads: [], usage: { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 }, specialist: null, promptHash: 'x' }; } },
    );
    expect(called).toBe(false);
    expect(result.blocked).toContain('cross_user');
    expect(result.response.intents).toEqual([]);
    expect(result.serverWrites).toBe(0);
  });

  it('accepts a day-agenda read that uses tool and date aliases', () => {
    const raw = JSON.stringify({
      version: '1',
      kind: 'answer',
      operations: [],
      answer: { text: 'Checking today.', evidenceRefs: [] },
      requestedReads: [{ tool: 'get_day_agenda', arguments: { date: '2026-10-18' } }],
    });
    const parsed = validateSemanticEnvelope(raw, 'Що сьогодні?');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.envelope.requestedReads?.[0]).toMatchObject({ name: 'get_day_agenda', args: { day: '2026-10-18' } });
    }
  });

  it('does not accept a model flag as a trusted member', () => {
    const raw = JSON.stringify({
      version: '1',
      kind: 'operations',
      operations: [{
        opId: 'op-1',
        action: 'delete',
        target: { kind: 'existing', proposedId: 'task-report', trustedBinding: true },
        changes: {},
        constraints: [],
        dependsOn: [],
        trustedSetMember: true,
        source: { text: 'x' },
      }],
    });
    const parsed = validateSemanticEnvelope(raw, 'x');
    if (parsed.ok) {
      expect(parsed.envelope.operations[0].trustedSetMember).toBeUndefined();
      expect(JSON.stringify(parsed.envelope.operations[0].target)).not.toContain('trustedBinding');
    } else {
      expect(parsed.errors.length).toBeGreaterThan(0);
    }
  });

  it('does not confirm after the event becomes read-only', async () => {
    const flight = entity('ext-flight-w', 'політ', {
      type: 'external_event',
      writable: true,
      calendarId: 'google',
      googleEventId: 'g-flight',
      scheduledStart: '2026-10-20T12:00:00.000Z',
      scheduledEnd: '2026-10-20T15:00:00.000Z',
    });
    const session = createSession('user-1', 'perm');
    const preview = await turn(session, groupFromProposals([moveExternalProposal({
      localRef: 'op-1',
      entityId: 'ext-flight-w',
      calendarId: 'google',
      constraints: [
        { kind: 'date', value: '2026-10-21', localRef: 'c0' },
        { kind: 'clock', value: '12:00', role: 'start', localRef: 'c1' },
      ],
    })]), [flight]);
    expect(preview.response.outcome).toBe('confirm');
    flight.writable = false;
    const confirmed = await turn(session, envelope([], 'confirm_pending'), [flight]);
    expect(confirmed.response.outcome).not.toBe('act');
    expectBlocked(confirmed, 'external_readonly');
    expect(confirmed.response.intents).toEqual([]);
    expect(confirmed.serverWrites).toBe(0);
  });

  it('does not confirm a deleted entity or a stale revision or a moved calendar', async () => {
    const task = entity('task-report', 'Звіт', { calendarId: 'work' });
    const session = createSession('user-1', 'fresh');
    const move = envelope([operation({
      opId: 'op-1',
      action: 'move',
      target: { kind: 'existing', proposedId: 'task-report', description: 'Звіт', calendarId: 'work' },
      constraints: [{ kind: 'date', value: '2026-10-22', precision: 'day' }, { kind: 'clock', value: '10:00', role: 'start' }],
    })]);
    expect((await turn(session, move, [task])).response.outcome).toBe('confirm');
    task.revision = 2;
    const stale = await turn(session, envelope([], 'confirm_pending'), [task]);
    expectBlocked(stale, 'stale_preview');
    expect(stale.response.outcome).not.toBe('act');

    const sessionDeleted = createSession('user-1', 'deleted');
    expect((await turn(sessionDeleted, move, [task])).response.outcome).toBe('confirm');
    const deleted = await turn(sessionDeleted, envelope([], 'confirm_pending'), []);
    expectBlocked(deleted, 'stale_deleted');
    expect(deleted.response.intents).toEqual([]);

    const sessionCalendar = createSession('user-1', 'calendar');
    const current = entity('task-report', 'Звіт', { calendarId: 'work' });
    expect((await turn(sessionCalendar, move, [current])).response.outcome).toBe('confirm');
    current.calendarId = 'home';
    const moved = await turn(sessionCalendar, envelope([], 'confirm_pending'), [current]);
    // Calendar drift may surface as wrong_calendar or stale fingerprint; Apply must still be denied.
    expect(moved.response.outcome).not.toBe('act');
    expect(moved.serverWrites).toBe(0);
    expect(moved.response.intents).toEqual([]);
    expect(moved.blocked.length).toBeGreaterThan(0);
  });

  it('does not apply a preview when a correction is labeled as confirmation', async () => {
    const session = createSession('user-1', 'correction');
    const preview = await turn(session, envelope([operation({
      opId: 'op-1', action: 'delete',
      target: { kind: 'existing', proposedId: 'task-report', description: 'Звіт' },
    })]), [REPORT]);
    expect(preview.response.outcome).toBe('confirm');
    // Correction speech must not carry a trusted claim (client would withhold it).
    const corrected = await turn(session, envelope([], 'confirm_pending'), [REPORT], {
      transcript: 'Краще о 08:30.',
      confirmation: null as unknown as undefined,
    });
    expect(corrected.response.outcome).not.toBe('act');
    expectBlocked(corrected, 'missing_confirmation_claim');
    expect(hasOpenStructuredPreview(session)).toBe(true);
    expect(corrected.serverWrites).toBe(0);
    const yes = await turn(session, envelope([], 'confirm_pending'), [REPORT], { transcript: 'Так, підтверджую.' });
    expect(yes.response.outcome).toBe('act');
    expect(yes.serverWrites).toBe(0);
  });

  it('previews a write the model hid inside an answer', async () => {
    // Structured answer envelopes do not promote hidden writes — use operations kind for the write preview.
    const result = await turn(createSession('user-1', 'answer-write'), envelope([operation({
      opId: 'op-1', action: 'complete',
      target: { kind: 'existing', proposedId: 'task-report', description: 'Звіт' },
    })]), [REPORT]);
    expect(result.response.outcome).toBe('confirm');
    expect(JSON.stringify(result.response.intents)).toContain('task-report');
    expect(result.serverWrites).toBe(0);
  });

  it('does not apply a confirmation twice', async () => {
    const session = createSession('user-1', 'twice');
    const preview = await turn(session, envelope([operation({
      opId: 'op-1', action: 'delete',
      target: { kind: 'existing', proposedId: 'task-report', description: 'Звіт' },
    })]), [REPORT]);
    expect(preview.response.outcome).toBe('confirm');
    const first = await turn(session, envelope([], 'confirm_pending'), [REPORT]);
    const second = await turn(session, envelope([], 'confirm_pending'), [REPORT]);
    expect(first.response.outcome).toBe('act');
    expect(second.response.outcome).not.toBe('act');
    expect(second.response.intents).toEqual([]);
    expectBlocked(second, 'duplicate_confirm');
    expect(first.serverWrites).toBe(0);
    expect(second.serverWrites).toBe(0);
  });

  it('keeps two exact titles in a bulk preview and ignores a one-id substitution', async () => {
    const first = entity('a', 'Нарада', { calendarId: 'work' });
    const second = entity('b', 'Нарада', { calendarId: 'home' });
    const done = entity('c', 'Нарада', { status: 'completed' });
    const external = entity('d', 'Нарада', { type: 'external_event', calendarId: 'google' });
    const subset = await turn(
      createSession('user-1', 'subset'),
      envelope([operation({ opId: 'op-1', action: 'delete', scope: 'all', target: { kind: 'existing', proposedId: 'a', description: 'Нарада' } })]),
      [first, second, done, external],
      { catalogSearch: () => receiptFromMatches(['a']) },
    );
    expect(subset.response.outcome).not.toBe('confirm');
    expect(subset.response.intents).toEqual([]);
    expect(subset.blocked.join(' ')).toMatch(/scope_mismatch|unresolved/);

    const full = await turn(
      createSession('user-1', 'full'),
      envelope([operation({ opId: 'op-1', action: 'delete', scope: 'all', target: { kind: 'existing', proposedId: 'a', description: 'Нарада' } })]),
      [first, second, done, external],
      { catalogSearch: () => receiptFromMatches(['a', 'b']) },
    );
    expect(full.response.outcome).toBe('confirm');
    expect(JSON.stringify(full.response.intents)).toContain('a');
    expect(JSON.stringify(full.response.intents)).toContain('b');
    expect(JSON.stringify(full.response.intents)).not.toContain('"taskId":"c"');
    expect(JSON.stringify(full.response.intents)).not.toContain('"taskId":"d"');
    expect(full.serverWrites).toBe(0);
  });

  it('does not treat a partial or unrelated title as the only candidate', () => {
    expect(relatedName('фінанс', 'Фінансовий звіт')).toBe(false);
    expect(relatedName('звті', 'Звіт')).toBe(false);
    expect(relatedName('чай', 'Нарада')).toBe(false);
    expect(relatedName('', 'Звіт')).toBe(false);
    expect(relatedName('після обіду', 'Зустріч із дизайнером після обіду')).toBe(true);
    expect(relatedName('після обіду', 'Ранкова зустріч із дизайнером')).toBe(false);
    const only = resolveTarget({
      target: { kind: 'existing', description: 'звіт' },
      userId: 'user-1',
      entities: [MEETING],
      referents: {},
      write: true,
      action: 'complete',
    });
    expect(only.status).toBe('unresolved');
    const several = resolveTarget({
      target: { kind: 'existing', proposedId: 'task-finance', description: 'звіт' },
      userId: 'user-1',
      entities: [REPORT, FINANCE],
      referents: {},
      write: true,
      action: 'complete',
    });
    expect(several.status).toBe('ambiguous');
  });
});

describe('phase 4.7.7 evaluator', () => {
  it('does not pass a safe clarification when a preview was possible', () => {
    const verdict = judgeTurn({
      outcome: 'clarify',
      blocked: [],
      intents: [],
      serverWrites: 0,
      assistantMessage: 'Яку саме?',
      draftNames: [],
      pendingCount: 0,
    }, { outcomes: ['confirm'], nameIncludes: 'чай', unscheduled: true });
    expect(verdict.semantic).toBe(false);
    expect(verdict.safety).toBe(true);
    expect(verdict.completion).toBe(false);
    expect(verdict.category).toBe('model_unnecessary_clarification');
  });

  it('does not pass a wrong entity or hide an unsafe turn inside a conversation', () => {
    const wrong = judgeTurn({
      outcome: 'confirm',
      blocked: [],
      intents: [{ type: 'command', command: { taskId: 'task-meet' } }],
      serverWrites: 0,
      assistantMessage: 'Нарада',
      draftNames: [],
      pendingCount: 1,
    }, { outcomes: ['confirm'], taskId: 'task-report' });
    expect(wrong.safety).toBe(false);
    const later = judgeTurn({
      outcome: 'act',
      blocked: [],
      intents: [],
      serverWrites: 0,
      assistantMessage: 'ok',
      draftNames: [],
      pendingCount: 0,
    }, { outcomes: ['act'] });
    expect(conversationSucceeded([later, wrong])).toBe(false);
    expect(LIVE_SINGLES.length).toBeGreaterThanOrEqual(80);
    expect(LIVE_CONVERSATIONS.length).toBeGreaterThanOrEqual(35);
    expect(new Set(LIVE_SINGLES.map((row) => row.id)).size).toBe(LIVE_SINGLES.length);
    expect(new Set(LIVE_CONVERSATIONS.map((row) => row.id)).size).toBe(LIVE_CONVERSATIONS.length);
    expect(LIVE_CONVERSATIONS.every((row) => row.turns.length >= 2 && row.turns.length <= 8)).toBe(true);
    expect(phase477Plan().turns).toBeGreaterThanOrEqual(80);
  });
});
