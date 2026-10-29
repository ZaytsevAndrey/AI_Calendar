import { createHash } from 'crypto';
import { EVALUATION, type EvalClass } from '../../../../../benchmark/evaluation';
import { FOLD_SCENARIOS } from '../../../../../benchmark/fold-experiment/scenarios';
import { BENCH_SCENARIOS } from '../../../../../benchmark/voice-regression/scenarios';

export const ORIGINAL_ID_HASH = '262ec8a3fd46a26ef7b0d6ec05caacefd96e476b33df4ba062f3d59e6cddeb85';

export type SemanticAnnotation = {
  caseId: string;
  source: 'voice-regression' | 'fold-experiment';
  evalClass: EvalClass | 'missing';
  historicalScorer: 'planner-stem';
  useAsSemanticOracle: false;
  adjudication: 'pending-human' | 'spec-note-only';
  contractNote: string;
};

function adjudication(evalClass: EvalClass | 'missing'): SemanticAnnotation['adjudication'] {
  if (evalClass === 'ambiguous' || evalClass === 'unsettled' || evalClass === 'manual') return 'pending-human';
  return 'spec-note-only';
}

/** Points at the original gold. Does not copy it into a semantic oracle and does not edit it. */
export function originalSemanticAnnotations(): SemanticAnnotation[] {
  const voice = BENCH_SCENARIOS.map((scenario) => ({
    caseId: scenario.id,
    source: 'voice-regression' as const,
    evalClass: EVALUATION[scenario.id] ?? 'missing',
    historicalScorer: 'planner-stem' as const,
    useAsSemanticOracle: false as const,
    adjudication: adjudication(EVALUATION[scenario.id] ?? 'missing'),
    contractNote: scenario.contractNote,
  }));
  const fold = FOLD_SCENARIOS.map((scenario) => ({
    caseId: scenario.id,
    source: 'fold-experiment' as const,
    evalClass: EVALUATION[scenario.id] ?? 'missing',
    historicalScorer: 'planner-stem' as const,
    useAsSemanticOracle: false as const,
    adjudication: adjudication(EVALUATION[scenario.id] ?? 'missing'),
    contractNote: scenario.note,
  }));
  return [...voice, ...fold];
}

export function originalIdHash(): string {
  const ids = [...BENCH_SCENARIOS.map((scenario) => scenario.id), ...FOLD_SCENARIOS.map((scenario) => scenario.id)];
  return createHash('sha256').update(ids.join('\n')).digest('hex');
}
