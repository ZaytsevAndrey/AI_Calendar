/**
 * Regression benchmark runner.
 *
 *   npx ts-node --transpile-only benchmark/voice-regression/runner.ts
 *     structure and assertions only, no model
 *
 *   npx ts-node --transpile-only benchmark/voice-regression/runner.ts --confirm-llm --wave 1
 *     planner A/B. Do not pass --confirm-llm until the gold is accepted.
 *
 * Production prompts are imported and not edited.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { parsePlannerDecision, type PlannerDecision } from '../../src/modules/voice/voice-agent.planner';
import type { VoiceToolCall } from '../../src/modules/voice/voice-agent.tools';
import { DEFAULT_DEEPSEEK_PLANNER_MODEL, deepseekPlannerCall } from '../../src/modules/voice/deepseek-planner';
import { buildPlannerPromptA, buildPlannerPromptB } from '../../.tmp/planner-ab.prompt';
import { LEGACY_CORPUS } from './legacy';
import { BENCH_SCENARIOS, type BenchCategory, type BenchScenario } from './scenarios';
import { scoreBench, type BenchTrace } from './score';
import { CLOCK, executeTool, interviewPlan, userPrompt } from './world';

const MAX_TOOL_ROUNDS = 2;
const MAX_TOOL_CALLS = 6;
const CATEGORY_COUNTS: Record<BenchCategory, number> = {
  crud: 10,
  time: 10,
  context: 8,
  dependency: 9,
  reminder: 6,
  clarify: 6,
  tool: 6,
  plan: 6,
};

function pace(system: string, user: string): number {
  return Math.ceil((system.length + user.length) / 3.5) + 800;
}

function traceOf(decision: PlannerDecision, toolCalls: BenchTrace['toolCalls']): BenchTrace {
  if (decision.type === 'steps') {
    return { type: 'steps', segments: decision.segments, answer: decision.answer, edits: [], toolCalls };
  }
  if (decision.type === 'final') {
    return {
      type: 'final',
      outcome: decision.outcome,
      segments: [],
      answer: decision.assistantMessage,
      edits: [],
      toolCalls,
    };
  }
  if (decision.type === 'plan_start') {
    return {
      type: 'plan_start',
      segments: [],
      answer: decision.question,
      question: decision.question,
      day: decision.day,
      edits: [],
      toolCalls,
    };
  }
  if (decision.type === 'plan_edits') {
    return {
      type: 'plan_edits',
      segments: [],
      answer: decision.answer,
      edits: decision.edits.map((edit) => JSON.stringify(edit)),
      toolCalls,
    };
  }
  if (decision.type === 'plan_question') {
    return { type: 'plan_question', segments: [], answer: decision.question, question: decision.question, edits: [], toolCalls };
  }
  return { type: decision.type, segments: [], answer: '', edits: [], toolCalls };
}

function assertStructure(): string[] {
  const failures: string[] = [];
  const ids = BENCH_SCENARIOS.map((scenario) => scenario.id);
  if (ids.length !== 61) failures.push(`expected 61 scenarios, got ${ids.length}`);
  if (new Set(ids).size !== ids.length) failures.push('duplicate scenario id');
  for (const [category, count] of Object.entries(CATEGORY_COUNTS)) {
    const got = BENCH_SCENARIOS.filter((scenario) => scenario.category === category).length;
    if (got !== count) failures.push(`${category} has ${got}, expected ${count}`);
  }
  const wave1 = BENCH_SCENARIOS.filter((scenario) => scenario.wave === 1);
  if (wave1.length !== 20) failures.push(`wave 1 has ${wave1.length}`);
  const waveCategories = new Set(wave1.map((scenario) => scenario.category));
  if (waveCategories.size !== 8) failures.push('wave 1 misses a category');
  if (wave1.some((scenario) => scenario.id === 'dep-pronoun-two-antecedents' || scenario.targetReview)) {
    failures.push('the unresolved two-antecedent target leaked into wave 1');
  }
  for (const scenario of BENCH_SCENARIOS) {
    if (scenario.level !== 'planner') failures.push(`${scenario.id} is not planner-level`);
    if (!scenario.branches.length || !scenario.forbid.length || !scenario.contractNote) {
      failures.push(`${scenario.id} is missing gold`);
    }
  }
  const a = buildPlannerPromptA();
  const b = buildPlannerPromptB();
  if (a === b) failures.push('A and B prompts are identical');
  if (!a.includes('First settle the final independent operations')) failures.push('production prompt A changed');
  if (!b.includes('A missing repeated name is not a separate operation')) failures.push('prompt B is not the consolidated copy');
  if (a.includes('Do not turn a delete, move, complete, or skip into a new task.') === false) {
    failures.push('prompt A lost the existing-task move rule');
  }
  if (b.includes('Do not turn a delete, move, complete, or skip into a new task.')) {
    failures.push('prompt B still has the unscoped move ban');
  }
  if (!b.includes('A later move, clock, or length that settles on the create this utterance is making stays that create')) {
    failures.push('prompt B does not keep a later change on the in-utterance create');
  }
  if (!b.includes('the last value of each parameter wins')) failures.push('prompt B dropped a later day, clock, or length on the same object');
  if (!b.includes('Independent objects are not merged')) failures.push('prompt B dropped independent operations');
  if (!b.includes('Several objects of one new errand stay one create')) failures.push('prompt B dropped one errand with several objects');
  if (!b.includes('Two independent errands')) failures.push('prompt B dropped the two-errand split');
  if (!b.includes('An unambiguous withdrawal removes that operation')) failures.push('prompt B dropped withdrawal');
  if (b.includes('An update or a delete of the create this utterance is making stays that create')) {
    failures.push('prompt B still keeps a delete of the in-utterance create');
  }
  if (!b.includes('A delete that unambiguously targets that same create removes it')) {
    failures.push('prompt B does not withdraw a delete of the in-utterance create');
  }
  if (!b.includes('A delete of a task that already existed stays its own operation')) {
    failures.push('prompt B drops a delete of an existing task');
  }
  if (!b.includes('A delete that does not settle one target leaves the create in place')) {
    failures.push('prompt B cancels a create when the delete target is unsettled');
  }
  if (!b.includes('A stated length on a task they already named is that task\'s duration')) {
    failures.push('prompt B still treats a duration update as a time question');
  }
  if (b.includes('An event with neither a day nor a clock is that time question when nothing else was asked.')) {
    failures.push('prompt B still uses the unscoped event-without-clock question');
  }
  if (!b.includes('An event they ask to place, with neither a day nor a clock and no other parameter, is that time question')) {
    failures.push('prompt B no longer asks when a new event has no placement');
  }
  if (!a.includes('An event with neither a day nor a clock is that time question when nothing else was asked.')) {
    failures.push('production prompt A lost decision 8');
  }
  if (!b.includes('whose reference does not settle one object, stays a segment')) {
    failures.push('prompt B can return final for a lone unsettled reference');
  }
  if (!b.includes('Do not return final to ask which object')) failures.push('prompt B asks which object in final');
  if (!b.includes('A pronoun is not that selection')) failures.push('prompt B binds a bare pronoun to the current task');
  if (!b.includes('Explicit selection of the task happening now')) failures.push('prompt B lost an explicit current-task selection');
  if (!b.includes('When that check leaves more than one, the command stays a segment')) {
    failures.push('prompt B picks among several antecedents');
  }
  if (!b.includes('A reference that settles no object stays its own segment')) failures.push('prompt B drops an unsettled reference');
  if (!b.includes('Do not turn a delete, move, complete, or skip of that task into a new task')) {
    failures.push('prompt B no longer protects a move of an existing task');
  }
  if (BENCH_SCENARIOS.some((scenario) => scenario.contract !== 'spec')) failures.push('a scenario still has an unsettled contract');
  const bare = userPrompt({ utterance: 'Перенеси його на завтра' });
  const afterChat = userPrompt({
    utterance: 'Перенеси його на завтра',
    history: [
      { role: 'user', text: 'Додай обід з командою' },
      { role: 'assistant', text: 'Підготував створення «Обід з командою».' },
    ],
  });
  if (bare === afterChat) failures.push('history did not change the shared user prompt');
  if (!bare.includes('2026-10-18') || bare.includes('2026-10-27')) failures.push('user prompt depends on the real date');
  for (const scenario of BENCH_SCENARIOS) {
    const first = userPrompt({
      utterance: scenario.utterance,
      history: scenario.history,
      pendingClarification: scenario.pendingClarification,
      pendingConfirmSummary: scenario.pendingConfirmSummary,
      planDraft: scenario.plan ? interviewPlan() : null,
    });
    const again = userPrompt({
      utterance: scenario.utterance,
      history: scenario.history,
      pendingClarification: scenario.pendingClarification,
      pendingConfirmSummary: scenario.pendingConfirmSummary,
      planDraft: scenario.plan ? interviewPlan() : null,
    });
    if (first !== again) failures.push(`${scenario.id} user prompt is not stable for A and B`);
  }
  const agenda = executeTool('default', { name: 'get_day_agenda', args: { day: '2026-10-19' } }) as { count: number; items: Array<{ name: string }> };
  const emptyDay = executeTool('empty-tomorrow', { name: 'get_day_agenda', args: { day: '2026-10-19' } }) as { count: number };
  const now = executeTool('default', { name: 'get_now_next', args: {} }) as { now: { name: string }; today: string };
  if (agenda.count !== 1 || agenda.items[0]?.name !== 'Нарада') failures.push('tomorrow agenda fixture drifted');
  if (emptyDay.count !== 0) failures.push('empty tomorrow fixture still has items');
  if (now.now?.name !== 'Звіт' || now.today !== '2026-10-18') failures.push('now fixture drifted');
  if (CLOCK.timeZone !== 'Europe/Kyiv' || CLOCK.nowLocal !== '09:00') failures.push('clock drifted');
  return failures;
}

function assertGold(): string[] {
  const failures: string[] = [];
  const expect = (id: string, trace: BenchTrace, verdict: string) => {
    const scenario = BENCH_SCENARIOS.find((item) => item.id === id);
    if (!scenario) {
      failures.push(`missing ${id}`);
      return;
    }
    const score = scoreBench(scenario, trace);
    if (score.verdict !== verdict) failures.push(`${id} ${score.verdict} ${JSON.stringify(score.failures)} expected ${verdict}`);
  };
  const steps = (segments: string[], tools: BenchTrace['toolCalls'] = []): BenchTrace => ({
    type: 'steps',
    segments,
    answer: '',
    edits: [],
    toolCalls: tools,
  });

  expect('dep-create-then-time', steps(['Купи молоко на завтра на десяту']), 'pass');
  expect('dep-create-then-time', steps(['Купи молоко і перенеси його на завтра на десяту']), 'pass');
  expect('dep-several-changes', steps(['Купи молоко на сьогодні, перенеси його на завтра і зроби його на годину']), 'fail');
  expect('dep-create-then-time', steps(['Купи молоко', 'перенеси його на завтра на десяту']), 'fail');
  expect('dep-create-then-time', steps(['Купи молоко на завтра на десяту', 'Купи молоко на завтра на десяту']), 'fail');
  expect('dep-several-changes', steps(['Купи молоко на завтра на годину']), 'pass');
  expect('dep-pronoun-two-antecedents', steps(['Купи молоко', 'Перенеси звіт на завтра', 'зроби його на годину']), 'review');
  expect('dep-pronoun-two-antecedents', steps(['Купи молоко', 'Перенеси звіт на завтра на годину']), 'review');
  expect('dep-pronoun-two-antecedents', steps(['Купи молоко на годину', 'Перенеси звіт на завтра']), 'review');
  expect('dep-pronoun-two-antecedents', steps(['Купи молоко', 'Перенеси звіт на завтра']), 'fail');
  expect('dep-pronoun-two-antecedents', steps(['Купи молоко', 'Перенеси нараду на завтра на годину']), 'fail');
  expect('dep-existing-two-fields', steps(['Перенеси звіт на завтра на годину']), 'pass');
  expect('ctx-bare-pronoun', steps(['Перенеси його на завтра']), 'pass');
  expect('ctx-bare-pronoun', steps(['Перенеси Звіт на завтра']), 'fail');
  expect('ctx-bare-pronoun', steps(['Перенеси Нараду на завтра']), 'fail');
  expect('ctx-explicit-current', steps(['Перенеси поточну задачу на завтра']), 'fail');
  expect('ctx-explicit-current', steps(['Перенеси Звіт на завтра'], [{ name: 'get_now_next' }]), 'pass');
  expect('clar-new-during-pending', { type: 'answer_pending', segments: [], answer: '', edits: [], toolCalls: [] }, 'fail');
  expect('clar-new-during-pending', { type: 'cancel_pending', segments: [], answer: '', edits: [], toolCalls: [] }, 'fail');
  expect('clar-new-during-pending', steps(['Купи хліб']), 'pass');
  expect('tool-agenda-tomorrow', {
    type: 'final',
    outcome: 'answer',
    segments: [],
    answer: 'Завтра нарада об 11.',
    edits: [],
    toolCalls: [],
  }, 'fail');
  expect('tool-agenda-tomorrow', {
    type: 'final',
    outcome: 'answer',
    segments: [],
    answer: 'Завтра нарада з 11:00 до 12:00.',
    edits: [],
    toolCalls: [{ name: 'get_day_agenda', args: { day: '2026-10-19' } }],
  }, 'pass');
  expect('tool-agenda-tomorrow', {
    type: 'final',
    outcome: 'answer',
    segments: [],
    answer: 'Завтра нарада з 08:00 до 09:00.',
    edits: [],
    toolCalls: [{ name: 'get_day_agenda', args: { day: '2026-10-19' } }],
  }, 'fail');
  expect('time-past-morning', {
    type: 'final',
    outcome: 'clarify',
    segments: [],
    answer: 'Шоста ранку вже минула. Маєте на увазі шосту вечора?',
    edits: [],
    toolCalls: [],
  }, 'fail');
  expect('time-past-morning', {
    type: 'final',
    outcome: 'clarify',
    segments: [],
    answer: 'Шоста ранку вже минула. На який день її поставити?',
    edits: [],
    toolCalls: [],
  }, 'pass');
  expect('time-whole-day', steps(['Завтра весь день відрядження']), 'pass');
  expect('time-whole-day', steps(['Завтра відрядження']), 'fail');
  expect('plan-not-a-list', steps(['Додай молоко і хліб на сьогодні']), 'pass');
  expect('plan-not-a-list', steps(['Додай молоко на сьогодні', 'Додай хліб на сьогодні']), 'fail');
  expect('rem-missing-day', steps(['Нагадай про вітаміни']), 'pass');
  expect('rem-missing-day', steps(['Нагадай про вітаміни завтра']), 'fail');
  expect('plan-not-a-list', {
    type: 'plan_start',
    segments: [],
    answer: 'Спланувати?',
    question: 'Спланувати?',
    day: CLOCK.today,
    edits: [],
    toolCalls: [],
  }, 'fail');
  expect('tool-empty-tomorrow', {
    type: 'final',
    outcome: 'answer',
    segments: [],
    answer: '',
    edits: [],
    toolCalls: [{ name: 'get_day_agenda', args: { day: '2026-10-19' } }],
  }, 'review');
  expect('clar-event-no-clock', steps(['Постав зустріч']), 'fail');
  expect('dep-independent', steps(['Купи молоко', 'Перенеси звіт на завтра']), 'pass');
  expect('dep-independent', steps(['Купи молоко на завтра і перенеси звіт']), 'fail');
  expect('dep-independent', steps(['Купи молоко', 'Перенеси звіт на завтра', 'Купи хліб']), 'fail');
  expect('dep-same-name', steps(['Створи нову Звіт', 'Видали стару Звіт']), 'pass');
  expect('dep-same-name', steps(['Створи нову Звіт', 'Видали задачу Звіт']), 'fail');
  expect('time-end-of-day', steps(['Закрити тікет до кінця дня']), 'pass');
  expect('time-end-of-day', steps(['Закрити тікет до 23:00']), 'pass');
  expect('time-end-of-day', steps(['Закрити тікет сьогодні']), 'fail');
  expect('time-whole-day', steps(['Завтра відрядження з 08:00 до 23:00']), 'pass');
  expect('crud-delete-named', steps(['Скасуй нараду']), 'pass');
  expect('crud-delete-named', steps(['Видали нараду']), 'pass');
  expect('crud-update-duration', steps(['На звіт заклади годину']), 'pass');
  expect('crud-update-duration', steps(['Запланувати звіт на 1 годину']), 'fail');
  expect('crud-update-duration', steps(['На звіт заклади годину о 15:00']), 'fail');
  expect('crud-note', steps(['До звіту додай нотатку, що чекаю цифри від фінансів']), 'pass');
  expect('crud-note', steps(['До звіту додай цифри']), 'fail');
  expect('crud-create-similar', steps(['Додай звіт для клієнта']), 'pass');
  expect('crud-create-similar', steps(['Перенеси звіт для клієнта на завтра']), 'fail');
  expect('dep-create-then-time', steps(['Купи молоко на завтра на десяту і хліб']), 'review');
  expect('clar-no-name', { type: 'final', outcome: 'clarify', segments: [], answer: 'Що саме поставити?', edits: [], toolCalls: [] }, 'pass');
  expect('clar-no-name', { type: 'final', outcome: 'clarify', segments: [], answer: 'Поставити зустріч завтра о 15?', edits: [], toolCalls: [] }, 'fail');
  expect('tool-gaps', {
    type: 'final', outcome: 'answer', segments: [], answer: 'Вільно з 10:00.', edits: [],
    toolCalls: [{ name: 'find_free_gaps', args: { day: '2026-10-18' } }],
  }, 'pass');
  expect('tool-gaps', {
    type: 'final', outcome: 'answer', segments: [], answer: 'Вільно з 10:00 і ще з 14:00.', edits: [],
    toolCalls: [{ name: 'find_free_gaps', args: { day: '2026-10-18' } }],
  }, 'fail');
  expect('tool-empty-tomorrow', {
    type: 'final', outcome: 'answer', segments: [], answer: 'Завтра задач немає взагалі.', edits: [],
    toolCalls: [{ name: 'get_day_agenda', args: { day: '2026-10-19' } }],
  }, 'review');
  expect('tool-agenda-tomorrow', {
    type: 'final', outcome: 'answer', segments: [], answer: 'Нарада з одинадцятої до дванадцятої.', edits: [],
    toolCalls: [{ name: 'get_day_agenda', args: { day: '2026-10-19' } }],
  }, 'pass');
  expect('plan-today', {
    type: 'plan_start', day: '2026-10-18', question: "Звіт з дев'ятої.", segments: [], answer: '', edits: [],
    toolCalls: [{ name: 'get_day_agenda', args: { day: '2026-10-18' } }],
  }, 'pass');
  expect('ctx-close-title', steps(['Перенеси звітність на понеділок']), 'pass');
  expect('ctx-close-title', steps(['Перенеси звітність']), 'fail');
  expect('dep-create-cancel', { type: 'final', outcome: 'answer', segments: [], answer: 'Видаляю звіт.', edits: [], toolCalls: [] }, 'fail');
  const seven = steps(Array.from({ length: 7 }, () => 'Купи молоко на завтра на десяту'));
  expect('dep-create-then-time', seven, 'fail');
  expect('dep-create-then-time', { ...steps(['Купи молоко на завтра на десяту']), toolRounds: 3 }, 'fail');
  const unbound = scoreBench(BENCH_SCENARIOS.find((item) => item.id === 'dep-create-then-time')!, steps(['Купи молоко на завтра на десяту', 'перенеси це']));
  if (unbound.verdict !== 'fail' || !unbound.failures.some((item) => item.reason.includes('pronoun'))) {
    failures.push(`unbound це scored ${unbound.verdict} ${JSON.stringify(unbound.failures)}`);
  }
  const fault = scoreBench(BENCH_SCENARIOS[0], {
    fault: 'invalid json',
    segments: [],
    answer: '',
    edits: [],
    toolCalls: [],
  });
  if (fault.verdict !== 'fail') failures.push(`parse fault scored ${fault.verdict}`);
  const packed = JSON.parse(JSON.stringify({
    tokens: 0,
    calls: 0,
    rows: [{ id: 'sample', A: { trace: steps(['Купи молоко']), score: fault }, B: { trace: steps(['Купи молоко']), score: fault } }],
  })) as { rows: Array<{ A: { trace: { segments: string[] }; score: { verdict: string } } }> };
  if (packed.rows[0].A.trace.segments[0] !== 'Купи молоко' || packed.rows[0].A.score.verdict !== 'fail') {
    failures.push('saved result drops the trace or the verdict');
  }
  return failures;
}

function syntheticCounts(): { pass: number; fail: number; review: number } {
  const counts = { pass: 0, fail: 0, review: 0 };
  const probe = (id: string, trace: BenchTrace) => {
    const scenario = BENCH_SCENARIOS.find((item) => item.id === id);
    if (!scenario) return;
    counts[scoreBench(scenario, trace).verdict] += 1;
  };
  const steps = (segments: string[], tools: BenchTrace['toolCalls'] = []): BenchTrace => ({
    type: 'steps', segments, answer: '', edits: [], toolCalls: tools,
  });
  probe('dep-create-then-time', steps(['Купи молоко на завтра на десяту']));
  probe('dep-create-then-time', steps(['Купи молоко і перенеси його на завтра на десяту']));
  probe('dep-several-changes', steps(['Купи молоко на сьогодні, перенеси його на завтра і зроби його на годину']));
  probe('dep-create-then-time', steps(['Купи молоко', 'перенеси його на завтра на десяту']));
  probe('dep-create-then-time', steps(['Купи молоко на завтра на десяту', 'Купи молоко на завтра на десяту']));
  probe('dep-several-changes', steps(['Купи молоко на завтра на годину']));
  probe('dep-pronoun-two-antecedents', steps(['Купи молоко', 'Перенеси звіт на завтра', 'зроби його на годину']));
  probe('dep-pronoun-two-antecedents', steps(['Купи молоко', 'Перенеси звіт на завтра на годину']));
  probe('dep-pronoun-two-antecedents', steps(['Купи молоко на годину', 'Перенеси звіт на завтра']));
  probe('dep-pronoun-two-antecedents', steps(['Купи молоко', 'Перенеси звіт на завтра']));
  probe('dep-pronoun-two-antecedents', steps(['Купи молоко', 'Перенеси нараду на завтра на годину']));
  probe('dep-existing-two-fields', steps(['Перенеси звіт на завтра на годину']));
  probe('ctx-bare-pronoun', steps(['Перенеси його на завтра']));
  probe('ctx-bare-pronoun', steps(['Перенеси Звіт на завтра']));
  probe('ctx-bare-pronoun', steps(['Перенеси Нараду на завтра']));
  probe('ctx-explicit-current', steps(['Перенеси поточну задачу на завтра']));
  probe('ctx-explicit-current', steps(['Перенеси Звіт на завтра'], [{ name: 'get_now_next' }]));
  probe('clar-new-during-pending', { type: 'answer_pending', segments: [], answer: '', edits: [], toolCalls: [] });
  probe('clar-new-during-pending', { type: 'cancel_pending', segments: [], answer: '', edits: [], toolCalls: [] });
  probe('clar-new-during-pending', steps(['Купи хліб']));
  probe('tool-agenda-tomorrow', { type: 'final', outcome: 'answer', segments: [], answer: 'Завтра нарада об 11.', edits: [], toolCalls: [] });
  probe('tool-agenda-tomorrow', { type: 'final', outcome: 'answer', segments: [], answer: 'Завтра нарада з 11:00 до 12:00.', edits: [], toolCalls: [{ name: 'get_day_agenda', args: { day: '2026-10-19' } }] });
  probe('tool-agenda-tomorrow', { type: 'final', outcome: 'answer', segments: [], answer: 'Завтра нарада з 08:00 до 09:00.', edits: [], toolCalls: [{ name: 'get_day_agenda', args: { day: '2026-10-19' } }] });
  probe('time-past-morning', { type: 'final', outcome: 'clarify', segments: [], answer: 'Шоста ранку вже минула. Маєте на увазі шосту вечора?', edits: [], toolCalls: [] });
  probe('time-past-morning', { type: 'final', outcome: 'clarify', segments: [], answer: 'Шоста ранку вже минула. На який день її поставити?', edits: [], toolCalls: [] });
  probe('time-whole-day', steps(['Завтра весь день відрядження']));
  probe('time-whole-day', steps(['Завтра відрядження']));
  probe('plan-not-a-list', steps(['Додай молоко і хліб на сьогодні']));
  probe('plan-not-a-list', steps(['Додай молоко на сьогодні', 'Додай хліб на сьогодні']));
  probe('rem-missing-day', steps(['Нагадай про вітаміни']));
  probe('rem-missing-day', steps(['Нагадай про вітаміни завтра']));
  probe('plan-not-a-list', { type: 'plan_start', segments: [], answer: 'Спланувати?', question: 'Спланувати?', day: CLOCK.today, edits: [], toolCalls: [] });
  probe('tool-empty-tomorrow', { type: 'final', outcome: 'answer', segments: [], answer: '', edits: [], toolCalls: [{ name: 'get_day_agenda', args: { day: '2026-10-19' } }] });
  probe('clar-event-no-clock', steps(['Постав зустріч']));
  probe('dep-independent', steps(['Купи молоко', 'Перенеси звіт на завтра']));
  probe('dep-independent', steps(['Купи молоко на завтра і перенеси звіт']));
  counts[scoreBench(BENCH_SCENARIOS[0], { fault: 'invalid json', segments: [], answer: '', edits: [], toolCalls: [] }).verdict] += 1;
  return counts;
}

function estimate() {
  const systemA = buildPlannerPromptA();
  const systemB = buildPlannerPromptB();
  const rows = BENCH_SCENARIOS.map((scenario) => {
    const user = userPrompt({
      utterance: scenario.utterance,
      history: scenario.history,
      pendingClarification: scenario.pendingClarification,
      pendingConfirmSummary: scenario.pendingConfirmSummary,
      planDraft: scenario.plan ? interviewPlan() : null,
    });
    const calls = scenario.tools?.length ? 2 : 1;
    return {
      id: scenario.id,
      wave: scenario.wave,
      category: scenario.category,
      calls,
      a: pace(systemA, user) * calls,
      b: pace(systemB, user) * calls,
    };
  });
  const sum = (wave?: 1 | 2) => rows
    .filter((row) => wave === undefined || row.wave === wave)
    .reduce((total, row) => ({
      scenarios: total.scenarios + 1,
      calls: total.calls + row.calls * 2,
      paceTokens: total.paceTokens + row.a + row.b,
    }), { scenarios: 0, calls: 0, paceTokens: 0 });
  return { wave1: sum(1), all: sum() };
}

function select(argv: string[]): BenchScenario[] {
  const wave = argv.includes('--wave') ? Number(argv[argv.indexOf('--wave') + 1]) : 0;
  const category = argv.includes('--category') ? argv[argv.indexOf('--category') + 1] : '';
  const ids = argv.includes('--ids') ? argv[argv.indexOf('--ids') + 1].split(',') : [];
  return BENCH_SCENARIOS.filter((scenario) => {
    if (wave && scenario.wave !== wave) return false;
    if (category && scenario.category !== category) return false;
    if (ids.length && !ids.includes(scenario.id)) return false;
    return true;
  });
}

type ArmLog = {
  rounds: Array<{
    round: number;
    userPrompt: string;
    raw: string | null;
    error: string | null;
    decisionType?: string;
    toolResults: Array<{ name: string; args?: Record<string, unknown>; result: unknown }>;
  }>;
  trace: BenchTrace;
  score: ReturnType<typeof scoreBench>;
};

function sharedUser(scenario: BenchScenario, toolResults: Array<{ name: string; result: unknown }> = []): string {
  return userPrompt({
    utterance: scenario.utterance,
    history: scenario.history,
    toolResults,
    pendingClarification: scenario.pendingClarification,
    pendingConfirmSummary: scenario.pendingConfirmSummary,
    planDraft: scenario.plan ? interviewPlan() : null,
  });
}

function summarizeLive(rows: Array<{ id: string; category: string; A: ArmLog; B: ArmLog }>) {
  const rank = { fail: 0, review: 1, pass: 2 } as const;
  const blank = () => ({ pass: 0, fail: 0, review: 0 });
  const arms = { A: blank(), B: blank() };
  const byCategory: Record<string, { A: ReturnType<typeof blank>; B: ReturnType<typeof blank> }> = {};
  const classes = {
    A: { hard: 0, semantic: 0, clarification: 0, tool: 0 },
    B: { hard: 0, semantic: 0, clarification: 0, tool: 0 },
  };
  const bBetter: string[] = [];
  const bWorse: string[] = [];
  const bothFail: string[] = [];
  const bothReview: string[] = [];
  for (const row of rows) {
    for (const arm of ['A', 'B'] as const) {
      const score = row[arm].score;
      arms[arm][score.verdict] += 1;
      byCategory[row.category] ??= { A: blank(), B: blank() };
      byCategory[row.category][arm][score.verdict] += 1;
      for (const kind of ['hard', 'semantic', 'clarification', 'tool'] as const) {
        if (score.failures.some((failure) => failure.class === kind)) classes[arm][kind] += 1;
      }
    }
    if (rank[row.B.score.verdict] > rank[row.A.score.verdict]) bBetter.push(row.id);
    if (rank[row.B.score.verdict] < rank[row.A.score.verdict]) bWorse.push(row.id);
    if (row.A.score.verdict === 'fail' && row.B.score.verdict === 'fail') bothFail.push(row.id);
    if (row.A.score.verdict === 'review' && row.B.score.verdict === 'review') bothReview.push(row.id);
  }
  return { arms, byCategory, classes, bBetter, bWorse, bothFail, bothReview };
}

async function runLive(argv: string[]): Promise<void> {
  const selected = select(argv);
  const wave = argv.includes('--wave') ? Number(argv[argv.indexOf('--wave') + 1]) : 0;
  if (wave === 1) {
    const categories = new Set(selected.map((scenario) => scenario.category));
    if (selected.length !== 20 || categories.size !== 8) {
      throw new Error(`wave 1 is not ready: ${selected.length} scenarios, ${categories.size} categories`);
    }
    if (selected.some((scenario) => scenario.id === 'dep-pronoun-two-antecedents')) {
      throw new Error('wave 2 target-review scenario is in wave 1');
    }
  }
  const system = { A: buildPlannerPromptA(), B: buildPlannerPromptB() };
  if (system.A === system.B) throw new Error('A and B system prompts are identical');
  for (const scenario of selected) {
    const first = sharedUser(scenario);
    if (first !== sharedUser(scenario)) throw new Error(`${scenario.id} user prompt is not stable`);
  }
  const configuredModel = process.env.DEEPSEEK_PLANNER_MODEL?.trim() || DEFAULT_DEEPSEEK_PLANNER_MODEL;
  const callShape = deepseekPlannerCall(configuredModel, system.A, 'same-user');
  const parameters = {
    role: 'planner' as const,
    model: callShape.body.model,
    temperature: callShape.body.temperature,
    maxTokens: callShape.body.max_tokens,
    thinking: callShape.body.thinking,
    responseFormat: callShape.body.response_format,
    providerSwitch: process.env.VOICE_LLM_PROVIDER?.trim() || null,
    note: 'A and B share this call shape. Only the system message differs. Tool JSON comes from the same fixture executor.',
  };

  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../../src/app.module');
  const { GroqClient } = await import('../../src/modules/voice/groq.client');
  process.env.VOICE_EVAL_PACE = '1';
  process.env.VOICE_DAILY_TOKEN_LIMIT = '0';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const groq = app.get(GroqClient);
  const arms = argv.includes('--arm') ? [argv[argv.indexOf('--arm') + 1]] : ['A', 'B'];
  const rows: Array<{ id: string; category: string; utterance: string; userPrompt: string; A?: ArmLog; B?: ArmLog }> = [];
  const file = join(__dirname, wave === 1 ? 'wave-1-ab.json' : 'last-run.json');
  const persist = () => {
    const spends = groq.evalSpends().map((row) => ({ ...row }));
    const finished = rows.filter((row): row is { id: string; category: string; utterance: string; userPrompt: string; A: ArmLog; B: ArmLog } => Boolean(row.A && row.B));
    const body = {
      wave,
      clock: CLOCK,
      parameters,
      systemPrompt: system,
      usage: {
        calls: spends.length,
        totalTokens: spends.reduce((sum, row) => sum + row.tokens, 0),
        promptTokens: null,
        completionTokens: null,
        cost: null,
        note: 'The planner client stores total_tokens only. No input/output split and no tariff are recorded.',
        spends,
      },
      summary: arms.includes('A') && arms.includes('B') ? summarizeLive(finished) : null,
      rows,
    };
    mkdirSync(__dirname, { recursive: true });
    writeFileSync(file, JSON.stringify(body, null, 2));
    if (wave === 1) writeFileSync(join(__dirname, 'last-run.json'), JSON.stringify(body, null, 2));
  };
  try {
    for (const scenario of selected) {
      const openingUser = sharedUser(scenario);
      const row: { id: string; category: string; utterance: string; userPrompt: string; A?: ArmLog; B?: ArmLog } = {
        id: scenario.id,
        category: scenario.category,
        utterance: scenario.utterance,
        userPrompt: openingUser,
      };
      for (const arm of arms) {
        const prompt = arm === 'A' ? system.A : system.B;
        const toolCalls: BenchTrace['toolCalls'] = [];
        const toolResults: Array<{ name: string; result: unknown }> = [];
        const rounds: ArmLog['rounds'] = [];
        let finalTrace: BenchTrace = { segments: [], answer: '', edits: [], toolCalls, fault: 'no decision' };
        for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
          const user = round === 0 ? openingUser : sharedUser(scenario, toolResults);
          if (round === 0 && user !== openingUser) throw new Error(`${scenario.id} ${arm} round 0 prompt drifted`);
          let raw: string | null = null;
          let decision: PlannerDecision;
          try {
            raw = await groq.completeJson(prompt, user, { role: 'planner', label: `bench.${arm}.${scenario.id}.r${round}` });
            decision = parsePlannerDecision(raw);
          } catch (error) {
            const message = error instanceof Error ? error.message : 'fault';
            rounds.push({ round, userPrompt: user, raw, error: message, toolResults: [] });
            finalTrace = { segments: [], answer: '', edits: [], toolCalls, fault: message };
            break;
          }
          const produced: ArmLog['rounds'][number]['toolResults'] = [];
          rounds.push({ round, userPrompt: user, raw, error: null, decisionType: decision.type, toolResults: produced });
          if (decision.type !== 'tools') {
            finalTrace = traceOf(decision, toolCalls);
            break;
          }
          if (!decision.calls.length || decision.calls.length > MAX_TOOL_CALLS || round === MAX_TOOL_ROUNDS) {
            finalTrace = { segments: [], answer: '', edits: [], toolCalls, fault: 'tool limit' };
            break;
          }
          for (const call of decision.calls as VoiceToolCall[]) {
            const result = executeTool(scenario.world ?? 'default', call);
            toolCalls.push({ name: call.name, args: call.args });
            toolResults.push({ name: call.name, result });
            produced.push({ name: call.name, args: call.args, result });
          }
        }
        const logged: ArmLog = { rounds, trace: finalTrace, score: scoreBench(scenario, finalTrace) };
        if (arm === 'A') row.A = logged;
        if (arm === 'B') row.B = logged;
      }
      rows.push(row);
      persist();
      console.log(JSON.stringify({ id: scenario.id, A: row.A?.score.verdict, B: row.B?.score.verdict }));
    }
  } finally {
    persist();
    const spends = groq.evalSpends();
    console.log(JSON.stringify({
      calls: spends.length,
      totalTokens: spends.reduce((sum, row) => sum + row.tokens, 0),
      models: [...new Set(spends.map((row) => row.model))],
      file,
    }));
    await app.close();
  }
}

function rescoreSaved(): void {
  const source = join(__dirname, 'wave-1-ab.json');
  const saved = JSON.parse(readFileSync(source, 'utf8')) as {
    rows: Array<{
      id: string;
      category: string;
      utterance: string;
      A: { trace: BenchTrace; score: { verdict: 'pass' | 'fail' | 'review'; failures: Array<{ class: string; reason: string }> } };
      B: { trace: BenchTrace; score: { verdict: 'pass' | 'fail' | 'review'; failures: Array<{ class: string; reason: string }> } };
    }>;
  };
  const reasonFor: Record<string, string> = {
    'plan-not-a-list': 'Milk and bread are one errand. The previous gold required two segments.',
    'rem-missing-day': 'A reminder segment with no day is a handoff to the specialist. An invented day still fails.',
    'tool-agenda-tomorrow': 'Нарада is 11:00–12:00 in Europe/Kyiv. 08:00–09:00 repeats the UTC instant.',
    'time-past-morning': 'A named morning may not be offered as 18:00. The check now reads the question.',
    'time-whole-day': 'The segment must keep the whole-day span, not only the date.',
    'plan-today': 'The opening must use the local 09:00 of Звіт. 06:00Z is not that clock.',
  };
  const blank = () => ({ pass: 0, fail: 0, review: 0 });
  const arms = { A: blank(), B: blank() };
  const previous = { A: blank(), B: blank() };
  const byCategory: Record<string, { A: ReturnType<typeof blank>; B: ReturnType<typeof blank> }> = {};
  const classes = {
    A: { hard: 0, semantic: 0, clarification: 0, tool: 0 },
    B: { hard: 0, semantic: 0, clarification: 0, tool: 0 },
  };
  const rows = saved.rows.map((row) => {
    const scenario = BENCH_SCENARIOS.find((item) => item.id === row.id);
    if (!scenario) throw new Error(`saved row ${row.id} is not in the benchmark`);
    const scored = {
      A: scoreBench(scenario, row.A.trace),
      B: scoreBench(scenario, row.B.trace),
    };
    const changes = (['A', 'B'] as const).flatMap((arm) => {
      const from = row[arm].score.verdict;
      const to = scored[arm].verdict;
      previous[arm][from] += 1;
      arms[arm][to] += 1;
      byCategory[row.category] ??= { A: blank(), B: blank() };
      byCategory[row.category][arm][to] += 1;
      for (const kind of ['hard', 'semantic', 'clarification', 'tool'] as const) {
        if (scored[arm].failures.some((failure) => failure.class === kind)) classes[arm][kind] += 1;
      }
      if (from === to) return [];
      return [{
        arm,
        from,
        to,
        reason: reasonFor[row.id] ?? 'The gold assertion changed.',
        previousFailures: row[arm].score.failures,
        failures: scored[arm].failures,
      }];
    });
    return {
      id: row.id,
      category: row.category,
      utterance: row.utterance,
      changes,
      A: { verdict: scored.A.verdict, failures: scored.A.failures, segments: row.A.trace.segments, answer: row.A.trace.answer },
      B: { verdict: scored.B.verdict, failures: scored.B.failures, segments: row.B.trace.segments, answer: row.B.trace.answer },
    };
  });
  const systemB = buildPlannerPromptB();
  const controlIds = [
    'dep-create-then-time',
    'dep-several-changes',
    'dep-independent',
    'dep-create-cancel',
    'dep-same-name',
    'plan-not-a-list',
    'dep-pronoun-two-antecedents',
    'ctx-bare-pronoun',
  ];
  const control = controlIds.map((id) => {
    const scenario = BENCH_SCENARIOS.find((item) => item.id === id);
    if (!scenario) throw new Error(`missing control ${id}`);
    const user = userPrompt({
      utterance: scenario.utterance,
      history: scenario.history,
      pendingClarification: scenario.pendingClarification,
      pendingConfirmSummary: scenario.pendingConfirmSummary,
      planDraft: scenario.plan ? interviewPlan() : null,
    });
    const calls = scenario.tools?.length ? 2 : 1;
    return { id, calls, paceTokens: pace(systemB, user) * calls };
  });
  const controlPace = control.reduce((sum, row) => sum + row.paceTokens, 0);
  const controlCalls = control.reduce((sum, row) => sum + row.calls, 0);
  const body = {
    source: 'wave-1-ab.json',
    note: 'Rescored from the saved traces. Raw model replies stay in wave-1-ab.json and were not rewritten.',
    previous,
    arms,
    byCategory,
    classes,
    stillFailing: rows.filter((row) => row.A.verdict === 'fail' || row.B.verdict === 'fail').map((row) => ({
      id: row.id,
      A: row.A.verdict,
      B: row.B.verdict,
      failuresA: row.A.failures,
      failuresB: row.B.failures,
    })),
    rows,
    controlB: {
      scenarios: control.length,
      calls: controlCalls,
      paceTokens: controlPace,
      likelyTokens: Math.round(controlPace * 0.73),
      bothArmsCalls: controlCalls * 2,
      bothArmsLikelyTokens: Math.round(controlPace * 2 * 0.73),
      tariff: null,
    },
  };
  const file = join(__dirname, 'wave-1-rescore.json');
  writeFileSync(file, JSON.stringify(body, null, 2));
  console.log(JSON.stringify({
    file,
    previous,
    arms,
    byCategory,
    classes,
    changes: rows.flatMap((row) => row.changes.map((change) => ({ id: row.id, ...change }))),
    stillFailing: body.stillFailing,
    controlB: body.controlB,
  }, null, 2));
}

function main(): void {
  const structure = assertStructure();
  const gold = assertGold();
  const failures = [...structure, ...gold];
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
  const cost = estimate();
  console.log(JSON.stringify({
    selfCheck: 'pass',
    scenarios: BENCH_SCENARIOS.length,
    categories: CATEGORY_COUNTS,
    conflicts: BENCH_SCENARIOS.filter((scenario) => scenario.contract === 'conflict').map((scenario) => scenario.id),
    synthetic: syntheticCounts(),
    legacy: LEGACY_CORPUS.counts,
    estimate: cost,
    likelyTokensFromLastSmokeRatio: {
      wave1: Math.round(cost.wave1.paceTokens * 0.73),
      all: Math.round(cost.all.paceTokens * 0.73),
    },
  }, null, 2));
  if (process.argv.includes('--rescore')) {
    rescoreSaved();
    return;
  }
  if (process.argv.includes('--confirm-llm')) {
    runLive(process.argv).catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
  }
}

main();
