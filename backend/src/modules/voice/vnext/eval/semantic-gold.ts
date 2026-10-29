import { BENCH_SCENARIOS } from '../../../../../benchmark/voice-regression/scenarios';
import { FOLD_SCENARIOS } from '../../../../../benchmark/fold-experiment/scenarios';
import { originalSemanticAnnotations } from './catalog';
import { EDGE_CASES } from './edge-cases';
import { HELD_OUT_CASES } from './held-out';

export type GoldClass = 'complete' | 'partial' | 'ambiguous' | 'unsupported' | 'unverified';

export type GoldRow = {
  id: string;
  source: 'fixture' | 'edge' | 'held-out';
  gold: GoldClass;
  reason: string;
};

function edgeClass(expect: (typeof EDGE_CASES)[number]['expect']): { gold: GoldClass; reason: string } {
  if (expect.adjudication === 'pending-human') return { gold: 'ambiguous', reason: 'pending human adjudication' };
  if (expect.outcome === 'refuse' || (expect.blockedIncludes ?? '').includes('unsupported')) {
    return { gold: 'unsupported', reason: 'the expected result is a safe refusal' };
  }
  const timed = expect.includesDate != null || expect.durationMinutes != null || expect.unscheduled === true || expect.preservedLabel != null;
  if (expect.intentCount == null) return { gold: 'partial', reason: 'outcome is specified and the operation count is not' };
  if (expect.outcome === 'confirm' && !timed) return { gold: 'partial', reason: 'confirm is specified without time or target fields' };
  return { gold: 'complete', reason: 'outcome, count, and the available field constraints are specified' };
}

/** Classifies existing fixtures. It does not rewrite them and it does not score unverified rows. */
export function semanticGoldRows(): GoldRow[] {
  const fixtures = originalSemanticAnnotations().map((row): GoldRow => ({
    id: row.caseId,
    source: 'fixture',
    gold: row.adjudication === 'pending-human' ? 'ambiguous' : 'unverified',
    reason: row.useAsSemanticOracle ? 'oracle' : 'historical fixture is not field-level gold',
  }));
  const edges = EDGE_CASES.map((row): GoldRow => {
    const classified = edgeClass(row.expect);
    return { id: row.id, source: 'edge', gold: classified.gold, reason: classified.reason };
  });
  const held = HELD_OUT_CASES.map((row): GoldRow => ({
    id: row.id,
    source: 'held-out',
    gold: row.note.toLowerCase().includes('ambiguous') ? 'ambiguous' : row.refusalAllowed ? 'unsupported' : 'partial',
    reason: 'held-out states an acceptable outcome class, not one operation per field',
  }));
  return [...fixtures, ...edges, ...held];
}

export function summarizeSemanticGold(): Record<GoldClass, number> & { total: number; scored: number; fixtureCount: number } {
  const rows = semanticGoldRows();
  const count = (gold: GoldClass) => rows.filter((row) => row.gold === gold).length;
  return {
    total: rows.length,
    complete: count('complete'),
    partial: count('partial'),
    ambiguous: count('ambiguous'),
    unsupported: count('unsupported'),
    unverified: count('unverified'),
    scored: count('complete'),
    fixtureCount: BENCH_SCENARIOS.length + FOLD_SCENARIOS.length,
  };
}
