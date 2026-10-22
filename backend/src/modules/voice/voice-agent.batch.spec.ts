import {
  collectSegments,
  continuePendingBatch,
  joinSpoken,
  MAX_SEGMENT_CLARIFY,
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

  it('appends the answered segment and moves to the next question', () => {
    const next = continuePendingBatch(
      held(),
      { segment: 'move the thing', result: command('shift', 'Report') },
      ctx,
    );
    expect(next.intents).toHaveLength(2);
    expect(next.unresolved).toEqual([{ segment: 'call mom', question: 'When?' }]);
    expect(next.segments.some((row) => row.status === 'clarify' && row.summary === 'move the thing')).toBe(false);
    expect(next.clarifyCount).toBe(1);
  });

  it('re-asks while the budget lasts, then drops the segment', () => {
    let batch = held();
    for (let i = 1; i < MAX_SEGMENT_CLARIFY; i += 1) {
      batch = continuePendingBatch(batch, { segment: 'move the thing', result: unclear('Which one exactly?') }, ctx);
      expect(batch.unresolved[0]).toEqual({ segment: 'move the thing', question: 'Which one exactly?' });
    }
    batch = continuePendingBatch(batch, { segment: 'move the thing', result: unclear('Still?') }, ctx);
    expect(batch.unresolved).toEqual([{ segment: 'call mom', question: 'When?' }]);
    expect(batch.segments).toContainEqual({ summary: 'move the thing', status: 'dropped' });
    expect(batch.notes).toHaveLength(1);
    expect(batch.intents).toHaveLength(1);
  });
});

describe('joinSpoken', () => {
  it('joins parts into sentences and skips blanks', () => {
    expect(joinSpoken(['Free at 3', null, ' ', 'Created «Milk».', 'Done!'])).toBe(
      'Free at 3. Created «Milk». Done!',
    );
  });
});
