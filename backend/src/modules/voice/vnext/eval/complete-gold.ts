import { EDGE_CASES, type EdgeCase } from './edge-cases';
import { fieldGoldRows } from './field-gold';
import { semanticGoldRows } from './semantic-gold';
import type { SemanticExpectation } from './semantic-outcome';

const DAYISH = /^\d{4}-\d{2}-\d{2}/;

export type GoldExclusion = { id: string; gold: string; reason: string };

function hasTimedAssertion(edge: EdgeCase): boolean {
  const expect = edge.expect;
  if (expect.durationMinutes != null || expect.unscheduled === true || expect.preservedLabel) return true;
  return typeof expect.includesDate === 'string' && DAYISH.test(expect.includesDate);
}

/** Complete-gold rows whose authored fields can be checked without guessing. */
export function eligibleCompleteGold(): { eligible: string[]; excluded: GoldExclusion[] } {
  const eligible: string[] = [];
  const excluded: GoldExclusion[] = [];
  for (const row of semanticGoldRows()) {
    if (row.gold !== 'complete') {
      excluded.push({ id: row.id, gold: row.gold, reason: row.reason });
      continue;
    }
    const edge = EDGE_CASES.find((item) => item.id === row.id);
    if (!edge || edge.expect.intentCount == null) {
      excluded.push({ id: row.id, gold: row.gold, reason: 'complete label without an edge expectation or an operation count' });
      continue;
    }
    if (edge.expect.outcome === 'confirm' && !hasTimedAssertion(edge)) {
      excluded.push({ id: row.id, gold: row.gold, reason: 'confirm without a date, duration, or preserved time label' });
      continue;
    }
    if ((edge.expect.intentCount ?? 0) > 1 && edge.expect.includesDate && !fieldGoldRows().find((item) => item.id === edge.id)?.operations?.length) {
      excluded.push({ id: row.id, gold: row.gold, reason: 'a shared date string cannot be checked across more than one operation' });
      continue;
    }
    eligible.push(row.id);
  }
  return { eligible, excluded };
}

export function expectationForEdge(edge: EdgeCase): SemanticExpectation | null {
  if (!eligibleCompleteGold().eligible.includes(edge.id)) return null;
  const field = fieldGoldRows().find((row) => row.id === edge.id);
  const operations = field?.operations
    ?.map((operation) => {
      const rest = { ...operation };
      delete rest.qualitative;
      return rest;
    })
    .filter((operation) => Object.keys(operation).length > 0);
  const includesDate = edge.expect.intentCount === 1 && typeof edge.expect.includesDate === 'string' && DAYISH.test(edge.expect.includesDate)
    ? edge.expect.includesDate
    : undefined;
  return {
    acceptable: [edge.expect.outcome],
    refusalAllowed: edge.expect.outcome === 'refuse',
    intentCount: edge.expect.intentCount,
    ...(edge.expect.durationMinutes != null ? { durationMinutes: edge.expect.durationMinutes } : {}),
    ...(edge.expect.blockedIncludes ? { blockedIncludes: edge.expect.blockedIncludes } : {}),
    ...(edge.expect.questionIncludes ? { questionIncludes: edge.expect.questionIncludes } : {}),
    ...(edge.expect.unscheduled != null ? { unscheduled: edge.expect.unscheduled } : {}),
    ...(edge.expect.preservedLabel ? { preservedLabel: edge.expect.preservedLabel } : {}),
    ...(operations && operations.length ? { operations } : {}),
    ...(includesDate ? { includesDate } : {}),
    ...(edge.expect.intentCount === 1 && edge.expect.excludesDate ? { excludesDate: edge.expect.excludesDate } : {}),
  };
}
