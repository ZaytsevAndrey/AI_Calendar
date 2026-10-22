import { t } from '../../i18n/t';
import { isAppLanguage } from '../../i18n/types';
import {
  commandNeedsConfirm,
  intentsFromParseResult,
} from './voice-agent.intents';
import type {
  PendingBatch,
  UnresolvedSegment,
  VoiceSegmentSummary,
  VoiceWriteIntent,
} from './voice-agent.types';
import type { VoiceParseResult } from './voice-parse.types';

export const MAX_SEGMENT_CLARIFY = 2;

export type SegmentParse =
  | { segment: string; result: VoiceParseResult }
  | { segment: string; error: string };

export type SummaryContext = {
  language?: string | null;
  timeZone?: string;
  nowIso?: string;
  wakeTime?: string | null;
  sleepTime?: string | null;
};

export type CollectedSegments = {
  intents: VoiceWriteIntent[];
  segments: VoiceSegmentSummary[];
  unresolved: UnresolvedSegment[];
  needsConfirm: boolean;
  notes: string[];
};

function language(ctx: SummaryContext) {
  return isAppLanguage(ctx.language) ? ctx.language : 'en';
}

/** Map each parsed segment to intents, an open question, or a refusal note. */
export function collectSegments(
  parses: SegmentParse[],
  ctx: SummaryContext,
): CollectedSegments {
  const out: CollectedSegments = {
    intents: [],
    segments: [],
    unresolved: [],
    needsConfirm: false,
    notes: [],
  };
  for (const parse of parses) {
    if ('error' in parse) {
      out.segments.push({ summary: parse.segment, status: 'dropped' });
      out.notes.push(t(language(ctx), 'voice.segmentDropped', { text: parse.segment }));
      continue;
    }
    const mapped = intentsFromParseResult(parse.result, ctx);
    if (mapped.refuseMessage) {
      out.segments.push({ summary: parse.segment, status: 'refused' });
      out.notes.push(mapped.refuseMessage);
      continue;
    }
    if (mapped.clarifyQuestion) {
      out.segments.push({ summary: parse.segment, status: 'clarify' });
      out.unresolved.push({ segment: parse.segment, question: mapped.clarifyQuestion });
      continue;
    }
    for (const intent of mapped.intents) {
      out.intents.push(intent);
      out.segments.push({ summary: intent.summary, status: 'ready' });
    }
    if (mapped.needsConfirm || mapped.intents.some((intent) => commandNeedsConfirm(intent))) {
      out.needsConfirm = true;
    }
  }
  return out;
}

/** Fold the parse of a clarification answer into a held batch. */
export function continuePendingBatch(
  batch: PendingBatch,
  answer: SegmentParse,
  ctx: SummaryContext,
): PendingBatch {
  const [current, ...rest] = batch.unresolved;
  const collected = collectSegments([answer], ctx);
  const segments = batch.segments.filter(
    (row) => !(row.status === 'clarify' && row.summary === current?.segment),
  );
  if (collected.unresolved.length) {
    const nextCount = batch.clarifyCount + 1;
    if (nextCount > MAX_SEGMENT_CLARIFY) {
      return {
        ...batch,
        segments: [...segments, { summary: current.segment, status: 'dropped' }],
        unresolved: rest,
        clarifyCount: 1,
        notes: [
          ...batch.notes,
          t(language(ctx), 'voice.segmentDropped', { text: current.segment }),
        ],
      };
    }
    return {
      ...batch,
      unresolved: [
        { segment: current.segment, question: collected.unresolved[0].question },
        ...rest,
      ],
      clarifyCount: nextCount,
    };
  }
  return {
    intents: [...batch.intents, ...collected.intents],
    segments: [...segments, ...collected.segments],
    unresolved: rest,
    clarifyCount: 1,
    answer: batch.answer,
    notes: [...batch.notes, ...collected.notes],
    needsConfirm: batch.needsConfirm || collected.needsConfirm,
  };
}

/** One spoken line: Q&A answer, then each write summary, then refusal notes. */
export function joinSpoken(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .map((part) => (/[.!?…»"]$/.test(part) ? part : `${part}.`))
    .join(' ');
}
