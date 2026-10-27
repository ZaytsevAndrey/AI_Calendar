import {
  collectSegments,
  continuePendingBatch,
  joinSpoken,
  skipOpenQuestions,
  type SegmentParse,
} from './voice-agent.batch';
import type { PendingBatch } from './voice-agent.types';
import type { VoiceParseResult } from './voice-parse.types';

const ctx = { language: 'en' };

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

function unclear(question: string): VoiceParseResult {
  return { understanding: 'needs_clarification', clarifyingQuestion: question, task: null, command: null };
}

describe('collectSegments', () => {
  it('keeps every resolved segment in order', () => {
    const parses: SegmentParse[] = [
      { segment: 'buy milk', result: create('Milk') },
      { segment: 'report is done', result: command('complete', 'Report') },
    ];
    const out = collectSegments(parses, ctx);
    expect(out.intents.map((intent) => intent.type)).toEqual(['create', 'command']);
    expect(out.segments.map((row) => row.status)).toEqual(['ready', 'ready']);
    expect(out.unresolved).toEqual([]);
    expect(out.needsConfirm).toBe(true);
  });

  it('holds unclear segments and notes failures and refusals', () => {
    const parses: SegmentParse[] = [
      { segment: 'buy milk', result: create('Milk') },
      { segment: 'move the thing', result: unclear('Which task?') },
      { segment: 'hack the bank', result: { ...command('refuse', ''), command: { kind: 'refuse', message: 'Cannot do that' } as never } },
      { segment: 'broken', error: 'boom' },
    ];
    const out = collectSegments(parses, ctx);
    expect(out.intents).toHaveLength(1);
    expect(out.unresolved).toEqual([{ segment: 'move the thing', question: 'Which task?' }]);
    expect(out.segments.map((row) => row.status)).toEqual(['ready', 'clarify', 'refused', 'dropped']);
    expect(out.notes).toHaveLength(2);
    expect(out.notes[0]).toBe('Cannot do that');
  });

  it('asks for confirmation when any write requires it', () => {
    const out = collectSegments(
      [
        { segment: 'buy milk', result: create('Milk') },
        { segment: 'delete draft', result: command('delete', 'Draft') },
      ],
      ctx,
    );
    expect(out.needsConfirm).toBe(true);
  });
});

describe('continuePendingBatch', () => {
  const held = (): PendingBatch => ({
    intents: collectSegments([{ segment: 'buy milk', result: create('Milk') }], ctx).intents,
    segments: [
      { summary: 'Milk', status: 'ready' },
      { summary: 'move the thing', status: 'clarify' },
    ],
    unresolved: [
      { segment: 'move the thing', question: 'Which task?' },
      { segment: 'call mom', question: 'When?' },
    ],
    clarifyCount: 1,
    answer: '',
    notes: [],
    needsConfirm: true,
  });

  function namesOf(batch: PendingBatch): string[] {
    return batch.intents.map((intent) =>
      intent.type === 'create' ? String(intent.task.name) : String(intent.command.taskName),
    );
  }

  function middleBatch(): PendingBatch {
    const milk = collectSegments([{ segment: 'buy milk', result: create('Milk') }], ctx).intents[0];
    const call = collectSegments([{ segment: 'call mom', result: create('Call') }], ctx).intents[0];
    return {
      intents: [milk, call],
      segments: [
        { summary: 'Milk', status: 'ready' },
        { summary: 'move the thing', status: 'clarify' },
        { summary: 'Call', status: 'ready' },
      ],
      unresolved: [{ segment: 'move the thing', question: 'Which task?' }],
      clarifyCount: 1,
      answer: '',
      notes: [],
      needsConfirm: true,
    };
  }

  it('places the answered middle segment between its ready neighbors', () => {
    const next = continuePendingBatch(
      middleBatch(),
      { segment: 'move the thing', result: command('shift', 'Report') },
      ctx,
    );
    expect(namesOf(next)).toEqual(['Milk', 'Report', 'Call']);
    expect(next.segments.map((row) => row.status)).toEqual(['ready', 'ready', 'ready']);
    expect(next.segments.map((row) => row.summary)).toEqual([
      'Milk',
      next.intents[1].summary,
      'Call',
    ]);
    expect(next.unresolved).toEqual([]);
    expect(next.needsConfirm).toBe(true);
  });

  it('answers two questions in the order of their segments', () => {
    const milk = collectSegments([{ segment: 'buy milk', result: create('Milk') }], ctx).intents[0];
    const call = collectSegments([{ segment: 'call mom', result: create('Call') }], ctx).intents[0];
    const first = continuePendingBatch(
      {
        intents: [milk, call],
        segments: [
          { summary: 'Milk', status: 'ready' },
          { summary: 'move the thing', status: 'clarify' },
          { summary: 'the later one', status: 'clarify' },
          { summary: 'Call', status: 'ready' },
        ],
        unresolved: [
          { segment: 'move the thing', question: 'Which task?' },
          { segment: 'the later one', question: 'Which day?' },
        ],
        clarifyCount: 1,
        answer: '',
        notes: [],
        needsConfirm: true,
      },
      { segment: 'move the thing', result: command('shift', 'Report') },
      ctx,
    );
    expect(namesOf(first)).toEqual(['Milk', 'Report', 'Call']);
    expect(first.segments.map((row) => row.status)).toEqual(['ready', 'ready', 'clarify', 'ready']);
    expect(first.unresolved).toEqual([{ segment: 'the later one', question: 'Which day?' }]);

    const second = continuePendingBatch(
      first,
      { segment: 'the later one', result: command('complete', 'Gym') },
      ctx,
    );
    expect(namesOf(second)).toEqual(['Milk', 'Report', 'Gym', 'Call']);
    expect(second.segments.map((row) => row.status)).toEqual(['ready', 'ready', 'ready', 'ready']);
    expect(second.unresolved).toEqual([]);
    expect(second.needsConfirm).toBe(true);
  });

  it('keeps a refused or dropped neighbor while the answered segment takes its slot', () => {
    const batch = middleBatch();
    batch.segments = [
      { summary: 'Milk', status: 'ready' },
      { summary: 'hack the bank', status: 'refused' },
      { summary: 'move the thing', status: 'clarify' },
      { summary: 'Call', status: 'ready' },
      { summary: 'broken', status: 'dropped' },
    ];
    const next = continuePendingBatch(
      batch,
      { segment: 'move the thing', result: command('shift', 'Report') },
      ctx,
    );
    expect(namesOf(next)).toEqual(['Milk', 'Report', 'Call']);
    expect(next.segments.map((row) => row.status)).toEqual([
      'ready',
      'refused',
      'ready',
      'ready',
      'dropped',
    ]);
    expect(next.segments[1]).toEqual({ summary: 'hack the bank', status: 'refused' });
    expect(next.segments[4]).toEqual({ summary: 'broken', status: 'dropped' });
  });

  it('puts a refused answer back in the question slot', () => {
    const next = continuePendingBatch(middleBatch(), {
      segment: 'move the thing',
      result: {
        ...command('refuse', ''),
        command: { kind: 'refuse', message: 'Cannot do that' } as never,
      },
    }, ctx);
    expect(namesOf(next)).toEqual(['Milk', 'Call']);
    expect(next.segments).toEqual([
      { summary: 'Milk', status: 'ready' },
      { summary: 'move the thing', status: 'refused' },
      { summary: 'Call', status: 'ready' },
    ]);
    expect(next.notes).toEqual(['Cannot do that']);
    expect(next.needsConfirm).toBe(true);
  });

  it('puts a dropped answer back in the question slot', () => {
    const next = continuePendingBatch(
      middleBatch(),
      { segment: 'move the thing', error: 'boom' },
      ctx,
    );
    expect(namesOf(next)).toEqual(['Milk', 'Call']);
    expect(next.segments.map((row) => row.status)).toEqual(['ready', 'dropped', 'ready']);
    expect(next.segments[1].summary).toBe('move the thing');
    expect(next.notes).toHaveLength(1);
    expect(next.unresolved).toEqual([]);
  });

  it('resolves the current question and moves to the next one', () => {
    const next = continuePendingBatch(
      held(),
      { segment: 'move the thing', result: command('shift', 'Report') },
      ctx,
    );
    expect(namesOf(next)).toEqual(['Milk', 'Report']);
    expect(next.unresolved).toEqual([{ segment: 'call mom', question: 'When?' }]);
    expect(next.segments.some((row) => row.status === 'clarify' && row.summary === 'move the thing')).toBe(false);
    expect(next.clarifyCount).toBe(1);
  });

  it('keeps the current question when the answer still needs clarification', () => {
    const next = continuePendingBatch(
      held(),
      { segment: 'move the thing', result: unclear('Which day?') },
      ctx,
    );
    expect(next.unresolved.map((row) => row.question)).toEqual(['Which day?', 'When?']);
    expect(next.unresolved[0].segment).toBe('move the thing');
    expect(next.intents).toHaveLength(1);
    expect(next.segments.some((row) => row.status === 'dropped')).toBe(false);
  });

  it('keeps a single question when the specialist asks again', () => {
    const single = held();
    single.unresolved = [{ segment: 'move the thing', question: 'Which task?' }];
    const next = continuePendingBatch(
      single,
      { segment: 'move the thing', result: unclear('Which day?') },
      ctx,
    );
    expect(next.unresolved).toEqual([{ segment: 'move the thing', question: 'Which day?' }]);
    expect(next.intents).toHaveLength(1);
    expect(next.notes).toEqual([]);
  });

  it('skips every open question when none was answered', () => {
    const next = skipOpenQuestions(held(), ctx);
    expect(next.unresolved).toEqual([]);
    expect(next.segments).toContainEqual({ summary: 'move the thing', status: 'dropped' });
    expect(next.notes).toHaveLength(2);
    expect(next.intents).toHaveLength(1);
  });
});

describe('joinSpoken', () => {
  it('joins parts into sentences and skips blanks', () => {
    expect(joinSpoken(['Free at 3', null, ' ', 'Created «Milk».', 'Done!'])).toBe(
      'Free at 3. Created «Milk». Done!',
    );
  });
});
