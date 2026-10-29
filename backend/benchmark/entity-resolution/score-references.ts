/**
 * Reference channel for the entity experiment.
 * Segment folding stays on the existing scorers. This module does not import them.
 * A lexical stem aligns a mention to a hand key. The verdict is the entity graph.
 */
import { normalizeMatchText, stemHits } from '../stem-match';
import type { MentionExpect, SampleExpect } from './expectations';

export type Reference = {
  id: string;
  mention: string;
  entity: string | null;
};

export type ResolutionVerdict = 'pass' | 'fail' | 'review' | 'not-emitted';
export type ConsistencyVerdict = 'pass' | 'fail' | 'na';
export type FoldVerdict = 'pass' | 'fail' | 'review';

export type Diagnosis =
  | 'withdrawn'
  | 'graph-right-segments-wrong'
  | 'graph-wrong-segments-right'
  | 'copied-error'
  | 'both-wrong'
  | 'both-agree'
  | 'ambiguous'
  | 'contradiction';

const MENTION_ID = /^m[1-9]\d*$/;
const OBJECT_ID = /^e[1-9]\d*$/;
const CALENDAR_ID = /task-|item-/i;

export function shapeErrors(utterance: string, references: Reference[] | null, decision: string): string[] {
  const errors: string[] = [];
  if (decision !== 'steps') {
    if (references && references.length) errors.push('references-on-non-steps');
    return errors;
  }
  if (!references) {
    errors.push('references-missing');
    return errors;
  }
  const ids = new Set<string>();
  const mentionCounts = new Map<string, number>();
  for (const reference of references) {
    if (!MENTION_ID.test(reference.id) || ids.has(reference.id)) errors.push(`id:${reference.id || 'empty'}`);
    if (reference.id) ids.add(reference.id);
    const mention = reference.mention?.trim() ?? '';
    if (!mention) errors.push('mention-empty');
    else if (!mentionInUtterance(utterance, mention)) errors.push(`mention-not-in-utterance:${mention}`);
    else if (isWholeUtterance(utterance, mention)) errors.push('mention-is-whole-utterance');
    else mentionCounts.set(normalizeMatchText(mention), (mentionCounts.get(normalizeMatchText(mention)) ?? 0) + 1);
    if (reference.entity !== null && (!OBJECT_ID.test(reference.entity) || CALENDAR_ID.test(reference.entity) || ids.has(reference.entity))) {
      errors.push(`entity:${reference.entity}`);
    }
  }
  for (const [mention, count] of mentionCounts) {
    if (occurrences(utterance, mention) < count) errors.push(`mention-repeated:${mention}`);
  }
  return errors;
}

export function scoreResolution(
  expect: SampleExpect,
  decision: string,
  references: Reference[] | null,
): { verdict: ResolutionVerdict; reasons: string[] } {
  if (expect.decision === 'final') {
    if (decision === 'final') return { verdict: 'not-emitted', reasons: ['withdrawal-has-no-reference-graph'] };
    return { verdict: 'fail', reasons: ['steps-after-withdrawal'] };
  }
  const shape = shapeErrors(expect.utterance, references, decision);
  if (shape.length || !references) return { verdict: 'fail', reasons: shape.length ? shape : ['references-missing'] };
  const used = new Set<number>();
  const aligned: Array<{ expect: MentionExpect; reference: Reference }> = [];
  for (const mention of expect.mentions) {
    const index = references.findIndex((reference, at) => !used.has(at) && mention.stems.some((stem) => stemHits(reference.mention, stem)));
    if (index < 0) return { verdict: 'fail', reasons: [`missing-mention:${mention.stems[0]}`] };
    used.add(index);
    aligned.push({ expect: mention, reference: references[index] });
  }
  if (used.size !== references.length) return { verdict: 'fail', reasons: ['extra-mention'] };

  const reasons: string[] = [];
  const reviews: string[] = [];
  const entityByGroup = new Map<string, string>();
  for (const row of aligned) {
    if (row.expect.link !== 'group') continue;
    const entity = row.reference.entity;
    if (entity === null) {
      reasons.push(`null-for-unique:${row.expect.group}`);
      continue;
    }
    const current = entityByGroup.get(row.expect.group);
    if (current && current !== entity) reasons.push(`split-group:${row.expect.group}`);
    else entityByGroup.set(row.expect.group, entity);
  }
  const owner = new Map<string, string>();
  for (const [group, entity] of entityByGroup) {
    const previous = owner.get(entity);
    if (previous) reasons.push(`merged:${previous}+${group}`);
    else owner.set(entity, group);
  }
  for (const row of aligned) {
    if (row.expect.link === 'none' && row.reference.entity !== null) reasons.push('invented-link');
    if (row.expect.link === 'ambiguous') {
      const entity = row.reference.entity;
      if (entity === null) reviews.push('ambiguous-left-null');
      else if ([...entityByGroup.values()].includes(entity)) reviews.push('ambiguous-picked-one');
      else reasons.push('ambiguous-invented-target');
    }
  }
  if (reasons.length) return { verdict: 'fail', reasons };
  if (reviews.length) return { verdict: 'review', reasons: reviews };
  return { verdict: 'pass', reasons: [] };
}

/**
 * Segments contradict the graph, or they do not.
 * Reference count and segment count are not inputs.
 */
export function segmentConsistency(
  expect: SampleExpect,
  references: Reference[] | null,
  segments: string[],
): ConsistencyVerdict {
  if (expect.decision === 'final') return 'na';
  if (shapeErrors(expect.utterance, references, 'steps').length || !references) return 'na';
  const resolution = scoreResolution(expect, 'steps', references);
  if (resolution.reasons.includes('extra-mention') || resolution.reasons.some((reason) => reason.startsWith('missing-mention'))) {
    return 'na';
  }
  const used = new Set<number>();
  const aligned: Array<{ expect: MentionExpect; reference: Reference }> = [];
  for (const mention of expect.mentions) {
    const index = references.findIndex((reference, at) => !used.has(at) && mention.stems.some((stem) => stemHits(reference.mention, stem)));
    if (index < 0) return 'na';
    used.add(index);
    aligned.push({ expect: mention, reference: references[index] });
  }
  for (const row of aligned) {
    if (row.reference.entity !== null) continue;
    const kept = segments.some((segment) => mentionInUtterance(segment, row.reference.mention));
    const substituted = expect.closedTitles.some((stem) => !stemHits(expect.utterance, stem) && segments.some((segment) => stemHits(segment, stem)));
    if (!kept || substituted) return 'fail';
  }
  for (const row of aligned) {
    if (row.expect.role !== 'dependent' || row.reference.entity === null) continue;
    const heads = aligned.filter((head) => head.expect.role === 'head' && head.reference.entity === row.reference.entity);
    if (!heads.length) continue;
    const unbound = segments.some((segment) =>
      mentionInUtterance(segment, row.reference.mention)
      && heads.every((head) => !mentionInUtterance(segment, head.reference.mention)),
    );
    if (unbound) return 'fail';
  }
  return 'pass';
}

export function diagnose(
  resolution: ResolutionVerdict,
  folding: FoldVerdict,
  consistency: ConsistencyVerdict,
): Diagnosis {
  if (resolution === 'not-emitted') return folding === 'pass' ? 'withdrawn' : 'both-wrong';
  if (resolution === 'pass' && folding === 'fail') return 'graph-right-segments-wrong';
  if (resolution === 'fail' && folding === 'pass') return 'graph-wrong-segments-right';
  if (resolution === 'pass' && folding === 'pass' && consistency === 'fail') return 'contradiction';
  if (resolution === 'fail' && folding === 'fail' && consistency === 'pass') return 'copied-error';
  if (resolution === 'review' && folding !== 'fail') return 'ambiguous';
  if (resolution === 'pass' && folding === 'pass') return 'both-agree';
  return 'both-wrong';
}

function mentionInUtterance(utterance: string, mention: string): boolean {
  const needle = normalizeMatchText(mention).trim();
  return needle.length > 0 && normalizeMatchText(utterance).includes(needle);
}

function isWholeUtterance(utterance: string, mention: string): boolean {
  const words = normalizeMatchText(utterance).split(/\s+/).filter(Boolean);
  return words.length > 3 && normalizeMatchText(mention).trim() === normalizeMatchText(utterance).trim();
}

function occurrences(utterance: string, mention: string): number {
  const hay = normalizeMatchText(utterance);
  const needle = normalizeMatchText(mention).trim();
  if (!needle) return 0;
  let count = 0;
  let at = 0;
  while (at <= hay.length) {
    const found = hay.indexOf(needle, at);
    if (found < 0) break;
    count += 1;
    at = found + needle.length;
  }
  return count;
}
