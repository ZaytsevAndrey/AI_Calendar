import { parsePlannerDecision } from './voice-agent.planner';
import { MAX_SEGMENTS } from './voice-agent.planner.prompt';

describe('parsePlannerDecision', () => {
  it('parses tool calls and drops nameless rows', () => {
    const decision = parsePlannerDecision(
      JSON.stringify({
        type: 'tools',
        calls: [{ name: 'get_day_agenda', args: { day: 'today' } }, { args: {} }, 'x'],
      }),
    );
    expect(decision).toEqual({
      type: 'tools',
      calls: [{ name: 'get_day_agenda', args: { day: 'today' } }],
    });
  });

  it('parses steps, trims segments and caps them', () => {
    const segments = Array.from({ length: MAX_SEGMENTS + 3 }, (_, i) => ` seg ${i} `);
    const decision = parsePlannerDecision(
      JSON.stringify({ type: 'steps', answer: ' Free at 3. ', segments: [...segments, ''] }),
    );
    expect(decision.type).toBe('steps');
    if (decision.type !== 'steps') return;
    expect(decision.answer).toBe('Free at 3.');
    expect(decision.segments).toHaveLength(MAX_SEGMENTS);
    expect(decision.segments[0]).toBe('seg 0');
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
        { op: 'set_preferred_start', itemId: 'a', hm: null },
      ],
    });
  });

  it('turns a plan_question without a question into plan_edits', () => {
    const decision = parsePlannerDecision(
      JSON.stringify({ type: 'plan_question', question: ' ', edits: [{ op: 'remove_item', itemId: 'x' }] }),
    );
    expect(decision).toEqual({
      type: 'plan_edits',
      edits: [{ op: 'remove_item', itemId: 'x' }],
      answer: '',
    });
  });

  it.each(['answer_pending', 'confirm_pending', 'cancel_pending'] as const)(
    'parses %s',
    (type) => {
      expect(parsePlannerDecision(JSON.stringify({ type }))).toEqual({ type });
    },
  );

  it('falls back to a final answer for unknown types', () => {
    expect(
      parsePlannerDecision(JSON.stringify({ type: 'final', outcome: 'clarify', assistantMessage: 'Which one?' })),
    ).toEqual({ type: 'final', outcome: 'clarify', assistantMessage: 'Which one?' });
    expect(parsePlannerDecision(JSON.stringify({ outcome: 'weird', assistantMessage: 'Hi' }))).toEqual({
      type: 'final',
      outcome: 'answer',
      assistantMessage: 'Hi',
    });
  });

  it('extracts JSON wrapped in prose', () => {
    const decision = parsePlannerDecision('Sure:\n{"type":"confirm_pending"}\n');
    expect(decision).toEqual({ type: 'confirm_pending' });
  });

  it('throws on non-JSON replies', () => {
    expect(() => parsePlannerDecision('no json here')).toThrow();
  });
});
