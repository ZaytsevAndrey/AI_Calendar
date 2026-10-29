import { BENCH_SCENARIOS } from '../../../../../benchmark/voice-regression/scenarios';
import { FOLD_SCENARIOS } from '../../../../../benchmark/fold-experiment/scenarios';
import { EDGE_CASES } from './edge-cases';
import { HELD_OUT_CASES } from './held-out';
import type { ExpectedOperation } from './semantic-outcome';
import { semanticGoldRows, type GoldClass } from './semantic-gold';

export type FieldGold = {
  id: string;
  source: 'edge' | 'held-out';
  gold: GoldClass;
  outcome: 'confirm' | 'clarify' | 'answer' | 'act' | 'refuse';
  intentCount?: number;
  date?: string;
  operations?: ExpectedOperation[];
  refusalAllowed?: boolean;
  reason: string;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function edgeGold(row: (typeof EDGE_CASES)[number]): FieldGold {
  const expect = row.expect;
  const date = typeof expect.includesDate === 'string' && DAY.test(expect.includesDate) ? expect.includesDate : undefined;
  const instant = typeof expect.includesDate === 'string' && INSTANT.test(expect.includesDate) ? expect.includesDate : undefined;
  const operations: ExpectedOperation[] | undefined = expect.intentCount === 1 && (expect.durationMinutes != null || instant || expect.unscheduled || expect.preservedLabel)
    ? [{
        ...(expect.durationMinutes != null ? { durationMinutes: expect.durationMinutes } : {}),
        ...(instant ? { scheduledStart: instant } : {}),
        ...(expect.preservedLabel ? { qualitative: expect.preservedLabel } : {}),
      }]
    : expect.intentCount === 0
      ? []
      : undefined;
  const gold: GoldClass = expect.adjudication === 'pending-human'
    ? 'ambiguous'
    : expect.outcome === 'refuse' || (expect.blockedIncludes ?? '').includes('unsupported')
      ? 'unsupported'
      : operations || date || expect.intentCount != null
        ? expect.outcome === 'confirm' && !operations && !date
          ? 'partial'
          : 'complete'
        : 'partial';
  return {
    id: row.id,
    source: 'edge',
    gold,
    outcome: expect.outcome,
    intentCount: expect.intentCount,
    ...(date ? { date } : {}),
    ...(operations ? { operations } : {}),
    ...(expect.outcome === 'refuse' ? { refusalAllowed: true } : {}),
    reason: 'Copied from the authored edge expectation. No field was added that the expectation did not already state.',
  };
}

/** Held-out notes that already state the outcome. Clocks are not invented. */
const HELD_OUT_FIELD: FieldGold[] = [
  { id: 'hold-range-meeting', source: 'held-out', gold: 'ambiguous', outcome: 'clarify', intentCount: 0, operations: [], reason: 'The note says the 7-to-9 span is ambiguous and must not pick a clock.' },
  { id: 'hold-all-day-offsite', source: 'held-out', gold: 'unsupported', outcome: 'refuse', refusalAllowed: true, intentCount: 0, operations: [], reason: 'All-day must not become a timed task.' },
  { id: 'hold-46-weekly', source: 'held-out', gold: 'unsupported', outcome: 'refuse', refusalAllowed: true, intentCount: 0, operations: [], reason: 'Weekly recurrence is not stored as one ordinary task.' },
  { id: 'hold-delete-every', source: 'held-out', gold: 'unsupported', outcome: 'clarify', intentCount: 0, operations: [], reason: 'A bulk delete without a complete target set must not preview one match.' },
  { id: 'hold-correction', source: 'held-out', gold: 'partial', outcome: 'confirm', intentCount: 1, reason: 'One create. The note does not give a clock or a calendar.' },
  { id: 'hold-which-report', source: 'held-out', gold: 'ambiguous', outcome: 'clarify', intentCount: 0, operations: [], reason: 'The target is not identified.' },
];

export function fieldGoldRows(): FieldGold[] {
  return [...EDGE_CASES.map(edgeGold), ...HELD_OUT_FIELD];
}

export type GoldProblem = { id: string; code: string };

export function validateGoldCorpus(): { ok: boolean; problems: GoldProblem[]; coverage: ReturnType<typeof goldCoverage> } {
  const problems: GoldProblem[] = [];
  const ids = [
    ...BENCH_SCENARIOS.map((row) => row.id),
    ...FOLD_SCENARIOS.map((row) => row.id),
    ...EDGE_CASES.map((row) => row.id),
    ...HELD_OUT_CASES.map((row) => row.id),
  ];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) problems.push({ id, code: 'duplicate_id' });
    seen.add(id);
  }
  for (const row of fieldGoldRows()) {
    if (row.intentCount != null && row.operations && row.operations.length !== row.intentCount && row.intentCount !== 0) {
      problems.push({ id: row.id, code: 'count_mismatch' });
    }
    if (row.intentCount === 0 && row.operations && row.operations.length !== 0) problems.push({ id: row.id, code: 'count_mismatch' });
    if (row.date && !DAY.test(row.date)) problems.push({ id: row.id, code: 'invalid_date' });
    for (const operation of row.operations ?? []) {
      if (operation.scheduledStart && !INSTANT.test(operation.scheduledStart)) problems.push({ id: row.id, code: 'invalid_instant' });
      if (operation.dependsOn?.some((dep) => dep === row.id)) problems.push({ id: row.id, code: 'bad_dependency' });
    }
    if (row.gold === 'ambiguous' && row.outcome === 'confirm' && (row.intentCount ?? 0) > 0) {
      problems.push({ id: row.id, code: 'ambiguous_confirm' });
    }
    if (row.gold === 'unsupported' && row.refusalAllowed !== true && row.outcome !== 'clarify') {
      problems.push({ id: row.id, code: 'unsupported_without_rule' });
    }
  }
  for (const row of HELD_OUT_FIELD) {
    if (!HELD_OUT_CASES.some((item) => item.id === row.id)) problems.push({ id: row.id, code: 'unknown_held_out' });
  }
  const classes = new Set(semanticGoldRows().map((row) => row.gold));
  if (![...classes].every((gold) => ['complete', 'partial', 'ambiguous', 'unsupported', 'unverified'].includes(gold))) {
    problems.push({ id: 'corpus', code: 'unknown_class' });
  }
  return { ok: problems.length === 0, problems, coverage: goldCoverage() };
}

export function goldCoverage(): {
  total: number;
  complete: number;
  partial: number;
  ambiguous: number;
  unsupported: number;
  unverified: number;
  scored: number;
  fixtures: number;
  edges: number;
  heldOut: number;
  operationLevel: number;
  duplicates: number;
} {
  const rows = semanticGoldRows();
  const count = (gold: GoldClass) => rows.filter((row) => row.gold === gold).length;
  const ids = rows.map((row) => row.id);
  return {
    total: rows.length,
    complete: count('complete'),
    partial: count('partial'),
    ambiguous: count('ambiguous'),
    unsupported: count('unsupported'),
    unverified: count('unverified'),
    scored: count('complete'),
    fixtures: BENCH_SCENARIOS.length + FOLD_SCENARIOS.length,
    edges: EDGE_CASES.length,
    heldOut: HELD_OUT_CASES.length,
    operationLevel: fieldGoldRows().filter((row) => row.operations && row.gold === 'complete').length,
    duplicates: ids.length - new Set(ids).size,
  };
}
