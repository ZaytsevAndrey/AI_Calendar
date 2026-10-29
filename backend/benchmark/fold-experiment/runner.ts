/**
 * Isolated fold experiment runner.
 *
 *   npx ts-node --transpile-only benchmark/fold-experiment/runner.ts
 *     synthetic checks and the token estimate. No model call.
 *
 *   npx ts-node --transpile-only benchmark/fold-experiment/runner.ts --confirm-llm
 *     B0, B1, and B2 on the 16 scenarios. Does not write the voice-regression files.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { buildPlannerPromptB } from '../../.tmp/planner-ab.prompt';
import { parsePlannerDecision, type PlannerDecision } from '../../src/modules/voice/voice-agent.planner';
import type { VoiceToolCall } from '../../src/modules/voice/voice-agent.tools';
import { executeTool, userPrompt } from '../voice-regression/world';
import { buildFoldPrompt, type FoldArm } from './prompts';
import { FOLD_SCENARIOS, type FoldScenario } from './scenarios';
import { stemHits } from '../stem-match';
import { operationScoreText, operationUnit, parseFoldRaw, scoreChannel, type ChannelScore, type ScoreText } from './score';

const ARMS: FoldArm[] = ['B0', 'B1', 'B2'];
const MAX_TOOL_ROUNDS = 2;
const MAX_TOOL_CALLS = 6;

function pace(system: string, user: string): number {
  return Math.ceil((system.length + user.length) / 3.5) + 800;
}

function expect(failures: string[], label: string, score: ChannelScore, verdict: ChannelScore['verdict']): void {
  if (score.verdict !== verdict) failures.push(`${label} ${score.verdict} expected ${verdict}`);
}

function channel(scenario: FoldScenario, units: ScoreText[], type: string, outcome?: string): ChannelScore {
  return scoreChannel(scenario, units, { type, outcome, json: true });
}

function synthetic(): string[] {
  const failures: string[] = [];
  const scenario = (id: string) => {
    const found = FOLD_SCENARIOS.find((item) => item.id === id);
    if (!found) throw new Error(`missing ${id}`);
    return found;
  };
  const tickets = scenario('date-tickets');
  expect(failures, 'folded tickets', channel(tickets, ['Замов квитки на поїзд на п\'ятницю'], 'steps'), 'pass');
  const split = channel(tickets, ['Замов квитки на поїзд', 'перенеси їх на п\'ятницю'], 'steps');
  expect(failures, 'split tickets', split, 'fail');
  if (split.count !== 'fail' || split.dependencies !== 'fail') failures.push('split tickets was not failed by the fold');
  const yoga = scenario('several-yoga');
  expect(failures, 'yoga with today', channel(yoga, ['Запиши йогу на сьогодні на завтра на дев\'яту на сорок п\'ять хвилин'], 'steps'), 'fail');
  const kept = channel(yoga, ['Запиши йогу на сьогодні на завтра на дев\'яту на сорок п\'ять хвилин'], 'steps');
  if (kept.count !== 'pass' || kept.cancelled !== 'fail') failures.push('a right count hid the cancelled day');
  expect(failures, 'yoga without clock', channel(yoga, ['Запиши йогу на завтра на сорок п\'ять хвилин'], 'steps'), 'fail');
  expect(failures, 'yoga final', channel(yoga, ['Запиши йогу на завтра на дев\'яту на сорок п\'ять хвилин'], 'steps'), 'pass');
  expect(failures, 'curly friday', channel(tickets, ['Замов квитки на поїзд на п’ятницю'], 'steps'), 'pass');
  if (stemHits('19:00', '9:00') || stemHits('09:00', '9:00')) failures.push('a shorter clock matched inside a longer one');
  if (!stemHits('9:00', '9:00') || !stemHits('16:00', '16')) failures.push('a clock token missed its own hour');
  if (!stemHits('2026-10-23', "п'ят") || stemHits('2026-10-11', '11')) failures.push('an ISO date was not read as a date');
  const friday = channel(tickets, [operationScoreText({ object: 'квитки на поїзд', action: 'create', final: { day: '2026-10-23' } })], 'steps');
  expect(failures, 'iso friday', friday, 'pass');
  const budgets = channel(scenario('same-budget'), [
    operationScoreText({ object: 'новий бюджет', action: 'create' }),
    operationScoreText({ object: 'старий бюджет', action: 'delete' }),
  ], 'steps');
  expect(failures, 'delete action', budgets, 'pass');
  const withdrawn = parseFoldRaw('{"type":"final","outcome":"answer","assistantMessage":"Гаразд, нічого не додаю."}');
  if (!withdrawn.json || withdrawn.operations.length) failures.push('a final decision required operations');
  const stepsWithout = parseFoldRaw('{"type":"steps","segments":[{"text":"Замов квитки"}]}');
  if (stepsWithout.json) failures.push('steps without operations counted as the experiment shape');
  expect(failures, 'draft withdrawn', channel(scenario('delete-draft'), [], 'final', 'answer'), 'pass');
  expect(failures, 'draft split', channel(scenario('delete-draft'), ['Створи чернетку листа', 'Видали чернетку листа'], 'steps'), 'fail');
  const bread = scenario('independent-bread');
  expect(failures, 'bread apart', channel(bread, ['Додай хліб', 'Перенеси нараду на п\'ятницю'], 'steps'), 'pass');
  expect(failures, 'bread merged', channel(bread, ['Додай хліб і перенеси нараду на п\'ятницю'], 'steps'), 'fail');
  expect(failures, 'bare kept', channel(scenario('pronoun-bare'), ['Перенеси це на вечір'], 'steps'), 'pass');
  expect(failures, 'bare substituted', channel(scenario('pronoun-bare'), ['Перенеси Звіт на вечір'], 'steps'), 'fail');
  expect(failures, 'bare evening clock', channel(scenario('pronoun-bare'), ['Перенеси це на 18:00'], 'steps'), 'fail');
  expect(failures, 'length invented', channel(scenario('existing-length'), ['Нарада на півтори години сьогодні о 9'], 'steps'), 'fail');
  expect(failures, 'length copy', channel(scenario('existing-length'), ['Зроби нараду на півтори години'], 'steps'), 'pass');
  expect(failures, 'length create', channel(scenario('existing-length'), ['Створи нову нараду на півтори години'], 'steps'), 'review');
  expect(failures, 'both as create', channel(scenario('existing-both'), ['Створи нараду на п\'ятницю на півтори години'], 'steps'), 'fail');
  expect(failures, 'budget kept', channel(scenario('same-budget'), ['Створи новий бюджет', 'Видали старий бюджет'], 'steps'), 'pass');
  expect(failures, 'budget lost old', channel(scenario('same-budget'), ['Створи новий бюджет', 'Видали бюджет'], 'steps'), 'fail');
  expect(failures, 'budget synonym', channel(scenario('same-budget'), ['Створи новий бюджет', 'Прибери старий бюджет'], 'steps'), 'pass');
  expect(failures, 'draft names report', channel(scenario('delete-draft'), [], 'final', 'answer'), 'pass');
  const named = scoreChannel(scenario('delete-draft'), [], { type: 'final', outcome: 'answer', json: true, spoken: 'Видаляю звіт.' });
  expect(failures, 'draft spoken report', named, 'fail');
  if (!stemHits("з дев'ятої", '09:00') || !stemHits('Скасуй нараду', 'видал') || !stemHits('з 08:00 до 23:00', 'весь день')) {
    failures.push('an accepted equivalent did not match');
  }
  if (stemHits('Перенеси сценарій', 'це')) failures.push('це matched inside another word');
  expect(failures, 'laundry withdrawn', channel(scenario('cancel-laundry'), [], 'final', 'answer'), 'pass');
  expect(failures, 'laundry kept', channel(scenario('cancel-laundry'), ['Додай прання'], 'steps'), 'fail');
  const many = scenario('pronoun-taxi-meeting');
  expect(failures, 'hour unresolved', channel(many, ['Додай таксі', 'Перенеси нараду на п\'ятницю', 'зроби його на годину'], 'steps'), 'review');
  expect(failures, 'hour on taxi', channel(many, ['Додай таксі на годину', 'Перенеси нараду на п\'ятницю'], 'steps'), 'review');
  expect(failures, 'meeting dropped', channel(many, ['Додай таксі на годину'], 'steps'), 'fail');
  const ops = scoreChannel(tickets, [operationUnit({ object: 'квитки на поїзд', final: { day: 'п\'ятницю' } })], { type: 'steps', json: true });
  const segs = scoreChannel(tickets, ['Замов квитки на поїзд', 'перенеси їх на п\'ятницю'], { type: 'steps', json: true });
  expect(failures, 'b2 operations', ops, 'pass');
  expect(failures, 'b2 segments', segs, 'fail');
  if (ops.verdict === 'pass' && segs.verdict === 'pass') failures.push('operations and segments were not scored apart');
  const broken = scoreChannel(tickets, [], { type: 'steps', json: false });
  expect(failures, 'broken json', broken, 'fail');
  return failures;
}

function assertStructure(): string[] {
  const failures: string[] = [];
  if (FOLD_SCENARIOS.length !== 16) failures.push(`expected 16 scenarios, got ${FOLD_SCENARIOS.length}`);
  const kinds = new Set(FOLD_SCENARIOS.map((scenario) => scenario.kind));
  if (kinds.size !== 16) failures.push(`expected 16 kinds, got ${kinds.size}`);
  const ids = new Set(FOLD_SCENARIOS.map((scenario) => scenario.id));
  if (ids.size !== FOLD_SCENARIOS.length) failures.push('duplicate scenario id');
  const b0 = buildFoldPrompt('B0');
  const b1 = buildFoldPrompt('B1');
  const b2 = buildFoldPrompt('B2');
  if (b0 !== buildPlannerPromptB()) failures.push('B0 is not the current Planner B');
  if (b1 === b0 || b2 === b0 || b2 === b1) failures.push('experiment prompts did not diverge');
  const orderAt = b1.indexOf('Decide in this order');
  const segmentAt = b1.indexOf('A segment is written only after that order');
  if (orderAt < 0 || segmentAt < 0 || orderAt > segmentAt) failures.push('B1 does not put the decision order before the segment');
  if (b2.includes('Decide in this order')) failures.push('B2 includes the B1 reorder');
  if (b1.includes('"operations"')) failures.push('B1 changes the JSON contract');
  if (!b2.includes('"operations"') || !b2.includes('Do not add a reasoning field')) failures.push('B2 is missing the experiment operations');
  if (!b0.includes('A later move, clock, or length that settles on the create')) failures.push('B0 lost the current move rule');
  if (b1.includes('молок') || b2.includes('молок')) failures.push('an experiment prompt uses a milk example');
  const sample = userPrompt({ utterance: 'Замов квитки' });
  if (!sample.includes('2026-10-18')) failures.push('the user prompt lost the fixed clock');
  failures.push(...synthetic());
  return failures;
}

function estimate() {
  const prompts = {
    B0: buildFoldPrompt('B0'),
    B1: buildFoldPrompt('B1'),
    B2: buildFoldPrompt('B2'),
  };
  const rows = FOLD_SCENARIOS.map((scenario) => {
    const user = userPrompt({ utterance: scenario.utterance });
    return {
      id: scenario.id,
      kind: scenario.kind,
      B0: pace(prompts.B0, user),
      B1: pace(prompts.B1, user),
      B2: pace(prompts.B2, user),
    };
  });
  const paceTokens = rows.reduce((sum, row) => sum + row.B0 + row.B1 + row.B2, 0);
  return {
    scenarios: FOLD_SCENARIOS.length,
    arms: ARMS.length,
    calls: FOLD_SCENARIOS.length * ARMS.length,
    chars: { B0: prompts.B0.length, B1: prompts.B1.length, B2: prompts.B2.length },
    paceTokens,
    likelyTokens: Math.round(paceTokens * 0.73),
    kinds: [...new Set(FOLD_SCENARIOS.map((scenario) => scenario.kind))],
  };
}

async function runLive(): Promise<void> {
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../../src/app.module');
  const { GroqClient } = await import('../../src/modules/voice/groq.client');
  process.env.VOICE_EVAL_PACE = '1';
  process.env.VOICE_DAILY_TOKEN_LIMIT = '0';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const groq = app.get(GroqClient);
  const prompts = { B0: buildFoldPrompt('B0'), B1: buildFoldPrompt('B1'), B2: buildFoldPrompt('B2') };
  const rows: unknown[] = [];
  try {
    for (const scenario of FOLD_SCENARIOS) {
      const row: Record<string, unknown> = { id: scenario.id, kind: scenario.kind, utterance: scenario.utterance };
      for (const arm of ARMS) {
        const toolCalls: Array<{ name: string; args?: Record<string, unknown> }> = [];
        const toolResults: Array<{ name: string; result: unknown }> = [];
        const rounds: Array<{ round: number; raw: string | null; error: string | null }> = [];
        let raw = '';
        let fault: string | undefined;
        for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
          const user = userPrompt({ utterance: scenario.utterance, toolResults });
          try {
            raw = await groq.completeJson(prompts[arm], user, { role: 'planner', label: `fold.${arm}.${scenario.id}.r${round}` });
          } catch (error) {
            fault = error instanceof Error ? error.message : 'fault';
            rounds.push({ round, raw: null, error: fault });
            break;
          }
          rounds.push({ round, raw, error: null });
          let decision: PlannerDecision;
          try {
            decision = parsePlannerDecision(raw);
          } catch {
            break;
          }
          if (decision.type !== 'tools') break;
          if (!decision.calls.length || decision.calls.length > MAX_TOOL_CALLS || round === MAX_TOOL_ROUNDS) {
            fault = 'tool limit';
            break;
          }
          for (const call of decision.calls as VoiceToolCall[]) {
            const result = executeTool('default', call);
            toolCalls.push({ name: call.name, args: call.args });
            toolResults.push({ name: call.name, result });
          }
        }
        const parsed = raw ? parseFoldRaw(raw) : parseFoldRaw('{}');
        if (fault) parsed.json = false;
        const decision = { type: parsed.type, outcome: parsed.outcome, json: arm === 'B2' ? parsed.json : parsed.production && !fault };
        row[arm] = {
          rounds,
          toolCalls,
          productionJson: parsed.production,
          segments: scoreChannel(scenario, parsed.segments, { ...decision, json: parsed.production && !fault }),
          operations: arm === 'B2'
            ? scoreChannel(scenario, parsed.operations.map(operationScoreText), decision)
            : null,
        };
      }
      rows.push(row);
      console.log(JSON.stringify({ id: scenario.id }));
    }
  } finally {
    const spends = groq.evalSpends().map((item) => ({ ...item }));
    const file = join(__dirname, 'last-run.json');
    mkdirSync(__dirname, { recursive: true });
    writeFileSync(file, JSON.stringify({
      calls: spends.length,
      totalTokens: spends.reduce((sum, item) => sum + item.tokens, 0),
      spends,
      rows,
    }, null, 2));
    console.log(JSON.stringify({ calls: spends.length, file }));
    await app.close();
  }
}

function rescoreSaved(): void {
  const saved = JSON.parse(readFileSync(join(__dirname, 'last-run.json'), 'utf8')) as {
    calls: number;
    totalTokens: number;
    rows: Array<Record<string, unknown>>;
  };
  const rows = saved.rows.map((row) => {
    const scenario = FOLD_SCENARIOS.find((item) => item.id === row.id);
    if (!scenario) throw new Error(`missing ${String(row.id)}`);
    const scored: Record<string, unknown> = { id: row.id, kind: row.kind, utterance: row.utterance };
    for (const arm of ARMS) {
      const prior = row[arm] as {
        rounds: Array<{ raw: string | null }>;
        segments: { verdict: string };
        operations: { verdict: string } | null;
      };
      const raw = [...prior.rounds].reverse().find((round) => round.raw)?.raw ?? '';
      const parsed = raw ? parseFoldRaw(raw) : parseFoldRaw('{}');
      const decision = { type: parsed.type, outcome: parsed.outcome, json: arm === 'B2' ? parsed.json : parsed.production };
      scored[arm] = {
        previous: { segments: prior.segments.verdict, operations: prior.operations?.verdict ?? null },
        segments: scoreChannel(scenario, parsed.segments, { ...decision, json: parsed.production }),
        operations: arm === 'B2' ? scoreChannel(scenario, parsed.operations.map(operationScoreText), decision) : null,
        segmentText: parsed.segments,
        operationText: parsed.operations.map((operation) => ({
          action: operation.action,
          object: operation.object,
          final: operation.final,
        })),
      };
    }
    return scored;
  });
  const file = join(__dirname, 'fold-rescore.json');
  writeFileSync(file, JSON.stringify({
    source: 'last-run.json',
    calls: saved.calls,
    totalTokens: saved.totalTokens,
    rows,
  }, null, 2));
  console.log(JSON.stringify({ rescored: rows.length, file }));
}

function main(): void {
  const failures = assertStructure();
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
  console.log(JSON.stringify({ selfCheck: 'pass', estimate: estimate() }, null, 2));
  if (process.argv.includes('--rescore')) {
    rescoreSaved();
    return;
  }
  if (process.argv.includes('--confirm-llm')) {
    runLive().catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
  }
}

main();
