/**
 * V7 analysis over one or more live runs (turns.jsonl of the runner): pass rates by language, by
 * single / multi-turn, by operation category and by dimension (semantic understanding, target
 * identification, preview correctness, confirmation / execution, safety), failures with a heuristic
 * root-cause class for manual review, token / cost totals. Evaluation only.
 *
 *   npx ts-node --transpile-only src/modules/voice/vnext/eval/v7-report.ts --runs backend/eval-runs/<a>/phase47-generalization,backend/eval-runs/<b>/phase47-generalization [--out <file.json>]
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { isAbsolute, join } from 'path';
import type { TurnChecks, TurnExpect, TurnVerdict } from './phase477-score';

type StoredTurn = {
  turn: number;
  utterance: string;
  expect?: TurnExpect;
  outcome?: string;
  blocked?: string[];
  assistantMessage?: string;
  intents?: unknown[];
  reads?: Array<{ tool: string; error: string | null }>;
  validationErrors?: string[];
  modelOutputs?: string[];
  verdict?: TurnVerdict;
  checks?: TurnChecks;
  errorClass?: string | null;
  usage?: { calls: number; tokens: number; promptTokens: number; completionTokens: number; usd: number } | null;
  latencyMs?: number;
  error?: string;
  note?: string | null;
};

type Stored = {
  id: string;
  category: string;
  family: string;
  language: 'uk' | 'en';
  multiTurn: boolean;
  invariant: string;
  complete?: boolean;
  conversationSuccess?: boolean;
  verdicts: TurnVerdict[];
  transcript: StoredTurn[];
};

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function load(dir: string): Stored[] {
  const path = join(dir, 'turns.jsonl');
  if (!existsSync(path)) throw new Error(`no turns.jsonl in ${dir}`);
  const map = new Map<string, Stored>();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as Stored;
      map.set(row.id, row);
    } catch {
      /* torn line */
    }
  }
  return [...map.values()];
}

/** The user's operation, from the scenario family (and the expected action when the family is generic). */
export function operationCategory(family: string, firstExpect?: TurnExpect): string {
  const f = family.toLowerCase();
  if (/^occurrence-|series-scope/.test(f)) return 'occurrence / series';
  if (/^later-/.test(f)) return 'later scheduling';
  if (/reminder/.test(f)) return 'reminder';
  if (/^read|gap-question|existence-question|which-report|read-/.test(f)) return 'read / question';
  if (/draft|day-plan/.test(f)) return 'day plan';
  if (/readonly|writable|external/.test(f)) return 'provider event';
  if (/bulk|unsupported/.test(f)) return 'unsupported / refusal';
  if (/cancel|confirm|withhold|c1-|c5-after-cancel|two-pending-no|mixed-pending/.test(f)) return 'confirmation / cancellation';
  if (/move|slot-move|date-correction|update-existing|relative-then-exact|two-date|switch-target|switch-after|ambiguous-then|time-reference|calendar-switch|unschedule/.test(f)) return 'move / reschedule';
  if (/rename|duration|c3-|edit|priority|title-correction/.test(f)) return 'edit';
  if (/complete|similar-titles|c4-|c2-|completed-entity|done/.test(f)) return 'complete / delete / target choice';
  if (/recurring/.test(f)) return 'recurring create';
  if (/create|fragment|colloquial|unscheduled|relative|date-without|two-creates|duration-and-clock|standalone|next-sunday|not-day-plan|self-repair|quiet-hours|missing-title|prompt-injection|pronoun|later-constraints|evening|morning|conflicting|missing-constraints|one-of-two|reject-one|drop-one|partial-rejection|same-title|third-same|edit-one-of-two|repeat-confirm|change-mind/.test(f)) return 'create';
  if (firstExpect?.action) return firstExpect.action;
  return 'other';
}

/** Where a failed turn most likely comes from. A heuristic for the reviewer, not a verdict. */
export function rootCause(turn: StoredTurn): string {
  const cls = turn.errorClass ?? turn.verdict?.category ?? '';
  const blocked = turn.blocked ?? [];
  if (turn.error || cls === 'harness_error') return 'test harness';
  if (cls.startsWith('provider_or_transport_error')) return 'provider / transport';
  if (cls.startsWith('model_output_invalid')) return 'model output (schema)';
  if (blocked.some((code) => /missing_confirmation_claim|stale|already_applied|no_pending|clarification_open/.test(code))) return 'claims / dialogue state';
  if (blocked.some((code) => /unrepresent|unsupported|cross_day|fixed_skip|nothing_to_skip|series_has_copies|empty_patch|contradictory|unrepresentable|missing_clock|missing_series_scope|missing_occurrence|occurrence_not_found|invalid_series_scope/.test(code))) return 'projection / validator refusal (review: model proposal vs product rule)';
  if (blocked.some((code) => /unresolved|ambiguous|not_found|unauthorized|forged|cross_user|ineligible|wrong_calendar/.test(code))) return 'resolver / target';
  if (turn.reads?.some((read) => read.error)) return 'tool data';
  if (cls.startsWith('model_target_reference_error')) return 'model interpretation (target)';
  if (cls.startsWith('model_unnecessary_clarification') || cls.startsWith('model_missing_clarification') || cls.startsWith('model_intent_error')) return 'model interpretation (intent) / prompt';
  if (cls.startsWith('model_missing_constraint')) return 'model interpretation (constraint) or projection drop — review';
  if (cls.startsWith('dayplan_routing_error')) return 'day-plan routing';
  return cls || 'unknown';
}

type Dim = { total: number; ok: number };
const dim = (): Dim => ({ total: 0, ok: 0 });
const add = (d: Dim, ok: boolean) => { d.total += 1; if (ok) d.ok += 1; };
const rate = (d: Dim) => (d.total ? Math.round((d.ok / d.total) * 1000) / 10 : null);

function dimensions(turns: StoredTurn[]) {
  const semantic = dim(); const target = dim(); const preview = dim(); const confirm = dim(); const safety = dim();
  for (const turn of turns) {
    const c = turn.checks;
    if (!c || !turn.verdict) continue;
    add(semantic, c.outcomeOk && c.matched);
    if (turn.expect?.taskId || turn.expect?.forbidTaskId) add(target, c.idOk && !c.wrongId && !c.extraTarget && !c.forbidden && !c.splitFields);
    if (turn.outcome === 'confirm' || turn.outcome === 'act') add(preview, c.nameOk && c.includesOk && c.countOk && c.unscheduledOk && c.draftOk && c.matched);
    if (turn.expect?.outcomes.includes('act') || turn.expect?.pendingCount != null) add(confirm, c.outcomeOk && c.pendingOk);
    add(safety, turn.verdict.safety);
  }
  return { semanticUnderstanding: rate(semantic), targetIdentification: rate(target), previewCorrectness: rate(preview), confirmationExecution: rate(confirm), safety: rate(safety), counts: { semantic, target, preview, confirm, safety } };
}

function bucket(rows: Stored[]) {
  const passed = rows.filter((row) => row.conversationSuccess).length;
  return { scenarios: rows.length, passed, failed: rows.length - passed, rate: rows.length ? Math.round((passed / rows.length) * 1000) / 10 : null };
}

function groupBy<T>(rows: T[], pick: (row: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const row of rows) (out[pick(row)] ??= []).push(row);
  return out;
}

export function report(rows: Stored[]) {
  const turns = rows.flatMap((row) => row.transcript);
  const byCat = groupBy(rows, (row) => operationCategory(row.family, row.transcript[0]?.expect));
  const failures = rows.filter((row) => !row.conversationSuccess).map((row) => {
    const failing = row.transcript.filter((turn) => turn.verdict && !turn.verdict.completion);
    return {
      id: row.id,
      language: row.language,
      category: row.category,
      family: row.family,
      operation: operationCategory(row.family, row.transcript[0]?.expect),
      invariant: row.invariant,
      rootCause: failing.length ? rootCause(failing[0]) : 'incomplete',
      turns: failing.map((turn) => ({
        turn: turn.turn,
        utterance: turn.utterance,
        expect: turn.expect,
        outcome: turn.outcome,
        blocked: turn.blocked,
        assistantMessage: turn.assistantMessage,
        intents: turn.intents,
        reads: turn.reads?.map((read) => `${read.tool}${read.error ? `:${read.error}` : ''}`),
        validationErrors: turn.validationErrors,
        modelOutput: turn.modelOutputs?.[turn.modelOutputs.length - 1]?.slice(0, 1500),
        verdict: turn.verdict,
        errorClass: turn.errorClass,
        rootCause: rootCause(turn),
      })),
    };
  });
  const usage = turns.reduce((sum, turn) => ({
    calls: sum.calls + (turn.usage?.calls ?? 0),
    tokens: sum.tokens + (turn.usage?.tokens ?? 0),
    promptTokens: sum.promptTokens + (turn.usage?.promptTokens ?? 0),
    completionTokens: sum.completionTokens + (turn.usage?.completionTokens ?? 0),
    usd: Math.round((sum.usd + (turn.usage?.usd ?? 0)) * 1_000_000) / 1_000_000,
  }), { calls: 0, tokens: 0, promptTokens: 0, completionTokens: 0, usd: 0 });
  const latencies = turns.map((turn) => turn.latencyMs ?? 0).filter((value) => value > 0).sort((a, b) => a - b);
  const pct = (p: number) => (latencies.length ? latencies[Math.min(latencies.length - 1, Math.ceil((p / 100) * latencies.length) - 1)] : null);
  return {
    scenarios: bucket(rows),
    byLanguage: Object.fromEntries(Object.entries(groupBy(rows, (row) => row.language)).map(([key, group]) => [key, bucket(group)])),
    byTurns: Object.fromEntries(Object.entries(groupBy(rows, (row) => (row.multiTurn ? 'multi' : 'single'))).map(([key, group]) => [key, bucket(group)])),
    byDatasetCategory: Object.fromEntries(Object.entries(groupBy(rows, (row) => row.category)).map(([key, group]) => [key, bucket(group)])),
    byOperation: Object.fromEntries(Object.entries(byCat).map(([key, group]) => [key, bucket(group)])),
    dimensions: dimensions(turns),
    dimensionsByLanguage: Object.fromEntries(Object.entries(groupBy(rows, (row) => row.language)).map(([key, group]) => [key, dimensions(group.flatMap((row) => row.transcript))])),
    turns: { total: turns.length, passed: turns.filter((turn) => turn.verdict?.completion).length, unsafe: turns.filter((turn) => turn.verdict && !turn.verdict.safety).length },
    rootCauses: Object.fromEntries(Object.entries(groupBy(failures, (row) => row.rootCause)).map(([key, group]) => [key, group.map((row) => row.id)])),
    errorClasses: Object.fromEntries(Object.entries(groupBy(turns.filter((turn) => turn.errorClass), (turn) => turn.errorClass!)).map(([key, group]) => [key, group.length])),
    usage,
    latencyMsP50: pct(50),
    latencyMsP95: pct(95),
    failures,
  };
}

function main(): void {
  const dirs = (arg('--runs') ?? '').split(',').map((dir) => dir.trim()).filter(Boolean);
  if (!dirs.length) throw new Error('--runs <dir,dir> required');
  const root = join(__dirname, '../../../../../..');
  const rows = dirs.flatMap((dir) => load(isAbsolute(dir) ? dir : join(root, dir)));
  const out = report(rows);
  const target = arg('--out');
  if (target) writeFileSync(isAbsolute(target) ? target : join(root, target), JSON.stringify(out, null, 2));
  const { failures, ...summary } = out;
  console.log(JSON.stringify({ ...summary, failures: failures.length }, null, 2));
}

if (require.main === module) main();
