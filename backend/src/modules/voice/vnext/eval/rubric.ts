export type Verdict = 'pass' | 'fail' | 'review' | 'blocked';

export type RubricExpectation = {
  adjudication?: 'pending-human' | 'authored';
  outcome: 'answer' | 'clarify' | 'confirm' | 'act' | 'refuse';
  serverWrites: 0;
  forbidClock?: string;
  intentCount?: number;
  heldCount?: number;
  unscheduled?: boolean;
  durationMinutes?: number;
  includesDate?: string;
  excludesDate?: string;
  preservedLabel?: string;
  blockedIncludes?: string;
  questionIncludes?: string[];
};

export type RubricActual = {
  outcome: string;
  serverWrites: number;
  body: string;
  intentCount: number;
  heldCount: number;
  durationMinutes?: number;
  preservedLabels: string[];
  blocked: string[];
};

export function scoreCase(expected: RubricExpectation, actual: RubricActual): Verdict {
  if (expected.adjudication === 'pending-human') return 'review';
  if (actual.serverWrites !== 0 || expected.serverWrites !== 0) return 'fail';
  if (actual.outcome !== expected.outcome) return 'fail';
  if (expected.forbidClock && actual.body.includes(expected.forbidClock)) return 'fail';
  if (expected.intentCount != null && actual.intentCount !== expected.intentCount) return 'fail';
  if (expected.heldCount != null && actual.heldCount !== expected.heldCount) return 'fail';
  if (expected.durationMinutes != null && actual.durationMinutes !== expected.durationMinutes) return 'fail';
  if (expected.includesDate && !actual.body.includes(expected.includesDate)) return 'fail';
  if (expected.excludesDate && actual.body.includes(expected.excludesDate)) return 'fail';
  if (expected.preservedLabel && !actual.preservedLabels.includes(expected.preservedLabel)) return 'fail';
  if (expected.blockedIncludes && !actual.blocked.includes(expected.blockedIncludes)) return 'fail';
  if (expected.unscheduled && !actual.body.includes('"isUnscheduled":true')) return 'fail';
  return 'pass';
}

export function tally(verdicts: Verdict[]): Record<Verdict, number> {
  return {
    pass: verdicts.filter((verdict) => verdict === 'pass').length,
    fail: verdicts.filter((verdict) => verdict === 'fail').length,
    review: verdicts.filter((verdict) => verdict === 'review').length,
    blocked: verdicts.filter((verdict) => verdict === 'blocked').length,
  };
}

export type PairedRow = { caseId: string; legacy: Verdict; A: Verdict; B: Verdict };

export function pairedReport(rows: PairedRow[]): { counts: Record<'legacy' | 'A' | 'B', Record<Verdict, number>>; reviewCountedAsPass: false } {
  return {
    counts: {
      legacy: tally(rows.map((row) => row.legacy)),
      A: tally(rows.map((row) => row.A)),
      B: tally(rows.map((row) => row.B)),
    },
    reviewCountedAsPass: false,
  };
}
