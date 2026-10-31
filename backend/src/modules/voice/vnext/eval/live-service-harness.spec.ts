/**
 * The V7 live harness drives the real production service: the shown claim travels with every turn,
 * a spoken "так" applies without a model call, dispatched writes are reported as applied, and the
 * capture sees the production prompt, model outputs and reads.
 */
import { buildLiveService, DEFAULT_SETTINGS, liveClient, parseStepLine, StepCapture, storeFromWorld } from './live-service-harness';
import { generalizationWorld } from './phase47-generalization';
import { judgeTurn } from './phase477-score';

function scripted(outputs: string[]) {
  return {
    completeJson: jest.fn(async () => {
      const next = outputs.shift();
      if (next == null) throw new Error('unscripted model call');
      return next;
    }),
    takeLastCompletion: jest.fn(() => ({ model: 'deepseek-flash', totalTokens: 120, promptTokens: 100, completionTokens: 20 })),
  };
}

const envelope = (text: string, operations: unknown[]) => JSON.stringify({ version: '1', kind: 'operations', operations: operations.map((row) => ({ changes: {}, constraints: [], dependsOn: [], source: { text }, ...(row as object) })) });

describe('live service harness', () => {
  beforeAll(() => { process.env.VOICE_TRACE_BODY = '1'; });
  afterAll(() => { delete process.env.VOICE_TRACE_BODY; });

  it('parses a service log line into a step with fields and body', () => {
    const step = parseStepLine('voice.structured t-1 turn.state {"blocked":["x"],"preview":{"state":"open","items":2}} body={"a":1}');
    expect(step).toEqual({ name: 'turn.state', fields: { blocked: ['x'], preview: { state: 'open', items: 2 } }, body: '{"a":1}', warn: false });
    expect(parseStepLine('something else')).toBeNull();
  });

  it('builds production rows from a world: a Later task, a scheduled task with a slot, an external event the model must find', () => {
    const store = storeFromWorld(generalizationWorld('default'));
    const report = store.tasks.find((row) => row.id === 'task-report')!;
    expect(report.isUnscheduled).toBe(true);
    const morning = store.tasks.find((row) => row.id === 'design-am')!;
    expect(morning.isUnscheduled).toBe(false);
    expect(store.slots.filter((row) => row.taskId === 'design-am')).toHaveLength(1);
    const flight = storeFromWorld(generalizationWorld('writable-flight'));
    expect(flight.tasks).toHaveLength(0);
    expect(flight.events[0]).toMatchObject({ id: 'ext-flight-w', organizer: { self: true } });
    expect(flight.externalIds.get('ext:google:ext-flight-w')).toBe('ext-flight-w');
  });

  it('runs a preview, applies it on a bare так with the shown claim and no model call, and reports it as applied', async () => {
    const groq = scripted([envelope('додай чай', [{ opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'n' }, changes: { title: 'Чай' } }])]);
    const store = storeFromWorld([]);
    const service = buildLiveService(store, DEFAULT_SETTINGS, groq as never);
    const capture = new StepCapture();
    capture.start();
    try {
      const client = liveClient({ service, groq: null, capture, sessionId: 's-1', store });
      const first = await client.turn('додай чай');
      expect(first.observed.outcome).toBe('confirm');
      expect(first.observed.pendingCount).toBe(1);
      expect(first.prompt).toContain('додай чай');
      expect(first.modelOutputs).toHaveLength(1);
      expect(first.usage).toMatchObject({ calls: 1, tokens: 120 });
      expect(judgeTurn(first.observed, { outcomes: ['confirm'], nameIncludes: 'чай', unscheduled: true }).completion).toBe(true);
      const second = await client.turn('так');
      expect(second.dto).toMatchObject({ executionId: first.response.execution!.executionId, previewRevision: first.response.execution!.previewRevision });
      expect(second.observed.outcome).toBe('act');
      expect(groq.completeJson).toHaveBeenCalledTimes(1);
      expect(second.simulatedReport).toEqual({ executionId: first.response.execution!.executionId, results: [{ summary: expect.any(String), status: 'applied' }] });
      const third = await client.turn('так');
      expect(third.dto).not.toHaveProperty('executionId');
      expect(third.observed.outcome).not.toBe('act');
    } finally {
      capture.stop();
    }
  });

  it('shows the scorer the world id of an external event found through find_events', async () => {
    const reads = JSON.stringify({ version: '1', kind: 'answer', operations: [], answer: { text: 'Checking.' }, requestedReads: [{ requestId: 'r-1', name: 'find_events', args: { day: '2026-10-19' } }] });
    const move = envelope('політ зсунь на 12:40', [{ opId: 'op-1', action: 'move', target: { kind: 'existing', proposedId: 'ext:google:ext-flight-w' }, constraints: [{ kind: 'date', value: '2026-10-19', precision: 'day' }, { kind: 'clock', value: '12:40', role: 'start' }] }]);
    const groq = scripted([reads, move]);
    const store = storeFromWorld(generalizationWorld('writable-flight'));
    const service = buildLiveService(store, DEFAULT_SETTINGS, groq as never);
    const capture = new StepCapture();
    capture.start();
    try {
      const client = liveClient({ service, groq: null, capture, sessionId: 's-2', store });
      const turn = await client.turn('політ зсунь на 12:40');
      expect(turn.reads.map((read) => read.tool)).toEqual(['find_events']);
      expect(turn.observed.outcome).toBe('confirm');
      expect(JSON.stringify(turn.observed.intents)).toContain('"taskId":"ext-flight-w"');
      expect(judgeTurn(turn.observed, { outcomes: ['confirm'], taskId: 'ext-flight-w', includes: '12:40' }).completion).toBe(true);
    } finally {
      capture.stop();
    }
  });
});
