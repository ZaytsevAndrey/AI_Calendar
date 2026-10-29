import { readFileSync } from 'fs';
import { join } from 'path';
import type { SemanticEnvelopeV1 } from './contracts/types';
import { scoreSemanticOutcome } from './eval/semantic-outcome';
import { expectationForEdge } from './eval/complete-gold';
import { EDGE_CASES } from './eval/edge-cases';
import { runVNextTurn } from './pipeline';
import { resolveTarget, type EntityRecord } from './reference/reference-resolver';
import { createSession } from './session/session';
import { resolveConstraints } from './temporal/temporal-resolver';

const NOW = '2026-10-18T06:00:00.000Z';
const USER = 'user-1';
const FAILED = [
  'edge-pronoun-clear', 'edge-qualitative-evening', 'edge-confirm-none', 'edge-morphology', 'edge-repeated-correction',
  'edge-recurring-reminder', 'edge-external-readonly', 'edge-stale-id', 'edge-settings-duration', 'edge-dayplan-evening',
  'edge-sunday-conference', 'edge-dst-fold-dated', 'edge-multilingual', 'edge-pronoun-ambiguous', 'edge-event-span',
  'edge-window-span', 'edge-dst-gap', 'edge-dst-fold', 'edge-two-reports', 'edge-week-only', 'edge-cross-user',
];

function entity(id: string, name: string, extra: Partial<EntityRecord> = {}): EntityRecord {
  return { id, userId: USER, type: 'task', name, status: 'open', ...extra };
}

describe('Phase 4.7.5 product contract', () => {
  it('previews one inflected or translated candidate and rejects a guessed id', () => {
    const report = entity('task-a', 'Звіт');
    const finance = entity('task-b', 'Фінансовий звіт');
    const other = entity('task-c', 'Нарада');
    expect(resolveTarget({ target: { kind: 'existing', description: 'звіту' }, userId: USER, entities: [report, other], referents: {}, write: true }).status).toBe('resolved');
    expect(resolveTarget({ target: { kind: 'existing', description: 'звіт' }, userId: USER, entities: [finance], referents: {}, write: true })).toMatchObject({ status: 'resolved', entityId: 'task-b' });
    expect(resolveTarget({ target: { kind: 'existing', description: 'звіт' }, userId: USER, entities: [report, finance], referents: {}, write: true }).status).toBe('ambiguous');
    expect(resolveTarget({ target: { kind: 'existing', description: 'the report', proposedId: 'task-c' }, userId: USER, entities: [report, other], referents: {}, write: true })).toMatchObject({ entityId: 'task-a' });
    expect(resolveTarget({ target: { kind: 'existing', description: 'звіт' }, userId: USER, entities: [other], referents: {}, write: true }).status).toBe('unresolved');
    expect(resolveTarget({ target: { kind: 'existing', proposedId: 'missing' }, userId: USER, entities: [report], referents: {}, write: true })).toMatchObject({ status: 'rejected', reason: 'forged' });
    expect(resolveTarget({ target: { kind: 'existing', proposedId: 'foreign' }, userId: USER, entities: [{ ...report, id: 'foreign', userId: 'user-2' }], referents: {}, write: true })).toMatchObject({ reason: 'cross_user' });
    expect(resolveTarget({ target: { kind: 'existing', description: 'звіт', proposedId: 'task-a' }, userId: USER, entities: [report, finance], referents: {}, write: true }).status).toBe('ambiguous');
    expect(resolveTarget({ target: { kind: 'existing', proposedId: 'task-a' }, userId: USER, entities: [{ ...report, status: 'completed' }], referents: {}, write: true })).toMatchObject({ reason: 'ineligible' });
    expect(resolveTarget({ target: { kind: 'existing', proposedId: 'task-a', calendarId: 'work' }, userId: USER, entities: [report], referents: {}, write: true })).toMatchObject({ reason: 'wrong_calendar' });
    expect(resolveTarget({ target: { kind: 'existing', description: 'наради' }, userId: USER, entities: [other], referents: {}, write: true })).toMatchObject({ status: 'resolved', entityId: 'task-c' });
  });

  it('allows a writable external event and rejects a read-only one', () => {
    const flight = entity('ext', 'політ', { type: 'external_event', writable: true });
    const locked = entity('ext-2', 'політ', { type: 'external_event' });
    expect(resolveTarget({ target: { kind: 'existing', description: 'політ' }, userId: USER, entities: [flight], referents: {}, write: true })).toMatchObject({ status: 'resolved', entityId: 'ext' });
    expect(resolveTarget({ target: { kind: 'existing', description: 'політ' }, userId: USER, entities: [locked], referents: {}, write: true })).toMatchObject({ reason: 'external_readonly' });
  });

  it('rolls a past clock on today-Sunday to next Sunday and keeps an explicit past date', () => {
    const clock = { nowIso: NOW, timeZone: 'Europe/Kyiv', wakeHm: '08:00', sleepHm: '23:00' };
    const today = resolveConstraints([
      { kind: 'weekday', weekday: 0, which: 'this' },
      { kind: 'clock', value: '07:00', role: 'start' },
    ], clock);
    expect(today.some((row) => row.status === 'instant' && String(row.status === 'instant' && row.iso).includes('2026-10-25'))).toBe(true);
    const dated = resolveConstraints([
      { kind: 'date', value: '2026-10-17', precision: 'day' },
      { kind: 'clock', value: '07:00', role: 'start' },
    ], clock);
    expect(dated.some((row) => row.status === 'instant' && String(row.status === 'instant' && row.iso).includes('2026-10-17'))).toBe(true);
  });

  it('checks a default-derived reminder clock for a DST gap and an explicit one for a fold', async () => {
    const session = createSession(USER, 'dst-reminder');
    const gap = await runVNextTurn({
      transcript: 'Нагадай',
      userId: USER,
      session,
      nowIso: '2026-03-08T06:00:00.000Z',
      timeZone: 'America/New_York',
      wakeHm: '08:00',
      sleepHm: '23:00',
      defaultDurationMinutes: 30,
      defaultReminderTime: '02:30',
      language: 'en',
      arm: 'A',
      entities: [],
    }, { arm: 'A', interpret: async () => ({ ok: true, envelope: { version: '1', kind: 'operations', operations: [{ opId: 'op-1', action: 'remind', target: { kind: 'new', localId: 'r' }, changes: { reminder: { op: 'create', name: 'дзвінок', dueYmd: '2026-03-08' } }, constraints: [], dependsOn: [], source: { text: 'Нагадай' } }] }, reads: [], usage: { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 }, specialist: null, promptHash: 'phase475' }) });
    expect(gap.blocked).toContain('gap');
    expect(gap.response.intents).toEqual([]);
    const fold = await runVNextTurn({
      transcript: 'Нагадай',
      userId: USER,
      session: createSession(USER, 'fold'),
      nowIso: '2026-11-01T05:00:00.000Z',
      timeZone: 'America/New_York',
      wakeHm: '08:00',
      sleepHm: '23:00',
      defaultDurationMinutes: 30,
      defaultReminderTime: '09:00',
      language: 'en',
      arm: 'A',
      entities: [],
    }, { arm: 'A', interpret: async () => ({ ok: true, envelope: { version: '1', kind: 'operations', operations: [{ opId: 'op-1', action: 'remind', target: { kind: 'new', localId: 'r' }, changes: { reminder: { op: 'create', name: 'дзвінок', dueYmd: '2026-11-01', notificationTime: '01:30' } }, constraints: [], dependsOn: [], source: { text: 'Нагадай' } }] }, reads: [], usage: { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 }, specialist: null, promptHash: 'phase475' }) });
    expect(fold.blocked).toContain('fold');
  });

  it('rejects a vague clarification and accepts a specific one', () => {
    const vague = scoreSemanticOutcome({
      schemaValid: true, outcome: 'clarify', intents: [], blocked: [], serverWrites: 0, question: 'Please repeat that.',
      expectation: { acceptable: ['clarify'], intentCount: 0, blockedIncludes: 'past', questionIncludes: ['день'] },
    });
    expect(vague.correct).toBe(false);
    const asked = scoreSemanticOutcome({
      schemaValid: true, outcome: 'clarify', intents: [], blocked: [], serverWrites: 0, question: 'На який день?',
      expectation: { acceptable: ['clarify'], intentCount: 0, blockedIncludes: 'past', questionIncludes: ['день'] },
    });
    expect(asked.correct).toBe(true);
    expect(asked.supportedExecution).toBe(false);
  });

  it('replays the 21 stored DeepSeek envelopes through the updated pipeline', async () => {
    const file = join(__dirname, '../../../../../docs/voice-vnext/runs/phase474-deepseek/phase44-results.json');
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { rows: Array<{ id: string; envelope: SemanticEnvelopeV1 | null }> };
    const failures: string[] = [];
    for (const id of FAILED) {
      const edge = EDGE_CASES.find((item) => item.id === id);
      const row = saved.rows.find((item) => item.id === id);
      if (!edge || !row?.envelope) {
        failures.push(`${id}:missing`);
        continue;
      }
      const session = createSession(USER, id);
      Object.assign(session, edge.sessionPatch ?? {});
      const result = await runVNextTurn({
        transcript: edge.transcript,
        userId: USER,
        session,
        nowIso: edge.nowIso,
        timeZone: edge.timeZone,
        wakeHm: edge.wakeHm,
        sleepHm: edge.sleepHm,
        defaultDurationMinutes: edge.defaultDurationMinutes,
        defaultReminderTime: '09:00',
        language: edge.language,
        arm: 'A',
        entities: edge.entities,
      }, {
        arm: 'A',
        interpret: async () => ({ ok: true, envelope: row.envelope ?? undefined, reads: [], usage: { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 }, specialist: null, promptHash: 'replay' }),
      });
      const expectation = expectationForEdge(edge);
      const score = expectation ? scoreSemanticOutcome({
        schemaValid: true,
        outcome: result.response.outcome,
        intents: result.response.intents,
        blocked: result.blocked,
        serverWrites: result.serverWrites,
        preservedLabels: result.preservedLabels,
        question: result.response.assistantMessage,
        expectation,
      }) : null;
      const storedKind = row.envelope.kind;
      if (storedKind === 'clarification' && result.response.intents.length > 0) {
        failures.push(`${id}:fabricated`);
      }
      const kept = [
        'edge-confirm-none', 'edge-sunday-conference', 'edge-multilingual', 'edge-dst-fold-dated',
        'edge-pronoun-ambiguous', 'edge-event-span', 'edge-window-span', 'edge-dst-gap', 'edge-dst-fold',
        'edge-two-reports', 'edge-week-only', 'edge-cross-user', 'edge-stale-id',
      ];
      if (kept.includes(id) && !score?.correct) {
        failures.push(`${id}:${score?.reason ?? 'no-expectation'}:${result.response.outcome}:${result.blocked.join(',')}`);
      }
      expect(result.serverWrites).toBe(0);
    }
    expect(failures).toEqual([]);
  });
});
