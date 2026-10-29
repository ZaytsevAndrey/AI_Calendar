/**
 * Offline gold check for Phase 4.7.3. Makes no model calls.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { config as loadEnv } from 'dotenv';
import { CLOCK } from '../../../../../benchmark/voice-regression/world';
import { PROMPT_A_HASH } from '../interpreters/prompts';
import { DEEPSEEK_FLASH_PRICE } from '../llm/pricing';
import { eligibleCompleteGold, expectationForEdge } from './complete-gold';
import { EDGE_CASES } from './edge-cases';
import { validateGoldCorpus } from './field-gold';

loadEnv({ path: join(__dirname, '../../../../../.env') });

const validation = validateGoldCorpus();
const selected = eligibleCompleteGold();
const eligible = selected.eligible.map((id) => {
  const edge = EDGE_CASES.find((item) => item.id === id);
  const expectation = edge ? expectationForEdge(edge) : null;
  const keys = expectation ? Object.keys(expectation).filter((key) => key !== 'acceptable' && expectation[key as keyof typeof expectation] != null) : [];
  return {
    id,
    utterance: edge?.transcript ?? '',
    outcome: edge?.expect.outcome ?? null,
    intentCount: edge?.expect.intentCount ?? null,
    assertionKeys: keys,
    expectation,
  };
});
const droppedComplete = selected.excluded.filter((row) => row.gold === 'complete');
const byGold: Record<string, number> = {};
for (const row of selected.excluded) byGold[row.gold] = (byGold[row.gold] ?? 0) + 1;
const report = {
  modelCalls: 0,
  goldOk: validation.ok,
  problems: validation.problems,
  coverage: validation.coverage,
  denominator: eligible.length,
  eligibleIds: eligible.map((row) => row.id),
  droppedComplete,
  excludedByGold: byGold,
  clock: CLOCK,
  promptHash: PROMPT_A_HASH,
  pricingModel: DEEPSEEK_FLASH_PRICE.model,
  configuredModel: process.env.DEEPSEEK_PLANNER_MODEL?.trim() || DEEPSEEK_FLASH_PRICE.model,
  keyPresent: Boolean(process.env.DEEPSEEK_API_KEY?.trim()),
  rows: eligible,
};
const root = join(__dirname, '../../../../../../docs/voice-vnext/runs/phase473-deepseek');
mkdirSync(root, { recursive: true });
writeFileSync(join(root, 'preflight.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  modelCalls: 0,
  goldOk: report.goldOk,
  problems: report.problems.length,
  coverage: report.coverage,
  denominator: report.denominator,
  droppedComplete: report.droppedComplete,
  excludedByGold: report.excludedByGold,
  configuredModel: report.configuredModel,
  pricingModel: report.pricingModel,
  keyPresent: report.keyPresent,
  promptHash: report.promptHash,
  ids: report.eligibleIds,
}, null, 2));
