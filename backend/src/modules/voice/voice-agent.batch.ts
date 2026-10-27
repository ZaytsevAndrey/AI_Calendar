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

function dropQuestions(
  batch: PendingBatch,
  dropped: PendingBatch['unresolved'],
  ctx: SummaryContext,
): PendingBatch {
  const droppedText = new Set(dropped.map((row) => row.segment));
  return {
    ...batch,
    unresolved: batch.unresolved.filter((row) => !droppedText.has(row.segment)),
    segments: batch.segments.map((row) =>
      row.status === 'clarify' && droppedText.has(row.summary)
        ? { ...row, status: 'dropped' }
        : row,
    ),
    notes: [
      ...batch.notes,
      ...dropped.map((row) =>
        t(language(ctx), 'voice.segmentDropped', { text: row.segment }),
      ),
    ],
  };
}

/** The utterance answered none of the open questions. Skip every one of them. */
export function skipOpenQuestions(batch: PendingBatch, ctx: SummaryContext): PendingBatch {
  if (!batch.unresolved.length) return batch;
  return dropQuestions(batch, batch.unresolved, ctx);
}

/** Fold the parse of a clarification answer into a held batch. */
export function continuePendingBatch(
  batch: PendingBatch,
  answer: SegmentParse,
  ctx: SummaryContext,
): PendingBatch {
  const [current, ...rest] = batch.unresolved;
  if (!current) return batch;
  const collected = collectSegments([answer], ctx);
  if (collected.unresolved.length) {
    const question = collected.unresolved[0].question.trim() || current.question;
    return {
      ...batch,
      unresolved: [{ segment: current.segment, question }, ...rest],
    };
  }
  const slot = batch.segments.findIndex(
    (row) => row.status === 'clarify' && row.summary === current.segment,
  );
  const segments =
    slot < 0
      ? [...batch.segments, ...collected.segments]
      : [
          ...batch.segments.slice(0, slot),
          ...collected.segments,
          ...batch.segments.slice(slot + 1),
        ];
  const readyBefore =
    slot < 0
      ? batch.intents.length
      : batch.segments.slice(0, slot).filter((row) => row.status === 'ready').length;
  return {
    intents: [
      ...batch.intents.slice(0, readyBefore),
      ...collected.intents,
      ...batch.intents.slice(readyBefore),
    ],
    segments,
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
