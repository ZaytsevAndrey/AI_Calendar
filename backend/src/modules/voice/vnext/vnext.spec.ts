import { readFileSync } from 'fs';
import { join } from 'path';
import { validateSemanticEnvelope } from './contracts/validate';
import { resolveZonedClock } from './temporal/resolve-clock';
import { specialistReason } from './interpreters/complexity';
import { buildTurnUser, INTERPRETER_A_SYSTEM, INTERPRETER_B_SYSTEM, PROMPT_A_HASH } from './interpreters/prompts';
import { deepseekFlashIsPeak, deepseekFlashUsd } from './llm/pricing';
import { runInterpreterA, runInterpreterB } from './interpreters/run-interpreter';
import { ReadBroker } from './broker/read-broker';
import { parseWithOneRepair, repairUser } from './repair/repair';
import { EDGE_CASES } from './eval/edge-cases';
import { originalIdHash, originalSemanticAnnotations, ORIGINAL_ID_HASH } from './eval/catalog';
import { pairedReport, scoreCase, tally, type Verdict } from './eval/rubric';
import { scoreEdge } from './eval/run-edge';
import { runLiveComparison } from './eval/live-run';
import type { SemanticOperationV1 } from './contracts/types';

describe('voice vNext', () => {
  it('keeps the original 77 ids unchanged and does not treat them as a semantic oracle', () => {
    const notes = originalSemanticAnnotations();
    expect(notes).toHaveLength(77);
    expect(originalIdHash()).toBe(ORIGINAL_ID_HASH);
    expect(notes.every((note) => note.useAsSemanticOracle === false)).toBe(true);
    expect(notes.filter((note) => note.adjudication === 'pending-human').length).toBeGreaterThan(0);
  });

  it('registers at least 30 authored edge cases and scores them', async () => {
    expect(EDGE_CASES.length).toBeGreaterThanOrEqual(30);
    const ids = EDGE_CASES.map((edge) => edge.id);
    expect(new Set(ids).size).toBe(ids.length);
    const verdicts: Verdict[] = [];
    for (const edge of EDGE_CASES) {
      const verdict = await scoreEdge(edge);
      verdicts.push(verdict);
      expect({ id: edge.id, verdict }).toEqual({ id: edge.id, verdict: 'pass' });
    }
    const counts = tally(verdicts);
    expect(counts.fail).toBe(0);
    expect(counts.pass).toBe(EDGE_CASES.length);
  });

  it('does not count review as pass', () => {
    expect(scoreCase({ adjudication: 'pending-human', outcome: 'confirm', serverWrites: 0 }, {
      outcome: 'confirm',
      serverWrites: 0,
      body: '',
      intentCount: 0,
      heldCount: 0,
      preservedLabels: [],
      blocked: [],
    })).toBe('review');
    const report = pairedReport([
      { caseId: 'sample', legacy: 'blocked', A: 'review', B: 'pass' },
    ]);
    expect(report.reviewCountedAsPass).toBe(false);
    expect(report.counts.A.pass).toBe(0);
    expect(report.counts.A.review).toBe(1);
    expect(report.counts.legacy.blocked).toBe(1);
  });

  it('rejects unknown actions, forged dates, and one failed repair', async () => {
    const bad = validateSemanticEnvelope('{"version":"1","kind":"operations","operations":[{"opId":"op-1","action":"habit_create","target":{"kind":"new","localId":"x"},"changes":{},"constraints":[],"dependsOn":[],"source":{"text":"Відміть звичку розтяжку"}}]}', 'Відміть звичку розтяжку');
    expect(bad.ok).toBe(false);
    const date = validateSemanticEnvelope('{"version":"1","kind":"operations","operations":[{"opId":"op-1","action":"create","target":{"kind":"new","localId":"x"},"changes":{"title":"день"},"constraints":[{"kind":"date","value":"2026-02-31","precision":"day"}],"dependsOn":[],"source":{"text":"2026-02-31"}}]}', 'Постав на 2026-02-31');
    expect(date.ok).toBe(false);
    if (!date.ok) expect(date.errors.some((error) => error.code === 'invalid_date')).toBe(true);
    const repaired = await parseWithOneRepair(
      { complete: async () => ({ text: 'not-json', inputTokens: 1, outputTokens: 1, latencyMs: 1 }) },
      'system',
      'user',
      'transcript',
    );
    expect(repaired.result.ok).toBe(false);
    expect(repaired.usage.calls).toBe(2);
    expect(repairUser([{ code: 'invalid_json', path: '', detail: 'bad' }], 'not-json')).not.toContain('sk-');
  });

  it('resolves a DST gap and fold without picking an instant', () => {
    expect(resolveZonedClock('2026-03-08', '02:30', 'America/New_York').status).toBe('gap');
    expect(resolveZonedClock('2026-11-01', '01:30', 'America/New_York').status).toBe('fold');
  });

  it('routes a specialist only from the envelope', () => {
    const operation = {
      opId: 'op-1',
      action: 'create',
      target: { kind: 'new', localId: 'local-1' },
      changes: {},
      constraints: [
        { kind: 'clock', value: '07:00', role: 'start' },
        { kind: 'clock', value: '09:00', role: 'end' },
      ],
      dependsOn: [],
      source: { text: 'span' },
    } as SemanticOperationV1;
    expect(specialistReason(operation)).toBe('event_window_ambiguity');
    expect(specialistReason({ ...operation, changes: { spanRole: 'event' } })).toBeNull();
    expect(INTERPRETER_A_SYSTEM).not.toMatch(/[А-Яа-яІіЇїЄєҐґ]/);
    expect(INTERPRETER_B_SYSTEM).not.toMatch(/[А-Яа-яІіЇїЄєҐґ]/);
    expect(PROMPT_A_HASH).toHaveLength(64);
  });

  it('runs interpreter A without a write and interpreter B with a specialist', async () => {
    const transcript = 'Create a report';
    const valid = JSON.stringify({
      version: '1',
      kind: 'operations',
      operations: [{
        opId: 'op-1',
        action: 'create',
        target: { kind: 'new', localId: 'local-report' },
        changes: { title: 'report' },
        constraints: [],
        dependsOn: [],
        source: { text: transcript },
      }],
    });
    const ambiguous = JSON.stringify({
      version: '1',
      kind: 'operations',
      operations: [{
        opId: 'op-1',
        action: 'create',
        target: { kind: 'new', localId: 'local-meet' },
        changes: { title: 'meeting' },
        constraints: [
          { kind: 'clock', value: '07:00', role: 'start' },
          { kind: 'clock', value: '09:00', role: 'end' },
        ],
        dependsOn: [],
        source: { text: 'Create a report' },
      }],
    });
    const filled = JSON.stringify({
      version: '1',
      kind: 'operations',
      operations: [{
        opId: 'op-1',
        action: 'create',
        target: { kind: 'new', localId: 'local-meet' },
        changes: { title: 'meeting', spanRole: 'event' },
        constraints: [
          { kind: 'clock', value: '07:00', role: 'start' },
          { kind: 'clock', value: '09:00', role: 'end' },
        ],
        dependsOn: [],
        source: { text: 'Create a report' },
      }],
    });
    let calls = 0;
    const llm = {
      complete: async () => {
        calls += 1;
        return { text: calls === 1 ? ambiguous : filled, inputTokens: 3, outputTokens: 4, latencyMs: 5 };
      },
    };
    const broker = new ReadBroker(async () => ({ error: 'timeout' }));
    const armB = await runInterpreterB(llm, broker, 'user', 'Create a report');
    expect(armB.ok).toBe(true);
    expect(armB.specialist).toBe('event_window_ambiguity');
    expect(armB.envelope?.operations[0].changes.spanRole).toBe('event');
    expect(armB.usage.calls).toBe(2);
    const armA = await runInterpreterA(
      { complete: async () => ({ text: valid, inputTokens: 2, outputTokens: 2, latencyMs: 2 }) },
      new ReadBroker(async () => ({})),
      'user',
      transcript,
    );
    expect(armA.ok).toBe(true);
    expect(armA.specialist).toBeNull();
  });

  it('keeps the turn prompt on this user and prices DeepSeek from the docs', () => {
    const user = buildTurnUser({
      transcript: 'Купи хліб',
      nowLocal: '2026-10-18 09:00',
      timeZone: 'Europe/Kyiv',
      wakeHm: '08:00',
      sleepHm: '23:00',
      scheduleToday: '2026-10-18',
      tomorrow: '2026-10-19',
      weekdays: 'Sunday 2026-10-18',
      defaultDurationMinutes: 45,
      language: 'uk',
      owned: [{ id: 'task-zvit', type: 'task', name: 'Звіт', status: 'open' }],
      openQuestion: null,
      pending: false,
    });
    expect(user).toContain('task-zvit');
    expect(user).not.toContain('task-foreign');
    expect(user).toContain('45 minutes');
    expect(deepseekFlashIsPeak(new Date('2026-10-27T02:00:00.000Z'))).toBe(true);
    expect(deepseekFlashIsPeak(new Date('2026-10-27T21:00:00.000Z'))).toBe(false);
    expect(deepseekFlashUsd({ at: new Date('2026-10-27T21:00:00.000Z'), cacheHit: 0, cacheMiss: 1_000_000, output: 1_000_000 }).usd).toBeCloseTo(0.75);
    expect(typeof runLiveComparison).toBe('function');
  });

  it('does not import vNext from the production orchestrator', () => {
    const source = readFileSync(join(__dirname, '../voice-agent.orchestrator.ts'), 'utf8');
    expect(source).not.toContain('./vnext');
    expect(source).not.toContain('runVNextTurn');
  });
});
