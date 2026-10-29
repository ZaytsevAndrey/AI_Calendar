/**
 * Entity-resolution experiment. Planner C2 plus a references field.
 *
 *   npx ts-node --transpile-only benchmark/entity-resolution/runner.ts
 *     static contract checks and the token estimate. No model call.
 *
 *   npx ts-node --transpile-only benchmark/entity-resolution/runner.ts --confirm-llm
 *     one arm, the nine locked fixtures. Writes run.json in this folder.
 *
 * Does not write production, Planner A/B/C/C2, scorers, or gold.
 */
import { createHash } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { buildPlannerPromptC2 } from '../../.tmp/planner-c2.prompt';
import { buildPlannerPromptER, REFERENCES_PARAGRAPH, restorePlannerC2 } from '../../.tmp/planner-er.prompt';
import { parsePlannerDecision } from '../../src/modules/voice/voice-agent.planner';
import type { VoiceToolCall } from '../../src/modules/voice/voice-agent.tools';
import { DEFAULT_DEEPSEEK_PLANNER_MODEL, deepseekPlannerCall } from '../../src/modules/voice/deepseek-planner';
import { FOLD_SCENARIOS } from '../fold-experiment/scenarios';
import { parseFoldRaw, scoreChannel } from '../fold-experiment/score';
import { BENCH_SCENARIOS } from '../voice-regression/scenarios';
import { scoreBench, type BenchTrace } from '../voice-regression/score';
import { CLOCK, executeTool, userPrompt } from '../voice-regression/world';
import { ENTITY_SAMPLE, type SampleExpect } from './expectations';
import {
  diagnose,
  scoreResolution,
  segmentConsistency,
  shapeErrors,
  type Reference,
} from './score-references';

const C2_SHA256 = '6a43727a2d4f77f62a7d87d185275ae4dc647a0e0358a2dbd24012f1cfb20c88';
const OUT_FILE = join(__dirname, 'run.json');
const SAVED_RAW = [
  join(__dirname, '..', 'voice-regression', 'last-run.json'),
  join(__dirname, '..', 'voice-regression', 'wave-1-ab.json'),
  join(__dirname, '..', 'voice-regression', 'wave-1-rescore.json'),
  join(__dirname, '..', 'fold-experiment', 'last-run.json'),
  join(__dirname, '..', 'fold-experiment', 'fold-rescore.json'),
  join(__dirname, '..', 'planner-b-control', 'b-control-run.json'),
  join(__dirname, '..', 'planner-bc', 'c-only-run.json'),
  join(__dirname, '..', 'planner-bc', 'c-only-subset-run.json'),
  join(__dirname, '..', 'planner-bc', 'c2-only-run.json'),
  join(__dirname, '..', 'planner-bc', 'c2-only-subset-run.json'),
  join(__dirname, '..', 'planner-bc', 'bc-run.json'),
];
const MAX_TOOL_ROUNDS = 2;
const MAX_TOOL_CALLS = 6;

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function pace(system: string, user: string): number {
  return Math.ceil((system.length + user.length) / 3.5) + 800;
}

function fixture(expect: SampleExpect) {
  if (expect.source === 'voice-regression') {
    const scenario = BENCH_SCENARIOS.find((item) => item.id === expect.id);
    if (!scenario || scenario.utterance !== expect.utterance) return null;
    return scenario;
  }
  const scenario = FOLD_SCENARIOS.find((item) => item.id === expect.id);
  if (!scenario || scenario.utterance !== expect.utterance) return null;
  return scenario;
}

function userFor(expect: SampleExpect, toolResults: Array<{ name: string; result: unknown }> = []): string {
  const scenario = fixture(expect);
  if (!scenario) throw new Error(`fixture drifted: ${expect.id}`);
  if (expect.source === 'fold-experiment') return userPrompt({ utterance: expect.utterance, toolResults });
  const voice = BENCH_SCENARIOS.find((item) => item.id === expect.id)!;
  return userPrompt({
    utterance: voice.utterance,
    history: voice.history,
    toolResults,
    pendingClarification: voice.pendingClarification,
    pendingConfirmSummary: voice.pendingConfirmSummary,
    planDraft: null,
  });
}

function contractChecks(c2: string, prompt: string): string[] {
  const failures: string[] = [];
  const fail = (label: string) => failures.push(label);
  if (hash(c2) !== C2_SHA256) fail('C2 hash drifted');
  if (restorePlannerC2(prompt) !== c2) fail('experiment prompt does not restore to C2');
  if (!prompt.includes('"references"') || !REFERENCES_PARAGRAPH.includes('null means the link is not determined')) {
    fail('references contract missing');
  }
  if (prompt.includes('"final":{"day"') || REFERENCES_PARAGRAPH.includes('"clock"') || REFERENCES_PARAGRAPH.includes('"duration"')) {
    fail('final parameters were added');
  }
  for (const word of ['молоко', 'його', 'йога', 'нарада', 'чернет']) {
    if (REFERENCES_PARAGRAPH.toLowerCase().includes(word)) fail(`example leaked: ${word}`);
  }
  if (REFERENCES_PARAGRAPH.includes('task-')) fail('calendar id in the references block');
  const withReferences = JSON.stringify({
    type: 'steps',
    answer: '',
    references: [{ id: 'm1', mention: 'молоко', entity: 'e1' }, { id: 'm2', mention: 'його', entity: null }],
    segments: [{ text: 'Купи молоко на завтра' }],
  });
  const withoutReferences = JSON.stringify({
    type: 'steps',
    answer: '',
    segments: [{ text: 'Купи молоко на завтра' }],
  });
  const parsed = parsePlannerDecision(withReferences);
  const parsedWithout = parsePlannerDecision(withoutReferences);
  if (JSON.stringify(parsed) !== JSON.stringify(parsedWithout)) fail('production parser kept references');
  if ('references' in parsed) fail('production decision exposes references');
  const ignored = {
    type: 'steps' as const,
    answer: '',
    segments: ['Купи молоко на завтра'],
  };
  if (JSON.stringify(parsed) !== JSON.stringify(ignored)) fail('production segments changed');

  const utterance = 'Купи молоко і перенеси його на завтра на десяту';
  const milk = ENTITY_SAMPLE[0];
  const good: Reference[] = [
    { id: 'm1', mention: 'молоко', entity: 'e1' },
    { id: 'm2', mention: 'його', entity: 'e1' },
  ];
  if (shapeErrors(utterance, good, 'steps').length) fail('stable local ids were rejected');
  if (shapeErrors(utterance, [{ id: 'm1', mention: 'молоко', entity: 'e1' }, { id: 'm1', mention: 'його', entity: 'e1' }], 'steps').length === 0) {
    fail('duplicate mention id was accepted');
  }
  if (!shapeErrors(utterance, [{ id: 'm1', mention: 'Нарада', entity: 'e1' }], 'steps').some((item) => item.startsWith('mention-not-in-utterance'))) {
    fail('mention outside the utterance was accepted');
  }
  if (!shapeErrors(utterance, [{ id: 'm1', mention: 'молоко', entity: 'task-zvit' }], 'steps').some((item) => item.startsWith('entity:'))) {
    fail('calendar id was accepted as entity');
  }
  if (!shapeErrors(utterance, [{ id: 'm1', mention: 'молоко', entity: 'm2' }], 'steps').some((item) => item.startsWith('entity:'))) {
    fail('mention id was accepted as entity');
  }
  const unique = scoreResolution(milk, 'steps', good);
  if (unique.verdict !== 'pass') fail(`unique link did not pass: ${unique.reasons.join(',')}`);
  const ducked = scoreResolution(milk, 'steps', [
    { id: 'm1', mention: 'молоко', entity: 'e1' },
    { id: 'm2', mention: 'його', entity: null },
  ]);
  if (ducked.verdict !== 'fail') fail('null on a unique antecedent was not a failure');
  const bare = ENTITY_SAMPLE.find((item) => item.id === 'pronoun-bare')!;
  const bareNull = scoreResolution(bare, 'steps', [{ id: 'm1', mention: 'це', entity: null }]);
  if (bareNull.verdict !== 'pass') fail('a reference with no antecedent must pass only when entity is null');
  const bareGuess = scoreResolution(bare, 'steps', [{ id: 'm1', mention: 'це', entity: 'e1' }]);
  if (bareGuess.verdict !== 'fail') fail('an invented link on an unresolved reference passed');
  const ambiguous = ENTITY_SAMPLE.find((item) => item.id === 'dep-pronoun-two-antecedents')!;
  const ambiguousRefs: Reference[] = [
    { id: 'm1', mention: 'молоко', entity: 'e1' },
    { id: 'm2', mention: 'звіт', entity: 'e2' },
    { id: 'm3', mention: 'його', entity: null },
  ];
  const ambiguousNull = scoreResolution(ambiguous, 'steps', ambiguousRefs);
  if (ambiguousNull.verdict !== 'review') fail('an ambiguous null was counted as pass or fail');
  const ambiguousPick = scoreResolution(ambiguous, 'steps', [
    { id: 'm1', mention: 'молоко', entity: 'e1' },
    { id: 'm2', mention: 'звіт', entity: 'e2' },
    { id: 'm3', mention: 'його', entity: 'e2' },
  ]);
  if (ambiguousPick.verdict !== 'review') fail('picking one of two antecedents was counted as pass');
  const ambiguousInvented = scoreResolution(ambiguous, 'steps', [
    { id: 'm1', mention: 'молоко', entity: 'e1' },
    { id: 'm2', mention: 'звіт', entity: 'e2' },
    { id: 'm3', mention: 'його', entity: 'e3' },
  ]);
  if (ambiguousInvented.verdict !== 'fail') fail('a third object for an ambiguous pronoun was accepted');

  const errand = ENTITY_SAMPLE.find((item) => item.id === 'plan-not-a-list')!;
  const twoObjects = scoreResolution(errand, 'steps', [
    { id: 'm1', mention: 'молоко', entity: 'e1' },
    { id: 'm2', mention: 'хліб', entity: 'e2' },
  ]);
  const collapsedObjects = scoreResolution(errand, 'steps', [
    { id: 'm1', mention: 'молоко', entity: 'e1' },
    { id: 'm2', mention: 'хліб', entity: 'e1' },
  ]);
  if (twoObjects.verdict !== 'pass') fail(`one action with two objects did not keep two entities: ${twoObjects.reasons.join(',')}`);
  if (collapsedObjects.verdict !== 'fail') fail('two objects of one action were accepted as one entity');
  if (segmentConsistency(errand, [
    { id: 'm1', mention: 'молоко', entity: 'e1' },
    { id: 'm2', mention: 'хліб', entity: 'e2' },
  ], ['Додай молоко і хліб на сьогодні']) !== 'pass') {
    fail('two entities in one segment were treated as a contradiction');
  }

  const folded = segmentConsistency(milk, good, ['Купи молоко на завтра на десяту']);
  const split = segmentConsistency(milk, good, ['Купи молоко', 'перенеси його на завтра на десяту']);
  const replaced = segmentConsistency(bare, [{ id: 'm1', mention: 'це', entity: null }], ['Перенеси Звіт на вечір']);
  if (folded !== 'pass' || split !== 'fail' || replaced !== 'fail') {
    fail(`consistency used the wrong signal: ${folded}/${split}/${replaced}`);
  }
  if (diagnose('pass', 'fail', 'fail') !== 'graph-right-segments-wrong') fail('fold error was not distinguished');
  if (diagnose('fail', 'pass', 'fail') !== 'graph-wrong-segments-right') fail('entity error was not distinguished');
  if (diagnose('fail', 'fail', 'pass') !== 'copied-error') fail('a copied wrong graph was not distinguished');
  if (diagnose('review', 'review', 'pass') !== 'ambiguous') fail('ambiguous review became pass');
  if (diagnose('not-emitted', 'pass', 'na') !== 'withdrawn') fail('withdrawal was scored as a reference pass');

  for (const expect of ENTITY_SAMPLE) {
    if (!fixture(expect)) fail(`fixture mismatch: ${expect.id}`);
  }
  if (ENTITY_SAMPLE.length !== 9) fail(`sample size ${ENTITY_SAMPLE.length}`);
  if (CLOCK.nowIso !== '2026-10-18T06:00:00.000Z' || CLOCK.timeZone !== 'Europe/Kyiv') fail('clock drifted');
  const call = deepseekPlannerCall(DEFAULT_DEEPSEEK_PLANNER_MODEL, prompt, 'same-user');
  if (call.body.model !== 'deepseek-flash' || call.body.temperature !== 0.1) fail('model shape drifted');
  if (call.body.thinking.type !== 'disabled' || call.body.response_format.type !== 'json_object') fail('call flags drifted');
  if (SAVED_RAW.includes(OUT_FILE)) fail('output path aliases a saved run');
  return failures;
}

function estimate(prompt: string) {
  const rows = ENTITY_SAMPLE.map((expect) => pace(prompt, userFor(expect)));
  const paceTokens = rows.reduce((sum, value) => sum + value, 0);
  return {
    scenarios: ENTITY_SAMPLE.length,
    callsFloor: ENTITY_SAMPLE.length,
    callsIfEveryScenarioTakesOneToolRound: ENTITY_SAMPLE.length * 2,
    paceTokens,
    likelyTokens: Math.round(paceTokens * 0.73),
    note: 'Floor matches the fixtures: none of the nine declares a tool. likelyTokens is the pace estimate times 0.73. The client stores total_tokens only.',
  };
}

function readReferences(raw: string): { decision: string; outcome?: string; answer: string; segments: string[]; references: Reference[] | null; fault?: string } {
  let decision;
  try {
    decision = parsePlannerDecision(raw);
  } catch (error) {
    return { decision: 'invalid', answer: '', segments: [], references: null, fault: error instanceof Error ? error.message : 'invalid' };
  }
  const answer = decision.type === 'steps' ? decision.answer : decision.type === 'final' ? decision.assistantMessage : '';
  let references: Reference[] | null = null;
  try {
    const parsed = JSON.parse(raw) as { references?: unknown };
    if (Array.isArray(parsed.references)) {
      references = parsed.references.map((row) => {
        const item = row as { id?: unknown; mention?: unknown; entity?: unknown };
        return {
          id: typeof item.id === 'string' ? item.id : '',
          mention: typeof item.mention === 'string' ? item.mention : '',
          entity: typeof item.entity === 'string' ? item.entity : item.entity === null ? null : '',
        };
      });
    }
  } catch {
    references = null;
  }
  if (decision.type === 'steps') {
    return { decision: decision.type, answer, segments: decision.segments, references };
  }
  if (decision.type === 'final') {
    return { decision: decision.type, outcome: decision.outcome, answer, segments: [], references };
  }
  return { decision: decision.type, answer, segments: [], references };
}

function foldOf(expect: SampleExpect, raw: string, trace: BenchTrace): 'pass' | 'fail' | 'review' {
  if (expect.source === 'voice-regression') {
    const scenario = BENCH_SCENARIOS.find((item) => item.id === expect.id)!;
    return scoreBench(scenario, trace).verdict;
  }
  const scenario = FOLD_SCENARIOS.find((item) => item.id === expect.id)!;
  const parsed = parseFoldRaw(raw);
  const spoken = trace.answer;
  return scoreChannel(scenario, parsed.segments, { type: parsed.type, outcome: parsed.outcome, json: parsed.json, spoken }).verdict;
}

async function runLive(prompt: string): Promise<void> {
  if (SAVED_RAW.includes(OUT_FILE)) throw new Error('refusing to write a saved run');
  process.env.VOICE_LLM_PROVIDER = 'deepseek';
  process.env.DEEPSEEK_PLANNER_MODEL = 'deepseek-flash';
  process.env.VOICE_EVAL_PACE = '1';
  process.env.VOICE_DAILY_TOKEN_LIMIT = '0';
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../../src/app.module');
  const { ConfigService } = await import('@nestjs/config');
  const { GroqClient } = await import('../../src/modules/voice/groq.client');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const groq = app.get(GroqClient);
  const config = app.get(ConfigService);
  const model = config.get<string>('DEEPSEEK_PLANNER_MODEL')?.trim() || DEFAULT_DEEPSEEK_PLANNER_MODEL;
  if (!config.get<string>('DEEPSEEK_API_KEY')?.trim()) throw new Error('DEEPSEEK_API_KEY missing');
  if (model !== 'deepseek-flash') throw new Error('provider shape drifted');
  const shape = deepseekPlannerCall(model, prompt, 'same-user').body;
  const rows: unknown[] = [];
  const persist = () => {
    const spends = groq.evalSpends().map((item) => ({ ...item }));
    mkdirSync(__dirname, { recursive: true });
    writeFileSync(OUT_FILE, JSON.stringify({
      arm: 'ER',
      recordedAt: new Date().toISOString(),
      clock: CLOCK,
      ids: ENTITY_SAMPLE.map((item) => item.id),
      parameters: {
        model: shape.model,
        temperature: shape.temperature,
        maxTokens: shape.max_tokens,
        thinking: shape.thinking,
        responseFormat: shape.response_format,
      },
      prompt: { chars: prompt.length, sha256: hash(prompt), c2Sha256: C2_SHA256 },
      usage: {
        calls: spends.length,
        totalTokens: spends.reduce((sum, item) => sum + item.tokens, 0),
        note: 'The planner client stores total_tokens only.',
        spends,
      },
      rows,
    }, null, 2));
  };
  try {
    for (const expect of ENTITY_SAMPLE) {
      const rounds: Array<{ round: number; raw: string | null; error: string | null; decisionType?: string }> = [];
      const toolCalls: Array<{ name: string; args?: Record<string, unknown> }> = [];
      const toolResults: Array<{ name: string; result: unknown }> = [];
      let raw = '';
      let fault: string | undefined;
      let decisionType = 'invalid';
      let outcome: string | undefined;
      let answer = '';
      let segments: string[] = [];
      let references: Reference[] | null = null;
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
        try {
          raw = await groq.completeJson(prompt, userFor(expect, toolResults), {
            role: 'planner',
            label: `er.${expect.id}.r${round}`,
          });
        } catch (error) {
          fault = error instanceof Error ? error.message : 'fault';
          rounds.push({ round, raw: null, error: fault });
          break;
        }
        const read = readReferences(raw);
        rounds.push({ round, raw, error: read.fault ?? null, decisionType: read.decision });
        if (read.fault) {
          fault = read.fault;
          break;
        }
        if (read.decision !== 'tools') {
          decisionType = read.decision;
          outcome = read.outcome;
          answer = read.answer;
          segments = read.segments;
          references = read.references;
          break;
        }
        let calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
        try {
          const decision = parsePlannerDecision(raw);
          calls = decision.type === 'tools' ? decision.calls : [];
        } catch {
          fault = 'invalid tools';
          break;
        }
        if (!calls.length || calls.length > MAX_TOOL_CALLS || round === MAX_TOOL_ROUNDS) {
          fault = 'tool limit';
          break;
        }
        for (const call of calls) {
          const result = executeTool('default', call as VoiceToolCall);
          toolCalls.push({ name: call.name, args: call.args });
          toolResults.push({ name: call.name, result });
        }
      }
      const trace: BenchTrace = {
        fault,
        type: decisionType,
        outcome,
        segments,
        answer,
        edits: [],
        toolCalls,
        toolRounds: rounds.length > 1 ? rounds.length - 1 : 0,
      };
      const folding = fault ? 'fail' as const : foldOf(expect, raw, trace);
      const resolution = fault
        ? { verdict: 'fail' as const, reasons: [fault] }
        : scoreResolution(expect, decisionType, references);
      const consistency = fault ? 'na' as const : segmentConsistency(expect, references, segments);
      const row = {
        id: expect.id,
        category: expect.category,
        utterance: expect.utterance,
        rounds,
        toolCalls,
        references,
        segments,
        resolution: resolution.verdict,
        resolutionReasons: resolution.reasons,
        folding,
        consistency,
        diagnosis: diagnose(resolution.verdict, folding, consistency),
      };
      rows.push(row);
      persist();
      console.log(JSON.stringify({ id: expect.id, resolution: row.resolution, folding: row.folding, consistency: row.consistency, diagnosis: row.diagnosis }));
    }
  } finally {
    persist();
    const spends = groq.evalSpends();
    console.log(JSON.stringify({
      calls: spends.length,
      totalTokens: spends.reduce((sum, item) => sum + item.tokens, 0),
      file: OUT_FILE,
    }));
    await app.close();
  }
}

function main(): void {
  const c2 = buildPlannerPromptC2();
  const prompt = buildPlannerPromptER();
  const failures = contractChecks(c2, prompt);
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
  const confirm = process.argv.includes('--confirm-llm');
  console.log(JSON.stringify({
    selfCheck: 'pass',
    dryRun: !confirm,
    chars: { C2: c2.length, ER: prompt.length, delta: prompt.length - c2.length },
    sha256: { C2: hash(c2), ER: hash(prompt) },
    ids: ENTITY_SAMPLE.map((item) => item.id),
    estimate: estimate(prompt),
    clock: { nowIso: CLOCK.nowIso, timeZone: CLOCK.timeZone },
    output: OUT_FILE,
    historicalOverwrite: false,
    command: 'npx ts-node --transpile-only benchmark/entity-resolution/runner.ts --confirm-llm',
  }, null, 2));
  if (!confirm) return;
  runLive(prompt).catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}

main();
