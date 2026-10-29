/**
 * Semantic axes for the fold experiment.
 * Segment count is one axis. A pass requires the other axes too.
 * B2 operations are scored with the same axes, not with a looser bar.
 */
import { parsePlannerDecision } from '../../src/modules/voice/voice-agent.planner';
import { MAX_SEGMENTS } from '../../src/modules/voice/voice-agent.planner.prompt';
import { actionClash, anyStem, groupHits, inventedDays, inventedHours, stemHits, surplusWords } from '../stem-match';
import type { FoldScenario } from './scenarios';

export type Axis = 'pass' | 'fail' | 'review' | 'na';

export type ChannelScore = {
  objects: Axis;
  dependencies: Axis;
  independent: Axis;
  params: Axis;
  cancelled: Axis;
  invented: Axis;
  count: Axis;
  decision: Axis;
  json: Axis;
  target: Axis;
  /** Closed verb set only. Unlisted verbs stay na and do not count as understood. */
  action: Axis;
  verdict: 'pass' | 'fail' | 'review';
};

export type ScoreText = string | { text: string; action?: string };

export type FoldOperation = {
  id?: string;
  object?: string;
  action?: string;
  dependsOn?: string | null;
  final?: Record<string, unknown>;
};

export type ParsedFold = {
  json: boolean;
  production: boolean;
  type?: string;
  outcome?: string;
  segments: string[];
  operations: FoldOperation[];
  error?: string;
};

export function operationUnit(operation: FoldOperation): string {
  const final = operation.final && typeof operation.final === 'object'
    ? Object.values(operation.final).filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  return [operation.object ?? '', ...final].filter(Boolean).join(' ');
}

export function operationScoreText(operation: FoldOperation): ScoreText {
  return {
    text: operationUnit(operation),
    action: typeof operation.action === 'string' ? operation.action : undefined,
  };
}

export function parseFoldRaw(raw: string): ParsedFold {
  let production = false;
  let type: string | undefined;
  let outcome: string | undefined;
  let segments: string[] = [];
  try {
    const decision = parsePlannerDecision(raw);
    production = true;
    type = decision.type;
    if (decision.type === 'steps') segments = decision.segments;
    if (decision.type === 'final') {
      outcome = decision.outcome;
      segments = [];
    }
  } catch (error) {
    production = false;
    type = undefined;
    segments = [];
    outcome = undefined;
    void error;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!type && typeof parsed.type === 'string') type = parsed.type;
    if (!outcome && typeof parsed.outcome === 'string') outcome = parsed.outcome;
    if (!segments.length && Array.isArray(parsed.segments)) {
      segments = parsed.segments.map((row) => {
        if (typeof row === 'string') return row.trim();
        const text = row && typeof row === 'object' ? (row as { text?: unknown }).text : '';
        return typeof text === 'string' ? text.trim() : '';
      }).filter(Boolean);
    }
    const rawOperations = parsed.operations;
    const listed = Array.isArray(rawOperations);
    const operations: FoldOperation[] = listed
      ? rawOperations.filter((row): row is FoldOperation => Boolean(row) && typeof row === 'object')
      : [];
    const malformed = operations.some((row) => typeof row.object !== 'string' || typeof row.action !== 'string');
    const withdrawn = type === 'final' && !listed;
    const shaped = malformed || (!listed && !withdrawn);
    return {
      json: !shaped,
      production,
      type,
      outcome,
      segments,
      operations,
      error: shaped ? 'operations are missing object or action' : undefined,
    };
  } catch (error) {
    return {
      json: false,
      production,
      type,
      outcome,
      segments,
      operations: [],
      error: error instanceof Error ? error.message : 'invalid json',
    };
  }
}

export function scoreChannel(
  scenario: FoldScenario,
  units: ScoreText[],
  decision: { type?: string; outcome?: string; json: boolean; spoken?: string },
): ChannelScore {
  const rows = units.map(asUnit);
  const blob = rows.map((row) => row.text).join('\n');
  const spoken = decision.spoken ?? '';
  const objects: Axis = scenario.objects.every((group) => rows.some((row) => hits(row, [group])) || hitsText(blob, [group])) ? 'pass' : 'fail';
  const foldUnit = scenario.fold
    ? rows.find((row) => hasAny(row, scenario.fold!.object) && scenario.fold!.params.every((group) => hasAny(row, group)))
    : undefined;
  const dependencies: Axis = scenario.fold ? (foldUnit ? 'pass' : 'fail') : 'na';
  const params: Axis = paramsAxis(scenario, rows, blob, foldUnit);
  const independent: Axis = scenario.separate && (separateOk(scenario, rows) && !strayUnits(scenario, rows).length) ? 'pass' : (scenario.separate ? 'fail' : 'na');
  const cancelled: Axis = banned(scenario.utterance, rows, blob, spoken, scenario.cancelled) ? 'fail' : 'pass';
  const listedInvention = banned(scenario.utterance, rows, blob, spoken, scenario.invented);
  const calendarInvention = rows.some((row) => inventedHours(scenario.utterance, row.text).length > 0 || inventedDays(scenario.utterance, row.text).length > 0);
  const invented: Axis = listedInvention || calendarInvention ? 'fail' : 'pass';
  let count: Axis = scenario.count === undefined ? 'na' : (units.length === scenario.count ? 'pass' : 'fail');
  if (units.length > MAX_SEGMENTS) count = 'fail';
  const decisionAxis: Axis = decision.type === scenario.decision && (!scenario.outcome || decision.outcome === scenario.outcome) ? 'pass' : 'fail';
  const target: Axis = targetAxis(scenario, rows, blob);
  const action: Axis = rows.some((row) => actionClash(scenario.utterance, row.text)) ? 'fail' : 'na';
  const allowed = [
    ...scenario.objects.flat(),
    ...scenario.fold?.object ?? [],
    ...(scenario.fold?.params ?? []).flat(),
    ...(scenario.separate ?? []).flatMap((part) => part.must.flat()),
    ...(scenario.present ?? []).flat(),
    ...scenario.cancelled,
  ];
  const surplus = rows.flatMap((row) => surplusWords(scenario.utterance, row.text, allowed));
  const score: ChannelScore = {
    objects,
    dependencies,
    independent,
    params,
    cancelled,
    invented,
    count,
    decision: decisionAxis,
    json: decision.json ? 'pass' : 'fail',
    target,
    action,
    verdict: 'pass',
  };
  const failed = Object.entries(score).some(([key, value]) => key !== 'verdict' && value === 'fail');
  score.verdict = failed ? 'fail' : (target === 'review' || surplus.length ? 'review' : 'pass');
  return score;
}

function banned(utterance: string, rows: Array<{ text: string; action?: string }>, blob: string, spoken: string, stems: string[]): boolean {
  if (rows.some((row) => hasAny(row, stems)) || anyStem(blob, stems)) return true;
  return stems.some((stem) => stem && !stemHits(utterance, stem) && stemHits(spoken, stem));
}

function paramsAxis(
  scenario: FoldScenario,
  rows: Array<{ text: string; action?: string }>,
  blob: string,
  foldUnit: { text: string; action?: string } | undefined,
): Axis {
  if (scenario.fold) {
    if (!foldUnit) return 'fail';
    if (scenario.fold.params.some((group) => !hasAny(foldUnit, group))) return 'fail';
  }
  if (scenario.present && scenario.present.some((group) => !hitsText(blob, [group]) && !rows.some((row) => hits(row, [group])))) return 'fail';
  if (!scenario.fold && !scenario.present) return 'na';
  return 'pass';
}

function separateUsed(scenario: FoldScenario, units: Array<{ text: string; action?: string }>): Set<number> | null {
  const used = new Set<number>();
  const matched = (scenario.separate ?? []).every((part) => {
    const index = units.findIndex((unit, at) => !used.has(at) && hits(unit, part.must) && !hasAny(unit, part.none ?? []));
    if (index < 0) return false;
    used.add(index);
    return true;
  });
  return matched ? used : null;
}

function separateOk(scenario: FoldScenario, units: Array<{ text: string; action?: string }>): boolean {
  return separateUsed(scenario, units) !== null;
}

function strayUnits(scenario: FoldScenario, units: Array<{ text: string; action?: string }>): Array<{ text: string; action?: string }> {
  const used = separateUsed(scenario, units);
  if (!used) return [];
  const param = scenario.targetReview?.param ?? [];
  const allowed = [
    ...scenario.objects.flat(),
    ...(scenario.fold?.params ?? []).flat(),
    ...(scenario.present ?? []).flat(),
  ];
  return units.filter((unit, index) => {
    if (used.has(index) || !unit.text.trim()) return false;
    const carries = param.length > 0
      && hasAny(unit, param)
      && inventedHours(scenario.utterance, unit.text).length === 0
      && surplusWords(scenario.utterance, unit.text, allowed).length === 0;
    return !carries;
  });
}

function targetAxis(scenario: FoldScenario, units: Array<{ text: string; action?: string }>, blob: string): Axis {
  if (!scenario.targetReview) return 'na';
  const present = anyStem(blob, scenario.targetReview.param) || units.some((unit) => hasAny(unit, scenario.targetReview!.param));
  return present ? 'review' : 'fail';
}

function asUnit(unit: ScoreText): { text: string; action?: string } {
  return typeof unit === 'string' ? { text: unit } : unit;
}

function hits(unit: { text: string; action?: string }, groups: string[][]): boolean {
  return groupHits(unit.text, groups, unit.action);
}

function hitsText(text: string, groups: string[][]): boolean {
  return groupHits(text, groups);
}

function hasAny(unit: { text: string; action?: string }, stems: string[]): boolean {
  return anyStem(unit.text, stems, unit.action);
}
