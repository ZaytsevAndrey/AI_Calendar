import {
  parsePlannerDecision,
  PlannerInvalidDecisionError,
  PlannerInvalidJsonError,
  PlannerSegmentLimitError,
} from './voice-agent.planner';
import { MAX_SEGMENTS } from './voice-agent.planner.prompt';

describe('parsePlannerDecision', () => {
  it('parses a list of known tool calls', () => {
    const decision = parsePlannerDecision(
      JSON.stringify({
        type: 'tools',
        calls: [{ name: 'get_day_agenda', args: { day: 'today' } }],
      }),
    );
    expect(decision).toEqual({
      type: 'tools',
      calls: [{ name: 'get_day_agenda', args: { day: 'today' } }],
    });
  });

  it('rejects a tool list that contains a bad call', () => {
    expect(() =>
      parsePlannerDecision(
        JSON.stringify({
          type: 'tools',
          calls: [{ name: 'get_day_agenda', args: { day: 'today' } }, { args: {} }, 'x'],
        }),
      ),
    ).toThrow(PlannerInvalidDecisionError);
    let unknown: unknown;
    try {
      parsePlannerDecision(
        JSON.stringify({ type: 'tools', calls: [{ name: 'drop_database', args: {} }] }),
      );
    } catch (err) {
      unknown = err;
    }
    expect(unknown).toBeInstanceOf(PlannerInvalidDecisionError);
    expect((unknown as PlannerInvalidDecisionError).reason).toBe('unknown_tool');
    let args: unknown;
    try {
      parsePlannerDecision(
        JSON.stringify({ type: 'tools', calls: [{ name: 'get_day_agenda', args: ['today'] }] }),
      );
    } catch (err) {
      args = err;
    }
    expect(args).toBeInstanceOf(PlannerInvalidDecisionError);
    expect((args as PlannerInvalidDecisionError).reason).toBe('args');
  });

  it('parses steps under the limit and trims them', () => {
    const segments = Array.from({ length: MAX_SEGMENTS }, (_, i) => ` seg ${i} `);
    const decision = parsePlannerDecision(
      JSON.stringify({ type: 'steps', answer: ' Free at 3. ', segments: [...segments, ''] }),
    );
    expect(decision).toEqual({
      type: 'steps',
      answer: 'Free at 3.',
      segments: segments.map((_, i) => `seg ${i}`),
    });
  });

  it('rejects a segment list past the limit without keeping a prefix', () => {
    const segments = Array.from({ length: MAX_SEGMENTS + 3 }, (_, i) => `seg ${i}`);
    expect(() =>
      parsePlannerDecision(JSON.stringify({ type: 'steps', answer: '', segments })),
    ).toThrow(PlannerSegmentLimitError);
    try {
      parsePlannerDecision(JSON.stringify({ type: 'steps', answer: '', segments }));
    } catch (err) {
      expect(err).toBeInstanceOf(PlannerSegmentLimitError);
      expect((err as PlannerSegmentLimitError).count).toBe(MAX_SEGMENTS + 3);
      expect((err as PlannerSegmentLimitError).code).toBe('segment_limit_exceeded');
    }
  });

  it('accepts segment objects with a text field', () => {
    const decision = parsePlannerDecision(
      JSON.stringify({ type: 'steps', segments: [{ text: 'buy milk' }] }),
    );
    expect(decision).toEqual({ type: 'steps', answer: '', segments: ['buy milk'] });
  });

  it('parses plan_start with validated edits', () => {
    const decision = parsePlannerDecision(
      JSON.stringify({
        type: 'plan_start',
        day: '2026-10-19',
        interview: true,
        question: 'Anything fixed tomorrow?',
        edits: [
          { op: 'add_task', name: 'Gym', durationMinutes: 60, preferredHm: '18:00' },
          { op: 'bogus' },
          { op: 'set_preferred_start', itemId: 'a', hm: '25:00' },
        ],
      }),
    );
    expect(decision).toEqual({
      type: 'plan_start',
      day: '2026-10-19',
      interview: true,
      question: 'Anything fixed tomorrow?',
      edits: [
        {
          op: 'add_task',
          name: 'Gym',
          durationMinutes: 60,
          preferredHm: '18:00',
          earliestHm: null,
          deadlineHm: null,
        },
      ],
      skipped: [
        { reason: 'invalid_edit', cause: 'unknown_op' },
        { reason: 'invalid_time' },
      ],
    });
  });

  it('rejects a plan_question that has no question', () => {
    expect(() =>
      parsePlannerDecision(
        JSON.stringify({
          type: 'plan_question',
          question: ' ',
          edits: [{ op: 'remove_item', itemId: 'x' }],
        }),
      ),
    ).toThrow(PlannerInvalidDecisionError);
    try {
      parsePlannerDecision(JSON.stringify({ type: 'plan_question', edits: [] }));
    } catch (err) {
      expect(err).toBeInstanceOf(PlannerInvalidDecisionError);
      expect((err as PlannerInvalidDecisionError).typeName).toBe('plan_question');
      expect((err as PlannerInvalidDecisionError).reason).toBe('empty_question');
    }
  });

  it('keeps a plan_question that asks something', () => {
    const decision = parsePlannerDecision(
      JSON.stringify({
        type: 'plan_question',
        question: ' Anything fixed? ',
        edits: [{ op: 'remove_item', itemId: 'x' }],
      }),
    );
    expect(decision).toEqual({
      type: 'plan_question',
      question: 'Anything fixed?',
      edits: [{ op: 'remove_item', itemId: 'x' }],
      skipped: [],
    });
  });

  it.each(['answer_pending', 'confirm_pending', 'cancel_pending'] as const)(
    'parses %s',
    (type) => {
      expect(parsePlannerDecision(JSON.stringify({ type }))).toEqual({ type });
    },
  );

  it('parses a final answer', () => {
    expect(
      parsePlannerDecision(JSON.stringify({ type: 'final', outcome: 'clarify', assistantMessage: 'Which one?' })),
    ).toEqual({ type: 'final', outcome: 'clarify', assistantMessage: 'Which one?' });
  });

  it('rejects an unknown decision type', () => {
    expect(() =>
      parsePlannerDecision(
        JSON.stringify({ type: 'step', assistantMessage: 'Tomorrow you have the dentist.' }),
      ),
    ).toThrow(PlannerInvalidDecisionError);
    let caught: unknown;
    try {
      parsePlannerDecision(JSON.stringify({ outcome: 'weird', assistantMessage: 'Hi' }));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PlannerInvalidDecisionError);
    expect((caught as PlannerInvalidDecisionError).typeName).toBe('(missing)');
  });

  it('extracts JSON wrapped in prose', () => {
    const decision = parsePlannerDecision('Sure:\n{"type":"confirm_pending"}\n');
    expect(decision).toEqual({ type: 'confirm_pending' });
  });

  it('rejects an outcome outside answer, clarify, and refuse', () => {
    expect(() =>
      parsePlannerDecision(
        JSON.stringify({ type: 'final', outcome: 'weird', assistantMessage: 'Hi' }),
      ),
    ).toThrow(PlannerInvalidDecisionError);
    try {
      parsePlannerDecision(JSON.stringify({ type: 'final', outcome: 'done', assistantMessage: 'Hi' }));
    } catch (err) {
      expect(err).toBeInstanceOf(PlannerInvalidDecisionError);
      expect((err as PlannerInvalidDecisionError).reason).toBe('outcome');
    }
  });

  it('rejects a segment that is not text', () => {
    expect(() =>
      parsePlannerDecision(
        JSON.stringify({ type: 'steps', answer: '', segments: ['buy milk', 4] }),
      ),
    ).toThrow(PlannerInvalidDecisionError);
  });

  it('accepts empty steps so the turn can refuse them without a task parse', () => {
    expect(parsePlannerDecision(JSON.stringify({ type: 'steps', answer: '', segments: [] }))).toEqual({
      type: 'steps',
      answer: '',
      segments: [],
    });
  });

  it('throws PlannerInvalidJsonError on non-JSON replies', () => {
    expect(() => parsePlannerDecision('no json here')).toThrow(PlannerInvalidJsonError);
    expect(() => parsePlannerDecision('no json here')).not.toThrow(PlannerInvalidDecisionError);
  });
});
